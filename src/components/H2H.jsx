import { useState, useMemo, useRef, useEffect, useCallback } from 'react'

function PlayerSearch({ label, value, onChange, players }) {
  const [q, setQ] = useState('')
  const results = q.length > 1
    ? players.filter(p => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : []

  function select(p) { onChange(p); setQ('') }
  function clear()    { onChange(null); setQ('') }

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#6896bd', marginBottom: 6 }}>{label}</div>
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 14px' }}>
          <span style={{ color: '#fff', fontWeight: 600, flex: 1 }}>{value.name}</span>
          <button onClick={clear} style={{ background: 'none', border: 'none', color: '#6896bd', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      ) : (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search players…"
            style={{ width: '100%', background: 'rgba(255,255,255,0.1)', border: '0.5px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" }} />
          {results.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 100, marginTop: 4, overflow: 'hidden' }}>
              {results.map(p => (
                <div key={p.name} onClick={() => select(p)}
                  style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '0.5px solid #f0f0f0', color: '#1a1a1a' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f4f4f4'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >{p.name}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatRow({ label, aVal, bVal, higherIsBetter = true }) {
  const aNum = parseFloat(String(aVal).replace('#',''))
  const bNum = parseFloat(String(bVal).replace('#',''))
  const aWins = !isNaN(aNum) && !isNaN(bNum) && (higherIsBetter ? aNum > bNum : aNum < bNum)
  const bWins = !isNaN(aNum) && !isNaN(bNum) && (higherIsBetter ? bNum > aNum : bNum < aNum)
  const cell = (val, wins) => ({
    flex: 1, padding: '10px 0', textAlign: wins ? 'right' : 'right',
    fontSize: 15, fontWeight: wins ? 700 : 400,
    color: wins ? '#173657' : '#888', fontVariantNumeric: 'tabular-nums',
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: '0.5px solid #f4f4f4' }}>
      <div style={cell(aVal, aWins)}>{aVal}</div>
      <div style={{ width: 160, textAlign: 'center', fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ ...cell(bVal, bWins), textAlign: 'left' }}>{bVal}</div>
    </div>
  )
}

const TEAM_COLORS = {
  ATL:'#C8102E',BOS:'#007A33',BKN:'#000000',CHA:'#00788C',CHO:'#00788C',
  CHI:'#CE1141',CLE:'#860038',DAL:'#00538C',DEN:'#0E2240',DET:'#C8102E',
  GSW:'#1D428A',HOU:'#CE1141',IND:'#002D62',LAC:'#C8102E',LAL:'#552583',
  MEM:'#5D76A9',MIA:'#98002E',MIL:'#00471B',MIN:'#0C2340',NOP:'#0C2340',
  NOH:'#0C2340',NYK:'#006BB6',OKC:'#007AC1',ORL:'#0077C0',PHI:'#006BB6',
  PHO:'#1D1160',POR:'#E03A3E',SAC:'#5A2D81',SAS:'#000000',SEA:'#00653A',
  TOR:'#CE1141',UTA:'#002B5C',WAS:'#002B5C',MNL:'#552583',
}

function MiniChart({ playerA, playerB }) {
  if (!playerA?.elo_history?.length && !playerB?.elo_history?.length) return null

  const animRef = useRef(null)
  const [frame,  setFrame]  = useState(null)
  const [frameA, setFrameA] = useState(null)
  const [frameB, setFrameB] = useState(null)
  const [playing,setPlaying]= useState(false)

  const dates = useMemo(() => {
    const s = new Set()
    ;(playerA?.elo_history || []).forEach(e => s.add(e[0]))
    ;(playerB?.elo_history || []).forEach(e => s.add(e[0]))
    return [...s].sort()
  }, [playerA, playerB])

  const histA = playerA?.elo_history || []
  const histB = playerB?.elo_history || []
  const eloA  = useMemo(() => Object.fromEntries(histA.map(e => [e[0], e[1]])), [playerA])
  const eloB  = useMemo(() => Object.fromEntries(histB.map(e => [e[0], e[1]])), [playerB])

  const allVals = [...histA.map(e=>e[1]), ...histB.map(e=>e[1])]
  const minV = Math.min(...allVals) - 50
  const maxV = Math.max(...allVals) + 50
  const W = 700, H = 180
  const xS = i => (i / Math.max(dates.length-1,1)) * W
  const yS = v => H - ((v - minV) / (maxV - minV)) * H

  function buildPathByGame(hist, gameIdx) {
    const upTo = gameIdx ?? hist.length - 1
    const pts = []
    for (let i = 0; i <= upTo; i++) {
      const e = hist[i]; if (!e) continue
      const di = dates.indexOf(e[0]); if (di < 0) continue
      pts.push(`${pts.length === 0 ? "M" : "L"}${xS(di).toFixed(1)},${yS(e[1]).toFixed(1)}`)
    }
    return pts.join(" ")
  }

  const pathA = buildPathByGame(histA, frameA)
  const pathB = buildPathByGame(histB, frameB)
  const curA = frameA !== null ? histA[frameA] : histA[histA.length-1]
  const curB = frameB !== null ? histB[frameB] : histB[histB.length-1]
  const dotA = curA ? { x: xS(dates.indexOf(curA[0])), y: yS(curA[1]) } : null
  const dotB = curB ? { x: xS(dates.indexOf(curB[0])), y: yS(curB[1]) } : null
  const curDate = [curA?.[0], curB?.[0]].filter(Boolean).sort().pop()
  const currentYear = curDate?.slice(0, 4)
  const currentFrame = frame !== null ? Math.min(frame, dates.length-1) : dates.length-1

  const animate = useCallback(() => {
    const total = Math.max(histA.length, histB.length)
    const duration = 10000
    const startTime = performance.now()
    const tick = now => {
      const progress = Math.min((now - startTime) / duration, 1)
      const step = Math.floor(progress * (total - 1))
      setFrame(step)
      setFrameA(Math.min(step, histA.length-1))
      setFrameB(Math.min(step, histB.length-1))
      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        setFrame(null); setFrameA(null); setFrameB(null); setPlaying(false)
      }
    }
    animRef.current = requestAnimationFrame(tick)
  }, [histA.length, histB.length])

  const handlePlay = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    setFrame(0); setFrameA(0); setFrameB(0); setPlaying(true); animate()
  }
  const handleStop = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    setFrame(null); setFrameA(null); setFrameB(null); setPlaying(false)
  }
  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current) }, [])

  const yearLabels = useMemo(() => {
    const labels = []; let lastY = null
    dates.forEach((d, i) => {
      const y = d.slice(0,4)
      if (y !== lastY && parseInt(y) % 5 === 0) { labels.push({ x: xS(i), year: y }); lastY = y }
    })
    return labels
  }, [dates])

  const gridLines = [1600,1800,2000,2200,2400,2600,2800,3000].filter(v => v >= minV && v <= maxV)

  return (
    <div style={{ padding: "0 32px 24px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:"#aaa" }}>Elo Rating History</div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {frame !== null && <span style={{ fontFamily:"'Consolas', 'Monaco', monospace", fontSize:13, color:"#173657", fontWeight:600 }}>{currentYear}</span>}
          <button onClick={playing ? handleStop : handlePlay} style={{ background:"#173657", color:"#fff", border:"none", borderRadius:6, padding:"5px 14px", fontSize:11, cursor:"pointer", fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif", fontWeight:500 }}>
            {playing ? "■ Stop" : "▶ Play"}
          </button>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H+20}`} style={{ width:"100%", overflow:"visible" }}>
        {gridLines.map(v => {
          const y = yS(v)
          return <g key={v}>
            <line x1={0} y1={y} x2={W} y2={y} stroke="#e0e0e0" strokeWidth={0.5} />
            <text x={-8} y={y+4} fontSize={9} fill="#bbb" textAnchor="end">{v}</text>
          </g>
        })}
        {yearLabels.map(({x,year}) => <text key={year} x={x} y={H+14} fontSize={9} fill="#bbb" textAnchor="middle">{year}</text>)}
        {pathA && <path d={pathA} fill="none" stroke="#1a1a1a" strokeWidth={2} strokeLinejoin="round" />}
        {pathB && <path d={pathB} fill="none" stroke="#c94040" strokeWidth={2} strokeLinejoin="round" strokeDasharray="4,2" />}
        {dotA && <circle cx={dotA.x} cy={dotA.y} r={4} fill="#1a1a1a" />}
        {dotB && <circle cx={dotB.x} cy={dotB.y} r={4} fill="#c94040" />}
        {frame !== null && <line x1={xS(currentFrame)} y1={0} x2={xS(currentFrame)} y2={H} stroke="rgba(0,0,0,0.1)" strokeWidth={1} strokeDasharray="3,2" />}
      </svg>
      <div style={{ display:"flex", gap:20, marginTop:8 }}>
        {playerA && <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"#555" }}><div style={{ width:20, height:2, background:"#1a1a1a" }} />{playerA.name}</div>}
        {playerB && <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:"#555" }}><div style={{ width:20, height:0, borderTop:"2px dashed #c94040" }} />{playerB.name}</div>}
      </div>
    </div>
  )
}

function SharedGames({ playerA, playerB }) {
  const shared = useMemo(() => {
    if (!playerA || !playerB) return []
    const histA = playerA.elo_history || []
    const histB = playerB.elo_history || []

    // Index histB by date
    const bByDate = {}
    histB.forEach(e => { bByDate[e[0]] = e })

    const games = []
    histA.forEach((eA, iA) => {
      const date = eA[0]
      const eB = bByDate[date]
      if (!eB) return
      // They played each other: eA[2] = opp, eA[4] = team
      const aOpp = eA[2], aTeam = eA[4]
      const bOpp = eB[2], bTeam = eB[4]
      const facedEachOther = (aOpp === bTeam || bOpp === aTeam)
      if (!facedEachOther) return

      // Previous Elo (entry before this one)
      const prevEloA = iA > 0 ? histA[iA-1][1] : eA[1]
      const prevEloB = (() => {
        const iB = histB.findIndex(e => e[0] === date)
        return iB > 0 ? histB[iB-1][1] : eB[1]
      })()

      const eloGainA = eA[1] - prevEloA
      const eloGainB = eB[1] - prevEloB
      const eloWinA  = eloGainA > eloGainB
      const teamWinA = eA[3] === true  // won_bool

      games.push({
        date,
        eloA: Math.round(eA[1]), eloB: Math.round(eB[1]),
        teamA: aTeam, teamB: bTeam,
        eloWinA, teamWinA,
        eloGainA: Math.round(eloGainA), eloGainB: Math.round(eloGainB),
      })
    })
    return games.sort((a,b) => a.date.localeCompare(b.date))
  }, [playerA, playerB])

  if (!shared.length) return (
    <div style={{ padding:"24px 32px", color:"#aaa", fontSize:13 }}>
      No direct head-to-head games found in the data.
    </div>
  )

  const aEloWins  = shared.filter(g => g.eloWinA).length
  const bEloWins  = shared.length - aEloWins
  const aTeamWins = shared.filter(g => g.teamWinA).length
  const bTeamWins = shared.length - aTeamWins

  const s = {
    th: { padding:"8px 12px", fontSize:10, fontWeight:600, color:"#aaa", textTransform:"uppercase", letterSpacing:"0.8px", textAlign:"left" },
    thR: { textAlign:"right" },
    td: { padding:"8px 12px", fontSize:13, borderBottom:"0.5px solid #f4f4f4" },
  }

  return (
    <div style={{ padding:"0 32px 24px" }}>
      <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:1, color:"#aaa", marginBottom:12 }}>
        Head-to-Head Games — {shared.length} matchups found
      </div>

      {/* Summary */}
      <div style={{ display:"flex", gap:12, marginBottom:16 }}>
        {[
          { label:"Elo W/L", aV:`${aEloWins}–${bEloWins}`, bV:`${bEloWins}–${aEloWins}` },
          { label:"Team W/L", aV:`${aTeamWins}–${bTeamWins}`, bV:`${bTeamWins}–${aTeamWins}` },
        ].map(({ label, aV, bV }) => (
          <div key={label} style={{ background:"#f4f4f4", borderRadius:8, padding:"10px 16px", fontSize:13 }}>
            <div style={{ fontSize:10, color:"#aaa", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>{label}</div>
            <div><span style={{ fontWeight:700, color:"#1a1a1a" }}>{playerA.name.split(" ").pop()}</span> <span style={{ color:"#888" }}>{aV}</span> · <span style={{ fontWeight:700, color:"#c94040" }}>{playerB.name.split(" ").pop()}</span> <span style={{ color:"#888" }}>{bV}</span></div>
          </div>
        ))}
      </div>

      {/* Game log */}
      <div style={{ border:"0.5px solid #e0e0e0", borderRadius:10, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead style={{ background:"#f8f8f8" }}>
            <tr>
              <th style={s.th}>Date</th>
              <th style={s.th}>{playerA.name.split(" ").pop()} Team</th>
              <th style={{ ...s.th, ...s.thR }}>{playerA.name.split(" ").pop()} Elo</th>
              <th style={{ ...s.th, ...s.thR }}>Elo Δ</th>
              <th style={{ ...s.th, ...s.thR }}>{playerB.name.split(" ").pop()} Elo</th>
              <th style={{ ...s.th, ...s.thR }}>Elo Δ</th>
              <th style={s.th}>{playerB.name.split(" ").pop()} Team</th>
              <th style={{ ...s.th, ...s.thR }}>Elo W</th>
              <th style={{ ...s.th, ...s.thR }}>Team W</th>
            </tr>
          </thead>
          <tbody>
            {shared.map((g,i) => {
              const fmt = d => `${d.slice(5,7)}/${d.slice(8,10)}/${d.slice(0,4)}`
              const colorA = TEAM_COLORS[g.teamA] || "#555"
              const colorB = TEAM_COLORS[g.teamB] || "#c94040"
              return (
                <tr key={i} style={{ background: i%2===0 ? "#fff" : "#f8f8f8" }}>
                  <td style={{ ...s.td, fontFamily:"'Consolas', 'Monaco', monospace", fontSize:11, color:"#aaa" }}>{fmt(g.date)}</td>
                  <td style={{ ...s.td, fontSize:11, fontWeight:600, color:colorA }}>{g.teamA}</td>
                  <td style={{ ...s.td, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{g.eloA.toLocaleString()}</td>
                  <td style={{ ...s.td, textAlign:"right", fontSize:11, color: g.eloGainA >= 0 ? "#173657" : "#c94040", fontVariantNumeric:"tabular-nums" }}>{g.eloGainA >= 0 ? "+" : ""}{g.eloGainA}</td>
                  <td style={{ ...s.td, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{g.eloB.toLocaleString()}</td>
                  <td style={{ ...s.td, textAlign:"right", fontSize:11, color: g.eloGainB >= 0 ? "#173657" : "#c94040", fontVariantNumeric:"tabular-nums" }}>{g.eloGainB >= 0 ? "+" : ""}{g.eloGainB}</td>
                  <td style={{ ...s.td, fontSize:11, fontWeight:600, color:colorB }}>{g.teamB}</td>
                  <td style={{ ...s.td, textAlign:"right", fontSize:12 }}>{g.eloWinA ? playerA.name.split(" ").pop() : playerB.name.split(" ").pop()}</td>
                  <td style={{ ...s.td, textAlign:"right", fontSize:12 }}>{g.teamWinA ? playerA.name.split(" ").pop() : playerB.name.split(" ").pop()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function H2H({ players }) {
  const [playerA, setPlayerA] = useState(null)
  const [playerB, setPlayerB] = useState(null)

  const avgElo = p => {
    if (!p) return null
    const h = p.elo_history || []
    return h.length ? Math.round(h.reduce((s, e) => s + e[1], 0) / h.length) : Math.round(p.current_elo)
  }

  const careerRange = p => {
    if (!p?.elo_history?.length) return "—"
    const y1 = p.elo_history[0][0].slice(0,4)
    const y2 = p.elo_history[p.elo_history.length-1][0].slice(0,4)
    return y1 === y2 ? y1 : `${y1}–${y2}`
  }

  const bothSelected = playerA && playerB

  return (
    <div style={{ display:"flex", flexDirection:"column", flex:1, overflow:"hidden", background:"#f4f4f4", fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ background:"#173657", padding:"28px 32px" }}>
        <div style={{ fontSize:11, letterSpacing:2, textTransform:"uppercase", color:"#6896bd", marginBottom:8 }}>Head-to-Head</div>
        <div style={{ display:"flex", gap:16, alignItems:"flex-start" }}>
          <PlayerSearch label="Player A" value={playerA} onChange={setPlayerA} players={players} />
          <div style={{ paddingTop:32, color:"#6896bd", fontSize:14, fontWeight:500, flexShrink:0 }}>vs</div>
          <PlayerSearch label="Player B" value={playerB} onChange={setPlayerB} players={players} />
        </div>
      </div>

      <div style={{ flex:1, overflow:"auto" }}>
        {!bothSelected ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"#aaa", fontSize:14 }}>
            Search for two players to compare
          </div>
        ) : (
          <>
            {/* Player headers */}
            <div style={{ display:"flex", background:"#fff", borderBottom:"0.5px solid #e0e0e0" }}>
              {[playerA, playerB].map((p, i) => (
                <div key={i} style={{ flex:1, padding:"20px 32px", borderRight: i===0 ? "0.5px solid #e0e0e0" : "none" }}>
                  <div style={{ fontSize:22, fontFamily:"'Georgia', serif", color:"#1a1a1a", marginBottom:4 }}>{p.name}</div>
                  <div style={{ fontSize:12, color:"#aaa" }}>{careerRange(p)} · {p.team}</div>
                  <div style={{ display:"flex", gap:20, marginTop:12 }}>
                    <div><div style={{ fontSize:11, color:"#aaa", marginBottom:2 }}>Peak Elo</div><div style={{ fontSize:18, fontWeight:600, color:"#6896bd" }}>{Math.round(p.peak_elo).toLocaleString()}</div></div>
                    <div><div style={{ fontSize:11, color:"#aaa", marginBottom:2 }}>Avg Elo</div><div style={{ fontSize:18, fontWeight:500 }}>{avgElo(p).toLocaleString()}</div></div>
                    <div><div style={{ fontSize:11, color:"#aaa", marginBottom:2 }}>Peak FPR</div><div style={{ fontSize:18, fontWeight:500 }}>#{p.peak_fpr_rank || "—"}</div></div>
                  </div>
                </div>
              ))}
            </div>

            {/* Animated Elo chart */}
            <div style={{ background:"#fff", borderBottom:"0.5px solid #e0e0e0", padding:"20px 32px 0" }}>
              <MiniChart playerA={playerA} playerB={playerB} />
            </div>

            {/* Stat comparison */}
            <div style={{ background:"#fff", margin:"16px 32px", borderRadius:12, border:"0.5px solid #e0e0e0", padding:"4px 24px" }}>
              <div style={{ display:"flex", padding:"8px 0 4px", borderBottom:"0.5px solid #e0e0e0" }}>
                <div style={{ flex:1, textAlign:"right", fontSize:11, fontWeight:600, color:"#555", textTransform:"uppercase", letterSpacing:0.5 }}>{playerA.name.split(" ").pop()}</div>
                <div style={{ width:160, textAlign:"center" }} />
                <div style={{ flex:1, fontSize:11, fontWeight:600, color:"#555", textTransform:"uppercase", letterSpacing:0.5 }}>{playerB.name.split(" ").pop()}</div>
              </div>
              <StatRow label="Peak Elo"      aVal={Math.round(playerA.peak_elo)}    bVal={Math.round(playerB.peak_elo)} />
              <StatRow label="Current Elo"   aVal={Math.round(playerA.current_elo)} bVal={Math.round(playerB.current_elo)} />
              <StatRow label="Average Elo"   aVal={avgElo(playerA)}                  bVal={avgElo(playerB)} />
              <StatRow label="Peak FPR Rank" aVal={`#${playerA.peak_fpr_rank||"—"}`} bVal={`#${playerB.peak_fpr_rank||"—"}`} higherIsBetter={false} />
              <StatRow label="Games Played"  aVal={playerA.games_played}             bVal={playerB.games_played} />
              <StatRow label="Career"        aVal={careerRange(playerA)}             bVal={careerRange(playerB)} />
            </div>

            {/* Shared games */}
            <div style={{ background:"#fff", margin:"0 32px 24px", borderRadius:12, border:"0.5px solid #e0e0e0", overflow:"hidden" }}>
              <div style={{ padding:"16px 32px 0" }}>
                <SharedGames playerA={playerA} playerB={playerB} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
