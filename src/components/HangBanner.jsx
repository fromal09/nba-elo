import { useState, useEffect, useMemo, useRef } from 'react'
import styles from './HangBanner.module.css'
import fs from './FiveChallenge.module.css'
import { Fit, fromIndex } from './Binders'
import { MiniCard } from './PlayerCard'
import { binderLogo, binderTeamInfo } from './SeasonExplorer'
import { TIER_NAME } from './Collector'

/*
 * Hang the Banner, a page of My binder (api/_lib/banner.js has the rules). Every franchise has a ladder, one rung per
 * finished NBA season, weakest best five first. Beat a rung's five (its combined pre-game Elo) with five of your own
 * cards of the franchise to see the next one; the card window narrows by stage. Every win opens a pack of the
 * franchise's cards; beating every rung hangs the franchise's Banner card in your binder.
 */

const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const last = n => baseName(n).split(' ').slice(-1)[0]
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const teamName = fc => binderTeamInfo(fc)?.name || fc
const Logo = ({ t, size = 34 }) => <span className={styles.logo} style={{ width: size, height: size }}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>
const yr = s => +String(s).slice(0, 4)
const NBA_MERGED = new Set(['DEN', 'IND', 'SAS', 'BKN'])
const nbaSeason = (fc, s) => !fc.includes('@') && s >= (NBA_MERGED.has(fc) ? '1976-77' : '1949-50')
const fits = (fc, cur, c) => {
  if (!c || c.kind || c.row?.pre == null || c.t !== fc || !nbaSeason(fc, c.s)) return false
  return !cur.window || (yr(c.s) >= cur.window[0] && yr(c.s) <= cur.window[1])
}
const windowText = cur => (!cur.window ? 'any season in franchise history' : cur.window[0] === cur.window[1] ? `the ${cur.s} season only`
  : `${cur.window[0]}-${String(cur.window[0] + 1).slice(2)} to ${cur.window[1]}-${String(cur.window[1] + 1).slice(2)}`)

// Phone layout (the wall and the rafters size down)
function usePhone() {
  const q = '(max-width: 760px)'
  const [p, setP] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q), h = () => setP(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h) }, [])
  return p
}
const tColor = fc => binderTeamInfo(fc)?.color || '#173657'
// A franchise's banner: its color, its code, the rungs beaten (a star once it's hung)
function Banner({ fc, w, cleared, rungs, dim }) {
  const hung = cleared >= rungs
  return <span className={styles.bn} style={{ '--c': tColor(fc), '--w': `${w}px` }} data-hung={hung ? '' : undefined} data-none={!cleared ? '' : undefined} data-dim={dim ? '' : undefined}>
    <b>{fc}</b>{!hung && <small>{cleared}/{rungs}</small>}
  </span>
}

// The franchise list as an arena ceiling: every banner hangs from a rafter, hauled up by the rungs you've beaten.
// Rafters hold 10 banners across a wide sheet, 6 on a medium one, 5 on a phone.
function Rafters({ sections, ready, fieldable, onOpen }) {
  const ref = useRef(null), [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(el); return () => ro.disconnect()
  }, [])
  const K = w >= 700 ? 10 : w >= 470 ? 6 : 5, small = w < 470
  const bw = small ? 42 : 56, bh = bw * 1.45, rowH = small ? 128 : 190, maxDrop = rowH - bh - 20
  return (
    <div ref={ref} className={styles.raft}>
      {w > 0 && sections.map(([label, L]) => <div key={label}>
        <div className={styles.rSec}>{label}</div>
        {!L.length ? <p className={styles.rNone}>{label.startsWith('Ready') ? 'No ladder is ready: every next rung needs more players from its window than you can field. Team packs fill the gaps.' : 'Nothing here.'}</p>
          : Array.from({ length: Math.ceil(L.length / K) }, (_, r) => <div key={r} className={styles.rafter}>
            <div className={styles.rBeam} />
            <div className={styles.rRow} style={{ height: rowH, gridTemplateColumns: `repeat(${K}, 1fr)` }}>
              {L.slice(r * K, r * K + K).map(f => {
                const frac = f.cleared / f.rungs, ok = ready(f), drop = !f.cleared ? maxDrop : Math.round(4 + (1 - frac) * (maxDrop - 16))
                const status = f.banner ? 'Banner hung' : f.cleared ? `rung ${Math.min(f.cleared + 1, f.rungs)} of ${f.rungs}` : `${f.rungs} rungs, not started`
                return <button key={f.fc} type="button" className={styles.rSlot} data-hung={f.banner ? '' : undefined} onClick={() => onOpen(f.fc)}
                  aria-label={`${teamName(f.fc)}: ${status}${ok ? '' : `, you can field ${fieldable[f.fc] ?? 0} of 5 players`}`}
                  title={`${teamName(f.fc)} · ${status}${ok ? '' : ` · you can field ${fieldable[f.fc] ?? 0} of the 5 players the next rung needs`}`}>
                  <i className={styles.rRope} style={{ height: drop + 3, marginLeft: -bw * 0.34 }} /><i className={styles.rRope} style={{ height: drop + 3, marginLeft: bw * 0.34 }} />
                  <span className={styles.rHang} style={{ top: drop }}>
                    <Banner fc={f.fc} w={bw} cleared={f.cleared} rungs={f.rungs} dim={!ok && !f.banner} />
                    <span className={styles.rLbl} data-short={!ok && !f.banner ? '' : undefined}>{f.banner ? '★ hung' : !ok ? `${fieldable[f.fc] ?? 0} of 5` : f.cleared ? `${Math.round(frac * 100)}%` : ''}</span>
                  </span>
                </button>
              })}
            </div>
          </div>)}
      </div>)}
      {w > 0 && <div className={styles.rFloor} />}
      <p className={styles.rKey}>Height: rungs beaten · ★ Banner hung · “3 of 5”: players you can field for the next rung</p>
    </div>
  )
}

