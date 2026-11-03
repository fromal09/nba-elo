// King of the Court: one player a game. For every game on a day's slate, pick a player you have a game card of (the Daily
// Lineup's multipliers and rest days apply: GOAT 7 days, Icon 5, Legend 3, counted across King of the Court). His score in
// a game: his Player of the Game score (Game Score plus a sixth of his Elo change) times the card's multiplier (a bad night
// isn't magnified). Picks lock as each game tips off.
//
// Group Challenge: everyone with a pick in before the day's first tipoff is grouped, six to a group, with collectors of
// similar binder strength (binder score, shuffled a little). Computer-made binders fill out a short group. Each game is
// its own contest among the group's picks: the leading pick (a tie on score goes to the higher-Elo card) pays its owner Coins for the performance
// (3 a point, 20 to 150), 50 more if he was that game's Player of the Game, and 250 more for leading every game of a
// slate of three or more (a clean sweep). The bounty: one Coin for every collector who enters, every day, up to 20,000;
// it goes (split if shared) to whoever has every game's Player of the Game in their picks on a day of five or more games.
//
// Rivalry: challenge another collector to a day, for a wager. Your wager is held when you challenge; theirs when they
// accept (before the day's first tipoff, or it expires and yours comes back). Same picks, head to head: most games won
// takes both wagers; a tie on games goes to the higher total score; a full tie gives both back.
import { slate } from './slate.js'
import { grant } from './coins.js'
import { rosters } from './forecast.js'
import { dayFile, fullDay, findRow, nightScore, lineupPts, isOpen, isDone, PRED } from './predictions.js'
import { TIER_ORDER } from './packs.js'
import { norm, winChance } from '../../src/components/predict.js'
import { buildRatings, scoreGame } from '../../src/components/live.js'

export const KOC = { perPoint: 3, winMin: 20, winMax: 150, potg: 50, sweep: 250, sweepMin: 3, bountyCap: 20000, bountyMinGames: 5, group: 6,
  wagerMin: 10, rivalDays: 7 }
const fail = (status, message) => Object.assign(new Error(message), { status })
const iso = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const gap = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5)
const multOf = tier => PRED.lineupMult[tier] || 1
const restOf = tier => PRED.lineupRest[tier] || 0
const r1 = v => Math.round(v * 10) / 10
// A card's Elo (the number on its face), the tiebreaker when two picks score the same
const cardElo = c => Math.round(c?.row?.post ?? c?.row?.pre ?? 0)
// Picks in order: score, then the card's Elo. The winners: the first, and anyone level with it on both
const ranked = list => [...list].sort((a, b) => (b.score ?? -1e9) - (a.score ?? -1e9) || (b.elo || 0) - (a.elo || 0))
const leaders = list => {
  const r = ranked(list), top = r[0]
  return top && top.score != null && top.score > 0 ? r.filter(e => e.score === top.score && (e.elo || 0) === (top.elo || 0)) : []
}
async function cardsById(sql, ids) {
  const want = [...new Set(ids.filter(Boolean).map(Number))]
  if (!want.length) return new Map()
  return new Map((await sql`select id, card from cards where id = any(${want})`).map(r => [Number(r.id), r.card]))
}

// Scores so far for games in progress or final but not yet in the nightly data: the same Player of the Game score
// (Game Score plus a sixth of the Elo change), from ESPN's live box scores and the players' Elo before the day.
// { gameId: { state, score(team, player) } }; cached for 30 seconds
const liveMemo = new Map()
let eloMemo = null
export async function liveScores(origin, day, games) {
  const want = games.filter(g => g.state === 'in' || g.state === 'post')
  if (!want.length) return {}
  const hit = liveMemo.get(day)
  if (hit && Date.now() - hit.at < 30e3) return hit.out
  const api = process.env.API_ORIGIN || origin
  const get = u => fetch(u, { signal: AbortSignal.timeout(10e3) }).then(r => (r.ok ? r.json() : null)).catch(() => null)
  if (!eloMemo || Date.now() - eloMemo.at > 10 * 60e3) {
    const d = await get(`${origin}/data/players.json`)
    if (d) eloMemo = { at: Date.now(), R: buildRatings(d.players || d) }
  }
  const feed = await get(`${api}/api/live?date=${day}`)
  const out = {}
  if (feed?.games && eloMemo) {
    const sy = +day.slice(0, 4) - (+day.slice(5, 7) < 9 ? 1 : 0)
    for (const g of want) {
      const x = feed.games.find(y => y.home === g.home && y.away === g.away)
      const sc = x?.box ? scoreGame(x, eloMemo.R, day, winChance, sy) : null
      if (!sc) continue
      const by = new Map(sc.players.map(p => [p.t + '|' + norm(p.n), r1(p.gs + (p.post - p.pre) / 6)]))
      out[g.id] = { state: x.state, score: (team, player) => by.get(team + '|' + norm(player)) ?? null }
    }
  }
  liveMemo.set(day, { at: Date.now(), out })
  return out
}

