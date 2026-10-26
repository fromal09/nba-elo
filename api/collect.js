// The card collection: accounts, packs (pick one of three per slot), your cards, your profile.
// One function routes every action (?action=...), which keeps the project under Vercel's function limit.
//
//   GET  me          the signed-in user, pack status, the big-pull meter, stats ({ user: null } signed out)
//   POST signup      { username, password }
//   POST login       { username, password }
//   POST logout
//   POST claim       today's pack (plus the streak bonus on every 7th day in a row) -> { packs }
//   POST team        { team } this week's team pack -> { packs }
//   GET  pack        ?id= one pack: its offers and the picks so far
//   POST pick        { pack, slot, choice } keep one card of the slot's three
//   GET  collection  every card you own, newest first
//   POST star        { id, on } add a card to (or take it out of) your Starred binder
//   POST showcase    { id, on } put a starred card in (or take it out of) your three-card showcase
//   POST profile     { favoriteTeam }
import { db, ensureSchema } from './_lib/db.js'
import { USERNAME, hashPassword, checkPassword, startSession, endSession, currentUser } from './_lib/auth.js'
import { buildOffers, recentDate, teamCodes, refOf, BIG, PITY_EVERY, TIER_ORDER } from './_lib/packs.js'

const STREAK_EVERY = 7
// Packs reset at midnight Eastern, with the NBA's day; team packs reset Monday
const etDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const weekStart = day => addDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7))
const iso = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
const fail = (status, message) => Object.assign(new Error(message), { status })

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  const chunks = []
  for await (const c of req) chunks.push(c)
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { return {} }
}

// The streak as it stands today: it continues if the last claim was yesterday or today
const streakNow = (u, today) => { const last = iso(u.last_claim); return last === today || last === addDays(today, -1) ? u.streak : 0 }

// A pack as the client sees it
const packView = p => ({ id: p.id, kind: p.kind, team: p.team, day: iso(p.day), pity: p.pity, status: p.status, picks: p.picks, slots: p.slots })

async function me(u) {
  if (!u) return { user: null }
  const sql = db()
  const today = etDay(), week = weekStart(today)
  const claimed = iso(u.last_claim) === today
  const streak = streakNow(u, today)
  const next = claimed ? streak : streak + 1
  const tierRows = await sql`select tier, count(*)::int as n from cards where user_id = ${u.id} group by tier`
  const best = await sql`select id, card from cards where user_id = ${u.id}
    order by array_position(${TIER_ORDER}::text[], tier) desc, (card->'row'->>'gs')::float desc nulls last limit 1`
  const show = u.showcase?.length ? await sql`select id, card from cards where user_id = ${u.id} and id = any(${u.showcase.map(String)}::bigint[])` : []
  const open = await sql`select id, kind, team, array_length(picks, 1) as picked, jsonb_array_length(slots) as total from packs
    where user_id = ${u.id} and status = 'open' order by id`
  const [teamClaim] = await sql`select 1 from claims where user_id = ${u.id} and day = ${week} and kind = 'team'`
  return {
    user: { username: u.username, favoriteTeam: u.favorite_team, joined: iso(u.created_at), starred: u.starred.map(Number), showcaseIds: u.showcase.map(Number),
      showcase: u.showcase.map(Number).map(id => show.find(c => Number(c.id) === id)).filter(Boolean).map(c => ({ id: Number(c.id), card: c.card })) },
    // untilBonus: daily packs to open (today's included) until the next streak bonus
    today: { day: today, claimed, streak, every: STREAK_EVERY, bonusToday: !claimed && next % STREAK_EVERY === 0,
      untilBonus: claimed ? STREAK_EVERY - (streak % STREAK_EVERY) : ((STREAK_EVERY - (next % STREAK_EVERY)) % STREAK_EVERY) + 1 },
    week: { start: week, next: addDays(week, 7), claimed: !!teamClaim },
    // Packs finished since the last Legend-or-better pick; the pack that reaches the limit guarantees one
    meter: { since: u.since_big, every: PITY_EVERY, until: Math.max(1, PITY_EVERY - u.since_big) },
    open: open.map(p => ({ id: p.id, kind: p.kind, team: p.team, picked: p.picked || 0, total: p.total })),
    stats: { cards: tierRows.reduce((a, r) => a + r.n, 0), tiers: Object.fromEntries(tierRows.map(r => [r.tier, r.n])),
      best: best[0] ? { id: Number(best[0].id), card: best[0].card } : null },
  }
}

