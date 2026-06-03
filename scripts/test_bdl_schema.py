import requests, json, sys

api_key = sys.argv[1]

# Test with the correct nba/v1 endpoint
r = requests.get(
    "https://api.balldontlie.io/nba/v1/stats",
    headers={"Authorization": api_key},
    params={"seasons[]": 1979, "per_page": 1},
    timeout=30
)
print("Status:", r.status_code)
if r.status_code == 200:
    data = r.json()["data"][0]
    print("Stat keys:", list(data.keys()))
    print("Game object:", json.dumps(data.get("game", {}), indent=2))
    print("Team object:", json.dumps(data.get("team", {}), indent=2))
else:
    print("Body:", r.text[:500])
