from __future__ import annotations

import importlib
import importlib.util


def _load_env_from_dotenv() -> None:
    """Load variables from a `.env` file when python-dotenv is available.

    The production environment already installs python-dotenv via
    `requirements.txt`, but local setups may occasionally miss it. Rather than
    crashing the whole application with a ModuleNotFoundError, we opportunistically
    load the helper if it can be imported.
    """

    if importlib.util.find_spec("dotenv") is None:
        return

    module = importlib.import_module("dotenv")
    load = getattr(module, "load_dotenv", None)
    if callable(load):
        load()


_load_env_from_dotenv()

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    _SCHED_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    BackgroundScheduler = None
    _SCHED_AVAILABLE = False
from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, field_validator
from typing import List, Optional, Literal
from datetime import datetime, date
import json, uuid, os, shutil, csv, io

# Switched to simplified ESPN-driven ticker implementation
from backend.cfb2 import get_cached_payload, refresh_cache

# Optional PDF engines
try:
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    _PDF_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    _PDF_AVAILABLE = False

try:
    from fpdf import FPDF  # fpdf2
    _FPDF_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    _FPDF_AVAILABLE = False

DATA_DIR = "data"
CASES_PATH = os.path.join(DATA_DIR, "cases.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
os.makedirs(DATA_DIR, exist_ok=True); os.makedirs(BACKUP_DIR, exist_ok=True)
FAVICON_FILE = os.path.join("static", "favicon.svg")

# ---------- Models ----------
class FocusEntry(BaseModel):
    at: datetime
    author: str
    text: str

class ColleagueTask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    at: datetime
    author: str  # Initials: WB, NC, TG, CS, SJ
    task: str
    reviewed: bool = False
    reviewed_at: Optional[datetime] = None

class Deadline(BaseModel):
    due_date: Optional[date]  # allow clearing a date from the UI
    description: str
    resolved: bool = False

Stage = Literal["Pre-filing","Filed","Discovery","Pretrial","Trial","Closed"]
# Canonical statuses (remove misspelling "Pre-Filling")
Status = Literal["Prospect","Pre-Filing","Active","Settlement","Post-Trial","Appeal"]

class ExternalRef(BaseModel):
    # reserved for Filevine; not used yet
    filevine_id: Optional[str] = None
    filevine_number: Optional[str] = None
    linked_at: Optional[datetime] = None

# --- Extended client/case data ---
class ICDCode(BaseModel):
    code: str
    description: Optional[str] = None

class Provider(BaseModel):
    name: str
    role: Optional[str] = None              # e.g., Insurance, Medical Provider, Adjuster, Other
    represents: Optional[str] = None        # e.g., Plaintiff, Defendant, Client, Insured
    company: Optional[str] = None           # Carrier or facility name
    phone: Optional[str] = None
    claim_number: Optional[str] = None
    policy_number: Optional[str] = None
    notes: Optional[str] = None

SPECIAL_STATUSES: set[str] = {"Prospect", "Settlement", "Post-Trial", "Appeal"}


class Case(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # primary key
    client_name: str
    case_name: str                                   # e.g., "Smith v. Jones"
    case_type: str                                   # free text
    stage: Stage = "Pre-filing"
    status: Status = "Pre-Filing"
    attention: Literal["needs_attention","waiting",""] = ""
    paralegal: str = ""
    current_focus: str = ""                          # one-liner, last focus
    focus_log: List[FocusEntry] = Field(default_factory=list)
    deadlines: List[Deadline] = Field(default_factory=list)
    colleague_tasks: List[ColleagueTask] = Field(default_factory=list)

    # Court fields (optional in pre-filing)
    case_number: Optional[str] = None
    county: Optional[str] = None
    division: Optional[str] = None
    judge: Optional[str] = None
    primary_attorney: Optional[str] = None
    opposing_counsel: Optional[str] = None
    opposing_firm: Optional[str] = None

    # Client details
    client_address: Optional[str] = None
    client_phone: Optional[str] = None
    client_dob: Optional[date] = None

    # Narrative summary of claim
    claim_summary: str = ""

    # Medical coding (ICD-10 codes)
    icd10: List[ICDCode] = Field(default_factory=list)

    # Providers and related contacts (insurance, facilities, adjusters, etc.)
    providers: List[Provider] = Field(default_factory=list)

    # Manual priority flag for TV and list emphasis
    top_priority: bool = False
    # Archive flag to hide finished cases from active views
    archived: bool = False

    # Derivatives
    next_due: Optional[date] = None
    external: ExternalRef = Field(default_factory=ExternalRef)

    # Validators to accept tolerant inputs
    @field_validator("status", mode="before")
    @classmethod
    def _coerce_status(cls, v):
        if v is None:
            return "Pre-Filing"
        # Map common variations to canonical Status values
        mapped = normalize_status(str(v))
        return mapped or "Pre-Filing"

    @field_validator("attention", mode="before")
    @classmethod
    def _coerce_attention(cls, v):
        allowed = {"needs_attention", "waiting", ""}
        if v in allowed:
            return v
        s = str(v or "").strip().lower()
        if s in ("needs", "need", "needs-attention", "needs_attention"):
            return "needs_attention"
        if s in ("wait", "waiting"):
            return "waiting"
        return ""

class CaseFile(BaseModel):
    schema_version: int = 1
    saved_at: datetime
    cases: List[Case] = Field(default_factory=list)


class ImportPayload(BaseModel):
    csv: str

# ---------- Storage ----------
def _migrate_raw_case(d: dict) -> tuple[dict, bool]:
    changed = False
    case = dict(d)
    # normalize stage
    stage_norm = normalize_stage(case.get("stage", ""))
    if not stage_norm:
        stage_norm = "Pre-filing"
    if case.get("stage") != stage_norm:
        case["stage"] = stage_norm
        changed = True

    # normalize status with tolerance; default based on case_number if not special
    status_norm = normalize_status(case.get("status", ""))
    if not status_norm or status_norm not in ("Settlement", "Post-Trial", "Appeal"):
        cn = (case.get("case_number") or "").strip()
        status_norm = "Active" if cn else "Pre-Filing"
    if case.get("status") != status_norm:
        case["status"] = status_norm
        changed = True

    # normalize attention
    if case.get("attention") not in ("needs_attention", "waiting", ""):
        case["attention"] = ""
        changed = True

    # normalize deadlines list and coerce optional dates
    dls = case.get("deadlines")
    if not isinstance(dls, list):
        dls = []
        changed = True
    out_dls = []
    for item in dls:
        if not isinstance(item, dict):
            changed = True
            continue
        due = item.get("due_date")
        if not due:
            due = None
        desc = item.get("description") or ""
        res = bool(item.get("resolved", False))
        out_dls.append({"due_date": due, "description": desc, "resolved": res})
        # if original differs, mark changed
        if (item.get("due_date") != due) or (item.get("description") != desc) or (bool(item.get("resolved", False)) != res):
            changed = True
    case["deadlines"] = out_dls

    # ensure focus_log is a list
    fl = case.get("focus_log")
    if not isinstance(fl, list):
        case["focus_log"] = []
        changed = True

    return case, changed


def _migrate_raw_file(raw: dict) -> tuple[dict, bool]:
    if not isinstance(raw, dict):
        return {"schema_version": 1, "saved_at": datetime.utcnow().isoformat(), "cases": []}, True
    changed = False
    cases = raw.get("cases")
    if not isinstance(cases, list):
        raw["cases"] = []
        changed = True
        cases = []
    new_cases = []
    for c in cases:
        if not isinstance(c, dict):
            changed = True
            continue
        nc, ch = _migrate_raw_case(c)
        new_cases.append(nc)
        changed = changed or ch
    raw["cases"] = new_cases
    # bump/ensure schema version
    if raw.get("schema_version") != 1:
        raw["schema_version"] = 1
        changed = True
    return raw, changed


def load() -> CaseFile:
    if not os.path.exists(CASES_PATH):
        return CaseFile(saved_at=datetime.utcnow(), cases=[])
    with open(CASES_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    raw, changed = _migrate_raw_file(raw)
    try:
        model = CaseFile(**raw)
    except ValidationError:
        # As a last resort, attempt to coerce again with defaults
        raw = {"schema_version": 1, "saved_at": datetime.utcnow().isoformat(), "cases": raw.get("cases", [])}
        model = CaseFile(**raw)
        changed = True
    if changed:
        # write back normalized data for durability
        save(model)
    return model

def save(model: CaseFile):
    tmp = CASES_PATH + ".tmp"
    model.saved_at = datetime.utcnow()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(json.loads(model.model_dump_json()), f, indent=2)
    shutil.move(tmp, CASES_PATH)
    # rolling backup
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    shutil.copyfile(CASES_PATH, os.path.join(BACKUP_DIR, f"cases-{stamp}.json"))

def recompute(case: Case) -> Case:
    # next_due from unresolved deadlines (ignore None dates)
    future = [d.due_date for d in case.deadlines if (not d.resolved) and (d.due_date is not None)]
    case.next_due = min(future) if future else None
    # current_focus from latest focus entry
    if case.focus_log:
        case.current_focus = case.focus_log[-1].text
    has_case_number = bool((case.case_number or "").strip())
    # Do not override user-specified special statuses (Prospect/Settlement/Post-Trial/Appeal)
    # Also, if archived, leave status as-is.
    if (not getattr(case, "archived", False)) and (case.status not in SPECIAL_STATUSES):
        case.status = "Active" if has_case_number else "Pre-Filing"
    return case

# ---------- App ----------
app = FastAPI(title="Caseboard")
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

# Lightweight ICD-10 description map (expandable). Fallback returns empty description.
ICD10_MAP: dict[str, str] = {
    "A00": "Cholera",
    "S06.0X0A": "Concussion without loss of consciousness, initial encounter",
    "S06.0X1A": "Concussion with loss of consciousness of 30 minutes or less, initial encounter",
    "M54.5": "Low back pain",
    "S16.1XXA": "Strain of muscle, fascia and tendon at neck level, initial encounter",
    "S13.4XXA": "Sprain of ligaments of cervical spine, initial encounter",
    "S80.01XA": "Contusion of knee, initial encounter",
}


@app.get("/favicon.ico")
def favicon() -> FileResponse:
    return FileResponse(FAVICON_FILE, media_type="image/svg+xml")


@app.on_event("startup")
def _startup():
    try:
        refresh_cache()
    except Exception:
        pass
    if getattr(app.state, "scheduler", None):
        return
    scheduler = BackgroundScheduler(timezone="UTC") if _SCHED_AVAILABLE else None
    if not scheduler:
        app.state.scheduler = None
        return
    scheduler.add_job(
        refresh_cache,
        "interval",
        seconds=90,
        id="cfb-refresh",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    app.state.scheduler = scheduler


@app.on_event("shutdown")
def _shutdown():
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler:
        scheduler.shutdown(wait=False)


VALID_STAGES = {stage.lower(): stage for stage in Stage.__args__}
VALID_STATUSES = {status.lower(): status for status in Status.__args__}

# Accept common variations and typos for robustness
_STAGE_SYNONYMS = {
    "pre filing": "Pre-filing",
    "prefiling": "Pre-filing",
    "pre-filed": "Pre-filing",
}
_STATUS_SYNONYMS = {
    # Various ways users may enter Pre-Filing
    "pre-filing": "Pre-Filing",
    "pre filing": "Pre-Filing",
    "prefiling": "Pre-Filing",
    "pre-filling": "Pre-Filing",  # common typo
    "pre-filling ": "Pre-Filing",
    # Prospect
    "prospect": "Prospect",
    # Normal forms map to themselves for completeness
    "active": "Active",
    "settlement": "Settlement",
    "post-trial": "Post-Trial",
    "post trial": "Post-Trial",
    "appeal": "Appeal",
}


def normalize(text: Optional[str]) -> str:
    if text is None:
        return ""
    return text.strip()


def normalize_stage(raw: str) -> Optional[Stage]:
    value = normalize(raw)
    if not value:
        return None
    key = value.lower()
    if key in VALID_STAGES:
        return VALID_STAGES[key]
    if key in _STAGE_SYNONYMS:
        return _STAGE_SYNONYMS[key]  # type: ignore[return-value]
    return None


def normalize_status(raw: str) -> Optional[Status]:
    value = normalize(raw)
    if not value:
        return None
    key = value.lower()
    # direct exact match
    if key in VALID_STATUSES:
        return VALID_STATUSES[key]
    # tolerant mapping
    mapped = _STATUS_SYNONYMS.get(key)
    if mapped:
        return mapped  # type: ignore[return-value]
    return None


def apply_case_updates(original: Case, updates: dict) -> Case:
    data = original.model_dump()
    for field, value in updates.items():
        if value is None:
            continue
        data[field] = value
    return Case(**data)


def import_cases_from_csv(content: str) -> dict:
    stream = io.StringIO(content)
    reader = csv.DictReader(stream)
    if not reader.fieldnames:
        raise ValueError("CSV file is missing a header row")
    fieldnames = [name.strip() for name in reader.fieldnames if name]
    reader.fieldnames = fieldnames
    lookup = {name.lower(): name for name in fieldnames}
    required = {"client_name", "case_name", "case_type"}
    missing = [col for col in required if col not in lookup]
    if missing:
        raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")

    def cell(row, key):
        actual = lookup.get(key)
        return normalize(row.get(actual)) if actual else ""

    model = load()
    added = 0
    updated = 0
    errors: list[str] = []

    def find_existing(case_number: Optional[str], client_name: str, case_name: str) -> Optional[int]:
        number_key = (case_number or "").lower()
        for idx, existing in enumerate(model.cases):
            if number_key and (existing.case_number or "").lower() == number_key:
                return idx
        client_key = client_name.lower()
        case_key = case_name.lower()
        for idx, existing in enumerate(model.cases):
            if existing.client_name.lower() == client_key and existing.case_name.lower() == case_key:
                return idx
        return None

    for row_index, row in enumerate(reader, start=2):
        client_name = cell(row, "client_name")
        case_name = cell(row, "case_name")
        case_type = cell(row, "case_type") or "Other"
        if not client_name or not case_name:
            errors.append(f"Row {row_index}: missing client_name or case_name")
            continue

        stage_value = normalize_stage(cell(row, "stage"))
        status_value = normalize_status(cell(row, "status"))
        paralegal = cell(row, "paralegal")
        current_focus = cell(row, "current_focus")
        case_number = cell(row, "case_number") or None

        existing_index = find_existing(case_number, client_name, case_name)
        if existing_index is not None:
            existing = model.cases[existing_index]
            updates = {
                "client_name": client_name,
                "case_name": case_name,
                "case_type": case_type if case_type else None,
                "paralegal": paralegal if paralegal else None,
                "current_focus": current_focus if current_focus else None,
                "case_number": case_number if case_number else None,
            }
            if stage_value:
                updates["stage"] = stage_value
            if status_value and status_value in SPECIAL_STATUSES:
                updates["status"] = status_value
            updated_case = apply_case_updates(existing, updates)
            model.cases[existing_index] = recompute(updated_case)
            updated += 1
            continue

        stage_final = stage_value or "Pre-filing"
        status_final = status_value if status_value in SPECIAL_STATUSES else None
        new_case_kwargs = dict(
            client_name=client_name,
            case_name=case_name,
            case_type=case_type,
            stage=stage_final,
            paralegal=paralegal,
            current_focus=current_focus,
            case_number=case_number,
        )
        if status_final:
            new_case_kwargs["status"] = status_final
        new_case = Case(**new_case_kwargs)
        model.cases.append(recompute(new_case))
        added += 1

    if added or updated:
        save(model)

    return {"added": added, "updated": updated, "errors": errors}

# ----- Add New Case Page -----
@app.get("/add")
def add_page():
    return FileResponse("static/add.html")

# ----- Edit Case Page -----
@app.get("/edit")
def edit_page():
    return FileResponse("static/edit.html")

@app.get("/")
def root():
    return FileResponse("static/index.html")

# ----- Auxiliary APIs -----
@app.get("/api/icd10/{code}")
def api_icd10(code: str):
    c = (code or "").strip().upper()
    return {"code": c, "description": ICD10_MAP.get(c, "")}

# ----- Manage API -----
@app.get("/api/cases", response_model=CaseFile)
def api_get_cases():
    model = load()
    model.cases = [recompute(c) for c in model.cases]
    return model

@app.post("/api/cases", response_model=Case)
def api_create_case(case: Case):
    model = load()
    case = recompute(case)
    model.cases.append(case)
    save(model)
    return case

@app.get("/api/cases/{case_id}", response_model=Case)
def api_get_case(case_id: str):
    model = load()
    for c in model.cases:
        if c.id == case_id:
            return recompute(c)
    raise HTTPException(404, "Not found")

@app.put("/api/cases/{case_id}", response_model=Case)
def api_update_case(case_id: str, patch: Case):
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            data = patch.model_dump()
            data["id"] = c.id  # keep id
            case = Case(**data)
            model.cases[i] = recompute(case)
            save(model)
            return model.cases[i]
    raise HTTPException(404, "Not found")

@app.delete("/api/cases/{case_id}", status_code=204)
def api_delete_case(case_id: str):
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            model.cases.pop(i)
            save(model)
            return Response(status_code=204)
    raise HTTPException(404, "Not found")

@app.post("/api/cases/{case_id}/focus", response_model=Case)
def api_add_focus(case_id: str, entry: FocusEntry):
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            c.focus_log.append(entry)
            model.cases[i] = recompute(c)
            save(model)
            return model.cases[i]
    raise HTTPException(404, "Not found")

@app.post("/api/cases/{case_id}/deadlines", response_model=Case)
def api_set_deadlines(case_id: str, deadlines: List[Deadline]):
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            c.deadlines = deadlines
            model.cases[i] = recompute(c)
            save(model)
            return model.cases[i]
    raise HTTPException(404, "Not found")

@app.post("/api/cases/{case_id}/attention/{state}", response_model=Case)
def api_set_attention(case_id: str, state: Literal["needs_attention","waiting",""]):
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            c.attention = state
            model.cases[i] = recompute(c)
            save(model)
            return model.cases[i]
    raise HTTPException(404, "Not found")


@app.post("/api/cases/import")
async def api_import_cases(payload: ImportPayload):
    try:
        summary = import_cases_from_csv(payload.csv)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    return summary

# Toggle Top Priority
@app.post("/api/cases/{case_id}/priority/{state}", response_model=Case)
def api_set_priority(case_id: str, state: Literal["on","off","toggle"]):
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            if state == "toggle":
                c.top_priority = not getattr(c, "top_priority", False)
            else:
                c.top_priority = (state == "on")
            model.cases[i] = recompute(c)
            save(model)
            return model.cases[i]
    raise HTTPException(404, "Not found")

# Archive/Unarchive
@app.post("/api/cases/{case_id}/archive/{state}", response_model=Case)
def api_set_archive(case_id: str, state: Literal["on","off","toggle"]):
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            if state == "toggle":
                c.archived = not getattr(c, "archived", False)
            else:
                c.archived = (state == "on")
            model.cases[i] = recompute(c)
            save(model)
            return model.cases[i]
    raise HTTPException(404, "Not found")

# ----- Colleague Task endpoints -----
@app.get("/api/cases/{case_id}/details")
def get_case_details(case_id: str):
    """Get full case details including focus history and colleague tasks"""
    model = load()
    for c in model.cases:
        if c.id == case_id:
            case_dict = json.loads(c.model_dump_json())
            return JSONResponse(case_dict)
    raise HTTPException(404, "Case not found")

class ColleagueTaskRequest(BaseModel):
    task: str
    author: str  # WB, NC, TG, CS, SJ

@app.post("/api/cases/{case_id}/colleague-tasks")
def add_colleague_task(case_id: str, request: ColleagueTaskRequest):
    """Add a new colleague task to a case"""
    # Validate author initials
    allowed_authors = {"WB", "NC", "TG", "CS", "SJ"}
    if request.author not in allowed_authors:
        raise HTTPException(400, f"Invalid author. Must be one of: {', '.join(allowed_authors)}")
    
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            # Create new colleague task
            new_task = ColleagueTask(
                at=datetime.utcnow(),
                author=request.author,
                task=request.task.strip(),
                reviewed=False
            )
            
            # Add to case
            if not hasattr(c, 'colleague_tasks') or c.colleague_tasks is None:
                c.colleague_tasks = []
            c.colleague_tasks.append(new_task)
            
            model.cases[i] = recompute(c)
            save(model)
            
            return JSONResponse({
                "success": True,
                "task": json.loads(new_task.model_dump_json())
            })
    
    raise HTTPException(404, "Case not found")

@app.post("/api/cases/{case_id}/colleague-tasks/{task_id}/review")
def review_colleague_task(case_id: str, task_id: str):
    """Mark a colleague task as reviewed"""
    model = load()
    for i, c in enumerate(model.cases):
        if c.id == case_id:
            if hasattr(c, 'colleague_tasks') and c.colleague_tasks:
                for j, task in enumerate(c.colleague_tasks):
                    if task.id == task_id:
                        task.reviewed = True
                        task.reviewed_at = datetime.utcnow()
                        model.cases[i] = recompute(c)
                        save(model)
                        return JSONResponse({"success": True})
            raise HTTPException(404, "Task not found")
    raise HTTPException(404, "Case not found")

# ----- TV endpoint (read-only) -----
@app.get("/tv/cases")
def tv_cases():
    model = load()
    # Exclude archived from TV feed
    cases = [recompute(c) for c in model.cases if not getattr(c, "archived", False)]
    def urgency_key(c: Case):
        days = 9999
        if c.next_due:
            days = (c.next_due - date.today()).days
        att = 0 if c.attention == "needs_attention" else 1
        # Top priority bumps earlier without disrupting core grouping too much
        pri = 0 if getattr(c, "top_priority", False) else 1
        return (pri, att, days, c.client_name.lower())
    cases.sort(key=urgency_key)
    
    # Add colleague task notification flag to each case
    cases_with_flags = []
    for c in cases:
        case_dict = json.loads(c.model_dump_json())
        # Check for unreviewed colleague tasks
        unreviewed_tasks = 0
        if hasattr(c, 'colleague_tasks') and c.colleague_tasks:
            unreviewed_tasks = sum(1 for task in c.colleague_tasks if not task.reviewed)
        case_dict['has_unreviewed_colleague_tasks'] = unreviewed_tasks > 0
        case_dict['unreviewed_colleague_task_count'] = unreviewed_tasks
        cases_with_flags.append(case_dict)
    
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "cases": cases_with_flags
    }


@app.get("/tv/cfb")
def tv_cfb():
    return JSONResponse(get_cached_payload())

# ----- Reports -----
@app.get("/api/reports/clients.pdf")
def api_report_clients_pdf(include_archived: bool = False):
    model = load()
    cases = [recompute(c) for c in model.cases if include_archived or not getattr(c, "archived", False)]

    if _PDF_AVAILABLE:
        # Build PDF via reportlab
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=36, rightMargin=36, topMargin=48, bottomMargin=36)
        styles = getSampleStyleSheet()

        title = Paragraph("Client Case Summary", styles["Title"])  # large title
        stamp = datetime.now().strftime("%B %d, %Y %I:%M %p")
        subtitle = Paragraph(f"Printed {stamp}", styles["Normal"])  # print date line

        # Helper to wrap text inside table cells
        def P(txt: str):
            return Paragraph((txt or "").replace("\n","<br/>"), styles["BodyText"]) if txt else Paragraph("", styles["BodyText"]) 

        # Header row
        data = [[
            Paragraph("<b>Client</b>", styles["Normal"]),
            Paragraph("<b>Case</b>", styles["Normal"]),
            Paragraph("<b>Case #</b>", styles["Normal"]),
            Paragraph("<b>Type</b>", styles["Normal"]),
            Paragraph("<b>County</b>", styles["Normal"]),
            Paragraph("<b>Current Focus</b>", styles["Normal"]),
        ]]
        for c in sorted(cases, key=lambda x: (x.client_name or "").lower()):
            data.append([
                P(c.client_name or "—"),
                P(c.case_name or "—"),
                P(c.case_number or ""),
                P(c.case_type or "—"),
                P(c.county or "—"),
                P(c.current_focus or ""),
            ])

        col_widths = [140, 160, 70, 110, 80, 220]
        table = Table(data, colWidths=col_widths, repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#0F1520")),
            ("TEXTCOLOR", (0,0), (-1,0), colors.HexColor("#F2EBE3")),
            ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE", (0,0), (-1,0), 10),
            ("BOTTOMPADDING", (0,0), (-1,0), 6),
            ("TOPPADDING", (0,0), (-1,0), 6),

            ("FONTNAME", (0,1), (-1,-1), "Helvetica"),
            ("FONTSIZE", (0,1), (-1,-1), 9),
            ("TEXTCOLOR", (0,1), (-1,-1), colors.black),

            ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.whitesmoke, colors.lightgrey]),
            ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#CCCCCC")),
            ("VALIGN", (0,0), (-1,-1), "TOP"),
        ]))

        story = [title, subtitle, Spacer(1, 10), table]
        doc.build(story)
        buf.seek(0)
        filename = f"client_case_summary_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        return Response(content=buf.getvalue(), media_type="application/pdf", headers={
            "Content-Disposition": f"attachment; filename={filename}"
        })

    if _FPDF_AVAILABLE:
        # Fallback: build PDF via fpdf2 (pure Python)
        pdf = FPDF(orientation='P', unit='pt', format='Letter')
        pdf.set_margins(36, 48, 36)
        pdf.add_page()
        # Title
        pdf.set_font('Helvetica', 'B', 18)
        pdf.cell(0, 22, 'Client Case Summary', ln=1)
        pdf.set_font('Helvetica', '', 11)
        stamp = datetime.now().strftime('%B %d, %Y %I:%M %p')
        pdf.cell(0, 16, f'Printed {stamp}', ln=1)
        pdf.ln(6)
        # Table header
        headers = ['Client', 'Case', 'Case #', 'Type', 'County', 'Current Focus']
        col_widths = [140, 160, 70, 110, 80, 220]
        pdf.set_font('Helvetica', 'B', 10)
        for w, h in zip(col_widths, headers):
            pdf.cell(w, 16, h, border=1)
        pdf.ln(16)
        # Rows
        pdf.set_font('Helvetica', '', 9)
        for c in sorted(cases, key=lambda x: (x.client_name or '').lower()):
            row = [
                c.client_name or '—',
                c.case_name or '—',
                c.case_number or '',
                c.case_type or '—',
                c.county or '—',
                c.current_focus or '',
            ]
            # naive wrapping: split very long focus into chunks
            # (fpdf2 supports multi_cell; use that for focus)
            # Print first five columns as single-line cells
            for i in range(5):
                pdf.cell(col_widths[i], 14, row[i][:60], border=1)
            # Focus as multi_cell occupying last column
            x_before = pdf.get_x()
            y_before = pdf.get_y()
            pdf.multi_cell(col_widths[5], 14, row[5], border=1)
            y_after = pdf.get_y()
            # Move to next line aligning with the tallest cell
            pdf.set_xy(36, y_after)
        out = pdf.output(dest='S').encode('latin-1')
        filename = f"client_case_summary_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        return Response(content=out, media_type="application/pdf", headers={
            "Content-Disposition": f"attachment; filename={filename}"
        })

    raise HTTPException(500, "PDF engine not installed. Please restart with reportlab or install fpdf2.")

# Optional static fallback route for diagnostics
@app.get("/static/data/cfb.json")
def cfb_static():
    path = os.path.join("static", "data", "cfb.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Fallback not configured")
    return FileResponse(path, media_type="application/json")

# ----- Pages -----
@app.get("/manage")
def manage_page(): return FileResponse("static/manage.html")

@app.get("/tv")
def tv_page(): return FileResponse("static/tv.html")

@app.get("/board")
def board_page(): return FileResponse("static/board.html")

