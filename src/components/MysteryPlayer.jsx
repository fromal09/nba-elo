import { useState, useMemo, useRef, useEffect } from 'react'

const TEAM_COLORS = {
  ATL:'#C8102E',BOS:'#007A33',BKN:'#000000',CHA:'#00788C',CHO:'#00788C',
  CHI:'#CE1141',CLE:'#860038',DAL:'#00538C',DEN:'#0E2240',DET:'#C8102E',
  GSW:'#1D428A',HOU:'#CE1141',IND:'#002D62',LAC:'#C8102E',LAL:'#552583',
  MEM:'#5D76A9',MIA:'#98002E',MIL:'#00471B',MIN:'#0C2340',NOP:'#0C2340',
  NOH:'#0C2340',NYK:'#006BB6',OKC:'#007AC1',ORL:'#0077C0',PHI:'#006BB6',
  PHO:'#1D1160',POR:'#E03A3E',SAC:'#5A2D81',SAS:'#000000',SEA:'#00653A',
  TOR:'#CE1141',UTA:'#002B5C',WAS:'#002B5C',MNL:'#552583',FTW:'#C8102E',
  SYR:'#006BB6',ROC:'#5A2D81',NOJ:'#002B5C',CHH:'#00788C',NOK:'#0C2340',
}

const FRANCHISE_ALIASES = {
  ATL:['ATL','STL','TRI','BOM'],BOS:['BOS'],BKN:['BKN','BRK','NJN','NJA'],
  CHA:['CHA','CHO'],CHI:['CHI'],CLE:['CLE'],DAL:['DAL'],DEN:['DEN','DNR'],
  DET:['DET','FTW'],GSW:['GSW','SFW','PHW'],HOU:['HOU','SDR'],IND:['IND'],
  LAC:['LAC','SDC','BUF'],LAL:['LAL','MNL'],MEM:['MEM','VAN'],MIA:['MIA'],
  MIL:['MIL'],MIN:['MIN'],NOP:['NOP','NOH','NOK'],NYK:['NYK'],OKC:['OKC','SEA'],
  ORL:['ORL'],PHI:['PHI','SYR'],PHO:['PHO'],POR:['POR'],SAC:['SAC','KCK','CIN','ROC'],
  SAS:['SAS','SAA'],TOR:['TOR'],UTA:['UTA','NOJ'],WAS:['WAS','WSB','BAL','CAP'],
}

const FRANCHISE_NAMES = {
  ATL:'Atlanta',BOS:'Boston',BKN:'Brooklyn',CHA:'Charlotte',CHI:'Chicago',
  CLE:'Cleveland',DAL:'Dallas',DEN:'Denver',DET:'Detroit',GSW:'Golden State',
  HOU:'Houston',IND:'Indiana',LAC:'LA Clippers',LAL:'LA Lakers',MEM:'Memphis',
  MIA:'Miami',MIL:'Milwaukee',MIN:'Minnesota',NOP:'New Orleans',NYK:'New York',
  OKC:'Oklahoma City',ORL:'Orlando',PHI:'Philadelphia',PHO:'Phoenix',
  POR:'Portland',SAC:'Sacramento',SAS:'San Antonio',TOR:'Toronto',UTA:'Utah',WAS:'Washington',
}

