// Season card details for points (final rank, honors, title) and the one-time rescore when the points rules change.
import { cardPoints } from './points.js'
import { poolJSON, refOf } from './packs.js'

export const POINTS_VERSION = 'points3'   // A+ (Nov. 3, 2026): scarcity × significance × occasion, contest cards   // change to rescore every card again after a points change

let cache = null
async function dataJSON(origin, path) {
  const r = await fetch(`${origin}/data/explorer/${path}`, { signal: AbortSignal.timeout(10e3) }).catch(() => null)
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
// One run per warm instance; after a failure, wait 10 minutes before trying again (never on every request)
let running = null, failedAt = 0, lastError = null
export function upgradePoints(sql, origin) {
  if (!running && Date.now() - failedAt > 10 * 60e3) {
    running = run(sql, origin).then(() => { lastError = null }).catch(e => { console.error('rescore', e); lastError = String(e?.message || e); failedAt = Date.now(); running = null })
  }
  return running || Promise.resolve()
}
async function run(sql, origin) {
  await sql`create table if not exists migrations (id text primary key, done_at timestamptz not null default now())`
  const done = new Set((await sql`select id from migrations`).map(r => r.id))
  const seasonsReady = Object.keys((await seasonData(origin)).rank).length > 0
  // Game cards, Peaks, Duels, Rivalries and Starting Fives rescore right away; Season cards wait for the Season data
  // A+ prices a Duel of the Day card by the matchups it took to earn: the count, from the day it was won
  if (!done.has('duel-matchups')) {
    for (const table of ['cards', 'sold']) await sql`update ${sql(table)} x set card = x.card || jsonb_build_object('n', d.total)
      from duel_days d where x.card->>'kind' = 'duel' and x.card->>'n' is null and d.user_id = x.user_id and d.claimed_ref = x.ref and d.total > 0`
    await sql`insert into migrations (id) values ('duel-matchups') on conflict do nothing`
  }
  if (!done.has(POINTS_VERSION)) await rescore(sql, origin, c => c?.kind !== 'season', POINTS_VERSION)
  if (!done.has(POINTS_VERSION + '-seasons') && seasonsReady) await rescore(sql, origin, c => c?.kind === 'season', POINTS_VERSION + '-seasons')
  // A build on Oct. 29, 2026 marked that day's regular-season games as playoff games (scripts/season_explorer.py's
  // postseason guess, fixed). Once the rebuilt pool no longer has playoff bands on last night's cards, 2026-27 cards
  // lose the band and the playoff bonus in their points, once.
  if (!done.has('bands-2026-27')) {
    const idx = await poolJSON(origin, 'index.json').catch(() => null)
    const bi = idx?.cols?.indexOf('band') ?? -1
    const clean = idx?.recent?.rows?.length && bi >= 0 && !idx.recent.rows.some(r => r[bi])
    if (clean) {
      for (const table of ['cards', 'sold']) {
        await sql`update ${sql(table)} set card = jsonb_set(card, '{band}', 'null'::jsonb) where card->>'s' = '2026-27' and jsonb_typeof(card->'band') = 'object'`
      }
      await rescore(sql, origin, c => c?.s === '2026-27' && !c.kind, 'bands-2026-27')
    }
  }
  // Box Score Sweeps (row.sw): once the rebuilt pool carries the column, cards already in binders from those games
  // gain it (and its stat-line bonus), from the Stat-line legends set
  if (!done.has('sweep-cards')) {
    const idx = await poolJSON(origin, 'index.json').catch(() => null)
    const lg = idx?.cols?.includes('sw') ? await dataJSON(origin, 'binders/league.json') : null
    const list = (lg?.sets?.stat || []).filter(c => c.row?.sw)
    if (list.length) {
      for (const table of ['cards', 'sold']) {
        for (const c of list) {
          await sql`update ${sql(table)} set card = jsonb_set(card, '{row,sw}', ${c.row.sw}::text::jsonb)
            where (ref = ${`${c.s}|${c.id}|${c.row.n}`} or ref = ${`${c.s}|${c.id}|${c.row.n}|ruby`}) and card->>'kind' is null`
        }
      }
      await rescore(sql, origin, c => !c?.kind && c?.row?.sw > 0, 'sweep-cards')
    }
  }
  // 5x5 games (five or more of all five): the stat-line bonus for cards already in binders
  if (!done.has('five-by-five')) await rescore(sql, origin, c => !c?.kind && c?.row && ['pts', 'trb', 'ast', 'stl', 'blk'].every(k => (c.row[k] || 0) >= 5), 'five-by-five')
  // Franchise History, Completed Franchise and Banner cards named for an old team name (Tri-Cities Blackhawks for the
  // Hawks): the franchise's current name, once
  if (!done.has('reward-names')) {
    const check = await dataJSON(origin, 'binders/checklist.json')
    if (check?.franchises) {
      for (const table of ['cards', 'sold']) {
        const rows = await sql`select id, card from ${sql(table)} where card->>'kind' in ('fhist', 'fcomp', 'banner')`
        for (const r of rows) {
          const name = check.franchises[r.card.fc]?.name
          if (name && name !== r.card.tn) await sql`update ${sql(table)} set card = jsonb_set(card, '{tn}', to_jsonb(${name}::text)) where id = ${r.id}`
        }
      }
      await sql`insert into migrations (id) values ('reward-names') on conflict do nothing`
    }
  }
  // The first rename stored the names with their JSON quotes ("Atlanta Hawks"); strip them
  if (!done.has('reward-names-quotes')) {
    for (const table of ['cards', 'sold'])
      await sql`update ${sql(table)} set card = jsonb_set(card, '{tn}', to_jsonb(btrim(card->>'tn', '"'))) where card->>'kind' in ('fhist', 'fcomp', 'banner') and card->>'tn' like '"%'`
    await sql`insert into migrations (id) values ('reward-names-quotes') on conflict do nothing`
  }
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
  return { version: POINTS_VERSION, done: rows.map(r => ({ id: r.id, at: r.done_at })), seasonData: Object.keys((await seasonData(origin)).rank).length > 0,
    lastError, failedAt: failedAt ? new Date(failedAt).toISOString() : null }
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
