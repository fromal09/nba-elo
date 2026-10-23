import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import styles from './SeasonExplorer.module.css'
import PlayerCard, { tierFor } from './PlayerCard'
import { buildForecaster, blendWeight } from './predict'
import { buildRatings, scoreGame, assignRanks, dayBoards } from './live.js'

// ── Team info ────────────────────────────────────────────────────────────────
// Names, colors and groups come from each season file (historical names). This
// list only fills in current teams that haven't played yet in the newest season.
const CURRENT = {
  ATL: ['Atlanta Hawks', '#C8102E', 'E'], BOS: ['Boston Celtics', '#007A33', 'E'], BKN: ['Brooklyn Nets', '#000000', 'E'],
  CHO: ['Charlotte Hornets', '#00788C', 'E'], CHI: ['Chicago Bulls', '#CE1141', 'E'], CLE: ['Cleveland Cavaliers', '#860038', 'E'],
  DAL: ['Dallas Mavericks', '#00538C', 'W'], DEN: ['Denver Nuggets', '#0E2240', 'W'], DET: ['Detroit Pistons', '#C8102E', 'E'],
  GSW: ['Golden State Warriors', '#1D428A', 'W'], HOU: ['Houston Rockets', '#CE1141', 'W'], IND: ['Indiana Pacers', '#002D62', 'E'],
  LAC: ['LA Clippers', '#C8102E', 'W'], LAL: ['Los Angeles Lakers', '#552583', 'W'], MEM: ['Memphis Grizzlies', '#5D76A9', 'W'],
  MIA: ['Miami Heat', '#98002E', 'E'], MIL: ['Milwaukee Bucks', '#00471B', 'E'], MIN: ['Minnesota Timberwolves', '#0C2340', 'W'],
  NOP: ['New Orleans Pelicans', '#0C2340', 'W'], NYK: ['New York Knicks', '#006BB6', 'E'], OKC: ['Oklahoma City Thunder', '#007AC1', 'W'],
  ORL: ['Orlando Magic', '#0077C0', 'E'], PHI: ['Philadelphia 76ers', '#006BB6', 'E'], PHO: ['Phoenix Suns', '#1D1160', 'W'],
  POR: ['Portland Trail Blazers', '#E03A3E', 'W'], SAC: ['Sacramento Kings', '#5A2D81', 'W'], SAS: ['San Antonio Spurs', '#4a4f54', 'W'],
  TOR: ['Toronto Raptors', '#CE1141', 'E'], UTA: ['Utah Jazz', '#002B5C', 'W'], WAS: ['Washington Wizards', '#002B5C', 'E'],
}
const GROUP_ORDER = ['Eastern Conference', 'Western Conference', 'BAA', 'NBA', 'ABA']
const GROUP_LABEL = { BAA: 'BAA Standings', NBA: 'NBA Standings', ABA: 'ABA Standings' }
const TWO_WORD = ['Trail Blazers', 'Red Skins']

// Set from the loaded season before children render (one season is on screen at a time)
let TEAMINFO = {}
let CAREER = { byName: {}, rank: {}, best: {} } // elo.json players, all-time peak Elo rank, best active rank
const tName = t => TEAMINFO[t]?.name || CURRENT[t]?.[0] || t
const tShort = t => {
  const n = tName(t)
  return TWO_WORD.find(w => n.endsWith(w)) || n.replace(/^The /, '').split(' ').slice(-1)[0]
}
const tColor = t => TEAMINFO[t]?.color || CURRENT[t]?.[1] || '#173657'
// Period-correct abbreviations (Basketball-Reference style) for renamed and relocated teams
const HIST_ABBR = {
  'Seattle SuperSonics': 'SEA', 'Baltimore Bullets': 'BAL', 'Capital Bullets': 'CAP', 'Washington Bullets': 'WSB',
  'New Jersey Nets': 'NJN', 'New York Nets': 'NYN', 'Philadelphia Warriors': 'PHW', 'San Francisco Warriors': 'SFW',
  'San Diego Rockets': 'SDR', 'Buffalo Braves': 'BUF', 'San Diego Clippers': 'SDC', 'Minneapolis Lakers': 'MNL',
  'Vancouver Grizzlies': 'VAN', 'Charlotte Bobcats': 'CHA', 'New Orleans Hornets': 'NOH', 'New Orleans/Oklahoma City Hornets': 'NOK',
  'Syracuse Nationals': 'SYR', 'Rochester Royals': 'ROC', 'Cincinnati Royals': 'CIN', 'Kansas City-Omaha Kings': 'KCO',
  'Kansas City Kings': 'KCK', 'New Orleans Jazz': 'NOJ', 'Toronto Huskies': 'TRH', 'Tri-Cities Blackhawks': 'TRI',
  'Milwaukee Hawks': 'MLH', 'St. Louis Hawks': 'STL', 'Chicago Stags': 'CHS', 'Cleveland Rebels': 'CLR',
  'Detroit Falcons': 'DTF', 'Fort Wayne Pistons': 'FTW', 'Oakland Oaks': 'OAK', 'Utah Stars': 'UTS',
  'New Jersey Americans': 'NJA', 'Denver Rockets': 'DNR', 'San Diego Conquistadors': 'SDA', 'Miami Floridians': 'MMF',
  'New Orleans Buccaneers': 'NOB', 'Washington Capitols': 'WSC',
}
const tCode = t => {
  const n = TEAMINFO[t]?.name, c = TEAMINFO[t]?.code || t.split('@')[0]
  if (n === 'Charlotte Hornets' && c === 'NOH') return 'CHH'
  return HIST_ABBR[n] || c
}

const LINE_COLORS = ['#1a5fa8', '#d4960a', '#c0392b', '#1a7a4a', '#7b3fa0', '#e67e22', '#0e8c99', '#b0306a',
  '#5d6d7e', '#8e6b2f', '#2e86de', '#6ab04c', '#8c564b', '#686de0', '#30336b', '#22a6b3']

// ── Helpers ──────────────────────────────────────────────────────────────────
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '')
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s*\(\d{4}\)$/, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const initials = n => n.replace(/\s*\(.*\)$/, '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', opts)
const r0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d)
const shortName = n => { const b = n.replace(/\s*\(.*\)$/, ''); const i = b.indexOf(' '); return i < 0 ? b : `${b[0]}. ${b.slice(i + 1)}` }
const pct = (m, a) => (a ? `${m}-${a}` : '0-0')
const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (day, k) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
const seasonFor = day => { const y = +day.slice(0, 4), sy = +day.slice(5, 7) >= 9 ? y : y - 1; return `${sy}-${String(sy + 1).slice(-2)}` }
const FULL_STATS = new Set(['st', 'pos', 'mp', 'tp', 'tpa', 'orb', 'drb', 'stl', 'blk', 'tov', 'pf', 'pm'])
const tipTime = iso => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')

// One game from a team's point of view (the shape the schedule and box score use)
function viewFor(g, team, sy) {
  const i = g.teams.indexOf(team), o = g.teams[1 - i]
  return {
    id: g.id, date: g.date, opp: o, home: g.home == null ? null : g.home === team, pts: g.pts[i], opp_pts: g.pts[1 - i],
    ot: g.ot, res: g.pts[i] > g.pts[1 - i] ? 'W' : 'L', post: g.post, players: g.players, elo: g.elo, wp: g.wp, sy, live: g.live,
  }
}

// Mirrors build_elo.py: every player duels every other player in the game on Game Score.
const kFactor = n => (n < 20 ? 40 : n < 100 ? 50 : 28)
function duel(a, b, N) {
  const exp = 1 / (1 + 10 ** ((b.pre - a.pre) / 620))
  const act = a.gs > b.gs ? 1 : a.gs === b.gs ? 0.5 : 0
  const mf = Math.max(0.5, Math.min(2, Math.log1p(Math.abs(a.gs - b.gs)) / Math.log1p(20)))
  return { exp, act, delta: (kFactor(a.gp) / Math.sqrt(N)) * mf * (act - exp) }
}

// ── Data loading (module-level caches) ───────────────────────────────────────
const cache = new Map()
const getJSON = url => {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.json() }))
  return cache.get(url)
}
let headshotPromise = null
const getHeadshots = () => {
  if (!headshotPromise) headshotPromise = fetch('/api/headshots').then(r => r.json()).then(d => d.players || {}).catch(() => ({}))
  return headshotPromise
}

function Headshot({ name, shots, color }) {
  const [bad, setBad] = useState(false)
  const src = shots?.[norm(name)]?.headshot
  return (
    <span className={styles.hs} style={{ '--c': color }}>
      {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : <i>{initials(name)}</i>}
    </span>
  )
}

// Official logos (ESPN CDN) for teams that still carry their current identity;
// relocated or renamed teams keep the abbreviation mark.
const ESPN_LOGO = {
  ATL: 'atl', BOS: 'bos', BKN: 'bkn', CHO: 'cha', CHI: 'chi', CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det', GSW: 'gs',
  HOU: 'hou', IND: 'ind', LAC: 'lac', LAL: 'lal', MEM: 'mem', MIA: 'mia', MIL: 'mil', MIN: 'min', NOP: 'no', NYK: 'ny',
  OKC: 'okc', ORL: 'orl', PHI: 'phi', PHO: 'phx', POR: 'por', SAC: 'sac', SAS: 'sa', TOR: 'tor', UTA: 'utah', WAS: 'wsh',
}
const logoUrl = t => {
  const info = TEAMINFO[t], code = info?.code || t
  if (t.includes('@') || !ESPN_LOGO[code] || !info || HIST_ABBR[info.name]) return null
  const cur = CURRENT[code]?.[0]
  if (!cur || tShort(t) !== (TWO_WORD.find(w => cur.endsWith(w)) || cur.split(' ').slice(-1)[0])) return null
  return `https://a.espncdn.com/i/teamlogos/nba/500/${ESPN_LOGO[code]}.png`
}

function TeamMark({ t, size = 28 }) {
  const [bad, setBad] = useState(false)
  const src = logoUrl(t)
  if (src && !bad) return <img className={styles.logo} src={src} alt={tName(t)} width={size} height={size} loading="lazy" onError={() => setBad(true)} />
  return <span className={styles.mark} style={{ background: tColor(t), width: size, height: size, fontSize: size * 0.34 }}>{tCode(t)}</span>
}

// ── Team-level Elo ───────────────────────────────────────────────────────────
// Lineup Elo: minutes-weighted average of the players who played.
// Win chance: the duel formula refit on 53,674 games with team ratings and home court.
// Fit by era: pre-1970 ratings separate teams less, and home court has shrunk since 2020
// (about 70 Elo points through 2019, about 44 since; the 2024-26 forecast backtest agrees).
const WP = sy => (sy < 1970 ? { scale: 1540, home: 420 } : sy < 2020 ? { scale: 400, home: 72 } : { scale: 450, home: 44 })
function lineupElo(ps, key) {
  const m = ps.reduce((s, p) => s + (p.mp || 0), 0)
  return m ? ps.reduce((s, p) => s + p[key] * (p.mp || 0), 0) / m : ps.reduce((s, p) => s + p[key], 0) / ps.length
}
function winChance(sy, eloA, eloB, homeA) {
  const { scale, home } = WP(sy)
  return 1 / (1 + 10 ** (-(eloA - eloB + (homeA == null ? 0 : homeA ? home : -home)) / scale))
}
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th')

