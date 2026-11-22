import { useState, useEffect, useLayoutEffect, useMemo, useRef, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { ArenaMatch, ColorPick, SCHEMES, COACHES, any } from './ClashArena.jsx'
import { Hub, Decks, Franchises, FranchiseDetail, Daily } from './ClashMenu.jsx'
import styles from './Clash.module.css'
import { useCollector, CardFace } from './Collector'
import { binderLogo, binderHeadshots } from './SeasonExplorer'
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
export function AbBadge({ a, c, big }) {
  const k = AB_KIND[E.AB[a].k]
  return big ? <div className={styles.abTile} data-kind={k}><span className={styles.abMark}>{AB_MARK[a]}</span><div><b>{E.AB[a].n}</b><em>{E.AB[a].k} · {KIND_TIP[k]}</em><p>{E.AB[a].t(c)}</p><small>Earned: {E.AB[a].why(c)}</small></div></div>
    : <span className={styles.abTag} data-kind={k} title={`${E.AB[a].n}: ${E.AB[a].t(c)}`}>{AB_MARK[a]}</span>
}
// A deck holds one card per player
const onePer = cs => new Set(cs.map(c => c.n)).size === cs.length
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
export const Faces = createContext({ face: () => null, shots: {} })
export function Chip({ c, side, pw, cls = '', onClick, w = 56, label, cost }) {
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
export function Floor({ id, revealed, children }) {
  const L = revealed && id ? E.LOCBY[id] : null
  const f = L ? L.floor : 'down'
  return <div className={styles.floor} data-floor={f} style={L ? { '--c1': L.c1 || '#555', '--c2': L.c2 || '#fff' } : undefined}>
    {L && (f === 'maple' || f === 'parquet' || f === 'fiba') && <><i className={styles.mid} /><i className={styles.circle} /><i className={styles.keyL} /><i className={styles.keyR} /></>}
    {L && (f === 'old' || f === 'asphalt' || f === 'concrete' || f === 'cup') && <><i className={styles.mid} /><i className={styles.ring} /></>}
    {L && f === 'ymca' && <><i className={styles.basket} style={{ left: 4 }} /><i className={styles.basket} style={{ right: 4 }} /></>}
    {children}
  </div>
}

export default function Clash({ env: env0, onClose }) {
  const C = useCollector()
  // The Game Room's screen host passes a headshot lookup but not the headshot map the card faces read, so load it here
  const [shots, setShots] = useState(env0.shots || null)
  useEffect(() => { if (!env0.shots) binderHeadshots().then(setShots).catch(() => {}) }, [])
  const env = useMemo(() => ({ ...env0, shots: shots || {} }), [env0, shots])
  const [D, setD] = useState(null)
  const [flags, setFlags] = useState({})
  const [view, setView] = useState(null)
  const [err, setErr] = useState(null)
  const [scr, setScr] = useState({ s: 'hub' })
  const [M, setM] = useState(null)
  // The menus and the match take over the whole screen: hold the page still behind them
  useEffect(() => {
    if (scr.s === 'claim') return
    const o = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = o }
  }, [scr.s === 'claim'])
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
    const per = {}, add = c => { if (out.length < 15 && !out.includes(c.id) && (per[c.n] || 0) < 1) { out.push(c.id); per[c.n] = (per[c.n] || 0) + 1; return true } return false }
    Object.entries(TCURVE).forEach(([k, n]) => { let got = 0; pool.filter(c => c.cost === +k).forEach(c => { if (got < n && add(c)) got++ }) })
    pool.forEach(add)
    return out.slice(0, 15)
  }
  const teamDeck = fc => { const s = view?.teams?.[fc]; return s && s.length === 15 && s.every(id => byId[id]) && onePer(s.map(id => byId[id])) ? s : autoTeam(fc) }
  const activeDeck = () => { const d = view?.decks?.[view.active]; const cs = d ? d.ids.map(id => byId[id]).filter(Boolean) : []; return cs.length === 15 && onePer(cs) ? d : null }

  if (err) return <div className={styles.root}><div className={styles.felt}><p className={styles.msg}>{err}</p></div></div>
  if (!D || !view) return <div className={styles.root}><div className={styles.felt}><p className={styles.msg}>Shuffling the decks…</p></div></div>

  // Deck colors: one of the presets per deck, kept on this device; the CPU coach draws another each match
  const colorKey = o => (o?.mode === 'fr' && o.fc ? `team:${o.fc}` : `deck:${view.active ?? 0}`)
  const colorOf = k => { try { return SCHEMES.find(s => s.id === localStorage.getItem(`fcc-colors:${k}`)) || SCHEMES[0] } catch { return SCHEMES[0] } }
  const ad0 = activeDeck()
  const deckCards = ad0 ? ad0.ids.map(id => byId[id]).filter(Boolean) : []
  const begin = (r, o) => {
    const you = colorOf(colorKey(o || { mode: r.mode, fc: r.fc }))
    const mode = r.mode, fc = r.fc
    setM({ id: r.match, title: r.title, mode, level: r.level, fc, ln: o?.ln ?? null, ids: o?.ids || [], view0: r.view, again: o || null, reward: null, n: Date.now(),
      you, opp: any(SCHEMES.filter(s => s.id !== you.id)), coach: any(COACHES),
      deckName: mode === 'fr' && fc ? `${E.NICK[fc]} deck` : (ad0?.name || 'Your deck'),
      label: mode === 'fr' && fc ? `${E.NICK[fc]} deck · ${E.LEVEL_NAME[r.level]}` : mode === 'daily' ? `Daily · ${E.LEVEL_NAME[r.level]}` : `${r.title || 'Lineup'} · ${E.LEVEL_NAME[r.level]}` })
    go('match')
  }
  const start = async o => { const r = await C.clashStart(o); if (r) begin(r, o) }
  const resume = async () => { const r = await C.clashMatch(view.open.id); if (r) begin(r, null) }
  const play = o => start({ ...o, ids: o.ids || ad0?.ids })
  const backFrom = m => (m?.mode === 'daily' ? go('daily') : m?.mode === 'fr' ? go('frd', { fc: m.fc }) : m?.mode === 'lineup' ? go('frd', { ln: m.ln }) : go('hub'))
  const P = { D, view, setView, binder, byId, jsonById, go, scr, start, resume, teamDeck, activeDeck, C, env, M, setM }
  const you = colorOf(scr.s === 'frd' && scr.fc ? `team:${scr.fc}` : `deck:${view.active ?? 0}`)
  const full = s => createPortal(<Faces.Provider value={faces}>{s}</Faces.Provider>, document.body)
  const faces = { shots: env.shots, face: c => (c.id != null && jsonById[c.id]) || (c.k && c.k[0] === 'c' ? asJson(c, D) : null) }
  return <Faces.Provider value={faces}><div className={styles.root}>
    {scr.s === 'hub' && full(<Hub view={view} deck={deckCards} deckName={ad0?.name} you={you} go={go} play={play} resume={resume} onClose={onClose} />)}
    {scr.s === 'decks' && full(<Decks {...P} you={you} />)}
    {scr.s === 'colors' && full(<ColorPick you={you.id} deckName={ad0?.name || 'Your deck'} setYou={id => { try { localStorage.setItem(`fcc-colors:deck:${view.active ?? 0}`, id) } catch { /* private window */ } go('colors') }} start={() => go('hub')} />)}
    {scr.s === 'build' && <Build {...P} />}
    {scr.s === 'fr' && full(<Franchises {...P} you={you} />)}
    {scr.s === 'frd' && full(<FranchiseDetail {...P} you={you} />)}
    {scr.s === 'daily' && full(<Daily {...P} you={you} />)}
    {scr.s === 'match' && M && full(<ArenaMatch key={M.n} view0={M.view0} you={M.you} opp={M.opp} coach={M.coach} label={M.label} deckName={M.deckName}
      turn={async plays => { const d = await C.clashTurn(M.id, plays); return d || null }}
      onOver={d => { setM(m => ({ ...m, reward: d.reward, over: d.over })); if (d.clash) setView(d.clash) }}
      reward={<RewardBlock M={M} go={go} env={env} />}
      again={M.again ? () => start(M.again) : null} menu={() => backFrom(M)} />)}
    {scr.s === 'claim' && <Claim {...P} />}
  </div></Faces.Provider>
}

