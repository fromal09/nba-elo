import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import styles from './PlayerCard.module.css'

// Rarity by where the player stood entering this game: his pre-game Elo rank among every
// player in that season (same tier names as the Franchise Tenures cards)
// Each capped tier is a print run: the serial is the rank over the cap (1/1, 3/5, 14/20, 33/50, 88/125)
export const TIERS = [
  { id: 'goat', label: '★ GOAT', max: 1 },
  { id: 'icon', label: 'Icon', max: 5 },
  { id: 'legend', label: 'Legend', max: 20 },
  { id: 'standout', label: 'Standout', max: 50 },
  { id: 'rare', label: 'Rare', max: 125 },
  { id: 'common', label: 'Common', max: Infinity },
]
export const tierFor = rank => TIERS.find(t => rank != null && rank <= t.max) || TIERS[TIERS.length - 1]
// The card's tier follows the player's rank after the game, so the frame matches the medallion
export const cardTier = row => tierFor(row.lrp ?? row.lr)
const tierName = t => t.label.replace('★ ', '')
const serialFor = rank => { const t = tierFor(rank); return rank != null && t.max !== Infinity ? `${rank}/${t.max}` : null }

// Slab grade: the game's Game Score as a percentile of every player-game on record (1,078,633 games
// with minutes, 1946-47 through 2026-27). Percentile 6-14 grades 1, 15-24 grades 2 ... 85-94 grades 9,
// 95 and up grades 10. GMSC_PCT[k] is the k-th percentile.
const GMSC_PCT = [-15.5, -3.1, -2.3, -1.8, -1.5, -1.2, -1.0, -0.7, -0.6, -0.4, -0.2, -0.1, 0.0, 0.1, 0.3, 0.4, 0.6, 0.7, 0.9, 1.1,
  1.3, 1.4, 1.6, 1.7, 1.9, 2.0, 2.2, 2.4, 2.6, 2.7, 2.9, 3.1, 3.2, 3.4, 3.6, 3.8, 4.0, 4.1, 4.3, 4.5, 4.7, 4.9, 5.0, 5.2, 5.4, 5.6,
  5.8, 6.0, 6.2, 6.4, 6.6, 6.8, 7.0, 7.2, 7.4, 7.6, 7.8, 8.1, 8.3, 8.5, 8.7, 9.0, 9.2, 9.4, 9.7, 9.9, 10.2, 10.4, 10.7, 11.0, 11.2,
  11.5, 11.8, 12.1, 12.4, 12.7, 13.0, 13.3, 13.7, 14.0, 14.4, 14.7, 15.1, 15.5, 16.0, 16.4, 16.9, 17.4, 17.9, 18.5, 19.1, 19.8,
  20.5, 21.3, 22.2, 23.3, 24.5, 26.2, 28.4, 31.9, 86.8]
// Debuts are graded against every career debut on record (4,426 first games with minutes)
const DEBUT_PCT = [-9.2, -3.3, -2.6, -2.2, -2.0, -1.8, -1.6, -1.4, -1.3, -1.2, -1.1, -1.0, -0.8, -0.7, -0.7, -0.7, -0.7, -0.5, -0.4, -0.4,
  -0.4, -0.2, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.2, 0.3, 0.3, 0.4, 0.6, 0.6, 0.7, 0.7, 0.8, 0.9, 1.0, 1.0, 1.2, 1.3,
  1.3, 1.5, 1.6, 1.7, 1.7, 1.9, 2.0, 2.0, 2.1, 2.3, 2.4, 2.4, 2.5, 2.7, 2.7, 2.9, 3.0, 3.2, 3.3, 3.4, 3.6, 3.7, 3.9, 4.0, 4.2, 4.4,
  4.6, 4.8, 5.0, 5.2, 5.4, 5.6, 5.8, 6.0, 6.2, 6.6, 6.9, 7.2, 7.6, 8.0, 8.4, 8.8, 9.3, 9.9, 10.4, 11.0, 11.6, 12.2, 13.0, 14.2, 15.7,
  17.0, 19.5, 23.1, 47.2]
