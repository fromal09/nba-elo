"""
build_careers.py — the player card's career data (src/components/PlayerModal.jsx), small enough to open instantly.

  public/data/careers/<0-63>.json  {name: [season, ...]}  players split into 64 files by a hash of the name (shard(), mirrored in
                                   PlayerModal.jsx), so opening a card loads one ~100 KB file instead of every season file
  public/data/careers/band.json    the league month by month: [month end, median, 90th percentile, No. 1] Elo of the players who
                                   played in the 75 days before it (months with fewer than 30 are left out)

One line per season: s (season), t (teams, in order), g (rated games, playoffs included), gp (regular-season games with a box score),
st / en / pk / av (Elo going in, at the end, at its peak, on average), rk / rn (where his end-of-season Elo ranked among the players with
20+ rated games that season, and how many there were), pts / trb / ast / gs / mp (regular-season per-game averages), b (best game by Game
Score) and h (most points), each {gs, pts, trb, ast, d (date), o (opponent), p (1 for a playoff game)}.

Needs elo.json and the explorer season files, so it runs after build_elo.py; split_elo.py calls it.
"""
import bisect, datetime as dt, json
from collections import defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
OUT = DATA / "careers"
SHARDS = 64
MIN_RANKED = 20


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
            shards[shard(n)][n] = lines

    # The league by month
    H = []
    for p in players:
        h = p.get("elo_history") or []
        if h:
            H.append(([x[0] for x in h], [x[1] for x in h]))
    first = min(ds[0] for ds, _ in H)
    last = max(ds[-1] for ds, _ in H)
    band, d = [], dt.date(int(first[:4]), int(first[5:7]), 1)
    stop = dt.date.fromisoformat(last)
    while True:
        nxt = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        me = min(nxt - dt.timedelta(days=1), stop)
        mes, lo = me.isoformat(), (me - dt.timedelta(days=75)).isoformat()
        v = []
        for ds, es in H:
            if ds[0] > mes or ds[-1] < lo:
                continue
            i = bisect.bisect_right(ds, mes) - 1
            if i >= 0 and ds[i] >= lo:
                v.append(es[i])
        if len(v) >= 30:
            v.sort()
            band.append([mes, round(v[len(v) // 2]), round(v[int(len(v) * 0.9)]), round(v[-1])])
        if me >= stop:
            break
        d = nxt

    OUT.mkdir(exist_ok=True)
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    for k in range(SHARDS):
        (OUT / f"{k}.json").write_text(dump(shards.get(k, {})), encoding="utf-8")
    (OUT / "band.json").write_text(dump(band), encoding="utf-8")
    size = sum((OUT / f"{k}.json").stat().st_size for k in range(SHARDS))
    print(f"  careers: {sum(len(v) for v in shards.values())} players in {SHARDS} files ({size / 1e6:.1f} MB), band {len(band)} months")


if __name__ == "__main__":
    main()
