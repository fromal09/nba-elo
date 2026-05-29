import { useEffect, useRef, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'
import styles from './PlayerModal.module.css'

function gmscColor(v) {
  if (v >= 25) return '#22c997'
  if (v >= 18) return '#5aadff'
  if (v >= 12) return '#d4960a'
  if (v >= 6)  return '#8b92a8'
  return '#c94040'
}

function StatCard({ label, value, sub, highlight }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={`${styles.statVal} ${highlight ? styles.highlight : ''}`}>{value}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  )
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

  // Build spaghetti data: all top-N players' elo histories
  // Merge all dates into unified x-axis
  const TOP_N = 60
  const topPlayers = allPlayers.slice(0, TOP_N)

  // Collect all unique dates
  const allDates = [...new Set(
    topPlayers.flatMap(p => p.elo_history.map(h => h[0]))
  )].sort()

  // Build per-player lookup maps
  const playerMaps = topPlayers.map(p => {
    const map = {}
    p.elo_history.forEach(([d, v]) => { map[d] = v })
    return { name: p.name, map, isFocus: p.name === player.name }
  })

  // Build unified chart data
  const chartData = allDates.map(date => {
    const pt = { date }
    playerMaps.forEach(({ name, map }) => {
      pt[name] = map[date] ?? null
    })
    return pt
  })

  // GmSc bar chart data
  const gmscData = player.gmsc_history.slice(-30).map(([date, val]) => ({
    date: date.slice(5), // MM-DD
    val,
    fill: gmscColor(val)
  }))

  const eloMin = Math.floor(Math.min(...topPlayers.flatMap(p => p.elo_history.map(h => h[1]))) / 100) * 100
  const eloMax = Math.ceil(Math.max(...topPlayers.flatMap(p => p.elo_history.map(h => h[1]))) / 100) * 100

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
        {/* Header */}
        <div className={styles.header}>
          <div>
            <div className={styles.playerName}>{player.name}</div>
            <div className={styles.playerMeta}>
              {player.team} · TPR #{player.current_tpr_rank} · {player.games_played} games
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          {/* Stat cards */}
          <div className={styles.statsGrid}>
            <StatCard label="Current Elo" value={player.current_elo.toFixed(0)} />
            <StatCard label="Peak Elo" value={player.peak_elo.toFixed(0)} highlight />
            <StatCard label="TPR Rank" value={`#${player.current_tpr_rank}`} />
            <StatCard label="Games Played" value={player.games_played} />
            <StatCard label="Recent GmSc" value={player.recent_gmsc_avg.toFixed(1)} sub="last 10 games" />
            <StatCard label="Career GmSc" value={player.career_gmsc_avg.toFixed(1)} sub="season avg" />
          </div>

          {/* Spaghetti chart */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Elo Rating Over Time</div>
            <div className={styles.sectionSub}>Top 60 players in gray · {player.name} highlighted in blue</div>
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    tickFormatter={d => {
                      const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                      const m = parseInt(d.slice(5,7), 10) - 1
                      return mo[m] || d
                    }}
                    interval={Math.floor(allDates.length / 6)}
                  />
                  <YAxis
                    domain={[eloMin, eloMax]}
                    tick={{ fill: 'var(--text3)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <ReferenceLine y={1500} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload) return null
                      const focusPt = payload.find(p => p.dataKey === player.name)
                      if (!focusPt) return null
                      return (
                        <div className={styles.tooltip}>
                          <div className={styles.ttDate}>{label}</div>
                          <div className={styles.ttVal}>{Math.round(focusPt.value)}</div>
                        </div>
                      )
                    }}
                  />
                  {/* Background lines */}
                  {playerMaps
                    .filter(p => !p.isFocus)
                    .map(p => (
                      <Line
                        key={p.name}
                        type="monotone"
                        dataKey={p.name}
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth={1}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  {/* Focus line */}
                  <Line
                    key={player.name}
                    type="monotone"
                    dataKey={player.name}
                    stroke="#5aadff"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* GmSc recent bar chart */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Recent Game Scores</div>
            <div className={styles.sectionSub}>Last 30 games · colored by performance tier</div>
            <div className={styles.gmscBars}>
              {gmscData.map((g, i) => (
                <div key={i} className={styles.gmscBarWrap} title={`${g.date}: ${g.val}`}>
                  <div
                    className={styles.gmscBar}
                    style={{
                      height: Math.max(2, Math.round(Math.abs(g.val) / 30 * 80)),
                      background: g.fill,
                      opacity: g.val < 0 ? 0.4 : 0.75,
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
