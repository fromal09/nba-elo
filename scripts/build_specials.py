"""
build_specials.py — the special cards: Peaks, Rivalries and Starting Fives (random pulls), from every season file.

Peaks       A player's career-high Elo games after his rookie season, one per season: the highest new career high he
            set that season. The newest is his reigning Peak; each earlier one is a Former Peak, with the date he
            first climbed past it ("until") and the next Peak's Elo ("next").
Rivalries   Every pair of opponents, scored over their head-to-head Game Score duels:
                sum over duels of  q × 4p(1 − p) × w
            q = exp(−(the weaker side's league rank going in) / 30), so a duel of two top-10 players counts the same in any era;
            p = the pre-game duel chance (Elo, scale 620), so even duels count most;
            w = 4 / (that season's regular-season meetings of the two teams), so each season's pairing counts about four games
                whatever the schedule; playoff duels count 1 each.
            The top 125 get the player tiers: GOAT No. 1, Icon 2-5, Legend 6-20, Standout 21-50, Rare 51-125.
Fives       Each team-season's best single-day five: the game whose five highest pre-game Elo players (among those who played)
            had the highest average, with each player's line, how often those five played together and the team's season.

Writes, under public/data/explorer/:
  packs/special/index.json            {"peaks": [[file, n]], "rivals": [[file, n]], "fives": [[file, n]]}
  packs/special/<kind>-<k>.json       {"cards": [card, ...]}   cards in the shape the site draws (kind: peak | rival | five)
  binders/rivalries.json              the 125 rivalry cards, by rank (also added to binders/league.json as the "rivalries" set)
  binders/peaks.json                  {player: [[season, game id, elo, date, until], ...]}  every Peak, oldest first
  binders/fives.json                  {franchise: {season: [elo, date, opp, won, score, [five names]]}}

Run after build_packs.py (build_binders.py calls both):  python3 scripts/build_specials.py
"""
import json, math, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_binders import honors, bands, card   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "public" / "data" / "explorer"
OUT = EXP / "packs" / "special"
MERGE = {"DEN@ABA": "DEN", "IND@ABA": "IND", "SAS@ABA": "SAS", "BKN@ABA": "BKN"}
TIERS = [("goat", 1), ("icon", 5), ("legend", 20), ("standout", 50), ("rare", 125)]
SHARD = 1500


def tier_of(rank):
    if rank is None:
        return "common"
    for name, top in TIERS:
        if rank <= top:
            return name
    return "common"


def load(f):
    d = json.loads(f.read_text(encoding="utf-8"))
    C = d["cols"]
    for g in d["games"]:
        g["players"] = [dict(zip(C, r)) for r in g["rows"]]
        del g["rows"]
    d["games"].sort(key=lambda g: (g["date"], g["id"]))
    return d


def played(p):
    return p.get("gs") is not None and ((p.get("mp") or 0) > 0 or p.get("mp") is None)


def duel_p(a, b):
    return 1 / (1 + 10 ** ((b["pre"] - a["pre"]) / 620))


