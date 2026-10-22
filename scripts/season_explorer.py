"""
season_explorer.py — writes the Season Explorer data for every season.

build_elo.py calls:
  mark_missing(df, cols)   before it zero-fills stats, so blank stats stay blank
  bind(df)                 after dedup, to snapshot the columns the box score needs
  record_game(...)         inside the Elo loop, so pre-game Elo is captured, not rebuilt
  write()                  at the end

Output:
  public/data/explorer/index.json         list of seasons
  public/data/explorer/<season>.json      teams (historical names, records, roster Elo)
                                          and every game once, with compact player rows
Player row = list in COLS order:
  n name, t team id, st starter, pos, mp, pts, fg, fga, tp, tpa, ft, fta, orb, drb, trb,
  ast, stl, blk, tov, pf, pm (+/-), gs (Game Score), pre, post (Elo),
  gp (career games before this one, drives K), xw (expected duels won), w (duels won)
"""
import json, math, re, shutil
from bisect import bisect_right
from collections import defaultdict, Counter, deque
from datetime import date
from pathlib import Path

OUT_DIR = Path("public/data/explorer")
COLS = ["n", "t", "st", "pos", "mp", "pts", "fg", "fga", "tp", "tpa", "ft", "fta", "orb", "drb", "trb",
        "ast", "stl", "blk", "tov", "pf", "pm", "gs", "pre", "post", "gp", "xw", "w", "lr"]
# lr: pre-game Elo rank among that season's players (same league) on that date
STAT_SRC = {"pts": "PTS", "fg": "FG", "fga": "FGA", "tp": "3P", "tpa": "3PA", "ft": "FT", "fta": "FTA",
            "orb": "ORB", "drb": "DRB", "trb": "TRB", "ast": "AST", "stl": "STL", "blk": "BLK",
            "tov": "TOV", "pf": "PF"}
OPTIONAL = ["st", "pos", "mp", "tp", "tpa", "orb", "drb", "stl", "blk", "tov", "pf", "pm"]

