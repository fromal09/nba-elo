"""
build_timemachine.py — team-season catalog for the Time Machine.

Reads the Season Explorer files (public/data/explorer/<season>.json) and writes
public/data/explorer/timemachine.json:

  {"cols": [...], "teams": [[...], ...], "leagues": {"1970-71|NBA": {"n": 17, "ppg": 112.4}, ...}}

One row per team-season with 40+ regular-season games. Each team is measured against its own
league that season (NBA, ABA or BAA), so every era lands on one scale:
  movz  margin of victory z-score
  eloz  season-average lineup Elo (pre-game, minutes-weighted) z-score
The site turns these into ratings (Results, Blend or Player Elo) and shrinks small leagues.

Also writes one game log per team-season, public/data/explorer/tm/<year><code>.json ('@' becomes '_'):
  {"cols": [...], "rk": [rookies], "games": [[date, opp, home, us, them, [[player row], ...]], ...]}
Simulated games borrow these lines for box scores and season stats.

The newest season's teams join before they reach 40 games, marked live ("In progress"):
  rating  current rotation Elo (recent minutes × current Elo, the game forecaster's view) as the
          Player Elo z-score; Results blends this season's margin in as games are played
  lines   synthetic games built from each rotation player's own recent games (either season),
          scaled so the team plays 240 minutes

Run after build_elo.py:  python3 scripts/build_timemachine.py
"""
import json, statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "public" / "data" / "explorer"
COLS = ["s", "t", "name", "color", "w", "l", "champ", "lg", "movz", "eloz", "mov", "elo", "live"]
LINE = ["n", "mp", "pts", "fg", "fga", "tp", "tpa", "ft", "fta", "orb", "drb", "trb", "ast", "stl", "blk", "tov", "pf", "gs"]


def league_of(code, group):
    if code.endswith("@ABA") or group == "ABA":
        return "ABA"
    return "BAA" if group == "BAA" else "NBA"


