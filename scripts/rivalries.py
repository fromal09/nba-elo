"""
rivalries.py — head-to-head duel history for every pair of players, built inside the Season Explorer pass.

Every game is a round robin of duels on Game Score (see build_elo.py). For each pair this tracks, by season
and split into opponent and teammate duels: wins, losses, ties, expected wins (from the pre-game duel
chance) and the Elo each player gained from those duels.

Outputs (written by season_explorer.write):
  explorer/rivals/<slug>-<hash>.json   one file per player: {"o": {opp: [...]}, "m": {mate: [...]}}
                                       each value is a flat list of season rows: sy, w, l, t, xw, elo, sy, w, ...
  explorer/rivals_active.json          opponent pairs among recently active players with 10+ duels,
                                       career totals through the latest game: [a, b, aw, bw, t, axw, aelo, belo]
  game["riv"] (in each season file)    the game's notable opposing pairs going into it (longest history and
                                       furthest from expectation): [a, b, aw, bw, t, axw, aelo, belo]
"""
import json, math, re, unicodedata
from collections import defaultdict
from pathlib import Path

_car = {}                   # (a, b), a < b -> opponent career totals [aw, bw, t, axw, aelo, belo]
_splits = defaultdict(list)  # (a, b) -> [(sy, kind, aw, bw, t, axw, aelo, belo), ...]
LOG20 = math.log1p(20)
MIN_LONG, MIN_LOPSIDED = 5, 20


def reset():
    _car.clear(); _splits.clear()


def _k(n):
    return 40 if n < 20 else 50 if n < 100 else 28


def process_season(sy, games):
    """games: one season's games in date order, rows in explorer COLS order (n, t, ..., gs 21, pre 22, gp 24).
    Sets game["riv"] from the history going in, then adds the game's duels."""
    season = {}
    for g in games:
        rows = g["rows"]
        N = len(rows)
        if N < 2:
            g["riv"] = []
            continue
        sq = math.sqrt(N)
        cands, pending = [], []
        for i in range(N):
            ri = rows[i]
            for j in range(i + 1, N):
                rj = rows[j]
                x, y = (ri, rj) if ri[0] < rj[0] else (rj, ri)
                key = (x[0], y[0])
                opp = x[1] != y[1]
                ex = 1 / (1 + 10 ** ((y[22] - x[22]) / 620))
                gx, gy = x[21], y[21]
                act = 1.0 if gx > gy else 0.5 if gx == gy else 0.0
                mf = math.log1p(abs(gx - gy)) / LOG20
                mf = 0.5 if mf < 0.5 else 2.0 if mf > 2.0 else mf
                dx = _k(x[24]) / sq * mf * (act - ex)
                dy = _k(y[24]) / sq * mf * (ex - act)
                sk = (x[0], y[0], opp)
                st = season.get(sk)
                if st is None:
                    st = season[sk] = [0, 0, 0, 0.0, 0.0, 0.0]
                if act == 1.0: st[0] += 1
                elif act == 0.0: st[1] += 1
                else: st[2] += 1
                st[3] += ex; st[4] += dx; st[5] += dy
                if opp:
                    c = _car.get(key)
                    if c:
                        cands.append((key, list(c)))
                    pending.append((key, act, ex, dx, dy))
        g["riv"] = _notable(cands)
        for key, act, ex, dx, dy in pending:
            c = _car.get(key)
            if c is None:
                c = _car[key] = [0, 0, 0, 0.0, 0.0, 0.0]
            if act == 1.0: c[0] += 1
            elif act == 0.0: c[1] += 1
            else: c[2] += 1
            c[3] += ex; c[4] += dx; c[5] += dy
    for (a, b, opp), st in season.items():
        _splits[(a, b)].append((sy, "o" if opp else "m", *st))


def _row(key, c):
    return [key[0], key[1], c[0], c[1], c[2], round(c[3], 1), round(c[4], 1), round(c[5], 1)]


def _notable(cands):
    """Up to two longest histories and two furthest from expectation (20+ duels), going into the game."""
    if not cands:
        return []
    out, seen = [], set()
    for key, c in sorted(cands, key=lambda kc: -(kc[1][0] + kc[1][1] + kc[1][2]))[:2]:
        if c[0] + c[1] + c[2] >= MIN_LONG:
            out.append(_row(key, c)); seen.add(key)
    lop = [(abs(c[0] + c[2] / 2 - c[3]), key, c) for key, c in cands if c[0] + c[1] + c[2] >= MIN_LOPSIDED]
    for _, key, c in sorted(lop, key=lambda t: -t[0])[:2]:
        if key not in seen:
            out.append(_row(key, c)); seen.add(key)
    return out


def fnv(s):
    """FNV-1a 32-bit over UTF-8; the site computes the same hash to find a player's file."""
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def slug(name):
    a = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode().lower()
    return (re.sub(r"[^a-z0-9]+", "-", a).strip("-") or "player") + "-" + fnv(name)


def write(out_dir, active):
    """out_dir: explorer folder. active: names of players seen recently (for rivals_active.json)."""
    folder = Path(out_dir) / "rivals"
    if folder.exists():
        for f in folder.glob("*.json"):
            f.unlink()
    folder.mkdir(parents=True, exist_ok=True)
    files = defaultdict(lambda: {"o": {}, "m": {}})
    r1 = lambda v: round(v, 1)
    for (a, b), rows in _splits.items():
        for sy, kind, aw, bw, t, axw, ae, be in rows:
            n = aw + bw + t
            files[a][kind].setdefault(b, []).extend([sy, aw, bw, t, r1(axw), r1(ae)])
            files[b][kind].setdefault(a, []).extend([sy, bw, aw, t, r1(n - axw), r1(be)])
    for name, d in files.items():
        (folder / f"{slug(name)}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    act = [_row(k, c) for k, c in _car.items() if k[0] in active and k[1] in active and c[0] + c[1] + c[2] >= 10]
    (Path(out_dir) / "rivals_active.json").write_text(json.dumps(act, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(files), len(act)