const ERAS = [
  { id:'early', label:'Early NBA', desc:'Pre-1974', test: e => e[0] < '1974-01-01' },
  { id:'aba',   label:'ABA Era',   desc:'1967–76',  test: e => e[0] >= '1967-01-01' && e[0] < '1977-01-01' },
  { id:'modern',label:'Modern',    desc:'1974+',    test: e => e[0] >= '1974-01-01' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function playerEra(hist) {
  // Returns the dominant era of a player's career
  const early  = hist.filter(e => e[0] < '1974-01-01').length
  const modern = hist.filter(e => e[0] >= '1974-01-01').length
  const aba    = hist.filter(e => e[0] >= '1967-01-01' && e[0] < '1977-01-01').length
  if (early > modern && early > aba) return 'early'
  if (aba > early && aba > modern)   return 'aba'
  return 'modern'
}

function playerTeams(hist) {
  return new Set(hist.map(e => e[4] || '').filter(Boolean))
}

function gradeEra(guess, mystery) {
  if (!guess) return { grade:'F', desc:'No guess made' }
  const mHist = mystery.elo_history || []
  const gHist = guess.elo_history   || []
  const mEra  = playerEra(mHist)
  const gEra  = playerEra(gHist)

  // Start and end years
  const mStart = parseInt(mHist[0]?.[0]?.slice(0,4) || 2000)
  const mEnd   = parseInt(mHist[mHist.length-1]?.[0]?.slice(0,4) || 2000)
  const gStart = parseInt(gHist[0]?.[0]?.slice(0,4) || 2000)
  const gEnd   = parseInt(gHist[gHist.length-1]?.[0]?.slice(0,4) || 2000)

  if (mEra !== gEra) return { grade:'F', desc:`Wrong era entirely — mystery player is ${mEra === 'early' ? 'pre-1974' : mEra === 'aba' ? 'ABA era' : 'modern era'}` }
  const overlap = Math.max(0, Math.min(mEnd, gEnd) - Math.max(mStart, gStart))
  const span    = Math.max(mEnd - mStart, 1)
  const pct     = overlap / span
  if (pct > 0.7) return { grade:'A', desc:`Great era match — careers overlapped ${overlap} years` }
  if (pct > 0.4) return { grade:'B', desc:`Good era match — careers overlapped ${overlap} years` }
  if (pct > 0.15) return { grade:'C', desc:`Partial era match — careers overlapped ${overlap} years` }
  return { grade:'D', desc:`Same era but careers barely overlapped` }
}

function gradeTeam(guess, mystery) {
  if (!guess) return { pass: false, desc: 'No guess made' }
  const mTeams = playerTeams(mystery.elo_history || [])
  const gTeams = playerTeams(guess.elo_history   || [])
  const overlap = [...mTeams].filter(t => gTeams.has(t))
  if (overlap.length > 0) return { pass: true,  desc: `Shared franchise: ${overlap.join(', ')}` }
  // Check franchise aliases
  for (const [, aliases] of Object.entries(FRANCHISE_ALIASES)) {
    const mHas = [...mTeams].some(t => aliases.includes(t))
    const gHas = [...gTeams].some(t => aliases.includes(t))
    if (mHas && gHas) return { pass: true, desc: 'Shared franchise (different eras)' }
  }
  return { pass: false, desc: 'No franchise overlap' }
}

function gradeQuality(guess, mystery) {
  if (!guess) return null
  const mHist = mystery.elo_history || []
  const gHist = guess.elo_history   || []

  const mAvg  = Math.round(mHist.reduce((s,e) => s+e[1], 0) / (mHist.length||1))
  const gAvg  = Math.round(gHist.reduce((s,e) => s+e[1], 0) / (gHist.length||1))
  const mPeak = Math.round(Math.max(...mHist.map(e=>e[1])))
  const gPeak = Math.round(Math.max(...gHist.map(e=>e[1])))
  const mGP   = mHist.length
  const gGP   = gHist.length

  const avgDiff  = Math.abs(mAvg  - gAvg)
  const peakDiff = Math.abs(mPeak - gPeak)
  const gpRatio  = Math.min(mGP, gGP) / Math.max(mGP, gGP)

  const avgGrade  = avgDiff  < 50  ? 'A' : avgDiff  < 150 ? 'B' : avgDiff  < 300 ? 'C' : 'D'
  const peakGrade = peakDiff < 50  ? 'A' : peakDiff < 150 ? 'B' : peakDiff < 300 ? 'C' : 'D'
  const gpGrade   = gpRatio  > 0.8 ? 'A' : gpRatio  > 0.6 ? 'B' : gpRatio  > 0.4 ? 'C' : 'D'

  return {
    avg:  { val: gAvg,  mystery: mAvg,  diff: gAvg  - mAvg,  grade: avgGrade },
    peak: { val: gPeak, mystery: mPeak, diff: gPeak - mPeak, grade: peakGrade },
    gp:   { val: gGP,   mystery: mGP,   diff: gGP   - mGP,   grade: gpGrade },
  }
}

const GRADE_COLOR = { A:'#2d8a5a', B:'#5a8a2d', C:'#c9920a', D:'#c94040', F:'#c94040' }

function GradePill({ grade, label }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      background: GRADE_COLOR[grade] + '18',
      border: `0.5px solid ${GRADE_COLOR[grade]}40`,
      borderRadius:6, padding:'3px 10px', fontSize:12,
    }}>
      <span style={{ fontWeight:700, color: GRADE_COLOR[grade] }}>{grade}</span>
      <span style={{ color:'#555' }}>{label}</span>
    </span>
  )
}

