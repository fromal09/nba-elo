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
//   GET  leaders     the top binders by score, and where yours ranks
//   GET  topcards    the highest-point cards in anyone's binder, and the best pulls of the last 24 hours
//   GET  binder      ?user= anyone's binder, read-only: profile, score, rank, showcase, cards
//   POST explore     { section } Coins for visiting a part of the site (10 each, 60 a day)
//   GET  store       the catalog, today's On This Day cards, your Coins, today's earnings, recent sales
//   POST buy         { kind, team } buy a pack with Coins -> { packs }
//   POST buycard     { ref } buy one of today's On This Day cards
//   POST sell        { id, confirm } sell a card for 20% of its points (24 hours after you got it, 500 Coins a day)
//   POST buyback     { id } buy a sold card back at its sale price, within 24 hours
//   GET  predictions today's and tomorrow's slates with your picks, your history and stats (grades finished games)
//   POST predict     { game, team } pick a winner; changeable until that game tips off
//   POST lock        { game, on } make that pick your Lock of the Day (movable until its game tips off)
//   POST duelpick    { game, player } who posts the higher Game Score in the game's top player matchup
//   POST lineup      { day, slot, card } put a player from your binder in a lineup slot (card: null empties it)
//   GET  potw        ?day= that day's week: the Player of the Week race (top 20) or the settled card, and the pick'em race
//   GET  challenge   this week's three Five challenges (easy, medium, hard), your lineups and their percentiles
//   POST challengeset { level, ids } your five cards for a challenge (ids: [] clears it)
//   POST potdpick    { day, player, team } your Player of the Day nomination (player: '' takes it back), until the first tipoff
//   GET  standings   ?scope=week|season pick'em points, and where you rank
//   GET  predreward  ?day=&kind=games|duels the cards you can choose from for a day you earned one
//   POST claimpred   { day, ref, kind } keep that card
//   GET  wishes      ?user= your wish list (or anyone's): each wish's progress and its meter per tier
//   GET  wishcards   ?name=&season= a player's cards by tier (and yours), and his seasons, for choosing a wish
//   POST wish        { name, season?, tier? } wish for a player: any card, or one season's, or one tier's (three at a time)
//   POST unwish      { id } take a wish off
import { db, ensureSchema } from './_lib/db.js'
import { USERNAME, hashPassword, checkPassword, startSession, endSession, currentUser } from './_lib/auth.js'
import { upgradePoints, pointsStatus, seasonDetails } from './_lib/rescore.js'
import { loadWishes, applyWishes, resetMeters, tickMeters, wishView, addWish, removeWish, wishNames, wishCards, warmWishes } from './_lib/wishes.js'
import { buildOffers, recentDate, teamCodes, refOf, BIG, PITY_EVERY, TIER_ORDER, ERAS, SPECIAL_KINDS } from './_lib/packs.js'
import { cardPoints } from './_lib/points.js'
import { RATES, SECTIONS, grant, tryChallenge, challengeFor, cardRewards, forgeSeasons, warmRewards, backfillSets } from './_lib/coins.js'
import { catalog, featured, eraOfWeek, PACK_PRICES } from './_lib/store.js'
import { potwWeek, potdPick, settlePotw, predDay, settle, predSummary, predView, predict, setLock, duelPick, setLineup, standings, settlePickWeek, rewardOptions, claimReward, PRED } from './_lib/predictions.js'
import { achievements } from './_lib/achievements.js'
import { challengeView, setChallenge, settleChallenges } from './_lib/challenge.js'
import { slate } from './_lib/slate.js'

const STREAK_EVERY = 7
// The NBA's day is Eastern; team packs reset Monday. The daily pack follows packDay() below
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

// The daily pack's day. A new day's pack waits until last night's games are all final and in the card pool (the nightly
// data update publishes them), so its "last night" cards really are last night's. Until then the pack day is still
// yesterday. Nights without games don't wait, and by noon Eastern the new pack opens whatever the data says.
let ORIGIN = null
let potwTried = 0
let packDayMemo = { day: null, v: null, at: 0 }
const etHour = () => +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date())
async function packDay() {
  const today = etDay()
  if (packDayMemo.day === today && (packDayMemo.v === today || Date.now() - packDayMemo.at < 60e3)) return packDayMemo.v
  let v = today
  const y = addDays(today, -1)
  if (etHour() < 12 && ORIGIN) {
    const rd = await recentDate(ORIGIN, 2 * 60e3).catch(() => null)
    if (!rd || rd < y) {
      const games = await slate(db(), y).catch(() => null)
      if (!games || games.some(g => g.state !== 'off')) v = y
    }
  }
  packDayMemo = { day: today, v, at: Date.now() }
  return v
}

// The streak as it stands today: it continues if the last claim was yesterday or today
const streakNow = (u, today) => { const last = iso(u.last_claim); return last === today || last === addDays(today, -1) ? u.streak : 0 }

