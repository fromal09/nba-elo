import { seasonDetails } from './rescore.js'
import { cardPoints } from './points.js'
// Coins: what collectors earn by playing and spend in the store. Every grant is a row in the coin ledger,
// which is how daily caps and once-only rewards are enforced; users.coins is the running balance.
import { poolJSON } from './packs.js'

export const RATES = {
  visit: 50,             // first visit of the day
  streakPer: 10, streakMax: 100,
  pack: 25,              // finishing a pack (all five picks)
  big: 50,               // keeping a Legend or better
  explore: 10, exploreCap: 60,
  challenge: 40,
  setStep: 100,          // every 10% of a league set
  weeklyTop10: 500, weeklyTop50: 200,
  sellRate: 0.2, sellCap: 500, sellCooldownHours: 24, buybackHours: 24,
}
export const SECTIONS = { scoreboard: 'Scoreboard', explorer: 'Season Explorer', timemachine: 'Time Machine', mystery: 'Mystery Player',
  rankings: 'Current Rankings', profile: 'a player profile', historical: 'Historical Elo', h2h: 'Head-to-Head', games: 'Game Explorer',
  daily: 'Daily Changes', seasons: 'Season by Season', franchise: 'Who’s Been Here?', bestx: 'Best Through X', tenures: 'Franchise Tenures', teams: 'Team Breakdown' }

// One challenge a day, the same for everyone: a test against an event
const CHALLENGES = [
  { id: 'nineties', text: 'Keep a card from the 1990s', on: 'card', ok: c => { const y = +c.s.slice(0, 4); return y >= 1989 && y <= 1998 } },
  { id: 'honor', text: 'Keep a Player of the Game or Player of the Day card', on: 'card', ok: c => !!c.honor },
  { id: 'playoff', text: 'Keep a playoff card', on: 'card', ok: c => !!c.band },
  { id: 'scoreboard', text: 'Check the Scoreboard', on: 'explore', ok: s => s === 'scoreboard' },
  { id: 'timemachine', text: 'Visit the Time Machine', on: 'explore', ok: s => s === 'timemachine' },
  { id: 'mystery', text: 'Play Mystery Player', on: 'explore', ok: s => s === 'mystery' },
  { id: 'finish', text: 'Finish a pack', on: 'pack' },
  { id: 'star', text: 'Star a card in your binder', on: 'star' },
  { id: 'hundred', text: 'Keep a card worth 100 points or more', on: 'card', ok: (c, pts) => pts >= 100 },
  { id: 'classic', text: 'Keep a card from before 1980', on: 'card', ok: c => +c.s.slice(0, 4) < 1979 },
]
const dayIndex = day => Math.floor(Date.parse(day + 'T12:00:00Z') / 864e5)
export const challengeFor = day => CHALLENGES[dayIndex(day) % CHALLENGES.length]

const LABEL = { visit: 'Daily visit', streak: 'Streak bonus', pack: 'Finished a pack', big: 'Kept a Legend or better', explore: 'Explored',
  challenge: 'Daily challenge', checklist: 'Completed a team checklist', set: 'Set milestone', weekly: 'Weekly leaderboard', sell: 'Sold a card',
  buyback: 'Bought back a card', store: 'Store', predict: 'Pick made', predcorrect: 'Correct pick', upset: 'Upset called', perfect: 'Perfect day', lock: 'Lock of the Day', lockloss: 'Lock of the Day missed',
  duelcorrect: 'Matchup called', lineup: 'Lineup', pickweekly: 'Weekly pick’em' }

/**
 * Grant (or charge, with a negative amount) Coins inside a transaction. ref makes a grant once-only;
 * cap limits a kind's total for the day. Returns the award ({ kind, amount, label }) or null when it didn't apply.
 */
export async function grant(t, userId, day, kind, amount, { ref = null, cap = null, label = null } = {}) {
  if (!amount) return null
  if (cap != null) {
    const [x] = await t`select coalesce(sum(amount), 0)::int as n from coin_ledger where user_id = ${userId} and day = ${day} and kind = ${kind}`
    amount = Math.min(amount, cap - x.n)
    if (amount <= 0) return null
  }
  const rows = await t`insert into coin_ledger (user_id, day, kind, ref, amount) values (${userId}, ${day}, ${kind}, ${ref}, ${amount})
    on conflict do nothing returning id`
  if (!rows.length) return null
  await t`update users set coins = coins + ${amount} where id = ${userId}`
  return { kind, amount, label: label || LABEL[kind] || kind }
}

// The day's challenge, if this event completes it
export async function tryChallenge(t, userId, day, event, arg, extra) {
  const ch = challengeFor(day)
  if (ch.on !== event || (ch.ok && !ch.ok(arg, extra))) return null
  return grant(t, userId, day, 'challenge', RATES.challenge, { ref: day, label: `Challenge: ${ch.text}` })
}

