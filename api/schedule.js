// Returns the current NBA regular-season schedule and today's injury report from ESPN:
// { fetched, season, games: [{ id, day, tip, home, away, done, hs, as }], injuries: { TEAM: [{ name, status, detail, ret }] } }
// Team codes match the site (bbref-style). Cached at the edge for 3h.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } }
const ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO', CHA: 'CHO', BKN: 'BKN' }
const code = a => ABBR[a] || a

const NAMES = {
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN', 'Charlotte Hornets': 'CHO', 'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE', 'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND', 'LA Clippers': 'LAC',
  'Los Angeles Clippers': 'LAC', 'Los Angeles Lakers': 'LAL', 'Memphis Grizzlies': 'MEM', 'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN', 'New Orleans Pelicans': 'NOP', 'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC', 'Orlando Magic': 'ORL', 'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHO',
  'Portland Trail Blazers': 'POR', 'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SAS', 'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS',
}

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '')
const etDay = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

async function getJSON(url) {
  const r = await fetch(url, UA)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

const num = v => (v == null ? null : typeof v === 'object' ? +(v.value ?? v.displayValue) : +v)

function addEvent(e, seen, games) {
  if (!e?.id || seen.has(e.id)) return
  const st = e.seasonType?.type ?? e.seasonType?.id ?? e.season?.type
  if (st != null && +st !== 2) return // regular season only
  const c = e.competitions?.[0]; if (!c) return
  const home = c.competitors?.find(x => x.homeAway === 'home'), away = c.competitors?.find(x => x.homeAway === 'away')
  if (!home?.team?.abbreviation || !away?.team?.abbreviation) return
  seen.add(e.id)
  const done = !!(c.status || e.status)?.type?.completed
  games.push({
    id: e.id, day: etDay(e.date || c.date), tip: e.date || c.date,
    home: code(home.team.abbreviation), away: code(away.team.abbreviation),
    done, hs: done ? num(home.score) : null, as: done ? num(away.score) : null,
  })
}

// Every team's own schedule (30 calls, ESPN's season = the year it ends), with the
// month-by-month scoreboard as a backup source. Errors are reported, not swallowed.
async function schedule(seasonStart, errors) {
  const seen = new Set(), games = []
  try {
    const t = await getJSON(`${BASE}/teams`)
    const teams = t.sports[0].leagues[0].teams.map(x => x.team)
    const pages = await Promise.all(teams.map(team =>
      getJSON(`${BASE}/teams/${team.id}/schedule?season=${seasonStart + 1}&seasontype=2`)
        .catch(e => { errors.push(`team ${team.abbreviation}: ${e.message}`); return { events: [] } })))
    pages.forEach(p => (p.events || []).forEach(e => addEvent(e, seen, games)))
  } catch (e) { errors.push(`teams: ${e.message}`) }
  if (games.length < 1000) {
    for (let i = 0; i < 7; i++) {
      const a = new Date(Date.UTC(seasonStart, 9 + i, 1)), b = new Date(Date.UTC(seasonStart, 10 + i, 0))
      const p = await getJSON(`${BASE}/scoreboard?dates=${ymd(a)}-${ymd(b)}&limit=1000`)
        .catch(e => { errors.push(`scoreboard ${ymd(a)}: ${e.message}`); return { events: [] } })
      ;(p.events || []).forEach(e => addEvent(e, seen, games))
    }
  }
  return games.sort((a, b) => a.tip.localeCompare(b.tip))
}

async function injuries() {
  const d = await getJSON(`${BASE}/injuries`)
  const out = {}
  for (const t of d.injuries || []) {
    const c = NAMES[t.displayName] || (t.team?.abbreviation ? code(t.team.abbreviation) : null)
    if (!c) continue
    out[c] = (t.injuries || []).map(i => ({
      name: i.athlete?.displayName || '',
      status: i.status || i.type?.description || '',
      detail: i.shortComment || i.details?.type || '',
      ret: i.details?.returnDate || null,
      date: i.date || null,
    })).filter(i => i.name)
  }
  return out
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const now = new Date()
  const seasonStart = Number(req.query?.season) || (now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1)
  try {
    const errors = []
    const [games, inj] = await Promise.all([schedule(seasonStart, errors), injuries().catch(e => { errors.push(`injuries: ${e.message}`); return {} })])
    // Cache a full schedule for 3h; an incomplete one only briefly so a fix shows up fast
    res.setHeader('Cache-Control', games.length >= 1000 ? 's-maxage=10800, stale-while-revalidate=86400' : 's-maxage=300')
    res.status(200).json({ fetched: now.toISOString(), season: seasonStart, count: games.length, errors: errors.slice(0, 20), games, injuries: inj })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
