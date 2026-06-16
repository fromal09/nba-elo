import { useState, useMemo } from 'react'

const NBA_TEAMS = [
  { abbr: 'ATL', name: 'Atlanta Hawks' },
  { abbr: 'BOS', name: 'Boston Celtics' },
  { abbr: 'BKN', name: 'Brooklyn Nets' },
  { abbr: 'CHA', name: 'Charlotte Hornets' },
  { abbr: 'CHI', name: 'Chicago Bulls' },
  { abbr: 'CLE', name: 'Cleveland Cavaliers' },
  { abbr: 'DAL', name: 'Dallas Mavericks' },
  { abbr: 'DEN', name: 'Denver Nuggets' },
  { abbr: 'DET', name: 'Detroit Pistons' },
  { abbr: 'GSW', name: 'Golden State Warriors' },
  { abbr: 'HOU', name: 'Houston Rockets' },
  { abbr: 'IND', name: 'Indiana Pacers' },
  { abbr: 'LAC', name: 'LA Clippers' },
  { abbr: 'LAL', name: 'LA Lakers' },
  { abbr: 'MEM', name: 'Memphis Grizzlies' },
  { abbr: 'MIA', name: 'Miami Heat' },
  { abbr: 'MIL', name: 'Milwaukee Bucks' },
  { abbr: 'MIN', name: 'Minnesota Timberwolves' },
  { abbr: 'NOP', name: 'New Orleans Pelicans' },
  { abbr: 'NYK', name: 'New York Knicks' },
  { abbr: 'OKC', name: 'Oklahoma City Thunder' },
  { abbr: 'ORL', name: 'Orlando Magic' },
  { abbr: 'PHI', name: 'Philadelphia 76ers' },
  { abbr: 'PHO', name: 'Phoenix Suns' },
  { abbr: 'POR', name: 'Portland Trail Blazers' },
  { abbr: 'SAC', name: 'Sacramento Kings' },
  { abbr: 'SAS', name: 'San Antonio Spurs' },
  { abbr: 'TOR', name: 'Toronto Raptors' },
  { abbr: 'UTA', name: 'Utah Jazz' },
  { abbr: 'WAS', name: 'Washington Wizards' },
]

function gmscColor(v) {
  if (v >= 25) return '#173657'
  if (v >= 18) return '#1a5fa8'
  if (v >= 12) return '#a87a0a'
  return '#888'
}

