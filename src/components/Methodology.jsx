const SECTIONS = [
  {
    title: 'What the FPR Measures',
    body: `The Floor Performance Ranking answers a specific question: among all NBA players throughout history, who has been most dominant relative to their peers — and among active players, who is performing at the highest level right now?

It is derived from an Elo rating system — the same mathematical framework used in chess, tennis, and competitive gaming to measure relative skill through head-to-head outcomes. Every player starts at 1,500. Every game updates their rating based on how they performed against every other player in that game.

Unlike traditional NBA metrics that measure a player in isolation (points per game, PER, BPM), the FPR is driven entirely by outcomes relative to specific opponents. Dominating a game full of highly-rated players moves your rating more than dominating a game of lower-rated ones — competitive context is built into the rating itself, not externally assigned.`,
  },
  {
    title: 'Adapting Chess Elo for Basketball',
    body: `Chess Elo is designed for two-player sequential competition. A basketball game involves ten active players simultaneously. We bridge this by decomposing each game into a full set of implied head-to-head matchups.

For a game with N players, each pair (i, j) constitutes one matchup. The player with the higher Game Score wins the matchup. A game with 20 players generates 190 pairings — each player faces every other player exactly once. This preserves the pairwise logic of Elo while accounting for the full competitive context of the game.

All rating changes are calculated using pre-game ratings and applied simultaneously. No player's Elo is updated mid-game — doing so would create arbitrary ordering effects based on calculation sequence.`,
  },
  {
    title: 'Game Score: The Performance Signal',
    body: `Game Score is the within-game performance metric used for pairwise comparison. The formula differs by era depending on which statistics were tracked.

Modern era (1973–74 onward):
GmSc = PTS + 0.4×FGM − 0.7×FGA − 0.4×(FTA−FTM) + 0.7×ORB + 0.3×DRB + STL + 0.7×AST + 0.7×BLK − 0.4×PF − TOV

Pre-1974 era (blocks and steals not tracked):
GmSc = PTS + 0.4×FGM − 0.7×FGA − 0.4×(FTA−FTM) + 0.7×TRB + 0.7×AST − 0.4×PF

The pre-1974 formula uses total rebounds with a 0.7 weight (versus the standard 0.3 for defensive rebounds) as a proxy for defensive presence, partially compensating for the absence of blocked shots and steals. This adjustment meaningfully improves the rankings of elite defensive players like Bill Russell, whose raw scoring alone would dramatically understate his dominance.

A 20-point Game Score represents an excellent performance. 30+ is exceptional. Negative values indicate a performance that hurt the team.`,
  },
  {
    title: 'The Rating Update Formula',
    body: `For each game, every player's expected win probability against every other player is calculated using their pre-game ratings:

E(i vs j) = 1 / (1 + 10^((Rⱼ − Rᵢ) / 650))

The D parameter of 650 (versus the standard chess value of 400) widens the probability curve, allowing ratings to spread further before hitting diminishing returns. This calibration was chosen to produce a top all-time peak near 3,100 — analogous to Magnus Carlsen's chess peak of 2,882 relative to the broader distribution.

The actual result is binary: 1 if player i's Game Score exceeded player j's, 0.5 if equal, 0 otherwise. The total rating change is:

ΔRᵢ = Σ K_eff × (actual − expected) for all opponents j`,
  },
  {
    title: 'Game-Size Normalization',
    body: `Raw pairwise summation creates a scaling problem: a player in a 24-person game participates in 23 comparisons, while a player in a 10-person game participates in 9. Without correction, large games would produce far more rating movement than small ones.

We correct this by dividing the K-factor by the square root of the number of players:

K_effective = K / √N

This normalization comes from statistical theory: when summing N random variables, variance scales with √N. Dividing by √N keeps effective rating sensitivity consistent regardless of game size. Early BAA seasons with 8-10 players per game are treated equivalently to modern 15-player games.`,
  },
  {
    title: 'K-Factor: Variable Sensitivity',
    body: `The K-factor controls how much a single game can move a player's rating. We use a three-tier variable K:

K = 40 — games 1 through 20 (new player, rapid convergence)
K = 50 — games 21 through 100 (establishing, moderate sensitivity)
K = 28 — games 101+ (established veteran, stable rating)

New players' ratings converge quickly toward their true level. The mid-career tier (games 21–100) uses a slightly higher K than veterans, accelerating the establishment of a reliable baseline while remaining sensitive to sustained performance changes. Veterans' ratings shift meaningfully only through extended performance changes — a single exceptional game won't dramatically reprice a player with 500 career appearances.`,
  },
  {
    title: 'FPR Eligibility',
    body: `The current FPR leaderboard shows only eligible players. A player is FPR-eligible if they have appeared in at least one of their team's last 20 games.

This window is intentionally team-relative rather than calendar-relative. A player whose team has been eliminated from the playoffs remains eligible if they appeared regularly through their team's final games. A player who missed the final stretch of their team's season due to injury falls outside the eligibility window regardless of calendar date.

The 20-game window represents roughly one quarter of a regular season — enough to establish recent form while remaining sensitive to extended absences. Ineligible players retain their full cumulative Elo rating and appear in Historical Elo and GOAT Rankings; they simply do not appear on the active leaderboard.

Both regular season and playoff games count toward eligibility and Elo accumulation. Playoff games carry the same weight as regular season games — the system does not apply a separate multiplier for postseason performance.`,
  },
  {
    title: 'Peak FPR Rank',
    body: `Peak FPR Rank records the best global rank a player ever held during the simulation — the highest position they ever occupied among all players by current Elo at any point in their career.

This differs from Peak Elo in that it accounts for the competitive landscape at the time. A player who peaked at 2,800 Elo in an era when the #1 player was at 2,850 achieved a higher peak FPR rank than a player who peaked at 2,800 when the #1 player was at 3,100.

Peak FPR Rank is computed by taking a global snapshot of all player ratings after every game and recording the best position achieved.`,
  },
  {
    title: 'GOAT Rankings',
    body: `The GOAT Rankings composite score combines three dimensions:

Peak Elo — the highest Elo rating ever achieved. Rewards players with transcendent individual seasons or stretches.

Average Elo — career average Elo across all games played. Rewards sustained excellence over time. A player who maintained a 2,600 average over 1,500 games scores higher here than a player who peaked at 2,900 but averaged 2,400.

Longevity — total games played. Rewards durability and sustained career length.

Each dimension is normalized to a 0–1 scale relative to all eligible players (minimum 200 games), then combined using user-defined weights. The resulting composite score is scaled 0–100. Because the weights sum to 100 automatically, users can freely adjust the emphasis without worrying about the total.`,
  },
  {
    title: 'Relationship to Traditional Metrics',
    body: `FPR and traditional per-game statistics answer different questions.

Points per game asks: how much does this player produce? FPR asks: based on head-to-head competitive results across their full history, how dominant has this player been relative to specific opponents in the same game?

A player who accumulates statistics in garbage time gains Game Score but faces opponents with deflated Elo ratings — the pairwise system partially self-corrects for schedule and situation. A player who consistently outperforms elite competition gains Elo disproportionate to their raw averages.

The ranking is era-consistent: a player who dominated their game in 1962 is rewarded for the same behavior as a player who dominates in 2026. Absolute Elo numbers shift across eras as league size and composition change, but the within-era rank order is consistent and meaningful. This is why the Historical Elo page includes era filters — to compare players against contemporaries rather than across 80 years of league evolution.`,
  },
]

