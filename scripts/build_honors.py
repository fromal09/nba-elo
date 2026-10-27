"""Season honors for Season cards: All-Star, All-League team (All-NBA, All-BAA, All-ABA) and MVP.

  python3 scripts/build_honors.py <bball-reference-datasets/Data>   rebuild scripts/honors.json from the CSVs
  python3 scripts/build_honors.py                                   publish scripts/honors.json to the binders

Source: Sumitro Datta's Basketball-Reference datasets (github.com/sumitrodatta/bball-reference-datasets).
Names are matched to the site's names for each season; scripts/honors_extra.json adds or fixes entries by hand
(for example a new season's All-NBA teams before the dataset has them).

honors.json (and binders/honors.json): {"2015-16": {"Stephen Curry": "S1M"}}  S = All-Star, 1/2/3 = All-League team, M = MVP, A = ABA
"""
import csv, json, re, sys, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "public" / "data" / "explorer"
OUT = ROOT / "scripts" / "honors.json"
EXTRA = ROOT / "scripts" / "honors_extra.json"


def season_of(year):            # 2016 → "2015-16"
    y = int(year)
    return f"{y - 1}-{str(y)[2:]}"


def key(n):
    n = re.sub(r"\s*\(.*?\)", "", n)   # "Charles Smith (1988)": the site's tag for two players of one name
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    n = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", n)
    return re.sub(r"[^a-z]", "", n)


def site_names(season):
    f = EXP / f"{season}.json"
    if not f.exists():
        return None
    sd = json.loads(f.read_text())
    i = sd.get("cols", ["n"]).index("n")
    return {r[i] for g in sd.get("games", []) for r in g.get("rows", [])}


# Basketball-Reference name → the site's name, where they differ
ALIASES = {"Tiny Archibald": ["Nate Archibald"], "Steve Smith": ["Steven Smith"], "Clifford Robinson": ["Cliff Robinson"],
           "Anfernee Hardaway": ["Penny Hardaway"], "World B. Free": ["World Free", "Lloyd Free"], "Metta World Peace": ["Ron Artest"],
           "Nenê": ["Nene", "Nene Hilario"], "Mahmoud Abdul-Rauf": ["Chris Jackson"], "Jamaal Wilkes": ["Keith Wilkes"],
           "Michael Ray Richardson": ["Micheal Ray Richardson"], "Fat Lever": ["Lafayette Lever"]}


def build(src):
    """The CSVs → scripts/honors.json, in Basketball-Reference's names (matched to the site's at publish)."""
    src = Path(src)
    rows = {}

    def add(season, name, code, aba):
        s = rows.setdefault(season, {}).setdefault(name, set())
        s.add(code)
        if aba:
            s.add("A")

    for r in csv.DictReader(open(src / "All-Star Selections.csv", encoding="utf-8")):
        add(season_of(r["season"]), r["player"], "S", r["lg"] == "ABA")
    for r in csv.DictReader(open(src / "End of Season Teams.csv", encoding="utf-8")):
        if r["type"] in ("All-NBA", "All-BAA", "All-ABA"):
            add(season_of(r["season"]), r["player"], r["number_tm"][0], r["type"] == "All-ABA")
    for r in csv.DictReader(open(src / "Player Award Shares.csv", encoding="utf-8")):
        if r["award"] in ("nba mvp", "aba mvp") and r["winner"] == "TRUE":
            add(season_of(r["season"]), r["player"], "M", r["award"] == "aba mvp")
    out = {}
    for season, players in rows.items():
        for name, codes in players.items():
            team = min((c for c in codes if c in "123"), default="")   # one All-League team a season
            out.setdefault(season, {})[name] = ("S" if "S" in codes else "") + team + ("M" if "M" in codes else "") + ("A" if "A" in codes else "")
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
    print(f"honors: {sum(len(v) for v in out.values())} player-seasons over {len(out)} seasons from {src}")


def publish(verbose=False):
    """scripts/honors.json + honors_extra.json, matched to each season's names → binders/honors.json"""
    src = json.loads(OUT.read_text()) if OUT.exists() else {}
    if EXTRA.exists():
        for season, players in json.loads(EXTRA.read_text()).items():
            if not season.startswith("_"):
                src.setdefault(season, {}).update(players)
    out, miss = {}, []
    for season in sorted(src):
        names = site_names(season)
        if names is None:
            continue
        by_key = {}
        for n in names:
            by_key.setdefault(key(n), []).append(n)
        for name, code in src[season].items():
            ours = None
            for n in [name] + ALIASES.get(name, []):
                if n in names:
                    ours = n
                    break
                hit = by_key.get(key(n), [])
                if len(hit) == 1:
                    ours = hit[0]
                    break
                if len(hit) > 1:
                    miss.append(f"{season} {name} (which one? {', '.join(sorted(hit))}: set it in honors_extra.json)")
                    ours = False
                    break
            if ours is None:
                miss.append(f"{season} {name}")
            elif ours and code:
                out.setdefault(season, {})[ours] = code
    dest = EXP / "binders" / "honors.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"honors: wrote {dest.relative_to(ROOT)}, {sum(len(v) for v in out.values())} player-seasons; {len(miss)} not found in the season's games")
    for m in miss[: (None if verbose else 40)]:
        print("  not found:", m)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        build(args[0])
    publish(verbose="-v" in sys.argv)
