"""
build_careers.py — the player card's career data (src/components/PlayerModal.jsx), small enough to open instantly.

  public/data/careers/<0-63>.json  {name: {"s": [season, ...], "d": [decade, ...]}}  players split into 64 files by a hash of the name
                                   (shard(), mirrored in PlayerModal.jsx), so opening a card loads one ~100 KB file, not every season file
  public/data/careers/ranks.json   the league month by month: [month end, No. 1, No. 20, No. 50, No. 100] — the Elo it took to hold each
                                   rank among active players (played in the last 250 days, as build_elo.py ranks them); null where
                                   fewer players were active

One line per season: s (season), t (teams, in order), g (rated games, playoffs included), gp (regular-season games with a box score),
st / en / pk / av (Elo going in, at the end, at its peak, on average), rk / rn (where his end-of-season Elo ranked among the players with
20+ rated games that season, and how many there were), pts / trb / ast / gs / mp (regular-season per-game averages), b (best game by Game
Score) and h (most points), each {gs, pts, trb, ast, d (date), o (opponent), p (1 for a playoff game)}.

One line per decade (by the season's start year, so 2009-10 is in the 2000s): d (1990 for the 1990s), n (seasons), g (rated games),
av / pk (average and peak Elo), ar / an (his average's rank among players with 82+ rated games that decade, of how many),
pr / pn (his peak's rank among everyone who played that decade, of how many).

Needs elo.json and the explorer season files, so it runs after build_elo.py; split_elo.py calls it.
"""
import bisect, datetime as dt, json
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
OUT = DATA / "careers"
SHARDS = 64
MIN_RANKED = 20
MIN_DECADE = 82
ACTIVE_DAYS = 250
RANK_MARKS = (1, 20, 50, 100)


def shard(name):
    h = 0
    for c in name:
        h = (h * 31 + ord(c)) % SHARDS
    return h


def fallback_season(d):
    y, m = int(d[:4]), int(d[5:7])
    s = y if m >= 8 else y - 1
    return f"{s}-{str(s + 1)[2:]}"


def r1(v):
    return round(v, 1)


