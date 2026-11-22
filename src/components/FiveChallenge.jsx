import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CardFace } from './Collector'
import { binderTeamInfo, binderHeadshots } from './SeasonExplorer'
import './FiveChallenge.css'

/*
 * The weekly Five challenge (api/_lib/challenge.js has the rules): three lineups to build from your own game cards (the
 * same three challenges for everyone each week), each ranked against every real five that franchise put on the floor in
 * its scope.  Easy: one franchise, every era. Medium: that franchise in one era. Hard: one season.
 * Score = total Elo: the pre-game Elo on your cards added up (up to five; fewer counts, at a disadvantage).
 * Percentile = the share of real fives below yours. Coins after the week: a few per card, plus the level's top payout ×
 * your percentile, doubled if you beat every real five.
 *
 * Presented as a front office at night: the war room (three case folders on the desk), the board (your five as magnets,
 * the board itself from the challenge's era), the ranking (every real five on the projector, yours sweeping past them)
 * and Monday's report on last week.
 */
const RM = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const sleep = ms => new Promise(r => setTimeout(r, RM ? Math.min(ms, 80) : ms))
const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const last = n => baseName(n).split(' ').slice(-1)[0]
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const teamName = fc => binderTeamInfo(fc)?.name || fc
const nick = fc => { const n = teamName(fc); return /Trail Blazers$/.test(n) ? 'Trail Blazers' : n.split(' ').pop() }
const tColor = fc => binderTeamInfo(fc)?.color || '#173657'
const ord = p => { const v = Math.round(p ?? 0), t = v % 100; return `${v}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'}` }
const ERA_LIST = { classic: '1946–59', groove: '1960–79', stripe: '1980–89', edge: '1990–99', refractor: '2000–19', modern: '2020–' }
const ERA_NAME = { classic: 'Classic', groove: 'Groove', stripe: 'Stripe', edge: 'Edge', refractor: 'Refractor', modern: 'Modern' }
const scopeOf = (lv, sp) => (lv === 'easy' ? 'Every era' : lv === 'medium' ? `${sp.era?.name || ERA_NAME[sp.era] || sp.era} era · ${sp.era?.years || ERA_LIST[sp.era] || ''}` : `${sp.s} season`)
const scopeText = L => scopeOf(L.level, L.spec)
const fits = (L, c) => {
  if (!c || c.kind || c.row?.pre == null || (MERGE[c.t] || c.t) !== L.spec.fc) return false
  const y = +String(c.s).slice(0, 4)
  return L.level === 'easy' ? true : L.level === 'medium' ? y >= L.spec.era.from && y <= L.spec.era.to : c.s === L.spec.s
}
// The board on the wall, by the challenge's era: chalk, cork and index cards, label tape, fax paper, glass, a touchscreen
const ERA_BOARD = { classic: 'chalk', groove: 'chalk', stripe: 'dymo', edge: 'fax', refractor: 'glass', modern: 'screen' }
const boardOf = L => {
  if (L.level === 'easy') return 'white'
  if (L.level === 'medium') return ERA_BOARD[L.spec.era?.id] || 'white'
  const d = Math.floor(+L.spec.s.slice(0, 4) / 10) * 10
  return d < 1970 ? 'chalk' : d < 1980 ? 'cork' : d < 1990 ? 'dymo' : d < 2000 ? 'fax' : d < 2010 ? 'glass' : 'screen'
}
// Roughly where a total sits among the real fives, from the 40-bar summary (the saved percentile is exact)
const estPct = (h, v) => {
  if (!h || v == null) return null
  if (v <= h.lo) return 0
  if (v > h.hi) return 100
  const n = h.bins.reduce((a, b) => a + b, 0), w = (h.hi - h.lo) / h.bins.length, k = Math.min(h.bins.length - 1, Math.floor((v - h.lo) / w))
  const below = h.bins.slice(0, k).reduce((a, b) => a + b, 0) + h.bins[k] * ((v - h.lo - k * w) / w)
  return Math.round((below / n) * 1000) / 10
}
const PER_CARD = { easy: 5, medium: 10, hard: 20 }
const estCoins = (L, pct, five, cards) => PER_CARD[L.level] * cards + Math.round(L.max * (pct || 0) / 100) * (L.pool.best != null && five > L.pool.best ? 2 : 1)
const SEEN = 'fpr.fiveReport'
const seen = w => { try { return localStorage.getItem(SEEN) === w } catch { return true } }
const markSeen = w => { try { localStorage.setItem(SEEN, w) } catch { /* private window */ } }
// Lineups lock at the end of Sunday, Eastern
function untilLock(ends) {
  if (!ends) return ''
  const now = new Date(), et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const end = new Date(`${ends}T23:59:59`), s = Math.max(0, (end - et) / 1000)
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : `${h}h ${m}m`
}
let SHOTS = null
function useShots() {
  const [s, set] = useState(SHOTS || {})
  useEffect(() => { if (!SHOTS) binderHeadshots().then(x => { SHOTS = x; set(x) }).catch(() => {}) }, [])
  return s
}
const countTo = (set, to, ms, from = 0) => new Promise(ok => {
  if (RM) { set(to); ok(); return }
  const t0 = performance.now()
  const f = now => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); set(from + (to - from) * e); if (k < 1) requestAnimationFrame(f); else ok() }
  requestAnimationFrame(f)
})

