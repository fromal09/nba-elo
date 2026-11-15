import { useState, useEffect, useMemo } from 'react'
import styles from './FloorTimes.module.css'
import { useAllTime, perGame } from './alltimeData'
import { Foil } from './AllTime'
import { tierFor } from './PlayerCard'
import { watchDay } from './liveFeed.js'
import { norm } from './predict'

/*
 * The Floor Times: the Scoreboard's morning paper, written from the data each day.
 *   Front page   the lead story (an upset counts most, then the night's best Game Score, then the margin), the line of the night,
 *                the biggest Elo climb and the all-time watch
 *   Last Night   a story on every game: headline, score, the Elo forecast going in, two or three paragraphs, a mini box, rank watch
 *   The Ledger   moves in the rankings by players who played (top 150), card-tier changes, every all-time move in the top 500,
 *                the season's biggest all-time climbers
 *   Tonight      a preview of every game: the forecast, projected score, each side's top two, who's out, milestone watch
 *   Milestones   all-time passes in reach tonight, card tiers on the line, No. 1 watch
 * Pregame odds for last night are the ones the Scoreboard shows (lineup Elo going in); tonight's come from the site's forecast.
 * kit: helpers from SeasonExplorer (team names, colors, the forecaster's safe game call, tip times).
 */
const TIER_LABEL = { goat: 'GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare', common: 'Common' }
const tier = r => tierFor(r).id
const pct = p => `${Math.round(p * 100)}%`
const sgn = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const word = (n, cap) => { const w = n <= 10 ? NUM[n] : String(n); return cap ? w[0].toUpperCase() + w.slice(1) : w }
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const lastName = n => { const w = baseName(n).split(' '); return /^(Jr\.|Sr\.|II|III|IV)$/.test(w.at(-1)) && w.length > 2 ? w.at(-2) : w.at(-1) }
const initials = n => baseName(n).split(' ').filter(w => !/^(Jr\.|Sr\.|II|III|IV)$/.test(w)).map(w => w[0]).join('').slice(0, 2)
const addDays = (day, k) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
const fmtDay = (d, o) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)
// Second colors for the art (the site keeps one color per team)
const ACCENT = { ATL: '#c1d32f', BOS: '#ba9653', BKN: '#ffffff', CHO: '#00788c', CHI: '#000000', CLE: '#fdbb30', DAL: '#b8c4ca', DEN: '#fec524', DET: '#1d42ba',
  GSW: '#ffc72c', HOU: '#c4ced4', IND: '#fdbb30', LAC: '#1d428a', LAL: '#fdb927', MEM: '#12173f', MIA: '#f9a01b', MIL: '#eee1c6', MIN: '#78be20', NOP: '#c8102e',
  NYK: '#f58426', OKC: '#ef3b24', ORL: '#c4ced4', PHI: '#ed174c', PHO: '#e56020', POR: '#000000', SAC: '#63727a', SAS: '#c4ced4', TOR: '#000000', UTA: '#79a3dc', WAS: '#e31837' }
const accent = t => ACCENT[t] || '#e7c160'
// One day number for the rotations: the lead art alternates by day, the game art by day and slot
const dayNum = d => Math.floor(Date.parse(d + 'T12:00:00Z') / 864e5)
const gapTxt = v => (v < 0.005 ? 'less than 0.01 points' : `${v.toFixed(2)} points`)