export default function Methodology() {
  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 32px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: '#7aaa7a', marginBottom: 10 }}>
            Technical Reference
          </div>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 40, color: '#1a1a1a', marginBottom: 12, lineHeight: 1.1 }}>
            Methodology
          </h1>
          <p style={{ fontSize: 15, color: '#666', lineHeight: 1.7, borderBottom: '0.5px solid #e0ddd6', paddingBottom: 32 }}>
            A complete reference for how the Floor Performance Ranking is calculated — the mathematical framework, era adjustments, eligibility rules, and design decisions behind the system.
          </p>
        </div>

        {/* Table of contents */}
        <div style={{ background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 12, padding: '20px 24px', marginBottom: 40 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 12 }}>Contents</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SECTIONS.map((s, i) => (
              <a
                key={s.title}
                href={`#section-${i}`}
                style={{ fontSize: 13, color: '#1a2e1a', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span style={{ fontSize: 10, color: '#bbb', minWidth: 20 }}>{i + 1}.</span>
                {s.title}
              </a>
            ))}
          </div>
        </div>

        {/* Sections */}
        {SECTIONS.map((section, i) => (
          <div
            key={section.title}
            id={`section-${i}`}
            style={{ marginBottom: 40, paddingBottom: 40, borderBottom: '0.5px solid #e0ddd6' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#bbb', minWidth: 24, paddingTop: 5 }}>{i + 1}</span>
              <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: '#1a1a1a', lineHeight: 1.2 }}>
                {section.title}
              </h2>
            </div>
            <div style={{ paddingLeft: 40 }}>
              {section.body.split('\n\n').map((para, j) => {
                const isFormula = para.includes('=') && (para.includes('×') || para.includes('^') || para.includes('Σ') || para.startsWith('K =') || para.startsWith('GmSc') || para.startsWith('E(') || para.startsWith('ΔR'))
                return isFormula ? (
                  <pre key={j} style={{
                    background: '#1a2e1a', color: '#a8c5a8',
                    borderRadius: 8, padding: '14px 18px',
                    fontSize: 13, lineHeight: 1.8,
                    fontFamily: 'monospace', margin: '12px 0',
                    whiteSpace: 'pre-wrap', overflowX: 'auto',
                  }}>
                    {para}
                  </pre>
                ) : (
                  <p key={j} style={{ fontSize: 14, color: '#444', lineHeight: 1.85, marginBottom: 14 }}>
                    {para}
                  </p>
                )
              })}
            </div>
          </div>
        ))}

      </div>
    </div>
  )
}
