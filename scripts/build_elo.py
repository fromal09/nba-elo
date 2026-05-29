"""
NBA Elo Pipeline
================
Usage:
    python scripts/build_elo.py data/2026_NBA.csv
    python scripts/build_elo.py data/2026_NBA.csv data/2026_NBA_playoffs.csv

Pass multiple CSVs to concatenate (e.g. regular season + playoff updates).
Output: public/data/elo.json

Key design decisions:
  - Pairwise within-game Elo comparison by Game Score rank
  - sqrt(n_players) K-factor scaling to normalize for game size
  - Dynamic K: 40 (<20 GP), 28 (20-100 GP), 20 (100+ GP)
  - 10-minute minimum to filter garbage time
  - last_played date tracked per player for recency filtering in UI
"""

import sys, json, io
from pathlib import Path
from datetime import date
from collections import defaultdict

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas required: pip install pandas")


def parse_csv(paths):
    frames = []
    for path in paths:
        raw = Path(path).read_text(encoding="utf-8")
        lines = raw.split("\n")
        header = lines[0]
        filtered = [header]
        for line in lines[1:]:
            if line.startswith("Rk,Player") or not line.strip():
                continue
            filtered.append(line)
        frames.append(pd.read_csv(io.StringIO("\n".join(filtered))))
    return pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]


def build_elo(df):
    if "Unnamed: 6" in df.columns:
        df.rename(columns={"Unnamed: 6": "home_away"}, inplace=True)

    df["GmSc"] = pd.to_numeric(df["GmSc"], errors="coerce")
    df["Date"] = pd.to_datetime(df["Date"])
    df["MP"]   = pd.to_numeric(df["MP"],   errors="coerce")
    df = df[df["MP"] >= 10].copy()

    def make_game_id(row):
        teams = sorted([row["Team"], row["Opp"]])
        return f"{row['Date'].strftime('%Y-%m-%d')}_{teams[0]}_{teams[1]}"

    df["game_id"] = df.apply(make_game_id, axis=1)
    df = df.sort_values("Date").reset_index(drop=True)

    elo          = {}
    games_played = {}
    elo_hist     = defaultdict(list)
    peak_elo     = {}
    gmsc_hist    = defaultdict(list)
    team_map     = {}
    last_played  = {}

    def k_factor(n):
        if n < 20:  return 40
        if n < 100: return 28
        return 20

    def init(player):
        if player not in elo:
            elo[player]          = 1500
            games_played[player] = 0
            peak_elo[player]     = 1500

    game_order  = df.drop_duplicates("game_id").sort_values("Date")["game_id"].tolist()
    game_groups = {gid: grp for gid, grp in df.groupby("game_id")}

    for game_id in game_order:
        group    = game_groups[game_id]
        players  = group["Player"].tolist()
        gmsc     = dict(zip(group["Player"], group["GmSc"]))
        date_str = group["Date"].iloc[0].strftime("%Y-%m-%d")
        n        = len(players)

        for p in players:
            init(p)
            team_map[p]    = group[group["Player"] == p]["Team"].iloc[0]
            last_played[p] = date_str

        deltas = defaultdict(float)
        for a in players:
            for b in players:
                if a == b: continue
                ea, eb = elo[a], elo[b]
                exp_a  = 1 / (1 + 10 ** ((eb - ea) / 400))
                ga, gb = gmsc[a], gmsc[b]
                act_a  = 1.0 if ga > gb else (0.5 if ga == gb else 0.0)
                k_eff  = k_factor(games_played[a]) / (n ** 0.5)
                deltas[a] += k_eff * (act_a - exp_a)

        for p in players:
            elo[p]          += deltas[p]
            games_played[p] += 1
            if elo[p] > peak_elo[p]: peak_elo[p] = elo[p]
            elo_hist[p].append([date_str, round(elo[p], 1)])
            gmsc_hist[p].append([date_str, round(gmsc[p], 1)])

    all_players = sorted(elo.keys(), key=lambda p: -elo[p])

    players_out = []
    for rank, player in enumerate(all_players, 1):
        recent     = gmsc_hist[player][-10:]
        recent_avg = sum(g[1] for g in recent) / len(recent) if recent else 0
        all_gs     = [g[1] for g in gmsc_hist[player]]
        career_avg = sum(all_gs) / len(all_gs) if all_gs else 0

        players_out.append({
            "name":             player,
            "team":             team_map.get(player, ""),
            "current_elo":      round(elo[player], 1),
            "peak_elo":         round(peak_elo[player], 1),
            "current_tpr_rank": rank,
            "games_played":     games_played[player],
            "recent_gmsc_avg":  round(recent_avg, 1),
            "career_gmsc_avg":  round(career_avg, 1),
            "last_played":      last_played.get(player, ""),
            "elo_history":      elo_hist[player],
            "gmsc_history":     gmsc_hist[player],
        })

    return {
        "season":        "2025-26",
        "generated":     date.today().isoformat(),
        "total_games":   len(game_order),
        "total_players": len(players_out),
        "players":       players_out,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    csv_paths = sys.argv[1:]
    print(f"Reading {len(csv_paths)} CSV(s)…")
    df = parse_csv(csv_paths)
    print(f"  {len(df)} raw rows")
    print("Running Elo pipeline…")
    output = build_elo(df)
    print(f"  {output['total_players']} players · {output['total_games']} games")
    out_path = Path("public/data/elo.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(f"  Written {out_path} ({out_path.stat().st_size/1024:.0f} KB)")

    # Build spaghetti.json — compact sparse format for the chart
    # Shared date index + per-player [[date_idx, elo], ...] arrays
    all_dates = sorted(set(
        h[0] for p in output["players"] for h in p["elo_history"]
    ))
    date_idx = {d: i for i, d in enumerate(all_dates)}
    sparse_players = [
        [[date_idx[d], v] for d, v in p["elo_history"]]
        for p in output["players"]
    ]
    spag = {"dates": all_dates, "players": sparse_players}
    spag_path = Path("public/data/spaghetti.json")
    spag_path.write_text(json.dumps(spag, separators=(",", ":")), encoding="utf-8")
    print(f"  Written {spag_path} ({spag_path.stat().st_size/1024:.0f} KB)")
    print("Done.")
