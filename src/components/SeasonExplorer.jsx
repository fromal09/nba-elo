import { historyReady } from '../history.js'
import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import styles from './SeasonExplorer.module.css'
import PlayerCard, { MiniCard, DuelCard, DuelModal, tierFor, momentsFor, setFirstGameLookup } from './PlayerCard'
import { SeasonBinder, CareerBinder, TeamBinder, FranchiseBinder, LeagueBinder, CollectionBinder, PublicBinder } from './Binders'
import { useCollector } from './Collector'
import { StoreBook } from './Store'
import { PickBar, usePredSlate } from './Predictions'
import predStyles from './Predictions.module.css'
import { buildForecaster, blendWeight, norm, WP, winChance, makeProjector, normCdf } from './predict'
import { buildRatings, scoreGame, assignRanks, dayBoards } from './live.js'
import { watchDay, useLiveFeeds, computeLive, gameKey, liveDaysAfter } from './liveFeed.js'
import { simulateOdds } from './odds.js'
import { raceAwards } from './awardsRace.js'

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
// Projected score for a forecast game (set once the season's scoring rates load): fg -> [home, away]
let PROJECT = null
const projText = (fg, homeFirst = false) => {
  const s = PROJECT?.(fg)
  return s ? (homeFirst ? `${s[0]}–${s[1]}` : `${s[1]}–${s[0]}`) : null
}
// Projected final for a game in progress: the score so far plus the pre-game projection for the time left
// Share of a 48-minute game still to play, from ESPN's period and clock
function shareLeft(live) {
  // ESPN's clock is "M:SS", or plain seconds ("20.2") in a period's last minute
  const ck = String(live.clock ?? '0:00')
  const [m, sec] = ck.includes(':') ? ck.split(':').map(Number) : [0, Number(ck)]
  const inPeriod = Math.min(live.period <= 4 ? 12 : 5, (isNaN(m) ? 0 : m) + (isNaN(sec) ? 0 : sec) / 60)
  const left = (live.period <= 4 ? (4 - live.period) * 12 : 0) + inPeriod
  return Math.max(0, left) / 48
}
function liveFinal(fg, live, ptsHome, ptsAway) {
  const s = Array.isArray(fg) ? fg : PROJECT?.(fg)
  if (!s || !live?.period) return null
  const r = shareLeft(live)
  return [Math.round(ptsHome + s[0] * r), Math.round(ptsAway + s[1] * r)]
}
// Home team's win chance during a game: the current lead plus the pre-game projected margin for the
// time left, with the spread of outcomes shrinking as the clock runs (sigma × √share left)
function liveWinHome(preMargin, live, sigma) {
  const lead = (live.hs || 0) - (live.as || 0)
  if (!live.period) return null
  const r = shareLeft(live)
  if (r <= 0.0005) return lead > 0 ? 1 : lead < 0 ? 0 : 0.5
  return normCdf((lead + (preMargin || 0) * r) / (sigma * Math.sqrt(r)))
}
let NEWEST = null // the newest season's label, for loading it with this season's teams
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
    ot: g.ot, res: g.pts[i] > g.pts[1 - i] ? 'W' : 'L', post: g.post, players: g.players, elo: g.elo, wp: g.wp, fcwp: g.fcwp, proj: g.proj, sy, live: g.live, riv: g.riv,
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

// Night score picks Player of the Game and Player of the Day: production plus a share of the Elo gained
const nightScore = p => p.gs + (p.post - p.pre) / 6
// Giant-Slayer: the least likely duel win, among players who both logged real minutes and a winner with a real line
const slayerOk = (a, b) => (a.mp || 0) >= 12 && (b.mp || 0) >= 12 && a.gs >= 10 && a.gs > b.gs && b.pre > a.pre
function gameSlayer(players) {
  let best = null
  for (const a of players) for (const b of players) {
    if (slayerOk(a, b) && (!best || b.pre - a.pre > best.gap)) best = { a, b, gap: b.pre - a.pre, wc: 1 / (1 + 10 ** ((b.pre - a.pre) / 620)) }
  }
  return best
}
// Duel: two highly rated opponents who both played well. Every cross-team pair with real minutes (20+, where
// the data has minutes) and a 10+ Game Score from each is scored on its weaker side, so one superstar's big
// night can't carry it: score = the lower Game Score × (the lower pre-game Elo / 2,500). Winner = higher Game Score.
const DUEL_MIN_GS = 10, DUEL_MIN_MP = 20
const duelOk = p => (p.gs || 0) >= DUEL_MIN_GS && (p.mp == null || p.mp >= DUEL_MIN_MP)
export const duelScore = (a, b) => Math.min(a.gs, b.gs) * (Math.min(a.pre, b.pre) / 2500)
function gameDuel(players) {
  let best = null
  for (const a of players) {
    if (!duelOk(a)) continue
    for (const b of players) {
      if (b.t === a.t || !duelOk(b) || b.n <= a.n) continue // each pair once
      const score = duelScore(a, b)
      if (!best || score > best.score) best = { a, b, score }
    }
  }
  if (!best) return null
  const [a, b] = best.a.gs >= best.b.gs ? [best.a, best.b] : [best.b, best.a]
  return { a, b, score: best.score }
}
function markHonors(games) {
  const byDay = {}
  for (const g of games) {
    let top = null
    for (const p of g.players) { p.potg = false; p.potd = false; if (!top || nightScore(p) > nightScore(top)) top = p }
    if (top) top.potg = true
    ;(byDay[g.date] = byDay[g.date] || []).push(...g.players)
  }
  for (const ps of Object.values(byDay)) {
    const top = ps.reduce((b, p) => (!b || nightScore(p) > nightScore(b) ? p : b), null)
    if (top) top.potd = true
  }
}

// Each day's Duel of the Day (the best duel score) and Giant-Slayer of the Day (widest Elo gap)
const duelCache = new WeakMap()
function dayDuels(games) {
  const out = new Map()
  for (const g of [...games].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const cur = out.get(g.date) || {}
    const sl = gameSlayer(g.players); if (sl && (!cur.slayer || sl.gap > cur.slayer.gap)) cur.slayer = { ...sl, g }
    const du = gameDuel(g.players); if (du && (!cur.duel || du.score > cur.duel.score)) cur.duel = { ...du, g }
    out.set(g.date, cur)
  }
  return out
}
const seasonDuels = sd => { if (!duelCache.has(sd)) duelCache.set(sd, dayDuels(sd.games)); return duelCache.get(sd) }

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
function lineupElo(ps, key) {
  const m = ps.reduce((s, p) => s + (p.mp || 0), 0)
  return m ? ps.reduce((s, p) => s + p[key] * (p.mp || 0), 0) / m : ps.reduce((s, p) => s + p[key], 0) / ps.length
}
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th')

// ── Season loading ───────────────────────────────────────────────────────────
// Records and roster Elo with live finals included, computed the way scripts/season_explorer.py does:
// roster Elo = average latest Elo of the team's eight highest-minute players this season
function withLiveTeams(base, games, finals) {
  const touched = new Set(finals.flatMap(g => g.teams))
  const out = { ...base }
  for (const t of touched) {
    const cur = base[t] || { code: t, name: CURRENT[t]?.[0] || t, color: CURRENT[t]?.[1] || '#173657',
      group: CURRENT[t]?.[2] === 'E' ? 'Eastern Conference' : 'Western Conference' }
    let w = 0, l = 0, pw = 0, pl = 0
    const mins = {}, latest = {}
    for (const g of games) {
      const i = g.teams.indexOf(t)
      if (i < 0) continue
      const won = g.pts[i] > g.pts[1 - i]
      if (g.post) { if (won) pw++; else pl++ } else if (won) w++; else l++
      for (const p of g.players) if (p.t === t) { mins[p.n] = (mins[p.n] || 0) + (p.mp || 0); latest[p.n] = p.post }
    }
    const top8 = Object.keys(mins).sort((a, b) => mins[b] - mins[a]).slice(0, 8)
    out[t] = { ...cur, w, l, pw, pl, gp: w + l + pw + pl,
      elo: top8.length ? Math.round((top8.reduce((s, n) => s + latest[n], 0) / top8.length) * 10) / 10 : cur.elo ?? null }
  }
  return out
}

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
    markHonors(d.games)
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
      rec: `${r[0]}-${r[1]}`, players: g.players, elo: g.elo, wp: g.wp, sy: sd.sy, riv: g.riv,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
