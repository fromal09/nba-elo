// The site's Elo forecast, run on the server for predictions: the same model the Scoreboard shows
// (src/components/predict.js), from the same inputs: player Elo, rotation minutes, ESPN rosters and
// injuries, games played, and the scoring model.
//   - The underdog in a pick is the team this forecast gives under 50% when the game tips off.
//   - A game's featured matchup is one player from each side, drawn at random from those rated 2,000+ who are in the
//     rotation and not on the injury report (the side's best healthy player when nobody qualifies).
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
// The same draw every time the slate refreshes before it's published: seeded by the game and the team
const seed = str => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296 }
export const FEATURED_MIN = 2000
function featured(side, gameId) {
  const pool = side.rows.filter(r => !r.out && !r.status && r.rated !== false && (r.mp ?? r.base ?? 0) > 0 && r.elo >= FEATURED_MIN)
    .sort((a, b) => a.name.localeCompare(b.name))
  return pool.length ? pool[Math.floor(seed(`${gameId}|${side.team}`) * pool.length)] : best(side)
}

/**
 * For each game ({ id, day, home, away }): { pHome, duel: { a, b, ae, be } }.
 * duel is the featured matchup: duel.a from the away side, duel.b from the home side (see featured()).
 * keep: { gameId: duel } matchups already published. A published matchup never changes to other players: if either of
 * its players is ruled out before tipoff, it's void ({ ...duel, void: 'injury', out: [names] }) and can't be picked.
 */
export async function forecast(origin, games, keep = {}) {
  if (!games.length) return {}
  const { f, proj } = await model(origin, games[0].day)
  const out = {}
  for (const g of games) {
    try {
      const fg = f.game(g.home, g.away, g.day)
      const pHome = Math.round((proj ? proj.win(proj.margin(fg)) : fg.pHome) * 1000) / 1000
      const a = featured(fg.away, g.id), b = featured(fg.home, g.id)
      const k = keep[g.id]
      let duel = a && b ? { a: a.name, b: b.name, ae: Math.round(a.elo), be: Math.round(b.elo) } : null
      if (k?.void) duel = k
      else if (k?.a && k?.b) {
        const outs = [[k.a, fg.away], [k.b, fg.home]].filter(([n, side]) => side.rows.some(r => r.name === n && r.out)).map(([n]) => n)
        duel = outs.length ? { ...k, void: 'injury', out: outs } : k
      }
      out[g.id] = { pHome, duel }
    } catch { /* a team the forecaster doesn't know: no forecast for this game */ }
  }
  return out
}

// Tonight's rosters for these teams: { team: [{ name, elo, mp, out, status, proj }] }. With games ({ home, away }),
// each healthy player carries his projected line (proj: { mp, pts, trb, ast, stl, blk, tp, gs }), the box score the
// Scoreboard's preview shows, scaled to his team's projected score
export async function rosters(origin, teams, day, games = []) {
  const { f, proj } = await model(origin, day)
  const lines = {}
  for (const g of games) {
    try {
      const fg = f.game(g.home, g.away, day), sc = proj?.score ? proj.score({ ...fg, margin: proj.margin(fg) }) : null
      for (const [side, pts] of [[fg.home, sc?.[0]], [fg.away, sc?.[1]]]) {
        const b = f.box(side, pts)
        for (const r of b?.rows || []) lines[side.team + '|' + r.name] = { mp: r.mp, pts: r.pts, trb: r.trb, ast: r.ast, stl: r.stl, blk: r.blk, tp: r.tp, gs: r.gs }
      }
    } catch { /* no forecast for this game */ }
  }
  const out = {}
  for (const t of teams) {
    try { out[t] = f.team(t, day).rows.map(r => ({ name: r.name, elo: Math.round(r.elo), mp: Math.round(r.mp || 0), out: !!r.out, status: r.status || null, proj: lines[t + '|' + r.name] || null })) } catch { out[t] = [] }
  }
  return out
}
