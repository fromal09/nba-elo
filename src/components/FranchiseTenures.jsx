import { useState, useMemo, useRef, useEffect, useCallback } from 'react'

// Load Three.js once
let threeLoaded = false
function loadThree() {
  if (threeLoaded || typeof window === 'undefined') return
  threeLoaded = true
  const s = document.createElement('script')
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
  document.head.appendChild(s)
}
let d3Loaded = false
function loadD3() {
  if (d3Loaded || typeof window === 'undefined') return
  d3Loaded = true
  const s = document.createElement('script')
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js'
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
    // Look directly along the hidden axis so it collapses and the two visible axes spread out
    // Axes: X=GP (right), Y=Avg Elo (up), Z=Peak Elo (into scene from origin corner)
    // GP x Avg:   hide Z ? look from +Z toward origin ? theta=-?/2, phi=?/2
    // GP x Peak:  hide Y ? look from +Y down ? theta=anything, phi?0
    // Avg x Peak: hide X ? look from -X toward origin ? theta=?, phi=?/2
    const thetaMap = { iso:.7, 'gp-avg':-Math.PI/2, 'gp-peak':-.7, 'avg-peak':Math.PI }
    const phiMap   = { iso:.55, 'gp-avg':Math.PI/2,  'gp-peak':0.02, 'avg-peak':Math.PI/2 }
    d.tTheta = thetaMap[v]
    d.tPhi   = phiMap[v]
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
        {[['iso','All 3 axes'],['gp-avg','GP x Avg Elo'],['gp-peak','GP x Peak Elo'],['avg-peak','Avg x Peak Elo']].map(([v,label])=>(
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
          <div style={{color:'#888'}}>GP {tooltip.p.gp} ? Avg {tooltip.p.avgElo} ? Peak {tooltip.p.peakElo}</div>
          <div style={{color:'#173657',fontWeight:500}}>Legend Score {Math.round(tooltip.p.legendScore).toLocaleString()}</div>
        </div>
      )}
    </div>
  )
}



