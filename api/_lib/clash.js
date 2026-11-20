// Full Court Clash, the Game Room's card table (src/clash/engine.js has the rules; scripts/build_clash.py the CPU decks).
// Every match runs here: the client sends its plays each turn and gets the reveal back, so a win can't be claimed from
// the browser. Your decks hold card ids from your binder and are checked against it whenever you save or play.
//
//   Franchise challenges  15 cards of that franchise only, at its courts (its arena, then old buildings it played in).
//                         Easy opens first; each win opens the next level. Beating Brutal unlocks the franchise
//                         redesign: one card from the deck that won wears one of four looks for good (card.clash).
//   All-time lineups      any deck, random courts. No reward yet.
//   Daily challenges      any deck, random courts, four CPU decks a day (the same for everyone). A win pulls one card
//                         from the pool: a Common on Easy, Rare on Medium, Standout on Hard, Legend on Brutal. Once a day each.
import { newMatch, playTurn, publicView, hydrate, dehydrate, cardFromBinder, cardFromRow, deckOf, dailyDeck, playable, venues, fcOf,
  FRANCHISES, LEVELS, LOCS, rng, shuffle, hash } from '../../src/clash/engine.js'
import { tierCard, refOf } from './packs.js'
import { cardPoints } from './points.js'
import { cardRewards } from './coins.js'

export const STYLES = ['floor', 'banner', 'foil', 'prog']
const PULL = { easy: 'common', medium: 'rare', hard: 'standout', brutal: 'legend' }
const fail = (status, message) => Object.assign(new Error(message), { status })

export async function ensureClashSchema(t) {
  await t`create table if not exists clash_users (user_id int primary key references users(id) on delete cascade,
    decks jsonb not null default '[]', active int not null default 0, teams jsonb not null default '{}', prog jsonb not null default '{}',
    daily jsonb not null default '{}', updated_at timestamptz not null default now())`
  await t`create table if not exists clash_matches (id bigserial primary key, user_id int not null references users(id) on delete cascade,
    mode text not null, key text not null, level text not null, fc text, deck bigint[] not null, state jsonb not null,
    winner text, created_at timestamptz not null default now(), done_at timestamptz)`
  await t`create index if not exists clash_matches_user on clash_matches (user_id, created_at desc)`
  await t`create table if not exists clash_claims (user_id int not null references users(id) on delete cascade, fc text not null,
    card_id bigint not null, style text not null, at timestamptz not null default now(), primary key (user_id, fc))`
}

// The Clash data files (refreshed nightly), cached per instance for an hour
const cache = {}
async function data(origin, file) {
  const c = cache[file]
  if (c && Date.now() - c.at < 36e5) return c.p
  const p = fetch(`${origin}/data/clash/${file}`, { signal: AbortSignal.timeout(20e3) }).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
  cache[file] = { at: Date.now(), p }
  p.catch(() => { delete cache[file] })
  return p.catch(() => { throw fail(503, 'Full Court Clash’s card data isn’t published yet.') })
}
const decksData = origin => data(origin, 'decks.json')
async function pairsMap(origin) {
  if (cache._pairs && Date.now() - cache._pairs.at < 36e5) return cache._pairs.m
  const m = new Map((await data(origin, 'pairs.json')).map(([a, b, n]) => [`${a}|${b}`, n]))
  cache._pairs = { at: Date.now(), m }
  return m
}

async function userRow(sql, uid) {
  const [r] = await sql`insert into clash_users (user_id) values (${uid}) on conflict (user_id) do update set user_id = excluded.user_id returning *`
  return r
}
// Your binder's playable cards by id, as Clash cards
async function myCards(sql, uid, origin, ids) {
  const rows = ids ? await sql`select id, card from cards where user_id = ${uid} and id = any(${ids.map(String)}::bigint[])`
    : await sql`select id, card from cards where user_id = ${uid}`
  const flags = await data(origin, 'flags.json').catch(() => ({}))
  return rows.filter(r => playable(r.card)).map(r => cardFromBinder(r.id, r.card, flags[`${r.card.s}|${r.card.id}|${r.card.row.n}`] || ''))
}
const unlocked = (prog, key, lv) => lv === 'easy' || !!prog?.[key]?.[LEVELS[LEVELS.indexOf(lv) - 1]]
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const dailyLocs = (day, lv) => shuffle(LOCS, rng(hash(`loc${day}${lv}`))).slice(0, 3).map(l => l.id)

export async function clashView(sql, u) {
  const r = await userRow(sql, u.id)
  const claims = Object.fromEntries((await sql`select fc, card_id, style from clash_claims where user_id = ${u.id}`).map(c => [c.fc, { card: Number(c.card_id), style: c.style }]))
  const [open] = await sql`select id, mode, key, level, fc, state from clash_matches where user_id = ${u.id} and done_at is null and created_at > now() - interval '1 day' order by id desc limit 1`
  const day = today()
  const pulls = r.daily[day] || {}
  const pullCards = Object.values(pulls).filter(Boolean)
  const pc = pullCards.length ? await sql`select id, card from cards where user_id = ${u.id} and id = any(${pullCards.map(String)}::bigint[])` : []
  return {
    decks: Array.from({ length: 5 }, (_, i) => r.decks[i] || null), active: r.active, teams: r.teams, prog: r.prog, claims, day,
    daily: Object.fromEntries(Object.entries(pulls).map(([lv, id]) => [lv, { id, card: pc.find(c => Number(c.id) === Number(id))?.card || null }])),
    open: open ? { id: Number(open.id), mode: open.mode, key: open.key, level: open.level, fc: open.fc, turn: open.state.turn } : null,
  }
}

