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
Duos        Dynamic Duos: every pair of teammates with 100+ games both on the floor (any team, so a pair who played
            together on two teams counts every game). Each game's duo Elo is 75% the weaker partner's pre-game Elo and 25%
            the stronger's: a duo is only as good as its second star. The ranking is half their prime (the average duo Elo
            over their best three seasons together, 20+ games each) and half their peak (the single highest game). Both must average DUO_MIN_ELO or better while
            together. The top 125 get the player tiers, as Rivalries.
Fives       Each team-season's best single-day five: the game whose five highest pre-game Elo players (among those who played)
            had the highest average, with each player's line, how often those five played together and the team's season.

Writes, under public/data/explorer/:
  packs/special/index.json            {"peaks": [[file, n]], "rivals": [[file, n]], "fives": [[file, n]], "duos": [[file, n]]}
  packs/special/<kind>-<k>.json       {"cards": [card, ...]}   cards in the shape the site draws (kind: peak | rival | five)
  binders/rivalries.json              the 125 rivalry cards, by rank (also added to binders/league.json as the "rivalries" set)
  binders/duos.json                   the 125 Dynamic Duo cards, by rank (league.json's "duos" set)
  binders/peaks.json                  {player: [[season, game id, elo, date, until], ...]}  every Peak, oldest first
  binders/fives.json                  {franchise: {season: [elo, date, opp, won, score, [five names]]}}
  binders/fivedist.json               {franchise: {season: [every game's five's total pre-game Elo, sorted]}}: the weekly Five challenge ranks against these

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
K_FIVE = 40   # how fast a Starting Five player's weight falls with his league rank (see the Starting Five tiers)
TIERS = [("goat", 1), ("icon", 5), ("legend", 20), ("standout", 50), ("rare", 125)]
SHARD = 1500
DUO_GAMES = 100      # games both on the floor to be a Dynamic Duo
DUO_MIN_ELO = 2200   # each partner's average pre-game Elo while together
DUO_WEAK = 0.75      # the weaker partner's share of a game's duo score
DUO_PRIME = 3        # seasons in a duo's prime
DUO_SEASON_MIN = 20  # games together for a season to count toward the prime


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


# Season card points, as api/_lib/points.js: 80 × his final tier's base × games / 82 (up to ×1.25), plus honors
TIER_BASE = {"common": 1, "rare": 3, "standout": 6, "legend": 12, "icon": 25, "goat": 60}


def season_points(rank, gp, honor, champ):
    mult = 1
    if honor:
        mult += 0.25 if "S" in honor else 0
        mult += next(({"1": 0.6, "2": 0.45, "3": 0.3}[c] for c in honor if c in "123"), 0)
        mult += 1 if "M" in honor else 0
    mult += 0.5 if champ else 0
    return max(5, round(80 * TIER_BASE[tier_of(rank)] * min(1.25, gp / 82) * mult))


def season_summary(d, bnd, name, fc):
    """A Season card's front, as the site's seasonSummary (SeasonExplorer.jsx), for the Greatest Seasons binder"""
    gp = [(g, p) for g in d["games"] for p in g["players"] if p["n"] == name and MERGE.get(p["t"], p["t"]) == fc and played(p)]
    if not gp:
        return None
    t = gp[-1][1]["t"]
    tm = d["teams"].get(t, {})
    won = lambda g, p: g["pts"][g["teams"].index(p["t"])] > g["pts"][1 - g["teams"].index(p["t"])]
    opp = lambda g, p: g["teams"][1 - g["teams"].index(p["t"])]
    reg = [x for x in gp if not x[0].get("post")]
    po = [x for x in gp if x[0].get("post")]
    av = lambda xs, k: round(sum((p.get(k) or 0) for _, p in xs) / len(xs), 1) if xs else None
    series = []
    for g, p in po:
        o = opp(g, p)
        b = bnd.get((g["id"], p["t"])) or {}
        if not series or series[-1]["o"] != o:
            series.append({"o": o, "on": d["teams"].get(o, {}).get("name", o), "round": b.get("label", ""), "w": 0, "l": 0})
        series[-1]["w" if won(g, p) else "l"] += 1
    champ = bool(po) and (bnd.get((po[-1][0]["id"], po[-1][1]["t"])) or {}).get("champ") and won(*po[-1])
    path = [gp[0][1]["pre"]] + [p["post"] for _, p in gp]
    bg, bp = max(gp, key=lambda x: x[1].get("gs") or 0)
    return {"name": name, "s": d["season"], "t": fc, "tn": tm.get("name", fc), "tc": tm.get("color"), "w": tm.get("w"), "l": tm.get("l"),
            "gp": len(gp), "reg": len(reg), "pts": av(reg, "pts"), "trb": av(reg, "trb"), "ast": av(reg, "ast"), "gs": av(reg, "gs"),
            "start": round(path[0]), "end": round(path[-1]), "peak": round(max(path)), "rank": gp[-1][1].get("lrp"), "path": [round(x) for x in path],
            "best": {"date": bg["date"], "o": opp(bg, bp), "home": None if bg.get("home") is None else bg["home"] == bp["t"], "row": {"pts": bp.get("pts"), "gs": bp.get("gs")}},
            "po": {"w": sum(x["w"] for x in series), "l": sum(x["l"] for x in series), "series": series, "champ": bool(champ)} if po else None}


def duel_p(a, b):
    return 1 / (1 + 10 ** ((b["pre"] - a["pre"]) / 620))


def dynamic_duos(files, duo):
    """The top 125 Dynamic Duos in detail: record, playoffs, titles, seasons, colors, who carried it, best game together."""
    ok = [(k, x) for k, x in duo.items() if x[0] >= DUO_GAMES and min(x[2], x[3]) / x[0] >= DUO_MIN_ELO]
    def prime(x):
        """Their best DUO_PRIME seasons together (DUO_SEASON_MIN games or more), by average duo Elo: (average, seasons)"""
        ss = sorted(((v[1] / v[0], s_, v) for s_, v in x[6].items() if v[0] >= DUO_SEASON_MIN), reverse=True)[:DUO_PRIME]
        if not ss:
            return x[1] / x[0], []
        return sum(v[1] for _, _, v in ss) / sum(v[0] for _, _, v in ss), sorted(s_ for _, s_, _ in ss)
    rank_by = lambda x: 0.5 * prime(x)[0] + 0.5 * x[4]   # half the prime, half the peak
    top = sorted(ok, key=lambda kx: -rank_by(kx[1]))[:125]
    want = {k: i for i, (k, _) in enumerate(top)}
    by_name = defaultdict(list)
    for k in want:
        by_name[k[0]].append(k)
    D = {k: {"w": 0, "pn": 0, "pw": 0, "titles": [], "seasons": {}, "teams": defaultdict(int), "names": {}, "colors": {}, "gsA": 0.0, "gsB": 0.0,
             "best": None, "first": None, "last": None} for k in want}
    for f in files:
        d = load(f)
        season, games = d["season"], d["games"]
        bnd = bands(games)
        champ = next(((x["id"], t_) for x in games if x.get("post") for t_ in x["teams"]
                      if (bnd.get((x["id"], t_)) or {}).get("champ") and x["pts"][x["teams"].index(t_)] > x["pts"][1 - x["teams"].index(t_)]), None)
        champ_t = champ[1] if champ else None
        po_together = set()
        for g in games:
            here = [p["n"] for p in g["players"] if p["n"] in by_name]
            if not here:
                continue
            on = {p["n"]: p for p in g["players"] if played(p)}
            for a in here:
                if a not in on:
                    continue
                for k in by_name[a]:
                    b = on.get(k[1])
                    pa = on[a]
                    if not b or b["t"] != pa["t"]:
                        continue
                    x = D[k]
                    t_ = pa["t"]
                    i_ = g["teams"].index(t_)
                    won = g["pts"][i_] > g["pts"][1 - i_]
                    x["w"] += won
                    if g.get("post"):
                        x["pn"] += 1; x["pw"] += won
                        if t_ == champ_t:
                            po_together.add(k)
                    ss = x["seasons"].setdefault(season, [0.0, 0])
                    ss[0] += pa["pre"] + b["pre"]; ss[1] += 1
                    x["teams"][t_] += 1
                    x["names"][t_] = d["teams"].get(t_, {}).get("name", t_)
                    x["colors"][t_] = d["teams"].get(t_, {}).get("color")
                    x["gsA"] += pa.get("gs") or 0; x["gsB"] += b.get("gs") or 0
                    tot = (pa.get("gs") or 0) + (b.get("gs") or 0)
                    if x["best"] is None or tot > x["best"]["tot"]:
                        x["best"] = {"tot": tot, "date": g["date"], "o": g["teams"][1 - i_], "home": None if g.get("home") is None else g["home"] == t_,
                                     "won": won, "score": f"{g['pts'][i_]}–{g['pts'][1 - i_]}", "post": bool(g.get("post")),
                                     "ap": pa.get("pts"), "bp": b.get("pts"), "ag": pa.get("gs"), "bg": b.get("gs")}
                    x["first"] = x["first"] or g["date"]; x["last"] = g["date"]
        for k in po_together:
            D[k]["titles"].append(season)
        print(f"  duos {season}", end="\r")
    out = []
    for k, i in want.items():
        n_, sc, sa, sb, pk, pkd, _ = duo[k]
        pr, prs = prime(duo[k])
        x = D[k]
        a, b = k
        ea, eb, ga, gb = sa / n_, sb / n_, x["gsA"], x["gsB"]
        if eb > ea:   # the stronger partner first
            a, b, ea, eb, ga, gb = b, a, eb, ea, gb, ga
            if x["best"]:
                bb = x["best"]; x["best"] = {**bb, "ap": bb["bp"], "bp": bb["ap"], "ag": bb["bg"], "bg": bb["ag"]}
        t_ = max(x["teams"], key=x["teams"].get)
        out.append({"kind": "duo", "rank": i + 1, "tier": tier_of(i + 1), "a": a, "b": b, "score": round(rank_by(duo[k])), "avg": round(sc / n_), "prime": round(pr), "primeSeasons": prs, "peak": round(pk), "peakDate": pkd, "elo": round((sa + sb) / n_),
                    "ea": round(ea), "eb": round(eb), "n": n_, "w": x["w"], "l": n_ - x["w"], "pw": x["pw"], "pl": x["pn"] - x["pw"], "titles": x["titles"],
                    "t": t_, "tn": x["names"][t_], "tc": x["colors"][t_], "teams": sorted(x["names"][c] for c in x["teams"]),
                    "share": round(ga / (ga + gb) * 100) if ga + gb > 0 else 50, "first": x["first"], "last": x["last"],
                    "seasons": [[s_, round(v[0] / v[1]), v[1]] for s_, v in sorted(x["seasons"].items())],
                    "best": {kk: vv for kk, vv in (x["best"] or {}).items() if kk != "tot"} or None})
    return sorted(out, key=lambda r: r["rank"])


def main():
    files = sorted(EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json"))
    # ── Pass 1: peaks, fives, rivalry scores ──
    first, high, open_peaks, peaks = {}, {}, defaultdict(list), defaultdict(list)
    score, meets = defaultdict(float), defaultdict(int)
    fives = []
    five_dist = defaultdict(lambda: defaultdict(list))  # franchise -> season -> every game's five, total pre-game Elo
    league_size = {}  # season -> ranked players (the deepest league rank seen)
    duo = {}          # (a, b) -> [games, duo Elo sum, a's Elo sum, b's Elo sum, peak duo Elo, its date, {season: [games, duo Elo sum]}]
    season_cands = [] # (points, end Elo, season, franchise, player) for every player-season with a franchise
    hp = EXP / "binders" / "honors.json"   # published by build_honors.py, which build_binders.py runs first
    honors_ = json.loads(hp.read_text(encoding="utf-8")) if hp.exists() else {}
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
        last_end = {}     # player -> Elo after his last game
        for g in games:
            for p in g["players"]:
                if not played(p):
                    continue
                n = p["n"]
                rk = p.get("lrp") if p.get("lrp") is not None else p.get("lr")
                if rk is not None and (n not in last_rank or (g["date"], g["id"]) > last_rank[n][0]):
                    last_rank[n] = ((g["date"], g["id"]), rk)
                last_end[n] = p["post"]
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
            # Dynamic Duos: every pair of teammates who both played
            for t_ in g["teams"]:
                mates = sorted((p["n"], p["pre"]) for p in g["players"] if p["t"] == t_ and played(p) and p.get("pre") is not None)
                for i_ in range(len(mates)):
                    a_, ea = mates[i_]
                    for b_, eb in mates[i_ + 1:]:
                        x_ = duo.get((a_, b_))
                        if x_ is None:
                            x_ = duo[(a_, b_)] = [0, 0.0, 0.0, 0.0, 0.0, None, {}]
                        v_ = DUO_WEAK * min(ea, eb) + (1 - DUO_WEAK) * max(ea, eb)
                        x_[0] += 1; x_[1] += v_; x_[2] += ea; x_[3] += eb
                        if v_ > x_[4]:
                            x_[4], x_[5] = v_, g["date"]
                        ss_ = x_[6].get(season)
                        if ss_ is None:
                            ss_ = x_[6][season] = [0, 0.0]
                        ss_[0] += 1; ss_[1] += v_
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
        league_size[season] = max((p.get("lr") or 0) for g in games for p in g["players"]) or None
        # Every Season card's points, for the Greatest Seasons binder
        gpc = defaultdict(int)
        for g in games:
            for p in g["players"]:
                if played(p):
                    gpc[(MERGE.get(p["t"], p["t"]), p["n"])] += 1
        champ_fc = next((MERGE.get(t_, t_) for x in games if x.get("post") for t_ in x["teams"]
                         if (bnd.get((x["id"], t_)) or {}).get("champ") and x["pts"][x["teams"].index(t_)] > x["pts"][1 - x["teams"].index(t_)]), None)
        for (fc_, n_), k_ in gpc.items():
            rk_ = last_rank.get(n_, (None, None))[1]
            season_cands.append((season_points(rk_, k_, honors_.get(season, {}).get(n_), champ_fc == fc_), last_end.get(n_, 0), season, fc_, n_))
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
                five_dist[MERGE.get(t, t)][season].append(round(v * 5))
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
    duos = dynamic_duos(files, duo)
    # ── Write ──
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    index = {}
    all_peaks = [c for n in sorted(peaks) for c in peaks[n]]
    # Starting Five tiers. Lineups compare across eras by where the five stood in the league that day, not by raw
    # Elo (which runs higher in later eras): each player counts exp(-K × his league rank going in ÷ that season's
    # number of ranked players), so a top-10 player in an eight-team league counts for less than in a 30-team one. The best lineup ever is the GOAT, then Icons (2-5), Legends (6-20), Standouts (21-50), Rares (51-125);
    # the rest are Common. The top 125 are the Starting Fives league binder.
    for c in fives:
        n_ = league_size.get(c["s"]) or 300
        c["str"] = round(sum(math.exp(-(p["lr"] if p.get("lr") is not None else n_) / n_ * K_FIVE) for p in c["players"]), 4)
    for i, c in enumerate(sorted(fives, key=lambda c: (-c["str"], -c["elo"]))):
        c["rank"] = i + 1
        c["tier"] = tier_of(i + 1)
    top_fives = sorted([c for c in fives if c["rank"] <= 125], key=lambda c: c["rank"])
    for kind, cards in (("peaks", all_peaks), ("rivals", rivals), ("fives", fives), ("duos", duos)):
        index[kind] = []
        for k in range(0, len(cards), SHARD):
            name = f"{kind}-{k // SHARD}.json"
            (OUT / name).write_text(json.dumps({"cards": cards[k:k + SHARD]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            index[kind].append([name, len(cards[k:k + SHARD])])
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    # The Greatest Seasons binder: the 125 Season cards worth the most points, with each card's front precomputed
    top_seasons = sorted(season_cands, key=lambda x: (-x[0], -x[1]))[:125]
    want_s = defaultdict(list)
    for i, (pts_, _, s_, fc_, n_) in enumerate(top_seasons):
        want_s[s_].append((i, pts_, fc_, n_))
    seasons_set = [None] * len(top_seasons)
    for f in files:
        d = None
        for i, pts_, fc_, n_ in want_s.get(f.stem, []):
            if d is None:
                d = load(f); bnd_ = bands(d["games"])
            sm = season_summary(d, bnd_, n_, fc_)
            if not sm:
                continue
            hc = honors_.get(sm["s"], {}).get(n_)
            sm["honors"] = {"allStar": "S" in hc, "allNba": next((int(c) for c in hc if c in "123"), 0), "mvp": "M" in hc, "aba": "A" in hc} if hc else None
            seasons_set[i] = {"kind": "season", "tier": "season", "s": sm["s"], "t": fc_, "tn": sm["tn"], "tc": sm["tc"], "n": n_, "gp": sm["gp"],
                              "rank": sm["rank"], "honors": hc, "champ": bool(sm["po"] and sm["po"]["champ"]), "points": pts_, "allTime": i + 1, "sum": sm}
    seasons_set = [x for x in seasons_set if x]
    B = EXP / "binders"
    B.mkdir(parents=True, exist_ok=True)
    (B / "rivalries.json").write_text(json.dumps(rivals, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (B / "duos.json").write_text(json.dumps(duos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # The Rivalries league binder: every possible Rivalry card, by rank
    lp = B / "league.json"
    if lp.exists():
        league = json.loads(lp.read_text(encoding="utf-8"))
        league.setdefault("sets", {})["rivalries"] = rivals
        league["sets"]["lineups"] = top_fives
        league["sets"]["seasons"] = seasons_set
        league["sets"]["duos"] = duos
        lp.write_text(json.dumps(league, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        # What the server needs from the league sets when a card is kept: each game-card set's refs (a few KB, not the whole file)
        refs = {k: [f"{c['s']}|{c['id']}|{c['row']['n']}" for c in v] for k, v in league["sets"].items()
                if v and isinstance(v, list) and all(isinstance(c, dict) and c.get("row") and c.get("id") for c in v)}
        (B / "setrefs.json").write_text(json.dumps(refs, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (B / "peaks.json").write_text(json.dumps({n: [[c["s"], c["id"], round(c["row"]["post"]), c["date"], c["until"]] for c in lst] for n, lst in peaks.items()},
                                             ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    fv = defaultdict(dict)
    for c in fives:
        fv[c["fc"]][c["s"]] = [c["elo"], c["date"], c["o"], c["won"], c["score"], [p["n"] for p in c["players"]]]
    (B / "seasonrank.json").write_text(json.dumps(season_rank, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (B / "fives.json").write_text(json.dumps(fv, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (B / "fivedist.json").write_text(json.dumps({fc: {s_: sorted(v) for s_, v in ss.items()} for fc, ss in five_dist.items()},
                                                separators=(",", ":")), encoding="utf-8")
    print(f"  Specials: {len(all_peaks):,} Peak cards ({len(peaks):,} players) · {len(rivals)} rivalries · {len(duos)} Dynamic Duos · {len(fives):,} Starting Fives            ")


if __name__ == "__main__":
    main()
