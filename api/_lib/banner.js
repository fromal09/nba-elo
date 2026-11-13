// Hang the Banner: a progressive challenge for every franchise. One rung per finished NBA season (no BAA or ABA seasons),
// ordered from the franchise's weakest best five to its strongest. A rung's target is that season's best single-game five:
// the game whose five highest pre-game Elo players averaged the most (binders/fives.json, the Starting Five measure).
// Beat it with five of your own game cards of the franchise, five different players: their average pre-game Elo (the
// number on each card) has to be higher. Beat a rung to see the next one.
// The card window narrows as the targets rise (stage by the rung's place in the ladder):
//   1 Open floor              the first 10%      any season in franchise history     pack: 1 Common
//   2 Within the generation   the next 15%       10 seasons either side              pack: 3 Commons
//   3 Within the decade       the next 25%       5 seasons either side               pack: 4 Commons, 1 up to Rare
//   4 Within the era          the next 25%       3 seasons either side               pack: 3 Commons, 2 up to Standout
//   5 Within the core         the next 12.5%     1 season either side                pack: 3 up to Rare, 2 up to Legend
//   6 Final                   the last 12.5%     that season only                    pack: 3 up to Rare, 2 up to Icon
// (packs.js SLOTS banner1–banner6; no guaranteed big pulls or special cards in them). Beating every rung earns the
// franchise's Banner card. A season added after it finishes slots into its place as a new rung; the Banner card is
// yours to keep.
// Rest: a card in a winning lineup sits out the franchise's next rungs or the next days, whichever ends first, by its
// tier: GOAT 10 rungs or 5 days, Icon 8 or 4, Legend 6 or 3, Standout 4 or 2, Rare 2 or 1, Common none. Days are
// Eastern-time days, so a GOAT that wins on the 13th is back on the 18th. No rest on the last two stages' rungs (Within
// the core, Final): their one-to-three-season windows already leave few cards to choose from.
import { nbaSeasonOf, seasonOver, newReward, franchiseName } from './coins.js'

export const STAGES = [null,
  { id: 1, name: 'Open floor', win: null, pack: '1 Common' }, { id: 2, name: 'Within the generation', win: 10, pack: '3 Commons' },
  { id: 3, name: 'Within the decade', win: 5, pack: '4 Commons and 1 up to Rare' }, { id: 4, name: 'Within the era', win: 3, pack: '3 Commons and 2 up to Standout' },
  { id: 5, name: 'Within the core', win: 1, pack: '3 up to Rare and 2 up to Legend' }, { id: 6, name: 'Final', win: 0, pack: '3 up to Rare and 2 up to Icon' }]
// Rungs a card sits out after a winning lineup, by tier
export const BANNER_REST = { goat: 10, icon: 8, legend: 6, standout: 4, rare: 2, common: 0 }
export const BANNER_REST_DAYS = { goat: 5, icon: 4, legend: 3, standout: 2, rare: 1, common: 0 }
export const BANNER_NO_REST_STAGE = 5
const etOf = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const weekday = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
export const BANNER_POINTS_PER = 150
const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const fail = (status, message) => Object.assign(new Error(message), { status })
const yr = s => +String(s).slice(0, 4)
export const stageOf = (i, N) => { const f = i / N; return i === N || f > 0.875 ? 6 : f <= 0.1 ? 1 : f <= 0.25 ? 2 : f <= 0.5 ? 3 : f <= 0.75 ? 4 : 5 }
const windowOf = (stage, s) => { const w = STAGES[stage].win; return w == null ? null : [yr(s) - w, yr(s) + w] }

