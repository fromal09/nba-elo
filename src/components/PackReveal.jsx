import { useState, useEffect, useMemo, useRef } from 'react'
import { CardFace, tierName, cardName, refOf, Meter } from './Collector'
import { isSpecial, specialLine } from './SpecialCards'
import { breakdown, useData } from './SelectionBreakdown'
import { cardPoints } from '../../api/_lib/points.js'
import './PackReveal.css'

/*
 * A pack after the rip: each offer's three cards deal face down and turn over on their own, lowest tier first, the
 * moment scaled to what's underneath (a Common just flips; a GOAT gets the lights). Tap a card for the full view: tier,
 * points and why, the game line and what keeping it changes in your binder. Keep one; the other two go. At the end,
 * the results: every card you kept, one at a time, with all it changed, and your binder score before and after.
 */
const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const RM = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const ORDER = ['common', 'rare', 'standout', 'legend', 'icon', 'goat']
const rankOf = c => (isSpecial(c) || c.kind ? 4 : Math.max(0, ORDER.indexOf(c.tier)))
const tierKey = c => (isSpecial(c) || c.kind ? 'special' : c.tier)
// How long each tier's turn takes: the build-up before the flip, and the beat after it
const BEAT = [[260, 220], [380, 320], [520, 420], [900, 700], [1300, 1000], [2000, 1500]]
const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const statLine = c => (isSpecial(c) ? specialLine(c) : [c.row?.pts != null && `${c.row.pts} pts`, c.row?.trb && `${c.row.trb} reb`, c.row?.ast && `${c.row.ast} ast`, c.row?.stl && `${c.row.stl} stl`, c.row?.blk && `${c.row.blk} blk`].filter(Boolean).join(' · '))
const sleep = ms => new Promise(r => setTimeout(r, RM ? Math.min(ms, 60) : ms))

