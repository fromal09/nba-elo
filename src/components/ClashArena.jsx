import { useState, useEffect, useRef, useMemo, memo } from 'react'
import * as E from '../clash/engine.js'
import { Chip as RawChip, AbBadge, AbIcon, Floor } from './Clash.jsx'
import styles from './Clash.module.css'
import './ClashArena.css'

/*
 * Full Court Clash, the match: the arena under the lights. Drag cards onto courts, possession banners, courts that
 * tip off one by one, a full-screen reveal for every card scaled to its tier, a move for every ability, markers for
 * effects that keep working, court details, a CPU coach, and deck colors. The server plays each turn (api clashturn);
 * this screen plays its steps back.
 */
// Card faces are the heaviest thing on screen: only redraw one when what it shows changes
const Chip = memo(p => <RawChip {...p} />, (a, b) => a.c === b.c && a.pw === b.pw && a.w === b.w && a.side === b.side && a.cost === b.cost && a.label === b.label && a.cls === b.cls)

const RM = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
// Vibration: Android phones buzz in patterns; iPhones (Safari has no vibration API) get a light tick from a hidden
// switch, which is all iOS allows a web page. On by default; the match menu turns it off.
const HAPTIC_KEY = 'fcc-haptics'
const hapticsOn = () => { try { return localStorage.getItem(HAPTIC_KEY) !== 'off' } catch { return true } }
const BUZZ = { tap: [8], land: [14], big: [22, 40, 30], huge: [30, 45, 30, 45, 70], goat: [40, 50, 40, 50, 40, 50, 140], hit: [35], home: [16, 35, 16], fp: [24, 40, 24, 40, 24], win: [40, 60, 40, 60, 220], loss: [90] }
let tick = null
function buzz(k) {
  if (!hapticsOn()) return
  if (typeof navigator !== 'undefined' && navigator.vibrate) { try { navigator.vibrate(BUZZ[k] || BUZZ.tap) } catch { /* not allowed */ } return }
  try {
    if (!tick) { const l = document.createElement('label'), i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i); l.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none'; document.body.appendChild(l); tick = l }
    const n = k === 'goat' ? 4 : k === 'huge' || k === 'win' ? 3 : k === 'big' || k === 'fp' || k === 'home' ? 2 : 1
    for (let j = 0; j < n; j++) setTimeout(() => tick.click(), j * 110)
  } catch { /* no haptics here */ }
}
// The first match teaches itself: a few coach marks, then out of the way
const TUT_KEY = 'fcc-tutorial'
const TUT = [
  { at: '.ar-board', t: 'Win two of three', b: 'Three courts, six possessions. Each court tips off on possessions 1, 2 and 3 and shows its arena and rule. Win two to win the match.' },
  { at: '.ar-hand', t: 'Your hand', b: 'Drag a card onto a court, or tap it and pick one. Its cost is in the corner; its power is the big number.' },
  { at: '.ar-energy', t: 'Energy', b: 'You get one more each possession, and what you don’t spend carries over. Watch it drain as you set cards down.' },
  { at: '.ar-arrow', t: 'Possession arrow', b: 'A jump ball decides who reveals first, then the arrow switches every possession. Revealing second lets you react.' },
  { at: '.ar-end', t: 'End the turn', b: 'Both sides commit face down, then the cards reveal one at a time.' },
  { at: '.ar-fp', t: 'Franchise power', b: 'Each possession, pick one power from the franchises you played. It fires when that team’s card is revealed.', when: 'fp' },
  { at: '.ar-board', t: 'Tap for details', b: 'Tap any card for its abilities, or a court for its rule and everything active there. Home Court: +3 for a card from a home game played in that building.', when: 'reveal' },
]
const sleep = ms => new Promise(r => setTimeout(r, RM ? Math.min(ms, 120) : ms))
const CURVE = { 1: 4, 2: 3, 3: 3, 4: 2, 5: 2, 6: 1 }
// Basketball words for each ability when it fires
const CALL = {
  fifty: ['FIFTY BALL', '#ff6a1f'], quad: ['QUAD-DUB', '#ffd36b'], triple: ['TRIP-DUB', '#ffd36b'], swat: ['REJECTED', '#ff3b5c'], pick: ['STOLEN', '#ffd36b'],
  floor: ['DIME', '#5aadff'], glass: ['BOARD MAN', '#7cf29a'], splash: ['SPLASH', '#3ec8ff'], perfect: ['PERFECT', '#e6d3ff'], charity: ['AND ONE', '#ffd36b'],
  iron: ['IRON MAN', '#c9d6e6'], ot: ['OVERTIME', '#b58cff'], home: ['HOME COURT', '#ff9a6b'], blowout: ['BLOWOUT', '#ff6a1f'], clutch: ['CLUTCH', '#b58cff'],
  heat: ['HEAT CHECK', '#ff5a36'], debut: ['DEBUT', '#7cf29a'], micro: ['MICROWAVE', '#ff9a6b'], sure: ['SURE HANDS', '#7cf29a']
}
export const SCHEMES = [
  { id: 'royal', n: 'Royal', a: '#4f9dff', ink: '#06142b' }, { id: 'crimson', n: 'Crimson', a: '#ff4d5e', ink: '#2a0508' },
  { id: 'emerald', n: 'Emerald', a: '#2fd27a', ink: '#04210f' }, { id: 'gold', n: 'Gold', a: '#ffc93c', ink: '#2a1d00' },
  { id: 'violet', n: 'Violet', a: '#a77bff', ink: '#150833' }, { id: 'teal', n: 'Teal', a: '#22d3c5', ink: '#032522' },
  { id: 'orange', n: 'Orange', a: '#ff8a3a', ink: '#2a1000' }, { id: 'silver', n: 'Silver', a: '#c9d3df', ink: '#0b1626' }
]
export const COACHES = ['Coach Fastbreak', 'Coach Hardwood', 'Coach Iso', 'Coach Pivot', 'Coach Zone']
const TAUNT = ['Put that on the jumbotron.', 'Too small, too slow.', 'That’s a bucket.', 'Check the scoreboard.', 'We run this floor.', 'Get that weak stuff out of here.']
const REACT = ['Lucky bounce.', 'Somebody guard him!', 'We’ll answer that.', 'Okay, okay. I see you.', 'Timeout! …just kidding.', 'That won’t happen twice.']
export const any = a => a[Math.floor(Math.random() * a.length)]
// How long each tier holds the spotlight: a Common is in and out, a GOAT gets the whole arena
const REVEAL_MS = [0, 520, 700, 900, 1150, 1500, 2300]
const TIER_WORD = ['', '', 'Rare', 'Standout', 'Legend', 'Icon', 'G.O.A.T.']
const FXC = { up: '#7cf29a', down: '#ff5a6e', good: '#9fe3ff' }
const ONGOING = ['quad', 'triple', 'glass', 'perfect', 'sure', 'clutch', 'ot', 'heat', 'debut', 'micro', 'iron', 'charity']
const parseFx = f => { const m = /^([+-]\d+)\s+(.*)$/.exec(f.t || ''); return m ? { v: +m[1], why: m[2] } : { v: 0, why: f.t || '' } }
const fxKind = why => (/Swat/.test(why) ? 'swat' : /Pickpocket/.test(why) ? 'pick' : /Floor General/.test(why) ? 'floor' : /Splash/.test(why) ? 'splash' : /Charity/.test(why) ? 'charity'
  : /Iron/.test(why) ? 'iron' : /Blowout/.test(why) ? 'blowout' : /Fifty/.test(why) ? 'fifty' : /Protected/.test(why) ? 'shield' : 'generic')
