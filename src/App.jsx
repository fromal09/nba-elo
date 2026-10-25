import { useState, useEffect, useMemo } from 'react'
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
import SeasonExplorer from './components/SeasonExplorer'
import TimeMachine from './components/TimeMachine'
import Methodology from './components/Methodology'
import PlayerModal from './components/PlayerModal'
import Nav from './components/Nav'
import FanSidedHeader from './components/FanSidedHeader'
import Homepage from './components/Homepage'
import styles from './App.module.css'
import { loadHistory } from './history.js'
import { buildRatings } from './components/live.js'
import { useLivePlayers } from './components/liveFeed.js'

// Views that read every player's game-by-game Elo wait for history.json
const NEEDS_HISTORY = new Set(['historical', 'franchise', 'tenures', 'bestx', 'mystery', 'h2h', 'seasons', 'daily'])

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  // /scoreboard and /timemachine have their own URLs; every other view lives at /
  const PATHS = { scoreboard: '/scoreboard', timemachine: '/timemachine' }
  const viewFromPath = () => {
    const p = window.location.pathname.replace(/\/+$/, '')
    return Object.keys(PATHS).find(v => PATHS[v] === p) || 'home'
  }
  const [view, setView] = useState(viewFromPath)

  useEffect(() => {
    const path = PATHS[view] || '/'
    if (window.location.pathname.replace(/\/+$/, '') !== path.replace(/\/+$/, '')) {
      window.history.pushState(null, '', path)
    }
    document.title = view === 'scoreboard' ? 'NBA Scoreboard · FPR' : view === 'timemachine' ? 'Time Machine · FPR' : 'NBA Floor Performance Rankings'
  }, [view])

  useEffect(() => {
    const onPop = () => setView(v => {
      const next = viewFromPath()
      return PATHS[next] ? next : PATHS[v] ? 'explorer' : v
    })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // players.json renders the site; career histories follow in the background
  const [histReady, setHistReady] = useState(false)
  const [histError, setHistError] = useState(false)
  useEffect(() => {
    fetch('/data/players.json')
      .then(r => { if (!r.ok) throw new Error('Failed to load data'); return r.json() })
      .then(d => {
        setData(d); setLoading(false)
        loadHistory(d.players).then(() => setHistReady(true)).catch(() => setHistError(true))
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])
  const waiting = NEEDS_HISTORY.has(view) && !histReady
  // Live layer: today's finals and games in progress move every player's Elo, rank and history on
  // every page that reads players.json. Season Explorer keeps the nightly ratings (its scoreboard
  // scores live games from them itself) and opens profiles through the live list.
  const ratings = useMemo(() => (data ? buildRatings(data.players) : null), [data])
  const { players, live } = useLivePlayers(data?.players, ratings, histReady)
  const shown = selectedPlayer && (players?.find(p => p.name === selectedPlayer.name) || selectedPlayer)

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
        <Nav meta={data} live={live} view={view} setView={setView} />
      )}
      {view === 'home' && <Homepage data={{ ...data, players }} setView={setView} />}
      {waiting && (
        <div className={styles.splash} style={{ minHeight: '50vh' }}>
          <div className={styles.splashInner}>
            <div className={styles.splashSub}>{histError ? "Couldn't load career histories. Refresh to try again." : 'Loading career histories…'}</div>
            {!histError && <div className={styles.spinner} />}
          </div>
        </div>
      )}
      {view === 'rankings' && (
        <Rankings players={players} live={live} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'historical' && !waiting && (
        <Historical players={players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'franchise' && !waiting && (
        <FranchiseThreshold players={players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'tenures' && !waiting && (
        <FranchiseTenures players={players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'bestx' && !waiting && (
        <BestThroughX players={players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'mystery' && !waiting && (
        <MysteryPlayer players={players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'games' && (
        <GameExplorer />
      )}
      {view === 'h2h' && !waiting && (
        <H2H players={players} />
      )}
      {view === 'teams' && (
        <Teams players={players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'seasons' && !waiting && (
        <Seasons players={players} onSelectPlayer={setSelectedPlayer} />
      )}
      {view === 'daily' && !waiting && (
        <Daily players={players} onSelectPlayer={setSelectedPlayer} />
      )}
      {(view === 'explorer' || view === 'scoreboard') && (
        <SeasonExplorer players={data.players} onSelectPlayer={setSelectedPlayer}
          mode={view === 'scoreboard' ? 'today' : 'standings'}
          onMode={m => setView(m === 'today' ? 'scoreboard' : 'explorer')} />
      )}
      {view === 'timemachine' && <TimeMachine />}
      {view === 'methodology' && <Methodology />}

      {selectedPlayer && !histReady && (
        <div className={styles.splash} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(23,54,87,.85)' }} onClick={() => setSelectedPlayer(null)}>
          <div className={styles.splashInner}><div className={styles.splashSub}>{histError ? "Couldn't load career histories." : 'Loading career history…'}</div>{!histError && <div className={styles.spinner} />}</div>
        </div>
      )}
      {selectedPlayer && histReady && (
        <PlayerModal
          player={shown}
          allPlayers={players}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}

