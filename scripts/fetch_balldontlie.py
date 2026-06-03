"""
BallDontLie Historical Fetcher
================================
Fetches NBA player game stats from the BallDontLie API back to 1946-47.
Requires ALL-STAR tier ($9.99/mo) or use the 48-hour GOAT trial (free).

Sign up at: https://app.balldontlie.io
Get your API key, then:

    python scripts/fetch_balldontlie.py --api-key YOUR_KEY
    python scripts/fetch_balldontlie.py --api-key YOUR_KEY --seasons 1946 1947 1948

Outputs one CSV per season into data/ in the same format as the nba_api fetcher.
Skips seasons already saved. Safe to re-run if interrupted.

Season note: BallDontLie uses the START year (1996 = 1996-97 season).
We already have 1996-2025 from nba_api, so default pulls 1946-1995 only.
"""

import sys, time, json, argparse, csv
from pathlib import Path
from datetime import datetime

try:
    import requests
except ImportError:
    sys.exit("Install requests first:\n  pip install requests")

BASE = "https://api.balldontlie.io/v1"
PER_PAGE = 100

def get(api_key, endpoint, params=None):
    """Single paginated GET, returns all rows across pages."""
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
        # Log rate limit headers on first successful response
        if r.status_code == 200 and not getattr(get, '_logged_headers', False):
            rl_limit = r.headers.get('X-RateLimit-Limit', 'unknown')
            rl_remaining = r.headers.get('X-RateLimit-Remaining', 'unknown')
            rl_reset = r.headers.get('X-RateLimit-Reset', 'unknown')
            print(f"\n  [API limits] limit={rl_limit} remaining={rl_remaining} reset={rl_reset}")
            get._logged_headers = True
        r.raise_for_status()
        data = r.json()
        rows.extend(data["data"])
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(12.5)  # 5 req/min = 1 per 12s
    return rows

def compute_gmsc(row):
    """Modern GmSc formula — nulls treated as 0."""
    def n(v): return v or 0
    pts  = n(row.get("pts"))
    fgm  = n(row.get("fgm"))
    fga  = n(row.get("fga"))
    ftm  = n(row.get("ftm"))
    fta  = n(row.get("fta"))
    orb  = n(row.get("oreb"))
    drb  = n(row.get("dreb"))
    stl  = n(row.get("stl"))
    ast  = n(row.get("ast"))
    blk  = n(row.get("blk"))
    pf   = n(row.get("pf"))
    tov  = n(row.get("turnover"))
    return round(
        pts + 0.4*fgm - 0.7*fga - 0.4*(fta-ftm)
        + 0.7*orb + 0.3*drb + stl + 0.7*ast + 0.7*blk - 0.4*pf - tov, 1
    )

