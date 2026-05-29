"""
NBA Historical Game Log Fetcher
================================
Run this locally (not in CI) to pull multiple seasons from the NBA stats API.
Outputs one CSV per season into data/ — feed them all to build_elo.py.

Usage:
    pip install nba_api pandas
    python scripts/fetch_seasons.py                    # pulls 2020-21 through 2024-25
    python scripts/fetch_seasons.py --seasons 2018-19 2019-20 2020-21

Then rebuild Elo across all seasons:
    python scripts/build_elo.py data/2020-21.csv data/2021-22.csv data/2022-23.csv data/2023-24.csv data/2024-25.csv data/2025-26.csv

Notes:
    - NBA API rate-limits aggressively. The script sleeps between requests.
    - Each season takes ~30-60 seconds to fetch.
    - The 2025-26 season CSV you already have from BBRef is fine to keep using —
      just pass it last so it appends after the historical data.
    - If a request times out, re-run — the script skips seasons already saved.
"""

import sys
import time
import argparse
from pathlib import Path

try:
    import pandas as pd
    from nba_api.stats.endpoints import playergamelogs
except ImportError:
    sys.exit("Install dependencies first:\n  pip install nba_api pandas")

# Column mapping: nba_api name -> our pipeline name
# nba_api gives us everything we need for the modern GmSc formula
COLUMN_MAP = {
    'PLAYER_NAME':  'Player',
    'GAME_DATE':    'Date',
    'TEAM_ABBREVIATION': 'Team',
    'MATCHUP':      '_matchup',   # "OKC vs. DEN" or "OKC @ DEN"
    'WL':           '_wl',
    'MIN':          'MP',
    'FGM':          'FG',
    'FGA':          'FGA',
    'FG_PCT':       'FG%',
    'FG3M':         '3P',
    'FG3A':         '3PA',
    'FG3_PCT':      '3P%',
    'FTM':          'FT',
    'FTA':          'FTA',
    'FT_PCT':       'FT%',
    'OREB':         'ORB',
    'DREB':         'DRB',
    'REB':          'TRB',
    'AST':          'AST',
    'STL':          'STL',
    'BLK':          'BLK',
    'TOV':          'TOV',
    'PF':           'PF',
    'PTS':          'PTS',
    'GAME_ID':      '_game_id',
}

def compute_gmsc(df):
    """Compute Game Score from raw stats — same formula as BBRef."""
    return (
        df['PTS']
        + 0.4 * df['FG']
        - 0.7 * df['FGA']
        - 0.4 * (df['FTA'] - df['FT'])
        + 0.7 * df['ORB']
        + 0.3 * df['DRB']
        + df['STL']
        + 0.7 * df['AST']
        + 0.7 * df['BLK']
        - 0.4 * df['PF']
        - df['TOV']
    )

def parse_matchup(matchup, team):
    """Extract opponent and home/away from matchup string like 'OKC vs. DEN' or 'OKC @ DEN'."""
    if ' vs. ' in matchup:
        opp = matchup.split(' vs. ')[1].strip()
        home_away = ''
    elif ' @ ' in matchup:
        opp = matchup.split(' @ ')[1].strip()
        home_away = '@'
    else:
        opp = ''
        home_away = ''
    return opp, home_away

def fetch_season(season_str, season_type='Regular Season'):
    """Fetch all player game logs for a season. Returns a DataFrame."""
    print(f"  Fetching {season_str} {season_type}...", end=' ', flush=True)
    logs = playergamelogs.PlayerGameLogs(
        season_nullable=season_str,
        season_type_nullable=season_type,
        league_id_nullable='00',
        timeout=60,
    )
    df = logs.get_data_frames()[0]
    print(f"{len(df)} rows")
    return df

def process(df):
    """Rename columns, compute GmSc, parse matchup."""
    df = df.rename(columns={k: v for k, v in COLUMN_MAP.items() if k in df.columns})

    # Parse opponent and home/away
    df[['Opp', 'home_away']] = df.apply(
        lambda r: pd.Series(parse_matchup(r['_matchup'], r['Team'])),
        axis=1
    )

    # Parse date — nba_api returns 'MMM DD, YYYY'
    df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')

    # Compute GmSc
    for col in ['PTS','FG','FGA','FTA','FT','ORB','DRB','STL','AST','BLK','PF','TOV']:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
    df['GmSc'] = compute_gmsc(df).round(1)

    # Build result string
    df['Result'] = df['_wl']

    # Keep only pipeline columns
    keep = ['Player','GmSc','Date','Team','home_away','Opp','Result','MP',
            'FG','FGA','FG%','3P','3PA','3P%','FT','FTA','FT%',
            'ORB','DRB','TRB','AST','STL','BLK','TOV','PF','PTS']
    keep = [c for c in keep if c in df.columns]
    return df[keep]

def main():
    parser = argparse.ArgumentParser(description='Fetch NBA game logs')
    parser.add_argument('--seasons', nargs='+', default=[
        '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'
    ], help='Season strings e.g. 2020-21 2021-22')
    parser.add_argument('--playoffs', action='store_true',
                        help='Also fetch playoff games (appended to same file)')
    parser.add_argument('--outdir', default='data',
                        help='Output directory (default: data/)')
    args = parser.parse_args()

    out = Path(args.outdir)
    out.mkdir(exist_ok=True)

    for season in args.seasons:
        out_path = out / f"{season}.csv"
        if out_path.exists():
            print(f"  {out_path} already exists — skipping (delete to re-fetch)")
            continue

        frames = []
        try:
            frames.append(fetch_season(season, 'Regular Season'))
            time.sleep(3)  # be polite

            if args.playoffs:
                frames.append(fetch_season(season, 'Playoffs'))
                time.sleep(3)

        except Exception as e:
            print(f"  ERROR fetching {season}: {e}")
            continue

        df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
        df = process(df)
        df.to_csv(out_path, index=False)
        print(f"  Saved {out_path} ({len(df)} player-games)")
        time.sleep(2)

    print("\nDone. Now run the Elo pipeline:")
    csvs = ' '.join(f"data/{s}.csv" for s in args.seasons)
    print(f"  python scripts/build_elo.py {csvs} data/2025-26.csv")

if __name__ == '__main__':
    main()
