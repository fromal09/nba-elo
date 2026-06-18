import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useEffect as useEffectOnce } from 'react'

// Load Three.js once
let threeLoaded = false
function loadThree() {
  if (threeLoaded || typeof window === 'undefined') return
  threeLoaded = true
  const s = document.createElement('script')
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
  document.head.appendChild(s)
}

const FRANCHISE_ALIASES = {
  ATL:['ATL','STL','TRI','BOM'],
  BOS:['BOS'],
  BKN:['BKN','BRK','NJN','NJA'],
  CHA:['CHA','CHO'],
  CHI:['CHI'],
  CLE:['CLE'],
  DAL:['DAL'],
  DEN:['DEN','DNR'],
  DET:['DET','FTW'],
  GSW:['GSW','SFW','PHW'],
  HOU:['HOU','SDR'],
  IND:['IND'],
  LAC:['LAC','SDC','BUF'],
  LAL:['LAL','MNL'],
  MEM:['MEM','VAN'],
  MIA:['MIA'],
  MIL:['MIL'],
  MIN:['MIN'],
  NOP:['NOP','NOH','NOK','NOM'],
  NYK:['NYK'],
  OKC:['OKC','SEA'],
  ORL:['ORL'],
  PHI:['PHI','SYR'],
  PHO:['PHO'],
  POR:['POR'],
  SAC:['SAC','KCK','CIN','ROC'],
  SAS:['SAS','SAA'],
  TOR:['TOR'],
  UTA:['UTA','NOJ'],
  WAS:['WAS','WSB','BAL','CAP'],
}

const FRANCHISE_NAMES = {
  ATL:'Atlanta Hawks',BOS:'Boston Celtics',BKN:'Brooklyn Nets',CHA:'Charlotte Hornets',
  CHI:'Chicago Bulls',CLE:'Cleveland Cavaliers',DAL:'Dallas Mavericks',DEN:'Denver Nuggets',
  DET:'Detroit Pistons',GSW:'Golden State Warriors',HOU:'Houston Rockets',IND:'Indiana Pacers',
  LAC:'LA Clippers',LAL:'LA Lakers',MEM:'Memphis Grizzlies',MIA:'Miami Heat',
  MIL:'Milwaukee Bucks',MIN:'Minnesota Timberwolves',NOP:'New Orleans Pelicans',NYK:'New York Knicks',
  OKC:'Oklahoma City Thunder',ORL:'Orlando Magic',PHI:'Philadelphia 76ers',PHO:'Phoenix Suns',
  POR:'Portland Trail Blazers',SAC:'Sacramento Kings',SAS:'San Antonio Spurs',TOR:'Toronto Raptors',
  UTA:'Utah Jazz',WAS:'Washington Wizards',
}

const TEAM_COLORS = {
  ATL:'#C8102E',BOS:'#007A33',BKN:'#000000',CHA:'#00788C',CHO:'#00788C',
  CHI:'#CE1141',CLE:'#860038',DAL:'#00538C',DEN:'#0E2240',DET:'#C8102E',
  GSW:'#1D428A',HOU:'#CE1141',IND:'#002D62',LAC:'#C8102E',LAL:'#552583',
  MEM:'#5D76A9',MIA:'#98002E',MIL:'#00471B',MIN:'#0C2340',NOP:'#0C2340',
  NYK:'#006BB6',OKC:'#007AC1',ORL:'#0077C0',PHI:'#006BB6',PHO:'#1D1160',
  POR:'#E03A3E',SAC:'#5A2D81',SAS:'#000000',TOR:'#CE1141',UTA:'#002B5C',WAS:'#002B5C',
}


const ABA_TEAMS = new Set([
  'ANA','CAR','DLC','FLO','HSM','KEN','LAS',
  'MMP','MMS','MMT','MNM','MNP','PTC','PTP',
  'SSL','TEX','VIR',
  // Dallas Chaparrals became SAS, so DLC is ABA-only
])
// ABA ran 1967-68 through 1975-76

const MIN_GP = 50

