import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CardFace } from './Collector'
import { binderTeamInfo, binderHeadshots } from './SeasonExplorer'
import './HangBanner.css'

/*
 * Hang the Banner (api/_lib/banner.js has the rules). Every franchise has a ladder, one rung per finished NBA season,
 * weakest best five first. Beat a rung's five (its combined pre-game Elo) with five of your own cards of the franchise to
 * see the next one; the card window narrows by stage. Every win opens a pack of the franchise's cards; beating every rung
 * hangs the franchise's Banner card in your binder.
 *
 * Presented as an old arena at night: the rafters (every franchise's banner, hauled up as you climb), the hall (a brass
 * plaque per rung), the matchup (their five unveiled one by one, a scoreboard and a report from the rung's era) and the
 * banner-raising ceremony.
 */
const RM = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const sleep = ms => new Promise(r => setTimeout(r, RM ? Math.min(ms, 100) : ms))
const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const last = n => baseName(n).split(' ').slice(-1)[0]
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const teamName = fc => binderTeamInfo(fc)?.name || fc
const nick = fc => { const n = teamName(fc); return /Trail Blazers$/.test(n) ? 'Trail Blazers' : n.split(' ').pop() }
const tColor = fc => binderTeamInfo(fc)?.color || '#173657'
const tColor2 = fc => binderTeamInfo(fc)?.color2 || '#f3ead8'
const yr = s => +String(s).slice(0, 4)
const NBA_MERGED = new Set(['DEN', 'IND', 'SAS', 'BKN'])
const nbaSeason = (fc, s) => !fc.includes('@') && s >= (NBA_MERGED.has(fc) ? '1976-77' : '1949-50')
const fits = (fc, cur, c) => {
  if (!c || c.kind || c.row?.pre == null || c.t !== fc || !nbaSeason(fc, c.s)) return false
  return !cur.window || (yr(c.s) >= cur.window[0] && yr(c.s) <= cur.window[1])
}
const windowText = cur => (!cur.window ? 'any season' : cur.window[0] === cur.window[1] ? `${cur.s} only`
  : `${cur.window[0]}–${String(cur.window[1] + 1).slice(2)}`)
const era = s => `d${Math.floor(yr(s) / 10) * 10}`
const decade = s => `the ${String(Math.floor(yr(s) / 10) * 10).slice(2)}s`
const SEEN = 'fpr.bannerSeen'
const seenGet = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]')) } catch { return new Set() } }
const seenAdd = k => { try { const x = seenGet(); x.add(k); localStorage.setItem(SEEN, JSON.stringify([...x].slice(-400))) } catch { /* private window */ } }
const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const plusDay = d => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
const backDay = d => (d === plusDay(etToday()) ? 'tomorrow' : new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }))
const restLine = o => `Resting · back after ${o.r} more rung${o.r === 1 ? '' : 's'} or ${backDay(o.until)}`
let SHOTS = null
function useShots() {
  const [s, set] = useState(SHOTS || {})
  useEffect(() => { if (!SHOTS) binderHeadshots().then(x => { SHOTS = x; set(x) }).catch(() => {}) }, [])
  return s
}
const SPOTS = [[50, 20], [16, 40], [84, 40], [33, 74], [67, 74]]

