// The weekly Five challenge: build a five-man lineup from your own game cards for the week's franchise (and era, or
// season), ranked against every real five that franchise put on the floor in that scope. Three at once, the same for
// everyone, drawn fresh each Monday:
//   easy    one franchise, every era
//   medium  one franchise in one era (the Era Pack eras)
//   hard    one franchise in one season
// A lineup scores its total Elo: the pre-game Elo on its cards added up. Up to five cards, so a short lineup (all the cards
// you have) can play, at a disadvantage. A real five is a game's five highest pre-game Elo players who played for that team
// (the Starting Five measure), totaled; every game counts. Percentile: the share of real fives below yours. Coins, paid once the week is over: the level's top payout × your percentile; beat every real five and it
// doubles. Cards cost nothing to use, stay sellable, and can sit in more than one lineup. One card per player per lineup.
import { ERAS } from './packs.js'
import { grant } from './coins.js'

export const CHALLENGE = { easy: 150, medium: 300, hard: 600 }
export const LEVELS = ['easy', 'medium', 'hard']
const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const fail = (status, message) => Object.assign(new Error(message), { status })
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const weekStart = day => addDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7))
const iso = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
const startYear = s => +String(s).slice(0, 4)
const eraOf = s => ERAS.find(e => startYear(s) >= e.from && startYear(s) <= e.to)

export async function ensureChallengeSchema(t) {
  await t`create table if not exists challenge_weeks (week date primary key, spec jsonb not null, settled_at timestamptz)`
  await t`create table if not exists challenge_entries (
    user_id int not null references users(id) on delete cascade, week date not null, level text not null,
    ids bigint[] not null, five real not null, names jsonb not null, pct real, coins int, settled_at timestamptz,
    made_at timestamptz not null default now(), primary key (user_id, week, level))`
}

// Every game's five, total pre-game Elo, by franchise and season (scripts/build_specials.py)
let distP = null, distAt = 0
async function dist(origin) {
  if (!distP || Date.now() - distAt > 6 * 36e5) {
    distAt = Date.now()
    distP = fetch(`${origin}/data/explorer/binders/fivedist.json`, { signal: AbortSignal.timeout(15e3) })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
    distP.then(d => { if (!d) distP = null })
  }
  return distP
}

// The week's three challenges, drawn from the week's date so everyone gets the same ones. Current franchises only
// (cards to play with); Hard skips the season in progress (its fives are still coming in) and seasons before 1970.
function rng(seed) { let h = 2166136261; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296 }
function draw(D, week) {
  const r = rng(`five|${week}`)
  const pick = list => list[Math.floor(r() * list.length)]
  const seasons = fc => Object.keys(D[fc] || {}).sort()
  const newest = Object.values(D).flatMap(x => Object.keys(x)).sort().pop()
  const active = Object.keys(D).filter(fc => !fc.includes('@') && D[fc][newest] && seasons(fc).length >= 5).sort()
  const used = new Set()
  const fresh = list => { const l = list.filter(x => !used.has(x)); const v = pick(l.length ? l : list); used.add(v); return v }
  const easy = { fc: fresh(active) }
  const medFc = fresh(active)
  const eras = ERAS.filter(e => seasons(medFc).filter(s => eraOf(s)?.id === e.id).length >= 3)
  // Only eras the franchise actually played in (three seasons or more): no Grizzlies in the '50s
  const medium = { fc: medFc, era: pick(eras).id }
  const hardFc = fresh(active)
  // One of the franchise's own finished seasons
  const hs = seasons(hardFc).filter(s => s !== newest && startYear(s) >= 1970 && (D[hardFc][s] || []).length >= 40)
  const hard = { fc: hardFc, s: pick(hs.length ? hs : seasons(hardFc).filter(s => s !== newest)) }
  return { easy, medium, hard }
}

async function specFor(sql, origin, week) {
  const [w] = await sql`select spec from challenge_weeks where week = ${week}`
  if (w) return w.spec
  const D = await dist(origin)
  if (!D) throw fail(503, 'The lineup challenge is waiting on the next data update.')
  const spec = draw(D, week)
  await sql`insert into challenge_weeks (week, spec) values (${week}, ${sql.json(spec)}) on conflict do nothing`
  const [x] = await sql`select spec from challenge_weeks where week = ${week}`
  return x.spec
}

// Which seasons a level covers, and whether a card fits it
const inScope = (lv, sp, s) => (lv === 'easy' ? true : lv === 'medium' ? eraOf(s)?.id === sp.era : s === sp.s)
const cardFc = c => MERGE[c.t] || c.t
const fits = (lv, sp, c) => c && !c.kind && c.row?.pre != null && cardFc(c) === sp.fc && inScope(lv, sp, c.s)