// ── One offer: deal, reveal, choose ──
export function PickStage({ pack, slot, slotLabel, kept, cards0, shots, busy, err, onKeep, onClose, W }) {
  const offer = pack.slots[slot]
  const n = offer.cards.length
  const [up, setUp] = useState([])
  const [hot, setHot] = useState(null) // the card mid-reveal, for its moment
  const [zoom, setZoom] = useState(null)
  const [leaving, setLeaving] = useState(null)
  const done = up.length >= n
  // The binder as it stands with this pack's earlier picks in it
  const cardsNow = useMemo(() => [...(cards0 || []), ...kept.map(card => ({ card }))], [cards0, kept])
  // You turn each card over: a tap pulses it (longer and brighter the better the card), then it flips
  const running = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; setUp([]); setHot(null); setZoom(null); setLeaving(null); running.current = false; return () => { alive.current = false } }, [slot])
  const turn = async i => {
    const r = rankOf(offer.cards[i])
    setHot({ i, r, phase: 'build' })
    await sleep(BEAT[r][0]); if (!alive.current) return
    setUp(u => (u.includes(i) ? u : [...u, i])); setHot({ i, r, phase: 'pop' })
    await sleep(BEAT[r][1]); if (!alive.current) return
    setHot(null)
  }
  const reveal = async i => {
    if (running.current || up.includes(i)) return
    running.current = true
    try { await turn(i) } finally { running.current = false }
  }
  // Turn over the rest, lowest tier first
  const revealAll = async () => {
    if (running.current) return
    running.current = true
    try {
      const order = offer.cards.map((c, i) => [i, rankOf(c)]).filter(([i]) => !up.includes(i)).sort((a, b) => a[1] - b[1] || a[0] - b[0])
      for (const [i] of order) { if (!alive.current) return; await turn(i) }
    } finally { running.current = false }
  }
  const keep = async i => { setLeaving(i); setZoom(null); await sleep(420); onKeep(i) }
  const big = hot && hot.r >= 3 ? hot : null
  return <div className="pk" data-moment={big ? big.r : undefined} data-phase={big?.phase}>
    <div className="pk-bg" aria-hidden="true" />
    <header className="pk-top">
      <button type="button" className="pk-x" onClick={onClose} aria-label="Close (your picks so far are saved)">×</button>
      <div><small>Pick {slot + 1} of {pack.slots.length}</small><b>{slotLabel}</b></div>
      <span className="pk-dots" aria-hidden="true">{pack.slots.map((_, i) => <i key={i} data-s={i < slot ? 'done' : i === slot ? 'now' : ''} />)}</span>
    </header>
    <div className="pk-stage">
      {big && <div className="pk-moment" data-r={big.r} aria-hidden="true"><i /><i /><i /></div>}
      <div className="pk-row" key={slot}>
        {offer.cards.map((c, i) => {
          const isUp = up.includes(i), t = tierKey(c), isHot = hot?.i === i
          return <button key={refOf(c)} type="button" className="pk-card" data-tier={t} data-up={isUp ? '' : undefined} data-hot={isHot ? hot.phase : undefined}
            data-leave={leaving == null ? undefined : leaving === i ? 'keep' : 'drop'} style={{ width: W, height: W * 1.4, '--d': `${i * 110}ms`, '--r': hot?.r ?? 0 }}
            disabled={busy || leaving != null} onClick={() => (isUp ? !hot && setZoom(i) : reveal(i))} aria-label={isUp ? `${cardName(c)}, ${tierName(c)}: see it` : `Card ${i + 1}, face down: turn it over`}>
            <span className="pk-flip">
              <span className="pk-back"><span>FPR</span></span>
              <span className="pk-front"><CardFace card={c} shots={shots} w={W} live /></span>
            </span>
            {isUp && <span className="pk-glow" aria-hidden="true" />}
            {isUp && c.wish && <span className="pk-wish">♥ Wish list</span>}
            {isUp && <span className="pk-tag"><b>{c.tier === 'goat' && !isSpecial(c) ? '★ GOAT' : tierName(c)}</b><em>{n0(cardPoints(c).points)} pts</em></span>}
          </button>
        })}
      </div>
      {big?.phase === 'pop' && <div className="pk-call" data-r={big.r}>{big.r >= 5 ? '★ GOAT' : big.r >= 4 ? (isSpecial(offer.cards[big.i]) ? tierName(offer.cards[big.i]) : 'Icon') : 'Legend'}</div>}
    </div>
    <footer className="pk-foot">
      {err && <p className="pk-err">{err}</p>}
      {!done ? <div className="pk-turnrow"><p className="pk-hint">Tap each card to turn it over</p><button type="button" className="pk-ghost" onClick={revealAll} disabled={!!hot}>Turn them all</button></div>
        : <p className="pk-hint">Tap a card to see it up close. Keep one; the other two go back.</p>}
      <div className="pk-kept" aria-label="Kept so far">{pack.slots.map((_, i) => kept[i]
        ? <span key={i} className="pk-kc"><CardFace card={kept[i]} shots={shots} w={34} /></span>
        : <span key={i} className="pk-ke" data-now={i === slot ? '' : undefined}>{i + 1}</span>)}</div>
    </footer>
    {zoom != null && <Zoom c={offer.cards[zoom]} cards={cardsNow} shots={shots} busy={busy}
      list={offer.cards} at={zoom} setAt={setZoom} onKeep={() => keep(zoom)} onClose={() => setZoom(null)} />}
  </div>
}

// ── The full view: card on top, its sheet below ──
function Zoom({ c, cards, shots, busy, list, at, setAt, onKeep, onClose }) {
  const sw = useRef(null)
  const step = d => setAt((at + d + list.length) % list.length)
  return <div className="pk-zoom" role="dialog" aria-label={cardName(c)} data-tier={tierKey(c)}>
    <div className="pk-zbg" aria-hidden="true" />
    <button type="button" className="pk-x pk-zx" onClick={onClose} aria-label="Back to the three">×</button>
    <div className="pk-zstage" onPointerDown={e => { sw.current = e.clientX }} onPointerUp={e => { const d = e.clientX - (sw.current ?? e.clientX); sw.current = null; if (Math.abs(d) > 40) step(d < 0 ? 1 : -1) }}>
      <button type="button" className="pk-arrow" data-s="l" onClick={() => step(-1)} aria-label="Previous card">‹</button>
      <div key={refOf(c)} className="pk-zcard"><CardFace card={c} shots={shots} w={190} live />{c.wish && <span className="pk-wish">♥ Wish list</span>}</div>
      <button type="button" className="pk-arrow" data-s="r" onClick={() => step(1)} aria-label="Next card">›</button>
    </div>
    <span className="pk-zdots" aria-hidden="true">{list.map((x, i) => <i key={i} data-on={i === at ? '' : undefined} />)}</span>
    <Sheet c={c} cards={cards} />
    <div className="pk-zbtns"><button type="button" className="pk-cta" disabled={busy} onClick={onKeep}><span>{busy ? 'Keeping…' : 'Keep this card'}</span></button></div>
  </div>
}

