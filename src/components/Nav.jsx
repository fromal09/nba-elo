import { useEffect, useRef } from 'react'
import styles from './Nav.module.css'

const NAV_ITEMS = [
  { view: 'rankings',    label: 'Current Rankings' },
  { view: 'scoreboard',  label: 'Scoreboard' },
  { view: 'explorer',    label: 'Season Explorer' },
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

export default function Nav({ meta, view, setView }) {
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
      <div className={styles.right}>
        <span className={styles.updated}>Updated {meta?.generated}</span>
      </div>
    </header>
  )
}