// One franchise's own rafters: the banner hangs against a wall marked with the stages, its tip at where you are.
// A win winches it up (the top eases to its new height).
function Wall({ fc, det, stages, phone, rose }) {
  const H = phone ? 330 : 400, bw = phone ? 82 : 110, bh = bw * 1.45, t0 = 26, rng = H - 36 - t0 - bh
  const f = det.cleared / det.rungs, hung = !!det.banner, ty = Math.round(t0 + (1 - f) * rng)
  const curStage = det.current?.stage
  const marks = [...stages.map((S, k) => { const i = det.ladder.findIndex(r => r.stage === k + 1); return i < 0 ? null : { name: S.name.replace(/^Within the /, ''), x: i / det.rungs, k: k + 1 } }).filter(Boolean), { name: 'Banner', x: 1, k: 0 }]
  return (
    <div className={styles.wall} style={{ height: H, '--c': tColor(fc) }}>
      <div className={styles.rBeam} />
      {!hung && <span className={styles.wGhost} style={{ top: t0, marginLeft: -bw / 2 }}><Banner fc={fc} w={bw} cleared={det.rungs} rungs={det.rungs} /></span>}
      <i className={styles.wRope} style={{ height: ty, marginLeft: -bw * 0.33 }} /><i className={styles.wRope} style={{ height: ty, marginLeft: bw * 0.33 }} />
      <span className={styles.wBig} data-rose={rose ? '' : undefined} style={{ top: ty, marginLeft: -bw / 2 }}><Banner fc={fc} w={bw} cleared={det.cleared} rungs={det.rungs} /></span>
      <div className={styles.wScale} style={{ top: Math.round(t0 + bh), height: Math.round(rng) }}>
        <i className={styles.wFill} style={{ height: Math.round(f * rng) }} />
        {marks.map(m => <div key={m.name} className={styles.wMk} style={{ bottom: Math.round(m.x * rng) }} data-on={m.k === curStage ? '' : undefined} data-done={m.k !== curStage && m.x <= f ? '' : undefined}>{m.name}</div>)}
      </div>
      <div className={styles.wPct}>{hung ? <>★ Banner hung</> : <>{Math.round(f * 100)}%<small>hoisted · {det.cleared} of {det.rungs} rungs</small></>}</div>
    </div>
  )
}