// Save a deck: { slot 0–4, name, ids } or { team: fc, ids }. Fifteen different cards you own that can play
export async function saveDeck(sql, u, origin, b) {
  const ids = [...new Set((b.ids || []).map(Number).filter(Boolean))]
  if (ids.length !== 15) throw fail(400, 'A deck is 15 different cards.')
  const cs = await myCards(sql, u.id, origin, ids)
  if (cs.length !== 15) throw fail(400, 'Every card has to be a game card in your binder.')
  const r = await userRow(sql, u.id)
  if (b.team) {
    const fc = String(b.team)
    if (!FRANCHISES.includes(fc)) throw fail(400, 'Pick a franchise.')
    if (cs.some(c => c.fc !== fc)) throw fail(400, 'A franchise deck takes only that franchise’s cards.')
    await sql`update clash_users set teams = ${sql.json({ ...r.teams, [fc]: ids })}, updated_at = now() where user_id = ${u.id}`
  } else {
    const slot = Number(b.slot)
    if (!(slot >= 0 && slot < 5)) throw fail(400, 'Pick a deck slot.')
    const decks = Array.from({ length: 5 }, (_, i) => r.decks[i] || null)
    decks[slot] = { name: String(b.name || `Deck ${slot + 1}`).slice(0, 24), ids }
    const active = decks[r.active]?.ids?.length === 15 ? r.active : slot
    await sql`update clash_users set decks = ${sql.json(decks)}, active = ${active}, updated_at = now() where user_id = ${u.id}`
  }
  return clashView(sql, u)
}
export async function setActive(sql, u, b) {
  const r = await userRow(sql, u.id), slot = Number(b.slot)
  if (!r.decks[slot]?.ids?.length) throw fail(400, 'That slot is empty.')
  await sql`update clash_users set active = ${slot} where user_id = ${u.id}`
  return clashView(sql, u)
}

// Start a match: { mode: 'fr' | 'lineup' | 'daily', fc?, ln?, level, ids: your 15 card ids }
export async function startMatch(sql, u, origin, b) {
  const D = await decksData(origin), mode = String(b.mode), lv = String(b.level)
  if (!LEVELS.includes(lv)) throw fail(400, 'Pick a level.')
  const r = await userRow(sql, u.id)
  const ids = [...new Set((b.ids || []).map(Number).filter(Boolean))]
  if (ids.length !== 15) throw fail(400, 'A deck is 15 different cards.')
  const mine = await myCards(sql, u.id, origin, ids)
  if (mine.length !== 15) throw fail(400, 'Every card in the deck has to be a game card in your binder.')
  let cDeck, key, fc = null, locs = [], title
  const day = today()
  if (mode === 'fr') {
    fc = String(b.fc)
    if (!D.franchise[fc]) throw fail(400, 'Pick a franchise.')
    if (!unlocked(r.prog, fc, lv)) throw fail(409, 'Beat the level before this one first.')
    if (mine.some(c => c.fc !== fc)) throw fail(400, 'Franchise challenges take only that franchise’s cards.')
    cDeck = deckOf(D, D.franchise[fc][lv].ids); key = fc; locs = venues(fc); title = D.teams[fc]?.name || fc
  } else if (mode === 'lineup') {
    const L = D.lineups.find(x => x.id === String(b.ln))
    if (!L || !L[lv]) throw fail(400, 'Pick a lineup.')
    cDeck = deckOf(D, L[lv]); key = `L:${L.id}`; title = L.name
  } else if (mode === 'daily') {
    cDeck = dailyDeck(D, day, lv); key = `D:${day}`; locs = dailyLocs(day, lv); title = 'Daily challenge'
  } else throw fail(400, 'Pick a challenge.')
  const P = await pairsMap(origin)
  const names = [...new Set([...mine, ...cDeck].map(c => c.n))].sort()
  const pairs = {}
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const n = P.get(`${names[i]}|${names[j]}`); if (n) pairs[`${names[i]}|${names[j]}`] = n }
  const at100 = names.filter(n => D.at100.includes(n))
  const seed = (Math.random() * 2 ** 31) >>> 0
  const st = newMatch({ pDeck: mine, cDeck, locs, seed, pairs, at100, meta: { mode, key, level: lv, fc, title } })
  // One open match at a time: starting another forfeits the last
  await sql`update clash_matches set done_at = now(), winner = 'forfeit' where user_id = ${u.id} and done_at is null`
  const [m] = await sql`insert into clash_matches (user_id, mode, key, level, fc, deck, state) values (${u.id}, ${mode}, ${key}, ${lv}, ${fc}, ${ids.map(String)}::bigint[], ${sql.json(dehydrate(st))}) returning id`
  return { match: Number(m.id), title, mode, level: lv, fc, view: publicView(st) }
}
export async function matchView(sql, u, id) {
  const [m] = await sql`select * from clash_matches where id = ${Number(id)} and user_id = ${u.id}`
  if (!m) throw fail(404, 'That match isn’t yours.')
  const st = hydrate(m.state)
  return { match: Number(m.id), title: st.title, mode: m.mode, level: m.level, fc: m.fc, view: publicView(st), winner: m.winner }
}

