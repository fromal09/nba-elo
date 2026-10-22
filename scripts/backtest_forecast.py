"""
backtest_forecast.py — replay past seasons with the Season Explorer forecast model.

Each game is predicted using only what was known before tipoff:
  - each player's Elo entering the game (pre-game Elo from the explorer data)
  - projected minutes from his previous 10 appearances (8 if he has none),
    filled top-down to 240, max 42 per player
  - the players who actually suited up, standing in for a perfect injury report
Team rating = w * rotation Elo + (1 - w) * top-8 roster Elo, w = n / (n + 4),
n = team games already played that season. Win chance = 1 / (1 + 10^(-(diff + home) / scale)).

Usage (from the repo root, after build_elo.py):
    python3 scripts/backtest_forecast.py              # last two completed seasons
    python3 scripts/backtest_forecast.py 2021-22 2025-26
"""
import json, math, sys
from collections import defaultdict, deque
from pathlib import Path

DIR = Path("public/data/explorer")
SCALE, HOME, K, MAX_MIN, ROOKIE_MIN = 450, 44, 4, 42, 8   # same as the site (2020+ fit)


def seasons_to_test():
    have = sorted(p.stem for p in DIR.glob("[0-9][0-9][0-9][0-9]-[0-9][0-9].json"))
    if len(sys.argv) == 3:
        a, b = sys.argv[1], sys.argv[2]
        test = [s for s in have if a <= s <= b]
    else:
        test = have[-3:-1]  # the newest season is in progress: skip it
    i = have.index(test[0])
    warm = have[i - 1] if i > 0 else None  # one season before, to seed recent minutes
    return warm, test


def team_rating(ps, ix, recent, n):
    pl = []
    for r in ps:
        q = [m for m in recent[r[ix["n"]]] if m is not None]
        pl.append((r[ix["pre"]], (sum(q) / len(q)) if q else ROOKIE_MIN))
    pl.sort(key=lambda x: -x[1])
    total, left, mins = sum(b for _, b in pl), 240, []
    if total >= 240:
        for e, b in pl:
            m = min(b, MAX_MIN, left); left -= m; mins.append((e, m))
    else:
        mins = [(e, min(MAX_MIN, b * 240 / total)) for e, b in pl]
    M = sum(m for _, m in mins) or 1
    rot = sum(e * m for e, m in mins) / M
    top8 = sorted((e for e, _ in pl), reverse=True)[:8]
    raw = sum(top8) / len(top8)
    w = n / (n + K)
    return w * rot + (1 - w) * raw


def main():
    warm, test = seasons_to_test()
    recent = defaultdict(lambda: deque(maxlen=10))
    results = []  # (season, games_played_both, p_for_team_a, a_won)
    for lab in ([warm] if warm else []) + test:
        d = json.loads((DIR / f"{lab}.json").read_text())
        C = d["cols"]; ix = {k: C.index(k) for k in ("n", "t", "mp", "pre")}
        gp = defaultdict(int)
        for g in d["games"]:
            if g["post"]:
                continue
            a, b = g["teams"]
            if lab in test:
                ra = team_rating([r for r in g["rows"] if r[ix["t"]] == a], ix, recent, gp[a])
                rb = team_rating([r for r in g["rows"] if r[ix["t"]] == b], ix, recent, gp[b])
                h = 0 if not g["home"] else (1 if g["home"] == a else -1)
                p = 1 / (1 + 10 ** (-(ra - rb + HOME * h) / SCALE))
                results.append((lab, max(gp[a], gp[b]), p, 1 if g["pts"][0] > g["pts"][1] else 0))
            gp[a] += 1; gp[b] += 1
            for r in g["rows"]:
                recent[r[ix["n"]]].append(r[ix["mp"]])

    def summary(rows, label):
        n = len(rows)
        acc = sum((p > .5) == bool(y) for _, _, p, y in rows) / n
        brier = sum((p - y) ** 2 for _, _, p, y in rows) / n
        print(f"\n{label}: {n:,} games")
        print(f"  Picked the winner: {acc:.1%}    Brier score: {brier:.4f} (0.25 = coin flip)")
        print("  Calibration (favorite's forecast -> how often the favorite won):")
        for lo, hi in [(.5, .6), (.6, .7), (.7, .8), (.8, 1.01)]:
            sel = [(max(p, 1 - p), y if p >= .5 else 1 - y) for _, _, p, y in rows if lo <= max(p, 1 - p) < hi]
            if sel:
                f = sum(x for x, _ in sel) / len(sel); w = sum(y for _, y in sel) / len(sel)
                print(f"    {int(lo*100)}–{min(100, int(hi*100))}%: forecast {f:.0%}, won {w:.0%}  ({len(sel):,} games)")

    summary(results, f"All regular-season games, {test[0]} to {test[-1]}")
    summary([r for r in results if r[1] < 10], "Early season (both teams under 10 games)")


if __name__ == "__main__":
    main()