export async function ensureBannerSchema(t) {
  await t`create table if not exists banner_wins (
    user_id int not null references users(id) on delete cascade, fc text not null, s text not null, rung int not null, stage int not null,
    target real not null, score real not null, ids bigint[] not null, names jsonb not null, won_at timestamptz not null default now(),
    primary key (user_id, fc, s))`
  // step: this win's place in your climb (1 for your first win on the ladder); tiers: the five cards' tiers, for rest
  await t`alter table banner_wins add column if not exists step int`
  await t`alter table banner_wins add column if not exists tiers text[]`
}
// Cards resting on your next rung of a ladder: { cardId: { r: rungs left, until: the ET day it's back } }. wins: that ladder's banner_wins rows, oldest first
async function fillTiers(sql, wins) {
  const need = wins.filter(w => !w.tiers).flatMap(w => w.ids)
  if (!need.length) return
  const m = new Map((await sql`select id, tier from cards where id = any(${need})`).map(c => [String(c.id), c.tier]))
  for (const w of wins) if (!w.tiers) w.tiers = w.ids.map(id => m.get(String(id)) || 'common')
}
// day: today (ET); stage: the next rung's stage (none from BANNER_NO_REST_STAGE on)
export function restOf(wins, day, stage) {
  if (!stage || stage >= BANNER_NO_REST_STAGE) return {}
  const next = wins.length + 1, out = {}
  for (const [k, w] of wins.entries()) {
    const step = w.step || k + 1
    w.ids.forEach((id, i) => {
      const t = w.tiers[i], r = step + (BANNER_REST[t] || 0) - next + 1
      if (r <= 0) return
      const until = addDays(etOf(w.won_at), BANNER_REST_DAYS[t] || 0)
      if (until <= day) return
      const o = out[Number(id)]
      out[Number(id)] = o ? { r: Math.max(o.r, r), until: o.until > until ? o.until : until } : { r, until }
    })
  }
  return out
}
async function resting(sql, userId, fc, day, stage) {
  const wins = await sql`select ids, tiers, step, won_at from banner_wins where user_id = ${userId} and fc = ${fc} order by won_at`
  await fillTiers(sql, wins)
  return restOf(wins, day, stage)
}