const winCoins = score => Math.max(KOC.winMin, Math.min(KOC.winMax, Math.round(score * KOC.perPoint)))

export async function ensureKocSchema(t) {
  await t`create table if not exists koc_picks (
    user_id int not null references users(id) on delete cascade, day date not null, mode text not null, game_id text not null,
    card_id bigint, player text not null, team text not null, tier text not null, mult real not null, score real, made_at timestamptz not null default now(),
    primary key (user_id, day, mode, game_id))`
  await t`create index if not exists koc_picks_day on koc_picks (day, mode)`
  await t`create table if not exists koc_days (day date primary key, entrants int not null default 0, formed_at timestamptz not null default now(), settled_at timestamptz,
    potg jsonb, bounty_won jsonb)`
  await t`create table if not exists koc_groups (id serial primary key, day date not null, members int[] not null, bots jsonb not null, result jsonb, settled_at timestamptz)`
  await t`create index if not exists koc_groups_day on koc_groups (day)`
  await t`create table if not exists koc_bounty (id int primary key, amount int not null default 0)`
  await t`insert into koc_bounty (id, amount) values (1, 0) on conflict do nothing`
  await t`create table if not exists koc_rivals (id serial primary key, from_id int not null references users(id) on delete cascade,
    to_id int not null references users(id) on delete cascade, day date not null, wager int not null, status text not null default 'pending',
    winner int, result jsonb, created_at timestamptz not null default now(), responded_at timestamptz, settled_at timestamptz)`
  await t`create index if not exists koc_rivals_users on koc_rivals (from_id, to_id, day)`
}

const firstTip = games => games.filter(g => g.state !== 'off').reduce((m, g) => (!m || Date.parse(g.tip) < Date.parse(m) ? g.tip : m), null)
const started = games => { const f = firstTip(games); return !!f && Date.parse(f) <= Date.now() }

// ── Picks ────────────────────────────────────────────────────────────────────
// Other days each card plays in King of the Court, near enough to matter for its rest
async function cardDays(sql, userId, day, ids) {
  if (!ids.length) return new Map()
  const rows = await sql`select distinct card_id, day from koc_picks where user_id = ${userId} and card_id = any(${ids.map(String)}::bigint[])
    and day <> ${day} and day > ${addDays(day, -8)} and day < ${addDays(day, 8)}`
  const m = new Map()
  for (const r of rows) { const k = Number(r.card_id); if (!m.has(k)) m.set(k, []); m.get(k).push(iso(r.day)) }
  return m
}
function restInfo(tier, days, day) {
  const n = restOf(tier)
  if (!n || !days?.length) return null
  const clash = days.filter(d => Math.abs(gap(day, d)) < n).sort()
  if (!clash.length) return null
  const before = clash.filter(d => d < day), after = clash.filter(d => d > day)
  return before.length ? { until: addDays(before[before.length - 1], n) } : { next: after[0], days: n }
}
// Your players in each game of the day: { gameId: [{ name, team, cardId, tier, mult, resting, out, elo }] }, best first
async function candidates(sql, u, origin, day, games) {
  const live = games.filter(g => g.state !== 'off' && isOpen(g))
  if (!live.length) return {}
  const R = await rosters(origin, [...new Set(live.flatMap(g => [g.home, g.away]))], day, live).catch(() => ({}))
  const onTeam = new Map()
  for (const [t, rows] of Object.entries(R)) for (const r of rows) onTeam.set(norm(r.name), { ...r, team: t })
  const mine = (await sql`select id, card, points, tier from cards where user_id = ${u.id} and tier = any(${TIER_ORDER})`).filter(c => c.card?.row?.n)
  const used = await cardDays(sql, u.id, day, mine.map(c => c.id))
  const by = new Map()
  for (const c of mine) {
    const k = norm(c.card.row.n), r = onTeam.get(k)
    if (!r) continue
    const rest = restInfo(c.tier, used.get(Number(c.id)), day)
    const x = { cardId: Number(c.id), tier: c.tier, mult: multOf(c.tier), resting: rest, points: c.points }
    const b = by.get(k)
    if (!b || (!!b.x.resting - !!x.resting || x.mult - b.x.mult || x.points - b.x.points) > 0) by.set(k, { r, x })
  }
  const out = {}
  for (const { r, x } of by.values()) {
    const g = live.find(g_ => g_.home === r.team || g_.away === r.team)
    if (!g) continue
    ;(out[g.id] = out[g.id] || []).push({ name: r.name, team: r.team, elo: r.elo, out: !!r.out, status: r.status || null, proj: r.proj?.gs ?? null,
      cardId: x.cardId, tier: x.tier, mult: x.mult, resting: x.resting })
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.out - b.out || !!a.resting - !!b.resting || b.mult * (b.proj ?? b.elo / 100) - a.mult * (a.proj ?? a.elo / 100))
  return out
}

