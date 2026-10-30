// Daily predictions, three games a night, all locking at each game's tipoff and changeable until then:
//
//   Picks     the winner of every game. Coins for each pick, each correct pick, upsets called (by the Elo
//             forecast) and a perfect day. More than half right: choose a card of Legend or below from the
//             day's games. Every game right: choose any card from them.
//   Lock      one pick a day as your Lock of the Day: a correct lock doubles its Coins (upset bonus included);
//             a wrong one costs that day's pick Coins.
//   Matchups  each game's top player matchup (each side's highest-Elo healthy player): who posts the higher
//             Game Score? More than half right: choose a Rare or Common from the day. All right: the Duel of
//             the Day card. Graded with the morning data update (Game Scores come from the pipeline).
//   Lineup    five player cards from your binder whose players play that night. Each scores its Game Score times the
//             card's tier multiplier (GOAT 2×, Icon 1.75×, Legend 1.5×, Standout 1.25×, Rare 1.1×, Common 1×; a
//             negative Game Score isn't multiplied). 1 Coin a point, up to 250. Top-tier cards then rest: a GOAT
//             card can't go in another lineup for 7 days, an Icon for 5, a Legend for 3.
//
//   PotD      Predict the Player of the Day: one nomination a day, changeable until the day's first tipoff. Right: the
//             ruby version of that day's Player of the Day card (twice its points) and 25 Coins. Graded with the day's cards.
//
// Player of the Week: each week's pick'em winner (ties share it) gets a numbered Player of the Week card of the NBA's best
// player that week, by the Player of the Day measure added up: Game Score plus a sixth of the Elo gained, every game.
//
// Standings rank pick'em points (a correct pick, a correct matchup, a correct lock's extra point) by week and
// season, with weekly Coin payouts; Beat the Forecast compares your wins with what the forecast expected of your picks.
import { slate, dogChance, gradeDay } from './slate.js'
import { grant, cardRewards } from './coins.js'
import { poolIndex, poolJSON, toCard, refOf, tierOf, TIER_ORDER } from './packs.js'
import { cardPoints } from './points.js'
import { rosters } from './forecast.js'
import { norm } from '../../src/components/predict.js'

export const PRED = {
  pick: 5,          // making a pick (once per game, even if you change it)
  correct: 15,      // each correct pick
  upsetMin: 10, upsetMax: 80, // calling an underdog: (50% − its chance) × 200, rounded to 5
  perfectPer: 15, perfectMax: 150, // a perfect day: 15 per game on the slate
  duel: 10,         // each correct matchup
  lineupMax: 250,   // lineups: 1 Coin per (multiplied) Game Score point
  lineupMult: { goat: 2, icon: 1.75, legend: 1.5, standout: 1.25, rare: 1.1, common: 1 },
  lineupRest: { goat: 7, icon: 5, legend: 3 }, // days before the same card can play again
  slots: 5,
  weeklyTop10: 300, weeklyTop50: 100, // pick'em standings, paid each Monday
  potd: 25,         // a correct Player of the Day call (plus the ruby card)
  potdStand: 2,     // pick'em points for a correct Player of the Day call
}
export const upsetBonus = p => (p == null || p >= 0.5 ? 0 : Math.max(PRED.upsetMin, Math.min(PRED.upsetMax, Math.round(((0.5 - p) * 200) / 5) * 5)))
const LEGEND_CAP = TIER_ORDER.indexOf('legend'), RARE_CAP = TIER_ORDER.indexOf('rare')
const fail = (status, message) => Object.assign(new Error(message), { status })
const iso = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null)
const isDone = g => g.state === 'post' || g.state === 'off'
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const weekStart = day => addDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7))
const seasonStart = day => `${+day.slice(0, 4) - (+day.slice(5, 7) < 9 ? 1 : 0)}-09-01`
const isOpen = g => g.state === 'pre' && Date.parse(g.tip) > Date.now()

export async function ensurePredSchema(t) {
  await t`create table if not exists pred_games (
    id text primary key, day date not null, tip timestamptz not null, home text not null, away text not null,
    state text not null, detail text, hs int, as_ int, winner text, line jsonb, updated_at timestamptz not null default now())`
  await t`create index if not exists pred_games_day on pred_games (day)`
  await t`create table if not exists predictions (
    user_id int not null references users(id) on delete cascade,
    game_id text not null, day date not null, pick text not null,
    made_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    result text, chance real, bonus int not null default 0,
    primary key (user_id, game_id))`
  await t`alter table predictions add column if not exists lock boolean not null default false`
  await t`alter table predictions add column if not exists credited boolean not null default false`
  await t`create index if not exists predictions_day on predictions (user_id, day)`
  await t`create index if not exists predictions_open on predictions (day) where result is null`
  await t`create unique index if not exists predictions_lock on predictions (user_id, day) where lock`
  await t`create table if not exists pred_days (
    user_id int not null references users(id) on delete cascade, day date not null,
    total int not null, picked int not null, correct int not null, upsets int not null default 0,
    reward text, claimed_ref text, claimed_card jsonb, claimed_at timestamptz,
    graded_at timestamptz not null default now(), primary key (user_id, day))`
  await t`create table if not exists duel_picks (
    user_id int not null references users(id) on delete cascade,
    game_id text not null, day date not null, pick text not null,
    made_at timestamptz not null default now(), result text, credited boolean not null default false,
    primary key (user_id, game_id))`
  await t`create index if not exists duel_picks_day on duel_picks (user_id, day)`
  await t`create table if not exists duel_days (
    user_id int not null references users(id) on delete cascade, day date not null,
    total int not null, picked int not null, correct int not null,
    reward text, claimed_ref text, claimed_card jsonb, claimed_at timestamptz,
    graded_at timestamptz not null default now(), primary key (user_id, day))`
  await t`create table if not exists lineups (
    user_id int not null references users(id) on delete cascade, day date not null, slot int not null,
    card_id bigint not null, player text not null, team text not null, game_id text not null, gs real,
    made_at timestamptz not null default now(), primary key (user_id, day, slot))`
  await t`alter table lineups add column if not exists tier text`
  await t`alter table lineups add column if not exists mult real`
  await t`create index if not exists lineups_card on lineups (card_id, day)`
  // Lineups set before multipliers: give them their card's tier (still-open days score with it)
  await t`update lineups l set tier = c.tier from cards c where c.id = l.card_id and l.tier is null`
  await t`create table if not exists lineup_days (
    user_id int not null references users(id) on delete cascade, day date not null,
    total real not null, coins int not null, graded_at timestamptz not null default now(), primary key (user_id, day))`
  await t`create table if not exists pick_settlements (week date primary key, settled_at timestamptz not null default now())`
  await t`create table if not exists potd_picks (
    user_id int not null references users(id) on delete cascade, day date not null, player text not null, team text not null,
    made_at timestamptz not null default now(), result text, credited boolean not null default false, primary key (user_id, day))`
  await t`create index if not exists potd_picks_open on potd_picks (day) where result is null`
  await t`create table if not exists potw_weeks (week date primary key, card jsonb, winners jsonb, settled_at timestamptz not null default now())`
}

// ── The day's cards (published by the nightly build): reward picks, matchup and lineup Game Scores ──
const files = new Map() // day -> { at, data }
export async function dayFile(origin, day) {
  // Refetched every 10 minutes: a day file published while games were still going (a partial day) gets replaced
  const m = files.get(day)
  if (m && Date.now() - m.at < (m.data ? 10 : 5) * 60e3) return m.data
  let data = null
  try {
    const idx = await poolIndex(origin)
    const f = await poolJSON(origin, `days/${day}.json`)
    const cards = f.rows.map(r => toCard(idx.cols, r, f.teams, 'predict'))
    data = { cards, duel: f.duel || null }
  } catch { data = null }
  files.set(day, { at: Date.now(), data })
  if (files.size > 30) files.delete(files.keys().next().value)
  return data
}
// A player's card from a game between these two teams (his Game Score is card.row.gs)
const hasGame = (file, day, home, away) => file.cards.some(c => c.date === day && c.t === home && c.o === away)
const findRow = (file, day, team, opp, name) => file.cards.find(c => c.date === day && c.t === team && c.o === opp && norm(c.row.n) === norm(name))

