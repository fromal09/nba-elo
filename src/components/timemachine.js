// Time Machine engine: ratings, schedules, seasons, playoffs, odds and box scores for leagues built
// from any team-seasons. Everything is deterministic given the league's seed, so a shared link
// replays the same season.

export const SCALE = 450
export const HOME = 44
export const RATING_SD = 124 // Elo points per standard deviation of team strength

// ── Random numbers ──────────────────────────────────────────────────────────
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const hash = (...parts) => {
  let h = 0x811c9dc5
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}

// ── Team-season catalog ─────────────────────────────────────────────────────
export const tsId = r => `${r.s.slice(0, 4)}${r.t}`
export const yearLabel = s => (s ? `'${s.slice(2, 4)}–${s.slice(5)}` : '')
export const fullName = ts => (ts.s ? `${ts.s} ${ts.name}` : ts.name)
export const nickname = name => {
  const two = ['Trail Blazers', 'Red Sox', 'Royals', 'Supersonics']
  const hit = two.find(x => name.endsWith(x))
  return hit || name.split(' ').slice(-1)[0]
}

export function parseCatalog(d) {
  const C = d.cols
  return d.teams.map(row => {
    const r = {}
    C.forEach((k, i) => { r[k] = row[i] })
    r.id = tsId(r)
    r.n = d.leagues[`${r.s}|${r.lg}`]?.n || 30
    r.ppg = d.leagues[`${r.s}|${r.lg}`]?.ppg || 110
    return r
  })
}

// Small leagues (the BAA and early NBA had 8 to 11 teams) produce extreme z-scores, so they are
// pulled toward average: full weight from 15 teams up
export const shrink = n => Math.min(1, (n - 1) / 14)
export const MODES = { r: 'Results', b: 'Blend', e: 'Player Elo' }
// Era deflation: standing out was easier in a smaller, shallower talent pool. Before the shot clock
// (1954-55) a z-score counts 60%, through the 1967 expansion 75%, through the 1976 ABA merger 88%.
export const eraFactor = s => {
  const y = +String(s || '').slice(0, 4)
  return !y ? 1 : y < 1954 ? 0.6 : y < 1967 ? 0.75 : y < 1976 ? 0.88 : 1
}
export function zFor(r, mode, era = true) {
  const z = mode === 'r' ? r.movz : mode === 'e' ? r.eloz : (r.movz + r.eloz) / 2
  return z * shrink(r.n) * (era ? eraFactor(r.s) : 1)
}
export const ratingFor = (r, mode, era = true) => Math.round(2000 + RATING_SD * zFor(r, mode, era))
export const winP = (ra, rb, homeAdv) => 1 / (1 + 10 ** (-(ra - rb + homeAdv) / SCALE))

// ── League settings and share links ─────────────────────────────────────────
export const SIZES = [8, 16, 24, 30]
export const LENGTHS = [41, 60, 82]
export const DEFAULT = { size: 16, confs: 2, games: 82, po: 4, mode: 'b', home: true, uniq: false, seed: 1, era: true, teams: [] }

export function playoffChoices(lg) {
  const group = lg.confs === 2 ? lg.size / 2 : lg.size
  return [2, 4, 6, 8, 16].filter(k => k <= group && (lg.confs === 2 || k >= 4))
}

// teams: [{ id, conf: 0|1 }] — conference 0 is East, 1 is West (ignored with one table)
export function encodeLeague(lg) {
  const t = lg.teams.map(x => (lg.confs === 2 ? 'EW'[x.conf] : 'A') + x.id).join('.')
  return ['v1', lg.size, lg.confs, lg.games, lg.po, lg.mode, lg.home ? 1 : 0, lg.uniq ? 1 : 0, lg.seed, t, lg.era === false ? 0 : 1].join('~')
}
export function decodeLeague(s) {
  try {
    const p = s.split('~')
    if (p[0] !== 'v1') return null
    const lg = { size: +p[1], confs: +p[2], games: +p[3], po: +p[4], mode: p[5], home: p[6] === '1', uniq: p[7] === '1', seed: +p[8], era: p[10] !== '0' }
    lg.teams = (p[9] || '').split('.').filter(Boolean).map(x => ({ id: x.slice(1), conf: x[0] === 'W' ? 1 : 0 }))
    if (!SIZES.includes(lg.size) || !LENGTHS.includes(lg.games) || !MODES[lg.mode]) return null
    return lg
  } catch { return null }
}