// A court total that counts up or down to its new value
function Tot({ v, side, lead }) {
  const [d, setD] = useState(v), prev = useRef(v)
  useEffect(() => {
    const a = prev.current, b = v; prev.current = v
    if (a === b || RM) { setD(b); return }
    const t0 = performance.now(), dur = 420; let raf
    const tick = t => { const k = Math.min(1, (t - t0) / dur); setD(Math.round(a + (b - a) * k)); if (k < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [v])
  return <div className="ar-tot" data-s={side} data-lead={lead ? '' : undefined}><b key={side + v} data-dir={v > prev.current ? 'up' : undefined}>{d}</b></div>
}
export function ColorPick({ you, setYou, start, deckName = 'Your deck' }) {
  const s = SCHEMES.find(x => x.id === you)
  return <div className={`${styles.root} ar`} style={{ '--you': s.a, '--youInk': s.ink }}>
    <div className="ar-bg" aria-hidden="true"><i /><i /><i /></div>
    <div className="ar-pick">
      <small>Deck colors</small>
      <h1>Your colors</h1>
      <p>They paint your side of the floor: your plate, your card glow, your power numbers and your big reveals. The CPU coach draws a different set every match.</p>
      <div className="ar-sw" role="radiogroup" aria-label="Deck colors">{SCHEMES.map(x => <button key={x.id} type="button" role="radio" aria-checked={x.id === you} onClick={() => setYou(x.id)} style={{ '--c': x.a }}><i /><span>{x.n}</span></button>)}</div>
      <div className="ar-preview"><div className="ar-plate" data-side="p"><span className="ar-av">YOU</span><b>{deckName}</b></div><span className="ar-pv-tot">14</span></div>
      <button type="button" className="ar-again" onClick={start}><span>Save colors</span></button>
    </div>
  </div>
}

// Markers for what keeps working on a card or court
const ICON = {
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z', end: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z', line: 'M4 12h16M14 6l6 6-6 6', proc: 'M4 18l6-6 4 4 6-8', glass: 'M4 4h16v12H4zM9 9h6v5H9z', sure: 'M7 11V5a1.5 1.5 0 0 1 3 0v6M10 10V4a1.5 1.5 0 0 1 3 0v6M13 10V5a1.5 1.5 0 0 1 3 0v8c0 4-2 7-6 7s-6-3-6-6l-1-3a1.5 1.5 0 0 1 3-1l1 2'
}
const Ic = ({ k }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[k]} /></svg>
const Marks = memo(({ o }) => (o && o.m.length ? <span className="ar-marks">{o.m.map(m => <i key={m.k} className="ar-mk" data-k={m.k} title={m.d || m.t} style={m.c ? { '--mc': m.c } : undefined}>{ICON[m.k] ? <Ic k={m.k} /> : m.t}</i>)}</span> : null))

export function ArenaMatch({ view0, turn, again, you, opp, coach, menu, label, deckName, onOver, reward }) {
  const st = useRef(null), nextRef = useRef(null)
  if (!st.current) st.current = E.fromPublic(view0)
  const S = st.current
  const root = useRef(null)
  const [, force] = useState(0)
  const [view, setView] = useState(() => E.board(S))
  const [hand, setHand] = useState(() => S.hand.p.slice())
  const [oppHand, setOppHand] = useState(S.handC ?? 0)
  const [staged, setStaged] = useState([])
  const [pend, setPend] = useState([])
  const [phase, setPhase] = useState(() => (S.turn === 1 && !S.locs.some(L => L.p.length || L.c.length) ? 'jump' : 'banner'))
  const [jump, setJump] = useState(null)
  const [tut, setTut] = useState(() => { try { return localStorage.getItem(TUT_KEY) === 'done' ? null : { i: 0 } } catch { return null } })
  const [tutBox, setTutBox] = useState(null)
  const [sheet, setSheet] = useState(false)
  const [hap, setHap] = useState(hapticsOn())
  const [gain, setGain] = useState(null)
  const [fpSel, setFpSel] = useState(null)
  const [fpShow, setFpShow] = useState(null)
  const swings = useRef([])
  const [banner, setBanner] = useState(null)
  const [flipLi, setFlipLi] = useState(null)
  const [shown, setShown] = useState(() => S.locs.map((L, li) => L.revealed && li < S.turn - 1))
  const [callout, setCallout] = useState(null)
  const [drag, setDrag] = useState(null)
  const [detail, setDetail] = useState(null)
  const [incoming, setIncoming] = useState(null)
  const [big, setBig] = useState(null)
  const [landed, setLanded] = useState(null)
  const [fx, setFx] = useState([])
  const [shake, setShake] = useState(0)
  const [flash, setFlash] = useState(0)
  const [fast, setFast] = useState(false)
  const fastRef = useRef(false)
  const [energy, setEnergy] = useState(S.energy.p)
  const [ruleHit, setRuleHit] = useState(null)
  const [quip, setQuip] = useState(null)
  const [bigFly, setBigFly] = useState(null)
  const [courtInfo, setCourtInfo] = useState(null)
  const [ca, setCa] = useState({})
  const bigRef = useRef(null), inRef = useRef(null)
  const viewRef = useRef(view)
  const showView = b => { viewRef.current = b; setView(b) }
  // Show a board where some cards keep their old power for now
  const holdBoard = (b, tgt) => {
    if (!tgt.size) return b
    const pp = {}; viewRef.current.forEach(L => ['p', 'c'].forEach(sd => L[sd].forEach(i => { pp[i.u] = i.pw })))
    return b.map(L => { const o = { ...L, t: { ...L.t } }; ['p', 'c'].forEach(sd => { o[sd] = L[sd].map(i => { if (tgt.has(i.u) && pp[i.u] != null) { o.t[sd] += pp[i.u] - i.pw; return { ...i, pw: pp[i.u] } } return i }) }); return o })
  }
  const cardAnim = (u, k, ms, vars) => { const n = Date.now() + Math.random(); setCa(m => ({ ...m, [u]: { k, n, vars } })); setTimeout(() => setCa(m => (m[u] && m[u].n === n ? (({ [u]: _, ...r }) => r)(m) : m)), ms) }
  useEffect(() => { if (shake && inRef.current?.animate && !RM) inRef.current.animate([{ transform: 'none' }, { transform: 'translate(-5px, 3px)' }, { transform: 'translate(5px, -3px)' }, { transform: 'translate(-4px, -2px)' }, { transform: 'translate(3px, 2px)' }, { transform: 'none' }], { duration: 320, easing: 'ease-out' }) }, [shake])
  const [W, setW] = useState(390)
  useEffect(() => { const f = () => setW(Math.min(480, window.innerWidth)); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const wait = ms => sleep(fastRef.current ? ms * 0.35 : ms)

  const spent = staged.reduce((s, x) => s + E.costOf(S, S.cards[x.k], x.li), 0)
  const left = energy - spent
  const perLi = li => staged.filter(x => x.li === li).length
  const canDrop = (k, li) => phase === 'plan' && li != null && E.canPlayAt(S, 'p', li, perLi(li)) && E.costOf(S, S.cards[k], li) <= left
  const colW = (W - 16 - 16) / 3
  const sw = Math.floor((colW - 8) / 2)
  const hw = Math.min(92, Math.floor((W - 24) / 4.2))

  // Where something is on screen, relative to the game
  const rel = sel => { const el = root.current?.querySelector(sel), r0 = root.current?.getBoundingClientRect(); if (!el || !r0) return null; const r = el.getBoundingClientRect(); return { x: r.left - r0.left + r.width / 2, y: r.top - r0.top + r.height / 2, w: r.width, h: r.height } }
  const box = () => root.current?.getBoundingClientRect() || { width: W, height: 844 }
  const cx = x => Math.max(62, Math.min(box().width - 62, x))
  const cy = y => Math.max(56, Math.min(box().height - 80, y))
  const talk = t => { const n = Date.now(); setQuip({ t, n }); setTimeout(() => setQuip(q => (q && q.n === n ? null : q)), 2200) }
  const hitRule = (li, txt) => { const n = Date.now() + li; setRuleHit(r => ({ ...(r || {}), [li]: { t: txt, n } })); setTimeout(() => setRuleHit(r => { if (!r || !r[li] || r[li].n !== n) return r; const o = { ...r }; delete o[li]; return o }), 1500) }
  const addFx = (o, ms = 1300) => { const id = Math.random().toString(36).slice(2); setFx(a => [...a, { ...o, id }]); setTimeout(() => setFx(a => a.filter(x => x.id !== id)), ms) }

  // The opening tip: a jump ball decides who reveals first on possession 1; the possession arrow alternates after that
  useEffect(() => { if (phase === 'jump') jumpBall() }, [phase])
  async function jumpBall() {
    const w = S.first || 'p'
    setJump({ w, step: 0, n: Date.now() })
    await wait(900); setJump(j => j && { ...j, step: 1 })
    await wait(1100); setJump(j => j && { ...j, step: 2 })
    await wait(1500); setJump(null)
    setPhase('banner')
  }
  const firstSide = E.firstThisTurn(S)
  // The tutorial: steps wait for their moment (the power bar showing up, the first reveal), then point at what they explain
  const tutStep = tut ? TUT[tut.i] : null
  const tutReady = tutStep && phase === 'plan' && (!tutStep.when || (tutStep.when === 'fp' ? E.fpChoices(staged.map(x => S.cards[x.k])).length > 0 : S.turn >= 2))
  useEffect(() => {
    if (!tutReady) { setTutBox(null); return }
    const f = () => { const r = rel(tutStep.at); if (r) setTutBox(r) }
    const id = setTimeout(f, 60); window.addEventListener('resize', f)
    return () => { clearTimeout(id); window.removeEventListener('resize', f) }
  }, [tutReady, tut?.i, staged.length])
  const tutNext = () => { const i = tut.i + 1; if (i >= TUT.length) { setTut(null); try { localStorage.setItem(TUT_KEY, 'done') } catch { /* private */ } } else setTut({ i }) }
  const tutSkip = () => { setTut(null); try { localStorage.setItem(TUT_KEY, 'done') } catch { /* private */ } }
  // Start of each turn: the banner, then the next court tips off
  useEffect(() => { if (phase === 'banner') startTurn() }, [phase])
  async function startTurn() {
    const t = S.turn
    setBanner({ t, n: Date.now() })
    await wait(1250)
    setBanner(null)
    if (t <= 3 && !st.current.locs[t - 1].shownOnce) {
      const li = t - 1
      st.current.locs[li].shownOnce = true
      setFlipLi(li)
      await wait(380)
      setShown(s => s.map((v, i) => (i === li ? true : v)))
      await wait(420)
      setFlipLi(null)
      const L = E.LOCBY[S.locs[li].id]
      const cp = rel(`[data-courtbox="${li}"]`), half = Math.min(130, box().width * 0.35)
      setCallout({ li, name: L.name, rule: L.rule, fx: L.fx, n: Date.now(), x: cp ? Math.max(half + 8, Math.min(box().width - half - 8, cp.x)) : box().width / 2, y: cp ? cp.y + 50 : 300 })
      await wait(1900)
      setCallout(null)
    }
    setShown(S.locs.map((L, li) => L.revealed)); setHand(S.hand.p.slice()); setOppHand(S.handC ?? 0); setStaged([]); setFpSel(null)
    setEnergy(e0 => { const d = S.energy.p - (phase === 'jump' ? 0 : e0); if (S.energy.p > e0) setGain({ v: S.energy.p - e0, n: Date.now() }); return S.energy.p })
    setPhase('plan')
  }

  async function endTurn() {
    if (phase !== 'plan') return
    setPhase('play'); setDetail(null)
    const plays = staged.slice(), fp = fpNow
    setPend(plays); setStaged([]); setHand(h => h.filter(k => !plays.some(x => x.k === k)))
    // The server plays the turn; its steps come back to play out here
    const d = await turn(plays, fp)
    if (!d) { setPend([]); setStaged(plays); setHand(S.hand.p.slice()); setPhase('plan'); return }
    S.cards = { ...S.cards, ...d.view.cards }
    const next = E.fromPublic({ ...d.view, cards: { ...S.cards, ...d.view.cards } })
    next.over = d.over || null
    nextRef.current = next
    const steps = d.steps
    const cpuN = steps.filter(s => s.side === 'c').length
    setOppHand(n => Math.max(0, n - cpuN))
    await wait(350)
    for (const s of steps) {
      if (s.end) { await endStep(s); continue }
      const c = S.cards[s.k]
      if (s.skip) { setPend(a => a.filter(x => x.k !== s.k)); continue }
      if (s.side === 'c') { setIncoming({ k: s.k, li: s.li, n: Date.now() }); await wait(480) }
      // The full-screen moment, then the card drops into its slot
      setBig({ k: s.k, side: s.side, n: Date.now() })
      buzz(c.cost >= 6 ? 'goat' : c.cost >= 5 ? 'huge' : c.cost >= 4 ? 'big' : 'tap')
      if (c.cost >= 5) setTimeout(() => setFlash(f => f + 1), c.cost >= 6 ? 700 : 250)
      if (c.cost >= 4) setTimeout(() => setShake(k => k + (c.cost >= 6 ? 3 : 1)), c.cost >= 6 ? 900 : 350)
      await wait(REVEAL_MS[c.cost] + (c.ab.length ? 250 : 0))
      const dest = rel(s.side === 'p' ? `[data-pk="${s.k}"]` : '[data-in]'), bc = bigRef.current?.getBoundingClientRect(), r0 = root.current?.getBoundingClientRect()
      if (dest && bc && r0 && !RM) {
        setBigFly({ x: dest.x - (bc.left - r0.left + bc.width / 2), y: dest.y - (bc.top - r0.top + bc.height / 2), s: dest.w / bc.width })
        await wait(300)
      }
      setBig(null); setBigFly(null)
      setIncoming(null)
      setPend(a => a.filter(x => x.k !== s.k))
      const before = viewRef.current[s.li]?.t
      // A franchise power: its plate slides across in the team's colors before its effects land
      if (s.fp && E.FP[s.fp]) { buzz('fp'); setFpShow({ fc: s.fp, side: s.side, n: Date.now() }); await wait(1500); setFpShow(null) }
      // Effects that hit other cards play out before those cards show their new power
      const all = (s.fx || []).map(f => ({ ...f, ...parseFx(f) }))
      const others = all.filter(f => f.u !== s.u)
      const held = holdBoard(s.board, new Set(others.map(f => f.u)))
      showView(held); setLanded(s.u)
      await wait(30)
      const at = rel(`[data-u="${s.u}"]`)
      if (at) addFx({ kind: 'slam', x: at.x, y: at.y, c: s.side === 'p' ? 'var(--you)' : 'var(--opp)', big: c.cost >= 4, tier: c.cost }, 900)
      buzz(others.some(f => f.v < 0 && S.locs[s.li]) ? 'hit' : 'land')
      if (c.cost >= 2) setShake(k => k + (c.cost >= 5 ? 3 : c.cost >= 4 ? 2 : 1))
      await wait(200)
      await abilityShow(s, c, at, all, others)
      showView(s.board)
      const LL = E.LOCBY[nextRef.current.locs[s.li].id]
      const N = nextRef.current, inst = N.locs[s.li][s.side].find(i => i.u === s.u)
      let locRow = null
      try { locRow = inst ? E.breakdown(N, inst).rows.find(r => r[2] === 'loc') : null } catch { locRow = null }
      if (locRow || all.some(f => f.why.includes(LL.rule))) { hitRule(s.li, `${LL.rule}${locRow ? ` ${locRow[0] > 0 ? '+' : ''}${locRow[0]}` : ''}`); if (at) cardAnim(s.u, 'catch', 600) }
      if (s.side === 'c' && (c.cost >= 4 || others.length)) setTimeout(() => talk(any(TAUNT)), 200)
      else if (s.side === 'p' && (c.cost >= 5 || others.some(f => f.v < 0))) setTimeout(() => talk(any(REACT)), 200)
      await wait(locRow ? 900 : 380)
      setLanded(null)
      if (before && s.board[s.li]) { const o = s.side === 'p' ? 'c' : 'p', d = (s.board[s.li].t[s.side] - before[s.side]) - (s.board[s.li].t[o] - before[o]); swings.current.push({ k: s.k, side: s.side, li: s.li, d, fp: s.fp || null }) }
    }
    setPend([])
    st.current = next
    if (next.over) { await wait(500); setPhase('over'); onOver?.(d); return }
    setPhase('banner')
  }

  // Each ability gets its own move
  async function abilityShow(s, c, at, all, others) {
    if (!at) return
    const opp = s.side === 'p' ? 'c' : 'p'
    const kinds = new Set(all.map(f => fxKind(f.why)))
    const fired = c.ab.find(a => kinds.has(a)) || c.ab.find(a => ONGOING.includes(a))
    const stamp = (a, x, y) => { const [w, col] = CALL[a] || [E.AB[a]?.n || a, '#fff']; addFx({ kind: 'call', x: cx(x), y: cy(y), t: w, c: col }, 1500) }
    const pos = u => rel(`[data-u="${u}"]`)
    const float = (f, dy = 0) => { const p = pos(f.u); if (p) addFx({ kind: 'float', x: cx(p.x), y: cy(p.y - 30 - dy), t: f.t, c: FXC[f.c] || '#fff' }) }
    if (kinds.has('swat')) {
      const f = others.find(x => x.kind === 'swat' || fxKind(x.why) === 'swat'), p = f && pos(f.u)
      if (p) {
        cardAnim(s.u, 'lunge', 520, { '--dx': `${(p.x - at.x) * 0.45}px`, '--dy': `${(p.y - at.y) * 0.45}px` })
        await wait(200)
        addFx({ kind: 'slash', x: p.x, y: p.y }, 700)
        cardAnim(f.u, 'swatted', 1250, { '--sx': `${p.x > W / 2 ? 1 : -1}` })
        addFx({ kind: 'ball', x1: p.x, y1: p.y, x2: p.x > W / 2 ? W + 40 : -40, y2: p.y - 220, arc: 40, d: 600 }, 700)
        setShake(k => k + 2)
        stamp('swat', p.x, p.y - p.h * 0.75)
        await wait(950)
        showView(s.board); float(f)
        await wait(450)
      }
    } else if (kinds.has('pick')) {
      const f = others.find(x => fxKind(x.why) === 'pick'), p = f && pos(f.u)
      if (p) {
        cardAnim(s.u, 'lunge', 420, { '--dx': `${(p.x - at.x) * 0.3}px`, '--dy': `${(p.y - at.y) * 0.3}px` })
        await wait(180)
        cardAnim(f.u, 'robbed', 800, { '--dx': `${(at.x - p.x) * 0.12}px`, '--dy': `${(at.y - p.y) * 0.12}px` })
        addFx({ kind: 'orb', x1: p.x, y1: p.y, x2: at.x, y2: at.y, arc: 50, d: 520 }, 600)
        stamp('pick', p.x, p.y - p.h * 0.75)
        await wait(520)
        cardAnim(s.u, 'gain', 600)
        showView(s.board); float(f); all.filter(x => x.u === s.u).forEach(x => float(x, 16))
        await wait(600)
      }
    } else if (kinds.has('floor') || kinds.has('splash')) {
      const sp = kinds.has('splash'), list = others.filter(x => fxKind(x.why) === (sp ? 'splash' : 'floor'))
      if (sp) addFx({ kind: 'wave', c: CALL.splash[1] }, 1300)
      stamp(sp ? 'splash' : 'floor', at.x, at.y - at.h * 0.75)
      cardAnim(s.u, 'toss', 500)
      list.forEach((f, i) => setTimeout(() => {
        const p = pos(f.u); if (!p) return
        addFx({ kind: 'ball', x1: at.x, y1: at.y - 10, x2: p.x, y2: p.y, arc: sp ? 150 : 60, d: sp ? 620 : 420 }, 800)
        setTimeout(() => { cardAnim(f.u, 'catch', 600); if (sp) addFx({ kind: 'swish', x: p.x, y: p.y }, 700); float(f) }, sp ? 620 : 420)
      }, 120 + i * 170))
      await wait(250 + list.length * 170 + (sp ? 700 : 500))
      showView(s.board)
      await wait(250)
    } else if (kinds.has('blowout') || kinds.has('fifty')) {
      const a = kinds.has('fifty') ? 'fifty' : 'blowout'
      if (a === 'fifty') { addFx({ kind: 'fire', x: at.x, y: at.y, w: at.w, h: at.h }, 1500); addFx({ kind: 'digits', x: cx(at.x), y: cy(at.y - at.h), t: String(c.pts) }, 1400); cardAnim(s.u, 'heat', 1200) }
      else { addFx({ kind: 'dust', x: at.x, y: at.y + at.h / 2 }, 900); setShake(k => k + 2); cardAnim(s.u, 'stomp', 700) }
      stamp(a, at.x, at.y - at.h * 0.8)
      await wait(400); all.forEach(f => float(f)); await wait(700)
    } else if (fired) {
      stamp(fired, at.x, at.y - at.h * 0.75)
      if (fired === 'glass') { const b = rel(`[data-sidebox="${s.li}-${s.side}"]`); if (b) addFx({ kind: 'glass', x: b.x, y: b.y, w: b.w, h: b.h }, 1500) }
      else if (fired === 'home') { const b = rel(`[data-courtbox="${s.li}"]`); if (b) addFx({ kind: 'courtglow', x: b.x, y: b.y, w: b.w, h: b.h, c: E.COLOR[c.fc] || '#ffd36b' }, 1300); setFlash(f => f + 1) }
      else if (fired === 'quad' || fired === 'triple') { addFx({ kind: 'aura', x: at.x, y: at.y }, 1100); nextRef.current.locs[s.li][s.side].forEach(i => { if (i.u !== s.u) cardAnim(i.u, 'catch', 600) }) }
      else if (fired === 'perfect' || fired === 'sure') cardAnim(s.u, 'shine', 900)
      else if (fired === 'clutch' || fired === 'ot' || fired === 'heat') { const b = rel(`[data-courtbox="${s.li}"]`); if (b) addFx({ kind: 'buzzer', x: b.x, y: b.y, w: b.w, h: b.h }, 1200) }
      else cardAnim(s.u, 'shine', 900)
      await wait(300); all.forEach(f => float(f)); await wait(650)
    } else if (all.length) {
      others.forEach(f => { const p = pos(f.u); if (p) addFx({ kind: 'beam', x1: at.x, y1: at.y, x2: p.x, y2: p.y, c: FXC[f.c] || '#ffd36b' }, 1000) })
      await wait(300); all.forEach(f => float(f)); await wait(500)
    }
    // Home Court: a card from a home game, in the building it was played in. Fires on its own, whatever else the card does
    { const LD = E.LOCBY[nextRef.current.locs[s.li]?.id]; if (LD && !LD.noHome && E.homeAt(LD, c)) { const b = rel(`[data-courtbox="${s.li}"]`); if (b) addFx({ kind: 'courtglow', x: b.x, y: b.y, w: b.w, h: b.h, c: E.COLOR[c.fc] || '#ffd36b' }, 1300); stamp('home', at.x, at.y - at.h * 0.95); setFlash(f => f + 1); buzz('home'); await wait(700) } }
    // Charity Stripe fires on the other side: a free throw for that card
    all.filter(f => fxKind(f.why) === 'charity').forEach(f => { const p = pos(f.u); if (p) { addFx({ kind: 'hoop', x: cx(p.x), y: cy(p.y - p.h * 0.9) }, 1000); addFx({ kind: 'ball', x1: p.x, y1: p.y, x2: p.x, y2: p.y - p.h * 0.9, arc: 40, d: 450 }, 600); setTimeout(() => { addFx({ kind: 'call', x: cx(p.x), y: cy(p.y - p.h * 1.2), t: CALL.charity[0], c: CALL.charity[1] }, 1300); float(f) }, 450) } })
    all.filter(f => fxKind(f.why) === 'shield').forEach(f => { cardAnim(f.u, 'shield', 900); float(f) })
  }

  async function endStep(s) {
    const all = (s.fx || []).map(f => ({ ...f, ...parseFx(f) }))
    S.locs.forEach((L, li) => { const LL = E.LOCBY[L.id]; if (LL.rule && all.some(f => f.why.includes(LL.rule))) hitRule(li, LL.rule) })
    all.forEach((f, i) => setTimeout(() => {
      const p = rel(`[data-u="${f.u}"]`); if (!p) return
      cardAnim(f.u, fxKind(f.why) === 'iron' ? 'iron' : f.v < 0 ? 'hurt' : 'catch', 700)
      addFx({ kind: 'float', x: cx(p.x), y: cy(p.y - 30), t: f.t, c: FXC[f.c] || '#fff' })
    }, i * 90))
    await wait(all.length ? 300 + all.length * 90 : 0)
    showView(s.board)
    await wait(all.length ? 700 : 200)
  }

  // What keeps working on the board: shown on the cards and courts for as long as it lasts
  const ongoing = li => {
    const V = view[li], LL = shown[li] ? E.LOCBY[S.locs[li].id] : null, out = { p: {}, c: {}, side: { p: [], c: [] }, court: [] }
    ;['p', 'c'].forEach(sd => {
      const list = V[sd], cards = list.map(i => S.cards[i.k])
      const glass = cards.find(c => c.ab.includes('glass')), sure = cards.find(c => c.ab.includes('sure'))
      const auraSrc = list.filter(i => S.cards[i.k].ab.some(a => a === 'quad' || a === 'triple'))
      if (glass) out.side[sd].push({ k: 'glass', t: `Glass Cleaner (${E.lastName(glass.n)}): these cards can’t lose power` })
      if (sure) out.side[sd].push({ k: 'sure', t: `Sure Hands (${E.lastName(sure.n)}): nothing can be stolen here` })
      list.forEach(i => {
        const c = S.cards[i.k], m = []
        if (c.ab.includes('perfect') || glass) m.push({ k: 'shield', t: c.ab.includes('perfect') ? 'Perfect Night: can’t lose power' : 'Protected by Glass Cleaner' })
        const boost = auraSrc.filter(s => s.u !== i.u).reduce((a, s) => a + (S.cards[s.k].ab.includes('quad') ? 2 : 1), 0)
        if (boost) m.push({ k: 'aura', t: `+${boost}`, d: `Getting +${boost} from a triple- or quad-double here` })
        if (LL && !LL.noHome && E.homeAt(LL, c)) m.push({ k: 'home', t: '+3', d: `Home Court: +3, a home game played in ${LL.name}`, c: E.COLOR[c.fc] })
        let lr = null; try { const inst = S.locs[li][sd].find(x => x.u === i.u); lr = inst && E.breakdown(S, inst).rows.find(r => r[2] === 'loc') } catch { lr = null }
        if (lr) m.push({ k: 'rule', t: `${lr[0] > 0 ? '+' : ''}${lr[0]}`, d: `${LL ? LL.rule : 'Court'}: ${lr[0] > 0 ? '+' : ''}${lr[0]}` })
        if (c.ab.some(a => a === 'clutch' || a === 'ot' || a === 'heat')) m.push({ k: 'end', t: 'End', d: 'Waits for the final buzzer' })
        if (c.ab.includes('iron')) m.push({ k: 'iron', t: '+1', d: 'Iron Man: +1 at the end of each possession' })
        if (c.ab.includes('charity')) m.push({ k: 'ft', t: 'FT', d: 'Charity Stripe: +1 each time the other side plays here' })
        const inst0 = S.locs[li]?.[sd]?.find(x => x.u === i.u)
        if (inst0?.guard && !m.some(x => x.k === 'shield')) m.push({ k: 'shield', t: 'Fadeaway: can’t lose power' })
        if (inst0?.proc > 0) m.push({ k: 'proc', t: `+${inst0.proc}`, d: `The Process: +1 at the end of each turn, ${inst0.proc} more` })
        out[sd][i.u] = { m, aura: auraSrc.some(s => s.u === i.u) }
      })
    })
    const F = S.locs[li]?.f || {}
    ;['p', 'c'].forEach(sd => { if (F.culture?.[sd]) out.side[sd].push({ k: 'shield', t: 'Heat Culture: these cards can’t lose power' }); if (F.line?.[sd]) out.side[sd].push({ k: 'line', t: `Second Line: the next card played here gets +${F.line[sd]}` }) })
    if (V.f?.lock) out.court.push({ k: 'lock', t: 'Locked: no more cards here' })
    if (V.f?.shut) out.court.push({ k: 'shut', t: `${V.f.shut === 'p' ? 'You' : 'The CPU'} can’t play here`, s: V.f.shut })
    return out
  }
  const ONG = useMemo(() => [0, 1, 2].map(li => ongoing(li)), [view, shown])

  // Drag a card from your hand onto a court
  const dragRef = useRef(null)
  const courtAt = (x, y) => { const el = document.elementFromPoint(x, y)?.closest?.('[data-court]'); return el ? +el.dataset.court : null }
  const onDown = (e, k) => {
    if (phase !== 'plan') { setDetail(k); return }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { k, x0: e.clientX, y0: e.clientY, on: false }
  }
  const onMove = e => {
    const d = dragRef.current
    if (!d) return
    if (!d.on && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 7) d.on = true
    if (d.on) {
      const r0 = d.r0 || (d.r0 = root.current.getBoundingClientRect())
      d.x = e.clientX - r0.left; d.y = e.clientY - r0.top
      if (ghostRef.current) ghostRef.current.style.translate = `${d.x}px ${d.y}px`
      const now = performance.now()
      if (d.t && now - d.t < 60 && d.started) return
      d.t = now
      const li = courtAt(e.clientX, e.clientY)
      if (d.started && li === d.li) return
      d.started = true; d.li = li
      let proj = null
      const ok = li != null && canDrop(d.k, li)
      if (ok) { try { proj = E.project(S, staged, d.k, li) } catch { proj = null } }
      setDrag({ k: d.k, x: d.x, y: d.y, li, ok, proj })
    }
  }
  const ghostRef = useRef(null)
  const phaseRef = useRef(phase); phaseRef.current = phase
  const onUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (!d.on) { setDetail(d.k); setDrag(null); return }
    const g = drag
    setDrag(null)
    if (g && g.ok) { buzz('tap'); setStaged(s => [...s, { k: d.k, li: g.li }]); setLanded('s' + d.k); setTimeout(() => setLanded(null), 500); ripple(d.k) }
  }
  const playTo = (k, li) => { if (canDrop(k, li)) { setStaged(s => [...s, { k, li }]); setDetail(null); ripple(k) } }
  // A card set down on the floor: a ring spreads out from its slot
  const ripple = k => setTimeout(() => { const p = rel(`[data-pk="${k}"]`); if (p) addFx({ kind: 'ripple', x: p.x, y: p.y, w: p.w }, 700) }, 40)
  // This turn's franchise power: one of the franchises you've put a card down from
  const fpOpts = E.fpChoices(staged.map(x => S.cards[x.k]))
  const fpNow = fpSel && fpOpts.includes(fpSel) ? fpSel : fpSel === 'none' ? null : fpOpts[0] || null
  const unstage = k => phaseRef.current === 'plan' && setStaged(s => s.filter(x => x.k !== k))

  const handShown = hand.filter(k => !staged.some(x => x.k === k) && !pend.some(x => x.k === k))
  const playable = handShown.some(k => [0, 1, 2].some(li => canDrop(k, li)))
  const totals = view.map(L => L.t)
  const over = S.over

  return <div className={`${styles.root} ar`} style={{ '--you': you.a, '--youInk': you.ink, '--opp': opp.a, '--oppInk': opp.ink }} ref={root} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { dragRef.current = null; setDrag(null) }}>
    <div className="ar-bg" aria-hidden="true"><i /><i /><i /></div>
    <div className="ar-in" ref={inRef}>
      <header className="ar-top">
        <div className="ar-plate" data-side="p"><span className="ar-av">YOU</span><b>{deckName}</b></div>
        <div className="ar-turn"><small>Possession</small><b>{Math.min(S.turn, 6)}<em>/6</em></b><span>{[1, 2, 3, 4, 5, 6].map(t => <i key={t} data-on={t <= S.turn ? '' : undefined} />)}</span>
          <em className="ar-arrow" data-s={firstSide} key={'ar' + S.turn} title={firstSide === 'p' ? 'You reveal first this possession' : `${coach} reveals first this possession`}><svg viewBox="0 0 24 12" aria-hidden="true"><path d="M2 6h18M8 1L2 6l6 5" /></svg><small>{firstSide === 'p' ? 'You first' : 'CPU first'}</small></em></div>
        <div className="ar-plate ar-coach" data-side="c"><span className="ar-cn"><b>{coach}</b><small>{label}</small></span><span className="ar-av" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 11a5 5 0 0 1 5-5h9l3-2v6h-4a5 5 0 1 1-13 1z" /><circle cx="8" cy="11" r="1.6" /></svg></span>
          {quip && <span key={quip.n} className="ar-quip" role="status">{quip.t}</span>}</div>
      </header>
      <div className="ar-opphand" aria-label={`Opponent has ${oppHand} cards`}>{Array.from({ length: oppHand }, (_, i) => <i key={i} />)}</div>

      <div className="ar-board">
        {S.locs.map((L, li) => {
          const V = view[li], rev = shown[li], LL = rev ? E.LOCBY[L.id] : null, t = totals[li]
          const mine = [...V.p.map(i => ({ ...i, st: 'on' })), ...pend.filter(x => x.li === li).map(x => ({ k: x.k, st: 'pend' })), ...staged.filter(x => x.li === li).map(x => ({ k: x.k, st: 'staged' }))]
          const theirs = [...V.c.map(i => ({ ...i, st: 'on' })), ...(incoming && incoming.li === li ? [{ k: incoming.k, st: 'in' }] : [])]
          const og = ONG[li]
          const hot = drag && drag.li === li
          const lead = !rev ? 0 : t.p > t.c ? 1 : t.c > t.p ? -1 : 0
          return <div key={li} className="ar-col" data-court={li} data-hot={hot ? (drag.ok ? 'ok' : 'no') : undefined}>
            <div className="ar-side" data-s="c" data-sidebox={`${li}-c`} data-glass={og.side.c.some(x => x.k === 'glass') ? '' : undefined} data-shut={og.court.some(x => x.k === 'shut' && x.s === 'c') || og.court.some(x => x.k === 'lock') ? '' : undefined}>
              {og.side.c.length > 0 && <span className="ar-sidetags">{og.side.c.map(x => <i key={x.k} title={x.t}><Ic k={x.k} /></i>)}</span>}{[2, 3, 0, 1].map(j => { const x = theirs[j]; return <div key={j} className="ar-slot" style={{ width: sw, height: Math.round(sw * 1.4) }}>
              {x && (x.st === 'in' ? <div data-in="" className="ar-back ar-in-fly" style={{ width: sw, height: Math.round(sw * 1.4) }} /> : <div data-u={x.u} className={`ar-card ${landed === x.u ? 'ar-land' : ''} ${og.c[x.u]?.aura ? 'ar-pers-aura' : ''} ${og.c[x.u]?.m.some(m => m.k === 'shield') ? 'ar-pers-shield' : ''}`}><div className={`ar-cw ${ca[x.u] ? 'ar-ca-' + ca[x.u].k : ''}`} key={ca[x.u]?.n || 0} style={ca[x.u]?.vars}><Chip c={S.cards[x.k]} side="c" w={sw} pw={x.pw} onClick={() => setDetail(x.k)} /></div><Marks o={og.c[x.u]} /></div>)}
            </div> })}</div>
            {rev ? <Tot v={t.c} side="c" lead={lead < 0} /> : <div className="ar-tot" />}
            <div className="ar-cwrap" data-li={li}>
            <div className={`ar-court ${flipLi === li ? 'ar-flip' : ''} ${ruleHit?.[li] ? 'ar-rulehit' : ''}`} key={'ct' + li + (ruleHit?.[li]?.n || '')} data-rev={rev ? '' : undefined} data-courtbox={li} role="button" tabIndex={0} aria-label={rev ? `${LL.name}: ${LL.rule}. Tap for details.` : `Court ${li + 1}, not revealed yet`}
              onClick={() => !drag && setCourtInfo(li)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCourtInfo(li) } }}>
              <Floor id={L.id} revealed={rev}>
                <div className="ar-cname">{rev ? <><b>{LL.name}</b><small>{LL.rule}</small></> : <><b>Court {li + 1}</b><small>Tips off poss. {li + 1}</small></>}</div>
              </Floor>
              {hot && drag.ok && drag.proj && <span className="ar-proj">+{drag.proj.d}</span>}
              {og.court.length > 0 && <span className="ar-courttag" title={og.court.map(x => x.t).join('. ')}><Ic k="lock" /></span>}
            </div>
            {ruleHit?.[li] && <span key={ruleHit[li].n} className="ar-rulestamp">{ruleHit[li].t}</span>}
            </div>
            {rev ? <Tot v={t.p} side="p" lead={lead > 0} /> : <div className="ar-tot" />}
            <div className="ar-side" data-s="p" data-sidebox={`${li}-p`} data-glass={og.side.p.some(x => x.k === 'glass') ? '' : undefined} data-shut={og.court.some(x => x.k === 'shut' && x.s === 'p') || og.court.some(x => x.k === 'lock') ? '' : undefined}>
              {og.side.p.length > 0 && <span className="ar-sidetags">{og.side.p.map(x => <i key={x.k} title={x.t}><Ic k={x.k} /></i>)}</span>}{[0, 1, 2, 3].map(j => { const x = mine[j]; const ghost = hot && drag.ok && j === mine.length; return <div key={j} className="ar-slot" data-ghost={ghost ? '' : undefined} style={{ width: sw, height: Math.round(sw * 1.4) }}>
              {x && <div data-u={x.u} data-pk={x.st !== 'on' ? x.k : undefined} className={`ar-card ${x.st !== 'on' ? 'ar-staged' : ''} ${landed === x.u || landed === 's' + x.k ? 'ar-land' : ''} ${og.p[x.u]?.aura ? 'ar-pers-aura' : ''} ${og.p[x.u]?.m.some(m => m.k === 'shield') ? 'ar-pers-shield' : ''}`}><div className={`ar-cw ${ca[x.u] ? 'ar-ca-' + ca[x.u].k : ''}`} key={ca[x.u]?.n || 0} style={ca[x.u]?.vars}>
                <Chip c={S.cards[x.k]} side="p" w={sw} pw={x.pw} onClick={() => (x.st === 'staged' ? unstage(x.k) : setDetail(x.k))} label={x.st === 'staged' ? `${E.cleanName(S.cards[x.k].n)}, tap to take back` : undefined} /></div>{x.u && <Marks o={og.p[x.u]} />}</div>}
            </div> })}</div>
          </div>
        })}
      </div>

      <div className="ar-hand" data-n={handShown.length}>
        {handShown.map((k, i) => {
          const c = S.cards[k], n = handShown.length, mid = (n - 1) / 2, rot = (i - mid) * 4, lift = Math.abs(i - mid) * 3.5
          const can = phase === 'plan' && [0, 1, 2].some(li => canDrop(k, li))
          const ov = Math.max(0, (n * (hw + 6) - (W - 20)) / Math.max(1, n - 1))
          return <div key={k} className="ar-hc" data-can={can ? '' : undefined} data-drag={drag?.k === k ? '' : undefined}
            style={{ transform: `translateY(${lift}px) rotate(${rot}deg)`, marginLeft: i ? -ov : 0, zIndex: i + 1 }}
            onPointerDown={e => onDown(e, k)}>
            <Chip c={c} side="p" w={hw} cost={E.costOf(S, c, null)} onClick={() => {}} label={`${E.cleanName(c.n)}, cost ${c.cost}, power ${c.pw}. Drag to a court, or tap for details.`} />
          </div>
        })}
        {!handShown.length && <span className="ar-empty">Hand empty</span>}
      </div>

      {phase === 'plan' && fpOpts.length > 0 && <div className="ar-fp" role="radiogroup" aria-label="Franchise power this possession">
        <small>Franchise power</small>
        <div className="ar-fpchips">{fpOpts.map(fc => <button key={fc} type="button" role="radio" aria-checked={fpNow === fc} onClick={() => setFpSel(fc)} style={{ '--c1': E.COLOR[fc], '--c2': E.COLOR2[fc] }}><b>{E.NICK[fc]}</b><span>{E.FP[fc].n}</span></button>)}
          <button type="button" role="radio" className="ar-fpnone" aria-checked={!fpNow} onClick={() => setFpSel('none')}><span>None</span></button></div>
        {fpNow && <p>{E.FP[fpNow].t}</p>}
      </div>}
      <footer className="ar-foot">
        <button type="button" className="ar-retreat ar-menubtn" onClick={() => setSheet(true)} aria-label="Match menu"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>Menu</span></button>
        {(() => {
          // Energy: a ball filling with light. It drains as you set cards down, previews what a dragged card would take,
          // and pops with what the new possession adds
          const now = phase === 'plan' ? left : energy, cap = Math.max(1, energy), take = drag?.ok ? E.costOf(S, S.cards[drag.k], drag.li) : 0
          const pct = Math.max(0, Math.min(1, now / cap)), after = Math.max(0, Math.min(1, (now - take) / cap))
          return <div className="ar-energy" aria-label={`${now} energy`} data-empty={now <= 0 ? '' : undefined} data-low={phase === 'plan' && take > now ? '' : undefined}>
            <div className="ar-eball"><span className="ar-efill" style={{ '--f': pct }}><i /></span>{take > 0 && <span className="ar-etake" style={{ '--a': after, '--b': pct }} />}<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M2 32h60M32 2v60M11 9c9 9 9 37 0 46M53 9c-9 9-9 37 0 46" /></svg>
              <b key={now}>{now}</b></div>
            <span className="ar-epips" aria-hidden="true">{Array.from({ length: Math.min(cap, 12) }, (_, i) => <i key={i} data-on={i < now ? '' : undefined} data-take={i >= now - take && i < now ? '' : undefined} />)}</span>
            {gain && <em key={gain.n} className="ar-egain">+{gain.v}</em>}
          </div>
        })()}
        <button type="button" className="ar-end" data-ready={phase === 'plan' && !playable ? '' : undefined} disabled={phase !== 'plan'} onClick={endTurn}>
          <span>{phase === 'plan' ? <>End turn<small>Poss. {S.turn}/6</small></> : phase === 'play' ? <>Playing…<small>Poss. {S.turn}/6</small></> : <>Get ready<small>Poss. {S.turn}/6</small></>}</span></button>
      </footer>
    </div>

    {phase === 'play' && <button type="button" className="ar-fast" onClick={() => { fastRef.current = !fastRef.current; setFast(f => !f) }}>{fast ? 'Normal speed' : 'Speed up ››'}</button>}

    {/* Overlays */}
    {flash > 0 && <div key={'fl' + flash} className="ar-flashes" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 60 + 5}%`, animationDelay: `${(i % 7) * 70}ms` }} />)}</div>}
    {banner && <div key={banner.n} className="ar-banner" aria-live="polite"><div><small>{banner.t === 6 ? 'Last chance' : banner.t === 1 ? 'Tip-off' : 'Next possession'}</small><b>{banner.t === 6 ? 'Final possession' : `Possession ${banner.t}/6`}</b><em className="ar-bnarrow" data-s={E.firstThisTurn(S)}>{E.firstThisTurn(S) === 'p' ? 'Possession arrow: you reveal first' : `Possession arrow: ${coach} reveals first`}</em></div></div>}
    {jump && <div key={jump.n} className="ar-jump" data-step={jump.step} data-w={jump.w} aria-live="polite">
      <div className="ar-jcircle" aria-hidden="true"><i /></div>
      <div className="ar-jplates"><span data-s="p">You</span><span data-s="c">{coach}</span></div>
      <span className="ar-jball" aria-hidden="true" />
      <div className="ar-jtxt"><small>Jump ball</small><b>{jump.step < 2 ? 'Tip-off' : jump.w === 'p' ? 'You win the tip' : `${coach} wins the tip`}</b>{jump.step >= 2 && <em>{jump.w === 'p' ? 'You reveal first on possession 1. The arrow alternates after that.' : `${coach} reveals first on possession 1. The arrow alternates after that.`}</em>}</div>
    </div>}
    {fpShow && <div key={fpShow.n} className="ar-fpplate" data-side={fpShow.side} style={{ '--c1': E.COLOR[fpShow.fc], '--c2': E.COLOR2[fpShow.fc] }} aria-live="polite">
      <div><small>{fpShow.side === 'p' ? 'Your franchise power' : `${coach} · franchise power`}</small><b>{E.NICK[fpShow.fc]}</b><strong>{E.FP[fpShow.fc].n}</strong><p>{E.FP[fpShow.fc].t}</p></div>
    </div>}
    {callout && <div key={callout.n} className="ar-l3" style={{ '--c1': E.LOCBY[S.locs[callout.li].id]?.c1 || '#1c2b4a', '--c2': E.LOCBY[S.locs[callout.li].id]?.c2 || '#ffd36b' }}>
      <span className="ar-l3k">Court {callout.li + 1} · tonight at</span><b>{callout.name}</b><span className="ar-l3r"><em>{callout.rule}</em>{callout.fx}</span></div>}
    {big && (() => { const c = S.cards[big.k]; return <div key={big.n} className="ar-big" data-side={big.side} data-tier={c.cost} data-fly={bigFly ? '' : undefined}>
      {c.cost >= 5 && <div className="ar-blackout" />}
      {c.cost >= 5 && <div className="ar-spot" />}
      {c.cost >= 2 && <div className="ar-rays" />}
      {c.cost >= 3 && <div className="ar-sparks">{Array.from({ length: c.cost >= 6 ? 28 : c.cost >= 4 ? 18 : 10 }, (_, i) => <i key={i} style={{ '--a': `${(i * 137) % 360}deg`, '--d': `${120 + ((i * 53) % 120)}px`, animationDelay: `${(c.cost >= 6 ? 700 : 120) + (i % 6) * 40}ms` }} />)}</div>}
      {c.cost >= 6 && <div className="ar-goatfetti">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ left: `${(i * 29) % 100}%`, animationDelay: `${900 + (i % 9) * 80}ms`, background: ['#ffd36b', '#ff5ea8', '#6bc8ff', '#7cf29a', '#fff'][i % 5] }} />)}</div>}
      {c.cost >= 4 && <div className="ar-shock" />}
      {TIER_WORD[c.cost] && <div className="ar-tierword">{TIER_WORD[c.cost]}</div>}
      <div className="ar-bigcard" ref={bigRef} data-fly={bigFly ? '' : undefined} style={bigFly ? { transform: `translate(${bigFly.x}px, ${bigFly.y}px) scale(${bigFly.s})` } : undefined}><Chip c={c} side={big.side} w={Math.min(220, W * 0.56)} cost={c.cost} onClick={() => {}} /></div>
      <div className="ar-bigname"><b>{E.cleanName(c.n)}</b><small>{big.side === 'p' ? 'You' : coach} · {E.TIER_NAME[c.cost]}</small></div>
      {c.ab.length > 0 && <div className="ar-bigab">{c.ab.map(a => <span key={a} style={{ '--k': (CALL[a] || [])[1] }}><b><AbIcon a={a} s={14} /> {E.AB[a].n}</b>{E.AB[a].t(c)}</span>)}</div>}
    </div> })()}
    {fx.map(f => f.kind === 'float' ? <span key={f.id} className="ar-float" style={{ left: f.x, top: f.y, color: f.c || '#fff' }}>{f.t}</span>
      : f.kind === 'slam' ? <span key={f.id} className="ar-slam" data-big={f.big ? '' : undefined} data-tier={f.tier} style={{ left: f.x, top: f.y, '--c': f.c }}><i /><i /><i /></span>
      : f.kind === 'call' ? <span key={f.id} className="ar-call" style={{ left: f.x, top: f.y, '--c': f.c }}>{f.t}!</span>
      : f.kind === 'wave' ? <span key={f.id} className="ar-wave" style={{ '--c': f.c }} />
      : f.kind === 'fire' ? <span key={f.id} className="ar-fire" style={{ left: f.x, top: f.y, width: f.w * 1.5, height: f.h * 1.4 }} />
      : f.kind === 'slash' ? <span key={f.id} className="ar-slashfx" style={{ left: f.x, top: f.y }}><i /><i /></span>
      : f.kind === 'ball' || f.kind === 'orb' ? <span key={f.id} className={f.kind === 'orb' ? 'ar-orbfx' : 'ar-ballfx'} style={{ left: f.x1, top: f.y1, '--tx': `${f.x2 - f.x1}px`, '--ty': `${f.y2 - f.y1}px`, '--arc': `${-f.arc}px`, '--d': `${f.d}ms` }}><i /></span>
      : f.kind === 'swish' ? <span key={f.id} className="ar-swish" style={{ left: f.x, top: f.y }}><i /><i /></span>
      : f.kind === 'digits' ? <span key={f.id} className="ar-digits" style={{ left: f.x, top: f.y }}>{f.t}</span>
      : f.kind === 'dust' ? <span key={f.id} className="ar-dust" style={{ left: f.x, top: f.y }}>{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--a': `${i * 36}deg` }} />)}</span>
      : f.kind === 'glass' ? <span key={f.id} className="ar-glass" style={{ left: f.x, top: f.y, width: f.w + 8, height: f.h + 8 }}><i /></span>
      : f.kind === 'ripple' ? <span key={f.id} className="ar-ripple" style={{ left: f.x, top: f.y, '--w': `${f.w}px` }}><i /><i /></span>
      : f.kind === 'courtglow' ? <span key={f.id} className="ar-cglow" style={{ left: f.x, top: f.y, width: f.w, height: f.h, '--c': f.c }} />
      : f.kind === 'buzzer' ? <span key={f.id} className="ar-buzz" style={{ left: f.x, top: f.y, width: f.w, height: f.h }}><b>Buzzer</b></span>
      : f.kind === 'aura' ? <span key={f.id} className="ar-aura" style={{ left: f.x, top: f.y }}><i /><i /><i /></span>
      : f.kind === 'hoop' ? <span key={f.id} className="ar-hoop" style={{ left: f.x, top: f.y }}><i /></span>
      : f.kind === 'beam' ? <svg key={f.id} className="ar-beam" aria-hidden="true"><line x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke={f.c} /></svg> : null)}
    {tutReady && tutBox && <div className="ar-tut" role="dialog" aria-label={tutStep.t}>
      <span className="ar-tuthole" style={{ left: tutBox.x - tutBox.w / 2 - 6, top: tutBox.y - tutBox.h / 2 - 6, width: tutBox.w + 12, height: tutBox.h + 12 }} />
      <div className="ar-tutcard" data-pos={tutBox.y > box().height * 0.55 ? 'above' : 'below'} style={tutBox.y > box().height * 0.55 ? { bottom: box().height - (tutBox.y - tutBox.h / 2) + 16 } : { top: tutBox.y + tutBox.h / 2 + 16 }}>
        <small>How to play · {tut.i + 1} of {TUT.length}</small><b>{tutStep.t}</b><p>{tutStep.b}</p>
        <div><button type="button" className="ar-tutskip" onClick={tutSkip}>Skip</button><button type="button" className="ar-tutnext" onClick={() => { buzz('tap'); tutNext() }}>{tut.i + 1 >= TUT.length ? 'Got it' : 'Next'}</button></div>
      </div>
    </div>}
    {sheet && <div className="ar-sheetwrap" onClick={() => setSheet(false)}><div className="ar-sheet" role="dialog" aria-label="Match menu" onClick={e => e.stopPropagation()}>
      <span className="ar-grab" aria-hidden="true" />
      <button type="button" onClick={() => setSheet(false)}><b>Resume</b></button>
      <button type="button" onClick={() => { setSheet(false); setTut({ i: 0 }) }}><b>How to play</b><small>Walk through the basics again</small></button>
      <button type="button" role="switch" aria-checked={hap} onClick={() => { const v = !hap; setHap(v); try { localStorage.setItem(HAPTIC_KEY, v ? 'on' : 'off') } catch { /* private */ } if (v) buzz('big') }}><b>Vibration</b><small>{typeof navigator !== 'undefined' && navigator.vibrate ? 'Buzzes on reveals, powers and the final buzzer' : 'On iPhone, a light tick: Safari allows nothing stronger'}</small><span className="ar-tog" data-on={hap ? '' : undefined}><i /></span></button>
      <button type="button" className="ar-sheetbad" onClick={() => { setSheet(false); menu() }}><b>Retreat</b><small>Leave this match</small></button>
    </div></div>}
    {drag && <div ref={ghostRef} className="ar-ghost" style={{ left: 0, top: 0, translate: `${dragRef.current?.x ?? drag.x}px ${dragRef.current?.y ?? drag.y}px` }} data-ok={drag.ok ? '' : undefined}><Chip c={S.cards[drag.k]} side="p" w={hw * 1.15} cost={S.cards[drag.k].cost} onClick={() => {}} /></div>}
    {detail && (() => { const c = S.cards[detail], inHand = handShown.includes(detail); return <div className="ar-detail" role="dialog" aria-label={E.cleanName(c.n)} onClick={e => { if (e.target === e.currentTarget) setDetail(null) }}>
      <div className="ar-dcard"><Chip c={c} side={detail.startsWith('c') ? 'c' : 'p'} w={Math.min(210, W * 0.52)} cost={c.cost} onClick={() => {}} /></div>
      <div className="ar-dabs">{c.ab.length ? c.ab.map(a => <AbBadge key={a} a={a} c={c} big />) : <p className="ar-noab">No ability. Raw power: {c.pw}.</p>}</div>
      {inHand && phase === 'plan' && <div className="ar-dplay"><small>Drag it to a court, or tap one</small><div>{[0, 1, 2].map(li => <button key={li} type="button" disabled={!canDrop(detail, li)} onClick={() => playTo(detail, li)}>{shown[li] ? E.LOCBY[S.locs[li].id].name : `Court ${li + 1}`}</button>)}</div></div>}
      <button type="button" className="ar-x" onClick={() => setDetail(null)} aria-label="Close"><span>✕</span></button>
    </div> })()}
    {courtInfo != null && (() => {
      const li = courtInfo, L = S.locs[li], rev = shown[li], LL = rev ? E.LOCBY[L.id] : null, V = view[li]
      const row = (sd, i) => { const c = S.cards[i.k]; return <li key={i.u}><span className="ar-ci-dot" data-s={sd} /><b>{E.cleanName(c.n)}</b><em>{i.pw}</em></li> }
      return <div className="ar-detail" role="dialog" aria-label={rev ? LL.name : `Court ${li + 1}`} onClick={e => { if (e.target === e.currentTarget) setCourtInfo(null) }}>
        <div className="ar-ci">
          <div className="ar-ci-floor"><Floor id={L.id} revealed={rev}><span /></Floor></div>
          {rev ? <>
            <small className="ar-ci-g">{LL.g === 'Arena' ? `${E.NICK[LL.fc] || ''} home floor` : LL.g === 'Historic' ? 'Historic venue' : LL.g === 'Court' ? 'Streetball court' : LL.g === 'Global' ? 'Global game' : LL.g}</small>
            <h2>{LL.name}</h2>
            <div className="ar-ci-rule"><b>{LL.rule}</b><p>{LL.fx}</p></div>
            <div className="ar-ci-score"><div data-s="p"><small>You</small><b>{V.t.p}</b></div><span>vs</span><div data-s="c"><small>{coach}</small><b>{V.t.c}</b></div></div>
            {(() => { const og = ONG[li], act = [...og.court.map(x => ({ ...x, who: 'court' })), ...og.side.p.map(x => ({ ...x, who: 'p' })), ...og.side.c.map(x => ({ ...x, who: 'c' })),
              ...['p', 'c'].flatMap(sd => V[sd].flatMap(i => (og[sd][i.u]?.m || []).filter(m => m.k !== 'shield' || S.cards[i.k].ab.includes('perfect')).map(m => ({ k: m.k, b: m.t, c: m.c, t: `${E.lastName(S.cards[i.k].n)}: ${m.d || m.t}`, who: sd }))))]
              return act.length > 0 && <div className="ar-ci-act"><small>Active now</small><ul>{act.map((a, n) => <li key={n} data-who={a.who}><i className="ar-mk" data-k={a.k} style={a.c ? { '--mc': a.c } : undefined}>{ICON[a.k] ? <Ic k={a.k} /> : a.b}</i>{a.t}</li>)}</ul></div> })()}
            {(V.p.length > 0 || V.c.length > 0) && <ul className="ar-ci-list">{V.p.map(i => row('p', i))}{V.c.map(i => row('c', i))}</ul>}
          </> : <>
            <small className="ar-ci-g">Court {li + 1}</small>
            <h2>Not revealed yet</h2>
            <div className="ar-ci-rule"><p>This court tips off on possession {li + 1}. Its arena and rule stay hidden until then, but you can play cards here now.</p></div>
          </>}
        </div>
        <button type="button" className="ar-x" onClick={() => setCourtInfo(null)} aria-label="Close"><span>✕</span></button>
      </div>
    })()}
    {phase === 'over' && over && <Buzz k={over.winner === 'p' ? 'win' : 'loss'} />}
    {phase === 'over' && over && <Result S={S} view={view} swings={swings.current} totals={totals} again={again} menu={menu} coach={coach} reward={reward} W={W} />}
  </div>
}

function Result({ S, view, swings, totals, again, menu, coach, reward, W }) {
  const w = totals.filter(t => t.p > t.c).length, l = totals.filter(t => t.c > t.p).length
  const res = S.over.winner === 'p' ? 'win' : S.over.winner === 'c' ? 'loss' : (w > l ? 'win' : l > w ? 'loss' : 'draw')
  return <div className="ar-result" data-r={res}>
    {res === 'win' && <div className="ar-confetti" aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <i key={i} style={{ left: `${(i * 23) % 100}%`, animationDelay: `${(i % 10) * 90}ms`, background: ['#ffd36b', '#5aadff', '#ff6a1f', '#fff'][i % 4] }} />)}</div>}
    <small>Final</small>
    <b>{res === 'win' ? 'Victory' : res === 'loss' ? 'Defeat' : 'Draw'}</b>
    <div className="ar-rcourts">{S.locs.map((L, i) => <div key={i} data-w={totals[i].p > totals[i].c ? 'p' : totals[i].c > totals[i].p ? 'c' : ''}><span>{E.LOCBY[L.id].name}</span><em>{totals[i].p}<i>–</i>{totals[i].c}</em></div>)}</div>
    {(() => {
      // The match's MVP: your strongest card on the floor at the final buzzer; then the three biggest swings, either side
      const mine = view.flatMap(L => L.p).sort((a, b) => b.pw - a.pw)[0]
      const top = swings.filter(x => x.d).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3)
      return <div className="ar-recap">
        {mine && <div className="ar-mvp"><span className="ar-mvptag">MVP</span><Chip c={S.cards[mine.k]} side="p" w={Math.min(96, W * 0.24)} pw={mine.pw} onClick={() => {}} /><div><b>{E.cleanName(S.cards[mine.k].n)}</b><small>{mine.pw} power at the buzzer</small></div></div>}
        {top.length > 0 && <div className="ar-swings"><small>Biggest swings</small><ol>{top.map((x, n) => <li key={n} data-s={x.side}><b>{x.d > 0 ? '+' : ''}{x.d}</b><span>{E.lastName(S.cards[x.k]?.n || '')}{x.fp ? ` · ${E.FP[x.fp].n}` : ''}</span><em>{E.LOCBY[S.locs[x.li].id]?.name}</em></li>)}</ol></div>}
      </div>
    })()}
    <p className="ar-rquip"><b>{coach}:</b> {res === 'win' ? 'Good game. Run it back?' : res === 'loss' ? 'Better luck next possession.' : 'Overtime next time.'}</p>
    {reward}
    <div className="ar-rbtns">{again && <button type="button" className="ar-again" onClick={again}><span>Run it back</span></button>}<button type="button" className="ar-x ar-menu" onClick={menu}><span>Menu</span></button></div>
  </div>
}
function Buzz({ k }) { useEffect(() => { buzz(k) }, []); return null }