// A pack as the client sees it
const packView = p => ({ id: p.id, kind: p.kind, team: p.team, day: iso(p.day), pity: p.pity, status: p.status, picks: p.picks, slots: p.slots })

// A binder's score and rank among every binder with a card (ties share a rank)
// Serial numbers: each copy's order among everyone who owns that card (first kept = #1), and how many own it
async function serials(sql, userId) {
  const rows = await sql`select id, k::int, n::int from (select id, user_id, row_number() over (partition by ref order by pulled_at, id) as k, count(*) over (partition by ref) as n
      from cards where ref in (select ref from cards where user_id = ${userId})) x where user_id = ${userId}`
  return new Map(rows.map(r => [Number(r.id), [r.k, r.n]]))
}

// Binder score and rank at the end of each week (Monday to Sunday, Eastern), for the last year. A card counts from the
// week it was kept; a sold card counts until the week it was sold (sales before score history began aren't known).
async function scoreHistory(sql, userId) {
  const rows = await sql`
    with held as (
      select user_id, points, pulled_at as a, null::timestamptz as b from cards
      union all select user_id, points, pulled_at, sold_at from sold where pulled_at is not null),
    weeks as (
      select generate_series(
        greatest(date_trunc('week', (select min(a) from held where user_id = ${userId}) at time zone 'America/New_York'), date_trunc('week', now() at time zone 'America/New_York') - interval '51 weeks'),
        date_trunc('week', now() at time zone 'America/New_York'), interval '1 week')::date as w),
    s as (
      select w.w, h.user_id, sum(h.points)::int as score from weeks w
      join held h on h.a at time zone 'America/New_York' < w.w + 7 and (h.b is null or h.b at time zone 'America/New_York' >= w.w + 7)
      group by 1, 2),
    r as (select w, user_id, score, rank() over (partition by w order by score desc)::int as rk, count(*) over (partition by w)::int as n from s)
    select w, score, rk, n from r where user_id = ${userId} order by w`
  return rows.map(x => ({ week: iso(x.w), score: x.score, rank: x.rk, of: x.n }))
}

async function standing(sql, userId) {
  const [r] = await sql`with s as (select user_id, sum(points)::int as score, count(*)::int as cards, count(distinct card->'row'->>'n')::int as players
      from cards group by user_id)
    select coalesce((select score from s where user_id = ${userId}), 0) as score,
      coalesce((select cards from s where user_id = ${userId}), 0) as cards,
      coalesce((select players from s where user_id = ${userId}), 0) as players,
      (select count(*)::int from s) as of`
  const [above] = await sql`select count(*)::int as n from (select sum(points) as score from cards group by user_id) x where score > ${r.score}`
  return { score: r.score, cards: r.cards, players: r.players, rank: r.score > 0 ? above.n + 1 : null, of: r.of }
}

async function me(u) {
  if (!u) return { user: null }
  const sql = db()
  const today = etDay(), week = weekStart(today)
  const pday = await packDay()
  const claimed = iso(u.last_claim) === pday
  const streak = streakNow(u, pday)
  const next = claimed ? streak : streak + 1
  const tierRows = await sql`select tier, count(*)::int as n from cards where user_id = ${u.id} group by tier`
  const best = await sql`select id, card from cards where user_id = ${u.id}
      and tier = any(${TIER_ORDER}) order by array_position(${TIER_ORDER}::text[], tier) desc, (card->'row'->>'gs')::float desc nulls last limit 1`
  const show = u.showcase?.length ? await sql`select id, card from cards where user_id = ${u.id} and id = any(${u.showcase.map(String)}::bigint[])` : []
  const open = await sql`select id, kind, team, array_length(picks, 1) as picked, jsonb_array_length(slots) as total from packs
    where user_id = ${u.id} and status = 'open' order by id`
  const [teamClaim] = await sql`select 1 from claims where user_id = ${u.id} and day = ${week} and kind = 'team'`
  return {
    user: { username: u.username, favoriteTeam: u.favorite_team, joined: iso(u.created_at), starred: u.starred.map(Number), showcaseIds: u.showcase.map(Number),
      showcase: u.showcase.map(Number).map(id => show.find(c => Number(c.id) === id)).filter(Boolean).map(c => ({ id: Number(c.id), card: c.card })) },
    // untilBonus: daily packs to open (today's included) until the next streak bonus
    // waiting: today's pack is held until last night's games are in the data (claimed is yesterday's pack then)
    today: { day: pday, waiting: pday !== today, claimed, streak, every: STREAK_EVERY, bonusToday: !claimed && next % STREAK_EVERY === 0,
      untilBonus: claimed ? STREAK_EVERY - (streak % STREAK_EVERY) : ((STREAK_EVERY - (next % STREAK_EVERY)) % STREAK_EVERY) + 1 },
    week: { start: week, next: addDays(week, 7), claimed: !!teamClaim },
    // Packs finished since the last Legend-or-better pick; the pack that reaches the limit guarantees one
    meter: { since: u.since_big, every: PITY_EVERY, until: Math.max(1, PITY_EVERY - u.since_big) },
    open: open.map(p => ({ id: p.id, kind: p.kind, team: p.team, picked: p.picked || 0, total: p.total })),
    stats: { cards: tierRows.reduce((a, r) => a + r.n, 0), tiers: Object.fromEntries(tierRows.map(r => [r.tier, r.n])),
      best: best[0] ? { id: Number(best[0].id), card: best[0].card } : null },
    standing: await standing(sql, u.id),
    coins: { balance: u.coins, ...(await earnings(sql, u.id, today)) },
    predict: await predSummary(sql, u.id, today),
    achievements: await achievements(sql, u.id),
    wishes: (await wishNames(sql, u.id)).map(w => ({ id: w.id, name: w.name, season: w.season, tier: w.tier || null })),
  }
}

