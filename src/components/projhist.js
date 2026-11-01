// Record projection history: each team's projected final wins after every game of a season, with the 10th–90th
// percentile range, rebuilt in the browser from the season file (no stored history needed, so it works for any season).
//
// After each day of games, every team's forecast rating is rebuilt the way the game forecaster builds it
// (predict.js): players' Elo after their latest game, minutes from their last 10 appearances, the players seen in
// the team's last 10 games, and w × rotation Elo + (1 − w) × top-8 Elo with w = n / (n + 4). Each remaining game's
// win chance comes from those ratings (the scoring model's margin this season, the Elo win chance for past
// seasons). Projected wins = wins so far + the sum of those chances. The range is a normal approximation of the
// odds simulation: game-to-game luck (Σ p(1 − p)) plus a random shift in each team's strength (2.5 points of margin
// per game, scaled by the share of the season left), the same spread the Playoff odds simulation uses.
// The injury report isn't known for past dates, so a player out for weeks still counts until he drops out of
// the team's last 10 games.

const SHIFT_SD = 2.5, SIGMA = 13.7, Z90 = 1.2816
const phi = z => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
// Inverse normal CDF (Acklam), for the slope of a win chance that comes from the Elo formula
export function invPhi(p) {
  p = Math.min(1 - 1e-9, Math.max(1e-9, p))
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924]
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857]
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878]
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]
  const q = Math.min(p, 1 - p)
  let x
  if (q < 0.02425) { const r = Math.sqrt(-2 * Math.log(q)); x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1) }
  else { const r = q - 0.5, s = r * r; x = (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1) }
  return p < 0.5 ? x : -x
}

/**
 * sd: a loaded season (SeasonExplorer loadSeason). schedule: [{ day, home, away }] every regular-season game, played
 * or not (the current season's schedule); omit it for a finished season and the games played are the schedule.
 * pHome(home, away, Rh, Ra, netH, netA): the home side's win chance from the two forecast ratings and each team's net
 * scoring margin so far (points a game, shrunk toward 0 with a 10-game prior, as the scoring model does).
 * Returns { team: [{ g, day, w, w10, w90, wins, losses, res, opp, home, pts }] }, g = games played (0 = opening night).
 */
