import { useState, useEffect, useMemo } from 'react'
import styles from './AllTime.module.css'
import foil from './Foil.module.css'
import { tierFor } from './PlayerCard'
import { binderHeadshots, binderTeamInfo, binderJSON } from './SeasonExplorer'
import { norm } from './predict'
import { Explain } from './Explainer'

/*
 * The all-time rankings (scripts/build_alltime.py, nightly): every player who has played, ranked by a blend of
 *   Peak 40%       his best three seasons in a row, measured against each month's top three (their average Elo) and a typical starter
 *   Career 40%     every rated game added up at that level ("top-three games")
 *   Dominance 20%  months ranked at a month's end: 1 for No. 1, 0.35 for Nos. 2-5, 0.20 for Nos. 6-20, 0.10 for Nos. 21-50
 * Live: a game tonight adds to an active player's career part (at his current Elo against this month's marks), so his
 * score and rank move while he plays. Peak and dominance move with the nightly update.
 */

export { loadAllTime, useAllTime, gameRanks, shard, perGame, liveAllTime } from './alltimeData'
import { useAllTime, perGame, liveAllTime, shard } from './alltimeData'

export const tierOf = r => (r ? tierFor(r).id : 'none')
export const Foil = ({ r, className = '', children, title }) => <span className={`${foil.f} ${className}`} data-t={tierOf(r)} title={title}>{children ?? (r ? `#${r}` : '—')}</span>

const f1 = v => v.toFixed(1)
const gap = v => (v < 0.005 ? 'under 0.01' : v.toFixed(2))
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const initials = n => baseName(n).split(' ').filter(w => !/^(Jr\.|Sr\.|II|III|IV)$/.test(w)).map(w => w[0]).join('').slice(0, 2)
const yearsOf = x => (x.active ? `${x.years.slice(0, 4)}–now` : x.years)
const PARTS = [
  { key: 'score', label: 'Overall' },
  { key: 'peak', label: 'Peak', rank: 'peak_rank' },
  { key: 'career', label: 'Career', rank: 'career_rank' },
  { key: 'dom', label: 'Dominance', rank: 'dom_rank' },
]
const PER_PAGE = 50

function Shot({ name, team, shots }) {
  const [bad, setBad] = useState(false)
  const src = shots?.[norm(name)]?.headshot
  return <span className={styles.shot} style={{ '--c': binderTeamInfo(team)?.color || '#3b5a82' }}>{initials(name)}{src && !bad && <img src={src} alt="" loading="lazy" onError={() => setBad(true)} />}</span>
}
const Bar = ({ x }) => <span className={styles.bar} title={`Peak ${f1(x.peak)} · Career ${f1(x.career)} · Dominance ${f1(x.dom)}`}>
  <i className={styles.cP} style={{ width: `${0.4 * x.peak}%` }} /><i className={styles.cC} style={{ width: `${0.4 * x.career}%` }} /><i className={styles.cD} style={{ width: `${0.2 * x.dom}%` }} /></span>

// ▲/▼ since last night (or since the nightly update, while tonight's games move it)
export function moveOf(x) {
  if (x.today && x.base !== x.rank) return { d: x.base - x.rank, live: true }
  if (x.prev && x.prev !== x.base) return { d: x.prev - x.base, live: false }
  return null
}
const Chip = ({ m }) => (m ? <span className={`${styles.chip} ${m.d > 0 ? styles.up : styles.down}`} title={m.live ? 'Tonight' : 'Since last night'}>{m.live && <i className={styles.dot} />}{m.d > 0 ? '▲' : '▼'}{Math.abs(m.d)}</span> : null)

