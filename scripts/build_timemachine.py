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

Run after build_elo.py:  python3 scripts/build_timemachine.py
"""
import json, statistics as st
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "public" / "data" / "explorer"
COLS = ["s", "t", "name", "color", "w", "l", "champ", "lg", "movz", "eloz", "mov", "elo"]
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
    for f in files:
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
                             round(mm[t], 1), round(em[t])])
        for gs in logs.values():
            for gm in gs:
                seen_players.update(r[0] for r in gm[5])
    out = {"cols": COLS, "teams": rows, "leagues": leagues}
    (EXP / "timemachine.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  Time Machine: {len(rows)} team-seasons across {len(leagues)} league-seasons")


if __name__ == "__main__":
    main()
