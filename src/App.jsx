import { useState, useEffect } from 'react'
import Rankings from './components/Rankings'
import Historical from './components/Historical'
import PlayerModal from './components/PlayerModal'
import Nav from './components/Nav'
import Homepage from './components/Homepage'
import styles from './App.module.css'

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [view, setView] = useState('home') // 'home' | 'rankings' | 'methodology'

  useEffect(() => {
    fetch('/data/elo.json')
      .then(r => { if (!r.ok) throw new Error('Failed to load data'); return r.json() })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div className={styles.splash}>
      <div className={styles.splashInner}>
        <div className={styles.splashTitle}>NBA · FPR</div>
        <div className={styles.splashSub}>Loading player ratings…</div>
        <div className={styles.spinner} />
      </div>
    </div>
  )

  if (error) return (
    <div className={styles.splash}>
      <div className={styles.splashInner}>
        <div className={styles.splashTitle}>Error</div>
        <div className={styles.splashSub}>{error}</div>
      </div>
    </div>
  )

  return (
    <div className={styles.app}>
      {view !== 'home' && (
        <Nav meta={data} view={view} setView={setView} />
      )}
      {view === 'home' && <Homepage data={data} setView={setView} />}
      {view === 'rankings' && (
        <Rankings players={data.players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'historical' && (
        <Historical players={data.players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'methodology' && <Methodology />}

      {selectedPlayer && (
        <PlayerModal
          player={selectedPlayer}
          allPlayers={data.players}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}

function Methodology() {
  const sections = [
    { title: "What the FPR Measures", body: `The Floor Performance Ranking answers a specific question: among NBA players who have appeared recently, who is performing at the highest level right now? It is a current-form ranking derived from an Elo rating system — the same mathematical framework used in chess, tennis, and competitive gaming to measure relative skill through head-to-head outcomes.\n\nUnlike traditional NBA metrics that measure a player in isolation (points per game, PER, BPM), the FPR is driven entirely by outcomes relative to specific opponents. Dominating a game full of highly-rated players moves your rating more than dominating a game of lower-rated ones — competitive context is built into the rating itself, not externally assigned.` },
    { title: "Adapting Chess Elo for Basketball", body: `Chess Elo is designed for two-player sequential competition. A basketball game involves ten active players simultaneously. We bridge this by decomposing each game into a full set of implied head-to-head matchups.\n\nFor a game with N eligible players, each pair (i, j) constitutes one matchup. The player with the higher Game Score wins the matchup. A game with 20 eligible players generates 190 pairings — each player faces every other player exactly once. This preserves the pairwise logic of Elo while accounting for the full competitive context of the game.` },
    { title: "Game Score: The Performance Signal", body: `Game Score is the within-game performance metric used for pairwise comparison:\n\nGmSc = PTS + 0.4×FGM − 0.7×FGA − 0.4×(FTA−FTM) + 0.7×ORB + 0.3×DRB + STL + 0.7×AST + 0.7×BLK − 0.4×PF − TOV\n\nGame Score integrates scoring efficiency, rebounding, playmaking, defense, and ball security into a single number. A 20-point Game Score represents an excellent performance; 30+ is exceptional; negative values indicate a performance that hurt the team.\n\nOnly players with 10 or more minutes played are included in the pairwise comparisons. This threshold eliminates garbage-time appearances from the rating signal — a player who enters in the final minute of a blowout should not gain or lose meaningful Elo from that appearance.` },
    { title: "The Rating Update Formula", body: `For each game, every player's expected win probability against every other player is calculated using their pre-game ratings:\n\nE(i vs j) = 1 / (1 + 10^((R_j − R_i) / 400))\n\nA 400-point rating advantage implies approximately 91% expected win probability. The actual result is binary: 1 if player i's Game Score exceeded player j's, 0.5 if equal, 0 otherwise. The total rating change is:\n\nΔR_i = Σ K_eff × (actual − expected) for all opponents j\n\nAll rating changes are calculated using pre-game ratings and applied simultaneously. No player's Elo is updated mid-game — doing so would create arbitrary ordering effects based on calculation sequence.` },
    { title: "Game-Size Normalization", body: `Raw pairwise summation creates a scaling problem: a player in a 24-person game participates in 23 comparisons, allowing swings of up to 23×K per game. An exceptional performance in a large game would generate far more rating movement than an equally exceptional performance in a smaller one.\n\nWe correct this by dividing the K-factor by the square root of the number of players:\n\nK_effective = K / √N\n\nThis normalization comes from statistical theory: when summing N random variables, variance scales with √N. Dividing by √N keeps effective rating sensitivity consistent regardless of game size. A historically dominant performance still moves the needle — it just doesn't produce artificial inflation from field-size alone.` },
    { title: "K-Factor: Variable Sensitivity", body: `The K-factor controls how much a single game can move a player's rating. We use a three-tier variable K:\n\nK = 40 — games 1 through 20 (new player, high volatility)\nK = 28 — games 21 through 100 (establishing, moderate sensitivity)\nK = 20 — games 100+ (established veteran, stable rating)\n\nNew players' ratings converge quickly toward their true level. Veterans' ratings shift meaningfully only through sustained performance changes — a single exceptional game won't dramatically reprice a player with 500 career appearances. This mirrors the FIDE chess standard and prevents early-career noise from permanently distorting a player's historical record.` },
    { title: "FPR Eligibility", body: `The FPR leaderboard shows only eligible players by default. A player is FPR-eligible if they have appeared in at least one of their team's last 20 games.\n\nThis window is intentionally team-relative rather than calendar-relative. A player whose team has been eliminated from the playoffs remains eligible if they appeared regularly through their team's final games. A player who missed the final stretch of their team's season due to injury falls outside the eligibility window regardless of calendar date.\n\nThe 20-game window represents roughly one quarter of a regular season — enough to establish recent form while remaining sensitive to extended absences. Ineligible players retain their cumulative Elo rating and appear in the full player search; they simply do not occupy a position on the active leaderboard.` },
    { title: "Current vs. Peak Elo", body: `Current Elo reflects a player's rating after their most recent game. Because Elo rises with strong performances and falls with poor ones, a player performing below their historical level will have a lower current Elo than their career peak — no explicit decay mechanism is required. The system is self-correcting through actual competitive results.\n\nPeak Elo is the highest rating achieved at any point in a player's history. It is a fixed historical record — it does not change retroactively as new data is added. A player's peak reflects the apex of their competitive dominance as measured at the time they achieved it.` },
    { title: "Field Strength and Historical Baselines", body: `Field strength is inherent to the pairwise structure. Beating a game full of high-Elo players earns more rating than beating a game of lower-rated players — no external quality adjustment is needed.\n\nHistorical depth matters for baseline accuracy. Every player enters their first game at 1,500 — the universal starting point. Players who have accumulated ratings through years of competition enter each game with a rating reflecting their actual history. The FPR database covers NBA history from 1996 onward, with earlier seasons available through historical records. The deeper the history, the more established the baselines — which is why current ratings for players with long careers are more reliable signals than those for players in their first season.` },
    { title: "Relationship to Traditional Metrics", body: `FPR and traditional per-game statistics answer different questions.\n\nPoints per game asks: how much does this player produce? FPR asks: based on head-to-head competitive results across their full history, how dominant has this player been relative to specific opponents?\n\nA player who accumulates statistics on a weak team gains Game Score efficiently but grows their Elo slowly — because they rarely outperform highly-rated opponents. A player who consistently beats elite competition gains Elo disproportionate to their raw averages. The two perspectives are complementary: traditional statistics for production volume, FPR for competitive dominance.\n\nThe ranking is also era-consistent in one important sense: a player who dominated their game in 2003 is rewarded for the same behavior as a player who dominates in 2026. Absolute Elo numbers shift across eras as league composition changes, but the within-era rank order is consistent and meaningful.` },
  ]

  return (
    <div style={{ maxWidth: 760, margin: '3rem auto', padding: '0 1.5rem 4rem' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 700, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }}>
        Methodology
      </h1>
      <p style={{ color: 'var(--text2)', fontSize: 14, marginBottom: '2.5rem', lineHeight: 1.6, borderBottom: '1px solid var(--border)', paddingBottom: '1.5rem' }}>
        A complete reference for how the Floor Performance Ranking is calculated — the mathematical framework, eligibility rules, and design decisions behind the system.
      </p>
      {sections.map(({ title, body }) => (
        <div key={title} style={{ marginBottom: '2rem', paddingBottom: '2rem', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: '0.65rem', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            {title}
          </h2>
          <div style={{ color: 'var(--text2)', lineHeight: 1.85, fontSize: 14, whiteSpace: 'pre-line' }}>{body}</div>
        </div>
      ))}
    </div>
  )
}