export default function FiveChallenge({ env, onClose }) {
  const C = env.collector
  const [d, setD] = useState(null), [err, setErr] = useState(null)
  const [scr, setScr] = useState({ s: 'room' })
  useEffect(() => { C.loadChallenge().then(x => { setD(x); if (x?.last && !seen(x.last.week)) setScr({ s: 'report' }) }).catch(e => setErr(e.message)) }, [])
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])
  const L = lv => d?.levels.find(x => x.level === lv)
  const save = async (lv, ids) => { const x = await C.setChallenge(lv, ids); if (!x) return false; setD(x); return x }
  return createPortal(<div className="fw">
    {err && <p className="fw-err" role="alert">{err}</p>}
    {scr.s === 'room' && <Room d={d} open={lv => setScr({ s: 'board', lv })} report={() => setScr({ s: 'report' })} onClose={onClose} />}
    {scr.s === 'board' && L(scr.lv) && <Board key={scr.lv} env={env} L={L(scr.lv)} back={() => setScr({ s: 'room' })}
      save={async ids => { const x = await save(scr.lv, ids); if (x) setScr({ s: 'reveal', lv: scr.lv }); return !!x }}
      clear={async () => { await save(scr.lv, []) }} replay={() => setScr({ s: 'reveal', lv: scr.lv })} />}
    {scr.s === 'reveal' && L(scr.lv)?.entry && <Reveal L={L(scr.lv)} room={() => setScr({ s: 'room' })} board={() => setScr({ s: 'board', lv: scr.lv })} />}
    {scr.s === 'report' && d?.last && <Report last={d.last} done={() => { markSeen(d.last.week); setScr({ s: 'room' }) }} />}
  </div>, document.body)
}