// Everything a pull changes in your binder: the franchise's players and seasons, the team-season, and the player's cards
// overall and that season. Totals come from the checklist and roster files when they've loaded; counts are from your cards.
const ord = v => `${v}${v % 100 >= 11 && v % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`
const nickOf = n => (/Trail Blazers$/.test(n || '') ? 'Trail Blazers' : (n || '').split(' ').pop())
const lastOf = n => (n || '').replace(/\s*\(.*\)$/, '').split(' ').slice(-1)[0]
function changes(cards, c, d) {
  if (!c || c.kind || !c.row) return []
  const fc = MERGE[c.t] || c.t, s = c.s, n = c.row.n, tn = nickOf(c.tn), who = lastOf(n)
  const mine = (cards || []).map(x => x.card).filter(k => k && !k.kind && k.row)
  const fr = mine.filter(k => (MERGE[k.t] || k.t) === fc)
  const frP = new Set(fr.map(k => k.row.n)), frS = new Set(fr.map(k => k.s)), ts = new Set(fr.filter(k => k.s === s).map(k => k.row.n))
  const his = mine.filter(k => k.row.n === n), hisS = his.filter(k => k.s === s)
  const F = d?.check?.franchises?.[fc], R = d?.roster?.[s] || [], gp = R.find(x => x[0] === n)?.[1] || null
  const seasonsN = F?.seasons ? Object.keys(F.seasons).length : null
  const L = [
    { k: `${tn} players`, now: frP.size, next: frP.size + (frP.has(n) ? 0 : 1), of: F?.players ?? null, sub: frP.has(n) ? `${who} is already one of your ${tn}` : `${who} is a new ${tn} player for you` },
    { k: `${tn} seasons`, now: frS.size, next: frS.size + (frS.has(s) ? 0 : 1), of: seasonsN, sub: frS.has(s) ? `You already have a player from ${s}` : `Your first player from the ${s} ${tn}` },
    { k: `${s} ${tn}`, now: ts.size, next: ts.size + (ts.has(n) ? 0 : 1), of: R.length || null, sub: ts.has(n) ? `${who} is already on your ${s} roster` : R.length ? `${R.length - ts.size - 1} more for the team set card` : `A new player from that roster` },
    { k: `${who} cards`, now: his.length, next: his.length + 1, of: null, sub: his.length ? `Your ${ord(his.length + 1)} version of him` : 'Your first card of him' },
    { k: `${who} in ${s}`, now: hisS.length, next: hisS.length + 1, of: gp, sub: gp ? `Every game of his ${s} season forges his Season card` : `His ${s} games in your binder` },
  ].map(x => ({ ...x, up: x.next > x.now && (x.k.endsWith('cards') || x.k.includes(' in ') ? x.now === 0 : true) }))
  // The season's All-Stars, from the full breakdown, when he was one
  const star = (breakdown(cards, c, d || {}) || []).find(x => /All-Stars$/.test(x.k))
  return star ? [...L, star] : L
}

// Everything about a card: tier and points (and why), the game, and what it does to your binder
function Sheet({ c, cards, compact }) {
  const P = cardPoints(c)
  const d = useData(c && !c.kind && c.t ? MERGE[c.t] || c.t : null)
  const lines = useMemo(() => changes(cards, c, d), [cards, c, d])
  const gs = c.row?.gs, de = c.row?.post != null && c.row?.pre != null ? c.row.post - c.row.pre : null
  return <div className="pk-sheet" data-compact={compact ? '' : undefined}>
    <div className="pk-shead">
      <span className="pk-tier" data-tier={tierKey(c)}>{tierName(c)}</span>
      <span className="pk-pts"><b>{n0(P.points)}</b><small>points</small></span>
    </div>
    <h3>{cardName(c)}</h3>
    {!isSpecial(c) && c.date ? <p className="pk-game">{fmtDay(c.date)} · {c.tn} {c.home === false ? '@' : 'vs'} {c.on || c.o}{c.score ? ` · ${c.won ? 'W' : 'L'} ${c.score}` : ''}</p> : null}
    <div className="pk-stats">
      <span><b>{statLine(c) || '—'}</b><small>Line</small></span>
      {gs != null && <span><b>{(+gs).toFixed(1)}</b><small>Game Score</small></span>}
      {de != null && <span><b>{de >= 0 ? '+' : '−'}{Math.abs(de).toFixed(1)}</b><small>Elo</small></span>}
    </div>
    {P.bonuses?.length > 0 && <div className="pk-why">{P.bonuses.map(([l, v], i) => <span key={i}>{l}{v ? <b> {v}</b> : null}</span>)}</div>}
    {lines.length > 0 && <div className="pk-bind"><h4>In your binder</h4>{lines.map(x => <div key={x.k} className="pk-bl" data-up={x.up ? '' : undefined}>
      <span className="pk-blk">{x.k}</span>
      {x.main ? <b className="pk-blm">{x.main}</b> : <b className="pk-blc">{x.now}{x.next !== x.now && <><i>→</i><em>{x.next}</em></>}{x.of ? <small> / {n0(x.of)}</small> : null}</b>}
      {x.of ? <span className="pk-bar"><i style={{ width: `${Math.min(100, (x.now / x.of) * 100)}%` }} /><em style={{ width: `${Math.min(100, ((x.next - x.now) / x.of) * 100)}%` }} /></span> : null}
      {!compact && x.sub && <small className="pk-bls">{x.sub}</small>}
    </div>)}</div>}
  </div>
}

