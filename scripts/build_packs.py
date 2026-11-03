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

A row (cols): s, id, date, t, o, home, won, us, them, ot, band, honor, n, pos, mp, pts, trb, ast, stl, blk, tp, gs, pre, post, lr, lrp, fx, gp, hs, sw
(gp = the player's career game number, so 1 is his debut)

Also writes the personal-binder checklists, which count players (own any card of a player and he's checked off):
  explorer/binders/checklist.json  {"franchises": {franchise: {"name": latest name, "players": all-time count, "nba": [NBA seasons, NBA players],
                                     "seasons": {season: [players, team name that season]}}}, "seasons": {season: players}}
  explorer/binders/roster/<FRANCHISE>.json  {season: [[name, games, pos], ...]} most games first
  explorer/packs/days/<YYYY-MM-DD>.json  every card from one day of the current season, for prediction rewards
                                         {"date", "teams": {code: [name, color]}, "rows": [...], "duel": the Duel of the Day
                                          as in league.json ({"k", "s", "id", "date", "a": card, "b": card, "score"}) or absent}
  explorer/packs/holiday/<k>.json          every card from a holiday's games (hol_dates.py): {"teams", "tiers": {tier: [row]}}
  explorer/packs/players/<hash>.json      the card database: every card of one player, career order (hash = sha1 of the name, 12 hex)
                                         {"teams": {"<season>|<code>": [name, color]}, "rows": [...]}
  explorer/packs/players.json            the card database's player list: [[name, hash, first season, last season, cards, [franchises]]]
  explorer/packs/top.json                the card database's front page: the 3,000 best cards on record by points (A+, points.js)
                                         {"teams": {"<season>|<code>": [...]}, "rows": [...]}
  explorer/packs/onthisday/<MM-DD>.json  the store's On This Day pool: the 40 best cards (by Game Score) of each tier
                                         from games on that calendar date, every year {"teams": {"season|code": [...]}, "tiers": {tier: [row, ...]}}
band = [level, label, champ] or null; honor = "potd" | "potg" | null

Run after build_binders.py (it calls this at the end):  python3 scripts/build_packs.py
"""
import hashlib
import heapq, itertools, json, math, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_binders import honors, bands, day_duels, card   # noqa: E402  (same Player of the Game / Day, playoff and duel rules)
from hol_dates import holiday_of   # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "public" / "data" / "explorer"
OUT = EXP / "packs"
TIERS = [("goat", 1), ("icon", 5), ("legend", 20), ("standout", 50), ("rare", 125)]
COLS = ["s", "id", "date", "t", "o", "home", "won", "us", "them", "ot", "band", "honor", "n", "pos", "mp",
        "pts", "trb", "ast", "stl", "blk", "tp", "gs", "pre", "post", "lr", "lrp", "fx", "gp", "hs", "sw"]
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
            p.get("stl"), p.get("blk"), p.get("tp"), r1(p.get("gs")), r1(p["pre"]), r1(p["post"]), p.get("lr"), p.get("lrp"), p.get("fx"), p.get("gp"), p.get("hs") or 0, p.get("sw") or 0]


# A+ points for a game card (api/_lib/points.js), to rank the card database's front page. The site rescores every card
# itself; this only has to pick the right 3,000. Keep the tables in step with points.js.
GMSC_TAIL = [[2, 6.6], [3, 10.3], [5, 14.3], [7, 16.7], [10, 19.1], [15, 21.6], [20, 23.3], [30, 25.6], [50, 28.3], [70, 30.1],
             [100, 31.9], [150, 34.0], [200, 35.4], [300, 37.5], [500, 40.1], [700, 42.0], [1000, 43.8], [1500, 46.0], [2000, 47.5], [3000, 49.4],
             [5000, 52.0], [7000, 53.8], [10000, 55.6], [15000, 57.8], [20000, 59.8], [30000, 62.0], [50000, 64.0], [70000, 66.1], [100000, 68.7],
             [150000, 70.4], [200000, 71.2], [300000, 72.3], [500000, 72.5], [1500000, 86.8]]
SCARCITY = {"common": 1.0, "rare": 1.294, "standout": 2.033, "legend": 2.828, "icon": 4.98, "goat": 9.092}
OCCASION = {"r1": 1.15, "r2": 1.2, "cf": 1.3, "finals": 1.45, "champ": 2.0}


def gs_rarity(gs):
    if gs is None:
        return 1
    T = GMSC_TAIL
    if gs <= T[0][1]:
        return 1 + max(0, gs + 3) / (T[0][1] + 3)
    if gs >= T[-1][1]:
        return T[-1][0]
    i = 0
    while T[i + 1][1] <= gs:
        i += 1
    (n0, g0), (n1, g1) = T[i], T[i + 1]
    f = 1 if g1 == g0 else (gs - g0) / (g1 - g0)
    return 10 ** (math.log10(n0) + f * (math.log10(n1) - math.log10(n0)))


def proxy_points(p, band, honor, date=None):
    v = lambda k: p.get(k) or 0
    tens = sum(1 for k in ("pts", "trb", "ast", "stl", "blk") if v(k) >= 10)
    tw = sum(1 for k in ("pts", "trb", "ast") if v(k) >= 20)
    pts = v("pts")
    L = [gs_rarity(p.get("gs"))]
    for ok, n in ((pts >= 100, 1080000), (pts >= 80, 540000), (pts >= 70, 120000), (pts >= 60, 13500), (pts >= 50, 1800), (pts >= 40, 200)):
        if ok:
            L.append(n); break
    if v("trb") >= 30: L.append(7000)
    elif v("trb") >= 25: L.append(2500)
    if tens >= 5: L.append(1080000)
    elif tens == 4: L.append(270000)
    elif tens == 3: L.append(350)
    if tw >= 2: L.append(1500)
    if v("ast") >= 20: L.append(3000)
    if v("blk") >= 10: L.append(5000)
    if v("stl") >= 10: L.append(40000)
    if v("tp") >= 10: L.append(1500)
    if v("sw") == 2: L.append(8000)
    elif v("sw") == 1: L.append(2000)
    if all(v(k) >= 5 for k in ("pts", "trb", "ast", "stl", "blk")): L.append(30000)
    if honor == "potd": L.append(300)
    elif honor == "potg": L.append(20)
    if (v("fx") & 1) and v("gp") >= 20: L.append(v("gp"))
    L.sort(reverse=True)
    E = max(1, L[0]) ** 0.3
    for n in L[1:3]:
        E *= max(1, n) ** 0.075
    O = OCCASION.get(band["level"], 1.15) if band else 1
    if p.get("gp") == 1:
        O *= 1.4
    if date and holiday_of(date):
        O *= 1.1
    return 10 * SCARCITY[tier(p)] * E * O


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
    hol = {}          # holiday -> {"teams", "tiers": {tier: [row, ...]}}: every card from a holiday game, for the holiday pack
    last_day, recent, recent_teams = "", [], {}
    day_pool = {}     # the newest season's cards by date
    who = {}          # player -> tier -> shard -> [row, ...]: where wish lists find a player's cards
    db_rows = {}      # player -> [row as JSON text]: the card database, one file per player
    db_names = {}     # player -> {"season|code": [name, color]}
    db_meta = {}      # player -> [first season, last season, cards, {franchises}]
    top = []          # heap of (points, n, row, names): the card database's front page
    top_n = itertools.count()
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
                line = json.dumps(r, ensure_ascii=False, separators=(",", ":"))
                by_team.setdefault((fc, tr), []).append(line)
                db_rows.setdefault(p["n"], []).append(line)
                dn = db_names.setdefault(p["n"], {})
                for c in (r[3], r[4]):
                    dn.setdefault(f"{season}|{c}", teams.get(c, [c, None]))
                m = db_meta.setdefault(p["n"], [season, season, 0, set()])
                m[1] = season; m[2] += 1; m[3].add(fc)
                band_ = bnd.get((g["id"], p["t"]))
                item = (proxy_points(p, band_, hon.get((g["id"], p["n"])), g["date"]), next(top_n), r, {f"{season}|{c}": teams.get(c, [c, None]) for c in (r[3], r[4])})
                if len(top) < 3000:
                    heapq.heappush(top, item)
                elif item[0] > top[0][0]:
                    heapq.heapreplace(top, item)
                hk = holiday_of(g["date"])
                if hk:
                    hd = hol.setdefault(hk, {"teams": {}, "tiers": {}})
                    hd["tiers"].setdefault(tr, []).append(r)
                    for c in (r[3], r[4]):
                        hd["teams"][f"{season}|{c}"] = teams.get(c, [c, None])
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
                base = name[len(t) + 1:-5]
                for j, x in enumerate(chunk):
                    who.setdefault(x[12], {}).setdefault(t, {}).setdefault(base, []).append(j)
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
    # Holiday packs: every card from each holiday's games
    (OUT / "holiday").mkdir(parents=True, exist_ok=True)
    for hk, d in hol.items():
        name = f"holiday/{hk}.json"
        (OUT / name).write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        written.add(name)
    index["holidays"] = {hk: sum(len(v) for v in d["tiers"].values()) for hk, d in hol.items()}
    # Prediction rewards: one file per day of the newest season
    (OUT / "days").mkdir(parents=True, exist_ok=True)
    for day, d in day_pool.items():
        name = f"days/{day}.json"
        (OUT / name).write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        written.add(name)
    # Each player's cards, one small file per player (the name's hash), for wish lists
    (OUT / "who").mkdir(parents=True, exist_ok=True)
    for n, tiers in who.items():
        name = f"who/{hashlib.sha1(n.encode('utf-8')).hexdigest()[:12]}.json"
        body = json.dumps(tiers, ensure_ascii=False, separators=(",", ":"))
        f_ = OUT / name
        if not f_.exists() or f_.read_text(encoding="utf-8") != body:   # unchanged files keep their date, so the sync skips them
            f_.write_text(body, encoding="utf-8")
        written.add(name)
    # The card database: every card of each player (written only when it changed, so the sync skips the rest), the player
    # list for search, and the 3,000 best cards on record
    (OUT / "players").mkdir(parents=True, exist_ok=True)
    plist = []
    for n, lines in db_rows.items():
        h = hashlib.sha1(n.encode("utf-8")).hexdigest()[:12]
        name = f"players/{h}.json"
        body = '{"teams":' + json.dumps(db_names[n], ensure_ascii=False, separators=(",", ":")) + ',"rows":[' + ",".join(lines) + "]}"
        f_ = OUT / name
        if not f_.exists() or f_.read_text(encoding="utf-8") != body:
            f_.write_text(body, encoding="utf-8")
        written.add(name)
        m = db_meta[n]
        plist.append([n, h, m[0], m[1], m[2], sorted(m[3])])
    plist.sort(key=lambda x: -x[4])
    (OUT / "players.json").write_text(json.dumps(plist, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    best = sorted(top, key=lambda x: -x[0])
    tnames = {}
    for _, _, _, nm in best:
        tnames.update(nm)
    (OUT / "top.json").write_text(json.dumps({"teams": tnames, "rows": [x[2] for x in best]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Shards from an older cut that this build didn't write
    for old in list(OUT.glob("*/*.json")) + list(OUT.glob("team/*/*.json")):
        if old.relative_to(OUT).as_posix() not in written and not old.relative_to(OUT).as_posix().startswith("special/"):
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
        # NBA history only (no BAA seasons, no ABA seasons), for Franchise History and Completed Franchise
        nba_s = [s_ for s_ in out if "@" not in fc and s_ >= ("1976-77" if fc in ("DEN", "IND", "SAS", "BKN") else "1949-50")]
        f["nba"] = [len(nba_s), len({r[0] for s_ in nba_s for r in out[s_]})]
        (EXP / "binders" / "roster" / f"{fc.replace('@', '_')}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (EXP / "binders" / "checklist.json").write_text(json.dumps(check, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    index["recent"] = {"date": last_day, "teams": recent_teams, "rows": recent}
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = {t: sum(n for _, n in v) for t, v in index["tiers"].items()}
    print(f"  Packs: {index['total']:,} cards in {len(written):,} shards · " + ", ".join(f"{t} {n:,}" for t, n in counts.items())
          + f" · {len(index['teams'])} team pools · last night {last_day}: {len(recent)} cards            ")


if __name__ == "__main__":
    main()