// ── The war room: three case folders on the desk ──
function Room({ d, open, report, onClose }) {
  const [clock, setClock] = useState(untilLock(d?.ends))
  useEffect(() => { setClock(untilLock(d?.ends)); const t = setInterval(() => setClock(untilLock(d?.ends)), 30000); return () => clearInterval(t) }, [d?.ends])
  const total = d ? d.levels.reduce((a, L) => a + (L.entry?.coins || 0), 0) : 0
  return <div className="fw-room">
    <div className="fw-lamp" aria-hidden="true" />
    {onClose && <button type="button" className="fw-close" onClick={onClose} aria-label="Back to the Game Room">× <span>Game Room</span></button>}
    <header className="fw-wall">
      <div className="fw-wb">
        <small>Front office · The Game Room</small>
        <h1>Five Challenge</h1>
        <p>Build a five from your cards. We rank it against every real five the franchise ever played.</p>
      </div>
      {d && <div className="fw-clock"><small>Lineups lock in</small><b>{clock}</b><em>Sunday night</em></div>}
    </header>
    {!d ? <p className="fw-wait">Turning on the lights…</p> : <>
      <div className="fw-week"><span>Week of {fmt(d.week)}</span>{total > 0 && <b>+{n0(total)} Coins on the table</b>}</div>
      <div className="fw-desk">
        {d.levels.map((L, i) => {
          const e = L.entry, gold = e && L.pool.best != null && e.five > L.pool.best
          return <button key={L.level} type="button" className="fw-folder" style={{ '--tc': tColor(L.spec.fc), '--i': i }} data-gold={gold ? '' : undefined} onClick={() => open(L.level)}>
            <span className="fw-tab">{LEVEL[L.level]}</span>
            <span className="fw-paper">
              <span className="fw-stamp" data-l={L.level}>Case {i + 1}</span>
              <b>{teamName(L.spec.fc)}</b>
              <small>{scopeText(L)} · {n0(L.pool.n)} real fives</small>
              {e ? <span className="fw-fres"><em>{ord(e.pct)}</em><i>percentile</i><strong>+{n0(e.coins)}</strong><i>Coins now</i></span>
                : <span className="fw-fnone">No lineup yet · up to +{n0(L.max * 2 + L.perCard * 5)} Coins</span>}
              {e && <span className="fw-faces">{e.cards.map(x => <i key={x.id}>{last(x.card.row.n)}</i>)}</span>}
            </span>
          </button>
        })}
      </div>
      {d.last && <button type="button" className="fw-env" onClick={report}><span className="fw-envflap" aria-hidden="true" /><b>Last week’s report</b><small>Week of {fmt(d.last.week)} · +{n0(d.last.results.reduce((a, r) => a + (r.coins || 0), 0))} Coins paid</small></button>}
      <p className="fw-note">Coins pay out after Sunday: a few for every card you play, more for your percentile, and double the percentile Coins if you beat every real five.</p>
    </>}
  </div>
}

