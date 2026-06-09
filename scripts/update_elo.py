"""
update_elo.py — incremental update from nbaupdates.csv
=======================================================
Loads existing elo.json, finds only new game dates not already
in the data, runs Elo updates for those games, and rewrites
public/data/elo.json and spaghetti.json in place.

Usage:
    python3 scripts/update_elo.py

Run this any time after adding new rows to data/nbaupdates.csv.
Much faster than a full rebuild — only processes new games.
"""

import sys, json, io
from pathlib import Path
from datetime import date
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from team_canonical import canon_team

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas required")

# ── Config ────────────────────────────────────────────────────────────────
ELO_JSON    = Path("public/data/elo.json")
SPAG_JSON   = Path("public/data/spaghetti.json")
UPDATES_CSV = Path("data/nbaupdates.csv")
D           = 650   # must match build_elo.py

def k_factor(n):
    if n < 20:  return 40
    if n < 100: return 50
    return 28

# ── Name aliases ──────────────────────────────────────────────────────────
NAME_ALIASES = {
    "Tiny Archibald":        "Nate Archibald",
    "Jimmy Butler III":      "Jimmy Butler",
    "Taurean Waller-Prince": "Taurean Prince",
    "Ron Artest":            "Metta World Peace",
    "Lloyd Free":            "World B. Free",
    "Nene Hilario":          "Nene",
}

def normalize_name(n):
    if not isinstance(n, str): return n
    return NAME_ALIASES.get(n.strip(), n.strip())

# ── Load existing elo.json ────────────────────────────────────────────────
print("Loading existing elo.json…")
if not ELO_JSON.exists():
    sys.exit("public/data/elo.json not found — run full build first")

data = json.loads(ELO_JSON.read_text(encoding="utf-8"))
players_out = data["players"]

# Build fast lookup: name -> player dict
player_map = {p["name"]: p for p in players_out}

# Find the last date already in the data
all_dates_in_data = set()
for p in players_out:
    for d, _ in (p.get("elo_history") or []):
        all_dates_in_data.add(d)

last_date = max(all_dates_in_data) if all_dates_in_data else "1900-01-01"
print(f"  {len(players_out)} players, data through {last_date}")

# ── Load nbaupdates.csv ───────────────────────────────────────────────────
if not UPDATES_CSV.exists():
    sys.exit(f"{UPDATES_CSV} not found")

raw = UPDATES_CSV.read_text(encoding="utf-8", errors="replace")
lines = raw.split("\n")
header = lines[0]
filtered = [header]
for line in lines[1:]:
    if line.startswith("Rk,Player") or not line.strip():
        continue
    filtered.append(line)

df = pd.read_csv(io.StringIO("\n".join(filtered)), low_memory=False)
df.rename(columns={"Unnamed: 6": "home_away"}, inplace=True)
df["Player"] = df["Player"].apply(normalize_name)
df["GmSc"]   = pd.to_numeric(df["GmSc"], errors="coerce")
df["Date"]   = pd.to_datetime(df["Date"], errors="coerce")
df["MP"]     = pd.to_numeric(df["MP"], errors="coerce")
df           = df.dropna(subset=["Date", "GmSc"]).copy()
df["Team"]   = df["Team"].apply(canon_team)
df["Opp"]    = df["Opp"].fillna("").astype(str).apply(canon_team)

# Fill missing Opp
null_opp = df["Opp"].str.strip() == ""
df.loc[null_opp, "Opp"] = df.loc[null_opp, "Team"]

df["date_str"] = df["Date"].dt.strftime("%Y-%m-%d")
df["game_id"]  = df.apply(
    lambda r: f"{r['date_str']}_{'_'.join(sorted([str(r['Team']), str(r['Opp'])]))}",
    axis=1
)

# ── Find new games only ───────────────────────────────────────────────────
new_df = df[df["date_str"] > last_date].copy()
if new_df.empty:
    print(f"No new games found after {last_date}. Nothing to update.")
    sys.exit(0)

new_dates = sorted(new_df["date_str"].unique())
print(f"  Found {len(new_df)} new rows across {len(new_dates)} new game dates: {new_dates[0]} → {new_dates[-1]}")

# Deduplicate
new_df = new_df.drop_duplicates(subset=["Player", "game_id"], keep="last").reset_index(drop=True)

# ── Restore state from elo.json ───────────────────────────────────────────
print("Restoring Elo state…")
elo          = {}
games_played = {}
elo_hist     = defaultdict(list)
gmsc_hist    = defaultdict(list)
team_hist    = defaultdict(list)
peak_elo     = {}
peak_fpr_rank_map = {}
games_at_1_map    = {}
cur_streak_map    = {}
max_streak_map    = {}
team_map     = {}
last_played  = {}

