import { useState, useMemo, useRef } from 'react'

const TEAM_COLORS = {
  ATL:'#C8102E',BOS:'#007A33',BKN:'#000000',CHA:'#00788C',CHO:'#00788C',
  CHI:'#CE1141',CLE:'#860038',DAL:'#00538C',DEN:'#0E2240',DET:'#C8102E',
  GSW:'#1D428A',HOU:'#CE1141',IND:'#002D62',LAC:'#C8102E',LAL:'#552583',
  MEM:'#5D76A9',MIA:'#98002E',MIL:'#00471B',MIN:'#0C2340',NOP:'#0C2340',
  NOH:'#0C2340',NYK:'#006BB6',OKC:'#007AC1',ORL:'#0077C0',
  PHI:'#006BB6',PHO:'#1D1160',POR:'#E03A3E',SAC:'#5A2D81',SAS:'#000000',
  SEA:'#00653A',TOR:'#CE1141',UTA:'#002B5C',WAS:'#002B5C',MNL:'#552583',
}

function fmt(date) {
  if (!date) return '—'
  return `${date.slice(5,7)}/${date.slice(8,10)}/${date.slice(0,4)}`
}

function PlayerSummary({ rank, row, color, gamesHeld }) {
  const medal = ['🥇','🥈','🥉'][rank - 1]
  return (
    <div style={{
      flex: 1, background: '#fff', borderRadius: 12, padding: '18px 20px',
      border: `0.5px solid ${color}33`,
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 8 }}>
        {medal} #{rank} All-Time Through {row.n.toLocaleString()} Games
      </div>
      <div style={{ fontFamily: "'Georgia', serif", fontSize: 20, color: '#1a1a1a', marginBottom: 4 }}>
        {row.name}
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: '#aaa' }}>Elo at game {row.n.toLocaleString()}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{row.elo.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#aaa' }}>Team</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#555' }}>{row.team}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#aaa' }}>Date</div>
          <div style={{ fontSize: 14, color: '#555', fontFamily: "'Consolas', 'Monaco', monospace" }}>{fmt(row.date)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#aaa' }}>Games held #1</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#555' }}>{gamesHeld.toLocaleString()}</div>
        </div>
      </div>
    </div>
  )
}

