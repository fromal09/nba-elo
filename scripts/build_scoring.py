"""
build_scoring.py — what the site needs to project scores, written to public/data/explorer/scoring.json:

  {"season", "margin": [const, per Elo, per point of net, home back-to-back, away back-to-back], "sigma",
   "total_b2b": points per team on a back-to-back, "league": ppg,
   "teams": {code: [offense, defense]}}   points scored / allowed per game, blended

Margin (home minus away) = const + per Elo × (home forecast rating − away) + per net × (home net −
away net) + the back-to-back terms. Total = each team's offense + the other's defense − 2 × league.
Fitted on every regular-season game since 2020-21 (scripts/backtest_scores.py tests it walk-forward).

Win chance = Φ(margin / sigma), sigma the spread of actual margins around the projection, so the
site's win percentages, projected scores and playoff odds all come from one model.

Team rates: this season's games weighted toward recent ones (half-life 15 games), plus last
season counted as 10 games and shifted to this season's league level.

Run after build_elo.py:  python3 scripts/build_scoring.py
"""
import json, sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backtest_scores import EXP, load, features   # noqa: E402

K, H, LGW = 10, 15, 50


def season_games(f):
    d = json.loads(f.read_text(encoding="utf-8"))
    out = []
    for g in sorted(d["games"], key=lambda g: g["date"]):
        if g.get("post") or not g.get("home"):
            continue
        h = g["home"]; a = [t for t in g["teams"] if t != h][0]
        ph, pa = (g["pts"][0], g["pts"][1]) if g["teams"][0] == h else (g["pts"][1], g["pts"][0])
        out.append((h, a, ph, pa))
    return d["season"], out


def main():
    feat = features(load(), K=K, H=H, LGW=LGW)
    train = [r for sy, rs in feat if sy >= 2020 for r in rs]
    X = np.array([[1.0, r["played"], r["net"], r["b2b_h"], r["b2b_a"]] for r in train])
    y = np.array([r["ph"] - r["pa"] for r in train])
    bm, *_ = np.linalg.lstsq(X, y, rcond=None)
    sigma = float(np.std(y - X @ bm))   # spread of actual margins around the projection: win chance = Φ(margin / sigma)
    Xr = np.array([[r["b2b_h"] + r["b2b_a"]] for r in train])
    bt, *_ = np.linalg.lstsq(Xr, np.array([r["ph"] + r["pa"] - r["tot"] for r in train]), rcond=None)

    # Current team rates, as of the latest game in the data
    files = sorted(EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json"))
    season, cur = season_games(files[-1])
    _, prev = season_games(files[-2])
    pt = {}
    for h, a, ph, pa in prev:
        for t, f_, a_ in ((h, ph, pa), (a, pa, ph)):
            x = pt.setdefault(t, [0, 0, 0]); x[0] += 1; x[1] += f_; x[2] += a_
    plg = sum(x[1] for x in pt.values()) / max(1, sum(x[0] for x in pt.values()))
    n = 2 * len(cur)
    clg = sum(ph + pa for _, _, ph, pa in cur) / n if n else plg
    w = n / (n + LGW)
    lg = w * clg + (1 - w) * plg
    hist = {}
    for h, a, ph, pa in cur:
        hist.setdefault(h, []).append((ph, pa)); hist.setdefault(a, []).append((pa, ph))
    teams = {}
    for t in set(pt) | set(hist):
        p = pt.get(t)
        prior = (p[1] / p[0] - plg + lg, p[2] / p[0] - plg + lg) if p else (lg, lg)
        ws, of, df = K, K * prior[0], K * prior[1]
        for k, (f_, a_) in enumerate(reversed(hist.get(t, []))):
            wk = 0.5 ** (k / H)
            ws += wk; of += wk * f_; df += wk * a_
        teams[t] = [round(of / ws, 2), round(df / ws, 2)]
    out = {"season": season, "margin": [round(float(c), 5) for c in bm], "sigma": round(sigma, 3), "total_b2b": round(float(bt[0]), 3),
           "league": round(lg, 2), "teams": teams}
    (EXP / "scoring.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    c = out["margin"]
    print(f"  Scoring: home court {c[0]:.2f} pts, {c[1] * 100:.2f} pts per 100 Elo, {c[2]:.2f} per point of net, "
          f"back-to-back {c[3]:+.2f} home / {c[4]:+.2f} away, total {out['total_b2b']:+.2f} per tired team, sigma {sigma:.2f}; league {lg:.1f}")


if __name__ == "__main__":
    main()