export default function HangBanner({ env, onClose }) {
  const C = env.collector
  const [list, setList] = useState(null), [fc, setFc] = useState(null), [d, setD] = useState(null), [err, setErr] = useState(null)
  const [scr, setScr] = useState('rafters')
  const [advance, setAdvance] = useState(false)
  const [award, setAward] = useState(null)
  const reload = () => C.loadBanner().then(setList).catch(e => setErr(e.message))
  useEffect(() => { reload() }, [])
  useEffect(() => { if (!fc) return; setD(null); C.loadBanner(fc).then(setD).catch(e => setErr(e.message)) }, [fc])
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])
  // Players you could field on each ladder's next rung: cards of the franchise in its window, not resting, one per player
  const fieldable = useMemo(() => {
    const out = {}
    for (const f of list?.franchises || []) {
      if (!f.cur) continue
      out[f.fc] = new Set((C.cards || []).filter(x => fits(f.fc, f.cur, x.card) && !f.resting?.[Number(x.id)]).map(x => x.card.row.n)).size
    }
    return out
  }, [list, C.cards])
  const open = f => { setFc(f); setScr('hall'); setAdvance(false) }
  const det = d?.detail
  return createPortal(<div className="hb">
    {err && <p className="hb-err" role="alert">{err}</p>}
    {scr === 'rafters' && <Rafters list={list} fieldable={fieldable} open={open} onClose={onClose} />}
    {scr === 'hall' && <Hall fc={fc} d={d} advance={advance} done={() => setAdvance(false)} back={() => { setScr('rafters'); setFc(null); reload() }} play={() => setScr('match')} />}
    {scr === 'match' && det?.current && <Match key={det.current.i} env={env} fc={fc} cur={det.current} rungs={det.rungs} resting={det.resting || {}} back={() => setScr('hall')}
      onPlay={ids => C.playBanner(fc, ids, { defer: true })}
      won={x => { setD(x.banner); if (x.result.banner) { setAward({ card: x.result.banner?.card || x.result.banner, final: x.result }); setScr('ceremony') } else { setAdvance(true); setScr('hall') } }} />}
    {scr === 'ceremony' && <Ceremony fc={fc} det={det} award={award} done={() => { setAward(null); setScr('rafters'); setFc(null); reload() }} />}
  </div>, document.body)
}

// ── The rafters ──
function Fabric({ fc, w, done, prog }) {
  return <span className="hb-fab" style={{ '--c': tColor(fc), '--c2': tColor2(fc), '--w': `${w}px` }} data-done={done ? '' : undefined}>
    <b>{fc.replace('@ABA', '')}</b>{done ? <i className="hb-star" aria-hidden="true">★</i> : prog && <small>{prog}</small>}
  </span>
}

function Rafters({ list, fieldable, open, onClose }) {
  const all = list?.franchises || []
  const sorted = [...all].sort((a, b) => nick(a.fc).localeCompare(nick(b.fc)))
  const rows = []; for (let i = 0; i < sorted.length; i += 5) rows.push(sorted.slice(i, i + 5))
  const hung = all.filter(f => f.banner).length, climbed = all.reduce((s, f) => s + (f.cleared || 0), 0)
  const ready = f => f.cur && (fieldable[f.fc] ?? 0) >= 5
  const next = [...all].filter(f => f.cur && f.cleared > 0).sort((a, b) => (ready(b) - ready(a)) || b.cleared / b.rungs - a.cleared / a.rungs)[0]
    || [...all].filter(ready).sort((a, b) => b.cleared / b.rungs - a.cleared / a.rungs)[0]
  return <div className="hb-raft">
    <div className="hb-lights" aria-hidden="true"><i /><i /><i /></div>
    {onClose && <button type="button" className="hb-close" onClick={onClose} aria-label="Back to the Game Room">× <span>Game Room</span></button>}
    <header className="hb-title"><small>The Game Room</small><h1>Hang the Banner</h1><p>Every franchise’s history, one season at a time</p></header>
    {!list ? <p className="hb-wait">Raising the lights…</p> : <>
      <div className="hb-stats"><div><b>{hung}</b><small>Banners hung</small></div><div><b>{n0(climbed)}</b><small>Rungs climbed</small></div></div>
      {next && <button type="button" className="hb-cont" onClick={() => open(next.fc)} style={{ '--c': tColor(next.fc) }}>
        <span className="hb-cont-bn"><Fabric fc={next.fc} w={46} /></span>
        <span className="hb-cont-t"><small>{next.cleared ? 'Keep climbing' : 'Start a climb'}</small><b>{teamName(next.fc)}</b><em>Rung {next.cleared + 1} of {next.rungs}{ready(next) ? '' : ' · you need more of their cards in the window'}</em></span>
      </button>}
      <div className="hb-ceiling">{rows.map((r, ri) => <div key={ri} className="hb-rafter">
        <div className="hb-truss" aria-hidden="true" />
        <div className="hb-row">{r.map((f, i) => {
          const done = !!f.banner, drop = done ? 0 : Math.round((1 - f.cleared / f.rungs) * 70)
          return <button key={f.fc} type="button" className="hb-hang" style={{ '--drop': `${drop}px`, '--d': `${(ri * 5 + i) * 0.35}s` }} data-done={done ? '' : undefined} data-ready={!done && ready(f) ? '' : undefined}
            onClick={() => open(f.fc)} aria-label={`${teamName(f.fc)}, ${done ? 'banner hung' : `${f.cleared} of ${f.rungs} rungs beaten`}`}>
            <span className="hb-rope" aria-hidden="true" />
            <Fabric fc={f.fc} w={56} done={done} prog={done ? null : `${f.cleared}/${f.rungs}`} />
          </button>
        })}</div>
      </div>)}</div>
      <p className="hb-note">A glowing rope means you have five players ready for that franchise’s next rung.</p>
    </>}
  </div>
}