// ── The board: your five as magnets, the shelf of players below ──
function Board({ env, L, back, save, clear, replay }) {
  const C = env.collector, shots = useShots()
  const elig = useMemo(() => (C.cards || []).filter(x => fits(L, x.card)).sort((a, b) => b.card.row.pre - a.card.row.pre), [C.cards, L])
  const players = useMemo(() => { const m = new Map(); for (const x of elig) { const k = x.card.row.n; if (!m.has(k)) m.set(k, []); m.get(k).push(x) } return [...m.values()] }, [elig])
  const start = (L.entry?.cards || []).map(x => x.id).filter(id => elig.some(x => Number(x.id) === id))
  const [sel, setSel] = useState(start)
  const [view, setView] = useState(null)
  const [busy, setBusy] = useState(false)
  const chosen = sel.map(id => elig.find(x => Number(x.id) === id)).filter(Boolean)
  const used = new Set(chosen.map(x => x.card.row.n))
  const five = chosen.reduce((a, x) => a + x.card.row.pre, 0)
  const pct = chosen.length ? estPct(L.pool.hist, five) : null
  const changed = sel.join() !== start.join()
  const b = boardOf(L)
  const place = x => { setSel(v => [...v.filter(id => elig.find(y => Number(y.id) === id)?.card.row.n !== x.card.row.n), Number(x.id)]); setView(null) }
  const remove = x => { setSel(v => v.filter(id => id !== Number(x.id))); setView(null) }
  const best = () => setSel(players.slice(0, 5).map(l => Number(l[0].id)))
  const lock = async () => { setBusy(true); try { await save(sel) } finally { setBusy(false) } }
  return <div className="fw-boardwrap" style={{ '--tc': tColor(L.spec.fc) }}>
    <header className="fw-bhead"><button type="button" className="fw-back" onClick={back} aria-label="Back to the war room">‹</button>
      <div><small>{LEVEL[L.level]} · Case {['easy', 'medium', 'hard'].indexOf(L.level) + 1}</small><h2>{teamName(L.spec.fc)}</h2><em>{scopeText(L)} · {n0(L.pool.n)} real fives to beat</em></div></header>
    <div className="fw-board" data-b={b}>
      <div className="fw-btitle"><span>{nick(L.spec.fc)} · {L.level === 'easy' ? 'all-time' : L.level === 'medium' ? L.spec.era.years : L.spec.s}</span></div>
      <div className="fw-mags">{[0, 1, 2, 3, 4].map(i => {
        const x = chosen[i]
        return <div key={i} className="fw-slot" data-i={i}>
          {x ? <button type="button" className="fw-mag" onClick={() => { const l = players.find(p => p[0].card.row.n === x.card.row.n); setView({ list: l, at: l.findIndex(y => y.id === x.id) }) }} aria-label={`${baseName(x.card.row.n)}: his other cards, or take him off`}>
            <span className="fw-pin" aria-hidden="true" /><CardFace card={x.card} shots={shots} w={58} /><b>{last(x.card.row.n)}</b><em>{n0(x.card.row.pre)}</em></button>
            : <span className="fw-open">{i === chosen.length ? '+' : ''}</span>}
        </div>
      })}</div>
      <div className="fw-sum"><span><small>Total Elo</small><b>{chosen.length ? n0(five) : '—'}</b></span>
        <span><small>{changed || !L.entry ? 'Ranks about' : 'Ranks'}</small><b>{pct == null ? '—' : ord(changed || !L.entry ? pct : L.entry.pct)}</b></span>
        <span><small>Coins</small><b>{chosen.length ? `+${n0(changed || !L.entry ? estCoins(L, pct, five, chosen.length) : L.entry.coins)}` : '—'}</b></span></div>
    </div>
    <div className="fw-shelf">
      <div className="fw-shead"><span>Your {nick(L.spec.fc)} · best card each</span>{players.length > 0 && <button type="button" className="fw-ghost" onClick={best}>{players.length >= 5 ? 'Best five' : `Best ${players.length}`}</button>}</div>
      {players.length ? <div className="fw-pool">{players.map(l => {
        const x = l[0], u = used.has(x.card.row.n)
        return <button key={x.card.row.n} type="button" className="fw-pc" data-on={u ? '' : undefined} onClick={() => setView({ list: l, at: u ? Math.max(0, l.findIndex(y => sel.includes(Number(y.id)))) : 0 })}>
          <CardFace card={x.card} shots={shots} w={62} /><span><b>{last(x.card.row.n)}</b><em>{u ? 'On the board' : n0(x.card.row.pre)}</em>{l.length > 1 && <i>+{l.length - 1} more</i>}</span>
        </button>
      })}</div> : <p className="fw-none">None of your cards fit this case yet. Team packs, Era packs and the store are the way in.</p>}
      <div className="fw-acts">
        {L.entry && !changed && <button type="button" className="fw-ghost fw-tall" onClick={replay}>See the ranking</button>}
        {L.entry && <button type="button" className="fw-ghost fw-tall" onClick={clear}>Clear</button>}
        <button type="button" className="fw-cta" disabled={!chosen.length || busy || (L.entry && !changed)} onClick={lock}><span>{busy ? 'Locking…' : L.entry && !changed ? 'Locked in' : 'Lock it in'}</span></button>
      </div>
    </div>
    {view && <Scout list={view.list} at={view.at} setAt={at => setView(v => ({ ...v, at }))} chosen={chosen} full={chosen.length >= 5} onPlace={place} onRemove={remove} onClose={() => setView(null)} />}
  </div>
}