// ── Season loading ───────────────────────────────────────────────────────────
function loadSeason(label, newest) {
  return getJSON(`/data/explorer/${label}.json`).then(d => {
    if (d._ready) return d
    const C = d.cols, sy = +d.season.slice(0, 4)
    // team -> lineup Elo after its most recent game. Teams start from last season's final
    // lineup Elo, so ranks cover the whole league from opening night.
    const inSeason = new Set(Object.keys(d.teams))
    if (newest && Object.values(d.teams).some(t => t.group.endsWith('Conference'))) Object.keys(CURRENT).forEach(c => inSeason.add(c))
    const latest = Object.fromEntries(Object.entries(d.seed || {}).filter(([t]) => inSeason.has(t)))
    const rankOf = (t, v) => {
      const others = Object.entries(latest).filter(([k]) => k !== t && !k.includes('@') === !t.includes('@'))
      return { rank: 1 + others.filter(([, x]) => x > v).length, of: others.length + 1 }
    }
    d.games.forEach(g => {
      g.players = g.rows.map(r => { const o = {}; C.forEach((k, i) => { o[k] = r[i] }); return o })
      delete g.rows
      const [a, b] = g.teams
      g.elo = {}
      for (const t of g.teams) {
        const ps = g.players.filter(p => p.t === t)
        g.elo[t] = { pre: lineupElo(ps, 'pre'), post: lineupElo(ps, 'post') }
        Object.assign(g.elo[t], { preRank: rankOf(t, g.elo[t].pre) })
      }
      g.wp = {}
      g.wp[a] = winChance(sy, g.elo[a].pre, g.elo[b].pre, g.home == null ? null : g.home === a)
      g.wp[b] = 1 - g.wp[a]
      for (const t of g.teams) latest[t] = g.elo[t].post
      for (const t of g.teams) g.elo[t].postRank = rankOf(t, g.elo[t].post)
    })
    d.has = new Set(d.stats || [])
    d.sy = sy
    d._ready = true
    return d
  })
}

