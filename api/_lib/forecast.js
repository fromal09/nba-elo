// The site's Elo forecast, run on the server for predictions: the same model the Scoreboard shows
// (src/components/predict.js), from the same inputs: player Elo, rotation minutes, ESPN rosters and
// injuries, games played, and the scoring model.
//   - The underdog in a pick is the team this forecast gives under 50% when the game tips off.
//   - A game's top player matchup is each side's highest-Elo healthy player, as on the Scoreboard card.
//   - Lineups draw on the same rosters (who plays for whom tonight, who's out).
import { buildForecaster, winChance, makeProjector } from '../../src/components/predict.js'

let cache = null // { at, origin, inputs }
async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10e3) })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

// The site's own APIs (schedule, rosters) live on the site even when data comes from elsewhere
const API = process.env.API_ORIGIN || null
async function inputs(origin) {
  const api = API || origin
  if (cache && cache.origin === origin && Date.now() - cache.at < 10 * 60e3) return cache.inputs
  const [players, rotation, scoring, sched, shots] = await Promise.all([
    getJSON(`${origin}/data/players.json`).then(d => d.players || d),
    getJSON(`${origin}/data/explorer/rotation.json`).catch(() => ({ players: {} })),
    getJSON(`${origin}/data/explorer/scoring.json`).catch(() => null),
    getJSON(`${api}/api/schedule`),
    getJSON(`${api}/api/headshots`).then(d => d.players || {}).catch(() => ({})),
  ])
  const x = { players, rotation, scoring, sched, roster: Object.fromEntries(Object.entries(shots).filter(([, v]) => v.team)) }
  cache = { at: Date.now(), origin, inputs: x }
  return x
}

const seasonOf = day => +day.slice(0, 4) - (+day.slice(5, 7) < 9 ? 1 : 0)
async function model(origin, day) {
  const { players, rotation, scoring, sched, roster } = await inputs(origin)
  const gamesPlayed = {}
  for (const g of sched.games || []) if (g.done) for (const t of [g.home, g.away]) gamesPlayed[t] = (gamesPlayed[t] || 0) + 1
  const sy = Number(sched.season) || seasonOf(day)
  const f = buildForecaster({ players, roster, rotation, injuries: sched.injuries, fetched: sched.fetched, gamesPlayed, winChance, sy })
  return { f, proj: makeProjector(scoring, sched) }
}
const best = side => [...side.rows].filter(r => !r.out).sort((a, b) => b.elo - a.elo)[0]

/**
 * For each game ({ id, day, home, away }): { pHome, duel: { a, b, ae, be } }, as the Scoreboard shows it.
 * duel.a is the away side's top player, duel.b the home side's.
 */
export async function forecast(origin, games) {
  if (!games.length) return {}
  const { f, proj } = await model(origin, games[0].day)
  const out = {}
  for (const g of games) {
    try {
      const fg = f.game(g.home, g.away, g.day)
      const pHome = Math.round((proj ? proj.win(proj.margin(fg)) : fg.pHome) * 1000) / 1000
      const a = best(fg.away), b = best(fg.home)
      out[g.id] = { pHome, duel: a && b ? { a: a.name, b: b.name, ae: Math.round(a.elo), be: Math.round(b.elo) } : null }
    } catch { /* a team the forecaster doesn't know: no forecast for this game */ }
  }
  return out
}

// Tonight's rosters for these teams: { team: [{ name, elo, mp, out, status }] }
export async function rosters(origin, teams, day) {
  const { f } = await model(origin, day)
  const out = {}
  for (const t of teams) {
    try { out[t] = f.team(t, day).rows.map(r => ({ name: r.name, elo: Math.round(r.elo), mp: Math.round(r.mp || 0), out: !!r.out, status: r.status || null })) } catch { out[t] = [] }
  }
  return out
}