// ── ESPN box scores: Game Scores for finished games before the nightly build publishes the day ──
const ESPN = process.env.ESPN_BASE || 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const ESPN_ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO', CHA: 'CHO', BRK: 'BKN' }
const boxes = new Map() // game id -> { at, gs: Map(team|norm name -> Game Score) | null }
const pairOf = v => { const m = /^(\d+)-(\d+)$/.exec(v || ''); return m ? [+m[1], +m[2]] : [0, 0] }
// Same formula and rounding as scripts/fetch_espn.py, so the score matches the card the nightly build makes
const gmsc = p => Math.round((p.pts + 0.4 * p.fg - 0.7 * p.fga - 0.4 * (p.fta - p.ft) + 0.7 * p.orb + 0.3 * p.drb
  + p.stl + 0.7 * p.ast + 0.7 * p.blk - 0.4 * p.pf - p.tov) * 10) / 10
async function espnBox(id) {
  const m = boxes.get(id)
  if (m && (m.gs || Date.now() - m.at < 2 * 60e3)) return m.gs
  let gs = null
  try {
    const r = await fetch(`${ESPN}/summary?event=${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10e3) })
    if (!r.ok) throw new Error(`summary ${r.status}`)
    const d = await r.json()
    gs = new Map()
    for (const grp of d.boxscore?.players || []) {
      const team = ESPN_ABBR[grp.team?.abbreviation] || grp.team?.abbreviation
      const st = grp.statistics?.[0]; if (!team || !st) continue
      const keys = st.keys || [], col = k => keys.indexOf(k)
      const KEY = { pts: 'points', orb: 'offensiveRebounds', drb: 'defensiveRebounds', ast: 'assists', stl: 'steals', blk: 'blocks', tov: 'turnovers', pf: 'fouls' }
      for (const a of st.athletes || []) {
        const v = a.stats || []
        // Listed but didn't play (a scratch, DNP): no Game Score, so his matchup is void
        if (a.didNotPlay || !v.length) { const nm = a.athlete?.displayName || a.athlete?.fullName; if (nm) gs.set(`${team}|${norm(nm)}`, null); continue }
        const p = {}
        for (const [f, k] of Object.entries(KEY)) p[f] = +(v[col(k)] ?? 0) || 0
        ;[p.fg, p.fga] = pairOf(v[col('fieldGoalsMade-fieldGoalsAttempted')]);[p.ft, p.fta] = pairOf(v[col('freeThrowsMade-freeThrowsAttempted')])
        const name = a.athlete?.displayName || a.athlete?.fullName
        if (name) gs.set(`${team}|${norm(name)}`, gmsc(p))
      }
    }
    if (!gs.size) gs = null
  } catch (e) { console.error('box', id, e.message); gs = null }
  boxes.set(id, { at: Date.now(), gs })
  if (boxes.size > 200) boxes.delete(boxes.keys().next().value)
  return gs
}

/**
 * Game Scores for grading a day: the nightly day file once it's published, ESPN's box scores until then.
 * has(game): that game's scores are in. gs(game, team, name): the Game Score; null = didn't play; undefined = not known yet.
 * With only ESPN, a name missing from the box score stays unknown (it may be spelled differently) until the day file
 * arrives, or for good two days on (then it counts as didn't play).
 */
async function gradeSource(origin, day, games) {
  const file = origin ? await dayFile(origin, day) : null
  const old = day <= addDays(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), -2)
  const box = new Map()
  // Finished games the day file doesn't have (none at all, or a partial day): ESPN's box scores
  const inFile = g => !!file && hasGame(file, day, g.home, g.away)
  await Promise.all(games.filter(g => g.state === 'post' && !inFile(g)).map(async g => { const b = await espnBox(g.id); if (b) box.set(g.id, b) }))
  return {
    file,
    has: g => g.state === 'post' && (inFile(g) || box.has(g.id)),
    gs(g, team, name) {
      const opp = g.home === team ? g.away : g.home
      if (inFile(g)) return findRow(file, day, team, opp, name)?.row.gs ?? null
      const v = box.get(g.id)?.get(`${team}|${norm(name)}`)
      return v ?? (old ? null : undefined)
    },
  }
}

// The Duel of the Day as a card for a binder
function duelCard(d) {
  const side = c => ({ ...c, tier: tierOf(c.row.lrp ?? c.row.lr) })
  return { kind: 'duel', k: 'duel', tier: 'duel', s: d.s, id: d.id, date: d.date, score: d.score, a: side(d.a), b: side(d.b) }
}

// The day's Player of the Day card (the pipeline marks it), and its ruby version for a correct call
const potdCard = (file, day) => file?.cards.find(c => c.honor === 'potd' && c.date === day) || null
// The day file covers every game the slate finished (a run during the night can publish a partial day; its Player of the
// Day is only the best of the games in it)
const fullDay = (file, day, games) => !!file && games.every(isDone) && games.filter(g => g.state === 'post').every(g => hasGame(file, day, g.home, g.away))
// The Player of the Day, once the day is over and the day file has all of it
const potdOf = (file, day, games) => (fullDay(file, day, games) ? potdCard(file, day) : null)
const rubyOf = c => ({ ...c, ruby: true, from: 'potd' })

// Each game's matchup result from its Game Scores: { id: { winner | null (void), ag, bg } }
function matchupResults(games, src) {
  const out = {}
  for (const g of games) {
    const d = g.line?.duel
    if (d?.void) { out[g.id] = { winner: null, ag: null, bg: null, void: d.void, a: d.a, b: d.b }; continue } // ruled out before tipoff
    if (!d || !src.has(g)) continue // not graded yet
    const ag = src.gs(g, g.away, d.a), bg = src.gs(g, g.home, d.b)
    if (ag === undefined || bg === undefined) continue // a name the box score doesn't show yet: wait for the day file
    out[g.id] = { winner: ag == null || bg == null || ag === bg ? null : ag > bg ? d.a : d.b, ag, bg, a: d.a, b: d.b }
  }
  return out
}
async function gradeMatchups(sql, games, src) {
  const res = matchupResults(games, src)
  for (const [id, r] of Object.entries(res)) {
    // A pick on anyone outside the matchup (it never changes once published, but just in case) is void, not a loss
    if (r.winner) await sql`update duel_picks set result = case when pick = ${r.winner} then 'win' when pick = any(${[r.a, r.b]}) then 'loss' else 'void' end where game_id = ${id} and result is null`
    else await sql`update duel_picks set result = 'void' where game_id = ${id} and result is null`
  }
  return res
}

/**
 * Credit Coins for graded picks and close finished days, once each: game picks (and the lock), matchups, the lineup.
 * onlyStale: only days that are over, or today if a game tipped off over two hours ago (keeps `me` from calling ESPN often).
 */
export async function settle(sql, userId, today, { onlyStale = false, origin = null } = {}) {
  const rows = await sql`
    select day from predictions p where user_id = ${userId} and day <= ${today}
      and (not credited or not exists (select 1 from pred_days d where d.user_id = p.user_id and d.day = p.day))
    union select day from duel_picks p where user_id = ${userId} and day <= ${today}
      and (not credited or not exists (select 1 from duel_days d where d.user_id = p.user_id and d.day = p.day))
    union select day from lineups l where user_id = ${userId} and day <= ${today}
      and not exists (select 1 from lineup_days d where d.user_id = l.user_id and d.day = l.day)
    union select day from potd_picks where user_id = ${userId} and day <= ${today} and not credited
    order by day limit 7`
  let days = rows.map(r => iso(r.day))
  if (onlyStale && days.includes(today)) {
    const [due] = await sql`select 1 from pred_games where day = ${today} and tip < now() - interval '2 hours' limit 1`
    if (!due) days = days.filter(d => d !== today)
  }
  const awards = []
  for (const day of days) {
    const games = await slate(sql, day, { origin })
    if (!games.length) continue
    await gradeDay(sql, day)
    const byId = new Map(games.map(g => [g.id, g]))
    const src = await gradeSource(origin, day, games)
    const file = src.file
    const results = await gradeMatchups(sql, games, src)
    await sql.begin(async t => {
      const push = a => a && awards.push(a)
      const label = g => `${g.away} at ${g.home}`
      // Game picks
      const picks = await t`select * from predictions where user_id = ${userId} and day = ${day} for update`
      for (const p of picks) {
        const g = byId.get(p.game_id)
        if (!g || !p.result || p.credited) continue
        let bonus = 0
        if (p.result === 'win') {
          bonus = upsetBonus(p.chance)
          push(await grant(t, userId, today, 'predcorrect', PRED.correct, { ref: g.id, label: `Correct pick: ${p.pick} (${label(g)})` }))
          if (bonus) push(await grant(t, userId, today, 'upset', bonus, { ref: g.id, label: `Upset called: ${p.pick} (${Math.round(p.chance * 100)}% to win)` }))
          if (p.lock) push(await grant(t, userId, today, 'lock', PRED.correct + bonus, { ref: day, label: `Lock of the Day: ${p.pick}, doubled` }))
        } else if (p.result === 'loss' && p.lock) {
          const [{ n }] = await t`select count(*)::int as n from predictions where user_id = ${userId} and day = ${day}`
          const [{ coins }] = await t`select coins from users where id = ${userId}`
          const cost = Math.min(coins, n * PRED.pick)
          if (cost > 0) push(await grant(t, userId, today, 'lockloss', -cost, { ref: day, label: `Lock of the Day missed: ${p.pick}` }))
        }
        await t`update predictions set credited = true, bonus = ${bonus} where user_id = ${userId} and game_id = ${p.game_id}`
        p.credited = true; p.bonus = bonus
      }
      // The game-picks day closes once every game is final (or off the schedule)
      const live = games.filter(g => g.state !== 'off')
      const [closed] = await t`select 1 from pred_days where user_id = ${userId} and day = ${day}`
      if (picks.length && live.length && games.every(isDone) && picks.every(p => p.result) && !closed) {
        const mine = picks.filter(p => p.result && p.result !== 'void')
        const correct = mine.filter(p => p.result === 'win').length
        const total = live.length
        const reward = correct === total ? 'any' : correct * 2 > total ? 'legend' : null
        await t`insert into pred_days (user_id, day, total, picked, correct, upsets, reward)
          values (${userId}, ${day}, ${total}, ${mine.length}, ${correct}, ${mine.filter(p => p.bonus > 0).length}, ${reward}) on conflict do nothing`
        if (correct === total) push(await grant(t, userId, today, 'perfect', Math.min(PRED.perfectMax, PRED.perfectPer * total), { ref: day, label: `Perfect day: ${total} for ${total}` }))
        if (reward) awards.push({ kind: 'predreward', amount: 0, label: reward === 'any' ? 'Perfect day: choose any card from the day' : 'More than half right: choose a card from the day' })
      }
      // Matchups
      const dps = await t`select * from duel_picks where user_id = ${userId} and day = ${day} for update`
      for (const p of dps) {
        if (!p.result || p.credited) continue
        if (p.result === 'win') push(await grant(t, userId, today, 'duelcorrect', PRED.duel, { ref: p.game_id, label: `Matchup called: ${p.pick}` }))
        await t`update duel_picks set credited = true where user_id = ${userId} and game_id = ${p.game_id}`
      }
      const withDuel = live.filter(g => g.line?.duel)
      const [dclosed] = await t`select 1 from duel_days where user_id = ${userId} and day = ${day}`
      duels: if (dps.length && games.every(isDone) && withDuel.every(g => results[g.id]) && dps.every(p => p.result) && !dclosed) {
        const total = withDuel.filter(g => results[g.id].winner).length
        const mine = dps.filter(p => results[p.game_id]?.winner)
        const correct = mine.filter(p => p.pick === results[p.game_id].winner).length
        let reward = total > 0 && correct === total ? 'duel' : correct * 2 > total ? 'rare' : null
        let claimed = null
        if (reward === 'duel' && !fullDay(file, day, games)) break duels // the Duel of the Day card comes with the whole day's file: close the day then
        if (reward === 'duel') {
          if (file.duel) {
            const c = duelCard(file.duel)
            const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${userId}, null, 'duel', ${refOf(c)}, ${t.json(c)}, ${cardPoints(c).points}, 'matchups')
              on conflict (user_id, ref) do nothing returning id`
            claimed = c
            if (row) awards.push({ kind: 'predreward', amount: 0, label: `Every matchup right: the Duel of the Day card is in your binder` })
          } else reward = 'legend' // no game produced a Duel of the Day: choose a Legend or below instead
        }
        await t`insert into duel_days (user_id, day, total, picked, correct, reward, claimed_ref, claimed_card, claimed_at)
          values (${userId}, ${day}, ${total}, ${mine.length}, ${correct}, ${reward}, ${claimed ? refOf(claimed) : null}, ${claimed ? t.json(claimed) : null}, ${claimed ? new Date() : null})
          on conflict do nothing`
        if (reward === 'rare' || reward === 'legend') awards.push({ kind: 'predreward', amount: 0, label: 'Matchups: more than half right, choose a card from the day' })
      }
      // The lineup
      const slots = await t`select * from lineups where user_id = ${userId} and day = ${day} order by slot`
      const [lclosed] = await t`select 1 from lineup_days where user_id = ${userId} and day = ${day}`
      const slotGs = s_ => { const g = byId.get(s_.game_id); return !g || g.state === 'off' ? null : src.has(g) ? src.gs(g, s_.team, s_.player) : undefined }
      if (slots.length && games.every(isDone) && !lclosed && slots.every(s_ => slotGs(s_) !== undefined)) {
        let total = 0
        for (const s_ of slots) {
          const gs = slotGs(s_) ?? 0 // didn't play: 0
          total += lineupPts(gs, s_.mult ?? PRED.lineupMult[s_.tier] ?? 1)
          await t`update lineups set gs = ${gs} where user_id = ${userId} and day = ${day} and slot = ${s_.slot}`
        }
        const coins = Math.max(0, Math.min(PRED.lineupMax, Math.round(total)))
        await t`insert into lineup_days (user_id, day, total, coins) values (${userId}, ${day}, ${Math.round(total * 10) / 10}, ${coins}) on conflict do nothing`
        if (coins) push(await grant(t, userId, today, 'lineup', coins, { ref: day, label: `Lineup: ${total.toFixed(1)} points` }))
      }
      // Player of the Day call: graded from the day's cards, which name the Player of the Day
      const [pp] = await t`select * from potd_picks where user_id = ${userId} and day = ${day} for update`
      const potd = potdOf(file, day, games)
      if (pp && !pp.credited && potd) {
        const win = norm(potd.row.n) === norm(pp.player)
        if (win) {
          const c = rubyOf(potd)
          const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${userId}, null, ${c.tier}, ${refOf(c)}, ${t.json(c)}, ${cardPoints(c).points}, 'potd')
            on conflict (user_id, ref) do nothing returning id`
          if (row) awards.push({ kind: 'potdcard', amount: 0, label: `You called the Player of the Day: ruby ${potd.row.n} is in your binder` })
          push(await grant(t, userId, today, 'potdcorrect', PRED.potd, { ref: day, label: `Player of the Day called: ${potd.row.n}` }))
        }
        await t`update potd_picks set result = ${win ? 'win' : 'loss'}, credited = true where user_id = ${userId} and day = ${day}`
      }
    })
  }
  awards.push(...(await repairPotd(sql, userId, today, origin)))
  return awards
}

// A Player of the Day call graded a loss against a partial day file (Oct. 29, 2026: the night's first run had two
// games): once the whole day is in and names the player called, the call is a win after all, with its ruby card and
// Coins. Only the last few days, and never the other way (a win stays a win).
async function repairPotd(sql, userId, today, origin) {
  if (!origin) return []
  const out = []
  for (const r of await sql`select day, player from potd_picks where user_id = ${userId} and result = 'loss' and day >= ${addDays(today, -4)}`) {
    const day = iso(r.day)
    const games = await slate(sql, day, { origin }).catch(() => [])
    const potd = potdOf(await dayFile(origin, day).catch(() => null), day, games)
    if (!potd || norm(potd.row.n) !== norm(r.player)) continue
    await sql.begin(async t => {
      const [x] = await t`update potd_picks set result = 'win', credited = true where user_id = ${userId} and day = ${day} and result = 'loss' returning 1`
      if (!x) return
      const c = rubyOf(potd)
      const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${userId}, null, ${c.tier}, ${refOf(c)}, ${t.json(c)}, ${cardPoints(c).points}, 'potd')
        on conflict (user_id, ref) do nothing returning id`
      if (row) out.push({ kind: 'potdcard', amount: 0, label: `You called the Player of the Day after all: ruby ${potd.row.n} is in your binder` })
      const a = await grant(t, userId, today, 'potdcorrect', PRED.potd, { ref: day, label: `Player of the Day called: ${potd.row.n}` })
      if (a) out.push(a)
    })
  }
  return out
}