// Set (card) or clear (no card) your pick for one game. mode: 'group' or 'r<rivalry id>'
export async function setPick(sql, u, origin, today, b) {
  const day = String(b.day || ''), mode = String(b.mode || ''), gameId = String(b.game || '')
  const games = (await slate(sql, day, { origin })).filter(g => g.state !== 'off')
  const g = games.find(x => x.id === gameId)
  if (!g) throw fail(404, 'That game isn’t on the slate.')
  if (!isOpen(g)) throw fail(409, 'That game has tipped off. Its pick is locked.')
  if (mode === 'group') {
    if (day < today || day > addDays(today, 1)) throw fail(400, 'The Group Challenge is for today’s and tomorrow’s games.')
    if (started(games)) {
      const [x] = await sql`select 1 from koc_picks where user_id = ${u.id} and day = ${day} and mode = 'group' limit 1`
      if (!x) throw fail(409, 'Group Challenge entries closed at the day’s first tipoff. Tomorrow’s is open.')
    }
  } else {
    const id = Number(mode.slice(1))
    const [r] = await sql`select * from koc_rivals where id = ${id}`
    if (!r || (r.from_id !== u.id && r.to_id !== u.id)) throw fail(404, 'That rivalry isn’t yours.')
    if (iso(r.day) !== day) throw fail(400, 'That rivalry is on another day.')
    if (r.status !== 'accepted' && !(r.status === 'pending' && r.from_id === u.id)) throw fail(409, 'That rivalry isn’t on.')
  }
  if (b.card == null) { await sql`delete from koc_picks where user_id = ${u.id} and day = ${day} and mode = ${mode} and game_id = ${gameId}`; return }
  const [c] = await sql`select id, card, tier from cards where id = ${Number(b.card)} and user_id = ${u.id}`
  if (!c || !TIER_ORDER.includes(c.tier) || !c.card?.row?.n) throw fail(404, 'Pick a game card from your binder.')
  const rest = restInfo(c.tier, (await cardDays(sql, u.id, day, [c.id])).get(Number(c.id)), day)
  if (rest) throw fail(409, rest.until ? `That card is resting until ${rest.until}.` : `That card plays on ${rest.next} and needs ${rest.days} days between games.`)
  const R = await rosters(origin, [g.home, g.away], day)
  const k = norm(c.card.row.n)
  const team = [g.home, g.away].find(t => (R[t] || []).some(r => norm(r.name) === k))
  if (!team) throw fail(409, `${c.card.row.n} doesn’t play in that game.`)
  await sql`insert into koc_picks (user_id, day, mode, game_id, card_id, player, team, tier, mult) values (${u.id}, ${day}, ${mode}, ${gameId}, ${c.id}, ${c.card.row.n}, ${team}, ${c.tier}, ${multOf(c.tier)})
    on conflict (user_id, day, mode, game_id) do update set card_id = excluded.card_id, player = excluded.player, team = excluded.team, tier = excluded.tier, mult = excluded.mult, made_at = now()`
}

// ── Groups ───────────────────────────────────────────────────────────────────
const BOT_NAMES = ['Hardwood Hank', 'Backboard Betty', 'Glass Cleaner', 'Pick-and-Roll Pat', 'Fast Break Fran', 'Swish Sanchez', 'Post-Up Paula', 'Bank Shot Bo',
  'Full-Court Flo', 'Sixth Man Sid', 'Corner Three Cora', 'And-One Andy', 'Box-Out Bev', 'Alley-Oop Al', 'Zone Defense Zed', 'Hook Shot Hal']