const GRADE_NAMES = ['Authentic', 'Poor', 'Good', 'VG', 'VG-EX', 'EX', 'EX-MT', 'NM', 'NM-MT', 'Mint', 'Gem Mint']
export function gradeFor(gs, pop = 'all') {
  if (gs == null) return null
  const T = pop === 'debut' ? DEBUT_PCT : GMSC_PCT
  let pct = 0
  while (pct < 100 && T[pct + 1] <= gs) pct++
  const g = pct >= 95 ? 10 : pct >= 6 ? Math.floor((pct + 5) / 10) : 0
  return { g, label: g ? String(g) : 'A', name: GRADE_NAMES[g], pct }
}

// First game of a player's career, for the rookie (RC) shield; set by the page that knows the careers
let firstGame = () => null
export const setFirstGameLookup = fn => { firstGame = fn }
const seasonOf = d => (+d.slice(5, 7) >= 8 ? +d.slice(0, 4) : +d.slice(0, 4) - 1)
const isRookieGame = (name, date) => { const f = firstGame(name); return !!f && !!date && seasonOf(f) === seasonOf(date) }

/**
 * A game's career moments and milestone stamps, highest first.
 * row.fx (from the pipeline, or computed live): 1 career-best Game Score, 2 career-best rank, 4 career-high Elo.
 */
export function momentsFor(row) {
  const fx = row.fx || 0, stamps = []
  const { lr, lrp } = row
  if (lr != null && lrp != null) {
    if (lrp === 1 && lr !== 1) stamps.push({ up: true, text: 'New #1' })
    const a = tierFor(lr), b = tierFor(lrp)
    if (a.id !== b.id) {
      const up = TIERS.indexOf(b) < TIERS.indexOf(a)
      stamps.push({ up, text: `${up ? 'Promoted' : 'Relegated'} to ${tierName(b)}` })
    }
    if (fx & 2 && lrp !== 1) stamps.push({ up: true, text: `Career-high rank #${lrp}` })
  }
  if (fx & 4) stamps.push({ up: true, text: 'Career-high Elo' })
  if (lr != null && lrp != null) {
    if (lr > 100 && lrp <= 100) stamps.push({ up: true, text: 'Enters Top 100' })
    else if (lr <= 100 && lrp > 100) stamps.push({ up: false, text: 'Drops out of Top 100' })
  }
  return { career: !!(fx & 1), stamps }
}

