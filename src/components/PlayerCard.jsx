import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import styles from './PlayerCard.module.css'
import { Serial } from './SpecialCards'
import './eraFonts.css'
import { useCareerHistory } from '../history.js'

// Rarity by where the player stood entering this game: his pre-game Elo rank among every
// player in that season (same tier names as the Franchise Tenures cards)
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
// A player with no games in the ratings yet (tonight's debut, before the nightly update) has no first game on record:
// his live row says so instead (gp = games before this one, 0; or no ratings match at all)
// (pipeline rows count this game in gp, so there a debut is gp 1)
const freshRow = row => !!row && ('espnName' in row ? row.unrated || row.gp === 0 : row.gp === 1)
const isRookieGame = (name, date, row) => { const f = firstGame(name); return f ? !!date && seasonOf(f) === seasonOf(date) : freshRow(row) }
const isDebutGame = (name, date, row) => { const f = firstGame(name); return f ? f === date : freshRow(row) }
// Older cards show their age: vintage before 1980, light wear through 1999
// Card designs follow the decade: Classic 1946–59, Groove 1960–79, Stripe 1980–89, Edge 1990–99,
// Refractor 2000–19, then today's design. The tier foil, honors, playoff band, aging and score bar ride on top.
export const eraOf = date => {
  if (!date) return null
  const s = seasonOf(date)
  return s < 1959 ? 'classic' : s < 1979 ? 'groove' : s < 1989 ? 'stripe' : s < 1999 ? 'edge' : s < 2019 ? 'refractor' : null
}
// Second team colors for the Stripe era's diagonal stripes (current franchises); others get gold
const TC2 = { ATL: '#C1D32F', BOS: '#BA9653', BKN: '#FFFFFF', CHO: '#00788C', CHI: '#000000', CLE: '#FDBB30', DAL: '#B8C4CA', DEN: '#FEC524', DET: '#1D42BA',
  GSW: '#FFC72C', HOU: '#C4CED4', IND: '#FDBB30', LAC: '#1D428A', LAL: '#FDB927', MEM: '#12173F', MIA: '#F9A01B', MIL: '#EEE1C6', MIN: '#78BE20', NOP: '#C8102E',
  NYK: '#F58426', OKC: '#EF3B24', ORL: '#C4CED4', PHI: '#ED174C', PHO: '#E56020', POR: '#E03A3E', SAC: '#63727A', SAS: '#C4CED4', TOR: '#A1A1A4', UTA: '#F9A01B', WAS: '#E31837',
  SEA: '#FFC200', NJN: '#C4CED4', KCK: '#FFFFFF', SDC: '#F58426', BUF: '#FFFFFF', VAN: '#E43C40', CHH: '#5C2F83', WSB: '#C8102E', NOH: '#FDB927' }