// Play a turn: { match, plays: [{ k, li }] }. Returns the reveal steps and the new view; a finished match settles here
export async function playClashTurn(sql, u, origin, b) {
  const [m] = await sql`select * from clash_matches where id = ${Number(b.match)} and user_id = ${u.id}`
  if (!m) throw fail(404, 'That match isn’t yours.')
  if (m.done_at) throw fail(409, 'That match is over.')
  const turn0 = m.state.turn
  const st = hydrate(m.state)
  let steps
  try { steps = playTurn(st, b.plays) } catch (e) { throw fail(400, e.message) }
  const done = !!st.over
  const winner = done ? (st.over.winner || 'draw') : null
  let reward = null
  await sql.begin(async t => {
    const [x] = await t`update clash_matches set state = ${t.json(dehydrate(st))}, done_at = case when ${done} then now() else null end, winner = ${winner}
      where id = ${m.id} and done_at is null and (state->>'turn')::int = ${turn0} returning id`
    if (!x) throw fail(409, 'That turn was already played. Reload the match.')
    if (winner === 'p') reward = await settleWin(t, u, origin, m)
  })
  if (reward?.awards?.length) reward.awards = reward.awards.filter(Boolean)
  return { steps, view: publicView(st), over: st.over, reward, ...(done ? { clash: await clashView(sql, u) } : {}) }
}
async function settleWin(t, u, origin, m) {
  const [r] = await t`select * from clash_users where user_id = ${u.id} for update`
  if (m.mode === 'daily') {
    const day = m.key.slice(2), d = r.daily[day] || {}
    if (d[m.level]) return { kind: 'daily', already: true }
    const taken = new Set((await t`select ref from cards where user_id = ${u.id}`).map(x => x.ref))
    const card = await tierCard(origin, PULL[m.level], taken)
    if (!card) return { kind: 'daily', none: true }
    const pts = cardPoints(card).points
    const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${u.id}, null, ${card.tier}, ${refOf(card)}, ${t.json(card)}, ${pts}, 'clash')
      on conflict (user_id, ref) do nothing returning id`
    const daily = Object.fromEntries(Object.entries({ ...r.daily, [day]: { ...d, [m.level]: row ? Number(row.id) : 0 } }).sort().slice(-7))
    await t`update clash_users set daily = ${t.json(daily)} where user_id = ${u.id}`
    const awards = row ? await cardRewards(t, u.id, day, origin, card).catch(() => []) : []
    return { kind: 'daily', card: row ? { id: Number(row.id), card } : null, awards }
  }
  const prog = { ...r.prog, [m.key]: { ...(r.prog[m.key] || {}), [m.level]: true } }
  await t`update clash_users set prog = ${t.json(prog)} where user_id = ${u.id}`
  if (m.mode === 'fr') {
    const nx = LEVELS[LEVELS.indexOf(m.level) + 1]
    if (nx) return { kind: 'unlock', level: nx }
    const [c] = await t`select 1 from clash_claims where user_id = ${u.id} and fc = ${m.fc}`
    return { kind: 'redesign', fc: m.fc, claimed: !!c, match: Number(m.id) }
  }
  return { kind: 'lineup' }
}

// Claim a franchise redesign: { fc, card, style }. The card has to be in a deck that beat that franchise's Brutal
export async function claimRedesign(sql, u, b) {
  const fc = String(b.fc), card = Number(b.card), style = String(b.style)
  if (!STYLES.includes(style)) throw fail(400, 'Pick a look.')
  const [won] = await sql`select 1 from clash_matches where user_id = ${u.id} and mode = 'fr' and fc = ${fc} and level = 'brutal' and winner = 'p' and ${String(card)}::bigint = any(deck) limit 1`
  if (!won) throw fail(409, 'Only a card from a deck that beat this franchise on Brutal can wear its redesign.')
  await sql.begin(async t => {
    const [x] = await t`insert into clash_claims (user_id, fc, card_id, style) values (${u.id}, ${fc}, ${card}, ${style}) on conflict do nothing returning fc`
    if (!x) throw fail(409, 'You’ve already claimed this franchise’s redesign.')
    const [c] = await t`update cards set card = card || ${t.json({ clash: { fc, style } })} where id = ${card} and user_id = ${u.id} returning id`
    if (!c) throw fail(404, 'That card isn’t in your binder.')
  })
  return clashView(sql, u)
}
