import { useState, useEffect, useMemo } from 'react'


// Historical team abbrev -> current franchise key
const TEAM_TO_FRANCHISE = {
  ATL:'ATL',STL:'ATL',TRI:'ATL',BOM:'ATL',
  BOS:'BOS',
  BKN:'BKN',BRK:'BKN',NJN:'BKN',NJA:'BKN',
  CHA:'CHA',CHO:'CHA',CHH:'CHA',
  CHI:'CHI',
  CLE:'CLE',
  DAL:'DAL',
  DEN:'DEN',DNR:'DEN',
  DET:'DET',FTW:'DET',
  GSW:'GSW',SFW:'GSW',PHW:'GSW',
  HOU:'HOU',SDR:'HOU',
  IND:'IND',
  LAC:'LAC',SDC:'LAC',BUF:'LAC',
  LAL:'LAL',MNL:'LAL',
  MEM:'MEM',VAN:'MEM',
  MIA:'MIA',
  MIL:'MIL',
  MIN:'MIN',
  NOP:'NOP',NOH:'NOP',NOK:'NOP',NOM:'NOP',
  NYK:'NYK',
  OKC:'OKC',SEA:'OKC',
  ORL:'ORL',
  PHI:'PHI',SYR:'PHI',
  PHO:'PHO',
  POR:'POR',
  SAC:'SAC',KCK:'SAC',CIN:'SAC',ROC:'SAC',
  SAS:'SAS',SAA:'SAS',
  TOR:'TOR',
  UTA:'UTA',NOJ:'UTA',
  WAS:'WAS',WSB:'WAS',BAL:'WAS',CAP:'WAS',
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
  NOH:'#0C2340',NOK:'#0C2340',NYK:'#006BB6',OKC:'#007AC1',ORL:'#0077C0',
  PHI:'#006BB6',PHO:'#1D1160',POR:'#E03A3E',SAC:'#5A2D81',SAS:'#000000',
  SEA:'#00653A',TOR:'#CE1141',UTA:'#002B5C',WAS:'#002B5C',MNL:'#552583',
  FTW:'#C8102E',SYR:'#006BB6',ROC:'#5A2D81',NOJ:'#002B5C',
}

// Score -> heat color: dark blue (low) -> white (mid) -> dark red (high)
function scoreColor(score) {
  // 0-40: cool blue range, 40-60: warm neutral, 60-100: hot red
  if (score >= 80) return `hsl(${Math.round(10 - (score-80)*0.1)}, 85%, ${Math.round(28 + (score-80)*0.3)}%)`
  if (score >= 60) return `hsl(${Math.round(35 - (score-60)*1.25)}, 75%, 35%)`
  if (score >= 40) return `hsl(${Math.round(200 + (score-40)*0.5)}, 40%, 45%)`
  return `hsl(${Math.round(210 + (40-score)*0.5)}, 55%, ${Math.round(35 + score*0.3)}%)`
}

function scoreTextColor(score) {
  return score > 35 && score < 65 ? '#fff' : '#fff'
}

function GameBox({ game, onClick, size = 'normal' }) {
  const color  = scoreColor(game.score)
  const teamAC = TEAM_COLORS[game.teamA] || '#555'
  const teamBC = TEAM_COLORS[game.teamB] || '#555'
  const isSmall = size === 'small'

  return (
    <div
      onClick={() => onClick(game)}
      style={{
        background: color,
        borderRadius: isSmall ? 6 : 8,
        padding: isSmall ? '6px 8px' : '10px 12px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: isSmall ? 3 : 5,
        transition: 'transform 0.1s, box-shadow 0.1s',
        userSelect: 'none',
        minWidth: isSmall ? 80 : 110,
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: isSmall ? 9 : 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.5 }}>{game.teamA}</span>
        <span style={{ fontSize: isSmall ? 9 : 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.5 }}>{game.teamB}</span>
      </div>
      <div style={{ textAlign: 'center', fontSize: isSmall ? 18 : 24, fontWeight: 800, color: '#fff', lineHeight: 1, fontFamily: "'Georgia', serif" }}>
        {game.score.toFixed(1)}
      </div>
      <div style={{ fontSize: isSmall ? 8 : 10, color: 'rgba(255,255,255,0.55)', textAlign: 'center', fontFamily: "'Consolas', 'Monaco', monospace" }}>
        {game.date.slice(5,7)}/{game.date.slice(8,10)}/{game.date.slice(0,4)}
      </div>
    </div>
  )
}

