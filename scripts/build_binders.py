"""
build_binders.py — what the career and franchise binders need, so the site doesn't load every season file.

Reads the Season Explorer files and timemachine.json (run build_timemachine.py first). Writes:

  explorer/binders/p/<slug>.json   one per player (slug as in rivalries.py):
      {"name", "games", "seasons": [{"s", "teams", "n", "rs", "po", "tiers", "start", "end", "peak", "champ", "best"}],
       "milestones": {"debut", "high_pts", "best_gs", "peak_elo", "best_rank", "swing", "title"},
       "duels": [{"k": "duel"|"slayer", "s", "id", "date", "a": card, "b": card}]}   a = the winner
      Duel of the Day goes in both players' binders, Giant-Slayer of the Day in the winner's.
  explorer/binders/f/<CODE>.json   one per franchise:
      {"code", "name", "color", "titles", "seasons": [{"s", "name", "color", "w", "l", "pw", "pl", "champ", "potg", "best"}],
       "legends": [{"n", "peak", "s", "games"}], "signature": [card, ...], "records": {...},
       "milestones": {"first": card, "clinch": [card per title], "peak_elo": card, "swing": card}}
      The newest season carries "live": true until its title is decided.

A card is everything a card front needs: {"s", "id", "date", "t", "tn", "tc", "o", "on", "oc", "home", "won", "score",
"ot", "band", "honor", "row": {"n", "pos", "pts", "trb", "ast", "gs", "pre", "post", "lr", "lrp", "fx"}}.
Tiers count cards by the post-game league rank: GOAT top 5, Icon 20, Legend 50, Rare 125, Common the rest.
Player of the Game / Day and playoff rounds match the site's own rules (markHonors, postBand).

  explorer/binders/league.json     the Binders page: league-wide sets and the franchise list
      {"franchises": [{"code", "name", "color", "titles", "first", "last", "active"}],
       "sets": {"titles", "debuts", "games", "stat", "crowns", "peaks", "swings": [card, ...],
                "slayers", "duels": [{"k", "s", "id", "date", "a": card, "b": card, "gap"|"score"}]}}

Run after build_timemachine.py:  python3 scripts/build_binders.py   (also builds the pack pool and the special cards: build_packs.py, build_specials.py)
"""
import heapq, itertools, json, sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rivalries import slug   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "public" / "data" / "explorer"
OUT = EXP / "binders"
TIERS = [(5, 0), (20, 1), (50, 2), (125, 3)]
# ABA teams that joined the NBA share a franchise binder with their NBA seasons
MERGE = {"DEN@ABA": "DEN", "IND@ABA": "IND", "SAS@ABA": "SAS", "BKN@ABA": "BKN"}
ROW_KEYS = ["n", "pos", "pts", "trb", "ast", "gs", "pre", "post", "lr", "lrp", "fx", "hs"]


def tier(rank):
    if rank is None:
        return 4
    for top, i in TIERS:
        if rank <= top:
            return i
    return 4


def night(p):
    return (p["gs"] or 0) + (p["post"] - p["pre"]) / 6


def honors(games):
    """Player of the Game and of the Day, as the site's markHonors."""
    out, by_day = {}, defaultdict(list)
    for g in games:
        top = max(g["players"], key=night, default=None)
        if top:
            out[(g["id"], top["n"])] = "potg"
        by_day[g["date"]].extend((g["id"], p) for p in g["players"])
    for ps in by_day.values():
        gid, top = max(ps, key=lambda x: night(x[1]))
        out[(gid, top["n"])] = "potd"
    return out


def _mp(p):
    return p.get("mp") or 0


def _gs(p):
    return p.get("gs") or 0


def game_slayer(players):
    """The least likely duel win in a game, as the site's gameSlayer: 12+ minutes each, a 10+ Game Score winner."""
    best = None
    for a in players:
        for b in players:
            if _mp(a) >= 12 and _mp(b) >= 12 and _gs(a) >= 10 and _gs(a) > _gs(b) and b["pre"] > a["pre"]:
                if best is None or b["pre"] - a["pre"] > best[2]:
                    best = (a, b, b["pre"] - a["pre"])
    return best


DUEL_MIN_GS, DUEL_MIN_MP = 10, 20


def _duel_ok(p):
    return _gs(p) >= DUEL_MIN_GS and (p.get("mp") is None or p["mp"] >= DUEL_MIN_MP)