export function AllTimeRankings({ players, onSelectPlayer, lookSwitch }) {
  const AT = useAllTime()
  const L = useMemo(() => liveAllTime(AT, players), [AT, players])
  const [part, setPart] = useState('score')
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  const [board, setBoard] = useState('night')
  const [shots, setShots] = useState(null)
  useEffect(() => { binderHeadshots().then(setShots).catch(() => {}) }, [])
  const P = PARTS.find(p => p.key === part)
  const reset = f => v => { f(v); setPage(0); setOpen(null) }

  const list = useMemo(() => {
    if (!L) return []
    const q = norm(search.trim().toLowerCase())
    const rows = part === 'score' ? L.rows : [...L.rows].sort((a, b) => a[P.rank] - b[P.rank])
    return rows.filter(x => (!activeOnly || x.active) && (!q || norm(x.name.toLowerCase()).includes(q)))
  }, [L, part, search, activeOnly])
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE))
  const rows = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const movers = useMemo(() => {
    if (!L) return []
    if (board === 'season') return L.rows.filter(x => x.active && x.rank <= 500 && x.pre && x.pre > x.rank).map(x => ({ x, d: x.pre - x.rank, from: x.pre })).sort((a, b) => b.d - a.d).slice(0, 10)
    return L.rows.filter(x => x.prev && x.prev !== x.base && Math.min(x.prev, x.base) <= 500 && x.prev > x.base).map(x => ({ x, d: x.prev - x.base, from: x.prev })).sort((a, b) => a.x.base - b.x.base).slice(0, 10)
  }, [L, board])
  const passedOf = x => L.rows.filter(y => y.prev && x.prev && y.prev < x.prev && y.prev >= x.base && y.base > x.base).sort((a, b) => a.base - b.base)

  const night = AT?.night ? new Date(AT.night + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <small>Floor Performance Rating</small>
        <h1>All-Time Rankings <Explain title="How the all-time rankings work" icon tone="light" label="How the all-time rankings work">
          <p>Every player in the database is ranked by three things, each measured against the league of his own time: how far above a typical starter he was, as a share of the gap to that month’s top three players (their average Elo, so one runaway No. 1 doesn’t shrink everyone else in his era).</p>
          <p><b>Peak (40%)</b> is his best three seasons in a row. <b>Career (40%)</b> adds up every rated game at that level, so a game played at the level of the league’s top three counts as one “top-three game”. <b>Dominance (20%)</b> counts where he ranked at each month’s end: a full month for No. 1, 0.35 for Nos. 2–5, 0.20 for Nos. 6–20 and 0.10 for Nos. 21–50.</p>
          <p>Each part is scaled so the best player at it scores 100. Tonight’s games add to an active player’s career part as they’re played, so his rank can move live; peak and dominance update overnight.</p>
        </Explain></h1>
        <p>{AT ? <>{AT.players.length.toLocaleString()} players ranked · through {night}{L?.any ? <> · <i className={styles.liveDot} />moving live</> : ''}</> : 'Loading…'}</p>
        {lookSwitch}
      </header>

      <div className={styles.controls}>
        <label className={styles.search}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="text" placeholder="Search players" value={search} onChange={e => reset(setSearch)(e.target.value)} aria-label="Search players" />
          {search && <button type="button" onClick={() => reset(setSearch)('')} aria-label="Clear">×</button>}
        </label>
        <div className={styles.seg} role="group" aria-label="Rank by">
          {PARTS.map(p => <button key={p.key} type="button" data-on={part === p.key ? '' : undefined} onClick={() => reset(setPart)(p.key)}>{p.label}</button>)}
        </div>
        <div className={styles.seg} role="group" aria-label="Players">
          <button type="button" data-on={!activeOnly ? '' : undefined} onClick={() => reset(setActiveOnly)(false)}>Everyone</button>
          <button type="button" data-on={activeOnly ? '' : undefined} onClick={() => reset(setActiveOnly)(true)}>Active</button>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.list}>
          <div className={styles.cols} aria-hidden="true"><span>Rank</span><span>Player</span><span className={styles.cBar}>Peak · Career · Dominance</span><span>{part === 'score' ? 'Score' : P.label}</span><span /></div>
          {!AT && <p className={styles.empty}>Loading the all-time list…</p>}
          {rows.map(x => {
            const r = part === 'score' ? x.rank : x[P.rank], m = part === 'score' ? moveOf(x) : null, isOpen = open === x.name
            return <div key={x.name} className={styles.item} data-open={isOpen ? '' : undefined}>
              <button type="button" className={styles.row} onClick={() => setOpen(isOpen ? null : x.name)} aria-expanded={isOpen}>
                <Foil r={r} className={styles.rk} />
                <Shot name={x.name} team={x.team} shots={shots} />
                <span className={styles.who}><b>{baseName(x.name)}{x.live && <i className={styles.liveTag}>Live</i>}</b>
                  <small>{yearsOf(x)}{m ? <span className={styles.mvTxt}> · {m.d > 0 ? 'up' : 'down'} from #{m.live ? x.base : x.prev} {m.live ? 'tonight' : 'last night'}</span> : ''}</small>
                  <Bar x={x} /></span>
                <span className={styles.sc}>{f1(part === 'score' ? x.score : x[part])}</span>
                <span className={styles.mv}><Chip m={m} /></span>
              </button>
              {isOpen && <div className={styles.drawer}><AllTimeProfile x={x} L={L} AT={AT} players={players} chart onCareer={() => { const p = players?.find(q => q.name === x.name); if (p) onSelectPlayer(p) }} /></div>}
            </div>
          })}
          {AT && !list.length && <p className={styles.empty}>No players match.</p>}
          {pages > 1 && <div className={styles.paging}>
            <span>{page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, list.length)} of {list.length.toLocaleString()}</span>
            <div><button type="button" onClick={() => { setPage(p => p - 1); setOpen(null) }} disabled={page === 0}>‹ Prev</button><b>{page + 1} / {pages}</b>
              <button type="button" onClick={() => { setPage(p => p + 1); setOpen(null) }} disabled={page >= pages - 1}>Next ›</button></div>
          </div>}
        </div>

        <aside className={styles.board}>
          <div className={styles.bTabs}><button type="button" data-on={board === 'night' ? '' : undefined} onClick={() => setBoard('night')}>Last night</button><button type="button" data-on={board === 'season' ? '' : undefined} onClick={() => setBoard('season')}>This season</button></div>
          <h3>{board === 'night' ? `Climbs in the top 500 · ${night}` : 'Biggest climbs since opening night'}</h3>
          {!movers.length && AT && <p className={styles.bEmpty}>{board === 'night' ? 'Nobody in the top 500 moved up last night.' : 'No climbs yet this season.'}</p>}
          {movers.map(({ x, d, from }, i) => {
            const passed = board === 'night' ? passedOf(x) : []
            return <button key={x.name} type="button" className={styles.bRow} onClick={() => { setPart('score'); setSearch(''); setActiveOnly(false); setPage(Math.floor((x.rank - 1) / PER_PAGE)); setOpen(x.name) }}>
              <span className={styles.bN}>{i + 1}</span>
              <span className={styles.bWho}><b>{baseName(x.name)}</b><small>#{from} → #{x.base}{passed.length ? ` · passed ${passed.slice(0, 3).map(y => baseName(y.name)).join(', ')}${passed.length > 3 ? ` and ${passed.length - 3} more` : ''}` : ''}</small></span>
              <span className={styles.bD}>▲{d}</span>
            </button>
          })}
        </aside>
      </div>
    </div>
  )
}

