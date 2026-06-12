import { useState, useMemo, useRef, useEffect, useCallback } from 'react'

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

  const svgRef    = useRef(null)
  const animRef   = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [frame,   setFrame]   = useState(null)
  const [frameA,  setFrameA]  = useState(null)
  const [frameB,  setFrameB]  = useState(null) // null = fully drawn

  // Build unified sorted date list
  const dates = useMemo(() => {
    const s = new Set()
    ;(playerA?.elo_history || []).forEach(e => s.add(e[0]))
    ;(playerB?.elo_history || []).forEach(e => s.add(e[0]))
    return [...s].sort()
  }, [playerA, playerB])

  // Lookup: date -> elo for each player
  const histA = playerA?.elo_history || []
  const histB = playerB?.elo_history || []
  const eloA = useMemo(() => Object.fromEntries(histA.map(e => [e[0], e[1]])), [playerA])
  const eloB = useMemo(() => Object.fromEntries(histB.map(e => [e[0], e[1]])), [playerB])

  const allVals = useMemo(() => [
    ...(playerA?.elo_history || []).map(e => e[1]),
    ...(playerB?.elo_history || []).map(e => e[1]),
  ], [playerA, playerB])

  const minV = Math.min(...allVals) - 50
  const maxV = Math.max(...allVals) + 50
  const W = 700, H = 180

  const xS = i => (i / Math.max(dates.length - 1, 1)) * W
  const yS = v => H - ((v - minV) / (maxV - minV)) * H

  function buildPathByGame(hist, gameIdx) {
    const upTo = gameIdx ?? hist.length - 1
    const pts = []
    for (let i = 0; i <= upTo; i++) {
      const e = hist[i]; if (!e) continue
      const di = dates.indexOf(e[0]); if (di < 0) continue
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${xS(di).toFixed(1)},${yS(e[1]).toFixed(1)}`)
    }
    return pts.join(' ')
  }

  const pathA = buildPathByGame(histA, frameA)
  const pathB = buildPathByGame(histB, frameB)
  const curA = frameA !== null ? histA[frameA] : histA[histA.length - 1]
  const curB = frameB !== null ? histB[frameB] : histB[histB.length - 1]
  const dotA = curA ? { x: xS(dates.indexOf(curA[0])), y: yS(curA[1]) } : null
  const dotB = curB ? { x: xS(dates.indexOf(curB[0])), y: yS(curB[1]) } : null
  const curDate = [curA?.[0], curB?.[0]].filter(Boolean).sort().pop()
  const currentYear = curDate?.slice(0, 4)
  // Animation: always 10 seconds total
  const animate = useCallback(() => {
    const total = Math.max(histA.length, histB.length)
    const duration = 10000
    const startTime = performance.now()
    const tick = now => {
      const progress = Math.min((now - startTime) / duration, 1)
      const step = Math.floor(progress * (total - 1))
      setFrame(step)
      setFrameA(Math.min(step, histA.length - 1))
      setFrameB(Math.min(step, histB.length - 1))
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
    setFrame(0)
    setPlaying(true)
    animate()
  }

  const handleReset = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
    setFrame(null)
    setPlaying(false)
  }

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current) }, [])

  // Year labels (static)
  const yearLabels = useMemo(() => {
    const labels = []; let lastY = null
    dates.forEach((d, i) => {
      const y = d.slice(0, 4)
      if (y !== lastY && parseInt(y) % 5 === 0) { labels.push({ x: xS(i), year: y }); lastY = y }
    })
    return labels
  }, [dates])

  const gridLines = [1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000].filter(v => v >= minV && v <= maxV)

  return (
    <div style={{ padding: '0 32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa' }}>Elo Rating History</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {frame !== null && (
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: '#1a2e1a', fontWeight: 600 }}>
              {currentYear}
            </span>
          )}
          <button
            onClick={playing ? handleReset : handlePlay}
            style={{
              background: '#1a2e1a', color: '#fff', border: 'none', borderRadius: 6,
              padding: '4px 12px', fontSize: 11, cursor: 'pointer',
              fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
            }}
          >
            {playing ? '■ Stop' : frame !== null ? '▶ Resume' : '▶ Replay'}
          </button>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H + 20}`} style={{ width: '100%', overflow: 'visible' }}>
        {gridLines.map(v => {
          const y = yS(v)
          return (
            <g key={v}>
              <line x1={0} y1={y} x2={W} y2={y} stroke="#e0ddd6" strokeWidth={0.5} />
              <text x={-8} y={y + 4} fontSize={9} fill="#bbb" textAnchor="end">{v}</text>
            </g>
          )
        })}
        {yearLabels.map(({ x, year }) => (
          <text key={year} x={x} y={H + 14} fontSize={9} fill="#bbb" textAnchor="middle">{year}</text>
        ))}
        {pathA && <path d={pathA} fill="none" stroke="#1a1a1a" strokeWidth={2} strokeLinejoin="round" />}
        {pathB && <path d={pathB} fill="none" stroke="#c94040" strokeWidth={2} strokeLinejoin="round" strokeDasharray="4,2" />}
        {dotA && <circle cx={dotA.x} cy={dotA.y} r={4} fill="#1a1a1a" />}
        {dotB && <circle cx={dotB.x} cy={dotB.y} r={4} fill="#c94040" />}
        {/* Playhead */}
        {frame !== null && (
          <line x1={xS(currentFrame)} y1={0} x2={xS(currentFrame)} y2={H}
            stroke="rgba(0,0,0,0.1)" strokeWidth={1} strokeDasharray="3,2" />
        )}
      </svg>

      <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
        {playerA && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}><div style={{ width: 20, height: 2, background: '#1a1a1a' }} />{playerA.name}</div>}
        {playerB && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}><div style={{ width: 20, height: 2, background: '#c94040', borderTop: '2px dashed #c94040' }} />{playerB.name}</div>}
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
          </>
        )}
      </div>
    </div>
  )
}