// ── The hall ──
function Hall({ fc, d, advance, done, back, play }) {
  const ref = useRef(null)
  const det = d?.detail, stages = d?.stages || []
  const cur = det?.current
  const seen = cur ? seenGet().has(`${fc}|${cur.s}`) : false
  const [lit, setLit] = useState(null)
  const [walker, setWalker] = useState(null)
  const beaten = det ? det.cleared : 0
  useEffect(() => {
    const el = ref.current; if (!el || !det) return
    const curI = cur ? cur.i : det.rungs
    const target = el.querySelector(`[data-rung="${advance ? curI - 1 : curI}"]`)
    if (target) el.scrollTo({ top: target.offsetTop - el.clientHeight * 0.55 })
    if (!advance) { setLit(beaten); return }
    let off = false
    setLit(beaten - 1)
    ;(async () => {
      await sleep(500); setLit(beaten)
      await sleep(900)
      const next = el.querySelector(`[data-rung="${curI}"]`)
      setWalker({ from: target?.offsetTop || 0, to: next?.offsetTop || 0, n: Date.now() })
      if (next) el.scrollTo({ top: next.offsetTop - el.clientHeight * 0.55, behavior: RM ? 'auto' : 'smooth' })
      await sleep(1300)
      if (!off) { setWalker(null); done() }
    })()
    return () => { off = true }
  }, [!!det])
  const L = lit ?? beaten
  return <div className="hb-hallwrap">
    <header className="hb-hhead"><button type="button" className="hb-back" onClick={back} aria-label="Back to the rafters">‹</button>
      <div><small>The hall</small><h2>{teamName(fc)}</h2><em>{!det ? 'Opening the doors…' : det.banner ? 'Every rung beaten · Banner hung' : `Rung ${cur.i} of ${det.rungs} · ${cur.stageName}`}</em></div></header>
    {det && <div className="hb-hall" ref={ref}>
      <div className="hb-end">
        <div className="hb-endlight" aria-hidden="true" />
        <span className="hb-endslot">{det.banner ? <Fabric fc={fc} w={70} done /> : <span className="hb-ghostbn">Your banner<br />hangs here</span>}</span>
        <small className="hb-endtxt">{det.cleared} of {det.rungs} rungs</small>
      </div>
      <div className="hb-runner" aria-hidden="true" />
      <ol className="hb-plaques">{det.ladder.slice().reverse().map((r, k, arr) => {
        const st = r.i <= L ? 'done' : r.status === 'current' ? (advance ? 'next' : 'open') : r.status === 'won' ? 'done' : 'locked'
        const below = arr[k + 1], gate = !below || below.stage !== r.stage, S = stages[r.stage - 1] || {}
        const reveal = st === 'done' || (st !== 'locked' && seen)
        return [<li key={r.i} data-rung={r.i} data-state={st} className="hb-plaque" data-side={r.i % 2 ? 'l' : 'r'}>
          <span className="hb-lamp" aria-hidden="true" />
          <div className="hb-brass">
            <small>Rung {r.i}</small>
            <b>{reveal ? `${r.s} ${nick(fc)}` : 'A mystery five'}</b>
            {st === 'done' ? <em>{n0(r.target * 5)} beaten by {n0(r.score * 5)}</em> : st === 'locked' ? <em>Beat rung {r.i - 1} to see it</em>
              : <em>Your cards: {windowText(cur)} · win {cur.pack}</em>}
            {st === 'open' && <button type="button" className="hb-cta hb-sm" onClick={play}><span>{seen ? 'Back to the court' : 'Challenge'}</span></button>}
          </div>
        </li>, gate && <li key={'g' + r.i} className="hb-gate"><span>{S.name}</span><small>{S.win == null ? 'Any season' : S.win === 0 ? 'That season only' : `${S.win} season${S.win === 1 ? '' : 's'} either side`}</small></li>]
      }).flat()}</ol>
      <div className="hb-doors"><span>Rung 1</span><small>The weakest five in franchise history</small></div>
      <p className="hb-rule"><b>Rest:</b> a card in a winning five sits out this ladder’s next rungs or next days, whichever ends first: GOAT 10 rungs or 5 days, Icon 8 or 4, Legend 6 or 3, Standout 4 or 2, Rare 2 or 1. Commons never rest, and nothing rests in the last two stages.</p>
      {walker && <span key={walker.n} className="hb-walker" style={{ '--from': `${walker.from}px`, '--to': `${walker.to}px` }} aria-hidden="true" />}
    </div>}
  </div>
}

