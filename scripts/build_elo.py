"""
NBA Elo Pipeline
================
Usage:
    python scripts/build_elo.py data/2026_NBA.csv
    python scripts/build_elo.py data/2026_NBA.csv data/2026_NBA_playoffs.csv

Pass multiple CSVs to concatenate. Output: public/data/elo.json + spaghetti.json
"""

# ═══════════════════════════════════════════════════════════════════════════
# OUTPUT CONTRACT — do not change these without updating all consumers
#
# elo_history entry: [date, elo, opp_team, won_bool, team]  (5 elements)
# player fields: name, current_elo, peak_elo, games_played, team,
#                last_played, is_fpr_eligible, fpr_rank, current_tpr_rank,
#                peak_fpr_rank, elo_history, team_history, badges,
#                career_gmsc_avg, recent_gmsc_avg
# games.json score: normalized 0-100 (max game = 100)
# fpr_rank: rank among is_fpr_eligible players only (None if ineligible)
# ═══════════════════════════════════════════════════════════════════════════
import sys, json, io, os as _os
from pathlib import Path
from datetime import date
import math
import math
from collections import defaultdict

sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from team_canonical import canon_team

try:
    import pandas as pd
except ImportError:
    sys.exit("pandas required: pip install pandas")

# ── Name aliases ───────────────────────────────────────────────────────────
NAME_ALIASES = {
    # Name changes / nicknames
    "Jimmy Butler III":      "Jimmy Butler",
    "Taurean Waller-Prince": "Taurean Prince",
    "Metta World Peace":     "Metta World Peace",
    "Ron Artest":            "Metta World Peace",
    "Jaren Jackson":         "Jaren Jackson Jr.",
    # Tiny Archibald = Nate Archibald (same player)
    "Tiny Archibald":        "Nate Archibald",
    # Other common BBRef vs BDL name variants
    "Phil Jackson":          "Phil Jackson",   # coach, shouldn't be in data
    "Gus Williams":          "Gus Williams",
    "World B. Free":         "World B. Free",
    "Lloyd Free":            "World B. Free",
    "Bill Bridges":          "Bill Bridges",
    "Zelmo Beaty":           "Zelmo Beaty",
    "Luol Deng":             "Luol Deng",
    "Nene Hilario":          "Nene",
    "Nene":                  "Nene",
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

    # Auto-include bbref-aba.csv (ABA 1967-76) if present
    bbref_aba = Path("data/bbref-aba.csv")
    if bbref_aba.exists() and str(bbref_aba) not in all_paths:
        all_paths.append(str(bbref_aba))
        print(f"  + including data/bbref-aba.csv (ABA 1967-76)")

    # If bbref-pre1974.csv exists, EXCLUDE BDL files for those seasons
    # (1946-47 through 1972-73) to avoid duplicate rows with TRB=0 vs real TRB.
    # BBRef data is authoritative for this era.
    bbref_pre74 = Path("data/bbref-pre1974.csv")
    if bbref_pre74.exists():
        bdl_pre74_years = [str(y) for y in range(1946, 1973)]
        filtered_paths = []
        skipped = 0
        for p in all_paths:
            pname = Path(p).name
            is_bdl_pre74 = any(pname.startswith(y) for y in bdl_pre74_years)
            if is_bdl_pre74:
                skipped += 1
            else:
                filtered_paths.append(p)
        all_paths = filtered_paths
        if skipped:
            print(f"  - excluded {skipped} BDL pre-1974 files (replaced by bbref-pre1974.csv)")
        all_paths.append(str(bbref_pre74))
        print(f"  + including data/bbref-pre1974.csv (authoritative pre-1974 source)")

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


import csv as _csv
_charlotte_csv = _os.path.join(_os.path.dirname(__file__), '..', 'data', 'charlotte.csv')
charlotte_keys = set()
if _os.path.exists(_charlotte_csv):
    with open(_charlotte_csv) as _f:
        for row in _csv.DictReader(_f):
            p, d = row.get('Player','').strip(), row.get('Date','').strip()
            if p and d:
                charlotte_keys.add((p, d))
    print(f"  Loaded {len(charlotte_keys)} Charlotte game-player keys")


# ── Player name disambiguation ───────────────────────────────────────────────
# Players sharing names disambiguated by rookie year + first team
PLAYER_DISAMBIG = {
    ('Bill Smith', '1961', 'NYK'): 'Bill Smith (1961)',
    ('Bill Smith', '1971', 'POR'): 'Bill Smith (1971)',
    ('Bob Duffy', '1946', 'BOS'): 'Bob Duffy (1946)',
    ('Bob Duffy', '1962', 'DET'): 'Bob Duffy (1962)',
    ('Bobby Jones', '1976', 'DEN'): 'Bobby Jones (1976)',
    ('Bobby Jones', '2006', 'DEN'): 'Bobby Jones (2006)',
    ('Brandon Williams', '1997', 'ATL'): 'Brandon Williams (1997)',
    ('Brandon Williams', '2021', 'DAL'): 'Brandon Williams (2021)',
    ('Cedric Henderson', '1986', 'ATL'): 'Cedric Henderson (1986)',
    ('Cedric Henderson', '1997', 'CLE'): 'Cedric Henderson (1997)',
    ('Charles Jones', '1983', 'CHI'): 'Charles Jones (1983)',
    ('Charles Jones', '1984', 'PHO'): 'Charles Jones (1984)',
    ('Charles Jones', '1998', 'CHI'): 'Charles Jones (1998)',
    ('Charles Smith', '1988', 'LAC'): 'Charles Smith (1988)',
    ('Charles Smith', '1989', 'BOS'): 'Charles Smith (1989)',
    ('Charles Smith', '1997', 'DEN'): 'Charles Smith (1997)',
    ('Chris Johnson', '2010', 'BOS'): 'Chris Johnson (2010)',
    ('Chris Johnson', '2012', 'BOS'): 'Chris Johnson (2012)',
    ('Chris Smith', '1992', 'MIN'): 'Chris Smith (1992)',
    ('Chris Smith', '2013', 'NYK'): 'Chris Smith (2013)',
    ('Chris Wright', '2011', 'GSW'): 'Chris Wright (2011)',
    ('Chris Wright', '2012', 'DAL'): 'Chris Wright (2012)',
    ('Dee Brown', '1990', 'BOS'): 'Dee Brown (1990)',
    ('Dee Brown', '2006', 'PHO'): 'Dee Brown (2006)',
    ('Don Smith', '1948', 'MNL'): 'Don Smith (1948)',
    ('Don Smith', '1974', 'PHI'): 'Don Smith (1974)',
    ('Freddie Lewis', '1948', 'BLB'): 'Freddie Lewis (1948)',
    ('Freddie Lewis', '1966', 'CIN'): 'Freddie Lewis (1966)',
    ('George Johnson', '1970', 'BAL'): 'George Johnson (1970)',
    ('George Johnson', '1972', 'ATL'): 'George Johnson (1972)',
    ('George Johnson', '1978', 'DEN'): 'George Johnson (1978)',
    ('George King', '1951', 'CIN'): 'George King (1951)',
    ('George King', '2018', 'DAL'): 'George King (2018)',
    ('Gerald Henderson', '1979', 'BOS'): 'Gerald Henderson (1979)',
    ('Gerald Henderson', '2009', 'CHA'): 'Gerald Henderson (2009)',
    ('Greg Smith', '1968', 'HOU'): 'Greg Smith (1968)',
    ('Greg Smith', '2011', 'DAL'): 'Greg Smith (2011)',
    ('Jack Turner', '1954', 'NYK'): 'Jack Turner (1954)',
    ('Jack Turner', '1961', 'CHP'): 'Jack Turner (1961)',
    ('Jeff Taylor', '1982', 'DET'): 'Jeff Taylor (1982)',
    ('Jeff Taylor', '2012', 'CHA'): 'Jeff Taylor (2012)',
    ('Jim Paxson', '1956', 'CIN'): 'Jim Paxson (1956)',
    ('Jim Paxson', '1979', 'BOS'): 'Jim Paxson (1979)',
    ('Johnny Davis', '1976', 'ATL'): 'Johnny Davis (1976)',
    ('Johnny Davis', '2022', 'WAS'): 'Johnny Davis (2022)',
    ('Ken Johnson', '1985', 'POR'): 'Ken Johnson (1985)',
    ('Ken Johnson', '2002', 'MIA'): 'Ken Johnson (2002)',
    ('Luke Jackson', '1964', 'PHI'): 'Luke Jackson (1964)',
    ('Luke Jackson', '2004', 'CLE'): 'Luke Jackson (2004)',
    ('Marcus Williams', '2006', 'GSW'): 'Marcus Williams (2006)',
    ('Marcus Williams', '2007', 'LAC'): 'Marcus Williams (2007)',
    ('Mark Davis', '1988', 'MIL'): 'Mark Davis (1988)',
    ('Mark Davis', '1995', 'GSW'): 'Mark Davis (1995)',
    ('Mark Jones', '1983', 'NJN'): 'Mark Jones (1983)',
    ('Mark Jones', '2004', 'ORL'): 'Mark Jones (2004)',
    ('Matt Guokas', '1946', 'PHW'): 'Matt Guokas (1946)',
    ('Matt Guokas', '1966', 'BUF'): 'Matt Guokas (1966)',
    ('Michael Smith', '1989', 'BOS'): 'Michael Smith (1989)',
    ('Michael Smith', '1994', 'SAC'): 'Michael Smith (1994)',
    ('Mike Davis', '1969', 'BAL'): 'Mike Davis (1969)',
    ('Mike Davis', '1982', 'NYK'): 'Mike Davis (1982)',
    ('Mike Dunleavy', '1976', 'HOU'): 'Mike Dunleavy (1976)',
    ('Mike Dunleavy', '2002', 'ATL'): 'Mike Dunleavy (2002)',
    ('Mike James', '2001', 'BOS'): 'Mike James (2001)',
    ('Mike James', '2017', 'BRK'): 'Mike James (2017)',
    ('Nate Williams', '1971', 'CIN'): 'Nate Williams (1971)',
    ('Nate Williams', '2022', 'GSW'): 'Nate Williams (2022)',
    ('Patrick Ewing', '1985', 'NYK'): 'Patrick Ewing (1985)',
    ('Patrick Ewing', '2010', 'NOH'): 'Patrick Ewing (2010)',
    ('Reggie Williams', '1987', 'CLE'): 'Reggie Williams (1987)',
    ('Reggie Williams', '2009', 'CHA'): 'Reggie Williams (2009)',
    ('Sam Williams', '1968', 'MIL'): 'Sam Williams (1968)',
    ('Sam Williams', '1981', 'GSW'): 'Sam Williams (1981)',
    ('Tony Mitchell', '2013', 'DET'): 'Tony Mitchell (DET)',
    ('Tony Mitchell', '2013', 'MIL'): 'Tony Mitchell (MIL)',
    ('Walker Russell', '1982', 'ATL'): 'Walker Russell (1982)',
    ('Walker Russell', '2011', 'DET'): 'Walker Russell (2011)',
}
_DISAMBIG_NAMES = set(k[0] for k in PLAYER_DISAMBIG)
_player_first_seen = {}  # name -> (first_year, first_team)

USE_MARGIN = True  # experimental: scale K by GmSc differential

def build_elo(df):
    if "Unnamed: 6" in df.columns:
        df.rename(columns={"Unnamed: 6": "home_away"}, inplace=True)

    df["GmSc"] = pd.to_numeric(df["GmSc"], errors="coerce")

    # ── CSV-level player name disambiguation ────────────────────────────────
    # Eddie Johnson (two separate players with same name)
    mask_eja = (df["Player"] == "Eddie Johnson") & (df["Team"].isin(["SAC","KCK","PHX","PHO","OKC","IND","HOU","SEA","CHH","CHA"]))
    mask_ejl = (df["Player"] == "Eddie Johnson") & (df["Team"].isin(["ATL","CLE"]))
    df.loc[mask_eja, "Player"] = "Eddie Johnson (1981)"
    df.loc[mask_ejl, "Player"] = "Eddie Johnson (1977)"
    # Larry Johnson (1977 LAC vs 1991 CHH/NYK)
    mask_lj77 = (df["Player"] == "Larry Johnson") & (df["Team"] == "LAC")
    mask_lj91 = (df["Player"] == "Larry Johnson") & (df["Team"].isin(["CHA","CHH","CHO","NYK"]))
    df.loc[mask_lj77, "Player"] = "Larry Johnson (1977)"
    df.loc[mask_lj91, "Player"] = "Larry Johnson (1991)"

    # ── Additional player name disambiguation (year-based splits) ────────────
    _yr = pd.to_numeric(df["Date"].astype(str).str[:4], errors="coerce").fillna(0).astype(int)
    _p  = df["Player"]

    # Bobby Jones: 1976-1986 DEN/PHI vs 2006-2008 modern
    df.loc[(_p=="Bobby Jones") & (_yr <= 1986), "Player"] = "Bobby Jones (1976)"
    df.loc[(_p=="Bobby Jones") & (_yr >= 2006), "Player"] = "Bobby Jones (2006)"

    # Brandon Williams: 1997-2003 ATL/GSW/SAS vs 2021+ DAL/POR
    df.loc[(_p=="Brandon Williams") & (_yr <= 2003), "Player"] = "Brandon Williams (1997)"
    df.loc[(_p=="Brandon Williams") & (_yr >= 2021), "Player"] = "Brandon Williams (2021)"

    # Charles Jones: three players - use team splits
    df.loc[(_p=="Charles Jones") & (df["Team"].isin(["CHI","DET","HOU","PHI","WSB","WAS"])) & (_yr <= 1998), "Player"] = "Charles Jones (1983)"
    df.loc[(_p=="Charles Jones") & (df["Team"].isin(["PHX","POR"])), "Player"] = "Charles Jones (1984)"
    df.loc[(_p=="Charles Jones") & (_yr >= 1998), "Player"] = "Charles Jones (1998)"

    # Charles Smith: LAC/NYK/SAS vs BOS/MIN vs DEN/MIA/POR
    df.loc[(_p=="Charles Smith") & (df["Team"].isin(["LAC","NYK","SAS"])), "Player"] = "Charles Smith (1988)"
    df.loc[(_p=="Charles Smith") & (df["Team"].isin(["BOS","MIN"])), "Player"] = "Charles Smith (1989)"
    df.loc[(_p=="Charles Smith") & (df["Team"].isin(["DEN","MIA","POR"])), "Player"] = "Charles Smith (1997)"

    # Chris Johnson: 2010-2012 BOS/MIN/NOH/POR vs 2012+ BOS/MEM/MIL/PHI/UTA
    df.loc[(_p=="Chris Johnson") & (_yr <= 2012) & (df["Team"].isin(["BOS","MIN","NOH","POR"])), "Player"] = "Chris Johnson (2010)"
    df.loc[(_p=="Chris Johnson") & (_yr >= 2013), "Player"] = "Chris Johnson (2012)"
    df.loc[(_p=="Chris Johnson") & (_yr == 2012) & (df["Team"].isin(["MEM","MIL","PHI","UTA"])), "Player"] = "Chris Johnson (2012)"

    # Chris Smith: 1992 MIN vs 2013 NYK
    df.loc[(_p=="Chris Smith") & (_yr <= 1995), "Player"] = "Chris Smith (1992)"
    df.loc[(_p=="Chris Smith") & (_yr >= 2013), "Player"] = "Chris Smith (2013)"

    # Chris Wright: GSW/MIL vs DAL
    df.loc[(_p=="Chris Wright") & (df["Team"].isin(["GSW","MIL"])), "Player"] = "Chris Wright (2011)"
    df.loc[(_p=="Chris Wright") & (df["Team"] == "DAL"), "Player"] = "Chris Wright (2012)"

    # Dee Brown: 1990-2001 BOS/ORL/TOR vs 2006-2008 PHX/UTA/WAS
    df.loc[(_p=="Dee Brown") & (_yr <= 2002), "Player"] = "Dee Brown (1990)"
    df.loc[(_p=="Dee Brown") & (_yr >= 2006), "Player"] = "Dee Brown (2006)"

    # George Johnson: three players by year
    df.loc[(_p=="George Johnson") & (df["Team"].isin(["BAL","HOU","DLC"])) & (_yr <= 1974), "Player"] = "George Johnson (1970)"
    df.loc[(_p=="George Johnson") & (_yr >= 1972) & (df["Team"].isin(["ATL","BUF","GSW","NJN","SAS","SEA","BKN","OKC","NOP","NOH","LAC"])), "Player"] = "George Johnson (1972)"
    df.loc[(_p=="George Johnson") & (df["Team"].isin(["DEN","IND","MIL","PHI","WSB","WAS","LAC","BUF"])), "Player"] = "George Johnson (1978)"

    # Gerald Henderson: 1979-1992 BOS/DET/HOU/MIL/NYK/PHI/SEA vs 2009+ CHA/POR/PHI
    df.loc[(_p=="Gerald Henderson") & (_yr <= 1992), "Player"] = "Gerald Henderson (1979)"
    df.loc[(_p=="Gerald Henderson") & (_yr >= 2009), "Player"] = "Gerald Henderson (2009)"

    # Greg Smith: 1968-1976 HOU/MIL/POR vs 2011+ DAL/HOU/MIN
    df.loc[(_p=="Greg Smith") & (_yr <= 1977), "Player"] = "Greg Smith (1968)"
    df.loc[(_p=="Greg Smith") & (_yr >= 2011), "Player"] = "Greg Smith (2011)"

    # Jeff Taylor: 1982-1987 DET/HOU vs 2012+ CHA/CHO
    df.loc[(_p=="Jeff Taylor") & (_yr <= 1987), "Player"] = "Jeff Taylor (1982)"
    df.loc[(_p=="Jeff Taylor") & (_yr >= 2012), "Player"] = "Jeff Taylor (2012)"

    # Jim Paxson: 1956-1958 CIN/MNL vs 1979-1990 BOS/POR
    df.loc[(_p=="Jim Paxson") & (_yr <= 1959), "Player"] = "Jim Paxson (1956)"
    df.loc[(_p=="Jim Paxson") & (_yr >= 1979), "Player"] = "Jim Paxson (1979)"

    # Johnny Davis: 1976-1986 ATL/CLE/IND/POR vs 2022+ WAS
    df.loc[(_p=="Johnny Davis") & (_yr <= 1987), "Player"] = "Johnny Davis (1976)"
    df.loc[(_p=="Johnny Davis") & (_yr >= 2022), "Player"] = "Johnny Davis (2022)"

    # Marcus Williams: 2006-2007 GSW/MEM/NJN vs 2007-2010 LAC/SAS
    df.loc[(_p=="Marcus Williams") & (df["Team"].isin(["GSW","MEM","NJN"])), "Player"] = "Marcus Williams (2006)"
    df.loc[(_p=="Marcus Williams") & (df["Team"].isin(["LAC","SAS"])), "Player"] = "Marcus Williams (2007)"

    # Mark Davis: 1988-1990 MIL/PHX vs 1995-2000 GSW/MIA/MIN/PHI
    df.loc[(_p=="Mark Davis") & (_yr <= 1991), "Player"] = "Mark Davis (1988)"
    df.loc[(_p=="Mark Davis") & (_yr >= 1995), "Player"] = "Mark Davis (1995)"

    # Mike Davis: 1969-1972 BAL/BUF vs 1982-1983 NYK
    df.loc[(_p=="Mike Davis") & (_yr <= 1973), "Player"] = "Mike Davis (1969)"
    df.loc[(_p=="Mike Davis") & (_yr >= 1982), "Player"] = "Mike Davis (1982)"

    # Mike Dunleavy: 1976-1990 PHI/HOU/SAS/MIL vs 2002+ GSW/IND/MIL/CHI/ATL
    df.loc[(_p=="Mike Dunleavy") & (_yr <= 1990), "Player"] = "Mike Dunleavy (1976)"
    df.loc[(_p=="Mike Dunleavy") & (_yr >= 2002), "Player"] = "Mike Dunleavy (2002)"

    # Mike James: 2001-2014 vs 2017+
    df.loc[(_p=="Mike James") & (_yr <= 2014), "Player"] = "Mike James (2001)"
    df.loc[(_p=="Mike James") & (_yr >= 2017), "Player"] = "Mike James (2017)"

    # Nate Williams: 1971-1977 CIN/GSW/KCO/NOJ vs 2022+ GSW/HOU/POR
    df.loc[(_p=="Nate Williams") & (_yr <= 1977), "Player"] = "Nate Williams (1971)"
    df.loc[(_p=="Nate Williams") & (_yr >= 2022), "Player"] = "Nate Williams (2022)"

    # Patrick Ewing: 1985-2002 NYK/ORL/SEA vs 2010-2011 NOH
    df.loc[(_p=="Patrick Ewing") & (_yr <= 2002), "Player"] = "Patrick Ewing (1985)"
    df.loc[(_p=="Patrick Ewing") & (_yr >= 2010), "Player"] = "Patrick Ewing (2010)"

    # Reggie Williams: 1987-1997 LAC/CLE/DEN/NJN vs 2009+ GSW/CHA/OKC/SAS/NOP
    df.loc[(_p=="Reggie Williams") & (_yr <= 1997), "Player"] = "Reggie Williams (1987)"
    df.loc[(_p=="Reggie Williams") & (_yr >= 2009), "Player"] = "Reggie Williams (2009)"

    # Sam Williams: only one in data (MIL 1968-1970), other (GSW/PHI 1981) may not exist
    df.loc[(_p=="Sam Williams") & (_yr <= 1970), "Player"] = "Sam Williams (1968)"
    df.loc[(_p=="Sam Williams") & (_yr >= 1981), "Player"] = "Sam Williams (1981)"

    # Walker Russell: 1982-1986 ATL/DET/IND vs 2011-2012 DET
    df.loc[(_p=="Walker Russell") & (_yr <= 1986), "Player"] = "Walker Russell (1982)"
    df.loc[(_p=="Walker Russell") & (_yr >= 2011), "Player"] = "Walker Russell (2011)"


    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df["MP"]   = pd.to_numeric(df["MP"],   errors="coerce")

    # Compute GmSc from raw stats wherever it's missing
    stat_cols = ["PTS","FG","FGA","FT","FTA","ORB","DRB","TRB","STL","BLK","AST","TOV","PF"]
    for col in stat_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        else:
            df[col] = 0.0

    missing_gmsc = df["GmSc"].isna()
    if missing_gmsc.sum() > 0:
        yr = df.loc[missing_gmsc, "Date"].dt.year.fillna(0).astype(int)
        pre74 = yr < 1974
        # Modern formula
        df.loc[missing_gmsc & ~pre74, "GmSc"] = (
            df["PTS"] + 0.4*df["FG"] - 0.7*df["FGA"] - 0.4*(df["FTA"]-df["FT"])
            + 0.7*df["ORB"] + 0.3*df["DRB"] + df["STL"] + 0.7*df["AST"]
            + 0.7*df["BLK"] - 0.4*df["PF"] - df["TOV"]
        ).loc[missing_gmsc & ~pre74]
        # Pre-1974 formula (no STL/BLK)
        df.loc[missing_gmsc & pre74, "GmSc"] = (
            df["PTS"] + 0.4*df["FG"] - 0.7*df["FGA"] - 0.4*(df["FTA"]-df["FT"])
            + 0.7*df["TRB"] + 0.7*df["AST"] - 0.4*df["PF"]
        ).loc[missing_gmsc & pre74]
        print(f"  Computed GmSc for {missing_gmsc.sum()} rows from raw stats")
    # Drop rows with unparseable dates
    nat_count = df["Date"].isna().sum()
    if nat_count: print(f"  Dropping {nat_count} rows with invalid dates")
    df = df.dropna(subset=["Date"]).copy()

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
    peak_fpr_rank_map = {}  # best global rank ever achieved
    games_at_1_map    = {}  # total game-days held global #1
    cur_streak_map    = {}  # current streak (game-days) at #1
    max_streak_map    = {}  # best streak at #1
    last_date_at_1    = {}  # last date each player was #1 (dedup per day)
    gmsc_hist    = defaultdict(list)  # kept for computing recent/career avg scalars
    team_hist    = defaultdict(list)   # only records team changes
    opp_map      = {}                  # opponent per game
    won_map      = {}                  # result per game
    team_map     = {}
    last_played  = {}

    def k_factor(n):
        if n < 20:  return 40
        if n < 100: return 50
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

        group_by_player = {row["Player"]: row for _, row in group.iterrows()}
        for p in players:
            init(p)
            prow           = group_by_player.get(p)
            if prow is None: continue
            team_map[p]    = prow["Team"]
            opp_map[p]     = str(prow["Opp"]).strip() if "Opp" in group.columns and str(prow.get("Opp","")).strip() not in ("","nan") else str(prow["Team"])
            result_str     = str(prow.get("Result","")).strip()
            won_map[p]     = result_str.startswith("W") if result_str else None
            # Charlotte disambiguation using franchise CSV
            if (p, date_str) in charlotte_keys:
                team_map[p] = "CHO"  # confirmed Charlotte
            elif team_map.get(p) == "CHO":
                team_map[p] = "NOH"  # CHO in BDL but not Charlotte = New Orleans
            last_played[p] = date_str

        deltas = defaultdict(float)
        for a in players:
            for b in players:
                if a == b: continue
                ea, eb = elo[a], elo[b]
                exp_a  = 1 / (1 + 10 ** ((eb - ea) / 620))
                ga, gb = gmsc[a], gmsc[b]
                act_a  = 1.0 if ga > gb else (0.5 if ga == gb else 0.0)
                k_eff  = k_factor(games_played[a]) / (n ** 0.5)
                if USE_MARGIN:
                    # Scale by log of GmSc differential — diminishing returns on dominance
                    # Clip at 0 to avoid negative differentials amplifying losses
                    diff = max(0.0, ga - gb) if ga > gb else max(0.0, gb - ga)
                    # Normalize: typical GmSc range ~0-40, ln(41) ~ 3.7
                    margin_factor = math.log1p(diff) / math.log1p(20)
                    # Cap at 2.0x, floor at 0.5x — don't let margin dominate
                    margin_factor = max(0.5, min(2.0, margin_factor))
                    k_eff *= margin_factor
                deltas[a] += k_eff * (act_a - exp_a)

        for p in players:
            elo[p]          += deltas[p]
            games_played[p] += 1
            if elo[p] > peak_elo[p]: peak_elo[p] = elo[p]
            elo_hist[p].append([date_str, round(elo[p], 1), opp_map.get(p,""), won_map.get(p), team_map.get(p,"")])
            gmsc_hist[p].append([date_str, round(gmsc[p], 1)])
            # Record team only when it changes
            cur_team = team_map.get(p, '')
            if not team_hist[p] or team_hist[p][-1][1] != cur_team:
                team_hist[p].append([date_str, cur_team])

        sorted_by_elo = sorted(players, key=lambda p: -elo[p])
        # Global FPR rank snapshot — sort ALL players after every game
        global_sorted = sorted(elo.keys(), key=lambda p: -elo[p])
        top_player = global_sorted[0]
        for global_rank, p in enumerate(global_sorted, 1):
            if p not in peak_fpr_rank_map or global_rank < peak_fpr_rank_map[p]:
                peak_fpr_rank_map[p] = global_rank
            # Track game-days at #1 (once per calendar date, not per game)
            if global_rank == 1:
                if last_date_at_1.get(p) != date_str:
                    games_at_1_map[p] = games_at_1_map.get(p, 0) + 1
                    last_date_at_1[p] = date_str
                cur_streak_map[p] = cur_streak_map.get(p, 0) + 1
                if cur_streak_map[p] > max_streak_map.get(p, 0):
                    max_streak_map[p] = cur_streak_map[p]
            else:
                cur_streak_map[p] = 0

    all_players = sorted(elo.keys(), key=lambda p: -elo[p])

    # FPR eligibility — current season only prevents retired players qualifying
    CURRENT_SEASON_START = "2025-10-01"
    team_game_dates = defaultdict(set)
    for pl, games in gmsc_hist.items():
        for d, _ in games:
            if d >= CURRENT_SEASON_START:
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
            "fpr_rank":         None,  # assigned below after eligibility is known
            "games_played":     games_played[player],
            "recent_gmsc_avg":  round(recent_avg, 1),
            "career_gmsc_avg":  round(career_avg, 1),
            "last_played":      lp,
            "is_fpr_eligible":  team in team_cutoff and lp >= team_cutoff[team],
            "peak_fpr_rank":    peak_fpr_rank_map.get(player, 9999),
            "_games_at_1":      games_at_1_map.get(player, 0),
            "_max_streak":      max_streak_map.get(player, 0),
            "elo_history":      elo_hist[player],
            "team_history":     team_hist[player],
        })

    # ── Badge computation ──────────────────────────────────────────────────
    peak_elo_ranking  = sorted(players_out, key=lambda p: -p["peak_elo"])
    peak_elo_rank_map = {p["name"]: i+1 for i, p in enumerate(peak_elo_ranking)}

    decade_best = defaultdict(lambda: defaultdict(float))
    for p in players_out:
        for _e in p["elo_history"]:
            date_str, elo_val = _e[0], _e[1]
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

    # Avg Elo by decade for era badges
    decade_avg = defaultdict(lambda: defaultdict(list))
    for p in players_out:
        for _e in p["elo_history"]:
            date_str, elo_val = _e[0], _e[1]
            yr     = int(date_str[:4])
            decade = (yr // 10) * 10
            decade_avg[p["name"]][decade].append(elo_val)
    decade_avg_rank_map = {}
    for decade in all_decades:
        avgs = [(name, sum(vals)/len(vals)) for name, d in decade_avg.items()
                if decade in d for vals in [d[decade]]]
        avgs.sort(key=lambda x: -x[1])
        decade_avg_rank_map[decade] = {name: i+1 for i, (name, _) in enumerate(avgs)}

    def compute_badges(p):
        badges = []
        name         = p["name"]
        curr_rank    = p["current_tpr_rank"]
        peak         = p["peak_elo"]
        gp           = p["games_played"]
        fpr_eligible = p["is_fpr_eligible"]
        pfpr         = peak_fpr_rank_map.get(name, 9999)
        games_at_1   = p.get("_games_at_1", 0)
        streak       = p.get("_max_streak", 0)

        def rank_tier(r):
            if r == 1: return 0
            if r <= 5: return 1
            if r <= 10: return 2
            if r <= 25: return 3
            if r <= 50: return 4
            if r <= 100: return 5
            return 6

        # ── FPR: Current rank (exclusive) ───────────────────────────────
        if fpr_eligible:
            t = rank_tier(curr_rank)
            if t == 0:   badges.append({"cat":"fpr","id":"current_1",     "label":"Current FPR #1",              "emoji":"🏆"})
            elif t == 1: badges.append({"cat":"fpr","id":"current_top5",  "label":f"Current FPR Top 5 (#{curr_rank})", "emoji":"⭐"})
            elif t == 2: badges.append({"cat":"fpr","id":"current_top10", "label":f"Current FPR Top 10 (#{curr_rank})","emoji":"⭐"})
            elif t == 3: badges.append({"cat":"fpr","id":"current_top25", "label":f"Current FPR Top 25 (#{curr_rank})","emoji":"📈"})
            elif t == 4: badges.append({"cat":"fpr","id":"current_top50", "label":f"Current FPR Top 50 (#{curr_rank})","emoji":"📈"})
            elif t == 5: badges.append({"cat":"fpr","id":"current_top100","label":f"Current FPR Top 100 (#{curr_rank})","emoji":"📈"})

        # ── FPR: Former rank (only if more impressive than current) ─────
        curr_tier = rank_tier(curr_rank) if fpr_eligible else 6
        peak_tier = rank_tier(pfpr)
        if peak_tier < curr_tier:
            if pfpr == 1:      badges.append({"cat":"fpr","id":"former_1",     "label":"Former FPR #1",              "emoji":"🔱"})
            elif pfpr <= 5:    badges.append({"cat":"fpr","id":"former_top5",  "label":f"Former FPR Top 5 (#{pfpr})", "emoji":"🔱"})
            elif pfpr <= 10:   badges.append({"cat":"fpr","id":"former_top10", "label":f"Former FPR Top 10 (#{pfpr})","emoji":"🏅"})
            elif pfpr <= 25:   badges.append({"cat":"fpr","id":"former_top25", "label":f"Former FPR Top 25 (#{pfpr})","emoji":"🏅"})
            elif pfpr <= 50:   badges.append({"cat":"fpr","id":"former_top50", "label":f"Former FPR Top 50 (#{pfpr})","emoji":"🏅"})
            elif pfpr <= 100:  badges.append({"cat":"fpr","id":"former_top100","label":f"Former FPR Top 100 (#{pfpr})","emoji":"🏅"})

        # ── FPR: Games at #1 and streak (both shown if qualified) ───────
        if games_at_1 >= 1:
            badges.append({"cat":"fpr","id":"games_at_1","label":f"{games_at_1}× FPR #1","emoji":"👑"})
        if streak >= 5:
            badges.append({"cat":"fpr","id":"streak_at_1","label":f"{streak}-Game FPR #1 Streak","emoji":"🔥"})

        # ── Elo Club (exclusive — highest threshold only) ────────────────
        for threshold in [3000, 2900, 2700, 2500, 2200, 2000]:
            if peak >= threshold:
                badges.append({"cat":"elo","id":f"club_{threshold}","label":f"{threshold:,} Elo Club","emoji":"⚡"})
                break

        # ── All-time peak rank (exclusive) ───────────────────────────────
        atr = peak_elo_rank_map.get(name, 9999)
        if atr == 1:       badges.append({"cat":"elo","id":"peak_1",      "label":"All-Time Peak #1",              "emoji":"🐐"})
        elif atr <= 5:     badges.append({"cat":"elo","id":"peak_top5",   "label":f"All-Time Peak Top 5 (#{atr})", "emoji":"🐐"})
        elif atr <= 10:    badges.append({"cat":"elo","id":"peak_top10",  "label":f"All-Time Peak Top 10 (#{atr})","emoji":"⚡"})
        elif atr <= 25:    badges.append({"cat":"elo","id":"peak_top25",  "label":f"All-Time Peak Top 25 (#{atr})","emoji":"⚡"})
        elif atr <= 50:    badges.append({"cat":"elo","id":"peak_top50",  "label":f"All-Time Peak Top 50 (#{atr})","emoji":"⚡"})

        # ── Longevity (exclusive — highest tier only) ────────────────────
        for threshold, emoji in [(1500,"💎"),(1000,"💎"),(750,"🏀"),(500,"🏀")]:
            if gp >= threshold:
                badges.append({"cat":"longevity","id":f"games_{threshold}","label":f"{threshold:,} Games","emoji":emoji})
                break

        # ── Era badges (per decade, exclusive within peak and avg) ───────
        era_emojis = {1940:"📼",1950:"📼",1960:"📼",1970:"📺",1980:"📺",
                      1990:"💿",2000:"💿",2010:"📱",2020:"📱"}
        for decade in all_decades:
            emoji = era_emojis.get(decade, "🏀")
            ds    = f"{decade}s"

            # Peak in decade (exclusive)
            pr = decade_rank_map.get(decade, {}).get(name)
            if pr:
                if pr == 1:       badges.append({"cat":"era","id":f"d{decade}_p1",   "label":f"{ds} Peak #1",             "emoji":emoji})
                elif pr <= 5:     badges.append({"cat":"era","id":f"d{decade}_p5",   "label":f"{ds} Peak Top 5 (#{pr})",  "emoji":emoji})
                elif pr <= 10:    badges.append({"cat":"era","id":f"d{decade}_p10",  "label":f"{ds} Peak Top 10 (#{pr})", "emoji":emoji})
                elif pr <= 25:    badges.append({"cat":"era","id":f"d{decade}_p25",  "label":f"{ds} Peak Top 25 (#{pr})", "emoji":emoji})
                elif pr <= 50:    badges.append({"cat":"era","id":f"d{decade}_p50",  "label":f"{ds} Peak Top 50 (#{pr})", "emoji":emoji})
                elif pr <= 100:   badges.append({"cat":"era","id":f"d{decade}_p100", "label":f"{ds} Peak Top 100 (#{pr})","emoji":emoji})

            # Avg in decade (exclusive)
            ar = decade_avg_rank_map.get(decade, {}).get(name)
            if ar:
                if ar == 1:       badges.append({"cat":"era","id":f"d{decade}_a1",   "label":f"{ds} Avg #1",             "emoji":emoji})
                elif ar <= 5:     badges.append({"cat":"era","id":f"d{decade}_a5",   "label":f"{ds} Avg Top 5 (#{ar})",  "emoji":emoji})
                elif ar <= 10:    badges.append({"cat":"era","id":f"d{decade}_a10",  "label":f"{ds} Avg Top 10 (#{ar})", "emoji":emoji})
                elif ar <= 25:    badges.append({"cat":"era","id":f"d{decade}_a25",  "label":f"{ds} Avg Top 25 (#{ar})", "emoji":emoji})
                elif ar <= 50:    badges.append({"cat":"era","id":f"d{decade}_a50",  "label":f"{ds} Avg Top 50 (#{ar})", "emoji":emoji})
                elif ar <= 100:   badges.append({"cat":"era","id":f"d{decade}_a100", "label":f"{ds} Avg Top 100 (#{ar})","emoji":emoji})

        return badges
    for p in players_out:
        p["badges"] = compute_badges(p)
        p.pop("_games_at_1", None)
        p.pop("_max_streak", None)

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

    # ── Disambiguate duplicate player names using elo_history ────────────────
    for _p in output["players"]:
        _n = _p["name"]
        if _n not in _DISAMBIG_NAMES: continue
        _hist = _p.get("elo_history", [])
        if not _hist: continue
        _yr = _hist[0][0][:4]
        _tm = _hist[0][4] if len(_hist[0]) > 4 else _p.get("team", "")
        _new = PLAYER_DISAMBIG.get((_n, _yr, _tm))
        if _new and _new != _n:
            _p["name"] = _new
    print(f"  Disambiguated duplicate player names")

    # ── Clean suffixes: dominant player (higher peak Elo) gets clean name ────
    base_groups = defaultdict(list)
    for _p2 in output["players"]:
        # Extract base name (strip parenthetical suffix)
        import re as _re
        _base = _re.sub(r' \(\d{4}\)$', '', _p2["name"])
        _base = _re.sub(r' \([A-Z]{2,3}\)$', '', _base)
        if _base != _p2["name"]:  # has a suffix
            base_groups[_base].append(_p2)

    for _base, _variants in base_groups.items():
        # Find ALL players with this base name (suffixed + clean)
        # Store original names for suffix recovery
        for _p2 in output["players"]:
            if "_orig_name" not in _p2:
                _p2["_orig_name"] = _p2["name"]
        _all = [_p2 for _p2 in output["players"]
                if _p2["name"] == _base or
                _re.sub(r' \(\d{4}\)$', '', _re.sub(r' \([A-Z]{2,3}\)$', '', _p2["name"])) == _base]
        if len(_all) < 2:
            continue
        # Best player gets clean name, others keep/get suffix
        _best = max(_all, key=lambda x: (x.get("peak_elo", 0), x.get("games_played", 0)))
        for _v in _all:
            if _v is _best:
                if _v["name"] != _base:
                    print(f"  Renaming {_v['name']} -> {_base} (peak {_v['peak_elo']:.0f})")
                    _v["name"] = _base
            else:
                # Ensure non-best has a suffix if it currently has the clean name
                if _v["name"] == _base:
                    # Give it a year suffix from first elo_history entry
                    _vh = _v.get("elo_history", [])
                    # Use suffix stored before renaming, else first hist year
                    _orig_suffix = _re.search(r'\((\d{4}|[A-Z]{2,3})\)', _v.get("_orig_name", _v["name"]))
                    if _orig_suffix:
                        _vsuffix = _orig_suffix.group(1)
                    elif _vh:
                        _vsuffix = _vh[0][0][:4]
                    else:
                        _vsuffix = "?"
                    _v["name"] = f"{_base} ({_vsuffix})"
                    print(f"  Adding suffix: {_v['name']} (peak {_v['peak_elo']:.0f})")

    print(f"  {output['total_players']} players · {output['total_games']} games")


    # Assign fpr_rank — rank among eligible players only, sorted by current Elo
    eligible_sorted = sorted(
        [p for p in output["players"] if p.get("is_fpr_eligible")],
        key=lambda p: -p["current_elo"]
    )
    fpr_rank_map = {p["name"]: i + 1 for i, p in enumerate(eligible_sorted)}
    for p in output["players"]:
        p["fpr_rank"] = fpr_rank_map.get(p["name"])

    # Strip internal tracking fields before output
    for _p3 in output["players"]:
        _p3.pop("_orig_name", None)

    out_path = Path("public/data/elo.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    print(f"  Written {out_path} ({out_path.stat().st_size/1024:.0f} KB)")

    all_dates = sorted(set(h[0] for p in output["players"] for h in p["elo_history"]))
    date_idx  = {d: i for i, d in enumerate(all_dates)}
    sparse_players = [[[date_idx[e[0]], e[1]] for e in p["elo_history"]] for p in output["players"]]
    spag = {"dates": all_dates, "players": sparse_players}
    spag_path = Path("public/data/spaghetti.json")
    spag_path.write_text(json.dumps(spag, separators=(",", ":")), encoding="utf-8")
    print(f"  Written {spag_path} ({spag_path.stat().st_size/1024:.0f} KB)")
    # ── Build games.json ─────────────────────────────────────────────────────
    print("  Building games index...")
    # Build lookup: player name -> list of elo_history entries
    player_hist = {p["name"]: p["elo_history"] for p in output["players"]}

    # Group all game entries by (date, team) to reconstruct games
    # Each elo_history entry: [date, elo, opp, won, team]
    game_map = defaultdict(lambda: defaultdict(list))  # date -> frozenset(teamA,teamB) -> [entries]
    for p in output["players"]:
        for e in p["elo_history"]:
            if len(e) >= 5 and e[2] and e[4]:
                key = frozenset([e[4], e[2]])  # team vs opp
                game_map[e[0]][key].append({"name": p["name"], "elo": round(e[1], 1), "team": e[4], "won": e[3]})

    # Normalize Elo range for 0-100 score
    ELO_MIN, ELO_MAX = 1400, 3100

    def elo_score(elo):
        return round(max(0, min(100, (elo - ELO_MIN) / (ELO_MAX - ELO_MIN) * 100)), 1)

    games_list = []
    for date, keys in game_map.items():
        for teams_key, players in keys.items():
            teams = list(teams_key)
            if len(teams) != 2: continue
            teamA, teamB = sorted(teams)
            pA = [p for p in players if p["team"] == teamA]
            pB = [p for p in players if p["team"] == teamB]
            if not pA or not pB: continue
            avgA = sum(p["elo"] for p in pA) / len(pA)
            avgB = sum(p["elo"] for p in pB) / len(pB)
            overall = (avgA * len(pA) + avgB * len(pB)) / (len(pA) + len(pB))
            # Sort players by elo desc, keep top 12 per team for size
            pA_sorted = sorted(pA, key=lambda x: -x["elo"])[:12]
            pB_sorted = sorted(pB, key=lambda x: -x["elo"])[:12]
            games_list.append({
                "date":    date,
                "teamA":   teamA,
                "teamB":   teamB,
                "scoreA":  elo_score(avgA),
                "scoreB":  elo_score(avgB),
                "score":   elo_score(overall),
                "playersA": [{"n": p["name"], "e": round(p["elo"]), "w": p["won"]} for p in pA_sorted],
                "playersB": [{"n": p["name"], "e": round(p["elo"]), "w": p["won"]} for p in pB_sorted],
            })

    # Sort by overall strength descending
    # Normalize scores so max = 100
    if games_list:
        max_s = max(g["score"] for g in games_list)
        for g in games_list:
            g["score"]  = round(g["score"]  / max_s * 100, 1)
            g["scoreA"] = round(g["scoreA"] / max_s * 100, 1)
            g["scoreB"] = round(g["scoreB"] / max_s * 100, 1)
    games_list.sort(key=lambda g: -g["score"])

    games_out = {"games": games_list}
    games_path = Path("public/data/games.json")
    games_path.write_text(json.dumps(games_out, separators=(",", ":")), encoding="utf-8")
    print(f"  Written {games_path} ({games_path.stat().st_size/1024:.0f} KB, {len(games_list):,} games)")

    print("Done.")
