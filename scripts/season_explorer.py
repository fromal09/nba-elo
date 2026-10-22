"""
season_explorer.py — writes the Season Explorer data.

build_elo.py calls record_game() for every game in the export window while the
Elo loop runs (so pre-game Elo is captured, not reconstructed), then write().

Output:
  public/data/explorer/index.json             seasons, team records, roster Elo
  public/data/explorer/<season>/<TEAM>.json   that team's games with full box scores
                                              (both teams), pre/post Elo, pairwise inputs
Player row keys:
  n name, t team, st starter, pos, mp, pts, fg, fga, tp, tpa, ft, fta, orb, drb, trb,
  ast, stl, blk, tov, pf, pm (+/-), gs (Game Score), pre, post (Elo),
  gp (career games before this one, drives K), xw (expected duels won), w (duels won)
"""
import json, math, re, shutil
from collections import defaultdict
from datetime import date
from pathlib import Path

OUT_DIR = Path("public/data/explorer")
SEASONS_KEPT = 2  # current season + the one before

_games = []


def export_from(season_start_year):
    return f"{season_start_year - SEASONS_KEPT + 1}-09-01"


def _season_of(d):
    y, m = int(d[:4]), int(d[5:7])
    y = y if m >= 9 else y - 1
    return f"{y}-{str(y + 1)[-2:]}"


def _num(row, *cols):
    for c in cols:
        if c in row.index:
            v = row[c]
            try:
                f = float(v)
                if math.isnan(f):
                    continue
                return int(f) if f.is_integer() else round(f, 1)
            except (TypeError, ValueError):
                continue
    return None


def _str(row, col):
    if col not in row.index:
        return ""
    v = row[col]
    if hasattr(v, "dropna"):  # duplicate column names (BDL "home_away" + renamed BBRef blank column)
        v = next((x for x in v.dropna() if str(x).strip()), None)
    return "" if v is None or (isinstance(v, float) and math.isnan(v)) else str(v).strip()


def record_game(game_id, date_str, players, rows, team_of, pre, gp, gmsc, post, xw, wins):
    out = []
    for p in players:
        r = rows.get(p)
        if r is None:
            continue
        out.append({
            "n": p, "t": team_of.get(p, ""),
            "st": _str(r, "GS") == "*",
            "pos": _str(r, "Pos.") or _str(r, "Pos"),
            "mp": _num(r, "MP"),
            "pts": _num(r, "PTS"), "fg": _num(r, "FG"), "fga": _num(r, "FGA"),
            "tp": _num(r, "3P"), "tpa": _num(r, "3PA"),
            "ft": _num(r, "FT"), "fta": _num(r, "FTA"),
            "orb": _num(r, "ORB"), "drb": _num(r, "DRB"), "trb": _num(r, "TRB"),
            "ast": _num(r, "AST"), "stl": _num(r, "STL"), "blk": _num(r, "BLK"),
            "tov": _num(r, "TOV"), "pf": _num(r, "PF"),
            "pm": _num(r, "+/-", "#ERROR!"),
            "gs": round(float(gmsc[p]), 1),
            "pre": round(pre[p], 1), "post": round(post[p], 1), "gp": gp[p],
            "xw": round(xw[p], 2), "w": wins[p],
            "_res": _str(r, "Result"), "_ha": _str(r, "home_away"), "_opp": _str(r, "Opp"),
        })
    _games.append({"id": game_id, "date": date_str, "rows": out})


_RES = re.compile(r"([WL]),?\s*(\d+)\s*-\s*(\d+)\s*(\((\d*)OT\))?")


def _game_meta(g):
    teams = sorted({r["t"] for r in g["rows"] if r["t"]})
    if len(teams) != 2:
        return None
    meta = {"teams": teams, "pts": {}, "home": None, "ot": ""}
    for t in teams:
        r = next(r for r in g["rows"] if r["t"] == t)
        m = _RES.search(r["_res"])
        if m:
            meta["pts"][t] = int(m.group(2))
            other = teams[1] if t == teams[0] else teams[0]
            meta["pts"].setdefault(other, int(m.group(3)))
            if m.group(4):
                meta["ot"] = f"{m.group(5) or ''}OT"
    away = {r["t"] for r in g["rows"] if r["_ha"] == "@"}
    if len(away) == 1:
        meta["home"] = teams[1] if teams[0] in away else teams[0]
    if len(meta["pts"]) != 2:
        return None
    return meta


def write(team_names=None):
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    by_season = defaultdict(list)
    for g in _games:
        meta = _game_meta(g)
        if meta:
            g["meta"] = meta
            by_season[_season_of(g["date"])].append(g)

    index = {"generated": date.today().isoformat(), "seasons": []}
    for season in sorted(by_season, reverse=True):
        games = sorted(by_season[season], key=lambda g: (g["date"], g["id"]))

        # Postseason starts after the median team's 82nd game
        team_dates = defaultdict(list)
        for g in games:
            for t in g["meta"]["teams"]:
                team_dates[t].append(g["date"])
        n82 = sorted(ds[81] for ds in team_dates.values() if len(ds) >= 82)
        reg_end = n82[len(n82) // 2] if len(n82) >= 15 else None

        team_games = defaultdict(list)
        rec = defaultdict(lambda: [0, 0, 0, 0])  # w, l, pw, pl
        for g in games:
            m = g["meta"]
            post = bool(reg_end and g["date"] > reg_end)
            rows = [{k: v for k, v in r.items() if not k.startswith("_")} for r in g["rows"]]
            for t in m["teams"]:
                o = m["teams"][1] if t == m["teams"][0] else m["teams"][0]
                won = m["pts"][t] > m["pts"][o]
                r = rec[t]
                i = 2 if post else 0
                r[i if won else i + 1] += 1
                team_games[t].append({
                    "id": g["id"], "date": g["date"], "opp": o,
                    "home": None if m["home"] is None else m["home"] == t,
                    "pts": m["pts"][t], "opp_pts": m["pts"][o], "ot": m["ot"],
                    "res": "W" if won else "L", "post": post,
                    "rec": f"{r[i]}-{r[i + 1]}",
                    "players": rows,
                })

        sdir = OUT_DIR / season
        sdir.mkdir()
        teams_out = {}
        for t, tg in team_games.items():
            # Roster Elo: average latest Elo of the 8 players with the most minutes for t
            mins, last = defaultdict(float), {}
            for g in tg:
                for p in g["players"]:
                    if p["t"] == t:
                        mins[p["n"]] += p["mp"] or 0
                        last[p["n"]] = p["post"]
            top8 = sorted(mins, key=lambda n: -mins[n])[:8]
            r = rec[t]
            teams_out[t] = {
                "w": r[0], "l": r[1], "pw": r[2], "pl": r[3], "gp": len(tg),
                "elo": round(sum(last[n] for n in top8) / len(top8), 1) if top8 else None,
                "last": tg[-1]["date"],
            }
            (sdir / f"{t}.json").write_text(
                json.dumps({"season": season, "team": t, "games": tg}, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8")
        index["seasons"].append({
            "season": season, "games": len(games), "first": games[0]["date"], "last": games[-1]["date"],
            "teams": teams_out,
        })
        print(f"  Explorer {season}: {len(games)} games, {len(teams_out)} teams")

    (OUT_DIR / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