// ── Schedule ────────────────────────────────────────────────────────────────
// Rounds in which every team plays once, built with the circle method. Full round robins come first;
// with two conferences the leftover rounds are conference-only, so rivals meet more often.
function circleRounds(ids) {
  const list = [...ids]
  if (list.length % 2) list.push(null)
  const n = list.length, rounds = []
  for (let r = 0; r < n - 1; r++) {
    const round = []
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i]
      round.push([a, b])
    }
    rounds.push(round)
    list.splice(1, 0, list.pop())
  }
  return rounds
}

export function makeSchedule(lg, seed) {
  const R = rng(hash('schedule', seed))
  const N = lg.teams.length
  const all = [...Array(N).keys()]
  const full = circleRounds(all).map(r => r.filter(([a, b]) => a != null && b != null))
  let intra = null
  if (lg.confs === 2) {
    const c0 = all.filter(i => lg.teams[i].conf === 0), c1 = all.filter(i => lg.teams[i].conf === 1)
    const r0 = circleRounds(c0), r1 = circleRounds(c1)
    const k = Math.max(r0.length, r1.length)
    intra = []
    for (let i = 0; i < k; i++) {
      const pairs = [...(r0[i] || []), ...(r1[i] || [])]
      const real = pairs.filter(([a, b]) => a != null && b != null)
      // With an odd conference, each side has a team sitting out: they play each other
      const byes = pairs.filter(([a, b]) => a == null || b == null).map(([a, b]) => (a == null ? b : a))
      if (byes.length === 2) real.push(byes)
      intra.push(real)
    }
  }
  const rounds = []
  while (rounds.length + full.length <= lg.games) rounds.push(...full)
  const extra = intra || full
  let i = 0
  while (rounds.length < lg.games) { rounds.push(extra[i % extra.length]); i++ }
  // Home and away alternate between each pair's meetings; shuffle the order of rounds
  const met = new Map()
  const games = []
  rounds.forEach((round, d) => round.forEach(([a, b]) => {
    const k = a < b ? a + '|' + b : b + '|' + a
    const m = met.get(k) || 0
    met.set(k, m + 1)
    games.push({ day: d, h: m % 2 ? b : a, a: m % 2 ? a : b })
  }))
  const order = rounds.map((_, d) => d)
  for (let j = order.length - 1; j > 0; j--) { const x = Math.floor(R() * (j + 1)); [order[j], order[x]] = [order[x], order[j]] }
  const dayOf = new Map(order.map((d, j) => [d, j]))
  games.forEach(g => { g.day = dayOf.get(g.day) })
  games.sort((x, y) => x.day - y.day)
  games.forEach((g, j) => { g.i = j })
  return games
}

// ── Season ──────────────────────────────────────────────────────────────────
export function expectedWins(sched, ratings, home) {
  const ex = ratings.map(() => 0)
  for (const g of sched) { const p = winP(ratings[g.h], ratings[g.a], home ? HOME : 0); ex[g.h] += p; ex[g.a] += 1 - p }
  return ex
}

export function playSeason(sched, ratings, home, R) {
  const N = ratings.length, w = new Array(N).fill(0), results = new Array(sched.length)
  for (let j = 0; j < sched.length; j++) {
    const g = sched[j]
    const hw = R() < winP(ratings[g.h], ratings[g.a], home ? HOME : 0)
    results[j] = hw
    w[hw ? g.h : g.a]++
  }
  return { w, results }
}

// Seeds by record, then rating
export function seedOrder(ids, w, ratings) {
  return [...ids].sort((a, b) => w[b] - w[a] || ratings[b] - ratings[a] || a - b)
}

const BEST7 = [true, true, false, false, true, false, true] // 2-2-1-1-1, higher seed at home
function playSeries(hi, lo, ratings, home, R, keep) {
  let x = 0, y = 0
  const games = []
  for (let g = 0; x < 4 && y < 4; g++) {
    const hiHome = BEST7[g]
    const p = winP(ratings[hi], ratings[lo], home ? (hiHome ? HOME : -HOME) : 0)
    const hiWon = R() < p
    if (hiWon) x++; else y++
    if (keep) games.push({ h: hiHome ? hi : lo, a: hiHome ? lo : hi, hw: hiHome === hiWon })
  }
  return { hi, lo, win: x === 4 ? hi : lo, score: [x, y], games }
}