// The real fives in scope, sorted, with the best and the middle
const pools = new Map()
async function pool(origin, lv, sp) {
  const key = `${lv}|${sp.fc}|${sp.era || ''}|${sp.s || ''}`
  const m = pools.get(key)
  if (m && Date.now() - m.at < 6 * 36e5) return m.data
  const D = await dist(origin)
  const all = Object.entries(D?.[sp.fc] || {}).filter(([s]) => inScope(lv, sp, s)).flatMap(([, v]) => v).sort((a, b) => a - b)
  const data = { all, n: all.length, best: all[all.length - 1] ?? null, median: all.length ? all[Math.floor(all.length / 2)] : null,
    p90: all.length ? all[Math.floor(all.length * 0.9)] : null, seasons: Object.keys(D?.[sp.fc] || {}).filter(s => inScope(lv, sp, s)).length }
  pools.set(key, { at: Date.now(), data })
  if (pools.size > 60) pools.delete(pools.keys().next().value)
  return data
}
// Share of real fives below this one (ties count half), 0–100
function pctOf(P, five) {
  if (!P.n) return null
  let lo = 0, hi = P.n
  while (lo < hi) { const mid = (lo + hi) >> 1; if (P.all[mid] < five) lo = mid + 1; else hi = mid }
  let eq = lo; while (eq < P.n && P.all[eq] === five) eq++
  return Math.round(((lo + (eq - lo) / 2) / P.n) * 1000) / 10
}
const coinsFor = (lv, pct, five, P) => Math.round(CHALLENGE[lv] * (pct || 0) / 100) * (P.best != null && five > P.best ? 2 : 1)

export async function challengeView(sql, u, origin, today) {
  const week = weekStart(today)
  const spec = await specFor(sql, origin, week)
  const mine = await sql`select * from challenge_entries where user_id = ${u.id} and week = ${week}`
  const cards = mine.length ? await sql`select id, card from cards where user_id = ${u.id} and id = any(${mine.flatMap(e => e.ids.map(String))}::bigint[])` : []
  const levels = []
  for (const lv of LEVELS) {
    const sp = spec[lv], P = await pool(origin, lv, sp)
    const e = mine.find(x => x.level === lv)
    const pct = e ? pctOf(P, e.five) : null
    levels.push({ level: lv, max: CHALLENGE[lv], spec: { ...sp, era: sp.era ? ERAS.find(x => x.id === sp.era) : null },
      pool: { n: P.n, best: P.best, median: P.median, p90: P.p90, seasons: P.seasons },
      entry: e ? { five: Math.round(e.five * 10) / 10, pct, coins: coinsFor(lv, pct, e.five, P),
        cards: e.ids.map(id => cards.find(c => Number(c.id) === Number(id))).filter(Boolean).map(c => ({ id: Number(c.id), card: c.card })) } : null })
  }
  const lastWeek = addDays(week, -7)
  const past = await sql`select level, five, pct, coins, names from challenge_entries where user_id = ${u.id} and week = ${lastWeek} and settled_at is not null`
  const [lw] = past.length ? await sql`select spec from challenge_weeks where week = ${lastWeek}` : [null]
  return { week, ends: addDays(week, 6), levels, rates: CHALLENGE,
    last: past.length ? { week: lastWeek, spec: lw?.spec || null, results: past.map(p => ({ level: p.level, five: Math.round(p.five * 10) / 10, pct: p.pct, coins: p.coins, names: p.names })) } : null }
}

// Save (or clear) a lineup: up to five of your game cards that fit the level, one per player
export async function setChallenge(sql, u, origin, b, today) {
  const week = weekStart(today), lv = String(b.level || '')
  if (!LEVELS.includes(lv)) throw fail(400, 'Pick Easy, Medium or Hard.')
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean))]
  if (!ids.length) { await sql`delete from challenge_entries where user_id = ${u.id} and week = ${week} and level = ${lv}`; return }
  if (ids.length > 5) throw fail(400, 'A lineup is at most five cards.')
  const spec = await specFor(sql, origin, week), sp = spec[lv]
  const rows = await sql`select id, card from cards where user_id = ${u.id} and id = any(${ids.map(String)}::bigint[])`
  if (rows.length !== ids.length) throw fail(400, 'Those cards aren’t all in your binder.')
  if (rows.some(r => !fits(lv, sp, r.card))) throw fail(400, 'Every card has to be a game card from this challenge’s franchise and years.')
  const names = rows.map(r => r.card.row.n)
  if (new Set(names).size !== names.length) throw fail(400, 'One card per player.')
  const five = rows.reduce((a, r) => a + r.card.row.pre, 0) // total Elo
  await sql`insert into challenge_entries (user_id, week, level, ids, five, names) values (${u.id}, ${week}, ${lv}, ${ids}, ${five}, ${sql.json(names)})
    on conflict (user_id, week, level) do update set ids = excluded.ids, five = excluded.five, names = excluded.names, made_at = now() where challenge_entries.settled_at is null`
}

// Finished weeks: everyone's percentile and Coins, once
export async function settleChallenges(sql, origin, today) {
  const week = weekStart(today)
  const open = await sql`select distinct week from challenge_entries where week < ${week} and settled_at is null order by week limit 4`
  for (const { week: w } of open) {
    const wk = iso(w)
    const [cw] = await sql`select spec from challenge_weeks where week = ${wk}`
    if (!cw) continue
    const entries = await sql`select * from challenge_entries where week = ${wk} and settled_at is null`
    for (const e of entries) {
      const sp = cw.spec[e.level], P = await pool(origin, e.level, sp)
      if (!P.n) continue
      const pct = pctOf(P, e.five), coins = coinsFor(e.level, pct, e.five, P)
      await sql.begin(async t => {
        const [x] = await t`update challenge_entries set pct = ${pct}, coins = ${coins}, settled_at = now() where user_id = ${e.user_id} and week = ${wk} and level = ${e.level} and settled_at is null returning 1`
        if (x && coins) await grant(t, e.user_id, today, 'challenge5', coins, { ref: `${wk}|${e.level}`, label: `Five challenge (${e.level}), week of ${wk}: ${pct}th percentile` })
      })
    }
    await sql`update challenge_weeks set settled_at = now() where week = ${wk}`
  }
}
