"""
build_alltime.py — the all-time player rankings, from elo.json. Every player who has played is ranked.

Every part is judged against the league of its own time, month by month, among active players (played in the last 250 days, as
build_elo.py ranks them). Two marks each month: the No. 1 player's Elo (the top) and a typical starter's — the Elo of the
(5 x teams)-th best active player (the base: No. 150 with 30 teams, No. 45 with 9). A game's level is

    level = (his Elo - base) / (top - base)     1.0 = the best player in the league, 0 = a typical starter

  Peak       his best three seasons in a row (by games-weighted average level), with fewer than 150 games in them scaled down
  Career     the sum of max(0, level) over every rated game: "No. 1-equivalent games", like WAR for this rating
  Dominance  months ranked No. 1, plus 0.35 for each month at Nos. 2-5

Each part is scaled so the best player at it scores 100; the overall score blends them by WEIGHTS.

Writes
  public/data/alltime.json       every player, best first: score, the three parts and their ranks, plus
                                   pre   his rank entering this season (the day before its first game)
                                   prev  his rank before the latest night of games
                                 and "now" (this month's top and base), so the page can add tonight's games to a career live
  public/data/alltime/<0-63>.json  {name: [all-time rank through each of his games, in elo_history order, delta-encoded]}
                                 split by the same name hash as careers/ (shard() in build_careers.py); a card's back reads
                                 the rank through its game. Ranks here use each month's final marks, so a game early in a month
                                 can differ by a spot or two from a ranking taken that day.

Run after build_elo.py:  python3 scripts/build_alltime.py   (split_elo.py calls it)
"""
import bisect, datetime as dt, json
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
OUT = DATA / "alltime"
SHARDS = 64
ACTIVE_DAYS = 250
WEIGHTS = {"peak": 0.4, "career": 0.4, "dom": 0.2}
PEAK_GAMES = 150
TOP5_CREDIT = 0.35


def shard(name):  # same as build_careers.shard and PlayerModal.jsx
    h = 0
    for c in name:
        h = (h * 31 + ord(c)) % SHARDS
    return h


def season_of_date(d, smap):
    if d in smap:
        return smap[d]
    y, m = int(d[:4]), int(d[5:7])
    s = y if m >= 8 else y - 1
    return f"{s}-{str(s + 1)[2:]}"


def month_marks(H, stop):
    """Each month's (top, base) among active players at its end (stop for the last), and each player's top-5 months."""
    first = min(ds[0] for _, ds, _, _ in H)
    months, marks, rank_at = [], [], defaultdict(dict)
    d = dt.date(int(first[:4]), int(first[5:7]), 1)
    while True:
        nxt = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        me = min(nxt - dt.timedelta(days=1), stop)
        mes, lo = me.isoformat(), (me - dt.timedelta(days=ACTIVE_DAYS)).isoformat()
        v, teams = [], set()
        for n, ds, es, ts in H:
            if ds[0] > mes or ds[-1] < lo:
                continue
            i = bisect.bisect_right(ds, mes) - 1
            if i >= 0 and ds[i] >= lo:
                v.append((-es[i], n))
                teams.add(ts[i])
        v.sort()
        k = len(months)
        months.append((mes[:7], mes))
        if v:
            base_rank = min(len(v), 5 * max(1, len(teams)))
            marks.append((-v[0][0], -v[base_rank - 1][0]))
            for r, (_, n) in enumerate(v[:5], 1):
                rank_at[n][k] = r
        else:
            marks.append(None)
        if me >= stop:
            break
        d = nxt
    return months, marks, rank_at


def window_value(S, w):
    g = sum(S[s][0] for s in w)
    avg = sum(S[s][1] for s in w) / g
    return avg * min(1.0, g / PEAK_GAMES), (w[0], w[-1], g, avg)