// The rung's actual five, from the season file: the cards behind its average
function useRungCards(env, fc, cur) {
  const [cards, setCards] = useState(null)
  useEffect(() => {
    let on = true
    env.getJSON(`/data/explorer/${cur.s}.json`).then(sd => {
      const g = sd.games.find(x => x.date === cur.date && x.teams.includes(fc))
      if (!g) { on && setCards([]); return }
      const C_ = sd.cols, i = g.teams.indexOf(fc), o = g.teams[1 - i]
      const rows = (g.rows || []).map(r => Object.fromEntries(C_.map((k, j) => [k, r[j]])))
      const tn = sd.teams?.[fc] || {}, on_ = sd.teams?.[o] || {}
      const out = cur.five.map(n => rows.find(r => r.n === n)).filter(Boolean).map(row => ({
        s: cur.s, id: g.id, date: g.date, t: fc, tn: tn.name || teamName(fc), tc: tn.color, o, on: on_.name || o, oc: on_.color,
        home: g.home == null ? null : g.home === fc, won: g.pts[i] > g.pts[1 - i], score: `${g.pts[i]}–${g.pts[1 - i]}`, ot: g.ot || '', band: null, honor: null, row }))
      on && setCards(out.sort((a, b) => (a.row.pre ?? 0) - (b.row.pre ?? 0)))
    }).catch(() => on && setCards([]))
    return () => { on = false }
  }, [fc, cur.s])
  return cards
}

