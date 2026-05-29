# NBA Player Elo · TPR

Per-game pairwise Elo ratings for NBA players. Every player's rating updates after each game based on Game Score rank within the game — teammates included.

**Live site:** https://nba-elo.vercel.app *(update after deploy)*

## Stack

- **Data pipeline:** Python (pandas) → static JSON
- **Frontend:** Vite + React + Recharts
- **Hosting:** Vercel (free tier, static build)

## How to update data

After each playoff round (or end of season), export a fresh game log from Basketball-Reference:

1. Go to [BBRef game logs](https://www.basketball-reference.com/play-index/pgl_finder.fcgi)
2. Export as CSV
3. Run the pipeline:
   ```bash
   # Regular season only
   python scripts/build_elo.py data/2026_NBA_regular.csv

   # Regular season + playoffs
   python scripts/build_elo.py data/2026_NBA_regular.csv data/2026_NBA_playoffs.csv
   ```
4. Commit the updated `public/data/elo.json`
5. Push to GitHub → Vercel auto-deploys

## Local development

```bash
npm install
npm run dev
```

## Architecture

```
scripts/build_elo.py     ← pipeline: CSV → public/data/elo.json
public/data/elo.json     ← static data (committed to repo)
src/
  App.jsx                ← root, data fetch, routing
  components/
    Nav.jsx              ← header + nav
    Rankings.jsx         ← leaderboard table
    PlayerModal.jsx      ← slide-in detail panel with charts
```

## Elo methodology

- **Initialization:** Every player starts at 1500 on first appearance
- **Per-game:** All players in the game compared pairwise by Game Score; Elo deltas applied simultaneously
- **K-factor:** 40 (first 20 games) → 28 (21–100 games) → 20 (veterans)
- **Minimum minutes:** 10 min threshold filters garbage time
- **Field strength:** Inherent in pairwise comparison — no separate adjustment needed

## Adding future seasons

Pass the new CSV alongside the existing one — the pipeline processes everything chronologically from scratch each run:

```bash
python scripts/build_elo.py data/2025-26.csv data/2026-27.csv
```

Update the `season` field in `build_elo.py` as needed.
