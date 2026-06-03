"""
patch_opp_from_bbref.py
=======================
Uses BBRef team games CSV to fill missing Opp in BDL player stat CSVs.
Normalizes ALL team abbreviations to canonical modern form before matching.

Usage:
    python scripts/patch_opp_from_bbref.py \
        --games "/path/to/pre-96 team games - Sheet1.csv" \
        --datadir data/
"""
import sys, argparse, io
from pathlib import Path
from collections import defaultdict
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from team_canonical import canon_team


def load_games(path):
    """Load BBRef team games CSV, normalize abbreviations, return lookup dicts."""
    raw = Path(path).read_text(encoding="utf-8", errors="replace")
    lines = raw.split("\n")
    filtered = [lines[0]]
    for line in lines[1:]:
        s = line.strip()
        if not s or s.startswith("Rk,Team") or s.startswith("Team,Opponent"):
            continue
        filtered.append(line)

    df = pd.read_csv(io.StringIO("\n".join(filtered)), low_memory=False)
    df.rename(columns={"Unnamed: 4": "home_away"}, inplace=True)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date", "Team", "Opp"])
    df["date_str"] = df["Date"].dt.strftime("%Y-%m-%d")
    df["team_c"] = df["Team"].apply(canon_team)
    df["opp_c"]  = df["Opp"].apply(canon_team)

    # Primary lookup: (canonical_team, date) -> canonical_opp
    lookup = {}
    # Secondary: date -> list of (team_c, opp_c) for fallback
    date_games = defaultdict(list)

    for _, row in df.iterrows():
        key = (row["team_c"], row["date_str"])
        lookup[key] = row["opp_c"]
        date_games[row["date_str"]].append((row["team_c"], row["opp_c"]))

    print(f"Loaded {len(lookup):,} team-game entries from {Path(path).name}")
    return lookup, date_games


def patch_csv(csv_path, lookup, date_games):
    df = pd.read_csv(csv_path, low_memory=False)

    if "Opp" not in df.columns:
        df["Opp"] = ""
    if "home_away" not in df.columns:
        df["home_away"] = ""

    # Cast to object so string assignment works
    df["Opp"]      = df["Opp"].astype(object)
    df["home_away"] = df["home_away"].astype(object)
    df["Team"]     = df["Team"].astype(object)

    df["Date"]    = pd.to_datetime(df["Date"], errors="coerce")
    df["date_str"] = df["Date"].dt.strftime("%Y-%m-%d")
    df["team_c"]  = df["Team"].apply(canon_team)

    missing_mask = (
        df["Opp"].isna() |
        (df["Opp"].astype(str).str.strip() == "") |
        (df["Opp"].astype(str) == "nan")
    )
    n_missing = missing_mask.sum()

    if n_missing == 0:
        print(f"  {csv_path.name}: already complete")
        return 0

    filled = 0
    for idx in df[missing_mask].index:
        team_c   = df.at[idx, "team_c"]
        date_str = df.at[idx, "date_str"]

        # Primary: exact (canonical_team, date) match
        opp = lookup.get((team_c, date_str))

        # Fallback: scan games on that date for any match involving this team
        if not opp:
            for t, o in date_games.get(date_str, []):
                if t == team_c:
                    opp = o
                    break
                if o == team_c:
                    opp = t
                    break

        if opp:
            df.at[idx, "Opp"] = opp
            filled += 1

    df.drop(columns=["date_str", "team_c"], inplace=True, errors="ignore")
    df.to_csv(csv_path, index=False)

    still = (
        df["Opp"].isna() |
        (df["Opp"].astype(str).str.strip() == "") |
        (df["Opp"].astype(str) == "nan")
    ).sum()
    print(f"  {csv_path.name}: filled {filled}/{n_missing} ({still} still missing)")
    return filled


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", required=True)
    parser.add_argument("--datadir", default="data")
    args = parser.parse_args()

    lookup, date_games = load_games(args.games)

    data_dir = Path(args.datadir)
    pre96 = [str(y) for y in range(1946, 1996)]

    reg_files = sorted([
        f for f in data_dir.glob("*.csv")
        if f.name[0].isdigit()
        and any(f.name.startswith(y) for y in pre96)
        and "playoffs" not in f.name
        and "updates" not in f.name
    ])
    po_files = sorted([
        f for f in data_dir.glob("*_playoffs.csv")
        if f.name[0].isdigit()
        and any(f.name.startswith(y) for y in pre96)
    ])
    all_files = sorted(set(reg_files + po_files))

    print(f"\nPatching {len(all_files)} CSV files...")
    total = 0
    for f in all_files:
        total += patch_csv(f, lookup, date_games)

    print(f"\nDone. Total rows filled: {total:,}")
    print("\nNow rebuild:")
    print("  python scripts/build_elo.py $(ls data/[0-9]*.csv | grep -v playoffs | sort)")


if __name__ == "__main__":
    main()
