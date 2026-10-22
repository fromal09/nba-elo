import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import styles from './PlayerCard.module.css'

// Rarity by all-time peak Elo rank (same five tiers as the Franchise Tenures cards)
export const TIERS = [
  { id: 'goat', label: '★ GOAT', max: 10 },
  { id: 'icon', label: 'Icon', max: 50 },
  { id: 'legend', label: 'Legend', max: 150 },
  { id: 'rare', label: 'Rare', max: 500 },
  { id: 'common', label: 'Common', max: Infinity },
]
export const tierFor = rank => TIERS.find(t => rank != null && rank <= t.max) || TIERS[TIERS.length - 1]

const r0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const f1 = v => (v == null || Number.isNaN(v) ? '—' : v.toFixed(1))
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const fmtDate = (d, o = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th')

function seasonLine(sd, name) {
  const gs = sd.games.filter(g => g.players.some(p => p.n === name))
  const rows = gs.map(g => ({ g, p: g.players.find(p => p.n === name) }))
  if (!rows.length) return null
  const avg = k => rows.reduce((s, r) => s + (r.p[k] || 0), 0) / rows.length
  const best = rows.reduce((b, r) => (!b || r.p.gs > b.p.gs ? r : b), null)
  const path = [rows[0].p.pre, ...rows.map(r => r.p.post)]
  return {
    gp: rows.length, pts: avg('pts'), trb: avg('trb'), ast: avg('ast'), gs: avg('gs'), mp: avg('mp'),
    start: rows[0].p.pre, end: rows[rows.length - 1].p.post, peak: Math.max(...path), path, best,
    hasReb: rows.some(r => r.p.trb), hasAst: rows.some(r => r.p.ast),
  }
}

function Spark({ path, color }) {
  if (path.length < 2) return null
  const W = 260, H = 54, lo = Math.min(...path), hi = Math.max(...path), span = hi - lo || 1
  const pts = path.map((v, i) => `${(i / (path.length - 1)) * W},${H - 4 - ((v - lo) / span) * (H - 8)}`).join(' ')
  return (
    <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,${H} ${pts} ${W},${H}`} fill={color} opacity=".12" stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * props: name, row (this game's box-score row), game, sd (season data), team (info: name, color, code),
 *        logo (url|null), headshot (url|null), career (elo.json player|null), peakRank, onProfile, onClose
 */
export default function PlayerCard({ name, row, game, sd, team, logo, headshot, career, peakRank, onProfile, onClose }) {
  const [flipped, setFlipped] = useState(false)
  const [imgBad, setImgBad] = useState(false)
  const ref = useRef(null)
  const lastRef = useRef(null)
  const tier = tierFor(peakRank)
  const season = useMemo(() => seasonLine(sd, name), [sd, name])
  const [first, ...rest] = baseName(name).split(' ')
  const last = rest.join(' ') || first
  const color = team?.color || '#173657'
  const d = row.post - row.pre

  // Shrink long last names to fit the plate
  useLayoutEffect(() => {
    const el = lastRef.current; if (!el) return
    const fit = () => { let s = 34; el.style.fontSize = s + 'px'; while (el.scrollWidth > el.clientWidth && s > 18) el.style.fontSize = --s + 'px' }
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
                    <div className={styles.backName}>{baseName(name)}</div>
                    <div className={styles.backSub}>{team?.name} · {sd.season}</div>
                  </div>
                  <span className={styles.tierTag}>{tier.label}</span>
                </div>

                <section>
                  <h4>This game <span>{fmtDate(game.date)} {game.home === false ? '@' : 'vs'} {game.oppAbbr}</span></h4>
                  <div className={styles.grid4}>
                    <div><b>{row.pts ?? '—'}</b><small>PTS</small></div>
                    <div><b>{row.trb ?? '—'}</b><small>REB</small></div>
                    <div><b>{row.ast ?? '—'}</b><small>AST</small></div>
                    <div><b>{row.gs.toFixed(1)}</b><small>GmSc</small></div>
                  </div>
                  <div className={styles.line}>Elo {r0(row.pre)} → <b>{r0(row.post)}</b> <em className={d >= 0 ? styles.up : styles.down}>{sgn(d)}</em> · won {Number.isInteger(row.w) ? row.w : row.w.toFixed(1)} of {game.players.length - 1} duels</div>
                </section>

                {season && <section>
                  <h4>{sd.season} season <span>{season.gp} game{season.gp === 1 ? '' : 's'}</span></h4>
                  <div className={styles.grid4}>
                    <div><b>{f1(season.pts)}</b><small>PPG</small></div>
                    <div><b>{season.hasReb ? f1(season.trb) : '—'}</b><small>RPG</small></div>
                    <div><b>{season.hasAst ? f1(season.ast) : '—'}</b><small>APG</small></div>
                    <div><b>{f1(season.gs)}</b><small>GmSc</small></div>
                  </div>
                  <Spark path={season.path} color={color} />
                  <div className={styles.line}>Elo {r0(season.start)} → <b>{r0(season.end)}</b> <em className={season.end >= season.start ? styles.up : styles.down}>{sgn(season.end - season.start)}</em> · peak {r0(season.peak)}
                    {season.gp > 1 && <> · best game <b>{season.best.p.gs.toFixed(1)}</b> GmSc, {fmtDate(season.best.g.date, { month: 'short', day: 'numeric' })}</>}</div>
                </section>}

                {career && <section>
                  <h4>Career</h4>
                  <div className={styles.grid4}>
                    <div><b>{career.games_played.toLocaleString()}</b><small>Games</small></div>
                    <div><b>{f1(career.career_gmsc_avg)}</b><small>GmSc avg</small></div>
                    <div><b>{r0(career.peak_elo)}</b><small>Peak Elo</small></div>
                    <div><b>{career.peak_fpr_rank ? ordinal(career.peak_fpr_rank) : '—'}</b><small>Best rank</small></div>
                  </div>
                  {career.badges?.length > 0 && <div className={styles.badges}>
                    {career.badges.slice(0, 4).map(b => <span key={b.id} title={b.label}>{b.emoji} {b.label}</span>)}
                  </div>}
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