function computeTenure(player, franchise, league = "NBA") {
  const aliases = FRANCHISE_ALIASES[franchise] || [franchise]
  const hist = player.elo_history || []
  const entries = hist.filter(e => {
    const t = e[4] || ''
    if (!aliases.includes(t)) return false
    if (league === 'NBA') return !ABA_TEAMS.has(t)
    if (league === 'ABA') return ABA_TEAMS.has(t)
    return true  // ALL
  })
  if (entries.length < MIN_GP) return null
  const gp = entries.length
  const avgElo = entries.reduce((s, e) => s + e[1], 0) / gp
  const peakElo = Math.max(...entries.map(e => e[1]))
  // Legend score: geometric mean weighted 60% avg Elo, 40% games
  const legendScore = Math.pow(avgElo, 0.40) * Math.pow(peakElo, 0.40) * Math.pow(gp, 0.20)
  return { gp, avgElo: Math.round(avgElo), peakElo: Math.round(peakElo), legendScore }
}

function ScatterPlot({ points, franchise, onHover, hoveredName, onSelectPlayer }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const [dims, setDims] = useState({ w: 600, h: 400 })

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(() => {
      const w = wrapRef.current.clientWidth
      setDims({ w, h: Math.round(w * 0.58) })
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  if (!points.length) return null

  const PAD = { top: 20, right: 24, bottom: 48, left: 56 }
  const W = dims.w, H = dims.h
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const maxGP  = Math.max(...points.map(p => p.gp)) * 1.05
  const minElo = Math.min(...points.map(p => p.avgElo)) - 80
  const maxElo = Math.max(...points.map(p => p.avgElo)) + 80
  const midGP  = maxGP / 2
  const midElo = (minElo + maxElo) / 2

  const xScale = gp  => PAD.left + (gp / maxGP) * plotW
  const yScale = elo => PAD.top + plotH - ((elo - minElo) / (maxElo - minElo)) * plotH

  const teamColor = TEAM_COLORS[franchise] || '#173657'

  const ns = 'http://www.w3.org/2000/svg'

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        {/* Quadrant lines */}
        <line x1={xScale(midGP)} y1={PAD.top} x2={xScale(midGP)} y2={PAD.top + plotH}
          stroke="rgba(0,0,0,0.08)" strokeWidth="1" strokeDasharray="4,3" />
        <line x1={PAD.left} y1={yScale(midElo)} x2={PAD.left + plotW} y2={yScale(midElo)}
          stroke="rgba(0,0,0,0.08)" strokeWidth="1" strokeDasharray="4,3" />

        {/* Quadrant labels */}
        <text x={xScale(midGP * 1.5)} y={yScale(maxElo * 0.98)} fontSize="10" fill="rgba(0,0,0,0.2)" textAnchor="middle" fontFamily="DM Sans,sans-serif">FRANCHISE LEGENDS</text>
        <text x={xScale(midGP * 0.5)} y={yScale(maxElo * 0.98)} fontSize="10" fill="rgba(0,0,0,0.15)" textAnchor="middle" fontFamily="DM Sans,sans-serif">PEAK CONTRIBUTORS</text>
        <text x={xScale(midGP * 1.5)} y={yScale(minElo * 1.02)} fontSize="10" fill="rgba(0,0,0,0.15)" textAnchor="middle" fontFamily="DM Sans,sans-serif">RELIABLE VETERANS</text>
        <text x={xScale(midGP * 0.5)} y={yScale(minElo * 1.02)} fontSize="10" fill="rgba(0,0,0,0.12)" textAnchor="middle" fontFamily="DM Sans,sans-serif">SHORT TENURE</text>

        {/* Y axis grid + labels */}
        {[...Array(5)].map((_, i) => {
          const elo = Math.round(minElo + (i / 4) * (maxElo - minElo))
          const y = yScale(elo)
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={PAD.left + plotW} y2={y} stroke="rgba(0,0,0,0.05)" strokeWidth="0.5" />
              <text x={PAD.left - 6} y={y + 4} fontSize="10" fill="rgba(0,0,0,0.3)" textAnchor="end" fontFamily="DM Mono,monospace">{elo.toLocaleString()}</text>
            </g>
          )
        })}

        {/* X axis labels */}
        {[...Array(5)].map((_, i) => {
          const gp = Math.round((i / 4) * maxGP)
          const x = xScale(gp)
          return (
            <text key={i} x={x} y={H - 8} fontSize="10" fill="rgba(0,0,0,0.3)" textAnchor="middle" fontFamily="DM Sans,sans-serif">{gp}</text>
          )
        })}

        {/* Axis labels */}
        <text x={PAD.left + plotW / 2} y={H - 2} fontSize="11" fill="rgba(0,0,0,0.4)" textAnchor="middle" fontFamily="DM Sans,sans-serif">Games Played</text>
        <text x={12} y={PAD.top + plotH / 2} fontSize="11" fill="rgba(0,0,0,0.4)" textAnchor="middle" fontFamily="DM Sans,sans-serif" transform={`rotate(-90, 12, ${PAD.top + plotH / 2})`}>Avg Elo</text>

        {/* Dots */}
        {points.map(p => {
          const cx = xScale(p.gp)
          const cy = yScale(p.avgElo)
          const isHovered = p.name === hoveredName
          return (
            <g key={p.name}>
              <circle
                cx={cx} cy={cy}
                r={isHovered ? 8 : 6}
                fill={(() => {
                  const minP = Math.min(...points.map(x => x.peakElo))
                  const maxP = Math.max(...points.map(x => x.peakElo))
                  const t = (p.peakElo - minP) / (maxP - minP || 1)
                  const opacity = isHovered ? 1 : 0.25 + t * 0.75
                  return teamColor + Math.round(opacity * 255).toString(16).padStart(2,'0')
                })()}
                stroke={isHovered ? '#fff' : 'none'}
                strokeWidth={isHovered ? 2 : 0}
                style={{ cursor: 'pointer', transition: 'fill 0.15s' }}
                onMouseEnter={() => onHover(p)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onSelectPlayer(p)}
              />
              {(isHovered || p.rank <= 3) && (
                <text
                  x={cx + (cx > W * 0.8 ? -9 : 9)}
                  y={cy + 4}
                  fontSize="11" fontWeight="600"
                  fill={isHovered ? '#1a1a1a' : 'rgba(0,0,0,0.45)'}
                  textAnchor={cx > W * 0.8 ? 'end' : 'start'}
                  fontFamily="DM Sans,sans-serif"
                  style={{ pointerEvents: 'none' }}
                >
                  {p.name.split(' ').pop()}
                </text>
              )}
            </g>
          )
        })}

        {/* Border */}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="0.5" />
      </svg>
    </div>
  )
}