// ── The matchup ──
function Match({ env, fc, cur, rungs, resting, back, onPlay, won }) {
  const C = env.collector
  const s = cur.s, E2 = era(s)
  const theirs = useRungCards(env, fc, cur)
  const shots = useShots()
  const reveal0 = !seenGet().has(`${fc}|${s}`)
  const target = cur.elo * 5
  const elig = useMemo(() => (C.cards || []).filter(x => fits(fc, cur, x.card)).sort((a, b) => b.card.row.pre - a.card.row.pre), [C.cards, fc, cur])
  // Every player you could field, his best card first
  const players = useMemo(() => { const m = new Map(); for (const x of elig) { const k = x.card.row.n; if (!m.has(k)) m.set(k, []); m.get(k).push(x) } return [...m.values()] }, [elig])
  const isRest = x => !!resting[Number(x.id)]
  const [phase, setPhase] = useState(reveal0 ? 'tonight' : 'pick')
  const [shown, setShown] = useState(reveal0 ? 0 : 5)
  const [unveil, setUnveil] = useState(null)
  const [fly, setFly] = useState(null)
  const [sel, setSel] = useState([])
  const [view, setView] = useState(null)
  const [res, setRes] = useState(null)
  const [dig, setDig] = useState({ a: null, b: null })
  const [err, setErr] = useState(null)
  const [opened, setOpened] = useState(false)
  const bigRef = useRef(null), rootRef = useRef(null)
  const chosen = sel.map(id => elig.find(x => Number(x.id) === id)).filter(Boolean)
  const sum = chosen.reduce((t, x) => t + x.card.row.pre, 0)
  const used = new Set(chosen.map(x => x.card.row.n))
  const T = theirs || []
  const shownSum = T.slice(0, shown).reduce((t, x) => t + (x.row.pre || 0), 0)
  // First challenge of a rung: their five unveiled one at a time, full screen, before each settles on the floor
  useEffect(() => {
    if (!theirs || phase !== 'tonight') return
    let off = false
    ;(async () => {
      await sleep(2200); if (off) return
      setPhase('intro')
      for (let i = 0; i < theirs.length; i++) {
        if (off) return
        setUnveil({ i, n: Date.now() }); setFly(null)
        await sleep(1900); if (off) return
        const spot = rootRef.current?.querySelector(`[data-tspot="${i}"]`)?.getBoundingClientRect(), b = bigRef.current?.getBoundingClientRect()
        if (spot && b && !RM) { setFly({ x: spot.left + spot.width / 2 - (b.left + b.width / 2), y: spot.top + spot.height / 2 - (b.top + b.height / 2), s: spot.width / b.width }); await sleep(420) }
        setUnveil(null); setFly(null); setShown(i + 1)
        await sleep(350)
      }
      seenAdd(`${fc}|${s}`)
      await sleep(400); if (!off) setPhase('pick')
    })()
    return () => { off = true }
  }, [theirs])
  const place = x => { setSel(v => [...v.filter(id => elig.find(y => Number(y.id) === id)?.card.row.n !== x.card.row.n), Number(x.id)]); setView(null) }
  const remove = x => { setSel(v => v.filter(id => id !== Number(x.id))); setView(null) }
  const best = () => { const out = []; for (const l of players) { if (out.length >= 5) break; const x = l.find(y => !isRest(y)); if (x) out.push(Number(x.id)) } setSel(out) }
  // The totals race up from zero on the scoreboard
  const countTo = (key, to, ms) => new Promise(ok => {
    if (RM) { setDig(v => ({ ...v, [key]: to })); ok(); return }
    const t0 = performance.now()
    const f = now => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); setDig(v => ({ ...v, [key]: Math.round(to * e) })); if (k < 1) requestAnimationFrame(f); else ok() }
    requestAnimationFrame(f)
  })
  const playIt = async () => {
    setErr(null); setPhase('reveal'); setDig({ a: null, b: null })
    const req = Promise.resolve(onPlay(chosen.map(x => Number(x.id)))).catch(e => ({ error: e.message }))
    await sleep(900)
    await countTo('a', target, 1300)
    const x = await req
    if (!x || x.error || !x.result) { setErr(x?.error || 'That didn’t go through. Try again.'); setPhase('pick'); setDig({ a: null, b: null }); return }
    await sleep(500)
    await countTo('b', x.result.score * 5, 2100)
    await sleep(600)
    setRes({ ...x.result, x })
  }
  const face = (c, w) => <CardFace card={c} shots={shots} w={w} />
  const U = unveil && T[unveil.i]
  const V = view && view.list[view.at]
  const gameLine = `${fmt(cur.date)} vs ${cur.opp} · ${cur.won ? 'W' : 'L'} ${cur.score}`
  return <div ref={rootRef} className={`hb-match ${phase === 'reveal' ? 'hb-dim' : ''}`} data-era={E2} data-res={res ? (res.won ? 'w' : 'l') : undefined}>
    <div className="hb-mlights" aria-hidden="true"><i /><i /></div>
    <header className="hb-mhead">
      <button type="button" className="hb-back" onClick={back} aria-label="Back to the hall">‹</button>
      <div><small>Rung {cur.i} of {rungs} · {cur.stageName}</small><h2>The {s} {nick(fc)}</h2><em>{gameLine} · {decade(s)}</em></div>
    </header>
    <Scoreboard era={E2} them={phase === 'reveal' ? dig.a : shown ? (shown >= 5 ? target : shownSum) : null} you={phase === 'reveal' ? dig.b : chosen.length ? sum : null}
      label={phase === 'tonight' || phase === 'intro' ? 'Introducing' : phase === 'pick' ? (chosen.length === 5 ? (sum > target ? `Beats it by ${n0(sum - target)}` : `${n0(target - sum)} short`) : `${chosen.length} of 5 on the floor`) : res ? 'Final' : 'Tip-off'} />
    <div className="hb-floors">
      <div className="hb-half" data-s="them" style={{ '--tc': tColor(fc) }}>
        <span className="hb-hlabel">Their five</span>
        {SPOTS.map(([x, y], i) => <div key={i} className="hb-spot" data-tspot={i} style={{ left: `${x}%`, top: `${y}%` }}>
          {T[i] && i < shown ? <div className="hb-settle">{face(T[i], 56)}</div> : <div className="hb-cardback"><i>?</i></div>}
        </div>)}
      </div>
      <div className="hb-half" data-s="you" style={{ '--tc': tColor(fc) }}>
        <span className="hb-hlabel">Your five</span>
        {SPOTS.map(([x, y], i) => <div key={i} className="hb-spot" style={{ left: `${x}%`, top: `${100 - y}%` }}>
          {chosen[i] ? <button type="button" className="hb-placed" onClick={() => { if (phase !== 'pick') return; const l = players.find(p => p[0].card.row.n === chosen[i].card.row.n); setView({ list: l, at: l.findIndex(y => y.id === chosen[i].id) }) }} aria-label={`${baseName(chosen[i].card.row.n)}: his other cards, or take him off`}>{face(chosen[i].card, 56)}</button>
            : <div className="hb-empty">{phase === 'pick' && i === chosen.length ? '+' : ''}</div>}
        </div>)}
      </div>
    </div>
    {phase === 'tonight' && <div className="hb-tonight" data-era={E2}><small>Tonight</small><b>The {s}<br />{teamName(fc)}</b><em>The best single-game five of their season</em></div>}
    {U && <div key={unveil.n} className="hb-unveil" data-era={E2} data-fly={fly ? '' : undefined}>
      <div className="hb-uspot" aria-hidden="true" />
      <small className="hb-uk">{unveil.i === 4 ? 'And finally' : ['First', 'Next', 'Then', 'Joining them'][unveil.i]}</small>
      <div className="hb-ucard" ref={bigRef} style={fly ? { transform: `translate(${fly.x}px, ${fly.y}px) scale(${fly.s})` } : undefined}>{face(U, 230)}</div>
      <b className="hb-uname">{baseName(U.row.n)}</b>
      <em className="hb-uelo">{n0(U.row.pre)} pre-game Elo</em>
    </div>}
    {phase === 'pick' && <div className="hb-pick">
      {err && <p className="hb-err2" role="alert">{err}</p>}
      <div className="hb-pickhead"><span>Your {nick(fc)} · {windowText(cur)} · best card each</span>{players.length >= 5 && <button type="button" className="hb-ghost" onClick={best}>Best five</button>}</div>
      {players.length ? <div className="hb-pool">{players.map(l => {
        const x = l.find(y => !isRest(y)) || l[0], allRest = l.every(isRest), u = used.has(x.card.row.n)
        return <button key={x.card.row.n} type="button" className="hb-pc" disabled={u} onClick={() => setView({ list: l, at: l.indexOf(x) })} data-rest={allRest ? '' : undefined}>
          {face(x.card, 64)}<span><b>{last(x.card.row.n)}</b><em>{u ? 'On the floor' : allRest ? 'Resting' : n0(x.card.row.pre)}</em>{l.length > 1 && <i className="hb-more">+{l.length - 1} more</i>}</span>
        </button>
      })}</div> : <p className="hb-none">None of your {nick(fc)} cards fit this rung yet. Team packs, Era packs and the store are the way in.</p>}
      <button type="button" className="hb-cta hb-play" disabled={chosen.length !== 5} onClick={playIt}><span>{chosen.length === 5 ? 'Play this rung' : `Pick ${5 - chosen.length} more`}</span></button>
    </div>}
    {V && <CardView env={env} list={view.list} at={view.at} setAt={at => setView(v => ({ ...v, at }))} chosen={chosen} resting={resting} full={chosen.length >= 5}
      onPlace={place} onRemove={remove} onClose={() => setView(null)} />}
    {res && <div className="hb-verdict" data-w={res.won ? '' : undefined}>
      {res.won && <div className="hb-tape" aria-hidden="true">{Array.from({ length: 34 }, (_, i) => <i key={i} style={{ left: `${(i * 31) % 100}%`, animationDelay: `${(i % 9) * 110}ms`, '--r': `${(i * 47) % 360}deg` }} />)}</div>}
      <Report era={E2} s={s} fc={fc}
        head={res.won ? `Your five tops the ’${s.slice(5)} ${nick(fc)}` : `The ’${s.slice(5)} ${nick(fc)} hold on`}
        line={`${n0(res.score * 5)} to ${n0(res.target * 5)} · ${res.won ? `by ${n0((res.score - res.target) * 5)}` : `${n0((res.target - res.score) * 5)} short`}`}
        body={res.won ? (res.banner ? `That was the last rung. Every ${nick(fc)} season is beaten.` : `A pack of ${nick(fc)} cards is yours. Rung ${cur.i + 1} is next.`) : 'Their five held the edge in combined pre-game Elo. Try another lineup.'} />
      {res.won && res.x.openPacks && res.x.packs?.length && !opened ? <button type="button" className="hb-cta" onClick={() => { setOpened(true); res.x.openPacks() }}><span>Open your {nick(fc)} pack</span></button>
        : res.won ? <button type="button" className="hb-cta" onClick={() => won(res.x)}><span>{res.banner ? 'Walk to the rafters' : 'Advance down the hall'}</span></button>
        : <button type="button" className="hb-cta" onClick={() => { setRes(null); setPhase('pick') }}><span>Try another five</span></button>}
    </div>}
  </div>
}

