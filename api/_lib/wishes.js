// Wish lists: players (or one player's season) a collector is after.
//
//   Boost   when a pack slot has a card at a tier where a wish has cards you don't own, 15% of the time one of
//           them takes that card's place. The tier never changes, so the pack's odds don't either: a wish
//           for a mostly Common player comes up far more often than one for a player whose cards are Legends.
//   Meter   each wish keeps a count per tier of the cards you keep at that tier without seeing one of its cards
//           there. When the count reaches the tier's number, the next card offered at that tier is a wished one:
//           guaranteed by the 100th Common you keep, the 10th GOAT.
//   Fulfilled  keeping a card the wish names fulfills it and frees its place at once: three wishes at a time, and
//           a new one (the same player again, say, to fill out a season) can go in right away.
import { createHash, randomInt } from 'node:crypto'
import { poolJSON, toCard, refOf, TIER_ORDER } from './packs.js'

export const WISH = {
  chance: 15,   // percent of pack slots (with a card a wish can take) that get a wished card
  meter: { common: 100, rare: 60, standout: 40, legend: 25, icon: 15, goat: 10 },
  max: 3,
}
const fail = (status, message) => Object.assign(new Error(message), { status })
const FRANCHISE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const fc = t => FRANCHISE[t] || t

export async function ensureWishSchema(t) {
  await t`create table if not exists wishes (
    id serial primary key, user_id int not null references users(id) on delete cascade,
    name text not null, season text, meter jsonb not null default '{}', granted int not null default 0,
    created_at timestamptz not null default now(), fulfilled_at timestamptz, fulfilled_ref text)`
  // One open wish per player (or player-season); fulfilled ones stay as history
  await t`create unique index if not exists wishes_open on wishes (user_id, name, coalesce(season, '')) where fulfilled_at is null`
}

// A player's cards in the pool: { tier: { "2015-16-0": [row, ...] } } (build_packs.py's who/ files)
const whoCache = new Map()
export function whoOf(origin, name) {
  const hit = whoCache.get(name)
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.p
  const p = poolJSON(origin, `who/${createHash('sha1').update(name).digest('hex').slice(0, 12)}.json`).catch(() => null)
  whoCache.set(name, { at: Date.now(), p })
  if (whoCache.size > 400) whoCache.delete(whoCache.keys().next().value)
  return p
}
// The wish's entries at a tier: [[shard, row], ...], its season only when it names one
function entries(who, tier, season) {
  const out = []
  for (const [base, rows] of Object.entries(who?.[tier] || {})) {
    if (season && !base.startsWith(season + '-')) continue
    for (const j of rows) out.push([base, j])
  }
  return out
}
const countAll = (who, season) => TIER_ORDER.reduce((s, t) => s + entries(who, t, season).length, 0)
const seasonOk = (w, c) => !w.season || c.s === w.season

// Cards of a wish you own, by tier
async function ownedByTier(sql, userId, w) {
  const rows = await sql`select tier, count(*)::int as n from cards where user_id = ${userId} and card->'row'->>'n' = ${w.name}
    and (${w.season}::text is null or card->>'s' = ${w.season}) and tier = any(${TIER_ORDER}) group by tier`
  return Object.fromEntries(rows.map(r => [r.tier, r.n]))
}

// Loaded for building packs: each wish with its pool entries and how many it still has to offer per tier
export async function loadWishes(sql, userId, origin) {
  const ws = await sql`select * from wishes where user_id = ${userId} and fulfilled_at is null order by id`
  const out = []
  for (const w of ws) {
    const who = await whoOf(origin, w.name)
    if (!who) continue
    const own = await ownedByTier(sql, userId, w)
    const left = Object.fromEntries(TIER_ORDER.map(t => [t, entries(who, t, w.season).length - (own[t] || 0)]))
    out.push({ id: w.id, name: w.name, season: w.season, meter: w.meter || {}, who, left })
  }
  return out
}

// A card of the wish at this tier that isn't taken, fitting the slot (a team pack keeps to its franchise)
async function wishCard(origin, w, tier, taken, fits) {
  const list = entries(w.who, tier, w.season)
  for (let tries = 0; tries < 10 && list.length; tries++) {
    const [base, j] = list.splice(randomInt(list.length), 1)[0]
    const sh = await poolJSON(origin, `${tier}/${base}.json`).catch(() => null)
    const r = sh?.rows?.[j]
    if (!r) continue
    const idx = await poolJSON(origin, 'index.json')
    const c = toCard(idx.cols, r, sh.teams, 'wish')
    if (c.row.n !== w.name || !seasonOk(w, c) || taken.has(refOf(c)) || !fits(c)) continue
    return c
  }
  return null
}

/**
 * Swap wished cards into a pack's slots. Mutates `slots`; returns the wishes that came up, by tier
 * (their meters reset). One wished card a slot, and a wish at most once a pack.
 */