// The summary `me` carries: today's slate size, your picks, cards waiting to be chosen
export async function predSummary(sql, userId, today) {
  const [x] = await sql`select (select count(*)::int from pred_games where day = ${today} and state <> 'off') as games,
      (select count(*)::int from predictions where user_id = ${userId} and day = ${today}) as picked,
      (select count(*)::int from pred_games where day = ${today} and state = 'pre' and tip > now()) as open,
      (select count(*)::int from pred_days where user_id = ${userId} and reward is not null and claimed_ref is null)
        + (select count(*)::int from duel_days where user_id = ${userId} and reward in ('rare', 'legend') and claimed_ref is null) as unclaimed`
  return x
}

// ── Stats ────────────────────────────────────────────────────────────────────
function stats({ picks, days, duels, duelDays, lineDays, coins }) {
  const graded = picks.filter(r => r.result === 'win' || r.result === 'loss').sort((a, b) => a.tip - b.tip || a.game_id.localeCompare(b.game_id))
  let cur = 0, best = 0
  graded.forEach(r => { cur = r.result === 'win' ? cur + 1 : 0; best = Math.max(best, cur) })
  const wins = graded.filter(r => r.result === 'win').length
  // Beat the Forecast: your wins against the wins the forecast expected from your picks
  const rated = graded.filter(r => r.chance != null)
  const expected = rated.reduce((a, r) => a + r.chance, 0)
  const ratedWins = rated.filter(r => r.result === 'win').length
  const favWon = rated.filter(r => (r.chance >= 0.5) === (r.result === 'win')).length // the forecast's favorite won
  const dogs = rated.filter(r => r.chance < 0.5)
  const locks = graded.filter(r => r.lock)
  const byTeam = {}
  graded.forEach(r => { const b = (byTeam[r.pick] = byTeam[r.pick] || [0, 0]); b[r.result === 'win' ? 0 : 1]++ })
  const teams = Object.entries(byTeam).map(([t, [w, l]]) => ({ team: t, w, l })).sort((a, b) => b.w + b.l - (a.w + a.l) || b.w - a.w)
  const dg = duels.filter(r => r.result === 'win' || r.result === 'loss')
  return {
    picks: graded.length, wins, losses: graded.length - wins, pct: graded.length ? wins / graded.length : null,
    streak: cur, best, days: days.length, perfect: days.filter(d => d.correct === d.total).length,
    rewards: days.filter(d => d.reward).length, claimed: days.filter(d => d.claimed_ref).length + duelDays.filter(d => d.claimed_ref).length,
    upsets: dogs.filter(r => r.result === 'win').length, dogPicks: dogs.length, coins,
    forecast: { rated: rated.length, wins: ratedWins, expected: Math.round(expected * 10) / 10, over: Math.round((ratedWins - expected) * 10) / 10, favW: favWon, favL: rated.length - favWon },
    locks: { w: locks.filter(r => r.result === 'win').length, l: locks.filter(r => r.result === 'loss').length },
    duels: { w: dg.filter(r => r.result === 'win').length, l: dg.filter(r => r.result === 'loss').length, cards: duelDays.filter(d => d.reward === 'duel' && d.claimed_ref).length },
    lineup: { days: lineDays.length, best: lineDays.reduce((m, d) => Math.max(m, d.total), 0), avg: lineDays.length ? Math.round(lineDays.reduce((a, d) => a + d.total, 0) / lineDays.length * 10) / 10 : null },
    teams: teams.slice(0, 6),
  }
}