const NICK2 = ['Trail Blazers']
const splitTeam = n => { const two = NICK2.find(w => (n || '').endsWith(w)); const nick = two || (n || '').split(' ').pop(); return { nick, city: (n || '').slice(0, (n || '').length - nick.length).trim() } }
const ageOf = date => { if (!date) return undefined; const s = seasonOf(date); return s < 1979 ? 'vintage' : s < 1999 ? 'worn' : undefined }

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
  // A label goes where the line isn't: try above and below the dot, nearer first, and take the first spot clear of the line and the peak label
  const placeGame = () => {
    const text = `This game ${Math.round(path[at]).toLocaleString()}`, w = text.length * 5.3
    const { x: lx, a } = lab(at), x0 = a === 'end' ? lx - w : a === 'start' ? lx : lx - w / 2, x1 = x0 + w
    const cy = y(path[at]), top = 9, bottom = H - B + (ends ? 0 : 10)
    const pk = at !== peakAt ? (() => { const p = lab(peakAt), pw = 50, px0 = p.a === 'end' ? p.x - pw : p.a === 'start' ? p.x : p.x - pw / 2; return [px0, px0 + pw, y(path[peakAt]) - 16, y(path[peakAt]) - 4] })() : null
    const near = []
    for (let i = 0; i < path.length; i++) { const px = x(i); if (px >= x0 - 2 && px <= x1 + 2) near.push(y(path[i])) }
    const hits = base => near.filter(v => v >= base - 9 && v <= base + 3).length + (pk && x1 > pk[0] && x0 < pk[1] && base > pk[2] && base - 8 < pk[3] ? 99 : 0)
    const tries = [cy + 16, cy - 9, cy + 26, cy - 19, cy + 36, cy - 29].filter(b => b - 8 >= top - 9 && b <= bottom)
    let best = tries[0] ?? Math.min(cy + 16, H - 2), score = Infinity
    for (const b of tries) { const h = hits(b); if (h < score) { best = b; score = h } if (!h) break }
    return { text, x: lx, a, base: best }
  }
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {ticks.map((v, i) => <g key={i}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e2ddd0" strokeDasharray={i === 1 ? '2 3' : ''} />
        <text x={L - 5} y={y(v) + 3} textAnchor="end" className={styles.tick}>{Math.round(v).toLocaleString()}</text>
      </g>)}
      <polyline points={`${x(0)},${H - B} ${pts} ${x(path.length - 1)},${H - B}`} fill={color} opacity=".1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(peakAt)} cy={y(path[peakAt])} r="4.5" fill="#e7c160" stroke="#8a6a12" strokeWidth="1" />
      <text x={lab(peakAt).x} y={y(path[peakAt]) - 7} textAnchor={lab(peakAt).a} className={styles.peakLab} stroke="#fff" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke">{at === peakAt ? 'Peak · this game' : 'Peak'} {Math.round(path[peakAt]).toLocaleString()}</text>
      {ends && <>
        <text x={L} y={H - 6} textAnchor="start" className={styles.tick}>{ends[0]}</text>
        <text x={W - R - 34} y={H - 6} textAnchor="end" className={styles.tick}>{ends[1]}</text>
      </>}
      {at > 0 && at !== peakAt && <>
        <circle cx={x(at)} cy={y(path[at])} r="5.5" fill="#fff" stroke={color} strokeWidth="2.5" />
        {(g => <text x={g.x} y={g.base} textAnchor={g.a} className={styles.gameLab} fill={color} stroke="#fff" strokeWidth="3" strokeLinejoin="round" paintOrder="stroke">{g.text}</text>)(placeGame())}
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
// Ruby: the Player of the Day card you called in Predictions. Near-black with glowing red veins and a neon ruby edge.
export function RubyFront({ name, row, game, team, headshot }) {
  const [bad, setBad] = useState(false)
  const lastRef = useRef(null)
  const [first, ...rest] = baseName(name).split(' ')
  const last = rest.join(' ') || first
  const [us, them] = (game.score || '').split('–')
  useLayoutEffect(() => {
    const el = lastRef.current; if (!el) return
    const fit = () => { let s = 46; el.style.fontSize = s + 'px'; while (el.scrollWidth > el.clientWidth + 1 && s > 20) el.style.fontSize = --s + 'px' }
    fit(); document.fonts?.ready.then(fit)
  }, [name])
  return (
    <div className={`${styles.frame} ${styles.ruby}`} data-front="ruby">
      <div className={styles.rbVeins} /><div className={styles.rbCracks} />
      <div className={styles.rbPhoto}>{headshot && !bad ? <img src={headshot} alt={baseName(name)} onError={() => setBad(true)} /> : <span>{first[0]}{last[0]}</span>}</div>
      <div className={styles.rbShade} />
      <div className={styles.rbCalled}>CALLED IT</div>
      <div className={styles.rbName}><small>{first !== last ? first : ''}</small><b ref={lastRef}>{last}</b></div>
      <div className={styles.rbMeta}>PLAYER OF THE DAY · {fmtDay(game.date)} {game.home === false ? '@' : 'vs'} {game.oppAbbr}</div>
      <div className={styles.rbScore}><span>{team?.abbr} {us}</span><em>Final{game.ot ? `/${game.ot}` : ''}</em><span>{game.oppAbbr} {them}</span></div>
      <div className={styles.rbStats}>
        <div><b>{row.pts ?? '—'}</b><small>PTS</small></div><div><b>{row.trb ?? '—'}</b><small>REB</small></div>
        <div><b>{row.ast ?? '—'}</b><small>AST</small></div><div><b>{row.gs == null ? '—' : row.gs.toFixed(1)}</b><small>GmSc</small></div>
      </div>
      <div className={styles.rbEdge} />
    </div>
  )
}

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
  const rookie = isRookieGame(name, game.date, row)
  // One front per card: a career debut is a ticket stub, a statistical feat is a stat-line insert
  const debut = isDebutGame(name, game.date, row)
  const feats = useMemo(() => (debut ? [] : featsFor(row)), [row, debut])
  const variant = debut ? 'debut' : feats.length ? 'stat' : 'std'
  const era = variant === 'std' ? eraOf(game.date) : null
  const ERA_MAX = { classic: 42, groove: 30, stripe: 30, edge: 60, refractor: 27 }
  useLayoutEffect(() => {
    const el = lastRef.current; if (!el) return
    // Measure the text itself (scrollWidth rounds, which let italic overhang trigger the ellipsis);
    // divide out any scale transform so binder minis fit the same way
    const textW = () => {
      const r = document.createRange(); r.selectNodeContents(el)
      const k = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1
      return r.getBoundingClientRect().width / k
    }
    const max = era ? ERA_MAX[era] : variant === 'std' ? 70 : variant === 'stat' ? 40 : 46
    const fit = () => { let s = max; el.style.fontSize = s + 'px'; while (textW() > el.clientWidth - 4 && s > 18) el.style.fontSize = --s + 'px' }
    fit(); document.fonts?.ready.then(fit)
  }, [name, variant, era])
  const shot = (cls, monoCls) => headshot && !imgBad
    ? <img className={cls} src={headshot} alt={baseName(name)} onError={() => setImgBad(true)} />
    : <span className={monoCls}>{first[0]}{last[0]}</span>
  const [us, them] = (game.score || '').split('–')
  return (
    <div className={styles.frame} data-front={variant} data-era={era || undefined}>
      <div className={styles.photo}>
        <div className={styles.photoBg} />
        {/* foil sits behind the player so the headshot stays crisp */}
        <div className={styles.rays} /><div className={styles.holo} /><div className={styles.glitter} /><div className={styles.shine} />
        {variant === 'std' && !era && <>
          <span className={styles.bigNum}>{r0(row.post)}</span>
          {shot(styles.shot, styles.mono)}
          <div className={styles.fade} />
        </>}
        {era && (() => {
          const tn = splitTeam(team?.name), when = `${fmtDay(game.date)} ${where} ${game.oppAbbr}`
          const result = game.live ? `In progress ${game.score || ''}`.trim() : game.score ? `${game.won ? 'W' : 'L'} ${game.score}` : ''
          // The photo window carries the tier foil (and honor rays) in every era
          const win = cls => (
            <div className={cls}>
              <div className={styles.eraFoil}><div className={styles.rays} /><div className={styles.holo} /><div className={styles.glitter} /><div className={styles.shine} /></div>
              {shot(styles.eraShot, styles.eraMono)}
            </div>
          )
          return <div className={styles.eraFace} style={{ '--tc2': TC2[team?.abbr] || '#f2c14e' }}>
            {era === 'classic' && <>
              <div className={styles.cWin}>{win(styles.eraWin)}{rank != null && <span className={styles.cNo}>No. {rank}</span>}</div>
              <div className={styles.cPlate}>
                <span className={styles.cName}><i>{first}</i><b ref={lastRef}>{last}</b></span>
                <span className={styles.cMeta}><span>{tn.city || tn.nick}</span><span>{fmtDay(game.date)}</span><em className={game.won && !game.live ? styles.cWon : ''}>{result}</em></span>
              </div>
            </>}
            {era === 'groove' && <>
              <div className={styles.gHead}><span>{tn.nick}</span><span>{rank != null ? `#${rank}` : ''}</span></div>
              {win(styles.gWin)}
              <div className={styles.gPill}><b ref={lastRef}>{last}</b></div>
              <div className={styles.gMeta}>{when} · {result}</div>
            </>}
            {era === 'stripe' && <>
              <div className={styles.sWin}>{win(styles.eraWin)}<i className={styles.sStripeA} /><i className={styles.sStripeB} /></div>
              <div className={styles.sName}><b ref={lastRef}>{`${first} ${last}`.trim()}</b>{rank != null && <span>#{rank}</span>}</div>
              <div className={styles.sMeta}>{tn.nick} · {when} · <em>{result}</em></div>
            </>}
            {era === 'edge' && <>
              {win(styles.eWin)}
              <div className={styles.ePlate}>
                <div className={styles.eName}><b ref={lastRef}>{last}</b>{rank != null && <span>#{rank}</span>}</div>
                <div className={styles.eMeta}><span>{tn.nick} · {fmtDay(game.date)}</span><em className={game.live ? '' : game.won ? styles.eWon : styles.eLost}>{result}</em></div>
              </div>
            </>}
            {era === 'refractor' && <div className={styles.rFrame}>
              {win(styles.rWin)}
              <div className={styles.rPlate}>
                <div className={styles.rName}><b ref={lastRef}>{`${first} ${last}`.trim()}</b>{rank != null && <span>#{rank}</span>}</div>
                <div className={styles.rMeta}>{tn.nick} · {when} · {result}</div>
              </div>
            </div>}
          </div>
        })()}
        {variant === 'debut' && <div className={styles.ticket}>
          <div className={styles.stub} />
          <div className={styles.ticketBody}>
            <div className={styles.ticketHead}><span>Admit one · First game</span><b>{team?.abbr}</b></div>
            <div className={styles.ticketPhoto}>{shot(styles.ticketShot, styles.ticketMono)}<span className={styles.debutStamp}>Debut</span></div>
            <div className={styles.ticketName}><small>{first}</small><b ref={lastRef}>{last}</b></div>
            <div className={styles.ticketMeta}><b>{fmtDay(game.date)} {where} {game.oppAbbr}</b><span>{[row.pos, team?.name].filter(Boolean).join(' · ')}</span></div>
          </div>
        </div>}
        {variant === 'stat' && <div className={styles.statFace}>
          {/* Honored cards carry the date in the header placard; the numeral and its unit name the feat */}
          {!game.honor && <div className={styles.statTop}><b>{fmtDay(game.date)}</b></div>}
          <div className={styles.statBig}>
            <span style={{ '--fs': `${statSize(feats[0].big)}px` }}>{feats[0].big}</span>
            <small>{feats[0].unit}</small>
          </div>
          {feats.length > 1 && <div className={styles.statMore}>{feats.slice(1).map(f => <span key={f.key}>+ {f.label}</span>)}</div>}
          <div className={styles.statWho}>
            <span className={styles.statShot}>{shot(styles.statImg, styles.statMono)}</span>
            <span className={styles.statName}><small>{first}</small><b ref={lastRef}>{last}</b><em>{team?.name} {where} {game.oppAbbr}</em></span>
          </div>
        </div>}
        {game.band && <div className={styles.poBand}><span>{game.band.champ ? 'Champions' : 'Playoffs'}</span><i>·</i><span>{game.band.label}</span></div>}
        {/* Honored games carry the date and matchup in a header placard (under the playoff band, if any), so the sash has room */}
        {game.honor && <div className={styles.honorBand}>
          <b>{fmtDay(game.date)}</b>
          <span className={styles.honorMatch}>
            <TeamLogo src={team?.logo} abbr={team?.abbr} color={team?.color} />
            <em>{where}</em>
            <TeamLogo src={game.oppLogo} abbr={game.oppAbbr} color={game.oppColor} />
          </span>
        </div>}
        {variant === 'std' && moments.career && <div className={styles.careerStamp}><span>★ Career game</span><b>{f1(row.gs)} <small>GmSc</small></b></div>}
        {game.honor && <div className={styles.sash}><span>{game.honor === 'potd' ? 'Player of the Day' : 'Player of the Game'}</span></div>}
        {variant === 'std' && !era && rank != null && <div className={styles.medal}>
          <span>Elo rank</span><b>#{rank}</b>
          {!!move && <i className={move > 0 ? styles.medalUp : styles.medalDown}>
            {move > 0 ? `▲ ${move}` : `▼ ${-move}`}</i>}
        </div>}
        {variant === 'std' && !era && !game.honor && <div className={styles.gameTag}>
          <b className={styles.gameDay}>{fmtDay(game.date)}</b>
          {/* Both teams, so the opponent's logo never reads as the player's own */}
          <div className={styles.matchup}>
            <TeamLogo src={team?.logo} abbr={team?.abbr} color={team?.color} />
            <span>{where}</span>
            <TeamLogo src={game.oppLogo} abbr={game.oppAbbr} color={game.oppColor} />
          </div>
        </div>}
        {variant === 'std' && !era && <div className={styles.nameOver}>
          <div className={styles.first}>{first}</div>
          <div ref={lastRef} className={styles.last}>{last}</div>
          <div className={styles.metaRow}>
            <span className={styles.meta}>{[row.pos, team?.name].filter(Boolean).join(' · ')}</span>
          </div>
        </div>}
      </div>
      {/* Final score bar: green-lit for a win, charcoal with a red rule for a loss; the winner reads bright */}
      {game.score && <div className={`${styles.scoreBar} ${game.live ? styles.barLive : game.won ? styles.barW : styles.barL}`}>
        <span className={game.live || game.won ? styles.barHi : styles.barLo}>{team?.abbr} {us}{rookie && <span className={styles.rc} title="Rookie season">RC</span>}</span>
        <em>{game.live ? 'In progress' : `Final${game.ot ? `/${game.ot}` : ''}`}</em>
        <span className={game.live || !game.won ? styles.barHi : styles.barLo}>{game.oppAbbr} {them}</span>
      </div>}
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

// Numeral size by length; the CSS scales it down further when a header band takes room
const statSize = big => (big.length <= 2 ? 190 : big.length <= 3 ? 150 : big.length <= 5 ? 118 : big.length <= 8 ? 84 : big.length <= 11 ? 64 : 52)

// Statistical feats that earn a stat-line insert, rarest first. Each: { key, label, big (the numerals), unit }
const FEAT_CATS = [['pts', 'PTS'], ['trb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK']]
export function featsFor(r) {
  const out = [], v = k => r[k] || 0
  const tens = FEAT_CATS.filter(([k]) => v(k) >= 10)
  const multi = n => ({ big: tens.map(([k]) => v(k)).join('·'), unit: tens.map(([, l]) => l).join(' · ') })
  if (tens.length >= 5) out.push({ key: 'x5', label: 'Quintuple-double', ...multi() })
  else if (tens.length === 4) out.push({ key: 'x4', label: 'Quadruple-double', ...multi() })
  if (v('pts') >= 50) { const t = Math.floor(v('pts') / 10) * 10; out.push({ key: 'pts', label: `${t}-point game`, big: String(v('pts')), unit: 'Points' }) }
  if (v('trb') >= 30) out.push({ key: 'reb', label: `${Math.floor(v('trb') / 10) * 10}-rebound game`, big: String(v('trb')), unit: 'Rebounds' })
  if (v('ast') >= 20) out.push({ key: 'ast', label: `${Math.floor(v('ast') / 10) * 10}-assist game`, big: String(v('ast')), unit: 'Assists' })
  if (v('blk') >= 10) out.push({ key: 'blk', label: '10+ blocks', big: String(v('blk')), unit: 'Blocks' })
  if (v('stl') >= 10) out.push({ key: 'stl', label: '10+ steals', big: String(v('stl')), unit: 'Steals' })
  if (v('tp') >= 10) out.push({ key: 'tp', label: '10+ threes', big: String(v('tp')), unit: 'Threes made' })
  if (tens.length === 3) out.push({ key: 'x3', label: 'Triple-double', ...multi() })
  const twenties = [['pts', 'PTS'], ['trb', 'REB'], ['ast', 'AST']].filter(([k]) => v(k) >= 20)
  if (twenties.length >= 2 && tens.length < 3) out.push({ key: '2020', label: twenties.length === 3 ? '20/20/20' : '20/20', big: twenties.map(([k]) => v(k)).join('/'), unit: twenties.map(([, l]) => l).join(' · ') })
  return out
}

/**
 * Duel cards: Giant-Slayer (the least likely duel win) and Duel (two highly rated opponents who both played well),
 * of the game (blue) or of the day (gold). a = the winner, b = the other player:
 * { name, row, color, team, abbr, headshot }. Drawn at full size (340 × 476) like MiniCard.
 * Headshots sit in corner medallions, so neither face runs under a name or the score chip.
 */
const initials = n => baseName(n).split(' ').map(w => w[0]).slice(0, 2).join('')
const splitName = n => { const [f, ...r] = baseName(n).split(' '); return { first: f, last: r.join(' ') || f } }
const duelChance = (a, b) => 1 / (1 + 10 ** ((b.row.pre - a.row.pre) / 620))
const duelTitle = (kind, scope) => `${kind === 'slayer' ? 'Giant-Slayer' : 'Duel'} of the ${scope === 'day' ? 'Day' : 'Game'}`

function Medal({ x, cls }) {
  const [bad, setBad] = useState(false)
  return (
    <span className={cls} style={{ '--c': x.color }}>
      {x.headshot && !bad ? <img src={x.headshot} alt="" onError={() => setBad(true)} /> : <i>{initials(x.name)}</i>}
    </span>
  )
}

// Shrinks a name until it fits its box (measured unscaled, so it fits the same in a pocket)
function useFit(ref, max, min, dep) {
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const fit = () => { let s = max; el.style.fontSize = s + 'px'; while (el.scrollWidth > el.clientWidth + 1 && s > min) el.style.fontSize = --s + 'px' }
    fit(); document.fonts?.ready.then(fit)
  }, [dep, max, min])
}

// live: the game is still being played, so nobody has won the duel yet
export function DuelCard({ kind, scope, a, b, date, live }) {
  const title = duelTitle(kind, scope)
  const wc = duelChance(a, b)
  const A = splitName(a.name), B = splitName(b.name)
  const ra = useRef(null), rb = useRef(null)
  useFit(ra, 42, 20, a.name); useFit(rb, 30, 14, b.name)
  return (
    <div className={styles.duel} data-scope={scope} data-kind={kind} data-card-shot={`${duelTitle(kind, scope)} ${baseName(a.name)} ${baseName(b.name)} ${date || ''}`}>
      <div className={styles.duelHead} data-long={title.length > 20 ? '' : undefined}>{title}</div>
      <div className={styles.duelBody}>
        <div className={styles.duelTop} style={{ '--c': a.color }}><span className={styles.duelWater}>{a.abbr}</span></div>
        <div className={styles.duelBot} style={{ '--c': b.color }}><span className={styles.duelWater}>{b.abbr}</span></div>
        <Medal x={a} cls={styles.duelMedA} />
        <Medal x={b} cls={styles.duelMedB} />
        <div className={styles.duelAGs}><span>{live ? 'In progress' : 'Winner'}</span><b>{f1(a.row.gs)}</b><small>Game Score</small></div>
        <div className={styles.duelA}><small>{A.first}</small><b ref={ra}>{A.last}</b><em>{a.team} · Elo {r0(a.row.pre)}</em></div>
        <div className={styles.duelChip}>
          {kind === 'slayer' ? <><b>{Math.max(1, Math.round(wc * 100))}%</b><small>Pre-game duel chance</small></>
            : <><b>{f1(a.row.gs)}–{f1(b.row.gs)}</b><small>Game Score</small></>}
        </div>
        <div className={styles.duelB}><small>{live ? 'vs' : kind === 'slayer' ? 'Beat' : 'Over'} {B.first !== B.last ? B.first : ''}</small><b ref={rb}>{B.last}</b><em>{f1(b.row.gs)} GmSc · {b.team} · {r0(b.row.pre)}</em></div>
        <div className={styles.duelFoot}><span>{fmtDay(date)}</span><span>{kind === 'slayer' ? `Elo gap ${r0(b.row.pre - a.row.pre)}` : `${Math.round(wc * 100)}% pre-game`}</span></div>
      </div>
    </div>
  )
}

// Two Elo paths on one time axis: the winner solid, the other dashed; a rule marks this game
function JointChart({ series, mark, H = 104, fmt }) {
  const all = series.flatMap(s => s.pts)
  if (all.length < 3) return <div className={styles.chartEmpty}>Not enough games yet</div>
  const W = 300, L = 38, R = 8, T = 22, B = 18
  const xs = all.map(p => p[0]), vs = all.map(p => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1
  const lo0 = Math.min(...vs), hi0 = Math.max(...vs), pad = Math.max(8, (hi0 - lo0) * 0.1), lo = lo0 - pad, hi = hi0 + pad
  const x = t => L + ((t - x0) / (x1 - x0 || 1)) * (W - L - R)
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const line = pts => {
    const step = Math.max(1, Math.floor(pts.length / 260))
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')
  }
  const ticks = [lo0, (lo0 + hi0) / 2, hi0]
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {ticks.map((v, i) => <g key={i}>
        <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e2ddd0" strokeDasharray={i === 1 ? '2 3' : ''} />
        <text x={L - 5} y={y(v) + 3} textAnchor="end" className={styles.tick}>{Math.round(v).toLocaleString()}</text>
      </g>)}
      {mark != null && mark >= x0 && mark <= x1 && <>
        <line x1={x(mark)} x2={x(mark)} y1={T - 4} y2={H - B} stroke="#1d2633" strokeOpacity=".35" strokeDasharray="3 3" />
        <text x={x(mark)} y={H - 5} textAnchor={x(mark) > W - 60 ? 'end' : x(mark) < L + 30 ? 'start' : 'middle'} className={styles.tick}>This game</text>
      </>}
      {series.map((s, i) => <polyline key={i} points={line(s.pts)} fill="none" stroke={s.color} strokeWidth={i ? 1.8 : 2.2} strokeDasharray={i ? '5 3' : ''} strokeLinejoin="round" />)}
      {series.map((s, i) => {
        const txt = `${s.label} ${s.pts.length ? Math.round(s.pts[s.pts.length - 1][1]).toLocaleString() : ''}`
        return i === 0
          ? <g key={'k' + i}><line x1={L} x2={L + 14} y1="10" y2="10" stroke={s.color} strokeWidth="2.2" /><text x={L + 18} y="13" className={styles.legendLab}>{txt}</text></g>
          : <g key={'k' + i}><text x={W - R - 18} y="13" textAnchor="end" className={styles.legendLab}>{txt}</text><line x1={W - R - 14} x2={W - R} y1="10" y2="10" stroke={s.color} strokeWidth="2" strokeDasharray="5 3" /></g>
      })}
      {fmt && <>
        {!(mark != null && x(mark) < L + 56) && <text x={L} y={H - 5} textAnchor="start" className={styles.tick}>{fmt(x0)}</text>}
        {!(mark != null && x(mark) > W - R - 70) && <text x={W - R} y={H - 5} textAnchor="end" className={styles.tick}>{fmt(x1)}</text>}
      </>}
    </svg>
  )
}

function FlipButton({ onFlip }) {
  return (
    <button type="button" className={styles.flipBtn} title="Flip card (F)" aria-label="Flip card"
      onClick={e => { e.stopPropagation(); onFlip() }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
    </button>
  )
}

// Draws a fixed 340 × 476 card scaled to its box
function Scaled({ children }) {
  const ref = useRef(null)
  const [k, setK] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const fit = () => { if (el.clientWidth) setK(el.clientWidth / 340) }
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect()
  }, [])
  return <div ref={ref} className={styles.scaled}><div style={{ transform: `scale(${k})`, transformOrigin: 'top left', width: 340, height: 476 }}>{children}</div></div>
}

const dayNum = d => Date.parse(d + 'T12:00:00Z') / 864e5
const seasonPts = (sd, name) => {
  const out = []
  ;[...sd.games].sort((p, q) => p.date.localeCompare(q.date) || p.id.localeCompare(q.id)).forEach(g => {
    const p = g.players.find(r => r.n === name); if (!p) return
    if (!out.length) out.push([dayNum(g.date) - 1, p.pre])
    out.push([dayNum(g.date), p.post])
  })
  return out
}

/**
 * The duel card, full size and flippable. The back: both lines from the game, the pre-game odds,
 * and the two players' Elo through the season and across their careers on shared axes.
 * a, b as DuelCard, plus careerA / careerB (elo_history: [[date, elo], ...]); sd = the season's games
 */
export function DuelModal({ kind, scope, a, b, date, matchup, sd, careerA: cA, careerB: cB, onClose, onBox, live }) {
  const hv = useCareerHistory()
  // Careers may arrive after the modal opens: getters read them on every draw
  const careerA = typeof cA === 'function' ? cA() : cA, careerB = typeof cB === 'function' ? cB() : cB
  const [flipped, setFlipped] = useState(false)
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } else if (e.key === 'f' || e.key === 'F') setFlipped(f => !f) }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
  const wc = duelChance(a, b)
  const short = n => { const { first, last } = splitName(n); return first === last ? last : `${first[0]}. ${last}` }
  const lastOf = n => splitName(n).last
  const titleRef = useRef(null)
  useFit(titleRef, 24, 15, kind + scope)
  const season = useMemo(() => sd ? [
    { pts: seasonPts(sd, a.name), color: a.color, label: lastOf(a.name) },
    { pts: seasonPts(sd, b.name), color: b.color, label: lastOf(b.name) },
  ] : null, [sd, a.name, b.name])
  const career = useMemo(() => {
    const pts = (h, name) => (h || []).map(e => [dayNum(e[0]), e[1]])
    if (!careerA?.length && !careerB?.length) return null
    return [
      { pts: pts(careerA, a.name), color: a.color, label: lastOf(a.name) },
      { pts: pts(careerB, b.name), color: b.color, label: lastOf(b.name) },
    ]
  }, [careerA, careerB, a.name, b.name, hv])
  const yr = t => new Date(t * 864e5).getUTCFullYear()
  const mo = t => new Date(t * 864e5).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  const line = (x, won) => {
    const d = x.row.post - x.row.pre
    return (
      <div className={styles.dRow} style={{ '--c': x.color }}>
        <span className={styles.dWho} title={`${baseName(x.name)} · ${x.team}`}><i />{short(x.name)}</span>
        <b>{x.row.pts ?? '—'}</b><b>{x.row.trb ?? '—'}</b><b>{x.row.ast ?? '—'}</b>
        <b className={won ? styles.dWin : ''}>{f1(x.row.gs)}</b>
        <b className={d >= 0 ? styles.up : styles.down}>{sgn(d)}</b>
      </div>
    )
  }
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.stage} onClick={e => e.stopPropagation()}>
        <div className={`${styles.card} ${flipped ? styles.flipped : ''}`} style={{ '--tc': scope === 'day' ? '#9a7316' : '#0b5f9e' }}>
          <div className={styles.tilt}><div className={styles.flip} onClick={e => { if (!e.target.closest('button')) setFlipped(f => !f) }}>
            <div className={`${styles.face} ${styles.front} ${styles.duelFace}`}>
              <Scaled><DuelCard kind={kind} scope={scope} a={a} b={b} date={date} live={live} /></Scaled>
              <FlipButton onFlip={() => setFlipped(f => !f)} />
            </div>
            <div className={`${styles.face} ${styles.back}`}>
              <div className={styles.backIn}>
                <div className={styles.backHead}>
                  <div>
                    <div ref={titleRef} className={styles.backName}>{duelTitle(kind, scope)}</div>
                    <div className={styles.backSub}>{fmtDate(date)}{matchup ? ` · ${matchup}` : ''}</div>
                  </div>
                  <span className={styles.tierTag}>{kind === 'slayer' ? `${Math.max(1, Math.round(wc * 100))}%` : 'H2H'}</span>
                </div>
                <section>
                  <h4>This game <span>{live ? 'in progress' : kind === 'slayer' ? 'least likely duel win' : 'two stars, both playing well'}</span></h4>
                  <div className={styles.dTable}>
                    <div className={`${styles.dRow} ${styles.dHead}`}><span /><small>PTS</small><small>REB</small><small>AST</small><small>GmSc</small><small>Elo Δ</small></div>
                    {line(a, !live)}{line(b, false)}
                  </div>
                  <p className={styles.dNote}>Pre-game: Elo {r0(a.row.pre)} vs {r0(b.row.pre)} · {Math.max(1, Math.round(wc * 100))}% duel win chance</p>
                </section>
                {season && <section>
                  <h4>{sd.season} season <span>Elo after each game</span></h4>
                  <JointChart series={season} mark={dayNum(date)} fmt={mo} H={86} />
                </section>}
                {career && <section>
                  <h4>Careers <span>Elo after each game</span></h4>
                  <JointChart series={career} mark={dayNum(date)} fmt={yr} H={82} />
                </section>}
              </div>
              <FlipButton onFlip={() => setFlipped(f => !f)} />
            </div>
          </div></div>
        </div>
        <div className={styles.hint}>Tap the card to flip<span className={styles.keyHint}> · Esc to close</span>
          {onBox && <button type="button" className={styles.binderBtn} onClick={onBox}>Box score</button>}</div>
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
    'data-age': ageOf(game.date),
    'data-ruby': game.ruby ? '' : undefined,
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
    <div className={`${styles.card} ${styles.miniCard}`} {...cardAttrs(row, game)} style={{ '--tc': team?.color || '#173657' }} data-card-shot={`${baseName(name)} ${game?.date || ''}`}>
      <div className={`${styles.face} ${styles.front}`}>{game?.ruby ? <RubyFront name={name} row={row} game={game} team={team} headshot={headshot} /> : <CardFront name={name} row={row} game={game} team={team} headshot={headshot} />}</div>
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
export default function PlayerCard({ name, row, game, sd, team, logo, headshot, career, peakRank, bestRank, onProfile, onClose, onBinder, onCareer, serial }) {
  const hv = useCareerHistory()   // the back charts his career (the version re-runs the memos when it lands)
  const [flipped, setFlipped] = useState(false)
  const ref = useRef(null)
  const backNameRef = useRef(null)
  const tier = cardTier(row)
  const season = useMemo(() => seasonLine(sd, name, game.id), [sd, name, game.id])
  const avgElo = useMemo(() => {
    const h = career?.elo_history; return h?.length ? h.reduce((s, e) => s + e[1], 0) / h.length : null
  }, [career, hv])
  // Career Elo path: 1,500 debut, then every game; this game = the entry on this game's date
  const careerPath = useMemo(() => {
    const h = career?.elo_history; if (!h?.length) return null
    const path = [1500, ...h.map(e => e[1])]
    const peak = Math.max(...path)
    const gi = h.findIndex(e => e[0] === game.date)
    const yr = d => d.slice(0, 4)
    return { path, peakAt: path.indexOf(peak), at: gi >= 0 ? gi + 1 : 0, ends: [yr(h[0][0]), yr(h[h.length - 1][0])] }
  }, [career, game.date, hv])
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

  const FlipBtn = () => <FlipButton onFlip={() => setFlipped(f => !f)} />

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.stage} onClick={e => e.stopPropagation()}>
        {momentsFor(row).career && <SlabLabel row={row} game={game} kind="Career game" className={styles.slabTop} />}
        <div ref={ref} className={`${styles.card} ${flipped ? styles.flipped : ''}`} {...cardAttrs(row, game)}
          style={{ '--tc': color }} onPointerMove={tilt} onPointerLeave={untilt}>
          <div className={styles.tilt}><div className={styles.flip} onClick={e => { if (!e.target.closest('button')) setFlipped(f => !f) }}>
            {/* ── Front ── */}
            <div className={`${styles.face} ${styles.front}`} data-card-shot={`${baseName(name)} ${game.date}`}>
              {game.ruby ? <RubyFront name={name} row={row} game={game} team={team} headshot={headshot} /> : <CardFront name={name} row={row} game={game} team={team} headshot={headshot} />}
              {serial && <Serial k={serial[0]} n={serial[1]} flip />}
              <FlipBtn />
            </div>

            {/* ── Back ── */}
            <div className={`${styles.face} ${styles.back}`} data-card-shot={`${baseName(name)} ${game.date} back`}>
              <div className={styles.backIn}>
                <div className={styles.backHead}>
                  <div>
                    <div ref={backNameRef} className={styles.backName}>{baseName(name)}</div>
                    <div className={styles.backSub}>{team?.name} · {sd.season}</div>
                  </div>
                  <span className={styles.tierTag}>{game.ruby ? `Ruby ${tier.label}` : tier.label}</span>
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
