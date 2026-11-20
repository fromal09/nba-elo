import { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react'
import styles from './Clash.module.css'
import { useCollector, CardFace } from './Collector'
import { binderLogo } from './SeasonExplorer'
import * as E from '../clash/engine.js'

/*
 * Full Court Clash, the Game Room's card table (src/clash/engine.js has the rules, api/_lib/clash.js runs the matches).
 * The table: your five decks, the 30 franchises' challenges and the all-time lineups, the daily challenges, and 1v1
 * (coming soon). Matches are played on the server; this screen projects your plays and animates the reveal it sends back.
 */

const STEP_MS = 820
const LEVEL_TXT = { easy: 'Everyday nights from the bottom half of its cards.', medium: 'Good nights, a step above average.', hard: 'Big nights from near the top.', brutal: 'Its best nights, packed around one season.' }
const DAILY_TXT = { easy: 'Everyday nights.', medium: 'Good nights, a step above average.', hard: 'Big nights.', brutal: 'The best nights in the pool.' }
const LEVEL_COL = { easy: '#5cc98f', medium: '#5aadff', hard: '#f2c14e', brutal: '#ff6b5c' }
const FR_WIN = { easy: 'Opens Medium', medium: 'Opens Hard', hard: 'Opens Brutal', brutal: 'A franchise card redesign' }
const DAILY_WIN = { easy: 'A random Common card', medium: 'A random Rare card', hard: 'A random Standout card', brutal: 'A random Legend card' }
const AI_NOTE = 'The CPU plays its best game at every level: it sees where you put your cards each turn, not which ones, and plays after you. Only its deck gets stronger.'
const LOOKS = [['floor', 'Home Floor', 'Printed on the franchise’s hardwood, its colors on the border, the circle and the baseline.'],
  ['banner', 'Rafters', 'Cut and stitched like a banner in the rafters, with the season in block letters.'],
  ['foil', 'Team Foil', 'Holographic foil in the team’s colors, with its name tiled through the shine.'],
  ['prog', 'Program Cover', 'Printed like that night’s game program, under the team’s name from that season.']]
// Each ability's mark on a card, and its timing (the color of its badge)
const AB_MARK = { fifty: '50', quad: '4×', triple: '3×', swat: 'BLK', pick: 'STL', floor: 'AST', glass: 'REB', splash: '3PT', perfect: '100%', charity: 'FT', iron: 'MIN',
  ot: 'OT', debut: '1ST', home: 'HOME', micro: 'HOT', blowout: '+40', sure: 'SAFE', clutch: 'CLU', heat: 'HEAT' }
const AB_KIND = { 'On reveal': 'reveal', Ongoing: 'ongoing', End: 'end', Cost: 'cost' }
const KIND_TIP = { reveal: 'Fires once, when it’s revealed', ongoing: 'Works the whole game', end: 'Checks after turn 6', cost: 'Changes what it costs' }
function AbBadge({ a, c, big }) {
  const k = AB_KIND[E.AB[a].k]
  return big ? <div className={styles.abTile} data-kind={k}><span className={styles.abMark}>{AB_MARK[a]}</span><div><b>{E.AB[a].n}</b><em>{E.AB[a].k} · {KIND_TIP[k]}</em><p>{E.AB[a].t(c)}</p><small>Earned: {E.AB[a].why(c)}</small></div></div>
    : <span className={styles.abTag} data-kind={k} title={`${E.AB[a].n}: ${E.AB[a].t(c)}`}>{AB_MARK[a]}</span>
}
const TCURVE = { 1: 4, 2: 3, 3: 3, 4: 2, 5: 2, 6: 1 }
const col = c => E.COLOR[c.fc] || '#334'
const fmtDate = d => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '')
const yr = c => `’${String(c.d || '').slice(2, 4)}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const avg = (cs, f) => (cs.length ? (cs.reduce((s, c) => s + f(c), 0) / cs.length).toFixed(1) : '—')
function statLine(c) {
  const s = [`${c.pts} pts`, `${c.reb} reb`, `${c.ast} ast`]
  if (c.stl >= 3) s.push(`${c.stl} stl`); if (c.blk >= 3) s.push(`${c.blk} blk`); if (c.tp >= 4) s.push(`${c.tp} 3PM`)
  if (c.min != null) s.push(`${c.min} min`)
  return s.join(', ')
}
const gameLine = c => `${E.NICK[c.fc] || c.fc} ${c.win ? 'W' : 'L'}${c.margin ? ` by ${Math.abs(c.margin)}` : ''} ${c.home ? 'vs' : 'at'} ${E.NICK[c.o] || c.o}${c.ot ? ` (${c.ot})` : ''}`
// A CPU card in the shape the binder's card face draws
const asJson = (c, D) => ({ s: c.s, id: c.g, date: c.d, t: c.fc, o: c.o, home: !!c.home, won: !!c.win, score: '', ot: c.ot, tier: ['common', 'common', 'rare', 'standout', 'legend', 'icon', 'goat'][c.cost],
  tn: D?.teams?.[c.fc]?.name, tc: E.COLOR[c.fc], row: { n: c.n, pos: c.pos, mp: c.min, pts: c.pts, trb: c.reb, ast: c.ast, stl: c.stl, blk: c.blk, tp: c.tp, gs: c.gs, lr: c.lr, lrp: c.lr } })

function Back({ onClick, label = 'Back' }) {
  return <button type="button" className={styles.back} onClick={onClick} aria-label={label}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg></button>
}
// Every card in Clash is the binder's own card face, shrunk: your cards from their stored JSON, the CPU's built from its line
const Faces = createContext({ face: () => null, shots: {} })
function Chip({ c, side, pw, cls = '', onClick, w = 56, label, cost }) {
  const { face, shots } = useContext(Faces)
  const card = face(c)
  return <button type="button" className={`${styles.mc} ${side === 'p' ? styles.mine : styles.theirs} ${cls}`} style={{ width: w, height: Math.round(w * 1.4) }} onClick={onClick}
    aria-label={label || `${E.cleanName(c.n)}, power ${pw ?? c.pw}`}>
    {card ? <CardFace card={card} shots={shots} w={w} /> : <span className={styles.mcI}>{E.initials(c.n)}</span>}
    {cost != null && <span className={styles.mcC}>{cost}</span>}
    {c.ab.length > 0 && <span className={styles.mcDots}>{c.ab.map(a => <AbBadge key={a} a={a} c={c} />)}</span>}
    <span className={styles.mcP}>{pw ?? c.pw}</span>
  </button>
}
// Your hand, fanned: swipe or use the arrows to bring a card to the front, tap the front card to pick it up
function HandFan({ items, sel, onPick, onInfo, disabled }) {
  const { face, shots } = useContext(Faces)
  const [focus, setFocus] = useState(0)
  const drag = useRef(null)
  const n = items.length
  useEffect(() => { if (focus > n - 1) setFocus(Math.max(0, n - 1)) }, [n])
  useEffect(() => { const i = items.findIndex(x => x.k === sel); if (i >= 0) setFocus(i) }, [sel])
  const step = d => setFocus(f => Math.max(0, Math.min(n - 1, f + d)))
  if (!n) return <div className={styles.fanEmpty}>No cards in hand</div>
  return <div className={styles.fan} onPointerDown={e => { drag.current = { x: e.clientX, f: focus, moved: false } }}
    onPointerMove={e => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 8) d.moved = true; const k = Math.round(-dx / 46); setFocus(Math.max(0, Math.min(n - 1, d.f + k))) }}
    onPointerUp={() => { setTimeout(() => { drag.current = null }, 0) }} onPointerLeave={() => { drag.current = null }}
    onKeyDown={e => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1) }}>
    <button type="button" className={styles.fanArrow} data-side="l" onClick={() => step(-1)} disabled={focus === 0} aria-label="Previous card">‹</button>
    <div className={styles.fanCards} role="listbox" aria-label="Your hand">
      {items.map((x, i) => {
        const d = i - focus, on = sel === x.k
        const style = { transform: `translateX(${d * 46}px) translateY(${on ? -26 : Math.abs(d) * 7}px) rotate(${d * 6}deg) scale(${d === 0 ? 1 : 0.86})`, zIndex: 50 - Math.abs(d) * 2 + (on ? 20 : 0) }
        return <button key={x.k} type="button" role="option" aria-selected={on} className={`${styles.fc} ${on ? styles.fcOn : ''} ${x.off ? styles.fcOff : ''} ${x.styled ? styles.fcSty : ''}`} style={style}
          aria-label={`${E.cleanName(x.c.n)}, cost ${x.kc}, power ${x.c.pw}${x.c.ab.length ? `, ${x.c.ab.map(a => E.AB[a].n).join(', ')}` : ''}`}
          onClick={() => { if (drag.current?.moved) return; if (d !== 0) { setFocus(i); return } if (!disabled) onPick(x.k) }}
          onContextMenu={e => { e.preventDefault(); onInfo(x.k) }}>
          {face(x.c) ? <CardFace card={face(x.c)} shots={shots} w={104} /> : null}
          <span className={styles.fcC} data-dn={x.kc < x.c.cost ? '' : undefined}>{x.kc}</span>
          <span className={styles.fcP}>{x.c.pw}</span>
          {d === 0 && x.c.ab.length > 0 && <span className={styles.fcAb}>{x.c.ab.map(a => <em key={a} data-kind={AB_KIND[E.AB[a].k]}>{AB_MARK[a]} · {E.AB[a].n}</em>)}</span>}
        </button>
      })}
    </div>
    <button type="button" className={styles.fanArrow} data-side="r" onClick={() => step(1)} disabled={focus >= n - 1} aria-label="Next card">›</button>
    <div className={styles.fanCount}>{focus + 1} / {n} · swipe through your hand · tap the front card to pick it up · press and hold for the full card</div>
  </div>
}
function Floor({ id, revealed, children }) {
  const L = revealed && id ? E.LOCBY[id] : null
  const f = L ? L.floor : 'down'
  return <div className={styles.floor} data-floor={f} style={L ? { '--c1': L.c1 || '#555', '--c2': L.c2 || '#fff' } : undefined}>
    {L && (f === 'maple' || f === 'parquet' || f === 'fiba') && <><i className={styles.mid} /><i className={styles.circle} /><i className={styles.keyL} /><i className={styles.keyR} /></>}
    {L && (f === 'old' || f === 'asphalt' || f === 'concrete' || f === 'cup') && <><i className={styles.mid} /><i className={styles.ring} /></>}
    {L && f === 'ymca' && <><i className={styles.basket} style={{ left: 4 }} /><i className={styles.basket} style={{ right: 4 }} /></>}
    {children}
  </div>
}

export default function Clash({ env }) {
  const C = useCollector()
  const [D, setD] = useState(null)
  const [flags, setFlags] = useState({})
  const [view, setView] = useState(null)
  const [err, setErr] = useState(null)
  const [scr, setScr] = useState({ s: 'hub' })
  const [M, setM] = useState(null)
  const go = (s, extra = {}) => { setScr({ s, ...extra }); window.scrollTo?.(0, 0); document.querySelector(`.${styles.root}`)?.scrollIntoView?.({ block: 'start' }) }
  useEffect(() => {
    fetch('/data/clash/decks.json').then(r => (r.ok ? r.json() : Promise.reject())).then(setD).catch(() => setErr('Full Court Clash’s card data isn’t published yet. It arrives with tonight’s data update.'))
    fetch('/data/clash/flags.json').then(r => (r.ok ? r.json() : {})).then(setFlags).catch(() => {})
    C.loadClash().then(setView).catch(e => setErr(e.message))
  }, [])
  // Your binder's playable cards as Clash cards, and their stored JSON (for the full card faces)
  const { binder, byId, jsonById } = useMemo(() => {
    const binder = [], byId = {}, jsonById = {}
    for (const x of C.cards || []) {
      if (!E.playable(x.card)) continue
      const c = E.cardFromBinder(x.id, x.card, flags[`${x.card.s}|${x.card.id}|${x.card.row.n}`] || '')
      binder.push(c); byId[c.id] = c; jsonById[c.id] = x.card
    }
    binder.sort((a, b) => a.cost - b.cost || b.pw - a.pw)
    return { binder, byId, jsonById }
  }, [C.cards, flags])
  const autoTeam = fc => {
    const pool = binder.filter(c => c.fc === fc).slice().sort((a, b) => b.pw - a.pw), out = []
    const per = {}, add = c => { if (out.length < 15 && !out.includes(c.id) && (per[c.n] || 0) < 2) { out.push(c.id); per[c.n] = (per[c.n] || 0) + 1; return true } return false }
    Object.entries(TCURVE).forEach(([k, n]) => { let got = 0; pool.filter(c => c.cost === +k).forEach(c => { if (got < n && add(c)) got++ }) })
    pool.forEach(add)
    pool.forEach(c => { if (out.length < 15 && !out.includes(c.id)) out.push(c.id) })
    return out.slice(0, 15)
  }
  const teamDeck = fc => { const s = view?.teams?.[fc]; return s && s.length === 15 && s.every(id => byId[id]) ? s : autoTeam(fc) }
  const activeDeck = () => { const d = view?.decks?.[view.active]; return d && d.ids.filter(id => byId[id]).length === 15 ? d : null }

  if (err) return <div className={styles.root}><div className={styles.felt}><p className={styles.msg}>{err}</p></div></div>
  if (!D || !view) return <div className={styles.root}><div className={styles.felt}><p className={styles.msg}>Shuffling the decks…</p></div></div>

  const start = async o => {
    const r = await C.clashStart(o)
    if (!r) return
    setM({ id: r.match, title: r.title, mode: r.mode, level: r.level, fc: r.fc, ids: o.ids, st: E.fromPublic(r.view), staged: [], phase: 'plan', anim: null, sel: null, over: null, reward: null, again: o })
    go('match')
  }
  const resume = async () => {
    const r = await C.clashMatch(view.open.id)
    if (!r) return
    setM({ id: r.match, title: r.title, mode: r.mode, level: r.level, fc: r.fc, ids: [], st: E.fromPublic(r.view), staged: [], phase: 'plan', anim: null, sel: null, over: null, reward: null })
    go('match')
  }
  const P = { D, view, setView, binder, byId, jsonById, go, scr, start, resume, teamDeck, activeDeck, C, env, M, setM }
  const faces = { shots: env.shots, face: c => (c.id != null && jsonById[c.id]) || (c.k && c.k[0] === 'c' ? asJson(c, D) : null) }
  return <Faces.Provider value={faces}><div className={styles.root}>
    {scr.s === 'hub' && <Hub {...P} />}
    {scr.s === 'decks' && <Decks {...P} />}
    {scr.s === 'build' && <Build {...P} />}
    {scr.s === 'fr' && <Franchises {...P} />}
    {scr.s === 'frd' && <FranchiseDetail {...P} />}
    {scr.s === 'daily' && <Daily {...P} />}
    {scr.s === 'match' && M && <Match {...P} />}
    {scr.s === 'claim' && <Claim {...P} />}
  </div></Faces.Provider>
}

function Hub({ D, view, go, resume, activeDeck, byId, jsonById, env }) {
  const d = activeDeck(), cs = d ? d.ids.map(id => byId[id]) : []
  const beaten = Object.values(view.prog || {}).reduce((s, x) => s + Object.keys(x).length, 0)
  const claims = Object.entries(view.claims || {})
  return <div className={styles.felt}>
    <h2 className={styles.hubTitle}>Full Court Clash</h2>
    <div className={styles.hubTag}>Pull up a chair</div>
    {view.open && <button type="button" className={styles.resume} onClick={resume}>Resume your match · turn {view.open.turn} of 6</button>}
    <div className={styles.spots}>
      <button type="button" className={styles.spot} onClick={() => go('decks')}><span>1</span><b>My Decks</b><small>Up to five decks of 15 from your binder</small></button>
      <button type="button" className={styles.spot} onClick={() => go('fr')}><span>2</span><b>Franchise Challenges</b><small>30 franchises and the all-time lineups · {beaten} win{beaten === 1 ? '' : 's'}</small></button>
      <button type="button" className={styles.spot} onClick={() => go('daily')}><span>3</span><b>Daily Challenges</b><small>Four new CPU decks every day</small></button>
      <button type="button" className={styles.spot} disabled><span>4</span><b>1v1</b><small>Another collector · coming soon</small></button>
    </div>
    <div className={styles.hubDeck}>
      <div><small>Playing with</small><b>{d ? d.name : 'No deck yet'}</b><span>{d ? `15 cards · avg cost ${avg(cs, c => c.cost)} · avg power ${avg(cs, c => c.pw)}` : 'Build one from your binder to play the lineups and dailies.'}</span></div>
      <button type="button" className={styles.ghost} onClick={() => go('decks')}>{d ? 'Change' : 'Build'}</button>
    </div>
    {claims.length > 0 && <div className={styles.hubClaims}><small>Your redesigns</small><div className={styles.hscroll}>{claims.map(([fc, x]) => jsonById[x.card] && <div key={fc} className={styles.look}><CardFace card={jsonById[x.card]} shots={env.shots} w={120} /><span>{E.NICK[fc]}</span></div>)}</div></div>}
    <div className={styles.howto}><b>How it plays.</b> Each side plays from a 15-card deck over six turns at three courts; win two. Each turn adds energy equal to the turn number, and what you don’t spend carries over. Cost comes from the card’s tier, power from that night’s Game Score (÷ 5, capped at 10), and up to two abilities from the box score. Cards from the same franchise at a court lift each other: +1, +2 from the same season, +3 from the same game.</div>
  </div>
}

function Decks({ view, go, byId, C, setView }) {
  return <div className={styles.page}>
    <div className={styles.top}><Back onClick={() => go('hub')} /><div><h3>My Decks</h3><p>Five slots, 15 cards each. The active deck plays the lineups and dailies.</p></div></div>
    <div className={styles.list}>{view.decks.map((d, k) => {
      if (!d) return <button key={k} type="button" className={`${styles.tile} ${styles.newDeck}`} onClick={() => go('build', { slot: k, name: `Deck ${k + 1}`, ids: [] })}><b>+ New deck</b><small>Slot {k + 1}</small></button>
      const cs = d.ids.map(id => byId[id]).filter(Boolean)
      const ok = cs.length === 15
      return <div key={k} className={styles.tile}>
        <div className={styles.row}>
          <div><b className={styles.cond}>{d.name}</b>{view.active === k && <em className={styles.badge}>Active</em>}<small>{ok ? `15 cards · avg cost ${avg(cs, c => c.cost)} · avg power ${avg(cs, c => c.pw)}` : `${15 - cs.length} card${15 - cs.length === 1 ? '' : 's'} no longer in your binder`}</small></div>
          <div className={styles.btns}>{view.active !== k && ok && <button type="button" className={styles.ghost} onClick={async () => { const v = await C.clashActive(k); if (v) setView(v) }}>Use</button>}
            <button type="button" className={styles.btn} onClick={() => go('build', { slot: k, name: d.name, ids: cs.map(c => c.id) })}>Edit</button></div>
        </div>
        <div className={styles.strip}>{cs.slice().sort((a, b) => b.pw - a.pw).slice(0, 8).map(c => <span key={c.k} style={{ background: col(c) }}>{E.initials(c.n)}</span>)}</div>
      </div>
    })}</div>
  </div>
}

// How a card would fit the deck so far: the best synergy it has with a card already in it
function fitWith(c, deck, pairs) {
  let best = null
  for (const o of deck) {
    if (o.id === c.id) continue
    if (o.fc === c.fc) {
      const t = o.g === c.g ? 3 : o.s === c.s ? 2 : 1
      if (!best || t > best.v) best = { v: t, t: t === 3 ? 'Same game' : t === 2 ? 'Same season' : 'Same franchise', with: o }
    }
    if (pairs && o.n !== c.n && (pairs.get([o.n, c.n].sort().join('|')) || 0) >= 100 && (!best || best.v < 1.5)) best = { v: 1.5, t: 'Real Duo', with: o }
  }
  return best
}
const SORTS = [['pw', 'Power'], ['cost', 'Cost'], ['gs', 'Game Score'], ['new', 'Newest'], ['old', 'Oldest']]
function Build({ scr, go, binder, byId, C, setView }) {
  const team = scr.team || null
  const [ids, setIds] = useState(scr.ids)
  const [name, setName] = useState(scr.name)
  const [q, setQ] = useState('')
  const [fr, setFr] = useState(null)
  const [cost, setCost] = useState(null)
  const [ab, setAb] = useState(null)
  const [syn, setSyn] = useState(false)
  const [sort, setSort] = useState('pw')
  const [more, setMore] = useState(60)
  const [pairs, setPairs] = useState(null)
  useEffect(() => { fetch('/data/clash/pairs.json').then(r => (r.ok ? r.json() : [])).then(a => setPairs(new Map(a.map(([x, y, n]) => [`${x}|${y}`, n])))).catch(() => setPairs(new Map())) }, [])
  useEffect(() => { setMore(60) }, [q, fr, cost, ab, syn, sort])
  const own = team ? binder.filter(c => c.fc === team) : binder
  const cs = ids.map(id => byId[id]).filter(Boolean).sort((a, b) => a.cost - b.cost || b.pw - a.pw)
  const fits = useMemo(() => Object.fromEntries(own.map(c => [c.id, fitWith(c, cs, pairs)])), [own, ids, pairs])
  const franchises = useMemo(() => { const m = {}; own.forEach(c => { m[c.fc] = (m[c.fc] || 0) + 1 }); return Object.entries(m).sort((a, b) => b[1] - a[1]) }, [own])
  const abilities = useMemo(() => { const m = {}; own.forEach(c => c.ab.forEach(a => { m[a] = (m[a] || 0) + 1 })); return Object.entries(m).sort((a, b) => E.AB_ORDER.indexOf(a[0]) - E.AB_ORDER.indexOf(b[0])) }, [own])
  let pool = own
  if (q) pool = pool.filter(c => c.n.toLowerCase().includes(q.toLowerCase()))
  if (fr) pool = pool.filter(c => c.fc === fr)
  if (cost) pool = pool.filter(c => c.cost === cost)
  if (ab) pool = pool.filter(c => c.ab.includes(ab))
  if (syn) pool = pool.filter(c => fits[c.id] && !ids.includes(c.id))
  const key = { pw: c => -c.pw * 100 + c.cost, cost: c => c.cost * 100 - c.pw, gs: c => -c.gs, new: c => -Date.parse(c.d), old: c => Date.parse(c.d) }[sort]
  pool = pool.slice().sort((a, b) => (syn ? (fits[b.id]?.v || 0) - (fits[a.id]?.v || 0) : 0) || key(a) - key(b))
  const synCount = own.filter(c => fits[c.id] && !ids.includes(c.id)).length
  const cnt = [1, 2, 3, 4, 5, 6].map(k => cs.filter(c => c.cost === k).length), mx = Math.max(1, ...cnt)
  const deckSyn = cs.filter(c => fitWith(c, cs, pairs)).length
  const toggle = id => setIds(x => (x.includes(id) ? x.filter(y => y !== id) : x.length >= 15 ? x : [...x, id]))
  const back = () => (team ? go('frd', { fc: team }) : go('decks'))
  const save = async () => { const v = await C.clashDeck(team ? { team, ids } : { slot: scr.slot, name, ids }); if (v) { setView(v); back() } }
  const anyFilter = q || fr || cost || ab || syn
  return <div className={styles.builder} style={team ? { '--c': E.COLOR[team] } : undefined}>
    <div className={styles.bHead}>
      <Back onClick={back} />
      <div className={styles.bTitle}>{team ? <h3>{E.NICK[team]} deck</h3> : <input className={styles.nameIn} value={name} maxLength={24} onChange={e => setName(e.target.value)} aria-label="Deck name" />}
        <small>{team ? `${E.NICK[team]} cards only · franchise challenges` : 'Plays the all-time lineups and daily challenges'}</small></div>
      <div className={styles.meter} style={{ '--p': cs.length / 15 }}><b>{cs.length}</b><small>/15</small></div>
    </div>
    <div className={styles.shelf} aria-label="Your deck">
      {cs.map((c, i) => <div key={c.k} className={styles.shelfCard} style={{ '--i': i }}><Chip c={c} side="p" w={64} cost={c.cost} onClick={() => toggle(c.id)} label={`Take ${E.cleanName(c.n)} out of the deck`} /><span className={styles.x} aria-hidden="true">×</span></div>)}
      {Array.from({ length: 15 - cs.length }, (_, k) => <i key={k} className={styles.shelfEmpty} />)}
    </div>
    <div className={styles.stats}>
      <div className={styles.curve} aria-label="Energy curve">{cnt.map((n, k) => <div key={k}><i style={{ height: Math.max(3, (n / mx) * 34) }} /><span>{k + 1}</span></div>)}</div>
      <dl><div><dt>Avg cost</dt><dd>{avg(cs, c => c.cost)}</dd></div><div><dt>Avg power</dt><dd>{avg(cs, c => c.pw)}</dd></div><div><dt>Abilities</dt><dd>{cs.reduce((s, c) => s + c.ab.length, 0)}</dd></div><div><dt>In synergy</dt><dd>{deckSyn}</dd></div></dl>
    </div>
    <div className={styles.fbar}>
      <input className={styles.search} type="search" placeholder="Search players" value={q} onChange={e => setQ(e.target.value)} aria-label="Search players" />
      <select className={styles.sortSel} value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort by">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </div>
    <div className={styles.fgroup}>
      <button type="button" className={`${styles.synBtn} ${syn ? styles.on : ''}`} aria-pressed={syn} disabled={!cs.length} onClick={() => setSyn(v => !v)}>
        <b>Fits my deck</b><small>{cs.length ? `${synCount} card${synCount === 1 ? '' : 's'} with a synergy` : 'Add a card first'}</small></button>
      {anyFilter && <button type="button" className={styles.clear} onClick={() => { setQ(''); setFr(null); setCost(null); setAb(null); setSyn(false) }}>Clear filters</button>}
    </div>
    <div className={styles.frow} aria-label="Cost">{[1, 2, 3, 4, 5, 6].map(k => <button key={k} type="button" className={`${styles.gem} ${cost === k ? styles.on : ''}`} aria-pressed={cost === k} onClick={() => setCost(c => (c === k ? null : k))}><b>{k}</b><small>{E.TIER_NAME[k]}</small></button>)}</div>
    {!team && <div className={styles.frow} aria-label="Franchise">{franchises.map(([f, n]) => <button key={f} type="button" className={`${styles.frBtn} ${fr === f ? styles.on : ''}`} style={{ '--c': E.COLOR[f] }} aria-pressed={fr === f} onClick={() => setFr(x => (x === f ? null : f))}>
      {binderLogo(f) ? <img src={binderLogo(f)} alt="" onError={e => { e.currentTarget.replaceWith(Object.assign(document.createElement('b'), { textContent: f })) }} /> : <b>{f}</b>}<small>{E.NICK[f]} · {n}</small></button>)}</div>}
    <div className={styles.frow} aria-label="Ability">{abilities.map(([a, n]) => <button key={a} type="button" className={`${styles.abBtn} ${ab === a ? styles.on : ''}`} aria-pressed={ab === a} onClick={() => setAb(x => (x === a ? null : a))} title={E.AB[a].t({ pts: 60, blk: 9, stl: 9, ast: 15, tp: 9, fc: team || 'LAL', min: 48 })}>{E.AB[a].n}<small>{n}</small></button>)}</div>
    <div className={styles.count}>{pool.length} card{pool.length === 1 ? '' : 's'}{anyFilter ? ' match' : ''}</div>
    {!own.length && <p className={styles.msg}>{team ? `No ${E.NICK[team]} game cards in your binder yet. Team packs and Hang the Banner packs bring them.` : 'No game cards in your binder yet.'}</p>}
    <div className={styles.grid}>{pool.slice(0, more).map(c => {
      const inDeck = ids.includes(c.id), fit = fits[c.id]
      return <div key={c.k} className={`${styles.cell} ${inDeck ? styles.inDeck : ''}`}>
        <Chip c={c} side="p" w={104} cost={c.cost} onClick={() => toggle(c.id)} label={`${inDeck ? 'Take out' : 'Add'} ${E.cleanName(c.n)}, ${fmtDate(c.d)}, cost ${c.cost}, power ${c.pw}`} />
        {inDeck && <span className={styles.check} aria-hidden="true">✓</span>}
        <span className={styles.cellName}>{E.lastName(c.n)} <em>{yr(c)}</em></span>
        {c.ab.length > 0 && <span className={styles.cellAb}>{c.ab.map(a => E.AB[a].n).join(' · ')}</span>}
        {fit && !inDeck && <span className={styles.cellFit} data-v={Math.floor(fit.v)}>+{Math.floor(fit.v) || 1} {fit.t} · {E.lastName(fit.with.n)}</span>}
      </div>
    })}</div>
    {pool.length > more && <div style={{ padding: '0 14px 20px' }}><button type="button" className={styles.ghost} style={{ width: '100%' }} onClick={() => setMore(m => m + 60)}>Show {Math.min(60, pool.length - more)} more</button></div>}
    <div className={styles.sticky}><button type="button" className={styles.ghost} onClick={back}>Cancel</button><button type="button" className={styles.btn} disabled={cs.length !== 15} onClick={save}>{cs.length === 15 ? 'Save deck' : `Add ${15 - cs.length} more`}</button></div>
  </div>
}

function Franchises({ D, view, go }) {
  const pr = view.prog || {}
  return <div className={styles.page}>
    <div className={styles.top}><Back onClick={() => go('hub')} /><div><h3>Franchise Challenges</h3><p>Your franchise cards against the franchise’s own history, at its home courts</p></div></div>
    <div className={styles.tgrid}>{E.FRANCHISES.slice().sort((a, b) => E.NICK[a].localeCompare(E.NICK[b])).map(fc => <button key={fc} type="button" className={styles.team} style={{ '--c': E.COLOR[fc] }} onClick={() => go('frd', { fc })}>
      {binderLogo(fc) ? <img src={binderLogo(fc)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : null}<b>{E.NICK[fc]}</b>
      <span className={styles.pips}>{E.LEVELS.map(l => <i key={l} data-on={pr[fc]?.[l] ? '' : undefined} />)}</span>{view.claims?.[fc] && <em>★</em>}
    </button>)}</div>
    <h4 className={styles.sh}>All-time lineups · any deck, random courts</h4>
    <div className={styles.list}>{D.lineups.map(L => <button key={L.id} type="button" className={styles.tile} onClick={() => go('frd', { ln: L.id })}>
      <div className={styles.row}><div><b className={styles.cond}>{L.name}</b><small>{L.desc}</small></div><span className={styles.pips}>{(L.fixed ? ['brutal'] : E.LEVELS).map(l => <i key={l} data-on={pr[`L:${L.id}`]?.[l] ? '' : undefined} />)}</span></div>
    </button>)}</div>
  </div>
}

function FranchiseDetail({ D, view, scr, go, start, teamDeck, activeDeck, byId, jsonById, binder, env }) {
  const { fc, ln } = scr, isL = ln != null, L = isL ? D.lineups.find(x => x.id === ln) : null
  const key = isL ? `L:${ln}` : fc, pr = view.prog?.[key] || {}
  const levels = isL && L.fixed ? ['brutal'] : E.LEVELS
  const td = isL ? null : teamDeck(fc).map(id => byId[id]).filter(Boolean)
  const ad = activeDeck()
  const open = lv => isL || lv === 'easy' || !!pr[E.LEVELS[E.LEVELS.indexOf(lv) - 1]]
  const ready = isL ? !!ad : td.length === 15
  const claim = !isL && view.claims?.[fc]
  const sampleId = claim ? claim.card : td?.slice().sort((a, b) => b.pw - a.pw)[0]?.id
  const sample = sampleId ? jsonById[sampleId] : !isL ? asJson(E.deckOf(D, D.franchise[fc].brutal.ids).sort((a, b) => b.pw - a.pw)[0], D) : null
  return <div className={styles.page} style={{ '--c': isL ? '#173657' : E.COLOR[fc] }} data-team="">
    <div className={styles.top}><Back onClick={() => go('fr')} /><div><h3>{isL ? L.name : D.teams[fc]?.name}</h3><p>{isL ? L.desc : `${E.NICK[fc]} cards only · played at ${E.NICK[fc]} home courts · beat each level to open the next`}</p></div></div>
    <div className={styles.list}>
      {isL ? <div className={styles.tile}><small>You play with</small><b className={styles.cond}>{ad ? ad.name : 'No active deck'}</b><small>Any cards from any franchise. The courts are a surprise.</small>{!ad && <button type="button" className={styles.btn} onClick={() => go('decks')}>Build a deck</button>}</div>
        : <div className={styles.tile}>
          <div className={styles.row}><div><small>Your {E.NICK[fc]} deck</small><b className={styles.cond}>{td.length}/15 {E.NICK[fc]} cards{ready ? ` · avg power ${avg(td, c => c.pw)}` : ''}</b></div>
            <button type="button" className={styles.ghost} onClick={() => go('build', { team: fc, ids: td.map(c => c.id) })}>Edit</button></div>
          <div className={styles.strip}>{td.slice().sort((a, b) => b.pw - a.pw).slice(0, 8).map(c => <span key={c.k} style={{ background: col(c) }}>{E.initials(c.n)}</span>)}</div>
          <small>{ready ? `Built from the best of your ${binder.filter(c => c.fc === fc).length} ${E.NICK[fc]} cards. Edit to swap any.` : `A franchise deck needs 15 of its cards; you have ${td.length}. Team packs and Hang the Banner packs bring more.`}</small>
        </div>}
      {levels.map(lv => {
        const cs = E.deckOf(D, isL ? L[lv] : D.franchise[fc][lv].ids), anchor = !isL && D.franchise[fc][lv].anchor
        const top = cs.slice().sort((a, b) => b.pw - a.pw || b.cost - a.cost).slice(0, 3), o = open(lv)
        return <div key={lv} className={`${styles.tile} ${o ? '' : styles.locked}`}>
          <div className={styles.diff}><div className={styles.lv} style={{ '--lc': LEVEL_COL[lv] }}>{!o && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>}{E.LEVEL_NAME[lv]}{pr[lv] && <small>Beaten</small>}</div>
            <div><small>{LEVEL_TXT[lv]}{anchor ? ` Built around the ${anchor} ${E.NICK[fc]}.` : ''}</small><span><b>{o ? 'Win:' : 'Locked:'}</b> {o ? (isL ? 'No reward set yet' : FR_WIN[lv]) : `Beat ${E.LEVEL_NAME[E.LEVELS[E.LEVELS.indexOf(lv) - 1]]} to open it`}</span></div></div>
          {o && <div className={styles.playRow}>{top.map(c => <Chip key={c.k} c={c} side="c" w={46} />)}<small>+{cs.length - 3} more · avg power {avg(cs, c => c.pw)}</small>
            <button type="button" className={styles.btn} disabled={!ready} onClick={() => start({ mode: isL ? 'lineup' : 'fr', fc: isL ? null : fc, ln: isL ? ln : null, level: lv, ids: isL ? ad.ids : td.map(c => c.id) })}>Play</button></div>}
        </div>
      })}
      <p className={styles.note}>{AI_NOTE}</p>
    </div>
    {!isL && sample && <>
      <h4 className={styles.sh}>The Brutal reward · a {E.NICK[fc]} redesign</h4>
      <p className={styles.note} style={{ padding: '0 14px' }}>{claim ? `Claimed: ${LOOKS.find(l => l[0] === claim.style)[1]}.` : 'Beat Brutal and pick one card from the deck that won. It wears one of these for good, and no other card in your binder looks like it.'}</p>
      <div className={styles.hscroll}>{LOOKS.map(([id, n, d]) => <div key={id} className={styles.look}><CardFace card={{ ...sample, clash: { fc, style: id } }} shots={env.shots} w={150} /><b>{n}</b><small>{d}</small></div>)}</div>
      {!claim && td.length > 0 && <div style={{ padding: '0 14px 24px' }}><button type="button" className={styles.ghost} style={{ width: '100%' }} onClick={() => go('claim', { fc, ids: td.map(c => c.id), demo: true })}>Preview the claim screen</button></div>}
    </>}
  </div>
}

function Daily({ D, view, go, start, activeDeck, jsonById, env }) {
  const day = view.day, ad = activeDeck()
  return <div className={styles.page}>
    <div className={styles.top}><Back onClick={() => go('hub')} /><div><h3>Daily Challenges</h3><p>{new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} · any deck, surprise courts · resets at midnight ET</p></div></div>
    <p className={styles.note} style={{ padding: '0 14px' }}>{AI_NOTE}</p>
    <div className={styles.list}>
      {!ad && <div className={styles.tile}><small>No active deck yet</small><button type="button" className={styles.btn} onClick={() => go('decks')}>Build a deck</button></div>}
      {E.LEVELS.map(lv => {
        const cs = E.dailyDeck(D, day, lv), done = view.daily?.[lv]
        return <div key={lv} className={styles.tile}><div className={styles.diff}>
          <div className={styles.lv} style={{ '--lc': LEVEL_COL[lv] }}>{E.LEVEL_NAME[lv]}{done && <small>Done</small>}</div>
          <div><small>{new Set(cs.map(c => c.fc)).size} franchises · avg power {avg(cs, c => c.pw)} · {DAILY_TXT[lv]}</small><span><b>Win:</b> {DAILY_WIN[lv]}</span></div>
          {done ? (done.card ? <span className={styles.pullThumb}><CardFace card={done.card} shots={env.shots} w={56} /></span> : null)
            : <button type="button" className={styles.btn} disabled={!ad} onClick={() => start({ mode: 'daily', level: lv, ids: ad.ids })}>Play</button>}
        </div></div>
      })}
    </div>
  </div>
}

function Match({ M, setM, go, C, setView, D, env, jsonById, start }) {
  const st = M.st
  const [sheet, setSheet] = useState(null)
  const live = useRef(M); live.current = M
  const spent = M.staged.reduce((s, x) => s + E.costOf(st, st.cards[x.k], x.li), 0)
  const left = st.energy.p - spent
  const cards = M.anim?.cards || st.cards
  const B = M.anim ? M.anim.board : E.board(st)
  const fxBy = {}; (M.anim?.fx || []).forEach(f => { fxBy[f.u] = f })
  const sel = M.sel
  const proj = li => {
    if (!sel || M.phase !== 'plan') return null
    const c = st.cards[sel]
    if (!E.canPlayAt(st, 'p', li, M.staged.filter(x => x.li === li).length) || E.costOf(st, c, li) > left) return null
    return E.project(st, M.staged, sel, li)
  }
  const endTurn = async () => {
    if (M.phase !== 'plan') return
    setM(m => ({ ...m, phase: 'cpu', sel: null }))
    const d = await C.clashTurn(M.id, M.staged.map(x => ({ k: x.k, li: x.li })))
    if (!d) { setM(m => ({ ...m, phase: 'plan' })); return }
    const allCards = { ...st.cards, ...d.view.cards }
    for (const s of d.steps) {
      if (s.skip) continue
      const pc = allCards[s.k], call = s.end ? null : { li: s.li, side: s.side, name: pc ? E.lastName(pc.n) : '', abs: (pc?.ab || []).filter(a => E.AB[a].k === 'On reveal' && s.fx.some(f => f.t.includes(E.AB[a].n))), fx: s.fx.slice(0, 3) }
      setM(m => ({ ...m, phase: 'reveal', anim: { board: s.board, fx: s.fx, flash: s.u, cards: allCards, call, n: (m.anim?.n || 0) + 1 } }))
      await sleep(s.end ? (s.fx.length ? 1000 : 150) : STEP_MS)
    }
    setM(m => ({ ...m, st: E.fromPublic(d.view), staged: [], anim: null, phase: d.over ? 'over' : 'plan', over: d.over, reward: d.reward }))
    if (d.clash) setView(d.clash)
  }
  const stage = li => {
    if (!sel || M.phase !== 'plan') { const L = st.locs[li]; if (L.revealed) setSheet({ loc: L.id }); return }
    if (!proj(li)) return
    setM(m => ({ ...m, staged: [...m.staged, { k: sel, li }], sel: null }))
  }
  const handFree = st.hand.p.filter(k => !M.staged.some(x => x.k === k))
  const instAt = u => { for (const L of st.locs) for (const s of ['p', 'c']) for (const i of L[s]) if (i.u === u) return i; return null }
  const over = M.over
  if (M.phase === 'over' && M.showResult) return <Result M={M} go={go} D={D} env={env} start={start} />
  const banner = M.phase === 'cpu' ? 'CPU is choosing' : null
  return <div className={styles.match}>
    <div className={styles.mtop}>
      <Back onClick={() => go('hub')} label="Leave the match (it stays open on the table)" />
      <div className={styles.turn}><b>Turn {Math.min(st.turn, 6)} <span>/ 6</span></b><small>{M.phase === 'plan' ? 'Your move' : M.phase === 'cpu' ? 'CPU is choosing' : M.phase === 'over' ? 'Final' : 'Revealing'}{M.phase === 'cpu' && <span className={styles.think}><i /><i /><i /></span>}</small></div>
      <div className={styles.cpu}><b>CPU · {E.LEVEL_NAME[M.level]}</b><small>{st.handC} in hand · {st.deckC} in deck</small></div>
    </div>
    <div className={styles.board}>{st.locs.map((L, li) => {
      const b = B[li], id = b.id, revealed = !!id
      const mine = b.p.map(x => ({ ...x, c: cards[x.k] })), theirs = b.c.map(x => ({ ...x, c: cards[x.k] }))
      const staged = M.anim ? [] : M.staged.filter(x => x.li === li)
      const slots = revealed ? (E.LOCBY[id].slots || 4) : 4
      const pj = proj(li), dim = sel && M.phase === 'plan' && !pj
      const w = over?.w?.[li]
      const t = over && !M.anim ? over.t[li] : b.t
      const chip = (x, side) => <div key={x.u} className={styles.slotWrap}>
        <Chip c={x.c} side={side} pw={x.pw} cls={M.anim?.flash === x.u ? styles.flash : ''} onClick={() => !M.anim && setSheet({ u: x.u })} />
        {M.anim?.flash === x.u && <i className={styles.burst} data-side={side} aria-hidden="true" />}
        {fxBy[x.u] && <span className={styles.fl} data-k={fxBy[x.u].c}>{fxBy[x.u].t}</span>}
      </div>
      const opp = [...theirs.map(x => chip(x, 'c'))]
      while (opp.length < slots) opp.push(<i key={`e${opp.length}`} className={styles.empty} />)
      const you = [...mine.map(x => chip(x, 'p')), ...staged.map(x => <div key={`s${x.k}`} className={styles.slotWrap}><Chip c={st.cards[x.k]} side="p" cls={`${styles.staged} ${styles.drop}`} onClick={() => M.phase === 'plan' && setM(m => ({ ...m, staged: m.staged.filter(y => y.k !== x.k) }))} label={`Take back ${E.cleanName(st.cards[x.k].n)}`} /></div>)]
      while (you.length < slots) you.push(<i key={`e${you.length}`} className={styles.empty} />)
      const def = revealed ? E.LOCBY[id] : null
      return <div key={li} className={styles.col}>
        <div className={`${styles.slots} ${styles.opp}`}>{opp.reverse()}</div>
        <button type="button" className={`${styles.loc} ${pj ? styles.target : ''} ${dim ? styles.dim : ''}`} onClick={() => stage(li)} aria-label={def ? `${def.name}: ${def.rule}. ${def.fx}` : `Court ${li + 1}, revealed on turn ${li + 1}`}>
          <Floor id={id} revealed={revealed}>{w && <div className={styles.wash} data-w={w} />}<div className={styles.sc}><span key={`p${t.p}`} className={M.anim ? styles.pop : ''} data-up={t.p > t.c ? '' : undefined}>{t.p}</span><span key={`c${t.c}`} className={M.anim ? styles.pop : ''} data-dn={t.c > t.p ? '' : undefined}>{t.c}</span></div></Floor>
          {M.anim?.call?.li === li && <div key={M.anim.n} className={styles.callout} data-side={M.anim.call.side}>
            <b>{M.anim.call.side === 'p' ? 'You' : 'CPU'}: {M.anim.call.name}</b>
            {M.anim.call.abs.map(a => <span key={a} className={styles.calloutAb}>{AB_MARK[a]} {E.AB[a].n}</span>)}
          </div>}
          <div className={styles.locInfo}>{def ? <><b>{def.name}</b><small><em>{def.rule}:</em> {def.fx}{L.f?.lock ? ' Locked.' : ''}{L.f?.shut ? (L.f.shut === 'p' ? ' You can’t play here.' : ' CPU can’t play here.') : ''}</small></> : <><b>Turn {li + 1}</b><small>Revealed on turn {li + 1}. You can still play here.</small></>}</div>
        </button>
        {pj && <div className={styles.proj}><b>{pj.you}–{pj.opp} {pj.you > pj.opp ? '▲' : pj.you < pj.opp ? '▼' : '='}</b>
          {pj.rows.filter(r => r[2] !== 'base').slice(0, 3).map((r, k) => <span key={k} data-k={r[2]}>{r[0] > 0 ? '+' : ''}{r[0]} {r[1]}</span>)}
          {pj.fx.slice(0, 2).map((f, k) => <span key={`f${k}`} data-k={f.c}>{f.t} →</span>)}</div>}
        <div className={`${styles.slots} ${styles.yours}`}>{you}</div>
      </div>
    })}</div>
    <div className={styles.dock}>
      {sel && !over && M.phase === 'plan' && <Spotlight key={sel} c={st.cards[sel]} kc={E.costOf(st, st.cards[sel], null)} lit={[0, 1, 2].filter(li => proj(li)).length} onBack={() => setM(m => ({ ...m, sel: null }))} onInfo={() => setSheet({ k: sel })} />}
      {!(sel && !over && M.phase === 'plan') && <div className={styles.panel}>
        {over ? <><b className={styles.ph}>{over.winner === 'p' ? 'You win' : over.winner === 'c' ? 'CPU wins' : 'Draw'} · {over.np}–{over.nc}</b><small>{(st.log || []).slice(-3).map(x => `${x[0] === 'p' ? 'You' : 'CPU'}: ${x[1]}`).join(' · ')}</small></>
          : sel ? null
            : <><b className={styles.ph}>{M.title} · {E.LEVEL_NAME[M.level]}</b><small>{st.turn === 1 && !st.log.length ? 'Tap a card to see what it would score at each court, then tap a court. Energy you don’t spend carries over.' : (st.log || []).slice(-3).map(x => `${x[0] === 'p' ? 'You' : 'CPU'}: ${x[1]}`).join(' · ')}</small>
              <small>CPU: {st.energy.c} energy, {st.handC} cards. It plays after you, seeing where your cards land but not which ones.</small></>}
      </div>}
      {!(sel && M.phase === 'plan') && <HandFan items={handFree.map(k => { const c = st.cards[k], kc = E.costOf(st, c, null); return { k, c, kc, off: kc > left || M.phase !== 'plan', styled: !!jsonById[c.id]?.clash } })}
        sel={sel} disabled={M.phase !== 'plan'} onInfo={k => setSheet({ k })}
        onPick={k => setM(m => ({ ...m, sel: m.sel === k ? null : k }))} />}
      <div className={styles.ctrl}>
        <div className={styles.orb}>{left}<small>Energy</small></div>
        <small className={styles.note}>{M.phase === 'plan' ? (st.turn < 6 ? `Next turn: +${st.turn + 1} energy${left ? `, plus ${left} carried over` : ''}.` : 'Last turn. Spend it all.') : ''} {st.deckP} in deck.</small>
        {over ? <button type="button" className={styles.btn} onClick={() => setM(m => ({ ...m, showResult: true }))}>Results</button>
          : <button type="button" className={styles.btn} disabled={M.phase !== 'plan'} onClick={endTurn}>{st.turn >= 6 ? 'Final turn' : 'End turn'}</button>}
      </div>
    </div>
    {banner && <div className={styles.banner}>{banner}</div>}
    {sheet && <Sheet sheet={sheet} st={st} cards={cards} instAt={instAt} onClose={() => setSheet(null)} />}
  </div>
}

// The card you picked up: big, with its abilities spelled out, while the courts light up with what it would score there
function Spotlight({ c, kc, lit, onBack, onInfo }) {
  const { face, shots } = useContext(Faces)
  return <div className={styles.spot2}>
    <div className={styles.spotCard}><span className={styles.spotShine} aria-hidden="true" />{face(c) && <CardFace card={face(c)} shots={shots} w={118} />}
      <span className={styles.fcC} data-dn={kc < c.cost ? '' : undefined}>{kc}</span><span className={styles.fcP}>{c.pw}</span></div>
    <div className={styles.spotInfo}>
      <b className={styles.ph}>{E.cleanName(c.n)}</b>
      <small>{statLine(c)} · {fmtDate(c.d)} · {gameLine(c)}</small>
      <div className={styles.spotAbs}>{c.ab.length ? c.ab.map(a => <AbBadge key={a} a={a} c={c} big />) : <div className={styles.abTile} data-kind="none"><span className={styles.abMark}>—</span><div><b>No ability</b><p>Raw power: {c.pw}. Fundamentals courts reward that.</p></div></div>}</div>
      <small className={styles.hint}>{lit ? `${lit} court${lit === 1 ? '' : 's'} lit: tap one to play it.` : 'No court can take it right now.'}</small>
      <div className={styles.spotBtns}><button type="button" className={styles.ghost} onClick={onBack}>Put it back</button><button type="button" className={styles.ghost} onClick={onInfo}>Full card</button></div>
    </div>
  </div>
}
function Sheet({ sheet, st, cards, instAt, onClose }) {
  if (sheet.loc) {
    const L = E.LOCBY[sheet.loc]
    return <div className={styles.veil} onClick={onClose}><div className={styles.sheet} role="dialog" aria-label={L.name} onClick={e => e.stopPropagation()}><i className={styles.grab} />
      <b className={styles.cond} style={{ fontSize: 24 }}>{L.name}</b><p><em>{L.rule}:</em> {L.fx}</p><button type="button" className={styles.ghost} style={{ width: '100%' }} onClick={onClose}>Close</button></div></div>
  }
  const inst = sheet.u ? instAt(sheet.u) : null
  const c = inst ? inst.c : cards[sheet.k]
  if (!c) return null
  const bd = inst ? E.breakdown(st, inst) : null
  return <div className={styles.veil} onClick={onClose}><div className={styles.sheet} role="dialog" aria-label={E.cleanName(c.n)} onClick={e => e.stopPropagation()}><i className={styles.grab} />
    <div className={styles.sheetHead}><span style={{ background: col(c) }}>{E.initials(c.n)}</span><div><small>{E.TIER_NAME[c.cost]} · cost {c.cost} · power {c.pw}</small><b className={styles.cond}>{E.cleanName(c.n)}</b><small>{fmtDate(c.d)} · {gameLine(c)}</small><small>{statLine(c)} · Game Score {c.gs}</small></div></div>
    {bd && <><h4 className={styles.sh}>Power now · {E.LOCBY[st.locs[inst.li].id]?.name}</h4>{bd.rows.map((r, k) => <div key={k} className={styles.bdRow}><span>{r[1]}</span><b data-k={r[2]}>{r[2] === 'base' ? r[0] : `${r[0] > 0 ? '+' : ''}${r[0]}`}</b></div>)}
      <div className={`${styles.bdRow} ${styles.bdTotal}`}><b>Total</b><b>{bd.total}</b></div></>}
    <h4 className={styles.sh}>Abilities</h4>{c.ab.length ? <div className={styles.spotAbs}>{c.ab.map(a => <AbBadge key={a} a={a} c={c} big />)}</div> : <p><small>None. A card carries up to two; this night didn’t earn one.</small></p>}
    <h4 className={styles.sh}>Synergies</h4><p><small>Same franchise at a court +1 · same season +2 · same game +3 · Real Duo (100+ games together) +1 · Era Arena +2.</small></p>
    <button type="button" className={styles.ghost} style={{ width: '100%' }} onClick={onClose}>Close</button></div></div>
}

function Result({ M, go, D, env, start }) {
  const st = M.st, f = M.over, win = f.winner === 'p', r = M.reward
  let mvp = null, mp = -1
  st.locs.forEach(L => L.p.forEach(i => { const p = E.power(st, i); if (p > mp) { mp = p; mvp = i } }))
  const back = () => (M.mode === 'daily' ? go('daily') : M.mode === 'fr' ? go('frd', { fc: M.fc }) : go('fr'))
  return <div className={`${styles.result} ${win ? '' : styles.lost}`}>
    {win && <div className={styles.confetti} aria-hidden="true">{Array.from({ length: 18 }, (_, k) => { const a = (k / 18) * Math.PI * 2; return <i key={k} style={{ '--dx': `${Math.round(Math.cos(a) * (120 + (k % 3) * 30))}px`, '--dy': `${Math.round(Math.sin(a) * 110 - 40)}px`, animationDelay: `${(k % 4) * 0.05}s` }} /> })}</div>}
    <small className={styles.kick}>{M.title} · {E.LEVEL_NAME[M.level]}</small>
    <h2>{win ? 'You win' : f.winner ? 'CPU wins' : 'Draw'}</h2><p className={styles.courtsTo}>{f.np} courts to {f.nc}</p>
    <div className={styles.resCourts}>{st.locs.map((L, li) => <div key={li}><div className={styles.resFloor}><Floor id={L.id} revealed><div className={styles.wash} data-w={f.w[li] || 'none'} /><div className={styles.sc} data-c=""><span>{f.t[li].p}–{f.t[li].c}</span></div></Floor></div><b>{E.LOCBY[L.id]?.name}</b></div>)}</div>
    {mvp && <div className={styles.tile}><div className={styles.sheetHead}><span style={{ background: col(mvp.c) }}>{E.initials(mvp.c.n)}</span><div><small className={styles.goldK}>Player of the match</small><b className={styles.cond}>{E.cleanName(mvp.c.n)}, {mvp.c.pts} pts</b><small>{fmtDate(mvp.c.d)} · {gameLine(mvp.c)} · finished at {mp} power</small></div></div></div>}
    <h4 className={styles.sh}>Reward</h4>
    {!win ? <div className={styles.tile}><small>No reward this time. {M.mode === 'fr' ? 'The level stays open.' : 'Try another deck.'}</small></div>
      : r?.kind === 'daily' ? (r.card ? <div className={`${styles.tile} ${styles.pull}`}><span className={styles.flipIn}><CardFace card={r.card.card} shots={env.shots} w={140} /></span><div><small className={styles.goldK}>{E.TIER_NAME[E.TIER_COST[r.card.card.tier]]} pulled</small><b className={styles.cond}>{E.cleanName(r.card.card.row.n)}</b><small>{fmtDate(r.card.card.date)} · {r.card.card.tn}</small><small>It’s in your binder.</small></div></div>
        : <div className={styles.tile}><small>{r.already ? 'You already took today’s card for this level.' : 'No card was left to pull. Try again later.'}</small></div>)
        : r?.kind === 'unlock' ? <div className={styles.tile}><b className={styles.good}>{E.LEVEL_NAME[r.level]} is open.</b><small>{r.level === 'brutal' ? 'Beat it for the franchise redesign.' : 'One step closer to Brutal.'}</small></div>
          : r?.kind === 'redesign' ? (r.claimed ? <div className={styles.tile}><small>{E.NICK[r.fc]} beaten again. Your redesign is already claimed.</small></div>
            : <div className={styles.tile}><b className={styles.good}>{E.NICK[r.fc]} redesign unlocked</b><small>Pick one card from the deck that just won and the look it wears for good.</small><button type="button" className={styles.btn} onClick={() => go('claim', { fc: r.fc, ids: M.ids })}>Claim it</button></div>)
            : <div className={styles.tile}><b className={styles.good}>Beaten.</b><small>No reward is set for the all-time lineups yet.</small></div>}
    <div className={styles.resBtns}>{M.again && <button type="button" className={styles.btn} onClick={() => start(M.again)}>Play again</button>}<button type="button" className={styles.ghost} onClick={back}>Back to {M.mode === 'daily' ? 'Daily Challenges' : M.mode === 'fr' ? E.NICK[M.fc] : 'the lineups'}</button></div>
  </div>
}

function Claim({ scr, go, byId, jsonById, env, C, setView }) {
  const { fc, ids, demo } = scr
  const cs = ids.map(id => byId[id]).filter(Boolean).sort((a, b) => b.pw - a.pw)
  const [pick, setPick] = useState(cs[0]?.id)
  const [look, setLook] = useState('floor')
  const [sure, setSure] = useState(false)
  const card = jsonById[pick]
  const apply = async () => {
    if (!sure) { setSure(true); return }
    const v = await C.clashClaim({ fc, card: pick, style: look })
    if (v) { setView(v); go('frd', { fc }) }
  }
  return <div className={styles.page} style={{ '--c': E.COLOR[fc] }} data-team="">
    <div className={styles.top}><Back onClick={() => go('frd', { fc })} /><div><h3>{E.NICK[fc]} redesign</h3><p>{demo ? 'Preview: what beating Brutal opens.' : 'One card from the deck that beat Brutal. This can’t be undone.'}</p></div></div>
    {card && <div className={styles.claimCard}><CardFace card={{ ...card, clash: { fc, style: look } }} shots={env.shots} w={230} live /></div>}
    <h4 className={styles.sh}>1 · Pick the look</h4>
    <div className={styles.opts}>{LOOKS.map(([id, n, d]) => <button key={id} type="button" className={look === id ? styles.on : ''} aria-pressed={look === id} onClick={() => { setLook(id); setSure(false) }}><b>{n}</b><small>{d}</small></button>)}</div>
    <h4 className={styles.sh}>2 · Pick the card</h4>
    <div className={styles.claimRow}>{cs.map(c => <Chip key={c.k} c={c} side="p" w={64} cls={c.id === pick ? styles.staged : ''} onClick={() => { setPick(c.id); setSure(false) }} label={`${E.cleanName(c.n)}, ${fmtDate(c.d)}`} />)}</div>
    <div className={styles.sticky}>{demo ? <button type="button" className={styles.btn} disabled>Beat Brutal to claim</button>
      : <button type="button" className={styles.btn} onClick={apply}>{sure ? `Tap again: ${E.lastName(byId[pick].n)} in ${LOOKS.find(l => l[0] === look)[1]}, for good` : `Apply to ${E.lastName(byId[pick]?.n || '')}`}</button>}</div>
  </div>
}
