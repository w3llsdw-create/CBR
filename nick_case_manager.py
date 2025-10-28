"""
Nick Case Manager — prompt_toolkit TUI (Nick / Halloween / Spy, local JSON)

Data file:
  Default: C:\\Users\\David Wells\\CBR\\data\\cases.json
  Override with env CASES_JSON

Keys:
  ↑/↓ move   Enter open   / search   R reload JSON   T toggle theme   Q quit
  In Case view: F set Focus   A cycle Attention   D show Deadlines   C copy ID   B back
"""
from __future__ import annotations
import os, sys, json, time, datetime as dt, subprocess
from pathlib import Path
from typing import List, Dict, Any

from prompt_toolkit import Application
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import HSplit, Layout
from prompt_toolkit.widgets import Frame, TextArea, Label
from prompt_toolkit.formatted_text import HTML

# ---------- Config ----------
DEFAULT_JSON = r"C:\Users\David Wells\CBR\data\cases.json"
CASES_JSON = Path(os.getenv("CASES_JSON", DEFAULT_JSON))

THEMES = {
    "nick":      {"accent": "ansiyellow",     "edge": "ansimagenta", "primary": "ansigreen"},
    "halloween": {"accent": "ansidarkyellow", "edge": "ansimagenta", "primary": "ansigreen"},
    "spy":       {"accent": "ansiwhite",      "edge": "ansigray",    "primary": "ansiwhite"},
}
THEME_ORDER = ["nick", "halloween", "spy"]
ATT_STATES = ["needs_attention", "waiting", ""]  # cycle order

# ---------- IO ----------
def load_cases(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"_raw": {"schema_version": 1, "cases": []}, "cases": []}
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return {"_raw": data, "cases": data.get("cases", [])}

def save_cases(path: Path, blob: Dict[str, Any]) -> None:
    # Atomic write: .tmp then replace
    raw = dict(blob.get("_raw", {}))
    raw["saved_at"] = dt.datetime.now().isoformat()
    raw["cases"] = blob.get("cases", [])
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(raw, f, indent=2, ensure_ascii=False)
    tmp.replace(path)

# ---------- helpers ----------
def fuzzy(hay: str, needle: str) -> bool:
    needle = (needle or "").lower()
    if not needle: return True
    hay = (hay or "").lower()
    i = 0
    for ch in needle:
        p = hay.find(ch, i)
        if p < 0: return False
        i = p + 1
    return True

def short_date(d: str | None) -> str:
    if not d: return "--"
    try:
        return dt.date.fromisoformat(d).strftime("%b %d")
    except Exception:
        return d

def due_color(d: str | None) -> str:
    if not d: return "ansigray"
    try:
        dd = dt.date.fromisoformat(d)
    except Exception:
        return "ansigray"
    today = dt.date.today()
    if dd < today: return "ansiyellow"
    if dd <= today + dt.timedelta(days=3): return "ansigreen"
    return "ansigray"

def copy_to_clipboard(text: str) -> None:
    try:
        if sys.platform.startswith("win"):
            p = subprocess.Popen(["clip"], stdin=subprocess.PIPE, close_fds=True)
            p.communicate(input=text.encode("utf-8"))
    except Exception:
        pass