const SEEN = 'fpr.bannerSeen'
const seenGet = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]')) } catch { return new Set() } }
const seenAdd = k => { try { const x = seenGet(); x.add(k); localStorage.setItem(SEEN, JSON.stringify([...x].slice(-400))) } catch { /* private window */ } }
const TIER_REST = t => ({ goat: 10, icon: 8, legend: 6, standout: 4, rare: 2 })[t] || 0
const TIER_REST_DAYS = t => ({ goat: 5, icon: 4, legend: 3, standout: 2, rare: 1 })[t] || 0
const NO_REST_STAGE = 5 // Within the core and Final: no rest
// A resting card's way back: { r: rungs left, until: the ET day it's back }
const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const plusDay = d => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
const backDay = (d, short) => d === plusDay(etToday()) ? 'tomorrow' : `${short ? '' : 'on '}${new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: short ? 'short' : 'long', timeZone: 'UTC' })}`
const restLine = o => `Back after ${o.r} more rung${o.r === 1 ? '' : 's'} or ${backDay(o.until)}`
// Lineup spots on a half court, guards up top and bigs underneath
const SPOTS = [['PG', 50, 24], ['SG', 15, 42], ['SF', 85, 42], ['PF', 37, 75], ['C', 63, 75]]
const posRank = p => (/^PG|^G$/.test(p || '') ? 0 : /SG|G/.test(p || '') ? 1 : /SF/.test(p || '') ? 2 : /PF|F/.test(p || '') ? 3 : /C/.test(p || '') ? 4 : 2)