// One player's all-time standing: where the score comes from, and (for active players) who's around him and what it takes
// to pass the next one. The Rankings drawer shows it with his month-by-month chart; the career card without.
export function AllTimeProfile({ x, L, AT, players, chart, onCareer }) {
  const me = players?.find(p => p.name === x.name)
  const r = x.rank, rows = L.rows
  const near = rows.slice(Math.max(0, r - 4), r + 3)
  const up = rows[r - 2], down = rows[r]
  const per = me && x.active ? perGame(AT, me.current_elo) : 0
  const g = up && per > 0 ? Math.max(1, Math.round((up.score - x.score) / per)) : null
  const fill = up && down ? Math.max(0, Math.min(1, (x.score - down.score) / Math.max(1e-6, up.score - down.score))) : 0
  const ones = Math.round((x.career / 100) * AT.scale.career)
  return <div className={styles.prof}>
    {chart && <RankChart name={x.name} win={x.peak_window} />}
    <div className={styles.parts}>
      <h4>Where the score comes from <span>{f1(x.score)}</span></h4>
      <Meter label="Peak" rank={x.peak_rank} v={x.peak} cls={styles.cP} note={`Best three seasons in a row: ${x.peak_window}, at ${x.peak_level.toFixed(2)}× the level of the league’s top three.`} />
      <Meter label="Career" rank={x.career_rank} v={x.career} cls={styles.cC} note={`${ones.toLocaleString()} top-three games in ${x.games.toLocaleString()} games.`} />
      <Meter label="Dominance" rank={x.dom_rank} v={x.dom} cls={styles.cD} note={x.m1 || x.m5 || x.m20 || x.m50 ? `Months at No. 1: ${x.m1} · Nos. 2–5: ${x.m5} · 6–20: ${x.m20 ?? 0} · 21–50: ${x.m50 ?? 0}.` : 'Never ranked in the top 50 at a month’s end.'} />
      {onCareer && me && <button type="button" className={styles.open} onClick={onCareer}>Open his career card →</button>}
    </div>
    <div className={styles.hood}>
      <h4>{x.active ? 'Around him' : 'The neighborhood'}</h4>
      {near.map(y => <div key={y.name} className={styles.nRow} data-me={y.name === x.name ? '' : undefined}>
        <Foil r={y.rank} className={styles.nRk} /><span className={styles.nName}>{baseName(y.name)}{y.live && <i className={styles.liveTag}>Live</i>}<small>{yearsOf(y)}</small></span>
        <span className={styles.nGap}>{y.name === x.name ? '' : `${y.score > x.score ? '+' : '−'}${Math.abs(y.score - x.score).toFixed(2)}`}</span><span className={styles.nSc}>{f1(y.score)}</span></div>)}
      {x.active && up && <div className={styles.next}>
        <b>Next: {baseName(up.name)} for #{up.rank}</b>
        <small>{gap(up.score - x.score)} behind{g ? ` · about ${g} game${g === 1 ? '' : 's'} at his current level` : ''}{down ? ` · the bar runs from #${down.rank} ${baseName(down.name)}` : ''}</small>
        <span className={styles.nBar}><i style={{ width: `${fill * 100}%` }} /></span>
      </div>}
    </div>
  </div>
}

