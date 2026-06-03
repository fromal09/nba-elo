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


# Explicit name aliases — maps any variant to the canonical name.
# Add entries here whenever the same player appears under different names
# across data sources (e.g. mid-career name changes, source inconsistencies).
NAME_ALIASES = {
    "Jimmy Butler III":       "Jimmy Butler",
    "Jimmy Butler III ":      "Jimmy Butler",
    "Jaren Jackson":          "Jaren Jackson Jr.",
    "Taurean Waller-Prince":  "Taurean Prince",
    "Nene":                   "Nene Hilario",
    "Metta World Peace":      "Ron Artest",
    "Ron Artest":             "Metta World Peace",  # canonical = later name
    "Stephen Jackson":        "Stephen Jackson",
    "Bam Adebayo":            "Bam Adebayo",
}

# For Artest/World Peace, pick one canonical name:
NAME_ALIASES["Ron Artest"] = "Metta World Peace"

def normalize_name(name):
    """Apply alias map to unify player names across data sources."""
    if not isinstance(name, str):
        return name
    name = name.strip()
    return NAME_ALIASES.get(name, name)


def parse_csv(paths):
    frames = []
    all_paths = []
    for path in paths:
        all_paths.append(path)
        # Auto-include matching _playoffs.csv if it exists
        playoff_path = str(path).replace(".csv", "_playoffs.csv")
        if Path(playoff_path).exists():
            all_paths.append(playoff_path)
            print(f"  + including {Path(playoff_path).name}")

    # Auto-include updates.csv if present — dedupe handles any overlap
    updates_path = Path("data/nbaupdates.csv")
    if updates_path.exists() and updates_path not in [Path(p) for p in all_paths]:
        all_paths.append(str(updates_path))
        print(f"  + including data/nbaupdates.csv")

    for path in all_paths:
        raw = Path(path).read_text(encoding="utf-8")
        lines = raw.split("\n")
        header = lines[0]
        filtered = [header]
        for line in lines[1:]:
            if line.startswith("Rk,Player") or not line.strip():
                continue
            filtered.append(line)
        frames.append(pd.read_csv(io.StringIO("\n".join(filtered))))
    df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
    df["Player"] = df["Player"].apply(normalize_name)
    return df


