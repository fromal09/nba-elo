#!/usr/bin/env python3
"""
fetch_espn.py: append final ESPN box scores to data/espn_updates.csv.

Covers every day from the latest game already in the data through today (US Eastern), so a
missed night or a game that was still going at the last run is picked up next time. Only games
ESPN marks final are written, and only games no data file has yet. Player names are matched to
the ratings (elo.json) so ESPN rows join the same careers as Stathead rows.

Usage (repo root):
    python3 scripts/fetch_espn.py                    # through today
    python3 scripts/fetch_espn.py --dry-run          # report, write nothing
    python3 scripts/fetch_espn.py --github-output "$GITHUB_OUTPUT"

Exit code 0 with new_games=0 means nothing to do. Exit code 1 means ESPN failed or a box score
didn't parse; nothing is written in that case.
"""
import argparse, csv, json, re, sys, time, unicodedata, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from team_canonical import canon_team

BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
OUT = Path("data/espn_updates.csv")
SOURCES = [Path("data/nbaupdates.csv"), OUT]
ABBR = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS", "PHX": "PHO", "CHA": "CHO", "BRK": "BKN"}
SEASON_TYPES = {2, 3, 5}  # regular season, playoffs, play-in
MAX_DAYS = 21
HEADER = ["Player", "GmSc", "Date", "Team", "home_away", "Opp", "Result", "GS", "MP", "FG", "FGA", "3P", "3PA",
          "FT", "FTA", "ORB", "DRB", "TRB", "AST", "STL", "BLK", "TOV", "PF", "PTS", "+/-", "Pos.", "espn_id"]

# ESPN name -> site name where ESPN uses a different first name (normalized keys); keep in sync with src/components/live.js
ALIASES = {
    "nicolas claxton": "nic claxton", "alexandre sarr": "alex sarr", "moe wagner": "moritz wagner",
    "herb jones": "herbert jones", "carlton carrington": "bub carrington", "kenyon martin": "kj martin",
    "jeenathan williams": "nate williams", "nahshon hyland": "bones hyland",
}
FIELDS = {
    "mp": ("minutes", "MIN"), "pts": ("points", "PTS"), "fg": ("fieldGoalsMade-fieldGoalsAttempted", "FG"),
    "tp": ("threePointFieldGoalsMade-threePointFieldGoalsAttempted", "3PT"), "ft": ("freeThrowsMade-freeThrowsAttempted", "FT"),
    "trb": ("rebounds", "REB"), "ast": ("assists", "AST"), "tov": ("turnovers", "TO"), "stl": ("steals", "STL"),
    "blk": ("blocks", "BLK"), "orb": ("offensiveRebounds", "OREB"), "drb": ("defensiveRebounds", "DREB"),
    "pf": ("fouls", "PF"), "pm": ("plusMinus", "+/-"),
}


