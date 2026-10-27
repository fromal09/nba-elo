"""
build_packs.py — the card pool that daily packs draw from (opened server-side by api/collect.js).

Every player-game with minutes is a card. Cards are grouped by tier (the card's frame: the player's
league rank after the game, as on the site) and stored in small shards, so opening a pack reads a few
hundred KB instead of whole seasons. Shards are cut by season in game order, so a nightly update only
rewrites the newest season's last shard of each tier.

Writes, under public/data/explorer/packs/:
  index.json  {"cols": [...], "tiers": {tier: [[file, count], ...]}, "total": n,
               "recent": {"date", "teams", "rows": [...]}}     recent = the latest day's cards
  <tier>/<season>-<k>.json  {"s", "teams": {code: [name, color]}, "rows": [[...], ...]}
  team/<FRANCHISE>/<tier>-<k>.json  the weekly team pack's pool: one franchise's cards across every season
                            {"teams": {"<season>|<code>": [name, color]}, "rows": [...]}   index.json "teams": {franchise: {tier: [[file, n]]}}

A row (cols): s, id, date, t, o, home, won, us, them, ot, band, honor, n, pos, mp, pts, trb, ast, stl, blk, tp, gs, pre, post, lr, lrp, fx, gp
(gp = the player's career game number, so 1 is his debut)

Also writes the personal-binder checklists, which count players (own any card of a player and he's checked off):
  explorer/binders/checklist.json  {"franchises": {franchise: {"name": latest name, "players": all-time count,
                                     "seasons": {season: [players, team name that season]}}}, "seasons": {season: players}}
  explorer/binders/roster/<FRANCHISE>.json  {season: [[name, games, pos], ...]} most games first
  explorer/packs/days/<YYYY-MM-DD>.json  every card from one day of the current season, for prediction rewards
                                         {"date", "teams": {code: [name, color]}, "rows": [...], "duel": the Duel of the Day
                                          as in league.json ({"k", "s", "id", "date", "a": card, "b": card, "score"}) or absent}
  explorer/packs/onthisday/<MM-DD>.json  the store's On This Day pool: the 40 best cards (by Game Score) of each tier
                                         from games on that calendar date, every year {"teams": {"season|code": [...]}, "tiers": {tier: [row, ...]}}
band = [level, label, champ] or null; honor = "potd" | "potg" | null

Run after build_binders.py (it calls this at the end):  python3 scripts/build_packs.py
"""
import heapq, itertools, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_binders import honors, bands, day_duels, card   # noqa: E402  (same Player of the Game / Day, playoff and duel rules)

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "public" / "data" / "explorer"
OUT = EXP / "packs"
TIERS = [("goat", 1), ("icon", 5), ("legend", 20), ("standout", 50), ("rare", 125)]
COLS = ["s", "id", "date", "t", "o", "home", "won", "us", "them", "ot", "band", "honor", "n", "pos", "mp",
        "pts", "trb", "ast", "stl", "blk", "tp", "gs", "pre", "post", "lr", "lrp", "fx", "gp"]
SHARD = 3000   # cards per shard
# ABA teams that joined the NBA count toward their franchise, as in the franchise binders
MERGE = {"DEN@ABA": "DEN", "IND@ABA": "IND", "SAS@ABA": "SAS", "BKN@ABA": "BKN"}


def tier(p):
    rank = p.get("lrp") if p.get("lrp") is not None else p.get("lr")
    if rank is None:
        return "common"
    for name, top in TIERS:
        if rank <= top:
            return name
    return "common"


def r1(v):
    return round(v, 1) if isinstance(v, float) else v