function Plot3D({ points }) {
  const mountRef  = useRef(null)
  const animRef   = useRef(null)
  const dragRef   = useRef({ dragging:false, lx:0, ly:0, theta:.7, phi:.55, tTheta:.7, tPhi:.55 })
  const stateRef  = useRef({ spheres:[], scene:null, camera:null, renderer:null })
  const [tooltip,  setTooltip] = useState(null)
  const [curView,  setCurView] = useState('iso')

  const VIEWS = {
    iso:     { t:.7,          p:.55 },
    'gp-avg':  { t:Math.PI/2,   p:Math.PI/2 },
    'gp-peak': { t:0,           p:Math.PI/2 },
    'avg-peak':{ t:Math.PI,     p:Math.PI/2 },
  }
  const CLABEL = {
    iso:'Legend Score',
    'gp-avg':'Peak Elo (Z)',
    'gp-peak':'Avg Elo (Y)',
    'avg-peak':'Games Played (X)',
  }

  useEffect(() => {
    if (!mountRef.current || !points.length || !window.THREE) return
    const THREE = window.THREE
    const el = mountRef.current
    const W = el.clientWidth || 600, H = Math.round(W * .60)

    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true })
    renderer.setSize(W, H); renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setClearColor(0, 0)
    el.appendChild(renderer.domElement)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, W/H, .1, 1000)

    const gpMin  = Math.min(...points.map(p=>p.gp)),   gpMax  = Math.max(...points.map(p=>p.gp))
    const avgMin = Math.min(...points.map(p=>p.avgElo)),avgMax = Math.max(...points.map(p=>p.avgElo))
    const pkMin  = Math.min(...points.map(p=>p.peakElo)),pkMax = Math.max(...points.map(p=>p.peakElo))
    const lsMin  = Math.min(...points.map(p=>p.legendScore)),lsMax = Math.max(...points.map(p=>p.legendScore))

    const S=8, o=-S/2
    const nx = v => (v-gpMin)/(gpMax-gpMin||1)*S+o
    const ny = v => (v-avgMin)/(avgMax-avgMin||1)*S+o
    const nz = v => (v-pkMin)/(pkMax-pkMin||1)*S+o
    const lerpCol = t => new THREE.Color().setHSL(.62-t*.58,.82,.44)

    // Wireframe cube
    const corners=[[o,o,o],[S+o,o,o],[S+o,S+o,o],[o,S+o,o],[o,o,S+o],[S+o,o,S+o],[S+o,S+o,S+o],[o,S+o,S+o]]
    const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]
    const ePts=[]; edges.forEach(([a,b])=>{ePts.push(new THREE.Vector3(...corners[a]),new THREE.Vector3(...corners[b]))})
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ePts),new THREE.LineBasicMaterial({color:0xaaaaaa,opacity:.2,transparent:true})))

    // Bold tube axes
    const boldAxis = (from, to, col) => {
      const path = new THREE.LineCurve3(new THREE.Vector3(...from), new THREE.Vector3(...to))
      return new THREE.Mesh(new THREE.TubeGeometry(path,1,.05,8,false), new THREE.MeshBasicMaterial({color:col}))
    }
    scene.add(boldAxis([o,o,o],[S+o+.3,o,o],0x173657))
    scene.add(boldAxis([o,o,o],[o,S+o+.3,o],0x1a8050))
    scene.add(boldAxis([o,o,o],[o,o,S+o+.3],0xb04020))

    // Arrow cones
    const cone = (pos, rot, col) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(.16,.5,10), new THREE.MeshBasicMaterial({color:col}))
      m.position.set(...pos); m.rotation.set(...rot); return m
    }
    scene.add(cone([S+o+.55,o,o],[0,0,-Math.PI/2],0x173657))
    scene.add(cone([o,S+o+.55,o],[0,0,0],0x1a8050))
    scene.add(cone([o,o,S+o+.55],[Math.PI/2,0,0],0xb04020))

    // Tick marks
    const tick = (pos, rot, col) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.4,6), new THREE.MeshBasicMaterial({color:col,opacity:.6,transparent:true}))
      m.position.set(...pos); m.rotation.set(...rot); return m
    }
    ;[0,S/2,S].forEach(x => scene.add(tick([o+x,o,o],[0,0,Math.PI/2],0x173657)))
    ;[0,S/2,S].forEach(y => scene.add(tick([o,o+y,o],[0,0,0],0x1a8050)))
    ;[0,S/2,S].forEach(z => scene.add(tick([o,o,o+z],[Math.PI/2,0,0],0xb04020)))

    // Sprite labels
    const spriteLabel = (text, col, size=22, w=200, h=50) => {
      const c = document.createElement('canvas'); c.width=w; c.height=h
      const cx = c.getContext('2d'); cx.clearRect(0,0,w,h)
      cx.font = `bold ${size}px Inter,Arial,sans-serif`
      cx.fillStyle=col; cx.textAlign='center'; cx.textBaseline='middle'
      cx.fillText(text,w/2,h/2)
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true}))
      sp.scale.set(w/40,h/40,1); return sp
    }

    // Axis name labels
    const la=spriteLabel('Games Played','#173657',26,300,60); la.position.set(S+o+2.4,o-.7,o); scene.add(la)
    const lb=spriteLabel('Avg Elo','#1a8050',26,200,60);       lb.position.set(o-1.9,S+o+1.2,o); scene.add(lb)
    const lc=spriteLabel('Peak Elo','#b04020',26,200,60);      lc.position.set(o-1.1,o-.7,S+o+1.6); scene.add(lc)

    // Tick values
    const tv = (val, pos, col) => { const sp=spriteLabel(Math.round(val).toLocaleString(),col,18,160,42); sp.position.set(...pos); scene.add(sp) }
    tv(gpMin,  [o,    o-.8,o-.5],'#173657'); tv((gpMin+gpMax)/2,[0,o-.8,o-.5],'#173657'); tv(gpMax,  [S+o,  o-.8,o-.5],'#173657')
    tv(avgMin, [o-1., o,   o-.5],'#1a8050'); tv((avgMin+avgMax)/2,[o-1.,0,o-.5],'#1a8050'); tv(avgMax, [o-1., S+o, o-.5],'#1a8050')
    tv(pkMin,  [o-1., o-.5,o  ],'#b04020'); tv((pkMin+pkMax)/2,[o-1.,o-.5,0],'#b04020'); tv(pkMax,  [o-1., o-.5,S+o],'#b04020')

    // Spheres
    const sGeo = new THREE.SphereGeometry(.22,16,16)
    const spheres = []
    points.forEach(p => {
      const t = (p.legendScore-lsMin)/(lsMax-lsMin||1)
      const mat = new THREE.MeshPhongMaterial({color:lerpCol(t),shininess:70})
      const m = new THREE.Mesh(sGeo, mat)
      m.position.set(nx(p.gp), ny(p.avgElo), nz(p.peakElo))
      m.userData = p; scene.add(m); spheres.push(m)
    })

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff,.7))
    const dl=new THREE.DirectionalLight(0xffffff,.8); dl.position.set(10,20,10); scene.add(dl)
    const dl2=new THREE.DirectionalLight(0xffffff,.25); dl2.position.set(-8,-5,-10); scene.add(dl2)

    stateRef.current = { spheres, scene, camera, renderer, lerpCol, lsMin, lsMax, gpMin, gpMax, avgMin, avgMax, pkMin, pkMax }

    // Camera
    const d = dragRef.current, r=21
    const updateCam = () => {
      camera.position.set(r*Math.sin(d.phi)*Math.cos(d.theta), r*Math.cos(d.phi), r*Math.sin(d.phi)*Math.sin(d.theta))
      camera.lookAt(0,0,0)
    }
    updateCam()

    // Drag events
    const onDown = e => { d.dragging=true; d.lx=e.clientX; d.ly=e.clientY; renderer.domElement.style.cursor='grabbing' }
    const onUp   = () => { d.dragging=false; renderer.domElement.style.cursor='grab' }
    const onMove = e => {
      if (!d.dragging) return
      d.tTheta += (e.clientX-d.lx)*.008
      d.tPhi = Math.max(.08, Math.min(Math.PI-.08, d.tPhi+(e.clientY-d.ly)*.008))
      d.lx=e.clientX; d.ly=e.clientY
    }
    renderer.domElement.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)
    renderer.domElement.addEventListener('touchstart', e=>{d.dragging=true;d.lx=e.touches[0].clientX;d.ly=e.touches[0].clientY},{passive:true})
    window.addEventListener('touchend', onUp)
    window.addEventListener('touchmove', e=>{if(!d.dragging)return;d.tTheta+=(e.touches[0].clientX-d.lx)*.008;d.tPhi=Math.max(.08,Math.min(Math.PI-.08,d.tPhi+(e.touches[0].clientY-d.ly)*.008));d.lx=e.touches[0].clientX;d.ly=e.touches[0].clientY},{passive:true})

    // Hover
    const ray=new THREE.Raycaster(), mouse=new THREE.Vector2()
    renderer.domElement.addEventListener('mousemove', e => {
      const rect=renderer.domElement.getBoundingClientRect()
      mouse.x=((e.clientX-rect.left)/rect.width)*2-1
      mouse.y=-((e.clientY-rect.top)/rect.height)*2+1
      ray.setFromCamera(mouse, camera)
      const hits=ray.intersectObjects(spheres)
      if (hits.length) setTooltip({x:e.clientX,y:e.clientY,p:hits[0].object.userData})
      else setTooltip(null)
    })
    renderer.domElement.addEventListener('mouseleave', ()=>setTooltip(null))

    // Animate
    const animate = () => {
      animRef.current = requestAnimationFrame(animate)
      d.theta += (d.tTheta-d.theta)*.06
      d.phi   += (d.tPhi  -d.phi  )*.06
      updateCam(); renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove)
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [points])

  // Recolor on view change
  const setView = (v) => {
    const d = dragRef.current
    d.tTheta = { iso:.7, 'gp-avg':Math.PI/2, 'gp-peak':0, 'avg-peak':Math.PI }[v]
    d.tPhi   = v === 'iso' ? .55 : Math.PI/2
    const { spheres, lsMin, lsMax, gpMin, gpMax, avgMin, avgMax, pkMin, pkMax, lerpCol } = stateRef.current
    if (!spheres) return
    spheres.forEach(s => {
      const p = s.userData
      const t = v==='gp-avg'   ? (p.peakElo -pkMin) /(pkMax -pkMin ||1)
              : v==='gp-peak'  ? (p.avgElo  -avgMin)/(avgMax-avgMin||1)
              : v==='avg-peak' ? (p.gp      -gpMin) /(gpMax -gpMin ||1)
              :                  (p.legendScore-lsMin)/(lsMax-lsMin||1)
      s.material.color = lerpCol(t)
    })
    setCurView(v)
  }

  const btnStyle = (v) => ({
    fontSize:11, padding:'4px 12px',
    border:'0.5px solid #e0e0e0', borderRadius:6, cursor:'pointer',
    background: curView===v ? '#173657' : 'transparent',
    color: curView===v ? '#fff' : '#888',
    fontFamily:"'Inter','Helvetica Neue',Arial,sans-serif",
  })

  return (
    <div style={{width:'100%'}}>
      <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontSize:11,color:'#aaa',marginRight:4}}>View:</span>
        {[['iso','All 3 axes'],['gp-avg','GP × Avg Elo'],['gp-peak','GP × Peak Elo'],['avg-peak','Avg × Peak Elo']].map(([v,label])=>(
          <button key={v} style={btnStyle(v)} onClick={()=>setView(v)}>{label}</button>
        ))}
        <span style={{fontSize:11,color:'#aaa',marginLeft:4}}>Drag to rotate</span>
      </div>
      <div ref={mountRef} style={{width:'100%',cursor:'grab',borderRadius:8,border:'0.5px solid #e0e0e0',overflow:'hidden'}} />
      <div style={{display:'flex',gap:20,marginTop:8,fontSize:11,color:'#888',flexWrap:'wrap',alignItems:'center'}}>
        <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{display:'inline-block',width:24,height:3,background:'#173657',borderRadius:2}}/><strong style={{color:'#173657'}}>X</strong> Games played</span>
        <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{display:'inline-block',width:24,height:3,background:'#1a8050',borderRadius:2}}/><strong style={{color:'#1a8050'}}>Y</strong> Avg Elo</span>
        <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{display:'inline-block',width:24,height:3,background:'#b04020',borderRadius:2}}/><strong style={{color:'#b04020'}}>Z</strong> Peak Elo</span>
        <span style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#aaa'}}>
          Color = {CLABEL[curView]}
          <span style={{display:'inline-block',width:60,height:8,borderRadius:4,background:'linear-gradient(to right,#4488cc,#cc5522)'}}/>
        </span>
      </div>
      {tooltip && (
        <div style={{position:'fixed',left:tooltip.x+14,top:tooltip.y-44,background:'#fff',border:'0.5px solid #e0e0e0',borderRadius:8,padding:'8px 12px',fontSize:12,pointerEvents:'none',zIndex:999,boxShadow:'0 2px 8px rgba(0,0,0,.12)',whiteSpace:'nowrap'}}>
          <div style={{fontWeight:600,marginBottom:2}}>{tooltip.p.name}</div>
          <div style={{color:'#888'}}>GP {tooltip.p.gp} · Avg {tooltip.p.avgElo} · Peak {tooltip.p.peakElo}</div>
          <div style={{color:'#173657',fontWeight:500}}>Legend Score {Math.round(tooltip.p.legendScore).toLocaleString()}</div>
        </div>
      )}
    </div>
  )
}