def game_duel(players):
    """Two highly rated opponents who both played well, as the site's gameDuel: every cross-team pair with
    20+ minutes (where recorded) and a 10+ Game Score each, scored on its weaker side:
    the lower Game Score x (the lower pre-game Elo / 2,500). Winner = the higher Game Score."""
    best = None
    for a in players:
        if not _duel_ok(a):
            continue
        for b in players:
            if b["t"] == a["t"] or not _duel_ok(b) or b["n"] <= a["n"]:
                continue
            score = min(_gs(a), _gs(b)) * (min(a["pre"], b["pre"]) / 2500)
            if best is None or score > best[2]:
                best = (a, b, score)
    if best is None:
        return None
    a, b, score = best
    if _gs(b) > _gs(a):
        a, b = b, a
    return (a, b, score)


def day_duels(games):
    """Duel of the Day (the best duel score) and Giant-Slayer of the Day (widest Elo gap), by date."""
    out = {}
    for g in games:
        cur = out.setdefault(g["date"], {})
        sl = game_slayer(g["players"])
        if sl and ("slayer" not in cur or sl[2] > cur["slayer"][3]):
            cur["slayer"] = (g, sl[0], sl[1], sl[2])
        du = game_duel(g["players"])
        if du and ("duel" not in cur or du[2] > cur["duel"][3]):
            cur["duel"] = (g, du[0], du[1], du[2])
    return out


class Top:
    """The n highest-scoring items seen, kept in a heap."""
    def __init__(self, n=125):   # the league binders' size: one GOAT, four Icons, 15 Legends, 30 Standouts, 75 Rares
        self.n, self.h, self.c = n, [], itertools.count()

    def add(self, score, make):
        if len(self.h) < self.n:
            heapq.heappush(self.h, (score, next(self.c), make()))
        elif score > self.h[0][0]:
            heapq.heapreplace(self.h, (score, next(self.c), make()))

    def items(self):
        return [x[2] for x in sorted(self.h, key=lambda x: (-x[0], x[1]))]


def stat_feat(p):
    """Rare stat lines for the league-wide stat set: 60 points, a quadruple-double, 40 rebounds, 25 assists."""
    tens = sum(1 for k in ("pts", "trb", "ast", "stl", "blk") if (p.get(k) or 0) >= 10)
    return (p.get("pts") or 0) >= 60 or tens >= 4 or (p.get("trb") or 0) >= 40 or (p.get("ast") or 0) >= 25


def bands(games):
    """Playoff round label per (game id, team), as the site's postBand. NBA and ABA playoffs are separate."""
    out = {}
    for aba in (False, True):
        out.update(_bands([g for g in games if ("@" in g["teams"][0]) == aba]))
    return out


def _bands(games):
    post = sorted((g for g in games if g.get("post")), key=lambda g: (g["date"], g["id"]))
    if not post:
        return {}
    from datetime import date
    start = date.fromisoformat(post[0]["date"])
    series = defaultdict(list)
    for g in post:
        series[frozenset(g["teams"])].append(g)
    play_in = {k for k, ss in series.items() if len(ss) == 1 and (date.fromisoformat(ss[0]["date"]) - start).days <= 6}

    def path(team):
        opps = []
        for g in post:
            if team in g["teams"]:
                o = [x for x in g["teams"] if x != team][0]
                if o not in opps and frozenset((team, o)) not in play_in:
                    opps.append(o)
        return opps
    last = post[-1]
    rounds = len(path(last["teams"][0]))
    out = {}
    for g in post:
        for t in g["teams"]:
            o = [x for x in g["teams"] if x != t][0]
            key = frozenset((t, o))
            if key in play_in:
                out[(g["id"], t)] = {"level": "r1", "label": "Play-In", "champ": False}
                continue
            r = path(t).index(o) + 1 if o in path(t) else 1
            ss = series[key]
            k = [x["id"] for x in ss].index(g["id"]) + 1
            finals = last in ss
            cf = not finals and rounds >= 3 and r == rounds - 1
            i = g["teams"].index(t)
            champ = finals and g["id"] == last["id"] and g["pts"][i] > g["pts"][1 - i]
            out[(g["id"], t)] = {"level": "champ" if champ else "finals" if finals else "cf" if cf else "r2" if r >= 2 else "r1",
                                 "label": f"{'Finals' if finals else 'Conf. Finals' if cf else f'R{r}'} · G{k}", "champ": champ}
    return out


