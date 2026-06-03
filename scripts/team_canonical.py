"""
team_canonical.py
=================
Maps every known team abbreviation (BBRef historical, BDL modern, variants)
to a single canonical modern abbreviation for that franchise.

Active franchises use current BBRef abbreviation.
Defunct franchises use their last known BBRef abbreviation.

Import with: from team_canonical import canon_team
"""

CANONICAL = {
    # ── BDL-SPECIFIC FIXES (differ from BBRef) ──────────────────────────
    "PHX": "PHO",   # BDL uses PHX; BBRef uses PHO for Phoenix Suns
    "BOM": "BOM",   # Baltimore Bullets (BAA era 1946-54) — defunct, not in games CSV
    "CHA": "NOP",   # Pre-2004 BDL CHA = original Charlotte Hornets = NOP franchise
                    # (New Charlotte Bobcats/Hornets didn't exist until 2004)
    "JET": "INJ",   # Indianapolis Jets variant
    "DN":  "DEN",   # Denver variant

    # ── ATLANTA HAWKS ────────────────────────────────────────────────────
    "TRI": "ATL", "TRH": "ATL", "MLH": "ATL", "STL": "ATL", "ATL": "ATL",

    # ── BOSTON CELTICS ───────────────────────────────────────────────────
    "BOS": "BOS",

    # ── BROOKLYN NETS ────────────────────────────────────────────────────
    "NYN": "BKN", "NJN": "BKN", "BKN": "BKN",

    # ── NEW ORLEANS PELICANS (original Charlotte Hornets franchise) ──────
    "CHH": "NOP", "NOH": "NOP", "NOK": "NOP", "NOP": "NOP",

    # ── CHICAGO BULLS ────────────────────────────────────────────────────
    "CHS": "CHI", "CHI": "CHI",

    # ── CLEVELAND CAVALIERS ──────────────────────────────────────────────
    "CLR": "CLE", "CLE": "CLE",

    # ── DALLAS MAVERICKS ─────────────────────────────────────────────────
    "DAL": "DAL",

    # ── DENVER NUGGETS ───────────────────────────────────────────────────
    "DEN": "DEN",

    # ── DETROIT PISTONS ──────────────────────────────────────────────────
    "DTF": "DET", "DEF": "DET", "FTW": "DET", "DET": "DET",

    # ── GOLDEN STATE WARRIORS ────────────────────────────────────────────
    "PHW": "GSW", "SFW": "GSW", "GSW": "GSW",

    # ── HOUSTON ROCKETS ──────────────────────────────────────────────────
    "SDR": "HOU", "HOU": "HOU",

    # ── INDIANA PACERS ───────────────────────────────────────────────────
    "IND": "IND",

    # ── LOS ANGELES CLIPPERS ─────────────────────────────────────────────
    "BUF": "LAC", "SDC": "LAC", "LAC": "LAC",

    # ── LOS ANGELES LAKERS ───────────────────────────────────────────────
    "MNL": "LAL", "LAL": "LAL",

    # ── MEMPHIS GRIZZLIES ────────────────────────────────────────────────
    "VAN": "MEM", "MEM": "MEM",

    # ── MIAMI HEAT ───────────────────────────────────────────────────────
    "MIA": "MIA",

    # ── MILWAUKEE BUCKS ──────────────────────────────────────────────────
    "MIL": "MIL",

    # ── MINNESOTA TIMBERWOLVES ───────────────────────────────────────────
    "MIN": "MIN",

    # ── NEW YORK KNICKS ──────────────────────────────────────────────────
    "NYK": "NYK",

    # ── OKLAHOMA CITY THUNDER ────────────────────────────────────────────
    "SEA": "OKC", "OKC": "OKC",

    # ── ORLANDO MAGIC ────────────────────────────────────────────────────
    "ORL": "ORL",

    # ── PHILADELPHIA 76ERS ───────────────────────────────────────────────
    "SYR": "PHI", "PHI": "PHI",

    # ── PHOENIX SUNS ─────────────────────────────────────────────────────
    "PHO": "PHO",   # BBRef abbreviation
    # PHX already mapped above

    # ── PORTLAND TRAIL BLAZERS ───────────────────────────────────────────
    "POR": "POR",

    # ── SACRAMENTO KINGS ─────────────────────────────────────────────────
    "ROC": "SAC", "CIN": "SAC", "KCO": "SAC", "KCK": "SAC", "SAC": "SAC",

    # ── SAN ANTONIO SPURS ────────────────────────────────────────────────
    "SAS": "SAS",

    # ── TORONTO RAPTORS ──────────────────────────────────────────────────
    "TOR": "TOR",

    # ── UTAH JAZZ ────────────────────────────────────────────────────────
    "NOJ": "UTA", "UTA": "UTA",

    # ── WASHINGTON WIZARDS ───────────────────────────────────────────────
    # Lineage: BAL/BOM -> CAP -> WSB -> WAS (one franchise)
    "BAL": "WAS", "CAP": "WAS", "WSB": "WAS", "WAS": "WAS",
    # Washington Capitols (WSC/HUS) are a SEPARATE defunct franchise
    # that folded in 1951 — do NOT map to WAS
    "WSC": "WSC", "HUS": "WSC",

    # ── DEFUNCT FRANCHISES ───────────────────────────────────────────────
    "AND": "AND",   # Anderson Packers
    "BLB": "BLB",   # Baltimore Bullets (BAA, distinct from WSB era)
    "CHP": "CHP",   # Chicago Packers (-> CHZ -> WAS)
    "CHZ": "CHZ",   # Chicago Zephyrs
    "DNN": "DEN",   # Denver Nuggets (BAA era)
    "INJ": "INJ",   # Indianapolis Jets
    "INO": "INO",   # Indianapolis Olympians
    "PIT": "PIT",   # Pittsburgh Ironmen
    "PRO": "PRO",   # Providence Steamrollers
    "SHE": "SHE",   # Sheboygan Redskins
    "STB": "STB",   # St. Louis Bombers
    "WAT": "WAT",   # Waterloo Hawks

    # ── SPECIAL ──────────────────────────────────────────────────────────
    "TOT": "TOT",   # BBRef multi-team season placeholder
}

def canon_team(abbr):
    """Convert any team abbreviation to its canonical modern form."""
    if not isinstance(abbr, str):
        return ""
    return CANONICAL.get(abbr.strip(), abbr.strip())