const r0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const f1 = v => (v == null || Number.isNaN(v) ? '—' : v.toFixed(1))
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const fmtDate = (d, o = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th')

function seasonLine(sd, name, gameId) {
  const rows = []
  sd.games.forEach(g => { const p = g.players.find(x => x.n === name); if (p) rows.push({ g, p, N: g.players.length }) })
  if (!rows.length) return null
  const avg = k => rows.reduce((s, r) => s + (r.p[k] || 0), 0) / rows.length
  const path = [rows[0].p.pre, ...rows.map(r => r.p.post)]
  const duels = rows.reduce((s, r) => s + r.N - 1, 0)
  return {
    gp: rows.length, pts: avg('pts'), trb: avg('trb'), ast: avg('ast'),
    start: rows[0].p.pre, end: rows[rows.length - 1].p.post, path,
    peak: Math.max(...path), peakAt: path.indexOf(Math.max(...path)),
    at: rows.findIndex(r => r.g.id === gameId) + 1, // index in path of this game's post-game Elo
    duelPct: duels ? rows.reduce((s, r) => s + r.p.w, 0) / duels : null,
    hasReb: rows.some(r => r.p.trb), hasAst: rows.some(r => r.p.ast),
  }
}

// Elo path with a y-axis, the peak (gold) and this game (team color) marked.
// Long paths are thinned for drawing; the markers stay exact.
function EloChart({ path, peakAt, at, color, H = 92, ends }) {
  if (path.length < 2) return <div className={styles.chartEmpty}>Elo path appears after a second game</div>
  const W = 300, L = 38, R = 8, T = 14, B = ends ? 24 : 14
  const lo0 = Math.min(...path), hi0 = Math.max(...path), pad = Math.max(8, (hi0 - lo0) * 0.12)
  const lo = lo0 - pad, hi = hi0 + pad
  const x = i => L + (i / (path.length - 1)) * (W - L - R)
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const step = Math.max(1, Math.floor(path.length / 300))
  const pts = path.map((v, i) => (i % step === 0 || i === path.length - 1 || i === peakAt || i === at) ? `${x(i)},${y(v)}` : null).filter(Boolean).join(' ')
  const ticks = [lo0, (lo0 + hi0) / 2, hi0]
  const lab = i => { const px = x(i); return px > W - 90 ? { x: px + 4, a: 'end' } : px < L + 50 ? { x: px - 4, a: 'start' } : { x: px, a: 'middle' } }
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {ticks.map((v, i) => <g key={i}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e2ddd0" strokeDasharray={i === 1 ? '2 3' : ''} />
        <text x={L - 5} y={y(v) + 3} textAnchor="end" className={styles.tick}>{Math.round(v).toLocaleString()}</text>
      </g>)}
      <polyline points={`${x(0)},${H - B} ${pts} ${x(path.length - 1)},${H - B}`} fill={color} opacity=".1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(peakAt)} cy={y(path[peakAt])} r="4.5" fill="#e7c160" stroke="#8a6a12" strokeWidth="1" />
      <text x={lab(peakAt).x} y={y(path[peakAt]) - 7} textAnchor={lab(peakAt).a} className={styles.peakLab}>{at === peakAt ? 'Peak · this game' : 'Peak'} {Math.round(path[peakAt]).toLocaleString()}</text>
      {ends && <>
        <text x={L} y={H - 6} textAnchor="start" className={styles.tick}>{ends[0]}</text>
        <text x={W - R - 34} y={H - 6} textAnchor="end" className={styles.tick}>{ends[1]}</text>
      </>}
      {at > 0 && at !== peakAt && <>
        <circle cx={x(at)} cy={y(path[at])} r="5.5" fill="#fff" stroke={color} strokeWidth="2.5" />
        <text x={lab(at).x} y={Math.min(y(path[at]) + 16, H - 2)} textAnchor={lab(at).a} className={styles.gameLab} fill={color}>This game {Math.round(path[at]).toLocaleString()}</text>
      </>}
    </svg>
  )
}

// AP style with the year, since a card can come from any season: DEC. 15, 2023 · MARCH 3, 2024
const AP_MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']
const fmtDay = d => `${AP_MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`.toUpperCase()

/**
 * The card front, specific to one game: date and opponent, result, the game line and Elo.
 * Used by the full card and, scaled down, by the season binder.
 * game: { date, home, oppAbbr, oppLogo, oppColor, won, score, ot, playoff (label or null) }
 */