# ── Franchise names by season start year ────────────────────────────────────
# (from_year, name); the last entry whose from_year <= season applies.
NBA_NAMES = {
    "ATL": [(1946, "Toronto Huskies"), (1949, "Tri-Cities Blackhawks"), (1951, "Milwaukee Hawks"), (1955, "St. Louis Hawks"), (1968, "Atlanta Hawks")],
    "BOS": [(1946, "Boston Celtics")],
    "BKN": [(1976, "New York Nets"), (1977, "New Jersey Nets"), (2012, "Brooklyn Nets")],
    "CHI": [(1946, "Chicago Stags"), (1966, "Chicago Bulls")],
    "CHO": [(1988, "Charlotte Hornets"), (2004, "Charlotte Bobcats"), (2014, "Charlotte Hornets")],
    "CLE": [(1946, "Cleveland Rebels"), (1970, "Cleveland Cavaliers")],
    "DAL": [(1980, "Dallas Mavericks")],
    "DEN": [(1949, "Denver Nuggets")],
    "DET": [(1946, "Detroit Falcons"), (1947, "Fort Wayne Pistons"), (1957, "Detroit Pistons")],
    "GSW": [(1946, "Philadelphia Warriors"), (1962, "San Francisco Warriors"), (1971, "Golden State Warriors")],
    "HOU": [(1967, "San Diego Rockets"), (1971, "Houston Rockets")],
    "IND": [(1976, "Indiana Pacers")],
    "LAC": [(1970, "Buffalo Braves"), (1978, "San Diego Clippers"), (1984, "Los Angeles Clippers"), (2015, "LA Clippers")],
    "LAL": [(1948, "Minneapolis Lakers"), (1960, "Los Angeles Lakers")],
    "MEM": [(1995, "Vancouver Grizzlies"), (2001, "Memphis Grizzlies")],
    "MIA": [(1988, "Miami Heat")],
    "MIL": [(1968, "Milwaukee Bucks")],
    "MIN": [(1989, "Minnesota Timberwolves")],
    "NOH": [(1988, "Charlotte Hornets"), (2002, "New Orleans Hornets"), (2005, "New Orleans/Oklahoma City Hornets"), (2007, "New Orleans Hornets")],
    "NOP": [(2002, "New Orleans Hornets"), (2005, "New Orleans/Oklahoma City Hornets"), (2007, "New Orleans Hornets"), (2013, "New Orleans Pelicans")],
    "NYK": [(1946, "New York Knicks")],
    "OKC": [(1967, "Seattle SuperSonics"), (2008, "Oklahoma City Thunder")],
    "ORL": [(1989, "Orlando Magic")],
    "PHI": [(1949, "Syracuse Nationals"), (1963, "Philadelphia 76ers")],
    "PHO": [(1968, "Phoenix Suns")],
    "POR": [(1970, "Portland Trail Blazers")],
    "SAC": [(1948, "Rochester Royals"), (1957, "Cincinnati Royals"), (1972, "Kansas City-Omaha Kings"), (1975, "Kansas City Kings"), (1985, "Sacramento Kings")],
    "SAS": [(1976, "San Antonio Spurs")],
    "TOR": [(1995, "Toronto Raptors")],
    "UTA": [(1974, "New Orleans Jazz"), (1979, "Utah Jazz")],
    "WAS": [(1961, "Chicago Packers"), (1962, "Chicago Zephyrs"), (1963, "Baltimore Bullets"), (1973, "Capital Bullets"), (1974, "Washington Bullets"), (1997, "Washington Wizards")],
    "AND": [(1949, "Anderson Packers")], "BLB": [(1947, "Baltimore Bullets")], "CHP": [(1961, "Chicago Packers")],
    "CHZ": [(1962, "Chicago Zephyrs")], "INJ": [(1948, "Indianapolis Jets")], "INO": [(1949, "Indianapolis Olympians")],
    "PIT": [(1946, "Pittsburgh Ironmen")], "PRO": [(1946, "Providence Steamrollers")], "SHE": [(1949, "Sheboygan Red Skins")],
    "STB": [(1946, "St. Louis Bombers")], "WAT": [(1949, "Waterloo Hawks")], "WSC": [(1946, "Washington Capitols")],
    "DNN": [(1949, "Denver Nuggets")], "BOM": [(1947, "Baltimore Bullets")],
}
ABA_NAMES = {
    "ANA": [(1967, "Anaheim Amigos")], "LAS": [(1968, "Los Angeles Stars")], "UTA": [(1970, "Utah Stars")],
    "BKN": [(1967, "New Jersey Americans"), (1968, "New York Nets")],
    "CAR": [(1969, "Carolina Cougars")], "SSL": [(1974, "Spirits of St. Louis")],
    "DEN": [(1967, "Denver Rockets"), (1974, "Denver Nuggets")],
    "DLC": [(1967, "Dallas Chaparrals")], "TEX": [(1970, "Texas Chaparrals")], "SAS": [(1973, "San Antonio Spurs")],
    "FLO": [(1970, "The Floridians")], "MEM": [(1968, "Miami Floridians")],
    "GSW": [(1967, "Oakland Oaks")], "WSA": [(1969, "Washington Caps")], "VIR": [(1970, "Virginia Squires")],
    "HSM": [(1967, "Houston Mavericks")], "IND": [(1967, "Indiana Pacers")], "KEN": [(1967, "Kentucky Colonels")],
    "LAC": [(1972, "San Diego Conquistadors")], "SDS": [(1975, "San Diego Sails")],
    "NOP": [(1967, "New Orleans Buccaneers")], "MMP": [(1970, "Memphis Pros")], "MMT": [(1972, "Memphis Tams")],
    "MMS": [(1974, "Memphis Sounds")], "MNM": [(1967, "Minnesota Muskies")], "MNP": [(1968, "Minnesota Pipers")],
    "PTP": [(1967, "Pittsburgh Pipers")], "PTC": [(1970, "Pittsburgh Condors")],
}
COLORS = {
    "ATL": "#C8102E", "BOS": "#007A33", "BKN": "#000000", "CHO": "#00788C", "CHI": "#CE1141", "CLE": "#860038",
    "DAL": "#00538C", "DEN": "#0E2240", "DET": "#C8102E", "GSW": "#1D428A", "HOU": "#CE1141", "IND": "#002D62",
    "LAC": "#C8102E", "LAL": "#552583", "MEM": "#5D76A9", "MIA": "#98002E", "MIL": "#00471B", "MIN": "#0C2340",
    "NOP": "#0C2340", "NOH": "#00788C", "NYK": "#006BB6", "OKC": "#007AC1", "ORL": "#0077C0", "PHI": "#006BB6",
    "PHO": "#1D1160", "POR": "#E03A3E", "SAC": "#5A2D81", "SAS": "#4a4f54", "TOR": "#CE1141", "UTA": "#002B5C",
    "WAS": "#002B5C",
}
HIST_COLORS = {"Seattle SuperSonics": "#00653A", "Vancouver Grizzlies": "#00B2A9", "New Jersey Nets": "#002A60",
               "Charlotte Bobcats": "#F26532", "Kansas City Kings": "#1D428A", "San Diego Clippers": "#1D428A",
               "Buffalo Braves": "#1D428A", "Washington Bullets": "#C8102E", "Baltimore Bullets": "#C8102E"}
