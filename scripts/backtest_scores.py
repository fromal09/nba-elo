"""
backtest_scores.py — walk-forward test of projected scores, and of possible improvements.

For every regular-season game from 2021-22 on, using only what was known before tip:
  base     margin = a + b × lineup Elo gap; total = each team's offense + opponent's defense
           (this season blended with last, counted as K games) relative to the league
  +net     margin also uses the gap in each team's point differential (same blending)
  +rest    back-to-backs (played the day before) for each side, in margin and total
  +recency team rates weight recent games more (half-life H games)
Every coefficient is fitted on earlier seasons only (2020-21 on), then tested on the next season.

Elo: "played" = lineup Elo of the players who actually played (knows who sat out, a bit
optimistic); "prev" = each team's lineup Elo after its previous game (knows nothing about tonight).
The site's forecast (projected minutes + injury report) sits between the two.

Run:  python3 scripts/backtest_scores.py
"""
import json, statistics as st
from datetime import date
from pathlib import Path
import numpy as np

EXP = Path(__file__).resolve().parent.parent / "public" / "data" / "explorer"


def lineup(rows, it, ip, imp, t):
    ps = [r for r in rows if r[it] == t]
    m = sum(r[imp] or 0 for r in ps)
    return sum(r[ip] * (r[imp] or 0) for r in ps) / m if m else st.mean(r[ip] for r in ps)