// A player's cards, full screen: swipe or use the arrows to pick which version takes the floor
function CardView({ env, list, at, setAt, chosen, resting, full, onPlace, onRemove, onClose }) {
  const x = list[at], sw = useRef(null), shots = useShots()
  const onIt = chosen.find(y => y.id === x.id), his = chosen.find(y => y.card.row.n === x.card.row.n)
  const r = resting[Number(x.id)]
  const step = dd => setAt((at + dd + list.length) % list.length)
  return <div className="hb-view" role="dialog" aria-label={baseName(x.card.row.n)}>
    <div className="hb-uspot" aria-hidden="true" />
    <small className="hb-uk">{list.length > 1 ? `Card ${at + 1} of ${list.length} · swipe for his others` : 'His only card here'}</small>
    <div className="hb-vstage" onPointerDown={e => { sw.current = e.clientX }} onPointerUp={e => { const dd = e.clientX - (sw.current ?? e.clientX); sw.current = null; if (Math.abs(dd) > 40 && list.length > 1) step(dd < 0 ? 1 : -1) }}>
      {list.length > 1 && <button type="button" className="hb-arrow" data-s="l" onClick={() => step(-1)} aria-label="Previous card">‹</button>}
      <div key={x.id} className="hb-vcard"><CardFace card={x.card} shots={shots} w={220} /></div>
      {list.length > 1 && <button type="button" className="hb-arrow" data-s="r" onClick={() => step(1)} aria-label="Next card">›</button>}
    </div>
    <b className="hb-uname">{baseName(x.card.row.n)}</b>
    <em className="hb-uelo">{n0(x.card.row.pre)} pre-game Elo · {x.card.s} vs {x.card.o}</em>
    {list.length > 1 && <div className="hb-dots">{list.map((y, i) => <i key={y.id} data-on={i === at ? '' : undefined} />)}</div>}
    {r && <p className="hb-restnote">{restLine(r)}</p>}
    <div className="hb-vbtns">
      <button type="button" className="hb-ghost" onClick={onClose}>Close</button>
      {onIt ? <button type="button" className="hb-cta" onClick={() => onRemove(x)}><span>Take him off</span></button>
        : <button type="button" className="hb-cta" disabled={!!r || (full && !his)} onClick={() => onPlace(x)}><span>{his ? 'Use this card' : 'Put him on the floor'}</span></button>}
    </div>
  </div>
}