// ── The results: every card you kept, one at a time, and the binder before and after ──
export function Results({ pack, title, kept, cards0, me, me0, shots, more, onNext, onMine, onClose, foot }) {
  const [at, setAt] = useState(0)
  const sw = useRef(null)
  const total = kept.reduce((a, c) => a + cardPoints(c).points, 0)
  const c = kept[at]
  // Each card measured against the binder as it was when it was kept
  const before = useMemo(() => [...(cards0 || []), ...kept.slice(0, at).map(card => ({ card }))], [cards0, kept, at])
  const s0 = me0?.standing, s1 = me?.standing
  const newPlayers = useMemo(() => { const have = new Set((cards0 || []).map(x => x.card?.row?.n)); return kept.filter(k => !k.kind && k.row && !have.has(k.row.n)).length }, [cards0, kept])
  const step = d => setAt(a => (a + d + kept.length) % kept.length)
  return <div className="pk pk-res">
    <div className="pk-bg" aria-hidden="true" />
    <header className="pk-top"><button type="button" className="pk-x" onClick={onClose} aria-label="Close">×</button><div><small>Pack results</small><b>{title}</b></div><span /></header>
    <div className="pk-sum">
      <span><b>+{n0(total)}</b><small>points</small></span>
      <span><b>{s1 ? n0(s1.score) : '—'}</b><small>{s0 && s1 && s1.score !== s0.score ? `binder score · was ${n0(s0.score)}` : 'binder score'}</small></span>
      <span><b>{s1?.rank ? `No. ${s1.rank}` : '—'}</b><small>{s0?.rank && s1?.rank && s0.rank !== s1.rank ? `${s0.rank > s1.rank ? '▲' : '▼'} ${Math.abs(s0.rank - s1.rank)} from No. ${s0.rank}` : s1?.of ? `of ${n0(s1.of)}` : 'rank'}</small></span>
    </div>
    <div className="pk-strip">{kept.map((k, i) => <button key={refOf(k)} type="button" className="pk-sc" data-on={i === at ? '' : undefined} data-tier={tierKey(k)} onClick={() => setAt(i)} aria-label={cardName(k)}><CardFace card={k} shots={shots} w={44} /></button>)}</div>
    <div className="pk-rcard" onPointerDown={e => { sw.current = e.clientX }} onPointerUp={e => { const d = e.clientX - (sw.current ?? e.clientX); sw.current = null; if (Math.abs(d) > 40) step(d < 0 ? 1 : -1) }}>
      {kept.length > 1 && <button type="button" className="pk-arrow" data-s="l" onClick={() => step(-1)} aria-label="Previous card">‹</button>}
      <div key={refOf(c)} className="pk-zcard"><CardFace card={c} shots={shots} w={150} /></div>
      {kept.length > 1 && <button type="button" className="pk-arrow" data-s="r" onClick={() => step(1)} aria-label="Next card">›</button>}
    </div>
    <div className="pk-rsheet"><Sheet c={c} cards={before} compact /></div>
    <footer className="pk-rfoot">
      {newPlayers > 0 && <p className="pk-new">{newPlayers} new player{newPlayers === 1 ? '' : 's'} in your binder</p>}
      <Meter meter={me?.meter} dark />
      <div className="pk-rbtns">{more > 0 ? <button type="button" className="pk-cta" onClick={onNext}><span>Open your next pack · {more} left</span></button>
        : <><button type="button" className="pk-ghost pk-tall" onClick={onClose}>Done</button><button type="button" className="pk-cta" onClick={onMine}><span>Open my binder</span></button></>}</div>
      {foot}
    </footer>
  </div>
}