export default function Teams({ players, onSelectPlayer }) {
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [sortKey, setSortKey] = useState('current_elo')
  const [sortAsc, setSortAsc] = useState(false)

  const activePlayers = useMemo(() =>
    players.filter(p => p.is_fpr_eligible), [players]
  )

  const activeRankMap = useMemo(() => {
    const sorted = [...activePlayers].sort((a, b) => b.current_elo - a.current_elo)
    const map = {}
    sorted.forEach((p, i) => { map[p.name] = i + 1 })
    return map
  }, [activePlayers])

  const teamPlayers = useMemo(() => {
    if (!selectedTeam) return []
    return players
      .filter(p => p.team === selectedTeam && p.is_fpr_eligible && p.last_played >= '2025-10-01')
      .sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey])
  }, [players, selectedTeam, sortKey, sortAsc])

  function setSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sortArrow = (key) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''

  const s = {
    wrap:     { display: 'flex', flex: 1, overflow: 'hidden', background: '#f4f4f4', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" },
    sidebar:  { width: 220, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e0e0e0', overflow: 'auto', display: 'flex', flexDirection: 'column' },
    sideHead: { padding: '20px 16px 12px', borderBottom: '0.5px solid #e0e0e0', fontFamily: "'Georgia', serif", fontSize: 16, color: '#1a1a1a', flexShrink: 0 },
    teamBtn:  (active) => ({
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '9px 16px', cursor: 'pointer', borderBottom: '0.5px solid #f4f4f4',
      background: active ? '#173657' : 'transparent',
      border: 'none', width: '100%', textAlign: 'left', transition: 'background 0.1s',
    }),
    main:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    pageHeader: { padding: '24px 32px 16px', borderBottom: '0.5px solid #e0e0e0' },
    pageTitle:  { fontFamily: "'Georgia', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888' },
    tableWrap:  { flex: 1, overflow: 'auto', background: '#fff' },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    thead:      { position: 'sticky', top: 0, zIndex: 10, background: '#f8f8f8', borderBottom: '0.5px solid #e0e0e0' },
    th:         (active) => ({ padding: '10px 14px', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", fontSize: 11, fontWeight: 600, color: active ? '#173657' : '#aaa', textAlign: 'left', whiteSpace: 'nowrap', letterSpacing: '0.8px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }),
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0f0f0', cursor: 'pointer' },
    td:         { padding: '10px 14px' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.sidebar}>
        <div style={s.sideHead}>Teams</div>
        {NBA_TEAMS.map(({ abbr, name }) => (
          <button
            key={abbr}
            style={s.teamBtn(selectedTeam === abbr)}
            onClick={() => setSelectedTeam(abbr)}
            onMouseEnter={e => { if (selectedTeam !== abbr) e.currentTarget.style.background = '#f4f4f4' }}
            onMouseLeave={e => { if (selectedTeam !== abbr) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: selectedTeam === abbr ? '#fff' : '#333' }}>{name}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: selectedTeam === abbr ? '#6896bd' : '#aaa', letterSpacing: 0.5 }}>{abbr}</span>
          </button>
        ))}
      </div>

      <div style={s.main}>
        {!selectedTeam ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#aaa', fontSize: 14 }}>
            Select a team to see their current roster
          </div>
        ) : (
          <>
            <div style={s.pageHeader}>
              <h1 style={s.pageTitle}>{NBA_TEAMS.find(t => t.abbr === selectedTeam)?.name}</h1>
              <p style={s.pageDesc}>{teamPlayers.length} FPR-eligible players · 2025–26 season</p>
            </div>

            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead style={s.thead}>
                  <tr>
                    <th style={{ ...s.th(false), width: 80, textAlign: 'right' }}>Active Rank</th>
                    <th style={s.th(false)}>Player</th>
                    <th style={{ ...s.th(sortKey === 'current_elo'), ...s.thR }} onClick={() => setSort('current_elo')}>
                      Current Elo{sortArrow('current_elo')}
                    </th>
                    <th style={{ ...s.th(sortKey === 'peak_elo'), ...s.thR }} onClick={() => setSort('peak_elo')}>
                      Peak Elo{sortArrow('peak_elo')}
                    </th>
                    <th style={{ ...s.th(sortKey === 'recent_gmsc_avg'), ...s.thR }} onClick={() => setSort('recent_gmsc_avg')}>
                      Recent GmSc{sortArrow('recent_gmsc_avg')}
                    </th>
                    <th style={{ ...s.th(sortKey === 'games_played'), ...s.thR }} onClick={() => setSort('games_played')}>
                      GP{sortArrow('games_played')}
                    </th>
                    <th style={{ ...s.th(false), ...s.thR }}>Last Game</th>
                  </tr>
                </thead>
                <tbody>
                  {teamPlayers.length === 0 ? (
                    <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#aaa', padding: 40 }}>No active players found for this team</td></tr>
                  ) : teamPlayers.map(p => {
                    const gc = gmscColor(p.recent_gmsc_avg)
                    return (
                      <tr
                        key={p.name}
                        style={s.row}
                        onClick={() => onSelectPlayer(p)}
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && onSelectPlayer(p)}
                        role="button"
                        onMouseEnter={e => e.currentTarget.style.background = '#f8f8f8'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>
                          #{activeRankMap[p.name] || '—'}
                        </td>
                        <td style={{ ...s.td, fontWeight: 500, color: '#1a1a1a' }}>{p.name}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 14, fontWeight: 500, color: '#1a1a1a', fontVariantNumeric: 'tabular-nums' }}>
                          {Math.round(p.current_elo).toLocaleString()}
                        </td>
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#6896bd', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                          {Math.round(p.peak_elo).toLocaleString()}
                        </td>
                        <td style={{ ...s.td, textAlign: 'right' }}>
                          <span style={{ background: gc + '18', color: gc, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>
                            {p.recent_gmsc_avg.toFixed(1)}
                          </span>
                        </td>
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>
                          {p.games_played.toLocaleString()}
                        </td>
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#aaa' }}>
                          {p.last_played ? p.last_played.slice(5) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
