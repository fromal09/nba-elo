"""
build_draft.py — player-season pool for the Time Machine draft.

Reads the Season Explorer files and timemachine.json (run build_timemachine.py first) and writes
public/data/explorer/draft.json:

  {"cols": [...], "rows": [[...], ...], "coef": {"movz": [a, b_elo, b_gs], "eloz": [a, b_elo, b_gs]}}

One row per player per team-season (10+ games, 150+ minutes) with his per-game line and two
era-adjusted scores, each a z-score against every player in that league-season, weighted by minutes:
  ez  season-average Elo
  gz  Game Score per 36 minutes
Small leagues are pulled toward average, as for teams.

pos is PG, SG, SF, PF or C, inferred from each player's role on his real team (see assign_positions);
the data lists positions only for recent seasons, and those decide the guard/forward/center group.
Era deflation for early seasons is applied on the site, so it can be switched off.

coef turns a drafted roster into team z-scores: for every real team-season, the minutes-weighted
average of its players' ez and gz is fitted against the team's own margin (movz) and lineup Elo
(eloz) z-scores. A real roster rebuilt in the draft lands close to its real team rating.
"""
import json, math, statistics as st
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "public" / "data" / "explorer"
COLS = ["s", "t", "n", "gp", "mp", "pts", "trb", "ast", "stl", "blk", "gs", "ez", "gz", "lg", "pos"]
POS = ["PG", "SG", "SF", "PF", "C"]


def league_of(code, group):
    if code.endswith("@ABA") or group == "ABA":
        return "ABA"
    return "BAA" if group == "BAA" else "NBA"


def shrink(n):
    return min(1.0, (n - 1) / 14)


def wz(vals, weights):
    tw = sum(weights) or 1
    mu = sum(v * w for v, w in zip(vals, weights)) / tw
    var = sum(w * (v - mu) ** 2 for v, w in zip(vals, weights)) / tw
    return mu, math.sqrt(var) or 1