// ── Lineups ──────────────────────────────────────────────────────────────────
// A slot's points: Game Score times the card's multiplier; a bad night isn't magnified
export const lineupPts = (gs, mult) => (gs > 0 ? gs * (mult || 1) : gs)
const multOf = tier => PRED.lineupMult[tier] || 1
const restOf = tier => PRED.lineupRest[tier] || 0
// The other days each card is in a lineup, near enough to matter for its rest
async function cardDays(sql, userId, day, ids) {
  if (!ids.length) return new Map()
  const rows = await sql`select card_id, day from lineups where user_id = ${userId} and card_id = any(${ids.map(String)}::bigint[])
    and day <> ${day} and day > ${addDays(day, -8)} and day < ${addDays(day, 8)}`
  const m = new Map()
  for (const r of rows) { const k = Number(r.card_id); if (!m.has(k)) m.set(k, []); m.get(k).push(iso(r.day)) }
  return m
}
const gap = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5)
// Resting on `day` (null if free): the nearest other lineup day closer than the card's rest
function restInfo(tier, days, day) {
  const n = restOf(tier)
  if (!n || !days?.length) return null
  const clash = days.filter(d => Math.abs(gap(day, d)) < n).sort()
  if (!clash.length) return null
  const before = clash.filter(d => d < day), after = clash.filter(d => d > day)
  return before.length ? { since: before[before.length - 1], until: addDays(before[before.length - 1], n) } : { next: after[0], days: n }
}
// Your players who play that day (any card of theirs counts) and your five slots
async function lineupView(sql, u, origin, day, games) {
  const live = games.filter(g => g.state !== 'off')
  const slots = await sql`select l.*, c.card from lineups l left join cards c on c.id = l.card_id where l.user_id = ${u.id} and l.day = ${day} order by slot`
  const [graded] = await sql`select total, coins from lineup_days where user_id = ${u.id} and day = ${day}`
  const gameOf = t => live.find(g => g.home === t || g.away === t)
  const slotView = s_ => {
    const g = gameOf(s_.team)
    const tier = s_.tier || s_.card?.tier, mult = s_.mult ?? (graded && s_.gs != null ? 1 : multOf(tier))
    return { slot: s_.slot, cardId: Number(s_.card_id), player: s_.player, team: s_.team, opp: g ? (g.home === s_.team ? g.away : g.home) : null, home: g?.home === s_.team,
      tip: g?.tip || null, open: g ? isOpen(g) : false, gs: s_.gs, pts: s_.gs == null ? null : Math.round(lineupPts(s_.gs, mult) * 10) / 10, tier, mult, rest: restOf(tier), card: s_.card }
  }
  let candidates = []
  if (live.some(isOpen) && origin) {
    const teams = [...new Set(live.flatMap(g => [g.home, g.away]))]
    const R = await rosters(origin, teams, day).catch(() => ({}))
    const onTeam = new Map()
    for (const [t, rows] of Object.entries(R)) for (const r of rows) onTeam.set(norm(r.name), { ...r, team: t })
    // Game cards only (special cards have no single game line), every card of each player who plays
    const mine = (await sql`select id, card, points, tier from cards where user_id = ${u.id} and tier = any(${TIER_ORDER})`).filter(c => c.card?.row?.n)
    const used = await cardDays(sql, u.id, day, mine.map(c => c.id))
    const by = new Map()
    for (const c of mine) {
      const k = norm(c.card.row.n), r = onTeam.get(k)
      if (!r) continue
      if (!by.has(k)) by.set(k, { r, cards: [] })
      const rest = restInfo(c.tier, used.get(Number(c.id)), day)
      by.get(k).cards.push({ cardId: Number(c.id), tier: c.tier, mult: multOf(c.tier), rest: restOf(c.tier), resting: rest, points: c.points, card: c.card })
    }
    candidates = [...by.values()].map(({ r, cards }) => {
      const g = gameOf(r.team)
      // Best multiplier first; among equals, the card worth the most
      cards.sort((a, b) => !!a.resting - !!b.resting || b.mult - a.mult || b.points - a.points)
      const top = cards[0]
      return { name: r.name, team: r.team, opp: g.home === r.team ? g.away : g.home, home: g.home === r.team, tip: g.tip, open: isOpen(g),
        elo: r.elo, mp: r.mp, out: r.out, status: r.status, cardId: top.cardId, card: top.card, tier: top.tier, mult: top.mult, resting: top.resting,
        cards: cards.map(({ card, points, ...x }) => x), n: cards.length }
    }).sort((a, b) => b.open - a.open || !!a.resting - !!b.resting || b.mult * b.elo - a.mult * a.elo)
  }
  return { slots: slots.map(slotView), candidates, graded: graded ? { total: graded.total, coins: graded.coins } : null }
}