function rng(seed) { let h = 2166136261; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296 }
// A computer-made binder's picks: for each game, one of its best five players, on a card about as good as the group's
async function botPicks(origin, day, games, strength, seed) {
  const r = rng(seed)
  const R = await rosters(origin, [...new Set(games.flatMap(g => [g.home, g.away]))], day, games).catch(() => ({}))
  const tiers = ['common', 'rare', 'standout', 'legend', 'icon', 'goat']
  const picks = {}
  for (const g of games) {
    const pool = [...(R[g.home] || []).map(x => ({ ...x, team: g.home })), ...(R[g.away] || []).map(x => ({ ...x, team: g.away }))]
      .filter(x => !x.out).sort((a, b) => b.elo - a.elo).slice(0, 5)
    if (!pool.length) continue
    const p = pool[Math.floor(r() * r() * pool.length)] // leans to the best
    const ti = Math.max(0, Math.min(tiers.length - 1, Math.round(strength + (r() - 0.5) * 1.6)))
    picks[g.id] = { player: p.name, team: p.team, tier: tiers[ti], mult: multOf(tiers[ti]), elo: Math.round(p.elo || 0) }
  }
  return picks
}
// Once the day's first game tips off: group everyone who entered, add the bounty's Coins
export async function formGroups(sql, origin, day, games) {
  if (!started(games)) return
  const [claim] = await sql`insert into koc_days (day) values (${day}) on conflict do nothing returning day`
  if (!claim) return
  const users = await sql`select p.user_id, coalesce(sum(c.points), 0)::int as score from (select distinct user_id from koc_picks where day = ${day} and mode = 'group') p
    left join cards c on c.user_id = p.user_id group by p.user_id`
  if (!users.length) return
  const r = rng(`koc|${day}`)
  const order = users.map(x => ({ id: x.user_id, k: x.score * (0.85 + 0.3 * r()) })).sort((a, b) => b.k - a.k)
  const live = games.filter(g => g.state !== 'off')
  const avgMult = async ids => {
    const [x] = await sql`select avg(mult)::real as m from koc_picks where day = ${day} and mode = 'group' and user_id = any(${ids})`
    const m = x?.m || 1
    return m >= 1.6 ? 3.2 : m >= 1.4 ? 2.6 : m >= 1.2 ? 1.8 : m >= 1.05 ? 1.1 : 0.4
  }
  for (let i = 0; i < order.length; i += KOC.group) {
    const members = order.slice(i, i + KOC.group).map(x => x.id)
    const bots = []
    const strength = await avgMult(members)
    for (let b = 0; members.length + bots.length < KOC.group; b++) {
      const name = BOT_NAMES[Math.floor(r() * BOT_NAMES.length)]
      if (bots.some(x => x.name === name)) continue
      bots.push({ id: -(bots.length + 1), name, picks: await botPicks(origin, day, live, strength, `${day}|${i}|${name}`) })
    }
    await sql`insert into koc_groups (day, members, bots) values (${day}, ${members}, ${sql.json(bots)})`
  }
  await sql`update koc_days set entrants = ${users.length} where day = ${day}`
  await sql`update koc_bounty set amount = least(${KOC.bountyCap}, amount + ${users.length}) where id = 1`
}

// The day's scores, once every game is final and in the data: { gameId: { potg: name, score(team, player) } }
async function dayScores(origin, day, games) {
  const file = await dayFile(origin, day).catch(() => null)
  if (!fullDay(file, day, games)) return null
  const out = {}
  for (const g of games.filter(x => x.state === 'post')) {
    const cards = file.cards.filter(c => c.date === day && ((c.t === g.home && c.o === g.away) || (c.t === g.away && c.o === g.home)))
    const potg = cards.find(c => c.honor === 'potg' || c.honor === 'potd') || [...cards].sort((a, b) => nightScore(b) - nightScore(a))[0]
    out[g.id] = { potg: potg?.row.n || null, score: (team, player) => { const c = findRow(file, day, team, team === g.home ? g.away : g.home, player); return c ? nightScore(c) : 0 } }
  }
  return out
}