def fetch_season(api_key, season_start_year, out_dir, playoffs_only=False):
    """Fetch all player stats for one season, save as CSV."""
    season_str = f"{season_start_year}-{str(season_start_year+1)[2:]}"
    suffix = "_playoffs" if playoffs_only else ""
    out_path = out_dir / f"{season_str}{suffix}.csv"

    if out_path.exists():
        print(f"  {out_path} already exists — skipping")
        return

    season_type_label = "Playoffs" if playoffs_only else "Regular Season"
    print(f"  Fetching {season_str} {season_type_label}...", end=" ", flush=True)

    # Get all stats for this season
    season_type_param = "Playoffs" if playoffs_only else "Regular Season"
    stats = get(api_key, "stats", {"seasons[]": season_start_year, "postseason": "true" if playoffs_only else "false"})
    print(f"{len(stats)} player-game rows", end=" ", flush=True)

    if not stats:
        print("— empty, skipping")
        return

    # Build lookup: game_id -> game info
    game_ids = list(set(s["game"]["id"] for s in stats))
    games = {}
    # game info is embedded in the stats response
    for s in stats:
        g = s["game"]
        games[g["id"]] = g

    # Write CSV
    fieldnames = [
        "Player","GmSc","Date","Team","home_away","Opp","Result","MP",
        "FG","FGA","FG%","3P","3PA","3P%","FT","FTA","FT%",
        "ORB","DRB","TRB","AST","STL","BLK","TOV","PF","PTS"
    ]

    rows_written = 0
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for s in stats:
            player = s.get("player", {})
            raw_name = f"{player.get('first_name','')} {player.get('last_name','')}".strip()
            # Import alias map from build_elo if available, otherwise identity
            try:
                import importlib.util, sys as _sys
                spec = importlib.util.spec_from_file_location("build_elo", Path(__file__).parent / "build_elo.py")
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                name = mod.normalize_name(raw_name)
            except Exception:
                name = raw_name
            if not name:
                continue

            game = games.get(s["game"]["id"], s["game"])
            date_str = game.get("date", "")[:10]

            # Determine team and opponent
            team_abbr = s.get("team", {}).get("abbreviation", "")
            home_team = game.get("home_team", {}).get("abbreviation", "")
            away_team = game.get("visitor_team", {}).get("abbreviation", "")
            if team_abbr == home_team:
                opp = away_team
                home_away = ""
            else:
                opp = home_team
                home_away = "@"

            # Result
            home_score = game.get("home_team_score") or 0
            away_score = game.get("visitor_team_score") or 0
            if team_abbr == home_team:
                wl = "W" if home_score > away_score else "L"
            else:
                wl = "W" if away_score > home_score else "L"

            def n(v): return v if v is not None else ""
            def pct(m, a):
                try: return round(m/a, 3) if a else ""
                except: return ""

            fgm = s.get("fgm") or 0
            fga = s.get("fga") or 0
            fg3m = s.get("fg3m") or 0
            fg3a = s.get("fg3a") or 0
            ftm = s.get("ftm") or 0
            fta = s.get("fta") or 0
            orb = s.get("oreb") or 0
            drb = s.get("dreb") or 0
            trb = orb + drb

            # Minutes: BDL returns "MM:SS" string
            mp_raw = s.get("min") or "0"
            try:
                parts = str(mp_raw).split(":")
                mp = int(parts[0]) + (int(parts[1])/60 if len(parts) > 1 else 0)
                mp = round(mp, 1)
            except:
                mp = 0

            gmsc = compute_gmsc(s)

            writer.writerow({
                "Player": name,
                "GmSc": gmsc,
                "Date": date_str,
                "Team": team_abbr,
                "home_away": home_away,
                "Opp": opp,
                "Result": wl,
                "MP": mp,
                "FG": fgm, "FGA": fga, "FG%": pct(fgm, fga),
                "3P": fg3m, "3PA": fg3a, "3P%": pct(fg3m, fg3a),
                "FT": ftm, "FTA": fta, "FT%": pct(ftm, fta),
                "ORB": orb, "DRB": drb, "TRB": trb,
                "AST": n(s.get("ast")),
                "STL": n(s.get("stl")),
                "BLK": n(s.get("blk")),
                "TOV": n(s.get("turnover")),
                "PF": n(s.get("pf")),
                "PTS": n(s.get("pts")),
            })
            rows_written += 1

    print(f"→ saved {rows_written} rows to {out_path}")
    time.sleep(0.5)


def main():
    parser = argparse.ArgumentParser(description="Fetch NBA history from BallDontLie")
    parser.add_argument("--api-key", required=True, help="BallDontLie API key")
    parser.add_argument("--seasons", nargs="+", type=int,
                        default=list(range(1946, 1996)),
                        help="Start years to fetch (e.g. 1946 1947). Default: 1946-1995")
    parser.add_argument("--playoffs", action="store_true",
                        help="Fetch playoff games instead of regular season")
    parser.add_argument("--outdir", default="data", help="Output directory")
    args = parser.parse_args()

    out = Path(args.outdir)
    out.mkdir(exist_ok=True)

    print(f"Fetching {len(args.seasons)} seasons from BallDontLie...")
    print(f"Seasons: {args.seasons[0]} – {args.seasons[-1]}")

    for yr in sorted(args.seasons):
        try:
            fetch_season(args.api_key, yr, out, playoffs_only=args.playoffs)
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401:
                print(f"\n  AUTH ERROR: Check your API key and account tier.")
                print("  Game Player Stats requires ALL-STAR ($9.99/mo) or GOAT trial.")
                sys.exit(1)
            print(f"  HTTP error for {yr}: {e}")
        except Exception as e:
            print(f"  Error fetching {yr}: {e}")
            time.sleep(5)

    print("\nDone. Build the full pipeline with:")
    bdl_csvs = " ".join(f"data/{yr}-{str(yr+1)[2:]}.csv" for yr in sorted(args.seasons))
    nba_csvs = " ".join(f"data/{yr}-{str(yr+1)[2:]}.csv" for yr in range(1996, 2025))
    print(f"  python scripts/build_elo.py {bdl_csvs} {nba_csvs} data/2025-26.csv")


if __name__ == "__main__":
    main()