// One bracket from a seeded list: 6 teams give the top two a bye
function bracket(seeds, ratings, home, R, keep, label) {
  const rounds = []
  let alive = [...seeds]
  const seedOf = new Map(seeds.map((t, i) => [t, i]))
  const higher = (a, b) => (seedOf.get(a) < seedOf.get(b) ? [a, b] : [b, a])
  if (alive.length === 6) {
    const s1 = playSeries(...higher(alive[2], alive[5]), ratings, home, R, keep)
    const s2 = playSeries(...higher(alive[3], alive[4]), ratings, home, R, keep)
    rounds.push([s1, s2])
    const winners = [s1.win, s2.win].sort((a, b) => seedOf.get(a) - seedOf.get(b))
    alive = [alive[0], alive[1], winners[0], winners[1]]
    alive = [alive[0], alive[3], alive[1], alive[2]] // 1 plays the lowest seed left
  } else {
    // Standard order: 1v8, 4v5, 2v7, 3v6 ...
    const order = n => (n === 1 ? [0] : order(n / 2).flatMap(i => [i, n - 1 - i]))
    alive = order(alive.length).map(i => alive[i])
  }
  while (alive.length > 1) {
    const round = []
    for (let i = 0; i < alive.length; i += 2) round.push(playSeries(...higher(alive[i], alive[i + 1]), ratings, home, R, keep))
    rounds.push(round)
    alive = round.map(s => s.win)
  }
  rounds.forEach((r, i) => r.forEach(s => { s.label = label; s.round = i; s.of = rounds.length }))
  return { rounds, champ: alive[0] }
}

export function playPlayoffs(lg, w, ratings, R, keep = false) {
  const ids = [...Array(ratings.length).keys()]
  if (lg.confs === 2) {
    const conf = [0, 1].map(c => seedOrder(ids.filter(i => lg.teams[i].conf === c), w, ratings).slice(0, lg.po))
    const b = conf.map((s, c) => bracket(s, ratings, home(lg), R, keep, c === 0 ? 'East' : 'West'))
    const [a, z] = [b[0].champ, b[1].champ]
    const [hi, lo] = w[a] > w[z] || (w[a] === w[z] && ratings[a] >= ratings[z]) ? [a, z] : [z, a]
    const fin = playSeries(hi, lo, ratings, home(lg), R, keep)
    fin.label = 'Finals'
    return { conf: b, finals: fin, champ: fin.win, seeds: conf }
  }
  const seeds = seedOrder(ids, w, ratings).slice(0, lg.po)
  const b = bracket(seeds, ratings, home(lg), R, keep, 'League')
  const last = b.rounds[b.rounds.length - 1][0]
  last.label = 'Finals'
  return { conf: [b], finals: last, champ: b.champ, seeds: [seeds] }
}
const home = lg => lg.home

// One full season with every game kept, for the season view
export function runSeason(lg, sched, ratings) {
  const R = rng(hash('season', lg.seed))
  const { w, results } = playSeason(sched, ratings, lg.home, R)
  const po = playPlayoffs(lg, w, ratings, R, true)
  return { w, results, po }
}

// Odds over many seasons, in chunks so the page stays responsive
export function runOdds(lg, sched, ratings, n, onDone) {
  const N = ratings.length
  const acc = { po: new Array(N).fill(0), fin: new Array(N).fill(0), title: new Array(N).fill(0), seed1: new Array(N).fill(0), wins: new Array(N).fill(0) }
  const R = rng(hash('odds', lg.seed, lg.mode))
  let done = 0, stop = false
  const step = () => {
    if (stop) return
    const end = Math.min(n, done + 500)
    for (; done < end; done++) {
      const { w } = playSeason(sched, ratings, lg.home, R)
      const po = playPlayoffs(lg, w, ratings, R, false)
      po.seeds.forEach(s => { s.forEach(t => { acc.po[t]++ }); acc.seed1[s[0]]++ })
      acc.fin[po.finals.hi]++; acc.fin[po.finals.lo]++
      acc.title[po.champ]++
      for (let i = 0; i < N; i++) acc.wins[i] += w[i]
    }
    if (done < n) setTimeout(step, 0)
    else onDone(Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.map(x => x / n)])))
  }
  setTimeout(step, 0)
  return () => { stop = true }
}

