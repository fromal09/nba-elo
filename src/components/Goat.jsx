import { useState, useMemo } from 'react'

const DIMENSIONS = [
  { key: 'peak_elo',  label: 'Peak Elo',    desc: 'Highest single Elo rating ever achieved' },
  { key: 'avg_elo',   label: 'Average Elo', desc: 'Career average Elo across all games' },
  { key: 'longevity', label: 'Longevity',   desc: 'Total games played' },
]

const PRESETS = [
  { label: 'Balanced',         weights: { peak_elo: 40, avg_elo: 40, longevity: 20 } },
  { label: 'Peak Performer',   weights: { peak_elo: 70, avg_elo: 25, longevity:  5 } },
  { label: 'Career Dominance', weights: { peak_elo: 20, avg_elo: 60, longevity: 20 } },
  { label: 'Ironman',          weights: { peak_elo: 15, avg_elo: 35, longevity: 50 } },
  { label: 'Pure Peak',        weights: { peak_elo:100, avg_elo:  0, longevity:  0 } },
]

const PRESET_HINTS = ['40/40/20', '70/25/5', '20/60/20', '15/35/50', '100/0/0']

function normalize(vals) {
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  if (max === min) return vals.map(() => 0)
  return vals.map(v => (v - min) / (max - min))
}

