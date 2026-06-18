import { useState, useMemo, useRef, useEffect, useCallback } from 'react'

const FRANCHISE_ALIASES = {
  ATL:['ATL','STL','TRI','BOM'],
  BOS:['BOS'],
  BKN:['BKN','BRK','NJN','NJA'],
  CHA:['CHA','CHO'],
  CHI:['CHI'],
  CLE:['CLE'],
  DAL:['DAL'],
  DEN:['DEN','DNR'],
  DET:['DET','FTW'],
  GSW:['GSW','SFW','PHW'],
  HOU:['HOU','SDR'],
  IND:['IND'],
  LAC:['LAC','SDC','BUF'],
  LAL:['LAL','MNL'],
  MEM:['MEM','VAN'],
  MIA:['MIA'],
  MIL:['MIL'],
  MIN:['MIN'],
  NOP:['NOP','NOH','NOK','NOM'],
  NYK:['NYK'],
  OKC:['OKC','SEA'],
  ORL:['ORL'],
  PHI:['PHI','SYR'],
  PHO:['PHO'],
  POR:['POR'],
  SAC:['SAC','KCK','CIN','ROC'],
  SAS:['SAS','SAA'],
  TOR:['TOR'],
  UTA:['UTA','NOJ'],
  WAS:['WAS','WSB','BAL','CAP'],
}

const FRANCHISE_NAMES = {
  ATL:'Atlanta Hawks',BOS:'Boston Celtics',BKN:'Brooklyn Nets',CHA:'Charlotte Hornets',
  CHI:'Chicago Bulls',CLE:'Cleveland Cavaliers',DAL:'Dallas Mavericks',DEN:'Denver Nuggets',
  DET:'Detroit Pistons',GSW:'Golden State Warriors',HOU:'Houston Rockets',IND:'Indiana Pacers',
  LAC:'LA Clippers',LAL:'LA Lakers',MEM:'Memphis Grizzlies',MIA:'Miami Heat',
  MIL:'Milwaukee Bucks',MIN:'Minnesota Timberwolves',NOP:'New Orleans Pelicans',NYK:'New York Knicks',
  OKC:'Oklahoma City Thunder',ORL:'Orlando Magic',PHI:'Philadelphia 76ers',PHO:'Phoenix Suns',
  POR:'Portland Trail Blazers',SAC:'Sacramento Kings',SAS:'San Antonio Spurs',TOR:'Toronto Raptors',
  UTA:'Utah Jazz',WAS:'Washington Wizards',
}

const TEAM_COLORS = {
  ATL:'#C8102E',BOS:'#007A33',BKN:'#000000',CHA:'#00788C',CHO:'#00788C',
  CHI:'#CE1141',CLE:'#860038',DAL:'#00538C',DEN:'#0E2240',DET:'#C8102E',
  GSW:'#1D428A',HOU:'#CE1141',IND:'#002D62',LAC:'#C8102E',LAL:'#552583',
  MEM:'#5D76A9',MIA:'#98002E',MIL:'#00471B',MIN:'#0C2340',NOP:'#0C2340',
  NYK:'#006BB6',OKC:'#007AC1',ORL:'#0077C0',PHI:'#006BB6',PHO:'#1D1160',
  POR:'#E03A3E',SAC:'#5A2D81',SAS:'#000000',TOR:'#CE1141',UTA:'#002B5C',WAS:'#002B5C',
}


const ABA_TEAMS = new Set([
  'ANA','AND','CAP','CAR','DAL','DEN','DNR','FLO','HOU','IND',
  'KEN','LAS','MEM','MIA','MIN','NOB','NJA','NNY','NVA','NYN',
  'OAK','PIT','SAA','SDC','TEX','UTA','VIR',
])

const MIN_GP = 50

function computeTenure(player, franchise, league = "NBA") {
  const aliases = FRANCHISE_ALIASES[franchise] || [franchise]
  const hist = player.elo_history || []
  const entries = hist.filter(e => {
    const t = e[4] || ''
    if (!aliases.includes(t)) return false
    if (league === 'NBA') return !ABA_TEAMS.has(t)
    if (league === 'ABA') return ABA_TEAMS.has(t)
    return true  // ALL
  })
  if (entries.length < MIN_GP) return null
  const gp = entries.length
  const avgElo = entries.reduce((s, e) => s + e[1], 0) / gp
  const peakElo = Math.max(...entries.map(e => e[1]))
  // Legend score: geometric mean weighted 60% avg Elo, 40% games
  const legendScore = Math.pow(avgElo, 0.40) * Math.pow(peakElo, 0.40) * Math.pow(gp, 0.20)
  return { gp, avgElo: Math.round(avgElo), peakElo: Math.round(peakElo), legendScore }
}