export function CardFront({ name, row, game, team, headshot }) {
  const [imgBad, setImgBad] = useState(false)
  const lastRef = useRef(null)
  const rank = row.lrp ?? row.lr ?? null
  const move = row.lrp != null && row.lr != null ? row.lr - row.lrp : null
  const [first, ...rest] = baseName(name).split(' ')
  const last = rest.join(' ') || first
  const d = row.post - row.pre
  const where = game.home === false ? '@' : 'vs'
  const moments = useMemo(() => momentsFor(row), [row])
  const rookie = isRookieGame(name, game.date)
  useLayoutEffect(() => {
    const el = lastRef.current; if (!el) return
    // Measure the text itself (scrollWidth rounds, which let italic overhang trigger the ellipsis);
    // divide out any scale transform so binder minis fit the same way
    const textW = () => {
      const r = document.createRange(); r.selectNodeContents(el)
      const k = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1
      return r.getBoundingClientRect().width / k
    }
    const fit = () => { let s = 70; el.style.fontSize = s + 'px'; while (textW() > el.clientWidth - 4 && s > 22) el.style.fontSize = --s + 'px' }
    fit(); document.fonts?.ready.then(fit)
  }, [name])
  return (
    <div className={styles.frame}>
      <div className={styles.photo}>
        <div className={styles.photoBg} />
        {/* foil sits behind the player so the headshot stays crisp */}
        <div className={styles.rays} /><div className={styles.holo} /><div className={styles.glitter} /><div className={styles.shine} />
        <span className={styles.bigNum}>{r0(row.post)}</span>
        {headshot && !imgBad
          ? <img className={styles.shot} src={headshot} alt={baseName(name)} onError={() => setImgBad(true)} />
          : <span className={styles.mono}>{first[0]}{last[0]}</span>}
        <div className={styles.fade} />
        {game.band && <div className={styles.poBand}><span>{game.band.champ ? 'Champions' : 'Playoffs'}</span><i>·</i><span>{game.band.label}</span></div>}
        {moments.career && <div className={styles.careerStamp}><span>★ Career game</span><b>{f1(row.gs)} <small>GmSc</small></b></div>}
        {game.honor && <div className={styles.sash}><span>{game.honor === 'potd' ? 'Player of the Day' : 'Player of the Game'}</span></div>}
        {serialFor(rank) && <span className={styles.serial}>{serialFor(rank)}</span>}
        {rank != null && <div className={styles.medal}>
          <span>Elo rank</span><b>#{rank}</b>
          {!!move && <i className={move > 0 ? styles.medalUp : styles.medalDown}>
            {move > 0 ? `▲ ${move}` : `▼ ${-move}`}</i>}
        </div>}
        <div className={styles.gameTag}>
          <b className={styles.gameDay}>{fmtDay(game.date)}</b>
          {/* Both teams, so the opponent's logo never reads as the player's own */}
          <div className={styles.matchup}>
            <TeamLogo src={team?.logo} abbr={team?.abbr} color={team?.color} />
            <span>{where}</span>
            <TeamLogo src={game.oppLogo} abbr={game.oppAbbr} color={game.oppColor} />
          </div>
        </div>
        <div className={styles.nameOver}>
          <div className={styles.first}>{first}</div>
          <div ref={lastRef} className={styles.last}>{last}</div>
          <div className={styles.metaRow}>
            <span className={styles.meta}>{[row.pos, team?.name].filter(Boolean).join(' · ')}</span>
          </div>
          {(game.score || rookie) && <div className={styles.scoreRow}>
            {game.score && <span className={game.won ? styles.resW : styles.resL}>{game.won ? 'W' : 'L'} {game.score}{game.ot ? ` ${game.ot}` : ''}</span>}
            {rookie && <span className={styles.rc} title="Rookie season">RC</span>}
          </div>}
        </div>
      </div>
      <div className={styles.strip}>
        <div className={styles.stripStats}>
          <div><b>{row.pts ?? '—'}</b><small>PTS</small></div>
          <div><b>{row.trb ?? '—'}</b><small>REB</small></div>
          <div><b>{row.ast ?? '—'}</b><small>AST</small></div>
          <div><b>{f1(row.gs)}</b><small>GmSc</small></div>
        </div>
        {/* Milestones get their own line in the strip, so nothing covers the headshot */}
        {moments.stamps.length > 0 && <div className={styles.msLine}>
          {moments.stamps.map(m => <span key={m.text} className={m.up ? styles.msUp : styles.msDown}>{m.up ? '◆' : '▼'} {m.text}</span>)}
        </div>}
        <div className={styles.stripElo}><small>Elo</small><b>{r0(row.post)}</b><em className={d >= 0 ? styles.up : styles.down}>{sgn(d)}</em></div>
      </div>
    </div>
  )
}

// Data attributes that drive the card's finish: tier, playoff round, honor, career game, milestones
function cardAttrs(row, game) {
  const m = momentsFor(row)
  return {
    'data-tier': cardTier(row).id,
    'data-po': game.band ? game.band.level : undefined,
    'data-honor': game.honor || undefined,
    'data-cg': m.career ? '' : undefined,
    'data-ms': m.stamps.some(x => x.up) ? '' : undefined,
  }
}

// Graded slab label: what the card is, the game, and the grade
export function SlabLabel({ row, game, kind, className }) {
  const debut = /debut/i.test(kind || '')
  const g = gradeFor(row.gs, debut ? 'debut' : 'all')
  if (!g) return null
  return (
    <div className={`${styles.slabLabel} ${className || ''}`}>
      <span className={styles.slabTxt}><b>FPR Graded · {kind}</b><span>{f1(row.gs)} GmSc · {fmtDay(game.date)} {game.home === false ? '@' : 'vs'} {game.oppAbbr}</span></span>
      <span className={styles.slabGrade} title={`Game Score in the ${g.pct}th percentile of every ${debut ? 'career debut' : 'game'} on record`}><b>{g.label}</b><small>{g.name}</small></span>
    </div>
  )
}

