# backend/cfb.py
"""
Lightweight CFB scores/odds cache for the TV board.

Exports:
    get_cached_payload() -> dict
    refresh_cache(force: bool = False) -> dict

Reads .env for:
    CFBD_API_KEY, ODDS_API_KEY
"""

from __future__ import annotations

import json
import os
import time
import datetime as dt
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

# ---------- setup ----------
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CACHE_FILE = DATA_DIR / "sports_cache.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)

load_dotenv(ROOT / ".env")

CFBD_API_KEY = os.getenv("CFBD_API_KEY", "").strip()
ODDS_API_KEY = os.getenv("ODDS_API_KEY", "").strip()

HTTP_TIMEOUT = 12
CFBD_BASE = "https://api.collegefootballdata.com"
ODDS_BASE = "https://api.the-odds-api.com/v4"


# ---------- helpers ----------
def _http_get(url: str, headers: Optional[Dict[str, str]] = None, params: Optional[Dict[str, Any]] = None) -> Any:
    r = requests.get(url, headers=headers or {}, params=params or {}, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    try:
        return r.json()
    except Exception:
        return r.text


def _read_cache() -> Dict[str, Any]:
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _write_cache(payload: Dict[str, Any]) -> None:
    tmp = CACHE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CACHE_FILE)


def _today_stamp() -> str:
    return dt.date.today().strftime("%Y%m%d")


def _cfb_year_today() -> int:
    # Simplified: by calendar year is fine for weekly schedules
    return dt.date.today().year


def _current_week_guess() -> int:
    # Basic guess: first week ~ late Aug. Adjust if needed.
    today = dt.date.today()
    season_start = dt.date(today.year, 8, 20)
    if today < season_start:
        season_start = dt.date(today.year - 1, 8, 20)
    delta_weeks = (today - season_start).days // 7
    return max(1, min(15, 1 + delta_weeks))


# ---------- external fetchers ----------
def cfbd_games(year: int, week: int) -> List[Dict[str, Any]]:
    if not CFBD_API_KEY:
        return []
    url = f"{CFBD_BASE}/games"
    headers = {"Authorization": f"Bearer {CFBD_API_KEY}"}
    params = {"year": year, "week": week, "seasonType": "regular"}
    data = _http_get(url, headers=headers, params=params)
    return data if isinstance(data, list) else []


def odds_upcoming(markets: str = "h2h,spreads,totals", regions: str = "us") -> List[Dict[str, Any]]:
    if not ODDS_API_KEY:
        return []
    url = f"{ODDS_BASE}/sports/americanfootball_ncaaf/odds"
    params = {
        "apiKey": ODDS_API_KEY,
        "regions": regions,
        "markets": markets,
        "oddsFormat": "american",
        "dateFormat": "iso",
    }
    data = _http_get(url, params=params)
    return data if isinstance(data, list) else []


def espn_day_scores(date_yyyymmdd: str) -> List[Dict[str, Any]]:
    """
    Optional live/final feed. Keep best-effort. If it fails, caller will continue.
    """
    try:
        url = f"https://site.web.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"
        params = {"dates": date_yyyymmdd}
        data = _http_get(url, params=params)
        events = data.get("events", []) if isinstance(data, dict) else []
        out = []
        for ev in events:
            comp = (ev.get("competitions") or [{}])[0]
            status = ((comp.get("status") or {}).get("type") or {}).get("shortDetail") or ""
            comps = comp.get("competitors") or []
            if len(comps) != 2:
                continue
            a = comps[0]
            b = comps[1]
            def _name(c): return ((c.get("team") or {}).get("location") or (c.get("team") or {}).get("displayName") or "").strip()
            def _abbr(c): return ((c.get("team") or {}).get("abbreviation") or "").strip()
            def _score(c):
                try:
                    return int(c.get("score") or 0)
                except Exception:
                    return 0
            row = {
                "home": _name(a) if a.get("homeAway") == "home" else _name(b),
                "away": _name(b) if a.get("homeAway") == "home" else _name(a),
                "home_abbr": _abbr(a) if a.get("homeAway") == "home" else _abbr(b),
                "away_abbr": _abbr(b) if a.get("homeAway") == "home" else _abbr(a),
                "home_score": _score(a) if a.get("homeAway") == "home" else _score(b),
                "away_score": _score(b) if a.get("homeAway") == "home" else _score(a),
                "status": status,
                "kickoff": comp.get("date"),
                "id": ev.get("id"),
            }
            out.append(row)
        return out
    except Exception:
        return []