// ── Deck builder: a full-screen game screen. The deck sits in cost columns up top, your binder fills the rest, and a
// tap opens the big card view. Sort slides in from the left, search and filters from the right. ──
const BSORTS = [['cost', 'Energy cost', 1], ['pw', 'Power', -1], ['gs', 'Game Score', -1], ['syn', 'Synergy', -1], ['date', 'Game date', -1], ['name', 'Name', 1]]
const BSORT_SHORT = { cost: 'COST', pw: 'POWER', gs: 'GS', syn: 'SYN', date: 'DATE', name: 'A–Z' }
const SYN_LV = [['fr', 'Franchise', 1], ['season', 'Season', 2], ['game', 'Game', 3]]
const TIER_BG = ['', '#c9d3df', '#7fbaff', '#cf9cff', '#ffd36b', '#ff9a6b', '#ffe08a']
const TIER_RAY = ['', 'rgba(200,215,235,.10)', 'rgba(110,170,255,.14)', 'rgba(190,130,255,.15)', 'rgba(255,205,90,.17)', 'rgba(255,130,80,.17)', 'rgba(255,225,140,.2)']
// What a card adds to a deck: the best franchise synergy it has with a card there (+1 franchise, +2 season, +3 game),
// plus +1 for a Real Duo. Both only count when the two share a court.
function synRows(c, deck, pairs) {
  let best = null
  for (const o of deck) {
    if (o.id === c.id || o.n === c.n || o.fc !== c.fc) continue
    const v = o.g === c.g ? 3 : o.s === c.s ? 2 : 1
    if (!best || v > best.v) best = { v, t: v === 3 ? 'Same game' : v === 2 ? 'Same season' : 'Same franchise', with: o }
  }
  const rows = best ? [best] : []
  const duo = pairs && deck.find(o => o.id !== c.id && o.n !== c.n && (pairs.get([o.n, c.n].sort().join('|')) || 0) >= 100)
  if (duo) rows.push({ v: 1, t: 'Real Duo', with: duo })
  return { v: rows.reduce((s, r) => s + r.v, 0), rows }
}
// The cards that would share a synergy level with card f
const synMatch = (f, lv) => c => c.fc === f.fc && c.n !== f.n && (lv === 'game' ? c.g === f.g : lv === 'season' ? c.s === f.s : true)
function useWidth(ref) {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return w
}
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const Svg = ({ d, size = 18, w = 3 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>

function Build({ scr, go, binder, byId, C, setView }) {
  const team = scr.team || null
  const [ids, setIds] = useState(scr.ids)
  const [name, setName] = useState(scr.name)
  const [q, setQ] = useState('')
  const [frs, setFrs] = useState([])
  const [costs, setCosts] = useState([])
  const [abs, setAbs] = useState([])
  const [fit, setFit] = useState(false)
  const [alt, setAlt] = useState(true)
  const [showIn, setShowIn] = useState(true)
  const [focus, setFocus] = useState(null)
  const [sort, setSort] = useState(['cost', 1])
  const [drawer, setDrawer] = useState(null)
  const [insp, setInsp] = useState(null)
  const [fly, setFly] = useState(null)
  const [landed, setLanded] = useState(null)
  const [backId, setBackId] = useState(null)
  const [pop, setPop] = useState(null)
  const [toast, setToast] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const [more, setMore] = useState(60)
  const [pairs, setPairs] = useState(null)
  const gridRef = useRef(null), moreRef = useRef(null), bigRef = useRef(null), ghostRef = useRef(null), trayRef = useRef(null)
  const start = useRef(scr.ids.join(','))
  const trayW = useWidth(trayRef), gridW = useWidth(gridRef)
  useEffect(() => { fetch('/data/clash/pairs.json').then(r => (r.ok ? r.json() : [])).then(a => setPairs(new Map(a.map(([x, y, n]) => [`${x}|${y}`, n])))).catch(() => setPairs(new Map())) }, [])
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])
  useEffect(() => { setMore(60); gridRef.current?.scrollTo?.({ top: 0 }) }, [q, frs, costs, abs, fit, alt, showIn, focus, sort])
  useEffect(() => {
    const k = e => { if (e.key !== 'Escape') return; if (insp) setInsp(null); else if (drawer) setDrawer(null); else if (leaving) setLeaving(false) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [insp, drawer, leaving])

  const own = useMemo(() => (team ? binder.filter(c => c.fc === team) : binder), [binder, team])
  const cs = useMemo(() => ids.map(id => byId[id]).filter(Boolean).sort((a, b) => a.cost - b.cost || b.pw - a.pw), [ids, byId])
  const inDeck = useMemo(() => new Set(ids), [ids])
  const deckBy = useMemo(() => Object.fromEntries(cs.map(c => [c.n, c])), [cs])
  const syn = useMemo(() => { const m = {}; own.forEach(c => { m[c.id] = synRows(c, cs, pairs) }); cs.forEach(c => { if (!m[c.id]) m[c.id] = synRows(c, cs, pairs) }); return m }, [own, cs, pairs])
  const franchises = useMemo(() => { const m = {}; own.forEach(c => { m[c.fc] = (m[c.fc] || 0) + 1 }); return Object.entries(m).sort((a, b) => (E.NICK[a[0]] || a[0]).localeCompare(E.NICK[b[0]] || b[0])) }, [own])
  const abilities = useMemo(() => { const m = {}; own.forEach(c => c.ab.forEach(a => { m[a] = (m[a] || 0) + 1 })); return Object.entries(m).sort((a, b) => E.AB_ORDER.indexOf(a[0]) - E.AB_ORDER.indexOf(b[0])) }, [own])
  const synTotal = cs.reduce((s, c) => s + (syn[c.id]?.v || 0), 0)
  const dupNames = cs.length - new Set(cs.map(c => c.n)).size
  const full = cs.length >= 15
  const fF = focus && byId[focus.id] ? { ...focus, c: byId[focus.id] } : null

  let pool = own
  if (fF) pool = pool.filter(synMatch(fF.c, fF.lv))
  if (q) { const s = q.toLowerCase().trim(); pool = pool.filter(c => E.cleanName(c.n).toLowerCase().includes(s) || (E.NICK[c.fc] || '').toLowerCase().includes(s) || String(c.s).includes(s)) }
  if (frs.length) pool = pool.filter(c => frs.includes(c.fc))
  if (costs.length) pool = pool.filter(c => costs.includes(c.cost))
  if (abs.length) pool = pool.filter(c => abs.some(a => c.ab.includes(a)))
  if (fit) pool = pool.filter(c => !inDeck.has(c.id) && syn[c.id]?.v)
  if (!alt) pool = pool.filter(c => inDeck.has(c.id) || !deckBy[c.n])
  if (!showIn) pool = pool.filter(c => !inDeck.has(c.id))
  const [sk, sd] = sort
  const key = { cost: c => c.cost * 100 - c.pw, pw: c => c.pw * 100 - c.cost, gs: c => c.gs, syn: c => (syn[c.id]?.v || 0) * 100 + c.pw, date: c => Date.parse(c.d) || 0 }[sk]
  pool = pool.slice().sort((a, b) => (sk === 'name' ? E.lastName(a.n).localeCompare(E.lastName(b.n)) || a.cost - b.cost : key(a) - key(b)) * sd)
  const nf = frs.length + costs.length + abs.length + (fit ? 1 : 0) + (q ? 1 : 0) + (alt ? 0 : 1) + (showIn ? 0 : 1)

  useEffect(() => {
    const el = moreRef.current, root = gridRef.current
    if (!el || !root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(es => { if (es[0].isIntersecting) setMore(m => m + 60) }, { root, rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [pool.length > more, more])

  // Sizes: six cost columns across the tray; four cards a row in the binder (five on a wider screen)
  const colW = trayW ? (trayW - 20 - 5 * 6) / 6 : 56
  const tw = Math.max(36, Math.min(76, Math.floor(colW - 6)))
  const stackH = Math.round(tw * 1.4 * 1.8)
  const cols = gridW > 500 ? 5 : 4
  const gw = gridW ? Math.min(110, Math.floor((gridW - 24 - (cols - 1) * 8) / cols)) : 80

  const say = t => { setToast({ t, n: Date.now() }); setTimeout(() => setToast(x => (x && x.t === t ? null : x)), 1800) }
  const land = (id, v) => {
    setLanded(id); setPop({ id, t: v ? `+${v} synergy` : 'Added', n: Date.now() })
    setTimeout(() => { setLanded(x => (x === id ? null : x)); setPop(x => (x && x.id === id ? null : x)) }, 1300)
  }
  const add = id => {
    const c = byId[id], rest = cs.filter(o => o.n !== c.n)
    if (rest.length >= 15) { say('Take a card out first'); return }
    const from = bigRef.current?.getBoundingClientRect()
    const v = synRows(c, rest, pairs).v
    setIds(x => [...x.filter(z => byId[z]?.n !== c.n), id])
    setInsp(null)
    if (from && from.width && !reducedMotion()) setFly({ id, from, v }); else land(id, v)
  }
  const remove = id => {
    setIds(x => x.filter(z => z !== id)); setInsp(null); setBackId(id)
    say(`${E.lastName(byId[id].n)} ${yr(byId[id])} is out`)
    if (focus?.id === id) setFocus(null)
    setTimeout(() => setBackId(x => (x === id ? null : x)), 800)
  }
  // The card flies from the big view into its column, then the column lights up
  useLayoutEffect(() => {
    if (!fly) return
    const g = ghostRef.current, t = trayRef.current?.querySelector(`[data-k="${fly.id}"]`)
    if (!g || !t || !g.animate) { setFly(null); land(fly.id, fly.v); return }
    const a = fly.from, b = t.getBoundingClientRect(), s = b.width / a.width, dx = b.left - a.left, dy = b.top - a.top
    const anim = g.animate([
      { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'brightness(1)' },
      { transform: `translate(${dx * 0.2}px, ${dy * 0.2 - 36}px) scale(.78) rotate(-7deg)`, filter: 'brightness(1.3)', offset: 0.35 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(0deg)`, filter: 'brightness(1.8)' }
    ], { duration: 560, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' })
    const f = fly
    anim.onfinish = () => { setFly(null); land(f.id, f.v) }
  }, [fly])

  const open = id => setInsp({ id, dir: 0, n: (insp?.n || 0) + 1 })
  const nav = insp ? (pool.some(c => c.id === insp.id) ? pool : cs).map(c => c.id) : []
  const step = d => { if (!insp || !nav.length) return; const i = nav.indexOf(insp.id); setInsp({ id: nav[(i + d + nav.length) % nav.length], dir: d, n: insp.n + 1 }) }
  const back = () => (team ? go('frd', { fc: team }) : go('decks'))
  const tryBack = () => (ids.join(',') !== start.current ? setLeaving(true) : back())
  const save = async () => {
    if (cs.length !== 15) { say(`Add ${15 - cs.length} more`); return }
    if (dupNames) { say('One card per player'); return }
    const v = await C.clashDeck(team ? { team, ids } : { slot: scr.slot, name, ids })
    if (v) { setView(v); back() }
  }
  const tog = set => v => set(a => (a.includes(v) ? a.filter(x => x !== v) : [...a, v]))
  const clearAll = () => { setQ(''); setFrs([]); setCosts([]); setAbs([]); setFit(false); setAlt(true); setShowIn(true) }

  const ic = insp && byId[insp.id]
  return createPortal(<div className={`${styles.root} ${styles.bx}`}>
    <div className={styles.bxIn} style={team ? { '--c': E.COLOR[team] } : undefined}>
      <div className={styles.bxHead}>
        <button type="button" className={styles.bxIcon} onClick={tryBack} aria-label="Back"><Svg d="M15 5l-7 7 7 7" /></button>
        <div className={styles.bxPlate}>{team ? <h3>{E.NICK[team]} deck</h3> : <input value={name} maxLength={24} onChange={e => setName(e.target.value)} aria-label="Deck name" />}</div>
        <div className={styles.bxCount} data-full={full ? '' : undefined}><b>{cs.length}</b><small>/15</small></div>
      </div>
      <div className={styles.bxSegs} data-full={full ? '' : undefined} aria-hidden="true">{Array.from({ length: 15 }, (_, i) => <i key={i} data-on={i < cs.length ? '' : undefined} />)}</div>

      <div className={styles.bxTray} ref={trayRef} aria-label="Your deck, by energy cost">
        {[1, 2, 3, 4, 5, 6].map(k => {
          const col = cs.filter(c => c.cost === k), n = col.length, ch = tw * 1.4
          const off = n > 1 ? Math.min(tw * 0.5, (stackH - ch) / (n - 1)) : 0
          return <div key={k} className={styles.bxCol}>
            <div className={styles.bxColHead}><b>{k}</b><small>{n || ''}</small></div>
            <div className={styles.bxStack} style={{ height: stackH }}>
              {col.map((c, i) => <div key={c.id} data-k={c.id} className={`${styles.bxSlot} ${landed === c.id ? styles.bxLand : ''}`} style={{ top: i * off, zIndex: i + 1, visibility: fly?.id === c.id ? 'hidden' : undefined }}>
                <Chip c={c} side="p" w={tw} cost={c.cost} onClick={() => open(c.id)} label={`${E.cleanName(c.n)} ${yr(c)}, in your deck`} />
                {syn[c.id]?.v > 0 && <span className={styles.bxSynDot}>+{syn[c.id].v}</span>}
                {pop?.id === c.id && <span key={pop.n} className={styles.bxPop}>{pop.t}</span>}
              </div>)}
              {!n && <span className={styles.bxColEmpty}>{E.TIER_NAME[k]}</span>}
            </div>
          </div>
        })}
      </div>
      <div className={styles.bxRule} />

      <div className={styles.bxBar}>
        <span className={styles.bxShown}>{pool.length} card{pool.length === 1 ? '' : 's'}</span>
        <button type="button" className={styles.bxToggle} aria-pressed={alt} onClick={() => setAlt(v => !v)}>Other versions<i className={styles.bxSw} /></button>
        {fF && <div className={styles.bxFocus}><span>Synergy with <b>{E.lastName(fF.c.n)} {yr(fF.c)}</b> · {SYN_LV.find(l => l[0] === fF.lv)[1]} (+{SYN_LV.find(l => l[0] === fF.lv)[2]})</span>
          <button type="button" onClick={() => setFocus(null)} aria-label="Stop filtering to this card's synergies"><Svg d="M6 6l12 12M18 6L6 18" size={14} /></button></div>}
      </div>

      <div className={styles.bxGrid} ref={gridRef}>
        {!own.length && <p className={styles.bxNone}>{team ? `No ${E.NICK[team]} game cards in your binder yet. Team packs and Hang the Banner packs bring them.` : 'No game cards in your binder yet.'}</p>}
        {own.length > 0 && !pool.length && <p className={styles.bxNone}>No cards match. <button type="button" className={styles.bxLink} onClick={() => { clearAll(); setFocus(null) }}>Clear filters</button></p>}
        <div className={styles.bxCards} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {pool.slice(0, more).map(c => {
            const d = inDeck.has(c.id), twin = !d && deckBy[c.n], v = syn[c.id]?.v || 0
            return <div key={c.k} className={`${styles.bxCell} ${backId === c.id ? styles.bxRet : ''}`}>
              <Chip c={c} side="p" w={gw} cost={c.cost} onClick={() => open(c.id)} label={`${E.cleanName(c.n)}, ${fmtDate(c.d)}, cost ${c.cost}, power ${c.pw}${d ? ', in your deck' : twin ? `, would swap for his ${yr(twin)} card` : ''}`} />
              {d && <span className={styles.bxDim}><span>In deck</span></span>}
              {twin && <span className={styles.bxTag} data-k="swap">Swap {yr(twin)}</span>}
              {!d && !twin && v > 0 && <span className={styles.bxTag} data-k="fit" data-v={Math.min(3, v)}>▲ +{v}</span>}
            </div>
          })}
        </div>
        {pool.length > more && <div ref={moreRef} className={styles.bxMore}>More cards…</div>}
      </div>

      <button type="button" className={styles.bxFab} data-side="l" onClick={() => setDrawer('sort')} aria-label={`Sort cards, now by ${BSORTS.find(s => s[0] === sk)[1]}`}>
        <Svg d="M4 6h16M4 12h11M4 18h6M18 14v6m0 0l-3-3m3 3l3-3" size={22} w={2.6} /><span>{BSORT_SHORT[sk]}</span></button>
      <button type="button" className={styles.bxFab} data-side="r" onClick={() => setDrawer('filter')} aria-label={`Search and filters${nf ? `, ${nf} on` : ''}`}>
        <Svg d="M3 5h18l-7 8v6l-4 2v-8z" size={22} w={2.6} />{nf > 0 && <em>{nf}</em>}</button>

      <div className={styles.bxFoot}>
        <div className={styles.bxStat}><b>{avg(cs, c => c.cost)}</b><small>Avg cost</small></div>
        <div className={styles.bxStat}><b>{avg(cs, c => c.pw)}</b><small>Avg power</small></div>
        <div className={styles.bxStat} data-k="syn"><b>+{synTotal}</b><small>Synergy</small></div>
        <button type="button" className={styles.bxGo} data-ready={cs.length === 15 && !dupNames ? '' : undefined} onClick={save}>
          <span>{dupNames ? 'One per player' : cs.length === 15 ? 'Save deck' : `Add ${15 - cs.length} more`}</span></button>
      </div>

      {(drawer || leaving) && <button type="button" className={styles.bxScrim} aria-label="Close" onClick={() => { setDrawer(null); setLeaving(false) }} />}
      {drawer === 'sort' && <div className={styles.bxDrawer} data-side="l" role="dialog" aria-label="Sort cards">
        <div className={styles.bxDH}><span>Sort cards</span>
          <button type="button" className={styles.bxDir} onClick={() => setSort(([k, d]) => [k, -d])} aria-label={sd === 1 ? 'Low to high. Tap for high to low' : 'High to low. Tap for low to high'} style={{ transform: sd === 1 ? 'none' : 'rotate(180deg)' }}><Svg d="M12 4v16m0 0l-6-6m6 6l6-6" /></button></div>
        {BSORTS.map(([k, l, d0]) => <button key={k} type="button" className={styles.bxSortOpt} aria-pressed={sk === k} onClick={() => setSort(([k0, d]) => (k0 === k ? [k, -d] : [k, d0]))}>{l}</button>)}
        <div style={{ padding: '12px 14px 0' }}><button type="button" className={styles.bxDone} onClick={() => setDrawer(null)}>Close</button></div>
      </div>}
      {drawer === 'filter' && <div className={styles.bxDrawer} data-side="r" role="dialog" aria-label="Search and filters">
        <div className={styles.bxFBody}>
          <div className={styles.bxDH} style={{ padding: 0 }}><span>Search &amp; filters</span></div>
          <label className={styles.bxLab} htmlFor="bx-q">Player, team or season</label>
          <input id="bx-q" className={styles.bxSearch} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" />
          <button type="button" className={styles.bxRow} data-k="fit" aria-pressed={fit} disabled={!cs.length} onClick={() => setFit(v => !v)}>
            <span>Fits my deck<small>{cs.length ? `${own.filter(c => !inDeck.has(c.id) && syn[c.id]?.v).length} cards with a synergy` : 'Add a card first'}</small></span><i className={styles.bxSw} /></button>
          <button type="button" className={styles.bxRow} aria-pressed={alt} onClick={() => setAlt(v => !v)}>
            <span>Other versions<small>More cards of players already in your deck</small></span><i className={styles.bxSw} /></button>
          <button type="button" className={styles.bxRow} aria-pressed={showIn} onClick={() => setShowIn(v => !v)}>
            <span>Cards in my deck<small>Keep them in the list</small></span><i className={styles.bxSw} /></button>
          <span className={styles.bxLab}>Energy cost</span>
          <div className={styles.bxCosts}>{[1, 2, 3, 4, 5, 6].map(k => <button key={k} type="button" className={styles.bxCost} aria-pressed={costs.includes(k)} aria-label={`Cost ${k}, ${E.TIER_NAME[k]}`} onClick={() => tog(setCosts)(k)}>{k}</button>)}</div>
          <span className={styles.bxLab}>Abilities</span>
          <div className={styles.bxChips}>{abilities.map(([a, n]) => <button key={a} type="button" className={styles.bxChip} aria-pressed={abs.includes(a)} onClick={() => tog(setAbs)(a)}>
            <span className={styles.abTag} data-kind={AB_KIND[E.AB[a].k]}>{AB_MARK[a]}</span><span>{E.AB[a].n}</span><small>{n}</small></button>)}</div>
          {!team && <><span className={styles.bxLab}>Franchise</span>
            <div className={styles.bxChips}>{franchises.map(([f, n]) => <button key={f} type="button" className={styles.bxChip} aria-pressed={frs.includes(f)} onClick={() => tog(setFrs)(f)}>
              {binderLogo(f) ? <img src={binderLogo(f)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <i style={{ background: E.COLOR[f] }} />}<span>{E.NICK[f] || f}</span><small>{n}</small></button>)}</div></>}
        </div>
        <div className={styles.bxFFoot}>
          <button type="button" className={styles.bxClear} onClick={clearAll}><span>Clear</span></button>
          <button type="button" className={styles.bxShow} onClick={() => setDrawer(null)}><span>Show {pool.length} cards</span></button>
        </div>
      </div>}
      {leaving && <div className={styles.bxLeave} role="dialog" aria-label="Leave without saving?">
        <b>Leave without saving?</b><small>Your changes to this deck will be lost.</small>
        <div><button type="button" className={styles.bxDone} onClick={() => setLeaving(false)}>Keep building</button><button type="button" className={styles.bxClear} onClick={back}><span>Leave</span></button></div>
      </div>}

      {ic && <BigCard key="big" c={ic} n={insp.n} dir={insp.dir} bigRef={bigRef} cs={cs} own={own} pairs={pairs} inDeck={inDeck.has(ic.id)} twin={!inDeck.has(ic.id) && deckBy[ic.n]} full={full}
        rows={syn[ic.id] || synRows(ic, cs, pairs)} variants={own.filter(x => x.n === ic.n && x.id !== ic.id)} deckIds={inDeck}
        onStep={step} onPick={open} onClose={() => setInsp(null)} onAdd={() => add(ic.id)} onRemove={() => remove(ic.id)}
        onFocus={lv => { clearAll(); setFocus({ id: ic.id, lv }); setInsp(null); setDrawer(null) }} />}
      {fly && <div ref={ghostRef} className={styles.bxGhost} style={{ left: fly.from.left, top: fly.from.top }}><Chip c={byId[fly.id]} side="p" w={fly.from.width} cost={byId[fly.id].cost} /></div>}
      {toast && <div key={toast.n} className={styles.bxToast} role="status">{toast.t}</div>}
    </div>
  </div>, document.body)
}

// The big card view: swipe or use the arrows to move through the list, see what the card does and what it adds to the deck
function BigCard({ c, n, dir, bigRef, cs, own, inDeck, twin, full, rows, variants, deckIds, onStep, onPick, onClose, onAdd, onRemove, onFocus }) {
  const sw = useRef(null)
  const bw = Math.min(230, Math.round((typeof window !== 'undefined' ? window.innerWidth : 390) * 0.54))
  const stats = [[c.pts, 'PTS'], [c.reb, 'REB'], [c.ast, 'AST']]
  if (c.stl >= 3) stats.push([c.stl, 'STL']); if (c.blk >= 3) stats.push([c.blk, 'BLK']); if (c.tp >= 4) stats.push([c.tp, '3PM']); if (c.min != null) stats.push([c.min, 'MIN'])
  const counts = SYN_LV.map(([lv]) => own.filter(synMatch(c, lv)).length)
  let cta = 'Add to deck', act = onAdd, kind = 'go', sub = ''
  if (inDeck) { cta = 'Remove'; act = onRemove; kind = 'off' }
  else if (twin) { cta = 'Swap in'; sub = `Replaces his ${yr(twin)} card. A deck holds one card per player.` }
  else if (full) { cta = 'Deck full'; act = null; kind = 'off'; sub = 'Take a card out first.' }
  return <div className={styles.bxInsp} role="dialog" aria-label={`${E.cleanName(c.n)}, ${fmtDate(c.d)}`} style={{ '--ray': TIER_RAY[c.cost], '--tier': TIER_BG[c.cost] }}>
    <div className={styles.bxRays} aria-hidden="true" />
    <div className={styles.bxIScroll}>
      <div className={styles.bxTier}>{E.TIER_NAME[c.cost]} · {c.s}</div>
      <div className={styles.bxStage}
        onPointerDown={e => { sw.current = { x: e.clientX, y: e.clientY } }}
        onPointerUp={e => { const s = sw.current; sw.current = null; if (!s) return; const dx = e.clientX - s.x, dy = e.clientY - s.y; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) onStep(dx < 0 ? 1 : -1) }}
        onPointerCancel={() => { sw.current = null }}>
        <button type="button" className={styles.bxArrow} data-side="l" onClick={() => onStep(-1)} aria-label="Previous card"><Svg d="M15 5l-7 7 7 7" /></button>
        <div key={n} ref={bigRef} className={styles.bxBig} data-dir={dir}><Chip c={c} side="p" w={bw} cost={c.cost} onClick={() => {}} label={`${E.cleanName(c.n)}, cost ${c.cost}, power ${c.pw}`} /></div>
        <button type="button" className={styles.bxArrow} data-side="r" onClick={() => onStep(1)} aria-label="Next card"><Svg d="M9 5l7 7-7 7" /></button>
      </div>
      <div className={styles.bxGame}>{fmtDate(c.d)} · {gameLine(c)}</div>
      <div className={styles.bxStats}>{stats.map(([v, k]) => <span key={k}><b>{v}</b>{k}</span>)}<span><b>{c.gs}</b>GS</span></div>
      <div className={styles.bxIAbs}>{c.ab.length ? c.ab.map(a => <AbBadge key={a} a={a} c={c} big />) : <div className={styles.abTile} data-kind="none"><span className={styles.abMark}>—</span><div><b>No ability</b><p>Raw power: {c.pw}.</p></div></div>}</div>
      <div className={styles.bxSec}>
        <h4>{inDeck ? 'Synergy in this deck' : 'Synergy with this deck'}</h4>
        {rows.rows.length ? <><div className={styles.bxSynRows}>{rows.rows.map(r => <span key={r.t}><b>+{r.v}</b> {r.t} · {E.lastName(r.with.n)} {yr(r.with)}</span>)}</div><p className={styles.bxNoSyn}>Counts when they share a court.</p></>
          : <p className={styles.bxNoSyn}>{cs.length ? 'None with the cards in your deck yet.' : 'Add cards to see synergies.'}</p>}
      </div>
      {inDeck && <div className={styles.bxSec}>
        <h4>Find cards that pair with him</h4>
        <div className={styles.bxLv}>{SYN_LV.map(([lv, l, v], i) => <button key={lv} type="button" disabled={!counts[i]} onClick={() => onFocus(lv)}><b>{l} +{v}</b><small>{counts[i]} card{counts[i] === 1 ? '' : 's'}</small></button>)}</div>
      </div>}
      {variants.length > 0 && <div className={styles.bxSec}>
        <h4>His other cards</h4>
        <div className={styles.bxVars}>{variants.map(v => <div key={v.id}><Chip c={v} side="p" w={50} cost={v.cost} onClick={() => onPick(v.id)} label={`${E.cleanName(v.n)}, ${fmtDate(v.d)}${deckIds.has(v.id) ? ', in your deck' : ''}`} />{deckIds.has(v.id) && <span className={styles.bxTag} data-k="deck">Deck</span>}</div>)}</div>
      </div>}
    </div>
    <div className={styles.bxIFoot}>
      {sub && <div className={styles.bxSub}>{sub}</div>}
      <div className={styles.bxIBtns}>
        <button type="button" className={styles.bxX} onClick={onClose} aria-label="Close"><span><Svg d="M6 6l12 12M18 6L6 18" w={3.4} /></span></button>
        <button type="button" className={styles.bxCta} data-k={kind} disabled={!act} onClick={act || undefined}><span>{cta}</span></button>
      </div>
    </div>
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

// What a finished match earned, shown on the result screen
function RewardBlock({ M, go, env }) {
  const f = M.over, r = M.reward
  if (!f) return null
  const win = f.winner === 'p'
  const box = (k, body) => <div className="ar-reward" data-k={k}>{body}</div>
  if (!win) return box('none', <small>No reward this time. {M.mode === 'fr' ? 'The level stays open.' : 'Try another deck.'}</small>)
  if (r?.kind === 'daily') return r.card ? box('pull', <><span className="ar-rpull"><CardFace card={r.card.card} shots={env.shots} w={110} /></span><div><small>{E.TIER_NAME[E.TIER_COST[r.card.card.tier]]} pulled</small><b>{E.cleanName(r.card.card.row.n)}</b><em>It’s in your binder.</em></div></>)
    : box('none', <small>{r.already ? 'You already took today’s card for this level.' : 'No card was left to pull. Try again later.'}</small>)
  if (r?.kind === 'unlock') return box('unlock', <><b>{E.LEVEL_NAME[r.level]} is open</b><small>{r.level === 'brutal' ? 'Beat it for the franchise redesign.' : 'One step closer to Brutal.'}</small></>)
  if (r?.kind === 'redesign') return r.claimed ? box('none', <small>{E.NICK[r.fc]} beaten again. Your redesign is already claimed.</small>)
    : box('unlock', <><b>{E.NICK[r.fc]} redesign unlocked</b><small>Pick one card from the deck that just won and the look it wears for good.</small><button type="button" className="ar-again" onClick={() => go('claim', { fc: r.fc, ids: M.ids })}><span>Claim it</span></button></>)
  return box('none', <small>Beaten. No reward is set for the all-time lineups yet.</small>)
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