// Today's Coins by kind, against the caps, and the day's challenge
async function earnings(sql, userId, day) {
  const rows = await sql`select kind, sum(amount)::int as n from coin_ledger where user_id = ${userId} and day = ${day} group by kind`
  const by = Object.fromEntries(rows.map(r => [r.kind, r.n]))
  const ch = challengeFor(day)
  return { today: by, earned: rows.filter(r => r.n > 0 && !['sell', 'buyback', 'store'].includes(r.kind)).reduce((a, r) => a + r.n, 0),
    explore: { got: by.explore || 0, cap: RATES.exploreCap }, sold: { got: by.sell || 0, cap: RATES.sellCap },
    challenge: { text: ch.text, done: !!by.challenge, coins: RATES.challenge } }
}

// The first visit of the day: Coins for showing up, more for a streak; and last week's leaderboard payouts
async function visit(u, origin) {
  const sql = db(), today = etDay(), awards = []
  await settleWeek(sql, today)
  await settlePickWeek(sql, origin, today).catch(e => console.error('pick week', e))
  await sql.begin(async t => {
    const a = await grant(t, u.id, today, 'visit', RATES.visit, { ref: today })
    if (a) {
      awards.push(a)
      const st = streakNow(u, today)
      const b = st && await grant(t, u.id, today, 'streak', Math.min(RATES.streakMax, st * RATES.streakPer), { ref: today, label: `${st}-day streak bonus` })
      if (b) awards.push(b)
      // A weekly payout made today shows with the first visit
      const [w] = await t`select amount from coin_ledger where user_id = ${u.id} and kind = 'weekly' and day = ${today}`
      if (w) awards.push({ kind: 'weekly', amount: w.amount, label: 'Last week’s leaderboard finish' })
      const [pw] = await t`select amount from coin_ledger where user_id = ${u.id} and kind = 'pickweekly' and day = ${today}`
      if (pw) awards.push({ kind: 'pickweekly', amount: pw.amount, label: 'Last week’s pick’em finish' })
    }
  })
  return awards
}
// Pays last week's top 10 (500 Coins) and top 50 (200) once, the first time anyone visits in the new week
async function settleWeek(sql, today) {
  const last = addDays(weekStart(today), -7)
  const [first] = await sql`insert into settlements (week) values (${last}) on conflict do nothing returning week`
  if (!first) return
  const rows = await sql`select user_id, sum(points)::int as score from cards group by user_id order by score desc limit 50`
  await sql.begin(async t => {
    for (const [i, r] of rows.entries()) {
      await grant(t, r.user_id, today, 'weekly', i < 10 ? RATES.weeklyTop10 : RATES.weeklyTop50, { ref: last, label: `Week of ${last}: No. ${i + 1}` })
    }
  })
}

// Every card a new pack must not offer: owned, or on offer in another open pack
async function takenRefs(sql, u) {
  const owned = await sql`select ref from cards where user_id = ${u.id}`
  const offered = await sql`select slots from packs where user_id = ${u.id} and status = 'open'`
  const set = new Set(owned.map(r => r.ref))
  offered.forEach(p => p.slots.forEach(s => s.cards.forEach(c => set.add(refOf(c)))))
  return { set, openNoPity: offered.length }
}

async function makePacks(sql, u, origin, kinds, team, era) {
  const { set, openNoPity } = await takenRefs(sql, u)
  const out = []
  let packsAhead = openNoPity // open packs that will finish before this one
  const wishes = await loadWishes(sql, u.id, origin).catch(e => { console.error('wishes', e); return [] })
  const granted = []
  for (const kind of kinds) {
    const pity = u.since_big + packsAhead >= PITY_EVERY - 1
    const offers = await buildOffers(origin, kind, { taken: set, team, pity, era })
    granted.push(...await applyWishes(origin, offers.slots, wishes, { taken: set, team }).catch(e => { console.error('wish swap', e); return [] }))
    offers.slots.forEach(s => s.cards.forEach(c => set.add(refOf(c))))
    out.push({ kind, team: team || null, pity: offers.pity, slots: offers.slots })
    packsAhead = pity ? 0 : packsAhead + 1
  }
  if (granted.length) await resetMeters(sql, granted).catch(e => console.error('wish meters', e))
  return out
}