// A static card front at full size (340 × 476), for the season binder to scale into a pocket.
// slab: a label (e.g. 'Career game') puts the card in a graded slab, drawn in the same 340 × 476 box
export function MiniCard({ name, row, game, team, headshot, slab }) {
  const card = (
    <div className={`${styles.card} ${styles.miniCard}`} {...cardAttrs(row, game)} style={{ '--tc': team?.color || '#173657' }}>
      <div className={`${styles.face} ${styles.front}`}><CardFront name={name} row={row} game={game} team={team} headshot={headshot} /></div>
    </div>
  )
  if (!slab) return card
  return (
    <div className={styles.slab}>
      <SlabLabel row={row} game={game} kind={slab} />
      <div className={styles.slabWell}><div className={styles.slabCard}>{card}</div></div>
    </div>
  )
}

function TeamLogo({ src, abbr, color }) {
  const [bad, setBad] = useState(false)
  return src && !bad
    ? <img className={styles.oppLogo} src={src} alt={abbr} onError={() => setBad(true)} />
    : <span className={styles.oppMark} style={{ '--oc': color || '#173657' }}>{abbr}</span>
}

/**
 * props: name, row (this game's box-score row), game, sd (season data), team (info: name, color, code),
 *        logo (url|null), headshot (url|null), career (elo.json player|null), peakRank, onProfile, onClose
 */
