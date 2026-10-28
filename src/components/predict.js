// Game forecasts for the current season.
//
// Team rating = blend of two Elo views, weighted by games played this season (n):
//   Rotation Elo: current player Elo weighted by projected minutes. Each player's minutes are his
//                 average over his last 10 appearances, filled top-down until the team's 240 minutes
//                 are used. Injured players are removed; if that leaves the team short of 240, the gap
//                 is spread across the healthy players in proportion to their minutes (max 42 each).
//   Roster Elo:   plain average of the top 8 healthy players' current Elo.
//   rating = w * Rotation + (1 - w) * Roster, with w = n / (n + 4)
// Win chance uses the same team-level fit as the box scores (since 2020: scale 450, home court 44).

// Accents, punctuation, hyphens and suffixes (Jr., III) dropped; matches api/headshots.js keys
export const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s*\(\d{4}\)$/, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

const OUT_STATUS = /^(out|doubtful|suspen)/i
const INJURY_WINDOW_DAYS = 10 // an "Out" with no return date applies to games in the next 10 days
const MAX_MIN = 42
const ROOKIE_MIN = 8
export const blendWeight = n => n / (n + 4)
const addDays = (day, k) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }

export function buildForecaster({ players, roster, rotation, injuries, fetched, gamesPlayed, winChance, sy }) {
  const eloBy = {}
  players.forEach(p => { eloBy[norm(p.name)] = p })
  const rotBy = {}
  Object.entries(rotation?.players || {}).forEach(([n, r]) => { rotBy[norm(n)] = { ...r, name: n } })
  const reportDay = (fetched || new Date().toISOString()).slice(0, 10)

  // Roster per team: ESPN rosters when available, else players whose latest game was for the team
  const teams = {}
  const add = (t, key, name) => { (teams[t] = teams[t] || new Map()).set(key, name) }
  const rosterEntries = Object.entries(roster || {})
  if (rosterEntries.length) rosterEntries.forEach(([k, v]) => v.team && add(v.team, k, eloBy[k]?.name || rotBy[k]?.name || k))
  else Object.entries(rotBy).forEach(([k, r]) => add(r.team, k, r.name))

  const inj = {}
  Object.entries(injuries || {}).forEach(([t, list]) => list.forEach(i => { inj[t + '|' + norm(i.name)] = i }))
  const isOut = (i, day) => {
    if (!i || !OUT_STATUS.test(i.status)) return false
    if (i.ret) return day < i.ret.slice(0, 10)
    return day <= addDays(reportDay, INJURY_WINDOW_DAYS)
  }

  const cache = new Map()
  function team(t, day) {
    const key = t + '|' + day
    if (cache.has(key)) return cache.get(key)
    const rows = [...(teams[t] || new Map())].map(([k, name]) => {
      const p = eloBy[k], r = rotBy[k], i = inj[t + '|' + k]
      return {
        key: k, name: p?.name || name, elo: p?.current_elo ?? 1500, rated: !!p,
        base: r?.mp ?? ROOKIE_MIN, status: i?.status || null, detail: i?.detail || '', out: isOut(i, day),
      }
    })
    const healthy = rows.filter(r => !r.out && r.base > 0)
    // Fill 240 minutes. A full roster keeps each player's recent minutes, top of the rotation first,
    // until 240 is used. Injuries leave a gap, which is spread across the healthy players (max 42 each).
    healthy.sort((a, b) => b.base - a.base)
    healthy.forEach(r => { r.mp = 0 })
    const total = healthy.reduce((s, r) => s + r.base, 0)
    if (total >= 240) {
      let left = 240
      healthy.forEach(r => { r.mp = Math.min(r.base, MAX_MIN, left); left -= r.mp })
    } else {
      let pool = 240, open = [...healthy]
      for (let k = 0; k < 8 && open.length && pool > 0.01; k++) {
        const tot = open.reduce((s, r) => s + r.base, 0), next = []
        let used = 0
        open.forEach(r => {
          const add = (r.base / tot) * pool, room = MAX_MIN - r.mp
          if (add >= room) { r.mp = MAX_MIN; used += room } else { r.mp += add; used += add; next.push(r) }
        })
        pool -= used; open = next
      }
    }
    rows.forEach(r => { if (r.out) r.mp = 0 })
    const mins = healthy.reduce((s, r) => s + r.mp, 0) || 1
    const rot = healthy.reduce((s, r) => s + r.mp * r.elo, 0) / mins
    const top8 = [...healthy].sort((a, b) => b.elo - a.elo).slice(0, 8)
    const raw = top8.length ? top8.reduce((s, r) => s + r.elo, 0) / top8.length : 1500
    const n = gamesPlayed[t] || 0, w = blendWeight(n)
    const out = { team: t, day, rows: rows.sort((a, b) => b.mp - a.mp || b.elo - a.elo), rot, raw, n, w, rating: w * rot + (1 - w) * raw }
    cache.set(key, out)
    return out
  }

  function game(home, away, day) {
    const h = team(home, day), a = team(away, day)
    const p = winChance(sy, h.rating, a.rating, true)
    return { home: h, away: a, pHome: p, pAway: 1 - p }
  }

  return { team, game, reportDay }
}

