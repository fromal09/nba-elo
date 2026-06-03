"""
patch_bdl_opp.py
================
Fetches the BDL games endpoint (lightweight — just game metadata) for all
historical seasons, builds a game_id → (home_team, visitor_team) map,
then patches the missing Opp column in existing BDL CSV files in-place.

Run once after the BDL stat fetch is complete:
    python scripts/patch_bdl_opp.py --api-key YOUR_KEY

The games endpoint is much lighter than stats — ~100 games/season vs ~20k rows.
All 50 seasons should fetch in a few minutes even at 5 req/min.
"""

import sys, time, csv, argparse
from pathlib import Path
from collections import defaultdict

try:
    import requests
    import pandas as pd
except ImportError:
    sys.exit("pip install requests pandas")

BASE = "https://api.balldontlie.io/nba/v1"
PER_PAGE = 100


def get(api_key, endpoint, params=None):
    headers = {"Authorization": api_key}
    rows = []
    cursor = None
    while True:
        p = dict(params or {})
        p["per_page"] = PER_PAGE
        if cursor:
            p["cursor"] = cursor
        r = requests.get(f"{BASE}/{endpoint}", headers=headers, params=p, timeout=30)
        if r.status_code == 429:
            print(" [rate limited, sleeping 15s]", end="", flush=True)
            time.sleep(15)
            continue
        if r.status_code in (502, 503, 504):
            print(" [server error, retrying in 30s]", end="", flush=True)
            time.sleep(30)
            continue
        r.raise_for_status()
        data = r.json()
        rows.extend(data["data"])
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(12.5)
    return rows


def fetch_team_map(api_key):
    """Fetch all NBA teams and return id -> abbreviation map."""
    print("Fetching team list...", end=" ", flush=True)
    teams = get(api_key, "teams")
    team_map = {t["id"]: t["abbreviation"] for t in teams}
    print(f"{len(team_map)} teams")
    return team_map


def fetch_game_map(api_key, season, team_map):
    """
    Fetch all games for a season.
    Returns dict: game_id -> {"home": abbr, "away": abbr, "date": str}
    """
    games = get(api_key, "games", {"seasons[]": season})
    result = {}
    for g in games:
        home_id = g.get("home_team_id")
        away_id = g.get("visitor_team_id")
        result[g["id"]] = {
            "home": team_map.get(home_id, ""),
            "away": team_map.get(away_id, ""),
            "date": g.get("date", "")[:10],
        }
    return result


def patch_csv(csv_path, game_map, team_map):
    """
    Read a BDL CSV, fill in missing Opp values using game_map,
    and overwrite the file.
    """
    df = pd.read_csv(csv_path)

    # Check if Opp is already present and valid
    if "Opp" in df.columns:
        missing = df["Opp"].isna().sum() + (df["Opp"] == "").sum()
    else:
        missing = len(df)

    if missing == 0:
        print(f"  {csv_path.name}: already complete, skipping")
        return 0

    # BDL CSVs don't store game_id directly — we need to reconstruct it
    # from the stat's game reference. But we don't have that after saving.
    # Instead, match by date + team: find games on same date where team played.

    df["Date"] = pd.to_datetime(df["Date"]).dt.strftime("%Y-%m-%d")

    # Build date+team -> (home_abbr, away_abbr) lookup from game_map
    date_team_map = defaultdict(dict)
    for gid, ginfo in game_map.items():
        d = ginfo["date"]
        h = ginfo["home"]
        a = ginfo["away"]
        if h:
            date_team_map[d][h] = {"opp": a, "home_away": ""}
        if a:
            date_team_map[d][a] = {"opp": h, "home_away": "@"}

    filled = 0
    missing_opp_mask = df["Opp"].isna() | (df["Opp"] == "")

    for idx in df[missing_opp_mask].index:
        date = df.at[idx, "Date"]
        team = df.at[idx, "Team"]
        match = date_team_map.get(date, {}).get(team)
        if match and match["opp"]:
            df.at[idx, "Opp"] = match["opp"]
            df.at[idx, "home_away"] = match["home_away"]
            filled += 1

    df.to_csv(csv_path, index=False)
    still_missing = df["Opp"].isna().sum() + (df["Opp"] == "").sum()
    print(f"  {csv_path.name}: filled {filled}/{missing} missing Opp ({still_missing} still missing)")
    return filled


def main():
    parser = argparse.ArgumentParser(description="Patch missing Opp in BDL CSVs")
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--seasons", nargs="+", type=int,
                        default=list(range(1946, 1996)),
                        help="Season start years to patch (default: 1946-1995)")
    parser.add_argument("--outdir", default="data")
    args = parser.parse_args()

    out = Path(args.outdir)
    team_map = fetch_team_map(args.api_key)
    time.sleep(1)

    total_filled = 0
    for season in sorted(args.seasons):
        season_str = f"{season}-{str(season+1)[2:]}"
        reg_path    = out / f"{season_str}.csv"
        playoff_path = out / f"{season_str}_playoffs.csv"

        if not reg_path.exists() and not playoff_path.exists():
            print(f"  {season_str}: no CSV found, skipping")
            continue

        print(f"  Fetching {season_str} game schedule...", end=" ", flush=True)
        try:
            game_map = fetch_game_map(args.api_key, season, team_map)
            print(f"{len(game_map)} games")
        except Exception as e:
            print(f"ERROR: {e}")
            time.sleep(5)
            continue

        if reg_path.exists():
            total_filled += patch_csv(reg_path, game_map, team_map)
        if playoff_path.exists():
            total_filled += patch_csv(playoff_path, game_map, team_map)

        time.sleep(0.5)

    print(f"\nDone. Total rows patched: {total_filled}")
    print("Now rebuild the pipeline:")
    print("  python scripts/build_elo.py $(ls data/[0-9]*.csv | grep -v playoffs | sort)")


if __name__ == "__main__":
    main()
