import { useState, useEffect } from 'react'
import Rankings from './components/Rankings'
import PlayerModal from './components/PlayerModal'
import Nav from './components/Nav'
import styles from './App.module.css'

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [view, setView] = useState('rankings') // 'rankings' | 'methodology'

  useEffect(() => {
    fetch('/data/elo.json')
      .then(r => { if (!r.ok) throw new Error('Failed to load data'); return r.json() })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div className={styles.splash}>
      <div className={styles.splashInner}>
        <div className={styles.splashTitle}>NBA · TPR</div>
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
      <Nav
        meta={data}
        view={view}
        setView={setView}
      />
      {view === 'rankings' && (
        <Rankings
          players={data.players}
          onSelectPlayer={setSelectedPlayer}
        />
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
  return (
    <div style={{ maxWidth: 720, margin: '3rem auto', padding: '0 1.5rem' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, marginBottom: '1.5rem', letterSpacing: 0.5 }}>
        Methodology
      </h2>
      {[
        ['What is this?', 'A per-game pairwise Elo rating system for NBA players. Every player\'s rating updates after each game based on their Game Score relative to every other player in that game — teammates included.'],
        ['Game Score', 'The pre-computed Basketball-Reference Game Score (GmSc) is used as the performance signal. GmSc = PTS + 0.4×FGM − 0.7×FGA − 0.4×(FTA−FTM) + 0.7×ORB + 0.3×DRB + STL + 0.7×AST + 0.7×BLK − 0.4×PF − TOV. Only players with 10+ minutes are included to filter garbage time.'],
        ['Pairwise Elo update', 'For each game, every pair of players is compared. If player A outscored player B by Game Score, A gains Elo and B loses Elo — proportional to how surprising the result was given their pre-game ratings. All changes apply simultaneously; no player\'s rating is updated mid-game.'],
        ['K-factor', 'Dynamic: 40 for first 20 games (high volatility), 28 for games 21–100, 20 for veterans. This prevents a small sample from locking in an unreliable rating.'],
        ['Field strength', 'Built in. Beating a game full of high-Elo players earns more than beating a game of low-Elo players — no separate adjustment needed.'],
        ['TPR Rank', 'Tour Performance Rank — each player\'s global rank by current Elo among all active players this season.'],
        ['Recent GmSc', 'Unweighted average of the player\'s last 10 games by Game Score — a simple recent-form indicator.'],
        ['Data source', 'Basketball-Reference game logs for the 2025-26 NBA season. Updated manually by uploading new CSV exports.'],
      ].map(([title, body]) => (
        <div key={title} style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--accent2)', marginBottom: 4, letterSpacing: 0.3 }}>{title}</div>
          <div style={{ color: 'var(--text2)', lineHeight: 1.7, fontSize: 14 }}>{body}</div>
        </div>
      ))}
    </div>
  )
}
