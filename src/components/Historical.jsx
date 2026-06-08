import { useState, useMemo, useCallback } from 'react'

const PER_PAGE = 50

const ERAS = [
  { val: 'all',    label: 'All Eras',  start: 0,    end: 9999 },
  { val: 'pre1970',label: 'Pre-1970',  start: 0,    end: 1969 },
  { val: '1970s',  label: '1970s',     start: 1970, end: 1979 },
  { val: '1980s',  label: '1980s',     start: 1980, end: 1989 },
  { val: '1990s',  label: '1990s',     start: 1990, end: 1999 },
  { val: '2000s',  label: '2000s',     start: 2000, end: 2009 },
  { val: '2010s',  label: '2010s',     start: 2010, end: 2019 },
  { val: '2020s',  label: '2020s',     start: 2020, end: 9999 },
]

const SORT_OPTIONS = [
  { key: 'peak_elo',    label: 'Peak Elo',    asc: false },
  { key: 'avg_elo',     label: 'Avg Elo',     asc: false },
  { key: 'era_gmsc',    label: 'Avg GmSc',    asc: false },
  { key: 'era_gp',      label: 'Games',       asc: false },
]

function peakColor(peak) {
  if (peak >= 3000) return '#c9920a'
  if (peak >= 2800) return '#2d8a5a'
  if (peak >= 2600) return '#1a5fa8'
  return '#888'
}

function computeEraStats(p, start, end) {
  // Filter elo_history and gmsc_history to era window
  const eloHist  = (p.elo_history  || []).filter(([d]) => { const y = parseInt(d); return y >= start && y <= end })
  const gmscHist = (p.gmsc_history || []).filter(([d]) => { const y = parseInt(d); return y >= start && y <= end })

  if (!eloHist.length) return null

  const peak_elo = Math.max(...eloHist.map(([, v]) => v))
  const avg_elo  = Math.round(eloHist.reduce((s, [, v]) => s + v, 0) / eloHist.length)
  const era_gp   = eloHist.length
  const era_gmsc = gmscHist.length
    ? gmscHist.reduce((s, [, v]) => s + v, 0) / gmscHist.length
    : p.career_gmsc_avg
  const firstDate = eloHist[0][0]
  const lastDate  = eloHist[eloHist.length - 1][0]
  const y1 = firstDate.slice(0, 4)
  const y2 = lastDate.slice(0, 4)
  const range = y1 === y2 ? y1 : `${y1}–${y2}`

  return { peak_elo, avg_elo, era_gp, era_gmsc, range }
}

export default function Historical({ players, onSelectPlayer }) {
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState('peak_elo')
  const [sortAsc, setSortAsc] = useState(false)
  const [page,    setPage]    = useState(0)
  const [eraVal,  setEraVal]  = useState('all')

  const setSort = useCallback((key, asc) => {
    setSortKey(key); setSortAsc(asc); setPage(0)
  }, [])

  const era = ERAS.find(e => e.val === eraVal)

  // For each player, compute stats scoped to the selected era
  const enriched = useMemo(() => {
    const results = []
    for (const p of players) {
      const stats = computeEraStats(p, era.start, era.end)
      if (!stats) continue  // player didn't play in this era
      results.push({ ...p, ...stats })
    }
    return results
  }, [players, era])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey])
  }, [enriched, search, sortKey, sortAsc])

  const slice      = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const maxPeak    = useMemo(() => filtered.length ? Math.max(...filtered.map(p => p.peak_elo)) : 3200, [filtered])

  const s = {
    wrap:       { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    pageHeader: { padding: '28px 32px 0' },
    pageTitle:  { fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888', marginBottom: 20 },
    controls:   { display: 'flex', alignItems: 'center', gap: 8, padding: '0 32px 16px', flexWrap: 'wrap' },
    searchWrap: { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 8, padding: '0 12px', color: '#aaa', minWidth: 220, flex: 1, maxWidth: 280 },
    search:     { background: 'none', border: 'none', outline: 'none', color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: '8px 0', width: '100%' },
    sortGroup:  { display: 'flex', gap: 4, flexWrap: 'wrap' },
    eraGroup:   { display: 'flex', gap: 4, flexWrap: 'wrap' },
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
    tdMeta:     { fontSize: 11, color: '#aaa', whiteSpace: 'nowrap' },
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
        <p style={s.pageDesc}>
          All-time rankings by peak Elo · stats scoped to selected era · {filtered.length.toLocaleString()} players in {era.label}
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

        <div style={s.sortGroup}>
          {SORT_OPTIONS.map(opt => (
            <button key={opt.key} style={s.btn(sortKey === opt.key)} onClick={() => setSort(opt.key, opt.asc)}>
              {opt.label}
            </button>
          ))}
        </div>

        <div style={s.eraGroup}>
          {ERAS.map(e => (
            <button key={e.val} style={s.btn(eraVal === e.val)} onClick={() => { setEraVal(e.val); setPage(0) }}>
              {e.label}
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
              <th style={{ ...s.th, cursor: 'default' }}>Team</th>
              <th style={{ ...s.th, cursor: 'default' }}>{eraVal === 'all' ? 'Career' : 'In Era'}</th>
              <th style={{ ...s.th, ...s.thR }} onClick={() => setSort('peak_elo', sortKey === 'peak_elo' ? !sortAsc : false)}>
                Peak Elo {sortKey === 'peak_elo' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ ...s.th, ...s.thR }} onClick={() => setSort('avg_elo', sortKey === 'avg_elo' ? !sortAsc : false)}>
                Avg Elo {sortKey === 'avg_elo' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ ...s.th, ...s.thR }} onClick={() => setSort('era_gmsc', sortKey === 'era_gmsc' ? !sortAsc : false)}>
                Avg GmSc {sortKey === 'era_gmsc' ? (sortAsc ? '↑' : '↓') : ''}
              </th>
              <th style={{ ...s.th, ...s.thR }} onClick={() => setSort('era_gp', sortKey === 'era_gp' ? !sortAsc : false)}>
                GP {sortKey === 'era_gp' ? (sortAsc ? '↑' : '↓') : ''}
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
                  key={p.name + eraVal}
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
                  <td style={{ ...s.td, ...s.tdMeta }}>{p.team}</td>
                  <td style={{ ...s.td, ...s.tdMeta }}>{p.range}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <div style={{ height: 3, borderRadius: 2, background: color, opacity: 0.4, width: barW, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color, minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(p.peak_elo).toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td style={{ ...s.td, ...s.tdNum }}>{p.avg_elo.toLocaleString()}</td>
                  <td style={{ ...s.td, ...s.tdNum }}>{p.era_gmsc.toFixed(1)}</td>
                  <td style={{ ...s.td, ...s.tdNum }}>{p.era_gp.toLocaleString()}</td>
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