const tierLabel = t => ({ goat: 'GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare', common: 'Common' })[t] || t
const fmtD = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
export async function setLineup(sql, u, b, origin, today) {
  const day = String(b.day || ''), slot = Number(b.slot)
  if (day < today || day > addDays(today, 1)) throw fail(400, 'Lineups are for today’s and tomorrow’s games.')
  if (!(slot >= 0 && slot < PRED.slots)) throw fail(400, 'Pick one of the five slots.')
  const games = (await slate(sql, day, { origin })).filter(g => g.state !== 'off')
  const [cur] = await sql`select * from lineups where user_id = ${u.id} and day = ${day} and slot = ${slot}`
  const curGame = cur && games.find(g => g.id === cur.game_id)
  if (cur && curGame && !isOpen(curGame)) throw fail(409, `${cur.player}’s game has tipped off. That slot is locked.`)
  if (b.card == null) { if (cur) await sql`delete from lineups where user_id = ${u.id} and day = ${day} and slot = ${slot}`; return }
  const [c] = await sql`select id, card, tier from cards where id = ${Number(b.card)} and user_id = ${u.id}`
  if (!c || !TIER_ORDER.includes(c.tier) || !c.card?.row?.n) throw fail(404, 'Pick a game card from your binder.')
  const rest = restInfo(c.tier, (await cardDays(sql, u.id, day, [c.id])).get(Number(c.id)), day)
  if (rest) throw fail(409, rest.until ? `That ${tierLabel(c.tier)} card is resting. It can play again ${fmtD(rest.until)}.`
    : `That ${tierLabel(c.tier)} card plays on ${fmtD(rest.next)}, and needs ${rest.days} days between games.`)
  const teams = [...new Set(games.flatMap(g => [g.home, g.away]))]
  const R = await rosters(origin, teams, day)
  const k = norm(c.card.row.n)
  const team = Object.keys(R).find(t => R[t].some(r => norm(r.name) === k))
  if (!team) throw fail(409, `${c.card.row.n} doesn’t play ${day === today ? 'today' : 'tomorrow'}.`)
  const g = games.find(x => x.home === team || x.away === team)
  if (!isOpen(g)) throw fail(409, `${c.card.row.n}’s game has tipped off.`)
  const dup = await sql`select slot from lineups where user_id = ${u.id} and day = ${day} and slot <> ${slot}`
  for (const d of dup) {
    const [o] = await sql`select player from lineups where user_id = ${u.id} and day = ${day} and slot = ${d.slot}`
    if (norm(o.player) === k) throw fail(409, `${c.card.row.n} is already in your lineup.`)
  }
  await sql`insert into lineups (user_id, day, slot, card_id, player, team, game_id, tier, mult) values (${u.id}, ${day}, ${slot}, ${c.id}, ${c.card.row.n}, ${team}, ${g.id}, ${c.tier}, ${multOf(c.tier)})
    on conflict (user_id, day, slot) do update set card_id = excluded.card_id, player = excluded.player, team = excluded.team, game_id = excluded.game_id, tier = excluded.tier, mult = excluded.mult, made_at = now()`
}

// ── Everything the Predictions page shows ────────────────────────────────────
export async function predView(sql, u, today, tomorrow, origin) {
  const awards = await settle(sql, u.id, today, { origin }).catch(e => { console.error('settle', e); return [] })
  const yesterday = addDays(today, -1)
  // [today, tomorrow, yesterday]: the client's slates are today and tomorrow; yesterday comes as `prev`
  const slates = await Promise.all([today, tomorrow, yesterday].map(d => slate(sql, d, { origin }).catch(() => [])))
  const ids = slates.flat().map(g => g.id)
  const mine = await sql`select game_id, pick, result, bonus, lock from predictions where user_id = ${u.id} and game_id = any(${ids})`
  const mineD = await sql`select game_id, pick, result from duel_picks where user_id = ${u.id} and game_id = any(${ids})`
  const crowd = await sql`select game_id, pick, count(*)::int as n from predictions where game_id = any(${ids}) group by game_id, pick`
  const decorate = g => {
    const p = mine.find(x => x.game_id === g.id), dp = mineD.find(x => x.game_id === g.id)
    const c = crowd.filter(x => x.game_id === g.id), tot = c.reduce((a, x) => a + x.n, 0)
    return { ...g, open: isOpen(g), pick: p?.pick || null, result: p?.result || null, bonus: p?.bonus || 0, lock: !!p?.lock,
      crowd: tot ? { n: tot, home: (c.find(x => x.pick === g.home)?.n || 0) / tot } : null,
      upset: { [g.home]: upsetBonus(dogChance(g, g.home)), [g.away]: upsetBonus(dogChance(g, g.away)) },
      duel: g.line?.duel ? { ...g.line.duel, pick: dp?.pick || null, result: dp?.result || null } : null }
  }
  const all = await Promise.all([today, tomorrow, yesterday].map(async (day, i) => {
    const games = slates[i].filter(g => g.state !== 'off').map(decorate)
    return { day, games, lineup: await lineupView(sql, u, origin, day, slates[i]).catch(e => { console.error('lineup', e); return { slots: [], candidates: [], graded: null } }),
      potd: await potdView(sql, u, origin, day, slates[i]).catch(e => { console.error('potd', e); return { pick: null, open: false, candidates: [], winner: null } }) }
  }))
  const view = all.slice(0, 2), prev = all[2]
  const picks = await sql`select p.game_id, p.pick, p.result, p.chance, p.bonus, p.lock, p.day, g.tip from predictions p join pred_games g on g.id = p.game_id where p.user_id = ${u.id}`
  const duels = await sql`select game_id, pick, result, day from duel_picks where user_id = ${u.id}`
  const days = await sql`select * from pred_days where user_id = ${u.id} order by day desc`
  const duelDays = await sql`select * from duel_days where user_id = ${u.id} order by day desc`
  const lineDays = await sql`select * from lineup_days where user_id = ${u.id} order by day desc`
  const potds = await sql`select day, player, team, result from potd_picks where user_id = ${u.id}`
  const [c] = await sql`select coalesce(sum(amount), 0)::int as n from coin_ledger where user_id = ${u.id}
    and kind in ('predict', 'predcorrect', 'upset', 'perfect', 'lock', 'lockloss', 'duelcorrect', 'lineup', 'pickweekly', 'potdcorrect')`
  // History: one row a day, with the picks, the matchups and the lineup
  const H = new Map()
  const at = d => { const k = iso(d); if (!H.has(k)) H.set(k, { day: k }); return H.get(k) }
  for (const r of picks) { const h = at(r.day); h.open = h.open || { picked: 0, graded: 0, correct: 0 }; h.open.picked++; if (r.result === 'win' || r.result === 'loss') h.open.graded++; if (r.result === 'win') h.open.correct++ }
  for (const d of days) at(d.day).games = { total: d.total, picked: d.picked, correct: d.correct, upsets: d.upsets, reward: d.reward,
    claimed: d.claimed_ref ? { ref: d.claimed_ref, card: d.claimed_card } : null, lock: picks.find(p => iso(p.day) === iso(d.day) && p.lock)?.result || null }
  for (const r of duels) { const h = at(r.day); h.dopen = h.dopen || { picked: 0 }; h.dopen.picked++ }
  for (const d of duelDays) at(d.day).duels = { total: d.total, picked: d.picked, correct: d.correct, reward: d.reward, claimed: d.claimed_ref ? { ref: d.claimed_ref, card: d.claimed_card } : null }
  for (const d of lineDays) at(d.day).lineup = { total: d.total, coins: d.coins }
  for (const r of potds) at(r.day).potd = { player: r.player, team: r.team, result: r.result }
  // Lineups set but not scored yet still make a day
  for (const r of await sql`select distinct day from lineups where user_id = ${u.id}`) { const h = at(r.day); if (!h.lineup) h.lopen = true }
  const history = [...H.values()].sort((a, b) => b.day.localeCompare(a.day))
  return {
    awards, slates: view, prev, history,
    stats: { ...stats({ picks: picks.map(r => ({ ...r, tip: Date.parse(r.tip) })), days, duels, duelDays, lineDays: lineDays.map(d => ({ ...d, total: +d.total })), coins: c.n }),
      potd: { w: potds.filter(r => r.result === 'win').length, l: potds.filter(r => r.result === 'loss').length } },
    rates: PRED,
  }
}