export default function FloorTimes({ sd, fc, shots, players, today, selectPlayer, kit }) {
  const { tName, tShort, tipTime } = kit
  const nick = t => tShort(t)
  const city = t => { const n = tName(t), k = tShort(t); return n.endsWith(k) ? n.slice(0, -k.length).trim() : n }
  const AT = useAllTime()
  const [feed, setFeed] = useState(null), [feedErr, setFeedErr] = useState(false)
  useEffect(() => watchDay(today, ({ data, err }) => { if (data) setFeed(data); setFeedErr(!!err && !data) }, true), [today])

  const byName = useMemo(() => new Map((players || []).map(p => [p.name, p])), [players])

  // Last night: the latest day of games before today, from the season file
  const night = useMemo(() => {
    if (!sd?.games?.length) return null
    const date = [...sd.games].reverse().find(g => g.date < today)?.date
    if (!date) return null
    const atOk = AT && AT.night === date
    const games = sd.games.filter(g => g.date === date).map(g => {
      const home = g.home || g.teams[1], away = g.teams.find(t => t !== home)
      const pts = { [g.teams[0]]: g.pts[0], [g.teams[1]]: g.pts[1] }
      const win = pts[home] > pts[away] ? home : away, lose = win === home ? away : home
      const ps = g.players.map(p => {
        const a = atOk ? AT.by.get(p.n) : null
        return { ...p, d: p.post - p.pre, a0: a?.prev, a1: a?.rank }
      })
      const side = t => ps.filter(p => p.t === t).sort((x, y) => y.gs - x.gs)
      const pw = g.wp?.[win] ?? 0.5
      const W = side(win), L = side(lose)
      const weight = Math.max(0, 0.5 - pw) * 100 + Math.max(...ps.map(p => p.gs)) * 0.6 + (pts[win] - pts[lose]) * 0.2
      return { g, id: g.id, home, away, win, lose, ws: pts[win], ls: pts[lose], pw, W, L, all: ps, weight, ot: g.ot }
    }).sort((a, b) => b.weight - a.weight)
    return { date, games, atOk }
  }, [sd, today, AT])

  // Tonight: today's schedule with the site's forecast
  const tonight = useMemo(() => {
    const xs = (feed?.games || []).filter(x => x.home && x.away)
    return xs.map(x => {
      const pf = fc?.f ? (() => { try { return fc.f.game(x.home, x.away, today) } catch { return null } })() : null
      const pr = pf && fc.project?.(pf)
      const top = side => (side?.rows || []).filter(r => !r.out).sort((a, b) => b.elo - a.elo).slice(0, 2)
      const out = side => (side?.rows || []).filter(r => r.out && (r.base || 0) >= 15).map(r => r.name)
      return { x, home: x.home, away: x.away, pHome: pf?.pHome ?? null, proj: pr ? { [x.home]: pr[0], [x.away]: pr[1] } : null,
        tops: pf ? [[x.away, top(pf.away)], [x.home, top(pf.home)]] : [], outs: pf ? [...out(pf.away), ...out(pf.home)] : [] }
    }).sort((a, b) => (a.x.tip || '').localeCompare(b.x.tip || ''))
  }, [feed, fc, today])
  const playing = useMemo(() => new Set(tonight.flatMap(g => [g.home, g.away])), [tonight])

  // Milestones: all-time passes in reach, card tiers on the line, No. 1
  const ms = useMemo(() => {
    if (!AT || !players) return null
    const active = players.filter(p => p.is_fpr_eligible && p.fpr_rank).sort((a, b) => a.fpr_rank - b.fpr_rank)
    const at = []
    for (const x of AT.players) {
      if (x.rank > 500 || x.rank === 1) continue
      const p = byName.get(x.name)
      if (!p || !p.is_fpr_eligible || !playing.has(p.team)) continue
      const per = perGame(AT, p.current_elo), nx = AT.players[x.rank - 2]
      if (per <= 0) continue
      const games = (nx.score - x.score) / per
      if (games <= 3) at.push({ x, p, nx, gap: nx.score - x.score, games })
    }
    const tiers = []
    for (const b of [1, 5, 20, 50, 125]) {
      const edge = active[b - 1]
      if (!edge) continue
      for (const p of active.slice(b, b + 3)) if (playing.has(p.team) && edge.current_elo - p.current_elo <= 40) tiers.push({ p, b, edge, gap: edge.current_elo - p.current_elo })
    }
    return { at, tiers, top: active.slice(0, 3) }
  }, [AT, players, byName, playing])

  if (!night && !tonight.length) return <div className={styles.wrap}><div className={styles.paper}><p className={styles.empty}>The paper goes to press after the first night of games.</p></div></div>

  const games = night?.games || []
  const lead = games[0]
  const flat = games.flatMap(g => g.all.map(p => ({ ...p, game: g })))
  const line = [...flat].filter(p => !lead || p.game !== lead || p.n !== lead.W[0]?.n).sort((a, b) => b.gs - a.gs)[0]
  const climb = [...flat].sort((a, b) => b.d - a.d)[0]
  const atMoves = AT && night?.atOk ? AT.players.filter(x => x.prev && x.prev !== x.rank && Math.min(x.prev, x.rank) <= 500).sort((a, b) => a.rank - b.rank) : []
  const passedBy = x => atMoves.filter(y => y.prev < x.prev && y.rank > x.rank)
  const atLead = atMoves.filter(x => x.prev > x.rank).sort((a, b) => (b.prev - b.rank) - (a.prev - a.rank) || a.rank - b.rank)[0]
  const climbers = AT ? AT.players.filter(x => x.active && x.rank <= 500 && x.pre && x.pre - x.rank >= 5).sort((a, b) => (b.pre - b.rank) - (a.pre - a.rank)).slice(0, 8) : []
  const moved = flat.filter(p => p.lr && p.lrp && p.lr !== p.lrp && Math.min(p.lr, p.lrp) <= 150).sort((a, b) => a.lrp - b.lrp)
  const tierMoves = moved.filter(p => tier(p.lr) !== tier(p.lrp))
  const upsets = games.filter(g => g.pw < 0.5).length
  const firstTip = tonight[0]?.x.tip ? tipTime(tonight[0].x.tip) : null
  const inReach = ms ? ms.at.filter(m => m.games <= 1.25) : []
  const day27 = AT?.opener ? Math.round((Date.parse(today) - Date.parse(AT.opener)) / 864e5) + 1 : null
  const season = sd?.season ? sd.season.replace('-', '–') : ''

  const statline = p => `${p.pts} points, ${p.trb} rebounds and ${p.ast} assists`
  const eloLine = p => `${p.d >= 0 ? 'gained' : 'lost'} ${Math.abs(p.d).toFixed(1)} Elo`
  const rankMove = p => (p.lr && p.lrp && p.lr !== p.lrp ? `${p.lrp < p.lr ? 'up' : 'down'} to No. ${p.lrp} in the rankings from No. ${p.lr}` : '')
  const headline = g => {
    const m = g.ws - g.ls, place = city(g.home)
    return g.pw < 0.2 ? `${nick(g.win)} stun ${nick(g.lose)} in ${place}` : g.pw < 0.5 && m >= 15 ? `${nick(g.win)} upset ${nick(g.lose)} by ${m}`
      : g.pw < 0.5 ? `${nick(g.win)} upset ${nick(g.lose)}` : m >= 15 ? `${nick(g.win)} rout ${nick(g.lose)}` : m <= 5 ? `${nick(g.win)} hold off ${nick(g.lose)}`
      : `${nick(g.win)} beat ${nick(g.lose)}, ${g.ws}–${g.ls}`
  }
  const story = (g, long) => {
    const top = g.W[0], ltop = g.L[0], dbl = g.W.filter(p => p.pts >= 10).length
    const byD = [...g.all].sort((a, b) => b.d - a.d), mover = byD[0], faller = byD.at(-1)
    const s = [`The ${tName(g.win)} beat the ${tName(g.lose)} ${g.ws}–${g.ls}${g.ot ? ` in ${g.ot === 'OT' ? 'overtime' : g.ot}` : ''}${g.pw < 0.5 ? `, a result the Elo forecast gave a ${pct(g.pw)} chance` : ` as ${pct(g.pw)} favorites`}. ${top.n} led the ${nick(g.win)} with ${statline(top)}, a Game Score of ${top.gs.toFixed(1)}.${dbl >= 5 ? ` ${word(dbl, true)} ${nick(g.win)} scored in double figures.` : ''}`]
    if (ltop) s.push(`${ltop.n} had ${ltop.pts} for ${city(g.lose)} and ${eloLine(ltop)}.`)
    if (mover && mover !== top) s.push(`The biggest climb in this game belonged to ${mover.n}, who ${eloLine(mover)}${rankMove(mover) ? ` and moves ${rankMove(mover)}` : ''}.`)
    if (long && faller && faller.d < -10) s.push(`${faller.n} ${eloLine(faller)}${rankMove(faller) ? `, ${rankMove(faller)}` : ''}.`)
    if (long) {
      const up = g.W.filter(p => p.lr && p.lrp && p.lrp < p.lr)
      if (up.length > 1) { const b = [...up].sort((a, b) => (b.lr - b.lrp) - (a.lr - a.lrp))[0]; s.push(`${word(up.length, true)} ${nick(g.win)} climbed in the rankings, led by ${b.n} (No. ${b.lr} to No. ${b.lrp}).`) }
    }
    return s
  }
  const rankWatch = g => {
    const xs = g.all.filter(p => p.lr && p.lrp && p.lr !== p.lrp && Math.min(p.lr, p.lrp) <= 150).sort((a, b) => a.lrp - b.lrp).slice(0, 3)
      .map(p => `${p.n} ${p.lrp < p.lr ? '▲' : '▼'} No. ${p.lrp}${tier(p.lr) !== tier(p.lrp) ? ` (${p.lrp < p.lr ? 'into' : 'out of'} the ${TIER_LABEL[tier(Math.min(p.lr, p.lrp))]} tier)` : ''}`)
    const at = g.all.filter(p => p.a0 && p.a1 && p.a0 !== p.a1 && Math.min(p.a0, p.a1) <= 500 && p.a1 < p.a0).map(p => {
      const ps = passedBy({ name: p.n, prev: p.a0, rank: p.a1 })
      return `${p.n} passes ${ps.length === 1 ? baseName(ps[0].name) : `${word(ps.length)} players`} for No. ${p.a1} all-time`
    })
    const all = [...xs, ...at]
    return all.length ? <div className={styles.rw}><b>Rank watch</b>{all.join('; ')}.</div> : null
  }
  const Mini = ({ g }) => <table className={styles.mini}><thead><tr><th /><th className={styles.r}>Pts-Reb-Ast</th><th className={styles.r}>GmSc</th><th className={styles.r}>Elo</th></tr></thead>
    <tbody>{[...g.W.slice(0, 3).map(p => [p, g.win]), ...g.L.slice(0, 2).map(p => [p, g.lose])].map(([p, t]) => <tr key={p.n}>
      <td><button type="button" className={styles.pl} onClick={() => selectPlayer?.(p.n)}>{p.n}</button> <span className={styles.tm}>{t}</span></td>
      <td className={`${styles.r} ${styles.num}`}>{p.pts}-{p.trb}-{p.ast}</td><td className={`${styles.r} ${styles.num}`}>{p.gs.toFixed(1)}</td>
      <td className={`${styles.r} ${styles.num} ${p.d >= 0 ? styles.up : styles.dn}`}>{sgn(p.d)}</td></tr>)}</tbody></table>
  const Line = ({ g }) => <div className={styles.line}><span>{g.away} at {g.home}</span>{g.win} {g.ws}, {g.lose} {g.ls}{g.ot ? ` (${g.ot})` : ''}<span>Elo had {g.win} {pct(g.pw)}</span></div>
  const go = id => e => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const shotOf = n => shots?.[norm(n)]?.headshot
  const shot = lead && shotOf(lead.W[0].n)
  const dn = dayNum(today)
  // Round headshot on the team's color (initials until it loads, or when there's no photo)
  const Disc = ({ name, team, size = 58 }) => {
    const src = shotOf(name)
    return <span className={styles.disc} style={{ '--c1': kit.tColor(team), '--c2': accent(team), width: size, height: size }}>
      <b style={{ fontSize: size * 0.3 }}>{initials(name)}</b>{src && <img src={src} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />}</span>
  }
  // The lead's art, rotating by day: A the photo plate (needs his headshot), B the upset meter
  const leadArt = lead && (shot && dn % 2 === 0 ? 'plate' : 'meter')
  const Plate = ({ g }) => { const p = g.W[0]
    return <div className={styles.plate} style={{ '--c1': kit.tColor(g.win), '--c2': accent(g.win) }}>
      <i className={styles.dots} /><img className={styles.cut} src={shot} alt="" />
      <div className={styles.big}><b>{p.pts}</b><small>points · {p.n}</small><b className={styles.big2}>{pct(g.pw)}</b><small>chance going in</small></div>
      <div className={styles.bug}>{g.win} {g.ws} · {g.lose} {g.ls}<span>{g.pw < 0.5 ? 'Upset' : 'Final'}</span></div></div> }
  const Meter = ({ g }) => {
    const r = 78, cx = 100, cy = 92, ang = Math.PI * (1 - g.pw), x = cx + r * Math.cos(ang), y = cy - r * Math.sin(ang)
    return <figure className={styles.meter}><figcaption className={styles.kick}>Elo’s pregame chance for the {nick(g.win)}</figcaption>
      <svg viewBox="0 0 200 120" role="img" aria-label={`Elo gave the ${nick(g.win)} a ${pct(g.pw)} chance. They won.`}>
        <path d="M22 92 A78 78 0 0 1 178 92" fill="none" stroke="#d9ceb0" strokeWidth="18" />
        <path d={`M22 92 A78 78 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke={kit.tColor(g.win)} strokeWidth="18" />
        <line x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="#1b1812" strokeWidth="3" /><circle cx={cx} cy={cy} r="6" fill="#1b1812" />
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize="22" fontWeight="900" fill="#1b1812">{pct(g.pw)}</text>
        <text x="22" y="112" textAnchor="middle" fontSize="8" fontWeight="700" fill="#7a6e57">0%</text><text x="178" y="112" textAnchor="middle" fontSize="8" fontWeight="700" fill="#7a6e57">100%</text>
        <g transform={`translate(${g.pw < 0.5 ? 150 : 50} 30) rotate(${g.pw < 0.5 ? 14 : -14})`}><rect x="-34" y="-13" width="68" height="26" fill="none" stroke="#8b1d1d" strokeWidth="2.5" />
          <text x="0" y="5" textAnchor="middle" fontSize="12" fontWeight="900" fill="#8b1d1d" letterSpacing="1.5">WON</text></g>
      </svg>
      <div className={styles.mFoot}><span>{g.win} {g.ws}</span><span>Final</span><span>{g.lose} {g.ls}</span></div></figure>
  }
  // In the lead story: every player's Elo change in the game, in team colors
  const Swing = ({ g }) => {
    const xs = [...g.all].filter(p => Math.abs(p.d) >= 3).sort((a, b) => b.d - a.d)
    if (xs.length < 4) return null
    const W = 360, rowH = 17, mid = W / 2, H = xs.length * rowH + 4, m = Math.max(...xs.map(p => Math.abs(p.d)))
    return <figure className={styles.swing}><figcaption className={styles.kick}>Who moved the ratings</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each player's Elo change in this game">
        <line x1={mid} y1="0" x2={mid} y2={H} stroke="#1b1812" />
        {xs.map((p, i) => { const w = Math.abs(p.d) / m * (mid - 80), y = i * rowH + 2, pos = p.d >= 0
          return <g key={p.n}><rect x={pos ? mid : mid - w} y={y} width={w} height={rowH - 4} fill={kit.tColor(p.t)} />
            <text x={pos ? mid - 4 : mid + 4} y={y + 10.5} fontSize="10" fontWeight="700" textAnchor={pos ? 'end' : 'start'} fill="#1b1812">{lastName(p.n)}</text>
            <text x={pos ? mid + w + 3 : mid - w - 3} y={y + 10.5} fontSize="10" fontWeight="800" textAnchor={pos ? 'start' : 'end'} fill={pos ? '#2f6b3a' : '#8b1d1d'}>{sgn(p.d)}</text></g> })}
      </svg><p className={styles.figCap}>Elo change for everyone who moved at least 3 points, in team colors.</p></figure>
  }
  // Game art, rotating by day and slot: A the score bug with the player of the game, C the portrait with a stat line
  const ScoreBug = ({ g }) => <><div className={styles.sbug}>
      <div style={{ background: kit.tColor(g.win) }}><span>{g.win}</span>{g.ws}</div><div className={styles.sMid}>Final{g.ot ? ` · ${g.ot}` : ''}<i>Elo had {g.win} {pct(g.pw)}</i></div>
      <div className={styles.sLose} style={{ background: kit.tColor(g.lose) }}>{g.ls}<span>{g.lose}</span></div></div>
    <div className={styles.pog}><Disc name={g.W[0].n} team={g.win} /><div><b>{g.W[0].n}</b><small>{g.W[0].pts} pts · {g.W[0].trb} reb · {g.W[0].ast} ast · {sgn(g.W[0].d)} Elo</small></div></div></>
  const Portrait = ({ g }) => { const p = g.W[0]
    return <div className={styles.port}><Disc name={p.n} team={g.win} size={88} /><div><span className={styles.ribbon} style={{ background: kit.tColor(g.win) }}>Player of the game</span>
      <b className={styles.pName}>{p.n}</b><div className={styles.pStat}><div><b>{p.pts}</b><small>PTS</small></div><div><b>{p.trb}</b><small>REB</small></div><div><b>{p.ast}</b><small>AST</small></div>
      <div><b className={p.d >= 0 ? styles.up : styles.dn}>{sgn(p.d)}</b><small>ELO</small></div></div></div></div> }

  return (
    <div className={styles.wrap}>
      <article className={styles.paper}>
        <header>
          <div className={styles.ears}>
            <div className={styles.ear}><b>Last night</b>{night ? `${word(games.length, true)} game${games.length === 1 ? '' : 's'} · ${upsets} upset${upsets === 1 ? '' : 's'} · ${moved.length} moves in the top 150` : 'No games'}</div>
            <h1 className={styles.mast}>The Floor Times</h1>
            <div className={`${styles.ear} ${styles.earR}`}><b>Tonight</b>{tonight.length ? `${word(tonight.length, true)} game${tonight.length === 1 ? '' : 's'}${firstTip ? ` · first tip ${firstTip}` : ''} · ${inReach.length} all-time pass${inReach.length === 1 ? '' : 'es'} in reach` : 'No games'}</div>
          </div>
          <div className={styles.dl}><span>{fmtDay(today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>{day27 > 0 && <span>Day {day27} of the {season} season</span>}<span>Rated by Elo · FanSided’s Full Court</span></div>
          <nav className={styles.nav}><a href="#ft-front" onClick={go('ft-front')}>Front Page</a><a href="#ft-games" onClick={go('ft-games')}>Last Night <small>{games.length}</small></a><a href="#ft-ledger" onClick={go('ft-ledger')}>The Ledger</a><a href="#ft-tonight" onClick={go('ft-tonight')}>Tonight <small>{tonight.length}</small></a><a href="#ft-watch" onClick={go('ft-watch')}>Milestone Watch</a></nav>
        </header>

        {lead && <section id="ft-front" className={styles.front}>
          <div className={styles.lead}>
            <div className={styles.kick}>{lead.pw < 0.5 ? 'Upset of the night' : 'Game of the night'}</div>
            <h2 className={styles.h1}>{headline(lead)}</h2>
            <div className={styles.dek}>Elo gave the {nick(lead.win)} a {pct(lead.pw)} chance{lead.win === lead.away ? ` in ${city(lead.home)}` : ''}. They won by {lead.ws - lead.ls}.</div>
            <div className={styles.by}>By the Floor Times Elo desk</div>
            {leadArt === 'plate' ? <Plate g={lead} /> : <Meter g={lead} />}
            <div className={styles.cap}>{lead.W[0].n} scored {lead.W[0].pts} for {city(lead.win)} and {eloLine(lead.W[0])}.</div>
            <div className={styles.cols}>{story(lead, true).map((s, i) => <p key={i}>{s}</p>)}</div>
            <Swing g={lead} />
            <Mini g={lead} />
          </div>
          <div className={styles.side}>
            {line && <div className={styles.blk}><div className={styles.kick}>Line of the night</div>
              <h3>{line.n}: {line.pts}, {line.trb} and {line.ast}{line.t === line.game.win ? ` as ${nick(line.game.win)} ${line.game.ws - line.game.ls >= 15 ? 'rout' : 'beat'} ${nick(line.game.lose)}` : ` in a loss to ${nick(line.game.win)}`}</h3>
              <p>A Game Score of {line.gs.toFixed(1)}{line.gs >= Math.max(...flat.map(p => p.gs)) ? ', the night’s best' : ''}.{line.t === line.game.win && line.game.pw < 0.5 ? ` ${city(line.game.win)} won as a ${pct(line.game.pw)} underdog, by ${line.game.ws - line.game.ls}.` : ''} {lastName(line.n)} {line.lrp ? `${line.lr && line.lr !== line.lrp ? `moves to` : 'holds at'} No. ${line.lrp} in the rankings` : ''}{line.a1 ? `${line.lrp ? ' and' : ''} No. ${line.a1} all-time` : ''}.</p></div>}
            {climb && <div className={styles.blk}><div className={styles.kick}>Biggest climb</div><h3>{climb.n} {sgn(climb.d)} Elo</h3>
              <p>{statline(climb)} for {city(climb.t)}{[climb.pts, climb.trb, climb.ast].filter(v => v >= 10).length >= 3 ? ', a triple-double' : ''}.{rankMove(climb) ? ` He moves ${rankMove(climb)}.` : ''}</p></div>}
            <div className={styles.blk}><div className={styles.kick}>All-Time Watch</div>
              {atLead ? <>
                <h3>{baseName(atLead.name)} {(() => { const ps = passedBy(atLead); return ps.length === 1 ? `passes ${baseName(ps[0].name)}` : `passes ${word(ps.length)}` })()} for No. {atLead.rank}</h3>
                <p>{atMoves.filter(x => x.prev > x.rank).length === 1 ? 'The only climb in the all-time top 500 last night.' : `${word(atMoves.filter(x => x.prev > x.rank).length, true)} climbs in the all-time top 500 last night.`}{inReach[0] ? ` Tonight, ${baseName(inReach[0].x.name)} can pass ${baseName(inReach[0].nx.name)} for No. ${inReach[0].nx.rank}.` : ''} <a href="#ft-watch" onClick={go('ft-watch')}>Milestone Watch →</a></p>
              </> : <>
                <h3>No changes in the all-time top 500</h3>
                <p>{inReach[0] ? `Tonight, ${baseName(inReach[0].x.name)} can pass ${baseName(inReach[0].nx.name)} for No. ${inReach[0].nx.rank}. ` : ''}<a href="#ft-watch" onClick={go('ft-watch')}>Milestone Watch →</a></p>
              </>}
            </div>
          </div>
        </section>}

        {games.length > 0 && <>
          <div className={styles.sh} id="ft-games"><h2>Last Night</h2><span>{fmtDay(night.date, { weekday: 'long', month: 'long', day: 'numeric' })} · every game</span></div>
          <section className={styles.games}>
            {games.map((g, i) => g === lead
              ? <article key={g.id} className={styles.game}><div className={styles.kick}>Front page</div><h3>{headline(g)}</h3><ScoreBug g={g} />
                <p className={styles.jump}>The full story leads the front page. <a href="#ft-front" onClick={go('ft-front')}>Read it →</a></p><Mini g={g} />{rankWatch(g)}</article>
              : (dn + i) % 2 === 0
                ? <article key={g.id} className={styles.game}><div className={styles.kick}>{g.pw < 0.5 ? 'Upset' : 'Final'}</div><h3>{headline(g)}</h3><ScoreBug g={g} />
                  {story(g, false).map((s, k) => <p key={k}>{s}</p>)}<Mini g={g} />{rankWatch(g)}</article>
                : <article key={g.id} className={styles.game}><div className={styles.kick}>{g.pw < 0.5 ? 'Upset' : 'Final'}</div><Portrait g={g} /><h3>{headline(g)}</h3><Line g={g} />
                  {story(g, false).map((s, k) => <p key={k}>{s}</p>)}<Mini g={g} />{rankWatch(g)}</article>)}
          </section>

          <div className={styles.sh} id="ft-ledger"><h2>The Ledger</h2><span>Who moved, current and all-time</span></div>
          <section className={styles.ledger}>
            <div>
              <h3>The rankings</h3><div className={styles.exp}>Everyone who played last night and moved in the top 150.</div>
              <table className={styles.tbl}><thead><tr><th>Now</th><th>Player</th><th className={styles.r}>Move</th><th className={styles.r}>Elo</th></tr></thead>
                <tbody>{moved.map(p => <tr key={p.n}><td><Foil r={p.lrp} className={styles.chip}>{p.lrp}</Foil></td>
                  <td><button type="button" className={styles.pl} onClick={() => selectPlayer?.(p.n)}>{p.n}</button> <span className={styles.tm}>{p.t}</span>{tier(p.lr) !== tier(p.lrp) && <span className={`${styles.tchg} ${p.lrp < p.lr ? styles.up : styles.dn}`}>to {TIER_LABEL[tier(p.lrp)]}</span>}</td>
                  <td className={`${styles.r} ${styles.num} ${p.lrp < p.lr ? styles.up : styles.dn}`}>{p.lrp < p.lr ? '▲' : '▼'}{Math.abs(p.lr - p.lrp)} <span className={styles.was}>({p.lr})</span></td>
                  <td className={`${styles.r} ${styles.num}`}>{Math.round(p.post).toLocaleString()}</td></tr>)}</tbody></table>
              {tierMoves.length > 0 && <div className={styles.exp} style={{ marginTop: 8 }}>{tierMoves.length} card-tier change{tierMoves.length === 1 ? '' : 's'}: {tierMoves.map(p => `${p.n} to ${TIER_LABEL[tier(p.lrp)]}`).join(', ')}.</div>}
            </div>
            <div>
              <h3>All-time</h3><div className={styles.exp}>Every move in the all-time top 500. Every player is ranked; the paper prints the top 500.</div>
              {night.atOk ? (atMoves.length ? <table className={styles.tbl}><thead><tr><th>Now</th><th>Player</th><th className={styles.r}>Was</th></tr></thead>
                <tbody>{atMoves.map(x => <tr key={x.name}><td><Foil r={x.rank} className={styles.chip}>{x.rank}</Foil></td><td>{baseName(x.name)}{!flat.some(p => p.n === x.name) && <span className={styles.tm}> · idle</span>}</td>
                  <td className={`${styles.r} ${styles.num} ${x.rank < x.prev ? styles.up : styles.dn}`}>{x.rank < x.prev ? '▲' : '▼'}{Math.abs(x.prev - x.rank)} <span className={styles.was}>({x.prev})</span></td></tr>)}</tbody></table>
                : <div className={styles.quiet}>No moves in the all-time top 500 last night.</div>) : <div className={styles.quiet}>The all-time list updates with the nightly ratings.</div>}
              {climbers.length > 0 && <>
                <h3 style={{ marginTop: 16 }}>Climbing this season</h3><div className={styles.exp}>Active players in the top 500, from where they stood entering the season.</div>
                <table className={styles.tbl}><thead><tr><th>Now</th><th>Player</th><th className={styles.r}>Opening night</th></tr></thead>
                  <tbody>{climbers.map(x => <tr key={x.name}><td><Foil r={x.rank} className={styles.chip}>{x.rank}</Foil></td><td>{baseName(x.name)} <span className={styles.tm}>{x.team}</span></td>
                    <td className={`${styles.r} ${styles.num} ${styles.up}`}>▲{x.pre - x.rank} <span className={styles.was}>({x.pre})</span></td></tr>)}</tbody></table>
              </>}
            </div>
          </section>
        </>}

        <div className={styles.sh} id="ft-tonight"><h2>Tonight</h2><span>{fmtDay(today, { weekday: 'long', month: 'long', day: 'numeric' })} · {tonight.length ? `${word(tonight.length)} game${tonight.length === 1 ? '' : 's'}` : 'no games'}</span></div>
        {!tonight.length ? <p className={styles.quiet}>{feed ? 'No games tonight.' : feedErr ? 'Tonight’s schedule isn’t available right now.' : 'Loading tonight’s schedule…'}</p> : <section className={styles.slate}>
          {tonight.map(g => {
            const pa = g.pHome == null ? null : 1 - g.pHome, fav = g.pHome == null ? null : g.pHome >= 0.5 ? g.home : g.away, fp = g.pHome == null ? null : Math.max(g.pHome, pa)
            const dog = fav === g.home ? g.away : g.home
            const hd = !fav ? `${nick(g.away)} at ${nick(g.home)}` : fp >= 0.75 ? `${nick(fav)} heavy favorites ${fav === g.home ? 'at home' : 'on the road'}` : fp >= 0.56 ? `${nick(fav)} favored ${fav === g.home ? 'against' : 'at'} ${nick(dog)}` : `Toss-up: ${nick(g.away)} at ${nick(g.home)}`
            const notes = ms ? [
              ...ms.at.filter(m => m.games <= 1.25 && (m.p.team === g.home || m.p.team === g.away)).map(m => `${baseName(m.x.name)} is ${gapTxt(m.gap)} behind ${baseName(m.nx.name)} for No. ${m.nx.rank} all-time, about one game at his level.`),
              ...ms.tiers.filter(m => m.b > 1 && (m.p.team === g.home || m.p.team === g.away)).map(m => `${m.p.name} (No. ${m.p.fpr_rank}) is ${m.gap.toFixed(1)} Elo behind ${m.edge.name} for the ${TIER_LABEL[tier(m.b)]} tier.`),
            ] : []
            const st = g.x.state === 'in' ? `Live · ${g.x.away} ${g.x.as ?? 0}, ${g.x.home} ${g.x.hs ?? 0}` : g.x.state === 'post' ? `Final · ${g.x.away} ${g.x.as}, ${g.x.home} ${g.x.hs}` : g.x.tip ? tipTime(g.x.tip) : ''
            return <article key={`${g.away}${g.home}`} className={styles.pv}>
              <div className={styles.tip}><span>{st}</span><span>{g.away} at {g.home}</span></div>
              <h3>{hd}</h3>
              {g.pHome != null && <div className={styles.tug}>
                <div style={{ width: `${pa * 100}%`, background: kit.tColor(g.away) }}>{pa >= 0.18 && <b>{g.away}</b>}<small>{pct(pa)}</small></div>
                <div style={{ width: `${g.pHome * 100}%`, background: kit.tColor(g.home) }}>{g.pHome >= 0.18 && <b>{g.home}</b>}<small>{pct(g.pHome)}</small></div></div>}
              {g.proj && <div className={styles.proj}>Projected: {g.away} {g.proj[g.away]}, {g.home} {g.proj[g.home]}</div>}
              {g.tops.length === 2 && g.tops[0][1][0] && g.tops[1][1][0] && <div className={styles.mq}>
                {g.tops.map(([t, rows], k) => { const r = rows[0], p = byName.get(r.name); return <button key={r.name} type="button" className={styles.mqP} onClick={() => selectPlayer?.(r.name)}>
                  <Disc name={r.name} team={t} size={64} /><b>{r.name}</b><small>{Math.round(r.elo).toLocaleString()} Elo{p?.fpr_rank ? ` · No. ${p.fpr_rank}` : ''}</small></button> }).reduce((a, el, k) => k ? [...a, <span key="vs" className={styles.vs}>vs</span>, el] : [el], [])}
              </div>}
              {g.outs.length > 0 && <div className={styles.out}>Out: {g.outs.join(', ')}</div>}
              {notes.length > 0 && <div className={styles.rw}><b>Milestone watch</b>{notes.join(' ')}</div>}
            </article>
          })}
        </section>}

        <div className={styles.sh} id="ft-watch"><h2>Milestone Watch</h2><span>What tonight’s games can change</span></div>
        {ms && <section className={styles.msg}>
          <div><h3>All-time passes in reach</h3><div className={styles.exp}>Players in tonight’s games within about one game of the next name on the all-time list, at their current level.</div>
            {inReach.length ? inReach.map(m => <div key={m.x.name} className={styles.item}><span className={styles.t}>No. {m.x.rank} → No. {m.nx.rank} · {m.p.team}</span>{baseName(m.x.name)} can pass <b>{baseName(m.nx.name)}</b>. {m.gap < 0.005 ? 'The gap is under 0.01 points.' : `${m.gap.toFixed(2)} points behind.`}</div>) : <div className={styles.item}>Nobody in tonight’s games is within a game of the next name.</div>}
            {ms.at.some(m => m.games > 1.25) && <><h3 style={{ marginTop: 14 }}>Within three games</h3>
              {ms.at.filter(m => m.games > 1.25).map(m => <div key={m.x.name} className={styles.item}><span className={styles.t}>No. {m.x.rank} · {m.p.team}</span>{baseName(m.x.name)}, {m.gap.toFixed(2)} behind {baseName(m.nx.name)}: about {Math.max(2, Math.round(m.games))} games.</div>)}</>}
          </div>
          <div><h3>Card tiers on the line</h3><div className={styles.exp}>Players in tonight’s games closest to the next card tier in the current rankings.</div>
            {ms.tiers.filter(m => m.b > 1).length ? ms.tiers.filter(m => m.b > 1).map(m => <div key={m.p.name} className={styles.item}><span className={styles.t}>No. {m.p.fpr_rank} → {TIER_LABEL[tier(m.b)]} · {m.p.team}</span>{m.p.name} is {m.gap.toFixed(1)} Elo behind {m.edge.name} (No. {m.b}).{m.gap < 1 ? ' One good night does it.' : ''}</div>)
              : <div className={styles.item}>Nobody in tonight’s games is within 40 Elo of the next tier.</div>}
          </div>
          <div><h3>No. 1 watch</h3><div className={styles.exp}>Who holds No. 1, and whether it can change tonight.</div>
            {ms.top[0] && ms.top[1] && <div className={styles.item}><span className={styles.t}>No. 1 · {ms.top[0].team}</span>{ms.top[0].name} leads {ms.top[1].name} by {(ms.top[0].current_elo - ms.top[1].current_elo).toFixed(1)} Elo.
              {(() => {
                const [a, b] = ms.top, gap = (a.current_elo - b.current_elo).toFixed(1), pa = playing.has(a.team), pb = playing.has(b.team)
                return pa && pb ? ` The ${nick(a.team)} and the ${nick(b.team)} both play tonight.`
                  : pa ? ` The ${nick(b.team)} are off tonight; ${lastName(a.name)} keeps No. 1 unless he loses ${gap} Elo.`
                  : pb ? ` The ${nick(a.team)} are off tonight; ${lastName(b.name)} takes No. 1 if he gains ${gap} Elo.`
                  : ' Neither plays tonight, so No. 1 holds.'
              })()}</div>}
            {ms.top[2] && <div className={styles.item}><span className={styles.t}>No. 3 · {ms.top[2].team}</span>{ms.top[2].name} is {(ms.top[1].current_elo - ms.top[2].current_elo).toFixed(1)} behind {lastName(ms.top[1].name)} for No. 2.{playing.has(ms.top[2].team) ? '' : ` The ${nick(ms.top[2].team)} are off tonight.`}</div>}
          </div>
        </section>}
        <footer className={styles.foot}>The Floor Times is written from the site’s ratings and box scores each morning after the nightly update. Current ranks are among active players; all-time ranks cover every player in the database.</footer>
      </article>
    </div>
  )
}
