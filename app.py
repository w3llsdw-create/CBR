from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, date
import json, uuid, os, shutil

DATA_DIR = "data"
CASES_PATH = os.path.join(DATA_DIR, "cases.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
os.makedirs(DATA_DIR, exist_ok=True); os.makedirs(BACKUP_DIR, exist_ok=True)

# ---------- Models ----------
class FocusEntry(BaseModel):
    at: datetime
    author: str
    text: str

class Deadline(BaseModel):
    due_date: date
    description: str
    resolved: bool = False

Stage = Literal["Pre-filing","Filed","Discovery","Pretrial","Trial","Closed"]
Status = Literal["open","pre-filing","filed","closed"]

class ExternalRef(BaseModel):
    # reserved for Filevine; not used yet
    filevine_id: Optional[str] = None
    filevine_number: Optional[str] = None
    linked_at: Optional[datetime] = None

class Case(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))  # primary key
    client_name: str
    case_name: str                                   # e.g., "Smith v. Jones"
    case_type: str                                   # free text
    stage: Stage = "Pre-filing"
    status: Status = "pre-filing"
    attention: Literal["needs_attention","waiting",""] = ""
    paralegal: str = ""
    current_focus: str = ""                          # one-liner, last focus
    focus_log: List[FocusEntry] = Field(default_factory=list)
    deadlines: List[Deadline] = Field(default_factory=list)

    # Court fields (optional in pre-filing)
    case_number: Optional[str] = None
    county: Optional[str] = None
    division: Optional[str] = None
    judge: Optional[str] = None
    opposing_counsel: Optional[str] = None
    opposing_firm: Optional[str] = None

    # Derivatives
    next_due: Optional[date] = None
    external: ExternalRef = Field(default_factory=ExternalRef)

class CaseFile(BaseModel):
    schema_version: int = 1
    saved_at: datetime
    cases: List[Case] = Field(default_factory=list)

# ---------- Storage ----------
def load() -> CaseFile:
    if not os.path.exists(CASES_PATH):
        return CaseFile(saved_at=datetime.utcnow(), cases=[])
    with open(CASES_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return CaseFile(**raw)

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
    # next_due from unresolved deadlines
    future = [d.due_date for d in case.deadlines if not d.resolved]
    case.next_due = min(future) if future else None
    # current_focus from latest focus entry
    if case.focus_log:
        case.current_focus = case.focus_log[-1].text
    return case

# ---------- App ----------
app = FastAPI(title="Caseboard")
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

@app.get("/")
def root():
    return FileResponse("static/index.html")

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

# ----- TV endpoint (read-only) -----
@app.get("/tv/cases")
def tv_cases():
    model = load()
    cases = [recompute(c) for c in model.cases]
    def urgency_key(c: Case):
        days = 9999
        if c.next_due:
            days = (c.next_due - date.today()).days
        att = 0 if c.attention == "needs_attention" else 1
        return (att, days, c.client_name.lower())
    cases.sort(key=urgency_key)
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "cases": [json.loads(c.model_dump_json()) for c in cases]
    }

# ----- Pages -----
@app.get("/manage")
def manage_page(): return FileResponse("static/manage.html")

@app.get("/tv")
def tv_page(): return FileResponse("static/tv.html")