EAST = {"ATL", "BOS", "BKN", "CHO", "CHI", "CLE", "DET", "IND", "MIA", "MIL", "NYK", "ORL", "PHI", "TOR", "WAS"}
_PALETTE = ["#5b4a8b", "#8c564b", "#2b6f6b", "#7a5c1e", "#4a6b8a", "#8a3b52", "#3f6e2a", "#6b4a2b"]


def _name(code, sy, lg):
    table = (ABA_NAMES if lg == "ABA" else NBA_NAMES).get(code)
    if not table:
        return code
    best = table[0][1]
    for y, n in table:
        if y <= sy:
            best = n
    return best


def _color(code, name, lg):
    if name in HIST_COLORS:
        return HIST_COLORS[name]
    if lg != "ABA" and code in COLORS:
        return COLORS[code]
    return _PALETTE[sum(map(ord, name)) % len(_PALETTE)]


# ── Hooks called from build_elo.py ──────────────────────────────────────────
_raw = {}
_games = []          # games of the season currently being recorded
_cur = [None]        # that season's start year
_index = []          # one summary per written season
_NA_COLS = []
_final = {}          # team id -> lineup Elo after its last game of the previous written season
_best = {}           # player -> [best league rank, season label]
_last_cur = {}       # league -> {player: Elo} at the end of the previous written season
_recent = defaultdict(lambda: deque(maxlen=10))  # player -> last 10 appearances (date, team, minutes)


def mark_missing(df, cols):
    """Bitmask of stats that were blank in the source, before build_elo zero-fills them."""
    import pandas as pd
    mask = pd.Series(0, index=df.index, dtype="int64")
    for i, c in enumerate(cols):
        if c in df.columns:
            mask |= pd.to_numeric(df[c], errors="coerce").isna().astype("int64") * (1 << i)
    df["_na"] = mask
    _NA_COLS[:] = list(cols)


def _first_text(df, col):
    """Column as list of strings; merges duplicate column names (BDL home_away + renamed blank column)."""
    if col not in df.columns:
        return None
    sub = df.loc[:, df.columns == col]
    out = None
    for j in range(sub.shape[1]):
        vals = sub.iloc[:, j].tolist()
        if out is None:
            out = ["" if v is None or (isinstance(v, float) and math.isnan(v)) else str(v).strip() for v in vals]
        else:
            for k, v in enumerate(vals):
                if not out[k] and v is not None and not (isinstance(v, float) and math.isnan(v)):
                    out[k] = str(v).strip()
    return out


def _nums(df, *cols):
    for c in cols:
        if c in df.columns:
            import pandas as pd
            return pd.to_numeric(df[c], errors="coerce").tolist()
    return None


def bind(df):
    """Snapshot the columns record_game needs, indexed by df row label (df must have a RangeIndex)."""
    _raw.clear()
    _raw["mp"] = _nums(df, "MP")
    _raw["pm"] = _nums(df, "+/-", "#ERROR!")
    for k, c in STAT_SRC.items():
        _raw[k] = _nums(df, c)
    _raw["gs_col"] = _first_text(df, "GS")
    _raw["pos"] = _first_text(df, "Pos.") or _first_text(df, "Pos")
    _raw["res"] = _first_text(df, "Result")
    _raw["ha"] = _first_text(df, "home_away")
    _raw["lg"] = _first_text(df, "_lg")
    _raw["na"] = df["_na"].tolist() if "_na" in df.columns else None
    _raw["na_bit"] = {k: (1 << _NA_COLS.index(c)) if c in _NA_COLS else 0 for k, c in STAT_SRC.items()}
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)
    _games.clear(); _index.clear(); _final.clear(); _best.clear(); _recent.clear(); _last_cur.clear(); _cur[0] = None


def _v(x):
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f):
        return None
    return int(f) if f.is_integer() else round(f, 1)