function GameDetail({ game, onClose }) {
  if (!game) return null

  const maxElo = Math.max(
    ...(game.playersA || []).map(p => p.e),
    ...(game.playersB || []).map(p => p.e)
  )
  const minElo = Math.min(
    ...(game.playersA || []).map(p => p.e),
    ...(game.playersB || []).map(p => p.e)
  )

  function PlayerRow({ p, side }) {
    const t = (p.e - minElo) / (maxElo - minElo || 1)
    const barColor = `hsl(${Math.round(220 - t * 220)}, 70%, 45%)`
    const barW = Math.round(t * 100)
    const align = side === 'A' ? 'flex-start' : 'flex-end'
    const teamColor = TEAM_COLORS[game[side === 'A' ? 'teamA' : 'teamB']] || '#555'

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexDirection: side === 'B' ? 'row-reverse' : 'row' }}>
        <div style={{ fontSize: 12, fontWeight: 500, minWidth: 130, color: '#1a1a1a', textAlign: side === 'B' ? 'right' : 'left' }}>
          {p.n}
          {p.m != null && <span style={{ fontSize: 10, color: '#aaa', fontWeight: 400, marginLeft: 4 }}>{p.m}m</span>}
        </div>
        <div style={{ flex: 1, height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${barW}%`, background: barColor, borderRadius: 3,
            marginLeft: side === 'B' ? 'auto' : 0,
          }} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: barColor, minWidth: 38, fontVariantNumeric: 'tabular-nums', textAlign: side === 'B' ? 'left' : 'right' }}>
          {p.e.toLocaleString()}
        </div>
      </div>
    )
  }

  const colorA = TEAM_COLORS[game.teamA] || '#555'
  const colorB = TEAM_COLORS[game.teamB] || '#555'

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 24,
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: 32, maxWidth: 720, width: '100%',
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontFamily: "'Consolas', 'Monaco', monospace", fontSize: 12, color: '#aaa', marginBottom: 4 }}>
              {game.date.slice(5,7)}/{game.date.slice(8,10)}/{game.date.slice(0,4)}
            </div>
            <div style={{ fontFamily: "'Georgia', serif", fontSize: 26, color: '#1a1a1a' }}>
              <span style={{ color: colorA }}>{game.teamA}</span>
              <span style={{ color: '#bbb', margin: '0 10px' }}>vs</span>
              <span style={{ color: colorB }}>{game.teamB}</span>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 4 }}>Game Strength</div>
            <div style={{
              background: scoreColor(game.score), borderRadius: 10,
              padding: '8px 16px', fontSize: 28, fontWeight: 800, color: '#fff',
              fontFamily: "'Georgia', serif",
            }}>{game.score.toFixed(1)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#aaa', padding: '0 4px' }}>×</button>
        </div>

        {/* Team score bars */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <div style={{ flex: 1, background: colorA + '15', borderRadius: 10, padding: '12px 16px', borderTop: `3px solid ${colorA}` }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: colorA, marginBottom: 4 }}>{game.teamA}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: colorA }}>{game.scoreA.toFixed(1)}</div>
            <div style={{ fontSize: 11, color: '#aaa' }}>{game.playersA?.length} players</div>
          </div>
          <div style={{ flex: 1, background: colorB + '15', borderRadius: 10, padding: '12px 16px', borderTop: `3px solid ${colorB}` }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: colorB, marginBottom: 4 }}>{game.teamB}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: colorB }}>{game.scoreB.toFixed(1)}</div>
            <div style={{ fontSize: 11, color: '#aaa' }}>{game.playersB?.length} players</div>
          </div>
        </div>

        {/* Player heatmaps side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 12 }}>{game.teamA} Roster</div>
            {(game.playersA || []).map(p => <PlayerRow key={p.n} p={p} side="A" />)}
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 12 }}>{game.teamB} Roster</div>
            {(game.playersB || []).map(p => <PlayerRow key={p.n} p={p} side="B" />)}
          </div>

        </div>
      </div>
    </div>
  )
}

export default function GameExplorer() {
  const [games,     setGames]     = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState(null)
  const [date,      setDate]      = useState('')
  const [page,      setPage]      = useState(0)
  const [franchise, setFranchise] = useState('')

  const PER_PAGE = 100  // 10 rows × 10 cols

  useEffect(() => {
    fetch('/data/games.json').then(r => r.json()).then(d => {
      setGames(d.games)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!games) return []
    let result = games
    if (franchise) {
      result = result.filter(g =>
        TEAM_TO_FRANCHISE[g.teamA] === franchise || TEAM_TO_FRANCHISE[g.teamB] === franchise
      )
    }
    if (date) return result.filter(g => g.date === date).sort((a,b) => b.score - a.score)
    return result
  }, [games, date, franchise])

  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const slice = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE)

  // Group by date for date view
  const dateGames = useMemo(() => {
    if (!date || !games) return null
    return games.filter(g => g.date === date).sort((a,b) => b.score - a.score)
  }, [date, games])

  const s = {
    wrap:   { display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', background: '#f4f4f4', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" },
    header: { padding: '20px 28px 16px', borderBottom: '0.5px solid #e0e0e0', background: '#fff', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' },
    title:  { fontFamily: "'Georgia', serif", fontSize: 26, color: '#1a1a1a', marginBottom: 4 },
    desc:   { fontSize: 13, color: '#888' },
    body:   { flex: 1, overflow: 'auto', padding: '20px 24px' },
    grid:   { display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 8 },
    paging: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 28px', borderTop: '0.5px solid #e0e0e0', background: '#f8f8f8', flexShrink: 0 },
    pgBtn:  { background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: '#666' },
  }

  if (loading) return <div style={{ ...s.wrap, alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#aaa' }}>Loading game data…</div></div>
  if (!games)  return <div style={{ ...s.wrap, alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#aaa' }}>games.json not found — run the pipeline first.</div></div>

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Game Explorer</h1>
          <p style={s.desc}>
            {date
              ? `${filtered.filter(g=>g.date===date).length} games on ${date.slice(5,7)}/${date.slice(8,10)}/${date.slice(0,4)}${franchise ? ` · ${FRANCHISE_NAMES[franchise]}` : ''}`
              : `${filtered.length.toLocaleString()} games sorted by Elo Strength Rating${franchise ? ` · ${FRANCHISE_NAMES[franchise]}` : ''}`}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {date && (
            <button onClick={() => { setDate(''); setPage(0) }}
              style={{ background: 'none', border: '0.5px solid #e0e0e0', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#888' }}>
              ← All Games
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#aaa' }}>Franchise</span>
            <select
              value={franchise}
              onChange={e => { setFranchise(e.target.value); setPage(0) }}
              style={{ border: '0.5px solid #e0e0e0', borderRadius: 6, padding: '6px 10px', fontSize: 13, outline: 'none', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", background: '#fff' }}
            >
              <option value="">All Franchises</option>
              {Object.entries(FRANCHISE_NAMES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#aaa' }}>Browse by date</span>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setPage(0) }}
              style={{ border: '0.5px solid #e0e0e0', borderRadius: 6, padding: '6px 10px', fontSize: 13, outline: 'none', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }}
            />
          </div>
        </div>
      </div>

      <div style={s.body}>
        {date && dateGames ? (
          // Date view — show matching games prominently
          <div>
            <div style={{ marginBottom: 16, fontSize: 13, color: '#888' }}>
              Click a game to see the full Elo heatmap
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {dateGames.map((g, i) => (
                <GameBox key={i} game={g} onClick={setSelected} size="normal" />
              ))}
            </div>
          </div>
        ) : (
          // Default: strength-sorted grid
          <>
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 12, color: '#aaa' }}>
                Color = Elo Strength Rating · 0 (cool blue) → 100 (hot red) · Click any game for detail
              </div>
              {/* Mini legend */}
              <div style={{ display: 'flex', gap: 3 }}>
                {[20,40,60,80,100].map(s => (
                  <div key={s} style={{ width: 24, height: 16, borderRadius: 4, background: scoreColor(s), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 8, color: '#fff', fontWeight: 700 }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={s.grid}>
              {slice.map((g, i) => (
                <GameBox key={i} game={g} onClick={setSelected} size="small" />
              ))}
            </div>
          </>
        )}
      </div>

      {!date && (
        <div style={s.paging}>
          <button style={s.pgBtn} onClick={() => setPage(0)} disabled={page === 0}>««</button>
          <button style={s.pgBtn} onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹</button>
          <span style={{ fontSize: 12, color: '#aaa', padding: '0 8px' }}>Page {page + 1} of {totalPages} · {filtered.length.toLocaleString()} games</span>
          <button style={s.pgBtn} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>›</button>
          <button style={s.pgBtn} onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»»</button>
        </div>
      )}

      {selected && <GameDetail game={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