// Every card a new pack must not offer: owned, or on offer in another open pack
async function takenRefs(sql, u) {
  const owned = await sql`select ref from cards where user_id = ${u.id}`
  const offered = await sql`select slots from packs where user_id = ${u.id} and status = 'open'`
  const set = new Set(owned.map(r => r.ref))
  offered.forEach(p => p.slots.forEach(s => s.cards.forEach(c => set.add(refOf(c)))))
  return { set, openNoPity: offered.length }
}

async function makePacks(sql, u, origin, kinds, team) {
  const { set, openNoPity } = await takenRefs(sql, u)
  const out = []
  let packsAhead = openNoPity // open packs that will finish before this one
  for (const kind of kinds) {
    const pity = u.since_big + packsAhead >= PITY_EVERY - 1
    const offers = await buildOffers(origin, kind, { taken: set, team, pity })
    offers.slots.forEach(s => s.cards.forEach(c => set.add(refOf(c))))
    out.push({ kind, team: team || null, pity: offers.pity, slots: offers.slots })
    packsAhead = pity ? 0 : packsAhead + 1
  }
  return out
}

async function claimDaily(u, origin) {
  const sql = db()
  const today = etDay()
  if (iso(u.last_claim) === today) throw fail(409, 'Today’s pack is already open. A new one arrives at midnight Eastern.')
  const next = streakNow(u, today) + 1
  const built = await makePacks(sql, u, origin, ['daily', ...(next % STREAK_EVERY === 0 ? ['streak'] : [])])
  const packs = await sql.begin(async t => {
    const got = await t`insert into claims (user_id, day, kind) values (${u.id}, ${today}, 'daily') on conflict do nothing returning day`
    if (!got.length) throw fail(409, 'Today’s pack is already open.')
    await t`update users set streak = ${next}, last_claim = ${today} where id = ${u.id}`
    const rows = []
    for (const p of built) rows.push((await t`insert into packs (user_id, kind, day, slots, pity) values (${u.id}, ${p.kind}, ${today}, ${t.json(p.slots)}, ${p.pity}) returning *`)[0])
    return rows
  })
  const [fresh] = await sql`select * from users where id = ${u.id}`
  return { packs: packs.map(packView), ...(await me(fresh)) }
}

async function claimTeam(u, origin, team) {
  const sql = db()
  const codes = await teamCodes(origin)
  if (!codes.includes(team)) throw fail(400, 'Pick a team for this week’s pack.')
  const week = weekStart(etDay())
  const [done] = await sql`select 1 from claims where user_id = ${u.id} and day = ${week} and kind = 'team'`
  if (done) throw fail(409, 'This week’s team pack is already open. A new one arrives Monday.')
  const [built] = await makePacks(sql, u, origin, ['team'], team)
  const [pack] = await sql.begin(async t => {
    const got = await t`insert into claims (user_id, day, kind) values (${u.id}, ${week}, 'team') on conflict do nothing returning day`
    if (!got.length) throw fail(409, 'This week’s team pack is already open.')
    return t`insert into packs (user_id, kind, day, team, slots, pity) values (${u.id}, 'team', ${week}, ${team}, ${t.json(built.slots)}, ${built.pity}) returning *`
  })
  const [fresh] = await sql`select * from users where id = ${u.id}`
  return { packs: [packView(pack)], ...(await me(fresh)) }
}