// Schedule rows from one team's point of view, with running records
function teamGames(sd, team) {
  const rec = { false: [0, 0], true: [0, 0] }
  return sd.games.filter(g => g.teams.includes(team)).map(g => {
    const i = g.teams.indexOf(team), o = g.teams[1 - i]
    const won = g.pts[i] > g.pts[1 - i], r = rec[g.post]
    r[won ? 0 : 1]++
    return {
      id: g.id, date: g.date, opp: o, home: g.home == null ? null : g.home === team,
      pts: g.pts[i], opp_pts: g.pts[1 - i], ot: g.ot, res: won ? 'W' : 'L', post: g.post,
      rec: `${r[0]}-${r[1]}`, players: g.players, elo: g.elo, wp: g.wp, sy: sd.sy,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
export default function SeasonExplorer({ players, onSelectPlayer }) {
  const [index, setIndex] = useState(null)
  const [err, setErr] = useState(null)
  const [season, setSeason] = useState(null)
  const [sd, setSd] = useState(null)
  const [open, setOpen] = useState(null)
  const [shots, setShots] = useState({})
  const [sched, setSched] = useState(null)       // ESPN schedule + injuries (current season only)
  const [rotation, setRotation] = useState(null) // recent minutes per player
  const [best, setBest] = useState({})           // best rank among active players, per player
  const [view, setView] = useState('standings')  // 'standings' | 'today'
  const [day, setDay] = useState(etToday)
  const goDay = d => { setDay(d); setView('today'); window.scrollTo({ top: 0 }) }

  useEffect(() => {
    getJSON('/data/explorer/index.json')
      .then(d => { setIndex(d); setSeason(d.seasons[0]?.season) })
      .catch(() => setErr('Season data not found. Run the build pipeline to generate it.'))
    getHeadshots().then(setShots)
    getJSON('/data/explorer/ranks.json').then(setBest).catch(() => {})
  }, [])

  const newest = !!index && season === index.seasons[0]?.season
  // Games view: the loaded season follows the chosen day (the newest season for days past the data)
  useEffect(() => {
    if (view !== 'today' || !index) return
    const lab = seasonFor(day)
    const target = index.seasons.some(x => x.season === lab) ? lab : lab > index.seasons[0].season ? index.seasons[0].season : null
    if (target && target !== season) setSeason(target)
  }, [view, day, index])
  const ratings = useMemo(() => buildRatings(players || []), [players])
  useEffect(() => {
    if (!newest || sched) return
    getJSON('/api/schedule').then(d => d.games && setSched(d)).catch(() => {})
    getJSON('/data/explorer/rotation.json').then(setRotation).catch(() => setRotation({ players: {} }))
  }, [newest, sched])

  useEffect(() => {
    if (!season) return
    setSd(null); setOpen(null)
    loadSeason(season, season === index?.seasons[0]?.season).then(setSd).catch(() => setErr(`Couldn't load ${season}.`))
  }, [season])

  const byName = useMemo(() => {
    const m = {}; players?.forEach(p => { m[p.name] = p }); return m
  }, [players])
  const selectPlayer = n => byName[n] && onSelectPlayer?.(byName[n])
  const peakRank = useMemo(() => {
    const m = {}; [...(players || [])].sort((a, b) => b.peak_elo - a.peak_elo).forEach((p, i) => { m[p.name] = i + 1 }); return m
  }, [players])
  CAREER = { byName, rank: peakRank, best }

  const teams = useMemo(() => {
    if (!sd) return {}
    const t = { ...sd.teams }
    // Newest season: list every current team, even before its first game
    if (index && sd.season === index.seasons[0].season && Object.values(t).some(x => x.group.endsWith('Conference'))) {
      Object.entries(CURRENT).forEach(([c, [name, color, conf]]) => {
        if (!t[c]) t[c] = { code: c, name, color, group: conf === 'E' ? 'Eastern Conference' : 'Western Conference', w: 0, l: 0, pw: 0, pl: 0, gp: 0, elo: null }
      })
    }
    return t
  }, [sd, index])
  TEAMINFO = teams

  // Forecasts for the newest season: remaining games per team and projected records
  const fc = useMemo(() => {
    if (!newest || !sd || !sched || !rotation || !players) return null
    const roster = Object.fromEntries(Object.entries(shots || {}).filter(([, v]) => v.team))
    const gamesPlayed = Object.fromEntries(Object.entries(teams).map(([t, x]) => [t, x.gp]))
    const f = buildForecaster({ players, roster, rotation, injuries: sched.injuries, fetched: sched.fetched, gamesPlayed, winChance, sy: sd.sy })
    const through = sd.games.length ? sd.games[sd.games.length - 1].date : '0000-00-00'
    const upcoming = {}, proj = {}
    Object.keys(teams).forEach(t => { upcoming[t] = []; proj[t] = [teams[t].w, teams[t].l] })
    for (const g of sched.games) {
      if (g.day <= through || !teams[g.home] || !teams[g.away]) continue
      const fg = g.done ? null : f.game(g.home, g.away, g.day)
      for (const t of [g.home, g.away]) {
        const home = t === g.home, p = fg ? (home ? fg.pHome : fg.pAway) : null
        const won = g.done ? (home ? g.hs > g.as : g.as > g.hs) : null
        upcoming[t].push({ ...g, opp: home ? g.away : g.home, isHome: home, p, won, fg })
        proj[t][0] += g.done ? +won : p
        proj[t][1] += g.done ? +!won : 1 - p
      }
    }
    return { f, upcoming, proj, through, fetched: sched.fetched }
  }, [newest, sd, sched, rotation, players, shots, teams])

  if (err) return <div className={styles.page}><div className={styles.empty}>{err}</div></div>
  if (!index) return <div className={styles.page}><div className={styles.empty}>Loading seasons…</div></div>

  const s = index.seasons.find(x => x.season === season) || index.seasons[0]
  const groups = GROUP_ORDER.filter(g => Object.values(teams).some(t => t.group === g))
  const league = s.leagues?.length ? ['BAA', 'NBA', 'ABA'].filter(l => s.leagues.includes(l)).join(' & ') : 'NBA'

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <div className={styles.kicker}>Season Explorer</div>
          <div className={styles.viewTabs} role="tablist">
            <button role="tab" aria-selected={view === 'standings'} className={view === 'standings' ? styles.viewOn : ''} onClick={() => setView('standings')}>Standings</button>
            <button role="tab" aria-selected={view === 'today'} className={view === 'today' ? styles.viewOn : ''} onClick={() => setView('today')}>Games by day</button>
          </div>
          {view === 'standings' ? <>
            <h1 className={styles.title}>{s.season} <span>{league} season</span></h1>
            <p className={styles.sub}>
              {s.games.toLocaleString()} games, {fmtDate(s.first, { month: 'short', day: 'numeric', year: 'numeric' })} to {fmtDate(s.last, { month: 'short', day: 'numeric', year: 'numeric' })}.
              Pick a team for its schedule, box scores with pre- and post-game Elo, and every player's Elo path.
            </p>
          </> : <>
            <h1 className={styles.title}>{fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })} <span>{day.slice(0, 4)}</span></h1>
            <p className={styles.sub}>Every game of the day with live Elo, the night's top performers, biggest movers and biggest upsets. Click a game for its box score.</p>
          </>}
        </div>
        {view === 'standings' ? (
          <label className={styles.seasonPick}>
            <span>Season</span>
            <select value={s.season} onChange={e => setSeason(e.target.value)}>
              {index.seasons.map(x => <option key={x.season} value={x.season}>{x.season}{x.leagues?.includes('ABA') ? ' · NBA & ABA' : x.leagues?.includes('BAA') ? ' · BAA' : ''}</option>)}
            </select>
          </label>
        ) : (
          <div className={styles.dayNav}>
            <button onClick={() => setDay(d => addDays(d, -1))} aria-label="Previous day">‹</button>
            <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} />
            <button onClick={() => setDay(d => addDays(d, 1))} aria-label="Next day">›</button>
            {day !== etToday() && <button className={styles.todayBtn} onClick={() => setDay(etToday())}>Today</button>}
          </div>
        )}
      </div>

      {view === 'today' ? (
        <Today day={day} sd={sd} index={index} fc={fc} shots={shots} ratings={ratings} selectPlayer={selectPlayer} />
      ) : !sd ? <div className={styles.empty}>Loading {s.season}…</div> : (
        <div className={styles.confs}>
          {groups.map(g => (
            <Standings key={g} label={GROUP_LABEL[g] || g} group={g} sd={sd} teams={teams} open={open} fc={fc}
              setOpen={t => setOpen(o => (o === t ? null : t))}
              shots={shots} selectPlayer={selectPlayer} goDay={goDay} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Standings table with expandable team rows ───────────────────────────────
function Standings({ label, group, sd, teams, open, setOpen, shots, selectPlayer, fc, goDay }) {
  const rows = Object.entries(teams).filter(([, x]) => x.group === group).map(([t, x]) =>
    ({ t, ...x, pct: x.w + x.l ? x.w / (x.w + x.l) : 0 })
  ).sort((a, b) => b.pct - a.pct || b.w - a.w || (b.elo || 0) - (a.elo || 0))
  const lead = rows[0]
  const anyPost = rows.some(r => r.pw + r.pl)

  return (
    <section className={styles.conf} style={{ '--cols': `minmax(0, 1fr) 44px 44px 58px 50px ${anyPost ? '74px ' : ''}${fc ? '84px ' : ''}104px` }}>
      <h2 className={styles.confHead}>{label}</h2>
      <div className={styles.standHead}>
        <span>Team</span><span>W</span><span>L</span><span>Pct</span><span>GB</span>
        {anyPost && <span className={styles.hideSm}>Playoffs</span>}
        {fc && <span className={styles.hideSm} title="Current record plus the Elo win chance of every remaining game">Proj W-L</span>}
        <span title="Average Elo of the eight players with the most minutes for this team">Roster Elo</span>
      </div>
      {rows.map((r, i) => {
        const gb = (lead.w - r.w + r.l - lead.l) / 2
        const isOpen = open === r.t
        return (
          <Fragment key={r.t}>
            <button className={`${styles.standRow} ${isOpen ? styles.rowOpen : ''}`} disabled={!r.gp && !fc?.upcoming[r.t]?.length}
              onClick={() => setOpen(r.t)} style={{ '--tc': tColor(r.t) }}>
              <span className={styles.teamCell}>
                <em>{i + 1}</em><TeamMark t={r.t} />
                <b className={styles.full}>{tName(r.t)}</b><b className={styles.abbr}>{tShort(r.t)}</b>
              </span>
              <span>{r.w}</span><span>{r.l}</span>
              <span>{r.w + r.l ? r.pct.toFixed(3).replace(/^0/, '') : '—'}</span>
              <span>{r.gp && gb ? gb.toFixed(1) : '—'}</span>
              {anyPost && <span className={styles.hideSm}>{r.pw + r.pl ? `${r.pw}-${r.pl}` : '—'}</span>}
              {fc && <span className={`${styles.hideSm} ${styles.projCell}`}>{fc.proj[r.t] ? `${Math.round(fc.proj[r.t][0])}-${Math.round(fc.proj[r.t][1])}` : '—'}</span>}
              <span className={styles.eloCell}>{r0(r.elo)}<i>{r.gp || fc?.upcoming[r.t]?.length ? (isOpen ? '▴' : '▾') : ''}</i></span>
            </button>
            {isOpen && <TeamPanel team={r.t} sd={sd} shots={shots} selectPlayer={selectPlayer} fc={fc} goDay={goDay} />}
          </Fragment>
        )
      })}
    </section>
  )
}

// ── Team panel: schedule + Elo progression ──────────────────────────────────
function TeamPanel({ team, sd, shots, selectPlayer, fc, goDay }) {
  const [tab, setTab] = useState('schedule')
  const [box, setBox] = useState(null)
  const [preview, setPreview] = useState(null)
  const [card, setCard] = useState(null) // player name, from a box-score click
  const games = useMemo(() => teamGames(sd, team), [sd, team])
  const cardRow = card && box?.players.find(p => p.n === card)

  return (
    <div className={styles.panel} style={{ '--tc': tColor(team) }}>
      <div className={styles.tabs}>
        <button className={tab === 'schedule' ? styles.on : ''} onClick={() => setTab('schedule')}>Schedule & Box Scores</button>
        <button className={tab === 'elo' ? styles.on : ''} onClick={() => setTab('elo')}>Elo Progression</button>
      </div>
      {tab === 'schedule'
        ? <Schedule team={team} games={games} onBox={setBox} upcoming={fc?.upcoming[team] || []} onPreview={setPreview} fetched={fc?.fetched} goDay={goDay} />
        : <Progression team={team} games={games} selectPlayer={selectPlayer} />}
      {preview && <Preview g={preview} shots={shots} fetched={fc?.fetched} onClose={() => setPreview(null)} />}
      {box && <BoxScore team={team} game={box} has={sd.has} shots={shots} onCard={setCard} onClose={() => setBox(null)} />}
      {cardRow && (
        <PlayerCard name={card} row={cardRow} sd={sd}
          game={{ id: box.id, date: box.date, home: cardRow.t === team ? box.home : box.home == null ? null : !box.home, oppAbbr: tCode(cardRow.t === team ? box.opp : team), players: box.players }}
          team={{ name: tName(cardRow.t), color: tColor(cardRow.t), abbr: tCode(cardRow.t) }}
          logo={logoUrl(cardRow.t)} headshot={shots?.[norm(card)]?.headshot}
          career={CAREER.byName[card] || null} peakRank={CAREER.rank[card]} bestRank={CAREER.best[card]}
          onProfile={n => { setCard(null); setBox(null); selectPlayer(n) }}
          onClose={() => setCard(null)} />
      )}
    </div>
  )
}

function teamSummary(g, team) {
  const mine = g.players.filter(p => p.t === team)
  const net = mine.reduce((a, p) => a + p.post - p.pre, 0)
  const star = mine.reduce((b, p) => (!b || p.post - p.pre > b.post - b.pre ? p : b), null)
  return { net, star }
}

function Schedule({ team, games, onBox, upcoming = [], onPreview, fetched, goDay }) {
  const parts = [['Regular Season', games.filter(g => !g.post)], ['Postseason', games.filter(g => g.post)]]
  return (
    <div className={styles.sched}>
      {games.length === 0 && upcoming.length === 0 && <div className={styles.empty}>No games yet.</div>}
      {parts.map(([label, gs]) => gs.length > 0 && (
        <div key={label}>
          <div className={styles.schedLabel}>{label}</div>
          <div className={styles.tableWrap}>
            <table className={styles.schedTable}>
              <thead><tr>
                <th>Date</th><th>Opponent</th>
                <th title="Pre-game win chance from the two lineups' Elo and home court">Elo Win %</th>
                <th>Result</th><th>W-L</th>
                <th>Elo Riser</th><th title="Sum of every player's Elo change for this team">Team ΔElo</th><th></th>
              </tr></thead>
              <tbody>
                {gs.map(g => {
                  const { net, star } = teamSummary(g, team)
                  const wp = g.wp[team], upset = (wp < 0.5) === (g.res === 'W')
                  return (
                    <tr key={g.id} onClick={() => onBox(g)}
                      className={upset ? (g.res === 'W' ? styles.rowUpsetW : styles.rowUpsetL) : (g.res === 'W' ? styles.rowW : styles.rowL)}>
                      <td className={styles.date}>{fmtDate(g.date)}</td>
                      <td><span className={styles.opp}>
                        <i>{g.home === false ? '@' : 'vs'}</i><TeamMark t={g.opp} size={22} />
                        <span className={styles.full}>{tName(g.opp)}</span><span className={styles.abbr}>{tCode(g.opp)}</span>
                      </span></td>
                      <td className={styles.num}><span className={styles.wpCell}>
                        <span className={styles.wpBar}><span style={{ width: `${wp * 100}%` }} /></span>
                        {Math.round(wp * 100)}%
                      </span></td>
                      <td><b className={g.res === 'W' ? styles.win : styles.loss}>{g.res}</b> {g.pts}-{g.opp_pts}{g.ot && <small> {g.ot}</small>}
                        {upset && <span className={styles.upsetTag}>{g.res === 'W' ? 'Upset' : 'Upset loss'}</span>}</td>
                      <td className={styles.num}>{g.rec}</td>
                      <td>{star && <span className={styles.riser}>{shortName(star.n)} <b>{sgn(star.post - star.pre)}</b></span>}</td>
                      <td className={`${styles.num} ${net >= 0 ? styles.up : styles.down}`}>{sgn(net)}</td>
                      <td><span className={styles.boxBtn}>Box Score</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {upcoming.length > 0 && (
        <div>
          <div className={styles.schedLabel}>Upcoming · Elo forecast
            <small>Current Elo, recent minutes, injury report{fetched ? ` as of ${fmtDate(fetched.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}</small></div>
          <div className={styles.tableWrap}>
            <table className={`${styles.schedTable} ${styles.upTable}`}>
              <thead><tr><th>Date</th><th>Opponent</th><th>Elo Win %</th><th>Projected</th><th title="Each team's highest-rated healthy player">Top player matchup</th><th></th></tr></thead>
              <tbody>
                {upcoming.map(g => {
                  const mine = g.fg && (g.isHome ? g.fg.home : g.fg.away), theirs = g.fg && (g.isHome ? g.fg.away : g.fg.home)
                  const best = x => x && [...x.rows].filter(r => !r.out).sort((a, b) => b.elo - a.elo)[0]
                  const tm = best(mine), to = best(theirs)
                  return (
                    <tr key={g.id} onClick={() => (g.done ? goDay?.(g.day) : g.fg && onPreview(g))} className={g.done ? `${styles.pending} ${g.won ? styles.rowW : styles.rowL}` : ''}>
                      <td className={styles.date}>{fmtDate(g.day)}</td>
                      <td><span className={styles.opp}>
                        <i>{g.isHome ? 'vs' : '@'}</i><TeamMark t={g.opp} size={22} />
                        <span className={styles.full}>{tName(g.opp)}</span><span className={styles.abbr}>{tCode(g.opp)}</span>
                      </span></td>
                      {g.done ? <>
                        <td colSpan={3}><b className={g.won ? styles.win : styles.loss}>{g.won ? 'W' : 'L'}</b> {g.isHome ? `${g.hs}-${g.as}` : `${g.as}-${g.hs}`} <small className={styles.muted}>Live box score in Games by day</small></td>
                        <td></td>
                      </> : <>
                        <td className={styles.num}><span className={styles.wpCell}>
                          <span className={styles.wpBar}><span style={{ width: `${g.p * 100}%` }} /></span>
                          {Math.round(g.p * 100)}%
                        </span></td>
                        <td>{g.p >= 0.5 ? <span className={styles.favTag}>Favored</span> : <span className={styles.dogTag}>Underdog</span>}</td>
                        <td>{tm && to ? <span className={styles.topMatch}>
                          <span className={tm.elo >= to.elo ? styles.topWin : ''}>{shortName(tm.name)} <b>{r0(tm.elo)}</b></span>
                          <i>vs</i>
                          <span className={to.elo > tm.elo ? styles.topWin : ''}>{shortName(to.name)} <b>{r0(to.elo)}</b></span>
                        </span> : '—'}</td>
                        <td><span className={styles.boxBtn}>Preview</span></td>
                      </>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Game preview (forecast) ──────────────────────────────────────────────────
function Preview({ g, shots, fetched, onClose }) {
  const { home, away, pHome, pAway } = g.fg
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose()
    addEventListener('keydown', k); document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  const P = { [home.team]: pHome, [away.team]: pAway }
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.scoreboard}>
          {[away, home].map((x, i) => (
            <Fragment key={x.team}>
              {i === 1 && <div className={styles.final}>
                <b>Preview</b>
                <span>{fmtDate(g.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <div className={styles.wp}>
                  <em className={styles.wpCap}>Pre-game Elo win chance</em>
                  <div className={styles.wpLab}><span>{Math.round(pAway * 100)}%</span><span>{Math.round(pHome * 100)}%</span></div>
                  <div className={styles.wpTrack}>
                    <span style={{ width: `${pAway * 100}%`, background: tColor(away.team) }} />
                    <span style={{ width: `${pHome * 100}%`, background: tColor(home.team) }} />
                  </div>
                </div>
              </div>}
              <div className={`${styles.sbTeam} ${i ? styles.sbHome : ''} ${styles.sbWin}`}>
                <span className={styles.sbLogo}><TeamMark t={x.team} size={52} /></span>
                <div className={styles.sbInfo}>
                  <div className={styles.sbName}>{tShort(x.team)}</div>
                  <div className={styles.sbCap}>Forecast rating</div>
                  <div className={styles.sbElo}><span>{r0(x.rating)}</span></div>
                </div>
                <div className={styles.sbPts}>{Math.round(P[x.team] * 100)}<small>%</small></div>
              </div>
            </Fragment>
          ))}
        </div>
        <div className={styles.cards}>
          <StoryCard tag="How the forecast works" tone="blue">
            Each team's rating blends its <b>rotation Elo</b> (current player Elo weighted by projected minutes) with its <b>roster Elo</b> (top 8 healthy players, unweighted).
            The rotation gets more weight as the season's sample grows: {Math.round(blendWeight(home.n) * 100)}% for {tShort(home.team)} after {home.n} game{home.n === 1 ? '' : 's'}.
          </StoryCard>
          <StoryCard tag="Injury report" tone="gold">
            Players listed out are removed and their minutes go to the rest of the rotation{fetched ? `. Report as of ${fmtDate(fetched.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}.
          </StoryCard>
        </div>
        {[away, home].map(x => <ProjBox key={x.team} x={x} shots={shots} />)}
      </div>
    </div>
  )
}

function ProjBox({ x, shots }) {
  const rows = x.rows.filter(r => r.mp > 0.5 || r.out || r.status)
  return (
    <div className={styles.teamBox} style={{ '--tc': tColor(x.team) }}>
      <div className={styles.teamBoxHead}><TeamMark t={x.team} size={30} /><span>{tName(x.team)}</span>
        <span className={styles.projSum}>Rotation {r0(x.rot)} × {Math.round(x.w * 100)}% + Roster {r0(x.raw)} × {Math.round((1 - x.w) * 100)}% = <b>{r0(x.rating)}</b></span></div>
      <div className={styles.tableWrap}>
        <table className={`${styles.box} ${styles.projTable}`}>
          <thead><tr>
            <th className={styles.sticky}>Player</th><th>Status</th><th>Current Elo</th><th>Proj MIN</th><th className={styles.swingH}>Share of rotation</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className={r.out ? styles.outRow : ''}>
                <td className={styles.sticky}><span className={styles.pl}><Headshot name={r.name} shots={shots} color={tColor(x.team)} />
                  <span><b className={styles.pName}>{shortName(r.name)}</b>{!r.rated && <small>No Elo yet · 1,500</small>}</span></span></td>
                <td>{r.status ? <span className={r.out ? styles.outTag : styles.dtdTag} title={r.detail}>{r.status}</span> : ''}</td>
                <td className={styles.elo}><b>{r0(r.elo)}</b></td>
                <td>{r.out ? '—' : r.mp.toFixed(1)}</td>
                <td className={styles.swing}><span className={styles.swingIn}><span className={styles.bar}>
                  <span className={styles.barUp} style={{ left: 0, width: `${(r.mp / 42) * 100}%` }} /></span></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Box score ────────────────────────────────────────────────────────────────
function BoxScore({ team, game, has, shots, onCard, onClose }) {
  const [focus, setFocus] = useState(null)
  const [side, setSide] = useState(team) // which team's table shows; starts on the team you came from
  const P = game.players, N = P.length
  const opp = game.opp
  const home = game.home === false ? opp : team
  const away = home === team ? opp : team
  const pts = { [team]: game.pts, [opp]: game.opp_pts }

  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose()
    addEventListener('keydown', k); document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])

  const story = useMemo(() => {
    const d = p => p.post - p.pre
    const climb = [...P].sort((a, b) => d(b) - d(a))[0]
    const drop = [...P].sort((a, b) => d(a) - d(b))[0]
    let gk = null
    for (const a of P) for (const b of P) {
      // The biggest upset in the grid: the duel the winner was least expected to win (largest Elo gap),
      // among players who both logged real minutes and a winner with a meaningful line
      if ((a.mp || 0) >= 12 && (b.mp || 0) >= 12 && a.gs >= 10 && a.gs > b.gs && b.pre - a.pre > (gk ? gk.gap : 0))
        gk = { a, b, gap: b.pre - a.pre, wc: 1 / (1 + 10 ** ((b.pre - a.pre) / 620)) }
    }
    return { climb, drop, gk }
  }, [P])

  const avail = useMemo(() => new Set(['mp', 'trb', 'ast', 'stl', 'blk', 'tov', 'tpa', 'fga', 'fta'].filter(k => P.some(p => (p[k] || 0) > 0))), [P])
  const st = game.live?.state
  const tied = game.pts === game.opp_pts
  const winner = tied ? null : game.res === 'W' ? team : opp
  const fav = game.wp[team] >= 0.5 ? team : opp
  const favWon = fav === winner
  const favPct = Math.round(game.wp[fav] * 100)
  const venue = game.home == null ? '' : fav === home ? ' at home' : ' on the road'

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <div className={styles.scoreboard}>
          {[away, home].map((t, i) => {
            const e = game.elo[t], d = e.post - e.pre
            return (
              <Fragment key={t}>
                {i === 1 && <div className={styles.final}>
                  <b>{st === 'in' ? <><i className={styles.liveDot} />Live · {game.live.detail}</> : `Final${game.ot ? `/${game.ot}` : ''}`}</b>
                  <span>{fmtDate(game.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  {game.post && <span className={styles.postTag}>Postseason</span>}
                  {game.live && <span className={styles.provTag} title="Scored from ESPN's box score. Official once the pipeline processes this game.">Provisional Elo</span>}
                  <div className={styles.wp}>
                    <em className={styles.wpCap}>Pre-game Elo win chance</em>
                    <div className={styles.wpLab}><span>{Math.round(game.wp[away] * 100)}%</span><span>{Math.round(game.wp[home] * 100)}%</span></div>
                    <div className={styles.wpTrack}>
                      <span style={{ width: `${game.wp[away] * 100}%`, background: tColor(away) }} />
                      <span style={{ width: `${game.wp[home] * 100}%`, background: tColor(home) }} />
                    </div>
                  </div>
                </div>}
                <div className={`${styles.sbTeam} ${i ? styles.sbHome : ''} ${t === winner ? styles.sbWin : ''}`}>
                  <span className={styles.sbLogo}><TeamMark t={t} size={52} /></span>
                  <div className={styles.sbInfo}>
                    <div className={styles.sbName}>{tShort(t)}</div>
                    <div className={styles.sbCap} title="Average Elo of the players who played, weighted by their minutes. The schedule's Roster Elo is the unweighted top-8 average.">Lineup Elo · minutes-weighted</div>
                    <div className={styles.sbElo}>
                      <span><small>Pre</small>{r0(e.pre)}<i>{ord(e.preRank.rank)} of {e.preRank.of}</i></span>
                      <span className={styles.sbArrow}>→</span>
                      <span><small>Post</small>{r0(e.post)}<i>{ord(e.postRank.rank)} of {e.postRank.of}</i></span>
                      <b className={d >= 0 ? styles.sbUp : styles.sbDown}>{sgn(d)}</b>
                    </div>
                  </div>
                  <div className={styles.sbPts}>{pts[t]}</div>
                </div>
              </Fragment>
            )
          })}
        </div>

        <div className={styles.cards}>
          <StoryCard tag="Elo Forecast" tone={favWon ? 'blue' : 'gold'}>
            <b>{tShort(fav)}</b> were {favPct}% favorites{venue}
            {st === 'in' ? (tied ? '. Tied.' : favWon ? ' and lead.' : ' and trail.') : favWon ? ' and won.' : '. Upset.'}
          </StoryCard>
          <StoryCard tag="Biggest Climb" tone="up">
            <b>{story.climb.n}</b> {r0(story.climb.pre)} → {r0(story.climb.post)} <em className={styles.up}>{sgn(story.climb.post - story.climb.pre)}</em>
          </StoryCard>
          <StoryCard tag="Biggest Drop" tone="down">
            <b>{story.drop.n}</b> {r0(story.drop.pre)} → {r0(story.drop.post)} <em className={styles.down}>{sgn(story.drop.post - story.drop.pre)}</em>
          </StoryCard>
          {story.gk && <StoryCard tag="Giant Killer" tone="gold">
            <b>{story.gk.a.n}</b> ({r0(story.gk.a.pre)}) out-scored <b>{story.gk.b.n}</b> ({r0(story.gk.b.pre)}): a {r0(story.gk.gap)}-point Elo gap, {Math.max(1, Math.round(story.gk.wc * 100))}% pre-game duel win chance.
          </StoryCard>}
        </div>

        <div className={styles.teamSwitch} role="tablist" aria-label="Team box score">
          {[away, home].map(t => (
            <button key={t} type="button" role="tab" aria-selected={side === t} className={side === t ? styles.switchOn : ''}
              style={{ '--tc': tColor(t) }} onClick={() => setSide(t)}>
              <TeamMark t={t} size={26} /><span>{tName(t)}</span><b>{pts[t]}</b>
            </button>
          ))}
        </div>
        <TeamBox key={side} t={side} rows={P.filter(p => p.t === side)} N={N} has={has} avail={avail} shots={shots}
          focus={focus} setFocus={setFocus} onCard={onCard} />

        <DuelGrid P={P} focus={focus} setFocus={setFocus} shots={shots} />
      </div>
    </div>
  )
}

function StoryCard({ tag, tone, children }) {
  return <div className={`${styles.card} ${styles['t_' + tone]}`}><div className={styles.cardTag}>{tag}</div><div>{children}</div></div>
}

// Box score columns in three groups. `need`: the season must have recorded the stat.
// `any`: hide when nobody in this game has a nonzero value (older box scores log unrecorded stats as 0).
const fmtPct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, '') : '—')
const ts = p => { const d = 2 * ((p.fga || 0) + 0.44 * (p.fta || 0)); return d ? (p.pts || 0) / d : null }
const BOX_GROUPS = [
  { g: 'Raw Stats', cls: 'gRaw', cols: [
    { h: 'MIN', need: 'mp', any: 'mp', v: p => p.mp ?? '—', tot: () => '' },
    { h: 'PTS', v: p => p.pts ?? '—', cls: 'pts', sum: 'pts' },
    { h: 'REB', any: 'trb', v: p => p.trb ?? '—', sum: 'trb' },
    { h: 'AST', any: 'ast', v: p => p.ast ?? '—', sum: 'ast' },
    { h: 'STL', need: 'stl', any: 'stl', v: p => p.stl ?? '—', sum: 'stl' },
    { h: 'BLK', need: 'blk', any: 'blk', v: p => p.blk ?? '—', sum: 'blk' },
    { h: 'TO', need: 'tov', any: 'tov', v: p => p.tov ?? '—', sum: 'tov' },
    { h: '+/-', need: 'pm', v: p => (p.pm == null ? '—' : p.pm > 0 ? `+${p.pm}` : p.pm), tot: () => '' },
  ] },
  { g: 'Shooting', cls: 'gShoot', cols: [
    { h: 'FG', pair: ['fg', 'fga'] },
    { h: 'FG%', any: 'fga', pct: ['fg', 'fga'] },
    { h: '3PT', need: 'tp', any: 'tpa', pair: ['tp', 'tpa'] },
    { h: '3P%', need: 'tp', any: 'tpa', pct: ['tp', 'tpa'] },
    { h: 'FT', pair: ['ft', 'fta'] },
    { h: 'FT%', any: 'fta', pct: ['ft', 'fta'] },
    { h: 'TS%', any: 'fga', v: p => { const v = ts(p); return v == null ? '—' : v.toFixed(3).replace(/^0/, '') },
      tot: rows => { const v = ts({ pts: sum(rows, 'pts'), fga: sum(rows, 'fga'), fta: sum(rows, 'fta') }); return v == null ? '—' : v.toFixed(3).replace(/^0/, '') } },
  ] },
]
const sum = (rows, k) => rows.reduce((s, p) => s + (p[k] || 0), 0)
const split = (m, a, showA = true) => (m == null ? '—' : showA ? `${m}-${a ?? '—'}` : `${m}`)

// Raw stats gain GmSc (the stat every duel is decided on) at the end
const RAW_EXTRA = { h: 'GmSc', v: p => p.gs.toFixed(1), cls: 'gs', tot: () => '' }

// Elo journey: pre-game Elo, duels expected vs. won on a 0..N-1 track, post-game Elo, change
function DuelTrack({ w, xw, n }) {
  const pc = v => `${(Math.max(0, Math.min(n, v)) / n) * 100}%`
  const beat = w >= xw, lo = Math.min(w, xw), hi = Math.max(w, xw), diff = w - xw
  const flip = beat ? w > n * 0.72 : w > n * 0.12 // put the label on the open side
  return (
    <span className={styles.track} title={`Won ${w} of ${n} duels; Elo expected ${xw.toFixed(1)}`}>
      <span className={styles.trackLine} />
      {[0.2, 0.4, 0.6, 0.8].map(f => <span key={f} className={styles.trackTick} style={{ left: `${f * 100}%` }} />)}
      <span className={beat ? styles.trackUp : styles.trackDown} style={{ left: pc(lo), width: `calc(${pc(hi)} - ${pc(lo)})` }} />
      <span className={styles.trackExp} style={{ left: pc(xw) }} />
      <span className={beat ? styles.trackWonUp : styles.trackWonDown} style={{ left: pc(w) }} />
      <span className={`${styles.trackLab} ${beat ? styles.up : styles.down}`}
        style={flip ? { right: `calc(100% - ${pc(lo)} + 13px)` } : { left: `calc(${pc(hi)} + 13px)` }}>{sgn(diff)}</span>
    </span>
  )
}

function TeamBox({ t, rows, N, has, avail, shots, focus, setFocus, onCard }) {
  const groups = BOX_GROUPS.map(G => ({ ...G, cols: [...G.cols.filter(c => (!c.need || has?.has(c.need)) && (!c.any || avail.has(c.any))), ...(G.g === 'Raw Stats' ? [RAW_EXTRA] : [])] }))
    .filter(G => G.cols.length)
  const cell = c => p => c.pair ? split(p[c.pair[0]], p[c.pair[1]], avail.has(c.pair[1]))
    : c.pct ? fmtPct(p[c.pct[0]] || 0, p[c.pct[1]] || 0) : c.v(p)
  const total = c => c.pair ? split(sum(rows, c.pair[0]), sum(rows, c.pair[1]), avail.has(c.pair[1]))
    : c.pct ? fmtPct(sum(rows, c.pct[0]), sum(rows, c.pct[1])) : c.sum ? sum(rows, c.sum) : c.tot ? c.tot(rows) : ''
  const starters = has?.has('st') && rows.some(p => p.st)
  const sorted = [...rows].sort((a, b) => (starters ? b.st - a.st : 0) || (b.mp || 0) - (a.mp || 0) || (b.pts || 0) - (a.pts || 0))
  const sections = starters ? [['Starters', sorted.filter(p => p.st)], ['Bench', sorted.filter(p => !p.st)]] : [[null, sorted]]
  const net = rows.reduce((s, p) => s + p.post - p.pre, 0)
  const ELO_COLS = 4
  const width = 2 + ELO_COLS + groups.reduce((s, G) => s + G.cols.length, 0)
  const n = N - 1

  const row = p => {
    const d = p.post - p.pre
    return (
      <tr key={p.n} className={focus === p.n ? styles.focus : ''} onMouseEnter={() => setFocus(p.n)} onMouseLeave={() => setFocus(null)}>
        <td className={styles.sticky}>
          <span className={styles.pl}>
            <Headshot name={p.n} shots={shots} color={tColor(t)} />
            <span><button className={styles.pName} onClick={() => onCard(p.n)} title="Open player card">{shortName(p.n)}</button>
              <small>{[p.pos, tierFor(p.lr).id !== 'common' && tierFor(p.lr).label].filter(Boolean).join(' · ')}</small></span>
          </span>
        </td>
        <td className={styles.rankCell}><RankCell p={p} /></td>
        <td className={`${styles.gElo} ${styles.gStart} ${styles.eloPre}`}>{r0(p.pre)}</td>
        <td className={`${styles.gElo} ${styles.trackCell}`}><DuelTrack w={p.w} xw={p.xw} n={n} /></td>
        <td className={`${styles.gElo} ${styles.eloPost}`}>{r0(p.post)}</td>
        <td className={`${styles.gElo} ${styles.eloDelta} ${d >= 0 ? styles.up : styles.down}`}>{sgn(d)}</td>
        {groups.map(G => G.cols.map((c, j) => (
          <td key={G.g + c.h} className={`${styles[G.cls]} ${j === 0 ? styles.gStart : ''} ${c.cls ? styles[c.cls] : ''}`}>{cell(c)(p)}</td>
        )))}
      </tr>
    )
  }

  return (
    <div className={styles.teamBox} style={{ '--tc': tColor(t) }}>
      <div className={styles.teamBoxHead}><TeamMark t={t} size={30} /><span>{tName(t)}</span>
        <span className={styles.boxLegend}><i className={styles.legExp} />Duels Elo expected<i className={styles.legWon} />Duels won</span></div>
      <div className={styles.tableWrap}>
        <table className={styles.box}>
          <thead>
            <tr className={styles.groupRow}>
              <th className={styles.sticky} /><th />
              <th colSpan={ELO_COLS} className={`${styles.gElo} ${styles.gStart}`}><span>Elo</span></th>
              {groups.map(G => <th key={G.g} colSpan={G.cols.length} className={`${styles[G.cls]} ${styles.gStart}`}><span>{G.g === 'Raw Stats' ? 'Raw' : G.g}</span></th>)}
            </tr>
            <tr>
              <th className={styles.sticky}>Player</th>
              <th className={styles.rankHead} title="League Elo rank after this game, among FPR-qualified players">Rank</th>
              <th className={`${styles.gElo} ${styles.gStart}`}>Pre</th>
              <th className={`${styles.gElo} ${styles.trackHead}`} title={`Every player duels the other ${n} on Game Score`}>
                <span>Duels: expected → won</span>
                <span className={styles.trackScale}><i style={{ left: '0%' }}>0</i><i style={{ left: '50%' }}>{Math.round(n / 2)}</i><i style={{ left: '100%' }}>{n}</i></span>
              </th>
              <th className={styles.gElo}>Post</th>
              <th className={styles.gElo}>Elo Δ</th>
              {groups.map(G => G.cols.map((c, j) => <th key={G.g + c.h} className={`${styles[G.cls]} ${j === 0 ? styles.gStart : ''}`}>{c.h}</th>))}
            </tr>
          </thead>
          {sections.map(([label, ps]) => (
            <tbody key={label || 'all'} className={label === 'Bench' ? styles.benchBody : undefined}>
              {label && <tr className={styles.section}><td className={styles.sticky}>{label}</td><td colSpan={width - 1} /></tr>}
              {ps.map(row)}
            </tbody>
          ))}
          <tbody>
            <tr className={styles.totals}>
              <td className={styles.sticky}>Team</td>
              <td />
              <td className={`${styles.gElo} ${styles.gStart}`} /><td className={styles.gElo} /><td className={styles.gElo} />
              <td className={`${styles.gElo} ${styles.eloDelta} ${net >= 0 ? styles.up : styles.down}`}>{sgn(net)}</td>
              {groups.map(G => G.cols.map((c, j) => (
                <td key={G.g + c.h} className={`${styles[G.cls]} ${j === 0 ? styles.gStart : ''} ${c.cls ? styles[c.cls] : ''}`}>{total(c)}</td>
              )))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// League Elo rank after the game (pre-game rank on data without it), with the move; -- when unranked
function RankCell({ p }) {
  const rank = p.unrated ? null : p.lrp ?? p.lr ?? null
  if (rank == null) return <span className={styles.rankNone} title="Not ranked">--</span>
  const mv = p.lrp != null && p.lr != null ? p.lr - p.lrp : 0
  return (
    <span className={styles.rankVal} title={p.lrp != null && p.lr != null ? `#${p.lr} before the game` : undefined}>
      <b>#{rank}</b>{mv !== 0 && <i className={mv > 0 ? styles.up : styles.down}>{mv > 0 ? '▲' : '▼'}{Math.abs(mv)}</i>}
    </span>
  )
}

// The differentiator: FPR scores a game as a round robin. Every cell is one duel.
function DuelGrid({ P, focus, setFocus, shots }) {
  const [hover, setHover] = useState(null)
  const [pin, setPin] = useState(null)
  const [cellPx, setCellPx] = useState(22)
  const sideRef = useRef(null)
  const N = P.length
  const order = useMemo(() => [...P].sort((a, b) => b.gs - a.gs), [P])
  const cells = useMemo(() => order.map(a => order.map(b => (a === b ? null : duel(a, b, N)))), [order, N])
  const max = Math.max(1, ...cells.flat().filter(Boolean).map(c => Math.abs(c.delta)))
  const shade = v => {
    const a = Math.min(1, Math.abs(v) / max) ** 0.6
    return v >= 0 ? `rgba(26,122,74,${0.12 + a * 0.85})` : `rgba(168,50,50,${0.12 + a * 0.85})`
  }
  const rec = useMemo(() => cells.map(row => {
    const w = row.reduce((s, c) => s + (c ? c.act : 0), 0)
    return { w, l: N - 1 - w }
  }), [cells, N])
  const netMax = Math.max(1, ...order.map(p => Math.abs(p.post - p.pre)))

  // Cells grow to fill the space beside the panel (14–36px)
  useEffect(() => {
    const el = sideRef.current; if (!el) return
    const fit = () => {
      const avail = el.clientWidth - 200 - 164 // row labels, record + net
      setCellPx(Math.max(14, Math.min(36, Math.floor((avail - 2 * (N - 1)) / N))))
    }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(el)
    return () => ro.disconnect()
  }, [N])

  // Key duels: the biggest Elo exchanges (winner's side) and the least likely wins
  const key = useMemo(() => {
    const wins = []
    cells.forEach((row, i) => row.forEach((c, j) => { if (c && c.act === 1) wins.push({ i, j, c }) }))
    const swings = [...wins].sort((x, y) => y.c.delta - x.c.delta).slice(0, 5)
    const upset = [...wins].sort((x, y) => x.c.exp - y.c.exp)[0]
    return { swings, upset }
  }, [cells])

  const sel = hover || pin
  const pick = (i, j) => setPin(p => (p && p[0] === i && p[1] === j ? null : [i, j]))
  const lab = p => shortName(p.n).replace(/^(.)\. /, '$1.')
  const cs = cellPx

  const Detail = ({ i, j }) => {
    const a = order[i], b = order[j], c = cells[i][j], back = cells[j][i]
    const verb = c.act === 1 ? 'beat' : c.act === 0 ? 'lost to' : 'tied'
    const upset = (c.act === 1 && c.exp < 0.5) || (c.act === 0 && c.exp > 0.5)
    const side = (p, d, chance) => (
      <div className={styles.dSide}>
        <Headshot name={p.n} shots={shots} color={tColor(p.t)} />
        <div className={styles.dWho}><b>{shortName(p.n)}</b><small><TeamMark t={p.t} size={14} /> {r0(p.pre)} Elo</small></div>
        <div className={styles.dGs}><b>{p.gs.toFixed(1)}</b><small>GmSc</small></div>
        <div className={`${styles.dDelta} ${d >= 0 ? styles.up : styles.down}`}>{sgn(d, 2)}</div>
      </div>
    )
    return (
      <div className={styles.dCard}>
        <div className={styles.dTag}>{pin && pin[0] === i && pin[1] === j ? 'Pinned duel' : 'Duel'}{upset && <span className={styles.upsetTag}>Upset</span>}</div>
        <div className={styles.dLine}><b>{shortName(a.n)}</b> {verb} <b>{shortName(b.n)}</b></div>
        {side(a, c.delta)}
        {side(b, back.delta)}
        <div className={styles.dChance}>
          <em className={styles.dChanceCap}>Pre-game duel win chance</em>
          <div className={styles.dChanceLab}><span>{shortName(a.n)} <b>{Math.round(c.exp * 100)}%</b></span><span><b>{Math.round((1 - c.exp) * 100)}%</b> {shortName(b.n)}</span></div>
          <div className={styles.wpTrack}><span style={{ width: `${c.exp * 100}%`, background: '#1a5fa8' }} /><span style={{ width: `${(1 - c.exp) * 100}%`, background: '#c3ccd6' }} /></div>
        </div>
        <p className={styles.dWhy}>{upset
          ? `${shortName(c.act === 1 ? a.n : b.n)} had a ${Math.round((c.act === 1 ? c.exp : 1 - c.exp) * 100)}% chance and won anyway, so the swing is larger.`
          : c.act === 0.5 ? 'Equal Game Scores split the duel.'
          : `The favorite won, so the Elo moved ${Math.abs(c.delta) < 1 ? 'only a little' : 'modestly'}.`}</p>
      </div>
    )
  }

  return (
    <div className={styles.duel}>
      <div className={styles.duelHead}>
        <h3>The Duel Grid</h3>
        <p>FPR scores every game as a round robin. Each player faces all {N - 1} others on the floor, from both teams, and wins a duel by posting the higher Game Score. The Elo he gains or loses in each duel depends on how much the rating expected him to win. Upsets pay more. Rows are sorted by Game Score; read across to see one player's {N - 1} results. Click a cell to pin it.</p>
      </div>
      <div className={styles.duelBody}>
        <div ref={sideRef} className={styles.duelGridSide}>
          <div className={styles.tableWrap}>
            <div className={styles.grid} style={{ gridTemplateColumns: `minmax(130px,max-content) repeat(${N}, ${cs}px) 150px`, '--cs': `${cs}px` }}
              onMouseLeave={() => { setHover(null); setFocus(null) }}>
              <span />
              {order.map((b, j) => (
                <span key={j} className={`${styles.colLab} ${focus === b.n ? styles.lit : ''}`} style={{ '--tc': tColor(b.t) }}>{lab(b)}</span>
              ))}
              <span className={`${styles.colLab} ${styles.netLab}`}>Record · Net Elo</span>
              {order.map((a, i) => {
                const d = a.post - a.pre
                return (
                  <Fragment key={a.n}>
                    <span className={`${styles.rowLab} ${focus === a.n ? styles.lit : ''}`} style={{ '--tc': tColor(a.t) }}>
                      {shortName(a.n)} <small>{a.gs}</small>
                    </span>
                    {order.map((b, j) => {
                      const c = cells[i][j]
                      const on = sel && sel[0] === i && sel[1] === j
                      const lit = sel && (sel[0] === i || sel[1] === j)
                      return c
                        ? <button key={j} type="button" aria-label={`${a.n} vs ${b.n}`}
                          className={`${styles.cell} ${on ? styles.cellOn : lit ? styles.cellLit : ''} ${focus === a.n || focus === b.n ? styles.cellFocus : ''}`}
                          style={{ background: shade(c.delta) }}
                          onMouseEnter={() => { setHover([i, j]); setFocus(a.n) }} onClick={() => pick(i, j)} />
                        : <span key={j} className={styles.diag} />
                    })}
                    <span className={styles.netCell}>
                      <span className={styles.netRec}>{Number.isInteger(rec[i].w) ? rec[i].w : rec[i].w.toFixed(1)}–{Number.isInteger(rec[i].l) ? rec[i].l : rec[i].l.toFixed(1)}</span>
                      <span className={styles.netBar}><span className={d >= 0 ? styles.barUp : styles.barDown} style={{ width: `${Math.min(50, Math.abs(d) / netMax * 50)}%` }} /></span>
                      <b className={d >= 0 ? styles.up : styles.down}>{sgn(d)}</b>
                    </span>
                  </Fragment>
                )
              })}
            </div>
          </div>
        </div>

        <aside className={styles.duelPanel}>
          {sel ? <Detail i={sel[0]} j={sel[1]} /> : (
            <div className={styles.dCard}>
              <div className={styles.dTag}>Key duels</div>
              <p className={styles.dIntro}>The five duels that moved the most Elo. Click one to find it in the grid.</p>
              {key.swings.map(({ i, j, c }) => (
                <button key={`${i}-${j}`} type="button" className={styles.keyRow} onClick={() => pick(i, j)}
                  onMouseEnter={() => setFocus(order[i].n)} onMouseLeave={() => setFocus(null)}>
                  <span className={styles.keyWho}><b>{shortName(order[i].n)}</b> over {shortName(order[j].n)}</span>
                  <span className={styles.keyMeta}>{order[i].gs.toFixed(1)} vs {order[j].gs.toFixed(1)} GmSc · {Math.round(c.exp * 100)}% chance</span>
                  <b className={styles.up}>{sgn(c.delta, 2)}</b>
                </button>
              ))}
              {key.upset && <>
                <div className={`${styles.dTag} ${styles.dTagGap}`}>Biggest upset</div>
                <button type="button" className={`${styles.keyRow} ${styles.keyUpset}`} onClick={() => pick(key.upset.i, key.upset.j)}>
                  <span className={styles.keyWho}><b>{shortName(order[key.upset.i].n)}</b> over {shortName(order[key.upset.j].n)}</span>
                  <span className={styles.keyMeta}>{r0(order[key.upset.i].pre)} vs {r0(order[key.upset.j].pre)} Elo · {Math.round(key.upset.c.exp * 100)}% chance</span>
                  <b className={styles.up}>{sgn(key.upset.c.delta, 2)}</b>
                </button>
              </>}
            </div>
          )}
          {pin && !hover && <button type="button" className={styles.unpin} onClick={() => setPin(null)}>Back to key duels</button>}
        </aside>
      </div>
    </div>
  )
}

// ── Elo progression chart ────────────────────────────────────────────────────
function Progression({ team, games, selectPlayer }) {
  const roster = useMemo(() => {
    const m = {}
    games.forEach((g, gi) => g.players.forEach(p => {
      if (p.t !== team) return
      const r = m[p.n] || (m[p.n] = { n: p.n, gp: 0, min: 0, first: gi, start: p.pre, pts: {}, peak: p.post })
      r.gp++; r.min += p.mp || 0; r.pts[gi] = p.post; r.cur = p.post; r.peak = Math.max(r.peak, p.post)
    }))
    return Object.values(m).sort((a, b) => b.min - a.min).map((r, i) => ({ ...r, color: LINE_COLORS[i % LINE_COLORS.length] }))
  }, [games, team])

  const [shown, setShown] = useState(() => new Set(roster.slice(0, 8).map(r => r.n)))
  const [hl, setHl] = useState(null)
  useEffect(() => { setShown(new Set(roster.slice(0, 8).map(r => r.n))) }, [roster])

  // x = 0 is the season start; x = i + 1 is after the team's i-th game
  const data = useMemo(() => {
    const rows = [{ x: 0, label: 'Start' }, ...games.map((g, i) => ({
      x: i + 1, label: `G${i + 1} ${g.home === false ? '@' : 'vs'} ${tCode(g.opp)}`, res: `${g.res} ${g.pts}-${g.opp_pts}`, date: g.date,
    }))]
    roster.forEach(r => {
      rows[r.first][r.n] = r.start
      Object.entries(r.pts).forEach(([gi, v]) => { rows[+gi + 1][r.n] = v })
    })
    return rows
  }, [games, roster])

  const vis = roster.filter(r => shown.has(r.n))
  const vals = vis.flatMap(r => [r.start, ...Object.values(r.pts)])
  const lo = vals.length ? Math.floor((Math.min(...vals) - 25) / 50) * 50 : 1400
  const hi = vals.length ? Math.ceil((Math.max(...vals) + 25) / 50) * 50 : 2000
  const toggle = n => setShown(s => { const t = new Set(s); t.has(n) ? t.delete(n) : t.add(n); return t })

  const Tip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const row = data[label]
    const items = payload.filter(p => p.value != null).sort((a, b) => b.value - a.value)
    return (
      <div className={styles.tip}>
        <div className={styles.tipHead}>{row.label}{row.res && <span> · {row.res}</span>}{row.date && <small> {fmtDate(row.date)}</small>}</div>
        {items.map(p => {
          const prev = (() => { for (let x = label - 1; x >= 0; x--) { const v = data[x][p.dataKey]; if (v != null) return v } return null })()
          const played = label > 0 && roster.find(r => r.n === p.dataKey)?.pts[label - 1] != null
          return (
            <div key={p.dataKey} className={styles.tipRow}>
              <i style={{ background: p.stroke }} />{shortName(p.dataKey)}<b>{r0(p.value)}</b>
              {played && prev != null && <em className={p.value >= prev ? styles.up : styles.down}>{sgn(p.value - prev)}</em>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={styles.prog}>
      <div className={styles.chips}>
        {roster.map(r => (
          <button key={r.n} className={shown.has(r.n) ? styles.chipOn : styles.chip} style={{ '--lc': r.color }}
            onClick={() => toggle(r.n)} onMouseEnter={() => shown.has(r.n) && setHl(r.n)} onMouseLeave={() => setHl(null)}>
            <i />{shortName(r.n)}
          </button>
        ))}
        <button className={styles.chipAct} onClick={() => setShown(new Set(roster.map(r => r.n)))}>All</button>
        <button className={styles.chipAct} onClick={() => setShown(new Set())}>None</button>
      </div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="#e8e8e8" vertical={false} />
            <XAxis dataKey="x" type="number" domain={[0, games.length]} allowDecimals={false}
              tickFormatter={x => (x ? `G${x}` : 'Start')} tick={{ fontSize: 11, fill: '#888' }}
              interval="preserveStartEnd" minTickGap={18} />
            <YAxis domain={[lo, hi]} tick={{ fontSize: 11, fill: '#888' }} width={46} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<Tip />} />
            {vis.map(r => (
              <Line key={r.n} dataKey={r.n} stroke={r.color} connectNulls isAnimationActive={false}
                strokeWidth={hl === r.n ? 3.5 : 2} strokeOpacity={hl && hl !== r.n ? 0.15 : 1}
                dot={games.length <= 20 ? { r: 2.5, strokeWidth: 0, fill: r.color } : false} activeDot={{ r: 4 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.movers}>
          <thead><tr><th>Player</th><th>GP</th><th>MIN</th><th>Start</th><th>Now</th><th>Peak</th><th>Season Δ</th></tr></thead>
          <tbody>
            {[...roster].sort((a, b) => (b.cur - b.start) - (a.cur - a.start)).map(r => (
              <tr key={r.n} onMouseEnter={() => shown.has(r.n) && setHl(r.n)} onMouseLeave={() => setHl(null)}>
                <td><span className={styles.dot} style={{ background: r.color }} />
                  <button className={styles.pName} onClick={() => selectPlayer(r.n)}>{r.n}</button></td>
                <td>{r.gp}</td><td>{Math.round(r.min)}</td><td>{r0(r.start)}</td><td><b>{r0(r.cur)}</b></td><td>{r0(r.peak)}</td>
                <td className={r.cur >= r.start ? styles.up : styles.down}><b>{sgn(r.cur - r.start)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Games by day: scoreboard, leaderboards, box scores. Days already in the data use the
// pipeline's Elo; later days (and games the data doesn't have yet) are scored live from ESPN.
function Today({ day, sd, index, fc, shots, ratings, selectPlayer }) {
  const asof = index.seasons[0]?.last || '0000-00-00'
  const wantsLive = day >= asof
  const [feed, setFeed] = useState(null)
  const [feedErr, setFeedErr] = useState(null)
  const [box, setBox] = useState(null)        // { id, team }
  const [card, setCard] = useState(null)      // { id: game id, name }
  const [preview, setPreview] = useState(null)
  const sdOk = sd && (sd.season === seasonFor(day) || (sd.season === index.seasons[0]?.season && seasonFor(day) > sd.season))
  const sy = +seasonFor(day).slice(0, 4)

  useEffect(() => {
    setFeed(null); setFeedErr(null); setBox(null); setCard(null)
    if (!wantsLive) return
    let stop = false, timer
    const load = () => fetch(`/api/live?date=${day}`).then(r => r.json()).then(d => {
      if (stop) return
      setFeed(d)
      setFeedErr(!d.games?.length && d.errors?.length ? d.errors[0] : null)
      // Poll while games are live; check back every 2 minutes on a game day before tip-off
      const wait = d.live ? 30000 : d.games?.some(g => g.state === 'pre') && day === etToday() ? 120000 : 0
      if (wait) timer = setTimeout(load, wait)
    }).catch(e => { if (!stop) { setFeedErr(e.message); timer = setTimeout(load, 60000) } })
    load()
    return () => { stop = true; clearTimeout(timer) }
  }, [day, wantsLive])

  // Each team's lineup Elo going into the day, for league ranks on live games
  const teamLatest = useMemo(() => {
    if (!sdOk) return {}
    const m = { ...(sd.seed || {}) }
    sd.games.forEach(g => { if (g.date < day) g.teams.forEach(t => { m[t] = g.elo[t].post }) })
    return m
  }, [sd, sdOk, day])

  const { scored, sched, unmatched } = useMemo(() => {
    const data = sdOk ? sd.games.filter(g => g.date === day) : []
    const have = new Set(data.map(g => [...g.teams].sort().join('|')))
    const live = [], sched = []
    for (const x of feed?.games || []) {
      if (have.has([x.home, x.away].sort().join('|'))) continue
      const g = x.box ? scoreGame(x, ratings, day, winChance, sy) : null
      if (g) live.push(g); else sched.push(x)
    }
    assignRanks(live, ratings)
    const rankOf = (t, v) => {
      const others = Object.entries(teamLatest).filter(([k]) => k !== t && !k.includes('@'))
      return { rank: 1 + others.filter(([, x]) => x > v).length, of: others.length + 1 }
    }
    live.forEach(g => g.teams.forEach(t => Object.assign(g.elo[t], { preRank: rankOf(t, g.elo[t].pre), postRank: rankOf(t, g.elo[t].post) })))
    const unmatched = live.flatMap(g => g.players.filter(p => p.unrated).map(p => `${p.espnName} (${tCode(p.t)})`))
    return { scored: [...data, ...live], sched, unmatched }
  }, [sd, sdOk, day, feed, ratings, teamLatest, sy])

  const boards = useMemo(() => dayBoards(scored), [scored])
  const cards = useMemo(() => {
    const order = { in: 0, pre: 1, post: 2 }
    const list = [
      ...scored.map(g => ({ key: g.id, g, state: g.live?.state || 'post', tip: g.tip || '' })),
      ...sched.map(x => ({ key: x.id, x, state: x.state, tip: x.tip || '', fg: fc && x.state === 'pre' ? safeGame(fc.f, x.home, x.away, day) : null })),
    ]
    return list.sort((a, b) => order[a.state] - order[b.state] || a.tip.localeCompare(b.tip) || a.key.localeCompare(b.key))
  }, [scored, sched, fc, day])

  const openBox = (g, team) => setBox({ id: g.id, team: team || (g.home && g.teams.find(t => t !== g.home)) || g.teams[0] })
  const boxGame = box && scored.find(g => g.id === box.id)
  const boxView = boxGame && viewFor(boxGame, box.team, sy)
  const openCard = (g, p) => setCard({ id: g.id, name: p.n })
  const cardGame = card && scored.find(g => g.id === card.id)
  const cardRow = cardGame?.players.find(p => p.n === card.name)
  const cardView = cardRow && viewFor(cardGame, cardRow.t, sy)
  const cardSd = cardGame && (sdOk && sd.games.includes(cardGame) ? sd : { season: seasonFor(day), games: [...(sdOk ? sd.games.filter(g => g.date < day) : []), cardGame] })
  const liveN = cards.filter(c => c.state === 'in').length
  const provisional = scored.some(g => g.live)
  const loading = (wantsLive && !feed && !feedErr) || (!sdOk && day <= asof)

  return (
    <div className={styles.dayPage}>
      <div className={styles.dayBar}>
        <span><b>{cards.length || 'No'}</b> game{cards.length === 1 ? '' : 's'}{liveN ? <> · <span className={styles.liveTxt}><i className={styles.liveDot} />{liveN} live</span></> : ''}</span>
        {provisional && <span className={styles.muted}>Live and unprocessed games use ratings through {fmtDate(ratings.asof || asof, { month: 'short', day: 'numeric' })}. Elo is provisional until the next data update.</span>}
        {!provisional && day <= asof && cards.length > 0 && <span className={styles.muted}>Official Elo from the ratings pipeline.</span>}
        {feed?.fetched && wantsLive && <span className={styles.muted}>Updated {new Date(feed.fetched).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>}
      </div>

      {loading ? <div className={styles.empty}>Loading games…</div>
        : feedErr && !cards.length ? <div className={styles.empty}>Couldn't load the scoreboard: {feedErr}</div>
        : !cards.length ? <div className={styles.empty}>No games on {fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}.</div>
        : <>
          <div className={styles.gGrid}>
            {cards.map(c => <GameCard key={c.key} c={c} shots={shots}
              onOpen={c.g ? () => openBox(c.g) : c.fg ? () => setPreview({ day, fg: c.fg }) : null} />)}
          </div>

          {scored.length > 0 && <>
            <PerfTable rows={boards.performers} shots={shots} onOpen={openCard} />

            <div className={styles.boards4}>
              <Board title="Elo risers" sub="Elo change" rows={boards.risers} shots={shots} onOpen={openCard}
                val={({ p }) => sgn(p.post - p.pre)} valCls={styles.up} line={({ p }) => `${r0(p.pre)} → ${r0(p.post)} · ${p.gs.toFixed(1)} GmSc`} />
              <Board title="Elo fallers" sub="Elo change" rows={boards.fallers} shots={shots} onOpen={openCard}
                val={({ p }) => sgn(p.post - p.pre)} valCls={styles.down} line={({ p }) => `${r0(p.pre)} → ${r0(p.post)} · ${p.gs.toFixed(1)} GmSc`} />
              <Board title="Top 100 risers" sub="League rank" rows={boards.top100Risers} shots={shots} onOpen={openCard} empty="Nobody climbed inside the top 100."
                val={({ p }) => `▲${p.lr - p.lrp}`} valCls={styles.up}
                line={({ p }) => `#${p.lr} → #${p.lrp}${p.lr > 100 ? ' · enters top 100' : ''}`} />
              <Board title="Top 100 fallers" sub="League rank" rows={boards.top100Fallers} shots={shots} onOpen={openCard} empty="Nobody in the top 100 slipped."
                val={({ p }) => `▼${p.lrp - p.lr}`} valCls={styles.down}
                line={({ p }) => `#${p.lr} → #${p.lrp}${p.lrp > 100 ? ' · drops out' : ''}`} />
            </div>

            <div className={styles.boards2}>
              <section className={styles.board}>
                <header><h3>Biggest upsets · Games</h3><span>Winner's pre-game chance</span></header>
                {boards.gameUpsets.length ? boards.gameUpsets.map(u => {
                  const ongoing = u.g.live?.state === 'in', i = u.g.teams.indexOf(u.team)
                  return (
                    <button key={u.g.id} className={styles.bRow} onClick={() => openBox(u.g, u.team)}>
                      <span className={styles.bLogo}><TeamMark t={u.team} size={30} /></span>
                      <span className={styles.bWho}><b>{tShort(u.team)} {ongoing ? 'lead' : 'over'} {tShort(u.opp)}</b>
                        <small>{u.g.pts[i]}-{u.g.pts[1 - i]}{ongoing ? ` · ${u.g.live.detail}` : ''}</small></span>
                      <b className={styles.bVal}>{Math.round(u.chance * 100)}%</b>
                    </button>
                  )
                }) : <p className={styles.bNone}>Every favorite {scored.some(g => g.live?.state === 'in') ? 'leads or won' : 'won'}.</p>}
              </section>
              <section className={styles.board}>
                <header><h3>Biggest upsets · Players</h3><span>Pre-game duel chance</span></header>
                {boards.duelUpsets.length ? boards.duelUpsets.map(u => (
                  <button key={u.g.id + u.a.n + u.b.n} className={styles.bRow} onClick={() => openCard(u.g, u.a)}>
                    <Headshot name={u.a.n} shots={shots} color={tColor(u.a.t)} />
                    <span className={styles.bWho}><b>{shortName(u.a.n)} <i>over</i> {shortName(u.b.n)}</b>
                      <small>{u.a.gs.toFixed(1)} vs {u.b.gs.toFixed(1)} GmSc · {r0(u.a.pre)} vs {r0(u.b.pre)} Elo</small></span>
                    <b className={styles.bVal}>{Math.max(1, Math.round(u.chance * 100))}%</b>
                  </button>
                )) : <p className={styles.bNone}>No qualifying upsets yet.</p>}
              </section>
            </div>
          </>}
          {unmatched.length > 0 && <p className={styles.unmatched} title="ESPN names with no match in the ratings. They're scored as new players at 1,500 until the pipeline links them.">
            Rated as new players (no ratings match): {unmatched.join(', ')}</p>}
        </>}

      {preview && <Preview g={preview} shots={shots} fetched={fc?.fetched} onClose={() => setPreview(null)} />}
      {boxView && <BoxScore key={box.id} team={box.team} game={boxView} has={boxGame.live ? FULL_STATS : sd?.has} shots={shots}
        onCard={n => setCard({ id: box.id, name: n })} onClose={() => setBox(null)} />}
      {cardView && (
        <PlayerCard name={card.name} row={cardRow} sd={cardSd}
          game={{ id: cardView.id, date: cardView.date, home: cardView.home, oppAbbr: tCode(cardView.opp), players: cardView.players }}
          team={{ name: tName(cardRow.t), color: tColor(cardRow.t), abbr: tCode(cardRow.t) }}
          logo={logoUrl(cardRow.t)} headshot={shots?.[norm(card.name)]?.headshot}
          career={CAREER.byName[card.name] || null} peakRank={CAREER.rank[card.name]} bestRank={CAREER.best[card.name]}
          onProfile={n => { setCard(null); setBox(null); selectPlayer(n) }}
          onClose={() => setCard(null)} />
      )}
    </div>
  )
}

const safeGame = (f, home, away, day) => { try { return f.game(home, away, day) } catch { return null } }

function GameCard({ c, shots, onOpen }) {
  const g = c.g, x = c.x
  const home = g ? (g.home || g.teams[1]) : x.home
  const away = g ? g.teams.find(t => t !== home) : x.away
  const pts = g ? { [g.teams[0]]: g.pts[0], [g.teams[1]]: g.pts[1] } : { [x.home]: x.hs, [x.away]: x.as }
  const started = c.state !== 'pre'
  const lead = started && pts[home] !== pts[away] ? (pts[home] > pts[away] ? home : away) : null
  const wp = g ? g.wp : c.fg ? { [home]: c.fg.pHome, [away]: c.fg.pAway } : null
  const upset = lead && wp && wp[lead] < 0.5
  const status = c.state === 'in' ? <span className={styles.liveTxt}><i className={styles.liveDot} />{(g?.live || x).detail}</span>
    : c.state === 'pre' ? tipTime(x.tip) : `Final${(g || x).ot ? `/${(g || x).ot}` : ''}`
  const top = g && [...g.players].sort((a, b) => b.gs - a.gs)[0]
  const mover = g && [...g.players].sort((a, b) => Math.abs(b.post - b.pre) - Math.abs(a.post - a.pre))[0]
  const best = side => side && [...side.rows].filter(r => !r.out).sort((a, b) => b.elo - a.elo)[0]
  const tm = c.fg && [best(c.fg.away), best(c.fg.home)]
  return (
    <button type="button" className={`${styles.gCard} ${c.state === 'in' ? styles.gLive : ''}`} onClick={onOpen || undefined} disabled={!onOpen}>
      <div className={styles.gHead}>
        <span>{status}</span>
        <span>{(g || x).post && <em className={styles.postTag}>Playoffs</em>}{upset && <em className={styles.upsetTag}>{c.state === 'in' ? 'Upset watch' : 'Upset'}</em>}</span>
      </div>
      {[away, home].map(t => (
        <div key={t} className={`${styles.gTeam} ${lead && lead !== t ? styles.gTrail : ''}`}>
          <TeamMark t={t} size={30} />
          <span className={styles.gName}>{tShort(t)}{g && <small>{r0(g.elo[t].pre)} lineup Elo</small>}{!g && c.fg && <small>{r0((t === home ? c.fg.home : c.fg.away).rating)} forecast rating</small>}</span>
          <b className={styles.gPts}>{started ? pts[t] ?? '–' : wp ? `${Math.round(wp[t] * 100)}%` : ''}</b>
        </div>
      ))}
      {wp && <div className={styles.gWp}>
        <div className={styles.gWpTrack}>
          <span style={{ width: `${wp[away] * 100}%`, background: tColor(away) }} />
          <span style={{ width: `${wp[home] * 100}%`, background: tColor(home) }} />
        </div>
        <small>{started ? `Pre-game Elo ${Math.round(wp[away] * 100)}–${Math.round(wp[home] * 100)}` : 'Elo forecast'}</small>
      </div>}
      <div className={styles.gFoot}>
        {top ? <>
          <span><Headshot name={top.n} shots={shots} color={tColor(top.t)} /><span><b>{shortName(top.n)}</b><small>{top.gs.toFixed(1)} GmSc · {top.pts ?? 0} PTS</small></span></span>
          {mover && <span className={styles.gMove}><small>Biggest swing</small><b className={mover.post >= mover.pre ? styles.up : styles.down}>{shortName(mover.n)} {sgn(mover.post - mover.pre)}</b></span>}
        </> : tm?.[0] && tm?.[1] ? <span className={styles.gMatch}><small>Top player matchup</small>
          <b>{shortName(tm[0].name)} {r0(tm[0].elo)} <i>vs</i> {shortName(tm[1].name)} {r0(tm[1].elo)}</b></span>
          : <span className={styles.muted}>{started ? 'Box score loading…' : 'Preview available once the forecast loads'}</span>}
      </div>
    </button>
  )
}

function Board({ title, sub, rows, shots, onOpen, val, valCls, line, delta, empty }) {
  return (
    <section className={styles.board}>
      <header><h3>{title}</h3><span>{sub}</span></header>
      {!rows.length && <p className={styles.bNone}>{empty || 'Nothing yet.'}</p>}
      {rows.map(({ p, g }, i) => (
        <button key={g.id + p.n} className={styles.bRow} onClick={() => onOpen(g, p)}>
          <em className={styles.bRank}>{i + 1}</em>
          <Headshot name={p.n} shots={shots} color={tColor(p.t)} />
          <span className={styles.bWho}><b>{shortName(p.n)} <small className={styles.bTeam}>{tCode(p.t)}{g.live?.state === 'in' ? ' · live' : ''}</small></b><small>{line({ p, g })}</small></span>
          <span className={styles.bRight}><b className={`${styles.bVal} ${valCls || ''}`}>{val({ p, g })}</b>
            {delta && <small className={p.post >= p.pre ? styles.up : styles.down}>{sgn(p.post - p.pre)} Elo</small>}</span>
        </button>
      ))}
    </section>
  )
}

// Top performers across the day, with the raw and shooting line behind each Game Score
function PerfTable({ rows, shots, onOpen }) {
  const ts = p => { const d = 2 * ((p.fga || 0) + 0.44 * (p.fta || 0)); return d ? ((p.pts || 0) / d).toFixed(3).replace(/^0/, '') : '—' }
  const sh = (m, a) => (m == null ? '—' : `${m}-${a ?? 0}`)
  return (
    <section className={`${styles.board} ${styles.perf}`}>
      <header><h3>Top performers</h3><span>Ranked by Game Score, the stat every duel is decided on</span></header>
      <div className={styles.tableWrap}>
        <table className={styles.perfTable}>
          <thead><tr>
            <th /><th className={styles.pLeft}>Player</th><th className={styles.pLeft}>Game</th>
            <th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th>
            <th className={styles.pGap}>FG</th><th>3PT</th><th>FT</th><th>TS%</th>
            <th className={styles.pGap}>GmSc</th><th>Elo Δ</th><th>Rank</th>
          </tr></thead>
          <tbody>
            {rows.map(({ p, g }, i) => {
              const o = g.teams.find(t => t !== p.t), d = p.post - p.pre
              return (
                <tr key={g.id + p.n} onClick={() => onOpen(g, p)}>
                  <td className={styles.bRank}>{i + 1}</td>
                  <td className={styles.pLeft}><span className={styles.pWho}><Headshot name={p.n} shots={shots} color={tColor(p.t)} />
                    <span><b>{shortName(p.n)}</b><small>{tCode(p.t)}{p.pos ? ` · ${p.pos}` : ''}</small></span></span></td>
                  <td className={styles.pLeft}><span className={styles.pGame}>{g.home === p.t ? 'vs' : '@'} {tCode(o)}
                    {g.live?.state === 'in' && <i className={styles.liveTxt}><i className={styles.liveDot} />live</i>}</span></td>
                  <td>{p.mp ?? '—'}</td><td className={styles.pPts}>{p.pts ?? '—'}</td><td>{p.trb ?? '—'}</td><td>{p.ast ?? '—'}</td>
                  <td>{p.stl ?? '—'}</td><td>{p.blk ?? '—'}</td><td>{p.tov ?? '—'}</td>
                  <td className={styles.pGap}>{sh(p.fg, p.fga)}</td><td>{sh(p.tp, p.tpa)}</td><td>{sh(p.ft, p.fta)}</td><td>{ts(p)}</td>
                  <td className={`${styles.pGap} ${styles.pGs}`}>{p.gs.toFixed(1)}</td>
                  <td className={d >= 0 ? styles.up : styles.down}><b>{sgn(d)}</b></td>
                  <td><RankCell p={p} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