export async function settleDay(sql, origin, day, today) {
  const games = (await slate(sql, day, { origin }).catch(() => [])).filter(g => g.state !== 'off')
  if (!games.length || !games.every(isDone)) return
  const S = await dayScores(origin, day, games)
  if (!S) return
  const done = games.filter(g => g.state === 'post')
  // Group Challenge
  const groups = await sql`select * from koc_groups where day = ${day} and settled_at is null`
  for (const grp of groups) {
    const picks = await sql`select p.*, u.username from koc_picks p join users u on u.id = p.user_id where p.day = ${day} and p.mode = 'group' and p.user_id = any(${grp.members})`
    const names = Object.fromEntries((await sql`select id, username from users where id = any(${grp.members})`).map(x => [x.id, x.username]))
    const won = new Map() // user -> games led
    const result = { games: [] }
    const cards = await cardsById(sql, picks.map(p => p.card_id))
    await sql.begin(async t => {
      for (const g of done) {
        const entries = []
        for (const p of picks.filter(x => x.game_id === g.id)) {
          const raw = S[g.id].score(p.team, p.player), score = r1(lineupPts(raw, p.mult))
          entries.push({ who: p.user_id, name: names[p.user_id], player: p.player, team: p.team, tier: p.tier, mult: p.mult, score, cardId: Number(p.card_id) || null, elo: cardElo(cards.get(Number(p.card_id))) })
          await t`update koc_picks set score = ${score} where user_id = ${p.user_id} and day = ${day} and mode = 'group' and game_id = ${g.id}`
        }
        for (const b of grp.bots) {
          const p = b.picks[g.id]; if (!p) continue
          entries.push({ who: b.id, name: b.name, bot: true, player: p.player, team: p.team, tier: p.tier, mult: p.mult, elo: p.elo || 0, score: r1(lineupPts(S[g.id].score(p.team, p.player), p.mult)) })
        }
        const winners = leaders(entries)
        for (const w of winners) {
          w.win = true
          if (w.bot) continue
          won.set(w.who, (won.get(w.who) || 0) + 1)
          const potg = norm(w.player) === norm(S[g.id].potg || '')
          const coins = winCoins(w.score) + (potg ? KOC.potg : 0)
          w.coins = coins
          await grant(t, w.who, today, 'koc', coins, { ref: `${day}|${g.id}`, label: `King of the Court: ${w.player} led your group${potg ? ', and was the Player of the Game' : ''}` })
        }
        result.games.push({ id: g.id, home: g.home, away: g.away, potg: S[g.id].potg, entries })
      }
      if (done.length >= KOC.sweepMin) for (const [uid, n] of won) if (n === done.length) {
        await grant(t, uid, today, 'kocsweep', KOC.sweep, { ref: day, label: 'King of the Court: a clean sweep, every game led' })
        result.sweep = [...(result.sweep || []), uid]
      }
      await t`update koc_groups set result = ${t.json(result)}, settled_at = now() where id = ${grp.id}`
    })
  }
  // The bounty: every game's Player of the Game in your picks, on a day of five or more games
  const [kd] = await sql`select * from koc_days where day = ${day}`
  if (kd && !kd.settled_at) {
    let winners = []
    if (done.length >= KOC.bountyMinGames) {
      const rows = await sql`select user_id, game_id, player from koc_picks where day = ${day} and mode = 'group'`
      const by = new Map()
      for (const r of rows) { if (!by.has(r.user_id)) by.set(r.user_id, new Map()); by.get(r.user_id).set(r.game_id, r.player) }
      winners = [...by].filter(([, m]) => done.every(g => S[g.id].potg && norm(m.get(g.id) || '') === norm(S[g.id].potg))).map(([id]) => id)
    }
    await sql.begin(async t => {
      let won = null
      if (winners.length) {
        const [b] = await t`select amount from koc_bounty where id = 1 for update`
        const each = Math.floor((b?.amount || 0) / winners.length)
        if (each > 0) {
          for (const id of winners) await grant(t, id, today, 'kocbounty', each, { ref: day, label: `The King of the Court bounty: every Player of the Game, ${each.toLocaleString()} Coins` })
          await t`update koc_bounty set amount = 0 where id = 1`
          won = { users: winners, each }
        }
      }
      await t`update koc_days set settled_at = now(), potg = ${t.json(Object.fromEntries(done.map(g => [g.id, S[g.id].potg])))}, bounty_won = ${won ? t.json(won) : null} where day = ${day}`
    })
  }
  // Rivalries
  for (const r of await sql`select * from koc_rivals where day = ${day} and status = 'accepted'`) {
    const mode = `r${r.id}`
    const picks = await sql`select * from koc_picks where day = ${day} and mode = ${mode}`
    const side = { [r.from_id]: { won: 0, total: 0 }, [r.to_id]: { won: 0, total: 0 } }
    const games_ = []
    const rc = await cardsById(sql, picks.map(p => p.card_id))
    for (const g of done) {
      const a = picks.find(p => p.user_id === r.from_id && p.game_id === g.id), b = picks.find(p => p.user_id === r.to_id && p.game_id === g.id)
      const sa = a ? r1(lineupPts(S[g.id].score(a.team, a.player), a.mult)) : null, sb = b ? r1(lineupPts(S[g.id].score(b.team, b.player), b.mult)) : null
      if (a) await sql`update koc_picks set score = ${sa} where user_id = ${a.user_id} and day = ${day} and mode = ${mode} and game_id = ${g.id}`
      if (b) await sql`update koc_picks set score = ${sb} where user_id = ${b.user_id} and day = ${day} and mode = ${mode} and game_id = ${g.id}`
      // a: the challenger. Level on score: the higher-Elo card
      const ea = a ? cardElo(rc.get(Number(a.card_id))) : 0, eb = b ? cardElo(rc.get(Number(b.card_id))) : 0
      const w = (sa ?? -1e9) > (sb ?? -1e9) ? 'a' : (sb ?? -1e9) > (sa ?? -1e9) ? 'b' : sa != null && ea !== eb ? (ea > eb ? 'a' : 'b') : null
      if (w) side[w === 'a' ? r.from_id : r.to_id].won++
      side[r.from_id].total += sa || 0; side[r.to_id].total += sb || 0
      games_.push({ id: g.id, home: g.home, away: g.away, a: a && { player: a.player, team: a.team, tier: a.tier, score: sa, elo: ea }, b: b && { player: b.player, team: b.team, tier: b.tier, score: sb, elo: eb }, w })
    }
    const A = side[r.from_id], B = side[r.to_id]
    const winner = A.won !== B.won ? (A.won > B.won ? r.from_id : r.to_id) : Math.abs(A.total - B.total) > 0.05 ? (A.total > B.total ? r.from_id : r.to_id) : null
    await sql.begin(async t => {
      const [x] = await t`update koc_rivals set status = 'settled', winner = ${winner}, settled_at = now(),
        result = ${t.json({ games: games_, won: [A.won, B.won], total: [r1(A.total), r1(B.total)] })} where id = ${r.id} and status = 'accepted' returning id`
      if (!x) return
      if (winner) await grant(t, winner, today, 'rivalwin', r.wager * 2, { ref: String(r.id), label: `Rivalry won: ${(r.wager * 2).toLocaleString()} Coins` })
      else for (const id of [r.from_id, r.to_id]) await grant(t, id, today, 'rivalrefund', r.wager, { ref: `${r.id}|${id}`, label: 'Rivalry tied: your wager is back' })
    })
  }
}