def main():
    files = sorted(EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json"))
    # ── Pass 1: peaks, fives, rivalry scores ──
    first, high, open_peaks, peaks = {}, {}, defaultdict(list), defaultdict(list)
    score, meets = defaultdict(float), defaultdict(int)
    fives = []
    season_rank = {}  # season -> {"r": {player: final rank}, "champ": franchise}: Season card points (api/_lib/points.js)
    for f in files:
        d = load(f)
        season, games = d["season"], d["games"]
        hon, bnd = honors(games), bands(games)
        teams = d["teams"]
        meet = defaultdict(int)
        for g in games:
            if not g.get("post"):
                meet[frozenset(g["teams"])] += 1
        season_best = {}  # player -> (post, card)
        last_rank = {}    # player -> ((date, game), rank after his last game): a Season card's tier
        for g in games:
            for p in g["players"]:
                if not played(p):
                    continue
                n = p["n"]
                rk = p.get("lrp") if p.get("lrp") is not None else p.get("lr")
                if rk is not None and (n not in last_rank or (g["date"], g["id"]) > last_rank[n][0]):
                    last_rank[n] = ((g["date"], g["id"]), rk)
                first.setdefault(n, season)
                # A Former Peak's run ends the first time he climbs past it
                for pk in open_peaks[n]:
                    if pk["until"] is None and p["post"] > pk["row"]["post"]:
                        pk["until"] = g["date"]
                if p["post"] > high.get(n, -1):
                    if season != first[n] and (n not in season_best or p["post"] > season_best[n][0]):
                        c = card(season, teams, g, p, bnd.get((g["id"], p["t"])), hon.get((g["id"], n)))
                        c.update({"kind": "peak", "tier": tier_of(p.get("lrp") if p.get("lrp") is not None else p.get("lr")), "until": None})
                        c["row"]["gp"] = p.get("gp")
                        season_best[n] = (p["post"], c)
                    high[n] = p["post"]
            # Rivalry duels between ranked opponents
            ps = [p for p in g["players"] if played(p) and p.get("lr") is not None and p["lr"] <= 150]
            A = [p for p in ps if p["t"] == g["teams"][0]]
            B = [p for p in ps if p["t"] == g["teams"][1]]
            wt = 1.0 if g.get("post") else 4 / meet[frozenset(g["teams"])]
            for a in A:
                for b in B:
                    x, y = (a, b) if a["n"] < b["n"] else (b, a)
                    pr = duel_p(x, y)
                    k = (x["n"], y["n"])
                    score[k] += math.exp(-max(x["lr"], y["lr"]) / 30) * 4 * pr * (1 - pr) * wt
                    meets[k] += 1
        for n, (_, c) in season_best.items():
            peaks[n].append(c)
            open_peaks[n] = [c]  # only the newest Peak can still be open
        season_rank[season] = {"r": {n: v[1] for n, v in last_rank.items()},
                               "champ": next((MERGE.get(t_, t_) for x in games if x.get("post") for t_ in x["teams"]
                                              if (bnd.get((x["id"], t_)) or {}).get("champ") and x["pts"][x["teams"].index(t_)] > x["pts"][1 - x["teams"].index(t_)]), None)}
        # Starting Fives: each team's best day
        recs = {t: [x.get("w"), x.get("l")] for t, x in teams.items()}
        for t in teams:
            best = None
            for g in games:
                if t not in g["teams"]:
                    continue
                five = sorted([p for p in g["players"] if p["t"] == t and played(p)], key=lambda p: -p["pre"])[:5]
                if len(five) < 5:
                    continue
                v = sum(p["pre"] for p in five) / 5
                if best is None or v > best[0]:
                    best = (v, g, five)
            if not best:
                continue
            v, g, five = best
            names = {p["n"] for p in five}
            tog = [x for x in games if t in x["teams"] and names <= {p["n"] for p in x["players"] if p["t"] == t and played(p)}]
            won = lambda x: x["pts"][x["teams"].index(t)] > x["pts"][1 - x["teams"].index(t)]
            po = [x for x in games if x.get("post") and t in x["teams"]]
            i = g["teams"].index(t); o = g["teams"][1 - i]
            tm, om = teams.get(t, {}), teams.get(o, {})
            fives.append({"kind": "five", "s": season, "t": t, "fc": MERGE.get(t, t), "tn": tm.get("name", t), "tc": tm.get("color"),
                          "date": g["date"], "id": g["id"], "o": o, "on": om.get("name", o), "home": None if g.get("home") is None else g["home"] == t,
                          "won": g["pts"][i] > g["pts"][1 - i], "score": f"{g['pts'][i]}–{g['pts'][1 - i]}", "ot": g.get("ot") or "", "elo": round(v),
                          "players": [{"n": p["n"], "pos": p.get("pos"), "pre": round(p["pre"]), "post": round(p["post"]), "mp": p.get("mp"), "pts": p.get("pts"),
                                       "trb": p.get("trb"), "ast": p.get("ast"), "stl": p.get("stl"), "blk": p.get("blk"), "tp": p.get("tp"),
                                       "gs": p.get("gs"), "st": p.get("st"), "lr": p.get("lr"), "lrp": p.get("lrp"), "fx": p.get("fx"), "gp": p.get("gp"),
                                       "honor": hon.get((g["id"], p["n"]))} for p in five],
                          # what each player's card from that game is worth adds up to the Five's points (api/_lib/points.js)
                          "band": (lambda b: {"level": b["level"]} if b else None)(bnd.get((g["id"], t))),
                          "tw": recs[t][0], "tl": recs[t][1], "together": len(tog), "togW": sum(1 for x in tog if won(x)),
                          "po": [sum(1 for x in po if won(x)), sum(1 for x in po if not won(x))] if po else None,
                          "champ": any((bnd.get((x["id"], t)) or {}).get("champ") and won(x) for x in po)})
        print(f"  {season}", end="\r")
    # Former Peaks: the next Peak's Elo
    for n, lst in peaks.items():
        for i, c in enumerate(lst):
            c["next"] = lst[i + 1]["row"]["post"] if i + 1 < len(lst) else None
            if i + 1 == len(lst):
                c["until"] = None
    # ── Pass 2: the top 125 rivalries in detail ──
    top = sorted(score.items(), key=lambda kv: -kv[1])[:125]
    want = {k: i for i, (k, _) in enumerate(top)}
    by_name = defaultdict(list)
    for k in want:
        by_name[k[0]].append(k); by_name[k[1]].append(k)
    R = {k: {"seasons": {}, "games": 0, "teamW": 0, "po": 0, "poW": 0, "bestA": None, "bestB": None, "elo": {k[0]: {}, k[1]: {}},
             "peak": {k[0]: 0, k[1]: 0}, "teams": {k[0]: defaultdict(int), k[1]: defaultdict(int)}, "color": {k[0]: defaultdict(int), k[1]: defaultdict(int)}} for k in want}
    for f in files:
        d = load(f)
        season, sy = d["season"], int(d["season"][:4])
        for g in d["games"]:
            here = {p["n"]: p for p in g["players"] if p["n"] in by_name and played(p)}
            for n, p in here.items():
                for k in by_name[n]:
                    R[k]["elo"][n][season] = round(p["post"]); R[k]["peak"][n] = max(R[k]["peak"][n], p["post"])
            for n in here:
                for k in by_name[n]:
                    if n != k[0] or k[1] not in here:
                        continue
                    a, b = here[k[0]], here[k[1]]
                    if a["t"] == b["t"]:
                        continue
                    x = R[k]
                    row = x["seasons"].setdefault(sy, [0, 0, 0, 0.0])
                    pr = duel_p(a, b)
                    row[3] += pr
                    row[0 if a["gs"] > b["gs"] else 1 if b["gs"] > a["gs"] else 2] += 1
                    ia = g["teams"].index(a["t"])
                    aw = g["pts"][ia] > g["pts"][1 - ia]
                    x["games"] += 1; x["teamW"] += aw
                    if g.get("post"):
                        x["po"] += 1; x["poW"] += aw
                    tn = d["teams"]
                    for who, p in ((k[0], a), (k[1], b)):
                        x["teams"][who][tn.get(p["t"], {}).get("name", p["t"]).split(" ")[-1]] += 1
                        x["color"][who][tn.get(p["t"], {}).get("color") or "#173657"] += 1
                    duel = {"d": g["date"], "post": bool(g.get("post")), "aw": aw, "ag": a["gs"], "bg": b["gs"], "ap": a.get("pts"), "bp": b.get("pts"),
                            "score": f"{g['pts'][ia]}–{g['pts'][1 - ia]}"}
                    if x["bestA"] is None or a["gs"] - b["gs"] > x["bestA"]["ag"] - x["bestA"]["bg"]:
                        x["bestA"] = duel
                    if x["bestB"] is None or b["gs"] - a["gs"] > x["bestB"]["bg"] - x["bestB"]["ag"]:
                        x["bestB"] = duel
        print(f"  rivalries {season}", end="\r")
    rivals = []
    for k, i in want.items():
        x = R[k]
        ss = [{"sy": sy, "w": v[0], "l": v[1], "t": v[2], "xw": round(v[3], 1)} for sy, v in sorted(x["seasons"].items())]
        if not ss:
            continue
        r = {"kind": "rival", "rank": i + 1, "tier": tier_of(i + 1), "score": round(score[k], 2), "a": k[0], "b": k[1],
             "w": sum(s["w"] for s in ss), "l": sum(s["l"] for s in ss), "t": sum(s["t"] for s in ss), "xw": round(sum(s["xw"] for s in ss), 1),
             "seasons": ss, "first": ss[0]["sy"], "last": ss[-1]["sy"] + 1, "games": x["games"], "teamW": x["teamW"], "po": x["po"], "poW": x["poW"],
             "bestA": x["bestA"], "bestB": x["bestB"], "elo": x["elo"], "peakA": round(x["peak"][k[0]]), "peakB": round(x["peak"][k[1]]),
             "teamsA": sorted(x["teams"][k[0]], key=lambda t: -x["teams"][k[0]][t]), "teamsB": sorted(x["teams"][k[1]], key=lambda t: -x["teams"][k[1]][t]),
             "ac": max(x["color"][k[0]], key=x["color"][k[0]].get), "bc": max(x["color"][k[1]], key=x["color"][k[1]].get)}
        # The leader (more duel wins) goes first
        if r["l"] > r["w"]:
            fl = lambda du: {**du, "ag": du["bg"], "bg": du["ag"], "ap": du["bp"], "bp": du["ap"], "aw": not du["aw"]}
            n_ = r["w"] + r["l"]
            r.update({"a": k[1], "b": k[0], "w": r["l"], "l": r["w"], "xw": round(n_ - r["xw"], 1), "seasons": [{**s, "w": s["l"], "l": s["w"], "xw": round(s["w"] + s["l"] - s["xw"], 1)} for s in ss],
                      "teamW": r["games"] - r["teamW"], "poW": r["po"] - r["poW"], "bestA": fl(x["bestB"]), "bestB": fl(x["bestA"]), "peakA": r["peakB"], "peakB": r["peakA"],
                      "teamsA": r["teamsB"], "teamsB": r["teamsA"], "ac": r["bc"], "bc": r["ac"]})
        rivals.append(r)
    rivals.sort(key=lambda r: r["rank"])
    # ── Write ──
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    index = {}
    all_peaks = [c for n in sorted(peaks) for c in peaks[n]]
    for kind, cards in (("peaks", all_peaks), ("rivals", rivals), ("fives", fives)):
        index[kind] = []
        for k in range(0, len(cards), SHARD):
            name = f"{kind}-{k // SHARD}.json"
            (OUT / name).write_text(json.dumps({"cards": cards[k:k + SHARD]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            index[kind].append([name, len(cards[k:k + SHARD])])
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    B = EXP / "binders"
    B.mkdir(parents=True, exist_ok=True)
    (B / "rivalries.json").write_text(json.dumps(rivals, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # The Rivalries league binder: every possible Rivalry card, by rank
    lp = B / "league.json"
    if lp.exists():
        league = json.loads(lp.read_text(encoding="utf-8"))
        league.setdefault("sets", {})["rivalries"] = rivals
        lp.write_text(json.dumps(league, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (B / "peaks.json").write_text(json.dumps({n: [[c["s"], c["id"], round(c["row"]["post"]), c["date"], c["until"]] for c in lst] for n, lst in peaks.items()},
                                             ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    fv = defaultdict(dict)
    for c in fives:
        fv[c["fc"]][c["s"]] = [c["elo"], c["date"], c["o"], c["won"], c["score"], [p["n"] for p in c["players"]]]
    (B / "seasonrank.json").write_text(json.dumps(season_rank, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (B / "fives.json").write_text(json.dumps(fv, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  Specials: {len(all_peaks):,} Peak cards ({len(peaks):,} players) · {len(rivals)} rivalries · {len(fives):,} Starting Fives            ")


if __name__ == "__main__":
    main()