def main():
    elo = json.loads((DATA / "elo.json").read_text(encoding="utf-8"))
    players = elo["players"]
    names = {p["name"] for p in players}

    # Box scores: the season of every game date, and each player's games by season
    season_of, box = {}, defaultdict(list)  # (name, season) -> [(date, row dict, opp, post)]
    for f in sorted((DATA / "explorer").glob("[0-9][0-9][0-9][0-9]-[0-9][0-9].json")):
        sd = json.loads(f.read_text(encoding="utf-8"))
        s, C = sd["season"] if "season" in sd else f.stem, sd["cols"]
        ix = {k: i for i, k in enumerate(C)}
        for g in sd["games"]:
            season_of[g["date"]] = s
            for r in g.get("rows") or []:
                n = r[ix["n"]]
                if n not in names:
                    continue
                t = r[ix["t"]]
                opp = next((x for x in g["teams"] if x != t), "")
                box[(n, s)].append((g["date"], {k: r[ix[k]] for k in ("pts", "trb", "ast", "gs", "mp", "pre")}, opp, bool(g.get("post"))))
    seas = lambda d: season_of.get(d) or fallback_season(d)

    # Each player's rated games by season, and every season's end-of-season Elo table for the ranks
    by_player, ends = {}, defaultdict(list)
    for p in players:
        S = defaultdict(list)
        for date, e, opp, post, team in p.get("elo_history") or []:
            S[seas(date)].append((date, e, team))
        by_player[p["name"]] = S
        for s, L in S.items():
            if len(L) >= MIN_RANKED:
                ends[s].append(L[-1][1])
    for s in ends:
        ends[s].sort(reverse=True)

    def game(x):
        date, r, opp, post = x
        out = {"gs": r1(r["gs"] or 0), "pts": r["pts"] or 0, "trb": r["trb"] or 0, "ast": r["ast"] or 0, "d": date, "o": opp}
        if post:
            out["p"] = 1
        return out

    # Decades, by season start year: every player's games, average and peak, then the ranks
    dec = defaultdict(dict)  # decade -> name -> [games, elo sum, peak, seasons]
    for n, S in by_player.items():
        for s, L in S.items():
            d = int(s[:4]) // 10 * 10
            r = dec[d].setdefault(n, [0, 0.0, 0.0, 0])
            r[0] += len(L); r[1] += sum(x[1] for x in L); r[2] = max(r[2], max(x[1] for x in L)); r[3] += 1
    dec_rank = {}
    for d, M in dec.items():
        avg = sorted(((v[1] / v[0], n) for n, v in M.items() if v[0] >= MIN_DECADE), reverse=True)
        pk = sorted(((v[2], n) for n, v in M.items()), reverse=True)
        dec_rank[d] = ({n: i + 1 for i, (_, n) in enumerate(avg)}, len(avg), {n: i + 1 for i, (_, n) in enumerate(pk)}, len(pk))

    shards = defaultdict(dict)
    for p in players:
        n, S, lines, prev = p["name"], by_player[p["name"]], [], None
        for s in sorted(S):
            L = S[s]
            es = [x[1] for x in L]
            G = sorted(box.get((n, s), []), key=lambda x: x[0])
            reg = [x for x in G if not x[3]]
            start = prev if prev is not None else (G[0][1]["pre"] if G and G[0][1]["pre"] is not None else es[0])
            line = {"s": s, "t": list(dict.fromkeys(x[2] for x in L)), "g": len(L), "gp": len(reg),
                    "st": round(start), "en": round(es[-1]), "pk": round(max(es)), "av": round(sum(es) / len(es))}
            if len(L) >= MIN_RANKED and ends.get(s):
                line["rk"] = bisect.bisect_left([-v for v in ends[s]], -es[-1]) + 1
                line["rn"] = len(ends[s])
            if reg:
                for k in ("pts", "trb", "ast", "gs", "mp"):
                    line[k] = r1(sum((x[1][k] or 0) for x in reg) / len(reg))
            if G:
                line["b"] = game(max(G, key=lambda x: x[1]["gs"] or -99))
                line["h"] = game(max(G, key=lambda x: x[1]["pts"] or 0))
            lines.append(line)
            prev = es[-1]
        if lines:
            ds = []
            for d in sorted(dk for dk in dec if n in dec[dk]):
                g, tot, peak, ns = dec[d][n]
                ar, an, pr, pn = dec_rank[d]
                row = {"d": d, "n": ns, "g": g, "av": round(tot / g), "pk": round(peak), "pr": pr[n], "pn": pn}
                if n in ar:
                    row["ar"], row["an"] = ar[n], an
                ds.append(row)
            shards[shard(n)][n] = {"s": lines, "d": ds}

    # The league by month: the Elo it took to be No. 1, 20, 50 and 100 among active players
    H = []
    for p in players:
        h = p.get("elo_history") or []
        if h:
            H.append(([x[0] for x in h], [x[1] for x in h]))
    first = min(ds[0] for ds, _ in H)
    last = max(ds[-1] for ds, _ in H)
    ranks, d = [], dt.date(int(first[:4]), int(first[5:7]), 1)
    stop = dt.date.fromisoformat(last)
    while True:
        nxt = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        me = min(nxt - dt.timedelta(days=1), stop)
        mes, lo = me.isoformat(), (me - dt.timedelta(days=ACTIVE_DAYS)).isoformat()
        v = []
        for ds, es in H:
            if ds[0] > mes or ds[-1] < lo:
                continue
            i = bisect.bisect_right(ds, mes) - 1
            if i >= 0 and ds[i] >= lo:
                v.append(es[i])
        if v:
            v.sort(reverse=True)
            ranks.append([mes] + [round(v[k - 1]) if len(v) >= k else None for k in RANK_MARKS])
        if me >= stop:
            break
        d = nxt

    OUT.mkdir(exist_ok=True)
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    for k in range(SHARDS):
        (OUT / f"{k}.json").write_text(dump(shards.get(k, {})), encoding="utf-8")
    (OUT / "ranks.json").write_text(dump(ranks), encoding="utf-8")
    old = OUT / "band.json"
    if old.exists():
        old.unlink()
    size = sum((OUT / f"{k}.json").stat().st_size for k in range(SHARDS))
    print(f"  careers: {sum(len(v) for v in shards.values())} players in {SHARDS} files ({size / 1e6:.1f} MB), rank lines {len(ranks)} months")


if __name__ == "__main__":
    main()
