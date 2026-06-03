import requests, json, sys, pandas as pd
from collections import defaultdict

api_key = sys.argv[1]

# Fetch teams
r = requests.get("https://api.balldontlie.io/nba/v1/teams",
                 headers={"Authorization": api_key}, timeout=30)
teams = r.json()["data"]
team_map = {t["id"]: t["abbreviation"] for t in teams}
print("Team map sample:", dict(list(team_map.items())[:10]))

# Fetch 1946-47 games
r2 = requests.get("https://api.balldontlie.io/nba/v1/games",
                  headers={"Authorization": api_key},
                  params={"seasons[]": 1946, "per_page": 5}, timeout=30)
games = r2.json()["data"]
print("\nSample games:")
for g in games[:3]:
    h = team_map.get(g.get("home_team_id"), "?")
    a = team_map.get(g.get("visitor_team_id"), "?")
    print(f"  {g['date'][:10]}: {a} @ {h} (home_id={g.get('home_team_id')}, away_id={g.get('visitor_team_id')})")

# Check what's in the CSV
df = pd.read_csv("data/1946-47.csv")
print("\nCSV Team values (unique):", sorted(df['Team'].dropna().unique().tolist()))
print("CSV Date sample:", df['Date'].head(3).tolist())
