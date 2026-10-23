// Live Elo: turns /api/live box scores into Season Explorer games, scored exactly like build_elo.py.
// Every player who played duels every other player in the game on Game Score; pre-game Elo and
// games played come from elo.json (the ratings as of the last pipeline run). Results are provisional
// until the pipeline processes the game.
import { norm } from './predict.js'

const kFactor = n => (n < 20 ? 40 : n < 100 ? 50 : 28)
const r1 = v => Math.round(v * 10) / 10

// Hollinger Game Score, the modern formula build_elo.py uses for 1974 onward
export const gameScore = p => (p.pts || 0) + 0.4 * (p.fg || 0) - 0.7 * (p.fga || 0) - 0.4 * ((p.fta || 0) - (p.ft || 0))
  + 0.7 * (p.orb || 0) + 0.3 * (p.drb || 0) + (p.stl || 0) + 0.7 * (p.ast || 0) + 0.7 * (p.blk || 0)
  - 0.4 * (p.pf || 0) - (p.tov || 0)

// ESPN name -> site name, for players ESPN lists under a different first name (normalized keys)
const ALIASES = {
  'nicolas claxton': 'nic claxton', 'alexandre sarr': 'alex sarr', 'moe wagner': 'moritz wagner',
  'herb jones': 'herbert jones', 'carlton carrington': 'bub carrington', 'kenyon martin': 'kj martin',
  'jeenathan williams': 'nate williams', 'nahshon hyland': 'bones hyland',
}

// Lookup tables built once from elo.json players
export function buildRatings(players) {
  const byNorm = {}, byLast = {}
  const sorted = [...(players || [])].sort((a, b) => (a.last_played || '').localeCompare(b.last_played || ''))
  for (const p of sorted) {
    const k = norm(p.name)
    byNorm[k] = p // the most recently active player wins a shared name
    const last = k.split(' ').slice(-1)[0]
    ;(byLast[last] = byLast[last] || []).push(p)
  }
  const pool = new Map(players.filter(p => p.is_fpr_eligible).map(p => [p.name, p.current_elo]))
  const asof = sorted.length ? sorted[sorted.length - 1].last_played : null
  return { byNorm, byLast, pool, asof }
}

// Exact name, then an alias, then a unique last-name match on the same team (first initial if needed)
function match(R, name, team) {
  let k = norm(name)
  if (ALIASES[k]) k = ALIASES[k]
  if (R.byNorm[k]) return R.byNorm[k]
  const parts = k.split(' '), last = parts.slice(-1)[0]
  const same = (R.byLast[last] || []).filter(p => p.team === team)
  if (same.length === 1) return same[0]
  const init = same.filter(p => norm(p.name)[0] === parts[0]?.[0])
  return init.length === 1 ? init[0] : null
}

const lineup = (ps, key) => {
  const m = ps.reduce((s, p) => s + (p.mp || 0), 0)
  return m ? ps.reduce((s, p) => s + p[key] * (p.mp || 0), 0) / m : ps.reduce((s, p) => s + p[key], 0) / ps.length
}

// One /api/live game with a box score -> a Season Explorer game (players in explorer row format)
export function scoreGame(g, R, date, winChance, sy) {
  const teams = [g.away, g.home].sort()
  const rows = []
  for (const t of teams) {
    for (const p of g.box?.[t] || []) {
      const m = match(R, p.name, t)
      rows.push({
        n: m?.name || p.name, t, st: p.st, pos: p.pos, mp: p.mp, pts: p.pts, fg: p.fg, fga: p.fga, tp: p.tp, tpa: p.tpa,
        ft: p.ft, fta: p.fta, orb: p.orb, drb: p.drb, trb: p.trb, ast: p.ast, stl: p.stl, blk: p.blk, tov: p.tov,
        pf: p.pf, pm: p.pm, gs: r1(gameScore(p)), pre: m ? m.current_elo : 1500, gp: m ? m.games_played : 0,
        unrated: !m, espnName: p.name,
      })
    }
  }
  if (teams.some(t => !rows.some(r => r.t === t))) return null
  const N = rows.length
  for (const a of rows) {
    let d = 0, xw = 0, w = 0
    for (const b of rows) {
      if (a === b) continue
      const exp = 1 / (1 + 10 ** ((b.pre - a.pre) / 620))
      const act = a.gs > b.gs ? 1 : a.gs === b.gs ? 0.5 : 0
      const mf = Math.max(0.5, Math.min(2, Math.log1p(Math.abs(a.gs - b.gs)) / Math.log1p(20)))
      d += (kFactor(a.gp) / Math.sqrt(N)) * mf * (act - exp)
      xw += exp; w += act
    }
    a.post = r1(a.pre + d); a.pre = r1(a.pre); a.xw = Math.round(xw * 100) / 100; a.w = w
  }
  const pts = { [g.home]: g.hs ?? 0, [g.away]: g.as ?? 0 }
  const elo = {}
  for (const t of teams) {
    const ps = rows.filter(r => r.t === t)
    elo[t] = { pre: lineup(ps, 'pre'), post: lineup(ps, 'post') }
  }
  const [a, b] = teams
  const wpA = winChance(sy, elo[a].pre, elo[b].pre, g.home === a)
  return {
    id: `live-${g.id}`, espnId: g.id, date, tip: g.tip, teams, pts: [pts[a], pts[b]], home: g.home, ot: g.ot, post: g.post,
    live: { state: g.state, detail: g.detail }, players: rows, elo, wp: { [a]: wpA, [b]: 1 - wpA },
  }
}

