"""
Historical headshots (proof of concept): a photo for players the live ESPN rosters don't cover, from two sources.

  1. NBA.com headshots, by NBA player ID. The ID list comes from the nba_api package (pip install nba_api), with
     stats.nba.com's all-time player list (career years) used to tell apart players who share a name. Each ID is checked
     against cdn.nba.com; NBA.com answers 403 for players it has no photo of.
  2. Wikimedia Commons, through Wikidata, for players NBA.com has no photo of: anyone with a Basketball-Reference player ID
     (P2685) and an image (P18). Freely licensed photos (not uniform headshots); the credit and license are kept with each.

Players match by name (the site's normalization); a name shared by two players in a source is matched by career years
when the source has them, and skipped otherwise.

Output: public/data/explorer/headshots_hist.json
  {normalized name: {"u": photo URL, "s": "nba" | "wiki", "c": credit, "l": license}}   (c and l for Wikimedia only)
The site merges it under the live ESPN headshots (live wins). Prints coverage by decade of each player's debut.

stats.nba.com often hangs on scripts, so it's skipped unless you ask for it (--years); without it, shared names that the
site also has more than once are skipped. Progress prints as it goes.

Run on a machine with internet access (it's not part of the nightly build):
  python3 -m pip install --break-system-packages nba_api
  python3 scripts/build_headshots.py && python3 scripts/sync_data.py push
"""
import json, re, socket, sys, time, unicodedata, urllib.parse, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
OUT = DATA / "explorer" / "headshots_hist.json"
UA = {"User-Agent": "Mozilla/5.0 (FPR headshots; https://nba-elo.vercel.app)"}
NBA_IMG = "https://cdn.nba.com/headshots/nba/latest/1040x760/{}.png"