# ---------- normalization ----------
def _normalize_espn_prev(espn_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for r in espn_rows:
        out.append(
            {
                "label": f"{r.get('away_abbr','')} @ {r.get('home_abbr','')}".strip(),
                "home": r.get("home"),
                "away": r.get("away"),
                "home_score": r.get("home_score"),
                "away_score": r.get("away_score"),
                "status": r.get("status", ""),
                "kickoff": r.get("kickoff"),
                "id": r.get("id"),
                "src": "espn",
            }
        )
    return out


def _normalize_next(cfbd_rows: List[Dict[str, Any]], odds_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Map odds by matchup key to attach lines if available
    odds_map: Dict[str, Dict[str, Any]] = {}
    for o in odds_rows:
        try:
            hk = (o.get("home_team") or "").strip().lower()
            ak = (o.get("away_team") or "").strip().lower()
            odds_map[f"{ak}@{hk}"] = o
        except Exception:
            continue

    out = []
    for g in cfbd_rows:
        home = (g.get("home_team") or "").strip()
        away = (g.get("away_team") or "").strip()
        k = f"{away.lower()}@{home.lower()}"
        line = None
        total = None
        try:
            o = odds_map.get(k)
            if o and isinstance(o.get("bookmakers"), list) and o["bookmakers"]:
                mkts = o["bookmakers"][0].get("markets") or []
                for m in mkts:
                    if m.get("key") == "spreads":
                        outcomes = m.get("outcomes") or []
                        for oo in outcomes:
                            if oo.get("name") == home:
                                line = oo.get("point")
                    if m.get("key") == "totals":
                        outcomes = m.get("outcomes") or []
                        for oo in outcomes:
                            if oo.get("name") in ("Over", "Under"):
                                total = oo.get("point")
        except Exception:
            pass

        out.append(
            {
                "label": f"{away} @ {home}",
                "home": home,
                "away": away,
                "kickoff": g.get("start_date"),
                "venue": g.get("venue"),
                "line": line,
                "total": total,
                "src": "cfbd+odds" if line or total else "cfbd",
            }
        )
    return out


# ---------- public API ----------
def refresh_cache(force: bool = False) -> Dict[str, Any]:
    """
    Rebuild cache. If any upstream fails, continue with what is available.
    """
    year = _cfb_year_today()
    this_week = _current_week_guess()

    # 1) Live/Finals via ESPN for today
    try:
        espn = espn_day_scores(_today_stamp())
        prev_rows = _normalize_espn_prev(espn)
    except Exception:
        prev_rows = []

    # 2) Upcoming via CFBD + Odds
    try:
        next_cfbd = cfbd_games(year, this_week)
    except Exception:
        next_cfbd = []

    try:
        odds = odds_upcoming()
    except Exception:
        odds = []

    next_rows = _normalize_next(next_cfbd, odds)

    payload = {
        "labels": {"prev": "Live/Finals", "next": f"Week {this_week} Kickoffs"},
        "prev": prev_rows,
        "next": next_rows,
        "_stamp": time.time(),
    }
    _write_cache(payload)
    return payload


def get_cached_payload() -> Dict[str, Any]:
    """
    Return last cache if fresh (< 900s). Otherwise refresh.
    """
    cache = _read_cache()
    now = time.time()
    if cache and isinstance(cache, dict) and float(cache.get("_stamp", 0)) > now - 900:
        return cache
    return refresh_cache(force=True)