def main():
    rows, leagues = [], {}
    files = sorted(p for p in EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json"))
    tm_dir = EXP / "tm"
    tm_dir.mkdir(exist_ok=True)
    seen_players = set()   # anyone seen in an earlier season is not a rookie
    before_newest = set()
    for f in files:
        if f == files[-1]:
            before_newest = set(seen_players)
        d = json.loads(f.read_text(encoding="utf-8"))
        C = d["cols"]
        li = [C.index(k) for k in LINE]
        logs = {}
        it, ipre, imp, ipts = C.index("t"), C.index("pre"), C.index("mp"), C.index("pts")
        teams = d["teams"]
        lg = {t: league_of(t, v.get("group", "")) for t, v in teams.items()}
        elo, mov, pts = {}, {}, {}
        champ = {}
        for g in d["games"]:
            a, b = g["teams"]
            pa, pb = g["pts"]
            if g.get("post"):
                # The last postseason game in each league crowns its champion
                champ[lg.get(a, "NBA")] = a if pa > pb else b
                continue
            for t, us, them in ((a, pa, pb), (b, pb, pa)):
                ps = [r for r in g["rows"] if r[it] == t]
                if not ps:
                    continue
                opp = b if t == a else a
                logs.setdefault(t, []).append([g["date"], opp, 1 if g.get("home") == t else 0, us, them,
                                               [[r[i] for i in li] for r in ps]])
                m = sum(r[imp] or 0 for r in ps)
                v = sum(r[ipre] * (r[imp] or 0) for r in ps) / m if m else st.mean(r[ipre] for r in ps)
                elo.setdefault(t, []).append(v)
                mov.setdefault(t, []).append(us - them)
                pts.setdefault(t, []).append(us)
        for L in set(lg.values()):
            ts = [t for t in teams if lg[t] == L and len(mov.get(t, [])) >= 40]
            if len(ts) < 4:
                continue
            em = {t: st.mean(elo[t]) for t in ts}
            mm = {t: st.mean(mov[t]) for t in ts}
            esd, msd = st.pstdev(em.values()) or 1, st.pstdev(mm.values()) or 1
            emu, mmu = st.mean(em.values()), st.mean(mm.values())
            leagues[f"{d['season']}|{L}"] = {"n": len(ts), "ppg": round(st.mean(p for t in ts for p in pts[t]), 1)}
            for t in ts:
                v = teams[t]
                names = {r[0] for gm in logs.get(t, []) for r in gm[5]}
                tm = {"cols": LINE, "rk": sorted(names - seen_players), "games": logs.get(t, [])}
                (tm_dir / f"{d['season'][:4]}{t.replace('@', '_')}.json").write_text(
                    json.dumps(tm, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                rows.append([d["season"], t, v["name"], v.get("color") or "#555555", v["w"], v["l"],
                             1 if champ.get(L) == t else 0, L,
                             round((mm[t] - mmu) / msd, 3), round((em[t] - emu) / esd, 3),
                             round(mm[t], 1), round(em[t]), 0])
        for gs in logs.values():
            for gm in gs:
                seen_players.update(r[0] for r in gm[5])
    live_teams(files, rows, leagues, tm_dir, before_newest)
    out = {"cols": COLS, "teams": rows, "leagues": leagues}
    (EXP / "timemachine.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  Time Machine: {len(rows)} team-seasons across {len(leagues)} league-seasons")


def live_teams(files, rows, leagues, tm_dir, seen_before):
    """Newest-season teams with fewer than 40 games: rated from current rosters, lines from recent games."""
    if len(files) < 2:
        return
    cur = json.loads(files[-1].read_text(encoding="utf-8"))
    prev = json.loads(files[-2].read_text(encoding="utf-8"))
    season = cur["season"]
    done = {r[1] for r in rows if r[0] == season}
    rot_p, elo_p = EXP / "rotation.json", ROOT / "public" / "data" / "elo.json"
    if not rot_p.exists() or not elo_p.exists():
        return
    rot = json.loads(rot_p.read_text(encoding="utf-8"))
    elo = {p["name"]: p["current_elo"] for p in json.loads(elo_p.read_text(encoding="utf-8"))["players"]}
    through = rot.get("through") or max(g["date"] for g in prev["games"])
    # Every player's recent regular-season lines, newest last, from the last two seasons
    recent = {}
    for d in (prev, cur):
        C = d["cols"]
        li, it = [C.index(k) for k in LINE], C.index("t")
        for g in d["games"]:
            if g.get("post"):
                continue
            for r in g["rows"]:
                recent.setdefault(r[0], []).append([r[i] for i in li])
    # Team pool: NBA teams of the previous season (names and colors), current record where played
    nba = {t: v for t, v in prev["teams"].items() if league_of(t, v.get("group", "")) == "NBA"}
    rec = {t: (v["w"], v["l"]) for t, v in cur["teams"].items()}
    mov = {}
    for g in cur["games"]:
        if g.get("post"):
            continue
        a, b = g["teams"]
        mov.setdefault(a, []).append(g["pts"][0] - g["pts"][1])
        mov.setdefault(b, []).append(g["pts"][1] - g["pts"][0])
    cutoff = f"{int(through[:4]) - 1}{through[4:]}"
    roster = {}
    for n, v in rot.get("players", {}).items():
        if v.get("team") in nba and v.get("mp", 0) >= 8 and v.get("last", "") >= cutoff and n in recent:
            roster.setdefault(v["team"], []).append((n, v["mp"]))
    proj = {}
    for t, ps in roster.items():
        ps.sort(key=lambda x: -x[1])
        left, tot, acc = 240, 0, 0
        for n, mp in ps:
            m = min(mp, 42, left)
            left -= m; tot += m; acc += m * elo.get(n, 1500)
        if tot:
            proj[t] = acc / tot
    if len(proj) < 10:
        return
    mu, sd = st.mean(proj.values()), st.pstdev(proj.values()) or 1
    msd = 5.0  # margin SD of a typical modern season, for this season's small samples
    ppg = leagues.get(f"{prev['season']}|NBA", {}).get("ppg", 112)
    leagues.setdefault(f"{season}|NBA", {"n": len(proj), "ppg": ppg})
    for t in sorted(proj):
        if t in done:
            continue
        z = (proj[t] - mu) / sd
        n = len(mov.get(t, []))
        act = st.mean(mov[t]) if n else 0.0
        w_ = n / (n + 20)
        movz = w_ * (act / msd) + (1 - w_) * z
        v = cur["teams"].get(t) or nba[t]
        w, l = rec.get(t, (0, 0))
        # Synthetic games: each rotation player's recent lines, cycled, minutes scaled to 240
        ps = roster[t][:11]
        games = []
        for k in range(82):
            lines = []
            for j, (n_, _) in enumerate(ps):
                hist = recent[n_][-40:]
                lines.append(list(hist[(k * 7 + j * 3) % len(hist)]))
            mins = sum(x[1] or 0 for x in lines)
            f = 240 / mins if mins else 1
            for x in lines:
                for i in range(1, len(LINE)):
                    if x[i] is not None:
                        x[i] = round(x[i] * f) if LINE[i] != "gs" else round(x[i] * f, 1)
            us = sum(x[2] or 0 for x in lines)
            games.append([through, "", k % 2, us, us + (1 if k % 2 else -1), lines])
        tm = {"cols": LINE, "rk": sorted({n_ for n_, _ in ps} - seen_before), "games": games, "synthetic": True}
        (tm_dir / f"{season[:4]}{t}.json").write_text(json.dumps(tm, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        rows.append([season, t, v["name"], v.get("color") or "#555555", w, l, 0, "NBA",
                     round(movz, 3), round(z, 3), round(act, 1), round(proj[t]), 1])


if __name__ == "__main__":
    main()
