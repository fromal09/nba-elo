"""
NBA Elo Pipeline
================
Usage:
    python scripts/build_elo.py data/2026_NBA.csv
    python scripts/build_elo.py data/2026_NBA.csv data/2026_NBA_playoffs.csv

Pass multiple CSVs to concatenate. Output: public/data/elo.json + spaghetti.json
"""

import sys, json, io, os as _os
from pathlib import Path
from datetime import date
from collections import defaultdict

sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from team_canonical import canon_team

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas required: pip install pandas")

# ── Name aliases ───────────────────────────────────────────────────────────
NAME_ALIASES = {
    "Jimmy Butler III":      "Jimmy Butler",
    "Taurean Waller-Prince": "Taurean Prince",
    "Metta World Peace":     "Metta World Peace",
    "Ron Artest":            "Metta World Peace",
    "Jaren Jackson":         "Jaren Jackson Jr.",
}

def normalize_name(name):
    if not isinstance(name, str):
        return name
    return NAME_ALIASES.get(name.strip(), name.strip())


def parse_csv(paths):
    frames = []
    all_paths = list(paths)

    # Auto-include matching _playoffs.csv files
    for path in list(paths):
        playoff_path = str(path).replace(".csv", "_playoffs.csv")
        if Path(playoff_path).exists() and playoff_path not in all_paths:
            all_paths.append(playoff_path)
            print(f"  + including {Path(playoff_path).name}")

    # Auto-include nbaupdates.csv if present
    updates_path = Path("data/nbaupdates.csv")
    if updates_path.exists() and str(updates_path) not in all_paths:
        all_paths.append(str(updates_path))
        print(f"  + including data/nbaupdates.csv")

    for path in all_paths:
        raw = Path(path).read_text(encoding="utf-8", errors="replace")
        lines = raw.split("\n")
        header = lines[0]
        filtered = [header]
        for line in lines[1:]:
            if line.startswith("Rk,Player") or not line.strip():
                continue
            filtered.append(line)
        frames.append(pd.read_csv(io.StringIO("\n".join(filtered)), low_memory=False))

    df = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
    df["Player"] = df["Player"].apply(normalize_name)
    return df