// Pending challenges whose day has started: expired, the challenger's wager back
async function expireRivals(sql, origin, today) {
  for (const r of await sql`select * from koc_rivals where status = 'pending' and day <= ${addDays(today, 1)}`) {
    const games = await slate(sql, iso(r.day), { origin }).catch(() => [])
    if (!started(games) && iso(r.day) >= today) continue
    await sql.begin(async t => {
      const [x] = await t`update koc_rivals set status = 'expired', responded_at = now() where id = ${r.id} and status = 'pending' returning id`
      if (x) await grant(t, r.from_id, today, 'rivalrefund', r.wager, { ref: `${r.id}|${r.from_id}`, label: 'Rivalry challenge expired: your wager is back' })
    })
  }
}

// Form today's groups, settle finished days, expire old challenges. Cheap when there's nothing to do
let ticked = 0
export async function kocTick(sql, origin, today, force = false) {
  if (!force && Date.now() - ticked < 60e3) return
  ticked = Date.now()
  const todays = await slate(sql, today, { origin }).catch(() => [])
  await formGroups(sql, origin, today, todays)
  const open = await sql`select distinct day from (select day from koc_groups where settled_at is null union select day from koc_days where settled_at is null
    union select day from koc_rivals where status = 'accepted') d where day <= ${today} and day >= ${addDays(today, -10)} order by day`
  for (const { day } of open) await settleDay(sql, origin, iso(day), today).catch(e => console.error('koc settle', e))
  await expireRivals(sql, origin, today).catch(e => console.error('koc expire', e))
}