def record_game(game_id, date_str, players, rows, team_of, pre, gp, gmsc, post, xw, wins):
    sy = _season_of(date_str)
    if sy != _cur[0]:
        if _games:
            _write_season(_cur[0], _games)
            _games.clear()
        _cur[0] = sy
    R = _raw
    out, res, ha = [], {}, {}
    for p in players:
        r = rows.get(p)
        if r is None:
            continue
        i = r.name
        lg = (R["lg"][i] if R["lg"] else "") or "NBA"
        tid = team_of.get(p, "") + ("@ABA" if lg == "ABA" else "")
        na = R["na"][i] if R["na"] else 0
        row = [p, tid,
               (R["gs_col"][i] == "*") if R["gs_col"] else None,
               R["pos"][i] if R["pos"] else "",
               round(R["mp"][i]) if R["mp"] and R["mp"][i] == R["mp"][i] else None]
        for k in ["pts", "fg", "fga", "tp", "tpa", "ft", "fta", "orb", "drb", "trb", "ast", "stl", "blk", "tov", "pf"]:
            row.append(None if (na & R["na_bit"][k]) or not R[k] else _v(R[k][i]))
        row += [_v(R["pm"][i]) if R["pm"] else None,
                round(float(gmsc[p]), 1), round(pre[p], 1), round(post[p], 1), gp[p],
                round(xw[p], 2), wins[p]]
        out.append(row)
        res.setdefault(tid, R["res"][i] if R["res"] else "")
        if R["ha"] and R["ha"][i] == "@":
            ha[tid] = True
    _games.append({"id": game_id, "date": date_str, "rows": out, "res": res, "away": set(ha)})


_RES = re.compile(r"([WL]),?\s*(\d+)\s*-\s*(\d+)\s*(\((\d*)OT\))?")


def _finish(g):
    teams = sorted({r[1] for r in g["rows"] if r[1]})
    if len(teams) != 2:
        return None
    pts, ot = {}, ""
    for t in teams:
        m = _RES.search(g["res"].get(t, ""))
        if m:
            o = teams[1] if t == teams[0] else teams[0]
            pts[t], pts[o] = int(m.group(2)), int(m.group(3))
            if m.group(4):
                ot = f"{m.group(5) or ''}OT"
            break
    if len(pts) != 2:  # no score in the source (BDL files): sum player points
        for t in teams:
            pts[t] = sum(r[5] or 0 for r in g["rows"] if r[1] == t)
        wl = {t: g["res"].get(t, "")[:1] for t in teams}
        a, b = teams
        if pts[a] == pts[b] or (wl[a] == "W" and pts[a] < pts[b]) or (wl[b] == "W" and pts[b] < pts[a]):
            if "W" in (wl[a], wl[b]):
                winner = a if wl[a] == "W" else b
                pts[winner] = max(pts[winner], pts[b if winner == a else a] + 1)
    home = None
    if len(g["away"]) == 1:
        home = teams[1] if teams[0] in g["away"] else teams[0]
    return {"id": g["id"], "date": g["date"], "teams": teams, "pts": [pts[teams[0]], pts[teams[1]]],
            "home": home, "ot": ot, "rows": g["rows"]}


def _season_of(d):
    y, m = int(d[:4]), int(d[5:7])
    return y if m >= 9 else y - 1


