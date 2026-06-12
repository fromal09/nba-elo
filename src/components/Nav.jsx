import styles from './Nav.module.css'

const NAV_ITEMS = [
  { view: 'rankings',    label: 'Current Rankings' },
  { view: 'historical',  label: 'Historical Elo' },
  { view: 'franchise', label: "Who's Been Here?" },
  { view: 'tenures',   label: 'Franchise Tenures' },
  { view: 'bestx',     label: 'Best Through X' },
  { view: 'mystery',   label: 'Mystery Player' },
  { view: 'h2h',         label: 'Head-to-Head' },
  { view: 'teams',       label: 'Team Breakdown' },
  { view: 'seasons',     label: 'Season by Season' },
  { view: 'daily',       label: 'Daily Changes' },
  { view: 'methodology', label: 'Methodology' },
]

export default function Nav({ meta, view, setView }) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <button className={styles.homeBtn} onClick={() => setView('home')}>
          ← Home
        </button>
        <div className={styles.divider} />
        <span className={styles.logo}>NBA · FPR</span>
      </div>
      <nav className={styles.nav}>
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
