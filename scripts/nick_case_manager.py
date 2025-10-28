# Nick Case Manager — prompt_toolkit TUI (Nick / Halloween / Spy, local JSON)
#
# Works directly on the same cases.json the FastAPI/TV app uses.
# Safe writes (atomic replace) and gentle read retries to reduce conflicts.
#
# Default data file: <repo>/data/cases.json
# Override with env CASES_JSON (absolute or relative path)
#
# Keys:
#   ↑/↓ move   Enter open   / search   R reload JSON   T toggle theme   Q quit
#   In Case view: F set Focus   A cycle Attention   D show Deadlines   C copy ID   B back

from __future__ import annotations

import os
import sys
import json
import time
import errno
import subprocess
import datetime as dt
from pathlib import Path
from typing import List, Dict, Any, Optional

from prompt_toolkit import Application
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import HSplit, Layout
from prompt_toolkit.widgets import Frame, Label, TextArea
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.filters import Condition

# ---------- Config ----------
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_JSON = (ROOT / "data" / "cases.json").resolve()
CASES_JSON = Path(os.getenv("CASES_JSON", str(DEFAULT_JSON))).resolve()
AUTHOR = os.getenv("CB_AUTHOR") or os.getenv("USERNAME") or os.getenv("USER") or "TUI"

THEMES = {
    "nick":      {"accent": "ansiyellow",     "edge": "ansimagenta", "primary": "ansigreen"},
    "halloween": {"accent": "ansidarkyellow", "edge": "ansimagenta", "primary": "ansigreen"},
    "spy":       {"accent": "ansiwhite",      "edge": "ansigray",    "primary": "ansiwhite"},
}
THEME_ORDER = ["nick", "halloween", "spy"]
ATT_STATES = ["needs_attention", "waiting", ""]  # cycle order


# ---------- File locking & IO helpers ----------
class FileLock:
    """Simple lock file next to cases.json to avoid our own concurrent writes.
    Note: The FastAPI server does not honor this lock; this mainly prevents
    two TUI instances from colliding.
    """

    def __init__(self, target: Path, timeout: float = 5.0, poll: float = 0.15):
        self.lock_path = target.with_suffix(target.suffix + ".lock")
        self.timeout = timeout
        self.poll = poll
        self._fd: Optional[int] = None

    def __enter__(self):
        start = time.time()
        while True:
            try:
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                self._fd = fd
                # write pid/timestamp (best-effort)
                try:
                    os.write(fd, f"pid={os.getpid()} time={time.time()}\n".encode("utf-8"))
                except Exception:
                    pass
                return self
            except OSError as e:
                if e.errno == errno.EEXIST and (time.time() - start) < self.timeout:
                    time.sleep(self.poll)
                    continue
                raise

    def __exit__(self, exc_type, exc, tb):
        try:
            if self._fd is not None:
                os.close(self._fd)
        finally:
            try:
                if self.lock_path.exists():
                    self.lock_path.unlink()
            except Exception:
                pass


def _safe_read_json(path: Path, retries: int = 3, delay: float = 0.1) -> Dict[str, Any]:
    last_err: Optional[Exception] = None
    for _ in range(retries):
        try:
            with path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            last_err = e
            time.sleep(delay)
    raise last_err  # type: ignore[misc]


def load_cases(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"_raw": {"schema_version": 1, "cases": []}, "cases": []}
    data = _safe_read_json(path)
    return {"_raw": data, "cases": data.get("cases", [])}


def save_cases(path: Path, blob: Dict[str, Any]) -> None:
    # Atomic write with optional lock to reduce collisions with another TUI.
    raw = dict(blob.get("_raw", {}))
    raw["saved_at"] = dt.datetime.utcnow().isoformat()
    raw["cases"] = blob.get("cases", [])

    tmp = path.with_suffix(path.suffix + ".tmp")
    with FileLock(path):
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(raw, f, indent=2, ensure_ascii=False)
        # Atomic replace where supported
        tmp.replace(path)


# ---------- helpers ----------
def fuzzy(hay: str, needle: str) -> bool:
    needle = (needle or "").lower()
    if not needle:
        return True
    hay = (hay or "").lower()
    i = 0
    for ch in needle:
        p = hay.find(ch, i)
        if p < 0:
            return False
        i = p + 1
    return True


