"""
build_season_binders.py — the Binder Room's season shelf: one binder per league season (BAA, NBA, ABA).

Reads the Season Explorer files and timemachine.json. Writes:

  explorer/binders/seasons.json        the shelf: [{"key", "s", "lg", "champ", "cn", "cc", "potd", "potw", "live"}]
  explorer/binders/lg/<key>.json       one per binder, key = <season>-<league>, e.g. 1971-72-ABA:
      {"key", "s", "lg", "champ", "cn", "cc", "live",
       "potd": [card, ...]    the Player of the Day for every day the league played, as build_binders.card()
       "potw": [potw, ...]}   the Player of the Week for every Monday–Sunday week, as the site's weekLine()

Both are scored the way the site scores them: Game Score plus a sixth of the Elo change.
Each league is scored on its own games, so in the NBA–ABA years each league has its own Player of the Day.
A Player of the Week needs two games that week; a week where nobody played twice has no card.

build_binders.py runs this at the end; on its own:  python3 scripts/build_season_binders.py
"""
import json, sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_binders import EXP, OUT, night, bands, card   # noqa: E402


def r1(v):
    return round(v + 0.0, 1)


def league_of(season_leagues, g):
    if "@" in g["teams"][0]:
        return "ABA"
    return "BAA" if season_leagues == ["BAA"] else "NBA"


def week_of(d):
    x = date.fromisoformat(d)
    return (x - timedelta(days=x.weekday())).isoformat()


def week_line(week, games):
    """One player's week as the site's weekLine: per-game averages, the week's games and its best night."""
    G = sorted(games, key=lambda c: c["date"]); last = G[-1]; n = len(G)
    sm = lambda k: sum(c["row"].get(k) or 0 for c in G)
    top = max(G, key=lambda c: c["row"].get("gs") or 0)
    return {"kind": "potw", "tier": "potw", "week": week, "end": (date.fromisoformat(week) + timedelta(days=6)).isoformat(),
            "s": last["s"], "n": last["row"]["n"], "t": last["t"], "tn": last["tn"], "tc": last["tc"], "pos": last["row"].get("pos"),
            "gp": n, "w": sum(1 for c in G if c["won"]), "pts": r1(sm("pts") / n), "trb": r1(sm("trb") / n), "ast": r1(sm("ast") / n),
            "gs": r1(sm("gs") / n), "score": r1(sum(night(c["row"]) for c in G)), "elo": [r1(G[0]["row"]["pre"]), r1(last["row"]["post"])],
            "lrp": last["row"].get("lrp"),
            "games": [{"date": c["date"], "o": c["o"], "home": c["home"], "won": c["won"], "score": c["score"], "pts": c["row"].get("pts"),
                       "trb": c["row"].get("trb"), "ast": c["row"].get("ast"), "gs": c["row"].get("gs"), "d": r1(c["row"]["post"] - c["row"]["pre"])} for c in G],
            "best": {"date": top["date"], "o": top["o"], "pts": top["row"].get("pts"), "gs": top["row"].get("gs")}}


def main():
    tm = json.loads((EXP / "timemachine.json").read_text(encoding="utf-8"))
    TC = tm["cols"]
    champ = {(r[TC.index("s")], r[TC.index("lg")]): r for r in tm["teams"] if r[TC.index("champ")]}
    seasons = {x["season"]: x.get("leagues") or ["NBA"] for x in json.loads((EXP / "index.json").read_text(encoding="utf-8"))["seasons"]}
    (OUT / "lg").mkdir(parents=True, exist_ok=True)
    shelf = []
    for f in sorted(EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        s, C, teams = d["season"], d["cols"], d["teams"]
        for g in d["games"]:
            g["players"] = [dict(zip(C, r)) for r in g["rows"]]
        band = bands(d["games"])
        by_lg = defaultdict(list)
        for g in d["games"]:
            by_lg[league_of(seasons.get(s, ["NBA"]), g)].append(g)
        for lg, games in sorted(by_lg.items()):
            days = defaultdict(list)
            for g in games:
                days[g["date"]].extend((g, p) for p in g["players"] if p.get("gs") is not None and p.get("pre") is not None)
            potd, weeks = [], defaultdict(lambda: defaultdict(list))
            for day in sorted(days):
                g, p = max(days[day], key=lambda x: night(x[1]))
                potd.append(card(s, teams, g, p, band.get((g["id"], p["t"])), "potd"))
                for g2, p2 in days[day]:
                    if (p2.get("mp") or 0) > 0 or p2.get("mp") is None:
                        weeks[week_of(day)][p2["n"]].append(card(s, teams, g2, p2, None, None))
            potw = []
            for wk in sorted(weeks):
                q = [L for L in weeks[wk].values() if len(L) >= 2]
                if q:
                    potw.append(week_line(wk, max(q, key=lambda L: sum(night(c["row"]) for c in L))))
            ch = champ.get((s, lg))
            if ch:
                ct, cn, cc = ch[TC.index("t")], ch[TC.index("name")], ch[TC.index("color")]
            else:
                # Seasons the Time Machine doesn't cover (the ABA's last): the winner of the league's last playoff game, once the finals are won
                ct = cn = cc = None
                post = sorted((g for g in games if g.get("post")), key=lambda g: (g["date"], g["id"]))
                if post and s != max(seasons):
                    last = post[-1]; ct = last["teams"][0 if last["pts"][0] > last["pts"][1] else 1]
                    cn, cc = teams.get(ct, {}).get("name", ct), teams.get(ct, {}).get("color")
            head = {"key": f"{s}-{lg}", "s": s, "lg": lg, "champ": ct, "cn": cn, "cc": cc, "live": not ct}
            (OUT / "lg" / f"{s}-{lg}.json").write_text(json.dumps({**head, "potd": potd, "potw": potw}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            shelf.append({**head, "potd": len(potd), "potw": len(potw)})
    (OUT / "seasons.json").write_text(json.dumps(shelf, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(shelf)} season binders · {sum(x['potd'] for x in shelf):,} Player of the Day cards · {sum(x['potw'] for x in shelf):,} Player of the Week cards")
    for x in shelf:
        if not x["champ"]:
            print("no champion:", x["key"])


if __name__ == "__main__":
    main()