export async function applyWishes(origin, slots, wishes, { taken, team = null }) {
  if (!wishes?.length) return []
  const granted = [], used = new Set()
  for (const slot of slots) {
    if (slot.src !== 'vault' && slot.src !== 'team') continue   // last night's games and themed packs keep their theme
    // Which of the slot's cards a wish could take: a full meter at that tier first, then one chance roll for the slot
    const open = slot.cards.map((c, i) => [c, i]).filter(([c]) => c && !c.kind)
      .map(([c, i]) => [i, wishes.filter(w => !used.has(w.id) && w.left[c.tier] > 0)]).filter(([, ws]) => ws.length)
    if (!open.length) continue
    const due = open.map(([i, ws]) => [i, ws.filter(w => (w.meter[slot.cards[i].tier] || 0) >= WISH.meter[slot.cards[i].tier] - 1)]).filter(([, ws]) => ws.length)
    const tryList = due.length ? due : randomInt(100) < WISH.chance ? open : []
    let done = false
    for (const [i, ws] of tryList.sort(() => randomInt(3) - 1)) {
      if (done) break
      const c = slot.cards[i], tier = c.tier
      for (const w of ws.sort(() => randomInt(3) - 1)) {
        const fits = x => (slot.src !== 'team' || fc(x.t) === team) && !slot.cards.some((y, k) => k !== i && y.row?.n === x.row.n)
        const wc = await wishCard(origin, w, tier, taken, fits)
        if (!wc) continue
        taken.add(refOf(wc))
        slot.cards[i] = { ...wc, from: c.from, wish: w.id }
        slot.cards.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
        used.add(w.id); granted.push({ id: w.id, tier, due: due.length > 0 }); w.left[tier]--; w.meter[tier] = 0
        done = true
        break
      }
    }
  }
  return granted
}

// After building packs: a wish that came up starts its meter at that tier over
export async function resetMeters(sql, granted) {
  for (const g of granted) {
    await sql`update wishes set meter = meter || ${sql.json({ [g.tier]: 0 })}, granted = granted + 1 where id = ${g.id}`
  }
}

// After keeping a card: every wish with cards left at that tier moves its meter on, unless the card was its own
// Returns the wishes the card fulfilled, as awards to celebrate.
export async function tickMeters(t, userId, origin, card) {
  if (!card || card.kind || !TIER_ORDER.includes(card.tier)) return []
  const ws = await t`select * from wishes where user_id = ${userId} and fulfilled_at is null`
  const done = []
  for (const w of ws) {
    const mine = card.row?.n === w.name && seasonOk(w, card)
    if (mine) {
      await t`update wishes set fulfilled_at = now(), fulfilled_ref = ${refOf(card)} where id = ${w.id}`
      done.push({ kind: 'wish', amount: 0, label: `Wish fulfilled: ${w.name}${w.season ? `, ${w.season}` : ''}` })
      continue
    }
    const who = await whoOf(origin, w.name)
    const total = entries(who, card.tier, w.season).length
    if (!total) continue
    const [o] = await t`select count(*)::int as n from cards where user_id = ${userId} and card->'row'->>'n' = ${w.name}
      and (${w.season}::text is null or card->>'s' = ${w.season}) and tier = ${card.tier}`
    if (o.n >= total) continue
    const n = Math.min(WISH.meter[card.tier], (w.meter?.[card.tier] || 0) + 1)
    await t`update wishes set meter = meter || ${t.json({ [card.tier]: n })} where id = ${w.id}`
  }
  return done
}

// The list as the binder shows it: progress, and each tier's meter where the wish has cards left
export async function wishView(sql, user, origin) {
  const ws = await sql`select * from wishes where user_id = ${user.id} and fulfilled_at is null order by id`
  const past = await sql`select w.id, w.name, w.season, w.fulfilled_at, c.card from wishes w left join cards c on c.user_id = w.user_id and c.ref = w.fulfilled_ref
    where w.user_id = ${user.id} and w.fulfilled_at is not null order by w.fulfilled_at desc limit 6`
  const list = []
  for (const w of ws) {
    const who = await whoOf(origin, w.name)
    const own = await ownedByTier(sql, user.id, w)
    const tiers = TIER_ORDER.map(t => {
      const total = entries(who, t, w.season).length, have = own[t] || 0
      return total ? { tier: t, total, have, meter: Math.min(w.meter?.[t] || 0, WISH.meter[t]), need: WISH.meter[t] } : null
    }).filter(Boolean)
    const total = tiers.reduce((s, x) => s + x.total, 0), have = tiers.reduce((s, x) => s + x.have, 0)
    list.push({ id: w.id, name: w.name, season: w.season, total, have, done: total > 0 && have >= total, granted: w.granted, tiers })
  }
  return { wishes: list, max: WISH.max, chance: WISH.chance, meter: WISH.meter,
    fulfilled: past.map(x => ({ id: x.id, name: x.name, season: x.season, at: x.fulfilled_at, card: x.card || null })) }
}

export async function addWish(sql, u, origin, b) {
  const name = String(b.name || '').trim(), season = b.season ? String(b.season) : null
  if (!name) throw fail(400, 'Pick a player.')
  if (season && !/^\d{4}-\d{2}$/.test(season)) throw fail(400, 'That season isn’t right.')
  const who = await whoOf(origin, name)
  if (!who || !countAll(who, season)) throw fail(404, season ? `${name} has no cards from ${season}.` : `${name} has no cards.`)
  const [{ n }] = await sql`select count(*)::int as n from wishes where user_id = ${u.id} and fulfilled_at is null`
  if (n >= WISH.max) throw fail(409, `You have ${WISH.max} wishes already. Take one off first.`)
  // Wishing for a whole player while you own every card he has, or a season you've filled, does nothing
  const [{ have }] = await sql`select count(*)::int as have from cards where user_id = ${u.id} and card->'row'->>'n' = ${name}
    and (${season}::text is null or card->>'s' = ${season}) and tier = any(${TIER_ORDER})`
  if (have >= countAll(who, season)) throw fail(409, season ? `You have every ${name} card from ${season}.` : `You have every ${name} card.`)
  await sql`insert into wishes (user_id, name, season) values (${u.id}, ${name}, ${season}) on conflict do nothing`
}

export async function removeWish(sql, u, b) {
  await sql`delete from wishes where id = ${Number(b.id)} and user_id = ${u.id} and fulfilled_at is null`
}

// Names only, for the Wish buttons across the site
export const wishNames = (sql, userId) => sql`select id, name, season from wishes where user_id = ${userId} and fulfilled_at is null order by id`