function ScatterPlot({ points, franchise, onHover, hoveredName, onSelectPlayer }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const [dims, setDims] = useState({ w: 600, h: 400 })

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(() => {
      const w = wrapRef.current.clientWidth
      setDims({ w, h: Math.round(w * 0.58) })
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  if (!points.length) return null

  const PAD = { top: 20, right: 24, bottom: 48, left: 56 }
  const W = dims.w, H = dims.h
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const maxGP  = Math.max(...points.map(p => p.gp)) * 1.05
  const minElo = Math.min(...points.map(p => p.avgElo)) - 80
  const maxElo = Math.max(...points.map(p => p.avgElo)) + 80
  const midGP  = maxGP / 2
  const midElo = (minElo + maxElo) / 2

  const xScale = gp  => PAD.left + (gp / maxGP) * plotW
  const yScale = elo => PAD.top + plotH - ((elo - minElo) / (maxElo - minElo)) * plotH

  const teamColor = TEAM_COLORS[franchise] || '#173657'

  const ns = 'http://www.w3.org/2000/svg'

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        {/* Quadrant lines */}
        <line x1={xScale(midGP)} y1={PAD.top} x2={xScale(midGP)} y2={PAD.top + plotH}
          stroke="rgba(0,0,0,0.08)" strokeWidth="1" strokeDasharray="4,3" />
        <line x1={PAD.left} y1={yScale(midElo)} x2={PAD.left + plotW} y2={yScale(midElo)}
          stroke="rgba(0,0,0,0.08)" strokeWidth="1" strokeDasharray="4,3" />

        {/* Quadrant labels */}
        <text x={xScale(midGP * 1.5)} y={yScale(maxElo * 0.98)} fontSize="10" fill="rgba(0,0,0,0.2)" textAnchor="middle" fontFamily="DM Sans,sans-serif">FRANCHISE LEGENDS</text>
        <text x={xScale(midGP * 0.5)} y={yScale(maxElo * 0.98)} fontSize="10" fill="rgba(0,0,0,0.15)" textAnchor="middle" fontFamily="DM Sans,sans-serif">PEAK CONTRIBUTORS</text>
        <text x={xScale(midGP * 1.5)} y={yScale(minElo * 1.02)} fontSize="10" fill="rgba(0,0,0,0.15)" textAnchor="middle" fontFamily="DM Sans,sans-serif">RELIABLE VETERANS</text>
        <text x={xScale(midGP * 0.5)} y={yScale(minElo * 1.02)} fontSize="10" fill="rgba(0,0,0,0.12)" textAnchor="middle" fontFamily="DM Sans,sans-serif">SHORT TENURE</text>

        {/* Y axis grid + labels */}
        {[...Array(5)].map((_, i) => {
          const elo = Math.round(minElo + (i / 4) * (maxElo - minElo))
          const y = yScale(elo)
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={PAD.left + plotW} y2={y} stroke="rgba(0,0,0,0.05)" strokeWidth="0.5" />
              <text x={PAD.left - 6} y={y + 4} fontSize="10" fill="rgba(0,0,0,0.3)" textAnchor="end" fontFamily="DM Mono,monospace">{elo.toLocaleString()}</text>
            </g>
          )
        })}

        {/* X axis labels */}
        {[...Array(5)].map((_, i) => {
          const gp = Math.round((i / 4) * maxGP)
          const x = xScale(gp)
          return (
            <text key={i} x={x} y={H - 8} fontSize="10" fill="rgba(0,0,0,0.3)" textAnchor="middle" fontFamily="DM Sans,sans-serif">{gp}</text>
          )
        })}

        {/* Axis labels */}
        <text x={PAD.left + plotW / 2} y={H - 2} fontSize="11" fill="rgba(0,0,0,0.4)" textAnchor="middle" fontFamily="DM Sans,sans-serif">Games Played</text>
        <text x={12} y={PAD.top + plotH / 2} fontSize="11" fill="rgba(0,0,0,0.4)" textAnchor="middle" fontFamily="DM Sans,sans-serif" transform={`rotate(-90, 12, ${PAD.top + plotH / 2})`}>Avg Elo</text>

        {/* Dots */}
        {points.map(p => {
          const cx = xScale(p.gp)
          const cy = yScale(p.avgElo)
          const isHovered = p.name === hoveredName
          return (
            <g key={p.name}>
              <circle
                cx={cx} cy={cy}
                r={isHovered ? 8 : 6}
                fill={(() => {
                  const minP = Math.min(...points.map(x => x.peakElo))
                  const maxP = Math.max(...points.map(x => x.peakElo))
                  const t = (p.peakElo - minP) / (maxP - minP || 1)
                  const opacity = isHovered ? 1 : 0.25 + t * 0.75
                  return teamColor + Math.round(opacity * 255).toString(16).padStart(2,'0')
                })()}
                stroke={isHovered ? '#fff' : 'none'}
                strokeWidth={isHovered ? 2 : 0}
                style={{ cursor: 'pointer', transition: 'fill 0.15s' }}
                onMouseEnter={() => onHover(p)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelectPlayer(p)}
              />
              {(isHovered || p.rank <= 3) && (
                <text
                  x={cx + (cx > W * 0.8 ? -9 : 9)}
                  y={cy + 4}
                  fontSize="11" fontWeight="600"
                  fill={isHovered ? '#1a1a1a' : 'rgba(0,0,0,0.45)'}
                  textAnchor={cx > W * 0.8 ? 'end' : 'start'}
                  fontFamily="DM Sans,sans-serif"
                  style={{ pointerEvents: 'none' }}
                >
                  {p.name.split(' ').pop()}
                </text>
              )}
            </g>
          )
        })}

        {/* Border */}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="0.5" />
      </svg>
    </div>
  )
}