// How the result is reported, by the rung's decade: The Floor Times on paper, then FanSided.com, then the FanSided app
function Report({ era: e, s, fc, head, line, body }) {
  const dd = +e.slice(1)
  if (dd < 1970) return <article className="hb-rep" data-k="old">
    <header><span>Five Cents</span><b>The Floor Times</b><span>Sports Extra</span></header>
    <div className="hb-rep-rule">{teamName(fc)} · {s} season</div>
    <h3>{head}</h3><h4>{line}</h4><p>{body}</p>
  </article>
  if (dd < 2000) return <article className="hb-rep" data-k="paper" data-d={dd}>
    <header><b>The Floor Times</b><span>Sports · final edition</span></header>
    <h3>{head}</h3><h4>{line}</h4><p>{body}</p>
  </article>
  if (dd < 2010) return <article className="hb-rep" data-k="web00">
    <div className="hb-rep-chrome"><i /><i /><i /><span>http://www.fansided.com/{nick(fc).toLowerCase().replace(/\s+/g, '')}/{s.slice(0, 4)}.html</span></div>
    <div className="hb-rep-site"><b>FanSided.com</b><nav><u>Scores</u> | <u>Teams</u> | <u>Message Boards</u></nav></div>
    <div className="hb-rep-body"><h3>{head}</h3><small>Posted 11:42 p.m. ET</small><h4>{line}</h4><p>{body}</p><u className="hb-rep-link">Discuss this game</u></div>
  </article>
  if (dd < 2020) return <article className="hb-rep" data-k="web10" style={{ '--tc': tColor(fc) }}>
    <div className="hb-rep-hero"><span>{nick(fc)}</span></div>
    <div className="hb-rep-body"><small>FanSided · 2 min read</small><h3>{head}</h3><h4>{line}</h4><p>{body}</p><div className="hb-rep-share" aria-hidden="true"><i /><i /><i /></div></div>
  </article>
  return <article className="hb-rep" data-k="push">
    <div className="hb-rep-time" aria-hidden="true">{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, '')}</div>
    <div className="hb-rep-note"><span className="hb-rep-app" aria-hidden="true">F</span><div><small><b>FANSIDED</b><em>now</em></small><h3>{head}</h3><p>{line}. {body}</p></div></div>
  </article>
}