def short_date(d: str | None) -> str:
    if not d:
        return "--"
    try:
        return dt.date.fromisoformat(d).strftime("%b %d")
    except Exception:
        return d


def due_color(d: str | None) -> str:
    if not d:
        return "ansigray"
    try:
        dd = dt.date.fromisoformat(d)
    except Exception:
        return "ansigray"
    today = dt.date.today()
    if dd < today:
        return "ansiyellow"
    if dd <= today + dt.timedelta(days=3):
        return "ansigreen"
    return "ansigray"


def copy_to_clipboard(text: str) -> None:
    try:
        if sys.platform.startswith("win"):
            p = subprocess.Popen(["clip"], stdin=subprocess.PIPE, close_fds=True)
            p.communicate(input=text.encode("utf-8"))
    except Exception:
        pass


def now_utc_isoz() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


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
        self.is_typing = False  # True when search/focus input is active

        # Widgets
        self.title = Label(text="")
        self.search = TextArea(multiline=False, prompt="/ ", accept_handler=self._on_search_accept)
        self.table = Label(text="")
        self.detail = Label(text="")
        self.history = TextArea(text="", read_only=True, scrollbar=True, wrap_lines=True)
        self.status = Label(text="")

        self._set_title()
        self._set_status("↑/↓ move   Enter open   / search   R reload   T theme   Q quit")

        root = HSplit([
            Frame(self.title),
            Frame(self.search),
            Frame(self.table, title="Cases"),
            Frame(self.detail, title="Detail"),
            Frame(self.history, title="Focus History"),
            Frame(self.status),
        ])

        kb = KeyBindings()

        # Only handle keys in command-mode (not when typing into search/focus)
        in_command_mode = Condition(lambda: not (self.is_typing or self.app.layout.has_focus(self.search)))

        @kb.add("up", filter=in_command_mode)
        def _up(e):
            self.move(-1)

        @kb.add("down", filter=in_command_mode)
        def _down(e):
            self.move(1)

        @kb.add("enter", filter=in_command_mode)
        def _open(e):
            self.open_case()

        @kb.add("/", filter=in_command_mode)
        def _focus_search(e):
            self.is_typing = True
            self.status.text = "Type to filter, Enter to apply."
            e.app.layout.focus(self.search)

        @kb.add("r", filter=in_command_mode)
        def _reload(e):
            self.reload()

        @kb.add("t", filter=in_command_mode)
        def _theme(e):
            self.toggle_theme()

        @kb.add("q", filter=in_command_mode)
        def _quit(e):
            e.app.exit()

        # Case screen keys (command-mode only)
        @kb.add("f", filter=in_command_mode)
        def _focus(e):
            if self.in_case:
                self.set_focus()

        @kb.add("a", filter=in_command_mode)
        def _attn(e):
            if self.in_case:
                self.cycle_attention()

        @kb.add("d", filter=in_command_mode)
        def _deadlines(e):
            if self.in_case:
                self.show_deadlines()

        @kb.add("c", filter=in_command_mode)
        def _copy(e):
            if self.in_case:
                self.copy_case_id()

        @kb.add("b", filter=in_command_mode)
        def _back(e):
            if self.in_case:
                self.exit_case()

        self.app = Application(layout=Layout(root), key_bindings=kb, full_screen=True)

    # ----- state -----
    def reload(self):
        try:
            self.db = load_cases(CASES_JSON)
            self._render_table()
            self._render_detail()
            self._render_history()
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
        a, e, p = self.theme["accent"], self.theme["edge"], self.theme["primary"]
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
        res: List[Dict[str, Any]] = []
        for c in self.db.get("cases", []):
            hay = f"{c.get('client_name','')} {c.get('case_name','')} {c.get('status','')} {c.get('id','')}"
            if fuzzy(hay, q):
                res.append(c)
        if self.cursor >= len(res):
            self.cursor = max(0, len(res) - 1)
        return res

    # ----- table/detail/history -----
    def _render_table(self):
        e, p = self.theme["edge"], self.theme["primary"]
        lines = [f"<{e}> IDX  !  CLIENT                   | CASE NAME                     | STATUS       | DUE</{e}>"]
        filtered = self._filtered()
        for idx, c in enumerate(filtered[:600]):
            att = (c.get("attention") or "").strip()
            glyph = "!" if att == "needs_attention" else ("~" if att == "waiting" else " ")
            client = (c.get("client_name", "--")[:23]).ljust(23)
            matter = (c.get("case_name", "--")[:27]).ljust(27)
            status = (c.get("status", "--")[:12]).ljust(12)
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

    def _render_history(self):
        filtered = self._filtered()
        if not filtered:
            self.history.text = ""
            return
        c = filtered[self.cursor]
        entries = c.get("focus_log") or []
        if not isinstance(entries, list):
            entries = []
        # Oldest first, newest last
        lines: List[str] = []
        for it in entries:
            at = (it.get("at") or "").replace("Z", "").replace("T", " ")
            author = it.get("author") or ""
            text = it.get("text") or ""
            lines.append(f"{at}  [{author}]  {text}")
        self.history.text = "\n".join(lines) if lines else "(No focus history)"

    # ----- actions -----
    def move(self, delta: int):
        n = len(self._filtered())
        if n == 0:
            return
        self.cursor = max(0, min(n - 1, self.cursor + delta))
        self._render_table(); self._render_detail(); self._render_history()

    def open_case(self):
        self.in_case = True
        self.case_idx = self.cursor
        self._set_status("F set Focus   A cycle Attention   D deadlines   C copy ID   B back")
        self._render_history()

    def exit_case(self):
        self.in_case = False
        self._set_status("↑/↓ move   Enter open   / search   R reload   T theme   Q quit")

    def set_focus(self):
        filtered = self._filtered()
        if not filtered:
            return
        c = filtered[self.case_idx]
        # Use search box to capture focus text
        self.search.text = ""
        self.status.text = "Type focus text and press Enter (blank = cancel)."
        self.is_typing = True
        self.app.layout.focus(self.search)

        orig_handler = self.search.accept_handler

        def after_enter(_buf):
            text = self.search.text.strip()
            self.search.accept_handler = orig_handler
            self.app.layout.focus(self.table)
            self.is_typing = False
            if text:
                # update current_focus and append to focus_log
                c["current_focus"] = text
                log = c.get("focus_log")
                if not isinstance(log, list):
                    log = []
                log.append({"at": now_utc_isoz(), "author": AUTHOR, "text": text})
                c["focus_log"] = log
                self.save()
                self._render_detail(); self._render_history()
                self._set_status("Focus updated and saved.")
            else:
                self._set_status("Focus unchanged.")

        self.search.accept_handler = after_enter

    def cycle_attention(self):
        filtered = self._filtered()
        if not filtered:
            return
        c = filtered[self.case_idx]
        curr = (c.get("attention") or "").strip()
        try:
            i = ATT_STATES.index(curr)
        except ValueError:
            i = -1
        next_state = ATT_STATES[(i + 1) % len(ATT_STATES)]
        c["attention"] = next_state
        self.save()
        self._render_table(); self._render_detail(); self._render_history()
        self._set_status(f"Attention → {next_state or 'none'}")

    def show_deadlines(self):
        filtered = self._filtered()
        if not filtered:
            return
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
        if not filtered:
            return
        cid = str(filtered[self.case_idx].get("id", ""))
        copy_to_clipboard(cid)
        self._set_status("Copied Case ID to clipboard.")

    def _on_search_accept(self, _buf):
        if self.in_case:
            # If we're in a temporary focus-entry mode, another handler will take over.
            pass
        self.filter_text = self.search.text.strip()
        self._render_table(); self._render_detail(); self._render_history()
        self._set_status(f"Filter: {self.filter_text}")
        self.is_typing = False
        self.app.layout.focus(self.table)

    # ----- theme -----
    def toggle_theme(self):
        self.theme_idx = (self.theme_idx + 1) % len(THEME_ORDER)
        self.theme = THEMES[THEME_ORDER[self.theme_idx]]
        self._set_title(); self._render_table(); self._render_detail(); self._render_history()
        self._set_status(f"Theme: {THEME_ORDER[self.theme_idx]}")

    # ----- run -----
    def run(self):
        # Initial load with path check
        if not CASES_JSON.exists():
            self._set_status(f"File not found: {CASES_JSON}")
        self.reload()
        self.app.run()


if __name__ == "__main__":
    # Dependency hint
    try:
        import prompt_toolkit  # noqa: F401
    except Exception:
        print("Missing dependency: prompt_toolkit. Install with: pip install prompt_toolkit", file=sys.stderr)
        sys.exit(1)
    TUI().run()

