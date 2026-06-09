import { useState, useMemo, useCallback } from 'react'

const PER_PAGE = 50

const ERAS = [
  { val: 'all',     label: 'All Eras',  start: 0,    end: 9999 },
  { val: 'pre1970', label: 'Pre-1970',  start: 0,    end: 1969 },
  { val: '1970s',   label: '1970s',     start: 1970, end: 1979 },
  { val: '1980s',   label: '1980s',     start: 1980, end: 1989 },
  { val: '1990s',   label: '1990s',     start: 1990, end: 1999 },
  { val: '2000s',   label: '2000s',     start: 2000, end: 2009 },
  { val: '2010s',   label: '2010s',     start: 2010, end: 2019 },
  { val: '2020s',   label: '2020s',     start: 2020, end: 9999 },
]

function peakColor(peak) {
  if (peak >= 3000) return '#c9920a'
  if (peak >= 2800) return '#2d8a5a'
  if (peak >= 2600) return '#1a5fa8'
  return '#888'
}

function computeEraStats(p, start, end) {
  const eloHist  = (p.elo_history  || []).filter(([d]) => { const y = parseInt(d); return y >= start && y <= end })
  const gmscHist = (p.gmsc_history || []).filter(([d]) => { const y = parseInt(d); return y >= start && y <= end })
  if (!eloHist.length) return null
  const peak_elo = Math.max(...eloHist.map(([, v]) => v))
  const peakEntry = eloHist.reduce((best, cur) => cur[1] > best[1] ? cur : best, eloHist[0])
  const peak_date = peakEntry[0]
  const avg_elo   = Math.round(eloHist.reduce((s, [, v]) => s + v, 0) / eloHist.length)
  const era_gp    = eloHist.length
  const era_gmsc  = gmscHist.length
    ? gmscHist.reduce((s, [, v]) => s + v, 0) / gmscHist.length
    : p.career_gmsc_avg
  const endDateStr = `${end}-12-31`
  const teamHist = p.team_history || []
  let era_team = p.team
  for (const [d, t] of teamHist) {
    if (d <= endDateStr) era_team = t
    else break
  }
  const y1 = eloHist[0][0].slice(0, 4)
  const y2 = eloHist[eloHist.length - 1][0].slice(0, 4)
  return { peak_elo, peak_date, avg_elo, era_gp, era_gmsc, era_team, range: y1 === y2 ? y1 : `${y1}–${y2}` }
}

// For a given date string, find each player's Elo (last entry <= date)
function computeSnapshotRankings(players, targetDate) {
  if (!targetDate) return []

  // "Active" window: player must have played within ~6 months (180 days) of the target date
  // This prevents retired players from polluting the snapshot
  const targetMs = new Date(targetDate).getTime()
  const windowMs = 180 * 24 * 60 * 60 * 1000  // 180 days

  const results = []
  for (const p of players) {
    const hist     = p.elo_history  || []
    const teamHist = p.team_history || []
    if (!hist.length) continue

    // Find last elo entry on or before targetDate
    let elo = null, lastDate = null
    for (const [d, v] of hist) {
      if (d <= targetDate) { elo = v; lastDate = d }
      else break
    }
    if (elo === null || lastDate === null) continue

    // Filter: last game must be within 180 days of target date
    const lastMs = new Date(lastDate).getTime()
    if (targetMs - lastMs > windowMs) continue

    // Team on date: last team_history entry on or before targetDate
    let teamOnDate = p.team
    for (const [d, t] of teamHist) {
      if (d <= targetDate) teamOnDate = t
      else break
    }

    results.push({ ...p, snapshot_elo: elo, snapshot_date: lastDate, team_on_date: teamOnDate })
  }

  results.sort((a, b) => b.snapshot_elo - a.snapshot_elo)
  return results.map((p, i) => ({ ...p, snapshot_rank: i + 1 }))
}

