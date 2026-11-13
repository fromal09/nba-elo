import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import styles from './PlayerModal.module.css'
import { binderTeamInfo, binderLogo, binderHeadshots } from './SeasonExplorer'
import { norm } from './predict'

/*
 * The player card: a career profile (not a collectible). The hero (headshot, team, rank seal), four headline numbers, the career
 * line against the league (its No. 1, the top 10% and the median, month by month), badges as medals, career highs, and the
 * season-by-season ledger.
 *
 * Season lines come from /data/careers/<shard>.json (scripts/build_careers.py, nightly): Elo going in, at the end, at its peak and on
 * average, where he finished among players with 20+ rated games, per-game box-score averages and the best game. Until a player's
 * file is there, the card builds the Elo part of each season from his game-by-game history and leaves the box scores out.
 */

const SHARDS = 64
const shard = name => { let h = 0; for (const c of name) h = (h * 31 + c.codePointAt(0)) % SHARDS; return h }
const cache = new Map()
const getJSON = url => {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null))
  return cache.get(url)
}

const fmt = v => (v == null ? '—' : Math.round(v).toLocaleString())
const md = (d, year = true) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
const tInfo = t => binderTeamInfo(t) || {}
const tColor = t => tInfo(t).color || '#3a5578'
const initials = n => n.replace(/\s*\(.*\)$/, '').split(/[\s-]+/).map(w => w[0]).join('').slice(0, 3).toUpperCase()
const SCALE = [1500, 3150] // the ledger bars' Elo range

// Season lines from the game-by-game history, for a player whose career file isn't built yet (no ranks or box scores)
function seasonsFromHistory(h) {
  const S = new Map()
  for (const [d, e, , , t] of h || []) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7), s0 = m >= 8 ? y : y - 1, s = `${s0}-${String(s0 + 1).slice(2)}`
    if (!S.has(s)) S.set(s, [])
    S.get(s).push([e, t])
  }
  let prev = null
  return [...S].map(([s, L]) => {
    const es = L.map(x => x[0])
    const line = { s, t: [...new Set(L.map(x => x[1]))], g: L.length, st: Math.round(prev ?? es[0]), en: Math.round(es.at(-1)), pk: Math.round(Math.max(...es)), av: Math.round(es.reduce((a, b) => a + b, 0) / es.length) }
    prev = es.at(-1)
    return line
  })
}

// "955 Games at No. 1" → 955 on the medal, "Games at No. 1" under it; "Peak Rank Top 5 (#3)" → #3
function medalOf(b) {
  let label = b.label, tag = ''
  let m = label.match(/^([\d,]+) (Games? at No\. 1)$/)
  if (m) { tag = m[1]; label = 'Games at No. 1' }
  m = label.match(/^(.*?)\s*\((#\d+)\)$/)
  if (m) { label = m[1]; tag = m[2] }
  return { ...b, label, tag }
}
const CAT = { fpr: 'Rank', elo: 'Elo', longevity: 'Longevity', era: 'Era' }

function usePhone() {
  const q = '(max-width: 760px)'
  const [p, setP] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q), h = () => setP(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h) }, [])
  return p
}