export function projHistory({ sd, schedule, pHome }) {
  const games = sd.games.filter(g => !g.post).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (!games.length) return {}
  const sched = schedule?.length ? schedule.map(g => ({ day: g.day, home: g.home, away: g.away }))
    : games.map(g => { const home = g.home || g.teams[1]; return { day: g.date, home, away: g.teams.find(t => t !== home) } })
  const teams = [...new Set(sched.flatMap(g => [g.home, g.away]))]
  const byTeam = Object.fromEntries(teams.map(t => [t, sched.filter(g => g.home === t || g.away === t).sort((a, b) => (a.day < b.day ? -1 : 1))]))
  const total = sched.length

  const P = {}                                   // player -> { elo, team, mins: [] }
  const T = Object.fromEntries(teams.map(t => [t, { w: 0, l: 0, days: [], pm: 0 }]))
  const net = t => (T[t] ? T[t].pm / (T[t].w + T[t].l + 10) : 0)
  const out = Object.fromEntries(teams.map(t => [t, []]))

  // Opening night: each team's first-game lineup at its pre-game Elo
  const first = {}
  for (const g of games) for (const t of g.teams) if (!first[t]) first[t] = g.players.filter(p => p.t === t)
  const rating = t => {
    const recent = new Set(T[t].days.slice(-10))
    let ps
    if (!T[t].days.length) ps = (first[t] || []).map(p => ({ elo: p.pre, mp: p.mp || 12 }))
    else ps = Object.values(P).filter(p => p.team === t && recent.has(p.last))
      .map(p => ({ elo: p.elo, mp: p.mins.reduce((a, x) => a + x, 0) / p.mins.length }))
    if (!ps.length) return 1500
    const mins = ps.reduce((a, p) => a + p.mp, 0) || 1
    const rot = ps.reduce((a, p) => a + p.mp * p.elo, 0) / mins
    const top = [...ps].sort((a, b) => b.elo - a.elo).slice(0, 8)
    const raw = top.reduce((a, p) => a + p.elo, 0) / top.length
    const n = T[t].w + T[t].l, w = n / (n + 4)
    return w * rot + (1 - w) * raw
  }
  const project = (t, day, R, played) => {
    const rest = byTeam[t].filter(g => g.day > day)
    let mean = 0, varLuck = 0, slope = 0, slopeOpp = 0
    for (const g of rest) {
      const home = g.home === t
      const ph = pHome(g.home, g.away, R[g.home] ?? 1500, R[g.away] ?? 1500, net(g.home), net(g.away))
      const p = home ? ph : 1 - ph
      const dp = phi(invPhi(p)) / SIGMA       // win chance per point of strength
      mean += p; varLuck += p * (1 - p); slope += dp; slopeOpp += dp * dp
    }
    const left = Math.max(0.05, (total - played) / total)
    const s = SHIFT_SD * Math.sqrt(left)
    const sd_ = Math.sqrt(varLuck + slope * slope * s * s + slopeOpp * s * s)
    const w = T[t].w + mean
    return { w, w10: Math.max(T[t].w, w - Z90 * sd_), w90: Math.min(T[t].w + rest.length, w + Z90 * sd_) }
  }

  // Opening night point for every team
  const R0 = Object.fromEntries(teams.map(t => [t, rating(t)]))
  for (const t of teams) out[t].push({ g: 0, day: null, ...project(t, '0000', R0, 0), wins: 0, losses: 0 })

  const days = [...new Set(games.map(g => g.date))]
  let played = 0
  for (const day of days) {
    const today = games.filter(g => g.date === day)
    const done = []
    for (const g of today) {
      const [a, b] = g.teams
      const aw = g.pts[0] > g.pts[1]
      for (const [t, won, i] of [[a, aw, 0], [b, !aw, 1]]) {
        if (!T[t]) continue
        won ? T[t].w++ : T[t].l++
        T[t].pm += g.pts[i] - g.pts[1 - i]
        T[t].days.push(day)
        done.push({ t, won, opp: g.teams[1 - i], home: g.home == null ? null : g.home === t, pts: [g.pts[i], g.pts[1 - i]] })
      }
      for (const p of g.players) {
        if (!p.mp) continue
        const x = P[p.n] ??= { elo: p.post, team: p.t, mins: [], last: day }
        x.elo = p.post; x.team = p.t; x.last = day
        x.mins.push(p.mp); if (x.mins.length > 10) x.mins.shift()
      }
      played++
    }
    const R = Object.fromEntries(teams.map(t => [t, rating(t)]))
    for (const d of done) {
      out[d.t].push({ g: T[d.t].w + T[d.t].l, day, ...project(d.t, day, R, played), wins: T[d.t].w, losses: T[d.t].l,
        res: d.won ? 'W' : 'L', opp: d.opp, home: d.home, pts: d.pts })
    }
  }
  return out
}

/** The biggest one-game jump and drop, and the best and worst stretch of `span` games, in projected wins. */
export function projMoves(h, span = 8) {
  if (!h || h.length < 3) return []
  const steps = h.slice(1).map((x, i) => ({ x, d: x.w - h[i].w }))
  const up = steps.reduce((m, s) => (s.d > m.d ? s : m)), dn = steps.reduce((m, s) => (s.d < m.d ? s : m))
  const runs = []
  for (let i = 0; i + span < h.length; i++) runs.push({ a: h[i], b: h[i + span], d: h[i + span].w - h[i].w })
  const best = runs.length ? runs.reduce((m, r) => (r.d > m.d ? r : m)) : null
  const worst = runs.length ? runs.reduce((m, r) => (r.d < m.d ? r : m)) : null
  const out = []
  if (best && best.d > 0.5) out.push({ kind: 'run', ...best })
  if (worst && worst.d < -0.5) out.push({ kind: 'run', ...worst })
  if (up.d > 0.3) out.push({ kind: 'game', x: up.x, d: up.d })
  if (dn.d < -0.3) out.push({ kind: 'game', x: dn.x, d: dn.d })
  return out.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3)
}