def solve3(X, y):
    """Least squares for y ≈ a + b1 x1 + b2 x2."""
    n = len(y)
    S = [[0.0] * 3 for _ in range(3)]
    v = [0.0] * 3
    for (x1, x2), t in zip(X, y):
        r = (1.0, x1, x2)
        for i in range(3):
            v[i] += r[i] * t
            for j in range(3):
                S[i][j] += r[i] * r[j]
    # Gaussian elimination
    M = [S[i] + [v[i]] for i in range(3)]
    for c in range(3):
        p = max(range(c, 3), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        for r in range(3):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [a - f * b for a, b in zip(M[r], M[c])]
    return [M[i][3] / M[i][i] for i in range(3)]


def main():
    tm = json.loads((EXP / "timemachine.json").read_text(encoding="utf-8"))
    TC = tm["cols"]
    team_z = {(r[TC.index("s")], r[TC.index("t")]): (r[TC.index("movz")], r[TC.index("eloz")])
              for r in tm["teams"] if not r[TC.index("live")]}
    n_teams = {k: v["n"] for k, v in tm["leagues"].items()}
    rows, fit_X, fit_m, fit_e = [], [], [], []
    groups = []   # one list per league-season, for positions
    for f in sorted(EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        C = d["cols"]
        ix = {k: C.index(k) for k in ["n", "t", "mp", "pts", "trb", "ast", "stl", "blk", "gs", "pre", "fga", "tpa", "pos"]}
        teams = d["teams"]
        acc = {}
        for g in d["games"]:
            if g.get("post"):
                continue
            for r in g["rows"]:
                k = (r[ix["t"]], r[ix["n"]])
                a = acc.setdefault(k, {"gp": 0, "mp": 0, "mpn": 0, "gsm": 0, "pts": 0, "trb": 0, "ast": 0, "stl": 0, "blk": 0,
                                       "gs": 0, "elo": 0, "fga": 0, "tpa": 0, "has": set(), "pl": Counter()})
                a["gp"] += 1
                if r[ix["mp"]] is not None:
                    # per-36 only from games that kept minutes
                    a["mp"] += r[ix["mp"]]; a["mpn"] += 1; a["gsm"] += r[ix["gs"]] or 0
                if r[ix["pos"]]:
                    a["pl"][r[ix["pos"]][0]] += 1   # listed position's first letter: G, F or C
                for s_ in ["pts", "trb", "ast", "stl", "blk", "gs", "fga", "tpa"]:
                    if r[ix[s_]] is not None:
                        a[s_] += r[ix[s_]]; a["has"].add(s_)
                a["elo"] += r[ix["pre"]]
        by_league = {}
        for (t, n), a in acc.items():
            if t not in teams:
                continue
            L = league_of(t, teams[t].get("group", ""))
            by_league.setdefault(L, []).append((t, n, a))
        for L, items in by_league.items():
            key = f"{d['season']}|{L}"
            if key not in n_teams:
                continue
            k = shrink(n_teams[key])
            # Minutes when kept, otherwise games as the weight; per-36 needs minutes
            # Minutes count when kept in most of his games; otherwise games stand in for minutes
            for _, _, a in items:
                a["permin"] = a["mpn"] >= 0.8 * a["gp"] and a["mp"] > 0
            use = [(t, n, a) for t, n, a in items if a["gp"] >= 10 and (a["mp"] >= 150 if a["permin"] else True)]
            if len(use) < 20:
                continue
            wts = [a["mp"] / a["mpn"] * a["gp"] if a["permin"] else a["gp"] * 24 for _, _, a in use]
            elo = [a["elo"] / a["gp"] for _, _, a in use]
            g36 = [(a["gsm"] / a["mp"] * 36) if a["permin"] else a["gs"] / a["gp"] * 36 / 24 for _, _, a in use]
            emu, esd = wz(elo, wts)
            gmu, gsd = wz(g36, wts)
            # Positions from the stat profile, a fifth of the league's minutes at each
            def p36(a, k_):
                if k_ not in a["has"]:
                    return None
                return a[k_] / (a["mp"] / a["mpn"] * a["gp"]) * 36 if a["permin"] else a[k_] / a["gp"]
            def zs(vals):
                ok = [(v, w) for v, w in zip(vals, wts) if v is not None]
                if len(ok) < 10:
                    return [0.0] * len(vals)
                mu, sd = wz([v for v, _ in ok], [w for _, w in ok])
                return [0.0 if v is None else (v - mu) / sd for v in vals]
            zr = zs([p36(a, "trb") for _, _, a in use])
            zb = zs([p36(a, "blk") for _, _, a in use])
            za = zs([p36(a, "ast") for _, _, a in use])
            zt = zs([p36(a, "stl") for _, _, a in use])
            zp = zs([p36(a, "pts") for _, _, a in use])
            z3 = zs([a["tpa"] / a["fga"] if "tpa" in a["has"] and a["fga"] else None for _, _, a in use])
            feat_keys = [k_ for k_, ok in (("blk", "blk"), ("stl", "stl"), ("tpa", "tpa"))
                         if sum(1 for _, _, a in use if ok in a["has"]) >= len(use) / 2]
            team_feat = {}
            group_rows = []
            for idx, ((t, n, a), w, e, g) in enumerate(zip(use, wts, elo, g36)):
                ez, gz = (e - emu) / esd * k, (g - gmu) / gsd * k
                gp = a["gp"]
                per = lambda s_: round(a[s_] / gp, 1) if s_ in a["has"] else None
                rows.append([d["season"], t, n, gp, round(a["mp"] / a["mpn"], 1) if a["permin"] else None,
                             per("pts"), per("trb"), per("ast"), per("stl"), per("blk"), per("gs"),
                             round(ez, 3), round(gz, 3), L, None])
                label = a["pl"].most_common(1)[0][0] if a["pl"] else None
                group_rows.append({"row": rows[-1], "w": w, "f": {"trb": zr[idx], "ast": za[idx], "blk": zb[idx], "stl": zt[idx], "tpa": z3[idx], "pts": zp[idx]},
                                   "keys": tuple(feat_keys), "label": label if label in ("G", "F", "C") else None})
                tf = team_feat.setdefault(t, [0.0, 0.0, 0.0])
                tf[0] += w * ez; tf[1] += w * gz; tf[2] += w
            groups.append(group_rows)
            for t, (se, sg, sw) in team_feat.items():
                z = team_z.get((d["season"], t))
                if z and sw:
                    fit_X.append((se / sw, sg / sw)); fit_m.append(z[0]); fit_e.append(z[1])
    acc_note = assign_positions(groups)
    coef = {"movz": [round(c, 4) for c in solve3(fit_X, fit_m)], "eloz": [round(c, 4) for c in solve3(fit_X, fit_e)]}
    # How well a real roster's players reproduce its own team rating
    pred = [coef["movz"][0] + coef["movz"][1] * a + coef["movz"][2] * b for a, b in fit_X]
    r = st.correlation(pred, fit_m) if len(pred) > 2 else 0
    out = {"cols": COLS, "rows": rows, "coef": coef}
    (EXP / "draft.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  Draft pool: {len(rows):,} player-seasons · team fit r = {r:.2f} on {len(fit_X):,} team-seasons · positions {acc_note}")


def assign_positions(groups):
    """Positions within each real team: a rotation has a center, two forwards and two guards, so each
    team's players are ranked by size, z(rebounds/36) + ½ z(blocks/36) − ⅓ z(assists/36) against the
    league. The biggest fifth of the team's minutes play C, the next fifth PF, then SF; the rest are
    guards, split into PG and SG by assists. Where a season lists positions (G, F, C), those decide the
    group and size only orders players inside it."""
    def size(x):
        f = x["f"]
        if f["trb"] == 0 and f["blk"] == 0:   # no rebounds kept (the BAA years): scorers who don't pass are the bigs
            return 0.5 * f["pts"] - f["ast"]
        return f["trb"] + 0.5 * f["blk"] - f["ast"] / 3
    listed = 0
    for g in groups:
        by_team = {}
        for x in g:
            by_team.setdefault(x["row"][1], []).append(x)
        for mem in by_team.values():
            tot = sum(x["w"] for x in mem) or 1
            if all(x["label"] for x in mem):
                listed += len(mem)
                cls = {id(x): x["label"] for x in mem}
            else:
                cls, cum = {}, 0.0
                for x in sorted(mem, key=lambda x: -size(x)):
                    share = (cum + x["w"] / 2) / tot
                    cum += x["w"]
                    cls[id(x)] = "C" if share < 0.2 else "F" if share < 0.6 else "G"
            for c, key, hi, lo in (("F", size, "PF", "SF"), ("G", lambda x: x["f"]["ast"], "PG", "SG")):
                grp = sorted([x for x in mem if cls[id(x)] == c], key=lambda x: -key(x))
                gt = sum(x["w"] for x in grp) or 1
                cum = 0.0
                for x in grp:
                    x["row"][-1] = hi if (cum + x["w"] / 2) / gt < 0.5 else lo
                    cum += x["w"]
            for x in mem:
                if cls[id(x)] == "C":
                    x["row"][-1] = "C"
    return f"from team roles ({listed:,} from listed positions)"


if __name__ == "__main__":
    main()