// ── Box scores ──────────────────────────────────────────────────────────────
// A simulated game borrows each team's lines from one of its real games that season: a win for the
// winner, a loss for the loser. Counting stats are scaled to a 110-point league pace so eras mix.
export const PACE = 110
const SCALED = ['fg', 'fga', 'tp', 'tpa', 'ft', 'fta', 'orb', 'drb', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf']

export function teamGamesOf(seasonData, code) {
  const C = seasonData.cols
  const ix = Object.fromEntries(C.map((k, i) => [k, i]))
  const out = []
  for (const g of seasonData.games) {
    if (g.post || !g.teams.includes(code)) continue
    const i = g.teams.indexOf(code), us = g.pts[i], them = g.pts[1 - i]
    const rows = g.rows.filter(r => r[ix.t] === code).map(r => Object.fromEntries(C.map((k, j) => [k, r[j]])))
    out.push({ date: g.date, opp: g.teams[1 - i], home: g.home === code, us, them, won: us > them, rows })
  }
  return out
}

function scaleLine(p, f) {
  const o = { n: p.n, pos: p.pos, st: p.st, mp: p.mp }
  for (const k of SCALED) o[k] = p[k] == null ? null : Math.round(p[k] * f)
  // Early seasons record makes without attempts: keep the attempts unknown
  if (p.fga === 0 && p.fg > 0) o.fga = null
  if (p.fta === 0 && p.ft > 0) o.fta = null
  if (o.fg != null && o.fga != null && o.fg > o.fga) o.fga = o.fg
  if (o.tp != null && o.tpa != null && o.tp > o.tpa) o.tpa = o.tp
  if (o.ft != null && o.fta != null && o.ft > o.fta) o.fta = o.ft
  if (o.trb == null && o.orb != null && o.drb != null) o.trb = o.orb + o.drb
  o.pts = 2 * (o.fg || 0) + (o.tp || 0) + (o.ft || 0)
  o.gs = Math.round((p.gs || 0) * f * 10) / 10
  return o
}

// side: { ts (catalog row), games (teamGamesOf) } for home and away; hw: did the home team win
export function boxScore(key, home, away, hw) {
  const R = rng(hash('box', key))
  const pick = (side, won) => {
    if (!side.pools) {
      const ok = side.games.filter(g => g.rows.length)
      side.pools = { true: ok.filter(g => g.won), false: ok.filter(g => !g.won), all: ok }
    }
    const list = side.pools[won].length ? side.pools[won] : side.pools.all
    return list[Math.floor(R() * list.length)]
  }
  const f = side => PACE / side.ts.ppg
  let best = null
  for (let k = 0; k < 40; k++) {
    const gh = pick(home, hw), ga = pick(away, !hw)
    if (!gh || !ga) return null
    const lh = gh.rows.map(p => scaleLine(p, f(home))), la = ga.rows.map(p => scaleLine(p, f(away)))
    const ph = lh.reduce((s, p) => s + p.pts, 0), pa = la.reduce((s, p) => s + p.pts, 0)
    const margin = hw ? ph - pa : pa - ph
    const cand = { gh, ga, lh, la, ph, pa, margin }
    if (margin > 0) { best = cand; break }
    if (!best || margin > best.margin) best = cand
  }
  // Rare: no pair of real games produced the right winner, so the winner takes it in overtime
  let ot = false
  if (best.margin <= 0) {
    ot = true
    const lines = hw ? best.lh : best.la
    const top = lines.reduce((m, p) => (p.pts > m.pts ? p : m), lines[0])
    const add = 1 - best.margin + Math.floor(R() * 5)
    top.pts += add; top.ft = (top.ft || 0) + add; top.fta = Math.max(top.fta || 0, top.ft); top.gs = Math.round((top.gs + add) * 10) / 10
    if (hw) best.ph += add; else best.pa += add
  }
  // Game Score duels inside the game, and Player of the Game
  const all = [...best.lh.map(p => ({ p, side: 'h' })), ...best.la.map(p => ({ p, side: 'a' }))]
  for (const x of all) {
    x.p.dw = all.filter(y => y !== x && x.p.gs > y.p.gs).length
    x.p.dl = all.filter(y => y !== x && x.p.gs < y.p.gs).length
  }
  const potg = all.reduce((m, x) => (!m || x.p.gs > m.p.gs ? x : m), null)
  if (potg) potg.p.potg = true
  // Starters: the five who played the most minutes (points when minutes weren't kept)
  for (const lines of [best.lh, best.la]) {
    const by = lines.some(p => p.mp != null) ? 'mp' : 'pts'
    ;[...lines].sort((a, b) => (b[by] || 0) - (a[by] || 0)).slice(0, 5).forEach(p => { p.start = true })
  }
  const src = (g, side) => ({ date: g.date, opp: g.opp, home: g.home, us: g.us, them: g.them, f: f(side), synthetic: g.synthetic })
  return {
    home: { lines: best.lh.sort((a, b) => (b.mp || 0) - (a.mp || 0) || b.pts - a.pts), pts: best.ph, src: src(best.gh, home) },
    away: { lines: best.la.sort((a, b) => (b.mp || 0) - (a.mp || 0) || b.pts - a.pts), pts: best.pa, src: src(best.ga, away) },
    ot,
  }
}

// ── Team-season game logs (explorer/tm/<year><code>.json) ───────────────────
export const logFile = ts => `/data/explorer/tm/${ts.s.slice(0, 4)}${ts.t.replace('@', '_')}.json`
export function parseTeamLog(d) {
  const C = d.cols
  const games = d.games.map(([date, opp, home, us, them, rows]) => ({
    date, opp, home: !!home, us, them, won: us > them, synthetic: !!d.synthetic,
    rows: rows.map(r => Object.fromEntries(C.map((k, i) => [k, r[i]]))),
  }))
  // Early box scores fill unrecorded stats with 0: a stat that's 0 for the whole team all season
  // wasn't kept, and makes without attempts mean the attempts weren't kept
  for (const k of ['trb', 'orb', 'drb', 'ast', 'stl', 'blk', 'tov', 'pf', 'mp']) {
    if (games.every(g => g.rows.every(r => !r[k]))) games.forEach(g => g.rows.forEach(r => { r[k] = null }))
  }
  for (const g of games) for (const r of g.rows) {
    if (r.fga === 0 && r.fg > 0) r.fga = null
    if (r.fta === 0 && r.ft > 0) r.fta = null
  }
  return { games, rookies: new Set(d.rk || []) }
}

// ── Season stats ────────────────────────────────────────────────────────────
// Every regular-season game's box score, added up per player. sides[i] = { ts, games, rookies }.
const STAT_KEYS = ['mp', 'pts', 'fg', 'fga', 'tp', 'tpa', 'ft', 'fta', 'orb', 'drb', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf', 'gs']
export function seasonStats(key, sched, results, sides, playoffGames = []) {
  const P = new Map()
  const add = (team, p, won, isPost) => {
    const id = team + '|' + p.n
    let x = P.get(id)
    if (!x) {
      x = { id, n: p.n, team, rookie: sides[team].rookies.has(p.n), gp: 0, st: 0, w: 0, potg: 0, dw: 0, dl: 0, has: {}, cnt: {}, post: { gp: 0, gs: 0, pts: 0, trb: 0, ast: 0 } }
      STAT_KEYS.forEach(k => { x[k] = 0 })
      P.set(id, x)
    }
    if (isPost) { x.post.gp++; x.post.gs += p.gs; x.post.pts += p.pts; x.post.trb += p.trb || 0; x.post.ast += p.ast || 0; return }
    x.gp++; if (p.start) x.st++; if (won) x.w++; if (p.potg) x.potg++
    x.dw += p.dw; x.dl += p.dl
    for (const k of STAT_KEYS) if (p[k] != null) { x[k] += p[k]; x.cnt[k] = (x.cnt[k] || 0) + 1 }
    // Shooting percentages only from games that kept attempts
    if (p.fga != null) x.fgm = (x.fgm || 0) + (p.fg || 0)
    if (p.fta != null) x.ftm = (x.ftm || 0) + (p.ft || 0)
  }
  sched.forEach((g, j) => {
    const b = boxScore(`${key}|r${j}`, sides[g.h], sides[g.a], results[j])
    if (!b) return
    b.home.lines.forEach(p => add(g.h, p, results[j], false))
    b.away.lines.forEach(p => add(g.a, p, !results[j], false))
  })
  for (const pg of playoffGames) {
    const b = boxScore(pg.key, sides[pg.h], sides[pg.a], pg.hw)
    if (!b) continue
    b.home.lines.forEach(p => add(pg.h, p, pg.hw, true))
    b.away.lines.forEach(p => add(pg.a, p, !pg.hw, true))
  }
  // A stat counts when it was kept in at least half his games (early box scores skip some);
  // per-game averages divide by the games that kept it
  const out = [...P.values()]
  for (const x of out) for (const k of STAT_KEYS) x.has[k] = (x.cnt[k] || 0) >= x.gp / 2
  return out
}
export const perGame = (x, k) => (x.cnt[k] ? x[k] / x.cnt[k] : 0)

// ── Awards ──────────────────────────────────────────────────────────────────
// Built from the simulated season: production (Game Score per game), availability and winning.
// Positions aren't in the data, so the All-League teams are the top 15 without positions.
// A player who appears on two team-seasons in one league can win once, for his better season.
export function awards(stats, w, games, champ) {
  const qual = stats.filter(x => x.gp >= games * 0.65)
  const per = (x, k) => (k === 'gs' || x.has[k] ? perGame(x, k) : 0)
  const winPct = t => w[t] / games
  const mvpScore = x => per(x, 'gs') * Math.sqrt(x.gp / games) * (0.6 + winPct(x.team))
  // A player on two team-seasons in the same league gets one spot: his better season
  const top = (list, score, n = 5) => {
    const seen = new Set(), out = []
    for (const x of [...list].sort((a, b) => score(b) - score(a))) {
      if (seen.has(x.n)) continue
      seen.add(x.n); out.push({ x, v: score(x) })
      if (out.length === n) break
    }
    return out
  }
  const hasDef = x => x.has.stl || x.has.blk
  const dpoyScore = x => (hasDef(x) ? per(x, 'stl') * 1.4 + per(x, 'blk') * 1.2 + per(x, 'drb') * 0.3 : per(x, 'trb') * 0.35) * (0.7 + winPct(x.team) * 0.6)
  const mvp = top(qual, mvpScore, 10)
  const total = mvp.reduce((s, r) => s + r.v ** 4, 0)
  mvp.forEach(r => { r.share = r.v ** 4 / total })
  const all = top(qual, mvpScore, 15)
  const leaders = k => top(qual.filter(x => x.has[k]), x => per(x, k), 5)
  const champs = stats.filter(x => x.team === champ && x.post.gp)
  const fmvp = top(champs, x => x.post.gs / x.post.gp * Math.sqrt(x.post.gp), 3)
  return {
    mvp,
    dpoy: top(qual, dpoyScore),
    roy: top(stats.filter(x => x.rookie && x.gp >= games * 0.5), x => per(x, 'gs') * Math.sqrt(x.gp / games)),
    sixth: top(stats.filter(x => x.gp >= games * 0.5 && x.st / x.gp < 0.4), x => per(x, 'gs') * Math.sqrt(x.gp / games)),
    fmvp,
    teams: [all.slice(0, 5), all.slice(5, 10), all.slice(10, 15)],
    leaders: { pts: leaders('pts'), trb: leaders('trb'), ast: leaders('ast'), stl: leaders('stl'), blk: leaders('blk'), gs: leaders('gs') },
  }
}

// ── Draft: leagues built from player-seasons ────────────────────────────────
// draft.json (scripts/build_draft.py): every player-season with era z-scores, and the fit that turns a
// roster's minutes-weighted z-scores into team z-scores on the same scale as real team-seasons.
export const DRAFT_NAMES = ['Aces', 'Bandits', 'Comets', 'Dukes', 'Embers', 'Flyers', 'Giants', 'Hurricanes', 'Knights', 'Lions',
  'Monarchs', 'Pilots', 'Stars', 'Titans', 'Vipers', 'Admirals', 'Barons', 'Cougars', 'Dragons', 'Express', 'Falcons', 'Generals',
  'Jets', 'Mariners', 'Outlaws', 'Panthers', 'Rangers', 'Sentinels', 'Thunderbirds', 'Wolves']
export const DRAFT_COLORS = ['#1a5fa8', '#c8102e', '#00843d', '#6f2da8', '#e07b00', '#008b8b', '#b5121b', '#2d3e50', '#c9a24a', '#5a7d2a',
  '#a0306e', '#3d5a99', '#d14d1f', '#1f7a6e', '#7a1fa2', '#004c97', '#8a6414', '#00695c', '#ad1457', '#37474f', '#ef6c00', '#283593',
  '#558b2f', '#6d4c41', '#0277bd', '#9e9d24', '#c62828', '#4527a0', '#00838f', '#5d4037']
const b36 = n => (n >>> 0).toString(36)
export const playerId = r => `${r.s.slice(0, 4)}${r.t}:${b36(hash(r.n))}`
export function parseDraftPool(d) {
  const C = d.cols
  const rows = d.rows.map(row => {
    const r = Object.fromEntries(C.map((k, i) => [k, row[i]]))
    r.id = playerId(r)
    r.ez0 = r.ez; r.gz0 = r.gz
    r.pos = r.pos || 'SF'
    return r
  })
  const pool = { rows, coef: d.coef, byId: Object.fromEntries(rows.map(r => [r.id, r])) }
  applyEra(pool, true)
  return pool
}
// Value = what he adds to a team rating, from the same fit that rates rosters (in Elo z units)
export function applyEra(pool, on) {
  if (pool.era === on) return pool
  const c = pool.coef, b1 = (c.movz[1] + c.eloz[1]) / 2, b2 = (c.movz[2] + c.eloz[2]) / 2
  for (const r of pool.rows) {
    const f = on ? eraFactor(r.s) : 1
    r.ez = r.ez0 * f; r.gz = r.gz0 * f
    r.value = r.ez + (b2 / b1) * r.gz
  }
  pool.era = on
  return pool
}

// ── Depth charts ────────────────────────────────────────────────────────────
// A position's 48 minutes go to its starter and backups. Playing someone away from his position
// costs value: next door (SG at PG) a little, across the floor (a guard at center) a lot.
export const POS = ['PG', 'SG', 'SF', 'PF', 'C']
const PENALTY = [0, 0.1, 0.35, 0.7, 1.0]
export function slotsFor(R) {
  const s = []
  if (R <= 8) {
    POS.forEach(p => s.push({ label: p, pos: [p], mp: 36, starter: true }))
    ;[['G', ['PG', 'SG']], ['F', ['SF', 'PF']], ['C', ['C', 'PF']]].slice(0, R - 5).forEach(([l, ps]) => s.push({ label: `${l} · bench`, pos: ps, mp: 20 }))
  } else {
    const st = R >= 12 ? 33 : 34, bn = R >= 12 ? 12 : 14
    POS.forEach(p => s.push({ label: p, pos: [p], mp: st, starter: true }))
    POS.forEach(p => s.push({ label: `${p} · 2nd`, pos: [p], mp: bn }))
    for (let i = 10; i < R; i++) s.push({ label: 'Reserve', pos: POS, mp: (240 - 5 * st - 5 * bn) / (R - 10) })
  }
  return s
}
export const penaltyFor = (p, slot) => PENALTY[Math.min(...slot.pos.map(q => Math.abs(POS.indexOf(p.pos) - POS.indexOf(q))))]
const slotValue = (p, slot) => p.value - penaltyFor(p, slot)
// Best depth chart: fill the biggest-minute slots first, then swap any two players while it helps
export function autoDepth(players, R) {
  const slots = slotsFor(R), out = new Array(slots.length).fill(null), left = new Set(players)
  const order = slots.map((s, i) => i).sort((a, b) => slots[b].mp - slots[a].mp)
  for (const i of order) {
    let best = null
    for (const p of left) if (!best || slotValue(p, slots[i]) > slotValue(best, slots[i])) best = p
    if (best) { out[i] = best; left.delete(best) }
  }
  const score = (p, i) => (p ? slots[i].mp * slotValue(p, slots[i]) : 0)
  for (let pass = 0; pass < 4; pass++) {
    let better = false
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      if (!out[i] && !out[j]) continue
      if (score(out[j], i) + score(out[i], j) > score(out[i], i) + score(out[j], j) + 1e-9) { [out[i], out[j]] = [out[j], out[i]]; better = true }
    }
    if (!better) break
  }
  return out
}

// order: player ids in slot order (a manual depth chart), or null for the best one
export function draftTeam(players, coef, i, name, size, order) {
  const R = size || players.length
  const slots = slotsFor(R)
  let depth
  if (order && order.length === slots.length && order.every(Boolean)) {
    const by = Object.fromEntries(players.map(p => [p.id, p]))
    depth = order.map(id => by[id] || null)
    if (depth.some(x => !x)) depth = autoDepth(players, R)
  } else depth = autoDepth(players, R)
  const alloc = depth.map((p, k) => (p ? { p, mp: slots[k].mp, slot: slots[k], pen: penaltyFor(p, slots[k]) } : null)).filter(Boolean)
  const W = alloc.reduce((s, x) => s + x.mp, 0) || 1
  const xe = alloc.reduce((s, x) => s + x.mp * (x.p.ez - x.pen), 0) / W
  const xg = alloc.reduce((s, x) => s + x.mp * (x.p.gz - x.pen), 0) / W
  const f = c => c[0] + c[1] * xe + c[2] * xg
  return {
    id: `D${i}`, s: '', t: `D${i}`, name: name || DRAFT_NAMES[i % DRAFT_NAMES.length], color: DRAFT_COLORS[i % DRAFT_COLORS.length],
    movz: players.length ? f(coef.movz) : -3, eloz: players.length ? f(coef.eloz) : -3, n: 30, ppg: PACE, lg: 'NBA',
    w: 0, l: 0, champ: 0, mov: 0, live: 0, draft: players, alloc, depth, slots,
  }
}
// The computer drafts for need: the pick that raises its team rating most, among the best available
export function cpuPick(available, team, coef, R, size, rnd) {
  const base = draftTeam(team, coef, 0, '', size)
  const cur = (base.movz + base.eloz) / 2
  const scored = available.slice(0, 40).map(p => {
    const t = draftTeam([...team, p], coef, 0, '', size)
    return { p, gain: (t.movz + t.eloz) / 2 - cur }
  }).sort((a, b) => b.gain - a.gain)
  const top = scored.slice(0, 3), w = [0.6, 0.27, 0.13]
  let u = rnd() * w.slice(0, top.length).reduce((a, b) => a + b, 0)
  for (let k = 0; k < top.length; k++) { u -= w[k]; if (u <= 0) return top[k].p }
  return top[0]?.p
}

// A drafted team's games: each player's line is one of his own games that season (pace-adjusted to
// 110 points), scaled to the minutes this roster gives him. logs: Map "season|team" -> parsed log
export function draftSide(ts, logs, leaguePpg) {
  const per = ts.alloc.map(({ p, mp }) => {
    const log = logs.get(p.s + '|' + p.t)
    const lines = log ? log.games.flatMap(g => g.rows.filter(r => r.n === p.n)) : []
    return { p, mp, lines, f: PACE / (leaguePpg(p) || PACE) }
  }).filter(x => x.lines.length)
  const games = []
  for (let k = 0; k < 82; k++) {
    const rows = per.map(({ p, mp, lines, f }, j) => {
      const src = lines[(k * 7 + j * 3 + hash(p.n) % 13) % lines.length]
      const m = src.mp || p.mp || 30
      const k2 = (mp / m) * f
      const o = { n: p.n, mp: Math.round(mp) }
      for (const key of SCALED) o[key] = src[key] == null ? null : src[key] * k2
      o.pts = (src.pts || 0) * k2
      o.gs = (src.gs || 0) * k2
      return o
    })
    games.push({ date: '', opp: '', home: k % 2 === 0, won: k % 2 === 0, synthetic: true, draft: true, rows })
  }
  // One ball: ten stars can't each take their usual shots. Scale scoring and playmaking so the team
  // averages a normal 112 points, and rebounds to a normal 44, keeping game-to-game variation.
  const mean = key => games.reduce((s, g) => s + g.rows.reduce((t, r) => t + (r[key] || 0), 0), 0) / games.length
  const fPts = mean('pts') ? 112 / mean('pts') : 1, fReb = mean('trb') ? 44 / mean('trb') : 1
  for (const g of games) {
    for (const r of g.rows) {
      for (const key of ['fg', 'fga', 'tp', 'tpa', 'ft', 'fta', 'ast', 'tov', 'pts', 'gs']) if (r[key] != null) r[key] *= fPts
      for (const key of ['orb', 'drb', 'trb']) if (r[key] != null) r[key] *= fReb
    }
    g.us = g.rows.reduce((s, r) => s + r.pts, 0); g.them = g.us + (g.won ? -1 : 1)
  }
  // already pace-adjusted, so the box score's pace factor is 1
  return { ts: { ...ts, ppg: PACE }, games, rookies: new Set() }
}

// Snake order: team index for overall pick k
export const snakeTeam = (k, N) => { const r = Math.floor(k / N), i = k % N; return r % 2 ? N - 1 - i : i }

// Share links: settings plus every team's picks
export function encodeDraft(dl) {
  // A team with a set depth chart stores its picks in slot order, marked by a leading '!'
  const teams = dl.picks.map((ps, i) => (dl.depth?.[i] ? '!' + dl.depth[i].join(',') : ps.join(','))).join('.')
  return ['d1', dl.size, dl.roster, dl.confs, dl.games, dl.po, dl.mode, dl.home ? 1 : 0, dl.seed, dl.you, teams, dl.era === false ? 0 : 1].join('~')
}
export function decodeDraft(s) {
  try {
    const p = s.split('~')
    if (p[0] !== 'd1') return null
    const dl = { size: +p[1], roster: +p[2], confs: +p[3], games: +p[4], po: +p[5], mode: p[6], home: p[7] === '1', seed: +p[8], you: +p[9], era: p[11] !== '0' }
    const parts = (p[10] || '').split('.')
    dl.picks = parts.map(x => (x ? x.replace(/^!/, '').split(',') : []))
    dl.depth = parts.map(x => (x.startsWith('!') ? x.slice(1).split(',') : null))
    while (dl.picks.length < dl.size) { dl.picks.push([]); dl.depth.push(null) }
    return dl
  } catch { return null }
}
