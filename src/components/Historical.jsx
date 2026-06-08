import { useState, useMemo, useCallback } from 'react'

const PER_PAGE = 50
const SORT_OPTIONS = [
  { key: 'peak_elo',        label: 'Peak Elo',      asc: false },
  { key: 'current_elo',     label: 'Current Elo',   asc: false },
  { key: 'career_gmsc_avg', label: 'Career GmSc',   asc: false },
  { key: 'games_played',    label: 'Games Played',  asc: false },
]

function eraLabel(firstDate, lastDate) {
  if (!firstDate || !lastDate) return '—'
  const y1 = firstDate.slice(0, 4)
  const y2 = lastDate.slice(0, 4)
  return y1 === y2 ? y1 : `${y1}–${y2}`
}

function peakColor(peak) {
  if (peak >= 3000) return '#c9920a'
  if (peak >= 2800) return '#2d8a5a'
  if (peak >= 2600) return '#1a5fa8'
  return '#888'
}

export default function Historical({ players, onSelectPlayer }) {
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState('peak_elo')
  const [sortAsc, setSortAsc] = useState(false)
  const [page,    setPage]    = useState(0)
  const [era,     setEra]     = useState('all')

  const setSort = useCallback((key, asc) => {
    setSortKey(key); setSortAsc(asc); setPage(0)
  }, [])

  // Enrich players with first/last year
  const enriched = useMemo(() => players.map(p => {
    const hist = p.elo_history || []
    const first = hist.length ? hist[0][0] : null
    const last  = hist.length ? hist[hist.length - 1][0] : null
    const firstYear = first ? parseInt(first.slice(0, 4)) : null
    const avgElo = hist.length
      ? Math.round(hist.reduce((s, h) => s + h[1], 0) / hist.length)
      : Math.round(p.current_elo)
    return { ...p, firstDate: first, lastDate: last, firstYear, avgElo }
  }), [players])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched
      .filter(p => {
        if (q && !p.name.toLowerCase().includes(q) && !p.team.toLowerCase().includes(q)) return false
        if (era === 'pre1980' && (!p.firstYear || p.firstYear >= 1980)) return false
        if (era === '1980s'   && (!p.firstYear || p.firstYear < 1980 || p.firstYear >= 1990)) return false
        if (era === '1990s'   && (!p.firstYear || p.firstYear < 1990 || p.firstYear >= 2000)) return false
        if (era === '2000s'   && (!p.firstYear || p.firstYear < 2000 || p.firstYear >= 2010)) return false
        if (era === '2010s'   && (!p.firstYear || p.firstYear < 2010 || p.firstYear >= 2020)) return false
        if (era === '2020s'   && (!p.firstYear || p.firstYear < 2020)) return false
        return true
      })
      .sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey])
  }, [enriched, search, sortKey, sortAsc, era])

  const slice      = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const maxPeak    = useMemo(() => Math.max(...filtered.map(p => p.peak_elo)), [filtered])

  const s = {
    wrap:       { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    pageHeader: { padding: '28px 32px 0' },
    pageTitle:  { fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888', marginBottom: 20 },
    controls:   { display: 'flex', alignItems: 'center', gap: 8, padding: '0 32px 16px', flexWrap: 'wrap' },
    searchWrap: { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 8, padding: '0 12px', color: '#aaa', minWidth: 220, flex: 1, maxWidth: 280 },
    search:     { background: 'none', border: 'none', outline: 'none', color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: '8px 0', width: '100%' },
    sortGroup:  { display: 'flex', gap: 4, flexWrap: 'wrap' },
    eraGroup:   { display: 'flex', gap: 4, flexWrap: 'wrap', marginLeft: 'auto' },
    btn:        (active) => ({
      background: active ? '#1a2e1a' : '#fff',
      border: `0.5px solid ${active ? '#1a2e1a' : '#e0ddd6'}`,
      borderRadius: 8, padding: '7px 12px',
      fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500,
      color: active ? '#fff' : '#888',
      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.12s',
    }),
    tableWrap:  { flex: 1, overflow: 'auto', background: '#fff', borderTop: '0.5px solid #e0ddd6' },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    thead:      { position: 'sticky', top: 0, zIndex: 10, background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    th:         { padding: '10px 14px', fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600, color: '#aaa', textAlign: 'left', whiteSpace: 'nowrap', letterSpacing: '0.8px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' },
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0ede8', cursor: 'pointer' },
    td:         { padding: '9px 14px' },
    tdRank:     { fontSize: 12, color: '#bbb', textAlign: 'right', width: 52, fontVariantNumeric: 'tabular-nums' },
    tdName:     { fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap' },
    tdTeam:     { fontSize: 11, color: '#aaa', whiteSpace: 'nowrap' },
    tdNum:      { textAlign: 'right', fontSize: 13, color: '#555', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
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
        <p style={s.pageDesc}>All-time player rankings by peak Elo · 1946 to present · {players.length.toLocaleString()} players</p>
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

        <div style={s.sortGroup}>
          {SORT_OPTIONS.map(opt => (
            <button key={opt.key} style={s.btn(sortKey === opt.key)} onClick={() => setSort(opt.key, opt.asc)}>
              {opt.label}
            </button>
          ))}
        </div>

        <div style={s.eraGroup}>
          {[['all','All Eras'],['pre1980','Pre-1980'],['1980s','1980s'],['1990s','1990s'],['2000s','2000s'],['2010s','2010s'],['2020s','2020s']].map(([val, label]) => (
            <button key={val} style={s.btn(era === val)} onClick={() => { setEra(val); setPage(0) }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead style={s.thead}>
            <tr>
              <th style={{ ...s.th, ...s.thR, width: 52, cursor: 'default' }}>#</th>
              <th style={{ ...s.th, cursor: 'default' }}>Player</th>
              <th style={{ ...s.th, cursor: 'default' }}>Last Team</th>
              <th style={{ ...s.th, cursor: 'default' }}>Career</th>
              <th style={{ ...s.th, ...s.thR }} onClick={() => setSort('peak_elo', sortKey === 'peak_elo' ? !sortAsc : false)}>
                Peak Elo {sortKey === 'peak_elo' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ ...s.th, ...s.thR }} onClick={() => setSort('current_elo', sortKey === 'current_elo' ? !sortAsc : false)}>
                Current Elo {sortKey === 'current_elo' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ ...s.th, ...s.thR }}>Avg Elo</th>
              <th style={{ ...s.th, ...s.thR }} onClick={() => setSort('career_gmsc_avg', sortKey === 'career_gmsc_avg' ? !sortAsc : false)}>
                Career GmSc {sortKey === 'career_gmsc_avg' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ ...s.th, ...s.thR }} onClick={() => setSort('games_played', sortKey === 'games_played' ? !sortAsc : false)}>
                GP {sortKey === 'games_played' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {slice.map((p, i) => {
              const rank  = page * PER_PAGE + i + 1
              const color = peakColor(p.peak_elo)
              const barW  = Math.max(2, Math.round((p.peak_elo / maxPeak) * 80))

              return (
                <tr
                  key={p.name}
                  style={s.row}
                  onClick={() => onSelectPlayer(p)}
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && onSelectPlayer(p)}
                  role="button"
                  aria-label={`Open ${p.name} profile`}
                  onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ ...s.td, ...s.tdRank }}>{rank}</td>
                  <td style={{ ...s.td, ...s.tdName }}>{p.name}</td>
                  <td style={{ ...s.td, ...s.tdTeam }}>{p.team}</td>
                  <td style={{ ...s.td, ...s.tdTeam }}>{eraLabel(p.firstDate, p.lastDate)}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <div style={{ height: 3, borderRadius: 2, background: color, opacity: 0.4, width: barW, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color, minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(p.peak_elo).toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td style={{ ...s.td, ...s.tdNum }}>{Math.round(p.current_elo).toLocaleString()}</td>
                  <td style={{ ...s.td, ...s.tdNum }}>{p.avgElo.toLocaleString()}</td>
                  <td style={{ ...s.td, ...s.tdNum }}>{p.career_gmsc_avg.toFixed(1)}</td>
                  <td style={{ ...s.td, ...s.tdNum }}>{p.games_played.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={s.paging}>
        <span style={s.pagingInfo}>
          {filtered.length === 0 ? 'No results' : `Showing ${page * PER_PAGE + 1}–${Math.min((page + 1) * PER_PAGE, filtered.length)} of ${filtered.length.toLocaleString()}`}
        </span>
        <div style={s.pagingBtns}>
          <button style={s.pageBtn} onClick={() => setPage(0)} disabled={page === 0}>««</button>
          <button style={s.pageBtn} onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹ Prev</button>
          <span style={s.pageNum}>{page + 1} / {totalPages}</span>
          <button style={s.pageBtn} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next ›</button>
          <button style={s.pageBtn} onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»»</button>
        </div>
      </div>
    </div>
  )
}
