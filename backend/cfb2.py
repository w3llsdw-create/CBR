import os
import json
import time
import datetime as dt
from typing import Any, Dict, List, Optional
import re

# httpx is optional; ticker will gracefully show no data without it
try:
    import httpx  # type: ignore
except Exception:  # pragma: no cover
    httpx = None  # type: ignore

CFBD_KEY = os.getenv("CFBD_API_KEY", "")  # not required when using ESPN-only flows
ODDS_KEY = os.getenv("ODDS_API_KEY", "")

# In-memory cache for the TV payload
CACHE: Dict[str, Any] = {
    "generated_at": None,
    "labels": {"prev": "Live/Finals", "next": "Kickoffs"},
    "prev": [],
    "next": [],
    "_stamp": 0.0,
}
CACHE_TTL = 120  # seconds

# Odds throttle (once per hour, 08:00–22:00 local)
_ODDS_IDX: Dict[str, Dict[str, Any]] = {}
_ODDS_LAST_FETCH: Optional[float] = None
_ODDS_WINDOW_START = 8   # 8 AM
_ODDS_WINDOW_END = 22    # 10 PM


def _fallback_enabled() -> bool:
    val = os.getenv("CFB_USE_FALLBACK", "").strip().lower()
    return val in {"1", "true", "yes", "on"}


def _iso(dtobj: dt.datetime) -> str:
    return dtobj.replace(microsecond=0).isoformat() + "Z"


def next_saturday(today: Optional[dt.date] = None) -> dt.date:
    d = today or dt.date.today()
    # Monday=0 ... Saturday=5
    offset = (5 - d.weekday()) % 7
    return d + dt.timedelta(days=offset)


def espn_day_scores(date_yyyymmdd: str) -> Dict[str, Any]:
    if httpx is None:
        return {}
    url = (
        "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"
    )
    # groups=80 corresponds to FBS
    params = {"dates": date_yyyymmdd, "groups": "80"}
    with httpx.Client(timeout=20) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        return r.json()


def _team_display(c: Dict[str, Any]) -> str:
    team = c.get("team", {})
    return (
        team.get("displayName")
        or team.get("location")
        or team.get("name")
        or ""
    )


