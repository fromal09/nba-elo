// Season card details for points (final rank, honors, title) and the one-time rescore when the points rules change.
import { cardPoints } from './points.js'
import { poolJSON, refOf } from './packs.js'

export const POINTS_VERSION = 'points2'   // change to rescore every card again after a points change

let cache = null
async function dataJSON(origin, path) {
  const r = await fetch(`${origin}/data/explorer/${path}`).catch(() => null)
  return r?.ok ? r.json() : null
}
async function seasonData(origin) {
  if (!cache || Date.now() - cache.at > 10 * 60e3) {
    const [rank, honors] = await Promise.all([dataJSON(origin, 'binders/seasonrank.json'), dataJSON(origin, 'binders/honors.json')])
    cache = { at: Date.now(), rank: rank || {}, honors: honors || {} }
  }
  return cache
}
// What a Season card needs for its points: his final rank, his honors code, and whether his franchise won the title
export async function seasonDetails(origin, s, fc, n) {
  const d = await seasonData(origin)
  return { rank: d.rank[s]?.r?.[n] ?? null, honors: d.honors[s]?.[n] || null, champ: !!d.rank[s]?.champ && d.rank[s].champ === fc }
}

// Rescore every card once: refresh Starting Fives from the published pool (they now carry each player's card details),
// fill in Season cards' rank and honors, then recompute points for cards and sales
let running = null
export function upgradePoints(sql, origin) {
  if (!running) running = run(sql, origin).catch(e => { console.error('rescore', e); running = null })
  return running
}
async function run(sql, origin) {
  await sql`create table if not exists migrations (id text primary key, done_at timestamptz not null default now())`
  const done = new Set((await sql`select id from migrations`).map(r => r.id))
  const seasonsReady = Object.keys((await seasonData(origin)).rank).length > 0
  // Game cards, Peaks, Duels, Rivalries and Starting Fives rescore right away; Season cards wait for the Season data
  if (!done.has(POINTS_VERSION)) await rescore(sql, origin, c => c?.kind !== 'season', POINTS_VERSION)
  if (!done.has(POINTS_VERSION + '-seasons') && seasonsReady) await rescore(sql, origin, c => c?.kind === 'season', POINTS_VERSION + '-seasons')
  // Starting Fives refresh again once the pool carries their tiers (Common to GOAT)
  if (!done.has('fives-tiers')) {
    const idx = await poolJSON(origin, 'special/index.json').catch(() => null)
    const first = idx?.fives?.[0] && (await poolJSON(origin, `special/${idx.fives[0][0]}`).catch(() => null))?.cards?.[0]
    if (first?.tier) await rescore(sql, origin, c => c?.kind === 'five', 'fives-tiers')
  }
}

export async function pointsStatus(sql, origin) {
  await sql`create table if not exists migrations (id text primary key, done_at timestamptz not null default now())`
  const rows = await sql`select id, done_at from migrations order by done_at`
  return { version: POINTS_VERSION, done: rows.map(r => ({ id: r.id, at: r.done_at })), seasonData: Object.keys((await seasonData(origin)).rank).length > 0 }
}

async function rescore(sql, origin, which, id) {
  const idx = await poolJSON(origin, 'special/index.json').catch(() => null)
  const fives = new Map()
  for (const [file] of idx?.fives || []) for (const c of (await poolJSON(origin, `special/${file}`).catch(() => ({ cards: [] }))).cards) fives.set(refOf(c), c)
  for (const table of ['cards', 'sold']) {
    const rows = (await sql`select id, ref, card from ${sql(table)}`).filter(r => which(r.card))
    const ids = [], pts = [], refreshed = []
    for (const r of rows) {
      let c = r.card
      if (c?.kind === 'five' && fives.has(r.ref)) { c = { ...fives.get(r.ref), from: c.from }; refreshed.push([r.id, c]) }
      else if (c?.kind === 'season') { c = { ...c, ...(await seasonDetails(origin, c.s, c.t, c.n)) }; refreshed.push([r.id, c]) }
      ids.push(r.id); pts.push(cardPoints(c).points)
    }
    await sql.begin(async t => {
      for (let i = 0; i < ids.length; i += 500) {
        const I = ids.slice(i, i + 500).map(String), P = pts.slice(i, i + 500)
        if (table === 'cards') await t`update cards set points = x.p from (select unnest(${I}::bigint[]) as id, unnest(${P}::int[]) as p) x where cards.id = x.id`
        else await t`update sold set points = x.p from (select unnest(${I}::bigint[]) as id, unnest(${P}::int[]) as p) x where sold.id = x.id`
      }
      for (const [rid, c] of refreshed) {
        if (table === 'cards') await t`update cards set card = ${t.json(c)} where id = ${rid}`
        else await t`update sold set card = ${t.json(c)} where id = ${rid}`
      }
    })
    console.log(`rescore ${id}: ${table} ${ids.length} (${refreshed.length} refreshed)`)
  }
  await sql`insert into migrations (id) values (${id}) on conflict do nothing`
}