def compute(players, smap, asof=None):
    """The ranking as of the end of asof (every game when None): rows best first, the part scales, the month marks."""
    H = []
    for p in players:
        h = p["elo_history"] if not asof else [x for x in p["elo_history"] if x[0] <= asof]
        if h:
            H.append((p, h))
    last = max(h[-1][0] for _, h in H)
    HH = [(p["name"], [x[0] for x in h], [x[1] for x in h], [x[4] for x in h]) for p, h in H]
    months, marks, rank_at = month_marks(HH, dt.date.fromisoformat(last))
    month_ix = {m: i for i, (m, _) in enumerate(months)}

    def level(date, e):
        mk = marks[month_ix[date[:7]]]
        return 0.0 if not mk else (e - mk[1]) / max(1.0, mk[0] - mk[1])

    rows = []
    for p, h in H:
        n = p["name"]
        lv = [level(x[0], x[1]) for x in h]
        S = {}
        for x, l in zip(h, lv):
            g = S.setdefault(season_of_date(x[0], smap), [0, 0.0])
            g[0] += 1; g[1] += l
        ss = sorted(S)
        best, best_w = None, None
        for i in range(len(ss)):
            val, w = window_value(S, ss[i:i + 3])
            if best is None or val > best:
                best, best_w = val, w
        r = rank_at.get(n, {})
        m1 = sum(1 for x in r.values() if x == 1)
        m5 = sum(1 for x in r.values() if 2 <= x <= 5)
        rows.append({"name": n, "peak_raw": best, "career_raw": sum(max(0.0, l) for l in lv), "dom_raw": m1 + TOP5_CREDIT * m5,
                     "m1": m1, "m5": m5, "win": best_w, "games": len(h), "first": h[0][0][:4], "last": h[-1][0], "team": p.get("team"),
                     "active": (dt.date.fromisoformat(last) - dt.date.fromisoformat(h[-1][0])).days < ACTIVE_DAYS})
    tops = {k: max(r[f"{k}_raw"] for r in rows) or 1 for k in ("peak", "career", "dom")}
    for r in rows:
        for k in tops:
            r[k] = 100 * r[f"{k}_raw"] / tops[k]
        r["score"] = sum(WEIGHTS[k] * r[k] for k in WEIGHTS)
    rows.sort(key=lambda r: (-r["score"], r["name"]))
    for k in ("peak", "career", "dom"):
        for i, r in enumerate(sorted(rows, key=lambda r: (-r[k], r["name"])), 1):
            r[f"{k}_rank"] = i
    return rows, tops, marks, months


def game_ranks(players, smap, marks, months):
    """Every player's all-time rank at the end of each day he played, replaying history a day at a time."""
    import numpy as np
    names = [p["name"] for p in players]
    N = len(names)
    month_ix = {m: i for i, (m, _) in enumerate(months)}

    def level(date, e):
        mk = marks[month_ix[date[:7]]]
        return 0.0 if not mk else (e - mk[1]) / max(1.0, mk[0] - mk[1])

    # dominance arrives at each month's end: (date, player index, credit)
    ix = {n: i for i, n in enumerate(names)}
    H = [(p["name"], [x[0] for x in p["elo_history"]], [x[1] for x in p["elo_history"]], [x[4] for x in p["elo_history"]]) for p in players]
    stop = dt.date.fromisoformat(max(ds[-1] for _, ds, _, _ in H))
    _, _, rank_at = month_marks(H, stop)
    credits = defaultdict(list)
    for n, ks in rank_at.items():
        for k, r in ks.items():
            credits[months[k][1]].append((ix[n], 1.0 if r == 1 else TOP5_CREDIT))
    by_day = defaultdict(list)
    for i, p in enumerate(players):
        for x in p["elo_history"]:
            by_day[x[0]].append((i, x[0], x[1]))
    days = sorted(set(by_day) | set(credits))

    peak, career, dom = np.zeros(N), np.zeros(N), np.zeros(N)
    seen = np.zeros(N, dtype=bool)
    seasons = [[] for _ in range(N)]; S = [dict() for _ in range(N)]; frozen = [None] * N
    out = [[] for _ in range(N)]
    for day in days:
        for i, c in credits.get(day, ()):
            dom[i] += c
        played = by_day.get(day, ())
        for i, d, e in played:
            l = level(d, e)
            career[i] += max(0.0, l)
            s = season_of_date(d, smap)
            if s not in S[i]:
                S[i][s] = [0, 0.0]; seasons[i].append(s)
                c = len(seasons[i]) - 1
                if c >= 3:  # the window that ended a season ago can no longer change
                    v, _ = window_value(S[i], seasons[i][c - 3:c])
                    frozen[i] = v if frozen[i] is None else max(frozen[i], v)
            S[i][s][0] += 1; S[i][s][1] += l
            ss, c = seasons[i], len(seasons[i]) - 1
            best = frozen[i]
            for k in range(max(0, c - 2), c + 1):
                v, _ = window_value(S[i], ss[k:k + 3])
                best = v if best is None else max(best, v)
            peak[i] = best
            seen[i] = True
        if not played:
            continue
        tp, tc, td = (peak[seen].max() or 1), (career[seen].max() or 1), (dom[seen].max() or 1)
        score = 100 * (WEIGHTS["peak"] * peak / tp + WEIGHTS["career"] * career / tc + WEIGHTS["dom"] * dom / td)
        score[~seen] = -np.inf
        desc = -np.sort(-score)  # high to low
        for i, d, e in played:
            # rank = 1 + how many score higher
            out[i].append(int(np.searchsorted(-desc, -score[i], side="left")) + 1)
    return {names[i]: out[i] for i in range(N) if out[i]}