export default function PlayerCard({ name, row, game, sd, team, logo, headshot, career, peakRank, bestRank, onProfile, onClose, onBinder, onCareer }) {
  const [flipped, setFlipped] = useState(false)
  const ref = useRef(null)
  const backNameRef = useRef(null)
  const tier = cardTier(row)
  const season = useMemo(() => seasonLine(sd, name, game.id), [sd, name, game.id])
  const avgElo = useMemo(() => {
    const h = career?.elo_history; return h?.length ? h.reduce((s, e) => s + e[1], 0) / h.length : null
  }, [career])
  // Career Elo path: 1,500 debut, then every game; this game = the entry on this game's date
  const careerPath = useMemo(() => {
    const h = career?.elo_history; if (!h?.length) return null
    const path = [1500, ...h.map(e => e[1])]
    const peak = Math.max(...path)
    const gi = h.findIndex(e => e[0] === game.date)
    const yr = d => d.slice(0, 4)
    return { path, peakAt: path.indexOf(peak), at: gi >= 0 ? gi + 1 : 0, ends: [yr(h[0][0]), yr(h[h.length - 1][0])] }
  }, [career, game.date])
  const color = team?.color || '#173657'
  const d = row.post - row.pre

  // Shrink long names to fit the back header
  useLayoutEffect(() => {
    const el = backNameRef.current; if (!el) return
    const fit = () => { let s = 24; el.style.fontSize = s + 'px'; while (el.scrollWidth > el.clientWidth && s > 14) el.style.fontSize = --s + 'px' }
    fit(); document.fonts?.ready.then(fit)
  }, [name])

  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } else if (e.key === 'f' || e.key === 'F') setFlipped(f => !f) }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])

  const tilt = e => {
    const el = ref.current; if (!el || e.pointerType === 'touch') return
    if (e.target.closest('button')) return // hold still under buttons so clicks land
    const b = el.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height
    el.style.setProperty('--rx', `${(0.5 - y) * 14}deg`); el.style.setProperty('--ry', `${(x - 0.5) * 18}deg`)
    el.style.setProperty('--mx', `${x * 100}%`); el.style.setProperty('--my', `${y * 100}%`)
  }
  const untilt = () => {
    const el = ref.current; if (!el) return
    el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg')
  }

  const FlipBtn = () => (
    <button type="button" className={styles.flipBtn} title="Flip card (F)" aria-label="Flip card"
      onClick={e => { e.stopPropagation(); setFlipped(f => !f) }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
    </button>
  )

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.stage} onClick={e => e.stopPropagation()}>
        {momentsFor(row).career && <SlabLabel row={row} game={game} kind="Career game" className={styles.slabTop} />}
        <div ref={ref} className={`${styles.card} ${flipped ? styles.flipped : ''}`} {...cardAttrs(row, game)}
          style={{ '--tc': color }} onPointerMove={tilt} onPointerLeave={untilt}>
          <div className={styles.tilt}><div className={styles.flip} onClick={e => { if (!e.target.closest('button')) setFlipped(f => !f) }}>
            {/* ── Front ── */}
            <div className={`${styles.face} ${styles.front}`}>
              <CardFront name={name} row={row} game={game} team={team} headshot={headshot} />
              <FlipBtn />
            </div>

            {/* ── Back ── */}
            <div className={`${styles.face} ${styles.back}`}>
              <div className={styles.backIn}>
                <div className={styles.backHead}>
                  <div>
                    <div ref={backNameRef} className={styles.backName}>{baseName(name)}</div>
                    <div className={styles.backSub}>{team?.name} · {sd.season}</div>
                  </div>
                  <span className={styles.tierTag}>{tier.label}</span>
                </div>

                <section>
                  <h4>This game <span>{fmtDate(game.date)} {game.home === false ? '@' : 'vs'} {game.oppAbbr}</span></h4>
                  <div className={styles.grid5}>
                    <div><b>{row.pts ?? '—'}</b><small>PTS</small></div>
                    <div><b>{row.trb ?? '—'}</b><small>REB</small></div>
                    <div><b>{row.ast ?? '—'}</b><small>AST</small></div>
                    <div><b>{Number.isInteger(row.w) ? row.w : row.w.toFixed(1)}<i>/{game.players.length - 1}</i></b><small>Duels</small></div>
                    <div><b className={d >= 0 ? styles.up : styles.down}>{sgn(d)}</b><small>Elo Δ</small></div>
                  </div>
                </section>

                {season && <section>
                  <h4>{sd.season} season <span>{season.gp} game{season.gp === 1 ? '' : 's'}</span></h4>
                  <div className={styles.grid5}>
                    <div><b>{f1(season.pts)}</b><small>PPG</small></div>
                    <div><b>{season.hasReb ? f1(season.trb) : '—'}</b><small>RPG</small></div>
                    <div><b>{season.hasAst ? f1(season.ast) : '—'}</b><small>APG</small></div>
                    <div><b>{season.duelPct == null ? '—' : (season.duelPct * 100).toFixed(1)}<i>%</i></b><small>Duel %</small></div>
                    <div><b className={season.end >= season.start ? styles.up : styles.down}>{sgn(season.end - season.start)}</b><small>Elo Δ</small></div>
                  </div>
                  <EloChart path={season.path} peakAt={season.peakAt} at={season.at} color={color} />
                </section>}

                {career && <section>
                  <h4>Career</h4>
                  <div className={styles.grid5}>
                    <div><b>{career.games_played.toLocaleString()}</b><small>Games</small></div>
                    <div><b>{r0(career.current_elo)}</b><small>Elo</small></div>
                    <div><b>{r0(career.peak_elo)}</b><small>Peak Elo</small></div>
                    <div><b>{r0(avgElo)}</b><small>Avg Elo</small></div>
                    <div><b>{bestRank ? ordinal(bestRank[0]) : '—'}</b><small>Best rank</small></div>
                  </div>
                  {careerPath && <EloChart path={careerPath.path} peakAt={careerPath.peakAt} at={careerPath.at} color={color} H={88} ends={careerPath.ends} />}
                </section>}
              </div>
              <FlipBtn />
            </div>
          </div></div>
        </div>
        <div className={styles.hint}>Tap the card to flip<span className={styles.keyHint}> · Esc to close</span>
          {onBinder && <button type="button" className={styles.binderBtn} onClick={onBinder}>Open {sd.season} binder</button>}
          {onCareer && <button type="button" className={styles.binderBtn} onClick={onCareer}>Career binder</button>}</div>
      </div>
    </div>
  )
}
