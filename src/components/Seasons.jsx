import { useState, useMemo } from 'react'

// Generate season labels 1946-47 through 2025-26
const SEASONS = []
for (let y = 1946; y <= 2025; y++) {
  const label = `${y}-${String(y + 1).slice(-2)}`
  const endDate = `${y + 1}-09-30`  // season ends by Sep of following year
  const startDate = `${y}-09-01`    // season starts Sep of start year
  SEASONS.push({ label, year: y, startDate, endDate })
}
SEASONS.reverse() // most recent first

function medalColor(rank) {
  if (rank === 1) return '#c9920a'
  if (rank === 2) return '#888'
  if (rank === 3) return '#a0522d'
  return '#bbb'
}

function medalEmoji(rank) {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return null
}

export default function Seasons({ players, onSelectPlayer }) {
  const [selectedSeason, setSelectedSeason] = useState(SEASONS[0])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)

  // For a given season, find the top 5 players by peak Elo within that season's dates
  const seasonRankings = useMemo(() => {
    const { startDate, endDate } = selectedSeason
    const results = []

    for (const p of players) {
      const hist = p.elo_history || []
      const seasonEntries = hist.filter(([d]) => d >= startDate && d <= endDate)
      if (!seasonEntries.length) continue

      const peakInSeason = Math.max(...seasonEntries.map(([, v]) => v))
      const peakEntry = seasonEntries.reduce((best, cur) => cur[1] > best[1] ? cur : best)
      const avgInSeason = Math.round(seasonEntries.reduce((s, [, v]) => s + v, 0) / seasonEntries.length)

      // Team during this season: last team_history entry on or before endDate
      const teamHist = p.team_history || []
      let teamInSeason = p.team
      for (const [d, t] of teamHist) {
        if (d <= endDate) teamInSeason = t
        else break
      }

      results.push({
        ...p,
        season_peak: peakInSeason,
        season_peak_date: peakEntry[0],
        season_avg: avgInSeason,
        season_gp: seasonEntries.length,
        team_in_season: teamInSeason,
      })
    }

    return results
      .sort((a, b) => b.season_peak - a.season_peak)
      .map((p, i) => ({ ...p, season_rank: i + 1 }))
  }, [players, selectedSeason])

  const top5 = seasonRankings.slice(0, 5)

  // Player search across all seasons
  const handleSearch = (q) => {
    setSearch(q)
    if (!q.trim()) { setSearchResults([]); return }
    const ql = q.toLowerCase()
    setSearchResults(players.filter(p => p.name.toLowerCase().includes(ql)).slice(0, 6))
    setSearchOpen(true)
  }

  // Find which seasons a searched player was top-5 in
  const playerSeasonHighlights = useMemo(() => {
    if (!search.trim()) return null
    const target = players.find(p => p.name.toLowerCase().includes(search.toLowerCase()))
    if (!target) return null

    const highlights = []
    for (const season of SEASONS) {
      const hist = target.elo_history || []
      const entries = hist.filter(([d]) => d >= season.startDate && d <= season.endDate)
      if (!entries.length) continue
      const peak = Math.max(...entries.map(([, v]) => v))
      highlights.push({ season, peak, gp: entries.length })
    }
    return { player: target, seasons: highlights.sort((a, b) => b.peak - a.peak) }
  }, [search, players])

  const s = {
    wrap:       { display: 'flex', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    sidebar:    { width: 180, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e0ddd6', overflow: 'auto', display: 'flex', flexDirection: 'column' },
    sideHead:   { padding: '16px 14px 10px', borderBottom: '0.5px solid #e0ddd6', fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 },
    seasonBtn:  (active) => ({
      display: 'block', width: '100%', textAlign: 'left',
      padding: '8px 14px', border: 'none', borderBottom: '0.5px solid #f5f3ee',
      background: active ? '#1a2e1a' : 'transparent',
      color: active ? '#fff' : '#555', fontSize: 13, fontWeight: active ? 500 : 400,
      cursor: 'pointer',
    }),
    main:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' },
    header:     { padding: '28px 32px 20px' },
    title:      { fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    subtitle:   { fontSize: 13, color: '#888' },
    searchWrap: { position: 'relative', marginBottom: 24 },
    searchBox:  { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 8, padding: '0 12px', maxWidth: 320 },
    searchInput:{ background: 'none', border: 'none', outline: 'none', color: '#1a1a1a', fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: '9px 0', width: '100%' },
    dropdown:   { position: 'absolute', top: '100%', left: 0, width: 320, background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 8, marginTop: 4, zIndex: 100, overflow: 'hidden' },
    podium:     { display: 'flex', gap: 16, padding: '0 32px 32px' },
    card1:      { flex: 1.2, background: '#1a2e1a', borderRadius: 14, padding: '24px', color: '#fff' },
    card2:      { flex: 1, background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 14, padding: '20px' },
    rankBadge:  (rank) => ({
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: 8,
      background: rank === 1 ? 'rgba(201,146,10,0.2)' : 'rgba(0,0,0,0.06)',
      color: medalColor(rank), fontSize: 13, fontWeight: 700, marginBottom: 10,
    }),
    tableSection:{ padding: '0 32px 32px' },
    tableTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 12 },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '0.5px solid #e0ddd6' },
    th:         { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#aaa', textAlign: 'left', letterSpacing: '0.8px', textTransform: 'uppercase', background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0ede8', cursor: 'pointer' },
    td:         { padding: '10px 14px' },
  }

  return (
    <div style={s.wrap}>
      {/* Season sidebar */}
      <div style={s.sidebar}>
        <div style={s.sideHead}>Season</div>
        {SEASONS.map(season => (
          <button
            key={season.label}
            style={s.seasonBtn(selectedSeason.label === season.label)}
            onClick={() => setSelectedSeason(season)}
          >
            {season.label}
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={s.main}>
        <div style={s.header}>
          <h1 style={s.title}>{selectedSeason.label} Season</h1>
          <p style={s.subtitle}>Top 5 players by peak Elo · {top5.length ? `${seasonRankings.length} players with data` : 'No data for this season'}</p>

          {/* Player search */}
          <div style={{ ...s.searchWrap, marginTop: 16 }}>
            <div style={s.searchBox}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                style={s.searchInput}
                placeholder="Find a player across all seasons…"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                onFocus={() => search && setSearchOpen(true)}
              />
              {search && <button style={{ background: 'none', border: 'none', color: '#bbb', cursor: 'pointer' }} onClick={() => { setSearch(''); setSearchResults([]); }}>✕</button>}
            </div>
            {searchOpen && searchResults.length > 0 && (
              <div style={s.dropdown}>
                {searchResults.map(p => (
                  <div
                    key={p.name}
                    style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13 }}
                    onClick={() => { setSearch(p.name); setSearchResults([]); setSearchOpen(false) }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f5f3ee'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {p.name} <span style={{ color: '#aaa', fontSize: 11 }}>{p.team}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Player search results */}
        {playerSeasonHighlights && (
          <div style={s.tableSection}>
            <div style={s.tableTitle}>{playerSeasonHighlights.player.name} — Season by Season</div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Season</th>
                  <th style={{ ...s.th, ...s.thR }}>Peak Elo</th>
                  <th style={{ ...s.th, ...s.thR }}>GP in Season</th>
                </tr>
              </thead>
              <tbody>
                {playerSeasonHighlights.seasons.slice(0, 20).map(({ season, peak, gp }) => (
                  <tr
                    key={season.label}
                    style={{ ...s.row, background: selectedSeason.label === season.label ? '#f0f5f0' : 'transparent' }}
                    onClick={() => setSelectedSeason(season)}
                    onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                    onMouseLeave={e => e.currentTarget.style.background = selectedSeason.label === season.label ? '#f0f5f0' : 'transparent'}
                  >
                    <td style={s.td}>{season.label}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontWeight: 600, color: '#c9920a', fontVariantNumeric: 'tabular-nums' }}>{Math.round(peak).toLocaleString()}</td>
                    <td style={{ ...s.td, textAlign: 'right', color: '#555', fontVariantNumeric: 'tabular-nums' }}>{gp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Top 5 podium */}
        {!playerSeasonHighlights && top5.length > 0 && (
          <>
            <div style={s.podium}>
              {top5.map((p, i) => {
                const isFirst = i === 0
                return (
                  <div
                    key={p.name}
                    style={isFirst ? s.card1 : s.card2}
                    onClick={() => onSelectPlayer(p)}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    role="button"
                    tabIndex={0}
                    style={{ ...(isFirst ? s.card1 : s.card2), cursor: 'pointer' }}
                  >
                    <div style={s.rankBadge(i + 1)}>
                      {medalEmoji(i + 1) || `#${i + 1}`}
                    </div>
                    <div style={{ fontSize: isFirst ? 20 : 16, fontFamily: "'DM Serif Display', serif", color: isFirst ? '#fff' : '#1a1a1a', marginBottom: 4 }}>
                      {p.name}
                    </div>
                    <div style={{ fontSize: 11, color: isFirst ? '#7aaa7a' : '#aaa', marginBottom: 12 }}>
                      {p.team_in_season} · {p.season_gp} games
                    </div>
                    <div style={{ display: 'flex', gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: isFirst ? '#7aaa7a' : '#bbb', marginBottom: 2 }}>Peak Elo</div>
                        <div style={{ fontSize: isFirst ? 24 : 18, fontWeight: 600, color: isFirst ? '#ffd700' : '#c9920a', fontVariantNumeric: 'tabular-nums' }}>
                          {Math.round(p.season_peak).toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: isFirst ? '#7aaa7a' : '#bbb', marginBottom: 2 }}>Avg Elo</div>
                        <div style={{ fontSize: isFirst ? 20 : 15, fontWeight: 400, color: isFirst ? '#e0e0e0' : '#555', fontVariantNumeric: 'tabular-nums' }}>
                          {p.season_avg.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Full season table */}
            <div style={s.tableSection}>
              <div style={s.tableTitle}>Full {selectedSeason.label} Rankings</div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, width: 40, textAlign: 'right' }}>#</th>
                    <th style={s.th}>Player</th>
                    <th style={s.th}>Team</th>
                    <th style={{ ...s.th, ...s.thR }}>Season Peak Elo</th>
                    <th style={{ ...s.th, ...s.thR }}>Season Avg Elo</th>
                    <th style={{ ...s.th, ...s.thR }}>GP</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonRankings.slice(0, 50).map(p => (
                    <tr
                      key={p.name}
                      style={s.row}
                      onClick={() => onSelectPlayer(p)}
                      onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      role="button" tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && onSelectPlayer(p)}
                    >
                      <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>{p.season_rank}</td>
                      <td style={{ ...s.td, fontWeight: 500, color: '#1a1a1a' }}>{p.name}</td>
                      <td style={{ ...s.td, fontSize: 11, color: '#aaa' }}>{p.team_in_season}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 600, color: '#c9920a', fontVariantNumeric: 'tabular-nums' }}>{Math.round(p.season_peak).toLocaleString()}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: '#555', fontVariantNumeric: 'tabular-nums' }}>{p.season_avg.toLocaleString()}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: '#555', fontVariantNumeric: 'tabular-nums' }}>{p.season_gp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!playerSeasonHighlights && top5.length === 0 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 14 }}>
            No player data found for {selectedSeason.label}
          </div>
        )}
      </div>
    </div>
  )
}