// League ranks before and after, among FPR-eligible players. Everyone who played today counts
// after the game (the Top 100 rule makes a player eligible once he plays for his team).
export function assignRanks(games, R) {
  const before = [...R.pool.values()].sort((x, y) => x - y)
  const after = new Map(R.pool)
  games.forEach(g => g.players.forEach(p => after.set(p.n, p.post)))
  const afterVals = [...after.values()].sort((x, y) => x - y)
  const above = (vals, v) => { let lo = 0, hi = vals.length; while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] <= v) lo = m + 1; else hi = m } return vals.length - lo }
  games.forEach(g => g.players.forEach(p => { p.lr = 1 + above(before, p.pre); p.lrp = 1 + above(afterVals, p.post) }))
}

// Day leaderboards from any mix of pipeline and live games
export function dayBoards(games) {
  const all = games.flatMap(g => g.players.map(p => ({ p, g })))
  const d = x => x.p.post - x.p.pre
  const performers = [...all].sort((x, y) => y.p.gs - x.p.gs).slice(0, 15)
  const risers = [...all].sort((x, y) => d(y) - d(x)).slice(0, 10)
  const fallers = [...all].sort((x, y) => d(x) - d(y)).slice(0, 10)
  const gameUpsets = games.map(g => {
    const [a, b] = g.teams, lead = g.pts[0] > g.pts[1] ? a : g.pts[1] > g.pts[0] ? b : null
    return lead && g.wp[lead] < 0.5 ? { g, team: lead, opp: lead === a ? b : a, chance: g.wp[lead] } : null
  }).filter(Boolean).sort((x, y) => x.chance - y.chance)
  const duels = []
  for (const g of games) {
    for (const a of g.players) for (const b of g.players) {
      // Same rule as the box score's Giant Killer: real minutes on both sides, a real line from the winner
      if ((a.mp || 0) >= 12 && (b.mp || 0) >= 12 && a.gs >= 10 && a.gs > b.gs && b.pre > a.pre)
        duels.push({ g, a, b, chance: 1 / (1 + 10 ** ((b.pre - a.pre) / 620)) })
    }
  }
  // One entry per winner (his least likely win), so a single big night doesn't fill the list
  duels.sort((x, y) => x.chance - y.chance)
  const seen = new Set(), duelUpsets = []
  for (const u of duels) {
    const k = u.g.id + '|' + u.a.n
    if (seen.has(k)) continue
    seen.add(k); duelUpsets.push(u)
    if (duelUpsets.length === 10) break
  }
  // Movement inside the league's top 100 (ranks among FPR-qualified players, before vs after the day's games)
  const ranked = all.filter(x => x.p.lr != null && x.p.lrp != null && !x.p.unrated)
  const mv = x => x.p.lr - x.p.lrp
  const top100Risers = ranked.filter(x => x.p.lrp <= 100 && mv(x) > 0).sort((x, y) => mv(y) - mv(x) || x.p.lrp - y.p.lrp).slice(0, 10)
  const top100Fallers = ranked.filter(x => x.p.lr <= 100 && mv(x) < 0).sort((x, y) => mv(x) - mv(y) || x.p.lr - y.p.lr).slice(0, 10)
  return { performers, risers, fallers, top100Risers, top100Fallers, gameUpsets, duelUpsets }
}