async function pick(u, b) {
  const sql = db()
  const packId = Number(b.pack), slot = Number(b.slot), choice = Number(b.choice)
  const result = await sql.begin(async t => {
    const [p] = await t`select * from packs where id = ${packId} and user_id = ${u.id} for update`
    if (!p) throw fail(404, 'That pack isn’t yours.')
    if (p.status !== 'open') throw fail(409, 'That pack is finished.')
    if (slot !== p.picks.length) throw fail(409, 'Pick the cards in order.')
    const c = p.slots[slot]?.cards[choice]
    if (!c) throw fail(400, 'Pick one of the three cards.')
    const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card) values (${u.id}, ${p.id}, ${c.tier}, ${refOf(c)}, ${t.json(c)})
      on conflict (user_id, ref) do nothing returning id`
    const picks = [...p.picks, choice]
    const done = picks.length === p.slots.length
    const big = picks.some((k, i) => BIG.has(p.slots[i].cards[k]?.tier))
    if (BIG.has(c.tier)) await t`update users set since_big = 0 where id = ${u.id}`
    else if (done && !big) await t`update users set since_big = since_big + 1 where id = ${u.id}`
    const [np] = await t`update packs set picks = ${picks}, status = ${done ? 'done' : 'open'}, done_at = ${done ? new Date() : null}
      where id = ${p.id} returning *`
    return { pack: np, cardId: row ? Number(row.id) : null }
  })
  const [fresh] = await sql`select * from users where id = ${u.id}`
  return { pack: packView(result.pack), cardId: result.cardId, ...(await me(fresh)) }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams)
  const action = q.action
  const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
  try {
    await ensureSchema()
    const sql = db()
    const origin = process.env.DATA_ORIGIN || `${(req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`
    const post = req.method === 'POST'
    if (action === 'me') return send(200, { ...(await me(await currentUser(req))), lastNight: await recentDate(origin).catch(() => null) })

    if (post && (action === 'signup' || action === 'login')) {
      const { username = '', password = '' } = await readBody(req)
      const name = String(username).trim(), key = name.toLowerCase()
      if (action === 'signup') {
        if (!USERNAME.test(name)) throw fail(400, 'Usernames are 3–20 letters, numbers or underscores.')
        if (String(password).length < 8) throw fail(400, 'Use a password of at least 8 characters.')
        const hash = await hashPassword(String(password))
        const [u] = await sql`insert into users (username, username_key, pass_hash) values (${name}, ${key}, ${hash})
          on conflict (username_key) do nothing returning *`
        if (!u) throw fail(409, 'That username is taken.')
        await startSession(res, req, u.id)
        return send(200, await me(u))
      }
      const [u] = await sql`select * from users where username_key = ${key}`
      if (!u || !(await checkPassword(String(password), u.pass_hash))) throw fail(401, 'Wrong username or password.')
      await startSession(res, req, u.id)
      return send(200, await me(u))
    }
    if (post && action === 'logout') { await endSession(res, req); return send(200, { user: null }) }

    const u = await currentUser(req)
    if (!u) throw fail(401, 'Sign in first.')
    if (post && action === 'claim') return send(200, await claimDaily(u, origin))
    if (post && action === 'team') return send(200, await claimTeam(u, origin, String((await readBody(req)).team || '')))
    if (post && action === 'pick') return send(200, await pick(u, await readBody(req)))
    if (action === 'pack') {
      const [p] = await sql`select * from packs where id = ${Number(q.id)} and user_id = ${u.id}`
      if (!p) throw fail(404, 'That pack isn’t yours.')
      return send(200, { pack: packView(p) })
    }
    if (action === 'collection') {
      const rows = await sql`select c.id, c.card, c.pulled_at, p.kind from cards c join packs p on p.id = c.pack_id
        where c.user_id = ${u.id} order by c.id desc`
      return send(200, { cards: rows.map(r => ({ id: Number(r.id), card: r.card, pulled: r.pulled_at, pack: r.kind })) })
    }
    if (post && action === 'star') {
      const b = await readBody(req), id = Number(b.id)
      const [own] = await sql`select 1 from cards where user_id = ${u.id} and id = ${id}`
      if (!own) throw fail(404, 'That card isn’t in your binder.')
      const cur = u.starred.map(Number).filter(x => x !== id)
      const next = b.on ? [...cur, id].slice(-2000) : cur
      // Unstarring a card takes it out of the showcase too
      const show = u.showcase.map(Number).filter(x => next.includes(x))
      const [fresh] = await sql`update users set starred = ${next.map(String)}::bigint[], showcase = ${show.map(String)}::bigint[] where id = ${u.id} returning *`
      return send(200, await me(fresh))
    }
    if (post && action === 'showcase') {
      const b = await readBody(req), id = Number(b.id)
      if (!u.starred.map(Number).includes(id)) throw fail(400, 'Star the card first; the showcase holds starred cards.')
      const cur = u.showcase.map(Number).filter(x => x !== id)
      if (b.on && cur.length >= 3) throw fail(409, 'Your showcase holds three cards. Take one out first.')
      const next = b.on ? [...cur, id] : cur
      const [fresh] = await sql`update users set showcase = ${next.map(String)}::bigint[] where id = ${u.id} returning *`
      return send(200, await me(fresh))
    }
    if (post && action === 'profile') {
      const b = await readBody(req)
      const team = b.favoriteTeam ? String(b.favoriteTeam).slice(0, 8) : null
      const [fresh] = await sql`update users set favorite_team = ${team} where id = ${u.id} returning *`
      return send(200, await me(fresh))
    }
    throw fail(404, 'Unknown action.')
  } catch (e) {
    const status = e.status || 500
    if (status === 500) console.error(e)
    return send(status, { error: status === 500 ? 'Something went wrong. Try again.' : e.message })
  }
}