export default function BestThroughX({ players, onSelectPlayer }) {
  const [jumpTo, setJumpTo] = useState('')
  const tableRef = useRef(null)

  const rows = useMemo(() => {
    const maxGP = Math.max(...players.map(p => (p.elo_history || []).length))
    const result = []
    for (let n = 1; n <= maxGP; n++) {
      let first = null, second = null, third = null
      for (const p of players) {
        const hist = p.elo_history || []
        if (hist.length < n) continue
        const elo = hist[n - 1][1]
        if (!first || elo > first.elo) {
          third = second; second = first
          first = { n, name: p.name, elo: Math.round(elo), team: hist[n-1][4] || p.team, date: hist[n-1][0] }
        } else if (!second || elo > second.elo) {
          third = second
          second = { n, name: p.name, elo: Math.round(elo), team: hist[n-1][4] || p.team, date: hist[n-1][0] }
        } else if (!third || elo > third.elo) {
          third = { n, name: p.name, elo: Math.round(elo), team: hist[n-1][4] || p.team, date: hist[n-1][0] }
        }
      }
      if (first) result.push({ first, second, third })
    }
    return result
  }, [players])

  const firstRows = useMemo(() => rows.map(r => r.first), [rows])

  const withMeta = useMemo(() => {
    return firstRows.map((row, i) => {
      const isChange = i === 0 || row.name !== firstRows[i-1].name
      let streak = 1
      let j = i - 1
      while (j >= 0 && firstRows[j].name === row.name) { streak++; j-- }
      return { ...row, isChange, streak }
    })
  }, [firstRows])

  // Top-3 snapshot — find peak game for each player in #1 position
  const topThree = useMemo(() => {
    const peaks = {}
    firstRows.forEach((row, i) => {
      if (!peaks[row.name] || row.elo > peaks[row.name].elo) {
        peaks[row.name] = { ...row, gamesHeld: 0 }
      }
    })
    firstRows.forEach(row => { if (peaks[row.name]) peaks[row.name].gamesHeld++ })
    return Object.values(peaks).sort((a,b) => b.elo - a.elo).slice(0, 3)
  }, [firstRows])

  const handleJump = () => {
    const n = parseInt(jumpTo)
    if (!n) return
    const el = tableRef.current?.querySelector(`[data-row="${n}"]`)
    el?.scrollIntoView({ behavior:'smooth', block:'center' })
  }

  const s = {
    wrap:  { display:'flex', flex:1, flexDirection:'column', overflow:'hidden', background:'#f4f4f4', fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif" },
    top:   { padding:'20px 28px 0', flexShrink:0 },
    title: { fontFamily:"'Georgia', serif", fontSize:26, color:'#1a1a1a', marginBottom:4 },
    desc:  { fontSize:13, color:'#888', marginBottom:20 },
    cards: { display:'flex', gap:16, marginBottom:20 },
    controls: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 28px 12px', flexShrink:0 },
    tableWrap: { flex:1, overflow:'auto' },
    thead: { position:'sticky', top:0, zIndex:10, background:'#f8f8f8', borderBottom:'0.5px solid #e0e0e0' },
    th:    { padding:'10px 20px', fontSize:10, fontWeight:600, color:'#aaa', textAlign:'left', letterSpacing:'0.8px', textTransform:'uppercase', whiteSpace:'nowrap' },
    thR:   { textAlign:'right' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.top}>
        <h1 style={s.title}>Best Through X</h1>
        <p style={s.desc}>The Elo leader at each career game milestone — who had the highest Elo through exactly N games. {rows.length.toLocaleString()} milestones tracked.</p>
        <div style={s.cards}>
          {topThree.map((row, i) => (
            <PlayerSummary
              key={row.name}
              rank={i+1}
              row={row}
              color={TEAM_COLORS[row.team] || '#173657'}
              gamesHeld={row.gamesHeld}
            />
          ))}
        </div>
      </div>

      <div style={s.controls}>
        <div style={{ fontSize:13, color:'#aaa' }}>{rows.length.toLocaleString()} career game milestones</div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:12, color:'#aaa' }}>Jump to game</span>
          <input
            style={{ width:72, border:'0.5px solid #e0e0e0', borderRadius:6, padding:'6px 10px', fontSize:13, fontFamily:"'Consolas', 'Monaco', monospace", color:'#333', outline:'none' }}
            type="number" value={jumpTo}
            onChange={e => setJumpTo(e.target.value)}
            onKeyDown={e => e.key==='Enter' && handleJump()}
            placeholder="500"
          />
          <button
            onClick={handleJump}
            style={{ background:'#173657', color:'#fff', border:'none', borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer', fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif" }}
          >Go</button>
        </div>
      </div>

      <div style={s.tableWrap} ref={tableRef}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead style={s.thead}>
            <tr>
              <th style={{ ...s.th, ...s.thR, width:80 }}>Game</th>
              <th style={s.th}>#1 Leader</th>
              <th style={{ ...s.th, ...s.thR }}>#1 Elo</th>
              <th style={s.th}>#1 Team</th>
              <th style={{ ...s.th, ...s.thR }}>#1 Date</th>
              <th style={{ ...s.th, ...s.thR }}>Games at #1</th>
              <th style={s.th}>#2</th>
              <th style={{ ...s.th, ...s.thR }}>#2 Elo</th>
              <th style={s.th}>#3</th>
              <th style={{ ...s.th, ...s.thR }}>#3 Elo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ first, second, third }, i) => {
              const color = TEAM_COLORS[first.team] || '#173657'
              const row = withMeta[i]
              return (
                <tr
                  key={first.n}
                  data-row={first.n}
                  style={{
                    borderBottom:'0.5px solid #f0f0f0',
                    background: row.isChange ? '#fff' : 'transparent',
                    borderLeft: row.isChange ? `3px solid ${color}` : '3px solid transparent',
                    cursor:'pointer',
                  }}
                  onClick={() => { const p = players.find(x=>x.name===first.name); if(p) onSelectPlayer(p) }}
                  onMouseEnter={e => e.currentTarget.style.background='#f8f8f8'}
                  onMouseLeave={e => e.currentTarget.style.background=row.isChange?'#fff':'transparent'}
                >
                  <td style={{ padding:'8px 20px', textAlign:'right', color:'#bbb', fontVariantNumeric:'tabular-nums' }}>{first.n.toLocaleString()}</td>
                  <td style={{ padding:'8px 20px', fontWeight:row.isChange?600:400 }}>{first.name}</td>
                  <td style={{ padding:'8px 20px', textAlign:'right', fontWeight:600, color, fontVariantNumeric:'tabular-nums' }}>{first.elo.toLocaleString()}</td>
                  <td style={{ padding:'8px 20px', fontSize:11, color:'#aaa' }}>{first.team}</td>
                  <td style={{ padding:'8px 20px', textAlign:'right', fontSize:12, color:'#aaa', fontFamily:"'Consolas', 'Monaco', monospace" }}>{fmt(first.date)}</td>
                  <td style={{ padding:'8px 20px', textAlign:'right', fontSize:12, color:'#bbb', fontVariantNumeric:'tabular-nums' }}>{row.streak}</td>
                  <td style={{ padding:'8px 20px', fontSize:12, color:'#999' }}>{second?.name || '—'}</td>
                  <td style={{ padding:'8px 20px', textAlign:'right', fontSize:12, color:'#bbb', fontVariantNumeric:'tabular-nums' }}>{second ? second.elo.toLocaleString() : '—'}</td>
                  <td style={{ padding:'8px 20px', fontSize:12, color:'#999' }}>{third?.name || '—'}</td>
                  <td style={{ padding:'8px 20px', textAlign:'right', fontSize:12, color:'#bbb', fontVariantNumeric:'tabular-nums' }}>{third ? third.elo.toLocaleString() : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