def load():
    files = [f for f in sorted(EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json")) if int(f.stem[:4]) >= 2019]
    seasons, last = [], {}
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        C = d["cols"]
        it, ipre, ipost, imp = C.index("t"), C.index("pre"), C.index("post"), C.index("mp")
        gs = []
        for g in sorted(d["games"], key=lambda g: g["date"]):
            if not g.get("home"):
                continue
            h = g["home"]; a = [t for t in g["teams"] if t != h][0]
            ph, pa = (g["pts"][0], g["pts"][1]) if g["teams"][0] == h else (g["pts"][1], g["pts"][0])
            lh, la = lineup(g["rows"], it, ipre, imp, h), lineup(g["rows"], it, ipre, imp, a)
            if not g.get("post"):
                gs.append({"date": g["date"], "h": h, "a": a, "ph": ph, "pa": pa,
                           "played": lh - la, "prev": last.get(h, lh) - last.get(a, la)})
            for t in (h, a):
                last[t] = lineup(g["rows"], it, ipost, imp, t)
        if len(gs) > 500:
            seasons.append((int(f.stem[:4]), gs))
    return seasons


def features(seasons, K=10, H=None, LGW=50):
    """Pre-game features for every game: blended offense/defense/net per team, league level, rest."""
    prev_rates, out = None, []
    for sy, gs in seasons:
        hist, last_day, n_pts, n = {}, {}, 0, 0
        plg = prev_rates["lg"] if prev_rates else 112
        rows = []
        for g in gs:
            w = n / (n + LGW) if n else 0
            lg = w * n_pts / n + (1 - w) * plg if n else plg
            def rate(t):
                pr = prev_rates["teams"].get(t, (plg, plg)) if prev_rates else (plg, plg)
                prior = (pr[0] - plg + lg, pr[1] - plg + lg)
                hs = hist.get(t, [])
                wsum, f_, a_ = K, K * prior[0], K * prior[1]
                for k, (pf, pa) in enumerate(reversed(hs)):
                    wk = 0.5 ** (k / H) if H else 1.0
                    wsum += wk; f_ += wk * pf; a_ += wk * pa
                return f_ / wsum, a_ / wsum
            oh, dh = rate(g["h"]); oa, da = rate(g["a"])
            day = date.fromisoformat(g["date"])
            b2b = lambda t: 1.0 if t in last_day and (day - last_day[t]).days == 1 else 0.0
            rows.append({**g, "lg": lg, "tot": oh + da + oa + dh - 2 * lg, "net": (oh - dh) - (oa - da),
                         "b2b_h": b2b(g["h"]), "b2b_a": b2b(g["a"]), "sy": sy})
            for t, f_, a_ in ((g["h"], g["ph"], g["pa"]), (g["a"], g["pa"], g["ph"])):
                hist.setdefault(t, []).append((f_, a_)); last_day[t] = day
            n += 2; n_pts += g["ph"] + g["pa"]
        tr = {}
        for g in gs:
            for t, f_, a_ in ((g["h"], g["ph"], g["pa"]), (g["a"], g["pa"], g["ph"])):
                x = tr.setdefault(t, [0, 0, 0]); x[0] += 1; x[1] += f_; x[2] += a_
        prev_rates = {"lg": n_pts / n, "teams": {t: (x[1] / x[0], x[2] / x[0]) for t, x in tr.items()}}
        out.append((sy, rows))
    return out


def evaluate(feat, elo="played", net=False, rest=False):
    res = {"m": [], "t": [], "s": [], "hit": [], "pm": [], "am": []}
    for i, (sy, rows) in enumerate(feat):
        if sy < 2021:
            continue
        train = [r for s2, rs in feat[:i] if s2 >= 2020 for r in rs]
        def Xm(r):
            x = [1.0, r[elo]]
            if net: x.append(r["net"])
            if rest: x += [r["b2b_h"], r["b2b_a"]]
            return x
        def Xt(r):
            x = [1.0, r["tot"]]
            if rest: x.append(r["b2b_h"] + r["b2b_a"])
            return x
        bm, *_ = np.linalg.lstsq(np.array([Xm(r) for r in train]), np.array([r["ph"] - r["pa"] for r in train]), rcond=None)
        # total: the rates already estimate it; the fit only adds rest (slope pinned at 1, no intercept)
        bt = None
        if rest:
            Xr = np.array([[r["b2b_h"] + r["b2b_a"]] for r in train]); yr = np.array([r["ph"] + r["pa"] - r["tot"] for r in train])
            bt, *_ = np.linalg.lstsq(Xr, yr, rcond=None)
        for r in rows:
            margin = float(np.dot(Xm(r), bm))
            total = r["tot"] + (float(bt[0]) * (r["b2b_h"] + r["b2b_a"]) if bt is not None else 0)
            ph, pa = total / 2 + margin / 2, total / 2 - margin / 2
            am = r["ph"] - r["pa"]
            res["m"].append(abs(margin - am)); res["t"].append(abs(total - (r["ph"] + r["pa"])))
            res["s"].append((abs(ph - r["ph"]) + abs(pa - r["pa"])) / 2)
            if am: res["hit"].append((margin > 0) == (am > 0))
            res["pm"].append(margin); res["am"].append(am)
        last_coef = (bm, bt)
    pm, amv = np.array(res["pm"]), np.array(res["am"])
    slope = float(np.polyfit(pm, amv, 1)[0])
    return {"margin": np.mean(res["m"]), "total": np.mean(res["t"]), "team": np.mean(res["s"]),
            "winner": np.mean(res["hit"]), "slope": slope, "n": len(res["m"]), "coef": last_coef}


def main():
    seasons = load()
    print(f"Seasons {[s for s, _ in seasons]}, tested 2021-22 on\n")
    print(f"{'':34}{'margin':>8}{'total':>8}{'team':>7}{'winner':>8}{'slope':>7}")
    for elo in ("played", "prev"):
        for label, H, net, rest in (("base", None, False, False), ("+net", None, True, False), ("+rest", None, False, True),
                                    ("+recency H=15", 15, False, False), ("+recency H=30", 30, False, False),
                                    ("+net +rest +recency H=15", 15, True, True), ("+net +rest +recency H=30", 30, True, True)):
            f = features(seasons, H=H)
            r = evaluate(f, elo, net, rest)
            print(f"[{elo:6}] {label:26}{r['margin']:8.2f}{r['total']:8.2f}{r['team']:7.2f}{r['winner']:8.1%}{r['slope']:7.2f}")
        print()
    f = features(seasons, H=30)
    r = evaluate(f, "prev", True, True)
    print("Last fold coefficients (margin: const, elo, net, b2b home, b2b away; total: b2b per team):", np.round(r["coef"][0], 4), np.round(r["coef"][1], 3))


if __name__ == "__main__":
    main()
