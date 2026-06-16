import { useState, useMemo } from 'react'

const DIMENSIONS = [
  { key: 'peak_elo',  label: 'Peak Elo',    desc: 'Highest single Elo rating ever achieved' },
  { key: 'avg_elo',   label: 'Average Elo', desc: 'Career average Elo across all games' },
  { key: 'longevity', label: 'Longevity',   desc: 'Total games played' },
]

const PRESETS = [
  { label: 'Balanced',         weights: { peak_elo: 40, avg_elo: 40, longevity: 20 } },
  { label: 'Peak Performer',   weights: { peak_elo: 70, avg_elo: 25, longevity:  5 } },
  { label: 'Career Dominance', weights: { peak_elo: 20, avg_elo: 60, longevity: 20 } },
  { label: 'Ironman',          weights: { peak_elo: 15, avg_elo: 35, longevity: 50 } },
  { label: 'Pure Peak',        weights: { peak_elo:100, avg_elo:  0, longevity:  0 } },
]

const PRESET_HINTS = ['40/40/20', '70/25/5', '20/60/20', '15/35/50', '100/0/0']

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

function normalize(vals) {
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  if (max === min) return vals.map(() => 0)
  return vals.map(v => (v - min) / (max - min))
}

// Get elo_history entries for a player filtered to a specific franchise
// Combines all stints with that team
function franchiseEntries(p, franchise) {
  const hist = p.elo_history || []
  if (!hist.length) return []
  if (!franchise) return hist

  const teamHist = p.team_history || []

  // If no team_history, use p.team for all entries
  if (!teamHist.length) {
    return p.team === franchise ? hist : []
  }

  // Build date ranges for this franchise from team_history
  // team_history: [[date, team], ...] — records when team CHANGED TO this team
  // So a player was on team T from teamHist[i][0] until teamHist[i+1][0]-1
  const ranges = [] // [{start, end}]
  for (let i = 0; i < teamHist.length; i++) {
    const [changeDate, team] = teamHist[i]
    if (team !== franchise) continue
    const start = changeDate
    const end = i + 1 < teamHist.length ? teamHist[i + 1][0] : '9999-12-31'
    ranges.push({ start, end })
  }

  if (!ranges.length) return []

  return hist.filter(entry => {
    const d = entry[0]
    return ranges.some(r => d >= r.start && d < r.end)
  })
}

