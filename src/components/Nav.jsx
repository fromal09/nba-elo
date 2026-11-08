import { useEffect, useRef } from 'react'
import styles from './Nav.module.css'
import PlayerSearch from './PlayerSearch'
import { AccountBar } from './Collector'
import { TOP, ELO_SUBS, topOf, hrefFor, linkTo } from '../nav.js'
import { BRAND } from '../brand.js'
import { ICONS } from './SectionIcons'
import { ToursButton } from './Tour'

// The site header on every page: the brand row (search, live status, your account), then the seven sections as
// one bar of icon tiles (on phones, seven across in a fixed grid), and under Elo Exploration a row of its pages.
// Every item is a link, so it opens in a new tab with a right-click or Cmd/Ctrl-click.
export default function Nav({ meta, live, view, setView, players, onSelectPlayer, onMine, onStore }) {
  const top = topOf(view)
  const subRef = useRef(null)
  useEffect(() => {
    const el = subRef.current?.querySelector(`.${styles.active}`)
    if (el && subRef.current.scrollWidth > subRef.current.clientWidth) subRef.current.scrollLeft = el.offsetLeft - (subRef.current.clientWidth - el.offsetWidth) / 2
  }, [view])
  const narrow = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 1100px)').matches
  const go = item => (item.id === 'store' ? linkTo(hrefFor('binders', { open: 'store' }), onStore) : linkTo(hrefFor(item.id), () => setView(item.id)))
  return (
    <>
    <header className={styles.brandRow}>
      <a href="https://fansided.com" target="_blank" rel="noopener" className={styles.fs}><img src="/fansided-logo.webp" alt="FanSided" /></a>
      <span className={styles.rule} />
      <a className={styles.name} {...linkTo('/', () => setView('home'))}>
        <b>{BRAND.name}</b>
        <small>{BRAND.tagline}</small>
      </a>
      <span className={styles.status}>{live?.inprog.length
        ? <><i className={styles.liveDot} />Live · {live.inprog.length} game{live.inprog.length === 1 ? '' : 's'} on</>
        : live?.finals.length ? <>Live · today’s finals in</> : meta?.generated ? <>Updated {meta.generated}</> : null}</span>
      <span className={styles.tours}><ToursButton /></span>
      {players && <div className={styles.search}><PlayerSearch players={players} onSelect={onSelectPlayer} /></div>}
      <div className={styles.account}><AccountBar onMine={onMine} onStore={onStore} compact={narrow} /></div>
    </header>
    <nav className={styles.bar} aria-label="Sections">
      {TOP.map(item => {
        const on = top === item.id
        return (
          <a key={item.id} data-tour={`tile-${item.id}`} className={`${styles.tile} ${on ? styles.active : ''}`} aria-current={on ? 'page' : undefined} {...go(item)}>
            {ICONS[item.id]}<span className={styles.long}>{item.label}</span><span className={styles.short}>{item.short}</span>
          </a>
        )
      })}
    </nav>
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
