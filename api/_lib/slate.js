// A day's NBA games for predictions, from ESPN's scoreboard, cached in Postgres (pred_games).
// Each game keeps its tipoff, status, final score and the site's Elo forecast (line = { pHome, duel }: the home
// win chance and the top player matchup). The forecast refreshes until tipoff and then freezes, so "upset" and
// "matchup" mean what it said when picks locked. Finished games are graded here, for every collector at once.
import { forecast } from './forecast.js'
const BASE = process.env.ESPN_BASE || 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO', CHA: 'CHO', BKN: 'BKN' }
const code = a => ABBR[a] || a
export const NBA = new Set(['ATL', 'BOS', 'BKN', 'CHO', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN',
  'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHO', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'])
const etDay = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const n = v => (v == null || v === "" ? null : typeof v === "object" ? n(v.value ?? v.displayValue) : isFinite(+v) ? +v : null)

function parse(e, day) {
  const c = e.competitions?.[0]; if (!c) return null
  const st = e.season?.type ?? e.seasonType?.type
  if (st != null && ![2, 3, 5].includes(+st)) return null // regular season, playoffs, play-in
  const H = c.competitors?.find(x => x.homeAway === 'home'), A = c.competitors?.find(x => x.homeAway === 'away')
  const home = code(H?.team?.abbreviation), away = code(A?.team?.abbreviation)
  if (!NBA.has(home) || !NBA.has(away)) return null // the All-Star Game and exhibitions
  const tip = e.date || c.date
  if (etDay(tip) !== day) return null
  const s = (c.status || e.status)?.type || {}
  const state = /postpon|cancel|suspend/i.test(s.name || s.description || '') ? 'off' : s.state || 'pre'
  const hs = n(H.score), as = n(A.score)
  const final = state === 'post' && !!s.completed
  return {
    id: String(e.id), day, tip, home, away, state: final ? 'post' : state === 'post' ? 'in' : state,
    detail: s.shortDetail || s.detail || '', hs: state === 'pre' ? null : hs, as: state === 'pre' ? null : as,
    winner: final && hs != null && as != null && hs !== as ? (hs > as ? home : away) : null,
  }
}

const memo = new Map() // day -> { at, games }
async function fetchDay(day) {
  const r = await fetch(`${BASE}/scoreboard?dates=${day.replace(/-/g, '')}&limit=100`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10e3) })
  if (!r.ok) throw new Error(`scoreboard ${r.status}`)
  const d = await r.json()
  return (d.events || []).map(e => parse(e, day)).filter(Boolean).sort((a, b) => a.tip.localeCompare(b.tip) || a.id.localeCompare(b.id))
}

/**
 * The day's games, refreshed from ESPN when stale (a minute while any game is unfinished, else hours),
 * written to pred_games. Falls back to the stored slate if ESPN can't be reached.
 */
export async function slate(sql, day, { fresh = false, origin = null } = {}) {
  const m = memo.get(day)
  const maxAge = fresh ? 20e3 : m && m.games.length && m.games.every(g => g.state === 'post' || g.state === 'off') ? 6 * 36e5 : 60e3
  if (m && Date.now() - m.at < maxAge) return m.games
  let games = null
  try { games = await fetchDay(day) } catch (e) { console.error('slate', day, e.message) }
  if (games) {
    // The Elo forecast for games that haven't tipped off (finished games keep the one they had)
    const ahead = games.filter(g => Date.parse(g.tip) > Date.now())
    const fc = origin && ahead.length ? await forecast(origin, ahead).catch(e => { console.error('forecast', e.message); return {} }) : {}
    for (const g of games) g.line = fc[g.id] ? { ...fc[g.id], src: 'elo' } : null
    for (const g of games) {
      // The forecast updates until tipoff, then stays as it was when picks locked
      await sql`insert into pred_games (id, day, tip, home, away, state, detail, hs, as_, winner, line, updated_at)
        values (${g.id}, ${day}, ${g.tip}, ${g.home}, ${g.away}, ${g.state}, ${g.detail}, ${g.hs}, ${g.as}, ${g.winner}, ${g.line ? sql.json(g.line) : null}, now())
        on conflict (id) do update set day = excluded.day, tip = excluded.tip, state = excluded.state, detail = excluded.detail, hs = excluded.hs, as_ = excluded.as_,
          winner = excluded.winner, updated_at = now(),
          line = case when pred_games.tip > now() and excluded.line is not null then excluded.line else coalesce(pred_games.line, excluded.line) end`
    }
    const ids = games.map(g => g.id)
    // A game ESPN no longer lists on this day (moved): take it off the slate
    await sql`update pred_games set state = 'off' where day = ${day} and not (id = any(${ids}))`
    await gradeDay(sql, day)
  }
  const rows = await sql`select * from pred_games where day = ${day} order by tip, id`
  const out = rows.map(r => ({ id: r.id, day, tip: new Date(r.tip).toISOString(), home: r.home, away: r.away, state: r.state, detail: r.detail,
    hs: r.hs, as: r.as_, winner: r.winner, line: r.line }))
  if (games) memo.set(day, { at: Date.now(), games: out })
  return out
}

// Grade every pick on the day's finished games, for every collector at once (Coins are credited per collector in settle)
export async function gradeDay(sql, day) {
  await sql`update predictions p set result = case when p.pick = g.winner then 'win' else 'loss' end,
      chance = case when g.line->>'pHome' is null then null when p.pick = g.home then (g.line->>'pHome')::real else 1 - (g.line->>'pHome')::real end
    from pred_games g where g.id = p.game_id and g.day = ${day} and g.state = 'post' and g.winner is not null and p.result is null`
  await sql`update predictions p set result = 'void' from pred_games g where g.id = p.game_id and g.day = ${day} and g.state = 'off' and p.result is null`
}

// A team's forecast win chance, when the game has one: below 50% is an underdog
export const dogChance = (g, team) => (g.line?.pHome == null ? null : team === g.home ? g.line.pHome : 1 - g.line.pHome)
