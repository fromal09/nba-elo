import { useState, useMemo, useEffect } from 'react'
import styles from './Rankings.module.css'
import { binderHeadshots, binderTeamInfo } from './SeasonExplorer'
import { norm } from './predict'
import { useCareerHistory } from '../history.js'
import { Explain } from './Explainer'

const PER_PAGE = 50
const SORTS = [
  { key: 'fpr_rank', label: 'FPR rank', asc: true },
  { key: 'current_elo', label: 'Current Elo', asc: false },
  { key: 'peak_elo', label: 'Peak Elo', asc: false },
  { key: 'recent_gmsc_avg', label: 'Recent Game Score', asc: false },
  { key: 'career_gmsc_avg', label: 'Career Game Score', asc: false },
  { key: 'games_played', label: 'Games played', asc: false },
]
const GP = [[1, 'Any GP'], [10, '10+ GP'], [20, '20+ GP'], [40, '40+ GP'], [60, '60+ GP']]

const r0 = v => Math.round(v).toLocaleString()
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const initials = n => baseName(n).split(' ').map(w => w[0]).join('').slice(0, 2)
const useWide = () => {
  const q = '(min-width: 761px)'
  const [w, setW] = useState(() => typeof matchMedia === 'undefined' || matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q), f = () => setW(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return w
}

// Current Rankings: the top three on podium cards in their team colors, everyone else as a card row with the headshot,
// Elo and its last move, a 20-game Elo line and the career peak. On a phone the rows drop the line and the peak.
export default function Rankings({ players, live, onSelectPlayer }) {
  const [search, setSearch] = useState('')
  const [team, setTeam] = useState('')
  const [sortKey, setSortKey] = useState('fpr_rank')
  const [minGP, setMinGP] = useState(10)
  const [page, setPage] = useState(0)
  const [activeOnly, setActiveOnly] = useState(true)
  const [shots, setShots] = useState({})
  useEffect(() => { binderHeadshots().then(setShots).catch(() => {}) }, [])
  const wide = useWide()
  // The Elo lines need every career's game log; it loads in the background on wider screens (phones skip the lines)
  useCareerHistory(wide)

  const sort = SORTS.find(s => s.key === sortKey)
  const teams = useMemo(() => [...new Set(players.filter(p => !activeOnly || p.is_fpr_eligible).map(p => p.team))].filter(Boolean).sort(), [players, activeOnly])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return players
      .filter(p => p.games_played >= minGP && (!activeOnly || p.is_fpr_eligible) && (!team || p.team === team)
        && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)))
      .sort((a, b) => (sort.asc ? (a[sortKey] ?? 1e9) - (b[sortKey] ?? 1e9) : b[sortKey] - a[sortKey]))
  }, [players, search, team, minGP, sortKey, activeOnly])
  const counts = useMemo(() => ({ active: players.filter(p => p.games_played >= minGP && p.is_fpr_eligible).length, all: players.filter(p => p.games_played >= minGP).length }), [players, minGP])

  const podium = page === 0 && !search && sortKey === 'fpr_rank' && filtered.length >= 3
  const rows = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const list = podium ? rows.slice(3) : rows
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const reset = f => v => { f(v); setPage(0) }

  const rankOf = (p, i) => (sortKey === 'fpr_rank' && !team ? (p.fpr_rank || p.current_tpr_rank) : page * PER_PAGE + i + 1)
  const view = (p) => {
    const h = p.elo_history
    const line = h?.length > 1 ? h.slice(-20).map(x => x[1]) : null
    // The last move: today's live change if there is one, else his last game's
    const move = p.live_change ? p.live_change : h?.length > 1 ? h[h.length - 1][1] - h[h.length - 2][1] : null
    const info = binderTeamInfo(p.team)
    return { line, move, color: info?.color || '#3b5a82', shot: shots?.[norm(p.name)]?.headshot }
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <small>Floor Performance Rating</small>
        <h1>Current Rankings <Explain title="How the rankings work" icon tone="light" label="How the rankings work">
          <p>Every player’s Elo moves after every game: beat the player you’re matched against on Game Score and you gain, lose to him and you drop. The bigger the upset, the bigger the move.</p>
          <p><b>FPR rank</b> orders active players by current Elo. Active means he has played in one of his team’s last 20 games.</p>
          <p><b>Peak</b> is the highest Elo of his career. The line on each row is his last 20 games, and the number under his Elo is his last move.</p>
          <p>Finals since the nightly update, and games in progress, move Elo and ranks live.</p>
        </Explain></h1>
        <p>{counts.active} active players · updated after every game{live?.inprog.length ? <> · <i className={styles.liveDot} />{live.inprog.length} live</> : ''}</p>
      </header>

      <div className={styles.controls}>
        <label className={styles.search}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
          <input type="text" placeholder="Search players or teams" value={search} onChange={e => reset(setSearch)(e.target.value)} aria-label="Search players" />
          {search && <button type="button" onClick={() => reset(setSearch)('')} aria-label="Clear">×</button>}
        </label>
        <select className={styles.select} value={team} onChange={e => reset(setTeam)(e.target.value)} aria-label="Team">
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{binderTeamInfo(t)?.name || t}</option>)}
        </select>
        <div className={styles.seg} role="group" aria-label="Player pool">
          <button type="button" data-on={activeOnly ? '' : undefined} onClick={() => reset(setActiveOnly)(true)}>Active{wide && <span>{counts.active}</span>}</button>
          <button type="button" data-on={!activeOnly ? '' : undefined} onClick={() => reset(setActiveOnly)(false)}>All{wide && <span>{counts.all.toLocaleString()}</span>}</button>
        </div>
        <select className={styles.select} value={sortKey} onChange={e => reset(setSortKey)(e.target.value)} aria-label="Sort by">
          {SORTS.map(s => <option key={s.key} value={s.key}>{wide ? 'Sort: ' : ''}{s.label}</option>)}
        </select>
        <select className={styles.select} value={minGP} onChange={e => reset(setMinGP)(+e.target.value)} aria-label="Minimum games">
          {GP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {podium && <div className={styles.podium}>
        {[1, 0, 2].map(k => {
          const p = rows[k], v = view(p)
          return (
            <button key={p.name} type="button" className={`${styles.pc} ${k === 0 ? styles.first : ''}`} style={{ '--c': v.color }} onClick={() => onSelectPlayer(p)} aria-label={`${k + 1}. ${p.name}, ${r0(p.current_elo)} Elo`}>
              <span className={styles.rk}>{k + 1}</span>
              <Shot name={p.name} src={v.shot} className={styles.pShot} />
              <span className={styles.pText}>
                <b>{baseName(p.name)}</b>
                <small><i className={styles.tm}>{p.team}</i> peak {r0(p.peak_elo)}</small>
                <span className={styles.pElo}><em>{r0(p.current_elo)}</em><Move v={v.move} live={p.live} /></span>
              </span>
              {v.line && <Spark pts={v.line} className={styles.pSpark} />}
            </button>
          )
        })}
      </div>}

      <div className={styles.list}>
        {list.map((p, i) => {
          const v = view(p), idx = podium ? i + 3 : i
          return (
            <button key={p.name} type="button" className={`${styles.row} ${!p.is_fpr_eligible ? styles.inactive : ''}`} style={{ '--c': v.color }} onClick={() => onSelectPlayer(p)}>
              <span className={styles.n}>{rankOf(p, idx)}</span>
              <Shot name={p.name} src={v.shot} className={styles.rShot} />
              <span className={styles.who}>
                <b>{baseName(p.name)}</b>
                <small><i className={styles.tm}>{p.team}</i>{p.games_played.toLocaleString()} games · {p.recent_gmsc_avg.toFixed(1)} GmSc{sortKey === 'career_gmsc_avg' ? ` · ${p.career_gmsc_avg.toFixed(1)} career` : ''}</small>
              </span>
              <span className={styles.line}>{v.line && <Spark pts={v.line} />}</span>
              <span className={styles.pk}><small>Peak</small><b>{r0(p.peak_elo)}</b></span>
              <span className={styles.e}><em>{r0(p.current_elo)}</em><Move v={v.move} live={p.live} /></span>
            </button>
          )
        })}
        {!filtered.length && <p className={styles.empty}>No players match. Try another search or fewer filters.</p>}
      </div>

      {totalPages > 1 && <div className={styles.paging}>
        <span>{page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, filtered.length)} of {filtered.length.toLocaleString()}</span>
        <div>
          <button type="button" onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹ Prev</button>
          <b>{page + 1} / {totalPages}</b>
          <button type="button" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next ›</button>
        </div>
      </div>}
    </div>
  )
}

function Shot({ name, src, className }) {
  const [bad, setBad] = useState(false)
  return <span className={`${styles.shot} ${className || ''}`}>{initials(name)}{src && !bad && <img src={src} alt="" loading="lazy" onError={() => setBad(true)} />}</span>
}

function Move({ v, live }) {
  if (v == null) return null
  if (Math.abs(v) < 0.05) return <small className={styles.flat}>±0</small>
  return <small className={v > 0 ? styles.up : styles.down} title={live ? 'In progress' : 'Last move'}>{live && <i className={styles.liveDot} />}{v > 0 ? '▲' : '▼'}{Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}</small>
}

function Spark({ pts, className }) {
  const W = 110, H = 30, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1
  const d = pts.map((y, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * W).toFixed(1)},${(H - 3 - (y - lo) / span * (H - 6)).toFixed(1)}`).join('')
  return <svg className={`${styles.spark} ${className || ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><path d={d} /><circle cx={W} cy={H - 3 - (pts[pts.length - 1] - lo) / span * (H - 6)} r="2.4" /></svg>
}