# ---------- TUI ----------
class TUI:
    def __init__(self):
        self.theme_idx = 0
        self.theme = THEMES[THEME_ORDER[self.theme_idx]]
        self.db: Dict[str, Any] = {"_raw": {"schema_version": 1}, "cases": []}
        self.filter_text = ""
        self.cursor = 0
        self.in_case = False
        self.case_idx = 0

        # Widgets
        self.title  = Label(text="")
        self.search = TextArea(multiline=False, prompt="/ ", accept_handler=self._on_search_accept)
        self.table  = Label(text="")
        self.detail = Label(text="")
        self.status = Label(text="")

        self._set_title()
        self._set_status("↑/↓ move   Enter open   / search   R reload   T theme   Q quit")

        root = HSplit([
            Frame(self.title),
            Frame(self.search),
            Frame(self.table, title="Cases"),
            Frame(self.detail, title="Detail"),
            Frame(self.status),
        ])

        kb = KeyBindings()
        @kb.add("up")     ;    # ↑
        def _up(e): self.move(-1)
        @kb.add("down")   ;    # ↓
        def _down(e): self.move(1)
        @kb.add("enter")
        def _open(e): self.open_case()
        @kb.add("/")
        def _focus_search(e): e.app.layout.focus(self.search)
        @kb.add("r")
        def _reload(e): self.reload()
        @kb.add("t")
        def _theme(e): self.toggle_theme()
        @kb.add("q")
        def _quit(e): e.app.exit()

        # Case screen keys
        @kb.add("f")
        def _focus(e): 
            if self.in_case: self.set_focus()
        @kb.add("a")
        def _attn(e):
            if self.in_case: self.cycle_attention()
        @kb.add("d")
        def _deadlines(e):
            if self.in_case: self.show_deadlines()
        @kb.add("c")
        def _copy(e):
            if self.in_case: self.copy_case_id()
        @kb.add("b")
        def _back(e):
            if self.in_case: self.exit_case()

        self.app = Application(layout=Layout(root), key_bindings=kb, full_screen=True)

    # ----- state -----
    def reload(self):
        try:
            self.db = load_cases(CASES_JSON)
            self._render_table(); self._render_detail()
            self._set_status(f"Loaded {len(self.db['cases'])} cases from {CASES_JSON}")
        except Exception as e:
            self._set_status(f"Error loading: {e}")

    def save(self):
        try:
            save_cases(CASES_JSON, self.db)
            self._set_status("Saved.")
        except Exception as e:
            self._set_status(f"Save error: {e}")

    # ----- UI helpers -----
    def _set_title(self):
        a,e,p = self.theme["accent"], self.theme["edge"], self.theme["primary"]
        banner = "🎃 HALLOWEEN MODE 🎃  " if THEME_ORDER[self.theme_idx] == "halloween" else ""
        self.title.text = HTML(
            f"<{p}><b>Nick Case Manager</b></{p}>  {banner}"
            f"<{a}>Nick / Halloween / Spy</{a}>   "
            f"<{e}>File:</{e}> {CASES_JSON}"
        )

    def _set_status(self, msg: str):
        self.status.text = msg

    def _filtered(self) -> List[Dict[str, Any]]:
        q = self.filter_text
        res = []
        for c in self.db["cases"]:
            hay = f"{c.get('client_name','')} {c.get('case_name','')} {c.get('status','')} {c.get('id','')}"
            if fuzzy(hay, q):
                res.append(c)
        if self.cursor >= len(res):
            self.cursor = max(0, len(res) - 1)
        return res

    # ----- table/detail -----
    def _render_table(self):
        e,p = self.theme["edge"], self.theme["primary"]
        lines = [f"<{e}> IDX  !  CLIENT                   | CASE NAME                     | STATUS       | DUE</{e}>"]
        filtered = self._filtered()
        for idx, c in enumerate(filtered[:600]):
            att = (c.get("attention") or "").strip()
            glyph = "!" if att == "needs_attention" else ("~" if att == "waiting" else " ")
            client = (c.get("client_name","--")[:23]).ljust(23)
            matter = (c.get("case_name","--")[:27]).ljust(27)
            status = (c.get("status","--")[:12]).ljust(12)
            due_raw = c.get("next_due")
            due_short = short_date(due_raw)
            color = due_color(due_raw)
            line = f" {idx:3d}  {glyph}  {client} | {matter} | {status} | "
            if idx == self.cursor:
                lines.append(f"<reverse><{p}>{line}</{p}><{color}>{due_short}</{color}></reverse>")
            else:
                lines.append(f"{line}<{color}>{due_short}</{color}>")
        self.table.text = HTML("\n".join(lines) if lines else "No cases")

    def _render_detail(self):
        filtered = self._filtered()
        if not filtered:
            self.detail.text = "No cases"
            return
        c = filtered[self.cursor]
        e = self.theme["edge"]; a = self.theme["accent"]
        bits = [
            f"<{e}>Case ID:</{e}> {c.get('id','--')}",
            f"<{e}>Client:</{e}> {c.get('client_name','--')}",
            f"<{e}>Matter:</{e}> {c.get('case_name','--')}",
            f"<{e}>Status:</{e}> {c.get('status','--')}   <{e}>Stage:</{e}> {c.get('stage','--')}",
            f"<{e}>#:</{e}> {c.get('case_number','--')}   <{e}>County:</{e}> {c.get('county','--')}   <{e}>Judge:</{e}> {c.get('judge','--')}",
        ]
        focus = (c.get("current_focus") or "").strip()
        if focus:
            bits.append(f"<{a}>Focus:</{a}> {focus}")
        self.detail.text = HTML("\n".join(bits))

    # ----- actions -----
    def move(self, delta: int):
        n = len(self._filtered())
        if n == 0: return
        self.cursor = max(0, min(n - 1, self.cursor + delta))
        self._render_table(); self._render_detail()

    def open_case(self):
        self.in_case = True
        self.case_idx = self.cursor
        self._set_status("F set Focus   A cycle Attention   D deadlines   C copy ID   B back")

    def exit_case(self):
        self.in_case = False
        self._set_status("↑/↓ move   Enter open   / search   R reload   T theme   Q quit")

    def set_focus(self):
        filtered = self._filtered()
        if not filtered: return
        c = filtered[self.case_idx]
        # Re-use search box to capture focus text
        self.search.text = ""
        self.status.text = "Type focus text and press Enter (blank = cancel)."
        self.app.layout.focus(self.search)

        orig = self.search.accept_handler
        def after_enter(_):
            text = self.search.text.strip()
            self.search.accept_handler = orig
            self.app.layout.focus(self.table)
            if text:
                c["current_focus"] = text
                self.save()
                self._render_detail()
                self._set_status("Focus updated and saved.")
            else:
                self._set_status("Focus unchanged.")
        self.search.accept_handler = after_enter

    def cycle_attention(self):
        filtered = self._filtered()
        if not filtered: return
        c = filtered[self.case_idx]
        curr = (c.get("attention") or "").strip()
        try: i = ATT_STATES.index(curr)
        except ValueError: i = -1
        next_state = ATT_STATES[(i + 1) % len(ATT_STATES)]
        c["attention"] = next_state
        self.save()
        self._render_table(); self._render_detail()
        self._set_status(f"Attention → {next_state or 'none'}")

    def show_deadlines(self):
        filtered = self._filtered()
        if not filtered: return
        c = filtered[self.case_idx]
        e = self.theme["edge"]
        dls = c.get("deadlines") or []
        if not dls:
            self._set_status("No deadlines in JSON.")
            return
        lines = [f"<{e}>-- Deadlines --</{e}>"]
        for d in dls[:20]:
            flag = "[x]" if d.get("resolved") else "[ ]"
            lines.append(f"  {flag}  {d.get('due_date','--')}  {d.get('description','')}")
        self.status.text = HTML("\n".join(lines))

    def copy_case_id(self):
        filtered = self._filtered()
        if not filtered: return
        cid = str(filtered[self.case_idx].get("id",""))
        copy_to_clipboard(cid)
        self._set_status("Copied Case ID to clipboard.")

    def _on_search_accept(self, _buf):
        if self.in_case:
            # If we're in a temporary focus-entry mode, another handler will take over.
            return
        self.filter_text = self.search.text.strip()
        self._render_table(); self._render_detail()
        self._set_status(f"Filter: {self.filter_text}")
        self.app.layout.focus(self.table)

    # ----- theme -----
    def toggle_theme(self):
        self.theme_idx = (self.theme_idx + 1) % len(THEME_ORDER)
        self.theme = THEMES[THEME_ORDER[self.theme_idx]]
        self._set_title(); self._render_table(); self._render_detail()
        self._set_status(f"Theme: {THEME_ORDER[self.theme_idx]}")

    # ----- run -----
    def run(self):
        self.reload()
        self.app.run()

if __name__ == "__main__":
    TUI().run()