export default function SeasonExplorer({ players, onSelectPlayer, mode, onMode }) {
  const [index, setIndex] = useState(null)
  const [err, setErr] = useState(null)
  const [season, setSeason] = useState(null)
  const [sd, setSd] = useState(null)
  const [open, setOpen] = useState(null)
  const [shots, setShots] = useState({})
  const [sched, setSched] = useState(null)       // ESPN schedule + injuries (current season only)
  const [rotation, setRotation] = useState(null) // recent minutes per player
  const [best, setBest] = useState({})           // best rank among active players, per player
  const [careers, setCareers] = useState({})     // career bests through the latest data, for live career moments
  // 'standings' | 'today'; App owns it so the games view can live at /scoreboard
  const view = mode === 'today' ? 'today' : 'standings'
  const setView = v => onMode?.(v)
  const [day, setDay] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('date')
    return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : etToday()
  })
  // Keep the address shareable: /scoreboard for today, /scoreboard?date=YYYY-MM-DD for any other day
  useEffect(() => {
    if (view !== 'today') return
    const url = day === etToday() ? '/scoreboard' : `/scoreboard?date=${day}`
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url)
  }, [view, day])
  const goDay = d => { setDay(d); setView('today'); window.scrollTo({ top: 0 }) }

  useEffect(() => {
    getJSON('/data/explorer/index.json')
      .then(d => { setIndex(d); setSeason(d.seasons[0]?.season) })
      .catch(() => setErr('Season data not found. Run the build pipeline to generate it.'))
    getHeadshots().then(setShots)
    getJSON('/data/explorer/ranks.json').then(setBest).catch(() => {})
    getJSON('/data/explorer/careers.json').then(setCareers).catch(() => {})
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
  const [scoring, setScoring] = useState(null)
  useEffect(() => {
    if (!newest || sched) return
    getJSON('/data/explorer/scoring.json').then(setScoring).catch(() => {})
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
  setFirstGameLookup(n => byName[n]?.team_history?.[0]?.[0] || null)
  NEWEST = index?.seasons[0]?.season || NEWEST

  // ── Live layer for the newest season ─────────────────────────────────────
  // Days after the last pipeline update (normally just today) come from the live ESPN feed: finals are
  // scored exactly like the nightly build and join the season (standings, team pages, award races);
  // games in progress feed the forecasts with their live win chance. Polls while games are on.
  const lastData = sd?.games.length ? sd.games[sd.games.length - 1].date : null
  const liveDays = useMemo(() => (newest && sd ? liveDaysAfter(lastData) : []), [newest, sd, lastData])
  const feeds = useLiveFeeds(liveDays)
  const live = useMemo(() => {
    if (!sd || !liveDays.length) return null
    const have = new Set(sd.games.map(g => gameKey(g.date, g.teams[0], g.teams[1])))
    const L = computeLive({ ratings, feeds, days: liveDays, have, winChance, sy: sd.sy })
    const { finals } = L
    if (finals.length) {
      // Team lineup-Elo ranks entering and leaving each game, as loadSeason computes them
      const latest = { ...(sd.seed || {}) }
      sd.games.forEach(g => g.teams.forEach(t => { latest[t] = g.elo[t].post }))
      Object.keys(CURRENT).forEach(c => { if (latest[c] == null) latest[c] = 1500 })
      const rankOf = (t, v) => {
        const others = Object.entries(latest).filter(([k]) => k !== t && !k.includes('@'))
        return { rank: 1 + others.filter(([, x]) => x > v).length, of: others.length + 1 }
      }
      finals.forEach(g => {
        g.teams.forEach(t => { g.elo[t].preRank = rankOf(t, g.elo[t].pre) })
        g.teams.forEach(t => { latest[t] = g.elo[t].post })
        g.teams.forEach(t => { g.elo[t].postRank = rankOf(t, g.elo[t].post) })
      })
      markHonors(finals)
    }
    return { ...L, key: gameKey }
  }, [sd, liveDays, feeds, ratings])
  // The season with live finals folded in: games, records and roster Elo, as the nightly build would write them
  const sdL = useMemo(() => {
    if (!sd || !live?.finals.length) return sd
    const games = [...sd.games, ...live.finals]
    return { ...sd, games, teams: withLiveTeams(sd.teams, games, live.finals), liveFinals: live.finals.length }
  }, [sd, live])
  const liveNow = useMemo(() => {
    const m = {}
    for (const x of live?.inprog || []) {
      m[x.home] = { opp: x.away, me: x.hs ?? 0, op: x.as ?? 0, detail: x.detail, home: true }
      m[x.away] = { opp: x.home, me: x.as ?? 0, op: x.hs ?? 0, detail: x.detail, home: false }
    }
    return m
  }, [live])

  const teams = useMemo(() => {
    if (!sdL) return {}
    const t = { ...sdL.teams }
    // Newest season: list every current team, even before its first game
    if (index && sdL.season === index.seasons[0].season && Object.values(t).some(x => x.group.endsWith('Conference'))) {
      Object.entries(CURRENT).forEach(([c, [name, color, conf]]) => {
        if (!t[c]) t[c] = { code: c, name, color, group: conf === 'E' ? 'Eastern Conference' : 'Western Conference', w: 0, l: 0, pw: 0, pl: 0, gp: 0, elo: null }
      })
    }
    return t
  }, [sdL, index])
  TEAMINFO = teams

  // Forecasts for the newest season: remaining games per team and projected records
  const fc = useMemo(() => {
    if (!newest || !sd || !sched || !rotation || !players) return null
    const roster = Object.fromEntries(Object.entries(shots || {}).filter(([, v]) => v.team))
    const gamesPlayed = Object.fromEntries(Object.entries(teams).map(([t, x]) => [t, x.gp]))
    const base = buildForecaster({ players, roster, rotation, injuries: sched.injuries, fetched: sched.fetched, gamesPlayed, winChance, sy: sd.sy })
    // One model for everything: once scoring.json loads, win chances come from the projected margin
    const model = makeProjector(scoring, sched)
    const f = !model ? base : { ...base, game: (h, a, day) => {
      const g = base.game(h, a, day), m = model.margin(g), p = model.win(m)
      return { ...g, margin: m, pHome: p, pAway: 1 - p }
    } }
    // Pipeline data ends at `through`; live finals after it are already in `teams` (skipped here),
    // and games in progress carry their live win chance
    const through = sd.games.length ? sd.games[sd.games.length - 1].date : '0000-00-00'
    const upcoming = {}, proj = {}, remaining = [], known = []
    const HCA = WP(sd.sy).home, sigma = model?.sigma || 13.7
    const liveFinal_ = new Set((live?.finals || []).map(g => live.key(g.date, g.teams[0], g.teams[1])))
    const inProg = new Map((live?.inprog || []).map(x => [live.key(x.day, x.home, x.away), x]))
    Object.keys(teams).forEach(t => { upcoming[t] = []; proj[t] = [teams[t].w, teams[t].l] })
    for (const g of sched.games) {
      if (g.day <= through || !teams[g.home] || !teams[g.away]) continue
      const k = live ? live.key(g.day, g.home, g.away) : null
      if (k && liveFinal_.has(k)) continue
      const lv = !g.done && k ? inProg.get(k) : null
      const fg = g.done ? null : f.game(g.home, g.away, g.day)
      // projected home margin in points (Elo-only conversion until scoring.json loads)
      const m = fg ? fg.margin ?? (fg.home.rating - fg.away.rating + HCA) * 0.0376 : null
      const pre = fg && model?.score ? model.score(fg) : null
      const pLive = lv && fg ? liveWinHome(pre ? pre[0] - pre[1] : m, lv, sigma) : null
      if (fg) remaining.push({ home: g.home, away: g.away, day: g.day, m, p: pLive })
      else known.push({ home: g.home, away: g.away, homeWon: g.hs > g.as })
      for (const t of [g.home, g.away]) {
        const home = t === g.home
        const p = fg ? (pLive != null ? (home ? pLive : 1 - pLive) : (home ? fg.pHome : fg.pAway)) : null
        const won = g.done ? (home ? g.hs > g.as : g.as > g.hs) : null
        const lvx = lv ? { me: home ? lv.hs : lv.as, op: home ? lv.as : lv.hs, detail: lv.detail } : null
        upcoming[t].push({ ...g, opp: home ? g.away : g.home, isHome: home, p, won, fg, live: lvx })
        proj[t][0] += g.done ? +won : p
        proj[t][1] += g.done ? +!won : 1 - p
      }
    }
    const last = sched.games.length ? sched.games[sched.games.length - 1].day : through
    return { f, upcoming, proj, through, fetched: sched.fetched, remaining, known, last, total: sched.games.length, model, project: model?.score || null }
  }, [newest, sd, sched, rotation, players, shots, teams, scoring, live])
  PROJECT = fc?.project || null

  // Playoff and title odds: the rest of the schedule played out many times
  const [standView, setStandView] = useState('standings')
  const [odds, setOdds] = useState(null)
  useEffect(() => {
    if (!fc || !sd) { setOdds(null); return }   // a live update re-simulates; the last result stays up meanwhile
    if (standView !== 'odds' && standView !== 'awards') return
    const conf = t => (teams[t]?.group === 'Eastern Conference' ? 'E' : teams[t]?.group === 'Western Conference' ? 'W' : null)
    const T = Object.fromEntries(Object.keys(teams).filter(conf).map(t => [t, { conf: conf(t), w: teams[t].w, l: teams[t].l }]))
    const day = addDays(fc.last, 1)
    const M = fc.model
    const strength = Object.fromEntries(Object.keys(T).map(t => [t, M ? M.strength(t, fc.f.team(t, day).rating) : fc.f.team(t, day).rating * 0.0376]))
    return simulateOdds({ teams: T, games: fc.remaining, known: fc.known, strength, sigma: M?.sigma || 13.7, home: M?.home ?? 1.66,
      left: fc.total ? fc.remaining.length / fc.total : 1, n: ODDS_N, seed: fc.remaining.length + 1 }, setOdds)
  }, [fc, standView === 'standings'])

  // Award races: this season so far, last season as the prior, team wins from the odds simulation
  const [prevSd, setPrevSd] = useState(null)
  const [race, setRace] = useState(null)
  useEffect(() => {
    if (standView !== 'awards' || !sd || prevSd) return
    const prev = index?.seasons[1]?.season
    if (prev) loadSeason(prev, false).then(setPrevSd).catch(() => setPrevSd({ games: [] }))
  }, [standView, sd, prevSd, index])
  useEffect(() => {
    if (!fc || !sdL) { setRace(null); return }
    if (standView !== 'awards' || !prevSd || !odds) return
    const t = setTimeout(() => setRace(buildRace({ sd: sdL, prevSd, fc, odds, byName })), 30)
    return () => clearTimeout(t)
  }, [standView, fc, sdL, prevSd, odds])

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
              {(s.games + (newest ? sdL?.liveFinals || 0 : 0)).toLocaleString()} games, {fmtDate(s.first, { month: 'short', day: 'numeric', year: 'numeric' })} to {fmtDate(newest && sdL?.liveFinals ? sdL.games[sdL.games.length - 1].date : s.last, { month: 'short', day: 'numeric', year: 'numeric' })}.
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

      {view === 'standings' && fc && sd && (
        <div className={styles.standBar}>
          <div className={styles.standTabs}>
            <button className={standView === 'standings' ? styles.standOn : ''} onClick={() => setStandView('standings')}>Standings</button>
            <button className={standView === 'odds' ? styles.standOn : ''} onClick={() => setStandView('odds')}>Playoff odds</button>
            <button className={standView === 'awards' ? styles.standOn : ''} onClick={() => setStandView('awards')}>Award races</button>
          </div>
          {standView === 'odds' && <span>{ODDS_N.toLocaleString()} simulated seasons · updates with every result</span>}
          {standView === 'awards' && <span>{RACE_N.toLocaleString()} simulated seasons · this season so far plus a projection for the rest</span>}
        </div>
      )}
      {view === 'standings' && newest && live && (live.finals.length > 0 || live.inprog.length > 0) && (
        <div className={styles.liveBar}>
          {live.inprog.length > 0 && <span className={styles.liveTxt}><i className={styles.liveDot} />{live.inprog.length} game{live.inprog.length === 1 ? '' : 's'} in progress</span>}
          {live.finals.length > 0 && <span>{live.finals.length} final{live.finals.length === 1 ? '' : 's'} since the nightly update counted in records, Elo and races</span>}
          {live.inprog.length > 0 && <span>Projections and odds use live win chances</span>}
          {live.fetched && <span className={styles.muted}>Updated {new Date(live.fetched).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>}
        </div>
      )}
      {view === 'today' ? (
        <Today day={day} sd={sd} index={index} fc={fc} shots={shots} ratings={ratings} careers={careers} selectPlayer={selectPlayer} />
      ) : !sd ? <div className={styles.empty}>Loading {s.season}…</div> : standView === 'odds' && fc ? (
        <OddsView odds={odds} teams={teams} sd={sdL} fc={fc} />
      ) : standView === 'awards' && fc ? (
        <AwardRaces race={race} shots={shots} selectPlayer={selectPlayer} />
      ) : (
        <div className={styles.confs}>
          {groups.map(g => (
            <Standings key={g} label={GROUP_LABEL[g] || g} group={g} sd={sdL} teams={teams} open={open} fc={fc} liveNow={liveNow}
              setOpen={t => setOpen(o => (o === t ? null : t))}
              shots={shots} selectPlayer={selectPlayer} goDay={goDay} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Playoff and title odds ──────────────────────────────────────────────────
const ODDS_N = 10000
const opct = v => (v >= 0.995 ? '>99' : v < 0.0005 ? '—' : v < 0.01 ? '<1' : `${Math.round(v * 100)}`)
const oTint = (v, k) => {
  if (v < 0.005) return { color: '#b4bcc6' }
  if (k === 'pi') return { background: `rgba(201,162,74,${0.08 + v * 0.55})`, color: '#6b4c0c' }
  if (k === 'title') return { background: `rgba(201,162,74,${0.12 + Math.min(1, v / 0.4) * 0.75})`, color: v >= 0.25 ? '#fff' : '#6b4c0c' }
  return { background: `rgba(26,95,168,${0.06 + v * 0.62})`, color: v > 0.7 ? '#fff' : '#173657' }
}
const ODD_COLS = [['po', 'Playoffs'], ['top6', 'Top 6'], ['pi', 'Play-In'], ['r2', '2nd Rd'], ['cf', 'Conf F'], ['fin', 'Finals'], ['title', 'Title']]

function OddsView({ odds, teams, sd, fc }) {
  const [open, setOpen] = useState(null)
  if (!odds) return <div className={styles.empty}>Simulating {ODDS_N.toLocaleString()} seasons…</div>
  const O = odds.teams
  const confs = [['W', 'Western Conference'], ['E', 'Eastern Conference']]
  const lo = 10, hi = 72, x = v => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100
  const race = Object.keys(O).sort((a, b) => O[b].title - O[a].title).slice(0, 16)
  return (
    <div className={styles.confs}>
      {confs.map(([c, group]) => {
        const ts = Object.keys(O).filter(t => teams[t]?.group === group).sort((a, b) => O[b].w - O[a].w || O[b].po - O[a].po)
        return (
          <section key={c} className={styles.conf}>
            <h2 className={styles.confHead}>{group}<small>Sorted by projected record · bar is the 10th to 90th percentile of wins</small></h2>
            <div className={styles.oddsWrap}>
              <table className={styles.oddsTable}>
                <thead><tr><th>Proj</th><th className={styles.oLeft}>Team</th><th>W-L</th><th>Elo</th><th className={styles.oLeft}>Projected record</th>
                  {ODD_COLS.map(([k, l]) => <th key={k} className={k === 'title' ? styles.oGold : ''}>{l}</th>)}</tr></thead>
                <tbody>
                  {ts.map((t, i) => {
                    const o = O[t], pw = Math.round(o.w)
                    return (
                      <Fragment key={t}>
                        {(i === 6 || i === 10) && <tr className={i === 6 ? styles.oCutPi : styles.oCutOut}><td colSpan={12}><span>{i === 6 ? 'Play-In' : 'Out'}</span></td></tr>}
                        <tr className={`${styles.oRow} ${open === t ? styles.oOpen : ''}`} onClick={() => setOpen(v => (v === t ? null : t))} style={{ '--tc': tColor(t) }}>
                          <td className={styles.oNum}>{i + 1}</td>
                          <td className={styles.oLeft}><span className={styles.oTeam}><TeamMark t={t} size={24} /><b className={styles.full}>{tName(t)}</b><b className={styles.abbr}>{tShort(t)}</b></span></td>
                          <td>{teams[t].w}-{teams[t].l}</td>
                          <td className={styles.oMuted}>{r0(fc.f.team(t, addDays(fc.through, 1)).rating)}</td>
                          <td className={styles.oLeft}><span className={styles.oProj}><b>{pw}-{o.games - pw}</b>
                            <span className={styles.oBar}><i style={{ left: `${x(o.w10)}%`, width: `${x(o.w90) - x(o.w10)}%`, background: tColor(t) }} /><em style={{ left: `${x(o.w)}%`, background: tColor(t) }} /></span></span></td>
                          {ODD_COLS.map(([k]) => <td key={k} className={styles.oPct} style={oTint(o[k], k)}>{opct(o[k])}</td>)}
                        </tr>
                        {open === t && <tr className={styles.oPanelRow}><td colSpan={12}><TeamOdds t={t} o={o} games={o.games} /></td></tr>}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
      <section className={styles.conf}>
        <h2 className={styles.confHead}>Title race<small>Chance of reaching each round · gold is the title</small></h2>
        <div className={styles.race}>
          {race.map(t => (
            <div key={t} className={styles.raceRow}>
              <span className={styles.oTeam}><TeamMark t={t} size={22} /><b>{tShort(t)}</b></span>
              <span className={styles.raceBar}>
                {[['po', '#d9e4f1'], ['r2', '#a9c3e0'], ['cf', '#6f9acb'], ['fin', '#2f67a6'], ['title', '#c9a24a']].map(([k, c]) => <i key={k} style={{ width: `${O[t][k] * 100}%`, background: c }} />)}
              </span>
              <b className={styles.raceVal}>{opct(O[t].title)}%</b>
            </div>
          ))}
          <div className={styles.raceLegend}>{[['Playoffs', '#d9e4f1'], ['2nd round', '#a9c3e0'], ['Conf. Finals', '#6f9acb'], ['Finals', '#2f67a6'], ['Title', '#c9a24a']].map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>
        </div>
      </section>
      <p className={styles.oNote}>Each simulated season plays every remaining game from its projected margin (lineup Elo from projected minutes and the injury report, plus each team's scoring margin and back-to-backs), then the play-in and four best-of-seven rounds. Team ratings get a random shift each season, smaller as the season goes on. Ties are broken at random; the NBA's tiebreakers aren't modeled.</p>
    </div>
  )
}

function TeamOdds({ t, o, games }) {
  const mx = Math.max(...o.seeds, 0.001)
  const hk = Object.keys(o.hist).map(Number), hmax = Math.max(...Object.values(o.hist))
  const lo = Math.max(0, Math.min(...hk) - 2), hi = Math.min(games, Math.max(...hk) + 2)
  const path = [['Playoffs', o.po], ['Top 6', o.top6], ['2nd round', o.r2], ['Conf. Finals', o.cf], ['Finals', o.fin], ['Title', o.title]]
  const nx = o.next
  return (
    <div className={styles.tOdds} style={{ "--tc": tColor(t) }}>
      <div className={styles.tPath}>{path.map(([l, v]) => <div key={l}><small>{l}</small><b>{opct(v)}%</b></div>)}</div>
      <div className={styles.tGrid}>
        <div>
          <div className={styles.tLab}>Final seed</div>
          <div className={styles.tSeeds}>{o.seeds.map((v, i) => (
            <div key={i}><span>{v >= 0.01 ? Math.round(v * 100) : ''}</span>
              <i style={{ height: `${Math.max(2, (v / mx) * 100)}px`, background: i < 6 ? '#1a5fa8' : i < 10 ? '#c9a24a' : '#c3c9d1' }} /><em>{i + 1}</em></div>
          ))}</div>
        </div>
        <div>
          <div className={styles.tLab}>Win total</div>
          <div className={styles.tHist}>{Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).map(wv => (
            <i key={wv} title={`${wv} wins: ${(((o.hist[wv] || 0) / ODDS_N) * 100).toFixed(1)}%`}
              style={{ height: `${((o.hist[wv] || 0) / hmax) * 80}px`, background: tColor(t), opacity: wv >= o.w10 && wv <= o.w90 ? 1 : 0.3 }} />
          ))}</div>
          <div className={styles.tAxis}><span>{lo}</span><span>{hi}</span></div>
          <p className={styles.tCap}>8 in 10 seasons land between <b>{o.w10}</b> and <b>{o.w90}</b> wins.</p>
        </div>
        {nx && <div className={styles.tStake}>
          <div className={styles.tLab}>What's at stake · next game {nx.home ? 'vs' : '@'} {tShort(nx.opp)}, {fmtDate(nx.game.day, { month: 'short', day: 'numeric' })}</div>
          <div className={styles.tStakeRow}>
            <div><small>With a win</small><b className={styles.up}>{opct(nx.poW)}%</b><span>playoffs · {opct(nx.tiW)}% title</span></div>
            <div><small>With a loss</small><b className={styles.down}>{opct(nx.poL)}%</b><span>playoffs · {opct(nx.tiL)}% title</span></div>
          </div>
          <p className={styles.tCap}>Win chance: {Math.round(nx.pWin * 100)}%. The result moves its playoff odds {Math.round(Math.abs(nx.poW - nx.poL) * 100)} points.</p>
        </div>}
      </div>
    </div>
  )
}

// ── Projected scores: makeProjector, in predict.js (shared with the server's prediction forecasts) ──

// ── Award races ─────────────────────────────────────────────────────────────
const RACE_N = 2000
const RACE_KEYS = ['gs', 'pts', 'trb', 'ast', 'stl', 'blk', 'drb', 'mp']
function seasonSums(sdx) {
  const out = {}
  for (const g of sdx.games || []) {
    if (g.post) continue
    for (const p of g.players) {
      const x = out[p.n] ??= { gp: 0, t: p.t, ...Object.fromEntries(RACE_KEYS.map(k => [k, 0])) }
      x.gp++; x.t = p.t
      for (const k of RACE_KEYS) x[k] += p[k] || 0
    }
  }
  return out
}
function buildRace({ sd, prevSd, fc, odds, byName }) {
  const cur = seasonSums(sd), prev = seasonSums(prevSd)
  const day = addDays(fc.through, 1)
  const G = 82
  // Team wins: a sampler over the playoff-odds simulation's win distribution
  const cdf = {}
  for (const [t, o] of Object.entries(odds.teams)) {
    const e = Object.entries(o.hist).map(([w, c]) => [+w, c]).sort((a, b) => a[0] - b[0])
    let acc = 0
    cdf[t] = e.map(([w, c]) => [w, (acc += c) / odds.n])
  }
  const teamWins = (t, R) => { const c = cdf[t]; if (!c) return G / 2; const u = R(); return (c.find(x => x[1] >= u) || c[c.length - 1])[0] }
  const pool = []
  for (const t of Object.keys(odds.teams)) {
    const roster = fc.f.team(t, day).rows
    // Bench = outside the top five by usual minutes: this season's average once he has 5 games, else
    // last season's (20+ games), else his recent minutes. Season averages keep late-season tanking
    // minutes and a starter's injury from making him a sixth man
    const usual = r => {
      const c = cur[r.name], pv = prev[r.name]
      if (c?.gp >= 5) return c.mp / c.gp
      if (pv?.gp >= 20) return pv.mp / pv.gp
      return r.base || 0
    }
    const ranked = [...roster].sort((a, b) => usual(b) - usual(a))
    const games = fc.remaining.filter(g => g.home === t || g.away === t)
    ranked.forEach((r, i) => {
      const c = cur[r.name] || { gp: 0, ...Object.fromEntries(RACE_KEYS.map(k => [k, 0])) }
      if ((r.base || 0) < 10 && c.gp === 0) return
      const pv = prev[r.name]
      const pp = pv && pv.gp ? { gp: pv.gp, ...Object.fromEntries(RACE_KEYS.map(k => [k, pv[k] / pv.gp])) } : null
      const left = games.filter(g => !fc.f.team(t, g.day).rows.find(x => x.name === r.name)?.out).length
      const career = byName[r.name]?.games_played ?? 0
      pool.push({
        n: r.name, t, cur: c, prev: pp, left, bench: i >= 5,
        avail: pp ? Math.max(0.55, Math.min(0.97, pp.gp / 82 + 0.05)) : 0.85,
        rookie: !pp && career <= c.gp,
      })
    })
  }
  return raceAwards({ pool, teamWins, G, n: RACE_N, seed: fc.remaining.length + 3 })
}

function AwardRaces({ race, shots, selectPlayer }) {
  if (!race) return <div className={styles.empty}>Simulating the season…</div>
  const fmt1 = v => v.toFixed(1)
  // Real stats so far on one line, the simulated full-season line under it, each labeled
  const actual = (r, extra) => {
    const c = r.p.cur, g = c?.gp || 0
    if (!g) return 'No games yet'
    const pg = k => (c[k] || 0) / g
    const x = extra ? extra({ line: { stl: pg('stl'), blk: pg('blk') } }) : ''
    return `${fmt1(pg('pts'))} pts · ${fmt1(pg('trb'))} reb · ${fmt1(pg('ast'))} ast${x ? ` · ${x}` : ''} · ${fmt1(pg('gs'))} GmSc · ${g} GP`
  }
  const row = (r, i, extra) => (
    <button key={r.p.n} type="button" className={styles.raceP} onClick={() => selectPlayer(r.p.n)}>
      <span className={styles.raceRank}>{i + 1}</span>
      <Headshot name={r.p.n} shots={shots} color={tColor(r.p.t)} />
      <span className={styles.racePWho}><b>{r.p.n} <small className={styles.raceTeam}>{tShort(r.p.t)}</small></b>
        <small><i className={styles.tagReal}>So far</i>{actual(r, extra)}</small>
        <small className={styles.raceSim}><i className={styles.tagSim}>Simulated</i>{fmt1(r.line.pts)} pts · {fmt1(r.line.trb)} reb · {fmt1(r.line.ast)} ast{extra ? ` · ${extra(r)}` : ''} · {fmt1(r.line.gs)} GmSc · {Math.round(r.line.gp)} GP</small></span>
      <span className={styles.raceChance}><i style={{ width: `${Math.max(2, r.chance * 100)}%` }} /><em>{r.chance >= 0.995 ? '>99' : r.chance < 0.01 ? '<1' : Math.round(r.chance * 100)}%</em></span>
    </button>
  )
  const card = (title, list, sub, extra, big) => (
    <section className={`${styles.conf} ${big ? styles.raceBig : ''}`} key={title}>
      <h2 className={styles.confHead}>{title}<small>{sub}</small></h2>
      {list.length && list[0].chance < 0.1 && <p className={styles.raceOpen}>Wide open: no one wins more than 1 in 10 simulated seasons yet.</p>}
      {list.length ? list.map((r, i) => row(r, i, extra)) : <div className={styles.empty}>No one qualifies yet.</div>}
    </section>
  )
  return (
    <div className={styles.confs}>
      <p className={styles.simNote}><i className={styles.tagSim}>Simulated</i>Each player's <b>So far</b> line is real. The <b>Simulated</b> line is his average full-season line across {RACE_N.toLocaleString()} simulated seasons, and the chance to win is how often he won in them.</p>
      {card('Most Valuable Player', race.mvp, 'Chance to win in simulations', null, true)}
      <div className={styles.raceGrid}>
        {card('Defensive Player of the Year', race.dpoy.slice(0, 6), 'Steals, blocks, defensive boards', r => `${fmt1(r.line.stl)} stl · ${fmt1(r.line.blk)} blk`)}
        {card('Rookie of the Year', race.roy.slice(0, 6), 'First NBA season')}
        {card('Sixth Man of the Year', race.sixth.slice(0, 6), 'Outside his team\u2019s top five in minutes')}
        {card('Most Improved Player', race.mip.slice(0, 6), 'Biggest Game Score jump from last season')}
      </div>
      {card('All-NBA', race.allNba.slice(0, 15), 'Chance to finish in the top 15 by the MVP formula')}
      <p className={styles.oNote}>Each simulated season adds a projection for every remaining game to the season so far. A player's projection starts from last season's per-game line and shifts toward this season's as games come in; rookies start from a typical rookie line. Games left skip any the injury report has him out for. MVP is Game Score per game × availability × team winning percentage, with team wins drawn from the playoff-odds simulation. MVP, DPOY, MIP and All-NBA require 65 games. This models production and winning, not voters' narratives.</p>
    </div>
  )
}

// ── Standings table with expandable team rows ───────────────────────────────
function Standings({ label, group, sd, teams, open, setOpen, shots, selectPlayer, fc, goDay, liveNow = {} }) {
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
        {fc && <span className={styles.hideSm} title="Current record plus the win chance of every remaining game">Proj W-L</span>}
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
                {liveNow[r.t] && <span className={styles.stLive} title={`${liveNow[r.t].home ? 'vs' : '@'} ${tName(liveNow[r.t].opp)} · ${liveNow[r.t].detail || 'live'}`}>
                  <i className={styles.liveDot} />{liveNow[r.t].me}-{liveNow[r.t].op}</span>}
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
  const [duelPick, setDuelPick] = useState(null) // { kind, an, bn }: a Duel / Giant-Slayer of the Game card
  const [binder, setBinder] = useState(null) // { kind, ... } for BinderHost
  const games = useMemo(() => teamGames(sd, team), [sd, team])
  const rawBox = box && sd.games.find(g => g.id === box.id)

  return (
    <div className={styles.panel} style={{ '--tc': tColor(team) }}>
      <div className={styles.tabs}>
        <button className={tab === 'schedule' ? styles.on : ''} onClick={() => setTab('schedule')}>Schedule & Box Scores</button>
        <button className={tab === 'elo' ? styles.on : ''} onClick={() => setTab('elo')}>Elo Progression</button>
        <button className={styles.binderOpen} onClick={() => setBinder({ kind: 'team', team, sd })}>Team binder</button>
      </div>
      {tab === 'schedule'
        ? <Schedule team={team} games={games} onBox={setBox} upcoming={fc?.upcoming[team] || []} onPreview={setPreview} fetched={fc?.fetched} goDay={goDay} />
        : <Progression team={team} games={games} selectPlayer={selectPlayer} />}
      {preview && <Preview g={preview} shots={shots} fetched={fc?.fetched} onClose={() => setPreview(null)} />}
      {box && <BoxScore team={team} game={box} has={sd.has} shots={shots} sd={sd} onCard={setCard} onClose={() => setBox(null)}
        onDuel={(kind, an, bn) => setDuelPick({ kind, an, bn })} />}
      {duelPick && rawBox && <DuelView kind={duelPick.kind} scope="game" an={duelPick.an} bn={duelPick.bn} g={rawBox} sd={sd} shots={shots} onClose={() => setDuelPick(null)} />}
      {card && rawBox && <SeasonCard name={card} g={rawBox} sd={sd} shots={shots}
        onProfile={n => { setCard(null); setBox(null); selectPlayer(n) }} onClose={() => setCard(null)}
        onBinder={() => { setBinder({ kind: 'season', name: card, sd }); setCard(null) }}
        onCareer={() => { setBinder({ kind: 'career', name: card }); setCard(null) }} />}
      {binder && <BinderHost start={binder} shots={shots} onClose={() => setBinder(null)}
        onProfile={n => { setBinder(null); setBox(null); selectPlayer(n) }} />}
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
          <div className={styles.schedLabel}>Upcoming · forecast
            <small>Current Elo, recent minutes, injury report{fetched ? ` as of ${fmtDate(fetched.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}</small></div>
          <div className={styles.tableWrap}>
            <table className={`${styles.schedTable} ${styles.upTable}`}>
              <thead><tr><th>Date</th><th>Opponent</th><th>Win %</th><th>Projected</th><th title="Each team's highest-rated healthy player">Top player matchup</th><th></th></tr></thead>
              <tbody>
                {upcoming.map(g => {
                  const mine = g.fg && (g.isHome ? g.fg.home : g.fg.away), theirs = g.fg && (g.isHome ? g.fg.away : g.fg.home)
                  const best = x => x && [...x.rows].filter(r => !r.out).sort((a, b) => b.elo - a.elo)[0]
                  const tm = best(mine), to = best(theirs)
                  return (
                    <tr key={g.id} onClick={() => (g.done || g.live ? goDay?.(g.day) : g.fg && onPreview(g))} className={g.done ? `${styles.pending} ${g.won ? styles.rowW : styles.rowL}` : g.live ? styles.liveRow : ''}>
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
                        <td>{g.live ? <span className={styles.liveTxt}><i className={styles.liveDot} />{g.live.me}-{g.live.op} · {g.live.detail}</span>
                          : g.p >= 0.5 ? <span className={styles.favTag}>Favored</span> : <span className={styles.dogTag}>Underdog</span>}
                          {PROJECT && !g.live && (() => { const sc = PROJECT(g.fg); if (!sc) return null; const me = g.isHome ? sc[0] : sc[1], op = g.isHome ? sc[1] : sc[0]; return <span className={styles.projScore}>{me > op ? 'W' : 'L'} {me}–{op}</span> })()}</td>
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
                {projText(g.fg) && <div className={styles.previewProj}><em>Projected score</em><b>{tShort(away.team)} {PROJECT(g.fg)[1]}, {tShort(home.team)} {PROJECT(g.fg)[0]}</b></div>}
                <div className={styles.wp}>
                  <em className={styles.wpCap}>Pre-game win chance</em>
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
function BoxScore({ team, game, has, shots, onCard, onClose, sd, pinPair, onDuel }) {
  const collector = useCollector() // a ✓ by each player whose card from this game is in your binder
  const [focus, setFocus] = useState(null)
  const [side, setSide] = useState(team) // which team's table shows; starts on the team you came from
  const [stat, setStat] = useState('box') // box score view, kept when switching teams
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
    return { climb, drop, gk: gameSlayer(P), duel: gameDuel(P) }
  }, [P])

  const avail = useMemo(() => new Set(['mp', 'orb', 'drb', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf', 'tpa', 'fga', 'fta'].filter(k => P.some(p => (p[k] || 0) > 0))), [P])
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
                    <em className={styles.wpCap}>Pre-game {game.fcwp ? '' : 'Elo '}win chance</em>
                    <div className={styles.wpLab}><span>{Math.round(game.wp[away] * 100)}%</span><span>{Math.round(game.wp[home] * 100)}%</span></div>
                    <div className={styles.wpTrack}>
                      <span style={{ width: `${game.wp[away] * 100}%`, background: tColor(away) }} />
                      <span style={{ width: `${game.wp[home] * 100}%`, background: tColor(home) }} />
                    </div>
                    {game.proj && <div className={styles.wpProj}><em>Projected score</em><b>{tShort(away)} {game.proj[away]}, {tShort(home)} {game.proj[home]}</b></div>}
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
          {story.duel && <StoryCard tag="Duel of the Game" tone="blue" onClick={onDuel && (() => onDuel('duel', story.duel.a.n, story.duel.b.n))}>
            <b>{story.duel.a.n}</b> {story.duel.a.gs.toFixed(1)} vs <b>{story.duel.b.n}</b> {story.duel.b.gs.toFixed(1)} Game Score: the best head-to-head of two highly rated opponents who both played well.
          </StoryCard>}
          {story.gk && <StoryCard tag="Giant-Slayer of the Game" tone="gold" onClick={onDuel && (() => onDuel('slayer', story.gk.a.n, story.gk.b.n))}>
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
        <TeamBox key={side} t={side} rows={P.filter(p => p.t === side)} P={P} N={N} has={has} avail={avail} shots={shots}
          focus={focus} setFocus={setFocus} onCard={onCard} stat={stat} setStat={setStat}
          owns={n => !!collector.me && collector.owned.has(`${sd?.season}|${game.id}|${n}`)} />

        <DuelGrid P={P} focus={focus} setFocus={setFocus} shots={shots} game={game} sd={sd} pinPair={pinPair} />
      </div>
    </div>
  )
}

function StoryCard({ tag, tone, children, onClick }) {
  if (onClick) return (
    <button type="button" className={`${styles.card} ${styles['t_' + tone]} ${styles.cardBtn}`} onClick={onClick}>
      <div className={styles.cardTag}>{tag}<span className={styles.cardOpen}>Open card ›</span></div><div>{children}</div>
    </button>
  )
  return <div className={`${styles.card} ${styles['t_' + tone]}`}><div className={styles.cardTag}>{tag}</div><div>{children}</div></div>
}

// Box score stat views. `need`: the season must have recorded the stat.
// `any`: hide when nobody in this game has a nonzero value (older box scores log unrecorded stats as 0).
const fmtPct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, '') : '—')
const dec3 = v => (v == null ? '—' : v.toFixed(3).replace(/^0/, ''))
const ts = p => { const d = 2 * ((p.fga || 0) + 0.44 * (p.fta || 0)); return d ? (p.pts || 0) / d : null }
const efg = p => (p.fga ? ((p.fg || 0) + 0.5 * (p.tp || 0)) / p.fga : null)
const sum = (rows, k) => rows.reduce((s, p) => s + (p[k] || 0), 0)
const split = (m, a, showA = true) => (m == null ? '—' : showA ? `${m}-${a ?? '—'}` : `${m}`)
const fmtW = w => (Number.isInteger(w) ? w : w.toFixed(1))

const STAT_VIEWS = [
  { id: 'box', label: 'Box score' },
  { id: 'elo', label: 'Elo' },
]
const STAT_COLS = {
  standard: [
    { h: 'MIN', need: 'mp', any: 'mp', v: p => p.mp ?? '—', tot: () => '' },
    { h: 'PTS', v: p => p.pts ?? '—', cls: 'pts', sum: 'pts' },
    { h: 'OREB', need: 'orb', any: 'orb', v: p => p.orb ?? '—', sum: 'orb' },
    { h: 'DREB', need: 'drb', any: 'drb', v: p => p.drb ?? '—', sum: 'drb' },
    { h: 'REB', any: 'trb', v: p => p.trb ?? '—', sum: 'trb' },
    { h: 'AST', any: 'ast', v: p => p.ast ?? '—', sum: 'ast' },
    { h: 'STL', need: 'stl', any: 'stl', v: p => p.stl ?? '—', sum: 'stl' },
    { h: 'BLK', need: 'blk', any: 'blk', v: p => p.blk ?? '—', sum: 'blk' },
    { h: 'TO', need: 'tov', any: 'tov', v: p => p.tov ?? '—', sum: 'tov' },
    { h: 'PF', need: 'pf', any: 'pf', v: p => p.pf ?? '—', sum: 'pf' },
    { h: 'GmSc', v: p => p.gs.toFixed(1), cls: 'gs', tot: () => '' },
  ],
  shooting: [
    { h: 'PTS', v: p => p.pts ?? '—', cls: 'pts', sum: 'pts' },
    { h: 'FG', pair: ['fg', 'fga'] },
    { h: 'FG%', any: 'fga', pct: ['fg', 'fga'] },
    { h: '3PT', need: 'tp', any: 'tpa', pair: ['tp', 'tpa'] },
    { h: '3P%', need: 'tp', any: 'tpa', pct: ['tp', 'tpa'] },
    { h: 'FT', pair: ['ft', 'fta'] },
    { h: 'FT%', any: 'fta', pct: ['ft', 'fta'] },
    { h: 'eFG%', need: 'tp', any: 'fga', v: p => dec3(efg(p)), tot: rows => dec3(efg({ fg: sum(rows, 'fg'), tp: sum(rows, 'tp'), fga: sum(rows, 'fga') })) },
    { h: 'TS%', any: 'fga', v: p => dec3(ts(p)), tot: rows => dec3(ts({ pts: sum(rows, 'pts'), fga: sum(rows, 'fga'), fta: sum(rows, 'fta') })) },
  ],
}

// Folded box score: every standard column in one phone-width row. Shooting stacks FG / 3P / FT with the
// percentage worked out; offensive rebounds sit under rebounds and turnovers under assists.
// Media-query hook: wide screens unfold the box score's shooting stack; phones get one scoreboard table at a time
const WIDE_Q = '(min-width: 900px)'
const PHONE_Q = '(max-width: 700px)'
function useMedia(q) {
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q), on = () => setM(mq.matches)
    on(); mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}
const useWide = () => useMedia(WIDE_Q)
function ShotCols({ lines, bold }) {
  return lines.map(([l, m, a, win]) => {
    const p = pctOf(m, a)
    return (
      <td key={l} className={`${styles.fCell} ${styles.fShotCol} ${l === 'FG' ? styles.fShotFirst : ''}`}>
        <b className={a ? '' : styles.fZero}>{m}-{a}</b>
        <small className={bold ? (win ? styles.fWin : '') : styles[pctCls(p)]}>{p == null ? '—' : `${p}%`}</small>
      </td>
    )
  })
}
const pctOf = (m, a) => (a ? Math.round((m / a) * 100) : null)
const pctCls = p => (p == null ? 'fZero' : p >= 50 ? 'fGood' : p >= 34 ? 'fMid' : 'fBad')
function ShotLines({ lines, bold }) {
  return (
    <span className={styles.fShots}>
      {lines.map(([l, m, a, win]) => {
        const p = pctOf(m, a)
        return (
          <span key={l} className={`${styles.fShot} ${a ? '' : styles.fZero}`}>
            <i>{l}</i><b>{m}-{a}</b><em className={bold ? (win ? styles.fWin : '') : styles[pctCls(p)]}>{p == null ? '—' : `${p}%`}</em>
          </span>
        )
      })}
    </span>
  )
}
function FoldCells({ p, F, FCOLS, hi, wide }) {
  const z = v => (v ? '' : styles.fZero)
  const top = (k, v) => (v > 0 && v === hi[k] ? styles.fHi : '')
  const lines = [F.fga && ['FG', p.fg || 0, p.fga || 0], F.tpa && ['3P', p.tp || 0, p.tpa || 0], F.fta && ['FT', p.ft || 0, p.fta || 0]].filter(Boolean)
  const sub = {
    reb: F.orb && p.orb ? <small>{p.orb} off</small> : null,
    ast: F.tov ? <small className={`${p.tov ? styles.down : styles.fZero} ${p.tov && p.tov === hi.tov ? styles.fBold : ''}`}>{p.tov || 0} TO</small> : null,
    pf: p.pf >= 6 ? <small className={styles.down}>out</small> : null,
  }
  const val = { reb: p.trb, ast: p.ast, stl: p.stl, blk: p.blk, pf: p.pf }
  const key = { reb: 'trb', ast: 'ast', stl: 'stl', blk: 'blk', pf: null }
  return <>
    <td className={`${styles.gStart} ${styles.fPts}`}><b className={`${z(p.pts)} ${top('pts', p.pts)}`}>{p.pts ?? 0}</b><small>{p.gs.toFixed(1)}</small></td>
    {wide ? <ShotCols lines={lines} /> : <td className={styles.fShootCell}><ShotLines lines={lines} /></td>}
    {FCOLS.map(([k]) => (
      <td key={k} className={styles.fCell}>
        <b className={`${z(val[k])} ${key[k] ? top(key[k], val[k]) : ''} ${k === 'pf' && val[k] >= 6 ? styles.down : ''}`}>{val[k] ?? '—'}</b>{sub[k]}
      </td>
    ))}
  </>
}
function FoldTotals({ label, rows, other, F, FCOLS, cls, wide }) {
  const s = k => sum(rows, k), o = k => sum(other, k)
  const better = (m, a, om, oa) => a && oa && m / a > om / oa
  const lines = [F.fga && ['FG', s('fg'), s('fga'), better(s('fg'), s('fga'), o('fg'), o('fga'))],
    F.tpa && ['3P', s('tp'), s('tpa'), better(s('tp'), s('tpa'), o('tp'), o('tpa'))],
    F.fta && ['FT', s('ft'), s('fta'), better(s('ft'), s('fta'), o('ft'), o('fta'))]].filter(Boolean)
  const key = { reb: 'trb', ast: 'ast', stl: 'stl', blk: 'blk', pf: 'pf' }
  const win = k => (k === 'pf' ? s(key[k]) < o(key[k]) : s(key[k]) > o(key[k]))
  return (
    <tr className={cls}>
      <td className={styles.sticky}>{label}</td><td />
      <td className={`${styles.gStart} ${styles.fPts}`}><b className={s('pts') > o('pts') ? styles.fWin : styles.fLose}>{s('pts')}</b></td>
      {wide ? <ShotCols lines={lines} bold /> : <td className={styles.fShootCell}><ShotLines lines={lines} bold /></td>}
      {FCOLS.map(([k]) => (
        <td key={k} className={styles.fCell}>
          <b className={win(k) ? styles.fWin : styles.fLose}>{s(key[k])}</b>
          {k === 'reb' && F.orb && <small>{s('orb')} off</small>}
          {k === 'ast' && F.tov && <small className={`${styles.down} ${s('tov') < o('tov') ? styles.fBold : ''}`}>{s('tov')} TO</small>}
        </td>
      ))}
    </tr>
  )
}

// Elo view: pre-game Elo, duels expected vs. won on a 0..N-1 track, post-game Elo, change
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

function TeamBox({ t, rows, P, N, has, avail, shots, focus, setFocus, onCard, stat, setStat, owns }) {
  const n = N - 1
  const starters = has?.has('st') && rows.some(p => p.st)
  const sorted = [...rows].sort((a, b) => (starters ? b.st - a.st : 0) || (b.mp || 0) - (a.mp || 0) || (b.pts || 0) - (a.pts || 0))
  const sections = starters ? [['Starters', sorted.filter(p => p.st)], ['Bench', sorted.filter(p => !p.st)]] : [[null, sorted]]
  const net = rows.reduce((s, p) => s + p.post - p.pre, 0)

  // Each player's most valuable duel win and costliest loss in the grid
  const ext = useMemo(() => {
    if (stat !== 'elo') return {}
    return Object.fromEntries(rows.map(a => {
      let best = null, worst = null
      const tm = [0, 0], op = [0, 0]
      for (const b of P) {
        if (a === b) continue
        const c = duel(a, b, N)
        const r = b.t === a.t ? tm : op
        r[0] += c.act; r[1] += 1 - c.act
        if (c.act === 1 && (!best || c.delta > best.c.delta)) best = { b, c }
        if (c.act === 0 && (!worst || c.delta < worst.c.delta)) worst = { b, c }
      }
      return [a.n, { best, worst, tm, op }]
    }))
  }, [stat, rows, P, N])

  const cols = stat !== 'box' && stat !== 'elo' ? STAT_COLS[stat].filter(c => (!c.need || has?.has(c.need)) && (!c.any || avail.has(c.any))) : []
  // Folded box score: the stats this game kept, both teams' game highs, and the opponent for the totals rows
  const ok = k => has?.has(k) !== false && avail.has(k)
  const F = {
    reb: avail.has('trb'), orb: ok('orb'), ast: avail.has('ast'), tov: ok('tov'), stl: ok('stl'), blk: ok('blk'), pf: ok('pf'),
    fga: avail.has('fga'), tpa: ok('tpa'), fta: avail.has('fta'), mp: ok('mp'),
  }
  const FCOLS = [['reb', 'REB', F.orb && 'off'], ['ast', 'AST', F.tov && 'TO'], ['stl', 'STL'], ['blk', 'BLK'], ['pf', 'PF']].filter(([k]) => F[k])
  const hi = useMemo(() => {
    const m = {}
    for (const k of ['pts', 'trb', 'ast', 'stl', 'blk', 'tov']) m[k] = Math.max(0, ...P.map(p => p[k] || 0))
    return m
  }, [P])
  const opp = P.filter(p => p.t !== t)
  const wide = useWide()
  const SHOTS = [F.fga && 'FG', F.tpa && '3P', F.fta && 'FT'].filter(Boolean)
  const cell = c => p => c.pair ? split(p[c.pair[0]], p[c.pair[1]], avail.has(c.pair[1]))
    : c.pct ? fmtPct(p[c.pct[0]] || 0, p[c.pct[1]] || 0) : c.v(p)
  const total = c => c.pair ? split(sum(rows, c.pair[0]), sum(rows, c.pair[1]), avail.has(c.pair[1]))
    : c.pct ? fmtPct(sum(rows, c.pct[0]), sum(rows, c.pct[1])) : c.sum ? sum(rows, c.sum) : c.tot ? c.tot(rows) : ''
  const ELO_HEAD = ['Current Elo', 'Pregame Elo', 'Elo Δ', 'track', 'Teammate duels', 'Opponent duels', 'Best win', 'Costliest loss']
  const width = 2 + (stat === 'elo' ? ELO_HEAD.length : stat === 'box' ? 1 + (wide ? SHOTS.length : 1) + FCOLS.length : cols.length)

  const duelLink = (x, up) => x
    ? <span className={styles.duelPick} title={`${Math.round((up ? x.c.exp : 1 - x.c.exp) * 100)}% pre-game duel chance for ${up ? 'the winner' : 'the loser'}`}>
        <span>{shortName(x.b.n)}</span><em className={up ? styles.up : styles.down}>{sgn(x.c.delta)}</em></span>
    : <span className={styles.muted}>—</span>

  const row = p => {
    const d = p.post - p.pre, e = ext[p.n]
    const rec = r => (r ? `${fmtW(r[0])}–${fmtW(r[1])}` : '—')
    return (
      <tr key={p.n} className={`${focus === p.n ? styles.focus : ''} ${p.potd ? styles.rowPotd : p.potg ? styles.rowPotg : ''}`} onMouseEnter={() => setFocus(p.n)} onMouseLeave={() => setFocus(null)}>
        <td className={styles.sticky}>
          <span className={styles.pl}>
            <Headshot name={p.n} shots={shots} color={tColor(t)} />
            <span><span className={styles.pNameRow}><button className={styles.pName} onClick={() => onCard(p.n)} title="Open player card">{wide ? p.n : shortName(p.n)}</button>
              {owns?.(p.n) && <span className={styles.ownTick} title="This card is in your binder">✓</span>}<MomentMarks p={p} /></span>
              <small>{[stat === 'box' && F.mp && p.mp != null ? `${p.mp} min` : null, p.pos, p.potd ? 'Player of the Day' : p.potg ? 'Player of the Game' : null].filter(Boolean).join(' · ')}</small></span>
          </span>
        </td>
        <td className={styles.rankCell}><RankCell p={p} /></td>
        {stat === 'box' ? <FoldCells p={p} F={F} FCOLS={FCOLS} hi={hi} wide={wide} /> : stat === 'elo' ? <>
          <td className={`${styles.gStart} ${styles.eloPost}`}>{r0(p.post)}</td>
          <td className={styles.eloPre}>{r0(p.pre)}</td>
          <td className={`${styles.eloDelta} ${d >= 0 ? styles.up : styles.down}`}>{sgn(d)}</td>
          <td className={styles.trackCell}><DuelTrack w={p.w} xw={p.xw} n={n} /></td>
          <td className={styles.recCell}>{rec(e?.tm)}</td>
          <td className={styles.recCell}>{rec(e?.op)}</td>
          <td className={styles.duelCell}>{duelLink(e?.best, true)}</td>
          <td className={styles.duelCell}>{duelLink(e?.worst, false)}</td>
        </> : cols.map((c, j) => (
          <td key={c.h} className={`${j === 0 ? styles.gStart : ''} ${c.cls ? styles[c.cls] : ''}`}>{cell(c)(p)}</td>
        ))}
      </tr>
    )
  }

  return (
    <div className={styles.teamBox} style={{ '--tc': tColor(t) }}>
      <div className={styles.teamBoxHead}><TeamMark t={t} size={30} /><span>{tName(t)}</span>
        <span className={styles.statSwitch} role="tablist" aria-label="Box score view">
          {STAT_VIEWS.map(v => (
            <button key={v.id} type="button" role="tab" aria-selected={stat === v.id} className={stat === v.id ? styles.statOn : ''} onClick={() => setStat(v.id)}>{v.label}</button>
          ))}
        </span>
        <EloHelpButton /></div>
      {stat === 'elo' && <div className={styles.eloNote}>
        <span className={styles.boxLegend}><i className={styles.legExp} />Duels Elo expected<i className={styles.legWon} />Duels won</span>
        <span>Every player duels the other {n} on Game Score. <b>Best win</b> and <b>costliest loss</b> are the single duels that moved his Elo most.</span>
      </div>}
      <div className={styles.tableWrap}>
        {stat === 'box' && <div className={styles.fNote}>Under REB: offensive rebounds{F.tov ? ' · under AST: turnovers' : ''} · <i className={styles.fHiKey} /> game high · bold total: won that column</div>}
        <table className={`${styles.box} ${styles['box_' + stat]}`}>
          <thead>
            <tr>
              <th className={styles.sticky}>Player</th>
              <th className={styles.rankHead} title="League Elo rank after this game, among FPR-qualified players, and the change from before it">Player Rank</th>
              {stat === 'box' ? <>
                <th className={`${styles.gStart} ${styles.fPtsHead}`}>PTS<small>GmSc</small></th>
                {wide ? SHOTS.map(h => <th key={h} className={`${styles.fHead} ${styles.fShotCol} ${h === 'FG' ? styles.fShotFirst : ''}`}>{h}<small>%</small></th>)
                  : <th className={styles.fShootHead}>Shooting</th>}
                {FCOLS.map(([k, h, sub]) => <th key={k} className={styles.fHead}>{h}{sub && <small className={sub === 'TO' ? styles.down : ''}>{sub}</small>}</th>)}
              </> : stat === 'elo' ? ELO_HEAD.map((h, j) => h === 'track'
                ? <th key={h} className={styles.trackHead} title={`Every player duels the other ${n} on Game Score`}>
                    <span>Duels: expected → won</span>
                    <span className={styles.trackScale}><i style={{ left: '0%' }}>0</i><i style={{ left: '50%' }}>{Math.round(n / 2)}</i><i style={{ left: '100%' }}>{n}</i></span>
                  </th>
                : <th key={h} className={`${j === 0 ? styles.gStart : ''} ${h.startsWith('Best') || h.startsWith('Cost') ? styles.duelHead : ''} ${h.endsWith('duels') ? styles.recHead : ''}`}>{h}</th>)
                : cols.map((c, j) => <th key={c.h} className={j === 0 ? styles.gStart : ''}>{c.h}</th>)}
            </tr>
          </thead>
          {sections.map(([label, ps]) => (
            <tbody key={label || 'all'} className={label === 'Bench' ? styles.benchBody : undefined}>
              {label && <tr className={styles.section}><td className={styles.sticky}>{label}</td><td colSpan={width - 1} /></tr>}
              {ps.map(row)}
            </tbody>
          ))}
          {stat === 'box' ? <tbody>
            <FoldTotals label={tName(t)} rows={rows} other={opp} F={F} FCOLS={FCOLS} cls={styles.totals} wide={wide} />
            <FoldTotals label={`vs ${tName(opp[0]?.t || '')}`} rows={opp} other={rows} F={F} FCOLS={FCOLS} cls={`${styles.totals} ${styles.fOpp}`} wide={wide} />
          </tbody> : <tbody>
            <tr className={styles.totals}>
              <td className={styles.sticky}>Team</td><td />
              {stat === 'elo' ? <>
                <td className={styles.gStart} /><td />
                <td className={`${styles.eloDelta} ${net >= 0 ? styles.up : styles.down}`}>{sgn(net)}</td><td /><td /><td /><td /><td />
              </> : cols.map((c, j) => (
                <td key={c.h} className={`${j === 0 ? styles.gStart : ''} ${c.cls ? styles[c.cls] : ''}`}>{total(c)}</td>
              ))}
            </tr>
          </tbody>}
        </table>
      </div>
    </div>
  )
}

// ── "How Elo works" pop-up: Short / Full explanation and a glossary ─────────
function EloHelpButton() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className={styles.helpBtn} onClick={() => setOpen(true)} aria-label="How FPR Elo works" title="How FPR Elo works">?</button>
    {open && <EloHelp onClose={() => setOpen(false)} />}
  </>
}

const GLOSSARY = [
  ['Ratings', [
    ['Current Elo', 'A player’s rating after this game.'],
    ['Pregame Elo', 'His rating going into it.'],
    ['Elo Δ', 'The change from this game: the sum of all his duels.'],
    ['Peak Elo', 'His highest rating ever. Season peak is his highest this season.'],
    ['Avg Elo', 'His average rating across every game of his career.'],
    ['Player Rank', 'League rank by Elo after this game, among qualified players. (▲3) means he moved up three spots.'],
    ['Qualified', 'A player whose most recent game falls within his team’s last 20 games. Retired and long-inactive players drop out of the rankings.'],
    ['Top 100', 'The 100 highest-rated qualified players right now.'],
    ['Card tiers', 'Set by rank after the game: GOAT #1, Icon 2–5, Legend 6–20, Standout 21–50, Rare 51–125, Common everyone else.'],
    ['Graded slabs', 'Career games and album cards come in a graded slab. The grade is the game\u2019s Game Score percentile among every player-game on record (debuts against every career debut): 6th–14th percentile grades 1, 15th–24th 2, up to 95th and above for a 10.'],
    ['Player of the Game / Day', 'The best night score in a game, and across the whole day: Game Score plus one-sixth of the Elo gained.'],
    ['Career game', 'A career-best Game Score, once a player has 20 career games.'],
    ['Milestones', 'Tier promotions and relegations, entering or leaving the Top 100, a new #1, and career-high rank or Elo (20+ games).'],
  ]],
  ['Duels', [
    ['Duel', 'One head-to-head between two players in a game, won by the higher Game Score.'],
    ['Duel win chance', 'The pre-game odds of winning a duel, set by the two players’ Elo.'],
    ['Duels: expected → won', 'The hollow circle is how many duels his rating predicted he’d win; the solid dot is how many he won.'],
    ['Teammate / Opponent duels', 'His duel record against his own team and against the other team.'],
    ['Best win / Costliest loss', 'The single duels that added and cost him the most Elo.'],
    ['Duel %', 'Share of duels won over the season.'],
    ['Giant-Slayer', 'The least likely duel win by a player with real minutes (12+ each, a 10+ Game Score from the winner): of the game, and of the day across every game.'],
    ['Duel of the Game', 'The best head-to-head between two opponents: both need 20+ minutes and a 10+ Game Score, and the pair is scored on its weaker side, the lower Game Score × the lower pre-game Elo ÷ 2,500, so one superstar’s big night can’t carry it. The Duel of the Day is the best of these across every game.'],
    ['Stat-line inserts', 'Feats get their own card: 50-, 60- and 70-point games, triple-, quadruple- and quintuple-doubles, 20/20s, 30+ rebounds, 20+ assists, 10+ threes, blocks or steals.'],
    ['Upset', 'A win by the side with less than a 50% pre-game chance, whether a team or a player in a duel.'],
  ]],
  ['Teams and forecasts', [
    ['Lineup Elo', 'The average Elo of the players who played, weighted by minutes.'],
    ['Roster Elo', 'The average current Elo of the team’s eight players with the most minutes.'],
    ['Pre-game win chance', 'For upcoming and live games: the projected margin (lineup Elo, each team’s scoring margin, home court, back-to-backs) turned into odds. For finished games: the two lineups’ Elo plus home court.'],
    ['Forecast rating', 'For games not yet played: a blend of rotation-weighted Elo (recent minutes, injured players removed) and the top-8 roster average. The rotation gets more weight as the season goes on.'],
    ['Proj W-L', 'Current record plus the win chances of every remaining game.'],
    ['Provisional Elo', 'Live or just-finished games scored from ESPN’s box score. Official once the nightly update processes the game.'],
  ]],
  ['Box score stats', [
    ['Game Score', 'John Hollinger’s one-number summary of a box score, and the stat every duel is decided on. The formula is on the Methodology page.'],
    ['eFG%', 'Field goal percentage with threes worth 1.5 makes: (FG + 0.5 × 3PM) ÷ FGA.'],
    ['TS%', 'Scoring efficiency including free throws: PTS ÷ (2 × (FGA + 0.44 × FTA)).'],
  ]],
]

function EloHelp({ onClose }) {
  const [tab, setTab] = useState('short')
  useEffect(() => {
    // Capture Escape first so it closes this pop-up, not the box score underneath
    const k = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } }
    addEventListener('keydown', k, true)
    return () => removeEventListener('keydown', k, true)
  }, [onClose])
  return (
    <div className={styles.helpOverlay} onClick={e => { e.stopPropagation(); onClose() }}>
      <div className={styles.helpBox} role="dialog" aria-modal="true" aria-label="How FPR Elo works" onClick={e => e.stopPropagation()}>
        <div className={styles.helpHead}>
          <h3>How FPR Elo works</h3>
          <button type="button" className={styles.helpClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.helpTabs} role="tablist">
          {[['short', 'Short'], ['full', 'Full'], ['glossary', 'Glossary']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? styles.helpOn : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <div className={styles.helpBody}>
          {tab === 'short' && <p>
            <b>FPR Elo turns every game into a round robin.</b> Each player is matched against everyone else who played, on both teams,
            and wins a duel by posting the higher Game Score. Before tipoff, the ratings set how likely he was to win each duel. Beat those
            odds and he gains Elo; fall short and he loses it. Upsets pay the most, wins he was expected to get pay little, and a wider
            winning margin adds a bit more.
          </p>}
          {tab === 'full' && <>
            <p><b>Every game is a round robin.</b> Each player who sees the floor is matched against every other player in the game, teammates
              and opponents alike. Each pairing is a duel, and the higher Game Score wins it. In a 20-player game, everyone has 19 duels.</p>
            <p><b>Each duel has an expected winner.</b> The two players’ ratings set the odds before tipoff. Equal ratings make it 50/50;
              a 200-point edge makes it about 68/32; a 500-point edge about 86/14.</p>
            <p><b>Surprises move ratings; expected results barely do.</b> An 86% favorite who wins gains only a little, because he did what
              his rating said he would. If he loses, he gives back a lot. An underdog who wins that same duel gains about six times what the
              favorite would have. That’s why a role player can gain Elo on a quiet 10-point night while a star with 25 points loses some:
              the star was expected to beat almost everyone, and didn’t.</p>
            <p><b>Margin adds a little.</b> Winning a duel by 15 Game Score points counts more than winning by 1, with diminishing returns.
              A lopsided duel is worth about twice a coin-flip one, and no more.</p>
            <p><b>Newer players move faster.</b> A player’s first 100 games carry more weight per duel, so new players find their level
              quickly and veterans’ ratings stay steady.</p>
            <p><b>Reading the box score:</b> Elo Δ is the sum of every duel in the game. On the duel graphic, the hollow circle is how many
              duels his rating expected him to win, and the solid dot is how many he won.</p>
          </>}
          {tab === 'glossary' && GLOSSARY.map(([group, items]) => (
            <section key={group} className={styles.glossGroup}>
              <h4>{group}</h4>
              <dl>{items.map(([term, def]) => <Fragment key={term}><dt>{term}</dt><dd>{def}</dd></Fragment>)}</dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

// ★ career game, ◆ milestones; hover for the details
function MomentMarks({ p }) {
  const m = momentsFor(p)
  return <>
    {m.career && <span className={styles.markStar} title={`Career game: career-best ${p.gs.toFixed(1)} Game Score`}>★</span>}
    {m.stamps.length > 0 && <span className={m.stamps.some(x => x.up) ? styles.markDia : styles.markDiaDown} title={m.stamps.map(x => x.text).join(' · ')}>◆</span>}
  </>
}

// League Elo rank after the game (pre-game rank on data without it), with the move; -- when unranked
function RankCell({ p }) {
  const rank = p.unrated ? null : p.lrp ?? p.lr ?? null
  if (rank == null) return <span className={styles.rankNone} title="Not ranked">--</span>
  const mv = p.lrp != null && p.lr != null ? p.lr - p.lrp : 0
  return (
    <span className={styles.rankVal} title={p.lrp != null && p.lr != null ? `#${p.lr} before the game` : undefined}>
      <b>#{rank}</b>{mv !== 0 && <i className={mv > 0 ? styles.up : styles.down}>({mv > 0 ? '▲' : '▼'}{Math.abs(mv)})</i>}
    </span>
  )
}

// ── Rivalries: head-to-head duel history going into a game ─────────────────
// Per-player files from the pipeline (scripts/rivalries.py); the name hash matches its fnv()
const fnv = str => { let h = 0x811c9dc5; for (const b of new TextEncoder().encode(str)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') }
const rivalSlug = n => (n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'player') + '-' + fnv(n)
const getRivals = n => getJSON(`/data/explorer/rivals/${rivalSlug(n)}.json`).catch(() => null)

// One pipeline rivalry row, oriented so the player ahead in the series comes first
// (or, with byOver, the player beating expectation)
function rivRow(r, byOver) {
  let [a, b, aw, bw, t, axw, ae, be] = r
  const flip = byOver ? aw + t / 2 - axw < 0 : bw > aw
  if (flip) { axw = aw + bw + t - axw; [a, b, aw, bw, ae, be] = [b, a, bw, aw, be, ae] }
  const n = aw + bw + t
  return { a, b, aw, bw, t, axw, ae, be, n, over: aw + t / 2 - axw,
    lead: aw === bw ? `Tied ${aw}–${bw}` : `${shortName(a)} leads ${aw}–${bw}` }
}

// Opponent and teammate records going into the game on `date`: earlier seasons from the files,
// earlier games this season from the loaded season data
// The same picks as rivalries._notable: two longest histories (5+ duels), two furthest from expectation (20+)
function notableRivals(players, car) {
  const c = []
  for (const x of players) for (const y of players) {
    if (x.t === y.t || x.n >= y.n) continue
    const r = car.get(x.n + '|' + y.n)
    if (r) c.push(r)
  }
  const n = r => r[2] + r[3] + r[4], seen = new Set(), out = []
  for (const r of [...c].sort((p, q) => n(q) - n(p)).slice(0, 2)) if (n(r) >= 5) { out.push(r); seen.add(r) }
  const off = r => Math.abs(r[2] + r[4] / 2 - r[5])
  for (const r of c.filter(r => n(r) >= 20).sort((p, q) => off(q) - off(p)).slice(0, 2)) if (!seen.has(r)) out.push(r)
  return out
}

async function rivalryGoingIn(a, b, sd, date) {
  const [fa, fb] = await Promise.all([getRivals(a), getRivals(b)])
  const sy = sd.sy ?? +String(sd.season).slice(0, 4)
  const blank = () => ({ w: 0, l: 0, t: 0, xw: 0, ea: 0, eb: 0 })
  const out = { o: blank(), m: blank() }
  for (const k of ['o', 'm']) {
    const ra = fa?.[k]?.[b] || [], rb = fb?.[k]?.[a] || []
    for (let i = 0; i < ra.length; i += 6) if (ra[i] < sy) { const r = out[k]; r.w += ra[i + 1]; r.l += ra[i + 2]; r.t += ra[i + 3]; r.xw += ra[i + 4]; r.ea += ra[i + 5] }
    for (let i = 0; i < rb.length; i += 6) if (rb[i] < sy) out[k].eb += rb[i + 5]
  }
  for (const g of sd.games || []) {
    if (g.date >= date) continue
    const pa = g.players.find(p => p.n === a), pb = pa && g.players.find(p => p.n === b)
    if (!pb) continue
    const N = g.players.length, c = duel(pa, pb, N), cb = duel(pb, pa, N), r = out[pa.t === pb.t ? 'm' : 'o']
    if (c.act === 1) r.w++; else if (c.act === 0) r.l++; else r.t++
    r.xw += c.exp; r.ea += c.delta; r.eb += cb.delta
  }
  return out
}

function RivalryBox({ a, b, sd, date }) {
  const [h, setH] = useState(null)
  useEffect(() => {
    let live = true
    setH(null)
    rivalryGoingIn(a, b, sd, date).then(x => { if (live) setH(x) })
    return () => { live = false }
  }, [a, b, sd, date])
  const A = shortName(a), B = shortName(b)
  const n = r => r.w + r.l + r.t
  const rec = (r, x, y) => r.w === r.l ? `Even at ${r.w}–${r.l}` : r.w > r.l ? `${x} leads ${r.w}–${r.l}` : `${y} leads ${r.l}–${r.w}`
  return (
    <div className={styles.rivBox}>
      <em className={styles.dChanceCap}>Rivalry going in</em>
      {!h ? <p className={styles.rivMuted}>Loading their history…</p>
        : !n(h.o) && !n(h.m) ? <p className={styles.rivMuted}>First meeting.</p>
        : <>
          {n(h.o) > 0 && <>
            <div className={styles.rivHead}><b>{rec(h.o, A, B)}</b><small>{n(h.o)} duel{n(h.o) === 1 ? '' : 's'} as opponents{h.o.t ? ` · ${h.o.t} tie${h.o.t === 1 ? '' : 's'}` : ''}</small></div>
            <div className={styles.rivLine}><span>{A} vs expected</span><b className={h.o.w + h.o.t / 2 - h.o.xw >= 0 ? styles.up : styles.down}>{sgn(h.o.w + h.o.t / 2 - h.o.xw)} wins</b></div>
            <div className={styles.rivLine}><span>Elo gained · {A}</span><b className={h.o.ea >= 0 ? styles.up : styles.down}>{sgn(h.o.ea)}</b></div>
            <div className={styles.rivLine}><span>Elo gained · {B}</span><b className={h.o.eb >= 0 ? styles.up : styles.down}>{sgn(h.o.eb)}</b></div>
          </>}
          {n(h.m) > 0 && <div className={`${styles.rivLine} ${styles.rivMate}`}><span>As teammates</span><b>{rec(h.m, A, B)}</b></div>}
        </>}
    </div>
  )
}

// The differentiator: FPR scores a game as a round robin. Every cell is one duel.
function DuelGrid({ P, focus, setFocus, shots, game, sd, pinPair }) {
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
  const idx = n => order.findIndex(p => p.n === n)
  // Opened from a rivalry board: start with that duel pinned
  useEffect(() => {
    if (!pinPair) return
    const i = idx(pinPair[0]), j = idx(pinPair[1])
    if (i >= 0 && j >= 0) setPin([i, j])
  }, [pinPair, order])
  // Rivalry of the game: the opposing pair with the deepest history going in
  const rotg = useMemo(() => {
    const r = game?.riv?.[0]; if (!r) return null
    const x = rivRow(r), i = idx(x.a), j = idx(x.b)
    return i >= 0 && j >= 0 ? { ...x, i, j } : null
  }, [game, order])
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
        {sd && game && <RivalryBox a={a.n} b={b.n} sd={sd} date={game.date} />}
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
              {rotg && <>
                <div className={`${styles.dTag} ${styles.dTagGap}`}>Rivalry of the game</div>
                <button type="button" className={`${styles.keyRow} ${styles.keyRiv}`} onClick={() => pick(rotg.i, rotg.j)}>
                  <span className={styles.keyWho}><b>{shortName(rotg.a)}</b> vs {shortName(rotg.b)}</span>
                  <span className={styles.keyMeta}>{rotg.n} opponent duels going in</span>
                  <b>{rotg.aw}–{rotg.bw}</b>
                </button>
              </>}
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
function Today({ day, sd, index, fc, shots, ratings, careers, selectPlayer }) {
  const asof = index.seasons[0]?.last || '0000-00-00'
  const wantsLive = day >= asof
  const [feed, setFeed] = useState(null)
  const [feedErr, setFeedErr] = useState(null)
  const [box, setBox] = useState(null)        // { id, team }
  const [card, setCard] = useState(null)      // { id: game id, name }
  const [duelPick, setDuelPick] = useState(null) // { kind, scope, an, bn, id }
  const [binder, setBinder] = useState(null)  // { name, sd }
  const [preview, setPreview] = useState(null)
  const sdOk = sd && (sd.season === seasonFor(day) || (sd.season === index.seasons[0]?.season && seasonFor(day) > sd.season))
  const sy = +seasonFor(day).slice(0, 4)

  useEffect(() => {
    setFeed(null); setFeedErr(null); setBox(null); setCard(null)
    if (!wantsLive) return
    // Shared with the standings' live layer: one fetch and one poll per day however many views watch it
    return watchDay(day, ({ data, err }) => { if (data) setFeed(data); setFeedErr(err) }, day === etToday())
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
    // Career moments for live games, against career bests through the last data update (20+ games)
    live.forEach(g => g.players.forEach(p => {
      const b = careers[p.n]
      p.fx = b && !p.unrated && p.gp >= 20 ? (p.gs > b[0] ? 1 : 0) | (p.lrp < b[1] ? 2 : 0) | (p.post > b[2] ? 4 : 0) : 0
    }))
    // Live games show the forecast's pre-game chance (the same model as previews), not the lineup's
    if (fc) live.forEach(g => {
      const home = g.home || g.teams[1], away = g.teams.find(t => t !== home)
      const pf = safeGame(fc.f, home, away, day)
      if (pf?.margin != null) { g.wp = { [home]: pf.pHome, [away]: pf.pAway }; g.fcwp = true }
      const pr = pf && fc.project?.(pf)
      if (pr) g.proj = { [home]: pr[0], [away]: pr[1] }   // pre-game projected score
    })
    markHonors([...data, ...live]) // Player of the Day covers every game of the day, live or official
    const unmatched = live.flatMap(g => g.players.filter(p => p.unrated).map(p => `${p.espnName} (${tCode(p.t)})`))
    return { scored: [...data, ...live], sched, unmatched }
  }, [sd, sdOk, day, feed, ratings, teamLatest, sy, careers, fc])

  const boards = useMemo(() => dayBoards(scored), [scored])
  // Rivalries: pipeline games carry theirs; live games look up career totals among active players
  const [activeRiv, setActiveRiv] = useState(null)
  const anyLive = scored.some(g => g.live)
  useEffect(() => {
    if (!anyLive || activeRiv) return
    getJSON('/data/explorer/rivals_active.json').then(rows => setActiveRiv(new Map(rows.map(r => [r[0] + '|' + r[1], r])))).catch(() => {})
  }, [anyLive, activeRiv])
  const rivals = useMemo(() => {
    const all = []
    for (const g of scored) {
      if (g.live && activeRiv) g.riv = notableRivals(g.players, activeRiv)
      for (const r of g.riv || []) all.push({ g, r })
    }
    const key = x => x.r[0] + '|' + x.r[1]
    const uniq = list => { const s = new Set(); return list.filter(x => !s.has(key(x)) && s.add(key(x))) }
    const n = r => r[2] + r[3] + r[4], off = r => Math.abs(r[2] + r[4] / 2 - r[5])
    return {
      longest: uniq([...all].sort((x, y) => n(y.r) - n(x.r))).slice(0, 8).map(x => ({ g: x.g, ...rivRow(x.r) })),
      lopsided: uniq(all.filter(x => n(x.r) >= 20).sort((x, y) => off(y.r) - off(x.r))).slice(0, 8).map(x => ({ g: x.g, ...rivRow(x.r, true) })),
    }
  }, [scored, activeRiv])
  const openRival = x => {
    const p = x.g.players.find(q => q.n === x.a)
    setBox({ id: x.g.id, team: p?.t || x.g.teams[0], pin: [x.a, x.b] })
  }
  const predLive = usePredSlate(day) // today and tomorrow: pick bars under the cards
  const cards = useMemo(() => {
    const order = { in: 0, pre: 1, post: 2 }
    const list = [
      ...scored.map(g => {
        const home = g.home || g.teams[1], away = g.teams.find(t => t !== home)
        // pre-game forecast for a game in progress, for its projected final
        return { key: g.id, g, state: g.live?.state || 'post', tip: g.tip || '', pfg: fc && g.live?.state === 'in' ? safeGame(fc.f, home, away, day) : null }
      }),
      ...sched.map(x => ({ key: x.id, x, state: x.state, tip: x.tip || '', fg: fc && x.state === 'pre' ? safeGame(fc.f, x.home, x.away, day) : null,
        pfg: fc && x.state === 'in' ? safeGame(fc.f, x.home, x.away, day) : null })),
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
  const daySd = useMemo(() => {
    const live = scored.filter(g => g.live)
    if (sdOk && !live.length) return sd
    return { ...(sdOk ? sd : {}), season: sdOk ? sd.season : seasonFor(day), games: [...(sdOk ? sd.games.filter(g => g.date < day || (g.date === day && !g.live)) : []), ...live] }
  }, [sd, sdOk, scored, day])
  const cardSd = cardGame && daySd
  // Sidebar: the day's Player of the Day, biggest riser and biggest faller, then career games and milestones
  const side = useMemo(() => {
    const all = scored.flatMap(g => g.players.map(p => ({ g, p })))
    const potd = all.find(x => x.p.potd)
    const moments = all.map(x => ({ ...x, m: momentsFor(x.p) }))
    const { slayer = null, duel = null } = dayDuels(scored).get(day) || [...dayDuels(scored).values()][0] || {}
    return {
      picks: [['Player of the Day', potd], ['Duel of the Day', duel, 'duel'], ['Giant-Slayer of the Day', slayer, 'slayer'],
        ['Biggest Elo riser', boards.risers[0]], ['Biggest Elo faller', boards.fallers[0]]].filter(([, x]) => x),
      careerGames: moments.filter(x => x.m.career).sort((a, b) => b.p.gs - a.p.gs),
      milestones: moments.filter(x => x.m.stamps.length).sort((a, b) => (a.p.lrp ?? 999) - (b.p.lrp ?? 999)),
    }
  }, [scored, boards])
  // Players in action: everyone in the day's box scores at his post-game (or live) Elo, plus the
  // projected rotations of games without a box yet at their current Elo. Rookies debuted this season.
  const inAction = useMemo(() => {
    const cut = `${sy}-08-01`
    const current = sy >= +(index.seasons[0]?.season || '0').slice(0, 4)
    const rookie = (n, espnName) => {
      // This season: ESPN's years of experience decides. Past seasons: first game in the data
      const e = current ? (shots?.[norm(n)] || (espnName && shots?.[norm(espnName)])) : null
      if (e && e.exp != null) return e.exp === 0
      const f = ratings.byNorm[norm(n)]?.team_history?.[0]?.[0]
      return !!f && f >= cut
    }
    // League rank after today's results so far (FPR-qualified pool), for players yet to play
    const after = new Map(ratings.pool)
    scored.forEach(g => g.players.forEach(p => { if (after.has(p.n)) after.set(p.n, p.post) }))
    const vals = [...after.values()].sort((a, b) => b - a)
    const rankOf = (n, v) => (after.has(n) ? 1 + vals.filter(x => x > v).length : null)
    const seen = new Set(), all = []
    for (const g of scored) {
      const state = g.live?.state || 'post'
      for (const p of g.players) {
        if (seen.has(p.n) || (state === 'post' && p.mp === 0)) continue
        seen.add(p.n)
        const opp = g.teams.find(t => t !== p.t), home = (g.home || g.teams[1]) === p.t
        all.push({ key: g.id + p.n, n: p.n, t: p.t, elo: p.post, d: p.post - p.pre, g, p, rk: p, state, opp, home, rookie: rookie(p.n, p.espnName) })
      }
    }
    if (fc) for (const x of sched) {
      if (x.state === 'post') continue
      for (const t of [x.home, x.away]) {
        let tm
        try { tm = fc.f.team(t, day) } catch { continue }
        for (const r of tm?.rows || []) {
          if (r.out || !(r.mp > 0) || seen.has(r.name)) continue
          seen.add(r.name)
          all.push({ key: x.id + r.name, n: r.name, t, elo: r.elo, d: null, x, rk: { lrp: rankOf(r.name, r.elo), lr: null }, state: x.state, opp: t === x.home ? x.away : x.home, home: t === x.home, rookie: rookie(r.name) })
        }
      }
    }
    all.sort((a, b) => b.elo - a.elo)
    return { top: all.slice(0, 20), rookies: all.filter(r => r.rookie).slice(0, 20), any: all.length }
  }, [scored, sched, fc, day, ratings, sy, shots, index])
  const openAction = r => (r.g ? openCard(r.g, r.p) : selectPlayer?.(r.n))

  // Every table on the day page. Desktop lays them out in grids; phones show one at a time with a picker
  const sideNode = <>
          {side.picks.map(([label, x, kind]) => kind ? (
            <div key={label} className={styles.sideCard}>
              <div className={styles.sideLab}>{label}<span>{shortName(x.a.n)} over {shortName(x.b.n)}{kind === 'slayer' ? ` · ${Math.max(1, Math.round(x.wc * 100))}%` : ''}</span></div>
              <button type="button" className={styles.sideMini} onClick={() => setDuelPick({ kind, scope: 'day', an: x.a.n, bn: x.b.n, id: x.g.id })} aria-label={`${label}: ${x.a.n} over ${x.b.n}, open card`}>
                <span className={styles.sideScale} data-still="">
                  <DuelCard kind={kind} scope="day" date={x.g.date}
                    a={{ name: x.a.n, row: x.a, color: tColor(x.a.t), team: tShort(x.a.t), abbr: tCode(x.a.t), headshot: shots?.[norm(x.a.n)]?.headshot }}
                    b={{ name: x.b.n, row: x.b, color: tColor(x.b.t), team: tShort(x.b.t), abbr: tCode(x.b.t), headshot: shots?.[norm(x.b.n)]?.headshot }} />
                </span>
              </button>
            </div>
          ) : (({ g, p }) => (
            <div key={label} className={styles.sideCard}>
              <div className={styles.sideLab}>{label}<span>{shortName(p.n)} · {sgn(p.post - p.pre)} Elo</span></div>
              <button type="button" className={styles.sideMini} onClick={() => openCard(g, p)} aria-label={`${label}: ${p.n}, open card`}>
                <span className={styles.sideScale} data-still="">
                  <MiniCard name={p.n} row={p} game={cardGameInfo(g, p.t, daySd, p)} team={{ name: tName(p.t), color: tColor(p.t), abbr: tCode(p.t), logo: logoUrl(p.t) }} headshot={shots?.[norm(p.n)]?.headshot} />
                </span>
              </button>
            </div>
          ))(x))}
          <section className={styles.sideList}>
            <h4><span className={styles.markStar}>★</span> Career games</h4>
            {side.careerGames.length ? side.careerGames.map(({ g, p }) => (
              <button key={g.id + p.n} type="button" onClick={() => openCard(g, p)}>
                <b>{shortName(p.n)}</b><small>{tCode(p.t)}</small><em>{p.gs.toFixed(1)} GmSc</em>
              </button>
            )) : <p>No career-best games yet.</p>}
          </section>
          <section className={styles.sideList}>
            <h4><span className={styles.markDia}>◆</span> Milestones</h4>
            {side.milestones.length ? side.milestones.map(({ g, p, m }) => (
              <button key={g.id + p.n} type="button" onClick={() => openCard(g, p)}>
                <b>{shortName(p.n)}</b><small>{tCode(p.t)}</small><em className={m.stamps[0].up ? '' : styles.muted}>{m.stamps.map(x => x.text).join(' · ')}</em>
              </button>
            )) : <p>No milestones yet.</p>}
          </section>
  </>
  const tables = []
  if (scored.length) tables.push({ id: 'perf', g: 'Players', title: 'Top performers', lead: boards.performers[0] && `${shortName(boards.performers[0].p.n)} · ${boards.performers[0].p.gs.toFixed(1)} GmSc`,
    node: <PerfTable rows={boards.performers} shots={shots} onOpen={openCard} /> })
  if (inAction.any) tables.push(
    { id: 'action', g: 'Players', title: 'Top 20 in action', lead: inAction.top[0] && `${shortName(inAction.top[0].n)} · ${r0(inAction.top[0].elo)}`,
      node: <InActionBoard title="Top 20 in action" rows={inAction.top} shots={shots} onOpen={openAction} /> },
    { id: 'rookies', g: 'Players', title: 'Top 20 rookies in action', lead: inAction.rookies[0] ? `${shortName(inAction.rookies[0].n)} · ${r0(inAction.rookies[0].elo)}` : 'No rookies today',
      node: <InActionBoard title="Top 20 rookies in action" rows={inAction.rookies} shots={shots} onOpen={openAction} empty="No rookies on today's rosters." /> })
  const lead = (x, f) => (x ? `${shortName(x.p.n)} · ${f(x.p)}` : 'Nobody yet')
  if (scored.length) tables.push(
    { id: 'risers', g: 'Elo', title: 'Elo risers', lead: lead(boards.risers[0], p => sgn(p.post - p.pre)), node: <Board title="Elo risers" sub="Elo change" rows={boards.risers} shots={shots} onOpen={openCard}
                val={({ p }) => sgn(p.post - p.pre)} valCls={styles.up} line={({ p }) => `${r0(p.pre)} → ${r0(p.post)} · ${p.gs.toFixed(1)} GmSc`} /> },
    { id: 'fallers', g: 'Elo', title: 'Elo fallers', lead: lead(boards.fallers[0], p => sgn(p.post - p.pre)), node: <Board title="Elo fallers" sub="Elo change" rows={boards.fallers} shots={shots} onOpen={openCard}
                val={({ p }) => sgn(p.post - p.pre)} valCls={styles.down} line={({ p }) => `${r0(p.pre)} → ${r0(p.post)} · ${p.gs.toFixed(1)} GmSc`} /> },
    { id: 't100up', g: 'Elo', title: 'Top 100 risers', lead: lead(boards.top100Risers[0], p => `▲${p.lr - p.lrp}`), node: <Board title="Top 100 risers" sub="League rank" rows={boards.top100Risers} shots={shots} onOpen={openCard} empty="Nobody climbed inside the top 100."
                val={({ p }) => `▲${p.lr - p.lrp}`} valCls={styles.up}
                line={({ p }) => `#${p.lr} → #${p.lrp}${p.lr > 100 ? ' · enters top 100' : ''}`} /> },
    { id: 't100down', g: 'Elo', title: 'Top 100 fallers', lead: lead(boards.top100Fallers[0], p => `▼${p.lrp - p.lr}`), node: <Board title="Top 100 fallers" sub="League rank" rows={boards.top100Fallers} shots={shots} onOpen={openCard} empty="Nobody in the top 100 slipped."
                val={({ p }) => `▼${p.lrp - p.lr}`} valCls={styles.down}
                line={({ p }) => `#${p.lr} → #${p.lrp}${p.lrp > 100 ? ' · drops out' : ''}`} /> },
    { id: 'upg', g: 'Upsets', title: 'Biggest upsets · Games', lead: boards.gameUpsets[0] ? `${tShort(boards.gameUpsets[0].team)} · ${Math.round(boards.gameUpsets[0].chance * 100)}%` : 'No upsets yet',
      node: <section className={styles.board}>
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
              </section> },
    { id: 'upp', g: 'Upsets', title: 'Biggest upsets · Players', lead: boards.duelUpsets[0] ? `${shortName(boards.duelUpsets[0].a.n)} · ${Math.max(1, Math.round(boards.duelUpsets[0].chance * 100))}%` : 'No upsets yet',
      node: <section className={styles.board}>
                <header><h3>Biggest upsets · Players</h3><span>Pre-game duel chance</span></header>
                {boards.duelUpsets.length ? boards.duelUpsets.map(u => (
                  <button key={u.g.id + u.a.n + u.b.n} className={styles.bRow} onClick={() => openCard(u.g, u.a)}>
                    <Headshot name={u.a.n} shots={shots} color={tColor(u.a.t)} />
                    <span className={styles.bWho}><b>{shortName(u.a.n)} <i>over</i> {shortName(u.b.n)}</b>
                      <small>{u.a.gs.toFixed(1)} vs {u.b.gs.toFixed(1)} GmSc · {r0(u.a.pre)} vs {r0(u.b.pre)} Elo</small></span>
                    <b className={styles.bVal}>{Math.max(1, Math.round(u.chance * 100))}%</b>
                  </button>
                )) : <p className={styles.bNone}>No qualifying upsets yet.</p>}
              </section> },
    { id: 'rlong', g: 'Rivalries', title: 'Rivalries · Longest history', lead: rivals.longest[0] ? `${shortName(rivals.longest[0].a)} vs ${shortName(rivals.longest[0].b)} · ${rivals.longest[0].n}` : '—',
      node: <section className={styles.board}>
                <header><h3>Rivalries · Longest history</h3><span>Opponent duels going in</span></header>
                {rivals.longest.length ? rivals.longest.map(x => (
                  <button key={x.g.id + x.a + x.b} className={styles.bRow} onClick={() => openRival(x)}>
                    <Headshot name={x.a} shots={shots} color={tColor(x.g.players.find(q => q.n === x.a)?.t)} />
                    <span className={styles.bWho}><b>{shortName(x.a)} <i>vs</i> {shortName(x.b)}</b>
                      <small>{x.lead}{x.t ? ` · ${x.t} tie${x.t === 1 ? '' : 's'}` : ''}</small></span>
                    <b className={styles.bVal}>{x.n}</b>
                  </button>
                )) : <p className={styles.bNone}>{anyLive && !activeRiv ? 'Loading rivalries…' : 'No pairs with 5+ duels tonight.'}</p>}
              </section> },
    { id: 'rlop', g: 'Rivalries', title: 'Rivalries · Most lopsided', lead: rivals.lopsided[0] ? `${shortName(rivals.lopsided[0].a)} · ${sgn(rivals.lopsided[0].over)}` : '—',
      node: <section className={styles.board}>
                <header><h3>Rivalries · Most lopsided</h3><span>Wins over expected · 20+ duels</span></header>
                {rivals.lopsided.length ? rivals.lopsided.map(x => (
                  <button key={x.g.id + x.a + x.b} className={styles.bRow} onClick={() => openRival(x)}>
                    <Headshot name={x.a} shots={shots} color={tColor(x.g.players.find(q => q.n === x.a)?.t)} />
                    <span className={styles.bWho}><b>{shortName(x.a)} <i>vs</i> {shortName(x.b)}</b>
                      <small>{x.aw}–{x.bw}{x.t ? `–${x.t}` : ''} · expected {x.axw.toFixed(1)} wins of {x.n}</small></span>
                    <b className={`${styles.bVal} ${styles.up}`}>{sgn(x.over)}</b>
                  </button>
                )) : <p className={styles.bNone}>No pairs with 20+ duels tonight.</p>}
              </section> },
    { id: 'honors', g: 'Honors', title: "Tonight's honors", lead: side.picks[0] ? `${shortName(side.picks[0][1].p.n)} · Player of the Day` : '—',
      node: <div className={styles.phoneSide}>{sideNode}</div> })
  const byId = Object.fromEntries(tables.map(t => [t.id, t.node]))

  const liveN = cards.filter(c => c.state === 'in').length
  const phone = useMedia(PHONE_Q)
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
        : <div className={styles.dayLayout}><div className={styles.dayMain}>
          <div className={styles.gGrid}>
            {cards.map(c => {
              const home = c.g ? (c.g.home || c.g.teams[1]) : c.x.home, away = c.g ? c.g.teams.find(t => t !== home) : c.x.away
              const card = <GameCard key={c.key} c={c} shots={shots}
                onOpen={c.g ? () => openBox(c.g) : c.fg ? () => setPreview({ day, fg: c.fg }) : null} />
              return predLive ? <div key={c.key} className={predStyles.cardWrap}>{card}<PickBar day={day} home={home} away={away} state={c.state} tip={c.tip} /></div> : card
            })}
          </div>

          {phone ? <PhoneTables tables={tables} /> : <>
            {byId.perf}
            {inAction.any > 0 && <div className={styles.boards2}>{byId.action}{byId.rookies}</div>}
            {scored.length > 0 && <>
              <div className={styles.boards4}>{byId.risers}{byId.fallers}{byId.t100up}{byId.t100down}</div>
              <div className={styles.boards2}>{byId.upg}{byId.upp}</div>
              <div className={styles.boards2}>{byId.rlong}{byId.rlop}</div>
            </>}
          </>}
          {unmatched.length > 0 && <p className={styles.unmatched} title="ESPN names with no match in the ratings. They're scored as new players at 1,500 until the pipeline links them.">
            Rated as new players (no ratings match): {unmatched.join(', ')}</p>}
        </div>
        {scored.length > 0 && !phone && <aside className={styles.daySide}>{sideNode}</aside>}
        </div>}

      {preview && <Preview g={preview} shots={shots} fetched={fc?.fetched} onClose={() => setPreview(null)} />}
      {boxView && <BoxScore key={box.id} team={box.team} game={boxView} has={boxGame.live ? FULL_STATS : sd?.has} shots={shots} sd={daySd} pinPair={box.pin}
        onCard={n => setCard({ id: box.id, name: n })} onClose={() => setBox(null)}
        onDuel={(kind, an, bn) => setDuelPick({ kind, scope: 'game', an, bn, id: box.id, fromBox: true })} />}
      {duelPick && (g => g && <DuelView kind={duelPick.kind} scope={duelPick.scope} an={duelPick.an} bn={duelPick.bn} g={g} sd={daySd} shots={shots}
        onClose={() => setDuelPick(null)}
        onBox={duelPick.fromBox ? undefined : () => { const a = g.players.find(p => p.n === duelPick.an); setDuelPick(null); setBox({ id: g.id, team: a?.t || g.teams[0], pin: [duelPick.an, duelPick.bn] }) }} />)(scored.find(x => x.id === duelPick.id))}
      {cardView && <SeasonCard name={card.name} g={cardGame} sd={cardSd} shots={shots}
        onProfile={n => { setCard(null); setBox(null); selectPlayer(n) }} onClose={() => setCard(null)}
        onBinder={() => { setBinder({ kind: 'season', name: card.name, sd: cardSd }); setCard(null) }}
        onCareer={() => { setBinder({ kind: 'career', name: card.name }); setCard(null) }} />}
      {binder && <BinderHost start={binder} shots={shots} onClose={() => setBinder(null)}
        onProfile={n => { setBinder(null); setBox(null); selectPlayer(n) }} />}
    </div>
  )
}

const safeGame = (f, home, away, day) => { try { return f.game(home, away, day) } catch { return null } }

const ScoreLine = ({ fav, dog, s }) => (
  <b className={styles.scoreLine}><TeamMark t={fav} size={16} />{s[fav]}<i>–</i><TeamMark t={dog} size={16} />{s[dog]}</b>
)
function GameCard({ c, shots, onOpen }) {
  const g = c.g, x = c.x
  const home = g ? (g.home || g.teams[1]) : x.home
  const away = g ? g.teams.find(t => t !== home) : x.away
  const pts = g ? { [g.teams[0]]: g.pts[0], [g.teams[1]]: g.pts[1] } : { [x.home]: x.hs, [x.away]: x.as }
  const started = c.state !== 'pre'
  const lead = started && pts[home] !== pts[away] ? (pts[home] > pts[away] ? home : away) : null
  const wp = g ? g.wp : c.fg ? { [home]: c.fg.pHome, [away]: c.fg.pAway } : null
  const status = c.state === 'in' ? <span className={styles.liveTxt}><i className={styles.liveDot} />{(g?.live || x).detail}</span>
    : c.state === 'pre' ? tipTime(x.tip) : `Final${(g || x).ot ? `/${(g || x).ot}` : ''}`
  const top = g && [...g.players].sort((a, b) => b.gs - a.gs)[0]
  const mover = g && [...g.players].sort((a, b) => Math.abs(b.post - b.pre) - Math.abs(a.post - a.pre))[0]
  const best = side => side && [...side.rows].filter(r => !r.out).sort((a, b) => b.elo - a.elo)[0]
  const tm = c.fg && [best(c.fg.away), best(c.fg.home)]
  // Started games: the pre-game projected score, and for games in progress the live projection
  const pp = g?.proj || ((started ? c.pfg : c.fg) && PROJECT?.(started ? c.pfg : c.fg))
  const preProj = !pp ? null : Array.isArray(pp) ? { [home]: pp[0], [away]: pp[1] } : pp
  // Pre-game favorite: by win chance, else by projected score
  const fav = wp ? (wp[home] >= wp[away] ? home : away) : preProj && preProj[away] > preProj[home] ? away : home
  const dog = fav === home ? away : home
  // Upset: the pre-game underdog won. Upset watch, in progress: the underdog is now projected to win, from the
  // pre-game projection plus the lead and the time left (a few early points don't flip a big favorite).
  // Without a projection, a late lead (fourth quarter or overtime) or a big one (12+) has to do.
  const st = { ...(g?.live || x), hs: pts[home] || 0, as: pts[away] || 0 }
  const pLiveHome = c.state === 'in' && preProj ? liveWinHome(preProj[home] - preProj[away], st, 13.7) : null
  const upset = c.state === 'in'
    ? (pLiveHome != null ? (dog === home ? pLiveHome : 1 - pLiveHome) >= 0.5 && wp?.[dog] < 0.5
      : lead === dog && wp?.[dog] < 0.5 && ((st.period || 0) >= 4 || Math.abs((pts[home] || 0) - (pts[away] || 0)) >= 12))
    : c.state === 'post' && lead && wp && wp[lead] < 0.5
  const liveProj = c.state === 'in' && preProj ? liveFinal([preProj[home], preProj[away]], g?.live || x, pts[home] || 0, pts[away] || 0) : null
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
      {(wp || preProj) && <div className={styles.gWp}>
        {wp && <div className={styles.gWpTrack}>
          <span style={{ width: `${wp[away] * 100}%`, background: tColor(away) }} />
          <span style={{ width: `${wp[home] * 100}%`, background: tColor(home) }} />
        </div>}
        {<>
          <small className={styles.gPre}>
            {wp && <span>Pre-game{g && !g.fcwp ? ' Elo' : ''}: <b className={styles.gProj}>{Math.round(wp[fav] * 100)}%</b><TeamMark t={fav} size={16} /></span>}
            {preProj && <span>Projected score: <ScoreLine fav={fav} dog={dog} s={preProj} /></span>}
          </small>
          {liveProj && <small className={`${styles.gPre} ${styles.gLiveProj}`}><span>Live projection: <ScoreLine fav={fav} dog={dog} s={{ [home]: liveProj[0], [away]: liveProj[1] }} /></span></small>}
        </>}
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

// Phones: one scoreboard table at a time. A button names the current table; tapping it opens a sheet
// of every table, grouped, each with tonight's leader so you can see where the action is before you tap
const PT_KEY = 'fpr.dayTable'
function PhoneTables({ tables }) {
  const [id, setId] = useState(() => { try { return localStorage.getItem(PT_KEY) || 'perf' } catch { return 'perf' } })
  const [open, setOpen] = useState(false)
  const pickRef = useRef(null)
  const k = Math.max(0, tables.findIndex(t => t.id === id)), cur = tables[k]
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', esc)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', esc) }
  }, [open])
  if (!cur) return null
  const pick = t => {
    setId(t.id); setOpen(false)
    try { localStorage.setItem(PT_KEY, t.id) } catch { /* private mode */ }
    // A long table may have scrolled the picker away: bring the new table's top back into view
    requestAnimationFrame(() => { const b = pickRef.current; if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ block: 'start' }) })
  }
  const groups = [...new Set(tables.map(t => t.g))]
  return (
    <div className={styles.ptWrap}>
      <button type="button" ref={pickRef} className={styles.ptPick} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className={styles.ptMeta}><small>{cur.g} · Table {k + 1} of {tables.length}</small><b>{cur.title}</b></span>
        <span className={styles.ptAll}>All tables</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <div className={styles.ptBody}>{cur.node}</div>
      {open && <div className={styles.ptLayer}>
        <button type="button" className={styles.ptBackdrop} onClick={() => setOpen(false)} aria-label="Close table picker" />
        <div className={styles.ptSheet} role="dialog" aria-modal="true" aria-label="Jump to a table">
          <span className={styles.ptGrip} />
          <div className={styles.ptHead}><b>Jump to a table</b>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button></div>
          <div className={styles.ptList}>
            {groups.map(g => (
              <div key={g} className={styles.ptGroup}>
                <span className={styles.ptGroupLab}>{g}</span>
                <div className={styles.ptTiles}>
                  {tables.filter(t => t.g === g).map(t => (
                    <button key={t.id} type="button" aria-pressed={t.id === cur.id} className={t.id === cur.id ? styles.ptOn : ''} onClick={() => pick(t)}>
                      <b>{t.title}</b><small>{t.lead || '—'}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>}
    </div>
  )
}

// The day's best players by Elo: live and finished games move with the box score; games yet to
// start list each team's projected rotation at current Elo
function InActionBoard({ title, rows, shots, onOpen, empty }) {
  return (
    <section className={styles.board}>
      <header><h3>{title}</h3><span>Player rank · Elo</span></header>
      {!rows.length && <p className={styles.bNone}>{empty || 'Nobody yet.'}</p>}
      {rows.map((r, i) => {
        const vs = `${r.home ? 'vs' : '@'} ${tCode(r.opp)}`
        const status = r.state === 'in'
          ? <><span className={styles.liveTxt}><i className={styles.liveDot} />{r.g?.live?.detail || r.x?.detail || 'Live'}</span> · {vs}</>
          : r.state === 'pre' ? `${tipTime(r.x?.tip)} ${vs}` : `Final ${vs}`
        return (
          <button key={r.key} className={styles.bRow} onClick={() => onOpen(r)}>
            <em className={styles.bRank}>{i + 1}</em>
            <Headshot name={r.n} shots={shots} color={tColor(r.t)} />
            <span className={styles.bWho}><b>{shortName(r.n)} <small className={styles.bTeam}>{tCode(r.t)}</small></b><small>{status}</small></span>
            <span className={styles.iaRank}><RankCell p={r.rk} /></span>
            <span className={`${styles.bRight} ${styles.iaElo}`}><b className={styles.bVal}>{r0(r.elo)}</b>
              {r.d != null && <small className={r.d >= 0 ? styles.up : styles.down}>{sgn(r.d)} {r.state === 'in' ? 'live' : 'today'}</small>}</span>
          </button>
        )
      })}
    </section>
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

// ═══════════════════════════════════════════════════════════════════════════
// Game cards: what a card front needs to know about its game, the card modal, and the season binder

// Postseason band from a team's point of view: { level: r1|r2|cf|finals|champ, label: "R2 · G5", champ }
function postBand(sd, g, t) {
  const o = g.teams.find(x => x !== t)
  const byDate = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  // NBA and ABA playoffs ran side by side (1967-76); each league has its own Finals
  const aba = t.includes('@')
  const post = sd.games.filter(x => x.post && x.teams[0].includes('@') === aba).sort(byDate)
  const start = post[0]?.date || g.date
  const days = (a, b) => (new Date(b) - new Date(a)) / 864e5
  const series = (a, b) => post.filter(x => x.teams.includes(a) && x.teams.includes(b))
  // Play-in: a one-game series in the first days of the postseason
  const isPlayIn = (a, b) => { const ss = series(a, b); return ss.length === 1 && days(start, ss[0].date) <= 6 }
  const path = team => {
    const opps = []
    post.forEach(x => { if (!x.teams.includes(team)) return; const oo = x.teams.find(y => y !== team); if (!opps.includes(oo) && !isPlayIn(team, oo)) opps.push(oo) })
    return opps
  }
  if (isPlayIn(t, o)) return { level: 'r1', label: 'Play-In', champ: false }
  const r = path(t).indexOf(o) + 1
  const ss = series(t, o), k = ss.findIndex(x => x.id === g.id) + 1
  const last = post[post.length - 1]
  const finals = !!last && ss.includes(last)
  const rounds = last ? path(last.teams[0]).length : r // the finalists' path sets how many rounds the season had
  const cf = !finals && rounds >= 3 && r === rounds - 1
  // Champions: the title-clinching game, won by this team
  const i = g.teams.indexOf(t)
  const champ = finals && g.id === last.id && g.pts[i] > g.pts[1 - i]
  return {
    level: champ ? 'champ' : finals ? 'finals' : cf ? 'cf' : r >= 2 ? 'r2' : 'r1',
    label: `${finals ? 'Finals' : cf ? 'Conf. Finals' : `R${r}`} · G${k}`, champ,
  }
}

function cardGameInfo(g, t, sd, p) {
  const i = g.teams.indexOf(t), o = g.teams[1 - i]
  return {
    id: g.id, date: g.date, home: g.home == null ? null : g.home === t, oppAbbr: tCode(o), oppLogo: logoUrl(o), oppColor: tColor(o),
    won: g.pts[i] > g.pts[1 - i], score: `${g.pts[i]}–${g.pts[1 - i]}`, ot: g.ot || '',
    band: g.post ? postBand(sd, g, t) : null, honor: p?.potd ? 'potd' : p?.potg ? 'potg' : null, players: g.players,
  }
}

function SeasonCard({ name, g, sd, shots, onProfile, onClose, onBinder, onCareer, info, team, serial }) {
  const row = g.players.find(p => p.n === name)
  if (!row) return null
  return (
    <PlayerCard name={name} row={row} sd={sd} game={info || cardGameInfo(g, row.t, sd, row)}
      team={team || { name: tName(row.t), color: tColor(row.t), abbr: tCode(row.t), logo: logoUrl(row.t) }}
      logo={logoUrl(row.t)} headshot={shots?.[norm(name)]?.headshot}
      career={CAREER.byName[name] || null} peakRank={CAREER.rank[name]} bestRank={CAREER.best[name]}
      onProfile={onProfile} onClose={onClose} onBinder={onBinder} onCareer={onCareer} serial={serial} />
  )
}

// The duel card modal for two players in one game: sides as the season had them, careers from elo.json
function DuelView({ kind, scope, an, bn, g, sd, shots, onClose, onBox }) {
  const a = g.players.find(p => p.n === an), b = g.players.find(p => p.n === bn)
  if (!a || !b) return null
  const { A, B, matchup } = withTeams(sd, () => {
    const mk = p => ({ name: p.n, row: p, color: tColor(p.t), team: tShort(p.t), abbr: tCode(p.t), headshot: shots?.[norm(p.n)]?.headshot })
    const home = g.home || g.teams[1], away = g.teams.find(t => t !== home)
    const pt = t => g.pts?.[g.teams.indexOf(t)]
    return { A: mk(a), B: mk(b), matchup: `${tCode(away)} ${pt(away) ?? ''} @ ${tCode(home)} ${pt(home) ?? ''}`.replace(/\s+/g, ' ').trim() }
  })
  return <DuelModal kind={kind} scope={scope} a={A} b={B} date={g.date} matchup={matchup} sd={sd}
    careerA={CAREER.byName[an]?.elo_history} careerB={CAREER.byName[bn]?.elo_history} onClose={onClose} onBox={onBox} />
}

// ── Binders (components in Binders.jsx) ─────────────────────────────────────
// What the binders need from this module: season loading, team names as they were that season, the card modal
const MERGE_FRANCHISE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const withTeams = (sd, fn) => {
  const prev = TEAMINFO
  if (sd?.teams) TEAMINFO = { ...sd.teams }
  try { return fn() } finally { TEAMINFO = prev }
}
// A team as it looked: from this season's teams (inside withTeams), or from a name and color the data carries
const teamInfo = (code, name, color) => {
  if (!name) return { name: tName(code), color: tColor(code), abbr: tCode(code), logo: logoUrl(code) }
  const prev = TEAMINFO
  TEAMINFO = { ...prev, [code]: { code: code.split('@')[0], name, color } }
  try { return { name, color: color || tColor(code), abbr: tCode(code), logo: logoUrl(code) } } finally { TEAMINFO = prev }
}
// Champions: won the season's last game, and with it a series that needed four wins
function champion(sd, t) {
  if (!t) return false
  const aba = t.includes('@')
  const post = sd.games.filter(g => g.post && g.teams[0].includes('@') === aba).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const last = post[post.length - 1]
  if (!last || !last.teams.includes(t)) return false
  const o = last.teams.find(x => x !== t)
  const wins = post.filter(g => g.teams.includes(t) && g.teams.includes(o)).filter(g => { const i = g.teams.indexOf(t); return g.pts[i] > g.pts[1 - i] }).length
  const i = last.teams.indexOf(t)
  return last.pts[i] > last.pts[1 - i] && wins >= 4
}
const careerSeasons = (name, current) => {
  const set = new Set((CAREER.byName[name]?.elo_history || []).map(e => seasonFor(e[0])))
  if (current) set.add(current)
  return [...set].sort()
}

// What the binders need when they open outside Season Explorer (the Binders page): careers, the
// newest season's label, the rookie lookup and best active ranks
export function primeBinders(players, index, best) {
  const byName = {}, peakRank = {}
  ;(players || []).forEach(p => { byName[p.name] = p })
  ;[...(players || [])].sort((a, b) => b.peak_elo - a.peak_elo).forEach((p, i) => { peakRank[p.name] = i + 1 })
  CAREER = { byName, rank: peakRank, best: best || CAREER.best }
  setFirstGameLookup(n => byName[n]?.team_history?.[0]?.[0] || null)
  NEWEST = index?.seasons[0]?.season || NEWEST
}
// A current franchise's logo, by code (no season context needed)
const currentLogo = code => (ESPN_LOGO[code] ? `https://a.espncdn.com/i/teamlogos/nba/500/${ESPN_LOGO[code]}.png` : null)
export { getJSON as binderJSON, getHeadshots as binderHeadshots, teamInfo as binderTeamInfo, currentLogo as binderLogo }

// ── Special cards: what they need from the seasons and careers ──
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// A player's season with one franchise, for his Season card: every game as a tile, months, best games, the playoff run
function seasonSummary(sd, name, fc) {
  const fr = t => MERGE_FRANCHISE[t] || t
  const gp = [...sd.games].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map(g => [g, g.players.find(p => p.n === name && fr(p.t) === fc)]).filter(x => x[1])
  if (!gp.length) return null
  const t = gp[gp.length - 1][1].t, tm = sd.teams[t] || {}
  const won = (g, p) => g.pts[g.teams.indexOf(p.t)] > g.pts[1 - g.teams.indexOf(p.t)]
  const opp = (g, p) => g.teams[1 - g.teams.indexOf(p.t)]
  const reg = gp.filter(([g]) => !g.post), po = gp.filter(([g]) => g.post)
  const av = (xs, k) => (xs.length ? Math.round((xs.reduce((s, [, p]) => s + (p[k] || 0), 0) / xs.length) * 10) / 10 : null)
  const series = []
  for (const [g, p] of po) {
    const o = opp(g, p), b = postBand(sd, g, p.t)
    if (!series.length || series[series.length - 1].o !== o) series.push({ o, on: sd.teams[o]?.name || o, round: b.label, w: 0, l: 0 })
    series[series.length - 1][won(g, p) ? 'w' : 'l']++
  }
  const lastPo = po[po.length - 1]
  const champ = !!lastPo && postBand(sd, lastPo[0], lastPo[1].t).champ && won(...lastPo)
  const months = [], byM = {}
  for (const [g, p] of reg) { const m = MON3[+g.date.slice(5, 7) - 1]; if (!byM[m]) { byM[m] = []; months.push(m) } byM[m].push([g, p]) }
  const top = [...gp].sort((a, b) => (b[1].gs || 0) - (a[1].gs || 0)).slice(0, 3)
  const path = [gp[0][1].pre, ...gp.map(([, p]) => p.post)]
  const r = x => Math.round(x)
  const tl = top[0]
  return {
    name, s: sd.season, t: fc, tn: tm.name || fc, tc: tm.color, w: tm.w, l: tm.l, gp: gp.length, reg: reg.length,
    pts: av(reg, 'pts'), trb: av(reg, 'trb'), ast: av(reg, 'ast'), gs: av(reg, 'gs'),
    start: r(path[0]), end: r(path[path.length - 1]), peak: r(Math.max(...path)), rank: gp[gp.length - 1][1].lrp, path: path.map(r),
    tiles: gp.map(([g, p]) => ({ id: g.id, d: g.date, o: opp(g, p), w: won(g, p), gs: Math.round((p.gs || 0) * 10) / 10, post: !!g.post })),
    best: { date: tl[0].date, o: opp(...tl), home: tl[0].home == null ? null : tl[0].home === tl[1].t, row: { pts: tl[1].pts, gs: tl[1].gs } },
    top: top.map(([g, p]) => ({ date: g.date, o: opp(g, p), home: g.home == null ? null : g.home === p.t, won: won(g, p), pts: p.pts, trb: p.trb, ast: p.ast, gs: p.gs, post: !!g.post })),
    months: months.map(m => ({ m, gp: byM[m].length, pts: av(byM[m], 'pts'), gs: av(byM[m], 'gs') })),
    po: po.length ? { w: series.reduce((a, x) => a + x.w, 0), l: series.reduce((a, x) => a + x.l, 0), series, champ, pts: av(po, 'pts'), gs: av(po, 'gs') } : null,
    potd: gp.filter(([, p]) => p.potd).length, potg: gp.filter(([, p]) => p.potg || p.potd).length,
  }
}
const summaries = new Map()
export const binderSeasonSummary = (s, name, fc) => {
  const k = `${s}|${fc}|${name}`
  if (!summaries.has(k)) summaries.set(k, loadSeason(s, s === NEWEST).then(sd => seasonSummary(sd, name, fc)))
  return summaries.get(k)
}
// A player's career Elo path up to a date (for a Peak card's climb), and the whole of it
export function binderCareerPath(name, date) {
  const h = CAREER.byName[name]?.elo_history
  if (!h?.length) return null
  const all = [1500, ...h.map(e => e[1])], cut = 1 + h.filter(e => e[0] <= date).length
  const k = Math.max(1, Math.floor(all.length / 140))
  const idx = []; for (let i = 0; i < all.length; i += k) idx.push(i); if (idx[idx.length - 1] !== all.length - 1) idx.push(all.length - 1)
  return { path: [...idx.filter(i => i < cut).map(i => all[i]), all[cut - 1]], pathAll: idx.map(i => all[i]) }
}
export const binderPeaks = () => getJSON('/data/explorer/binders/peaks.json')
export const binderHistory = () => historyReady()

// Opens one binder and keeps a back stack, so closing a binder opened from another returns to it
export function BinderHost({ start, shots, onClose, onProfile }) {
  const [stack, setStack] = useState([start])
  const [, setTick] = useState(0)
  useEffect(() => { historyReady()?.then(() => setTick(1)).catch(() => {}) }, [])
  const top = stack[stack.length - 1]
  const push = b => setStack(st => [...st, b])
  const back = () => (stack.length > 1 ? setStack(st => st.slice(0, -1)) : onClose())
  const collector = useCollector()
  const env = useMemo(() => ({
    collector, owned: collector.me ? collector.owned : null,
    loadSeason: label => loadSeason(label, label === NEWEST), withTeams, teamInfo, champion, careerSeasons, nightScore, getJSON, slug: rivalSlug, dayDuels: seasonDuels,
    franchiseOf: t => MERGE_FRANCHISE[t] || t,
    cardGameInfo, headshot: n => shots?.[norm(n)]?.headshot,
    renderCard: ({ name, g, sd, serial, onClose: close }) => {
      const row = g.players.find(p => p.n === name)
      if (!row) return null
      const { info, team } = withTeams(sd, () => ({ info: cardGameInfo(g, row.t, sd, row), team: teamInfo(row.t) }))
      return <SeasonCard name={name} g={g} sd={sd} shots={shots} info={info} team={team} serial={serial} onProfile={onProfile} onClose={close}
        onCareer={top.kind !== 'career' ? () => { close(); push({ kind: 'career', name }) } : undefined} />
    },
    renderDuel: ({ kind, scope, an, bn, g, sd, onClose: close }) => <DuelView kind={kind} scope={scope} an={an} bn={bn} g={g} sd={sd} shots={shots} onClose={close} />,
  }), [shots, top.kind, collector])
  const openSeason = (name, season) => env.loadSeason(season).then(sd => push({ kind: 'season', name, sd })).catch(() => {})
  const openTeam = (code, season) => env.loadSeason(season).then(sd => push({ kind: 'team', team: code, sd })).catch(() => {})
  if (top.kind === 'season') return <SeasonBinder key={stack.length} name={top.name} sd={top.sd} env={env} onClose={back} onCareer={n => push({ kind: 'career', name: n })} />
  if (top.kind === 'career') return <CareerBinder key={stack.length} name={top.name} env={env} onClose={back} onSeason={openSeason} />
  if (top.kind === 'team') return <TeamBinder key={stack.length} team={top.team} sd={top.sd} env={env} onClose={back} onFranchise={code => push({ kind: 'franchise', code })} />
  if (top.kind === 'franchise') return <FranchiseBinder key={stack.length} code={top.code} env={env} onClose={back} onSeason={openTeam} />
  if (top.kind === 'predict') return <CollectionBinder key={stack.length} env={env} onClose={back} onLeague={set => push({ kind: 'league', set })} startView="predict" onStore={() => push({ kind: 'store' })} />
  if (top.kind === 'store') return <StoreBook key={stack.length} env={env} onClose={back} onMine={() => push({ kind: 'mine', sell: true })} />
  if (top.kind === 'public') return <PublicBinder key={stack.length} name={top.name} env={env} onClose={back} onLeague={set => push({ kind: 'league', set })} />
  if (top.kind === 'mine') return <CollectionBinder key={stack.length} env={env} onClose={back} onLeague={set => push({ kind: 'league', set })} startSell={!!top.sell} onStore={() => push({ kind: 'store' })} />
  if (top.kind === 'league') return <LeagueBinder key={stack.length} set={top.set} env={env} onClose={back} onCareer={n => push({ kind: 'career', name: n })} />
  return null
}