def build_elo(df):
    if "Unnamed: 6" in df.columns:
        df.rename(columns={"Unnamed: 6": "home_away"}, inplace=True)

    df["GmSc"] = pd.to_numeric(df["GmSc"], errors="coerce")
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df["MP"]   = pd.to_numeric(df["MP"],   errors="coerce")

    print(f"  {len(df)} rows, {df['MP'].isna().sum()} rows with no MP data")
    print(f"  Unique players: {df['Player'].nunique()}")

    # Fill empty/NaN Team or Opp
    df["Team"] = df["Team"].fillna("UNK").replace("", "UNK").astype(str)
    df["Opp"]  = df["Opp"].fillna("").astype(str)

    # Normalize team abbreviations to canonical modern form
    df["Team"] = df["Team"].apply(canon_team)
    df["Opp"]  = df["Opp"].apply(canon_team)

    # Fill missing Opp with Team so game_id is still usable
    null_opp = (df["Opp"].str.strip() == "") | (df["Opp"] == "nan")
    if null_opp.sum() > 0:
        print(f"  {null_opp.sum()} rows with missing Opp — using team as game_id fallback")
        df.loc[null_opp, "Opp"] = df.loc[null_opp, "Team"]

    def make_game_id(row):
        teams = sorted([str(row["Team"]), str(row["Opp"])])
        return f"{row['Date'].strftime('%Y-%m-%d')}_{teams[0]}_{teams[1]}"

    df["game_id"] = df.apply(make_game_id, axis=1)

    # Deduplicate
    df = df.sort_values("Date")
    df = df.drop_duplicates(subset=["Player", "game_id"], keep="last")
    df = df.reset_index(drop=True)
    print(f"  {len(df)} rows after deduplication ({df['Player'].nunique()} players)")

    elo          = {}
    games_played = {}
    elo_hist     = defaultdict(list)
    peak_elo     = {}
    gmsc_hist    = defaultdict(list)
    rank_hist    = defaultdict(list)
    team_map     = {}
    last_played  = {}

    def k_factor(n):
        if n < 20:  return 64
        if n < 100: return 44
        return 28

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
                exp_a  = 1 / (1 + 10 ** ((eb - ea) / 650))
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

        sorted_by_elo = sorted(players, key=lambda p: -elo[p])
        for rank_pos, p in enumerate(sorted_by_elo, 1):
            rank_hist[p].append([date_str, rank_pos])

    all_players = sorted(elo.keys(), key=lambda p: -elo[p])

    # FPR eligibility
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

    # ── Badge computation ──────────────────────────────────────────────────
    peak_elo_ranking  = sorted(players_out, key=lambda p: -p["peak_elo"])
    peak_elo_rank_map = {p["name"]: i+1 for i, p in enumerate(peak_elo_ranking)}

    decade_best = defaultdict(lambda: defaultdict(float))
    for p in players_out:
        for date_str, elo_val in p["elo_history"]:
            yr     = int(date_str[:4])
            decade = (yr // 10) * 10
            if elo_val > decade_best[p["name"]][decade]:
                decade_best[p["name"]][decade] = elo_val

    all_decades    = sorted(set(dec for pb in decade_best.values() for dec in pb))
    decade_rank_map = {}
    for decade in all_decades:
        players_in_decade = [(name, pb[decade]) for name, pb in decade_best.items() if decade in pb]
        players_in_decade.sort(key=lambda x: -x[1])
        decade_rank_map[decade] = {name: i+1 for i, (name, _) in enumerate(players_in_decade)}

    def compute_badges(p):
        badges = []
        name          = p["name"]
        rh            = p["rank_history"]
        curr_rank     = p["current_tpr_rank"]
        peak          = p["peak_elo"]
        gp            = p["games_played"]
        fpr_eligible  = p["is_fpr_eligible"]

        games_at_1  = sum(1 for _, r in rh if r == 1)
        max_streak  = cur_streak = 0
        for _, r in rh:
            if r == 1: cur_streak += 1; max_streak = max(max_streak, cur_streak)
            else:      cur_streak = 0
        best_rank_ever = min((r for _, r in rh), default=9999)

        if fpr_eligible:
            if curr_rank == 1:
                badges.append({"cat":"fpr","id":"current_1","label":"Current FPR #1","emoji":"🏆"})
            if curr_rank <= 5:
                badges.append({"cat":"fpr","id":"current_top5","label":f"Current FPR Top 5 (#{curr_rank})","emoji":"⭐"})
            elif curr_rank <= 10:
                badges.append({"cat":"fpr","id":"current_top10","label":f"Current FPR Top 10 (#{curr_rank})","emoji":"⭐"})
            elif curr_rank <= 25:
                badges.append({"cat":"fpr","id":"current_top25","label":f"Current FPR Top 25 (#{curr_rank})","emoji":"📈"})
            elif curr_rank <= 50:
                badges.append({"cat":"fpr","id":"current_top50","label":f"Current FPR Top 50 (#{curr_rank})","emoji":"📈"})
            elif curr_rank <= 100:
                badges.append({"cat":"fpr","id":"current_top100","label":f"Current FPR Top 100 (#{curr_rank})","emoji":"📈"})

        if best_rank_ever == 1 and not (fpr_eligible and curr_rank == 1):
            badges.append({"cat":"fpr","id":"former_1","label":"Former FPR #1","emoji":"🔱"})
        elif best_rank_ever <= 5 and not (fpr_eligible and curr_rank <= 5):
            badges.append({"cat":"fpr","id":"former_top5","label":f"Former FPR Top 5 (#{best_rank_ever})","emoji":"🔱"})
        elif best_rank_ever <= 10 and not (fpr_eligible and curr_rank <= 10):
            badges.append({"cat":"fpr","id":"former_top10","label":f"Former FPR Top 10 (#{best_rank_ever})","emoji":"🔱"})
        elif best_rank_ever <= 25 and not (fpr_eligible and curr_rank <= 25):
            badges.append({"cat":"fpr","id":"former_top25","label":f"Former FPR Top 25 (#{best_rank_ever})","emoji":"🏅"})
        elif best_rank_ever <= 50 and not (fpr_eligible and curr_rank <= 50):
            badges.append({"cat":"fpr","id":"former_top50","label":f"Former FPR Top 50 (#{best_rank_ever})","emoji":"🏅"})
        elif best_rank_ever <= 100 and not (fpr_eligible and curr_rank <= 100):
            badges.append({"cat":"fpr","id":"former_top100","label":f"Former FPR Top 100 (#{best_rank_ever})","emoji":"🏅"})

        if games_at_1 >= 1:
            badges.append({"cat":"fpr","id":"games_at_1","label":f"{games_at_1}-Game FPR #1","emoji":"👑"})
        if max_streak >= 10:
            badges.append({"cat":"fpr","id":"streak_at_1","label":f"{max_streak}-Game FPR #1 Streak","emoji":"🔥"})

        for threshold in range(1800, 3100, 100):
            if peak >= threshold:
                badges.append({"cat":"elo","id":f"club_{threshold}","label":f"{threshold:,} Elo Club","emoji":"⚡"})

        peak_rank = peak_elo_rank_map.get(name, 9999)
        if peak_rank == 1:
            badges.append({"cat":"elo","id":"peak_alltime_1","label":"All-Time Peak Elo #1","emoji":"🐐"})
        elif peak_rank <= 5:
            badges.append({"cat":"elo","id":"peak_alltime_top5","label":f"Top 5 All-Time Peak Elo (#{peak_rank})","emoji":"🐐"})
        elif peak_rank <= 10:
            badges.append({"cat":"elo","id":"peak_alltime_top10","label":f"Top 10 All-Time Peak Elo (#{peak_rank})","emoji":"⚡"})
        elif peak_rank <= 25:
            badges.append({"cat":"elo","id":"peak_alltime_top25","label":f"Top 25 All-Time Peak Elo (#{peak_rank})","emoji":"⚡"})
        elif peak_rank <= 50:
            badges.append({"cat":"elo","id":"peak_alltime_top50","label":f"Top 50 All-Time Peak Elo (#{peak_rank})","emoji":"⚡"})
        elif peak_rank <= 100:
            badges.append({"cat":"elo","id":"peak_alltime_top100","label":f"Top 100 All-Time Peak Elo (#{peak_rank})","emoji":"⚡"})

        for threshold, emoji in [(1000,"💎"),(750,"🏀"),(500,"🏀")]:
            if gp >= threshold:
                badges.append({"cat":"longevity","id":f"games_{threshold}","label":f"{threshold:,} Games Played","emoji":emoji})
                break

        era_emojis = {1940:"📼",1950:"📼",1960:"📼",1970:"📺",1980:"📺",
                      1990:"💿",2000:"💿",2010:"📱",2020:"📱"}
        for decade, player_decade_rank in sorted(decade_rank_map.items(), reverse=True):
            rank_in_decade = player_decade_rank.get(name)
            if not rank_in_decade: continue
            decade_str = f"{decade}s"
            emoji = era_emojis.get(decade, "🏀")
            if rank_in_decade == 1:
                badges.append({"cat":"era","id":f"era_{decade}_1","label":f"{decade_str} FPR #1","emoji":emoji})
            elif rank_in_decade <= 5:
                badges.append({"cat":"era","id":f"era_{decade}_top5","label":f"{decade_str} Top 5 (#{rank_in_decade})","emoji":emoji})
            elif rank_in_decade <= 10:
                badges.append({"cat":"era","id":f"era_{decade}_top10","label":f"{decade_str} Top 10 (#{rank_in_decade})","emoji":emoji})
            elif rank_in_decade <= 25:
                badges.append({"cat":"era","id":f"era_{decade}_top25","label":f"{decade_str} Top 25 (#{rank_in_decade})","emoji":emoji})
            elif rank_in_decade <= 50:
                badges.append({"cat":"era","id":f"era_{decade}_top50","label":f"{decade_str} Top 50 (#{rank_in_decade})","emoji":emoji})
            elif rank_in_decade <= 100:
                badges.append({"cat":"era","id":f"era_{decade}_top100","label":f"{decade_str} Top 100 (#{rank_in_decade})","emoji":emoji})

        return badges

    for p in players_out:
        p["badges"] = compute_badges(p)

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

    all_dates = sorted(set(h[0] for p in output["players"] for h in p["elo_history"]))
    date_idx  = {d: i for i, d in enumerate(all_dates)}
    sparse_players = [[[date_idx[d], v] for d, v in p["elo_history"]] for p in output["players"]]
    spag = {"dates": all_dates, "players": sparse_players}
    spag_path = Path("public/data/spaghetti.json")
    spag_path.write_text(json.dumps(spag, separators=(",", ":")), encoding="utf-8")
    print(f"  Written {spag_path} ({spag_path.stat().st_size/1024:.0f} KB)")
    print("Done.")