// ── Rewards for keeping a card: a completed team-season checklist, league set milestones ──
let leagueCache = null
const rosterCache = new Map()
async function dataJSON(origin, path) {
  const r = await fetch(`${origin}/data/explorer/${path}`, { signal: AbortSignal.timeout(10e3) }).catch(() => null)
  return r?.ok ? r.json() : null
}
const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }

export async function cardRewards(t, userId, day, origin, card) {
  const out = []
  // Team-season checklist: every player who played for the franchise that season
  const fc = MERGE[card.t] || card.t
  if (!rosterCache.has(fc)) rosterCache.set(fc, dataJSON(origin, `binders/roster/${fc.replace('@', '_')}.json`))
  const roster = (await rosterCache.get(fc))?.[card.s]
  if (roster?.length) {
    const codes = [fc, ...Object.keys(MERGE).filter(k => MERGE[k] === fc)]
    const have = new Set((await t`select distinct card->'row'->>'n' as n from cards where user_id = ${userId} and card->>'s' = ${card.s}
      and card->>'t' = any(${codes})`).map(r => r.n))
    if (roster.every(([n]) => have.has(n))) {
      const amount = Math.max(100, Math.min(500, roster.length * 20))
      const a = await grant(t, userId, day, 'checklist', amount, { ref: `${fc}|${card.s}`, label: `Completed the ${card.s} ${card.tn} checklist` })
      if (a) out.push(a)
    }
  }
  // Season card: every game of his season with this franchise
  out.push(...(await forgeSeasons(t, userId, day, origin, { s: card.s, fc, n: card.row.n })))
  // League sets: 100 Coins at every 10% of a set
  if (!leagueCache || Date.now() - leagueCache.at > 10 * 60e3) leagueCache = { at: Date.now(), data: await dataJSON(origin, 'binders/league.json') }
  const sets = leagueCache.data?.sets || {}
  const ref = `${card.s}|${card.id}|${card.row.n}`
  for (const [id, list] of Object.entries(sets)) {
    if (id === 'slayers' || id === 'duels' || id === 'rivalries' || id === 'lineups' || id === 'seasons' || !list.some(c => `${c.s}|${c.id}|${c.row.n}` === ref)) continue
    const refs = list.map(c => `${c.s}|${c.id}|${c.row.n}`)
    const [x] = await t`select count(*)::int as n from cards where user_id = ${userId} and ref = any(${refs})`
    const steps = Math.floor((x.n / refs.length) * 10)
    for (let k = 1; k <= steps; k++) {
      const a = await grant(t, userId, day, 'set', RATES.setStep, { ref: `${id}|${k}`, label: `${k * 10}% of a league set` })
      if (a) out.push(a)
    }
  }
  return out
}

/**
 * Season cards: when a collector owns a card of every game a player played for a franchise in a season, the Season card
 * is forged into the binder (kind 'season'). only = { s, fc, n } checks one player-season; without it, every one the
 * collector has cards from (for collectors who completed one before Season cards existed).
 */
export async function forgeSeasons(t, userId, day, origin, only = null) {
  const rows = only
    ? await t`select card->>'s' as s, card->>'t' as t, card->'row'->>'n' as n, count(*)::int as k, max(card->>'tn') as tn, max(card->>'tc') as tc from cards
        where user_id = ${userId} and card->>'s' = ${only.s} and card->'row'->>'n' = ${only.n} and card->>'kind' is null group by 1, 2, 3`
    : await t`select card->>'s' as s, card->>'t' as t, card->'row'->>'n' as n, count(*)::int as k, max(card->>'tn') as tn, max(card->>'tc') as tc from cards
        where user_id = ${userId} and card->>'kind' is null group by 1, 2, 3 having count(*) >= 2`
  const by = new Map()
  for (const r of rows) {
    const fc = MERGE[r.t] || r.t, key = `${r.s}|${fc}|${r.n}`
    const x = by.get(key) || { s: r.s, fc, n: r.n, k: 0, tn: r.tn, tc: r.tc }
    x.k += r.k; by.set(key, x)
  }
  const out = []
  for (const x of by.values()) {
    if (!rosterCache.has(x.fc)) rosterCache.set(x.fc, dataJSON(origin, `binders/roster/${x.fc.replace('@', '_')}.json`))
    const games = (await rosterCache.get(x.fc))?.[x.s]?.find(([n]) => n === x.n)?.[1]
    if (!games || x.k < games) continue
    const card = { kind: 'season', tier: 'season', s: x.s, t: x.fc, tn: x.tn, tc: x.tc, n: x.n, gp: games, ...(await seasonDetails(origin, x.s, x.fc, x.n)) }
    const ref = `season|${x.s}|${x.fc}|${x.n}`
    const [row] = await t`insert into cards (user_id, pack_id, tier, ref, card, points, source) values (${userId}, null, 'season', ${ref}, ${t.json(card)}, ${cardPoints(card).points}, 'forged')
      on conflict (user_id, ref) do nothing returning id`
    if (row) out.push({ kind: 'season', amount: 0, label: `Season card forged: ${x.n}, ${x.s}` })
  }
  return out
}

export { poolJSON }