for p in players_out:
    name = p["name"]
    elo[name]          = p["current_elo"]
    games_played[name] = p["games_played"]
    peak_elo[name]     = p["peak_elo"]
    team_map[name]     = p["team"]
    last_played[name]  = p.get("last_played", "")
    elo_hist[name]     = list(p.get("elo_history") or [])
    gmsc_hist[name]    = list(p.get("gmsc_history") or [])
    team_hist[name]    = list(p.get("team_history") or [])
    # Restore FPR tracking from badges
    for b in (p.get("badges") or []):
        if b["id"] == "games_at_1":
            games_at_1_map[name] = int(b["label"].split("×")[0])
        if b["id"] == "streak_at_1":
            max_streak_map[name] = int(b["label"].split("-")[0])
    peak_fpr_rank_map[name] = p.get("peak_fpr_rank", 9999)

# ── Run Elo pipeline for new games ───────────────────────────────────────
print("Running incremental Elo update…")
game_order  = new_df.drop_duplicates("game_id").sort_values("Date")["game_id"].tolist()
game_groups = {gid: grp for gid, grp in new_df.groupby("game_id")}

for game_id in game_order:
    group    = game_groups[game_id]
    players  = group["Player"].tolist()
    gmsc     = dict(zip(group["Player"], group["GmSc"]))
    date_str = group["Date"].iloc[0].strftime("%Y-%m-%d")
    n        = len(players)

    for p in players:
        if p not in elo:
            elo[p] = 1500; games_played[p] = 0; peak_elo[p] = 1500
        team_map[p]    = group[group["Player"] == p]["Team"].iloc[0]
        last_played[p] = date_str

    deltas = defaultdict(float)
    for a in players:
        for b in players:
            if a == b: continue
            exp_a = 1 / (1 + 10 ** ((elo[b] - elo[a]) / D))
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
        cur_team = team_map.get(p, "")
        if not team_hist[p] or team_hist[p][-1][1] != cur_team:
            team_hist[p].append([date_str, cur_team])

    # Global rank snapshot
    global_sorted = sorted(elo.keys(), key=lambda p: -elo[p])
    for global_rank, p in enumerate(global_sorted, 1):
        if p not in peak_fpr_rank_map or global_rank < peak_fpr_rank_map[p]:
            peak_fpr_rank_map[p] = global_rank
        if global_rank == 1:
            games_at_1_map[p] = games_at_1_map.get(p, 0) + 1
            cur_streak_map[p] = cur_streak_map.get(p, 0) + 1
            if cur_streak_map[p] > max_streak_map.get(p, 0):
                max_streak_map[p] = cur_streak_map[p]
        else:
            cur_streak_map[p] = 0

print(f"  Processed {len(game_order)} games")

# ── Recompute derived stats for changed players ───────────────────────────
changed_players = set(new_df["Player"].unique())
print(f"  Updating {len(changed_players)} changed players…")

# FPR eligibility: team's last 20 game dates
team_game_dates = defaultdict(set)
for pl, games in gmsc_hist.items():
    for d, _ in games:
        team_game_dates[team_map.get(pl, "")].add(d)

team_cutoff = {}
for team, dates in team_game_dates.items():
    sorted_dates = sorted(dates, reverse=True)
    team_cutoff[team] = sorted_dates[min(19, len(sorted_dates) - 1)]

# Rebuild peak Elo rank map
peak_rank_order = sorted(elo.keys(), key=lambda p: -peak_elo[p])
peak_elo_rank_map = {p: i+1 for i, p in enumerate(peak_rank_order)}

