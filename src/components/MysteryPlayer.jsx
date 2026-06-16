import { useState, useMemo, useRef, useEffect, useCallback } from 'react'

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

const ALL_FRANCHISES = Object.keys(FRANCHISE_NAMES)
const MAX_GUESSES = 5

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
}

function playerFranchises(hist) {
  const teams = new Set(hist.map(e => e[4]||'').filter(Boolean))
  const out = new Set()
  for (const [fk, aliases] of Object.entries(FRANCHISE_ALIASES)) {
    if ([...teams].some(t => aliases.includes(t))) out.add(fk)
  }
  return out
}

function playerRookieYear(hist) { return hist[0]?.[0]?.slice(0,4) }
function playerAvgElo(hist) {
  if (!hist.length) return 0
  return Math.round(hist.reduce((s,e) => s+e[1], 0) / hist.length)
}

function buildClues(wrongGuesses, mystery) {
  const mHist   = mystery.elo_history || []
  const mPeak   = Math.round(Math.max(...mHist.map(e=>e[1])))
  const mAvg    = playerAvgElo(mHist)
  const mStart  = parseInt(playerRookieYear(mHist)||0)
  const mFranch = playerFranchises(mHist)
  let peakMin = 0, peakMax = 99999, startMin = 0, startMax = 99999
  const ruledOut = new Set(), confirmed = new Set()

  for (const g of wrongGuesses) {
    if (!g.player) continue
    const gHist   = g.player.elo_history || []
    const gPeak   = Math.round(Math.max(...gHist.map(e=>e[1])))
    const gStart  = parseInt(playerRookieYear(gHist)||0)
    const gFranch = playerFranchises(gHist)
    if (mPeak > gPeak) peakMin = Math.max(peakMin, gPeak+1)
    if (mPeak < gPeak) peakMax = Math.min(peakMax, gPeak-1)
    if (mStart > gStart) startMin = Math.max(startMin, gStart+1)
    if (mStart < gStart) startMax = Math.min(startMax, gStart-1)
    for (const f of ALL_FRANCHISES) {
      if (gFranch.has(f) && !mFranch.has(f)) ruledOut.add(f)
      if (gFranch.has(f) && mFranch.has(f))  confirmed.add(f)
    }
  }
  return { peakMin, peakMax, startMin, startMax, ruledOut, confirmed }
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function drawChart(svg, hist, round, W, H, spagData, wrongGuesses = []) {
  while (svg.firstChild) svg.removeChild(svg.firstChild)
  const ns = 'http://www.w3.org/2000/svg'
  const PAD = { top:16, right:16, bottom: round>=2 ? 28 : 8, left:44 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const elos  = hist.map(e=>e[1])
  const minE  = Math.min(...elos)-60, maxE = Math.max(...elos)+60
  const n = hist.length
  const xS = i => PAD.left + (i/(n-1))*plotW
  const yS = v => PAD.top + plotH - ((v-minE)/(maxE-minE))*plotH

  if (spagData) {
    const {dates:sd, players:sp} = spagData
    const startDate = hist[0][0], endDate = hist[hist.length-1][0]
    const si = sd.findIndex(d=>d>=startDate)
    const ei = sd.findLastIndex ? sd.findLastIndex(d=>d<=endDate) : sd.reduce((a,d,i)=>d<=endDate?i:a,-1)
    if (si>=0 && ei>si) {
      sp.forEach(pts => {
        const filtered = pts.filter(([idx])=>idx>=si&&idx<=ei)
        if (filtered.length<2) return
        const d = filtered.map(([idx,sv],k)=>{
          const x = PAD.left+(idx-si)/(ei-si)*plotW
          const y = PAD.top+plotH-((sv-minE)/(maxE-minE))*plotH
          return `${k===0?'M':'L'}${x.toFixed(1)},${Math.max(PAD.top,Math.min(PAD.top+plotH,y)).toFixed(1)}`
        }).join(' ')
        const p = document.createElementNS(ns,'path')
        p.setAttribute('d',d); p.setAttribute('fill','none')
        p.setAttribute('stroke','rgba(150,150,150,0.08)'); p.setAttribute('stroke-width','1')
        svg.appendChild(p)
      })
    }
  }

  for (const v of [1500,1700,1900,2100,2300,2500,2700,2900,3100]) {
    if (v<minE||v>maxE) continue
    const y = yS(v)
    const l = document.createElementNS(ns,'line')
    l.setAttribute('x1',PAD.left); l.setAttribute('y1',y)
    l.setAttribute('x2',W-PAD.right); l.setAttribute('y2',y)
    l.setAttribute('stroke','rgba(0,0,0,0.06)'); l.setAttribute('stroke-width','0.5')
    svg.appendChild(l)
    const t = document.createElementNS(ns,'text')
    t.setAttribute('x',PAD.left-4); t.setAttribute('y',y+4)
    t.setAttribute('font-size','9'); t.setAttribute('fill','rgba(0,0,0,0.2)')
    t.setAttribute('text-anchor','end'); t.setAttribute('font-family','sans-serif')
    t.textContent = v; svg.appendChild(t)
  }

  if (round>=2) {
    let lastYr = null
    hist.forEach((e,i)=>{
      const yr = e[0].slice(0,4)
      if (yr===lastYr) return; lastYr=yr
      if (parseInt(yr)%3!==0) return
      const t = document.createElementNS(ns,'text')
      t.setAttribute('x',xS(i)); t.setAttribute('y',H-4)
      t.setAttribute('font-size','9'); t.setAttribute('fill','rgba(0,0,0,0.3)')
      t.setAttribute('text-anchor','middle'); t.setAttribute('font-family','sans-serif')
      t.textContent=yr; svg.appendChild(t)
    })
  }

  // Wrong guess overlay lines
  if (wrongGuesses.length > 0) {
    const WRONG_COLORS = ['#c94040','#e07020','#9040c9','#207090','#809040']
    wrongGuesses.forEach((g, gi) => {
      const gh = g.player?.elo_history
      if (!gh?.length) return
      const color = WRONG_COLORS[gi % WRONG_COLORS.length]
      const pts = []
      gh.forEach(e => {
        // Map date to x position by finding closest date in mystery hist
        let best = 0, bestDiff = Infinity
        hist.forEach((me, mi) => {
          const diff = Math.abs(new Date(e[0]) - new Date(me[0]))
          if (diff < bestDiff) { bestDiff = diff; best = mi }
        })
        if (bestDiff < 90 * 86400000) {  // within 90 days
          pts.push([best, e[1]])
        }
      })
      if (pts.length < 2) return
      // Sort by x
      pts.sort((a,b) => a[0]-b[0])
      const d = pts.map(([xi,v],k) => `${k===0?'M':'L'}${xS(xi).toFixed(1)},${yS(v).toFixed(1)}`).join(' ')
      const p = document.createElementNS(ns,'path')
      p.setAttribute('d',d); p.setAttribute('fill','none')
      p.setAttribute('stroke',color); p.setAttribute('stroke-width','1.5')
      p.setAttribute('stroke-dasharray','3,3')
      p.setAttribute('opacity','0.5')
      svg.appendChild(p)
    })
  }

  const drawSeg = (pts, s0, color) => {
    if (pts.length<2) return
    const d = pts.map((e,k)=>`${k===0?'M':'L'}${xS(s0+k).toFixed(1)},${yS(e[1]).toFixed(1)}`).join(' ')
    const p = document.createElementNS(ns,'path')
    p.setAttribute('d',d); p.setAttribute('fill','none')
    p.setAttribute('stroke',color); p.setAttribute('stroke-width','2.5')
    p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-linejoin','round')
    svg.appendChild(p)
  }

  if (round>=3) {
    let seg=[],s0=0,curT=hist[0]?.[4]||''
    hist.forEach((e,i)=>{
      const t=e[4]||''
      if (t!==curT){ seg.push(e); drawSeg(seg,s0,TEAM_COLORS[curT]||'#173657'); seg=[e]; s0=i; curT=t } else seg.push(e)
    })
    drawSeg(seg,s0,TEAM_COLORS[curT]||'#173657')
  } else {
    drawSeg(hist,0,'#173657')
  }

  const last=hist[hist.length-1]
  const dot=document.createElementNS(ns,'circle')
  dot.setAttribute('cx',xS(n-1)); dot.setAttribute('cy',yS(last[1]))
  dot.setAttribute('r','4')
  dot.setAttribute('fill',round>=3?(TEAM_COLORS[last[4]||'']||'#173657'):'#173657')
  svg.appendChild(dot)
}

function MysteryChart({ player, round, wrongGuesses = [] }) {
  const svgRef  = useRef(null)
  const wrapRef = useRef(null)
  const [tooltip,setTooltip] = useState(null)
  const [spag,setSpag]       = useState(null)
  const animRef = useRef(null)
  const hist = player?.elo_history || []

  useEffect(()=>{
    let c=false
    fetch('/data/spaghetti.json').then(r=>r.json()).then(d=>{if(!c)setSpag(d)}).catch(()=>{})
    return ()=>{c=true}
  },[])

  useEffect(()=>{
    if (!svgRef.current||!wrapRef.current||!hist.length) return
    const W = wrapRef.current.clientWidth||640, H=230
    svgRef.current.setAttribute('viewBox',`0 0 ${W} ${H}`)
    setTooltip(null)
    let frame=0
    const animate=()=>{
      if (!svgRef.current) return
      if (frame>=45){
        drawChart(svgRef.current,hist,round,W,H,spag,wrongGuesses)
        addHits(svgRef.current,hist,round,W,H)
        return
      }
      const t=frame/45, ease=1-Math.pow(1-t,3)
      const noisy=hist.map(e=>[e[0],e[1]+(Math.random()-.5)*150*(1-ease),...e.slice(2)])
      drawChart(svgRef.current,noisy,round,W,H,null)
      frame++
      animRef.current=requestAnimationFrame(animate)
    }
    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current=requestAnimationFrame(animate)
    return ()=>{if(animRef.current)cancelAnimationFrame(animRef.current)}
  },[player?.name,round,spag,wrongGuesses.length])

  const addHits=(svg,hist,round,W,H)=>{
    const ns='http://www.w3.org/2000/svg'
    const PAD={top:16,right:16,bottom:round>=2?28:8,left:44}
    const plotH=H-PAD.top-PAD.bottom, n=hist.length
    const xS=i=>PAD.left+(i/(n-1))*(W-PAD.left-PAD.right)
    const elos=hist.map(e=>e[1])
    const minE=Math.min(...elos)-60,maxE=Math.max(...elos)+60
    const yS=v=>PAD.top+plotH-((v-minE)/(maxE-minE))*plotH
    hist.forEach((e,i)=>{
      if (i%4!==0) return
      const hit=document.createElementNS(ns,'circle')
      hit.setAttribute('cx',xS(i)); hit.setAttribute('cy',yS(e[1]))
      hit.setAttribute('r','10'); hit.setAttribute('fill','transparent')
      hit.setAttribute('style','cursor:crosshair')
      hit.addEventListener('mouseenter',()=>{
        const info={elo:Math.round(e[1])}
        if (round>=2) info.date=e[0]
        if (round>=3) info.team=e[4]||''
        setTooltip({x:xS(i),y:yS(e[1]),svgW:W,...info})
      })
      hit.addEventListener('mouseleave',()=>setTooltip(null))
      svg.appendChild(hit)
    })
  }

  return (
    <div ref={wrapRef} style={{background:'#f4f4f4',borderRadius:12,border:'0.5px solid #e0e0e0',padding:'12px 8px 4px',position:'relative'}}>
      <svg ref={svgRef} style={{width:'100%',display:'block',height:230}} />
      {tooltip&&(
        <div style={{
          position:'absolute',
          left:`${(tooltip.x/(tooltip.svgW||640))*100}%`,
          top:`${(tooltip.y/230)*100}%`,
          transform:tooltip.x>(tooltip.svgW||640)*0.65?'translate(-110%,-50%)':'translate(10%,-50%)',
          background:'#fff',color:'#1a1a1a',borderRadius:8,padding:'8px 12px',border:'0.5px solid #e0e0e0',
          fontSize:12,lineHeight:1.7,pointerEvents:'none',zIndex:10,
          boxShadow:'0 4px 16px rgba(0,0,0,0.8)',whiteSpace:'nowrap',border:'0.5px solid #e0e0e0',
        }}>
          <div>Elo <span style={{color:'#6896bd',fontWeight:600}}>{tooltip.elo.toLocaleString()}</span></div>
          {tooltip.date&&<div style={{color:'#888'}}>{tooltip.date.slice(5,7)}/{tooltip.date.slice(8,10)}/{tooltip.date.slice(0,4)}</div>}
          {tooltip.team&&<div style={{color:TEAM_COLORS[tooltip.team]||'#ccc'}}>{tooltip.team}</div>}
        </div>
      )}
    </div>
  )
}

function GuessInput({ players, onGuess, disabled, usedNames }) {
  const [val,setVal]=useState('')
  const [suggs,setSuggs]=useState([])
  const onChange=e=>{
    const q=e.target.value; setVal(q)
    if (q.length<2){setSuggs([]);return}
    const nq=normalize(q)
    setSuggs(players.filter(p=>normalize(p.name).includes(nq)&&!usedNames.has(p.name)).slice(0,7))
  }
  const submit=name=>{
    const n=name||val; if(!n.trim()) return
    setVal(''); setSuggs([]); onGuess(n.trim())
  }
  return (
    <div style={{position:'relative',width:'100%'}}>
      <div style={{display:'flex',gap:8}}>
        <input value={val} onChange={onChange} disabled={disabled}
          onKeyDown={e=>e.key==='Enter'&&val&&submit()}
          placeholder="Name your suspect..."
          style={{flex:1,border:'0.5px solid #e0e0e0',borderRadius:8,padding:'12px 16px',fontSize:14,
            fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif",outline:'none',background:'#f0f0f0',color:'#1a1a1a'}}
        />
        <button onClick={()=>submit()} disabled={disabled||!val.trim()}
          style={{background:disabled||!val.trim()?'#e0e0e0':'#173657',color:disabled||!val.trim()?'#aaa':'#fff',
            border:'none',borderRadius:8,padding:'12px 24px',fontSize:14,fontWeight:700,cursor:'pointer',
            fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif"}}>
          Accuse
        </button>
      </div>
      {suggs.length>0&&(
        <div style={{position:'absolute',top:'100%',left:0,right:80,zIndex:30,
          background:'#f0f0f0',border:'0.5px solid #e0e0e0',borderRadius:8,
          boxShadow:'0 8px 24px rgba(0,0,0,0.8)',marginTop:4,overflow:'hidden'}}>
          {suggs.map(p=>(
            <div key={p.name} onClick={()=>submit(p.name)}
              style={{padding:'10px 14px',cursor:'pointer',fontSize:14,borderBottom:'0.5px solid #333',color:'#1a1a1a'}}
              onMouseEnter={e=>e.currentTarget.style.background='#f4f4f4'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}
            >{p.name}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function CluesSidebar({ guesses, mystery, round, visibleGuesses = new Set(), onToggle }) {
  if (!mystery) return null
  const wrongGuesses = guesses.filter(g=>!g.correct)
  const clues = buildClues(wrongGuesses, mystery)
  const mFranch = playerFranchises(mystery.elo_history||[])
  const mPeak   = Math.round(Math.max(...(mystery.elo_history||[]).map(e=>e[1])))
  const mAvg    = playerAvgElo(mystery.elo_history||[])

  if (!wrongGuesses.length) return (
    <div style={{padding:'20px 16px',color:'#aaa',fontSize:13,textAlign:'center'}}>
      <div style={{fontSize:28,marginBottom:8}}>🗂</div>
      <div>Make a guess to start building the case file</div>
    </div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',gap:0,overflow:'auto',flex:1}}>
      <div style={{padding:'12px 14px 0'}}>
        <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:1,color:'#aaa',marginBottom:10}}>Ruled Out</div>
        {wrongGuesses.map((g,i)=>{
          if (!g.player) return (
            <div key={i} style={{background:'#fff5f5',border:'0.5px solid #f0d0d0',borderRadius:8,padding:'10px 12px',marginBottom:8}}>
              <div style={{fontSize:13,color:'#c94040',fontWeight:600}}>✗ {g.name}</div>
              <div style={{fontSize:11,color:'#888'}}>Not found</div>
            </div>
          )
          const gHist  = g.player.elo_history||[]
          const gPeak  = Math.round(Math.max(...gHist.map(e=>e[1])))
          const gAvg   = playerAvgElo(gHist)
          const gStart = playerRookieYear(gHist)
          const gEnd   = gHist[gHist.length-1]?.[0]?.slice(0,4)
          const gFranch= playerFranchises(gHist)
          const mStart = mystery.elo_history[0]?.[0]?.slice(0,4)
          const peakDir = mPeak>gPeak?'↑ Higher':mPeak<gPeak?'↓ Lower':'= Same'
          const peakClr = mPeak>gPeak?'#ff9944':mPeak<gPeak?'#44aaff':'#173657'
          const avgDir  = mAvg>gAvg?'↑ Higher':mAvg<gAvg?'↓ Lower':'= Same'
          const avgClr  = mAvg>gAvg?'#ff9944':mAvg<gAvg?'#44aaff':'#173657'
          return (
            <div key={i} style={{background:'#fff5f5',border:'0.5px solid #f0d0d0',borderRadius:8,padding:'10px 12px',marginBottom:8}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <div style={{fontSize:13,color:'#c94040',fontWeight:600}}>✗ {g.name}</div>
                <button
                  onClick={()=>onToggle(g.name)}
                  style={{
                    background: visibleGuesses.has(g.name) ? '#c9404022' : 'transparent',
                    border: `0.5px solid ${visibleGuesses.has(g.name) ? '#c94040' : '#e0e0e0'}`,
                    borderRadius:6, padding:'2px 8px', fontSize:10, cursor:'pointer',
                    color: visibleGuesses.has(g.name) ? '#c94040' : '#aaa',
                    fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif", whiteSpace:'nowrap',
                  }}
                >{visibleGuesses.has(g.name) ? '● Hide' : '○ Show'}</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4,marginBottom:6}}>
                <div style={{fontSize:11}}>
                  <span style={{color:'#888'}}>Peak </span>
                  <span style={{color:'#ffd700'}}>{gPeak.toLocaleString()}</span>
                  <span style={{color:peakClr,marginLeft:4,fontSize:10}}>{peakDir}</span>
                </div>
                <div style={{fontSize:11}}>
                  <span style={{color:'#888'}}>Avg </span>
                  <span style={{color:'#888'}}>{gAvg.toLocaleString()}</span>
                  <span style={{color:avgClr,marginLeft:4,fontSize:10}}>{avgDir}</span>
                </div>
              </div>
              {round>=2&&(
                <div style={{fontSize:11,color:'#888',marginBottom:6}}>
                  {gStart}–{gEnd}
                  {mStart&&<span style={{marginLeft:6,color:mStart>gStart?'#ff9944':mStart<gStart?'#44aaff':'#173657',fontSize:10}}>
                    {mStart>gStart?'↑ Later start':mStart<gStart?'↓ Earlier start':'= Same era'}
                  </span>}
                </div>
              )}
              {round>=3&&(
                <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                  {[...gFranch].map(f=>{
                    const shared=mFranch.has(f)
                    return (
                      <span key={f} style={{
                        fontSize:10,padding:'1px 5px',borderRadius:4,fontWeight:600,
                        background:shared?(TEAM_COLORS[f]||'#555')+'22':'#0f0f0f',
                        color:shared?(TEAM_COLORS[f]||'#aaa'):'#333',
                        border:`0.5px solid ${shared?(TEAM_COLORS[f]||'#555')+'44':'#222'}`,
                        textDecoration:shared?'none':'line-through',opacity:shared?1:0.5,
                      }}>{f}</span>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>


    </div>
  )
}

function FiltersScreen({ players, onSelect, onBack }) {
  const [rookieYear,setRookieYear] = useState('')
  const [minPeak,setMinPeak]       = useState('')
  const [minGP,setMinGP]           = useState(100)
  const [franchises,setFranchises] = useState([])
  const toggle=(arr,set,v)=>set(arr.includes(v)?arr.filter(x=>x!==v):[...arr,v])

  const pool = useMemo(()=>players.filter(p=>{
    const h=p.elo_history||[]
    if (h.length<minGP) return false
    if (rookieYear&&parseInt(playerRookieYear(h)||0)<parseInt(rookieYear)) return false
    if (minPeak&&(p.peak_elo||0)<parseInt(minPeak)) return false
    if (franchises.length>0){
      const pf=playerFranchises(h)
      if (!franchises.some(f=>pf.has(f))) return false
    }
    return true
  }),[players,rookieYear,minPeak,minGP,franchises])

  return (
    <div style={{display:'flex',flex:1,flexDirection:'column',overflow:'hidden',background:'#f4f4f4',fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif"}}>
      <div style={{padding:'16px 24px',borderBottom:'0.5px solid #e0e0e0',display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#888',cursor:'pointer',fontSize:13}}>← Back</button>
        <div style={{fontFamily:"'Georgia', serif",fontSize:20,color:'#1a1a1a'}}>Filter the Suspect Pool</div>
      </div>
      <div style={{flex:1,overflow:'auto',padding:24}}>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:1,color:'#888',marginBottom:10}}>Franchise Filter <span style={{color:'#bbb',fontWeight:400}}>(optional)</span></div>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {ALL_FRANCHISES.map(f=>(
              <button key={f}
                style={{background:franchises.includes(f)?'#173657':'transparent',
                  border:`0.5px solid ${franchises.includes(f)?'#173657':'#e0e0e0'}`,
                  borderRadius:20,padding:'4px 10px',fontSize:11,
                  fontWeight:franchises.includes(f)?700:400,
                  color:franchises.includes(f)?'#fff':'#555',
                  cursor:'pointer',fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif"}}
                onClick={()=>toggle(franchises,setFranchises,f)}>{FRANCHISE_NAMES[f]}</button>
            ))}
          </div>
        </div>

        <div style={{display:'flex',gap:24,marginBottom:32}}>
          {[
            {label:'Min Rookie Year',val:rookieYear,set:setRookieYear,ph:'e.g. 1984'},
            {label:'Min Peak Elo',val:minPeak,set:setMinPeak,ph:'e.g. 2200'},
          ].map(({label,val,set,ph})=>(
            <div key={label}>
              <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:1,color:'#888',marginBottom:8}}>{label}</div>
              <input type="number" value={val} onChange={e=>set(e.target.value)} placeholder={ph}
                style={{background:'#f0f0f0',border:'0.5px solid #e0e0e0',borderRadius:8,padding:'10px 14px',
                  fontSize:14,color:'#1a1a1a',outline:'none',fontFamily:"'Consolas', 'Monaco', monospace",width:120}} />
            </div>
          ))}
          <div>
            <div style={{fontSize:11,textTransform:'uppercase',letterSpacing:1,color:'#888',marginBottom:8}}>Min Career Games</div>
            <input type="number" value={minGP} onChange={e=>setMinGP(Math.max(1,parseInt(e.target.value)||1))}
              style={{background:'#f0f0f0',border:'0.5px solid #e0e0e0',borderRadius:8,padding:'10px 14px',
                fontSize:14,color:'#1a1a1a',outline:'none',fontFamily:"'Consolas', 'Monaco', monospace",width:80}} />
          </div>
        </div>

        <button onClick={()=>pool.length&&onSelect(pool[Math.floor(Math.random()*pool.length)])} disabled={!pool.length}
          style={{background:pool.length?'#173657':'#e0e0e0',color:pool.length?'#fff':'#aaa',
            border:'none',borderRadius:12,padding:'16px 40px',fontSize:16,fontWeight:700,
            cursor:pool.length?'pointer':'not-allowed',fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif"}}>
          {pool.length?`Pick from ${pool.length.toLocaleString()} suspects →`:'No players match'}
        </button>
      </div>
    </div>
  )
}

function LandingScreen({ onQuick, onFilter }) {
  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      padding:40,background:'#f4f4f4',fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif"}}>
      <div style={{textAlign:'center',maxWidth:500}}>
        <div style={{fontSize:72,marginBottom:16}}>🔍</div>
        <h1 style={{fontFamily:"'Georgia', serif",fontSize:40,color:'#1a1a1a',marginBottom:12,letterSpacing:-1}}>
          Mystery Player
        </h1>
        <p style={{fontSize:15,color:'#888',lineHeight:1.7,marginBottom:36}}>
          A mystery player's Elo career chart is hidden behind the fog. Study the shape, cross-reference the evidence, and name your suspect. You have <span style={{color:'#ffd700',fontWeight:600}}>5 guesses</span>.
        </p>
        <div style={{display:'flex',gap:12,justifyContent:'center',marginBottom:32,flexWrap:'wrap'}}>
          {[
            {round:'Round 1',desc:'Shape only — no years, no teams'},
            {round:'Round 2',desc:'Years revealed on x-axis'},
            {round:'Rounds 3–5',desc:'Team colors fully revealed'},
          ].map(({round,desc})=>(
            <div key={round} style={{background:'#f4f4f4',border:'0.5px solid #e0e0e0',borderRadius:10,padding:'12px 16px',fontSize:12,color:'#888',textAlign:'left',flex:1,minWidth:130}}>
              <div style={{color:'#173657',fontWeight:600,marginBottom:4}}>{round}</div>
              <div>{desc}</div>
            </div>
          ))}
        </div>
        <button onClick={onFilter} style={{background:'#173657',color:'#fff',border:'none',borderRadius:12,
          padding:'16px 48px',fontSize:16,fontWeight:700,cursor:'pointer',
          fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif",marginBottom:12,display:'block',width:'100%'}}>
          Filter the Suspect Pool →
        </button>
        <button onClick={onQuick} style={{background:'transparent',color:'#888',border:'0.5px solid #e0e0e0',borderRadius:12,
          padding:'14px 48px',fontSize:14,cursor:'pointer',
          fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif",display:'block',width:'100%'}}>
          Quick Start (random)
        </button>
      </div>
    </div>
  )
}

export default function MysteryPlayer({ players, onSelectPlayer }) {
  const [screen, setScreen]   = useState('landing')
  const [mystery,setMystery]  = useState(null)
  const [guesses,setGuesses]  = useState([])
  const [result, setResult]   = useState(null)
  const [visibleGuesses, setVisibleGuesses] = useState(new Set())

  const round = useMemo(()=>{
    const w = guesses.filter(g=>!g.correct).length
    return w===0?1:w===1?2:3
  },[guesses])

  const usedNames = useMemo(()=>new Set(guesses.map(g=>g.name)),[guesses])

  const startGame = p => {
    setMystery(p); setGuesses([]); setResult(null); setScreen('game')
  }

  const quickStart = () => {
    const pool = players.filter(p=>(p.elo_history||[]).length>=100)
    startGame(pool[Math.floor(Math.random()*pool.length)])
  }

  const toggleGuess = name => {
    setVisibleGuesses(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleGuess = name => {
    const gp = players.find(p=>normalize(p.name)===normalize(name))
    const correct = normalize(name)===normalize(mystery.name)
    const newG = [...guesses,{name,player:gp,correct}]
    setGuesses(newG)
    if (correct) setResult('win')
    else if (newG.filter(g=>!g.correct).length>=MAX_GUESSES) setResult('lose')
  }

  const reset = () => { setScreen('landing'); setMystery(null); setGuesses([]); setResult(null) }

  if (screen==='landing') return (
    <div style={{display:'flex',flex:1,overflow:'hidden'}}>
      <LandingScreen onQuick={quickStart} onFilter={()=>setScreen('filters')} />
    </div>
  )

  if (screen==='filters') return (
    <FiltersScreen players={players} onSelect={startGame} onBack={()=>setScreen('landing')} />
  )

  const wrongGuesses = guesses.filter(g=>!g.correct)
  const guessesLeft  = MAX_GUESSES - wrongGuesses.length
  const HINTS = ['Elo shape only — no years, no teams','Years visible on x-axis','Team colors revealed']

  return (
    <div style={{display:'flex',flex:1,overflow:'hidden',background:'#f4f4f4',fontFamily:"'Inter', 'Helvetica Neue', Arial, sans-serif"}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'12px 20px',borderBottom:'1px solid #1a1a2e',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0,background:'#fff'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <span style={{fontSize:18}}>🔍</span>
            <div>
              <div style={{fontFamily:"'Georgia', serif",fontSize:17,color:'#1a1a1a'}}>Mystery Player</div>
              <div style={{fontSize:11,color:'#aaa'}}>{HINTS[Math.min(round-1,2)]}</div>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{display:'flex',gap:5,alignItems:'center'}}>
              {Array.from({length:MAX_GUESSES}).map((_,i)=>(
                <div key={i} style={{width:9,height:9,borderRadius:'50%',
                  background:i<wrongGuesses.length?'#c94040':'#e0e0e0',
                  border:'0.5px solid #e0e0e0'}} />
              ))}
              <span style={{fontSize:11,color:'#aaa',marginLeft:4}}>{guessesLeft} left</span>
            </div>
            <button onClick={reset} style={{background:'none',border:'0.5px solid #e0e0e0',borderRadius:6,
              padding:'4px 10px',fontSize:11,cursor:'pointer',color:'#888'}}>New Case</button>
          </div>
        </div>

        <div style={{padding:'16px 20px',flexShrink:0}}>
          <MysteryChart player={mystery} round={result?3:round} wrongGuesses={wrongGuesses.filter(g=>!g.correct&&visibleGuesses.has(g.name))} />
        </div>

        <div style={{padding:'0 20px 20px',flex:1,overflow:'auto'}}>
          {result==='win'&&(
            <div style={{background:'#f0f7f0',border:'0.5px solid #c0d8c0',borderRadius:12,padding:24,textAlign:'center',marginBottom:16}}>
              <div style={{fontSize:36,marginBottom:8}}>🎉</div>
              <div style={{fontFamily:"'Georgia', serif",fontSize:24,color:'#173657',marginBottom:4}}>{mystery.name}</div>
              <div style={{fontSize:13,color:'#888',marginBottom:16}}>Case solved in {guesses.length===1?'1 guess':`${guesses.length} guesses`}</div>
              <div style={{display:'flex',gap:10,justifyContent:'center'}}>
                <button onClick={()=>onSelectPlayer(mystery)} style={{background:'#173657',color:'#1a1a1a',border:'none',borderRadius:8,padding:'10px 20px',fontSize:13,fontWeight:600,cursor:'pointer'}}>View Player →</button>
                <button onClick={reset} style={{background:'transparent',border:'0.5px solid #e0e0e0',borderRadius:8,padding:'10px 20px',fontSize:13,cursor:'pointer',color:'#888'}}>New Case</button>
              </div>
            </div>
          )}
          {result==='lose'&&(
            <div style={{background:'#fff5f5',border:'0.5px solid #f0d0d0',borderRadius:12,padding:24,textAlign:'center',marginBottom:16}}>
              <div style={{fontSize:36,marginBottom:8}}>💀</div>
              <div style={{fontSize:13,color:'#888',marginBottom:4}}>The mystery player was</div>
              <div style={{fontFamily:"'Georgia', serif",fontSize:24,color:'#c94040',marginBottom:16}}>{mystery.name}</div>
              <div style={{display:'flex',gap:10,justifyContent:'center'}}>
                <button onClick={()=>onSelectPlayer(mystery)} style={{background:'#c94040',color:'#1a1a1a',border:'none',borderRadius:8,padding:'10px 20px',fontSize:13,fontWeight:600,cursor:'pointer'}}>View Player →</button>
                <button onClick={reset} style={{background:'transparent',border:'0.5px solid #e0e0e0',borderRadius:8,padding:'10px 20px',fontSize:13,cursor:'pointer',color:'#888'}}>New Case</button>
              </div>
            </div>
          )}
          {!result&&(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div style={{fontSize:12,color:'#aaa'}}>
                {round===1&&'Study the Elo shape. Who could this player be?'}
                {round===2&&'The timeline is now visible. Narrow your suspects.'}
                {round>=3&&'Team colors revealed. Make your final accusation.'}
              </div>
              <GuessInput players={players} onGuess={handleGuess} disabled={!!result} usedNames={usedNames} />
            </div>
          )}
        </div>
      </div>

      <div style={{width:260,flexShrink:0,borderLeft:'1px solid #1a1a2e',background:'#fff',display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'12px 14px 10px',borderBottom:'1px solid #1a1a2e',flexShrink:0}}>
          <div style={{fontSize:11,fontWeight:600,color:'#aaa',textTransform:'uppercase',letterSpacing:1}}>🗂 Case File</div>
        </div>
        <CluesSidebar guesses={guesses} mystery={mystery} round={round} visibleGuesses={visibleGuesses} onToggle={toggleGuess} />
      </div>
    </div>
  )
}
