import json
import os
import time
import datetime as dt
from typing import Any, Dict, List, Optional

# httpx is optional; if missing, we fall back to static payloads and skip live fetches
try:  # pragma: no cover - optional dependency
    import httpx  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    httpx = None  # type: ignore


CFBD_KEY = os.getenv("CFBD_API_KEY", "")
ODDS_KEY = os.getenv("ODDS_API_KEY", "")

# In-memory cache
CACHE: Dict[str, Any] = {
    "generated_at": None,
    "labels": {"prev": "", "next": ""},
    "prev": [],
    "next": [],
}
CACHE_TTL = 120  # seconds


def _iso(dtobj: dt.datetime) -> str:
    return dtobj.replace(microsecond=0).isoformat() + "Z"


def current_cfb_year_today() -> int:
    today = dt.date.today()
    return today.year


def cfb_week(today: Optional[dt.date] = None) -> int:
    d = today or dt.date.today()
    if d.month < 8:
        return 1
    base = dt.date(d.year, 8, 25)
    return max(1, min(14, ((d - base).days // 7) + 1))


def cfbd_games(year: int, week: int) -> List[Dict[str, Any]]:
    if not CFBD_KEY or httpx is None:
        return []
    url = "https://api.collegefootballdata.com/games"
    params = {"year": year, "seasonType": "regular", "week": week}
    headers = {"Authorization": f"Bearer {CFBD_KEY}"}
    with httpx.Client(timeout=20) as client:
        r = client.get(url, params=params, headers=headers)
        r.raise_for_status()
        return r.json()



def espn_day_scores(date_yyyymmdd: str) -> Dict[str, Any]:
    if httpx is None:
        return {}
    url = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"
    params = {"dates": date_yyyymmdd, "groups": "80"}
    with httpx.Client(timeout=20) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        return r.json()



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



def _team_label(team: str, rank: Optional[int]) -> str:
    return f"#{rank} {team}" if rank else team


def _tv_from_cfbd(game: Dict[str, Any]) -> Optional[str]:
    tv = game.get("tv") or game.get("notes")
    if tv and isinstance(tv, str):
        return tv.split(";")[0].strip()
    return None


def _normalize_prev(cfbd_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for g in cfbd_list:
        hs = g.get("home_points")
        as_ = g.get("away_points")
        if hs is None or as_ is None:
            continue
        if g.get("completed") is True or str(g.get("status", "")).lower() == "final":
            rows.append(
                {
                    "away": _team_label(g.get("away_team", ""), g.get("away_rank")),
                    "home": _team_label(g.get("home_team", ""), g.get("home_rank")),
                    "away_score": as_,
                    "home_score": hs,
                    "status": "FINAL",
                }
            )
    return rows


def _index_odds(odds_payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    games = odds_payload.get("games") or []
    for game in games:
        away = game.get("away_team", "")
        home = game.get("home_team", "")
        key = f"{away}@@{home}"
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
        out[key] = {
            "fav": fav,
            "spread": spread,
            "ml": moneyline,
            "ou": total,
            "book": "consensus",
        }
    return out


def _normalize_next(cfbd_list: List[Dict[str, Any]], odds_idx: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for g in cfbd_list:
        if g.get("completed"):
            continue
        start_raw = g.get("start_date") or g.get("start_time_tbd")
        start_iso: Optional[str] = None
        if isinstance(start_raw, str) and start_raw:
            try:
                parsed = dt.datetime.fromisoformat(start_raw.replace("Z", ""))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=dt.timezone.utc)
                start_iso = parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")
            except ValueError:
                start_iso = None
        away = g.get("away_team", "")
        home = g.get("home_team", "")
        key = f"{away}@@{home}"
        rows.append(
            {
                "away": _team_label(away, g.get("away_rank")),
                "home": _team_label(home, g.get("home_rank")),
                "start": start_iso,
                "network": _tv_from_cfbd(g),
                "odds": odds_idx.get(key) or None,
            }
        )
    rows.sort(key=lambda r: r.get("start") or "")
    return rows


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
    year = current_cfb_year_today()
    this_week = cfb_week()
    prev_week = max(1, this_week - 1)

    try:
        prev_cfbd = cfbd_games(year, prev_week)
    except Exception:
        prev_cfbd = []
    try:
        next_cfbd = cfbd_games(year, this_week)
    except Exception:
        next_cfbd = []

    try:
        odds_idx = _index_odds(odds_next_week())
    except Exception:
        odds_idx = {}

    prev_rows = _normalize_prev(prev_cfbd)
    next_rows = _normalize_next(next_cfbd, odds_idx)

    if not prev_rows and not next_rows:
        fallback = _fallback_payload()
        if fallback:
            CACHE.update(
                {
                    "generated_at": fallback.get("generated_at"),
                    "labels": fallback.get("labels", {}),
                    "prev": fallback.get("prev", []),
                    "next": fallback.get("next", []),
                    "_stamp": time.time(),
                }
            )
            return

    labels = {
        "prev": f"Week {prev_week} Finals",
        "next": f"Week {this_week} Kickoffs",
    }

    CACHE.update(
        {
            "generated_at": _iso(dt.datetime.utcnow()),
            "labels": labels,
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
    if not CACHE.get("prev") and not CACHE.get("next"):
        fallback = _fallback_payload()
        if fallback:
            return {
                "generated_at": fallback.get("generated_at"),
                "labels": fallback.get("labels", {}),
                "prev": fallback.get("prev", []),
                "next": fallback.get("next", []),
            }
    return {
        "generated_at": CACHE.get("generated_at"),
        "labels": CACHE.get("labels", {}),
        "prev": CACHE.get("prev", []),
        "next": CACHE.get("next", []),
    }