function Meter({ label, rank, v, cls, note }) {
  return <div className={styles.meter}><div><b>{label}</b><span>#{rank.toLocaleString()} · {f1(v)}</span></div><span className={styles.track}><i className={cls} style={{ width: `${Math.max(0, v)}%` }} /></span><small>{note}</small></div>
}

// Where he ranked among active players at each month's end (careers/<shard>.json "m"), card-tier bands, best three seasons boxed
const BANDS = [[1, 1, 'goat'], [1.5, 5, 'icon'], [5.5, 20, 'legend'], [20.5, 50, 'standout'], [50.5, 125, 'rare'], [125.5, 500, 'common']]
function RankChart({ name, win }) {
  const [m, setM] = useState(undefined)
  useEffect(() => { let on = true; binderJSON(`/data/careers/${shard(name)}.json`).then(d => on && setM(d?.[name]?.m || null)).catch(() => on && setM(null)); return () => { on = false } }, [name])
  if (m === undefined) return <div className={styles.chart}><h4>Where he ranked, month by month</h4><div className={styles.cWait} /></div>
  if (!m) return null
  const W = 520, H = 170, padL = 34, padT = 8, ih = H - padT - 18
  const y = r => padT + (Math.log(Math.min(500, Math.max(1, r))) / Math.log(500)) * ih
  const [fy, fm] = m.f.split('-').map(Number), n = m.r.length
  const x = i => padL + (i / Math.max(1, n - 1)) * (W - padL - 6)
  const segs = []; let cur = []
  m.r.forEach((r, i) => { if (r) cur.push(`${x(i).toFixed(1)},${y(r).toFixed(1)}`); else if (cur.length) { segs.push(cur); cur = [] } })
  if (cur.length) segs.push(cur)
  // best three seasons: "2022-23–25" → Oct 2022 to Jun 2025
  const m0 = (yy, mm) => (yy - fy) * 12 + (mm - fm)
  const a = +win.slice(0, 4), e = +win.slice(-2)
  let b = win.length > 7 ? a - (a % 100) + e : a + 1
  if (b < a) b += 100
  const wa = Math.max(0, m0(a, 10)), wb = Math.min(n - 1, m0(b, 6))
  const yrs = []; for (let k = 0; k < n; k += 12 * Math.max(1, Math.ceil(n / 12 / 6))) yrs.push(k)
  return <div className={styles.chart}><h4>Where he ranked, month by month</h4>
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.cSvg} role="img" aria-label={`${name}: rank among active players by month`}>
      {BANDS.map(([lo, hi, t]) => <rect key={t} x={padL} width={W - padL - 6} y={y(lo)} height={Math.max(1, y(hi) - y(lo))} className={styles[`b_${t}`]} />)}
      {[1, 5, 20, 50, 125, 500].map(r => <text key={r} x={padL - 5} y={y(r) + 3} className={styles.cAx}>#{r}</text>)}
      {wb > wa && <><rect x={x(wa)} y={padT} width={x(wb) - x(wa)} height={ih} className={styles.cWin} /><text x={x(wa) + 4} y={H - 22} className={styles.cWinT}>best 3 seasons</text></>}
      {segs.map((s, i) => <polyline key={i} points={s.join(' ')} className={styles.cLine} />)}
      {yrs.map(k => <text key={k} x={x(k)} y={H - 4} className={styles.cYr}>{fy + Math.floor((fm - 1 + k) / 12)}</text>)}
    </svg></div>
}

// The Scoreboard's all-time callouts: every climb in the all-time top 500 from a day's games, with who he passed.
// The latest night in the data reads the nightly list; today's games count once they're final (scored live from the box).
export function AllTimeWatch({ day, games }) {
  const AT = useAllTime()
  const calls = useMemo(() => {
    if (!AT) return []
    let rows
    if (day === AT.night) rows = AT.players.map(x => ({ ...x, from: x.prev, to: x.rank }))
    else if (day > AT.night) {
      const fin = (games || []).filter(g => g.live && g.live.state === 'post')
      const ps = fin.flatMap(g => g.players.filter(p => !p.unrated).map(p => ({ name: p.n, current_elo: p.post, last_played: day })))
      if (!ps.length) return []
      const L = liveAllTime(AT, ps)
      rows = L.rows.map(x => ({ ...x, from: x.base, to: x.rank }))
    } else return []
    const moved = rows.filter(x => x.from && x.from > x.to && x.to <= 500)
    return moved.sort((a, b) => a.to - b.to).map(x => ({ x, passed: rows.filter(y => y.from && y.from < x.from && y.from >= x.to && y.to > x.to).sort((a, b) => a.to - b.to) }))
  }, [AT, day, games])
  if (!calls.length) return null
  return <section className={styles.watch} aria-label="All-time moves">
    <h3>All-Time Watch <span>{day === AT.night ? 'final' : 'tonight’s finals'}</span></h3>
    <div className={styles.wList}>{calls.map(({ x, passed }) => <div key={x.name} className={styles.wItem}>
      <Foil r={x.to} className={styles.wRk} />
      <span><b>{baseName(x.name)}</b> passes {passed.length === 1 ? baseName(passed[0].name) : passed.length <= 3 ? passed.map(y => baseName(y.name)).join(', ').replace(/, ([^,]*)$/, ' and $1') : `${passed.length} players`} for No. {x.to} all-time<small>up from No. {x.from}</small></span>
    </div>)}</div>
  </section>
}