// ── Team-level Elo win chance ───────────────────────────────────────────────
// The duel formula refit on 53,674 games with team ratings and home court.
// Fit by era: pre-1970 ratings separate teams less, and home court has shrunk since 2020
// (about 70 Elo points through 2019, about 44 since; the 2024-26 forecast backtest agrees).
export const WP = sy => (sy < 1970 ? { scale: 1540, home: 420 } : sy < 2020 ? { scale: 400, home: 72 } : { scale: 450, home: 44 })
export function winChance(sy, eloA, eloB, homeA) {
  const { scale, home } = WP(sy)
  return 1 / (1 + 10 ** (-(eloA - eloB + (homeA == null ? 0 : homeA ? home : -home)) / scale))
}

// ── Projected scores ────────────────────────────────────────────────────────
// From scoring.json (scripts/build_scoring.py), fitted and backtested on every game since 2020-21:
//   margin = home court + Elo gap of the forecast ratings + gap in team net scoring + back-to-backs
//   total  = each team's offense + the other's defense − twice the league average, less for back-to-backs
// Team offense/defense weight recent games more, with last season as a 10-game prior.
export function makeProjector(sc, sched) {
  if (!sc || !sc.teams) return null
  const [c0, cElo, cNet, cB2bH, cB2bA] = sc.margin
  const lg = sc.league, sigma = sc.sigma || 13.7
  const played = new Set((sched?.games || []).map(g => [g.home + '|' + g.day, g.away + '|' + g.day]).flat())
  const b2b = (t, day) => (day && played.has(t + '|' + addDays(day, -1)) ? 1 : 0)
  const rate = t => sc.teams[t] || [lg, lg]
  const net = t => rate(t)[0] - rate(t)[1]
  const margin = fg => c0 + cElo * (fg.home.rating - fg.away.rating) + cNet * (net(fg.home.team) - net(fg.away.team))
    + cB2bH * b2b(fg.home.team, fg.home.day) + cB2bA * b2b(fg.away.team, fg.home.day)
  const score = fg => {
    if (!fg) return null
    const h = fg.home.team, v = fg.away.team, day = fg.home.day
    const [oh, dh] = rate(h), [ov, dv] = rate(v)
    const total = oh + dv + ov + dh - 2 * lg + sc.total_b2b * (b2b(h, day) + b2b(v, day))
    const m = fg.margin ?? margin(fg)
    return untie(total / 2 + m / 2, total / 2 - m / 2, m)
  }
  return { margin, score, sigma, home: c0, win: m => normCdf(m / sigma), strength: (t, rating) => cElo * rating + cNet * net(t) }
}
// Rounded projected scores, never a tie: when both round to the same number, the side the margin favors gets the
// point (its score rounds up, or the other's down, whichever is nearer the unrounded value). lean: the margin's sign
// breaks an exact tie; with no lean, the home side.
export function untie(h, a, lean = h - a) {
  let H = Math.round(h), A = Math.round(a)
  if (H !== A) return [H, A]
  const homeFav = lean > 0 || (lean === 0 && h >= a)
  if (homeFav) Math.abs(H + 1 - h) <= Math.abs(A - 1 - a) ? H++ : A--
  else Math.abs(A + 1 - a) <= Math.abs(H - 1 - h) ? A++ : H--
  return [H, A]
}
export const normCdf = x => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2)
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