def main(debug=False):
    elo = json.loads((DATA / "elo.json").read_text(encoding="utf-8"))
    players = [p for p in elo["players"] if p.get("elo_history")]
    smap = {}
    for f in (DATA / "explorer").glob("[0-9][0-9][0-9][0-9]-[0-9][0-9].json"):
        for g in json.loads(f.read_text(encoding="utf-8"))["games"]:
            smap[g["date"]] = f.stem

    rows, tops, marks, months = compute(players, smap)
    last = max(p["elo_history"][-1][0] for p in players)
    cur = season_of_date(last, smap)
    opener = min(d for d, s in smap.items() if s == cur) if cur in smap.values() else last
    day_before = lambda d: (dt.date.fromisoformat(d) - dt.timedelta(days=1)).isoformat()
    pre = {r["name"]: i for i, r in enumerate(compute(players, smap, day_before(opener))[0], 1)}
    prev = {r["name"]: i for i, r in enumerate(compute(players, smap, day_before(last))[0], 1)}

    mk = marks[-1]
    out = {
        "generated": elo.get("generated"),
        "night": last,                       # the latest night of games; prev is the ranking before it
        "opener": opener,                    # this season's first night; pre is the ranking before it
        "weights": WEIGHTS,
        "scale": {k: round(tops[k], 4) for k in tops},   # raw value that scores 100 in each part
        "now": {"month": months[-1][0], "top": round(mk[0], 1), "base": round(mk[1], 1)},  # for live career value
        "players": [{
            "rank": i, "name": r["name"], "team": r["team"], "active": r["active"], "years": f"{r['first']}–{r['last'][:4]}",
            "score": round(r["score"], 3), "peak": round(r["peak"], 1), "career": round(r["career"], 1), "dom": round(r["dom"], 1),
            "peak_rank": r["peak_rank"], "career_rank": r["career_rank"], "dom_rank": r["dom_rank"],
            "m1": r["m1"], "m5": r["m5"], "games": r["games"],
            "peak_window": f"{r['win'][0]}–{r['win'][1][-2:]}" if r["win"][0] != r["win"][1] else r["win"][0],
            "peak_level": round(r["win"][3], 3),
            **({"pre": pre[r["name"]]} if r["name"] in pre else {}),
            **({"prev": prev[r["name"]]} if r["name"] in prev else {}),
        } for i, r in enumerate(rows, 1)],
    }
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    (DATA / "alltime.json").write_text(dump(out), encoding="utf-8")

    # the rank through each game, for the cards
    G = game_ranks(players, smap, marks, months)
    shards = defaultdict(dict)
    for n, rs in G.items():
        shards[shard(n)][n] = [rs[0]] + [b - a for a, b in zip(rs, rs[1:])]
    OUT.mkdir(exist_ok=True)
    for k in range(SHARDS):
        (OUT / f"{k}.json").write_text(dump(shards.get(k, {})), encoding="utf-8")
    size = sum((OUT / f"{k}.json").stat().st_size for k in range(SHARDS))
    moved = sum(1 for r in out["players"] if r.get("prev") and r["prev"] != r["rank"] and min(r["prev"], r["rank"]) <= 500)
    print(f"  alltime.json: {len(rows)} players ranked, #1 {rows[0]['name']} {rows[0]['score']:.1f}; {moved} moves in the top 500 on {last}")
    print(f"  alltime/: ranks through every game, {SHARDS} files ({size / 1e6:.1f} MB)")
    if debug:
        return rows, G


if __name__ == "__main__":
    main()
