import { useState, useMemo } from 'react'

// Complete franchise → all historical abbreviations used in BBRef data
const FRANCHISE_ALIASES = {
  ATL: ['ATL','STL','TRI','BOM'],           // Hawks: Atlanta, Milwaukee, St Louis, Tri-Cities, Bombers
  BOS: ['BOS'],
  BKN: ['BKN','BRK','NJN','NJA'],                 // Nets: Brooklyn, Newark, New Jersey
  CHA: ['CHA','CHO'],                  // Hornets: Charlotte, New Orleans
  CHI: ['CHI'],
  CLE: ['CLE'],
  DAL: ['DAL'],
  DEN: ['DEN','DNR'],                              // Nuggets incl ABA
  DET: ['DET','FTW'],                              // Pistons: Detroit, Fort Wayne
  GSW: ['GSW','SFW','PHW'],                        // Warriors: Golden State, SF, Philadelphia
  HOU: ['HOU','SDR'],                              // Rockets: Houston, San Diego
  IND: ['IND'],
  LAC: ['LAC','SDC','BUF'],                        // Clippers: LA, San Diego, Buffalo Braves
  LAL: ['LAL','MNL'],                              // Lakers: LA, Minneapolis
  MEM: ['MEM','VAN'],                              // Grizzlies: Memphis, Vancouver
  MIA: ['MIA'],
  MIL: ['MIL'],
  MIN: ['MIN'],
  NOP: ['NOP','NOH','NOK','NOM'],                  // Pelicans/Hornets: New Orleans
  NYK: ['NYK'],
  OKC: ['OKC','SEA'],                              // Thunder: OKC, Seattle SuperSonics
  ORL: ['ORL'],
  PHI: ['PHI','SYR'],                              // 76ers: Philadelphia, Syracuse Nationals
  PHO: ['PHO'],
  POR: ['POR'],
  SAC: ['SAC','KCK','CIN','ROC'],                  // Kings: Sacramento, KC, Cincinnati, Rochester
  SAS: ['SAS','SAA'],                              // Spurs incl ABA
  TOR: ['TOR'],
  UTA: ['UTA','NOJ'],                              // Jazz: Utah, New Orleans
  WAS: ['WAS','WSB','BAL','CAP'],                  // Wizards: Washington, Baltimore, Capital
}

const FRANCHISE_NAMES = {
  ATL:'Atlanta Hawks', BOS:'Boston Celtics', BKN:'Brooklyn Nets', CHA:'Charlotte Hornets',
  CHI:'Chicago Bulls', CLE:'Cleveland Cavaliers', DAL:'Dallas Mavericks', DEN:'Denver Nuggets',
  DET:'Detroit Pistons', GSW:'Golden State Warriors', HOU:'Houston Rockets', IND:'Indiana Pacers',
  LAC:'LA Clippers', LAL:'LA Lakers', MEM:'Memphis Grizzlies', MIA:'Miami Heat',
  MIL:'Milwaukee Bucks', MIN:'Minnesota Timberwolves', NOP:'New Orleans Pelicans', NYK:'New York Knicks',
  OKC:'Oklahoma City Thunder', ORL:'Orlando Magic', PHI:'Philadelphia 76ers', PHO:'Phoenix Suns',
  POR:'Portland Trail Blazers', SAC:'Sacramento Kings', SAS:'San Antonio Spurs', TOR:'Toronto Raptors',
  UTA:'Utah Jazz', WAS:'Washington Wizards',
}

// Determine what team a player was on at a given date
function teamAtDate(player, date) {
  const th = player.team_history || []
  if (!th.length) return player.team
  let team = player.team
  for (const [d, t] of th) {
    if (d <= date) team = t
    else break
  }
  return team
}

// Get date ranges when player was above threshold FOR a specific franchise
function franchiseThresholdRanges(player, franchise, threshold) {
  const aliases = FRANCHISE_ALIASES[franchise] || [franchise]
  const hist = player.elo_history || []
  if (!hist.length) return []

  const ranges = []
  let inRange = false
  let rangeStart = null

  for (let i = 0; i < hist.length; i++) {
    const entry = hist[i]
    const date = entry[0], elo = entry[1]
    const team = teamAtDate(player, date)
    const onFranchise = aliases.includes(team)
    const aboveThreshold = elo >= threshold

    if (onFranchise && aboveThreshold) {
      if (!inRange) { inRange = true; rangeStart = date }
    } else {
      if (inRange) {
        ranges.push({ start: rangeStart, end: hist[i-1][0], peak: Math.max(...hist.slice(ranges.length ? 0 : 0, i).map(e => e[1])) })
        inRange = false; rangeStart = null
      }
    }
  }
  if (inRange) {
    const lastDate = hist[hist.length - 1][0]
    ranges.push({ start: rangeStart, end: lastDate, peak: Math.max(...hist.filter((e,i2) => {
      const t = teamAtDate(player, e[0])
      return aliases.includes(t) && e[1] >= threshold
    }).map(e => e[1])) })
  }
  return ranges
}

