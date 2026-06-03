"""
diagnose_missing_opp.py — shows remaining unmatched rows after patching
Usage:
    python scripts/diagnose_missing_opp.py \
        --games "/path/to/pre-96 team games - Sheet1.csv" \
        --datadir data/ --top 40
"""
import sys, argparse, io
from pathlib import Path
from collections import defaultdict, Counter
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
from team_canonical import canon_team

def load_games(path):
    raw = Path(path).read_text(encoding="utf-8", errors="replace")
    lines = raw.split("\n")
    filtered = [lines[0]]
    for line in lines[1:]:
        s = line.strip()
        if not s or s.startswith("Rk,Team") or s.startswith("Team,Opponent"): continue
        filtered.append(line)
    df = pd.read_csv(io.StringIO("\n".join(filtered)), low_memory=False)
    df.rename(columns={"Unnamed: 4": "home_away"}, inplace=True)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date","Team","Opp"])
    df["date_str"] = df["Date"].dt.strftime("%Y-%m-%d")
    df["team_c"] = df["Team"].apply(canon_team)
    return df

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--games", required=True)
    parser.add_argument("--datadir", default="data")
    parser.add_argument("--top", type=int, default=40)
    args = parser.parse_args()

    games_df = load_games(args.games)
    date_to_teams = defaultdict(set)
    for _, row in games_df.iterrows():
        date_to_teams[row["date_str"]].add(row["team_c"])

    data_dir = Path(args.datadir)
    files = sorted([
        f for f in data_dir.glob("*.csv")
        if f.name[0].isdigit()
        and "updates" not in f.name
        and int(f.name[:4]) < 1996
    ])

    missing_by_team_year = Counter()
    missing_by_team = Counter()
    sample_rows = []
    total_missing = 0

    for csv_path in files:
        df = pd.read_csv(csv_path, low_memory=False)
        if "Opp" not in df.columns: continue
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        df["date_str"] = df["Date"].dt.strftime("%Y-%m-%d")
        df["year"] = df["Date"].dt.year
        df["team_c"] = df["Team"].apply(canon_team)

        missing_mask = df["Opp"].isna() | (df["Opp"].astype(str).str.strip().isin(["","nan"]))
        missing = df[missing_mask]
        total_missing += len(missing)

        for _, row in missing.iterrows():
            team  = str(row.get("Team","")).strip()
            teamc = row["team_c"]
            year  = int(row["year"]) if pd.notna(row.get("year")) else 0
            date  = row["date_str"]
            games_on_date = sorted(date_to_teams.get(date, set()))
            missing_by_team_year[(teamc, year)] += 1
            missing_by_team[teamc] += 1
            if len(sample_rows) < 8:
                sample_rows.append({
                    "file": csv_path.name, "raw_team": team,
                    "canonical": teamc, "date": date, "year": year,
                    "games_csv_teams": games_on_date[:6]
                })

    print(f"\nTotal still missing: {total_missing:,}\n")
    print("Sample missing rows:")
    for r in sample_rows:
        print(f"  {r['file']}: raw={r['raw_team']} canonical={r['canonical']} date={r['date']}")
        print(f"    Games CSV teams on that date: {r['games_csv_teams']}")

    print(f"\nTop {args.top} missing by (canonical_team, year):")
    print(f"{'Team':<8} {'Year':>6} {'Count':>8}")
    print("-" * 28)
    for (team, year), count in missing_by_team_year.most_common(args.top):
        print(f"{team:<8} {year:>6} {count:>8}")

    print(f"\nMissing by canonical team:")
    for team, count in missing_by_team.most_common(20):
        years = sorted(set(y for (t,y) in missing_by_team_year if t == team))
        print(f"  {team:<8}: {count:>6}  years={years[:8]}")

if __name__ == "__main__":
    main()