export default function Historical({ players, onSelectPlayer }) {
  const [search,      setSearch]      = useState('')
  const [sortKey,     setSortKey]     = useState('peak_elo')
  const [sortAsc,     setSortAsc]     = useState(false)
  const [page,        setPage]        = useState(0)
  const [eraVal,      setEraVal]      = useState('all')
  const [mode,        setMode]        = useState('alltime')  // 'alltime' | 'snapshot'
  const [snapshotDate, setSnapshotDate] = useState('')

  const setSort = useCallback((key, asc) => {
    setSortKey(key); setSortAsc(asc); setPage(0)
  }, [])

  const era = ERAS.find(e => e.val === eraVal)

  // All unique game dates for snapping
  const allDates = useMemo(() => {
    const s = new Set()
    for (const p of players) {
      for (const [d] of (p.elo_history || [])) s.add(d)
    }
    return [...s].sort()
  }, [players])

  const minDate = allDates[0] || '1946-01-01'
  const maxDate = allDates[allDates.length - 1] || '2026-12-31'

  // Snap selected date to nearest previous game date
  const effectiveDate = useMemo(() => {
    if (!snapshotDate || !allDates.length) return null
    // Find last date <= snapshotDate
    let result = null
    for (const d of allDates) {
      if (d <= snapshotDate) result = d
      else break
    }
    return result
  }, [snapshotDate, allDates])

  // All-time mode: era-scoped stats
  const enrichedAllTime = useMemo(() => {
    const results = []
    for (const p of players) {
      const stats = computeEraStats(p, era.start, era.end)
      if (!stats) continue
      results.push({ ...p, ...stats })
    }
    return results
  }, [players, era])

  const filteredAllTime = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enrichedAllTime
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey])
  }, [enrichedAllTime, search, sortKey, sortAsc])

  // Snapshot mode
  const snapshotRankings = useMemo(() => {
    if (mode !== 'snapshot' || !effectiveDate) return []
    return computeSnapshotRankings(players, effectiveDate)
  }, [players, mode, effectiveDate])

  const filteredSnapshot = useMemo(() => {
    const q = search.trim().toLowerCase()
    return snapshotRankings.filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)
    )
  }, [snapshotRankings, search])

  const filtered      = mode === 'snapshot' ? filteredSnapshot : filteredAllTime
  const slice         = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const totalPages    = Math.ceil(filtered.length / PER_PAGE)

  const btn = (active) => ({
    background: active ? '#1a2e1a' : '#fff',
    border: `0.5px solid ${active ? '#1a2e1a' : '#e0ddd6'}`,
    borderRadius: 8, padding: '7px 12px',
    fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500,
    color: active ? '#fff' : '#888',
    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.12s',
  })

  const s = {
    wrap:       { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    pageHeader: { padding: '28px 32px 0' },
    pageTitle:  { fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888', marginBottom: 20 },
    controls:   { display: 'flex', alignItems: 'center', gap: 8, padding: '0 32px 16px', flexWrap: 'wrap' },
    searchWrap: { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 8, padding: '0 12px', color: '#aaa', minWidth: 200, flex: 1, maxWidth: 260 },
    search:     { background: 'none', border: 'none', outline: 'none', color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: '8px 0', width: '100%' },
    tableWrap:  { flex: 1, overflow: 'auto', background: '#fff', borderTop: '0.5px solid #e0ddd6' },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    thead:      { position: 'sticky', top: 0, zIndex: 10, background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    th:         (clickable) => ({ padding: '10px 14px', fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600, color: '#aaa', textAlign: 'left', whiteSpace: 'nowrap', letterSpacing: '0.8px', textTransform: 'uppercase', cursor: clickable ? 'pointer' : 'default', userSelect: 'none' }),
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0ede8', cursor: 'pointer' },
    td:         { padding: '9px 14px' },
    paging:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 32px', borderTop: '0.5px solid #e0ddd6', background: '#faf9f6', flexShrink: 0 },
    pagingInfo: { fontSize: 12, color: '#aaa' },
    pagingBtns: { display: 'flex', alignItems: 'center', gap: 4 },
    pageBtn:    { background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#666', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    pageNum:    { fontSize: 12, color: '#aaa', padding: '0 8px', minWidth: 60, textAlign: 'center' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.pageHeader}>
        <h1 style={s.pageTitle}>Historical Elo</h1>
        <p style={s.pageDesc}>
          {mode === 'snapshot' && effectiveDate
            ? `Rankings on ${effectiveDate} · ${filtered.length.toLocaleString()} players with data`
            : `All-time rankings · stats scoped to ${era.label} · ${filtered.length.toLocaleString()} players`}
        </p>
      </div>

      <div style={s.controls}>
        <div style={s.searchWrap}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            style={s.search}
            type="text"
            placeholder="Search players…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
          />
          {search && <button style={{ background: 'none', border: 'none', color: '#bbb', fontSize: 11, cursor: 'pointer' }} onClick={() => { setSearch(''); setPage(0) }}>✕</button>}
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', border: '0.5px solid #e0ddd6', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
          <button style={{ ...btn(mode === 'alltime'), borderRadius: 0, border: 'none', borderRight: '0.5px solid #e0ddd6' }}
            onClick={() => { setMode('alltime'); setPage(0) }}>All-Time</button>
          <button style={{ ...btn(mode === 'snapshot'), borderRadius: 0, border: 'none' }}
            onClick={() => { setMode('snapshot'); setPage(0) }}>Day in History</button>
        </div>

        {/* All-time: era filters */}
        {mode === 'alltime' && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ERAS.map(e => (
              <button key={e.val} style={btn(eraVal === e.val)} onClick={() => { setEraVal(e.val); setPage(0) }}>
                {e.label}
              </button>
            ))}
          </div>
        )}

        {/* Snapshot: date picker */}
        {mode === 'snapshot' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="date"
              min={minDate}
              max={maxDate}
              value={snapshotDate}
              onChange={e => { setSnapshotDate(e.target.value); setPage(0) }}
              style={{ background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 8, padding: '7px 12px', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: '#1a1a1a', cursor: 'pointer' }}
            />
            {snapshotDate && effectiveDate && snapshotDate !== effectiveDate && (
              <span style={{ fontSize: 12, color: '#888' }}>→ showing {effectiveDate} (nearest game day)</span>
            )}
            {snapshotDate && !effectiveDate && (
              <span style={{ fontSize: 12, color: '#c94040' }}>No game data before this date</span>
            )}
          </div>
        )}
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead style={s.thead}>
            {mode === 'snapshot' ? (
              <tr>
                <th style={{ ...s.th(false), ...s.thR, width: 52 }}>#</th>
                <th style={s.th(false)}>Player</th>
                <th style={s.th(false)}>Team</th>
                <th style={{ ...s.th(false), ...s.thR }}>Elo on Date</th>
                <th style={{ ...s.th(false), ...s.thR }}>Peak Elo</th>
                <th style={{ ...s.th(false) }}>Last Game</th>
              </tr>
            ) : (
              <tr>
                <th style={{ ...s.th(false), ...s.thR, width: 52 }}>#</th>
                <th style={s.th(false)}>Player</th>
                <th style={s.th(false)}>Team</th>
                <th style={s.th(false)}>{eraVal === 'all' ? 'Career' : 'In Era'}</th>
                <th style={{ ...s.th(true), ...s.thR }} onClick={() => setSort('peak_elo', sortKey === 'peak_elo' ? !sortAsc : false)}>
                  Peak Elo {sortKey === 'peak_elo' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th style={s.th(false)}>Peak Date</th>
                <th style={{ ...s.th(true), ...s.thR }} onClick={() => setSort('avg_elo', sortKey === 'avg_elo' ? !sortAsc : false)}>
                  Avg Elo {sortKey === 'avg_elo' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th style={{ ...s.th(true), ...s.thR }} onClick={() => setSort('era_gmsc', sortKey === 'era_gmsc' ? !sortAsc : false)}>
                  Avg GmSc {sortKey === 'era_gmsc' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
                <th style={{ ...s.th(true), ...s.thR }} onClick={() => setSort('era_gp', sortKey === 'era_gp' ? !sortAsc : false)}>
                  GP {sortKey === 'era_gp' ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {mode === 'snapshot' && !snapshotDate ? (
              <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#aaa', padding: '40px' }}>Select a date to see rankings</td></tr>
            ) : slice.map((p, i) => {
              const rank = page * PER_PAGE + i + 1

              if (mode === 'snapshot') {
                return (
                  <tr key={p.name} style={s.row}
                    onClick={() => onSelectPlayer(p)}
                    tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelectPlayer(p)} role="button"
                    onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>{rank}</td>
                    <td style={{ ...s.td, fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{p.name}</td>
                    <td style={{ ...s.td, fontSize: 11, color: '#aaa' }}>{p.team_on_date || p.team}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#1a2e1a', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(p.snapshot_elo).toLocaleString()}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#c9920a', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(p.peak_elo).toLocaleString()}
                    </td>
                    <td style={{ ...s.td, fontSize: 12, color: '#aaa' }}>{p.snapshot_date}</td>
                  </tr>
                )
              }

              const color = peakColor(p.peak_elo)
              return (
                <tr key={p.name + eraVal} style={s.row}
                  onClick={() => onSelectPlayer(p)}
                  tabIndex={0} onKeyDown={e => e.key === 'Enter' && onSelectPlayer(p)} role="button"
                  onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>{rank}</td>
                  <td style={{ ...s.td, fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td style={{ ...s.td, fontSize: 11, color: '#aaa' }}>{p.team}</td>
                  <td style={{ ...s.td, fontSize: 11, color: '#aaa' }}>{p.range}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(p.peak_elo).toLocaleString()}
                    </span>
                  </td>
                  <td style={{ ...s.td, fontSize: 12, color: '#aaa' }}>{p.peak_date || '—'}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>{p.avg_elo.toLocaleString()}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>{p.era_gmsc.toFixed(1)}</td>
                  <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>{p.era_gp.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={s.paging}>
        <span style={s.pagingInfo}>
          {filtered.length === 0
            ? (mode === 'snapshot' && snapshotDate ? 'No data' : 'Select a date')
            : `Showing ${page * PER_PAGE + 1}–${Math.min((page + 1) * PER_PAGE, filtered.length)} of ${filtered.length.toLocaleString()}`}
        </span>
        <div style={s.pagingBtns}>
          <button style={s.pageBtn} onClick={() => setPage(0)} disabled={page === 0}>««</button>
          <button style={s.pageBtn} onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹ Prev</button>
          <span style={s.pageNum}>{page + 1} / {Math.max(1, totalPages)}</span>
          <button style={s.pageBtn} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next ›</button>
          <button style={s.pageBtn} onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»»</button>
        </div>
      </div>
    </div>
  )
}