def card(season, teams, g, p, band, honor):
    t = p["t"]; i = g["teams"].index(t); o = g["teams"][1 - i]
    ti, oi = teams.get(t, {}), teams.get(o, {})
    return {"s": season, "id": g["id"], "date": g["date"], "t": t, "tn": ti.get("name", t), "tc": ti.get("color"),
            "o": o, "on": oi.get("name", o), "oc": oi.get("color"),
            "home": None if g.get("home") is None else g["home"] == t, "won": g["pts"][i] > g["pts"][1 - i],
            "score": f"{g['pts'][i]}–{g['pts'][1 - i]}", "ot": g.get("ot") or "", "band": band, "honor": honor,
            "row": {k: (round(p[k], 1) if isinstance(p.get(k), float) else p.get(k)) for k in ROW_KEYS}}


def end_heater(L, h):
    """A run of straight Elo gains is over: 5+ games makes it a Heater, its last game's card with the run attached."""
    c = h.get("card")
    if not c or (h.get("n") or 0) < 5:
        return
    post = c["row"]["post"]
    L["heaters"].add(h["n"] + (post - h["e0"]) / 1e5, lambda: {**c, "heat": {"n": h["n"], "from": h["from"], "e0": round(h["e0"], 1), "e1": round(post, 1)}})