export default function HangBanner({ env, tools }) {
  const C = env.collector
  const [list, setList] = useState(null), [fc, setFc] = useState(null), [d, setD] = useState(null), [err, setErr] = useState(null)
  const [court, setCourt] = useState(false), [res, setRes] = useState(null)
  useEffect(() => { C.loadBanner().then(setList).catch(e => setErr(e.message)) }, [])
  useEffect(() => { if (!fc) return; setD(null); setRes(null); C.loadBanner(fc).then(setD).catch(e => setErr(e.message)) }, [fc])
  const det = d?.detail, cur = det?.current
  const seen = cur ? seenGet().has(`${fc}|${cur.s}`) : false
  // Players you could field on each ladder's next rung: cards of the franchise in its window, not resting, one per player
  const fieldable = useMemo(() => {
    const out = {}
    for (const f of list?.franchises || []) {
      if (!f.cur) continue
      out[f.fc] = new Set((C.cards || []).filter(x => fits(f.fc, f.cur, x.card) && !f.resting?.[Number(x.id)]).map(x => x.card.row.n)).size
    }
    return out
  }, [list, C.cards])
  const ready = f => !f.cur || (fieldable[f.fc] ?? 0) >= 5
  const [mode, setMode] = useState('all') // all | ready | az
  const byName = (a, b) => teamName(a.fc).localeCompare(teamName(b.fc))
  const hi = (a, b) => b.cleared / b.rungs - a.cleared / a.rungs || byName(a, b)
  const all = list?.franchises || []
  const sections = mode === 'az' ? [['A–Z', [...all].sort(byName)]]
    : mode === 'ready' ? [['Ready for the next rung · highest first', all.filter(f => !f.banner && ready(f)).sort(hi)]]
    : [['In the rafters · highest first', all.filter(f => f.cleared > 0).sort(hi)], ['Still on the floor', all.filter(f => !f.cleared).sort(byName)]]
  const phone = usePhone()
  return (
    <div className={fs.right}>
      <div className={fs.sheetHead}><div className={fs.sheetTitle}><b>Hang the Banner</b><span>{fc ? teamName(fc) : list ? `${list.franchises.filter(f => f.banner).length} banner${list.franchises.filter(f => f.banner).length === 1 ? '' : 's'} hung` : ''}</span></div>{tools}</div>
      <div className={fs.body}>
        {err && <p className={styles.err}>{err}</p>}
        {!fc && <>
          <p className={fs.intro}>Every franchise has a ladder: one rung for each of its NBA seasons, its weakest best five first and its greatest last. Challenge a rung to unveil the five you’re up against, then set your own five from your cards of the franchise. As the rungs get harder, your cards have to come from closer to that season, until the final stretch takes cards from that season alone. Every win opens a pack of the franchise’s cards, better the higher you climb, and a winning card rests for a few rungs or days by its tier, whichever ends first. Beat them all to hang its Banner.</p>
          {!list && !err && <p className={fs.note}>Loading the ladders…</p>}
          {list && <>
            <div className={styles.chips} role="group" aria-label="Show">
              {[['all', `All ${all.length}`], ['ready', 'Ready to climb'], ['az', 'A–Z']].map(([v, l]) => <button key={v} type="button" data-on={mode === v ? '' : undefined} aria-pressed={mode === v} onClick={() => setMode(v)}>{l}</button>)}
            </div>
            <Rafters sections={sections} ready={ready} fieldable={fieldable} onOpen={setFc} />
          </>}
        </>}
        {fc && <>
          <button type="button" className={styles.back} onClick={() => { setFc(null); C.loadBanner().then(setList).catch(() => {}) }}>← All franchises</button>
          {!det && <p className={fs.note}>Loading the {teamName(fc)} ladder…</p>}
          {det && <div className={styles.hero} style={{ '--c': binderTeamInfo(fc)?.color || '#173657' }}>
            <Wall fc={fc} det={det} stages={d.stages} phone={phone} rose={!!res?.won} />
            <div className={styles.board}>
              {!cur ? <div className={styles.done}><b>★ Banner hung</b><p>Every {teamName(fc)} rung beaten. New seasons join the ladder in the offseason; your Banner card stays yours.</p></div> : <>
                <div className={styles.next} style={{ '--c': binderTeamInfo(fc)?.color || '#173657' }}>
                  <small>Next rung · stage {cur.stage} of {d.stages.length}</small>
                  <b>{cur.stageName}</b>
                  <span>Rung {cur.i} of {det.rungs} · {seen ? <>the {cur.s} five · {n0(cur.elo * 5)} combined Elo</> : 'a mystery five. Challenge it to unveil the season, its strength and its cards.'}</span>
                  <span>Your cards: {windowText(cur)}</span>
                  <span>Win: a {teamName(fc)} pack · {cur.pack}</span>
                  <button type="button" className={fs.primary} onClick={() => { setCourt(true); setRes(null) }}>{seen ? 'Back to the court' : 'Challenge this rung'}</button>
                </div>
              </>}
              {res?.won && <p className={styles.won}>Rung {res.rung} beaten, {n0(res.score * 5)} to {n0(res.target * 5)}. Your pack is open.{res.banner ? ' The Banner card is in your binder.' : ''}</p>}
              <div className={styles.climb}>
                <h4>The climb · {det.cleared} of {det.rungs}</h4>
                <div className={styles.trail}>{det.ladder.map((r, k) => <i key={r.i} data-st={r.status} data-new={k > 0 && det.ladder[k - 1].stage !== r.stage ? '' : undefined}
                  title={`Rung ${r.i}${r.status === 'won' ? ` · ${r.s} ✓` : r.status === 'current' ? ' · next' : ''}`} />)}</div>
                <small>Gold top: a new stage starts</small>
              </div>
              {cur && <div className={styles.rule}><b>Rest:</b> a card in a winning five sits out this ladder’s next rungs or next days, whichever ends first: GOAT 10 rungs or 5 days, Icon 8 or 4, Legend 6 or 3, Standout 4 or 2, Rare 2 or 1. Commons never rest, and nothing rests in the last two stages.</div>}
            </div>
          </div>}
          {det && <div className={styles.lad} style={{ '--c': binderTeamInfo(fc)?.color || '#173657' }}>
            <div className={styles.rungs}>
              <div className={styles.ladHead}><Logo t={fc} size={30} /><span><b>{det.cleared} of {det.rungs}</b><small>{det.banner ? '★ Banner hung' : 'rungs beaten'}</small></span></div>
              {det.ladder.map((r, k) => {
                const head = k === 0 || det.ladder[k - 1].stage !== r.stage, S = d.stages[r.stage - 1]
                return <div key={r.i}>
                  {head && <div className={styles.stage}>{S.name}<small>{S.win == null ? 'any season' : S.win === 0 ? 'that season only' : `${S.win} season${S.win === 1 ? '' : 's'} either side`}</small></div>}
                  <div className={styles.rung} data-st={r.status}>
                    <span className={styles.n}>{r.i}</span>
                    {r.status === 'locked' || (r.status === 'current' && !seen) ? <span><b>• • • •</b><small>{r.status === 'current' ? 'challenge it to unveil' : 'locked'}</small></span>
                      : <span><b>{r.s}</b><small>{r.status === 'won' ? `${n0(r.score * 5)} beat ${n0(r.target * 5)}` : `target ${n0(r.target * 5)}`}</small></span>}
                    <span className={styles.st}>{r.status === 'won' ? '✓' : r.status === 'current' ? 'Now' : '🔒'}</span>
                  </div>
                </div>
              })}
            </div>
          </div>}
        </>}
      </div>
      {court && cur && <CourtModal env={env} fc={fc} cur={cur} rungs={det.rungs} resting={det.resting || {}} reveal={!seen}
        onSeen={() => seenAdd(`${fc}|${cur.s}`)} onClose={() => setCourt(false)}
        onPlay={async ids => { const x = await C.playBanner(fc, ids); if (x) { setD(x.banner); if (x.result.won) { setRes(x.result); setCourt(false) } } return x?.result }} />}
    </div>
  )
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
      on && setCards(out.sort((a, b) => posRank(a.row.pos) - posRank(b.row.pos)))
    }).catch(() => on && setCards([]))
    return () => { on = false }
  }, [fc, cur.s])
  return cards
}