def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"[.'’]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    s = re.sub(r"\s*\(\d{4}\)$", "", s)
    s = re.sub(r"[^a-z ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                raise RuntimeError(f"{url.replace(BASE, '')}: {e}")
            time.sleep(2 * (i + 1))


def et_today():
    # US Eastern without a tz database: EDT from the 2nd Sunday of March to the 1st Sunday of November
    now = datetime.now(timezone.utc)
    y = now.year
    mar = date(y, 3, 8) + timedelta(days=(6 - date(y, 3, 8).weekday()) % 7)
    nov = date(y, 11, 1) + timedelta(days=(6 - date(y, 11, 1).weekday()) % 7)
    start = datetime(y, mar.month, mar.day, 7, tzinfo=timezone.utc)
    end = datetime(y, nov.month, nov.day, 6, tzinfo=timezone.utc)
    return (now - timedelta(hours=4 if start <= now < end else 5)).date()


def existing_games():
    """(date, team, team) keys already in the data, and the latest date seen."""
    keys, latest = set(), None
    files = [p for p in SOURCES if p.exists()]
    seasons = sorted(Path("data").glob("[0-9][0-9][0-9][0-9]-[0-9][0-9].csv"))
    if seasons:
        files.append(seasons[-1])
    for f in files:
        with f.open(encoding="utf-8", errors="replace") as fh:
            for row in csv.DictReader(fh):
                d, t, o = (row.get("Date") or "")[:10], row.get("Team") or "", row.get("Opp") or ""
                if not re.match(r"\d{4}-\d{2}-\d{2}$", d) or not t:
                    continue
                keys.add((d, *sorted([canon_team(t), canon_team(o)])))
                latest = d if latest is None or d > latest else latest
    return keys, latest


def ratings():
    """Name lookups from elo.json: exact normalized name, and last name -> players (for same-team fallback)."""
    path = Path("public/data/elo.json")
    by_norm, by_last = {}, {}
    if not path.exists():
        return by_norm, by_last
    players = json.loads(path.read_text(encoding="utf-8"))["players"]
    for p in sorted(players, key=lambda p: p.get("last_played") or ""):
        k = norm(p["name"])
        by_norm[k] = p  # the most recently active player wins a shared name
        by_last.setdefault(k.split(" ")[-1], []).append(p)
    return by_norm, by_last


def match(name, team, by_norm, by_last):
    k = norm(name)
    k = ALIASES.get(k, k)
    if k in by_norm:
        return by_norm[k]["name"]
    parts = k.split(" ")
    same = [p for p in by_last.get(parts[-1], []) if canon_team(p.get("team") or "") == team]
    if len(same) == 1:
        return same[0]["name"]
    init = [p for p in same if norm(p["name"])[:1] == parts[0][:1]]
    return init[0]["name"] if len(init) == 1 else None


def parse_box(group):
    st = (group.get("statistics") or [{}])[0]
    keys, labels = st.get("keys") or [], st.get("labels") or st.get("names") or []
    col = {}
    for f, (k, l) in FIELDS.items():
        col[f] = keys.index(k) if k in keys else labels.index(l) if l in labels else -1
    missing = [f for f in ("mp", "pts", "fg", "ft", "trb", "ast") if col[f] < 0]
    if missing:
        raise ValueError(f"box score is missing columns {missing} (labels: {labels})")
    out = []
    for a in st.get("athletes") or []:
        s = a.get("stats") or []
        if a.get("didNotPlay") or not s:
            continue
        g = lambda f: s[col[f]] if col[f] >= 0 and col[f] < len(s) else None
        def n(f):
            v = g(f)
            try:
                return int(str(v).replace("+", ""))
            except (TypeError, ValueError):
                return None
        def pair(f):
            m = re.match(r"^(\d+)-(\d+)$", str(g(f) or ""))
            return (int(m.group(1)), int(m.group(2))) if m else (None, None)
        mp_raw = str(g("mp") or "")
        mp = round(int(mp_raw.split(":")[0]) + int(mp_raw.split(":")[1]) / 60) if ":" in mp_raw else n("mp")
        fg, fga = pair("fg"); tp, tpa = pair("tp"); ft, fta = pair("ft")
        p = dict(name=(a.get("athlete") or {}).get("displayName") or "", espn=(a.get("athlete") or {}).get("id") or "",
                 pos=((a.get("athlete") or {}).get("position") or {}).get("abbreviation") or "", st=bool(a.get("starter")),
                 mp=mp, pts=n("pts"), fg=fg, fga=fga, tp=tp, tpa=tpa, ft=ft, fta=fta, orb=n("orb"), drb=n("drb"),
                 trb=n("trb"), ast=n("ast"), stl=n("stl"), blk=n("blk"), tov=n("tov"), pf=n("pf"), pm=n("pm"))
        played = p["mp"] or any(p[k] for k in ("pts", "fga", "fta", "trb", "ast", "stl", "blk", "tov", "pf"))
        if p["name"] and played:
            out.append(p)
    return out


def game_score(p):
    z = lambda k: p[k] or 0
    return round(z("pts") + 0.4 * z("fg") - 0.7 * z("fga") - 0.4 * (z("fta") - z("ft")) + 0.7 * z("orb") + 0.3 * z("drb")
                 + z("stl") + 0.7 * z("ast") + 0.7 * z("blk") - 0.4 * z("pf") - z("tov"), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--github-output")
    ap.add_argument("--since", help="first day to check (YYYY-MM-DD); default: latest day in the data")
    args = ap.parse_args()

    have, latest = existing_games()
    today = et_today()
    start = date.fromisoformat(args.since) if args.since else (date.fromisoformat(latest) if latest else today)
    start = max(start, today - timedelta(days=MAX_DAYS))
    by_norm, by_last = ratings()
    print(f"Checking {start} through {today} ({len(have):,} games already in the data, latest {latest})")

    rows, games, unmatched, pending = [], [], [], 0
    d = start
    while d <= today:
        day = d.isoformat()
        sb = get(f"{BASE}/scoreboard?dates={day.replace('-', '')}&limit=100")
        for e in sb.get("events") or []:
            c = (e.get("competitions") or [{}])[0]
            stype = int((e.get("season") or {}).get("type") or (c.get("type") or {}).get("id") or 2)
            if stype not in SEASON_TYPES:
                continue
            comp = {x.get("homeAway"): x for x in c.get("competitors") or []}
            if "home" not in comp or "away" not in comp:
                continue
            code = lambda x: canon_team(ABBR.get(x["team"]["abbreviation"], x["team"]["abbreviation"]))
            home, away = code(comp["home"]), code(comp["away"])
            if (day, *sorted([home, away])) in have:
                continue
            status = (c.get("status") or e.get("status") or {}).get("type") or {}
            if not status.get("completed"):
                pending += 1
                continue
            summ = get(f"{BASE}/summary?event={e['id']}")
            box = {}
            for grp in (summ.get("boxscore") or {}).get("players") or []:
                ab = (grp.get("team") or {}).get("abbreviation")
                box[canon_team(ABBR.get(ab, ab))] = parse_box(grp)
            if set(box) != {home, away} or any(len(v) < 5 for v in box.values()):
                raise ValueError(f"{day} {away}@{home}: incomplete box score ({ {k: len(v) for k, v in box.items()} })")
            hs, as_ = int(comp["home"].get("score") or 0), int(comp["away"].get("score") or 0)
            if sum(p["pts"] or 0 for p in box[home]) != hs or sum(p["pts"] or 0 for p in box[away]) != as_:
                raise ValueError(f"{day} {away}@{home}: player points don't add up to the final score")
            detail = status.get("shortDetail") or status.get("detail") or ""
            ot = re.search(r"(\d*)OT", detail)
            ot_tag = f" ({ot.group(1)}OT)" if ot else ""
            for team, opp, pts, opp_pts, ha in ((home, away, hs, as_, ""), (away, home, as_, hs, "@")):
                result = f"{'W' if pts > opp_pts else 'L'}, {pts}-{opp_pts}{ot_tag}"
                for p in box[team]:
                    name = match(p["name"], team, by_norm, by_last)
                    if name is None:
                        unmatched.append(f"{p['name']} ({team})")
                    rows.append({
                        "Player": name or p["name"], "GmSc": game_score(p), "Date": day, "Team": team, "home_away": ha,
                        "Opp": opp, "Result": result, "GS": "*" if p["st"] else "", "MP": p["mp"],
                        "FG": p["fg"], "FGA": p["fga"], "3P": p["tp"], "3PA": p["tpa"], "FT": p["ft"], "FTA": p["fta"],
                        "ORB": p["orb"], "DRB": p["drb"], "TRB": p["trb"], "AST": p["ast"], "STL": p["stl"],
                        "BLK": p["blk"], "TOV": p["tov"], "PF": p["pf"], "PTS": p["pts"], "+/-": p["pm"],
                        "Pos.": p["pos"], "espn_id": p["espn"],
                    })
            games.append(f"{day} {away}@{home} {as_}-{hs}")
        d += timedelta(days=1)

    print(f"{len(games)} new final games, {len(rows)} player rows, {pending} not final yet")
    for g in games:
        print("  " + g)
    if unmatched:
        print(f"New to the ratings (no name match), {len(unmatched)}: {', '.join(unmatched)}")

    if rows and not args.dry_run:
        new_file = not OUT.exists()
        with OUT.open("a", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=HEADER)
            if new_file:
                w.writeheader()
            w.writerows({k: ("" if v is None else v) for k, v in r.items()} for r in rows)
        print(f"Appended to {OUT}")

    if args.github_output:
        through = max((g[:10] for g in games), default=latest or "")
        with open(args.github_output, "a") as fh:
            fh.write(f"new_games={0 if args.dry_run else len(games)}\nthrough={through}\npending={pending}\n")
            fh.write(f"unmatched={len(unmatched)}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
