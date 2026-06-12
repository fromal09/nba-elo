import { useState, useMemo, useRef, useCallback } from 'react'

const TEAM_COLORS = {
  ATL:'#C8102E',BOS:'#007A33',BKN:'#000000',CHA:'#00788C',CHO:'#00788C',
  CHI:'#CE1141',CLE:'#860038',DAL:'#00538C',DEN:'#0E2240',DET:'#C8102E',
  GSW:'#1D428A',HOU:'#CE1141',IND:'#002D62',LAC:'#C8102E',LAL:'#552583',
  MEM:'#5D76A9',MIA:'#98002E',MIL:'#00471B',MIN:'#0C2340',NOP:'#0C2340',
  NOH:'#0C2340',NYK:'#006BB6',OKC:'#007AC1',ORL:'#0077C0',
  PHI:'#006BB6',PHO:'#1D1160',POR:'#E03A3E',SAC:'#5A2D81',SAS:'#000000',
  SEA:'#00653A',TOR:'#CE1141',UTA:'#002B5C',WAS:'#002B5C',MNL:'#552583',
}

export default function BestThroughX({ players, onSelectPlayer }) {
  const [jumpTo, setJumpTo] = useState('')
  const tableRef = useRef(null)

  const rows = useMemo(() => {
    const maxGP = Math.max(...players.map(p => (p.elo_history || []).length))
    const result = []
    for (let n = 1; n <= maxGP; n++) {
      let best = null
      for (const p of players) {
        const hist = p.elo_history || []
        if (hist.length < n) continue
        const entry = hist[n - 1]
        const elo = entry[1]
        if (!best || elo > best.elo) {
          best = { n, name: p.name, elo: Math.round(elo), team: entry[4] || p.team, date: entry[0] }
        }
      }
      if (best) result.push(best)
    }
    return result
  }, [players])

  const withMeta = useMemo(() => {
    return rows.map((row, i) => {
      const prevLeader = i > 0 ? rows[i - 1].name : null
      const isChange = row.name !== prevLeader
      // Count consecutive games this leader has held the top
      let streak = 1
      if (!isChange) {
        let j = i - 1
        while (j >= 0 && rows[j].name === row.name) { streak++; j-- }
      }
      // Find how long this leader's reign started
      let reignStart = i
      while (reignStart > 0 && rows[reignStart - 1].name === row.name) reignStart--
      return { ...row, isChange, streak: i - reignStart + 1 }
    })
  }, [rows])

  const handleJump = () => {
    const n = parseInt(jumpTo)
    if (!n || n < 1 || n > rows.length) return
    const el = tableRef.current?.querySelector(`[data-row="${n}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const s = {
    wrap:    { display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    header:  { padding: '20px 32px 16px', borderBottom: '0.5px solid #e0ddd6', background: '#fff', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' },
    title:   { fontFamily: "'DM Serif Display', serif", fontSize: 26, color: '#1a1a1a', marginBottom: 4 },
    desc:    { fontSize: 13, color: '#888' },
    jumpRow: { display: 'flex', alignItems: 'center', gap: 8 },
    jumpLbl: { fontSize: 12, color: '#aaa' },
    jumpIn:  { width: 72, border: '0.5px solid #e0ddd6', borderRadius: 6, padding: '6px 10px', fontSize: 13, fontFamily: "'DM Mono', monospace", color: '#333', outline: 'none' },
    jumpBtn: { background: '#1a2e1a', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    table:   { flex: 1, overflow: 'auto' },
    thead:   { position: 'sticky', top: 0, zIndex: 10, background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    th:      { padding: '10px 20px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'left', letterSpacing: '0.8px', textTransform: 'uppercase', whiteSpace: 'nowrap' },
    thR:     { textAlign: 'right' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Best Through X</h1>
          <p style={s.desc}>The Elo leader at each career game milestone. {rows.length.toLocaleString()} games tracked.</p>
        </div>
        <div style={s.jumpRow}>
          <span style={s.jumpLbl}>Jump to game</span>
          <input
            style={s.jumpIn}
            type="number"
            value={jumpTo}
            onChange={e => setJumpTo(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJump()}
            placeholder="500"
          />
          <button style={s.jumpBtn} onClick={handleJump}>Go</button>
        </div>
      </div>

      <div style={s.table} ref={tableRef}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={s.thead}>
            <tr>
              <th style={{ ...s.th, ...s.thR, width: 80 }}>Career Game</th>
              <th style={s.th}>Elo Leader</th>
              <th style={{ ...s.th, ...s.thR }}>Elo</th>
              <th style={s.th}>Team</th>
              <th style={{ ...s.th, ...s.thR }}>Date</th>
              <th style={{ ...s.th, ...s.thR }}>Games at #1</th>
            </tr>
          </thead>
          <tbody>
            {withMeta.map(row => {
              const color = TEAM_COLORS[row.team] || '#1a2e1a'
              return (
                <tr
                  key={row.n}
                  data-row={row.n}
                  style={{
                    borderBottom: '0.5px solid #f0ede8',
                    background: row.isChange ? '#fff' : 'transparent',
                    cursor: 'pointer',
                    borderLeft: row.isChange ? `3px solid ${color}` : '3px solid transparent',
                  }}
                  onClick={() => {
                    const p = players.find(x => x.name === row.name)
                    if (p) onSelectPlayer(p)
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                  onMouseLeave={e => e.currentTarget.style.background = row.isChange ? '#fff' : 'transparent'}
                >
                  <td style={{ padding: '10px 20px', textAlign: 'right', color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>
                    {row.n.toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 20px', fontWeight: row.isChange ? 600 : 400 }}>
                    {row.name}
                  </td>
                  <td style={{ padding: '10px 20px', textAlign: 'right', fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
                    {row.elo.toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 20px', fontSize: 11, color: '#aaa' }}>{row.team}</td>
                  <td style={{ padding: '10px 20px', textAlign: 'right', fontSize: 12, color: '#aaa', fontFamily: "'DM Mono', monospace" }}>
                    {row.date ? `${row.date.slice(5,7)}/${row.date.slice(8,10)}/${row.date.slice(0,4)}` : '—'}
                  </td>
                  <td style={{ padding: '10px 20px', textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>
                    {row.streak}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