def _normalize_espn_prev(scoreboard: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        events = scoreboard.get("events") or []
        for ev in events:
            comps = (ev.get("competitions") or [{}])[0]
            competitors = comps.get("competitors") or []
            if len(competitors) < 2:
                continue
            status = comps.get("status") or ev.get("status") or {}
            stype = ((status.get("type") or {}).get("name") or "").upper()
            completed = (status.get("type") or {}).get("completed") is True or stype in {"STATUS_FINAL", "FINAL"}
            inprog = stype in {"STATUS_IN_PROGRESS", "IN"}
            away = next((c for c in competitors if (c.get("homeAway") or "").lower()=="away"), competitors[0])
            home = next((c for c in competitors if (c.get("homeAway") or "").lower()=="home"), competitors[-1])

            def to_int(v):
                try:
                    return int(v)
                except Exception:
                    try:
                        return int(float(v))
                    except Exception:
                        return None

            a_score = to_int(away.get("score"))
            h_score = to_int(home.get("score"))
            if a_score is None or h_score is None:
                continue
            if completed or inprog:
                rows.append(
                    {
                        "away": _team_display(away) or "Away",
                        "home": _team_display(home) or "Home",
                        "away_score": a_score,
                        "home_score": h_score,
                        "status": "FINAL" if completed else "LIVE",
                    }
                )
    except Exception:
        return []
    return rows


def _normalize_espn_upcoming(scoreboard: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    try:
        events = scoreboard.get("events") or []
        now = dt.datetime.utcnow()
        for ev in events:
            comps = (ev.get("competitions") or [{}])[0]
            competitors = comps.get("competitors") or []
            if len(competitors) < 2:
                continue
            status = comps.get("status") or ev.get("status") or {}
            stype = ((status.get("type") or {}).get("name") or "").upper()
            if stype in {"STATUS_FINAL", "FINAL"}:
                continue
            # Start time and friendly label
            start_raw = comps.get("date") or ev.get("date")
            start_iso = None
            kick_label = None
            # ESPN status short detail (e.g., "Sat 2:30 PM")
            st_type = (status.get("type") or {})
            short_detail = st_type.get("shortDetail") or st_type.get("detail")
            if start_raw:
                try:
                    parsed = dt.datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
                    start_iso = (
                        parsed.astimezone(dt.timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z")
                    )
                    if parsed < now:
                        # Skip games already started/finished when building upcoming
                        continue
                except Exception:
                    # Keep raw as a label if parse fails
                    kick_label = short_detail or start_raw
            else:
                kick_label = short_detail
            away = next((c for c in competitors if (c.get("homeAway") or "").lower()=="away"), competitors[0])
            home = next((c for c in competitors if (c.get("homeAway") or "").lower()=="home"), competitors[-1])
            # network (use first broadcast name if present)
            network = None
            broadcasts = comps.get("broadcasts") or []
            if broadcasts:
                names = [b.get("names", [None])[0] for b in broadcasts if b.get("names")]
                network = names[0] if names else None
            row = {
                "away": _team_display(away) or "Away",
                "home": _team_display(home) or "Home",
                "start": start_iso,
                "network": network,
            }
            if kick_label:
                row["kick_label"] = kick_label
            rows.append(row)
    except Exception:
        return []
    rows.sort(key=lambda r: r.get("start") or "")
    return rows


def _norm_team(name: Optional[str]) -> str:
    s = (name or "").lower()
    s = re.sub(r"\b(university of|univ\.?|the)\b", "", s)
    s = s.replace("&", "and")
    s = s.replace("st.", "saint").replace(" st ", " saint ")
    s = s.replace("\u00a0", " ")
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def odds_next_week() -> Dict[str, Any]:
    if not ODDS_KEY or httpx is None:
        return {}
    url = "https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds"
    params = {
        "apiKey": ODDS_KEY,
        "regions": "us",
        "markets": "h2h,spreads,totals",
        "oddsFormat": "american",
        "dateFormat": "iso",
    }
    with httpx.Client(timeout=20) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        return {"games": r.json(), "remaining": r.headers.get("x-requests-remaining")}


def _should_fetch_odds(now: Optional[dt.datetime] = None) -> bool:
    global _ODDS_LAST_FETCH
    now = now or dt.datetime.now()
    if now.hour < _ODDS_WINDOW_START or now.hour > _ODDS_WINDOW_END:
        return False
    if _ODDS_LAST_FETCH is None:
        return True
    return (now.timestamp() - _ODDS_LAST_FETCH) >= 3600


def _index_odds(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    games = payload.get("games") or []
    for game in games:
        away = game.get("away_team", "")
        home = game.get("home_team", "")
        key = f"{_norm_team(away)}@@{_norm_team(home)}"
        fav = None
        spread = None
        moneyline = None
        total = None
        for bookmaker in game.get("bookmakers", []):
            for market in bookmaker.get("markets", []):
                outcomes = market.get("outcomes") or []
                if market.get("key") == "spreads":
                    for outcome in outcomes:
                        name = outcome.get("name")
                        if name in (home, "Home"):
                            spread = outcome.get("point")
                            if spread is not None and spread < 0:
                                fav = home
                        if name in (away, "Away") and spread is None:
                            spread = outcome.get("point")
                            if spread is not None and spread < 0:
                                fav = away
                elif market.get("key") == "h2h":
                    for outcome in outcomes:
                        name = outcome.get("name")
                        price = outcome.get("price")
                        if name in (home, away):
                            if fav is None or (price is not None and price < 0):
                                fav = name
                            if price is not None:
                                moneyline = price
                elif market.get("key") == "totals":
                    for outcome in outcomes:
                        if "point" in outcome:
                            total = outcome["point"]
            if fav and spread is not None and moneyline is not None and total is not None:
                break
        out[key] = {"fav": fav, "spread": spread, "ml": moneyline, "ou": total, "book": "consensus"}
    return out


def get_odds_index_throttled() -> Dict[str, Dict[str, Any]]:
    global _ODDS_IDX, _ODDS_LAST_FETCH
    try:
        if _should_fetch_odds():
            payload = odds_next_week()
            idx = _index_odds(payload) if payload else {}
            _ODDS_IDX = idx
            _ODDS_LAST_FETCH = time.time()
    except Exception:
        pass
    return _ODDS_IDX


def _fallback_payload() -> Optional[Dict[str, Any]]:
    root = os.path.dirname(os.path.dirname(__file__))
    path = os.path.join(root, "static", "data", "cfb.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def refresh_cache() -> None:
    # Live/Finals from ESPN for today
    try:
        today_stamp = dt.date.today().strftime("%Y%m%d")
        espn_today = espn_day_scores(today_stamp)
        prev_rows = _normalize_espn_prev(espn_today)
    except Exception:
        prev_rows = []

    # Kickoffs from ESPN for the next Saturday (+ tomorrow)
    next_rows: List[Dict[str, Any]] = []
    try:
        sat = next_saturday()
        espn_sat = espn_day_scores(sat.strftime("%Y%m%d"))
        next_rows = _normalize_espn_upcoming(espn_sat)
        espn_tomorrow = espn_day_scores((dt.date.today() + dt.timedelta(days=1)).strftime("%Y%m%d"))
        next_rows += _normalize_espn_upcoming(espn_tomorrow)
    except Exception:
        next_rows = []

    # Attach odds if available
    odds_idx = get_odds_index_throttled()
    if odds_idx and next_rows:
        for row in next_rows:
            key = f"{_norm_team(row.get('away'))}@@{_norm_team(row.get('home'))}"
            if key in odds_idx:
                row["odds"] = odds_idx[key]

    # Final fallback: static file only if explicitly enabled
    if not prev_rows and not next_rows and _fallback_enabled():
        fb = _fallback_payload()
        if fb:
            CACHE.update(
                {
                    "generated_at": fb.get("generated_at"),
                    "labels": fb.get("labels", {"prev": "Live/Finals", "next": "Kickoffs"}),
                    "prev": fb.get("prev", []),
                    "next": fb.get("next", []),
                    "_stamp": time.time(),
                }
            )
            return

    # Update cache from live sources
    CACHE.update(
        {
            "generated_at": _iso(dt.datetime.utcnow()),
            "labels": {"prev": "Live/Finals", "next": "Kickoffs"},
            "prev": prev_rows,
            "next": next_rows,
            "_stamp": time.time(),
        }
    )


def get_cached_payload() -> Dict[str, Any]:
    if not CACHE.get("_stamp") or (time.time() - CACHE["_stamp"] > CACHE_TTL):
        try:
            refresh_cache()
        except Exception:
            pass
        if (not CACHE.get("prev") and not CACHE.get("next") and _fallback_enabled()):
            fb = _fallback_payload()
            if fb:
                return {
                    "generated_at": fb.get("generated_at"),
                    "labels": fb.get("labels", {"prev": "Live/Finals", "next": "Kickoffs"}),
                    "prev": fb.get("prev", []),
                    "next": fb.get("next", []),
                }
    return {
        "generated_at": CACHE.get("generated_at"),
        "labels": CACHE.get("labels", {"prev": "Live/Finals", "next": "Kickoffs"}),
        "prev": CACHE.get("prev", []),
        "next": CACHE.get("next", []),
    }
