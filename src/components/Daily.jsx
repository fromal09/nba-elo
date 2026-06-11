import { useState, useMemo } from 'react'

function deltaColor(v) {
  if (v > 0) return '#2d8a5a'
  if (v < 0) return '#c94040'
  return '#aaa'
}

function deltaStr(v) {
  const r = Math.round(v)
  if (r > 0) return `+${r}`
  return `${r}`
}

function rankDeltaStr(v) {
  if (!v || v === 0) return null
  if (v > 0) return `▲${v}`   // moved up (rank number decreased) = good
  return `▼${Math.abs(v)}`    // fell down (rank number increased) = bad
}

function rankDeltaColor(v) {
  if (!v) return '#aaa'
  if (v > 0) return '#2d8a5a'  // improved = green
  return '#c94040'              // worsened = red
}

export default function Daily({ players, onSelectPlayer }) {
  const mostRecentDate = useMemo(() => {
    let latest = ''
    for (const p of players) {
      if (p.last_played > latest) latest = p.last_played
    }
    return latest
  }, [players])

  const [selectedDate, setSelectedDate] = useState('')
  const effectiveDate = selectedDate || mostRecentDate

  const dailyData = useMemo(() => {
    if (!effectiveDate) return []

    // Step 1: for every player find their Elo on effectiveDate and prev day
    const withElo = []
    for (const p of players) {
      const hist = p.elo_history || []
      const todayIdx = hist.findIndex(([d]) => d === effectiveDate)
      if (todayIdx === -1) continue  // didn't play this day

      const todayElo = hist[todayIdx][1]
      const prevElo  = todayIdx > 0 ? hist[todayIdx - 1][1] : todayElo
      const eloDelta = todayElo - prevElo
      withElo.push({ ...p, day_elo: todayElo, prev_elo: prevElo, elo_delta: eloDelta })
    }

    // Step 2: global rank on effectiveDate — sort ALL players by their Elo on that date
    const fprRankMap = {}
    players.forEach(p => { fprRankMap[p.name] = p.fpr_rank || p.current_tpr_rank })
    const allWithEloOnDate = []
    for (const p of players) {
      const hist = p.elo_history || []
      let eloOnDate = null
      for (const [d, v] of hist) {
        if (d <= effectiveDate) eloOnDate = v
        else break
      }
      if (eloOnDate !== null) allWithEloOnDate.push({ name: p.name, eloOnDate })
    }
    allWithEloOnDate.sort((a, b) => b.eloOnDate - a.eloOnDate)
    const rankOnDate = {}
    allWithEloOnDate.forEach(({ name }, i) => { rankOnDate[name] = i + 1 })

    // Step 3: previous day rank — Elo before this game
    const allWithPrevElo = []
    for (const p of players) {
      const hist = p.elo_history || []
      // Find last entry strictly BEFORE effectiveDate
      let prevEloGlobal = null
      for (const [d, v] of hist) {
        if (d < effectiveDate) prevEloGlobal = v
        else break
      }
      // If no prev entry, use starting Elo
      allWithPrevElo.push({ name: p.name, prevElo: prevEloGlobal ?? 1500 })
    }
    allWithPrevElo.sort((a, b) => b.prevElo - a.prevElo)
    // Build prev fpr rank: sort eligible players by their pre-game Elo
    const eligiblePrev = players
      .filter(p => p.is_fpr_eligible)
      .map(p => {
        const hist = p.elo_history || []
        const prevEntry = hist.find(e => e[0] === selectedDate)
        const prevElo = prevEntry ? (hist[hist.indexOf(prevEntry) - 1]?.[1] ?? prevEntry[1]) : p.current_elo
        return { name: p.name, prevElo }
      })
      .sort((a, b) => b.prevElo - a.prevElo)
    const prevRank = {}
    eligiblePrev.forEach(({ name }, i) => { prevRank[name] = i + 1 })

    // Step 4: compute rank delta and attach
    return withElo
      .map(p => ({
        ...p,
        rank_on_date: fprRankMap[p.name] || p.fpr_rank || p.current_tpr_rank,
        rank_delta: (prevRank[p.name] || 0) - (fprRankMap[p.name] || 0), // positive = improved
      }))
      .sort((a, b) => b.day_elo - a.day_elo)  // sort by current Elo desc
  }, [players, effectiveDate])

  // Group by team, sort teams by highest Elo player
  const byTeam = useMemo(() => {
    const groups = {}
    for (const p of dailyData) {
      if (!groups[p.team]) groups[p.team] = []
      groups[p.team].push(p)
    }
    return Object.entries(groups).sort((a, b) => b[1][0].day_elo - a[1][0].day_elo)
  }, [dailyData])

  const s = {
    wrap:       { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    header:     { padding: '24px 32px 20px', background: '#fff', borderBottom: '0.5px solid #e0ddd6', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' },
    pageTitle:  { fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888' },
    datePicker: { display: 'flex', alignItems: 'center', gap: 10 },
    dateInput:  { background: '#f5f3ee', border: '0.5px solid #e0ddd6', borderRadius: 8, padding: '7px 12px', fontFamily: "'DM Sans', sans-serif", fontSize: 13, color: '#1a1a1a', cursor: 'pointer' },
    scroll:     { flex: 1, overflow: 'auto', padding: '24px 32px' },
    teamSection:{ marginBottom: 28 },
    teamHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
    teamLabel:  { fontSize: 11, fontWeight: 700, color: '#1a2e1a', textTransform: 'uppercase', letterSpacing: 1.2, background: '#e8f0e0', padding: '3px 10px', borderRadius: 5 },
    teamCount:  { fontSize: 12, color: '#aaa' },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '0.5px solid #e0ddd6' },
    thead:      { background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    th:         { padding: '8px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'left', letterSpacing: '1px', textTransform: 'uppercase' },
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0ede8', cursor: 'pointer' },
    td:         { padding: '10px 14px' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h1 style={s.pageTitle}>Daily Changes</h1>
          <p style={s.pageDesc}>
            {dailyData.length} players · {effectiveDate} · sorted by current Elo within each team
          </p>
        </div>
        <div style={s.datePicker}>
          <span style={{ fontSize: 12, color: '#aaa' }}>Date</span>
          <input
            type="date"
            style={s.dateInput}
            value={selectedDate || effectiveDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
          {selectedDate && selectedDate !== mostRecentDate && (
            <button onClick={() => setSelectedDate('')} style={{ fontSize: 12, color: '#1a2e1a', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
              → Latest
            </button>
          )}
        </div>
      </div>

      <div style={s.scroll}>
        {byTeam.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#aaa', padding: 60, fontSize: 14 }}>No games found for this date</div>
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
                  <th style={{ ...s.th, ...s.thR }}>Current Elo</th>
                  <th style={{ ...s.th, ...s.thR }}>Δ Elo</th>
                  <th style={{ ...s.th, ...s.thR }}>FPR Rank</th>
                </tr>
              </thead>
              <tbody>
                {teamPlayers.map(p => {
                  const dc = deltaColor(p.elo_delta)
                  const rd = rankDeltaStr(p.rank_delta)
                  const rc = rankDeltaColor(p.rank_delta)
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
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 14, fontWeight: 500, color: '#1a1a1a', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(p.day_elo).toLocaleString()}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 600, color: dc, fontVariantNumeric: 'tabular-nums' }}>
                        {deltaStr(p.elo_delta)}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        <span style={{ fontSize: 13, color: '#555' }}>#{p.rank_on_date}</span>
                        {rd && (
                          <span style={{ fontSize: 11, color: rc, marginLeft: 6 }}>({rd})</span>
                        )}
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
