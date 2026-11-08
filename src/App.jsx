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
import BinderRoom from './components/BinderRoom'
import GameRoom from './components/GameRoom'
import { CollectorProvider, useCollector } from './components/Collector'
import Methodology from './components/Methodology'
import PlayerModal from './components/PlayerModal'
import Nav from './components/Nav'
import Homepage from './components/Homepage'
import EloExploration from './components/EloExploration'
import styles from './App.module.css'
import { viewFromUrl, hrefFor, TITLES, goTo } from './nav.js'
import { installCardSave } from './cardSave.js'
import { BRAND } from './brand.js'
import { TourHost, useAutoTour, useWelcomeTour } from './components/Tour'
import { ROOM_TOUR, STATION_TOUR } from './components/tours'
import { registerPlayers, ensureHistory, onHistory } from './history.js'
import { buildRatings } from './components/live.js'
import { useLivePlayers } from './components/liveFeed.js'

// Views that read every player's game-by-game Elo wait for history.json
const NEEDS_HISTORY = new Set(['historical', 'franchise', 'tenures', 'bestx', 'mystery', 'h2h', 'seasons', 'daily'])

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  // Every view has a URL (src/nav.js), so menu items open in new tabs and Back works
  // Predictions moved to the Game Room: an old /binders?open=predict link opens them there
  const [view, setView] = useState(() => {
    if (viewFromUrl() === 'binders' && new URLSearchParams(window.location.search).get('open') === 'predict') window.history.replaceState(null, '', hrefFor('gameroom', { open: 'predict' }))
    return viewFromUrl()
  })
  // A binder to open on the Binders page: { kind: mine | store, n } (n changes on every request)
  const [binderStart, setBinderStart] = useState(() => {
    const o = new URLSearchParams(window.location.search).get('open')
    return viewFromUrl() === 'binders' && ['mine', 'store'].includes(o) ? { kind: o, n: 1 } : null
  })
  const openBinder = kind => { setView('binders'); setBinderStart({ kind, n: Date.now() }) }
  const openMine = () => openBinder('mine')
  const openStore = () => openBinder('store')
  const openPredict = () => goTo('gameroom', { open: 'predict' })

  useEffect(() => {
    if (viewFromUrl() !== view) window.history.pushState(null, '', hrefFor(view))
    document.title = view === 'home' ? BRAND.full : `${TITLES[view] || 'NBA'} · ${BRAND.full}`
  }, [view])

  useEffect(() => installCardSave(), []) // right-click a card: Save card image

  useEffect(() => {
    const onPop = () => setView(viewFromUrl())
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
        registerPlayers(d.players)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])
  // Career histories load only for what needs them: these pages, a player's profile (anything else asks for them itself)
  const wantHistory = NEEDS_HISTORY.has(view) || !!selectedPlayer
  useEffect(() => {
    if (!data) return
    const h = wantHistory ? ensureHistory() : null
    h?.then(() => setHistReady(true)).catch(() => setHistError(true))
  }, [data, wantHistory])
  useEffect(() => onHistory(() => setHistReady(true)), [])
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
        <div className={styles.splashTitle}>{BRAND.full}</div>
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
    <CollectorProvider onOpenMine={openMine} onOpenStore={openStore} onOpenPredict={openPredict}>
    <ExploreCoins view={view} profile={!!selectedPlayer} />
    <TourHost />
    <RoomTours view={view} />
    <div className={styles.app}>
      <Nav meta={data} live={live} view={view} setView={setView} players={players} onSelectPlayer={setSelectedPlayer} onMine={openMine} onStore={openStore} />
      {view === 'home' && <Homepage players={players} live={live} setView={setView} onMine={openMine} onStore={openStore} />}
      {view === 'elo' && <EloExploration data={{ ...data, players }} setView={setView} />}
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
      {(view === 'explorer' || view === 'scoreboard' || view === 'mypicks' || view === 'potw') && (
        <SeasonExplorer players={data.players} onSelectPlayer={setSelectedPlayer}
          mode={view === 'scoreboard' ? 'today' : view === 'mypicks' ? 'picks' : view === 'potw' ? 'potw' : 'standings'}
          onMode={m => setView(m === 'today' ? 'scoreboard' : m === 'picks' ? 'mypicks' : m === 'potw' ? 'potw' : 'explorer')} />
      )}
      {view === 'timemachine' && <TimeMachine />}
      {view === 'binders' && <BinderRoom part="desk" players={data.players} onSelectPlayer={setSelectedPlayer} start={binderStart} />}
      {view === 'library' && <BinderRoom part="library" players={data.players} onSelectPlayer={setSelectedPlayer} />}
      {view === 'gameroom' && <GameRoom players={data.players} onSelectPlayer={setSelectedPlayer} ratings={ratings} />}
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
    </CollectorProvider>
  )
}


// Coins for exploring: each part of the site, once a day (the server caps it)
const EXPLORE = new Set(['scoreboard', 'explorer', 'timemachine', 'mystery', 'rankings', 'historical', 'h2h', 'games', 'daily', 'seasons', 'franchise', 'bestx', 'tenures', 'teams'])
function ExploreCoins({ view, profile }) {
  const C = useCollector()
  const signedIn = !!C.me
  useEffect(() => { if (signedIn && EXPLORE.has(view)) C.explore(view) }, [view, signedIn])
  useEffect(() => { if (signedIn && profile) C.explore('profile') }, [profile, signedIn])
  return null
}

// Everest's room tours: each room's starts itself the first time you walk in (the welcome tour on your desk, the
// first days after you make your binder; a Game Room station's when you first open it)
function RoomTours({ view }) {
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('open'))
  useEffect(() => {
    const t = setInterval(() => setOpen(new URLSearchParams(window.location.search).get('open')), 800)
    return () => clearInterval(t)
  }, [])
  useWelcomeTour(view === 'binders' && !open)
  useAutoTour(view === 'gameroom' && open ? STATION_TOUR[open] : ROOM_TOUR[view])
  return null
}