def row(season, g, p, band, honor):
    i = g["teams"].index(p["t"])
    b = [band["level"], band["label"], band["champ"]] if band else None
    home = None if g.get("home") is None else g["home"] == p["t"]
    return [season, g["id"], g["date"], p["t"], g["teams"][1 - i], home, g["pts"][i] > g["pts"][1 - i], g["pts"][i], g["pts"][1 - i],
            g.get("ot") or "", b, honor, p["n"], p.get("pos"), r1(p.get("mp")), p.get("pts"), p.get("trb"), p.get("ast"),
            p.get("stl"), p.get("blk"), p.get("tp"), r1(p.get("gs")), r1(p["pre"]), r1(p["post"]), p.get("lr"), p.get("lrp"), p.get("fx"), p.get("gp")]


def main():
    files = sorted(EXP.glob("[12][0-9][0-9][0-9]-[0-9][0-9].json"))
    index = {"cols": COLS, "tiers": {}, "total": 0, "teams": {}}
    by_team = {}      # (franchise, tier) -> rows, as JSON text to keep memory down
    team_names = {}   # franchise -> {"season|code": [name, color]}
    roster = {}       # franchise -> season -> name -> [games, pos]
    season_players = {}
    written = set()
    otd = {}          # (MM-DD, tier) -> heap of (gs, n, row, names)
    otd_n = itertools.count()
    last_day, recent, recent_teams = "", [], {}
    day_pool = {}     # the newest season's cards by date
    for f in files:
        d = json.loads(f.read_text(encoding="utf-8"))
        C, season = d["cols"], d["season"]
        teams = {code: [t.get("name", code), t.get("color")] for code, t in d["teams"].items()}
        games = sorted(d["games"], key=lambda g: (g["date"], g["id"]))
        for g in games:
            g["players"] = [dict(zip(C, r)) for r in g["rows"]]
        hon, bnd = honors(games), bands(games)
        by_tier = {}
        for g in games:
            for p in g["players"]:
                if not (p.get("mp") or 0) > 0 and p.get("gs") is None:
                    continue
                r = row(season, g, p, bnd.get((g["id"], p["t"])), hon.get((g["id"], p["n"])))
                tr = tier(p)
                by_tier.setdefault(tr, []).append(r)
                fc = MERGE.get(p["t"], p["t"])
                by_team.setdefault((fc, tr), []).append(json.dumps(r, ensure_ascii=False, separators=(",", ":")))
                h = otd.setdefault((g["date"][5:], tr), [])
                item = (p.get("gs") or 0, next(otd_n), r, {f"{season}|{c}": teams.get(c, [c, None]) for c in (r[3], r[4])})
                if len(h) < 40:
                    heapq.heappush(h, item)
                elif item[0] > h[0][0]:
                    heapq.heapreplace(h, item)
                rs = roster.setdefault(fc, {}).setdefault(season, {"_name": teams.get(p["t"], [p["t"]])[0]})
                e = rs.setdefault(p["n"], [0, p.get("pos")]); e[0] += 1
                season_players.setdefault(season, set()).add(p["n"])
                names = team_names.setdefault(fc, {})
                for c in (r[3], r[4]):
                    names.setdefault(f"{season}|{c}", teams.get(c, [c, None]))
                if f == files[-1]:
                    dp = day_pool.setdefault(g["date"], {"date": g["date"], "teams": {}, "rows": []})
                    dp["rows"].append(r)
                    for c in (r[3], r[4]):
                        dp["teams"][c] = teams.get(c, [c, None])
                if g["date"] > last_day:
                    last_day, recent, recent_teams = g["date"], [], teams
                if g["date"] == last_day:
                    recent.append(r)
        if f == files[-1]:
            # The Duel of the Day, the card a perfect day of matchup picks wins
            for day, x in day_duels(games).items():
                if "duel" in x and day in day_pool:
                    g, a, b, sc = x["duel"]
                    day_pool[day]["duel"] = {"k": "duel", "s": season, "id": g["id"], "date": g["date"],
                                             "a": card(season, d["teams"], g, a, bnd.get((g["id"], a["t"])), hon.get((g["id"], a["n"]))),
                                             "b": card(season, d["teams"], g, b, bnd.get((g["id"], b["t"])), hon.get((g["id"], b["n"]))),
                                             "score": round(sc, 1)}
        for t, rows in by_tier.items():
            (OUT / t).mkdir(parents=True, exist_ok=True)
            for k in range(0, len(rows), SHARD):
                name = f"{t}/{season}-{k // SHARD}.json"
                chunk = rows[k:k + SHARD]
                used = {x[3] for x in chunk} | {x[4] for x in chunk}
                (OUT / name).write_text(json.dumps({"s": season, "teams": {c: teams.get(c, [c, None]) for c in used}, "rows": chunk},
                                                   ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                written.add(name)
                index["tiers"].setdefault(t, []).append([name, len(chunk)])
                index["total"] += len(chunk)
        print(f"  {season}", end="\r")
    # Team pools, chronological within each franchise and tier
    for (fc, tr), rows in sorted(by_team.items()):
        folder = fc.replace("@", "_")
        (OUT / "team" / folder).mkdir(parents=True, exist_ok=True)
        for k in range(0, len(rows), SHARD):
            name = f"team/{folder}/{tr}-{k // SHARD}.json"
            chunk = rows[k:k + SHARD]
            used = set()
            for line in chunk:
                x = json.loads(line); used.add(f"{x[0]}|{x[3]}"); used.add(f"{x[0]}|{x[4]}")
            body = '{"teams":' + json.dumps({u: team_names[fc][u] for u in used}, ensure_ascii=False, separators=(",", ":")) + ',"rows":[' + ",".join(chunk) + "]}"
            (OUT / name).write_text(body, encoding="utf-8")
            written.add(name)
            index["teams"].setdefault(fc, {}).setdefault(tr, []).append([name, len(chunk)])
    # On This Day: one file per calendar date
    (OUT / "onthisday").mkdir(parents=True, exist_ok=True)
    days = {}
    for (md, tr), h in otd.items():
        d = days.setdefault(md, {"teams": {}, "tiers": {}})
        for gs_, _, r, names in sorted(h, key=lambda x: -x[0]):
            d["tiers"].setdefault(tr, []).append(r)
            d["teams"].update(names)
    for md, d in days.items():
        name = f"onthisday/{md}.json"
        (OUT / name).write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        written.add(name)
    # Prediction rewards: one file per day of the newest season
    (OUT / "days").mkdir(parents=True, exist_ok=True)
    for day, d in day_pool.items():
        name = f"days/{day}.json"
        (OUT / name).write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        written.add(name)
    # Shards from an older cut that this build didn't write
    for old in list(OUT.glob("*/*.json")) + list(OUT.glob("team/*/*.json")):
        if old.relative_to(OUT).as_posix() not in written:
            old.unlink()
    check = {"franchises": {}, "seasons": {s_: len(v) for s_, v in season_players.items()}}
    (EXP / "binders" / "roster").mkdir(parents=True, exist_ok=True)
    for fc, seasons in roster.items():
        names, out = set(), {}
        for s_, rs in seasons.items():
            tn = rs.pop("_name")
            out[s_] = sorted(([n, g, pos] for n, (g, pos) in rs.items()), key=lambda x: (-x[1], x[0]))
            names.update(rs)
            check["franchises"].setdefault(fc, {"seasons": {}})["seasons"][s_] = [len(rs), tn]
        f = check["franchises"][fc]
        f["name"] = f["seasons"][max(f["seasons"])][1]
        f["players"] = len(names)
        (EXP / "binders" / "roster" / f"{fc.replace('@', '_')}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (EXP / "binders" / "checklist.json").write_text(json.dumps(check, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    index["recent"] = {"date": last_day, "teams": recent_teams, "rows": recent}
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {t: sum(n for _, n in v) for t, v in index["tiers"].items()}
    print(f"  Packs: {index['total']:,} cards in {len(written):,} shards · " + ", ".join(f"{t} {n:,}" for t, n in counts.items())
          + f" · {len(index['teams'])} team pools · last night {last_day}: {len(recent)} cards            ")


if __name__ == "__main__":
    main()
