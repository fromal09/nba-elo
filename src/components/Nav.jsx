import { useEffect, useRef } from 'react'
import styles from './Nav.module.css'
import PlayerSearch from './PlayerSearch'
import { AccountBar } from './Collector'
import { TOP, ELO_SUBS, topOf, hrefFor, linkTo } from '../nav.js'

// Top bar: the four sections. Under Elo Exploration, a second row of its pages.
// Every item is a link, so it opens in a new tab with a right-click or Cmd/Ctrl-click.
export default function Nav({ meta, live, view, setView, players, onSelectPlayer, onMine, onStore }) {
  const top = topOf(view)
  // On narrow screens the tabs scroll sideways; keep the current one in view
  const navRef = useRef(null), subRef = useRef(null)
  useEffect(() => {
    for (const r of [navRef, subRef]) {
      const el = r.current?.querySelector(`.${styles.active}`)
      if (el && r.current.scrollWidth > r.current.clientWidth) r.current.scrollLeft = el.offsetLeft - (r.current.clientWidth - el.offsetWidth) / 2
    }
  }, [view])
  return (
    <>
    <header className={styles.header}>
      <div className={styles.left}>
        <a className={styles.homeBtn} {...linkTo('/', () => setView('home'))}>← Home</a>
        <div className={styles.divider} />
        <span className={styles.logo}>NBA · FPR</span>
      </div>
      <nav className={styles.nav} ref={navRef}>
        {TOP.map(item => (
          <a key={item.id} className={`${styles.navBtn} ${top === item.id ? styles.active : ''}`} aria-current={top === item.id ? 'page' : undefined}
            {...linkTo(hrefFor(item.id), () => setView(item.id))}>
            {item.label}
          </a>
        ))}
      </nav>
      {players && <div className={styles.search}><PlayerSearch players={players} onSelect={onSelectPlayer} /></div>}
      <div className={styles.account}><AccountBar onMine={onMine} onStore={onStore} compact={typeof matchMedia !== 'undefined' && matchMedia('(max-width: 1100px)').matches} /></div>
      <div className={styles.right}>
        <span className={styles.updated}>{live?.inprog.length
          ? <><i className={styles.liveDot} />Live · {live.inprog.length} game{live.inprog.length === 1 ? '' : 's'} on</>
          : live?.finals.length ? <>Live · today's finals in</> : <>Updated {meta?.generated}</>}</span>
      </div>
    </header>
    {top === 'elo' && <nav className={styles.sub} ref={subRef} aria-label="Elo Exploration">
      <a className={`${styles.subBtn} ${view === 'elo' ? styles.active : ''}`} {...linkTo(hrefFor('elo'), () => setView('elo'))}>All</a>
      {ELO_SUBS.map(s => (
        <a key={s.view} className={`${styles.subBtn} ${view === s.view ? styles.active : ''}`} aria-current={view === s.view ? 'page' : undefined}
          {...linkTo(hrefFor(s.view), () => setView(s.view))}>{s.label}</a>
      ))}
    </nav>}
    </>
  )
}
