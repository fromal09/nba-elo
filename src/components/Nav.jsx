import styles from './Nav.module.css'

export default function Nav({ meta, view, setView }) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <span className={styles.logo}>🏀 NBA · FPR</span>
        <span className={styles.meta}>
          {meta?.total_players} players · {meta?.total_games} games · {meta?.season}
        </span>
      </div>
      <nav className={styles.nav}>
        <button
          className={`${styles.navBtn} ${view === 'rankings' ? styles.active : ''}`}
          onClick={() => setView('rankings')}
        >
          Rankings
        </button>
        <button
          className={`${styles.navBtn} ${view === 'methodology' ? styles.active : ''}`}
          onClick={() => setView('methodology')}
        >
          Methodology
        </button>
      </nav>
      <div className={styles.right}>
        <span className={styles.updated}>Updated {meta?.generated}</span>
      </div>
    </header>
  )
}