export default function Goat({ players, onSelectPlayer }) {
  const [weights,      setWeights]      = useState(PRESETS[0].weights)
  const [activePreset, setActivePreset] = useState(0)
  const [page,         setPage]         = useState(0)
  const PER_PAGE = 25
  const minGP    = 200

  const eligible = useMemo(() =>
    players.filter(p => p.games_played >= minGP), [players]
  )

  const normalized = useMemo(() => {
    const peakElos = eligible.map(p => p.peak_elo)
    const avgElos  = eligible.map(p => {
      const h = p.elo_history || []
      return h.length ? h.reduce((s, [, v]) => s + v, 0) / h.length : p.current_elo
    })
    const gps = eligible.map(p => p.games_played)
    return {
      peak_elo:  normalize(peakElos),
      avg_elo:   normalize(avgElos),
      longevity: normalize(gps),
    }
  }, [eligible])

  const avgEloMap = useMemo(() => {
    const map = {}
    eligible.forEach(p => {
      const h = p.elo_history || []
      map[p.name] = h.length
        ? Math.round(h.reduce((s, [, v]) => s + v, 0) / h.length)
        : Math.round(p.current_elo)
    })
    return map
  }, [eligible])

  const ranked = useMemo(() => {
    const total = Object.values(weights).reduce((s, v) => s + v, 0) || 1
    return eligible
      .map((p, i) => {
        const score = DIMENSIONS.reduce((s, dim) =>
          s + (weights[dim.key] / total) * (normalized[dim.key][i] || 0), 0
        )
        return { ...p, goat_score: score * 100 }
      })
      .sort((a, b) => b.goat_score - a.goat_score)
  }, [eligible, weights, normalized])

  const slice      = ranked.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const totalPages = Math.ceil(ranked.length / PER_PAGE)
  const totalW     = Object.values(weights).reduce((s, v) => s + v, 0)

  function setPreset(i) { setActivePreset(i); setWeights(PRESETS[i].weights); setPage(0) }
  function updateWeight(key, val) { setActivePreset(-1); setWeights(w => ({ ...w, [key]: val })) }

  const s = {
    wrap:       { display: 'flex', flex: 1, overflow: 'hidden', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
    sidebar:    { width: 260, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e0ddd6', display: 'flex', flexDirection: 'column' },
    main:       { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    sideHead:   { padding: '24px 20px 16px', borderBottom: '0.5px solid #e0ddd6' },
    sideTitle:  { fontFamily: "'DM Serif Display', serif", fontSize: 18, color: '#1a1a1a', marginBottom: 4 },
    sideDesc:   { fontSize: 12, color: '#888', lineHeight: 1.6 },
    presets:    { padding: '16px 20px', borderBottom: '0.5px solid #f0ede8' },
    presetsLbl: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 10 },
    presetGrid: { display: 'flex', flexDirection: 'column', gap: 5 },
    presetBtn:  (active) => ({
      background: active ? '#1a2e1a' : '#f5f3ee',
      border: `0.5px solid ${active ? '#1a2e1a' : '#e0ddd6'}`,
      borderRadius: 7, padding: '8px 12px',
      fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500,
      color: active ? '#fff' : '#555',
      cursor: 'pointer', textAlign: 'left',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }),
    sliders:    { padding: '16px 20px', flex: 1 },
    slidersLbl: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 16 },
    sliderRow:  { marginBottom: 22 },
    sliderTop:  { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
    sliderLabel:{ fontSize: 13, fontWeight: 500, color: '#333' },
    sliderDesc: { fontSize: 11, color: '#aaa', marginBottom: 8 },
    sliderVal:  { fontSize: 13, fontWeight: 600, color: '#1a2e1a' },
    totalRow:   { padding: '12px 20px', borderTop: '0.5px solid #e0ddd6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    totalLabel: { fontSize: 11, color: '#aaa' },
    totalVal:   (ok) => ({ fontSize: 13, fontWeight: 600, color: ok ? '#2d8a5a' : '#c94040' }),
    pageHeader: { padding: '24px 32px 16px' },
    pageTitle:  { fontFamily: "'DM Serif Display', serif", fontSize: 28, color: '#1a1a1a', marginBottom: 4 },
    pageDesc:   { fontSize: 13, color: '#888' },
    tableWrap:  { flex: 1, overflow: 'auto', background: '#fff', borderTop: '0.5px solid #e0ddd6' },
    table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    thead:      { position: 'sticky', top: 0, zIndex: 10, background: '#faf9f6', borderBottom: '0.5px solid #e0ddd6' },
    th:         { padding: '10px 14px', fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600, color: '#aaa', textAlign: 'left', whiteSpace: 'nowrap', letterSpacing: '0.8px', textTransform: 'uppercase' },
    thR:        { textAlign: 'right' },
    row:        { borderBottom: '0.5px solid #f0ede8', cursor: 'pointer' },
    td:         { padding: '9px 14px' },
    paging:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 32px', borderTop: '0.5px solid #e0ddd6', background: '#faf9f6', flexShrink: 0 },
    pagingInfo: { fontSize: 12, color: '#aaa' },
    pagingBtns: { display: 'flex', alignItems: 'center', gap: 4 },
    pageBtn:    { background: '#fff', border: '0.5px solid #e0ddd6', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#666', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" },
    pageNum:    { fontSize: 12, color: '#aaa', padding: '0 8px', minWidth: 60, textAlign: 'center' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.sidebar}>
        <div style={s.sideHead}>
          <div style={s.sideTitle}>GOAT Rankings</div>
          <div style={s.sideDesc}>Set the weight of each dimension. Rankings update instantly.</div>
        </div>

        <div style={s.presets}>
          <div style={s.presetsLbl}>Presets</div>
          <div style={s.presetGrid}>
            {PRESETS.map((p, i) => (
              <button key={p.label} style={s.presetBtn(activePreset === i)} onClick={() => setPreset(i)}>
                <span>{p.label}</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>{PRESET_HINTS[i]}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={s.sliders}>
          <div style={s.slidersLbl}>Weights</div>
          {DIMENSIONS.map(dim => (
            <div key={dim.key} style={s.sliderRow}>
              <div style={s.sliderTop}>
                <span style={s.sliderLabel}>{dim.label}</span>
                <span style={s.sliderVal}>{weights[dim.key]}</span>
              </div>
              <div style={s.sliderDesc}>{dim.desc}</div>
              <input
                type="range" min={0} max={100} step={5}
                value={weights[dim.key]}
                onChange={e => updateWeight(dim.key, Number(e.target.value))}
                style={{ width: '100%', accentColor: '#1a2e1a' }}
              />
            </div>
          ))}
        </div>

        <div style={s.totalRow}>
          <span style={s.totalLabel}>Total weight</span>
          <span style={s.totalVal(totalW > 0)}>{totalW}</span>
        </div>
      </div>

      <div style={s.main}>
        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>{activePreset >= 0 ? PRESETS[activePreset].label : 'Custom'}</h1>
          <p style={s.pageDesc}>Min 200 GP · {eligible.length.toLocaleString()} players · composite score 0–100</p>
        </div>

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead style={s.thead}>
              <tr>
                <th style={{ ...s.th, ...s.thR, width: 52 }}>#</th>
                <th style={s.th}>Player</th>
                <th style={s.th}>Team</th>
                <th style={{ ...s.th, ...s.thR }}>Score</th>
                <th style={{ ...s.th, ...s.thR }}>Peak Elo</th>
                <th style={{ ...s.th, ...s.thR }}>Avg Elo</th>
                <th style={{ ...s.th, ...s.thR }}>GP</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((p, i) => {
                const rank     = page * PER_PAGE + i + 1
                const score    = p.goat_score
                const barColor = rank === 1 ? '#c9920a' : rank <= 5 ? '#2d8a5a' : rank <= 25 ? '#1a5fa8' : '#bbb'

                return (
                  <tr
                    key={p.name}
                    style={s.row}
                    onClick={() => onSelectPlayer(p)}
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && onSelectPlayer(p)}
                    role="button"
                    onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>{rank}</td>
                    <td style={{ ...s.td, fontWeight: 500, color: '#1a1a1a', whiteSpace: 'nowrap' }}>{p.name}</td>
                    <td style={{ ...s.td, fontSize: 11, color: '#aaa' }}>{p.team}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <div style={{ height: 3, borderRadius: 2, background: barColor, opacity: 0.35, width: Math.round(score * 1.2), flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: barColor, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {score.toFixed(1)}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#c9920a', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(p.peak_elo).toLocaleString()}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>
                      {(avgEloMap[p.name] || 0).toLocaleString()}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right', fontSize: 13, color: '#555', fontVariantNumeric: 'tabular-nums' }}>
                      {p.games_played.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={s.paging}>
          <span style={s.pagingInfo}>
            Showing {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, ranked.length)} of {ranked.length.toLocaleString()}
          </span>
          <div style={s.pagingBtns}>
            <button style={s.pageBtn} onClick={() => setPage(0)} disabled={page === 0}>««</button>
            <button style={s.pageBtn} onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹ Prev</button>
            <span style={s.pageNum}>{page + 1} / {totalPages}</span>
            <button style={s.pageBtn} onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next ›</button>
            <button style={s.pageBtn} onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»»</button>
          </div>
        </div>
      </div>
    </div>
  )
}
