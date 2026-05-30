import { useState, useMemo, useCallback } from 'react'
import styles from './Rankings.module.css'

const PER_PAGE = 50
const SORT_OPTIONS = [
  { key: 'current_tpr_rank', label: 'FPR Rank',     asc: true  },
  { key: 'current_elo',      label: 'Current Elo',  asc: false },
  { key: 'peak_elo',         label: 'Peak Elo',     asc: false },
  { key: 'recent_gmsc_avg',  label: 'Recent GmSc',  asc: false },
  { key: 'career_gmsc_avg',  label: 'Career GmSc',  asc: false },
  { key: 'games_played',     label: 'Games Played', asc: false },
]

function gmscColor(v) {
  if (v >= 25) return '#22c997'
  if (v >= 18) return '#5aadff'
  if (v >= 12) return '#d4960a'
  if (v >= 6)  return '#8b92a8'
  return '#c94040'
}

export default function Rankings({ players, onSelectPlayer }) {
  const [search,    setSearch]    = useState('')
  const [sortKey,   setSortKey]   = useState('current_tpr_rank')
  const [sortAsc,   setSortAsc]   = useState(true)
  const [minGP,     setMinGP]     = useState(10)
  const [page,      setPage]      = useState(0)
  const [activeOnly, setActiveOnly] = useState(true)

  const setSort = useCallback((key, asc) => {
    setSortKey(key); setSortAsc(asc); setPage(0)
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return players
      .filter(p => {
        if (p.games_played < minGP) return false
        if (activeOnly && !p.is_fpr_eligible) return false
        if (q && !p.name.toLowerCase().includes(q) && !p.team.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey])
  }, [players, search, minGP, sortKey, sortAsc, activeOnly])

  // Re-rank within filtered set for display
  const ranked = useMemo(() => {
    if (sortKey !== 'current_tpr_rank') return filtered
    return filtered.map((p, i) => ({ ...p, _displayRank: i + 1 }))
  }, [filtered, sortKey])

  const maxElo  = useMemo(() => Math.max(...filtered.map(p => p.current_elo)), [filtered])
  const slice      = ranked.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const totalPages = Math.ceil(filtered.length / PER_PAGE)

  const activeCount = useMemo(() =>
    players.filter(p => p.games_played >= minGP && p.is_fpr_eligible).length,
    [players, minGP]
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.searchWrap}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            className={styles.search}
            type="text"
            placeholder="Search players or teams…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            aria-label="Search players"
          />
          {search && <button className={styles.clearBtn} onClick={() => { setSearch(''); setPage(0) }} aria-label="Clear">✕</button>}
        </div>

        <div className={styles.activeToggle} role="group" aria-label="Player pool">
          <button
            className={`${styles.toggleBtn} ${activeOnly ? styles.toggleActive : ''}`}
            onClick={() => { setActiveOnly(true); setPage(0) }}
          >
            Active
            <span className={styles.toggleCount}>{activeCount}</span>
          </button>
          <button
            className={`${styles.toggleBtn} ${!activeOnly ? styles.toggleActive : ''}`}
            onClick={() => { setActiveOnly(false); setPage(0) }}
          >
            All Players
            <span className={styles.toggleCount}>{players.filter(p => p.games_played >= minGP).length}</span>
          </button>
        </div>

        <div className={styles.sortGroup} role="group" aria-label="Sort by">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`${styles.sortBtn} ${sortKey === opt.key ? styles.sortActive : ''}`}
              onClick={() => setSort(opt.key, opt.asc)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className={styles.gpFilter}>
          <label htmlFor="mingp" className={styles.gpLabel}>Min GP</label>
          <select
            id="mingp"
            className={styles.gpSelect}
            value={minGP}
            onChange={e => { setMinGP(Number(e.target.value)); setPage(0) }}
          >
            <option value={1}>All</option>
            <option value={10}>10+</option>
            <option value={20}>20+</option>
            <option value={40}>40+</option>
            <option value={60}>60+</option>
          </select>
        </div>
      </div>

      {activeOnly && (
        <div className={styles.activeBanner}>
          <span className={styles.activeDot} />
          Showing FPR-eligible players · must have played in team's last 20 games
          <button className={styles.bannerLink} onClick={() => { setActiveOnly(false); setPage(0) }}>
            Show all →
          </button>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thRank}>#</th>
              <th className={styles.thName}>Player</th>
              <th className={styles.thTeam}>Team</th>
              <th className={`${styles.th} ${styles.thR}`} onClick={() => setSort('current_elo', sortKey === 'current_elo' ? !sortAsc : false)}>
                Current Elo {sortKey === 'current_elo' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th className={`${styles.th} ${styles.thR}`} onClick={() => setSort('peak_elo', sortKey === 'peak_elo' ? !sortAsc : false)}>
                Peak Elo {sortKey === 'peak_elo' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th className={`${styles.th} ${styles.thR}`} onClick={() => setSort('games_played', sortKey === 'games_played' ? !sortAsc : false)}>
                GP {sortKey === 'games_played' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th className={`${styles.th} ${styles.thR}`} onClick={() => setSort('recent_gmsc_avg', sortKey === 'recent_gmsc_avg' ? !sortAsc : false)}>
                Recent GmSc {sortKey === 'recent_gmsc_avg' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th className={`${styles.th} ${styles.thR}`} onClick={() => setSort('career_gmsc_avg', sortKey === 'career_gmsc_avg' ? !sortAsc : false)}>
                Career GmSc {sortKey === 'career_gmsc_avg' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th className={`${styles.th} ${styles.thR}`}>Last Game</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((p, i) => {
              const displayRank = sortKey === 'current_tpr_rank'
                ? (p._displayRank ?? p.current_tpr_rank)
                : page * PER_PAGE + i + 1
              const barW    = Math.max(2, Math.round((p.current_elo / maxElo) * 90))
              const gc      = gmscColor(p.recent_gmsc_avg)
              const inactive = !p.is_fpr_eligible

              return (
                <tr
                  key={p.name}
                  className={`${styles.row} ${inactive ? styles.inactive : ''}`}
                  onClick={() => onSelectPlayer(p)}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onSelectPlayer(p)}
                  role="button"
                  aria-label={`Open ${p.name} profile`}
                >
                  <td className={styles.tdRank}>{displayRank}</td>
                  <td className={styles.tdName}>{p.name}</td>
                  <td className={styles.tdTeam}>{p.team}</td>
                  <td className={styles.tdElo}>
                    <div className={styles.eloWrap}>
                      <div className={styles.eloBar} style={{ width: barW }} />
                      <span className={styles.eloVal}>{p.current_elo.toFixed(0)}</span>
                    </div>
                  </td>
                  <td className={styles.tdNum} style={{ color: 'var(--gold)' }}>{p.peak_elo.toFixed(0)}</td>
                  <td className={styles.tdNum}>{p.games_played}</td>
                  <td className={styles.tdNum}>
                    <span className={styles.chip} style={{ background: gc + '22', color: gc }}>
                      {p.recent_gmsc_avg.toFixed(1)}
                    </span>
                  </td>
                  <td className={styles.tdNum}>{p.career_gmsc_avg.toFixed(1)}</td>
                  <td className={styles.tdNum}>
                    <span className={inactive ? styles.stale : styles.fresh}>
                      {p.last_played ? p.last_played.slice(5) : '—'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.paging}>
        <span className={styles.pagingInfo}>
          {filtered.length === 0
            ? 'No results'
            : `Showing ${page * PER_PAGE + 1}–${Math.min((page + 1) * PER_PAGE, filtered.length)} of ${filtered.length}`}
        </span>
        <div className={styles.pagingBtns}>
          <button className={styles.pageBtn} onClick={() => setPage(0)} disabled={page === 0}>««</button>
          <button className={styles.pageBtn} onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹ Prev</button>
          <span className={styles.pageNum}>{page + 1} / {totalPages}</span>
          <button className={styles.pageBtn} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next ›</button>
          <button className={styles.pageBtn} onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»»</button>
        </div>
      </div>
    </div>
  )
}
