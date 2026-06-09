import { useEffect, useRef, useCallback, useState } from 'react'

let spagCache = null
let spagPromise = null
function getSpagData() {
  if (spagCache) return Promise.resolve(spagCache)
  if (!spagPromise) {
    spagPromise = fetch('/data/spaghetti.json')
      .then(r => r.json())
      .then(d => { spagCache = d; return d })
  }
  return spagPromise
}

function drawChart(data, focusIdx, svg, eloHist, careerMode) {
  while (svg.firstChild) svg.removeChild(svg.firstChild)
  const W = svg.clientWidth || 560
  const H = 160
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 20}`)
  const ns = 'http://www.w3.org/2000/svg'
  const { dates, players } = data

  if (!players || focusIdx < 0 || focusIdx >= players.length) return

  // If careerMode, find date range from player's elo_history
  let dateStart = 0, dateEnd = dates.length - 1
  if (careerMode && eloHist && eloHist.length) {
    const first = eloHist[0][0], last = eloHist[eloHist.length - 1][0]
    const si = dates.findIndex(d => d >= first)
    // findLastIndex polyfill
    let ei = -1
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] <= last) { ei = i; break }
    }
    if (si !== -1) dateStart = si
    if (ei !== -1) dateEnd = ei
  }

  const focusPts = (players[focusIdx] || []).filter(([i]) => i >= dateStart && i <= dateEnd)
  if (!focusPts.length) return

  // Min/max across ALL players in window (career mode still shows all players)
  let minV = Infinity, maxV = -Infinity
  for (const pts of players) {
    for (const [i, v] of pts) {
      if (i < dateStart || i > dateEnd) continue
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
  }
  if (!isFinite(minV)) return
  minV -= 30; maxV += 30
  const xScale = i => ((i - dateStart) / Math.max(dateEnd - dateStart, 1)) * W
  const yScale = v => H - ((v - minV) / (maxV - minV)) * H

  // Grid lines
  for (const v of [1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000]) {
    if (v < minV || v > maxV) continue
    const y = yScale(v)
    const line = document.createElementNS(ns, 'line')
    line.setAttribute('x1', 0); line.setAttribute('y1', y)
    line.setAttribute('x2', W); line.setAttribute('y2', y)
    line.setAttribute('stroke', 'rgba(0,0,0,0.05)'); line.setAttribute('stroke-width', '0.5')
    svg.appendChild(line)
    const txt = document.createElementNS(ns, 'text')
    txt.setAttribute('x', 4); txt.setAttribute('y', y - 3)
    txt.setAttribute('font-size', '8'); txt.setAttribute('fill', 'rgba(0,0,0,0.25)')
    txt.setAttribute('font-family', 'sans-serif')
    txt.textContent = v
    svg.appendChild(txt)
  }

  // Dynamic x-axis labels — step size based on visible year range
  const yr0 = parseInt(dates[dateStart]?.slice(0,4) || '1946')
  const yr1 = parseInt(dates[dateEnd]?.slice(0,4) || '2026')
  const yearSpan = yr1 - yr0 || 1
  const maxLabels = Math.floor(W / 52)
  let labelStep = 1
  for (const step of [1,2,3,5,10,15,20,25,30,40,50]) {
    if (Math.ceil(yearSpan / step) <= maxLabels) { labelStep = step; break }
  }
  let lastLabelX = -999
  dates.slice(dateStart, dateEnd + 1).forEach((d, idx) => {
    const yr = parseInt(d.slice(0, 4))
    if (yr % labelStep !== 0) return
    const x = xScale(dateStart + idx)
    if (x - lastLabelX < 48) return
    lastLabelX = x
    const txt = document.createElementNS(ns, 'text')
    txt.setAttribute('x', x); txt.setAttribute('y', H + 14)
    txt.setAttribute('font-size', '9'); txt.setAttribute('fill', 'rgba(0,0,0,0.3)')
    txt.setAttribute('font-family', 'sans-serif'); txt.setAttribute('text-anchor', 'middle')
    txt.textContent = yr
    svg.appendChild(txt)
  })

  // Background players — always shown in both modes
  players.forEach((pts, idx) => {
    if (idx === focusIdx) return
    const filtered = pts.filter(([i]) => i >= dateStart && i <= dateEnd)
    if (filtered.length < 2) return
    const d = filtered.map(([i, v], k) => `${k === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ')
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', d); path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'rgba(150,175,210,0.12)'); path.setAttribute('stroke-width', '1')
    svg.appendChild(path)
  })

  // Focus player
  if (focusPts.length >= 2) {
    const d = focusPts.map(([i, v], k) => `${k === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ')
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', d); path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#1a2e1a'); path.setAttribute('stroke-width', '2.5')
    path.setAttribute('stroke-linecap', 'round')
    svg.appendChild(path)
    const last = focusPts[focusPts.length - 1]
    const dot = document.createElementNS(ns, 'circle')
    dot.setAttribute('cx', xScale(last[0])); dot.setAttribute('cy', yScale(last[1]))
    dot.setAttribute('r', '4'); dot.setAttribute('fill', '#1a2e1a')
    svg.appendChild(dot)
  }
}

function SpagChart({ playerIndex, playerName, eloHist }) {
  const svgRef       = useRef(null)
  const wrapRef      = useRef(null)
  const eloHistRef   = useRef(eloHist)
  const [loaded,     setLoaded]     = useState(false)
  const [careerMode, setCareerMode] = useState(false)
  const [spagData,   setSpagData]   = useState(null)

  // Load spaghetti data once
  useEffect(() => {
    let cancelled = false
    getSpagData()
      .then(d => { if (!cancelled) setSpagData(d) })
      .catch(err => console.error('spaghetti load failed:', err))
    return () => { cancelled = true }
  }, [])

  // Draw whenever data or mode changes
  useEffect(() => {
    if (!spagData || !svgRef.current || !wrapRef.current) return
    const w = wrapRef.current.clientWidth || 560
    svgRef.current.style.width = w + 'px'
    drawChart(spagData, playerIndex, svgRef.current, eloHistRef.current, careerMode)
    setLoaded(true)
  }, [spagData, playerIndex, careerMode])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa' }}>
          {careerMode ? `Career view · all players in gray` : `All players in gray · ${playerName} highlighted`}
        </div>
        <div style={{ display: 'flex', border: '0.5px solid #e0ddd6', borderRadius: 6, overflow: 'hidden' }}>
          {[['All-Time', false],['Career', true]].map(([label, mode]) => (
            <button
              key={label}
              onClick={() => setCareerMode(mode)}
              style={{
                padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500,
                background: careerMode === mode ? '#1a2e1a' : 'transparent',
                color: careerMode === mode ? '#fff' : '#888',
                borderRight: mode === false ? '0.5px solid #e0ddd6' : 'none',
              }}
            >{label}</button>
          ))}
        </div>
      </div>
      <div ref={wrapRef} style={{ background: '#fafaf8', borderRadius: 8, border: '0.5px solid #e8e5e0', padding: '8px 4px 0', minHeight: 188 }}>
        {!loaded && <div style={{ textAlign: 'center', padding: 20, fontSize: 12, color: '#aaa' }}>Loading…</div>}
        <svg ref={svgRef} style={{ width: '100%', display: loaded ? 'block' : 'none' }} />
      </div>
    </div>
  )
}

const BADGE_STYLES = {
  fpr:       { bg: '#e8f0e0', color: '#2d5a1a', border: '#c0d8a0' },
  elo:       { bg: '#faf0dc', color: '#7a4f0a', border: '#f0d090' },
  longevity: { bg: '#ede8f8', color: '#4a2a8a', border: '#c8b8f0' },
  era:       { bg: '#e0eaf8', color: '#1a3a6e', border: '#b0c8f0' },
}

function Badge({ b }) {
  const style = BADGE_STYLES[b.cat] || BADGE_STYLES.fpr
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
      background: style.bg, color: style.color, border: `0.5px solid ${style.border}`,
    }}>
      <span>{b.emoji}</span> {b.label}
    </span>
  )
}

export default function PlayerModal({ player, allPlayers, onClose }) {
  const backdropRef = useRef(null)
  const handleKey = useCallback(e => { if (e.key === 'Escape') onClose() }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = '' }
  }, [handleKey])

  const playerIndex = allPlayers.findIndex(p => p.name === player.name)

  const avgElo = player.elo_history?.length
    ? Math.round(player.elo_history.reduce((s, [, v]) => s + v, 0) / player.elo_history.length)
    : Math.round(player.current_elo)

  const careerRange = (() => {
    const h = player.elo_history || []
    if (!h.length) return null
    const y1 = h[0][0].slice(0, 4), y2 = h[h.length - 1][0].slice(0, 4)
    return y1 === y2 ? y1 : `${y1}–${y2}`
  })()

  const badgeCats = [
    { key: 'fpr',       label: 'FPR Rank' },
    { key: 'elo',       label: 'Elo' },
    { key: 'longevity', label: 'Longevity' },
    { key: 'era',       label: 'Era' },
  ]

  return (
    <div
      ref={backdropRef}
      onClick={e => e.target === backdropRef.current && onClose()}
      role="dialog" aria-modal="true" aria-label={`${player.name} profile`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 24,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, border: '0.5px solid #e0ddd6',
        width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
      }}>
        {/* Dark header */}
        <div style={{ background: '#1a2e1a', padding: '24px 24px 0', position: 'relative' }}>
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 6,
              color: '#7aaa7a', width: 28, height: 28, cursor: 'pointer',
              fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Close"
          >✕</button>

          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 26, color: '#fff', marginBottom: 4 }}>
            {player.name}
          </div>
          <div style={{ fontSize: 12, color: '#7aaa7a', display: 'flex', gap: 10, marginBottom: 20 }}>
            <span>{player.team}</span>
            {careerRange && <><span style={{ opacity: 0.4 }}>·</span><span>{careerRange}</span></>}
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{player.games_played.toLocaleString()} games</span>
            {player.last_played && <><span style={{ opacity: 0.4 }}>·</span><span>Last played {player.last_played.slice(5)}</span></>}
          </div>

          {/* Stat strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderTop: '0.5px solid rgba(255,255,255,0.1)', borderLeft: '0.5px solid rgba(255,255,255,0.1)' }}>
            {[
              { label: 'Current Elo', val: Math.round(player.current_elo).toLocaleString(), color: '#fff' },
              { label: 'Peak Elo',    val: Math.round(player.peak_elo).toLocaleString(),    color: '#ffd700' },
              { label: 'FPR Rank',    val: player.is_fpr_eligible ? `#${player.fpr_rank}` : `#${player.current_tpr_rank}`,                   color: player.is_fpr_eligible ? '#fff' : '#7aaa7a' },
              { label: 'Avg Elo',     val: avgElo.toLocaleString(),                          color: '#a8c5a8' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ padding: '14px 16px', borderRight: '0.5px solid rgba(255,255,255,0.1)', borderBottom: '0.5px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#7aaa7a', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 500, color, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>

          {/* Spaghetti chart */}
          <div style={{ marginBottom: 20 }}>
            <SpagChart playerIndex={playerIndex} playerName={player.name} eloHist={player.elo_history} />
          </div>

          {/* Badges */}
          {player.badges && player.badges.length > 0 && (
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 12 }}>Badges</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {badgeCats.map(({ key, label }) => {
                  const catBadges = player.badges.filter(b => b.cat === key)
                  if (!catBadges.length) return null
                  return (
                    <div key={key}>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, color: '#bbb', marginBottom: 6 }}>{label}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {catBadges.map(b => <Badge key={b.id} b={b} />)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