export default function FranchiseTenures({ players, onSelectPlayer }) {
  const [franchise, setFranchise] = useState('LAL')
  useEffect(() => { loadThree() }, [])
  const [hovered,   setHovered]   = useState(null)
  const [view3d,    setView3d]    = useState(false)
  const [league,    setLeague]    = useState('ALL')  // 'NBA' | 'ABA' | 'ALL' | null (franchise mode)

  const points = useMemo(() => {
    const compute = (entries, p) => {
      if (entries.length < MIN_GP) return null
      const gp = entries.length
      const avgElo = Math.round(entries.reduce((s,e) => s+e[1], 0) / gp)
      const peakElo = Math.round(Math.max(...entries.map(e=>e[1])))
      const legendScore = Math.pow(avgElo, 0.40) * Math.pow(peakElo, 0.40) * Math.pow(gp, 0.20)
      return { name: p.name, gp, avgElo, peakElo, legendScore, player: p }
    }

    return players.map(p => {
      const hist = p.elo_history || []
      if (franchise) {
        // Franchise mode: show career with that franchise only
        const tenure = computeTenure(p, franchise, 'ALL')
        if (!tenure) return null
        return { name: p.name, ...tenure, player: p }
      }
      // League mode
      const entries = hist.filter(e => {
        const t = e[4] || ''
        if (league === 'ABA') return ABA_TEAMS.has(t) && e[0] >= '1967-01-01' && e[0] <= '1977-01-01'
        if (league === 'NBA') return !ABA_TEAMS.has(t) && t !== ''
        return t !== ''  // ALL
      })
      return compute(entries, p)
    })
    .filter(Boolean)
    .sort((a, b) => b.legendScore - a.legendScore)
    .map((p, i) => ({ ...p, rank: i + 1 }))
  }, [players, franchise, league])

  const franchiseName = FRANCHISE_NAMES[franchise]
  const teamColor = TEAM_COLORS[franchise] || '#173657'

  const s = {
    wrap:      { display: 'flex', flex: 1, overflow: 'hidden', background: '#f4f4f4', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif" },
    sidebar:   { width: 220, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e0e0e0', display: 'flex', flexDirection: 'column', overflow: 'auto' },
    main:      { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    sideHead:  { padding: '20px 16px 14px', borderBottom: '0.5px solid #e0e0e0' },
    sideTitle: { fontFamily: "'Georgia', serif", fontSize: 16, color: '#1a1a1a', marginBottom: 3 },
    sideDesc:  { fontSize: 12, color: '#888', lineHeight: 1.6 },
    section:   { padding: '12px 16px', borderBottom: '0.5px solid #f0f0f0' },
    sectionLbl:{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 8 },
    teamGrid:  { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 },
    teamBtn:   (active) => ({
      background: active ? '#173657' : 'transparent',
      border: `0.5px solid ${active ? '#173657' : '#e0e0e0'}`,
      borderRadius: 6, padding: '5px 4px',
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", fontSize: 11, fontWeight: active ? 600 : 400,
      color: active ? '#fff' : '#555', cursor: 'pointer', textAlign: 'center',
    }),
    pageHeader:{ padding: '20px 28px 14px', borderBottom: '0.5px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 },
    pageTitle: { fontFamily: "'Georgia', serif", fontSize: 24, color: '#1a1a1a', marginBottom: 2 },
    pageDesc:  { fontSize: 13, color: '#888' },
    body:      { flex: 1, display: 'flex', overflow: 'hidden' },
    plotArea:  { flex: 1, padding: '20px 24px', overflow: 'auto' },
    rankPanel: { width: 280, flexShrink: 0, borderLeft: '0.5px solid #e0e0e0', overflow: 'auto', background: '#fff' },
    rankHead:  { padding: '12px 16px', borderBottom: '0.5px solid #e0e0e0', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb' },
    rankRow:   (active) => ({
      padding: '9px 16px', borderBottom: '0.5px solid #f0f0f0', cursor: 'pointer',
      background: active ? '#f4f4f4' : 'transparent',
      display: 'flex', alignItems: 'center', gap: 10,
    }),
    rankNum:   { fontSize: 11, color: '#bbb', minWidth: 20, fontVariantNumeric: 'tabular-nums' },
    rankName:  { flex: 1, fontSize: 13, fontWeight: 500 },
    rankScore: { fontSize: 11, color: '#888', fontVariantNumeric: 'tabular-nums' },
  }

  return (
    <div style={s.wrap}>
      <div style={s.sidebar}>
        <div style={s.sideHead}>
          <div style={s.sideTitle}>Franchise Tenures</div>
          <div style={s.sideDesc}>Avg Elo vs games played for each franchise. Top-right = Legends.</div>
        </div>
        <div style={s.section}>
          <div style={s.sectionLbl}>League</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['NBA', 'ABA', 'ALL'].map(l => (
              <button key={l}
                onClick={() => { setLeague(l); setFranchise(null); setHovered(null) }}
                style={{
                  flex: 1, background: !franchise && league === l ? '#173657' : 'transparent',
                  border: `0.5px solid ${!franchise && league === l ? '#173657' : '#e0e0e0'}`,
                  borderRadius: 6, padding: '5px 0', fontSize: 11,
                  fontWeight: !franchise && league === l ? 700 : 400,
                  color: !franchise && league === l ? '#fff' : '#888',
                  cursor: 'pointer', fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                }}
              >{l === 'ALL' ? 'NBA+ABA' : l}</button>
            ))}
          </div>
        </div>
        <div style={s.section}>
          <div style={s.sectionLbl}>Franchise</div>
          <div style={s.teamGrid}>
            {Object.keys(FRANCHISE_NAMES).map(abbr => (
              <button key={abbr} style={s.teamBtn(franchise === abbr)}
                onClick={() => { setFranchise(abbr); setLeague(null); setHovered(null) }}
                title={FRANCHISE_NAMES[abbr]}
              >{abbr}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 16px', fontSize: 11, color: '#aaa', lineHeight: 1.7 }}>
          Min {MIN_GP} GP to qualify. Click any dot to open player modal.
        </div>
      </div>

      <div style={s.main}>
        <div style={s.pageHeader}>
          <div>
            <h1 style={s.pageTitle}>
              {franchise ? FRANCHISE_NAMES[franchise]
                : league === 'ABA' ? 'ABA All-Time'
                : league === 'NBA' ? 'NBA All-Time'
                : 'NBA + ABA All-Time'}
            </h1>
            <p style={s.pageDesc}>{points.length} players · min {MIN_GP} GP · sorted by Legend Score</p>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {['scatter','3d'].map(v => (
              <button key={v}
                onClick={() => setView3d(v === '3d')}
                style={{
                  background: (view3d ? v==='3d' : v==='scatter') ? '#173657' : 'transparent',
                  border: '0.5px solid #e0e0e0', borderRadius: 6, padding: '4px 12px',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  color: (view3d ? v==='3d' : v==='scatter') ? '#fff' : '#888',
                  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                }}
              >{v === '3d' ? '3D Cube' : 'Scatter'}</button>
            ))}
          </div>
          </div>
          {hovered && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{hovered.name}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {hovered.gp} GP · Avg {hovered.avgElo.toLocaleString()} Elo · Peak {hovered.peakElo.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: teamColor, fontWeight: 600 }}>
                Legend Score: {Math.round(hovered.legendScore).toLocaleString()} · #{hovered.rank}
              </div>
            </div>
          )}
        </div>

        <div style={s.body}>
          <div style={s.plotArea}>
            {view3d
              ? <Plot3D points={points} />
              : <ScatterPlot
              points={points}
              franchise={franchise}
              onHover={setHovered}
              hoveredName={hovered?.name}
              onSelectPlayer={p => onSelectPlayer(p.player)}
            />
            }
          </div>

          <div style={s.rankPanel}>
            <div style={s.rankHead}>Franchise Elo Legends</div>
            <div style={{ padding: '8px 16px', borderBottom: '0.5px solid #f0f0f0', fontSize: 11, color: '#aaa' }}>
              Color intensity = franchise peak Elo
            </div>
            {points.slice(0, 30).map(p => (
              <div
                key={p.name}
                style={s.rankRow(hovered?.name === p.name)}
                onMouseEnter={() => setHovered(p)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectPlayer(p.player)}
              >
                <span style={s.rankNum}>{p.rank}</span>
                <span style={s.rankName}>{p.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: teamColor, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(p.legendScore).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