async function openGame(sql, origin, id, today) {
  const [row] = await sql`select day from pred_games where id = ${id}`
  if (!row) throw fail(404, 'That game isn’t on the slate.')
  const day = iso(row.day)
  if (day < today) throw fail(409, 'That game has already been played.')
  const g = (await slate(sql, day, { fresh: true, origin })).find(x => x.id === id)
  if (!g || g.state === 'off') throw fail(409, 'That game is off the schedule.')
  if (!isOpen(g)) throw fail(409, 'That game has tipped off. Picks lock at tipoff.')
  return { g, day }
}

export async function predict(sql, u, b, today, origin) {
  const id = String(b.game || ''), team = String(b.team || '')
  const { g, day } = await openGame(sql, origin, id, today)
  if (team !== g.home && team !== g.away) throw fail(400, 'Pick one of the two teams.')
  const awards = []
  await sql.begin(async t => {
    await t`insert into predictions (user_id, game_id, day, pick) values (${u.id}, ${id}, ${day}, ${team})
      on conflict (user_id, game_id) do update set pick = excluded.pick, updated_at = now() where predictions.result is null`
    const a = await grant(t, u.id, today, 'predict', PRED.pick, { ref: id, label: `Pick made: ${g.away} at ${g.home}` })
    if (a) awards.push(a)
  })
  return awards
}

// Make a pick your Lock of the Day (or take the lock off). The lock moves freely until its game tips off.
export async function setLock(sql, u, b, today, origin) {
  const id = String(b.game || '')
  const { day } = await openGame(sql, origin, id, today)
  const [p] = await sql`select pick from predictions where user_id = ${u.id} and game_id = ${id}`
  if (!p) throw fail(400, 'Pick a winner first, then make it your lock.')
  const [cur] = await sql`select p.game_id, g.tip, g.state from predictions p join pred_games g on g.id = p.game_id where p.user_id = ${u.id} and p.day = ${day} and p.lock`
  if (cur && cur.game_id !== id && (cur.state !== 'pre' || new Date(cur.tip) <= new Date())) throw fail(409, 'Your Lock of the Day has tipped off. It stays where it is.')
  await sql.begin(async t => {
    await t`update predictions set lock = false where user_id = ${u.id} and day = ${day} and lock`
    if (b.on !== false) await t`update predictions set lock = true where user_id = ${u.id} and game_id = ${id}`
  })
}

export async function duelPick(sql, u, b, today, origin) {
  const id = String(b.game || ''), player = String(b.player || '')
  const { g, day } = await openGame(sql, origin, id, today)
  const d = g.line?.duel
  if (!d) throw fail(409, 'That game has no matchup yet.')
  if (d.void) throw fail(409, `That matchup is void: ${(d.out || []).join(' and ') || 'a player'} ruled out.`)
  if (player !== d.a && player !== d.b) throw fail(400, 'Pick one of the two players.')
  await sql`insert into duel_picks (user_id, game_id, day, pick) values (${u.id}, ${id}, ${day}, ${player})
    on conflict (user_id, game_id) do update set pick = excluded.pick, made_at = now() where duel_picks.result is null`
}

// ── Reward cards: a card from the day for game picks (Legend or below / any) or matchups (Rare or below) ──
async function rewardRow(sql, u, day, kind) {
  const [d] = kind === 'duels' ? await sql`select * from duel_days where user_id = ${u.id} and day = ${day}` : await sql`select * from pred_days where user_id = ${u.id} and day = ${day}`
  if (!d?.reward || d.reward === 'duel') throw fail(404, 'No card to choose for that day.')
  return d
}
const capOf = reward => (reward === 'any' ? 99 : reward === 'legend' ? LEGEND_CAP : RARE_CAP)

export async function rewardOptions(sql, u, origin, day, kind = 'games') {
  const d = await rewardRow(sql, u, day, kind)
  const file = await dayFile(origin, day)
  if (!file) return { day, kind, reward: d.reward, pending: true, cards: [] }
  const owned = new Set((await sql`select ref from cards where user_id = ${u.id} and ref = any(${file.cards.map(refOf)})`).map(r => r.ref))
  return {
    day, kind, reward: d.reward, claimed: d.claimed_ref ? { ref: d.claimed_ref, card: d.claimed_card } : null,
    cards: file.cards.map(c => ({ card: c, points: cardPoints(c).points, owned: owned.has(refOf(c)), ok: TIER_ORDER.indexOf(c.tier) <= capOf(d.reward) })),
  }
}