# Rebuild era data for badge computation (only for changed players, use existing for others)
# For simplicity, recompute decade_best and decade_rank_map from full elo_hist
decade_best = defaultdict(lambda: defaultdict(float))
for name in elo.keys():
    for d_str, elo_val in elo_hist[name]:
        yr = int(d_str[:4]); decade = (yr // 10) * 10
        if elo_val > decade_best[name][decade]:
            decade_best[name][decade] = elo_val

all_decades = sorted(set(dec for pb in decade_best.values() for dec in pb))
decade_rank_map = {}
for decade in all_decades:
    plist = [(n, pb[decade]) for n, pb in decade_best.items() if decade in pb]
    plist.sort(key=lambda x: -x[1])
    decade_rank_map[decade] = {n: i+1 for i, (n, _) in enumerate(plist)}

decade_avg = defaultdict(lambda: defaultdict(list))
for name in elo.keys():
    for d_str, elo_val in elo_hist[name]:
        yr = int(d_str[:4]); decade = (yr // 10) * 10
        decade_avg[name][decade].append(elo_val)
decade_avg_rank_map = {}
for decade in all_decades:
    avgs = [(n, sum(v)/len(v)) for n, d in decade_avg.items() if decade in d for v in [d[decade]]]
    avgs.sort(key=lambda x: -x[1])
    decade_avg_rank_map[decade] = {n: i+1 for i, (n, _) in enumerate(avgs)}

# ── Import badge function from build_elo ─────────────────────────────────
# Re-implement badge logic inline (same as build_elo.py)
era_emojis = {1940:"📼",1950:"📼",1960:"📼",1970:"📺",1980:"📺",
              1990:"💿",2000:"💿",2010:"📱",2020:"📱"}

def rank_tier(r):
    if r == 1: return 0
    if r <= 5: return 1
    if r <= 10: return 2
    if r <= 25: return 3
    if r <= 50: return 4
    if r <= 100: return 5
    return 6

def compute_badges(name, curr_rank, peak, gp, fpr_eligible):
    badges = []
    pfpr       = peak_fpr_rank_map.get(name, 9999)
    g1         = games_at_1_map.get(name, 0)
    streak     = max_streak_map.get(name, 0)

    if fpr_eligible:
        t = rank_tier(curr_rank)
        labels = {0:("current_1","Current FPR #1","🏆"),1:(f"current_top5",f"Current FPR Top 5 (#{curr_rank})","⭐"),
                  2:(f"current_top10",f"Current FPR Top 10 (#{curr_rank})","⭐"),3:(f"current_top25",f"Current FPR Top 25 (#{curr_rank})","📈"),
                  4:(f"current_top50",f"Current FPR Top 50 (#{curr_rank})","📈"),5:(f"current_top100",f"Current FPR Top 100 (#{curr_rank})","📈")}
        if t in labels: badges.append({"cat":"fpr","id":labels[t][0],"label":labels[t][1],"emoji":labels[t][2]})

    curr_tier = rank_tier(curr_rank) if fpr_eligible else 6
    peak_tier = rank_tier(pfpr)
    if peak_tier < curr_tier:
        if pfpr==1:      badges.append({"cat":"fpr","id":"former_1","label":"Former FPR #1","emoji":"🔱"})
        elif pfpr<=5:    badges.append({"cat":"fpr","id":"former_top5","label":f"Former FPR Top 5 (#{pfpr})","emoji":"🔱"})
        elif pfpr<=10:   badges.append({"cat":"fpr","id":"former_top10","label":f"Former FPR Top 10 (#{pfpr})","emoji":"🏅"})
        elif pfpr<=25:   badges.append({"cat":"fpr","id":"former_top25","label":f"Former FPR Top 25 (#{pfpr})","emoji":"🏅"})
        elif pfpr<=50:   badges.append({"cat":"fpr","id":"former_top50","label":f"Former FPR Top 50 (#{pfpr})","emoji":"🏅"})
        elif pfpr<=100:  badges.append({"cat":"fpr","id":"former_top100","label":f"Former FPR Top 100 (#{pfpr})","emoji":"🏅"})

    if g1 >= 1: badges.append({"cat":"fpr","id":"games_at_1","label":f"{g1}× FPR #1","emoji":"👑"})

    for t in [3000,2900,2700,2500,2200,2000]:
        if peak >= t:
            badges.append({"cat":"elo","id":f"club_{t}","label":f"{t:,} Elo Club","emoji":"⚡"}); break

    atr = peak_elo_rank_map.get(name, 9999)
    if atr==1:      badges.append({"cat":"elo","id":"peak_1","label":"All-Time Peak #1","emoji":"🐐"})
    elif atr<=5:    badges.append({"cat":"elo","id":"peak_top5","label":f"All-Time Peak Top 5 (#{atr})","emoji":"🐐"})
    elif atr<=10:   badges.append({"cat":"elo","id":"peak_top10","label":f"All-Time Peak Top 10 (#{atr})","emoji":"⚡"})
    elif atr<=25:   badges.append({"cat":"elo","id":"peak_top25","label":f"All-Time Peak Top 25 (#{atr})","emoji":"⚡"})
    elif atr<=50:   badges.append({"cat":"elo","id":"peak_top50","label":f"All-Time Peak Top 50 (#{atr})","emoji":"⚡"})

    for t, e in [(1500,"💎"),(1000,"💎"),(750,"🏀"),(500,"🏀")]:
        if gp >= t:
            badges.append({"cat":"longevity","id":f"games_{t}","label":f"{t:,} Games","emoji":e}); break

    for decade in all_decades:
        emoji = era_emojis.get(decade, "🏀"); ds = f"{decade}s"
        pr = decade_rank_map.get(decade, {}).get(name)
        if pr:
            if pr==1:      badges.append({"cat":"era","id":f"d{decade}_p1","label":f"{ds} Peak #1","emoji":emoji})
            elif pr<=5:    badges.append({"cat":"era","id":f"d{decade}_p5","label":f"{ds} Peak Top 5 (#{pr})","emoji":emoji})
            elif pr<=10:   badges.append({"cat":"era","id":f"d{decade}_p10","label":f"{ds} Peak Top 10 (#{pr})","emoji":emoji})
            elif pr<=25:   badges.append({"cat":"era","id":f"d{decade}_p25","label":f"{ds} Peak Top 25 (#{pr})","emoji":emoji})
            elif pr<=50:   badges.append({"cat":"era","id":f"d{decade}_p50","label":f"{ds} Peak Top 50 (#{pr})","emoji":emoji})
            elif pr<=100:  badges.append({"cat":"era","id":f"d{decade}_p100","label":f"{ds} Peak Top 100 (#{pr})","emoji":emoji})
        ar = decade_avg_rank_map.get(decade, {}).get(name)
        if ar:
            if ar==1:      badges.append({"cat":"era","id":f"d{decade}_a1","label":f"{ds} Avg #1","emoji":emoji})
            elif ar<=5:    badges.append({"cat":"era","id":f"d{decade}_a5","label":f"{ds} Avg Top 5 (#{ar})","emoji":emoji})
            elif ar<=10:   badges.append({"cat":"era","id":f"d{decade}_a10","label":f"{ds} Avg Top 10 (#{ar})","emoji":emoji})
            elif ar<=25:   badges.append({"cat":"era","id":f"d{decade}_a25","label":f"{ds} Avg Top 25 (#{ar})","emoji":emoji})
            elif ar<=50:   badges.append({"cat":"era","id":f"d{decade}_a50","label":f"{ds} Avg Top 50 (#{ar})","emoji":emoji})
            elif ar<=100:  badges.append({"cat":"era","id":f"d{decade}_a100","label":f"{ds} Avg Top 100 (#{ar})","emoji":emoji})
    return badges

# ── Rebuild players_out ───────────────────────────────────────────────────
all_player_names = sorted(elo.keys(), key=lambda p: -elo[p])
new_players_out = []

for rank, name in enumerate(all_player_names, 1):
    hist    = elo_hist[name]
    recent  = gmsc_hist[name][-10:]
    all_gs  = [g[1] for g in gmsc_hist[name]]
    recent_avg = sum(g[1] for g in recent) / len(recent) if recent else 0
    career_avg = sum(all_gs) / len(all_gs) if all_gs else 0
    team    = team_map.get(name, "")
    lp      = last_played.get(name, "")
    eligible = lp >= team_cutoff.get(team, "")

    new_players_out.append({
        "name":             name,
        "team":             team,
        "current_elo":      round(elo[name], 1),
        "peak_elo":         round(peak_elo[name], 1),
        "current_tpr_rank": rank,
        "games_played":     games_played[name],
        "recent_gmsc_avg":  round(recent_avg, 1),
        "career_gmsc_avg":  round(career_avg, 1),
        "last_played":      lp,
        "is_fpr_eligible":  eligible,
        "peak_fpr_rank":    peak_fpr_rank_map.get(name, 9999),
        "elo_history":      hist,
        "team_history":     team_hist[name],
        "badges":           compute_badges(name, rank, peak_elo[name], games_played[name], eligible),
    })

# ── Write elo.json ────────────────────────────────────────────────────────
output = {
    "season":        "2025-26",
    "generated":     date.today().isoformat(),
    "total_games":   data.get("total_games", 0) + len(game_order),
    "total_players": len(new_players_out),
    "players":       new_players_out,
}
ELO_JSON.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
print(f"  Written {ELO_JSON} ({ELO_JSON.stat().st_size/1024:.0f} KB)")

# ── Write spaghetti.json ──────────────────────────────────────────────────
all_dates_sorted = sorted(set(h[0] for p in new_players_out for h in p["elo_history"]))
date_idx = {d: i for i, d in enumerate(all_dates_sorted)}
sparse = [[[date_idx[d], v] for d, v in p["elo_history"]] for p in new_players_out]
spag = {"dates": all_dates_sorted, "players": sparse}
SPAG_JSON.write_text(json.dumps(spag, separators=(",", ":")), encoding="utf-8")
print(f"  Written {SPAG_JSON} ({SPAG_JSON.stat().st_size/1024:.0f} KB)")

print(f"\nDone. {len(new_players_out)} players, {output['total_games']} total games.")
print(f"New dates processed: {', '.join(new_dates)}")
print(f"\nDeploy with:")
print(f"  git add public/data/ data/nbaupdates.csv")
print(f"  git commit -m 'data: update through {new_dates[-1]}'")
print(f"  git push")
