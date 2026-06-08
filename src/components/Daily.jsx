import { useState, useMemo } from 'react'

function gmscColor(v) {
  if (v >= 25) return '#2d8a5a'
  if (v >= 18) return '#1a5fa8'
  if (v >= 12) return '#a87a0a'
  if (v >= 6)  return '#888'
  return '#c94040'
}

function deltaColor(v) {
  if (v > 0) return '#2d8a5a'
  if (v < 0) return '#c94040'
  return '#aaa'
}

function deltaStr(v) {
  if (v > 0) return `+${Math.round(v)}`
  return `${Math.round(v)}`
}

export default function Daily({ players, onSelectPlayer }) {
  // Find the most recent game date in the dataset
  const mostRecentDate = useMemo(() => {
    let latest = ''
    for (const p of players) {
      if (p.last_played > latest) latest = p.last_played
    }
    return latest
  }, [players])

  const [selectedDate, setSelectedDate] = useState('')

  // All dates that have game data
  const allDates = useMemo(() => {
    const s = new Set()
    for (const p of players) {
      for (const [d] of (p.elo_history || [])) s.add(d)
    }
    return [...s].sort().reverse()
  }, [players])

  const effectiveDate = selectedDate || mostRecentDate

  // Build daily changes for the effective date
  const dailyData = useMemo(() => {
    if (!effectiveDate) return []

    const results = []
    for (const p of players) {
      const eloHist  = p.elo_history  || []
      const gmscHist = p.gmsc_history || []

      // Find this player's entry on effectiveDate
      const todayElo  = eloHist.find(([d]) => d === effectiveDate)
      const todayGmsc = gmscHist.find(([d]) => d === effectiveDate)

      if (!todayElo) continue

      // Find previous Elo (last entry before effectiveDate)
      let prevElo = null
      for (const [d, v] of eloHist) {
        if (d < effectiveDate) prevElo = v
        else break
      }

      // Find previous rank
      const eloDelta = prevElo !== null ? todayElo[1] - prevElo : 0

      results.push({
        ...p,
        day_elo:   todayElo[1],
        day_gmsc:  todayGmsc ? todayGmsc[1] : null,
        elo_delta: eloDelta,
      })
    }

    return results.sort((a, b) => b.day_gmsc - a.day_gmsc)
  }, [players, effectiveDate])

  // Group by team
  const byTeam = useMemo(() => {
    const groups = {}
    for (const p of dailyData) {
      if (!groups[p.team]) groups[p.team] = []
      groups[p.team].push(p)
    }
    // Sort teams by highest GmSc player
    return Object.entries(groups)
      .sort((a, b) => (b[1][0]?.day_gmsc || 0) - (a[1][0]?.day_gmsc || 0))
  }, [dailyData])

  const s = {
    wrap:       { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    pageHeader: { padding: '24px 32px 16px', display: 'flex', alignItems: 'flex-end', gap: 20, borderBottom: '0.5px solid #e0ddd6', background: '#fff' },
    titleBlock: { flex: 1 },
    pageTitle:  { fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888' },
    datePicker: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 },
    dateInput:  { background: '#f5f3ee', border: '0.5px solid #e0ddd6', borderRadius: 8, padding: '7px 12px', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: '#1a1a1a', cursor: 'pointer' },
    scroll:     { flex: 1, overflow: 'auto', padding: '24px 32px' },
    teamSection:{ marginBottom: 32 },
    teamHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
    teamLabel:  { fontSize: 12, fontWeight: 600, color: '#1a2e1a', textTransform: 'uppercase', letterSpacing: 1, background: '#e8f0e0', padding: '3px 10px', borderRadius: 5 },
    teamCount:  { fontSize: 12, color: '#aaa' },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '0.5px solid #e0ddd6' },
    thead:      { background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    th:         { padding: '8px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'left', letterSpacing: '0.8px', textTransform: 'uppercase' },
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0ede8', cursor: 'pointer' },
    td:         { padding: '9px 14px' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.pageHeader}>
        <div style={s.titleBlock}>
          <h1 style={s.pageTitle}>Daily Changes</h1>
          <p style={s.pageDesc}>
            {dailyData.length} player-games on {effectiveDate} · sorted by GmSc within each team
          </p>
        </div>
        <div style={s.datePicker}>
          <span style={{ fontSize: 12, color: '#aaa' }}>Date</span>
          <input
            type="date"
            style={s.dateInput}
            value={selectedDate || effectiveDate}
            max={mostRecentDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
          {selectedDate && selectedDate !== mostRecentDate && (
            <button
              onClick={() => setSelectedDate('')}
              style={{ fontSize: 12, color: '#1a2e1a', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
            >
              → Today
            </button>
          )}
        </div>
      </div>

      <div style={s.scroll}>
        {byTeam.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#aaa', padding: 60 }}>No games found for this date</div>
        ) : byTeam.map(([team, teamPlayers]) => (
          <div key={team} style={s.teamSection}>
            <div style={s.teamHeader}>
              <span style={s.teamLabel}>{team}</span>
              <span style={s.teamCount}>{teamPlayers.length} players</span>
            </div>
            <table style={s.table}>
              <thead style={s.thead}>
                <tr>
                  <th style={s.th}>Player</th>
                  <th style={{ ...s.th, ...s.thR }}>GmSc</th>
                  <th style={{ ...s.th, ...s.thR }}>Elo</th>
                  <th style={{ ...s.th, ...s.thR }}>Δ Elo</th>
                  <th style={{ ...s.th, ...s.thR }}>FPR Rank</th>
                </tr>
              </thead>
              <tbody>
                {teamPlayers.map(p => {
                  const gc = p.day_gmsc !== null ? gmscColor(p.day_gmsc) : '#aaa'
                  const dc = deltaColor(p.elo_delta)
                  return (
                    <tr
                      key={p.name}
                      style={s.row}
                      onClick={() => onSelectPlayer(p)}
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && onSelectPlayer(p)}
                      role="button"
                      onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ ...s.td, fontWeight: 500, color: '#1a1a1a' }}>{p.name}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>
                        {p.day_gmsc !== null ? (
                          <span style={{ background: gc + '18', color: gc, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                            {p.day_gmsc.toFixed(1)}
                          </span>
                        ) : <span style={{ color: '#bbb' }}>—</span>}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(p.day_elo).toLocaleString()}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 13, fontWeight: 500, color: dc, fontVariantNumeric: 'tabular-nums' }}>
                        {deltaStr(p.elo_delta)}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>
                        #{p.current_tpr_rank}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