let fivesP = null, fivesAt = 0
async function fives(origin) {
  if (!fivesP || Date.now() - fivesAt > 6 * 36e5) {
    fivesAt = Date.now()
    fivesP = fetch(`${origin}/data/explorer/binders/fives.json`, { signal: AbortSignal.timeout(15e3) }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    fivesP.then(d => { if (!d) fivesP = null })
  }
  return fivesP
}
// A franchise's ladder: [{ i, s, elo, date, opp, won, score, five, stage }], weakest first
export async function ladder(origin, fc, day) {
  const F = (await fives(origin))?.[fc]
  if (!F) return []
  const rows = []
  for (const [s, v] of Object.entries(F)) {
    if (!nbaSeasonOf(fc, s) || !(await seasonOver(origin, s, day))) continue
    rows.push({ s, elo: v[0], date: v[1], opp: v[2], won: v[3], score: v[4], five: v[5] })
  }
  rows.sort((a, b) => a.elo - b.elo || a.s.localeCompare(b.s))
  return rows.map((r, k) => ({ ...r, i: k + 1, stage: stageOf(k + 1, rows.length) }))
}

export async function bannerView(sql, u, origin, day, fc) {
  const F = (await fives(origin)) || {}
  const wins = await sql`select fc, s, rung, stage, target, score, names, won_at, ids, tiers, step from banner_wins where user_id = ${u.id} order by won_at`
  await fillTiers(sql, wins)
  const banners = new Set((await sql`select ref from cards where user_id = ${u.id} and ref like 'banner|%'`).map(r => r.ref.slice(7)))
  const franchises = []
  // Today's 30 franchises (the ones with a five in the newest season), with their whole history
  const newest = Object.values(F).flatMap(x => Object.keys(x)).sort().pop()
  for (const f of Object.keys(F).filter(x => !x.includes('@') && F[x][newest]).sort()) {
    const L = await ladder(origin, f, day)
    if (!L.length) continue
    const fw = wins.filter(w => w.fc === f), mine = new Set(fw.map(w => w.s))
    // The next rung's card window and the cards resting on it, so the list can tell which ladders you can field five for
    const next = L.find(r => !mine.has(r.s))
    franchises.push({ fc: f, rungs: L.length, cleared: L.filter(r => mine.has(r.s)).length, banner: banners.has(f),
      cur: next ? { s: next.s, window: windowOf(next.stage, next.s) } : null, resting: next ? restOf(fw, day, next.stage) : {} })
  }
  let detail = null
  if (fc) {
    const L = await ladder(origin, fc, day)
    const mine = new Map(wins.filter(w => w.fc === fc).map(w => [w.s, w]))
    const cur = L.find(r => !mine.has(r.s)) || null
    detail = {
      fc, banner: banners.has(fc), rungs: L.length, cleared: L.filter(r => mine.has(r.s)).length,
      ladder: L.map(r => {
        const w = mine.get(r.s)
        if (w) return { i: r.i, stage: r.stage, status: 'won', s: r.s, target: r.elo, score: w.score, names: w.names, at: w.won_at }
        if (r === cur) return { i: r.i, stage: r.stage, status: 'current', s: r.s, target: r.elo }
        return { i: r.i, stage: r.stage, status: 'locked' }
      }),
      current: cur && { ...cur, stageName: STAGES[cur.stage].name, pack: STAGES[cur.stage].pack, window: windowOf(cur.stage, cur.s) },
      resting: await resting(sql, u.id, fc, day, cur?.stage), step: L.filter(r => mine.has(r.s)).length + 1,
    }
  }
  return { franchises, detail, stages: STAGES.slice(1), rest: BANNER_REST, restDays: BANNER_REST_DAYS, noRestStage: BANNER_NO_REST_STAGE }
}

// Does a card fit the rung? A game card of the franchise (its NBA seasons) in the stage's window
export function fitsRung(fc, rung, card) {
  if (!card || card.kind || card.row?.pre == null || card.t !== fc || !nbaSeasonOf(fc, card.s)) return false
  const w = windowOf(rung.stage, rung.s)
  return !w || (yr(card.s) >= w[0] && yr(card.s) <= w[1])
}

// Play the current rung with five cards (ids). Returns { won, score, target, rung, banner } and, on a win, the pack kind
export async function playRung(sql, u, origin, day, { fc, ids }) {
  fc = String(fc || '')
  const L = await ladder(origin, fc, day)
  if (!L.length) throw fail(400, 'That franchise has no Hang the Banner ladder.')
  const done = new Set((await sql`select s from banner_wins where user_id = ${u.id} and fc = ${fc}`).map(r => r.s))
  const rung = L.find(r => !done.has(r.s))
  if (!rung) throw fail(409, 'You’ve beaten every rung of this ladder.')
  const want = [...new Set((ids || []).map(Number).filter(Boolean))]
  if (want.length !== 5) throw fail(400, 'Pick five cards.')
  const cards = await sql`select id, card from cards where user_id = ${u.id} and id = any(${want.map(String)}::bigint[])`
  if (cards.length !== 5) throw fail(400, 'Those cards aren’t all in your binder.')
  const bad = cards.find(c => !fitsRung(fc, rung, c.card))
  if (bad) throw fail(400, `${bad.card.row?.n || 'A card'} doesn’t fit this rung.`)
  if (new Set(cards.map(c => c.card.row.n)).size !== 5) throw fail(400, 'Five different players.')
  const rest = await resting(sql, u.id, fc, day, rung.stage)
  const tired = cards.find(c => rest[Number(c.id)])
  if (tired) {
    const o = rest[Number(tired.id)]
    throw fail(409, `${tired.card.row.n}’s card is resting: back after ${o.r} more rung${o.r === 1 ? '' : 's'} or ${o.until === addDays(day, 1) ? 'tomorrow' : `on ${weekday(o.until)}`}.`)
  }
  const score = Math.round((cards.reduce((a, c) => a + c.card.row.pre, 0) / 5) * 10) / 10
  const won = score > rung.elo
  if (!won) return { won, score, target: rung.elo, rung: rung.i }
  const names = cards.map(c => [c.card.row.n, c.card.s, Math.round(c.card.row.pre)])
  let banner = null
  await sql.begin(async t => {
    const ids = cards.map(c => String(c.id)), tiers = cards.map(c => c.card.tier || 'common')
    const [x] = await t`insert into banner_wins (user_id, fc, s, rung, stage, target, score, ids, names, step, tiers) values (${u.id}, ${fc}, ${rung.s}, ${rung.i}, ${rung.stage},
      ${rung.elo}, ${score}, ${ids}::bigint[], ${t.json(names)}, ${done.size + 1}, ${tiers}) on conflict do nothing returning s`
    if (!x) throw fail(409, 'Already beaten.')
    if (L.every(r => r.s === rung.s || done.has(r.s))) {
      const [look0] = await t`select card->>'tn' as tn, card->>'tc' as tc from cards where user_id = ${u.id} and card->>'t' = ${fc} and card->>'kind' is null order by card->>'s' desc limit 1`
      const look = { tn: (await franchiseName(origin, fc)) || look0?.tn, tc: look0?.tc }
      banner = await newReward(t, u.id, day, `banner|${fc}`, { kind: 'banner', tier: 'banner', fc, t: fc, tn: look?.tn || fc, tc: look?.tc || null, size: L.length,
        from: L.map(r => r.s).sort()[0], to: L.map(r => r.s).sort().pop(), final: { s: rung.s, elo: rung.elo, score } },
      `Hang the Banner: every ${look?.tn || fc} rung beaten. The Banner card is in your binder`)
    }
  })
  return { won, score, target: rung.elo, rung: rung.i, stage: rung.stage, pack: `banner${rung.stage}`, banner }
}