def build_elo(df):
    if "Unnamed: 6" in df.columns:
        df.rename(columns={"Unnamed: 6": "home_away"}, inplace=True)

    df["GmSc"] = pd.to_numeric(df["GmSc"], errors="coerce")
    df["Date"] = pd.to_datetime(df["Date"])
    df["MP"]   = pd.to_numeric(df["MP"],   errors="coerce")
    df = df[df["MP"] >= 10].copy()

    # Drop rows with missing Team or Opp (malformed rows from some data sources)
    df = df.dropna(subset=["Team", "Opp"]).copy()

    def make_game_id(row):
        teams = sorted([str(row["Team"]), str(row["Opp"])])
        return f"{row['Date'].strftime('%Y-%m-%d')}_{teams[0]}_{teams[1]}"

    df["game_id"] = df.apply(make_game_id, axis=1)

    # Deduplicate: if the same player-game appears in multiple CSVs
    # (e.g. 2025-26.csv and updates.csv overlap), keep only one copy.
    # Sort first so the dedup keeps the row from the later file (updates win).
    df = df.sort_values("Date")
    df = df.drop_duplicates(subset=["Player", "game_id"], keep="last")
    df = df.reset_index(drop=True)
    print(f"  {len(df)} rows after deduplication")

    elo          = {}
    games_played = {}
    elo_hist     = defaultdict(list)
    peak_elo     = {}
    gmsc_hist    = defaultdict(list)
    rank_hist    = defaultdict(list)
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

        # Record rank snapshot after each game — rank among all players seen so far
        sorted_by_elo = sorted(players, key=lambda p: -elo[p])
        for rank_pos, p in enumerate(sorted_by_elo, 1):
            rank_hist[p].append([date_str, rank_pos])

    all_players = sorted(elo.keys(), key=lambda p: -elo[p])

    # Build team game date sets for eligibility (once, outside player loop)
    team_game_dates = defaultdict(set)
    for pl, games in gmsc_hist.items():
        for d, _ in games:
            team_game_dates[team_map.get(pl, "")].add(d)

    team_cutoff = {}
    for team, dates in team_game_dates.items():
        sorted_dates = sorted(dates, reverse=True)
        team_cutoff[team] = sorted_dates[min(19, len(sorted_dates) - 1)]

    players_out = []
    for rank, player in enumerate(all_players, 1):
        recent     = gmsc_hist[player][-10:]
        recent_avg = sum(g[1] for g in recent) / len(recent) if recent else 0
        all_gs     = [g[1] for g in gmsc_hist[player]]
        career_avg = sum(all_gs) / len(all_gs) if all_gs else 0
        team       = team_map.get(player, "")
        lp         = last_played.get(player, "")

        players_out.append({
            "name":             player,
            "team":             team,
            "current_elo":      round(elo[player], 1),
            "peak_elo":         round(peak_elo[player], 1),
            "current_tpr_rank": rank,
            "games_played":     games_played[player],
            "recent_gmsc_avg":  round(recent_avg, 1),
            "career_gmsc_avg":  round(career_avg, 1),
            "last_played":      lp,
            "is_fpr_eligible":  lp >= team_cutoff.get(team, ""),
            "elo_history":      elo_hist[player],
            "gmsc_history":     gmsc_hist[player],
            "rank_history":     rank_hist[player],
        })

    # ── Badge computation ─────────────────────────────────────────────────────
    # Compute global peak Elo ranking across all players
    peak_elo_ranking = sorted(players_out, key=lambda p: -p["peak_elo"])
    peak_elo_rank_map = {p["name"]: i+1 for i, p in enumerate(peak_elo_ranking)}

    # Compute per-decade peak ranks
    # For each player, find their best Elo within each decade
    decade_best = defaultdict(lambda: defaultdict(float))  # player -> decade -> best_elo
    for p in players_out:
        for date_str, elo_val in p["elo_history"]:
            yr = int(date_str[:4])
            decade = (yr // 10) * 10
            if elo_val > decade_best[p["name"]][decade]:
                decade_best[p["name"]][decade] = elo_val

    # For each decade, rank all players by their best Elo in that decade
    all_decades = sorted(set(dec for pb in decade_best.values() for dec in pb))
    decade_rank_map = {}  # decade -> {player_name -> rank}
    for decade in all_decades:
        players_in_decade = [(name, pb[decade]) for name, pb in decade_best.items() if decade in pb]
        players_in_decade.sort(key=lambda x: -x[1])
        decade_rank_map[decade] = {name: i+1 for i, (name, _) in enumerate(players_in_decade)}

    def compute_badges(p):
        badges = []
        name = p["name"]
        rh = p["rank_history"]  # [[date, rank], ...]
        curr_rank = p["current_tpr_rank"]
        peak = p["peak_elo"]
        gp = p["games_played"]
        fpr_eligible = p["is_fpr_eligible"]

        # ── FPR RANK BADGES ──────────────────────────────────────────────────
        # Times at #1 and streak
        at_number_one = [r for _, r in rh if r == 1]
        games_at_1 = len(at_number_one)

        # Longest consecutive streak at #1
        max_streak = cur_streak = 0
        for _, r in rh:
            if r == 1:
                cur_streak += 1
                max_streak = max(max_streak, cur_streak)
            else:
                cur_streak = 0

        # Best rank ever achieved
        best_rank_ever = min((r for _, r in rh), default=9999)

        # Current rank badges (eligible players only)
        if fpr_eligible:
            if curr_rank == 1:
                badges.append({"cat": "fpr", "id": "current_1", "label": "Current FPR #1", "emoji": "🏆"})
            if curr_rank <= 5:
                badges.append({"cat": "fpr", "id": "current_top5", "label": f"Current FPR Top 5 (#{curr_rank})", "emoji": "⭐"})
            elif curr_rank <= 10:
                badges.append({"cat": "fpr", "id": "current_top10", "label": f"Current FPR Top 10 (#{curr_rank})", "emoji": "⭐"})
            elif curr_rank <= 25:
                badges.append({"cat": "fpr", "id": "current_top25", "label": f"Current FPR Top 25 (#{curr_rank})", "emoji": "📈"})
            elif curr_rank <= 50:
                badges.append({"cat": "fpr", "id": "current_top50", "label": f"Current FPR Top 50 (#{curr_rank})", "emoji": "📈"})
            elif curr_rank <= 100:
                badges.append({"cat": "fpr", "id": "current_top100", "label": f"Current FPR Top 100 (#{curr_rank})", "emoji": "📈"})

        # Former rank badges (based on best rank ever)
        if best_rank_ever == 1:
            if not (fpr_eligible and curr_rank == 1):
                badges.append({"cat": "fpr", "id": "former_1", "label": "Former FPR #1", "emoji": "🔱"})
        elif best_rank_ever <= 5 and not (fpr_eligible and curr_rank <= 5):
            badges.append({"cat": "fpr", "id": "former_top5", "label": f"Former FPR Top 5 (#{best_rank_ever})", "emoji": "🔱"})
        elif best_rank_ever <= 10 and not (fpr_eligible and curr_rank <= 10):
            badges.append({"cat": "fpr", "id": "former_top10", "label": f"Former FPR Top 10 (#{best_rank_ever})", "emoji": "🔱"})
        elif best_rank_ever <= 25 and not (fpr_eligible and curr_rank <= 25):
            badges.append({"cat": "fpr", "id": "former_top25", "label": f"Former FPR Top 25 (#{best_rank_ever})", "emoji": "🏅"})
        elif best_rank_ever <= 50 and not (fpr_eligible and curr_rank <= 50):
            badges.append({"cat": "fpr", "id": "former_top50", "label": f"Former FPR Top 50 (#{best_rank_ever})", "emoji": "🏅"})
        elif best_rank_ever <= 100 and not (fpr_eligible and curr_rank <= 100):
            badges.append({"cat": "fpr", "id": "former_top100", "label": f"Former FPR Top 100 (#{best_rank_ever})", "emoji": "🏅"})

        # Games at #1 and streak
        if games_at_1 >= 1:
            badges.append({"cat": "fpr", "id": "games_at_1", "label": f"{games_at_1}-Game FPR #1", "emoji": "👑"})
        if max_streak >= 10:
            badges.append({"cat": "fpr", "id": "streak_at_1", "label": f"{max_streak}-Game FPR #1 Streak", "emoji": "🔥"})

        # ── ELO BADGES ───────────────────────────────────────────────────────
        # Club badges — every 100 points from 1800 up
        for threshold in range(1800, 3100, 100):
            if peak >= threshold:
                badges.append({"cat": "elo", "id": f"club_{threshold}",
                               "label": f"{threshold:,} Elo Club", "emoji": "⚡"})

        # All-time peak Elo ranking
        peak_rank = peak_elo_rank_map.get(name, 9999)
        if peak_rank == 1:
            badges.append({"cat": "elo", "id": "peak_alltime_1", "label": "All-Time Peak Elo #1", "emoji": "🐐"})
        elif peak_rank <= 5:
            badges.append({"cat": "elo", "id": "peak_alltime_top5", "label": f"Top 5 All-Time Peak Elo (#{peak_rank})", "emoji": "🐐"})
        elif peak_rank <= 10:
            badges.append({"cat": "elo", "id": "peak_alltime_top10", "label": f"Top 10 All-Time Peak Elo (#{peak_rank})", "emoji": "⚡"})
        elif peak_rank <= 25:
            badges.append({"cat": "elo", "id": "peak_alltime_top25", "label": f"Top 25 All-Time Peak Elo (#{peak_rank})", "emoji": "⚡"})
        elif peak_rank <= 50:
            badges.append({"cat": "elo", "id": "peak_alltime_top50", "label": f"Top 50 All-Time Peak Elo (#{peak_rank})", "emoji": "⚡"})
        elif peak_rank <= 100:
            badges.append({"cat": "elo", "id": "peak_alltime_top100", "label": f"Top 100 All-Time Peak Elo (#{peak_rank})", "emoji": "⚡"})

        # ── LONGEVITY BADGES ─────────────────────────────────────────────────
        for threshold, emoji in [(1000,"💎"),(750,"🏀"),(500,"🏀")]:
            if gp >= threshold:
                badges.append({"cat": "longevity", "id": f"games_{threshold}",
                               "label": f"{threshold:,} Games Played", "emoji": emoji})
                break  # only show highest achieved

        # ── ERA BADGES ────────────────────────────────────────────────────────
        era_emojis = {1940:"📼",1950:"📼",1960:"📼",1970:"📺",1980:"📺",
                      1990:"💿",2000:"💿",2010:"📱",2020:"📱"}
        for decade, player_decade_rank in sorted(decade_rank_map.items(), reverse=True):
            rank_in_decade = player_decade_rank.get(name)
            if not rank_in_decade:
                continue
            decade_str = f"{decade}s"
            emoji = era_emojis.get(decade, "🏀")
            if rank_in_decade == 1:
                badges.append({"cat": "era", "id": f"era_{decade}_1",
                               "label": f"{decade_str} FPR #1", "emoji": emoji})
            elif rank_in_decade <= 5:
                badges.append({"cat": "era", "id": f"era_{decade}_top5",
                               "label": f"{decade_str} Top 5 (#{rank_in_decade})", "emoji": emoji})
            elif rank_in_decade <= 10:
                badges.append({"cat": "era", "id": f"era_{decade}_top10",
                               "label": f"{decade_str} Top 10 (#{rank_in_decade})", "emoji": emoji})
            elif rank_in_decade <= 25:
                badges.append({"cat": "era", "id": f"era_{decade}_top25",
                               "label": f"{decade_str} Top 25 (#{rank_in_decade})", "emoji": emoji})
            elif rank_in_decade <= 50:
                badges.append({"cat": "era", "id": f"era_{decade}_top50",
                               "label": f"{decade_str} Top 50 (#{rank_in_decade})", "emoji": emoji})
            elif rank_in_decade <= 100:
                badges.append({"cat": "era", "id": f"era_{decade}_top100",
                               "label": f"{decade_str} Top 100 (#{rank_in_decade})", "emoji": emoji})

        return badges

    # Attach badges to all players
    for p in players_out:
        p["badges"] = compute_badges(p)
        # Remove rank_history from output to save space — badges already computed
        # Keep it for charting though
        p["rank_history"] = p["rank_history"]  # keep for now

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