// Get peak Elo for player while on franchise
function franchisePeak(player, franchise) {
  const aliases = FRANCHISE_ALIASES[franchise] || [franchise]
  const hist = player.elo_history || []
  let peak = 0
  for (const entry of hist) {
    const team = teamAtDate(player, entry[0])
    if (aliases.includes(team) && entry[1] > peak) peak = entry[1]
  }
  return peak
}

// Get total games for player while on franchise
function franchiseGames(player, franchise) {
  const aliases = FRANCHISE_ALIASES[franchise] || [franchise]
  const hist = player.elo_history || []
  return hist.filter(e => aliases.includes(teamAtDate(player, e[0]))).length
}

const ELO_PRESETS = [1800, 2000, 2200, 2400, 2500, 2600, 2700, 2800, 2900]

export default function FranchiseThreshold({ players, onSelectPlayer }) {
  const [franchise,  setFranchise]  = useState('LAL')
  const [threshold,  setThreshold]  = useState(2200)
  const [customElo,  setCustomElo]  = useState('')
  const [showPicker, setShowPicker] = useState(false)

  const effectiveThreshold = customElo ? parseInt(customElo) || threshold : threshold

  const results = useMemo(() => {
    const aliases = FRANCHISE_ALIASES[franchise] || [franchise]

    return players
      .filter(p => {
        const hist = p.elo_history || []
        return hist.some(e => {
          const team = teamAtDate(p, e[0])
          return aliases.includes(team) && e[1] >= effectiveThreshold
        })
      })
      .map(p => {
        const ranges = franchiseThresholdRanges(p, franchise, effectiveThreshold)
        const peak = franchisePeak(p, franchise)
        const gp = franchiseGames(p, franchise)
        const totalDays = ranges.reduce((s, r) => {
          const d1 = new Date(r.start), d2 = new Date(r.end)
          return s + Math.max(1, Math.round((d2 - d1) / 86400000))
        }, 0)
        return { ...p, ranges, peak, gp, totalDays }
      })
      .sort((a, b) => b.peak - a.peak)
  }, [players, franchise, effectiveThreshold])

  const franchiseName = FRANCHISE_NAMES[franchise]

  const s = {
    wrap:      { display: 'flex', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    sidebar:   { width: 240, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e0ddd6', display: 'flex', flexDirection: 'column', overflow: 'auto' },
    main:      { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    sideHead:  { padding: '22px 18px 14px', borderBottom: '0.5px solid #e0ddd6' },
    sideTitle: { fontFamily: "'DM Serif Display', serif", fontSize: 17, color: '#1a1a1a', marginBottom: 3 },
    sideDesc:  { fontSize: 12, color: '#888', lineHeight: 1.6 },
    section:   { padding: '14px 18px', borderBottom: '0.5px solid #f0ede8' },
    sectionLbl:{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 10 },
    teamGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 },
    teamBtn:   (active) => ({
      background: active ? '#1a2e1a' : 'transparent',
      border: `0.5px solid ${active ? '#1a2e1a' : '#e0ddd6'}`,
      borderRadius: 6, padding: '5px 4px',
      fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: active ? 600 : 400,
      color: active ? '#fff' : '#555', cursor: 'pointer', textAlign: 'center',
    }),
    eloGrid:   { display: 'flex', flexWrap: 'wrap', gap: 5 },
    eloBtn:    (active) => ({
      background: active ? '#1a2e1a' : 'transparent',
      border: `0.5px solid ${active ? '#1a2e1a' : '#e0ddd6'}`,
      borderRadius: 6, padding: '5px 10px',
      fontFamily: "'DM Mono', monospace", fontSize: 11, fontWeight: active ? 600 : 400,
      color: active ? '#fff' : '#555', cursor: 'pointer',
    }),
    customInput: {
      width: '100%', marginTop: 8, padding: '7px 10px',
      border: '0.5px solid #e0ddd6', borderRadius: 6,
      fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#333',
      background: '#fafaf8', outline: 'none',
    },
    pageHeader:{ padding: '22px 28px 14px' },
    pageTitle: { fontFamily: "'DM Serif Display', serif", fontSize: 26, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:  { fontSize: 13, color: '#888' },
    tableWrap: { flex: 1, overflow: 'auto', background: '#fff', borderTop: '0.5px solid #e0ddd6' },
    table:     { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    thead:     { position: 'sticky', top: 0, zIndex: 10, background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    th:        { padding: '9px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'left', whiteSpace: 'nowrap', letterSpacing: '0.8px', textTransform: 'uppercase' },
    thR:       { textAlign: 'right' },
    row:       { borderBottom: '0.5px solid #f0ede8', cursor: 'pointer' },
    td:        { padding: '10px 14px', verticalAlign: 'top' },
    empty:     { padding: '60px 32px', textAlign: 'center', color: '#aaa', fontSize: 14 },
  }

  return (
    <div style={s.wrap}>
      <div style={s.sidebar}>
        <div style={s.sideHead}>
          <div style={s.sideTitle}>Franchise Threshold</div>
          <div style={s.sideDesc}>Find every player who hit a given Elo level for a franchise — and when.</div>
        </div>

        <div style={s.section}>
          <div style={s.sectionLbl}>Franchise</div>
          <div style={s.teamGrid}>
            {Object.keys(FRANCHISE_NAMES).map(abbr => (
              <button key={abbr} style={s.teamBtn(franchise === abbr)}
                onClick={() => setFranchise(abbr)}
                title={FRANCHISE_NAMES[abbr]}
              >{abbr}</button>
            ))}
          </div>
        </div>

        <div style={s.section}>
          <div style={s.sectionLbl}>Elo Threshold</div>
          <div style={s.eloGrid}>
            {ELO_PRESETS.map(v => (
              <button key={v} style={s.eloBtn(!customElo && threshold === v)}
                onClick={() => { setThreshold(v); setCustomElo('') }}
              >{v}</button>
            ))}
          </div>
          <input
            type="number"
            placeholder="Custom Elo..."
            value={customElo}
            onChange={e => setCustomElo(e.target.value)}
            style={s.customInput}
          />
        </div>

        <div style={{ padding: '14px 18px', fontSize: 12, color: '#aaa', lineHeight: 1.7 }}>
          <div style={{ marginBottom: 6, fontWeight: 500, color: '#888' }}>Historical aliases</div>
          {(FRANCHISE_ALIASES[franchise] || [franchise]).join(', ')}
        </div>
      </div>

      <div style={s.main}>
        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>
            {franchiseName} · {effectiveThreshold}+ Elo
          </h1>
          <p style={s.pageDesc}>
            {results.length === 0
              ? 'No players found at this threshold'
              : `${results.length} player${results.length !== 1 ? 's' : ''} reached ${effectiveThreshold}+ Elo while with this franchise`}
          </p>
        </div>

        <div style={s.tableWrap}>
          {results.length === 0 ? (
            <div style={s.empty}>
              No players reached {effectiveThreshold} Elo while with {franchiseName}.<br />
              Try lowering the threshold.
            </div>
          ) : (
            <table style={s.table}>
              <thead style={s.thead}>
                <tr>
                  <th style={{ ...s.th, width: 28 }}>#</th>
                  <th style={s.th}>Player</th>
                  <th style={{ ...s.th, ...s.thR }}>Franchise Peak</th>
                  <th style={{ ...s.th, ...s.thR }}>GP</th>
                  <th style={s.th}>Above {effectiveThreshold} — Periods</th>
                </tr>
              </thead>
              <tbody>
                {results.map((p, i) => (
                  <tr
                    key={p.name}
                    style={s.row}
                    onClick={() => onSelectPlayer(p)}
                    onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ ...s.td, fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                    <td style={{ ...s.td, fontWeight: 500, whiteSpace: 'nowrap' }}>{p.name}</td>
                    <td style={{ ...s.td, textAlign: 'right', color: '#c9920a', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(p.peak).toLocaleString()}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', color: '#888', fontVariantNumeric: 'tabular-nums' }}>
                      {p.gp}
                    </td>
                    <td style={s.td}>
                      {p.ranges.map((r, ri) => (
                        <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: ri < p.ranges.length - 1 ? 5 : 0 }}>
                          <span style={{
                            display: 'inline-block', background: '#1a2e1a', color: '#fff',
                            borderRadius: 5, padding: '2px 8px', fontSize: 11,
                            fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap',
                          }}>
                            {r.start.slice(5,7)}/{r.start.slice(8,10)}/{r.start.slice(0,4)} – {r.end.slice(5,7)}/{r.end.slice(8,10)}/{r.end.slice(0,4)}
                          </span>
                          <span style={{ fontSize: 11, color: '#aaa' }}>
                            peak {Math.round(r.peak).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
