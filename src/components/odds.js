// Playoff and title odds for the current season: plays out the rest of the schedule many times with
// the game forecaster's win chances, then the play-in and four best-of-seven rounds.
//
// Uncertainty: each simulated season shifts every team's rating by a random amount (normal, SD
// RATING_SD scaled by how much of the season is left), so a team that is better or worse than its
// rating shows up in the spread, not only game-to-game luck.
// Ties in the standings are broken at random (the NBA's tiebreakers aren't modeled).

const RATING_SD = 60

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

// input:
//   teams:  { code: { conf: 'E'|'W', w, l } }
//   games:  [{ home, away, d }]  d = home rating − away rating + home court, Elo points (unplayed games)
//   known:  [{ home, away, homeWon }]  finals not yet in the season data
//   rating: { code: rating } for the playoffs
//   scale, home: the win-chance fit (scale in Elo points, home-court edge)
//   left:   share of the season still to play (0..1)
// returns per team: mean wins, 10th/90th percentile wins, win histogram, seed distribution, and the
// chance of each outcome; plus, for each team's next game, playoff and title odds with a win or a loss
export function simulateOdds({ teams, games, known, rating, scale, home, left, n = 10000, seed = 1 }, onDone) {
  const codes = Object.keys(teams), N = codes.length, ix = Object.fromEntries(codes.map((c, i) => [c, i]))
  const conf = codes.map(c => teams[c].conf)
  const base = codes.map(c => teams[c].w)
  for (const k of known) base[ix[k.homeWon ? k.home : k.away]]++
  const G = games.filter(g => g.home in ix && g.away in ix).map(g => ({ h: ix[g.home], a: ix[g.away], d: g.d, day: g.day }))
  const rat = codes.map(c => rating[c] ?? 1500)
  // Season length per team: games already played, finals not yet in the data, and games left
  const total = codes.map(c => teams[c].w + teams[c].l)
  for (const k of known) { total[ix[k.home]]++; total[ix[k.away]]++ }
  for (const g of G) { total[g.h]++; total[g.a]++ }
  const sd = RATING_SD * Math.sqrt(Math.max(0.05, left))
  // Each team's next game, for "what's at stake"
  const next = new Array(N).fill(-1)
  G.forEach((g, j) => { if (next[g.h] < 0) next[g.h] = j; if (next[g.a] < 0) next[g.a] = j })

  const zeros = () => new Array(N).fill(0)
  const acc = { wins: zeros(), po: zeros(), top6: zeros(), pi: zeros(), r2: zeros(), cf: zeros(), fin: zeros(), title: zeros() }
  const seeds = codes.map(() => new Array(15).fill(0))
  const winsAll = codes.map(() => [])
  const stake = codes.map(() => ({ wN: 0, wPo: 0, wTi: 0, lN: 0, lPo: 0, lTi: 0 }))
  const R = rng(seed)
  const P = (d) => 1 / (1 + 10 ** (-d / scale))
  let done = 0, stopped = false

  const one = () => {
    const shift = codes.map(() => gauss(R) * sd)
    const w = base.slice()
    const nextWon = new Array(N).fill(null)
    for (let j = 0; j < G.length; j++) {
      const g = G[j]
      const hw = R() < P(g.d + shift[g.h] - shift[g.a])
      w[hw ? g.h : g.a]++
      if (next[g.h] === j) nextWon[g.h] = hw
      if (next[g.a] === j) nextWon[g.a] = !hw
    }
    const r = rat.map((x, i) => x + shift[i])
    const tb = codes.map(() => R())
    const series = (a, b) => {
      // a has home court
      let x = 0, y = 0
      for (let k = 0; x < 4 && y < 4; k++) {
        const aHome = k === 0 || k === 1 || k === 4 || k === 6
        if (R() < P(r[a] - r[b] + (aHome ? home : -home))) x++; else y++
      }
      return x === 4 ? a : b
    }
    const single = (a, b) => (R() < P(r[a] - r[b] + home) ? a : b)
    const champs = [], made = new Array(N).fill(false)
    let champ = -1
    for (const c of ['E', 'W']) {
      const ids = codes.map((_, i) => i).filter(i => conf[i] === c).sort((a, b) => w[b] - w[a] || tb[b] - tb[a])
      ids.forEach((t, k) => { seeds[t][k]++ })
      ids.slice(0, 6).forEach(t => { acc.top6[t]++ })
      ids.slice(6, 10).forEach(t => { acc.pi[t]++ })
      if (ids.length < 10) continue
      const s7 = single(ids[6], ids[7]), l78 = s7 === ids[6] ? ids[7] : ids[6]
      const s8 = single(l78, single(ids[8], ids[9]))
      const sl = [...ids.slice(0, 6), s7, s8]
      sl.forEach(t => { acc.po[t]++; made[t] = true })
      const r1 = [series(sl[0], sl[7]), series(sl[3], sl[4]), series(sl[1], sl[6]), series(sl[2], sl[5])]
      r1.forEach(t => { acc.r2[t]++ })
      const order = t => sl.indexOf(t)
      const ser = (a, b) => (order(a) < order(b) ? series(a, b) : series(b, a))
      const cf = [ser(r1[0], r1[1]), ser(r1[2], r1[3])]
      cf.forEach(t => { acc.cf[t]++ })
      const f = ser(cf[0], cf[1])
      acc.fin[f]++
      champs.push(f)
    }
    if (champs.length === 2) {
      const [a, b] = champs
      champ = w[a] > w[b] || (w[a] === w[b] && tb[a] > tb[b]) ? series(a, b) : series(b, a)
      acc.title[champ]++
    }
    for (let i = 0; i < N; i++) {
      acc.wins[i] += w[i]; winsAll[i].push(w[i])
      if (nextWon[i] === true) { stake[i].wN++; if (made[i]) stake[i].wPo++; if (champ === i) stake[i].wTi++ }
      else if (nextWon[i] === false) { stake[i].lN++; if (made[i]) stake[i].lPo++; if (champ === i) stake[i].lTi++ }
    }
  }

  const step = () => {
    if (stopped) return
    const end = Math.min(n, done + 400)
    for (; done < end; done++) one()
    if (done < n) { setTimeout(step, 0); return }
    const out = {}
    codes.forEach((c, i) => {
      const ws = winsAll[i].sort((a, b) => a - b)
      const hist = {}
      ws.forEach(x => { hist[x] = (hist[x] || 0) + 1 })
      const st = stake[i]
      out[c] = {
        games: total[i], w: acc.wins[i] / n, w10: ws[Math.floor(n * 0.1)], w90: ws[Math.floor(n * 0.9)],
        po: acc.po[i] / n, top6: acc.top6[i] / n, pi: acc.pi[i] / n, r2: acc.r2[i] / n, cf: acc.cf[i] / n,
        fin: acc.fin[i] / n, title: acc.title[i] / n,
        seeds: seeds[i].map(x => x / n), hist,
        next: next[i] >= 0 && st.wN && st.lN ? {
          game: G[next[i]], home: G[next[i]].h === i, opp: codes[G[next[i]].h === i ? G[next[i]].a : G[next[i]].h],
          pWin: st.wN / n, poW: st.wPo / st.wN, poL: st.lPo / st.lN, tiW: st.wTi / st.wN, tiL: st.lTi / st.lN,
        } : null,
      }
    })
    onDone({ n, teams: out })
  }
  setTimeout(step, 0)
  return () => { stopped = true }
}