// -- Parallel Coordinates -----------------------------------------------------
function ParallelCoords({ points }) {
  const svgRef = useRef(null)
  const [hovered, setHovered] = useState(null)
  const [colorKey, setColorKey] = useState('legendScore')

  useEffect(() => {
    if (!svgRef.current || !points.length) return
    const el = svgRef.current
    const W = el.clientWidth || 640, H = 320
    el.setAttribute('viewBox', `0 0 ${W} ${H}`)

    while (el.firstChild) el.removeChild(el.firstChild)
    const ns = 'http://www.w3.org/2000/svg'

    const DIMS = [
      { key: 'gp',          label: 'Games Played' },
      { key: 'avgElo',      label: 'Avg Elo'       },
      { key: 'peakElo',     label: 'Peak Elo'      },
      { key: 'legendScore', label: 'Legend Score'  },
    ]
    const PAD = { top: 40, bottom: 50, left: 60, right: 60 }
    const xScale = i => PAD.left + (i / (DIMS.length - 1)) * (W - PAD.left - PAD.right)

    const yScales = {}
    DIMS.forEach((dim, i) => {
      const vals = points.map(p => p[dim.key])
      const mn = Math.min(...vals), mx = Math.max(...vals)
      yScales[dim.key] = v => PAD.top + (H - PAD.top - PAD.bottom) - ((v - mn) / (mx - mn)) * (H - PAD.top - PAD.bottom)
    })

    const lsVals = points.map(p => p[colorKey])
    const lsMin = Math.min(...lsVals), lsMax = Math.max(...lsVals)
    const getColor = p => {
      const t = (p[colorKey] - lsMin) / (lsMax - lsMin || 1)
      const r = Math.round(23 + t * 232), g = Math.round(54 + t * 50), b = Math.round(87 + t * 100)
      return `rgb(${r},${g},${b})`
    }

    const linePath = p => DIMS.map((dim, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScales[dim.key](p[dim.key]).toFixed(1)}`).join(' ')

    // Lines
    const sorted = [...points].sort((a, b) => a[colorKey] - b[colorKey])
    sorted.forEach(p => {
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', linePath(p))
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', getColor(p))
      path.setAttribute('stroke-width', hovered === p.name ? 3 : 1.5)
      path.setAttribute('opacity', hovered ? (hovered === p.name ? 1 : 0.06) : 0.5)
      path.setAttribute('stroke-linecap', 'round')
      path.style.cursor = 'pointer'
      path.addEventListener('mouseenter', () => setHovered(p.name))
      path.addEventListener('mouseleave', () => setHovered(null))
      el.appendChild(path)
    })

    // Axes
    DIMS.forEach((dim, i) => {
      const x = xScale(i)
      const vals = points.map(p => p[dim.key])
      const mn = Math.min(...vals), mx = Math.max(...vals)

      const line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', x); line.setAttribute('y1', PAD.top)
      line.setAttribute('x2', x); line.setAttribute('y2', H - PAD.bottom)
      line.setAttribute('stroke', '#173657'); line.setAttribute('stroke-width', 2)
      el.appendChild(line)

      // Ticks
      for (let ti = 0; ti <= 4; ti++) {
        const v = mn + (ti / 4) * (mx - mn)
        const y = yScales[dim.key](v)
        const tick = document.createElementNS(ns, 'line')
        tick.setAttribute('x1', x - 5); tick.setAttribute('y1', y)
        tick.setAttribute('x2', x + 5); tick.setAttribute('y2', y)
        tick.setAttribute('stroke', '#ccc'); tick.setAttribute('stroke-width', 1)
        el.appendChild(tick)
        const lbl = document.createElementNS(ns, 'text')
        lbl.setAttribute('x', i === DIMS.length - 1 ? x + 8 : x - 8)
        lbl.setAttribute('y', y + 4)
        lbl.setAttribute('font-size', 9)
        lbl.setAttribute('fill', '#aaa')
        lbl.setAttribute('text-anchor', i === DIMS.length - 1 ? 'start' : 'end')
        lbl.setAttribute('font-family', 'Inter,sans-serif')
        lbl.textContent = Math.round(v).toLocaleString()
        el.appendChild(lbl)
      }

      const label = document.createElementNS(ns, 'text')
      label.setAttribute('x', x); label.setAttribute('y', H - 12)
      label.setAttribute('text-anchor', 'middle')
      label.setAttribute('font-size', 12); label.setAttribute('font-weight', '600')
      label.setAttribute('fill', '#173657')
      label.setAttribute('font-family', 'Inter,sans-serif')
      label.textContent = dim.label
      el.appendChild(label)
    })

  }, [points, hovered, colorKey])

  const btnStyle = k => ({
    fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
    border: '0.5px solid #e0e0e0', fontFamily: "'Inter',sans-serif",
    background: colorKey === k ? '#173657' : 'transparent',
    color: colorKey === k ? '#fff' : '#888',
  })

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Color by:</span>
        {[['legendScore','Legend Score'],['gp','GP'],['avgElo','Avg Elo'],['peakElo','Peak Elo']].map(([k,l]) => (
          <button key={k} style={btnStyle(k)} onClick={() => setColorKey(k)}>{l}</button>
        ))}
        {hovered && <span style={{ fontSize: 11, color: '#173657', marginLeft: 8 }}>{hovered}</span>}
      </div>
      <svg ref={svgRef} style={{ width: '100%', display: 'block', height: 320 }} />
    </div>
  )
}

// -- Force Bubbles -------------------------------------------------------------
function ForceBubbles({ points }) {
  const svgRef  = useRef(null)
  const simRef  = useRef(null)
  const [colorKey, setColorKey] = useState('legendScore')
  const [tooltip, setTooltip] = useState(null)

  const W = 640, H = 360

  const gpExt = useMemo(() => [Math.min(...points.map(p=>p.gp)), Math.max(...points.map(p=>p.gp))], [points])
  const rScale = useCallback(gp => {
    const t = (gp - gpExt[0]) / (gpExt[1] - gpExt[0] || 1)
    return 8 + t * 28
  }, [gpExt])

  const getColor = useCallback((p) => {
    const vals = points.map(x => x[colorKey])
    const mn = Math.min(...vals), mx = Math.max(...vals)
    const t = (p[colorKey] - mn) / (mx - mn || 1)
    const r = Math.round(133 + t * (23-133))
    const g = Math.round(180 + t * (54-180))
    const b = Math.round(221 + t * (87-221))
    return `rgb(${r},${g},${b})`
  }, [points, colorKey])

  const targetX = useCallback((p) => {
    const vals = points.map(x => x[colorKey])
    const mn = Math.min(...vals), mx = Math.max(...vals)
    const t = (p[colorKey] - mn) / (mx - mn || 1)
    return 60 + t * (W - 120)
  }, [points, colorKey])

  useEffect(() => {
    if (!svgRef.current || !points.length || !window.d3) return
    const d3 = window.d3
    const data = points.map(p => ({ ...p, x: W/2, y: H/2 }))

    if (simRef.current) simRef.current.stop()

    const sim = d3.forceSimulation(data)
      .force('x', d3.forceX(d => targetX(d)).strength(0.22))
      .force('y', d3.forceY(H / 2).strength(0.12))
      .force('collide', d3.forceCollide(d => rScale(d.gp) + 2).strength(0.85))
      .alphaDecay(0.02)

    simRef.current = sim

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const bubbles = svg.selectAll('g').data(data).join('g').style('cursor', 'pointer')

    bubbles.append('circle')
      .attr('r', d => rScale(d.gp))
      .attr('fill', d => getColor(d))
      .attr('stroke', '#fff').attr('stroke-width', 1.5)

    bubbles.append('text')
      .attr('text-anchor', 'middle').attr('dy', '0.35em')
      .attr('fill', '#fff').attr('font-size', d => rScale(d.gp) > 20 ? 10 : 0)
      .attr('pointer-events', 'none')
      .text(d => d.name.split(' ').pop())

    bubbles
      .on('mouseover', (e, d) => setTooltip({ x: e.offsetX, y: e.offsetY, p: d }))
      .on('mousemove', (e, d) => setTooltip({ x: e.offsetX, y: e.offsetY, p: d }))
      .on('mouseout', () => setTooltip(null))

    sim.on('tick', () => {
      bubbles.attr('transform', d =>
        `translate(${Math.max(rScale(d.gp), Math.min(W-rScale(d.gp), d.x))},${Math.max(rScale(d.gp)+5, Math.min(H-rScale(d.gp)-30, d.y))})`
      )
    })

    // Axis
    const vals = points.map(p => p[colorKey])
    const mn = Math.min(...vals), mx = Math.max(...vals)
    const axSc = d3.scaleLinear().domain([mn, mx]).range([60, W-60])
    svg.append('line').attr('x1',60).attr('y1',H-20).attr('x2',W-60).attr('y2',H-20).attr('stroke','#ddd')
    axSc.ticks(5).forEach(t => {
      svg.append('line').attr('x1',axSc(t)).attr('y1',H-24).attr('x2',axSc(t)).attr('y2',H-16).attr('stroke','#ccc')
      svg.append('text').attr('x',axSc(t)).attr('y',H-8).attr('text-anchor','middle').attr('font-size',9).attr('fill','#aaa').attr('font-family','Inter,sans-serif').text(Math.round(t).toLocaleString())
    })

    return () => sim.stop()
  }, [points, colorKey])

  const btnStyle = k => ({
    fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
    border: '0.5px solid #e0e0e0', fontFamily: "'Inter',sans-serif",
    background: colorKey === k ? '#173657' : 'transparent',
    color: colorKey === k ? '#fff' : '#888',
  })

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Cluster & color by:</span>
        {[['legendScore','Legend Score'],['gp','GP'],['avgElo','Avg Elo'],['peakElo','Peak Elo']].map(([k,l]) => (
          <button key={k} style={btnStyle(k)} onClick={() => setColorKey(k)}>{l}</button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>Size = Games Played</div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', height: 360 }} />
      {tooltip && (
        <div style={{ position: 'absolute', left: tooltip.x + 10, top: tooltip.y - 50, background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 8, padding: '8px 12px', fontSize: 12, pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
          <div style={{ fontWeight: 600 }}>{tooltip.p.name}</div>
          <div style={{ color: '#888' }}>GP {tooltip.p.gp} ? Avg {tooltip.p.avgElo} ? Peak {tooltip.p.peakElo}</div>
          <div style={{ color: '#173657' }}>Legend Score {Math.round(tooltip.p.legendScore).toLocaleString()}</div>
        </div>
      )}
    </div>
  )
}

// -- Hexbin --------------------------------------------------------------------
function HexbinMap({ points }) {
  const svgRef = useRef(null)
  const [minPeak, setMinPeak] = useState(0)
  const [tooltip, setTooltip] = useState(null)

  const pkMin = useMemo(() => Math.min(...points.map(p=>p.peakElo)), [points])
  const pkMax = useMemo(() => Math.max(...points.map(p=>p.peakElo)), [points])

  useEffect(() => {
    if (!svgRef.current || !points.length || !window.d3) return
    const d3 = window.d3
    const el = svgRef.current
    const W = el.clientWidth || 640, H = 320
    el.setAttribute('viewBox', `0 0 ${W} ${H}`)

    const filtered = points.filter(p => p.peakElo >= minPeak)
    const PAD = { top: 20, right: 20, bottom: 48, left: 56 }
    const PW = W - PAD.left - PAD.right, PH = H - PAD.top - PAD.bottom

    const xSc = d3.scaleLinear().domain(d3.extent(points,p=>p.gp)).range([0,PW])
    const ySc = d3.scaleLinear().domain(d3.extent(points,p=>p.avgElo)).range([PH,0])

    const hexbin = d3.hexbin ? d3.hexbin() : null
    if (!hexbin) {
      // Fallback scatter if hexbin not loaded
      const svg = d3.select(el); svg.selectAll('*').remove()
      svg.selectAll('circle').data(filtered).join('circle')
        .attr('cx',d=>PAD.left+xSc(d.gp)).attr('cy',d=>PAD.top+ySc(d.avgElo))
        .attr('r',5).attr('fill','#173657').attr('opacity',0.6)
      return
    }

    hexbin.x(d=>xSc(d.gp)).y(d=>ySc(d.avgElo)).radius(Math.max(20, PW/16)).extent([[0,0],[PW,PH]])

    const bins = hexbin(filtered)
    const maxCount = d3.max(bins, d=>d.length) || 1
    const colorSc = d3.scaleSequential().domain([0,maxCount]).interpolator(d3.interpolateRgb('#E6F1FB','#173657'))

    const svg = d3.select(el); svg.selectAll('*').remove()
    const g = svg.append('g').attr('transform',`translate(${PAD.left},${PAD.top})`)

    g.selectAll('path').data(bins).join('path')
      .attr('d', hexbin.hexagon())
      .attr('transform',d=>`translate(${d.x},${d.y})`)
      .attr('fill',d=>colorSc(d.length))
      .attr('stroke','#fff').attr('stroke-width',1)
      .style('cursor','pointer')
      .on('mouseover',(e,d)=>{
        const names = d.map(p=>p.name)
        setTooltip({x:e.offsetX,y:e.offsetY,names,count:d.length})
      })
      .on('mousemove',(e)=>setTooltip(t=>t?{...t,x:e.offsetX,y:e.offsetY}:null))
      .on('mouseout',()=>setTooltip(null))

    // Dots
    g.selectAll('circle').data(filtered).join('circle')
      .attr('cx',d=>xSc(d.gp)).attr('cy',d=>ySc(d.avgElo))
      .attr('r',2).attr('fill','#173657').attr('opacity',0.4).attr('pointer-events','none')

    // Axes
    const xAxis = d3.axisBottom(xSc).ticks(5).tickFormat(d=>Math.round(d).toLocaleString())
    const yAxis = d3.axisLeft(ySc).ticks(4).tickFormat(d=>Math.round(d).toLocaleString())
    g.append('g').attr('transform',`translate(0,${PH})`).call(xAxis).selectAll('text').attr('fill','#aaa').attr('font-size',9)
    g.append('g').call(yAxis).selectAll('text').attr('fill','#aaa').attr('font-size',9)
    g.append('text').attr('x',PW/2).attr('y',PH+38).attr('text-anchor','middle').attr('font-size',11).attr('font-weight',600).attr('fill','#173657').attr('font-family','Inter,sans-serif').text('Games Played')
    g.append('text').attr('transform','rotate(-90)').attr('x',-PH/2).attr('y',-42).attr('text-anchor','middle').attr('font-size',11).attr('font-weight',600).attr('fill','#173657').attr('font-family','Inter,sans-serif').text('Avg Elo')

  }, [points, minPeak])

  // Load d3-hexbin if needed
  useEffect(() => {
    if (window.d3 && !window.d3.hexbin) {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/d3-hexbin@0.2.2/build/d3-hexbin.min.js'
      s.onload = () => { if(window.d3Hexbin) window.d3.hexbin = window.d3Hexbin }
      document.head.appendChild(s)
    }
  }, [])

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Min Peak Elo:</span>
        <input type="range" min={pkMin} max={pkMax} value={minPeak || pkMin} step={10}
          style={{ width: 140 }} onChange={e => setMinPeak(+e.target.value)} />
        <span style={{ fontSize: 11, color: '#173657', fontWeight: 500 }}>{Math.round(minPeak || pkMin).toLocaleString()}</span>
        <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>
          Cell color = player density &nbsp;
          <span style={{ display:'inline-block',width:40,height:7,borderRadius:3,background:'linear-gradient(to right,#E6F1FB,#173657)',verticalAlign:'middle' }} />
        </span>
      </div>
      <svg ref={svgRef} style={{ width: '100%', display: 'block', height: 320 }} />
      {tooltip && (
        <div style={{ position: 'absolute', left: tooltip.x + 10, top: tooltip.y - 50, background: '#fff', border: '0.5px solid #e0e0e0', borderRadius: 8, padding: '8px 12px', fontSize: 12, pointerEvents: 'none', zIndex: 10, maxWidth: 200 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{tooltip.count} player{tooltip.count > 1 ? 's' : ''}</div>
          <div style={{ color: '#888', fontSize: 11 }}>{tooltip.names.join(', ')}</div>
        </div>
      )}
    </div>
  )
}

// -- Constellation -------------------------------------------------------------
function Constellation({ points }) {
  const canvasRef = useRef(null)
  const [posMode,  setPosMode]  = useState('ls_gp')
  const [showLines,setShowLines]= useState(true)
  const [tooltip,  setTooltip]  = useState(null)
  const posRef = useRef({})

  const W = 640, H = 340

  const lsExt  = useMemo(() => [Math.min(...points.map(p=>p.legendScore)), Math.max(...points.map(p=>p.legendScore))], [points])
  const gpExt  = useMemo(() => [Math.min(...points.map(p=>p.gp)), Math.max(...points.map(p=>p.gp))], [points])
  const avgExt = useMemo(() => [Math.min(...points.map(p=>p.avgElo)), Math.max(...points.map(p=>p.avgElo))], [points])
  const pkExt  = useMemo(() => [Math.min(...points.map(p=>p.peakElo)), Math.max(...points.map(p=>p.peakElo))], [points])

  const rScale = gp => 4 + ((gp - gpExt[0]) / (gpExt[1] - gpExt[0] || 1)) * 14
  const brightness = ls => 0.3 + ((ls - lsExt[0]) / (lsExt[1] - lsExt[0] || 1)) * 0.7

  const computePositions = useCallback((mode) => {
    const pos = {}
    const norm = (v, mn, mx) => (v - mn) / (mx - mn || 1)
    points.forEach(p => {
      let x, y
      if (mode === 'ls_gp') {
        x = 60 + norm(p.legendScore, lsExt[0], lsExt[1]) * (W - 120) + (Math.random() - 0.5) * 30
        y = 30 + (1 - norm(p.gp, gpExt[0], gpExt[1])) * (H - 70) + (Math.random() - 0.5) * 20
      } else if (mode === 'avg_peak') {
        x = 60 + norm(p.peakElo, pkExt[0], pkExt[1]) * (W - 120) + (Math.random() - 0.5) * 20
        y = 30 + (1 - norm(p.avgElo, avgExt[0], avgExt[1])) * (H - 70) + (Math.random() - 0.5) * 20
      } else {
        x = 60 + Math.random() * (W - 120)
        y = 30 + Math.random() * (H - 70)
      }
      pos[p.name] = { x, y }
    })
    return pos
  }, [points, lsExt, gpExt, pkExt, avgExt])

  useEffect(() => {
    posRef.current = computePositions(posMode)
    draw()
  }, [posMode, points])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const pos = posRef.current
    ctx.clearRect(0, 0, W, H)

    // Sky background
    ctx.fillStyle = '#080c18'
    ctx.fillRect(0, 0, W, H)

    // Background stars
    for (let i = 0; i < 150; i++) {
      const x = (i * 137.5) % W, y = (i * 97.3) % H
      ctx.fillStyle = `rgba(255,255,255,${0.05 + (i%5)*0.03})`
      ctx.beginPath(); ctx.arc(x, y, i%10<1?1.2:0.4, 0, Math.PI*2); ctx.fill()
    }

    // Teammate lines
    if (showLines) {
      points.forEach(p => {
        points.forEach(q => {
          if (p.name >= q.name) return
          // Connect if similar era (within 200 avg elo of each other) ? proxy for teammates
          if (Math.abs(p.avgElo - q.avgElo) < 150 && Math.abs(p.gp - q.gp) < 400) {
            const pp = pos[p.name], qp = pos[q.name]
            if (!pp || !qp) return
            ctx.strokeStyle = 'rgba(104,150,189,0.18)'
            ctx.lineWidth = 0.8
            ctx.setLineDash([3, 4])
            ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(qp.x, qp.y); ctx.stroke()
          }
        })
      })
      ctx.setLineDash([])
    }

    // Stars
    points.forEach(p => {
      const pp = pos[p.name]; if (!pp) return
      const r = rScale(p.gp)
      const b = brightness(p.legendScore)

      // Glow
      ctx.fillStyle = `rgba(104,150,189,${b * 0.3})`
      ctx.beginPath(); ctx.arc(pp.x, pp.y, r + 5, 0, Math.PI*2); ctx.fill()

      // Star
      const ri = Math.round(133 + b * 122), gi = Math.round(180 + b * 75), bi2 = Math.round(221 + b * 34)
      ctx.fillStyle = `rgba(${ri},${gi},${bi2},${b})`
      ctx.beginPath(); ctx.arc(pp.x, pp.y, r, 0, Math.PI*2); ctx.fill()

      // Label for bright/large stars
      if (b > 0.55 || r > 12) {
        ctx.fillStyle = `rgba(180,210,240,${b * 0.8})`
        ctx.font = `${Math.round(8 + b*3)}px Inter,sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(p.name.split(' ').pop(), pp.x, pp.y - r - 5)
      }
    })

    // Axis labels
    ctx.fillStyle = 'rgba(100,140,180,0.4)'
    ctx.font = '10px Inter,sans-serif'
    ctx.textAlign = 'center'
    if (posMode === 'ls_gp') {
      ctx.fillText('Legend Score ?', W/2, H-6)
      ctx.save(); ctx.translate(12, H/2); ctx.rotate(-Math.PI/2); ctx.fillText('Games Played ?', 0, 0); ctx.restore()
    } else if (posMode === 'avg_peak') {
      ctx.fillText('Peak Elo ?', W/2, H-6)
      ctx.save(); ctx.translate(12, H/2); ctx.rotate(-Math.PI/2); ctx.fillText('Avg Elo ?', 0, 0); ctx.restore()
    }
  }, [points, showLines, posMode, lsExt, gpExt])

  useEffect(() => { draw() }, [showLines, draw])

  const handleMouseMove = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = W / rect.width
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top) * (H / rect.height)
    const pos = posRef.current
    let closest = null, minD = 999
    points.forEach(p => {
      const pp = pos[p.name]; if (!pp) return
      const d = Math.hypot(mx - pp.x, my - pp.y)
      if (d < minD && d < rScale(p.gp) + 8) { minD = d; closest = p }
    })
    setTooltip(closest ? { x: e.clientX - rect.left, y: e.clientY - rect.top, p: closest } : null)
  }, [points])

  const btnStyle = m => ({
    fontSize: 11, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
    border: '0.5px solid rgba(104,150,189,0.4)', fontFamily: "'Inter',sans-serif",
    background: posMode === m ? '#173657' : 'transparent',
    color: posMode === m ? '#fff' : 'rgba(150,180,220,0.7)',
  })

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 5, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#aaa' }}>Position by:</span>
        {[['ls_gp','Legend Score x GP'],['avg_peak','Avg x Peak Elo'],['random','Random sky']].map(([m,l]) => (
          <button key={m} style={btnStyle(m)} onClick={() => setPosMode(m)}>{l}</button>
        ))}
        <label style={{ display:'flex',alignItems:'center',gap:4,fontSize:11,color:'#aaa',marginLeft:6,cursor:'pointer' }}>
          <input type="checkbox" checked={showLines} onChange={e=>setShowLines(e.target.checked)} />
          Connection lines
        </label>
      </div>
      <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden' }}>
        <canvas ref={canvasRef} width={W} height={H}
          style={{ width:'100%',display:'block',cursor:'crosshair' }}
          onMouseMove={handleMouseMove} onMouseLeave={()=>setTooltip(null)} />
        {tooltip && (
          <div style={{ position:'absolute',left:tooltip.x+12,top:tooltip.y-44,background:'rgba(8,12,24,0.95)',border:'0.5px solid #2a3a6a',borderRadius:8,padding:'8px 12px',fontSize:12,pointerEvents:'none',zIndex:10,whiteSpace:'nowrap' }}>
            <div style={{ fontWeight:600,color:'#a0c8ff' }}>{tooltip.p.name}</div>
            <div style={{ color:'#6896bd' }}>GP {tooltip.p.gp} ? Avg {tooltip.p.avgElo} ? Peak {tooltip.p.peakElo}</div>
            <div style={{ color:'#ffd700' }}>Legend Score {Math.round(tooltip.p.legendScore).toLocaleString()}</div>
          </div>
        )}
      </div>
      <div style={{ display:'flex',gap:16,marginTop:6,fontSize:11,color:'#aaa' }}>
        <span>Brightness = Legend Score</span>
        <span>Size = Games Played</span>
      </div>
    </div>
  )
}