export async function claimReward(sql, u, origin, b, today) {
  const day = String(b.day || ''), ref = String(b.ref || ''), kind = b.kind === 'duels' ? 'duels' : 'games'
  const file = await dayFile(origin, day)
  if (!file) throw fail(409, 'That day’s cards aren’t published yet. They arrive with the morning update.')
  const c = file.cards.find(x => refOf(x) === ref)
  if (!c) throw fail(400, 'That card isn’t from that day.')
  return sql.begin(async t => {
    const [d] = kind === 'duels' ? await t`select * from duel_days where user_id = ${u.id} and day = ${day} for update` : await t`select * from pred_days where user_id = ${u.id} and day = ${day} for update`
    if (!d?.reward || d.reward === 'duel') throw fail(404, 'No card to choose for that day.')
    if (d.claimed_ref) throw fail(409, 'You already chose your card for that day.')
    if (TIER_ORDER.indexOf(c.tier) > capOf(d.reward)) throw fail(403, d.reward === 'rare' ? 'Matchups earn a Rare or a Common.' : 'More than half right earns a Legend or below. Icons and GOATs take a perfect day.')
    const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${u.id}, null, ${c.tier}, ${ref}, ${t.json(c)}, ${cardPoints(c).points}, 'predict')
      on conflict (user_id, ref) do nothing returning id`
    if (!row) throw fail(409, 'That card is already in your binder. Choose another.')
    if (kind === 'duels') await t`update duel_days set claimed_ref = ${ref}, claimed_card = ${t.json(c)}, claimed_at = now() where user_id = ${u.id} and day = ${day}`
    else await t`update pred_days set claimed_ref = ${ref}, claimed_card = ${t.json(c)}, claimed_at = now() where user_id = ${u.id} and day = ${day}`
    return { cardId: Number(row.id), awards: await cardRewards(t, u.id, today, origin, c) }
  })
}

// ── Standings: pick'em points by week or season ──────────────────────────────
// Grade recent days for everyone before ranking (grading happens when a slate or the day's cards are read)
async function refresh(sql, origin, today) {
  const open = await sql`select distinct day from predictions where result is null and day <= ${today} and day >= ${addDays(today, -8)}
    union select distinct day from duel_picks where result is null and day < ${today} and day >= ${addDays(today, -8)} order by day`
  for (const { day: d } of open) {
    const day = iso(d)
    const games = await slate(sql, day, { origin }).catch(() => [])
    if (games.length) await gradeMatchups(sql, games, await gradeSource(origin, day, games))
    await gradePotd(sql, origin, day, games)
  }
  for (const { day: d } of await sql`select distinct day from potd_picks where result is null and day < ${today} and day >= ${addDays(today, -8)}`) {
    const day = iso(d)
    await gradePotd(sql, origin, day, await slate(sql, day, { origin }).catch(() => []))
  }
}
// Everyone's Player of the Day calls for a finished day (results only; Coins and the card come with each collector's settle)
async function gradePotd(sql, origin, day, games) {
  if (!origin || !games.length || !games.every(isDone)) return
  const top = potdOf(await dayFile(origin, day), day, games)
  if (!top) return
  for (const r of await sql`select user_id, player from potd_picks where day = ${day} and result is null`)
    await sql`update potd_picks set result = ${norm(r.player) === norm(top.row.n) ? 'win' : 'loss'} where user_id = ${r.user_id} and day = ${day} and result is null`
}

async function rank(sql, from, to, limit) {
  return sql`with p as (
      select user_id, count(*) filter (where result = 'win')::int as w, count(*) filter (where result in ('win', 'loss'))::int as n,
        count(*) filter (where result = 'win' and lock)::int as lw,
        coalesce(sum(case when result in ('win', 'loss') and chance is not null then (case when result = 'win' then 1 else 0 end) - chance end), 0)::float as over
      from predictions where day between ${from} and ${to} group by user_id),
    d as (select user_id, count(*) filter (where result = 'win')::int as w, count(*) filter (where result in ('win', 'loss'))::int as n
      from duel_picks where day between ${from} and ${to} group by user_id),
    o as (select user_id, count(*) filter (where result = 'win')::int as w, count(*) filter (where result in ('win', 'loss'))::int as n
      from potd_picks where day between ${from} and ${to} group by user_id)
    select u.id, u.username, u.favorite_team, coalesce(p.w, 0) + coalesce(p.lw, 0) + coalesce(d.w, 0) + ${PRED.potdStand} * coalesce(o.w, 0) as score,
      coalesce(p.w, 0) as w, coalesce(p.n, 0) as n, coalesce(d.w, 0) as dw, coalesce(d.n, 0) as dn, coalesce(p.lw, 0) as lw, coalesce(p.over, 0) as over,
      coalesce(o.w, 0) as ow, coalesce(o.n, 0) as on_
    from users u left join p on p.user_id = u.id left join d on d.user_id = u.id left join o on o.user_id = u.id
    where coalesce(p.n, 0) + coalesce(d.n, 0) + coalesce(o.n, 0) > 0
    order by score desc, over desc, u.id limit ${limit}`
}

export async function standings(sql, origin, scope, today, viewer) {
  await refresh(sql, origin, today).catch(e => console.error('refresh', e.message))
  const from = scope === 'season' ? seasonStart(today) : weekStart(today), to = scope === 'season' ? today : addDays(weekStart(today), 6)
  const rows = await rank(sql, from, to, 1000)
  let r = 0, prev = null
  const all = rows.map((x, i) => { if (prev !== x.score) { r = i + 1; prev = x.score } return { rank: r, username: x.username, favoriteTeam: x.favorite_team, score: x.score,
    picks: [x.w, x.n - x.w], matchups: [x.dw, x.dn - x.dw], locks: x.lw, potd: [x.ow, x.on_ - x.ow], over: Math.round(x.over * 10) / 10, id: x.id } })
  const you = viewer ? all.find(x => x.id === viewer.id) || null : null
  const strip = ({ id, ...x }) => x
  return { scope, from, to, entrants: all.length, leaders: all.slice(0, 25).map(strip), you: you ? strip(you) : null,
    payouts: scope === 'week' ? { top10: PRED.weeklyTop10, top50: PRED.weeklyTop50 } : null }
}

// Last week's pick'em top 10 and top 50 are paid once, the first time anyone visits in the new week
export async function settlePickWeek(sql, origin, today) {
  const last = addDays(weekStart(today), -7)
  const [x] = await sql`select 1 from pick_settlements where week = ${last}`
  if (x) return
  await refresh(sql, origin, today).catch(() => {})
  const [first] = await sql`insert into pick_settlements (week) values (${last}) on conflict do nothing returning week`
  if (!first) return
  const rows = (await rank(sql, last, addDays(last, 6), 50)).filter(r => r.score > 0)
  await sql.begin(async t => {
    for (const [i, r] of rows.entries()) {
      await grant(t, r.id, today, 'pickweekly', i < 10 ? PRED.weeklyTop10 : PRED.weeklyTop50, { ref: last, label: `Pick’em, week of ${last}: No. ${i + 1}` })
    }
  })
}

// ── Predict the Player of the Day ───────────────────────────────────────────
// One nomination a day, open until the day's first tipoff: any player on a team that plays that day
const firstTip = games => games.filter(g => g.state !== 'off').reduce((m, g) => (!m || Date.parse(g.tip) < Date.parse(m) ? g.tip : m), null)
const potdOpen = games => { const live = games.filter(g => g.state !== 'off'); return live.length > 0 && live.every(isOpen) }

async function potdView(sql, u, origin, day, games) {
  const live = games.filter(g => g.state !== 'off')
  const [pp] = await sql`select player, team, result from potd_picks where user_id = ${u.id} and day = ${day}`
  const open = potdOpen(games)
  let candidates = []
  if (open && origin) {
    const R = await rosters(origin, [...new Set(live.flatMap(g => [g.home, g.away]))], day).catch(() => ({}))
    for (const g of live) for (const t of [g.away, g.home]) for (const r of R[t] || []) {
      if (r.out || !(r.mp > 0)) continue
      candidates.push({ name: r.name, team: t, opp: t === g.home ? g.away : g.home, home: t === g.home, tip: g.tip, elo: r.elo, mp: r.mp, status: r.status })
    }
    candidates.sort((a, b) => b.elo - a.elo)
  }
  const top = live.length && live.every(isDone) && origin ? potdOf(await dayFile(origin, day).catch(() => null), day, live) : null
  return { pick: pp ? { player: pp.player, team: pp.team, result: pp.result } : null, open, lock: firstTip(games), candidates,
    winner: top ? { name: top.row.n, team: top.t, gs: top.row.gs, pts: top.row.pts, trb: top.row.trb, ast: top.row.ast, card: top, ruby: pp?.result === 'win' } : null }
}

export async function potdPick(sql, u, b, today, origin) {
  const day = String(b.day || ''), player = String(b.player || '').trim(), team = String(b.team || '')
  if (day !== today && day !== addDays(today, 1)) throw fail(400, 'Player of the Day picks are for today and tomorrow.')
  const games = await slate(sql, day, { origin })
  if (!potdOpen(games)) throw fail(409, 'The day’s first game has tipped off, so the Player of the Day pick is in.')
  if (!player) { await sql`delete from potd_picks where user_id = ${u.id} and day = ${day} and result is null`; return }
  if (!games.some(g => g.state !== 'off' && (g.home === team || g.away === team))) throw fail(400, 'That player’s team doesn’t play that day.')
  await sql`insert into potd_picks (user_id, day, player, team) values (${u.id}, ${day}, ${player}, ${team})
    on conflict (user_id, day) do update set player = excluded.player, team = excluded.team, made_at = now() where potd_picks.result is null`
}

// ── Player of the Week ───────────────────────────────────────────────────────
// The NBA's best player of a Monday–Sunday week: the Player of the Day measure (Game Score + Elo gained ÷ 6), added
// up over his games, two or more. From the week's day files, so it waits for Sunday's to be published.
const r1 = v => Math.round(v * 10) / 10
// Every player's week so far, best first: the Player of the Day measure added up (two games to qualify)
async function weekRows(origin, week) {
  const by = new Map()
  let through = null
  for (let i = 0; i < 7; i++) {
    const day = addDays(week, i)
    const f = await dayFile(origin, day)
    if (f?.cards.length) through = day
    for (const c of f?.cards || []) {
      const r = c.row
      if (c.date !== day || r.gs == null || !((r.mp || 0) > 0 || r.mp == null)) continue
      const x = by.get(r.n) || { n: r.n, games: [] }
      x.games.push(c); by.set(r.n, x)
    }
  }
  const rows = [...by.values()].map(x => ({ ...x, score: x.games.reduce((a, c) => a + (c.row.gs || 0) + ((c.row.post - c.row.pre) || 0) / 6, 0) }))
    .sort((a, b) => (b.games.length >= 2) - (a.games.length >= 2) || b.score - a.score)
  return { rows, through }
}
// One player's week as the card (and the table) shows it
function weekLine(x, week) {
  const G = x.games.sort((a, b) => a.date.localeCompare(b.date)), last = G[G.length - 1]
  const sum = k => G.reduce((a, c) => a + (c.row[k] || 0), 0)
  const top = [...G].sort((a, b) => (b.row.gs || 0) - (a.row.gs || 0))[0]
  return {
    kind: 'potw', tier: 'potw', week, end: addDays(week, 6), s: last.s, n: x.n, t: last.t, tn: last.tn, tc: last.tc, pos: last.row.pos,
    gp: G.length, w: G.filter(c => c.won).length, pts: r1(sum('pts') / G.length), trb: r1(sum('trb') / G.length), ast: r1(sum('ast') / G.length),
    gs: r1(sum('gs') / G.length), score: r1(x.score), elo: [r1(G[0].row.pre), r1(last.row.post)], lrp: last.row.lrp ?? null,
    games: G.map(c => ({ date: c.date, o: c.o, home: c.home, won: c.won, score: c.score, pts: c.row.pts, trb: c.row.trb, ast: c.row.ast, gs: c.row.gs, d: r1(c.row.post - c.row.pre) })),
    best: { date: top.date, o: top.o, pts: top.row.pts, gs: top.row.gs },
  }
}
// Running totals for one player's week (the page adds live games to these)
function weekSums(x) {
  const G = [...x.games].sort((a, b) => a.date.localeCompare(b.date)), last = G[G.length - 1]
  const sum = k => G.reduce((a, c) => a + (c.row[k] || 0), 0)
  return { n: x.n, t: last.t, tn: last.tn, tc: last.tc, pos: last.row.pos, s: last.s, gp: G.length, w: G.filter(c => c.won).length,
    pts: sum('pts'), trb: sum('trb'), ast: sum('ast'), gs: r1(sum('gs')), score: r1(x.score), e0: r1(G[0].row.pre), e1: r1(last.row.post) }
}
export async function weekStar(origin, week) {
  const { rows } = await weekRows(origin, week)
  const best = rows.find(x => x.games.length >= 2)
  return best ? weekLine(best, week) : null
}

// The Scoreboard's PotW tab: a week's top 20 so far (the frontrunner first), the pick'em race, and the card once settled
const boards = new Map()
export async function potwWeek(sql, origin, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail(400, 'Pick a day.')
  const week = weekStart(day), end = addDays(week, 6)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [done] = await sql`select card, winners from potw_weeks where week = ${week}`
  const m = boards.get(week)
  let board = m && Date.now() - m.at < 10 * 60e3 ? m.data : null
  if (!board) {
    const { rows, through } = await weekRows(origin, week)
    // all: every player's week as running totals, so the page can add tonight's live games and re-rank
    board = { through, top: rows.slice(0, 20).map(x => ({ ...weekLine(x, week), games: undefined, qualified: x.games.length >= 2 })),
      leader: rows[0]?.games.length >= 2 ? weekLine(rows[0], week) : null, all: rows.map(weekSums) }
    boards.set(week, { at: Date.now(), data: board })
    if (boards.size > 20) boards.delete(boards.keys().next().value)
  }
  const race = week <= today ? (await rank(sql, week, end, 5)).map((r, i) => ({ rank: i + 1, username: r.username, score: r.score, picks: [r.w, r.n - r.w], matchups: [r.dw, r.dn - r.dw], over: Math.round(r.over * 10) / 10 })) : []
  return { week, end, complete: today > end, settled: done?.card ? { card: { ...done.card, k: 1 }, winners: done.card.winners || [] } : null,
    through: board.through, leader: done?.card || board.leader, top: board.top, all: done?.card ? undefined : board.all, race }
}

// Monday on: the week's pick'em winner gets the card; a tie shares it, numbered (1/3, 2/3, 3/3)
export async function settlePotw(sql, origin, today) {
  const week = addDays(weekStart(today), -7)
  const [done] = await sql`select 1 from potw_weeks where week = ${week}`
  if (done || !origin) return
  // Every day of the week either published or without games; after Thursday, settle with what's there
  const late = today >= addDays(week, 10)
  if (!late) for (let i = 0; i < 7; i++) {
    const day = addDays(week, i)
    if (await dayFile(origin, day)) continue
    const games = await slate(sql, day, { origin }).catch(() => null)
    if (!games || games.some(g => g.state !== 'off')) return
  }
  await refresh(sql, origin, today).catch(() => {})
  const star = await weekStar(origin, week)
  const rows = await rank(sql, week, addDays(week, 6), 1000)
  const top = rows[0]?.score || 0
  const winners = top > 0 ? rows.filter(r => r.score === top).sort((a, b) => b.over - a.over || a.username.localeCompare(b.username)) : []
  const base = star && winners.length ? { ...star, of: winners.length, entrants: rows.length,
    winners: winners.map(r => ({ username: r.username, score: r.score, picks: [r.w, r.n - r.w], matchups: [r.dw, r.dn - r.dw], locks: r.lw, potd: [r.ow, r.on_ - r.ow], over: Math.round(r.over * 10) / 10 })) } : null
  await sql.begin(async t => {
    const [first] = await t`insert into potw_weeks (week, card, winners) values (${week}, ${base ? t.json(base) : null}, ${t.json(winners.map(r => r.username))}) on conflict do nothing returning week`
    if (!first || !base) return
    for (const [i, r] of winners.entries()) {
      const c = { ...base, k: i + 1 }
      await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${r.id}, null, 'potw', ${refOf(c)}, ${t.json(c)}, ${cardPoints(c).points}, 'potw')
        on conflict (user_id, ref) do nothing`
    }
  })
}

