import { useState, useMemo } from 'react'

const NBA_TEAMS = [
  'ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW',
  'HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK',
  'OKC','ORL','PHI','PHO','POR','SAC','SAS','TOR','UTA','WAS',
]

const TEAM_NAMES = {
  ATL:'Atlanta Hawks', BOS:'Boston Celtics', BKN:'Brooklyn Nets',
  CHA:'Charlotte Hornets', CHI:'Chicago Bulls', CLE:'Cleveland Cavaliers',
  DAL:'Dallas Mavericks', DEN:'Denver Nuggets', DET:'Detroit Pistons',
  GSW:'Golden State Warriors', HOU:'Houston Rockets', IND:'Indiana Pacers',
  LAC:'LA Clippers', LAL:'LA Lakers', MEM:'Memphis Grizzlies',
  MIA:'Miami Heat', MIL:'Milwaukee Bucks', MIN:'Minnesota Timberwolves',
  NOP:'New Orleans Pelicans', NYK:'New York Knicks', OKC:'Oklahoma City Thunder',
  ORL:'Orlando Magic', PHI:'Philadelphia 76ers', PHO:'Phoenix Suns',
  POR:'Portland Trail Blazers', SAC:'Sacramento Kings', SAS:'San Antonio Spurs',
  TOR:'Toronto Raptors', UTA:'Utah Jazz', WAS:'Washington Wizards',
}

function gmscColor(v) {
  if (v >= 25) return '#2d8a5a'
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

  // Active rank = rank among currently eligible players
  const activeRankMap = useMemo(() => {
    const sorted = [...activePlayers].sort((a, b) => b.current_elo - a.current_elo)
    const map = {}
    sorted.forEach((p, i) => { map[p.name] = i + 1 })
    return map
  }, [activePlayers])

  const teamPlayers = useMemo(() => {
    if (!selectedTeam) return []
    // Only show players active in 2025-26 season (last game after Oct 2025)
    return players
      .filter(p => p.team === selectedTeam && p.is_fpr_eligible && p.last_played >= '2025-10-01')
      .sort((a, b) => sortAsc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey])
  }, [players, selectedTeam, sortKey, sortAsc])

  const allTeamPlayers = useMemo(() => {
    if (!selectedTeam) return []
    return players.filter(p => p.team === selectedTeam)
  }, [players, selectedTeam])

  function setSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  const s = {
    wrap:       { display: 'flex', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    sidebar:    { width: 220, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e0ddd6', overflow: 'auto', display: 'flex', flexDirection: 'column' },
    sideHead:   { padding: '20px 16px 12px', borderBottom: '0.5px solid #e0ddd6', fontFamily: "'DM Serif Display', serif", fontSize: 16, color: '#1a1a1a' },
    teamBtn:    (active) => ({
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '9px 16px', cursor: 'pointer', borderBottom: '0.5px solid #f5f3ee',
      background: active ? '#1a2e1a' : 'transparent',
      border: 'none', width: '100%', textAlign: 'left',
      transition: 'background 0.1s',
    }),
    teamAbbr:   (active) => ({ fontSize: 12, fontWeight: 600, color: active ? '#7aaa7a' : '#aaa', letterSpacing: 0.5 }),
    teamName:   (active) => ({ fontSize: 13, fontWeight: 500, color: active ? '#fff' : '#333' }),
    main:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    pageHeader: { padding: '24px 32px 0' },
    pageTitle:  { fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888', marginBottom: 16 },
    statsRow:   { display: 'flex', gap: 12, padding: '0 32px 16px' },
    statCard:   { background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 10, padding: '12px 16px', minWidth: 100 },
    statLabel:  { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 4 },
    statVal:    { fontSize: 20, fontWeight: 500, color: '#1a1a1a', fontVariantNumeric: 'tabular-nums' },
    tableWrap:  { flex: 1, overflow: 'auto', background: '#fff', borderTop: '0.5px solid #e0ddd6' },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    thead:      { position: 'sticky', top: 0, zIndex: 10, background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    th:         (active) => ({ padding: '10px 14px', fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600, color: active ? '#1a2e1a' : '#aaa', textAlign: 'left', whiteSpace: 'nowrap', letterSpacing: '0.8px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }),
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0ede8', cursor: 'pointer' },
    td:         { padding: '10px 14px' },
  }

  const sortArrow = (key) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''

  return (
    <div style={s.wrap}>
      {/* Team sidebar */}
      <div style={s.sidebar}>
        <div style={s.sideHead}>Teams</div>
        {NBA_TEAMS.map(abbr => (
          <button
            key={abbr}
            style={s.teamBtn(selectedTeam === abbr)}
            onClick={() => setSelectedTeam(abbr)}
            onMouseEnter={e => { if (selectedTeam !== abbr) e.currentTarget.style.background = '#f5f3ee' }}
            onMouseLeave={e => { if (selectedTeam !== abbr) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={s.teamName(selectedTeam === abbr)}>{TEAM_NAMES[abbr]}</span>
            <span style={s.teamAbbr(selectedTeam === abbr)}>{abbr}</span>
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={s.main}>
        {!selectedTeam ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#aaa', fontSize: 14 }}>
            Select a team to see their current roster
          </div>
        ) : (
          <>
            <div style={s.pageHeader}>
              <h1 style={s.pageTitle}>{TEAM_NAMES[selectedTeam]}</h1>
              <p style={s.pageDesc}>Current FPR-eligible players · Elo ratings and rankings</p>
            </div>

            {/* Team stat cards */}
            <div style={s.statsRow}>
              {[
                { label: 'Active Players',  val: teamPlayers.length },
                { label: 'Roster Size',     val: allTeamPlayers.length },
                { label: 'Top Elo',         val: teamPlayers[0] ? Math.round(teamPlayers[0].current_elo).toLocaleString() : '—' },
                { label: 'Avg Team Elo',    val: teamPlayers.length ? Math.round(teamPlayers.reduce((s, p) => s + p.current_elo, 0) / teamPlayers.length).toLocaleString() : '—' },
                { label: 'Best FPR Rank',   val: teamPlayers.length ? `#${Math.min(...teamPlayers.map(p => p.current_tpr_rank))}` : '—' },
              ].map(({ label, val }) => (
                <div key={label} style={s.statCard}>
                  <div style={s.statLabel}>{label}</div>
                  <div style={s.statVal}>{val}</div>
                </div>
              ))}
            </div>

            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead style={s.thead}>
                  <tr>
                    <th style={{ ...s.th(false), width: 52, textAlign: 'right' }}>Active Rank</th>
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
                  {teamPlayers.map(p => {
                    const gc = gmscColor(p.recent_gmsc_avg)
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
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>
                          #{activeRankMap[p.name] || p.current_tpr_rank}
                        </td>
                        <td style={{ ...s.td, fontWeight: 500, color: '#1a1a1a' }}>{p.name}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 14, fontWeight: 500, color: '#1a1a1a', fontVariantNumeric: 'tabular-nums' }}>
                          {Math.round(p.current_elo).toLocaleString()}
                        </td>
                        <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#c9920a', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
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
