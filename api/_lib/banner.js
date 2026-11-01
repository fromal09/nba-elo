// Hang the Banner: a progressive challenge for every franchise. One rung per finished NBA season (no BAA or ABA seasons),
// ordered from the franchise's weakest best five to its strongest. A rung's target is that season's best single-game five:
// the game whose five highest pre-game Elo players averaged the most (binders/fives.json, the Starting Five measure).
// Beat it with five of your own game cards of the franchise, five different players: their average pre-game Elo (the
// number on each card) has to be higher. Beat a rung to see the next one.
// The card window narrows as the targets rise (stage by the rung's place in the ladder):
//   1 Open floor              the first 25%          any season in franchise history
//   2 Within the generation   to 50%                 within 20 years of the rung's season
//   3 Within the decade       to 75%                 within 10 years
//   4 Within the era          to 90%                 within 5 years
//   5 Within the core         to the next-to-last    within 2 years
//   6 Final                   the last rung          that season only
// Every win opens a pack of the franchise's cards, better as the stages go (packs.js SLOTS banner1–banner6). Beating
// every rung earns the franchise's Banner card. A season added after it finishes slots into its place as a new rung;
// the Banner card is yours to keep.
import { nbaSeasonOf, seasonOver, newReward } from './coins.js'

export const STAGES = [null,
  { id: 1, name: 'Open floor', win: null }, { id: 2, name: 'Within the generation', win: 20 }, { id: 3, name: 'Within the decade', win: 10 },
  { id: 4, name: 'Within the era', win: 5 }, { id: 5, name: 'Within the core', win: 2 }, { id: 6, name: 'Final', win: 0 }]
export const BANNER_POINTS_PER = 150
const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const fail = (status, message) => Object.assign(new Error(message), { status })
const yr = s => +String(s).slice(0, 4)
export const stageOf = (i, N) => (i === N ? 6 : i / N <= 0.25 ? 1 : i / N <= 0.5 ? 2 : i / N <= 0.75 ? 3 : i / N <= 0.9 ? 4 : 5)
const windowOf = (stage, s) => { const w = STAGES[stage].win; return w == null ? null : [yr(s) - w, yr(s) + w] }

export async function ensureBannerSchema(t) {
  await t`create table if not exists banner_wins (
    user_id int not null references users(id) on delete cascade, fc text not null, s text not null, rung int not null, stage int not null,
    target real not null, score real not null, ids bigint[] not null, names jsonb not null, won_at timestamptz not null default now(),
    primary key (user_id, fc, s))`
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
  const wins = await sql`select fc, s, rung, stage, target, score, names, won_at from banner_wins where user_id = ${u.id}`
  const banners = new Set((await sql`select ref from cards where user_id = ${u.id} and ref like 'banner|%'`).map(r => r.ref.slice(7)))
  const franchises = []
  // Today's 30 franchises (the ones with a five in the newest season), with their whole history
  const newest = Object.values(F).flatMap(x => Object.keys(x)).sort().pop()
  for (const f of Object.keys(F).filter(x => !x.includes('@') && F[x][newest]).sort()) {
    const L = await ladder(origin, f, day)
    if (!L.length) continue
    const mine = new Set(wins.filter(w => w.fc === f).map(w => w.s))
    franchises.push({ fc: f, rungs: L.length, cleared: L.filter(r => mine.has(r.s)).length, banner: banners.has(f) })
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
      current: cur && { ...cur, stageName: STAGES[cur.stage].name, window: windowOf(cur.stage, cur.s) },
    }
  }
  return { franchises, detail, stages: STAGES.slice(1) }
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
  const score = Math.round((cards.reduce((a, c) => a + c.card.row.pre, 0) / 5) * 10) / 10
  const won = score > rung.elo
  if (!won) return { won, score, target: rung.elo, rung: rung.i }
  const names = cards.map(c => [c.card.row.n, c.card.s, Math.round(c.card.row.pre)])
  let banner = null
  await sql.begin(async t => {
    const [x] = await t`insert into banner_wins (user_id, fc, s, rung, stage, target, score, ids, names) values (${u.id}, ${fc}, ${rung.s}, ${rung.i}, ${rung.stage},
      ${rung.elo}, ${score}, ${want.map(String)}::bigint[], ${t.json(names)}) on conflict do nothing returning s`
    if (!x) throw fail(409, 'Already beaten.')
    if (L.every(r => r.s === rung.s || done.has(r.s))) {
      const [look] = await t`select max(card->>'tn') as tn, max(card->>'tc') as tc from cards where user_id = ${u.id} and card->>'t' = ${fc} and card->>'kind' is null`
      banner = await newReward(t, u.id, day, `banner|${fc}`, { kind: 'banner', tier: 'banner', fc, t: fc, tn: look?.tn || fc, tc: look?.tc || null, size: L.length,
        from: L.map(r => r.s).sort()[0], to: L.map(r => r.s).sort().pop(), final: { s: rung.s, elo: rung.elo, score } },
      `Hang the Banner: every ${look?.tn || fc} rung beaten. The Banner card is in your binder`)
    }
  })
  return { won, score, target: rung.elo, rung: rung.i, stage: rung.stage, pack: `banner${rung.stage}`, banner }
}