// ── One day in full, for History: every game and your pick, every matchup, your lineup ──
export async function predDay(sql, u, day, origin) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail(400, 'Pick a day.')
  const games = await sql`select * from pred_games where day = ${day} and state <> 'off' order by tip, id`
  const picks = await sql`select game_id, pick, result, chance, bonus, lock from predictions where user_id = ${u.id} and day = ${day}`
  const duels = await sql`select game_id, pick, result from duel_picks where user_id = ${u.id} and day = ${day}`
  const slots = await sql`select * from lineups where user_id = ${u.id} and day = ${day} order by slot`
  const [ld] = await sql`select total, coins from lineup_days where user_id = ${u.id} and day = ${day}`
  const [pp] = await sql`select player, team, result from potd_picks where user_id = ${u.id} and day = ${day}`
  const done = games.length && games.every(g => g.state === 'post')
  const top = done && origin ? potdOf(await dayFile(origin, day).catch(() => null), day, games) : null
  const mr = done ? matchupResults(games, await gradeSource(origin, day, games).catch(() => ({ has: () => false }))) : {}
  return {
    day,
    games: games.map(g => {
      const p = picks.find(x => x.game_id === g.id)
      return { id: g.id, tip: g.tip, home: g.home, away: g.away, state: g.state, hs: g.hs, as: g.as_, winner: g.winner,
        pHome: g.line?.pHome ?? null, pick: p?.pick || null, result: p?.result || null, lock: !!p?.lock, chance: p?.chance ?? null, bonus: p?.bonus || 0 }
    }),
    matchups: games.filter(g => g.line?.duel).map(g => {
      const d = g.line.duel, dp = duels.find(x => x.game_id === g.id), r = mr[g.id]
      return { id: g.id, home: g.home, away: g.away, a: d.a, b: d.b, pick: dp?.pick || null, result: dp?.result || null, ag: r?.ag ?? null, bg: r?.bg ?? null, state: g.state,
        void: d.void || null, out: d.out || null }
    }),
    lineup: { slots: slots.map(x => ({ slot: x.slot, player: x.player, team: x.team, tier: x.tier, mult: x.mult ?? null, gs: x.gs,
      pts: x.gs == null ? null : Math.round(lineupPts(x.gs, x.mult ?? PRED.lineupMult[x.tier] ?? 1) * 10) / 10 })), graded: ld ? { total: +ld.total, coins: ld.coins } : null },
    potd: { pick: pp ? { player: pp.player, team: pp.team, result: pp.result } : null, lock: games.length ? games.reduce((m, g) => (g.tip < m ? g.tip : m), games[0].tip) : null,
      winner: top ? { name: top.row.n, team: top.t, gs: top.row.gs, pts: top.row.pts, card: top } : null },
  }
}