def norm(s):
    """Same as the site's norm (src/components/predict.js, api/headshots.js)."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"[.'’]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    s = re.sub(r"\s*\(\d{4}\)$", "", s)
    s = re.sub(r"[^a-z ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def our_players():
    """Every player on the site: name, debut year and last year (from players.json)."""
    d = json.loads((DATA / "players.json").read_text(encoding="utf-8"))
    out = []
    for p in d["players"]:
        first = (p.get("team_history") or [[None]])[0][0]
        out.append({"name": p["name"], "key": norm(p["name"]), "from": int(first[:4]) if first else None,
                    "to": int((p.get("last_played") or "0")[:4]) or None})
    return out


def nba_ids(years=False):
    """NBA.com player IDs (the nba_api list), with career years from stats.nba.com when asked for (--years)."""
    from nba_api.stats.static import players as static
    base = {p["id"]: {"id": p["id"], "name": p["full_name"], "from": None, "to": None} for p in static.get_players()}
    print(f"  NBA.com: {len(base):,} players in the nba_api list", flush=True)
    if not years:
        return list(base.values())
    try:
        raw = get("https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=2025-26&IsOnlyCurrentSeason=0",
                  {"Referer": "https://www.nba.com/", "Origin": "https://www.nba.com", "Accept": "application/json",
                   "x-nba-stats-origin": "stats", "x-nba-stats-token": "true"}, timeout=20)
        rs = json.loads(raw)["resultSets"][0]
        h = rs["headers"]
        for r in rs["rowSet"]:
            x = dict(zip(h, r))
            pid = int(x["PERSON_ID"])
            e = base.setdefault(pid, {"id": pid, "name": x["DISPLAY_FIRST_LAST"], "from": None, "to": None})
            e["from"], e["to"] = int(x["FROM_YEAR"]), int(x["TO_YEAR"])
        print(f"  stats.nba.com: career years for {sum(1 for e in base.values() if e['from'])} players")
    except Exception as e:
        print(f"  stats.nba.com didn't answer ({e}); name-only matching for shared names")
    return list(base.values())


def match(ours, theirs, years=True):
    """our key -> their record. A name both sides have once matches directly. Otherwise careers decide: their player
    whose debut is within a year of ours. (Two of ours with one key and debuts a year apart are one player spelled two
    ways, like Sengun and Şengün.)"""
    by = defaultdict(list)
    for t in theirs:
        by[norm(t["name"])].append(t)
    mine = defaultdict(list)
    for p in ours:
        mine[p["key"]].append(p)
    out = {}
    for key, ps in mine.items():
        cands = by.get(key, [])
        if not cands:
            continue
        debuts = {p["from"] for p in ps if p["from"]}
        one_player = len(ps) == 1 or (debuts and max(debuts) - min(debuts) <= 1)
        if len(cands) == 1 and one_player:
            out[key] = cands[0]
        elif years and one_player and debuts:
            fit = [c for c in cands if c.get("from") and abs(c["from"] - min(debuts)) <= 1]
            if len(fit) == 1:
                out[key] = fit[0]
    return out


# cdn.nba.com stalls on requests that don't look like a browser, so ask like one: a GET for the first byte
IMG_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
               "Chrome/130.0.0.0 Safari/537.36", "Referer": "https://www.nba.com/", "Accept": "image/avif,image/webp,image/png,*/*",
               "Range": "bytes=0-0"}


def photo_status(pid, timeout=8):
    """The photo's size in bytes (an image came back), False (NBA.com has none), None (no answer). NBA.com sends the same
    silhouette for players it has no photo of, so the size tells real photos apart (see main)."""
    try:
        req = urllib.request.Request(NBA_IMG.format(pid), headers=IMG_HEADERS)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status not in (200, 206) or "image" not in r.headers.get("Content-Type", ""):
                return False
            total = (r.headers.get("Content-Range") or "").rsplit("/", 1)[-1]
            return int(total) if total.isdigit() else int(r.headers.get("Content-Length") or 1)
    except urllib.error.HTTPError as e:
        return False if e.code in (403, 404) else None
    except Exception:
        return None


def has_photo(pid):
    for i in range(2):
        y = photo_status(pid)
        if y is not None:
            return y
        time.sleep(1)
    return False


def wikidata():
    """Everyone on Wikidata with a Basketball-Reference player ID and a picture."""
    q = """SELECT ?item ?label ?image ?birth WHERE {
      ?item wdt:P2685 ?bbref ; wdt:P18 ?image .
      ?item rdfs:label ?label FILTER(lang(?label) = "en")
      OPTIONAL { ?item wdt:P569 ?birth }
    }"""
    print("  Wikidata: asking for every basketball player with a picture (up to 90 seconds)…", flush=True)
    raw = get("https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(q),
              {"Accept": "application/sparql-results+json"}, timeout=90)
    rows = json.loads(raw)["results"]["bindings"]
    out = []
    for r in rows:
        file = urllib.parse.unquote(r["image"]["value"].rsplit("/", 1)[-1])
        out.append({"name": r["label"]["value"], "file": file, "from": None})
    return out


def commons_credits(files):
    """Artist and license for each Commons file, 50 a request."""
    out = {}
    files = list(files)
    for i in range(0, len(files), 50):
        batch = files[i:i + 50]
        url = ("https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata"
               "&iiextmetadatafilter=Artist|LicenseShortName&titles=" + urllib.parse.quote("|".join("File:" + f for f in batch)))
        try:
            pages = json.loads(get(url))["query"]["pages"].values()
        except Exception as e:
            print(f"  Commons credits batch {i // 50}: {e}", flush=True)
            continue
        for pg in pages:
            meta = (pg.get("imageinfo") or [{}])[0].get("extmetadata", {})
            artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()
            out[pg["title"].replace("File:", "", 1)] = {"c": artist[:120], "l": meta.get("LicenseShortName", {}).get("value", "")}
    return out


def main():
    socket.setdefaulttimeout(30)   # nothing waits longer than this for a reply
    ours = our_players()
    print(f"{len(ours):,} players on the site", flush=True)
    result = {}

    # 1 · NBA.com
    ids = nba_ids(years="--years" in sys.argv)
    m = match(ours, ids)
    print(f"  NBA.com: {len(m):,} matched to an NBA ID; checking which have a photo…", flush=True)
    keys = list(m)
    # A known photo first (LeBron James, 2544): if cdn.nba.com won't answer this machine, don't check 4,900 one by one.
    # Every matched ID gets the NBA.com URL unchecked instead; the card shows initials when a photo doesn't load.
    probe = photo_status(2544, timeout=15)
    print(f"  NBA.com test photo: {'ok' if probe else 'no answer' if probe is None else 'refused'}", flush=True)
    if not probe or "--no-check" in sys.argv:
        print("  NBA.com: skipping the per-player check; using the NBA.com URL for every matched player", flush=True)
        ok = [True] * len(keys)
    else:
        sizes = []
        with ThreadPoolExecutor(32) as ex:
            for i, y in enumerate(ex.map(lambda k: has_photo(m[k]["id"]), keys), 1):
                sizes.append(y)
                if i % 500 == 0 or i == len(keys):
                    print(f"    {i:,} of {len(keys):,} checked", flush=True)
        # Real headshots all differ in size; one size shared by ten or more players is the no-photo silhouette
        common = Counter(x for x in sizes if x)
        fake = {sz for sz, n in common.items() if n >= 10}
        for sz in sorted(fake, key=lambda z: -common[z]):
            print(f"  NBA.com placeholder: {common[sz]:,} players get the same {sz:,}-byte image; treated as no photo", flush=True)
        ok = [bool(x) and x not in fake for x in sizes]
    for k, y in zip(keys, ok):
        if y:
            result[k] = {"u": NBA_IMG.format(m[k]["id"]), "s": "nba"}
    print(f"  NBA.com: {sum(ok):,} with a photo")

    # 2 · Wikimedia, for the rest
    try:
        wd = wikidata()
        rest = [p for p in ours if p["key"] not in result]
        w = match(rest, wd, years=False)
        print(f"  Wikimedia: {len(w):,} matched; getting photo credits…", flush=True)
        credits = commons_credits({x["file"] for x in w.values()})
        for k, x in w.items():
            cr = credits.get(x["file"].replace("_", " ")) or credits.get(x["file"]) or {}
            result[k] = {"u": "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(x["file"]) + "?width=500",
                         "s": "wiki", "c": cr.get("c", ""), "l": cr.get("l", "")}
        print(f"  Wikimedia: {len(w):,} more ({len(wd):,} basketball players with a picture on Wikidata)")
    except Exception as e:
        print(f"  Wikidata didn't answer ({e}); NBA.com photos only")

    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # Coverage by decade of debut
    print(f"\nCoverage: {len(result):,} of {len(ours):,} players ({len(result) / max(1, len(ours)):.0%})")
    print(f"  {'debut':<8}{'players':>8}{'NBA.com':>9}{'Wiki':>7}{'any':>7}")
    dec = defaultdict(lambda: [0, 0, 0])
    for p in ours:
        d = f"{(p['from'] or 0) // 10 * 10}s" if p["from"] else "?"
        dec[d][0] += 1
        s = result.get(p["key"], {}).get("s")
        if s == "nba": dec[d][1] += 1
        if s == "wiki": dec[d][2] += 1
    for d in sorted(dec):
        n, a, b = dec[d]
        print(f"  {d:<8}{n:>8}{a:>9}{b:>7}{(a + b) / n:>7.0%}")
    print(f"\nWrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
