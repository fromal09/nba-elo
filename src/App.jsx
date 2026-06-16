import { useState, useEffect } from 'react'
import Rankings from './components/Rankings'
import Historical from './components/Historical'
import FranchiseThreshold from './components/FranchiseThreshold'
import FranchiseTenures from './components/FranchiseTenures'
import BestThroughX from './components/BestThroughX'
import MysteryPlayer from './components/MysteryPlayer'
import GameExplorer from './components/GameExplorer'
import H2H from './components/H2H'
import Teams from './components/Teams'
import Seasons from './components/Seasons'
import Daily from './components/Daily'
import Methodology from './components/Methodology'
import PlayerModal from './components/PlayerModal'
import Nav from './components/Nav'
import FanSidedHeader from './components/FanSidedHeader'
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
      <FanSidedHeader />
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
      {view === 'franchise' && (
        <FranchiseThreshold players={data.players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'tenures' && (
        <FranchiseTenures players={data.players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'bestx' && (
        <BestThroughX players={data.players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'mystery' && (
        <MysteryPlayer players={data.players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'games' && (
        <GameExplorer />
      )}
      {view === 'h2h' && (
        <H2H players={data.players} />
      )}
      {view === 'teams' && (
        <Teams players={data.players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'seasons' && (
        <Seasons players={data.players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'daily' && (
        <Daily players={data.players} onSelectPlayer={setSelectedPlayer} />
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