function PassPill({ pass, label }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      background: pass ? '#2d8a5a18' : '#c9404018',
      border: `0.5px solid ${pass ? '#2d8a5a40' : '#c9404040'}`,
      borderRadius:6, padding:'3px 10px', fontSize:12,
    }}>
      <span style={{ fontWeight:700, color: pass ? '#2d8a5a' : '#c94040' }}>{pass ? 'PASS' : 'FAIL'}</span>
      <span style={{ color:'#555' }}>{label}</span>
    </span>
  )
}

function DiffArrow({ diff }) {
  if (diff === 0) return <span style={{ color:'#2d8a5a' }}>exact</span>
  const sign = diff > 0 ? '▲' : '▼'
  const color = '#555'
  return <span style={{ color }}>{sign}{Math.abs(diff).toLocaleString()}</span>
}

// ── Transition Screen ─────────────────────────────────────────────────────────

function RoundTransition({ guess, mystery, round, onContinue }) {
  const eraGrade   = gradeEra(guess, mystery)
  const teamGrade  = gradeTeam(guess, mystery)
  const qualGrade  = gradeQuality(guess, mystery)
  const gName      = guess?.name || 'No guess'

  return (
    <div style={{
      display:'flex', flex:1, flexDirection:'column', alignItems:'center',
      justifyContent:'center', padding:'32px 24px', gap:20,
      background:'#f5f3ee', fontFamily:"'DM Sans', sans-serif",
    }}>
      <div style={{ textAlign:'center', marginBottom:4 }}>
        <div style={{ fontSize:28, marginBottom:6 }}>❌</div>
        <div style={{ fontFamily:"'DM Serif Display', serif", fontSize:22, color:'#1a1a1a', marginBottom:4 }}>
          Not quite — that was {gName}
        </div>
        <div style={{ fontSize:13, color:'#aaa' }}>Round {round} complete · Here's how close you were</div>
      </div>

      <div style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:12 }}>

        {/* Era */}
        <div style={{ background:'#fff', borderRadius:12, padding:'16px 20px', border:'0.5px solid #e0ddd6' }}>
          <div style={{ fontSize:11, textTransform:'uppercase', letterSpacing:1, color:'#bbb', marginBottom:10 }}>Era Match</div>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <GradePill grade={eraGrade.grade} label="Era" />
            <span style={{ fontSize:13, color:'#555' }}>{eraGrade.desc}</span>
          </div>
        </div>

        {/* Team */}
        <div style={{ background:'#fff', borderRadius:12, padding:'16px 20px', border:'0.5px solid #e0ddd6' }}>
          <div style={{ fontSize:11, textTransform:'uppercase', letterSpacing:1, color:'#bbb', marginBottom:10 }}>Franchise Match</div>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <PassPill pass={teamGrade.pass} label="Team" />
            <span style={{ fontSize:13, color:'#555' }}>{teamGrade.desc}</span>
          </div>
        </div>

        {/* Quality */}
        {qualGrade && (
          <div style={{ background:'#fff', borderRadius:12, padding:'16px 20px', border:'0.5px solid #e0ddd6' }}>
            <div style={{ fontSize:11, textTransform:'uppercase', letterSpacing:1, color:'#bbb', marginBottom:12 }}>Player Quality Match</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
              {[
                { label:'Avg Elo', q:qualGrade.avg },
                { label:'Peak Elo', q:qualGrade.peak },
                { label:'Career GP', q:qualGrade.gp },
              ].map(({ label, q }) => (
                <div key={label} style={{ textAlign:'center' }}>
                  <GradePill grade={q.grade} label={label} />
                  <div style={{ fontSize:12, color:'#aaa', marginTop:6 }}>
                    Your guess: {q.val.toLocaleString()}
                  </div>
                  <div style={{ fontSize:12, color:'#888' }}>
                    <DiffArrow diff={q.diff} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onContinue}
        style={{
          background:'#1a2e1a', color:'#fff', border:'none', borderRadius:10,
          padding:'13px 36px', fontSize:15, fontWeight:600, cursor:'pointer',
          fontFamily:"'DM Sans', sans-serif",
        }}
      >
        Round {round + 1} →
      </button>
    </div>
  )
}

// ── Mystery Chart ─────────────────────────────────────────────────────────────

function drawChart(svg, hist, round, W, H) {
  while (svg.firstChild) svg.removeChild(svg.firstChild)
  const ns = 'http://www.w3.org/2000/svg'
  const PAD = { top:16, right:16, bottom: round >= 2 ? 28 : 8, left:44 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const elos = hist.map(e => e[1])
  const minE = Math.min(...elos) - 60
  const maxE = Math.max(...elos) + 60
  const n = hist.length
  const xS = i  => PAD.left + (i / (n - 1)) * plotW
  const yS = v  => PAD.top + plotH - ((v - minE) / (maxE - minE)) * plotH

  // Grid
  for (const v of [1500,1700,1900,2100,2300,2500,2700,2900,3100]) {
    if (v < minE || v > maxE) continue
    const y = yS(v)
    const l = document.createElementNS(ns, 'line')
    l.setAttribute('x1', PAD.left); l.setAttribute('y1', y)
    l.setAttribute('x2', W - PAD.right); l.setAttribute('y2', y)
    l.setAttribute('stroke', 'rgba(0,0,0,0.06)'); l.setAttribute('stroke-width','0.5')
    svg.appendChild(l)
    const t = document.createElementNS(ns, 'text')
    t.setAttribute('x', PAD.left - 4); t.setAttribute('y', y + 4)
    t.setAttribute('font-size','9'); t.setAttribute('fill','rgba(0,0,0,0.25)')
    t.setAttribute('text-anchor','end'); t.setAttribute('font-family','sans-serif')
    t.textContent = v; svg.appendChild(t)
  }

  // X axis years (round 2+)
  if (round >= 2) {
    let lastYr = null
    hist.forEach((e, i) => {
      const yr = e[0].slice(0,4)
      if (yr === lastYr) return
      lastYr = yr
      if (parseInt(yr) % 3 !== 0) return
      const t = document.createElementNS(ns, 'text')
      t.setAttribute('x', xS(i)); t.setAttribute('y', H - 4)
      t.setAttribute('font-size','9'); t.setAttribute('fill','rgba(0,0,0,0.3)')
      t.setAttribute('text-anchor','middle'); t.setAttribute('font-family','sans-serif')
      t.textContent = yr; svg.appendChild(t)
    })
  }

  // Line — team-colored in round 3, single dark color otherwise
  const drawSeg = (pts, startIdx, color) => {
    if (pts.length < 2) return
    const d = pts.map((e, k) => `${k===0?'M':'L'}${xS(startIdx+k).toFixed(1)},${yS(e[1]).toFixed(1)}`).join(' ')
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', d); p.setAttribute('fill','none')
    p.setAttribute('stroke', color); p.setAttribute('stroke-width','2.5')
    p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-linejoin','round')
    svg.appendChild(p)
  }

  if (round >= 3) {
    let seg = [], segStart = 0, curTeam = hist[0]?.[4] || ''
    hist.forEach((e, i) => {
      const team = e[4] || ''
      if (team !== curTeam) {
        seg.push(e); drawSeg(seg, segStart, TEAM_COLORS[curTeam] || '#1a2e1a')
        seg = [e]; segStart = i; curTeam = team
      } else { seg.push(e) }
    })
    drawSeg(seg, segStart, TEAM_COLORS[curTeam] || '#1a2e1a')
  } else {
    drawSeg(hist, 0, '#1a2e1a')
  }

  // End dot
  const last = hist[hist.length - 1]
  const dot = document.createElementNS(ns, 'circle')
  dot.setAttribute('cx', xS(n-1)); dot.setAttribute('cy', yS(last[1]))
  dot.setAttribute('r','4')
  dot.setAttribute('fill', round >= 3 ? (TEAM_COLORS[last[4]||''] || '#1a2e1a') : '#1a2e1a')
  svg.appendChild(dot)
}

function MysteryChart({ player, round, onReady }) {
  const svgRef  = useRef(null)
  const wrapRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)
  const animRef = useRef(null)
  const hist = player?.elo_history || []

  useEffect(() => {
    if (!svgRef.current || !wrapRef.current || !hist.length) return
    const W = wrapRef.current.clientWidth || 640
    const H = 230
    svgRef.current.setAttribute('viewBox', `0 0 ${W} ${H}`)
    setTooltip(null)

    let frame = 0
    const FRAMES = 45

    const animate = () => {
      if (!svgRef.current) return
      if (frame >= FRAMES) {
        drawChart(svgRef.current, hist, round, W, H)
        onReady?.()
        // Add hit targets
        addHitTargets(svgRef.current, hist, round, W, H)
        return
      }
      const t = frame / FRAMES
      const ease = 1 - Math.pow(1 - t, 3)
      const noisy = hist.map(e => [e[0], e[1] + (Math.random() - 0.5) * 150 * (1 - ease), ...e.slice(2)])
      drawChart(svgRef.current, noisy, round, W, H)
      frame++
      animRef.current = requestAnimationFrame(animate)
    }

    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current = requestAnimationFrame(animate)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [player?.name, round])

  const addHitTargets = (svg, hist, round, W, H) => {
    const ns = 'http://www.w3.org/2000/svg'
    const PAD = { top:16, right:16, bottom: round >= 2 ? 28 : 8, left:44 }
    const plotH = H - PAD.top - PAD.bottom
    const n = hist.length
    const xS = i => PAD.left + (i / (n-1)) * (W - PAD.left - PAD.right)
    const elos = hist.map(e => e[1])
    const minE = Math.min(...elos) - 60, maxE = Math.max(...elos) + 60
    const yS = v => PAD.top + plotH - ((v - minE) / (maxE - minE)) * plotH

    hist.forEach((e, i) => {
      if (i % 4 !== 0) return
      const hit = document.createElementNS(ns, 'circle')
      hit.setAttribute('cx', xS(i)); hit.setAttribute('cy', yS(e[1]))
      hit.setAttribute('r','10'); hit.setAttribute('fill','transparent')
      hit.setAttribute('style','cursor:crosshair')
      hit.addEventListener('mouseenter', () => {
        const info = { elo: Math.round(e[1]) }
        if (round >= 2) info.date = e[0]
        if (round >= 3) info.team = e[4] || ''
        setTooltip({ x: xS(i), y: yS(e[1]), svgW: W, ...info })
      })
      hit.addEventListener('mouseleave', () => setTooltip(null))
      svg.appendChild(hit)
    })
  }

  return (
    <div ref={wrapRef} style={{ background:'#fafaf8', borderRadius:10, border:'0.5px solid #e8e5e0', padding:'12px 8px 4px', position:'relative' }}>
      <svg ref={svgRef} style={{ width:'100%', display:'block', height:230 }} />
      {tooltip && (
        <div style={{
          position:'absolute',
          left:`${(tooltip.x / (tooltip.svgW||640)) * 100}%`,
          top:`${(tooltip.y / 230) * 100}%`,
          transform: tooltip.x > (tooltip.svgW||640)*0.65 ? 'translate(-110%,-50%)' : 'translate(10%,-50%)',
          background:'#1a1a1a', color:'#fff', borderRadius:8, padding:'8px 12px',
          fontSize:12, lineHeight:1.7, pointerEvents:'none', zIndex:10,
          boxShadow:'0 4px 16px rgba(0,0,0,0.25)', whiteSpace:'nowrap',
        }}>
          <div>Elo <span style={{ color:'#ffd700', fontWeight:600 }}>{tooltip.elo.toLocaleString()}</span></div>
          {tooltip.date && <div style={{ color:'#aaa' }}>{tooltip.date.slice(5,7)}/{tooltip.date.slice(8,10)}/{tooltip.date.slice(0,4)}</div>}
          {tooltip.team && <div style={{ color:'#ccc' }}>{tooltip.team}</div>}
        </div>
      )}
    </div>
  )
}

// ── Autocomplete guess input ──────────────────────────────────────────────────

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
}

function GuessInput({ players, onGuess, disabled, placeholder }) {
  const [val, setVal] = useState('')
  const [suggs, setSuggs] = useState([])

  const onChange = e => {
    const q = e.target.value
    setVal(q)
    if (q.length < 2) { setSuggs([]); return }
    const nq = normalize(q)
    setSuggs(players.filter(p => normalize(p.name).includes(nq)).slice(0,7))
  }

  const submit = name => {
    const n = name || val
    if (!n.trim()) return
    setVal(''); setSuggs([])
    onGuess(n.trim())
  }

  return (
    <div style={{ position:'relative', width:'100%', maxWidth:420 }}>
      <div style={{ display:'flex', gap:8 }}>
        <input
          value={val} onChange={onChange} disabled={disabled}
          onKeyDown={e => e.key==='Enter' && val && submit()}
          placeholder={placeholder || 'Type a player name...'}
          style={{
            flex:1, border:'0.5px solid #e0ddd6', borderRadius:8,
            padding:'11px 14px', fontSize:14, fontFamily:"'DM Sans', sans-serif",
            outline:'none', background:'#fff',
          }}
        />
        <button
          onClick={() => submit()}
          disabled={disabled || !val.trim()}
          style={{
            background:'#1a2e1a', color:'#fff', border:'none', borderRadius:8,
            padding:'11px 22px', fontSize:14, fontWeight:600, cursor:'pointer',
            fontFamily:"'DM Sans', sans-serif", opacity: (disabled||!val.trim()) ? 0.5 : 1,
          }}
        >Guess</button>
      </div>
      {suggs.length > 0 && (
        <div style={{
          position:'absolute', top:'100%', left:0, right:52, zIndex:30,
          background:'#fff', border:'0.5px solid #e0ddd6', borderRadius:8,
          boxShadow:'0 4px 16px rgba(0,0,0,0.12)', marginTop:4, overflow:'hidden',
        }}>
          {suggs.map(p => (
            <div key={p.name} onClick={() => submit(p.name)}
              style={{ padding:'10px 14px', cursor:'pointer', fontSize:14, borderBottom:'0.5px solid #f0ede8' }}
              onMouseEnter={e => e.currentTarget.style.background='#f5f3ee'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}
            >{p.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Filter Screen ─────────────────────────────────────────────────────────────

function FilterScreen({ players, onSelect }) {
  const [franchises, setFranchises] = useState([])
  const [eras,       setEras]       = useState([])
  const [minGP,      setMinGP]      = useState(100)

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter(x=>x!==v) : [...arr, v])

  const pool = useMemo(() => players.filter(p => {
    const h = p.elo_history || []
    if (h.length < minGP) return false
    if (eras.length > 0 && !h.some(e => eras.some(id => ERAS.find(x=>x.id===id)?.test(e)))) return false
    if (franchises.length > 0) {
      const al = franchises.flatMap(f => FRANCHISE_ALIASES[f]||[f])
      if (!h.some(e => al.includes(e[4]||''))) return false
    }
    return true
  }), [players, franchises, eras, minGP])

  const s = {
    wrap:  { display:'flex', flex:1, flexDirection:'column', alignItems:'center', justifyContent:'center', padding:32, background:'#f5f3ee' },
    card:  { background:'#fff', borderRadius:14, padding:32, width:'100%', maxWidth:620, boxShadow:'0 2px 16px rgba(0,0,0,0.08)' },
    lbl:   { fontSize:11, textTransform:'uppercase', letterSpacing:1, color:'#bbb', marginBottom:10, display:'block' },
    grid:  { display:'flex', flexWrap:'wrap', gap:6, marginBottom:22 },
    chip:  (active) => ({
      background: active ? '#1a2e1a' : 'transparent',
      border:`0.5px solid ${active ? '#1a2e1a' : '#e0ddd6'}`,
      borderRadius:20, padding:'5px 12px', fontSize:12,
      fontWeight: active ? 600 : 400, color: active ? '#fff' : '#555',
      cursor:'pointer', fontFamily:"'DM Sans', sans-serif",
    }),
    btn:   { width:'100%', background:'#1a2e1a', color:'#fff', border:'none', borderRadius:10, padding:'14px 0', fontSize:16, fontWeight:600, cursor:'pointer', fontFamily:"'DM Sans', sans-serif", marginTop:4 },
  }

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <h1 style={{ fontFamily:"'DM Serif Display', serif", fontSize:28, color:'#1a1a1a', marginBottom:6 }}>Mystery Player</h1>
        <p style={{ fontSize:14, color:'#888', marginBottom:28, lineHeight:1.6 }}>
          Guess the player from their Elo career chart. Three rounds, each revealing more clues. Wrong guesses earn a report card.
        </p>

        <span style={s.lbl}>Filter by Franchise <span style={{ color:'#ccc', fontWeight:400 }}>(optional)</span></span>
        <div style={s.grid}>
          {Object.keys(FRANCHISE_NAMES).map(f => (
            <button key={f} style={s.chip(franchises.includes(f))} onClick={() => toggle(franchises, setFranchises, f)}>
              {FRANCHISE_NAMES[f]}
            </button>
          ))}
        </div>

        <span style={s.lbl}>Filter by Era <span style={{ color:'#ccc', fontWeight:400 }}>(optional, multi-select)</span></span>
        <div style={s.grid}>
          {ERAS.map(e => (
            <button key={e.id} style={s.chip(eras.includes(e.id))} onClick={() => toggle(eras, setEras, e.id)}>
              {e.label} <span style={{ opacity:0.55 }}>· {e.desc}</span>
            </button>
          ))}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:24 }}>
          <span style={{ ...s.lbl, margin:0 }}>Min career games</span>
          <input
            type="number" value={minGP}
            onChange={e => setMinGP(Math.max(1, parseInt(e.target.value)||1))}
            style={{ width:80, border:'0.5px solid #e0ddd6', borderRadius:6, padding:'6px 10px', fontSize:13, fontFamily:"'DM Mono', monospace", color:'#333', outline:'none' }}
          />
          <span style={{ fontSize:12, color:'#aaa' }}>{pool.length} players eligible</span>
        </div>

        <button style={s.btn} onClick={() => pool.length && onSelect(pool[Math.floor(Math.random()*pool.length)])} disabled={!pool.length}>
          {pool.length ? 'Pick a Mystery Player →' : 'No players match filters'}
        </button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MysteryPlayer({ players, onSelectPlayer }) {
  const [mystery,    setMystery]    = useState(null)
  const [round,      setRound]      = useState(1)
  const [guesses,    setGuesses]    = useState([])  // {name, player, correct}
  const [result,     setResult]     = useState(null) // 'win'|'lose'
  const [showTrans,  setShowTrans]  = useState(false) // transition screen

  const reset = () => { setMystery(null); setRound(1); setGuesses([]); setResult(null); setShowTrans(false) }

  const handleGuess = name => {
    const guessPlayer = players.find(p => normalize(p.name) === normalize(name))
    const correct = normalize(name) === normalize(mystery.name)
    const newGuesses = [...guesses, { name, player: guessPlayer, correct }]
    setGuesses(newGuesses)

    if (correct) {
      setResult('win')
    } else if (round < 3) {
      setShowTrans(true) // show transition/grade screen
    } else {
      setResult('lose')
    }
  }

  const continueToNextRound = () => {
    setShowTrans(false)
    setRound(r => r + 1)
  }

  if (!mystery) return <FilterScreen players={players} onSelect={p => { setMystery(p); setRound(1); setGuesses([]); setResult(null); setShowTrans(false) }} />

  // Transition screen between rounds
  if (showTrans) {
    const lastGuess = guesses[guesses.length - 1]
    return (
      <RoundTransition
        guess={lastGuess?.player}
        mystery={mystery}
        round={round}
        onContinue={continueToNextRound}
      />
    )
  }

  const ROUND_HINTS = [
    'No years · No team colors',
    'Years now visible on the x-axis',
    'Team colors now revealed — final round',
  ]

  const s = {
    wrap:   { display:'flex', flex:1, flexDirection:'column', overflow:'hidden', background:'#f5f3ee', fontFamily:"'DM Sans', sans-serif" },
    header: { padding:'16px 28px', borderBottom:'0.5px solid #e0ddd6', background:'#fff', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center' },
    body:   { flex:1, overflow:'auto', padding:'24px 32px', display:'flex', flexDirection:'column', alignItems:'center', gap:20 },
    dot:    (filled) => ({ width:10, height:10, borderRadius:'50%', background: filled ? '#1a2e1a' : '#e0ddd6' }),
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ display:'flex', gap:6 }}>
            {[1,2,3].map(r => <div key={r} style={s.dot(r <= round)} />)}
          </div>
          <div>
            <span style={{ fontWeight:600, fontSize:14 }}>Round {round}</span>
            <span style={{ fontSize:13, color:'#aaa', marginLeft:10 }}>{ROUND_HINTS[round-1]}</span>
          </div>
        </div>
        <button onClick={reset} style={{ background:'none', border:'0.5px solid #e0ddd6', borderRadius:6, padding:'6px 14px', fontSize:12, cursor:'pointer', color:'#888' }}>
          New Player
        </button>
      </div>

      <div style={s.body}>
        <div style={{ width:'100%', maxWidth:700 }}>
          <MysteryChart player={mystery} round={result ? 3 : round} />
        </div>

        {/* Wrong guesses */}
        {guesses.filter(g => !g.correct).map((g, i) => (
          <div key={i} style={{ background:'#fff5f5', border:'0.5px solid #f0d0d0', borderRadius:8, padding:'8px 16px', fontSize:13, color:'#c94040', display:'flex', gap:8 }}>
            <span>✗</span><span>{g.name}</span><span style={{ color:'#aaa', fontSize:11 }}>— not correct</span>
          </div>
        ))}

        {/* Win */}
        {result === 'win' && (
          <div style={{ background:'#f0f7f0', border:'0.5px solid #c0d8c0', borderRadius:14, padding:28, textAlign:'center', width:'100%', maxWidth:480 }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🎉</div>
            <div style={{ fontFamily:"'DM Serif Display', serif", fontSize:22, color:'#1a2e1a', marginBottom:4 }}>{mystery.name}</div>
            <div style={{ fontSize:13, color:'#888', marginBottom:20 }}>Solved in round {round} · {guesses.length === 1 ? '1 guess' : `${guesses.length} guesses`}</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <button onClick={() => onSelectPlayer(mystery)} style={{ background:'#1a2e1a', color:'#fff', border:'none', borderRadius:8, padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>View Player →</button>
              <button onClick={reset} style={{ background:'#fff', border:'0.5px solid #e0ddd6', borderRadius:8, padding:'10px 20px', fontSize:13, cursor:'pointer', color:'#555' }}>Play Again</button>
            </div>
          </div>
        )}

        {/* Lose */}
        {result === 'lose' && (
          <div style={{ background:'#fff5f5', border:'0.5px solid #f0d0d0', borderRadius:14, padding:28, textAlign:'center', width:'100%', maxWidth:480 }}>
            <div style={{ fontSize:32, marginBottom:8 }}>😔</div>
            <div style={{ fontFamily:"'DM Serif Display', serif", fontSize:22, color:'#c94040', marginBottom:4 }}>The answer was {mystery.name}</div>
            <div style={{ fontSize:13, color:'#888', marginBottom:20 }}>Better luck next time</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <button onClick={() => onSelectPlayer(mystery)} style={{ background:'#1a2e1a', color:'#fff', border:'none', borderRadius:8, padding:'10px 20px', fontSize:13, fontWeight:600, cursor:'pointer' }}>View Player →</button>
              <button onClick={reset} style={{ background:'#fff', border:'0.5px solid #e0ddd6', borderRadius:8, padding:'10px 20px', fontSize:13, cursor:'pointer', color:'#555' }}>Play Again</button>
            </div>
          </div>
        )}

        {/* Guess input */}
        {!result && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, width:'100%' }}>
            <div style={{ fontSize:13, color:'#888' }}>
              {round === 1 && 'Who is this player? No years, no team colors yet.'}
              {round === 2 && 'The years are visible now. Take another look.'}
              {round === 3 && 'Team colors revealed. This is your last chance.'}
            </div>
            <GuessInput players={players} onGuess={handleGuess} disabled={!!result} />
          </div>
        )}
      </div>
    </div>
  )
}