function Scoreboard({ era: e, them, you, label }) {
  const D = v => (v == null ? '– – – –' : n0(v))
  return <div className="hb-board" data-era={e}>
    <div><small>Them</small><b>{D(them)}</b></div>
    <span className="hb-blabel">{label}</span>
    <div><small>You</small><b>{D(you)}</b></div>
  </div>
}

// ── Hanging the banner ──
function Ceremony({ fc, det, award, done }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    let off = false
    ;(async () => { for (const [s, ms] of [[1, 900], [2, 1500], [3, 2600], [4, 1400]]) { await sleep(ms); if (off) return; setStep(s) } })()
    return () => { off = true }
  }, [])
  const L = det?.ladder || [], seasons = L.map(r => r.s).sort()
  const card = award?.card?.kind === 'banner' ? award.card : { kind: 'banner', tier: 'banner', fc, t: fc, tn: teamName(fc), tc: tColor(fc), size: det?.rungs || L.length,
    from: seasons[0], to: seasons[seasons.length - 1], final: award?.final ? { s: L[L.length - 1]?.s, elo: award.final.target, score: award.final.score } : undefined }
  return <div className="hb-cer" data-step={step}>
    <div className="hb-cer-flash" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 70 + 20}%`, animationDelay: `${(i % 9) * 120}ms` }} />)}</div>
    <div className="hb-cer-rafter" aria-hidden="true" />
    <div className="hb-cer-spot" aria-hidden="true" />
    <div className="hb-cer-bn"><span className="hb-cer-ropes" aria-hidden="true" />
      <span className="hb-big" style={{ '--c': tColor(fc), '--c2': tColor2(fc) }}><small>Hall complete</small><b>{teamName(fc).replace(/ (?=\S+$)/, '\n')}</b><em>{seasons[0]} to {seasons[seasons.length - 1]}</em><i>★</i></span>
    </div>
    <div className="hb-cer-text"><small>Tonight, in the rafters</small><b>The {nick(fc)} banner</b></div>
    {step >= 4 && <div className="hb-cer-card"><div className="hb-cer-cardin"><CardFace card={card} shots={{}} w={200} /></div><p>The Banner card is in your binder.</p>
      <button type="button" className="hb-cta" onClick={done}><span>Back to the rafters</span></button></div>}
  </div>
}