def main():
    tm = json.loads((EXP / "timemachine.json").read_text(encoding="utf-8"))
    TC = tm["cols"]
    champs = {(r[TC.index("s")], r[TC.index("t")]) for r in tm["teams"] if r[TC.index("champ")]}

    players = {}                     # name -> state
    L = {"games": Top(), "swings": Top(), "slayers": Top(), "duels": Top(), "heaters": Top(), "stat": [], "crowns": []}
    heat = {}    # player -> the run of straight Elo gains he's on: {"from", "e0", "card"} (its latest game's card)
    fr = defaultdict(lambda: {"seasons": [], "peak": {}, "games": defaultdict(int), "best_gs": None, "most_pts": None, "sig": {},
                              "first": None, "clinch": [], "peak_elo": None, "swing": None})
    files = sorted(EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json"))
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        C, season, teams = d["cols"], d["season"], d["teams"]
        games = sorted(d["games"], key=lambda g: (g["date"], g["id"]))
        for g in games:
            g["players"] = [dict(zip(C, r)) for r in g["rows"]]
        hon, bnd = honors(games), bands(games)
        potg = defaultdict(lambda: defaultdict(int))
        best_team = {}
        for g in games:
            gtop = {}   # each team's Player of the Game, for franchise milestones
            for p in g["players"]:
                if p["t"] not in gtop or night(p) > night(gtop[p["t"]]):
                    gtop[p["t"]] = p
            for t, p in gtop.items():
                F = fr[MERGE.get(t, t)]
                b = bnd.get((g["id"], t))
                if F["first"] is None or (b and b["champ"]):
                    c = card(season, teams, g, p, b, hon.get((g["id"], p["n"])))
                    if F["first"] is None:
                        F["first"] = c
                    if b and b["champ"]:
                        F["clinch"].append(c)
            for p in g["players"]:
                key = (g["id"], p["n"])
                c = None

                def mk():
                    return card(season, teams, g, p, bnd.get((g["id"], p["t"])), hon.get(key))
                st = players.setdefault(p["n"], {"games": 0, "seasons": {}, "ms": {}})
                st["games"] += 1
                ss = st["seasons"].setdefault(season, {"s": season, "teams": [], "n": 0, "rs": 0, "po": 0, "tiers": [0] * 5,
                                                       "start": p["pre"], "end": p["post"], "peak": p["post"], "champ": False, "best": None, "_gs": -1e9})
                if p["t"] not in ss["teams"]:
                    ss["teams"].append(p["t"])
                ss["n"] += 1; ss["po" if g.get("post") else "rs"] += 1
                ss["tiers"][tier(p.get("lrp") if p.get("lrp") is not None else p.get("lr"))] += 1
                ss["end"] = p["post"]; ss["peak"] = max(ss["peak"], p["post"])
                gs = p["gs"] or 0
                if gs > ss["_gs"]:
                    ss["_gs"] = gs; ss["best"] = c = c or mk()
                ms = st["ms"]
                if "debut" not in ms:
                    ms["debut"] = (0, c or mk()); c = ms["debut"][1]
                for k, v in (("high_pts", p["pts"] or 0), ("best_gs", gs), ("peak_elo", p["post"]),
                             ("best_rank", -(p["lrp"] if p.get("lrp") is not None else 1e9)), ("swing", p["post"] - p["pre"])):
                    if k not in ms or v > ms[k][0]:
                        ms[k] = (v, c or mk()); c = ms[k][1]
                L["games"].add(gs, lambda: c or mk())
                L["swings"].add(p["post"] - p["pre"], lambda: c or mk())
                # Heaters: each run of 5+ straight Elo gains, as the card of its last game (ties: the bigger climb)
                hs = p.get("hs") or 0
                if hs == 1:
                    heat[p["n"]] = {"from": g["date"], "e0": p["pre"]}
                if hs >= 5 and p["n"] in heat:
                    heat[p["n"]]["card"] = c or mk()
                    heat[p["n"]]["n"] = hs
                if hs == 0 and p["n"] in heat:
                    end_heater(L, heat.pop(p["n"]))
                if stat_feat(p):
                    L["stat"].append(c or mk())
                # First time at No. 1, once he has 100 games (opening weeks of the first seasons rank tiny samples)
                if p.get("lrp") == 1 and "crown" not in st and (p.get("gp") or 0) >= 100:
                    st["crown"] = True
                    L["crowns"].append(c or mk())
                b = bnd.get((g["id"], p["t"]))
                if b and b["champ"] and "title" not in ms:
                    ms["title"] = (0, c or mk())
                # franchise
                fc = MERGE.get(p["t"], p["t"])
                F = fr[fc]
                F["games"][p["n"]] += 1
                if p["post"] > F["peak"].get(p["n"], (0,))[0]:
                    F["peak"][p["n"]] = (p["post"], season)
                # a player's best game in this uniform only, so a traded season counts for each team separately
                if p["n"] not in F["sig"] or gs > F["sig"][p["n"]][0]:
                    F["sig"][p["n"]] = (gs, c or mk()); c = F["sig"][p["n"]][1]
                if F["best_gs"] is None or gs > F["best_gs"][0]:
                    F["best_gs"] = (gs, c or mk())
                if F["most_pts"] is None or (p["pts"] or 0) > F["most_pts"][0]:
                    F["most_pts"] = (p["pts"] or 0, c or mk()); c = F["most_pts"][1]
                if F["peak_elo"] is None or p["post"] > F["peak_elo"][0]:
                    F["peak_elo"] = (p["post"], c or mk()); c = F["peak_elo"][1]
                if F["swing"] is None or p["post"] - p["pre"] > F["swing"][0]:
                    F["swing"] = (p["post"] - p["pre"], c or mk()); c = F["swing"][1]
                if hon.get(key) in ("potg", "potd"):
                    potg[p["t"]][p["n"]] += 1
                if p["t"] not in best_team or gs > best_team[p["t"]][0]:
                    best_team[p["t"]] = (gs, c or mk())
        for day in day_duels(games).values():
            for k in ("duel", "slayer"):
                if k not in day:
                    continue
                g, a, b, _ = day[k]
                entry = {"k": k, "s": season, "id": g["id"], "date": g["date"],
                         "a": card(season, teams, g, a, bnd.get((g["id"], a["t"])), hon.get((g["id"], a["n"]))),
                         "b": card(season, teams, g, b, bnd.get((g["id"], b["t"])), hon.get((g["id"], b["n"])))}
                for who in ((a, b) if k == "duel" else (a,)):
                    players[who["n"]].setdefault("duels", []).append(entry)
                if k == "slayer":
                    L["slayers"].add(_, lambda e=entry: {**e, "gap": round(_, 1)})
                else:
                    L["duels"].add(_, lambda e=entry, sc=_: {**e, "score": round(sc, 1)})
        for t, info in teams.items():
            fc = MERGE.get(t, t)
            top = max(potg[t].items(), key=lambda x: x[1]) if potg[t] else None
            fr[fc]["seasons"].append({"s": season, "code": t, "name": info["name"], "color": info.get("color"), "w": info.get("w", 0),
                                      "l": info.get("l", 0), "pw": info.get("pw", 0), "pl": info.get("pl", 0),
                                      "champ": (season, t) in champs, "potg": list(top) if top else None,
                                      "best": best_team.get(t, (0, None))[1]})
        for p_name, st in players.items():
            s = st["seasons"].get(season)
            if s and any((season, t) in champs for t in s["teams"]):
                s["champ"] = True
        print(f"  {season}", end="\r")

    # The newest season is in progress until its title is decided
    newest = d["season"]
    if not any(s_ == newest for s_, _ in champs):
        for F in fr.values():
            if F["seasons"] and F["seasons"][-1]["s"] == newest:
                F["seasons"][-1]["live"] = True
    (OUT / "p").mkdir(parents=True, exist_ok=True); (OUT / "f").mkdir(parents=True, exist_ok=True)
    for name, st in players.items():
        seasons = []
        for s in st["seasons"].values():
            s.pop("_gs")
            for k in ("start", "end", "peak"):
                s[k] = round(s[k], 1)
            seasons.append(s)
        out = {"name": name, "games": st["games"], "seasons": seasons,
               "milestones": {k: v[1] for k, v in st["ms"].items()}, "duels": st.get("duels", [])}
        (OUT / "p" / f"{slug(name)}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for code, F in fr.items():
        if not F["seasons"]:
            continue
        last = F["seasons"][-1]
        legends = sorted(F["peak"].items(), key=lambda x: -x[1][0])[:12]
        leg = [{"n": n, "peak": round(e, 1), "s": s, "games": F["games"][n]} for n, (e, s) in legends]
        sig = [F["sig"][l["n"]][1] for l in leg[:3] if l["n"] in F["sig"]]
        best_rec = max(F["seasons"], key=lambda s: (s["w"] / max(1, s["w"] + s["l"]), s["w"]) if s["w"] + s["l"] >= 20 else (0, 0))
        most = max(F["games"].items(), key=lambda x: x[1])
        out = {"code": code, "name": last["name"], "color": last["color"], "titles": [s["s"] for s in F["seasons"] if s["champ"]],
               "seasons": F["seasons"], "legends": leg, "signature": sig,
               "records": {"best_record": {"s": best_rec["s"], "w": best_rec["w"], "l": best_rec["l"]},
                           "most_cards": {"n": most[0], "games": most[1]},
                           "best_gs": F["best_gs"][1], "most_pts": F["most_pts"][1]},
               "milestones": {"first": F["first"], "clinch": F["clinch"], "peak_elo": F["peak_elo"][1], "swing": F["swing"][1]}}
        (OUT / "f" / f"{code.replace('@', '_')}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for h in heat.values():
        end_heater(L, h)
    # League-wide sets for the Binders page
    debuts = Top()
    for st in players.values():
        if "debut" in st["ms"]:
            c = st["ms"]["debut"][1]
            debuts.add(c["row"]["gs"] or 0, lambda c=c: c)
    by_peak = sorted(players.values(), key=lambda st: -st["ms"]["peak_elo"][0])[:125]
    titles = sorted((c for F in fr.values() for c in F["clinch"]), key=lambda c: c["date"])
    # Current franchises: played this season or last (a season a few days old hasn't seen every team yet)
    recent = {f.stem for f in files[-2:]}
    franchises = []
    for code, F in fr.items():
        if not F["seasons"]:
            continue
        last = F["seasons"][-1]
        franchises.append({"code": code, "name": last["name"], "color": last["color"], "titles": sum(1 for x in F["seasons"] if x["champ"]),
                           "first": F["seasons"][0]["s"], "last": last["s"], "active": last["s"] in recent})
    league = {"franchises": sorted(franchises, key=lambda x: x["name"]),
              "sets": {"titles": titles, "debuts": debuts.items(), "games": L["games"].items(), "stat": L["stat"], "crowns": L["crowns"],
                       "peaks": [st["ms"]["peak_elo"][1] for st in by_peak], "swings": L["swings"].items(),
                       "slayers": L["slayers"].items(), "duels": L["duels"].items(), "heaters": L["heaters"].items()}}
    (OUT / "league.json").write_text(json.dumps(league, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  Binders: {len(players):,} players, {len(fr)} franchises, league sets " +
          ", ".join(f"{k} {len(v)}" for k, v in league["sets"].items()) + "            ")


if __name__ == "__main__":
    main()
    # The daily-pack card pool reads the same season files; build it in the same step (nightly included)
    from build_packs import main as build_packs
    build_packs()
    from build_honors import publish as build_honors   # All-Star, All-League and MVP for Season cards (the specials read them)
    build_honors()
    from build_specials import main as build_specials
    build_specials()