export default function Goat({ players, onSelectPlayer }) {
  const [weights,      setWeights]      = useState(PRESETS[0].weights)
  const [activePreset, setActivePreset] = useState(0)
  const [page,         setPage]         = useState(0)
  const [franchise,    setFranchise]    = useState(null)
  const PER_PAGE = 25
  const minGP = franchise ? 50 : 200  // lower threshold for franchise view

  const eligible = useMemo(() => {
    if (!franchise) return players.filter(p => p.games_played >= minGP)
    // For franchise filter: players who have any elo_history with this team
    return players.filter(p => franchiseEntries(p, franchise).length >= minGP)
  }, [players, franchise, minGP])

  const normalized = useMemo(() => {
    const peakElos = eligible.map(p => {
      const entries = franchiseEntries(p, franchise)
      if (!entries.length) return p.peak_elo
      return Math.max(...entries.map(e => e[1]))
    })
    const avgElos = eligible.map(p => {
      const entries = franchiseEntries(p, franchise)
      if (!entries.length) return p.current_elo
      return entries.reduce((s, e) => s + e[1], 0) / entries.length
    })
    const gps = eligible.map(p => franchiseEntries(p, franchise).length || p.games_played)
    return {
      peak_elo:  normalize(peakElos),
      avg_elo:   normalize(avgElos),
      longevity: normalize(gps),
    }
  }, [eligible, franchise])

  const avgEloMap = useMemo(() => {
    const map = {}
    eligible.forEach(p => {
      const entries = franchiseEntries(p, franchise)
      map[p.name] = entries.length
        ? Math.round(entries.reduce((s, e) => s + e[1], 0) / entries.length)
        : Math.round(p.current_elo)
    })
    return map
  }, [eligible, franchise])

  const peakEloMap = useMemo(() => {
    const map = {}
    eligible.forEach(p => {
      const entries = franchiseEntries(p, franchise)
      map[p.name] = entries.length
        ? Math.round(Math.max(...entries.map(e => e[1])))
        : Math.round(p.peak_elo)
    })
    return map
  }, [eligible, franchise])

  const gpMap = useMemo(() => {
    const map = {}
    eligible.forEach(p => {
      const entries = franchiseEntries(p, franchise)
      map[p.name] = entries.length || p.games_played
    })
    return map
  }, [eligible, franchise])

  const ranked = useMemo(() => {
    const total = Object.values(weights).reduce((s, v) => s + v, 0) || 1
    return eligible
      .map((p, i) => {
        const score = DIMENSIONS.reduce((s, dim) =>
          s + (weights[dim.key] / total) * (normalized[dim.key][i] || 0), 0
        )
        return { ...p, goat_score: score * 100 }
      })
      .sort((a, b) => b.goat_score - a.goat_score)
  }, [eligible, weights, normalized])

  const slice      = ranked.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const totalPages = Math.ceil(ranked.length / PER_PAGE)
  const totalW     = Object.values(weights).reduce((s, v) => s + v, 0)

  function setPreset(i) { setActivePreset(i); setWeights(PRESETS[i].weights); setPage(0) }
  function updateWeight(key, val) { setActivePreset(-1); setWeights(w => ({ ...w, [key]: val })) }

  const franchiseName = franchise ? NBA_TEAMS.find(t => t.abbr === franchise)?.name : null

  const s = {
    wrap:       { display: 'flex', flex: 1, overflow: 'hidden', background: '#f4f4f4', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" },
    sidebar:    { width: 260, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e0e0e0', display: 'flex', flexDirection: 'column', overflow: 'auto' },
    main:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    sideHead:   { padding: '24px 20px 16px', borderBottom: '0.5px solid #e0e0e0' },
    sideTitle:  { fontFamily: "'Georgia', serif", fontSize: 18, color: '#1a1a1a', marginBottom: 4 },
    sideDesc:   { fontSize: 12, color: '#888', lineHeight: 1.6 },
    section:    { padding: '14px 20px', borderBottom: '0.5px solid #f0f0f0' },
    sectionLbl: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 10 },
    presetGrid: { display: 'flex', flexDirection: 'column', gap: 5 },
    btn:        (active) => ({
      background: active ? '#003594' : '#f4f4f4',
      border: `0.5px solid ${active ? '#003594' : '#e0e0e0'}`,
      borderRadius: 7, padding: '7px 12px',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", fontSize: 12, fontWeight: 500,
      color: active ? '#fff' : '#555', cursor: 'pointer', textAlign: 'left',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }),
    franchiseGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 },
    fBtn:       (active) => ({
      background: active ? '#003594' : 'transparent',
      border: `0.5px solid ${active ? '#003594' : '#e0e0e0'}`,
      borderRadius: 6, padding: '5px 8px',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", fontSize: 11, fontWeight: active ? 600 : 400,
      color: active ? '#fff' : '#555', cursor: 'pointer', textAlign: 'left',
    }),
    sliders:    { padding: '14px 20px', flex: 1 },
    slidersLbl: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 14 },
    sliderRow:  { marginBottom: 20 },
    sliderTop:  { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
    sliderLabel:{ fontSize: 13, fontWeight: 500, color: '#333' },
    sliderDesc: { fontSize: 11, color: '#aaa', marginBottom: 7 },
    sliderVal:  { fontSize: 13, fontWeight: 600, color: '#003594' },
    totalRow:   { padding: '12px 20px', borderTop: '0.5px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
    totalLabel: { fontSize: 11, color: '#aaa' },
    totalVal:   (ok) => ({ fontSize: 13, fontWeight: 600, color: ok ? '#003594' : '#c94040' }),
    pageHeader: { padding: '24px 32px 16px' },
    pageTitle:  { fontFamily: "'Georgia', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888' },
    tableWrap:  { flex: 1, overflow: 'auto', background: '#fff', borderTop: '0.5px solid #e0e0e0' },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    thead:      { position: 'sticky', top: 0, zIndex: 10, background: '#f8f8f8', borderBottom: '0.5px solid #e0e0e0' },
    th:         { padding: '10px 14px', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", fontSize: 11, fontWeight: 600, color: '#aaa', textAlign: 'left', whiteSpace: 'nowrap', letterSpacing: '0.8px', textTransform: 'uppercase' },
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0f0f0', cursor: 'pointer' },
    td:         { padding: '9px 14px' },
    paging:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 32px', borderTop: '0.5px solid #e0e0e0', background: '#f8f8f8', flexShrink: 0 },
    pagingInfo: { fontSize: 12, color: '#aaa' },
    pagingBtns: { display: 'flex', alignItems: 'center', gap: 4 },
    pageBtn:    { background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#666', cursor: 'pointer', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" },
    pageNum:    { fontSize: 12, color: '#aaa', padding: '0 8px', minWidth: 60, textAlign: 'center' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.sidebar}>
        <div style={s.sideHead}>
          <div style={s.sideTitle}>GOAT Rankings</div>
          <div style={s.sideDesc}>Adjust weights to define greatness. Filter by franchise to see all-time team leaders.</div>
        </div>

        {/* Franchise filter */}
        <div style={s.section}>
          <div style={s.sectionLbl}>Franchise</div>
          <div style={{ marginBottom: 6 }}>
            <button style={s.btn(!franchise)} onClick={() => { setFranchise(null); setPage(0) }}>
              <span>All Franchises</span>
            </button>
          </div>
          <div style={s.franchiseGrid}>
            {NBA_TEAMS.map(t => (
              <button key={t.abbr} style={s.fBtn(franchise === t.abbr)}
                onClick={() => { setFranchise(franchise === t.abbr ? null : t.abbr); setPage(0) }}
                title={t.name}
              >
                {t.abbr}
              </button>
            ))}
          </div>
        </div>

        {/* Presets */}
        <div style={s.section}>
          <div style={s.sectionLbl}>Presets</div>
          <div style={s.presetGrid}>
            {PRESETS.map((p, i) => (
              <button key={p.label} style={s.btn(activePreset === i)} onClick={() => setPreset(i)}>
                <span>{p.label}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>{PRESET_HINTS[i]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div style={s.sliders}>
          <div style={s.slidersLbl}>Weights</div>
          {DIMENSIONS.map(dim => (
            <div key={dim.key} style={s.sliderRow}>
              <div style={s.sliderTop}>
                <span style={s.sliderLabel}>{dim.label}</span>
                <span style={s.sliderVal}>{weights[dim.key]}</span>
              </div>
              <div style={s.sliderDesc}>{dim.desc}</div>
              <input
                type="range" min={0} max={100} step={5}
                value={weights[dim.key]}
                onChange={e => updateWeight(dim.key, Number(e.target.value))}
                style={{ width: '100%', accentColor: '#003594' }}
              />
            </div>
          ))}
        </div>

        <div style={s.totalRow}>
          <span style={s.totalLabel}>Total weight</span>
          <span style={s.totalVal(totalW > 0)}>{totalW}</span>
        </div>
      </div>

      <div style={s.main}>
        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>
            {franchise
              ? `Greatest ${franchiseName} Ever`
              : activePreset >= 0 ? PRESETS[activePreset].label : 'Custom'}
          </h1>
          <p style={s.pageDesc}>
            {franchise
              ? `Min 50 GP with ${franchiseName} · stats scoped to time with this franchise · ${eligible.length} qualifying players`
              : `Min 200 GP · ${eligible.length.toLocaleString()} players · composite score 0–100`}
          </p>
        </div>

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead style={s.thead}>
              <tr>
                <th style={{ ...s.th, ...s.thR, width: 52 }}>#</th>
                <th style={s.th}>Player</th>
                <th style={s.th}>Team</th>
                <th style={{ ...s.th, ...s.thR }}>Score</th>
                <th style={{ ...s.th, ...s.thR }}>{franchise ? 'Franchise' : 'Career'} Peak Elo</th>
                <th style={{ ...s.th, ...s.thR }}>{franchise ? 'Franchise' : 'Career'} Avg Elo</th>
                <th style={{ ...s.th, ...s.thR }}>{franchise ? 'GP w/ Franchise' : 'GP'}</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((p, i) => {
                const rank     = page * PER_PAGE + i + 1
                const score    = p.goat_score
                const barColor = rank === 1 ? '#d4002a' : rank <= 5 ? '#003594' : rank <= 25 ? '#1a5fa8' : '#bbb'

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
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>{rank}</td>
                    <td style={{ ...s.td, fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{p.name}</td>
                    <td style={{ ...s.td, fontSize: 11, color: '#aaa' }}>{p.team}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <div style={{ height: 3, borderRadius: 2, background: barColor, opacity: 0.35, width: Math.round(score * 1.2), flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: barColor, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {score.toFixed(1)}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#d4002a', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      {(peakEloMap[p.name] || 0).toLocaleString()}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>
                      {(avgEloMap[p.name] || 0).toLocaleString()}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>
                      {(gpMap[p.name] || 0).toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={s.paging}>
          <span style={s.pagingInfo}>
            Showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, ranked.length)} of {ranked.length.toLocaleString()}
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
    </div>
  )
}