// ── Rivalries ────────────────────────────────────────────────────────────────
export async function challenge(sql, u, origin, today, b) {
  const [o] = await sql`select id, username from users where username_key = ${String(b.to || '').toLowerCase()}`
  if (!o) throw fail(404, 'No collector by that name.')
  if (o.id === u.id) throw fail(400, 'Challenge someone else.')
  const day = String(b.day || ''), wager = Math.floor(Number(b.wager))
  if (!(day >= today && day <= addDays(today, KOC.rivalDays))) throw fail(400, `Pick a day in the next ${KOC.rivalDays} days.`)
  if (!(wager >= KOC.wagerMin)) throw fail(400, `The smallest wager is ${KOC.wagerMin} Coins.`)
  const games = (await slate(sql, day, { origin })).filter(g => g.state !== 'off')
  if (!games.length) throw fail(400, 'There are no games that day.')
  if (started(games)) throw fail(409, 'That day’s games have started. Pick a later day.')
  const [dup] = await sql`select 1 from koc_rivals where status in ('pending', 'accepted') and day = ${day}
    and ((from_id = ${u.id} and to_id = ${o.id}) or (from_id = ${o.id} and to_id = ${u.id}))`
  if (dup) throw fail(409, `You already have a rivalry with ${o.username} that day.`)
  await sql.begin(async t => {
    const [x] = await t`update users set coins = coins - ${wager} where id = ${u.id} and coins >= ${wager} returning coins`
    if (!x) throw fail(402, 'You don’t have that many Coins.')
    const [r] = await t`insert into koc_rivals (from_id, to_id, day, wager) values (${u.id}, ${o.id}, ${day}, ${wager}) returning id`
    await t`insert into coin_ledger (user_id, day, kind, ref, amount) values (${u.id}, ${today}, 'rivalwager', ${`${r.id}|${u.id}`}, ${-wager})`
  })
}
export async function respond(sql, u, origin, today, b) {
  const id = Number(b.id), act = String(b.act || '')
  const [r] = await sql`select * from koc_rivals where id = ${id}`
  if (!r || (r.from_id !== u.id && r.to_id !== u.id)) throw fail(404, 'That challenge isn’t yours.')
  if (r.status !== 'pending') throw fail(409, 'That challenge has already been answered.')
  const games = await slate(sql, iso(r.day), { origin })
  if (started(games)) throw fail(409, 'That day’s games have started; the challenge has expired.')
  if (act === 'accept') {
    if (r.to_id !== u.id) throw fail(403, 'Only the challenged collector can accept.')
    await sql.begin(async t => {
      const [x] = await t`update users set coins = coins - ${r.wager} where id = ${u.id} and coins >= ${r.wager} returning coins`
      if (!x) throw fail(402, `You need ${r.wager.toLocaleString()} Coins to accept.`)
      const [y] = await t`update koc_rivals set status = 'accepted', responded_at = now() where id = ${id} and status = 'pending' returning id`
      if (!y) throw fail(409, 'That challenge has already been answered.')
      await t`insert into coin_ledger (user_id, day, kind, ref, amount) values (${u.id}, ${today}, 'rivalwager', ${`${id}|${u.id}`}, ${-r.wager})`
    })
  } else if (act === 'decline' || act === 'cancel') {
    if (act === 'cancel' && r.from_id !== u.id) throw fail(403, 'Only the challenger can cancel.')
    if (act === 'decline' && r.to_id !== u.id) throw fail(403, 'Only the challenged collector can decline.')
    await sql.begin(async t => {
      const [y] = await t`update koc_rivals set status = ${act === 'cancel' ? 'cancelled' : 'declined'}, responded_at = now() where id = ${id} and status = 'pending' returning id`
      if (y) await grant(t, r.from_id, today, 'rivalrefund', r.wager, { ref: `${id}|${r.from_id}`, label: act === 'cancel' ? 'Challenge cancelled: your wager is back' : 'Challenge declined: your wager is back' })
    })
  } else throw fail(400, 'Accept, decline or cancel.')
}