export default function FranchiseTenures({ players, onSelectPlayer }) {
  const [franchise, setFranchise] = useState('LAL')
  useEffect(() => { loadThree(); loadD3() }, [])
  const [hovered,   setHovered]   = useState(null)
  const [vizMode,    setVizMode]   = useState('scatter')
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
      border: '0.5px solid ' + (active ? '#173657' : '#e0e0e0'),
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
                  border: '0.5px solid ' + (!franchise && league === l ? '#173657' : '#e0e0e0'),
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
            <p style={s.pageDesc}>{points.length} players ? min {MIN_GP} GP ? sorted by Legend Score</p>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {[['scatter','Scatter'],['cube','3D Cube'],['parallel','Parallel'],['bubbles','Bubbles'],['hexbin','Hexbin'],['constellation','Stars']].map(([v,label]) => (
              <button key={v}
                onClick={() => setVizMode(v)}
                style={{
                  background: vizMode === v ? '#173657' : 'transparent',
                  border: '0.5px solid #e0e0e0', borderRadius: 6, padding: '4px 10px',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  color: vizMode === v ? '#fff' : '#888',
                  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                }}
              >{label}</button>
            ))}
          </div>
          {hovered && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{hovered.name}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {hovered.gp} GP ? Avg {hovered.avgElo.toLocaleString()} Elo ? Peak {hovered.peakElo.toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: teamColor, fontWeight: 600 }}>
                Legend Score: {Math.round(hovered.legendScore).toLocaleString()} ? #{hovered.rank}
              </div>
            </div>
          )}
        </div>

        <div style={s.body}>
          <div style={s.plotArea}>
            {vizMode === 'cube'          ? <Plot3D points={points} />
              : vizMode === 'parallel'    ? <ParallelCoords points={points} />
              : vizMode === 'bubbles'     ? <ForceBubbles points={points} />
              : vizMode === 'hexbin'      ? <HexbinMap points={points} />
              : vizMode === 'constellation' ? <Constellation points={points} />
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
  </div>
  )
}
