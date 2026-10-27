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
  const [done] = await sql`select 1 from migrations where id = ${POINTS_VERSION}`
  if (done) return
  const rank = (await seasonData(origin)).rank
  if (!Object.keys(rank).length) return   // the data isn't published yet: try again on a later request
  // Starting Fives from the pool, by ref
  const idx = await poolJSON(origin, 'special/index.json').catch(() => null)
  const fives = new Map()
  for (const [file] of idx?.fives || []) for (const c of (await poolJSON(origin, `special/${file}`)).cards) fives.set(refOf(c), c)
  for (const table of ['cards', 'sold']) {
    const rows = await sql`select id, ref, card from ${sql(table)}`
    const ids = [], pts = [], cardsOut = [], changed = []
    for (const r of rows) {
      let c = r.card
      if (c?.kind === 'five' && fives.has(r.ref)) { c = { ...fives.get(r.ref), from: c.from }; changed.push(r.id) }
      else if (c?.kind === 'season') { c = { ...c, ...(await seasonDetails(origin, c.s, c.t, c.n)) }; changed.push(r.id) }
      ids.push(r.id); pts.push(cardPoints(c).points); cardsOut.push(c)
    }
    await sql.begin(async t => {
      for (let i = 0; i < ids.length; i += 500) {
        const I = ids.slice(i, i + 500), P = pts.slice(i, i + 500)
        if (table === 'cards') await t`update cards set points = x.p from (select unnest(${I}::bigint[]) as id, unnest(${P}::int[]) as p) x where cards.id = x.id`
        else await t`update sold set points = x.p from (select unnest(${I}::bigint[]) as id, unnest(${P}::int[]) as p) x where sold.id = x.id`
      }
      for (const id of changed) {
        const c = cardsOut[ids.indexOf(id)]
        if (table === 'cards') await t`update cards set card = ${t.json(c)} where id = ${id}`
        else await t`update sold set card = ${t.json(c)} where id = ${id}`
      }
    })
    console.log(`rescore: ${table} ${ids.length} (${changed.length} refreshed)`)
  }
  await sql`insert into migrations (id) values (${POINTS_VERSION}) on conflict do nothing`
}
