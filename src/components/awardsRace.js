// Award races for the current season: each player's season so far plus a projection for the rest,
// played out many times. The award formulas match the Time Machine's (production, availability,
// winning), with the NBA's 65-game minimum for MVP, DPOY, MIP and All-NBA.
//
// Projection per player: per-game production = (this season's totals + PRIOR_GAMES × last season's
// per-game line) / (games this season + PRIOR_GAMES), so last season dominates early and fades as
// games come in. Each simulated season adds a talent shift (how much better or worse he really is)
// and game-to-game noise. Games left = his team's remaining games he isn't listed out for, each
// played with his availability rate from last season.

const PRIOR_GAMES = 20
const ROOKIE_PRIOR = { gs: 6, pts: 8, trb: 3.5, ast: 1.5, stl: 0.6, blk: 0.4, drb: 2.7, mp: 18 }
const ROOKIE_PRIOR_GAMES = 6
const TALENT_SD = 2.2   // Game Score points per game, full season to go
const GAME_SD = 7.5     // one game's Game Score spread
const MIN_GAMES = 65

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = R => { let u = 0; while (!u) u = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R()) }
const KEYS = ['gs', 'pts', 'trb', 'ast', 'stl', 'blk', 'drb', 'mp']

// pool: [{ n, t, cur: {gp, gs, pts, ...sums}, prev: {gp, gs, pts, ... per game} | null, rookie,
//          left (team games he's not listed out for), avail (0..1), bench (outside the top 5 in minutes) }]
// teamWins: { t: [win counts by simulation...] } or a function (t, R) → wins; G: season length
export function raceAwards({ pool, teamWins, G, n = 2000, seed = 7 }) {
  const R = rng(seed)
  const P = pool.map(p => {
    const prior = p.prev || ROOKIE_PRIOR, k = p.prev ? PRIOR_GAMES : ROOKIE_PRIOR_GAMES
    const mu = {}
    for (const key of KEYS) mu[key] = ((p.cur[key] || 0) + k * (prior[key] || 0)) / (p.cur.gp + k)
    return { ...p, mu }
  })
  const win = Object.fromEntries(['mvp', 'dpoy', 'roy', 'sixth', 'mip'].map(a => [a, new Map()]))
  const allNba = new Map()
  const proj = new Map(P.map(p => [p, { gp: 0, gs: 0, pts: 0, trb: 0, ast: 0, stl: 0, blk: 0, mvpTop5: 0 }]))
  const scale = G / 82

  for (let s = 0; s < n; s++) {
    const tw = {}
    const winsOf = t => (tw[t] ??= typeof teamWins === 'function' ? teamWins(t, R) : teamWins[t] ? teamWins[t][Math.floor(R() * teamWins[t].length)] : G / 2)
    const rows = []
    for (const p of P) {
      // games still to play: each available game played with probability avail
      const m = p.left * p.avail, sd = Math.sqrt(p.left * p.avail * (1 - p.avail))
      const rem = Math.max(0, Math.min(p.left, Math.round(m + gauss(R) * sd)))
      const gp = p.cur.gp + rem
      if (!gp) continue
      const frac = rem / G
      const shift = gauss(R) * TALENT_SD * Math.sqrt(frac)
      const noise = rem ? gauss(R) * GAME_SD / Math.sqrt(rem) : 0
      const ratio = p.mu.gs > 0 ? (p.mu.gs + shift + noise) / p.mu.gs : 1
      const pg = key => {
        const remv = rem * p.mu[key] * (key === 'gs' ? 1 : Math.max(0.3, ratio))
        return ((p.cur[key] || 0) + remv) / gp
      }
      const gs = ((p.cur.gs || 0) + rem * (p.mu.gs + shift + noise)) / gp
      const x = { p, gp, gs, pts: pg('pts'), trb: pg('trb'), ast: pg('ast'), stl: pg('stl'), blk: pg('blk'), drb: pg('drb') }
      const wp = winsOf(p.t) / G
      x.mvp = gs * Math.sqrt(gp / G) * (0.6 + wp)
      x.dpoy = (x.stl * 1.4 + x.blk * 1.2 + x.drb * 0.3) * (0.7 + wp * 0.6)
      x.value = gs * Math.sqrt(gp / G)
      rows.push(x)
      const pr = proj.get(p)
      pr.gp += gp; pr.gs += gs; pr.pts += x.pts; pr.trb += x.trb; pr.ast += x.ast; pr.stl += x.stl; pr.blk += x.blk
    }
    const eligible = rows.filter(x => x.gp >= MIN_GAMES * scale)
    const best = (list, key) => list.reduce((b, x) => (!b || x[key] > b[key] ? x : b), null)
    const tally = (a, x) => { if (x) win[a].set(x.p, (win[a].get(x.p) || 0) + 1) }
    tally('mvp', best(eligible, 'mvp'))
    tally('dpoy', best(eligible, 'dpoy'))
    tally('roy', best(rows.filter(x => x.p.rookie), 'value'))
    tally('sixth', best(rows.filter(x => x.p.bench && x.gp >= G * 0.5), 'value'))
    const mip = eligible.filter(x => x.p.prev && x.p.prev.gp >= 30 * scale && !x.p.rookie).map(x => ({ ...x, mipv: x.gs - x.p.prev.gs }))
    tally('mip', best(mip, 'mipv'))
    const top = [...eligible].sort((a, b) => b.mvp - a.mvp)
    top.slice(0, 15).forEach(x => { allNba.set(x.p, (allNba.get(x.p) || 0) + 1) })
    top.slice(0, 5).forEach(x => { proj.get(x.p).mvpTop5++ })
  }

  const line = p => {
    const pr = proj.get(p)
    return { gp: pr.gp / n, gs: pr.gs / n, pts: pr.pts / n, trb: pr.trb / n, ast: pr.ast / n, stl: pr.stl / n, blk: pr.blk / n }
  }
  const board = (map, k = 8) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([p, c]) => ({ p, chance: c / n, line: line(p) }))
  return {
    n,
    mvp: board(win.mvp, 10), dpoy: board(win.dpoy), roy: board(win.roy), sixth: board(win.sixth), mip: board(win.mip),
    allNba: board(allNba, 20),
  }
}
