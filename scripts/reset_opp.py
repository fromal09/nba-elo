"""
reset_opp.py
============
Clears the Opp column in all pre-1996 BDL CSVs so patch_opp_from_bbref.py
can re-fill them cleanly with canonical abbreviations.

Usage:
    python scripts/reset_opp.py --datadir data/
"""
import argparse, pandas as pd
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--datadir", default="data")
    args = parser.parse_args()

    data_dir = Path(args.datadir)
    pre96 = [str(y) for y in range(1946, 1996)]

    files = sorted([
        f for f in data_dir.glob("*.csv")
        if f.name[0].isdigit()
        and any(f.name.startswith(y) for y in pre96)
        and "updates" not in f.name
    ])

    print(f"Resetting Opp in {len(files)} files...")
    for f in files:
        df = pd.read_csv(f, low_memory=False)
        if "Opp" in df.columns:
            df["Opp"] = None
        if "home_away" in df.columns:
            df["home_away"] = None
        df.to_csv(f, index=False)
        print(f"  {f.name}: reset")

    print("Done. Now re-run patch_opp_from_bbref.py")

if __name__ == "__main__":
    main()
