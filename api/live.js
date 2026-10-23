// Live scoreboard and box scores for one day, from ESPN.
//   GET /api/live?date=YYYY-MM-DD   (default: today in US Eastern time)
//   GET /api/live?date=...&debug=1  adds ESPN's raw stat labels and keys per game, for checking the parser
// Returns { fetched, date, live, games: [{ id, tip, state, detail, period, clock, post, ot, home, away, hs, as, box }], errors }
//   state: 'pre' | 'in' | 'post'; box: { TEAM: [player] } once the game has started, else null
//   player: { name, espn, pos, st, mp, pts, fg, fga, tp, tpa, ft, fta, orb, drb, trb, ast, stl, blk, tov, pf, pm }
// Team codes match the site (bbref-style). Cached at the edge for 15s while a game is live.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } }
const ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO', CHA: 'CHO', BKN: 'BKN', BRK: 'BKN' }
const code = a => ABBR[a] || a
const SEASON_TYPES = new Set([2, 3, 5]) // regular season, playoffs, play-in; preseason and All-Star are skipped

async function getJSON(url) {
  const r = await fetch(url, UA)
  if (!r.ok) throw new Error(`${r.status} ${url.replace(BASE, '')}`)
  return r.json()
}

const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null }

// ESPN stat columns, matched by key first and label second so column order doesn't matter
const FIELDS = {
  mp: ['minutes', 'MIN'],
  pts: ['points', 'PTS'],
  fg: ['fieldGoalsMade-fieldGoalsAttempted', 'FG'],
  tp: ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3PT'],
  ft: ['freeThrowsMade-freeThrowsAttempted', 'FT'],
  trb: ['rebounds', 'REB'],
  ast: ['assists', 'AST'],
  tov: ['turnovers', 'TO'],
  stl: ['steals', 'STL'],
  blk: ['blocks', 'BLK'],
  orb: ['offensiveRebounds', 'OREB'],
  drb: ['defensiveRebounds', 'DREB'],
  pf: ['fouls', 'PF'],
  pm: ['plusMinus', '+/-'],
}

function parseTeam(group) {
  const st = group.statistics?.[0]
  if (!st) return []
  const keys = st.keys || [], labels = st.labels || st.names || []
  const col = {}
  for (const [f, [k, l]] of Object.entries(FIELDS)) {
    let i = keys.indexOf(k)
    if (i < 0) i = labels.indexOf(l)
    col[f] = i
  }
  const get = (s, f) => (col[f] >= 0 ? s[col[f]] : null)
  const pair = v => { const m = /^(\d+)-(\d+)$/.exec(v || ''); return m ? [+m[1], +m[2]] : [null, null] }
  const out = []
  for (const a of st.athletes || []) {
    const s = a.stats || []
    if (a.didNotPlay || !s.length) continue
    const mpRaw = String(get(s, 'mp') ?? '')
    const mp = mpRaw.includes(':') ? +mpRaw.split(':')[0] + +mpRaw.split(':')[1] / 60 : int(mpRaw)
    const [fg, fga] = pair(get(s, 'fg')), [tp, tpa] = pair(get(s, 'tp')), [ft, fta] = pair(get(s, 'ft'))
    const p = {
      name: a.athlete?.displayName || a.athlete?.fullName || '', espn: a.athlete?.id || null,
      pos: a.athlete?.position?.abbreviation || '', st: !!a.starter,
      mp: mp == null ? null : Math.round(mp), pts: int(get(s, 'pts')), fg, fga, tp, tpa, ft, fta,
      orb: int(get(s, 'orb')), drb: int(get(s, 'drb')), trb: int(get(s, 'trb')), ast: int(get(s, 'ast')),
      stl: int(get(s, 'stl')), blk: int(get(s, 'blk')), tov: int(get(s, 'tov')), pf: int(get(s, 'pf')),
      pm: int(String(get(s, 'pm') ?? '').replace('+', '')),
    }
    // Checked in but never got in: no minutes and an empty line
    const any = ['pts', 'fga', 'fta', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf'].some(k => p[k])
    if (!p.name || (!p.mp && !any)) continue
    out.push(p)
  }
  return out
}

function parseEvent(e) {
  const c = e.competitions?.[0]; if (!c) return null
  const type = +(e.season?.type ?? c.type?.id ?? 2)
  if (!SEASON_TYPES.has(type)) return null
  const home = c.competitors?.find(x => x.homeAway === 'home'), away = c.competitors?.find(x => x.homeAway === 'away')
  if (!home?.team?.abbreviation || !away?.team?.abbreviation) return null
  const status = c.status || e.status || {}
  const state = status.type?.state || 'pre'
  const detail = status.type?.shortDetail || status.type?.detail || ''
  const ot = /OT/.test(detail) ? (detail.match(/(\d*OT)/)?.[1] || 'OT') : ''
  return {
    id: e.id, tip: e.date || c.date, state, detail, period: status.period || 0, clock: status.displayClock || '',
    post: type !== 2, ot,
    home: code(home.team.abbreviation), away: code(away.team.abbreviation),
    hs: state === 'pre' ? null : int(home.score), as: state === 'pre' ? null : int(away.score),
    box: null,
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.date || '') ? req.query.date : etToday()
  const debug = !!req.query?.debug
  const errors = []
  try {
    const sb = await getJSON(`${BASE}/scoreboard?dates=${date.replace(/-/g, '')}&limit=100`)
    const games = (sb.events || []).map(parseEvent).filter(Boolean)
    await Promise.all(games.map(async g => {
      if (g.state === 'pre') return
      try {
        const s = await getJSON(`${BASE}/summary?event=${g.id}`)
        g.box = {}
        for (const grp of s.boxscore?.players || []) {
          const t = code(grp.team?.abbreviation)
          if (t) g.box[t] = parseTeam(grp)
          if (debug) (g.debug = g.debug || {})[t] = { keys: grp.statistics?.[0]?.keys, labels: grp.statistics?.[0]?.labels || grp.statistics?.[0]?.names, sample: grp.statistics?.[0]?.athletes?.[0] }
        }
        if (!Object.keys(g.box).length) g.box = null
      } catch (e) { errors.push(`game ${g.id}: ${e.message}`) }
    }))
    games.sort((a, b) => (a.tip || '').localeCompare(b.tip || ''))
    const live = games.some(g => g.state === 'in')
    const pending = games.some(g => g.state === 'pre')
    res.setHeader('Cache-Control', live ? 's-maxage=15, stale-while-revalidate=30'
      : pending ? 's-maxage=60, stale-while-revalidate=120' : 's-maxage=600, stale-while-revalidate=3600')
    res.status(200).json({ fetched: new Date().toISOString(), date, live, games, errors })
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=10')
    res.status(502).json({ fetched: new Date().toISOString(), date, live: false, games: [], errors: [e.message] })
  }
}