// ── The page ─────────────────────────────────────────────────────────────────
export async function kocView(sql, u, origin, today, q) {
  await kocTick(sql, origin, today).catch(e => console.error('koc tick', e))
  const day = q.day && q.day >= addDays(today, -7) && q.day <= addDays(today, KOC.rivalDays) ? String(q.day) : today
  const games = (await slate(sql, day, { origin }).catch(() => [])).filter(g => g.state !== 'off')
  const gv = g => ({ id: g.id, home: g.home, away: g.away, tip: g.tip, state: g.state, detail: g.detail, hs: g.hs, as: g.as, open: isOpen(g) })
  const myPicks = await sql`select * from koc_picks where user_id = ${u.id} and day = ${day}`
  const pickView = p => p && { player: p.player, team: p.team, tier: p.tier, mult: p.mult, cardId: Number(p.card_id), score: p.score }
  const group = {}
  for (const p of myPicks.filter(x => x.mode === 'group')) group[p.game_id] = pickView(p)
  const [bounty] = await sql`select amount from koc_bounty where id = 1`
  // Your group, once formed: everyone's pick for a game shows once it tips off
  const [grp] = await sql`select * from koc_groups where day = ${day} and ${u.id} = any(members)`
  let groupView = null
  if (grp) {
    const names = Object.fromEntries((await sql`select id, username from users where id = any(${grp.members})`).map(x => [x.id, x.username]))
    const all = await sql`select * from koc_picks where day = ${day} and mode = 'group' and user_id = any(${grp.members})`
    const members = [...grp.members.map(id => ({ id, name: names[id], you: id === u.id })), ...grp.bots.map(b => ({ id: b.id, name: b.name, bot: true }))]
    const pc = await cardsById(sql, all.map(p => p.card_id))
    // Before the day settles, games in progress or final carry scores so far from the live box scores
    const L = grp.settled_at ? {} : await liveScores(origin, day, games).catch(() => ({}))
    const withCard = (e, cid) => { const c = cid ? pc.get(cid) || null : null; return { ...e, cardId: cid || null, card: c, elo: e.elo ?? (c ? cardElo(c) : 0) } }
    groupView = { members, settled: !!grp.settled_at, result: grp.result,
      games: games.map(g => {
        const res = grp.result?.games?.find(x => x.id === g.id)
        let entries, provisional = false
        if (res) entries = res.entries.map(e => withCard(e, e.bot ? null : e.cardId ?? (Number(all.find(p => p.user_id === e.who && p.game_id === g.id)?.card_id) || null)))
        else if (isOpen(g)) return { id: g.id, entries: null }
        else {
          entries = [...all.filter(p => p.game_id === g.id).map(p => withCard({ who: p.user_id, name: names[p.user_id], player: p.player, team: p.team, tier: p.tier, mult: p.mult, score: p.score }, Number(p.card_id))),
            ...grp.bots.filter(b => b.picks[g.id]).map(b => ({ who: b.id, name: b.name, bot: true, ...b.picks[g.id], elo: b.picks[g.id].elo || 0, score: null, card: null }))]
          const Lg = L[g.id]
          if (Lg) {
            provisional = true
            for (const e of entries) e.score = r1(lineupPts(Lg.score(e.team, e.player) ?? 0, e.mult))
            for (const e of leaders(entries)) e.lead = true
          }
        }
        entries = ranked(entries).map((e, i) => ({ ...e, rank: i + 1, you: !e.bot && e.who === u.id }))
        return { id: g.id, entries, potg: res?.potg || null, provisional, state: g.state }
      }) }
  }
  const [kd] = await sql`select * from koc_days where day = ${day}`
  // Rivalries: yours from a week back to a week ahead
  const rivals = await sql`select r.*, a.username as from_name, b.username as to_name from koc_rivals r join users a on a.id = r.from_id join users b on b.id = r.to_id
    where (r.from_id = ${u.id} or r.to_id = ${u.id}) and r.day >= ${addDays(today, -7)} order by r.day desc, r.id desc limit 40`
  const rivalPicks = rivals.length ? await sql`select * from koc_picks where day = ${day} and mode = any(${rivals.map(r => `r${r.id}`)})` : []
  const rpc = await cardsById(sql, rivalPicks.map(p => p.card_id))
  const RL = rivalPicks.some(p => p.score == null) ? await liveScores(origin, day, games).catch(() => ({})) : {}
  // A rivalry pick with its card, and its score so far until the day settles
  const rivalPick = (p, g) => {
    if (!p) return null
    const c = rpc.get(Number(p.card_id)) || null, live = p.score == null && RL[g.id]
    return { ...pickView(p), card: c, elo: cardElo(c), score: live ? r1(lineupPts(live.score(p.team, p.player) ?? 0, p.mult)) : p.score, provisional: !!live }
  }
  const rivalView = r => {
    const you = r.from_id === u.id ? 'from' : 'to', oppId = you === 'from' ? r.to_id : r.from_id
    const v = { id: r.id, day: iso(r.day), wager: r.wager, status: r.status, you, opp: you === 'from' ? r.to_name : r.from_name, winner: r.winner == null ? null : r.winner === u.id ? 'you' : 'opp', result: r.result }
    if (iso(r.day) === day && (r.status === 'accepted' || r.status === 'settled' || (r.status === 'pending' && you === 'from'))) {
      const mode = `r${r.id}`
      v.games = games.map(g => {
        const mine = rivalPicks.find(p => p.mode === mode && p.user_id === u.id && p.game_id === g.id)
        const theirs = rivalPicks.find(p => p.mode === mode && p.user_id === oppId && p.game_id === g.id)
        return { id: g.id, mine: rivalPick(mine, g), theirs: !isOpen(g) ? rivalPick(theirs, g) : theirs ? { hidden: true } : null }
      })
    }
    return v
  }
  return {
    day, today, games: games.map(gv), group, bounty: bounty?.amount || 0, rules: KOC,
    entryOpen: !started(games) || myPicks.some(p => p.mode === 'group'), groupView, potg: kd?.potg || null, bountyWon: kd?.bounty_won || null,
    candidates: games.some(isOpen) ? await candidates(sql, u, origin, day, games).catch(() => ({})) : {},
    rivals: rivals.map(rivalView),
  }
}