export default function FranchiseTenures({ players, onSelectPlayer }) {
  const [franchise, setFranchise] = useState('LAL')
  const [hovered,   setHovered]   = useState(null)
  const [league,    setLeague]    = useState('NBA')  // 'NBA' | 'ABA' | 'ALL'

  const points = useMemo(() => {
    if (league === 'ABA' || league === 'ALL') {
      // Show all players across all franchises for this league
      // Compute per-player stats across their whole career in that league
      return players
        .map(p => {
          const hist = p.elo_history || []
          const entries = hist.filter(e => {
            const t = e[4] || ''
            if (league === 'ABA') return ABA_TEAMS.has(t)
            return true // ALL
          })
          if (entries.length < MIN_GP) return null
          const gp = entries.length
          const avgElo = Math.round(entries.reduce((s,e) => s+e[1], 0) / gp)
          const peakElo = Math.round(Math.max(...entries.map(e=>e[1])))
          const legendScore = Math.pow(avgElo, 0.40) * Math.pow(peakElo, 0.40) * Math.pow(gp, 0.20)
          return { name: p.name, gp, avgElo, peakElo, legendScore, player: p }
        })
        .filter(Boolean)
        .sort((a, b) => b.legendScore - a.legendScore)
        .map((p, i) => ({ ...p, rank: i + 1 }))
    }
    // NBA mode: use franchise filter
    return players
      .map(p => {
        const tenure = computeTenure(p, franchise, league)
        if (!tenure) return null
        return { name: p.name, ...tenure, player: p }
      })
      .filter(Boolean)
      .sort((a, b) => b.legendScore - a.legendScore)
      .map((p, i) => ({ ...p, rank: i + 1 }))
  }, [players, franchise, league])

  const franchiseName = FRANCHISE_NAMES[franchise]
  const teamColor = TEAM_COLORS[franchise] || '#173657'

  const s = {
    wrap:      { display: 'flex', flex: 1, overflow: 'hidden', background: '#f4f4f4', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" },
    sidebar:   { width: 220, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e0e0e0', display: 'flex', flexDirection: 'column', overflow: 'auto' },
    main:      { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    sideHead:  { padding: '20px 16px 14px', borderBottom: '0.5px solid #e0e0e0' },
    sideTitle: { fontFamily: "'Georgia', serif", fontSize: 16, color: '#1a1a1a', marginBottom: 3 },
    sideDesc:  { fontSize: 12, color: '#888', lineHeight: 1.6 },
    section:   { padding: '12px 16px', borderBottom: '0.5px solid #f0f0f0' },
    sectionLbl:{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 8 },
    teamGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 },
    teamBtn:   (active) => ({
      background: active ? teamColor : 'transparent',
      border: `0.5px solid ${active ? teamColor : '#e0e0e0'}`,
      borderRadius: 6, padding: '5px 4px',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", fontSize: 11, fontWeight: active ? 600 : 400,
      color: active ? '#fff' : '#555', cursor: 'pointer', textAlign: 'center',
    }),
    pageHeader:{ padding: '20px 28px 14px', borderBottom: '0.5px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 },
    pageTitle: { fontFamily: "'Georgia', serif", fontSize: 24, color: '#1a1a1a', marginBottom: 2 },
    pageDesc:  { fontSize: 13, color: '#888' },
    body:      { flex: 1, display: 'flex', overflow: 'hidden' },
    plotArea:  { flex: 1, padding: '20px 24px', overflow: 'auto' },
    rankPanel: { width: 280, flexShrink: 0, borderLeft: '0.5px solid #e0e0e0', overflow: 'auto', background: '#fff' },
    rankHead:  { padding: '12px 16px', borderBottom: '0.5px solid #e0e0e0', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb' },
    rankRow:   (active) => ({
      padding: '9px 16px', borderBottom: '0.5px solid #f0f0f0', cursor: 'pointer',
      background: active ? '#f4f4f4' : 'transparent',
      display: 'flex', alignItems: 'center', gap: 10,
    }),
    rankNum:   { fontSize: 11, color: '#bbb', minWidth: 20, fontVariantNumeric: 'tabular-nums' },
    rankName:  { flex: 1, fontSize: 13, fontWeight: 500 },
    rankScore: { fontSize: 11, color: '#888', fontVariantNumeric: 'tabular-nums' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.sidebar}>
        <div style={s.sideHead}>
          <div style={s.sideTitle}>Franchise Tenures</div>
          <div style={s.sideDesc}>Avg Elo vs games played for each franchise. Top-right = Legends.</div>
        </div>
        <div style={s.section}>
          <div style={s.sectionLbl}>League</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['NBA', 'ABA', 'ALL'].map(l => (
              <button key={l}
                onClick={() => { setLeague(l); setHovered(null) }}
                style={{
                  flex: 1, background: league === l ? '#173657' : 'transparent',
                  border: `0.5px solid ${league === l ? '#173657' : '#e0e0e0'}`,
                  borderRadius: 6, padding: '5px 0', fontSize: 11,
                  fontWeight: league === l ? 700 : 400,
                  color: league === l ? '#fff' : '#888',
                  cursor: 'pointer', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                }}
              >{l === 'ALL' ? 'NBA+ABA' : l}</button>
            ))}
          </div>
        </div>
        {league === 'NBA' && <div style={s.section}>
          <div style={s.sectionLbl}>Franchise</div>
          <div style={s.teamGrid}>
            {Object.keys(FRANCHISE_NAMES).map(abbr => (
              <button key={abbr} style={s.teamBtn(franchise === abbr)}
                onClick={() => { setFranchise(abbr); setHovered(null) }}
                title={FRANCHISE_NAMES[abbr]}
              >{abbr}</button>
            ))}
          </div>
        </div>}
        <div style={{ padding: '12px 16px', fontSize: 11, color: '#aaa', lineHeight: 1.7 }}>
          Min {MIN_GP} GP to qualify. Click any dot to open player modal.
        </div>
      </div>

      <div style={s.main}>
        <div style={s.pageHeader}>
          <div>
            <h1 style={s.pageTitle}>{league === 'ABA' ? 'ABA All-Time' : league === 'ALL' ? 'NBA + ABA All-Time' : franchiseName}</h1>
            <p style={s.pageDesc}>{points.length} players · min {MIN_GP} GP · sorted by Legend Score</p>
          </div>
          {hovered && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{hovered.name}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {hovered.gp} GP · Avg {hovered.avgElo.toLocaleString()} Elo · Peak {hovered.peakElo.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: teamColor, fontWeight: 600 }}>
                Legend Score: {Math.round(hovered.legendScore).toLocaleString()} · #{hovered.rank}
              </div>
            </div>
          )}
        </div>

        <div style={s.body}>
          <div style={s.plotArea}>
            <ScatterPlot
              points={points}
              franchise={franchise}
              onHover={setHovered}
              hoveredName={hovered?.name}
              onSelectPlayer={p => onSelectPlayer(p.player)}
            />
          </div>

          <div style={s.rankPanel}>
            <div style={s.rankHead}>Franchise Elo Legends</div>
            <div style={{ padding: '8px 16px', borderBottom: '0.5px solid #f0f0f0', fontSize: 11, color: '#aaa' }}>
              Color intensity = franchise peak Elo
            </div>
            {points.slice(0, 30).map(p => (
              <div
                key={p.name}
                style={s.rankRow(hovered?.name === p.name)}
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectPlayer(p.player)}
              >
                <span style={s.rankNum}>{p.rank}</span>
                <span style={s.rankName}>{p.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: teamColor, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(p.legendScore).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
