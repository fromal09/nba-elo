import { useState, useMemo, useRef, useEffect, useCallback } from 'react'

function CumulativeChart({ sharedGames, playerA, playerB }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!sharedGames.length || !svgRef.current || !wrapRef.current) return
    const svg = svgRef.current
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    const W = wrapRef.current.clientWidth || 600
    const H = 140
    const PAD = { top: 16, right: 16, bottom: 24, left: 40 }
    const ns = 'http://www.w3.org/2000/svg'
    svg.setAttribute('viewBox', `0 0 ${W} ${H + PAD.top + PAD.bottom}`)

    // Build cumulative series (chronological order)
    const games = [...sharedGames].sort((a, b) => a.date.localeCompare(b.date))
    let cumA = 0, cumB = 0
    const pointsA = [], pointsB = []
    games.forEach((g, i) => {
      cumA += g.aDelta
      cumB += g.bDelta
      pointsA.push({ x: i, y: cumA })
      pointsB.push({ x: i, y: cumB })
    })

    const n = games.length
    const allY = [...pointsA.map(p => p.y), ...pointsB.map(p => p.y), 0]
    const minY = Math.min(...allY), maxY = Math.max(...allY)
    const yRange = maxY - minY || 1

    const xScale = i => PAD.left + (i / Math.max(n - 1, 1)) * (W - PAD.left - PAD.right)
    const yScale = v => PAD.top + H - ((v - minY) / yRange) * H

    // Zero line
    const zeroY = yScale(0)
    const zeroline = document.createElementNS(ns, 'line')
    zeroline.setAttribute('x1', PAD.left); zeroline.setAttribute('x2', W - PAD.right)
    zeroline.setAttribute('y1', zeroY); zeroline.setAttribute('y2', zeroY)
    zeroline.setAttribute('stroke', 'rgba(0,0,0,0.1)'); zeroline.setAttribute('stroke-dasharray', '3,3'); zeroline.setAttribute('stroke-width', '1')
    svg.appendChild(zeroline)

    // Y axis labels
    for (const v of [minY, 0, maxY]) {
      if (Math.abs(maxY - minY) < 5) continue
      const t = document.createElementNS(ns, 'text')
      t.setAttribute('x', PAD.left - 4); t.setAttribute('y', yScale(v) + 4)
      t.setAttribute('font-size', '9'); t.setAttribute('fill', 'rgba(0,0,0,0.3)')
      t.setAttribute('font-family', 'sans-serif'); t.setAttribute('text-anchor', 'end')
      t.textContent = (v >= 0 ? '+' : '') + Math.round(v)
      svg.appendChild(t)
    }

    // Draw filled area under each line
    const drawArea = (pts, color) => {
      const z = yScale(0)
      const area = ['M', xScale(pts[0].x), z]
      pts.forEach(p => area.push('L', xScale(p.x), yScale(p.y)))
      area.push('L', xScale(pts[pts.length-1].x), z, 'Z')
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', area.join(' '))
      path.setAttribute('fill', color); path.setAttribute('opacity', '0.12')
      svg.appendChild(path)
    }

    // Draw line
    const drawLine = (pts, color, dashed = false) => {
      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.x).toFixed(1)},${yScale(p.y).toFixed(1)}`).join(' ')
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', d); path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color); path.setAttribute('stroke-width', '2')
      path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round')
      if (dashed) path.setAttribute('stroke-dasharray', '4,2')
      svg.appendChild(path)
      // End dot
      const last = pts[pts.length - 1]
      const dot = document.createElementNS(ns, 'circle')
      dot.setAttribute('cx', xScale(last.x)); dot.setAttribute('cy', yScale(last.y))
      dot.setAttribute('r', '3.5'); dot.setAttribute('fill', color)
      svg.appendChild(dot)
    }

    // X axis game labels (sparse)
    const maxLabels = Math.floor((W - PAD.left - PAD.right) / 60)
    const step = Math.max(1, Math.ceil(n / maxLabels))
    games.forEach((g, i) => {
      if (i % step !== 0 && i !== n - 1) return
      const t = document.createElementNS(ns, 'text')
      t.setAttribute('x', xScale(i)); t.setAttribute('y', H + PAD.top + 16)
      t.setAttribute('font-size', '9'); t.setAttribute('fill', 'rgba(0,0,0,0.3)')
      t.setAttribute('font-family', 'sans-serif'); t.setAttribute('text-anchor', 'middle')
      t.textContent = g.date.slice(0, 7)
      svg.appendChild(t)
    })

    drawArea(pointsA, '#1a1a1a')
    drawArea(pointsB, '#c94040')
    drawLine(pointsA, '#1a1a1a', false)
    drawLine(pointsB, '#c94040', true)
  }, [sharedGames])

  return (
    <div ref={wrapRef} style={{ background: '#fafaf8', borderRadius: 10, border: '0.5px solid #e8e5e0', padding: '12px 8px 4px' }}>
      <div style={{ display: 'flex', gap: 16, paddingLeft: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
          <div style={{ width: 12, height: 2, background: '#1a1a1a', borderRadius: 1 }} />
          {playerA.name.split(' ').pop()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#555' }}>
          <div style={{ width: 12, height: 0, borderTop: '2px dashed #c94040' }} />
          {playerB.name.split(' ').pop()}
        </div>
      </div>
      <svg ref={svgRef} style={{ width: '100%', display: 'block' }} />
    </div>
  )
}


function PlayerSearch({ label, value, onChange, players }) {
  const [query, setQuery] = useState('')
  const [open,  setOpen]  = useState(false)

  const results = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return players
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, players])

  function select(p) {
    onChange(p)
    setQuery(p.name)
    setOpen(false)
  }

  function clear() {
    onChange(null)
    setQuery('')
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#7aaa7a', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '0 12px' }}>
        {value && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#7aaa7a', marginRight: 8, flexShrink: 0 }} />}
        <input
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontFamily: "'DM Sans', sans-serif", fontSize: 14, padding: '10px 0' }}
          placeholder={`Search ${label}…`}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
        {value && (
          <button onClick={clear} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>✕</button>
        )}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#1a2e1a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, overflow: 'hidden', zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          {results.map(p => (
            <div
              key={p.name}
              onClick={() => select(p)}
              style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: '#fff', fontSize: 13 }}>{p.name}</span>
              <span style={{ color: '#7aaa7a', fontSize: 11 }}>{p.team} · {Math.round(p.peak_elo).toLocaleString()} peak</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatRow({ label, aVal, bVal, higherIsBetter = true }) {
  const aNum = typeof aVal === 'number' ? aVal : null
  const bNum = typeof bVal === 'number' ? bVal : null
  const aWins = aNum !== null && bNum !== null && (higherIsBetter ? aNum > bNum : aNum < bNum)
  const bWins = aNum !== null && bNum !== null && (higherIsBetter ? bNum > aNum : bNum < aNum)

  const fmt = v => {
    if (v === null || v === undefined) return '—'
    if (typeof v === 'string') return v
    return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : Math.round(v).toLocaleString()
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: '0.5px solid #f0ede8' }}>
      <div style={{ flex: 1, textAlign: 'right', fontSize: 14, fontWeight: aWins ? 600 : 400, color: aWins ? '#1a1a1a' : '#888' }}>
        {fmt(aVal)}
      </div>
      <div style={{ width: 160, textAlign: 'center', fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: bWins ? 600 : 400, color: bWins ? '#1a1a1a' : '#888' }}>
        {fmt(bVal)}
      </div>
    </div>
  )
}

function MiniChart({ playerA, playerB }) {
  if (!playerA?.elo_history?.length && !playerB?.elo_history?.length) return null

  const animRef = useRef(null)
  const [frame, setFrame] = useState(null)
  const [playing, setPlaying] = useState(false)

  const dates = useMemo(() => {
    const s = new Set()
    ;(playerA?.elo_history || []).forEach(e => s.add(e[0]))
    ;(playerB?.elo_history || []).forEach(e => s.add(e[0]))
    return [...s].sort()
  }, [playerA, playerB])

  const eloA = useMemo(() => Object.fromEntries((playerA?.elo_history || []).map(e => [e[0], e[1]])), [playerA])
  const eloB = useMemo(() => Object.fromEntries((playerB?.elo_history || []).map(e => [e[0], e[1]])), [playerB])

  const allVals = [
    ...(playerA?.elo_history || []).map(e => e[1]),
    ...(playerB?.elo_history || []).map(e => e[1]),
  ]
  const minV = Math.min(...allVals) - 50
  const maxV = Math.max(...allVals) + 50
  const W = 700, H = 180
  const xS = i => (i / Math.max(dates.length - 1, 1)) * W
  const yS = v => H - ((v - minV) / (maxV - minV)) * H

  function buildPath(eloMap, upTo) {
    const pts = []
    for (let i = 0; i <= upTo; i++) {
      const v = eloMap[dates[i]]
      if (v !== undefined) pts.push(`${pts.length === 0 ? 'M' : 'L'}${xS(i).toFixed(1)},${yS(v).toFixed(1)}`)
    }
    return pts.join(' ')
  }

  const currentFrame = frame ?? dates.length - 1
  const pathA = buildPath(eloA, currentFrame)
  const pathB = buildPath(eloB, currentFrame)

  const dotA = (() => { for (let i = currentFrame; i >= 0; i--) { if (eloA[dates[i]] !== undefined) return { x: xS(i), y: yS(eloA[dates[i]]) } } return null })()
  const dotB = (() => { for (let i = currentFrame; i >= 0; i--) { if (eloB[dates[i]] !== undefined) return { x: xS(i), y: yS(eloB[dates[i]]) } } return null })()
  const currentYear = dates[currentFrame]?.slice(0, 4)

  const animate = useCallback(() => {
    const total = dates.length
    const duration = 10000
    const startTime = performance.now()
    const tick = now => {
      const progress = Math.min((now - startTime) / duration, 1)
      setFrame(Math.floor(progress * (total - 1)))
      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        setFrame(null)
        setPlaying(false)
      }
    }
    animRef.current = requestAnimationFrame(tick)
  }, [dates.length])

  const handlePlay = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    setFrame(0); setPlaying(true); animate()
  }
  const handleStop = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    setFrame(null); setPlaying(false)
  }

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current) }, [])

  const yearLabels = useMemo(() => {
    const labels = []; let lastY = null
    dates.forEach((d, i) => {
      const y = d.slice(0, 4)
      if (y !== lastY && parseInt(y) % 5 === 0) { labels.push({ x: xS(i), year: y }); lastY = y }
    })
    return labels
  }, [dates])

  const gridLines = [1600,1800,2000,2200,2400,2600,2800,3000].filter(v => v >= minV && v <= maxV)

  return (
    <div style={{ padding: '0 32px 24px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ fontSize:11, textTransform:'uppercase', letterSpacing:1, color:'#aaa' }}>Elo Rating History</div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {frame !== null && (
            <span style={{ fontFamily:"'DM Mono', monospace", fontSize:13, color:'#1a2e1a', fontWeight:600 }}>
              {currentYear}
            </span>
          )}
          <button
            onClick={playing ? handleStop : handlePlay}
            style={{
              background:'#1a2e1a', color:'#fff', border:'none', borderRadius:6,
              padding:'5px 14px', fontSize:11, cursor:'pointer',
              fontFamily:"'DM Sans', sans-serif", fontWeight:500,
            }}
          >{playing ? '■ Stop' : frame !== null ? '▶ Resume' : '▶ Play'}</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 20}`} style={{ width:'100%', overflow:'visible' }}>
        {gridLines.map(v => {
          const y = yS(v)
          return (
            <g key={v}>
              <line x1={0} y1={y} x2={W} y2={y} stroke="#e0ddd6" strokeWidth={0.5} />
              <text x={-8} y={y+4} fontSize={9} fill="#bbb" textAnchor="end">{v}</text>
            </g>
          )
        })}
        {yearLabels.map(({x, year}) => (
          <text key={year} x={x} y={H+14} fontSize={9} fill="#bbb" textAnchor="middle">{year}</text>
        ))}
        {pathA && <path d={pathA} fill="none" stroke="#1a1a1a" strokeWidth={2} strokeLinejoin="round" />}
        {pathB && <path d={pathB} fill="none" stroke="#c94040" strokeWidth={2} strokeLinejoin="round" strokeDasharray="4,2" />}
        {dotA && <circle cx={dotA.x} cy={dotA.y} r={4} fill="#1a1a1a" />}
        {dotB && <circle cx={dotB.x} cy={dotB.y} r={4} fill="#c94040" />}
        {frame !== null && (
          <line x1={xS(currentFrame)} y1={0} x2={xS(currentFrame)} y2={H}
            stroke="rgba(0,0,0,0.1)" strokeWidth={1} strokeDasharray="3,2" />
        )}
      </svg>
      <div style={{ display:'flex', gap:20, marginTop:8 }}>
        {playerA && <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#555' }}><div style={{ width:20, height:2, background:'#1a1a1a' }} />{playerA.name}</div>}
        {playerB && <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#555' }}><div style={{ width:20, height:0, borderTop:'2px dashed #c94040' }} />{playerB.name}</div>}
      </div>
    </div>
  )
}


