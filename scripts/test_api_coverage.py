"""
Run this locally first to verify nba_api has complete data for older seasons.
    python scripts/test_api_coverage.py
"""
import time
from nba_api.stats.endpoints import playergamelogs

REQUIRED_COLS = ['STL', 'BLK', 'TOV', 'OREB']

test_seasons = [
    '1996-97', '1997-98', '1999-00',  # oldest range
    '2003-04', '2007-08',              # mid-range
    '2013-14', '2019-20', '2024-25',  # recent
]

print(f"{'Season':<12} {'Rows':>6}  {'STL':>4} {'BLK':>4} {'TOV':>4} {'ORB':>4}  Notes")
print("-" * 60)

for season in test_seasons:
    try:
        logs = playergamelogs.PlayerGameLogs(
            season_nullable=season,
            season_type_nullable='Regular Season',
            league_id_nullable='00',
            timeout=60,
        )
        df = logs.get_data_frames()[0]
        cols = df.columns.tolist()
        flags = {c: ('✓' if c in cols else '✗') for c in REQUIRED_COLS}
        missing = [c for c in REQUIRED_COLS if c not in cols]
        note = f"MISSING: {missing}" if missing else "complete"
        # Check for nulls in key cols
        if not missing:
            null_pct = df[REQUIRED_COLS].isnull().mean().mean() * 100
            if null_pct > 1:
                note = f"WARNING: {null_pct:.0f}% nulls in key cols"
        print(f"{season:<12} {len(df):>6}  {flags['STL']:>4} {flags['BLK']:>4} {flags['TOV']:>4} {flags['OREB']:>4}  {note}")
        time.sleep(2)
    except Exception as e:
        print(f"{season:<12} {'ERROR':>6}  —    —    —    —    {str(e)[:40]}")
        time.sleep(2)

print("\nIf all ✓ and no warnings, safe to run fetch_seasons.py back to 1996-97.")