// A player's cards, full screen like a scouting report: swipe or use the arrows to pick his version
function Scout({ list, at, setAt, chosen, full, onPlace, onRemove, onClose }) {
  const x = list[at], sw = useRef(null), shots = useShots()
  const onIt = chosen.find(y => y.id === x.id), his = chosen.find(y => y.card.row.n === x.card.row.n)
  const step = dd => setAt((at + dd + list.length) % list.length)
  const r = x.card.row
  return <div className="fw-scout" role="dialog" aria-label={baseName(r.n)}>
    <small className="fw-sk">{list.length > 1 ? `Card ${at + 1} of ${list.length} · swipe for his others` : 'His only card here'}</small>
    <div className="fw-sstage" onPointerDown={e => { sw.current = e.clientX }} onPointerUp={e => { const dd = e.clientX - (sw.current ?? e.clientX); sw.current = null; if (Math.abs(dd) > 40 && list.length > 1) step(dd < 0 ? 1 : -1) }}>
      {list.length > 1 && <button type="button" className="fw-arrow" data-s="l" onClick={() => step(-1)} aria-label="Previous card">‹</button>}
      <div key={x.id} className="fw-scard"><CardFace card={x.card} shots={shots} w={220} /></div>
      {list.length > 1 && <button type="button" className="fw-arrow" data-s="r" onClick={() => step(1)} aria-label="Next card">›</button>}
    </div>
    <div className="fw-sheet">
      <b>{baseName(r.n)}</b>
      <em>{n0(r.pre)} pre-game Elo · {x.card.s} · {fmt(x.card.date)} vs {x.card.o}</em>
      {list.length > 1 && <div className="fw-dots">{list.map((y, i) => <i key={y.id} data-on={i === at ? '' : undefined} />)}</div>}
    </div>
    <div className="fw-sbtns">
      <button type="button" className="fw-ghost fw-tall" onClick={onClose}>Close</button>
      {onIt ? <button type="button" className="fw-cta" onClick={() => onRemove(x)}><span>Take him off</span></button>
        : <button type="button" className="fw-cta" disabled={full && !his} onClick={() => onPlace(x)}><span>{his ? 'Use this card' : 'Put him on the board'}</span></button>}
    </div>
  </div>
}