export default function H2H({ players }) {
  const [playerA, setPlayerA] = useState(null)
  const [playerB, setPlayerB] = useState(null)

  const avgElo = (p) => {
    if (!p) return null
    const h = p.elo_history || []
    return h.length ? Math.round(h.reduce((s, [, v]) => s + v, 0) / h.length) : Math.round(p.current_elo)
  }

  const careerRange = (p) => {
    if (!p?.elo_history?.length) return '—'
    const y1 = p.elo_history[0][0].slice(0, 4)
    const y2 = p.elo_history[p.elo_history.length - 1][0].slice(0, 4)
    return y1 === y2 ? y1 : `${y1}–${y2}`
  }

  const bothSelected = playerA && playerB

  const sharedGames = useMemo(() => {
    if (!playerA || !playerB) return []
    const buildLookup = (p) => {
      const hist = p.elo_history || []
      const map = {}
      for (let i = 0; i < hist.length; i++) {
        const e = hist[i]
        const date = e[0], eloVal = e[1], opp = e[2] || ''
        const prev = i > 0 ? hist[i-1][1] : eloVal
        let team = p.team
        for (const [d, t] of (p.team_history || [])) {
          if (d <= date) team = t; else break
        }
        const won = e.length > 3 ? e[3] : null
        map[date] = { elo: eloVal, prev, delta: eloVal - prev, team, opp, won }
      }
      return map
    }
    const lookupA = buildLookup(playerA)
    const lookupB = buildLookup(playerB)
    const shared = []
    for (const [date, a] of Object.entries(lookupA)) {
      const b = lookupB[date]
      if (!b) continue
      const facedEachOther = (a.opp && a.opp === b.team) || (b.opp && b.opp === a.team)
      if (!facedEachOther) continue
      const aEloWon = a.delta > b.delta
      const eloTied = a.delta === b.delta
      // Team result: e[3] is true if player won that game
      const aTeamWon = a.won === true
      const bTeamWon = b.won === true
      const teamTied = a.won === b.won
      shared.push({ date, aElo: a.elo, bElo: b.elo, aDelta: a.delta, bDelta: b.delta, aEloWon, eloTied, aTeamWon, bTeamWon, teamTied })
    }
    return shared.sort((a, b) => b.date.localeCompare(a.date))
  }, [playerA, playerB])

  const sharedRecord = useMemo(() => {
    const aEloWins  = sharedGames.filter(g => g.aEloWon).length
    const bEloWins  = sharedGames.filter(g => !g.aEloWon && !g.eloTied).length
    const eloTies   = sharedGames.filter(g => g.eloTied).length
    const aTeamWins = sharedGames.filter(g => g.aTeamWon).length
    const bTeamWins = sharedGames.filter(g => g.bTeamWon).length
    const teamTies  = sharedGames.filter(g => g.teamTied).length
    const aTotal = sharedGames.reduce((s, g) => s + g.aDelta, 0)
    const bTotal = sharedGames.reduce((s, g) => s + g.bDelta, 0)
    return { aEloWins, bEloWins, eloTies, aTeamWins, bTeamWins, teamTies, total: sharedGames.length, aTotal, bTotal }
  }, [sharedGames])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" }}>

      {/* Search header */}
      <div style={{ background: '#1a2e1a', padding: '28px 32px' }}>
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#7aaa7a', marginBottom: 8 }}>Head-to-Head</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <PlayerSearch label="Player A" value={playerA} onChange={setPlayerA} players={players} />
          <div style={{ paddingTop: 32, color: '#7aaa7a', fontSize: 14, fontWeight: 500, flexShrink: 0 }}>vs</div>
          <PlayerSearch label="Player B" value={playerB} onChange={setPlayerB} players={players} />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!bothSelected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: 14 }}>
            Search for two players to compare
          </div>
        ) : (
          <>
            {/* Player headers */}
            <div style={{ display: 'flex', background: '#fff', borderBottom: '0.5px solid #e0ddd6' }}>
              {[playerA, playerB].map((p, i) => {
                const peakFprRank = p.peak_fpr_rank || '—'
                const avg = avgElo(p)
                return (
                  <div key={i} style={{ flex: 1, padding: '20px 32px', borderRight: i === 0 ? '0.5px solid #e0ddd6' : 'none' }}>
                    <div style={{ fontSize: 22, fontFamily: "'DM Serif Display', serif", color: '#1a1a1a', marginBottom: 4 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: '#aaa' }}>{careerRange(p)} · {p.team}</div>
                    <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
                      <div><div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>Peak Elo</div><div style={{ fontSize: 18, fontWeight: 600, color: '#c9920a' }}>{Math.round(p.peak_elo).toLocaleString()}</div></div>
                      <div><div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>Avg Elo</div><div style={{ fontSize: 18, fontWeight: 500, color: '#1a1a1a' }}>{avg.toLocaleString()}</div></div>
                      <div><div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>Peak FPR Rank</div><div style={{ fontSize: 18, fontWeight: 500, color: '#1a1a1a' }}>#{peakFprRank}</div></div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Elo chart */}
            <div style={{ background: '#fff', borderBottom: '0.5px solid #e0ddd6', padding: '20px 32px 0' }}>
              <MiniChart playerA={playerA} playerB={playerB} />
            </div>

            {/* Stat comparison */}
            <div style={{ background: '#fff', margin: '16px 32px', borderRadius: 12, border: '0.5px solid #e0ddd6', padding: '4px 24px' }}>
              <div style={{ display: 'flex', padding: '8px 0 4px', borderBottom: '0.5px solid #e0ddd6' }}>
                <div style={{ flex: 1, textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>{playerA.name.split(' ').pop()}</div>
                <div style={{ width: 160, textAlign: 'center' }} />
                <div style={{ flex: 1, textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>{playerB.name.split(' ').pop()}</div>
              </div>
              <StatRow label="Peak Elo"         aVal={Math.round(playerA.peak_elo)}    bVal={Math.round(playerB.peak_elo)} />
              <StatRow label="Current Elo"      aVal={Math.round(playerA.current_elo)} bVal={Math.round(playerB.current_elo)} />
              <StatRow label="Average Elo"      aVal={avgElo(playerA)}                  bVal={avgElo(playerB)} />
              <StatRow label="Peak FPR Rank"    aVal={`#${playerA.peak_fpr_rank || '—'}`} bVal={`#${playerB.peak_fpr_rank || '—'}`} higherIsBetter={false} />
              <StatRow label="Games Played"     aVal={playerA.games_played}             bVal={playerB.games_played} />
              <StatRow label="Career"           aVal={careerRange(playerA)}             bVal={careerRange(playerB)} />
            </div>

            {/* Shared games */}
            {sharedGames.length > 0 && (
              <div style={{ margin: '16px 32px 24px' }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                  <div style={{ flex: 1, background: '#1a2e1a', borderRadius: 12, padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', marginBottom: 10 }}>{playerA.name.split(' ').pop()}</div>
                    <div style={{ fontSize: 12, color: '#7aaa7a', marginBottom: 2 }}>Elo record</div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
                      {sharedRecord.aEloWins}–{sharedRecord.bEloWins}{sharedRecord.eloTies > 0 ? `–${sharedRecord.eloTies}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#7aaa7a', marginBottom: 2 }}>Team record</div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
                      {sharedRecord.aTeamWins}–{sharedRecord.bTeamWins}{sharedRecord.teamTies > 0 ? `–${sharedRecord.teamTies}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#7aaa7a' }}>{sharedRecord.aTotal >= 0 ? '+' : ''}{Math.round(sharedRecord.aTotal)} cumulative Elo</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 4px', fontSize: 11, color: '#aaa', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>vs</span>
                    <span>{sharedRecord.total}</span>
                    <span>games</span>
                  </div>
                  <div style={{ flex: 1, background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 12, padding: '16px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#1a1a1a', marginBottom: 10 }}>{playerB.name.split(' ').pop()}</div>
                    <div style={{ fontSize: 12, color: '#aaa', marginBottom: 2 }}>Elo record</div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#1a1a1a', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
                      {sharedRecord.bEloWins}–{sharedRecord.aEloWins}{sharedRecord.eloTies > 0 ? `–${sharedRecord.eloTies}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#aaa', marginBottom: 2 }}>Team record</div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#1a1a1a', fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
                      {sharedRecord.bTeamWins}–{sharedRecord.aTeamWins}{sharedRecord.teamTies > 0 ? `–${sharedRecord.teamTies}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>{sharedRecord.bTotal >= 0 ? '+' : ''}{Math.round(sharedRecord.bTotal)} cumulative Elo</div>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '0.5px solid #e0ddd6', tableLayout: 'fixed' }}>
                  <thead style={{ background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' }}>
                    <tr>
                      <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'left', letterSpacing: '0.8px', textTransform: 'uppercase', width: '14%' }}>Date</th>
                      <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'right', letterSpacing: '0.8px', textTransform: 'uppercase', width: '18%' }}>{playerA.name.split(' ').pop()} Elo</th>
                      <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'right', letterSpacing: '0.8px', textTransform: 'uppercase', width: '10%' }}>Δ</th>
                      <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'center', letterSpacing: '0.8px', textTransform: 'uppercase', width: '12%' }}>Result</th>
                      <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'left', letterSpacing: '0.8px', textTransform: 'uppercase', width: '18%' }}>{playerB.name.split(' ').pop()} Elo</th>
                      <th style={{ padding: '8px 14px', fontSize: 10, fontWeight: 600, color: '#aaa', textAlign: 'left', letterSpacing: '0.8px', textTransform: 'uppercase', width: '10%' }}>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sharedGames.slice(0, 50).map(g => {
                      const ac = g.aDelta > 0 ? '#2d8a5a' : g.aDelta < 0 ? '#c94040' : '#aaa'
                      const bc = g.bDelta > 0 ? '#2d8a5a' : g.bDelta < 0 ? '#c94040' : '#aaa'
                      return (
                        <tr key={g.date} style={{ borderBottom: '0.5px solid #f0ede8' }}>
                          <td style={{ padding: '8px 14px', fontSize: 12, color: '#aaa' }}>{g.date}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(g.aElo).toLocaleString()}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600, color: ac, fontVariantNumeric: 'tabular-nums' }}>{g.aDelta >= 0 ? '+' : ''}{Math.round(g.aDelta)}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'center', fontSize: 16, color: '#555', width: '12%' }}>
                            {g.aTeamWon ? '←' : g.bTeamWon ? '→' : '·'}
                          </td>
                          <td style={{ padding: '8px 14px', fontVariantNumeric: 'tabular-nums' }}>{Math.round(g.bElo).toLocaleString()}</td>
                          <td style={{ padding: '8px 14px', fontWeight: 600, color: bc, fontVariantNumeric: 'tabular-nums' }}>{g.bDelta >= 0 ? '+' : ''}{Math.round(g.bDelta)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {sharedGames.length > 50 && (
                  <div style={{ padding: '10px 14px', fontSize: 12, color: '#aaa', borderTop: '0.5px solid #e0ddd6', background: '#faf9f6', borderRadius: '0 0 12px 12px' }}>
                    Showing 50 of {sharedGames.length} shared games
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 8 }}>
                    Cumulative Elo in H2H matchups
                  </div>
                  <CumulativeChart sharedGames={sharedGames} playerA={playerA} playerB={playerB} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
