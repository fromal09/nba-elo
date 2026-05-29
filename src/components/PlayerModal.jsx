import { useEffect, useRef, useCallback, useState } from 'react'
import styles from './PlayerModal.module.css'

function gmscColor(v) {
  if (v >= 25) return '#22c997'
  if (v >= 18) return '#5aadff'
  if (v >= 12) return '#d4960a'
  if (v >= 6)  return '#8b92a8'
  return '#c94040'
}

function StripItem({ label, value, sub, gold, blue }) {
  return (
    <div className={styles.stripItem}>
      <div className={styles.stripLabel}>{label}</div>
      <div className={`${styles.stripVal}${gold ? ' '+styles.gold : blue ? ' '+styles.blue : ''}`}>{value}</div>
      {sub && <div className={styles.stripSub}>{sub}</div>}
    </div>
  )
}

// Module-level cache — fetched once, reused across all modal opens
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

function SpaghettiChart({ playerIndex, playerName }) {
  const svgRef = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [tooltip, setTooltip] = useState(null)

  useEffect(() => {
    let cancelled = false
    getSpagData().then(data => {
      if (cancelled || !svgRef.current) return
      drawChart(data, playerIndex, svgRef.current, setTooltip)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [playerIndex])

  return (
    <div className={styles.chartOuter}>
      {!loaded && <div className={styles.chartLoading}>Loading all players…</div>}
      <svg
        ref={svgRef}
        className={styles.spagSvg}
        aria-label={`Elo rating history for ${playerName} vs all players`}
        role="img"
      />
      {tooltip && (
        <div
          className={styles.svgTooltip}
          style={{ left: tooltip.x + 12, top: tooltip.y - 28 }}
        >
          <span className={styles.ttDate}>{tooltip.date}</span>
          <span className={styles.ttVal}>{Math.round(tooltip.elo)}</span>
        </div>
      )}
    </div>
  )
}

function drawChart(data, focusIdx, svg, setTooltip) {
  const { dates, players } = data
  const W = svg.parentElement.clientWidth || 620
  const H = 280
  const PAD = { top: 12, right: 16, bottom: 28, left: 44 }
  const CW = W - PAD.left - PAD.right
  const CH = H - PAD.top - PAD.bottom

  // Compute global elo min/max
  let eloMin = Infinity, eloMax = -Infinity
  players.forEach(p => p.forEach(([, v]) => {
    if (v < eloMin) eloMin = v
    if (v > eloMax) eloMax = v
  }))
  eloMin = Math.floor(eloMin / 100) * 100
  eloMax = Math.ceil(eloMax / 100) * 100

  const xScale = i => PAD.left + (i / (dates.length - 1)) * CW
  const yScale = v => PAD.top + CH - ((v - eloMin) / (eloMax - eloMin)) * CH

  // Build SVG
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('width', W)
  svg.setAttribute('height', H)
  svg.innerHTML = ''

  const ns = 'http://www.w3.org/2000/svg'

  // Grid lines + Y axis labels
  const yTicks = []
  for (let v = eloMin; v <= eloMax; v += 200) yTicks.push(v)
  yTicks.forEach(v => {
    const y = yScale(v)
    const line = document.createElementNS(ns, 'line')
    line.setAttribute('x1', PAD.left); line.setAttribute('x2', W - PAD.right)
    line.setAttribute('y1', y); line.setAttribute('y2', y)
    line.setAttribute('stroke', 'rgba(0,0,0,0.06)')
    line.setAttribute('stroke-width', '1')
    svg.appendChild(line)

    const txt = document.createElementNS(ns, 'text')
    txt.setAttribute('x', PAD.left - 6)
    txt.setAttribute('y', y + 4)
    txt.setAttribute('text-anchor', 'end')
    txt.setAttribute('font-size', '10')
    txt.setAttribute('fill', '#5a6278')
    txt.setAttribute('font-family', 'IBM Plex Mono, monospace')
    txt.textContent = v
    svg.appendChild(txt)
  })

  // X axis — season dividers every year, labels every 3 years to avoid collision
  let lastYear = null
  let seasonCount = 0
  dates.forEach((d, i) => {
    const yr = parseInt(d.slice(0, 4), 10)
    const mo = parseInt(d.slice(5, 7), 10)
    if (mo === 10 && yr !== lastYear) {
      lastYear = yr
      seasonCount++
      const x = xScale(i)
      // Divider every season
      const divider = document.createElementNS(ns, 'line')
      divider.setAttribute('x1', x); divider.setAttribute('x2', x)
      divider.setAttribute('y1', PAD.top); divider.setAttribute('y2', PAD.top + CH)
      divider.setAttribute('stroke', 'rgba(0,0,0,0.05)')
      divider.setAttribute('stroke-width', '1')
      divider.setAttribute('stroke-dasharray', '2 4')
      svg.appendChild(divider)
      // Label every 3 seasons only
      if (seasonCount % 3 === 1) {
        const txt = document.createElementNS(ns, 'text')
        txt.setAttribute('x', x + 3)
        txt.setAttribute('y', H - 6)
        txt.setAttribute('text-anchor', 'start')
        txt.setAttribute('font-size', '9')
        txt.setAttribute('fill', '#8a9885')
        txt.setAttribute('font-family', 'IBM Plex Mono, monospace')
        txt.textContent = "'" + String(yr).slice(2)
        svg.appendChild(txt)
      }
    }
  })

  // Draw background players
  const bgGroup = document.createElementNS(ns, 'g')
  players.forEach((pts, idx) => {
    if (idx === focusIdx || pts.length < 2) return
    const d = pts.map(([i, v], k) =>
      `${k === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`
    ).join(' ')
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', d)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'rgba(150,175,210,0.14)')
    path.setAttribute('stroke-width', '1')
    path.setAttribute('stroke-linecap', 'round')
    bgGroup.appendChild(path)
  })
  svg.appendChild(bgGroup)

  // Draw focus player
  const focusPts = players[focusIdx]
  if (focusPts && focusPts.length >= 2) {
    const d = focusPts.map(([i, v], k) =>
      `${k === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`
    ).join(' ')
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', d)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#1a9e6e')
    path.setAttribute('stroke-width', '2.5')
    path.setAttribute('stroke-linecap', 'round')
    svg.appendChild(path)

    // Invisible hover overlay for tooltip
    focusPts.forEach(([i, v]) => {
      const circle = document.createElementNS(ns, 'circle')
      const cx = xScale(i), cy = yScale(v)
      circle.setAttribute('cx', cx)
      circle.setAttribute('cy', cy)
      circle.setAttribute('r', '6')
      circle.setAttribute('fill', 'transparent')
      circle.setAttribute('style', 'cursor:crosshair')
      circle.addEventListener('mouseenter', e => {
        setTooltip({ x: cx, y: cy, date: dates[i], elo: v })
      })
      circle.addEventListener('mouseleave', () => setTooltip(null))
      svg.appendChild(circle)
    })

    // End dot
    const last = focusPts[focusPts.length - 1]
    const dot = document.createElementNS(ns, 'circle')
    dot.setAttribute('cx', xScale(last[0]))
    dot.setAttribute('cy', yScale(last[1]))
    dot.setAttribute('r', '4')
    dot.setAttribute('fill', '#1a9e6e')
    svg.appendChild(dot)
  }
}

export default function PlayerModal({ player, allPlayers, onClose }) {
  const backdropRef = useRef(null)

  const handleKey = useCallback(e => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [handleKey])

  // Find this player's index in the global sorted order (matches spaghetti.json order)
  const playerIndex = allPlayers.findIndex(p => p.name === player.name)

  // GmSc bar data
  const gmscData = player.gmsc_history.slice(-30).map(([date, val]) => ({
    date: date.slice(5),
    val,
    color: gmscColor(val)
  }))

  const maxGmsc = Math.max(...gmscData.map(g => Math.abs(g.val)), 1)

  return (
    <div
      className={styles.backdrop}
      ref={backdropRef}
      onClick={e => e.target === backdropRef.current && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`${player.name} player profile`}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <div className={styles.playerName}>{player.name}</div>
            <div className={styles.playerMeta}>
              {player.team} · TPR #{player.current_tpr_rank} · {player.games_played} games
              {player.last_played && <span className={styles.lastPlayed}> · last played {player.last_played}</span>}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          <div className={styles.statStrip}>
            <StripItem label="Current Elo"  value={player.current_elo.toFixed(0)} blue />
            <StripItem label="Peak Elo"     value={player.peak_elo.toFixed(0)} gold />
            <StripItem label="TPR Rank"     value={`#${player.current_tpr_rank}`} />
            <StripItem label="Games Played" value={player.games_played} />
            <StripItem label="Recent GmSc"  value={player.recent_gmsc_avg.toFixed(1)} sub="last 10 games" />
            <StripItem label="Career GmSc"  value={player.career_gmsc_avg.toFixed(1)} sub="season avg" />
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Elo Rating Over Time</div>
            <div className={styles.sectionSub}>All {allPlayers.length} players in gray · {player.name} in blue</div>
            <div className={styles.chartWrap}>
              <SpaghettiChart playerIndex={playerIndex} playerName={player.name} />
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Recent Game Scores</div>
            <div className={styles.sectionSub}>Last 30 games · colored by performance tier</div>
            <div className={styles.gmscBars}>
              {gmscData.map((g, i) => (
                <div key={i} className={styles.gmscBarWrap} title={`${g.date}: ${g.val}`}>
                  <div
                    className={styles.gmscBar}
                    style={{
                      height: Math.max(2, Math.round((Math.abs(g.val) / maxGmsc) * 76)),
                      background: g.color,
                      opacity: g.val < 0 ? 0.35 : 0.75,
                      alignSelf: g.val >= 0 ? 'flex-end' : 'flex-start',
                    }}
                  />
                </div>
              ))}
            </div>
            <div className={styles.gmscLegend}>
              {[['25+','#22c997'],['18+','#5aadff'],['12+','#d4960a'],['6+','#8b92a8'],['<6','#c94040']].map(([label, color]) => (
                <span key={label} className={styles.legendItem}>
                  <span className={styles.legendDot} style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