// Unveil steps: five cards, then the season and strength
const DONE = 6
// The strength ticks up to its value when it's first unveiled
function CountUp({ to, run }) {
  const [v, setV] = useState(run ? 0 : to)
  useEffect(() => {
    if (!run) { setV(to); return }
    let raf, t0
    const step = t => { t0 ??= t; const k = Math.min(1, (t - t0) / 900); setV(to * (1 - (1 - k) ** 3)); if (k < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf)
  }, [to, run])
  return n0(v)
}

function CourtModal({ env, fc, cur, rungs, resting, reveal, onSeen, onClose, onPlay }) {
  const C = env.collector
  const theirs = useRungCards(env, fc, cur)
  const [shown, setShown] = useState(reveal ? 0 : DONE)
  const [sel, setSel] = useState([]), [busy, setBusy] = useState(false), [out, setOut] = useState(null), [err, setErr] = useState(null)
  // Unveil their five one at a time, the first time this rung is challenged
  useEffect(() => {
    if (!theirs || shown >= DONE) return
    // The fifth card lands, a beat, then the season, the game and the strength
    const t = setTimeout(() => setShown(v => v + 1), shown === 0 ? 900 : shown === 5 ? 1300 : 900)
    return () => clearTimeout(t)
  }, [theirs, shown])
  useEffect(() => { if (theirs && shown >= DONE) onSeen() }, [theirs, shown])
  const elig = useMemo(() => (C.cards || []).filter(x => fits(fc, cur, x.card)).sort((a, b) => b.card.row.pre - a.card.row.pre), [C.cards, fc, cur])
  const chosen = sel.map(id => elig.find(x => Number(x.id) === id)).filter(Boolean)
  const used = new Set(chosen.map(x => x.card.row.n))
  // One row per player you could still add: his best card that isn't resting, his others behind it
  const pool = useMemo(() => {
    const by = new Map()
    for (const x of elig) { if (used.has(x.card.row.n)) continue; const k = x.card.row.n; if (!by.has(k)) by.set(k, []); by.get(k).push(x) }
    return [...by.values()].map(l => l.sort((a, b) => !!resting[Number(a.id)] - !!resting[Number(b.id)] || b.card.row.pre - a.card.row.pre))
  }, [elig, sel, resting])
  // Strength reads as the five's combined pre-game Elo (5 × the average the server compares)
  const sum = chosen.length ? chosen.reduce((a, x) => a + x.card.row.pre, 0) : null, avg = sum != null ? sum / chosen.length : null
  const add = x => { if (chosen.length < 5 && !resting[Number(x.id)]) { setSel([...sel, Number(x.id)]); setOut(null) } }
  const play = async () => { setBusy(true); setErr(null); try { const r = await onPlay(sel); if (r) setOut(r) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const face = c => { const e = fromIndex(env, c, { key: `${c.s}|${c.id}|${c.row.n}` }); return <Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit> }
  const tc = binderTeamInfo(fc)?.color || '#173657'
  return (
    <div className={styles.cmOverlay} onClick={onClose}>
      <div className={styles.cm} style={{ '--c': tc }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Challenge the rung">
        <button type="button" className={fs.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.cmHead}>
          <small>{teamName(fc)} · rung {cur.i} of {rungs} · {cur.stageName}</small>
          {shown >= DONE ? <b className={styles.in}>The {cur.s} {teamName(fc).split(' ').pop()}</b> : <b className={styles.mystery}>A mystery five</b>}
          <span className={shown >= DONE ? styles.in : styles.hid}>{fmt(cur.date)} vs {cur.opp} · {cur.won ? 'W' : 'L'} {cur.score} · <b>{n0(cur.elo * 5)}</b> combined pre-game Elo</span>
        </div>
        <div className={styles.courts}>
          <div className={styles.side2}>
            <div className={styles.cTitle}><span>Their five</span>{shown >= DONE ? <b className={styles.in}><CountUp to={cur.elo * 5} run={reveal} /></b> : <b className={styles.mystery}>?</b>}</div>
            <div className={styles.court}>
              {SPOTS.map(([p, x, y], i) => <div key={p} className={styles.spot} style={{ left: `${x}%`, top: `${y}%` }}>
                {theirs && theirs[i] && i < shown ? <div className={styles.flipIn}>{face(theirs[i])}<em><b>{baseName(theirs[i].row.n)}</b>{n0(theirs[i].row.pre)}</em></div>
                  : <div className={styles.cardBack}><i>?</i></div>}
              </div>)}
            </div>
          </div>
          <div className={styles.side2}>
            <div className={styles.cTitle}><span>Your five</span><b data-win={chosen.length === 5 ? (avg > cur.elo ? 'y' : 'n') : undefined}>{sum != null ? n0(sum) : '—'}</b></div>
            <div className={`${styles.court} ${styles.courtMine}`}>
              {SPOTS.map(([p, x, y], i) => <div key={p} className={styles.spot} style={{ left: `${x}%`, top: `${y}%` }}>
                {chosen[i] ? <button type="button" className={styles.placed} onClick={() => setSel(sel.filter(v => v !== Number(chosen[i].id)))} title="Take him off the court">{face(chosen[i].card)}<em><b>{baseName(chosen[i].card.row.n)}</b>{n0(chosen[i].card.row.pre)}</em></button>
                  : <div className={styles.empty}><i>{i === chosen.length ? '+' : ''}</i></div>}
              </div>)}
            </div>
          </div>
        </div>
        <div className={styles.cmRule}>Your cards: {windowText(cur)}, five different players. Tap a player to put him on the court; tap him there to take him off.</div>
        <div className={styles.pool}>
          {shown < DONE && reveal ? <p className={fs.note}>Unveiling their five…</p>
            : !pool.length && chosen.length < 5 ? <p className={fs.note}>{chosen.length ? 'No more of your players fit this rung.' : 'None of your cards fit this rung yet. Team packs, Era packs and the store are the way in.'}</p>
            : pool.map(l => {
              const x = l[0], rest = resting[Number(x.id)]
              // His other cards: each rests on its own, so a second card of his plays while the first cools down
              const alts = l.length > 1 && <div className={styles.alts}><span>His other cards</span>{l.slice(1).map(y => {
                const r = resting[Number(y.id)]
                return <button key={y.id} type="button" className={styles.alt} disabled={!!r || chosen.length >= 5} onClick={() => add(y)} title={r ? restLine(r) : 'Put this card on the court'}>
                  {y.card.s.slice(2)} · {fmt(y.card.date)} · <b>{n0(y.card.row.pre)}</b>{r ? <em> · back {backDay(r.until, true)} or {r.r} rung{r.r === 1 ? '' : 's'}</em> : null}</button>
              })}</div>
              return <div key={x.card.row.n} className={styles.pgroup}><button type="button" className={styles.prow} disabled={!!rest || chosen.length >= 5} onClick={() => add(x)}>
                <span className={styles.pcard}>{face(x.card)}</span>
                <span className={styles.ptext}><b>{baseName(x.card.row.n)}</b><small>{x.card.s} · {fmt(x.card.date)} vs {x.card.o} · {TIER_NAME[x.card.tier] || ''}</small>
                  {rest ? <em>Resting · {restLine(rest).toLowerCase()}</em> : TIER_REST(x.card.tier) && cur.stage < NO_REST_STAGE ? <em className={styles.restNote}>Rests {TIER_REST(x.card.tier)} rungs or {TIER_REST_DAYS(x.card.tier)} day{TIER_REST_DAYS(x.card.tier) === 1 ? '' : 's'} if he wins</em> : null}</span>
                <strong>{n0(x.card.row.pre)}<small>Elo</small></strong>
              </button>{alts}</div>
            })}
        </div>
        <div className={styles.cmFoot}>
          {out && !out.won && <span className={styles.lost}>Not this time: {n0(out.score * 5)} against {n0(out.target * 5)}.</span>}
          {err && <span className={styles.lost}>{err}</span>}
          <span className={styles.gapTxt}>{chosen.length === 5 ? (avg > cur.elo ? `Beats it by ${n0(sum - cur.elo * 5)}` : `${n0(Math.max(1, cur.elo * 5 - sum))} short`) : `${chosen.length} of 5 on the court`}</span>
          <button type="button" className={fs.primary} disabled={chosen.length !== 5 || busy} onClick={play}>{busy ? 'Playing…' : 'Play this rung'}</button>
        </div>
      </div>
    </div>
  )
}
