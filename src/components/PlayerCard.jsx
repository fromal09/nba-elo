import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import styles from './PlayerCard.module.css'

// Rarity by where the player stood entering this game: his pre-game Elo rank among every
// player in that season (same tier names as the Franchise Tenures cards)
export const TIERS = [
  { id: 'goat', label: '★ GOAT', max: 5 },
  { id: 'icon', label: 'Icon', max: 20 },
  { id: 'legend', label: 'Legend', max: 50 },
  { id: 'rare', label: 'Rare', max: 125 },
  { id: 'common', label: 'Common', max: Infinity },
]
export const tierFor = rank => TIERS.find(t => rank != null && rank <= t.max) || TIERS[TIERS.length - 1]

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

// Season Elo path with a y-axis, the season peak and this game marked
function SeasonChart({ path, peakAt, at, color }) {
  if (path.length < 2) return <div className={styles.chartEmpty}>Elo path appears after a second game</div>
  const W = 300, H = 100, L = 38, R = 8, T = 14, B = 14
  const lo0 = Math.min(...path), hi0 = Math.max(...path), pad = Math.max(8, (hi0 - lo0) * 0.12)
  const lo = lo0 - pad, hi = hi0 + pad
  const x = i => L + (i / (path.length - 1)) * (W - L - R)
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const pts = path.map((v, i) => `${x(i)},${y(v)}`).join(' ')
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
      {at > 0 && at !== peakAt && <>
        <circle cx={x(at)} cy={y(path[at])} r="5.5" fill="#fff" stroke={color} strokeWidth="2.5" />
        <text x={lab(at).x} y={Math.min(y(path[at]) + 16, H - 2)} textAnchor={lab(at).a} className={styles.gameLab} fill={color}>This game {Math.round(path[at]).toLocaleString()}</text>
      </>}
    </svg>
  )
}

/**
 * props: name, row (this game's box-score row), game, sd (season data), team (info: name, color, code),
 *        logo (url|null), headshot (url|null), career (elo.json player|null), peakRank, onProfile, onClose
 */
export default function PlayerCard({ name, row, game, sd, team, logo, headshot, career, peakRank, bestRank, onProfile, onClose }) {
  const [flipped, setFlipped] = useState(false)
  const [imgBad, setImgBad] = useState(false)
  const ref = useRef(null)
  const lastRef = useRef(null)
  const backNameRef = useRef(null)
  const tier = tierFor(row.lr)
  const season = useMemo(() => seasonLine(sd, name, game.id), [sd, name, game.id])
  const avgElo = useMemo(() => {
    const h = career?.elo_history; return h?.length ? h.reduce((s, e) => s + e[1], 0) / h.length : null
  }, [career])
  const [first, ...rest] = baseName(name).split(' ')
  const last = rest.join(' ') || first
  const color = team?.color || '#173657'
  const d = row.post - row.pre

  // Shrink long last names to fit the plate
  useLayoutEffect(() => {
    const el = lastRef.current; if (!el) return
    const fitEl = (e, max, min) => { if (!e) return; let s = max; e.style.fontSize = s + 'px'; while (e.scrollWidth > e.clientWidth && s > min) e.style.fontSize = --s + 'px' }
    const fit = () => { fitEl(el, 34, 18); fitEl(backNameRef.current, 24, 14) }
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
      onClick={e => { e.stopPropagation(); setFlipped(f => !f) }}>↻</button>
  )

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.stage} onClick={e => e.stopPropagation()}>
        <div ref={ref} className={`${styles.card} ${flipped ? styles.flipped : ''}`} data-tier={tier.id}
          style={{ '--tc': color }} onPointerMove={tilt} onPointerLeave={untilt}>
          <div className={styles.tilt}><div className={styles.flip} onClick={e => { if (!e.target.closest('button')) setFlipped(f => !f) }}>
            {/* ── Front ── */}
            <div className={`${styles.face} ${styles.front}`}>
              <div className={styles.frame}>
                <div className={styles.top}>
                  <span className={styles.tierTag}>{tier.label}</span>
                  <span className={styles.season}>{sd.season}</span>
                </div>
                <div className={styles.photo}>
                  <div className={styles.photoBg} />
                  <span className={styles.bigNum}>{r0(row.post)}</span>
                  {headshot && !imgBad
                    ? <img className={styles.shot} src={headshot} alt={baseName(name)} onError={() => setImgBad(true)} />
                    : <span className={styles.mono}>{first[0]}{last[0]}</span>}
                  {logo
                    ? <img className={styles.logo} src={logo} alt="" />
                    : <span className={styles.logoMark}>{team?.abbr}</span>}
                </div>
                <div className={styles.plate}>
                  <div className={styles.first}>{first}</div>
                  <div ref={lastRef} className={styles.last}>{last}</div>
                  <div className={styles.meta}>{[row.pos, team?.name].filter(Boolean).join(' · ')}</div>
                </div>
                <div className={styles.strip}>
                  <div><small>Elo</small><b>{r0(row.post)}</b><em className={d >= 0 ? styles.up : styles.down}>{sgn(d)}</em></div>
                  <div><small>Season peak</small><b>{r0(season?.peak)}</b></div>
                  <div><small>All-time peak</small><b>{r0(career?.peak_elo)}</b>{peakRank && <em>#{peakRank.toLocaleString()}</em>}</div>
                </div>
              </div>
              <div className={styles.holo} /><div className={styles.glitter} /><div className={styles.shine} />
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
                  <SeasonChart path={season.path} peakAt={season.peakAt} at={season.at} color={color} />
                </section>}

                {career && <section>
                  <h4>Career</h4>
                  <div className={styles.grid5}>
                    <div><b>{career.games_played.toLocaleString()}</b><small>Games</small></div>
                    <div><b>{r0(career.current_elo)}</b><small>{career.is_fpr_eligible ? 'Current' : 'Final'} Elo</small></div>
                    <div><b>{r0(career.peak_elo)}</b><small>Peak Elo</small></div>
                    <div><b>{r0(avgElo)}</b><small>Avg Elo</small></div>
                    <div><b>{bestRank ? ordinal(bestRank[0]) : '—'}</b><small>Best rank</small></div>
                  </div>
                  {bestRank && <div className={styles.note}>Best rank among active players: {ordinal(bestRank[0])} in {bestRank[1]}</div>}
                </section>}

                <div className={styles.backFoot}>
                  {career && <button type="button" className={styles.profile} onClick={() => onProfile(name)}>Full profile →</button>}
                  <span>#{peakRank ? peakRank.toLocaleString() : '—'} all-time peak Elo</span>
                </div>
              </div>
              <FlipBtn />
            </div>
          </div></div>
        </div>
        <div className={styles.hint}>Click the card or ↻ to flip · Esc to close</div>
      </div>
    </div>
  )
}