def write():
    if _games:
        _write_season(_cur[0], _games, latest=True)
        _games.clear()
    (OUT_DIR / "ranks.json").write_text(json.dumps(_best, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Recent minutes for the prediction model: players seen in the last ~400 days
    last_day = max((q[-1][0] for q in _recent.values() if q), default="0000-00-00")
    y, m, d = map(int, last_day.split("-"))
    cutoff = f"{y - 1}-{m:02d}-{d:02d}"
    rot = {}
    for n, q in _recent.items():
        if q and q[-1][0] >= cutoff:
            mins = [x[2] for x in q if x[2] is not None]
            rot[n] = {"mp": round(sum(mins) / len(mins), 1) if mins else None, "n": len(q), "team": q[-1][1], "last": q[-1][0],
                      "log": [[x[0], x[1], x[2]] for x in q]}
    (OUT_DIR / "rotation.json").write_text(json.dumps({"through": last_day, "players": rot}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    index = {"generated": date.today().isoformat(), "cols": COLS,
             "seasons": sorted(_index, key=lambda x: x["season"], reverse=True)}
    (OUT_DIR / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    total = sum(f.stat().st_size for f in OUT_DIR.glob("*.json"))
    print(f"  Explorer: {len(_index)} seasons, {sum(s['games'] for s in _index):,} games, {total / 1e6:.0f} MB")


def _write_season(sy, raw_games, latest=False):
    games = sorted((f for f in map(_finish, raw_games) if f), key=lambda g: (g["date"], g["id"]))
    if not games:
        return
    label = f"{sy}-{str(sy + 1)[-2:]}"
    lg_of = lambda t: "ABA" if t.endswith("@ABA") else "NBA"

    # Regular season ends on the last game of the teams that played the fewest games
    # (non-playoff teams); anything later is postseason. Done per league.
    reg_end = {}
    for lg in {lg_of(t) for g in games for t in g["teams"]}:
        cnt, last = Counter(), {}
        for g in games:
            for t in g["teams"]:
                if lg_of(t) == lg:
                    cnt[t] += 1
                    last[t] = g["date"]
        vals = sorted(cnt.values())
        low = vals[: max(1, len(vals) // 2)]
        L = Counter(low).most_common(1)[0][0]
        ends = [last[t] for t in cnt if cnt[t] == L]
        reg_end[lg] = max(ends) if ends and max(cnt.values()) > L else None

    teams = {}
    rec = defaultdict(lambda: [0, 0, 0, 0])
    mins, latest = defaultdict(lambda: defaultdict(float)), defaultdict(dict)
    for g in games:
        lg = lg_of(g["teams"][0])
        g["post"] = bool(reg_end.get(lg) and g["date"] > reg_end[lg])
        a, b = g["teams"]
        win = a if g["pts"][0] > g["pts"][1] else b
        for t in (a, b):
            rec[t][(2 if g["post"] else 0) + (0 if t == win else 1)] += 1
        for r in g["rows"]:
            mins[r[1]][r[0]] += r[4] or 0
            latest[r[1]][r[0]] = r[23]

    present_stats = {k: any(r[COLS.index(k)] not in (None, "", False) for g in games for r in g["rows"]) for k in OPTIONAL}
    for t, (w, l, pw, pl) in rec.items():
        code, lg = t.split("@")[0], lg_of(t)
        name = _name(code, sy, lg)
        top8 = sorted(mins[t], key=lambda n: -mins[t][n])[:8]
        if sy >= 2004 and lg == "NBA":
            group = "Eastern Conference" if code in EAST else "Western Conference"
        else:
            group = "ABA" if lg == "ABA" else ("BAA" if sy < 1949 else "NBA")
        teams[t] = {"code": code, "name": name, "color": _color(code, name, lg), "group": group,
                    "w": w, "l": l, "pw": pw, "pl": pl, "gp": w + l + pw + pl,
                    "elo": round(sum(latest[t][n] for n in top8) / len(top8), 1) if top8 else None}

    # League rank entering each game: every player who appears this season, at his latest Elo
    # (his first pre-game Elo before his debut), ranked within his league.
    cur = defaultdict(dict)
    for g in games:
        for r in g["rows"]:
            cur[lg_of(r[1])].setdefault(r[0], r[22])
    # The season in progress also counts last season's players who haven't played yet
    if latest:
        for lg, d in _last_cur.items():
            for n, v in d.items():
                cur[lg].setdefault(n, v)
    by_date = defaultdict(list)
    for g in games:
        by_date[g["date"]].append(g)
    for day in sorted(by_date):
        snap = {lg: sorted(v.values()) for lg, v in cur.items()}
        for g in by_date[day]:
            for r in g["rows"]:
                vals = snap[lg_of(r[1])]
                rank = 1 + len(vals) - bisect_right(vals, r[22])
                r.append(rank)
                b = _best.get(r[0])
                if not b or rank < b[0]:
                    _best[r[0]] = [rank, label]
                _recent[r[0]].append((day, r[1], r[4]))
        for g in by_date[day]:
            for r in g["rows"]:
                cur[lg_of(r[1])][r[0]] = r[23]
    _last_cur.clear()
    _last_cur.update({lg: {n: v for n, v in d.items()} for lg, d in cur.items()})

    # Lineup Elo (minutes-weighted post-game Elo) after each team's final game: seeds next season's ranks
    seed = dict(_final)
    _final.clear()
    for g in games:
        for t in g["teams"]:
            ps = [r for r in g["rows"] if r[1] == t]
            m = sum(r[4] or 0 for r in ps)
            _final[t] = round(sum(r[23] * (r[4] or 0) for r in ps) / m if m else sum(r[23] for r in ps) / len(ps), 1)

    out = {"season": label, "cols": COLS, "seed": seed, "stats": [k for k, v in present_stats.items() if v],
           "teams": teams, "games": [{k: g[k] for k in ("id", "date", "teams", "pts", "home", "ot", "post", "rows")} for g in games]}
    (OUT_DIR / f"{label}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    _index.append({"season": label, "games": len(games), "first": games[0]["date"], "last": games[-1]["date"],
                             "leagues": sorted({t["group"] if t["group"] in ("ABA", "BAA") else "NBA" for t in teams.values()})})
