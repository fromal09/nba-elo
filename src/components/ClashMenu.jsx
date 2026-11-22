import { useState, useEffect } from 'react'
import * as E from '../clash/engine.js'
import { Chip } from './Clash.jsx'
import styles from './Clash.module.css'
import './ClashArena.css'
import './ClashMenu.css'

/*
 * Full Court Clash menus in the arena look: the main screen, the decks, Franchise Challenges and their ladders,
 * and the Daily Challenges.
 */
const DAILY_REWARD = { easy: 1, medium: 2, hard: 3, brutal: 4 }
const TIER_COL = ['', '#c9d3df', '#7fbaff', '#cf9cff', '#ffd36b']
const FR_WIN = { easy: 'opens Medium', medium: 'opens Hard', hard: 'opens Brutal', brutal: 'a permanent franchise redesign for one card in the winning deck' }
const avg = (cs, f) => (cs.length ? (cs.reduce((s, c) => s + f(c), 0) / cs.length).toFixed(1) : '—')
const onePer = cs => new Set(cs.map(c => c.n)).size === cs.length
const Svg = ({ d, s = 18 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
const LOCK = 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z', CHECK = 'M4 12l5 5L20 6', BACK = 'M15 5l-7 7 7 7', CROWN = 'M3 8l4 4 5-7 5 7 4-4-2 11H5z', X = 'M6 6l12 12M18 6L6 18'
// Time left until the dailies reset at midnight Eastern
function untilReset() {
  const now = new Date(), et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const mid = new Date(et); mid.setHours(24, 0, 0, 0)
  const s = Math.max(0, (mid - et) / 1000)
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
const levelsBeaten = (view, key) => E.LEVELS.filter(l => view.prog?.[key]?.[l]).length

export function Shell({ children, title, sub, onBack, you, onClose }) {
  return <div className={`${styles.root} ar mn`} style={{ '--you': you.a, '--youInk': you.ink }}>
    <div className="ar-bg" aria-hidden="true"><i /><i /><i /></div>
    <div className="mn-in">
      {onBack ? <header className="mn-head"><button type="button" className="mn-back" onClick={onBack} aria-label="Back"><Svg d={BACK} /></button><div><h2>{title}</h2>{sub && <small>{sub}</small>}</div></header>
        : onClose && <button type="button" className="mn-close" onClick={onClose} aria-label="Back to the Game Room"><Svg d={X} s={16} /><span>Game Room</span></button>}
      {children}
    </div>
  </div>
}

export function Hub({ view, deck, deckName, you, go, play, resume, onClose }) {
  const cs = deck || []
  const top = cs.slice().sort((a, b) => b.cost - a.cost || b.pw - a.pw).slice(0, 3)
  const wins = E.FRANCHISES.reduce((s, fc) => s + levelsBeaten(view, fc), 0)
  const next = E.LEVELS.find(l => !view.daily?.[l]) || null
  const [clock, setClock] = useState(untilReset())
  useEffect(() => { const t = setInterval(() => setClock(untilReset()), 30000); return () => clearInterval(t) }, [])
  return <Shell you={you} onClose={onClose}>
    <div className="mn-logo"><small>FanSided’s Full Court</small><h1><span>Clash</span></h1></div>
    {view.open && <button type="button" className="mn-resume" onClick={resume}><span>Resume your match · possession {Math.min(view.open.turn, 6)} of 6</span></button>}
    <section className="mn-deck">
      <div className="mn-podium" aria-hidden="true" />
      {top.length ? <div className="mn-fan">{top.map((c, i) => <div key={c.k} className="mn-fc" style={{ '--i': i - 1 }}><Chip c={c} side="p" w={92} cost={c.cost} onClick={() => go('decks')} label={`${E.cleanName(c.n)}, in your deck`} /></div>)}</div>
        : <div className="mn-fan mn-nodeck"><span>No deck yet</span></div>}
      <div className="mn-plate"><span className="mn-dot" /><b>{deckName || 'Build a deck'}</b><em>{cs.length ? `15 cards · avg cost ${avg(cs, c => c.cost)} · avg power ${avg(cs, c => c.pw)}` : 'Pick 15 cards from your binder to play the dailies and lineups'}</em></div>
      <div className="mn-deckbtns"><button type="button" className="mn-ghost" onClick={() => go('decks')}><span>{cs.length ? 'Change deck' : 'Build a deck'}</span></button><button type="button" className="mn-ghost" onClick={() => go('colors')}><span>Colors</span></button></div>
    </section>
    <button type="button" className="mn-play" onClick={() => (!cs.length ? go('decks') : next ? play({ mode: 'daily', level: next }) : go('fr'))}>
      <span><b>Play</b><small>{!cs.length ? 'Build a deck first' : next ? `Daily challenge · ${E.LEVEL_NAME[next]}` : 'Franchise challenges'}</small></span>
    </button>
    <div className="mn-modes">
      <button type="button" className="mn-mode" data-k="fr" onClick={() => go('fr')}>
        <span className="mn-mtag">30 franchises</span><b>Franchise Challenges</b>
        <small>Beat each team’s Easy, Medium, Hard and Brutal decks on its home floors. Brutal wins a card redesign.</small>
        <span className="mn-bar"><i style={{ width: `${(wins / 120) * 100}%` }} /></span><em>{wins} of 120 wins</em>
      </button>
      <button type="button" className="mn-mode" data-k="daily" onClick={() => go('daily')}>
        <span className="mn-mtag">New in {clock}</span><b>Daily</b>
        <small>Any deck. Hidden courts. A card pull for each win.</small>
        <span className="mn-pips">{E.LEVELS.map(l => <i key={l} data-on={view.daily?.[l] ? '' : undefined} style={{ '--c': TIER_COL[DAILY_REWARD[l]] }} />)}</span>
      </button>
      <button type="button" className="mn-mode" data-k="pvp" disabled>
        <span className="mn-mtag"><Svg d={LOCK} s={12} /> Coming soon</span><b>1v1</b>
        <small>Take your deck against another collector.</small>
      </button>
    </div>
  </Shell>
}

export function Decks({ view, byId, go, C, setView, you }) {
  return <Shell you={you} title="My Decks" sub="Five slots · the active deck plays dailies and lineups" onBack={() => go('hub')}>
    <div className="mn-decks">{view.decks.map((d, k) => {
      if (!d) return <button key={k} type="button" className="mn-dk mn-dknew" onClick={() => go('build', { slot: k, name: `Deck ${k + 1}`, ids: [] })}><b>+ New deck</b><small>Slot {k + 1}</small></button>
      const cs = d.ids.map(id => byId[id]).filter(Boolean), dup = !onePer(cs), ok = cs.length === 15 && !dup, act = view.active === k
      const top = cs.slice().sort((a, b) => b.cost - a.cost || b.pw - a.pw).slice(0, 4)
      return <div key={k} className="mn-dk" data-act={act ? '' : undefined}>
        <div className="mn-dkhead"><b>{d.name}</b>{act && <em>Active</em>}</div>
        <div className="mn-dkcards">{top.map(c => <Chip key={c.k} c={c} side="p" w={54} cost={c.cost} onClick={() => go('build', { slot: k, name: d.name, ids: cs.map(x => x.id) })} label={E.cleanName(c.n)} />)}</div>
        <small>{ok ? `15 cards · avg cost ${avg(cs, c => c.cost)} · avg power ${avg(cs, c => c.pw)}` : dup ? 'Has two cards of one player. Edit it to keep one.' : `${15 - cs.length} card${15 - cs.length === 1 ? '' : 's'} no longer in your binder`}</small>
        <div className="mn-dkbtns">{!act && ok && <button type="button" className="mn-ghost mn-sm" onClick={async () => { const v = await C.clashActive(k); if (v) setView(v) }}><span>Use</span></button>}
          <button type="button" className="mn-go mn-sm" onClick={() => go('build', { slot: k, name: d.name, ids: cs.map(c => c.id) })}><span>Edit</span></button></div>
      </div>
    })}</div>
  </Shell>
}

export function Franchises({ view, D, go, you }) {
  const wins = E.FRANCHISES.reduce((s, fc) => s + levelsBeaten(view, fc), 0)
  const list = E.FRANCHISES.slice().sort((a, b) => (E.NICK[a] || a).localeCompare(E.NICK[b] || b))
  return <Shell you={you} title="Franchise Challenges" sub={`${wins} of 120 wins · ${Object.keys(view.claims || {}).length} redesigns earned`} onBack={() => go('hub')}>
    <div className="mn-teams">{list.map(fc => {
      const n = levelsBeaten(view, fc)
      return <button key={fc} type="button" className="mn-team" style={{ '--c1': E.COLOR[fc], '--c2': E.COLOR2[fc] || '#fff' }} onClick={() => go('frd', { fc })} data-done={n >= 4 ? '' : undefined}>
        {view.claims?.[fc] && <span className="mn-crown" title="Redesign claimed"><Svg d={CROWN} s={12} /></span>}
        <b>{E.NICK[fc]}</b>
        <span className="mn-tpips">{E.LEVELS.map((l, i) => <i key={l} data-on={view.prog?.[fc]?.[l] ? '' : undefined} data-next={i === n ? '' : undefined} />)}</span>
      </button>
    })}</div>
    {D.lineups?.length > 0 && <><h3 className="mn-sh">All-time lineups · any deck, surprise courts</h3>
      <div className="mn-lineups">{D.lineups.map(L => <button key={L.id} type="button" className="mn-ln" onClick={() => go('frd', { ln: L.id })}>
        <b>{L.name}</b><small>{L.desc}</small><span className="mn-tpips">{(L.fixed ? ['brutal'] : E.LEVELS).map(l => <i key={l} data-on={view.prog?.[`L:${L.id}`]?.[l] ? '' : undefined} />)}</span>
      </button>)}</div></>}
  </Shell>
}

export function FranchiseDetail({ D, view, scr, go, start, teamDeck, activeDeck, byId, binder, you }) {
  const { fc, ln } = scr, isL = ln != null, L = isL ? D.lineups.find(x => x.id === ln) : null
  const key = isL ? `L:${ln}` : fc, pr = view.prog?.[key] || {}
  const levels = isL && L.fixed ? ['brutal'] : E.LEVELS
  const td = isL ? null : teamDeck(fc).map(id => byId[id]).filter(Boolean)
  const ad = activeDeck()
  const open = lv => isL || lv === 'easy' || !!pr[E.LEVELS[E.LEVELS.indexOf(lv) - 1]]
  const ready = isL ? !!ad : td.length === 15
  const arena = !isL && (E.LOCBY[fc] || {}).name
  const c1 = isL ? '#173657' : E.COLOR[fc], c2 = isL ? '#ffd36b' : (E.COLOR2[fc] || '#fff')
  return <Shell you={you} title={isL ? L.name : E.NICK[fc]} sub={isL ? 'All-time lineup' : 'Franchise challenge'} onBack={() => go('fr')}>
    <section className="mn-banner" style={{ '--c1': c1, '--c2': c2 }}>
      <small>{isL ? 'Any deck' : 'Home floor'}</small><b>{isL ? L.name : arena}</b>
      <p>{isL ? L.desc : `Their deck is all ${E.NICK[fc]} cards, and so is yours. You play at ${arena} and the team’s historic buildings.`}</p>
    </section>
    <div className="mn-yours">
      <div><small>{isL ? 'You play with' : `Your ${E.NICK[fc]} deck`}</small><b>{isL ? (ad ? ad.name : 'No active deck') : `${td.length}/15 players${ready ? ` · avg power ${avg(td, c => c.pw)}` : ''}`}</b>
        <em>{isL ? 'Any cards from any franchise. The courts are a surprise.' : ready ? `Built from the best of your ${binder.filter(c => c.fc === fc).length} ${E.NICK[fc]} cards.` : `You need 15 different ${E.NICK[fc]} players; you have ${td.length}. Team packs and Hang the Banner packs bring more.`}</em></div>
      <button type="button" className="mn-ghost mn-sm" onClick={() => (isL ? go('decks') : go('build', { team: fc, ids: td.map(c => c.id) }))}><span>{isL ? (ad ? 'Change' : 'Build') : 'Edit'}</span></button>
    </div>
    <ol className="mn-ladder">{levels.map((lv, i) => {
      const done = !!pr[lv], o = open(lv) && !done, locked = !open(lv)
      const play = () => start({ mode: isL ? 'lineup' : 'fr', fc: isL ? null : fc, ln: isL ? ln : null, level: lv, ids: isL ? ad.ids : td.map(c => c.id) })
      return <li key={lv} data-state={done ? 'done' : o ? 'open' : 'locked'}>
        <span className="mn-rung">{done ? <Svg d={CHECK} /> : locked ? <Svg d={LOCK} s={16} /> : i + 1}</span>
        <div><b>{E.LEVEL_NAME[lv]}</b><small>{locked ? `Beat ${E.LEVEL_NAME[E.LEVELS[E.LEVELS.indexOf(lv) - 1]]} to open it` : isL ? 'No reward set yet' : `Win: ${FR_WIN[lv]}`}</small></div>
        {o ? <button type="button" className="mn-go" disabled={!ready} onClick={play}><span>Play</span></button>
          : done ? <button type="button" className="mn-ghost mn-sm" disabled={!ready} onClick={play}><span>Replay</span></button> : null}
      </li>
    })}</ol>
  </Shell>
}

export function Daily({ view, go, start, activeDeck, you }) {
  const ad = activeDeck()
  return <Shell you={you} title="Daily Challenges" sub={`New decks in ${untilReset()}`} onBack={() => go('hub')}>
    <p className="mn-lead">Four CPU decks a day. Play any deck you own. The courts are random and stay hidden until they tip off. Each win pulls one card.</p>
    {!ad && <button type="button" className="mn-go" onClick={() => go('decks')}><span>Build a deck to play</span></button>}
    <div className="mn-daily">{E.LEVELS.map(l => {
      const t = DAILY_REWARD[l], done = view.daily?.[l]
      return <button key={l} type="button" className="mn-dcard" data-done={done ? '' : undefined} style={{ '--c': TIER_COL[t] }} onClick={() => !done && ad && start({ mode: 'daily', level: l, ids: ad.ids })} disabled={!!done || !ad}>
        <span className="mn-dlv">{E.LEVEL_NAME[l]}</span>
        <span className="mn-dprize"><i /><b>{E.TIER_NAME[t]}</b><small>card pull</small></span>
        <span className="mn-dstate">{done ? <><Svg d={CHECK} s={14} /> Won today</> : 'Play'}</span>
      </button>
    })}</div>
  </Shell>
}
