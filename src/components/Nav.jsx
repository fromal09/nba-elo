import { useEffect, useRef } from 'react'
import styles from './Nav.module.css'
import PlayerSearch from './PlayerSearch'
import { AccountBar } from './Collector'

const NAV_ITEMS = [
  { view: 'rankings',    label: 'Current Rankings' },
  { view: 'scoreboard',  label: 'Scoreboard' },
  { view: 'explorer',    label: 'Season Explorer' },
  { view: 'binders',     label: 'Binders' },
  { view: 'timemachine', label: 'Time Machine' },
  { view: 'historical',  label: 'Historical Elo' },
  { view: 'franchise', label: "Who's Been Here?" },
  { view: 'tenures',   label: 'Franchise Tenures' },
  { view: 'bestx',     label: 'Best Through X' },
  { view: 'mystery',   label: 'Mystery Player' },
  { view: 'games',     label: 'Game Explorer' },
  { view: 'h2h',         label: 'Head-to-Head' },
  { view: 'teams',       label: 'Team Breakdown' },
  { view: 'seasons',     label: 'Season by Season' },
  { view: 'daily',       label: 'Daily Changes' },
  { view: 'methodology', label: 'Methodology' },
]

export default function Nav({ meta, live, view, setView, players, onSelectPlayer, onMine }) {
  // On narrow screens the tabs scroll sideways; keep the current one in view
  const navRef = useRef(null)
  useEffect(() => {
    const el = navRef.current?.querySelector(`.${styles.active}`)
    if (el && navRef.current.scrollWidth > navRef.current.clientWidth) {
      navRef.current.scrollLeft = el.offsetLeft - (navRef.current.clientWidth - el.offsetWidth) / 2
    }
  }, [view])
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <button className={styles.homeBtn} onClick={() => setView('home')}>
          ← Home
        </button>
        <div className={styles.divider} />
        <span className={styles.logo}>NBA · FPR</span>
      </div>
      <nav className={styles.nav} ref={navRef}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.view}
            className={`${styles.navBtn} ${view === item.view ? styles.active : ''}`}
            onClick={() => setView(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {players && <div className={styles.search}><PlayerSearch players={players} onSelect={onSelectPlayer} /></div>}
      <div className={styles.account}><AccountBar onMine={onMine} compact={typeof matchMedia !== 'undefined' && matchMedia('(max-width: 1100px)').matches} /></div>
      <div className={styles.right}>
        <span className={styles.updated}>{live?.inprog.length
          ? <><i className={styles.liveDot} />Live · {live.inprog.length} game{live.inprog.length === 1 ? '' : 's'} on</>
          : live?.finals.length ? <>Live · today's finals in</> : <>Updated {meta?.generated}</>}</span>
      </div>
    </header>
  )
}