export default function PlayerModal({ player, allPlayers, onClose }) {
  const backdropRef = useRef(null)
  const handleKey = useCallback(e => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = '' }
  }, [handleKey])

  const name = player.name
  const [career, setCareer] = useState(undefined), [band, setBand] = useState(null), [shots, setShots] = useState(null)
  useEffect(() => {
    let on = true
    setCareer(undefined)
    getJSON(`/data/careers/${shard(name)}.json`).then(d => on && setCareer(d?.[name] || null))
    getJSON('/data/careers/band.json').then(d => on && setBand(d))
    binderHeadshots().then(s => on && setShots(s))
    return () => { on = false }
  }, [name])
  const phone = usePhone()

  const hist = player.elo_history || []
  const seasons = useMemo(() => career || seasonsFromHistory(hist), [career, hist])
  const full = !!career // box scores and ranks
  const team = player.team, info = tInfo(team), color = tColor(team)
  const y1 = hist[0]?.[0]?.slice(0, 4), y2 = hist.at(-1)?.[0]?.slice(0, 4)
  const active = player.last_played && (Date.now() - Date.parse(player.last_played)) / 864e5 < 400
  const years = !y1 ? '' : active ? `${y1}–present` : y1 === y2 ? y1 : `${y1}–${y2}`
  const avgElo = hist.length ? Math.round(hist.reduce((s, x) => s + x[1], 0) / hist.length) : Math.round(player.current_elo)
  const peakRank = 1 + (allPlayers || []).filter(p => p.peak_elo > player.peak_elo).length
  const ranked = seasons.filter(s => s.g >= 20)
  const bestSeason = (ranked.length ? ranked : seasons).reduce((a, b) => (b.av > a.av ? b : a), seasons[0])
  const jump = seasons.slice(1).reduce((a, b) => (!a || b.en - b.st > a.en - a.st ? b : a), null)
  const bestGame = full ? seasons.filter(s => s.b).map(s => s.b).reduce((a, b) => (!a || b.gs > a.gs ? b : a), null) : null
  const mostPts = full ? seasons.filter(s => s.h).map(s => s.h).reduce((a, b) => (!a || b.pts > a.pts ? b : a), null) : null
  const src = shots?.[norm(name)]?.headshot
  const logo = binderLogo(team)
  const seal = active && player.is_fpr_eligible && player.fpr_rank <= 99 ? { top: 'FPR', n: `#${player.fpr_rank}`, sub: 'today' } : peakRank <= 99 ? { top: 'Peak', n: `#${peakRank}`, sub: 'all-time' } : null
  // Badges from data built before v185 (day counts at No. 1, the streak, today's rank) are left off: the card shows today's rank live
  const medals = (player.badges || []).filter(b => b.id !== 'streak_at_1' && !b.id.startsWith('current_') && !(b.id === 'games_at_1' && b.label.includes('×'))).map(medalOf)

  return (
    <div ref={backdropRef} className={styles.back} onClick={e => e.target === backdropRef.current && onClose()} role="dialog" aria-modal="true" aria-label={`${name} career`} data-m="pm-back">
      <div className={styles.card} style={{ '--team': color }} data-m="pm-box">
        <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.hero}>
          <div className={styles.hs}>
            {src ? <img src={src} alt="" onError={e => { e.currentTarget.style.display = 'none' }} /> : null}
            <b className={styles.ini}>{initials(name)}</b>
            <TeamChip team={team} logo={logo} title={info.name || team} />
          </div>
          <div className={styles.who}>
            <div className={styles.kick}>{info.name || team}{years ? ` · ${years}` : ''}</div>
            <h2 className={styles.nm}>{name}</h2>
            <div className={styles.sub}><b>{fmt(player.games_played)}</b> games{player.career_gmsc_avg != null && <> · career GmSc <b>{player.career_gmsc_avg}</b></>}{player.last_played && <> · last played {md(player.last_played, !active)}</>}</div>
          </div>
          {seal && <div className={styles.seal}><span><small>{seal.top}</small><b>{seal.n}</b><small>{seal.sub}</small></span></div>}
        </div>

        <div className={styles.tiles}>
          <div><small>{active ? (player.live ? 'Current Elo · live' : 'Current Elo') : 'Final Elo'}</small><b>{fmt(player.current_elo)}</b>
            <em>{active ? (player.is_fpr_eligible ? `#${player.fpr_rank} in the league` : `#${player.current_tpr_rank} rated · not enough recent games`) : `last game ${md(player.last_played)}`}</em></div>
          <div><small>Peak Elo</small><b className={styles.gold}>{fmt(player.peak_elo)}</b><em>#{peakRank} all-time</em></div>
          <div><small>Career average</small><b>{fmt(avgElo)}</b><em>every rated game</em></div>
          <div><small>Best season</small><b>{bestSeason?.s || '—'}</b><em>{bestSeason ? `${fmt(bestSeason.av)} avg${bestSeason.rk ? ` · #${bestSeason.rk}` : ''}` : ''}</em></div>
        </div>

        <section className={styles.sec}>
          <Trajectory hist={hist} band={band} name={name} />
        </section>

        {(medals.length > 0 || bestGame || jump) && <section className={`${styles.sec} ${styles.two}`}>
          {medals.length > 0 && <div>
            <Head>Badges</Head>
            <div className={styles.medals}>{medals.map(b => (
              <div key={b.id} className={styles.md} data-c={b.cat} title={b.label}>
                <div className={styles.disc}><span>{b.emoji}</span>{b.tag && <b>{b.tag}</b>}</div>
                <span>{b.label}</span><small>{CAT[b.cat] || ''}</small>
              </div>))}</div>
          </div>}
          <div>
            <Head>Career highs</Head>
            <div className={styles.facts}>
              {bestGame && <Fact icon="🎯" title={`Best game: ${bestGame.gs} GmSc`} sub={`${bestGame.pts} pts, ${bestGame.trb} reb, ${bestGame.ast} ast vs ${bestGame.o} · ${md(bestGame.d)}${bestGame.p ? ' · playoffs' : ''}`} />}
              {mostPts && <Fact icon="💥" title={`Career high: ${mostPts.pts} points`} sub={`vs ${mostPts.o} · ${md(mostPts.d)}${mostPts.p ? ' · playoffs' : ''}`} />}
              {bestSeason && <Fact icon="📈" title={`Best season: ${bestSeason.s}`} sub={`${fmt(bestSeason.av)} average Elo${bestSeason.rk ? ` · finished #${bestSeason.rk}` : ''}`} />}
              {jump && jump.en > jump.st && <Fact icon="🚀" title={`Biggest jump: ${jump.s}`} sub={`▲${fmt(jump.en - jump.st)} Elo${jump.rk && prevRank(seasons, jump) ? ` · #${prevRank(seasons, jump)} to #${jump.rk}` : ''}`} />}
            </div>
          </div>
        </section>}

        <section className={styles.sec}>
          <Head>Year by year</Head>
          {phone ? <SeasonRows seasons={seasons} full={full} /> : <SeasonTable seasons={seasons} full={full} best={bestSeason} />}
          <p className={styles.note}>{full ? 'GP and per-game numbers: regular season. Games rated includes the playoffs. ' : 'Box scores and ranks fill in after tonight’s update. '}Bar: the season’s Elo going in to its end on a {SCALE[0].toLocaleString()}–{SCALE[1].toLocaleString()} scale; the gold tick is its peak.{full ? ' Rank: where he finished among players with 20+ rated games.' : ''}</p>
        </section>
      </div>
    </div>
  )
}

function TeamChip({ team, logo, title }) {
  const [bad, setBad] = useState(false)
  return <span className={styles.tchip} title={title}>{logo && !bad ? <img src={logo} alt="" onError={() => setBad(true)} /> : team}</span>
}
const prevRank = (seasons, s) => { const i = seasons.indexOf(s); return i > 0 ? seasons[i - 1].rk : null }
const Head = ({ children, right }) => <div className={styles.sh}><h3>{children}</h3><i />{right}</div>
const Fact = ({ icon, title, sub }) => <div className={styles.fact}><i>{icon}</i><b>{title}</b><small>{sub}</small></div>
const Team = ({ t }) => <span className={styles.tm} style={{ background: tColor(t) }}>{t}</span>
const Change = ({ s }) => { const d = s.en - s.st; return <span className={d >= 0 ? styles.up : styles.dn}>{d >= 0 ? '▲' : '▼'}{fmt(Math.abs(d))}</span> }
const Rank = ({ s }) => (s.rk ? <span className={styles.rk} data-top={s.rk <= 5 ? '' : undefined} title={`of ${s.rn}`}>#{s.rk}</span> : <span className={styles.rkNone}>—</span>)
function Bar({ s }) {
  const p = v => Math.max(0, Math.min(100, ((v - SCALE[0]) / (SCALE[1] - SCALE[0])) * 100))
  const a = Math.min(s.st, s.en), b = Math.max(s.st, s.en)
  return <span className={styles.bar}><i className={styles.tr} /><i className={styles.rg} data-dn={s.en < s.st ? '' : undefined} style={{ left: `${p(a)}%`, width: `${Math.max(1.5, p(b) - p(a))}%` }} /><i className={styles.pk} style={{ left: `${p(s.pk)}%` }} /></span>
}
const bestText = g => (g ? <><b>{g.pts} pts</b> vs {g.o}, {md(g.d, false)}{g.p ? ' (playoffs)' : ''}</> : '—')

function SeasonTable({ seasons, full, best }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>Season</th><th className={styles.l}>Team</th><th>{full ? 'GP' : 'Games'}</th><th>Elo range</th><th>End</th><th>Peak</th><th>Change</th>{full && <><th>Rank</th><th>Pts / Reb / Ast</th><th>GmSc</th><th className={styles.l}>Best game</th></>}</tr></thead>
        <tbody>{seasons.map(s => (
          <tr key={s.s} data-best={s === best ? '' : undefined}>
            <td className={styles.s}>{s.s}</td>
            <td className={styles.l}><span className={styles.tms}>{s.t.map(t => <Team key={t} t={t} />)}</span></td>
            <td title={full ? `${s.g} rated games, playoffs included` : undefined}>{full ? s.gp || s.g : s.g}</td>
            <td><Bar s={s} /></td><td>{fmt(s.en)}</td><td>{fmt(s.pk)}</td><td><Change s={s} /></td>
            {full && <><td><Rank s={s} /></td><td>{s.pts != null ? `${s.pts} / ${s.trb} / ${s.ast}` : '—'}</td><td>{s.gs ?? '—'}</td><td className={`${styles.l} ${styles.bg}`}>{bestText(s.b)}</td></>}
          </tr>))}</tbody>
      </table>
    </div>
  )
}

function SeasonRows({ seasons, full }) {
  const rev = [...seasons].reverse()
  const [open, setOpen] = useState((rev.find(s => s.g >= 10) || rev[0])?.s) // the latest real season, not a week-old one
  return <div className={styles.rows}>{rev.map(s => {
    const on = open === s.s
    return <div key={s.s}>
      <button type="button" className={styles.srow} data-on={on ? '' : undefined} aria-expanded={on} onClick={() => setOpen(on ? null : s.s)}>
        <b>{s.s}</b>{full ? <Rank s={s} /> : <Team t={s.t[0]} />}<Bar s={s} /><b>{fmt(s.en)}</b><Change s={s} />
      </button>
      {on && <div className={styles.sdet}>
        <div><small>Team</small><span className={styles.tms}>{s.t.map(t => <Team key={t} t={t} />)}</span></div>
        <div><small>{full ? 'GP' : 'Games'}</small><b>{full ? s.gp || s.g : s.g}</b></div>
        <div><small>Peak</small><b>{fmt(s.pk)}</b></div>
        <div><small>Average</small><b>{fmt(s.av)}</b></div>
        {full && s.pts != null && <><div><small>Pts</small><b>{s.pts}</b></div><div><small>Reb / Ast</small><b>{s.trb} / {s.ast}</b></div><div><small>GmSc</small><b>{s.gs}</b></div><div><small>Min</small><b>{s.mp}</b></div></>}
        {full && s.b && <p className={styles.w}>Best game: {bestText(s.b)}</p>}
      </div>}
    </div>
  })}</div>
}

// The career line, colored by team, against the league: its No. 1, the top 10% band and the median. "His career" frames his years;
// "All-time" stretches to 1946 so he sits against every era. Hover (or touch) for the date, Elo and team.
function Trajectory({ hist, band, name }) {
  const wrap = useRef(null), [w, setW] = useState(0), [mode, setMode] = useState('career'), [tip, setTip] = useState(null)
  useEffect(() => {
    const el = wrap.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width))); ro.observe(el); return () => ro.disconnect()
  }, [])
  const H = w < 500 ? 200 : 260, pl = 36, pr = 10, pt = 22, pb = 22
  const geo = useMemo(() => {
    if (!hist.length || !w) return null
    const t0 = mode === 'all' ? Date.parse(band?.[0]?.[0] || '1946-11-01') : Date.parse(hist[0][0]) - 60 * 864e5
    const t1 = mode === 'all' ? Date.parse(band?.at(-1)?.[0] || hist.at(-1)[0]) : Date.parse(hist.at(-1)[0]) + 30 * 864e5
    const B = (band || []).filter(b => { const t = Date.parse(b[0]); return t >= t0 && t <= t1 })
    let lo = Math.min(...hist.map(x => x[1])), hi = Math.max(...hist.map(x => x[1]))
    for (const b of B) { lo = Math.min(lo, b[1]); hi = Math.max(hi, b[3]) }
    lo = Math.floor((lo - 60) / 100) * 100; hi = Math.ceil((hi + 60) / 100) * 100
    const X = d => pl + ((Date.parse(d) - t0) / (t1 - t0)) * (w - pl - pr), Y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb)
    // His line, thinned to about one point per pixel; the peak always kept
    const step = Math.max(1, Math.floor(hist.length / (w - pl - pr)))
    const pkI = hist.reduce((a, x, i) => (x[1] > hist[a][1] ? i : a), 0)
    const pts = hist.filter((x, i) => i % step === 0 || i === pkI || i === hist.length - 1)
    const segs = []
    for (const x of pts) { const t = x[4]; if (!segs.length || segs.at(-1).t !== t) segs.push({ t, p: segs.length ? [segs.at(-1).p.at(-1)] : [] }); segs.at(-1).p.push([X(x[0]), Y(x[1])]) }
    const grid = []; for (let v = Math.ceil(lo / 200) * 200; v <= hi; v += 200) grid.push(v)
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), span = y1 - y0
    const stepY = [1, 2, 5, 10, 20].find(s => span / s <= (w - pl) / 60) || 20
    const years = []; for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1; y += stepY) years.push(y)
    // The band breaks where the league has no months (offseasons, and any gap over 200 days)
    const runs = []
    for (const b of B) { const last = runs.at(-1)?.at(-1); if (!last || Date.parse(b[0]) - Date.parse(last[0]) > 200 * 864e5) runs.push([]); runs.at(-1).push(b) }
    return { X, Y, runs: runs.filter(r => r.length > 1), segs, grid, years, pk: hist[pkI], pts, lo, hi }
  }, [hist, band, w, mode, H])
  const move = e => {
    if (!geo) return
    const r = e.currentTarget.getBoundingClientRect(), cx = ((e.touches?.[0] || e).clientX - r.left) * (w / r.width)
    let best = null, bd = 1e9
    for (const x of geo.pts) { const d = Math.abs(geo.X(x[0]) - cx); if (d < bd) { bd = d; best = x } }
    if (best) setTip({ x: geo.X(best[0]), y: geo.Y(best[1]), d: best[0], e: best[1], t: best[4] })
  }
  const teams = geo ? [...new Set(geo.segs.map(s => s.t))] : []
  const path = P => `M${P.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}`
  return (
    <>
      <Head right={<span className={styles.seg} role="group" aria-label="Range">{[['career', 'His career'], ['all', 'All-time']].map(([v, l]) => <button key={v} type="button" data-on={mode === v ? '' : undefined} aria-pressed={mode === v} onClick={() => { setMode(v); setTip(null) }}>{l}</button>)}</span>}>Career trajectory</Head>
      <div className={styles.chart} ref={wrap}>
        {geo && <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} onMouseMove={move} onTouchMove={move} onMouseLeave={() => setTip(null)} role="img" aria-label={`${name}'s Elo over his career against the league`}>
          {geo.grid.map(v => <g key={v}><line x1={pl} x2={w - pr} y1={geo.Y(v)} y2={geo.Y(v)} className={v === 3000 ? styles.g3k : styles.gl} /><text x={2} y={geo.Y(v) + 3} className={styles.ax}>{v}</text></g>)}
          {geo.years.map(y => <text key={y} x={geo.X(`${y}-01-01`)} y={H - 6} className={styles.ax} textAnchor="middle">{y}</text>)}
          {geo.runs.map((R, i) => <g key={i}>
            <path d={`${path(R.map(b => [geo.X(b[0]), geo.Y(b[2])]))}L${R.slice().reverse().map(b => `${geo.X(b[0]).toFixed(1)},${geo.Y(b[3]).toFixed(1)}`).join('L')}Z`} className={styles.band} />
            <path d={path(R.map(b => [geo.X(b[0]), geo.Y(b[1])]))} className={styles.med} />
            <path d={path(R.map(b => [geo.X(b[0]), geo.Y(b[3])]))} className={styles.top} />
          </g>)}
          {geo.segs.map((s, i) => <path key={i} d={path(s.p)} fill="none" stroke={tColor(s.t)} strokeWidth={mode === 'all' ? 1.8 : 2.4} strokeLinejoin="round" />)}
          <circle cx={geo.X(geo.pk[0])} cy={geo.Y(geo.pk[1])} r={4.5} className={styles.pkDot} />
          <text x={geo.X(geo.pk[0]) + (geo.X(geo.pk[0]) > w * 0.6 ? -8 : 8)} y={Math.max(12, geo.Y(geo.pk[1]) - 8)} textAnchor={geo.X(geo.pk[0]) > w * 0.6 ? 'end' : 'start'} className={styles.pkTxt}>Peak {fmt(geo.pk[1])} · {md(geo.pk[0])}</text>
          {tip && <g><line x1={tip.x} x2={tip.x} y1={pt - 6} y2={H - pb} className={styles.cross} /><circle cx={tip.x} cy={tip.y} r={4} fill={tColor(tip.t)} stroke="#fff" strokeWidth={1.5} /></g>}
        </svg>}
        {tip && <div className={styles.tip} style={{ left: tip.x, top: tip.y }} data-r={tip.x > w * 0.65 ? '' : undefined}><b>{md(tip.d)}</b><span>Elo <em>{fmt(tip.e)}</em></span><span>{tInfo(tip.t).name || tip.t}</span></div>}
        <div className={styles.legend}>
          {teams.map(t => <span key={t}><i style={{ background: tColor(t) }} />{tInfo(t).name?.split(' ').slice(-1)[0] || t}</span>)}
          {band && <><span><i className={styles.lTop} />League’s No. 1</span><span><i className={styles.lBand} />Top 10%</span><span><i className={styles.lMed} />League median</span></>}
        </div>
      </div>
    </>
  )
}