// ── The ranking: every real five on the projector, yours sweeping past them ──
function Reveal({ L, room, board }) {
  const e = L.entry, h = L.pool.hist, gold = L.pool.best != null && e.five > L.pool.best
  const [v, setV] = useState(null), [step, setStep] = useState(0), [coins, setCoins] = useState(0)
  const max = h ? Math.max(...h.bins) : 1
  const xOf = val => (h ? Math.max(0, Math.min(1, (val - h.lo) / (h.hi - h.lo || 1))) : 0)
  useEffect(() => {
    let off = false
    ;(async () => {
      await sleep(300); if (off) return; setStep(1)          // the bars rise
      await sleep(1400); if (off) return; setStep(2)         // your total climbs past them
      // Up from zero to the worst real five fast, then slowly past the rest of them
      const floor = h ? Math.min(h.lo, e.five) : e.five
      await countTo(x => !off && setV(x), floor, 600)
      if (off) return
      await countTo(x => !off && setV(x), e.five, gold ? 3000 : 2400, floor)
      if (off) return
      await sleep(250); setStep(3)                           // the verdict
      await sleep(gold ? 900 : 500); if (off) return
      await countTo(x => !off && setCoins(x), e.coins, 1100)
      if (!off) setStep(4)
    })()
    return () => { off = true }
  }, [])
  const at = v == null ? 0 : xOf(v)
  const beaten = Math.round(((e.pct || 0) / 100) * L.pool.n)
  return <div className="fw-rev" data-step={step} data-gold={gold && step >= 3 ? '' : undefined} style={{ '--tc': tColor(L.spec.fc) }}>
    <div className="fw-beam" aria-hidden="true" />
    <header className="fw-rhead"><small>{LEVEL[L.level]} · {teamName(L.spec.fc)}</small><h2>Every real five</h2><em>{n0(L.pool.n)} games · {scopeText(L)}</em></header>
    <div className="fw-screen">
      <div className="fw-chart">
        {h?.bins.map((n, i) => <i key={i} style={{ '--h': `${Math.max(3, (n / max) * 100)}%`, '--d': `${i * 28}ms` }} data-lit={step >= 2 && (i + 1) / h.bins.length <= at + 0.0001 ? '' : undefined} />)}
        <span className="fw-mark" style={{ left: `${at * 100}%` }}><b>{v == null ? '' : n0(v)}</b></span>
      </div>
      <div className="fw-axis"><span>{n0(h?.lo)}<small>worst</small></span><span>{n0(L.pool.median)}<small>middle</small></span><span>{n0(h?.hi)}<small>best</small></span></div>
    </div>
    <div className="fw-total"><small>Your five</small><b>{v == null ? '— — —' : n0(v)}</b><em>{e.cards.map(x => last(x.card.row.n)).join(' · ')}</em></div>
    {step >= 3 && <div className="fw-verdict">
      {gold ? <div className="fw-goldstamp"><small>Front office memo</small><b>Beats every<br />real five</b><em>Percentile Coins doubled</em></div>
        : <div className="fw-pstamp"><b>{ord(e.pct)}</b><small>percentile</small></div>}
      <p>{gold ? `Better than all ${n0(L.pool.n)} fives the ${nick(L.spec.fc)} ever put on the floor in these years.` : `Better than ${n0(beaten)} of ${n0(L.pool.n)} real ${nick(L.spec.fc)} fives.`}</p>
      <div className="fw-coins"><b>+{n0(coins)}</b><small>Coins after Sunday, if it holds</small></div>
    </div>}
    {gold && step >= 3 && <div className="fw-confetti" aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <i key={i} style={{ left: `${(i * 29) % 100}%`, animationDelay: `${(i % 10) * 90}ms`, '--r': `${(i * 53) % 360}deg` }} />)}</div>}
    {step >= 4 && <div className="fw-rbtns"><button type="button" className="fw-ghost fw-tall" onClick={board}>Adjust lineup</button><button type="button" className="fw-cta" onClick={room}><span>Back to the war room</span></button></div>}
  </div>
}

// ── Monday: the front office report on last week ──
function Report({ last: lw, done }) {
  const rows = ['easy', 'medium', 'hard'].map(lv => lw.results.find(r => r.level === lv)).filter(Boolean)
  const total = rows.reduce((a, r) => a + (r.coins || 0), 0)
  return <div className="fw-rep">
    <div className="fw-lamp" aria-hidden="true" />
    <article className="fw-memo">
      <header><small>Front office report · final</small><h2>Week of {fmt(lw.week)}</h2></header>
      {rows.map(r => {
        const sp = lw.spec?.[r.level]
        return <div key={r.level} className="fw-mrow">
          <span className="fw-mlv">{LEVEL[r.level]}</span>
          <span className="fw-mt"><b>{sp ? teamName(sp.fc) : LEVEL[r.level]}</b><small>{sp ? scopeOf(r.level, sp) : ''}{r.names?.length ? ` · ${r.names.map(n => last(Array.isArray(n) ? n[0] : n)).join(', ')}` : ''}</small></span>
          <span className="fw-mp"><b>{ord(r.pct)}</b><small>pct</small></span>
          <span className="fw-mc"><b>+{n0(r.coins || 0)}</b></span>
        </div>
      })}
      <footer><span>Paid to your Coins</span><b>+{n0(total)}</b></footer>
    </article>
    <button type="button" className="fw-cta" onClick={done}><span>To this week’s cases</span></button>
  </div>
}