async function claimDaily(u, origin) {
  const sql = db()
  const today = await packDay()
  if (iso(u.last_claim) === today) throw fail(409, today !== etDay() ? 'Your next pack opens once last night’s games are final and in the data.' : 'Today’s pack is already open. The next one arrives after tonight’s games are final.')
  const next = streakNow(u, today) + 1
  const built = await makePacks(sql, u, origin, ['daily', ...(next % STREAK_EVERY === 0 ? ['streak'] : [])])
  const packs = await sql.begin(async t => {
    const got = await t`insert into claims (user_id, day, kind) values (${u.id}, ${today}, 'daily') on conflict do nothing returning day`
    if (!got.length) throw fail(409, 'Today’s pack is already open.')
    await t`update users set streak = ${next}, best_streak = greatest(best_streak, ${next}), last_claim = ${today} where id = ${u.id}`
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

async function pick(u, b, origin) {
  const sql = db()
  const today = etDay()
  const packId = Number(b.pack), slot = Number(b.slot), choice = Number(b.choice)
  // Everything the pick will read from the data files, fetched before the transaction holds the database
  const [peek] = await sql`select slots from packs where id = ${packId} and user_id = ${u.id}`
  const chosen = peek?.slots?.[slot]?.cards?.[choice]
  await Promise.all([warmRewards(origin, chosen), warmWishes(sql, u.id, origin), seasonDetails(origin, '', '', '')]).catch(() => {})
  const result = await sql.begin(async t => {
    const [p] = await t`select * from packs where id = ${packId} and user_id = ${u.id} for update`
    if (!p) throw fail(404, 'That pack isn’t yours.')
    if (p.status !== 'open') throw fail(409, 'That pack is finished.')
    if (slot !== p.picks.length) throw fail(409, 'Pick the cards in order.')
    const c = p.slots[slot]?.cards[choice]
    if (!c) throw fail(400, 'Pick one of the three cards.')
    const pts = cardPoints(c).points
    const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${u.id}, ${p.id}, ${SPECIAL_KINDS.has(c.kind) ? c.kind : c.tier}, ${refOf(c)}, ${t.json(c)}, ${pts}, ${p.kind})
      on conflict (user_id, ref) do nothing returning id`
    const picks = [...p.picks, choice]
    const done = picks.length === p.slots.length
    const big = picks.some((k, i) => BIG.has(p.slots[i].cards[k]?.tier))
    if (BIG.has(c.tier)) await t`update users set since_big = 0 where id = ${u.id}`
    else if (done && !big) await t`update users set since_big = since_big + 1 where id = ${u.id}`
    const [np] = await t`update packs set picks = ${picks}, status = ${done ? 'done' : 'open'}, done_at = ${done ? new Date() : null}
      where id = ${p.id} returning *`
    // Coins for the pick
    const awards = []
    const push = a => a && (Array.isArray(a) ? awards.push(...a) : awards.push(a))
    if (row && BIG.has(c.tier)) push(await grant(t, u.id, today, 'big', RATES.big, { ref: refOf(c), label: `Kept a ${c.tier === 'goat' ? '★ GOAT' : c.tier[0].toUpperCase() + c.tier.slice(1)}` }))
    if (done) push(await grant(t, u.id, today, 'pack', RATES.pack, { ref: String(p.id) }))
    push(await tryChallenge(t, u.id, today, 'card', c, pts))
    if (done) push(await tryChallenge(t, u.id, today, 'pack'))
    if (row && !c.kind) push(await cardRewards(t, u.id, today, origin, c))
    if (row && !c.kind) push(await tickMeters(t, u.id, origin, c))
    return { pack: np, cardId: row ? Number(row.id) : null, awards }
  })
  const [fresh] = await sql`select * from users where id = ${u.id}`
  return { pack: packView(result.pack), cardId: result.cardId, awards: result.awards, ...(await me(fresh)) }
}

// ── The store ───────────────────────────────────────────────────────────────
async function storeView(sql, u, origin) {
  const today = etDay()
  const f = await featured(origin, today)
  const owned = new Set((await sql`select ref from cards where user_id = ${u.id} and ref = any(${f.cards.map(x => refOf(x.card))})`).map(r => r.ref))
  const sold = await sql`select id, card, points, price, sold_at from sold where user_id = ${u.id} and not bought_back
    and sold_at > now() - ${RATES.buybackHours + ' hours'}::interval order by id desc`
  const mine = new Set((await sql`select ref from cards where user_id = ${u.id} and ref = any(${sold.map(r => refOf(r.card))})`).map(r => r.ref))
  return {
    day: today, next: addDays(today, 1), era: eraOfWeek(today), packs: catalog(today),
    featured: { random: f.random, partial: f.partial, cards: f.cards.map(x => ({ ...x, owned: owned.has(refOf(x.card)) })) },
    sold: sold.map(r => ({ id: Number(r.id), card: r.card, points: r.points, price: r.price, soldAt: r.sold_at, owned: mine.has(refOf(r.card)) })),
    rates: { ...RATES, pred: PRED },
  }
}

async function buyPack(u, origin, b) {
  const sql = db(), today = etDay()
  const item = catalog(today).find(x => x.kind === b.kind)
  if (!item) throw fail(400, 'That pack isn’t in the store.')
  let team = null
  if (item.team) {
    team = String(b.team || '')
    if (!(await teamCodes(origin)).includes(team)) throw fail(400, 'Pick a team for the Team Pack.')
  }
  if (u.coins < item.price) throw fail(402, `You need ${(item.price - u.coins).toLocaleString()} more Coins for the ${item.name}.`)
  const era = item.era ? ERAS.find(e => e.id === item.era) : null
  const [built] = await makePacks(sql, u, origin, [b.kind], team, era)
  const [pack] = await sql.begin(async t => {
    const [x] = await t`update users set coins = coins - ${item.price} where id = ${u.id} and coins >= ${item.price} returning coins`
    if (!x) throw fail(402, 'Not enough Coins.')
    await t`insert into coin_ledger (user_id, day, kind, ref, amount) values (${u.id}, ${today}, 'store', ${'pack:' + b.kind + ':' + Date.now()}, ${-item.price})`
    return t`insert into packs (user_id, kind, day, team, slots, pity) values (${u.id}, ${b.kind}, ${today}, ${team}, ${t.json(built.slots)}, ${built.pity}) returning *`
  })
  const [fresh] = await sql`select * from users where id = ${u.id}`
  return { packs: [packView(pack)], ...(await me(fresh)) }
}

async function buyCard(u, origin, b) {
  const sql = db(), today = etDay()
  const f = await featured(origin, today)
  const item = f.cards.find(x => refOf(x.card) === String(b.ref))
  if (!item) throw fail(400, 'That card isn’t in today’s store.')
  const awards = await sql.begin(async t => {
    const [x] = await t`update users set coins = coins - ${item.price} where id = ${u.id} and coins >= ${item.price} returning coins`
    if (!x) throw fail(402, `You need ${(item.price - u.coins).toLocaleString()} more Coins for that card.`)
    const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${u.id}, null, ${item.card.tier}, ${refOf(item.card)}, ${t.json(item.card)}, ${item.points}, 'store')
      on conflict (user_id, ref) do nothing returning id`
    if (!row) throw fail(409, 'That card is already in your binder.')
    await t`insert into coin_ledger (user_id, day, kind, ref, amount) values (${u.id}, ${today}, 'store', ${'card:' + refOf(item.card)}, ${-item.price})`
    return cardRewards(t, u.id, today, origin, item.card)
  })
  const [fresh] = await sql`select * from users where id = ${u.id}`
  return { awards, store: await storeView(sql, fresh, origin), ...(await me(fresh)) }
}

async function sell(u, origin, b) {
  const sql = db(), today = etDay(), id = Number(b.id)
  const [c] = await sql`select * from cards where id = ${id} and user_id = ${u.id}`
  if (!c) throw fail(404, 'That card isn’t in your binder.')
  if (SPECIAL_KINDS.has(c.tier)) throw fail(409, 'Special cards (Duels, Peaks, Rivalries, Starting Fives, Season cards, Player of the Week, Complete Sets) can’t be sold.')
  if (c.card?.ruby) throw fail(409, 'Ruby cards can’t be sold.')
  if (u.starred.map(Number).includes(id)) throw fail(409, 'Un-star the card first. Starred and showcase cards can’t be sold.')
  const hours = (Date.now() - new Date(c.pulled_at).getTime()) / 36e5
  if (hours < RATES.sellCooldownHours) throw fail(409, `You can sell this card in ${Math.ceil(RATES.sellCooldownHours - hours)} hour${Math.ceil(RATES.sellCooldownHours - hours) === 1 ? '' : 's'}. New cards wait a day.`)
  if (BIG.has(c.tier) && !b.confirm) throw fail(428, 'Confirm to sell a Legend-or-better card.')
  const price = Math.max(1, Math.round(c.points * RATES.sellRate))
  await sql.begin(async t => {
    const [x] = await t`select coalesce(sum(amount), 0)::int as n from coin_ledger where user_id = ${u.id} and day = ${today} and kind = 'sell'`
    if (x.n + price > RATES.sellCap) throw fail(409, `Selling this card would pass today’s ${RATES.sellCap}-Coin limit on sales (${x.n} so far).`)
    await t`delete from cards where id = ${id}`
    const [s_] = await t`insert into sold (user_id, ref, card, points, price, pulled_at) values (${u.id}, ${c.ref}, ${t.json(c.card)}, ${c.points}, ${price}, ${c.pulled_at}) returning id`
    await t`insert into coin_ledger (user_id, day, kind, ref, amount) values (${u.id}, ${today}, 'sell', ${'sold:' + s_.id}, ${price})`
    await t`update users set coins = coins + ${price} where id = ${u.id}`
  })
  const [fresh] = await sql`select * from users where id = ${u.id}`
  return { sold: { price }, awards: [{ kind: 'sell', amount: price, label: `Sold ${c.card.row.n}` }], ...(await me(fresh)) }
}

async function buyback(u, origin, b) {
  const sql = db(), today = etDay()
  await sql.begin(async t => {
    const [s_] = await t`select * from sold where id = ${Number(b.id)} and user_id = ${u.id} and not bought_back
      and sold_at > now() - ${RATES.buybackHours + ' hours'}::interval for update`
    if (!s_) throw fail(404, 'That sale can’t be undone anymore.')
    const [x] = await t`update users set coins = coins - ${s_.price} where id = ${u.id} and coins >= ${s_.price} returning coins`
    if (!x) throw fail(402, 'Not enough Coins to buy it back.')
    const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${u.id}, null, ${s_.card.tier}, ${s_.ref}, ${t.json(s_.card)}, ${s_.points}, 'buyback')
      on conflict (user_id, ref) do nothing returning id`
    if (!row) throw fail(409, 'That card is already back in your binder.')
    await t`update sold set bought_back = true where id = ${s_.id}`
    await t`insert into coin_ledger (user_id, day, kind, ref, amount) values (${u.id}, ${today}, 'buyback', ${'sold:' + s_.id}, ${-s_.price})`
  })
  const [fresh] = await sql`select * from users where id = ${u.id}`
  return { store: await storeView(sql, fresh, origin), ...(await me(fresh)) }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams)
  const action = q.action
  const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)) }
  try {
    await ensureSchema()
    const sql = db()
    const origin = ORIGIN = process.env.DATA_ORIGIN || `${(req.headers['x-forwarded-proto'] || 'https').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`
    const post = req.method === 'POST'
    // Once after a points change, every card is rescored. Reads wait for it; packs, picks and purchases never do.
    // A read waits up to 5 seconds for it, then goes ahead (the rescore carries on)
    const up = upgradePoints(sql, origin)
    if (!post) await Promise.race([up, new Promise(r => setTimeout(r, 5e3))])
    if (action === 'me') {
      const u0 = await currentUser(req)
      const awards = u0 ? await visit(u0, origin) : []
      // Picks on games that finished since the last visit: grade them (only touches ESPN when one is due)
      if (u0) awards.push(...(await settle(sql, u0.id, etDay(), { onlyStale: true, origin }).catch(e => { console.error('settle', e); return [] })))
      // Last week's Player of the Week card, once the week's data is in (tried every 10 minutes per instance until it is)
      if (Date.now() - potwTried > 10 * 60e3) {
        potwTried = Date.now()
        await settlePotw(sql, origin, etDay()).catch(e => console.error('potw', e))
        await settleChallenges(sql, origin, etDay()).catch(e => console.error('challenge', e))
      }
      // Complete Set cards for checklists finished before the cards existed
      if (u0) awards.push(...(await backfillSets(sql, u0.id, origin, etDay()).catch(e => { console.error('sets', e); return [] })))
      if (u0) for (const c of await sql`select id, card from cards where user_id = ${u0.id} and tier = 'potw' and not coalesce((card->>'seen')::boolean, false)`) {
        awards.push({ kind: 'potw', amount: 0, label: `Player of the Week: you won the week of ${new Date(c.card.week + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}. Your ${c.card.n} card is in your binder` })
        await sql`update cards set card = card || '{"seen": true}'::jsonb where id = ${c.id}`
      }
      const u1 = u0 && (await sql`select * from users where id = ${u0.id}`)[0]
      return send(200, { ...(await me(u1)), awards, lastNight: await recentDate(origin).catch(() => null) })
    }

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
        const awards = await visit(u, origin)
        return send(200, { ...(await me((await sql`select * from users where id = ${u.id}`)[0])), awards })
      }
      const [u] = await sql`select * from users where username_key = ${key}`
      if (!u || !(await checkPassword(String(password), u.pass_hash))) throw fail(401, 'Wrong username or password.')
      await startSession(res, req, u.id)
      const awards = await visit(u, origin)
      return send(200, { ...(await me((await sql`select * from users where id = ${u.id}`)[0])), awards })
    }
    if (post && action === 'logout') { await endSession(res, req); return send(200, { user: null }) }

    if (action === 'leaders') {
      // One pass over cards: totals, rank and count together; best card only for the rows returned
      const viewer = await currentUser(req)
      const vid = viewer ? viewer.id : -1
      const rows = await sql`with s as (select user_id, sum(points)::int as score, count(*)::int as cards,
            count(distinct card->'row'->>'n')::int as players from cards group by user_id),
          r as (select s.*, rank() over (order by score desc)::int as rk, count(*) over ()::int as n from s)
        select r.*, u.username, u.favorite_team,
          (select c.card from cards c where c.user_id = r.user_id order by c.points desc nulls last limit 1) as best
        from r join users u on u.id = r.user_id
        where r.rk <= 50 or r.user_id = ${vid}
        order by r.score desc, r.cards desc, u.id`
      const leaders = rows.filter(r => r.rk <= 50).slice(0, 50).map(r => ({ rank: r.rk, username: r.username, favoriteTeam: r.favorite_team, score: r.score, cards: r.cards, players: r.players, best: r.best }))
      const mine = rows.find(r => r.user_id === vid)
      const n = rows[0]?.n || 0
      const you = !viewer ? null : mine ? { username: viewer.username, score: mine.score, cards: mine.cards, players: mine.players, rank: mine.score > 0 ? mine.rk : null, of: n }
        : { username: viewer.username, score: 0, cards: 0, players: 0, rank: null, of: n }
      return send(200, { leaders, binders: n, you })
    }
    if (action === 'status') return send(200, { points: await pointsStatus(sql, origin) })
    // Player of the Week for any day's week: the top 20 so far, the pick'em race, and the card once the week is settled
    if (action === 'potw') return send(200, await potwWeek(sql, origin, String(q.day || '')))
    if (action === 'topcards') {
      // The most valuable cards anyone holds (one row a card, with how many binders have it), and the best pulls of the last day
      const top = await sql`select c.ref, max(c.points)::int as points, count(distinct c.user_id)::int as owners,
          (array_agg(c.card order by c.pulled_at))[1] as card, (array_agg(u.username order by c.pulled_at))[1] as first
        from cards c join users u on u.id = c.user_id group by c.ref order by points desc, owners desc limit 10`
      const recent = await sql`select c.card, c.points, c.pulled_at, c.source, u.username from cards c join users u on u.id = c.user_id
        where c.pulled_at > now() - interval '24 hours' order by c.points desc, c.pulled_at desc limit 10`
      return send(200, {
        top: top.map(r => ({ card: r.card, points: r.points, owners: r.owners, first: r.first })),
        recent: recent.map(r => ({ card: r.card, points: r.points, at: r.pulled_at, username: r.username, forged: r.card?.kind === 'season' })),
      })
    }
    if (action === 'wishes' && q.user) {
      const [o] = await sql`select * from users where username_key = ${String(q.user).toLowerCase()}`
      if (!o) throw fail(404, 'No binder by that name.')
      return send(200, await wishView(sql, o, origin))
    }
    if (action === 'history') {
      const name = String(q.user || '').toLowerCase()
      const [o] = name ? await sql`select id from users where username_key = ${name}` : [await currentUser(req)]
      if (!o) throw fail(404, 'No binder by that name.')
      return send(200, { history: await scoreHistory(sql, o.id) })
    }
    if (action === 'binder') {
      const [o] = await sql`select * from users where username_key = ${String(q.user || '').toLowerCase()}`
      if (!o) throw fail(404, 'No binder by that name.')
      const rows = await sql`select id, card, points, pulled_at from cards where user_id = ${o.id} order by id desc`
      const ser = await serials(sql, o.id)
      return send(200, { user: { username: o.username, favoriteTeam: o.favorite_team, joined: iso(o.created_at), showcaseIds: o.showcase.map(Number), starred: o.starred.map(Number) },
        standing: await standing(sql, o.id), achievements: (await achievements(sql, o.id)).filter(a => a.earned), cards: rows.map(r => ({ id: Number(r.id), card: r.card, points: r.points, pulled: r.pulled_at, serial: ser.get(Number(r.id)) })) })
    }

    if (action === 'standings') return send(200, { standings: await standings(sql, origin, q.scope === 'season' ? 'season' : 'week', etDay(), await currentUser(req)) })

    const u = await currentUser(req)
    if (!u) throw fail(401, 'Sign in first.')
    if (post && action === 'claim') return send(200, await claimDaily(u, origin))
    if (post && action === 'team') return send(200, await claimTeam(u, origin, String((await readBody(req)).team || '')))
    if (post && action === 'pick') return send(200, await pick(u, await readBody(req), origin))
    if (action === 'store') return send(200, { store: await storeView(sql, u, origin), ...(await me(u)) })
    if (post && action === 'buy') return send(200, await buyPack(u, origin, await readBody(req)))
    if (post && action === 'buycard') return send(200, await buyCard(u, origin, await readBody(req)))
    if (post && action === 'sell') return send(200, await sell(u, origin, await readBody(req)))
    if (post && action === 'buyback') return send(200, await buyback(u, origin, await readBody(req)))
    if (action === 'predictions' || (post && ['predict', 'lock', 'duelpick', 'lineup', 'potdpick'].includes(action))) {
      const today = etDay()
      const b = post ? await readBody(req) : null
      const awards = action === 'predict' ? await predict(sql, u, b, today, origin) : []
      if (action === 'lock') await setLock(sql, u, b, today, origin)
      if (action === 'duelpick') await duelPick(sql, u, b, today, origin)
      if (action === 'lineup') await setLineup(sql, u, b, origin, today)
      if (action === 'potdpick') await potdPick(sql, u, b, today, origin)
      const view = await predView(sql, u, today, addDays(today, 1), origin)
      const [fresh] = await sql`select * from users where id = ${u.id}`
      return send(200, { predictions: view, ...(await me(fresh)), awards: [...awards, ...view.awards] })
    }
    if (action === 'challenge' || (post && action === 'challengeset')) {
      if (post) await setChallenge(sql, u, origin, await readBody(req), etDay())
      return send(200, { challenge: await challengeView(sql, u, origin, etDay()) })
    }
    if (action === 'predday') return send(200, { day: await predDay(sql, u, String(q.day || ''), origin) })
    if (action === 'predreward') return send(200, { reward: await rewardOptions(sql, u, origin, String(q.day || ''), q.kind === 'duels' ? 'duels' : 'games') })
    if (post && action === 'claimpred') {
      const today = etDay()
      const r = await claimReward(sql, u, origin, await readBody(req), today)
      const [fresh] = await sql`select * from users where id = ${u.id}`
      return send(200, { cardId: r.cardId, awards: r.awards, predictions: await predView(sql, fresh, today, addDays(today, 1), origin), ...(await me(fresh)) })
    }
    if (post && action === 'explore') {
      const section = String((await readBody(req)).section || '')
      if (!SECTIONS[section]) return send(200, { awards: [] })
      const today = etDay(), awards = []
      await sql.begin(async t => {
        const a = await grant(t, u.id, today, 'explore', RATES.explore, { ref: `${today}|${section}`, cap: RATES.exploreCap, label: `Explored ${SECTIONS[section]}` })
        if (a) awards.push(a)
        const c = await tryChallenge(t, u.id, today, 'explore', section)
        if (c) awards.push(c)
      })
      const [fresh] = await sql`select * from users where id = ${u.id}`
      return send(200, { awards, coins: { balance: fresh.coins, ...(await earnings(sql, u.id, today)) } })
    }
    if (action === 'pack') {
      const [p] = await sql`select * from packs where id = ${Number(q.id)} and user_id = ${u.id}`
      if (!p) throw fail(404, 'That pack isn’t yours.')
      return send(200, { pack: packView(p) })
    }
    if (action === 'collection') {
      // Season cards: forge any player-season you've completed (cards kept before Season cards existed count too)
      const forged = await sql.begin(t => forgeSeasons(t, u.id, etDay(), origin)).catch(e => { console.error('forge', e); return [] })
      const rows = await sql`select c.id, c.card, c.points, c.pulled_at, coalesce(p.kind, c.source) as kind from cards c left join packs p on p.id = c.pack_id
        where c.user_id = ${u.id} order by c.id desc`
      const ser = await serials(sql, u.id)
      return send(200, { awards: forged, cards: rows.map(r => ({ id: Number(r.id), card: r.card, points: r.points, pulled: r.pulled_at, pack: r.kind, serial: ser.get(Number(r.id)) })) })
    }
    if (action === 'wishes') return send(200, await wishView(sql, u, origin))
    if (action === 'wishcards') return send(200, await wishCards(sql, u, origin, q))
    if (post && (action === 'wish' || action === 'unwish')) {
      const b = await readBody(req)
      if (action === 'wish') await addWish(sql, u, origin, b); else await removeWish(sql, u, b)
      const [fresh] = await sql`select * from users where id = ${u.id}`
      return send(200, { wishlist: await wishView(sql, u, origin), ...(await me(fresh)) })
    }
    if (post && action === 'star') {
      const b = await readBody(req), id = Number(b.id)
      const [own] = await sql`select 1 from cards where user_id = ${u.id} and id = ${id}`
      if (!own) throw fail(404, 'That card isn’t in your binder.')
      const cur = u.starred.map(Number).filter(x => x !== id)
      const next = b.on ? [...cur, id].slice(-2000) : cur
      // Unstarring a card takes it out of the showcase too
      const show = u.showcase.map(Number).filter(x => next.includes(x))
      const awards = []
      if (b.on) await sql.begin(async t => { const a = await tryChallenge(t, u.id, etDay(), 'star'); if (a) awards.push(a) })
      const [fresh] = await sql`update users set starred = ${next.map(String)}::bigint[], showcase = ${show.map(String)}::bigint[] where id = ${u.id} returning *`
      return send(200, { ...(await me(fresh)), awards })
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
    // A 500 carries a short reason too, so a failure can be read from the browser's network panel
    return send(status, status === 500 ? { error: 'Something went wrong. Try again.', detail: String(e?.message || e).slice(0, 300) } : { error: e.message })
  }
}
