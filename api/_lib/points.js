// Binder points (system A+): what a card is worth = how hard it was to get × how notable it is.
// Shared by the server (scored when a card is kept, so totals can't be edited from the browser) and the site.
//
//   pulled cards    points = 10 × S × E × O
//     S  scarcity     √(how many times rarer to pull than a Common game card), from the pack odds (packs.js)
//     E  significance N^0.3 for the rarest thing about the game (1 player-game in N; every 10× rarer doubles it),
//                     × N^0.075 for each of the next two callouts (a quarter of the weight: one big night isn't paid many times)
//     O  occasion     playoff round ×1.15 / 1.2 / 1.3 / 1.45 · title clincher ×2 · debut ×1.4 · holiday ×1.1
//   contest cards   won by calling it or beating other collectors: W = 2 × √(1 / chance of winning)
//     Called It (ruby)    the card's own points + 10 × W × E, chance = his pre-game chance of being Player of the Day
//     Duel of the Day     10 × W × E, chance = every matchup right (½ per matchup)
//     Player of the Week  10 × W × 3, chance = 1 in the week's entrants, as days of packs (7 a week)
//   earned cards    (Season, Complete Set, All-Star Roster, Franchise History, Completed Franchise, Banner) keep their
//                   size-based prices until the pack simulation prices them by effort
//
// The feat frequencies (1 in N) are estimates; the pipeline will replace them with exact counts.
import { holidayOf } from './holidays.js'

export const TIER_BASE = { common: 1, rare: 3, standout: 6, legend: 12, icon: 25, goat: 60 }

// The k-th percentile of Game Score across every player-game on record, and across every career debut
const GMSC_PCT = [-15.5, -3.1, -2.3, -1.8, -1.5, -1.2, -1.0, -0.7, -0.6, -0.4, -0.2, -0.1, 0.0, 0.1, 0.3, 0.4, 0.6, 0.7, 0.9, 1.1,
  1.3, 1.4, 1.6, 1.7, 1.9, 2.0, 2.2, 2.4, 2.6, 2.7, 2.9, 3.1, 3.2, 3.4, 3.6, 3.8, 4.0, 4.1, 4.3, 4.5, 4.7, 4.9, 5.0, 5.2, 5.4, 5.6,
  5.8, 6.0, 6.2, 6.4, 6.6, 6.8, 7.0, 7.2, 7.4, 7.6, 7.8, 8.1, 8.3, 8.5, 8.7, 9.0, 9.2, 9.4, 9.7, 9.9, 10.2, 10.4, 10.7, 11.0, 11.2,
  11.5, 11.8, 12.1, 12.4, 12.7, 13.0, 13.3, 13.7, 14.0, 14.4, 14.7, 15.1, 15.5, 16.0, 16.4, 16.9, 17.4, 17.9, 18.5, 19.1, 19.8,
  20.5, 21.3, 22.2, 23.3, 24.5, 26.2, 28.4, 31.9, 86.8]
const DEBUT_PCT = [-9.2, -3.3, -2.6, -2.2, -2.0, -1.8, -1.6, -1.4, -1.3, -1.2, -1.1, -1.0, -0.8, -0.7, -0.7, -0.7, -0.7, -0.5, -0.4, -0.4,
  -0.4, -0.2, -0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.2, 0.3, 0.3, 0.4, 0.6, 0.6, 0.7, 0.7, 0.8, 0.9, 1.0, 1.0, 1.2, 1.3,
  1.3, 1.5, 1.6, 1.7, 1.7, 1.9, 2.0, 2.0, 2.1, 2.3, 2.4, 2.4, 2.5, 2.7, 2.7, 2.9, 3.0, 3.2, 3.3, 3.4, 3.6, 3.7, 3.9, 4.0, 4.2, 4.4,
  4.6, 4.8, 5.0, 5.2, 5.4, 5.6, 5.8, 6.0, 6.2, 6.6, 6.9, 7.2, 7.6, 8.0, 8.4, 8.8, 9.3, 9.9, 10.4, 11.0, 11.6, 12.2, 13.0, 14.2, 15.7,
  17.0, 19.5, 23.1, 47.2]

// Game Score → 1 in N player-games, above the median (from the card pool: [N, Game Score])
const GMSC_TAIL = [[2, 6.6], [3, 10.3], [5, 14.3], [7, 16.7], [10, 19.1], [15, 21.6], [20, 23.3], [30, 25.6], [50, 28.3], [70, 30.1],
  [100, 31.9], [150, 34.0], [200, 35.4], [300, 37.5], [500, 40.1], [700, 42.0], [1000, 43.8], [1500, 46.0], [2000, 47.5], [3000, 49.4],
  [5000, 52.0], [7000, 53.8], [10000, 55.6], [15000, 57.8], [20000, 59.8], [30000, 62.0], [50000, 64.0], [70000, 66.1], [100000, 68.7],
  [150000, 70.4], [200000, 71.2], [300000, 72.3], [500000, 72.5], [1500000, 86.8]]
const DEBUT_TAIL = [[2, 1.9], [3, 4.0], [5, 6.7], [10, 10.8], [20, 14.5], [50, 19.4], [100, 22.4], [200, 25.5], [500, 31.1], [1000, 32.8],
  [2000, 37.4], [6000, 47.2]]
// How rare a Game Score is: N, as in 1 in N (1 for the bottom half)
export function gmscRarity(gs, debut) {
  if (gs == null) return 1
  const T = debut ? DEBUT_TAIL : GMSC_TAIL
  if (gs <= T[0][1]) return 1 + Math.max(0, gs - (debut ? -3 : -3)) / (T[0][1] + 3) // the bottom half: 1 to 2
  if (gs >= T[T.length - 1][1]) return T[T.length - 1][0]
  let i = 0
  while (T[i + 1][1] <= gs) i++
  const [n0, g0] = T[i], [n1, g1] = T[i + 1]
  const f = g1 === g0 ? 1 : (gs - g0) / (g1 - g0)
  return 10 ** (Math.log10(n0) + f * (Math.log10(n1) - Math.log10(n0)))
}
export const performance = (gs, debut) => 1 + Math.log10(Math.max(1, gmscRarity(gs, debut))) / 2.5

// The callouts a game card carries, each [label, N] (1 player-game in N). One per family: the biggest scoring night,
// the biggest rebounding night, the most doubles. Estimates until the pipeline counts them.
const FEATS = { p100: 1080000, p80: 540000, p70: 120000, p60: 13500, p50: 1800, p40: 200, r30: 7000, r25: 2500, x5: 1080000, x4: 270000, x3: 350,
  tw: 1500, a20: 3000, b10: 5000, s10: 40000, t10: 1500, sweepOut: 8000, sweep: 2000, fives: 30000, potd: 300, potg: 20 }
export function callouts(r, honor) {
  const v = k => r[k] || 0, out = []
  const tens = ['pts', 'trb', 'ast', 'stl', 'blk'].filter(k => v(k) >= 10).length
  const twenties = ['pts', 'trb', 'ast'].filter(k => v(k) >= 20).length
  const pts = v('pts')
  const P = pts >= 100 ? ['100 points', FEATS.p100] : pts >= 80 ? ['80 points', FEATS.p80] : pts >= 70 ? ['70 points', FEATS.p70] : pts >= 60 ? ['60 points', FEATS.p60]
    : pts >= 50 ? ['50 points', FEATS.p50] : pts >= 40 ? ['40 points', FEATS.p40] : null
  if (P) out.push(P)
  if (v('trb') >= 30) out.push(['30 rebounds', FEATS.r30]); else if (v('trb') >= 25) out.push(['25 rebounds', FEATS.r25])
  if (tens >= 5) out.push(['Quintuple-double', FEATS.x5]); else if (tens === 4) out.push(['Quadruple-double', FEATS.x4]); else if (tens === 3) out.push(['Triple-double', FEATS.x3])
  if (twenties >= 2) out.push([twenties === 3 ? '20-20-20' : '20-20', FEATS.tw])
  if (v('ast') >= 20) out.push(['20 assists', FEATS.a20])
  if (v('blk') >= 10) out.push(['10 blocks', FEATS.b10])
  if (v('stl') >= 10) out.push(['10 steals', FEATS.s10])
  if (v('tp') >= 10) out.push(['10 threes', FEATS.t10])
  if (v('sw') === 2) out.push(['Box Score Sweep, outright', FEATS.sweepOut]); else if (v('sw') === 1) out.push(['Box Score Sweep', FEATS.sweep])
  if (['pts', 'trb', 'ast', 'stl', 'blk'].every(k => v(k) >= 5)) out.push(['5x5', FEATS.fives])
  if (honor === 'potd') out.push(['Player of the Day', FEATS.potd]); else if (honor === 'potg') out.push(['Player of the Game', FEATS.potg])
  // His best Game Score so far (20+ games in): 1 game in his career
  if ((r.fx & 1) && (r.gp || 0) >= 20) out.push(['Career game', r.gp])
  return out
}
// The rarest stat line on the card (the stat-line insert fronts and the binder sets read it)
export function statLine(r) {
  const c = callouts(r).filter(([l]) => l !== 'Career game').sort((a, b) => b[1] - a[1])[0]
  return c ? [c[0], 0] : null
}
// Significance: the rarest thing sets it; the next two add a quarter of their weight each (more than that is the same night)
export function significance(list) {
  const L = [...list].sort((a, b) => b[1] - a[1])
  if (!L.length) return 1
  return Math.max(1, L[0][1]) ** 0.3 * L.slice(1, 3).reduce((a, x) => a * Math.max(1, x[1]) ** 0.075, 1)
}

export function gradeOf(gs, debut) {
  if (gs == null) return 0
  const T = debut ? DEBUT_PCT : GMSC_PCT
  let pct = 0
  while (pct < 100 && T[pct + 1] <= gs) pct++
  return pct >= 95 ? 10 : pct >= 6 ? Math.floor((pct + 5) / 10) : 0
}

// The same feats as the stat-line insert fronts (PlayerCard featsFor)
export function hasFeat(r) {
  const v = k => r[k] || 0
  const tens = ['pts', 'trb', 'ast', 'stl', 'blk'].filter(k => v(k) >= 10).length
  const twenties = ['pts', 'trb', 'ast'].filter(k => v(k) >= 20).length
  const fives = ['pts', 'trb', 'ast', 'stl', 'blk'].every(k => v(k) >= 5)
  return v('sw') > 0 || fives || tens >= 3 || v('pts') >= 50 || v('trb') >= 30 || v('ast') >= 20 || v('blk') >= 10 || v('stl') >= 10 || v('tp') >= 10 || twenties >= 2
}

// Scarcity. Pulls per daily pack (12 Base offers + 3 Rare+ offers) by tier, and the special cards (1 pack in 15:
// Peak 40%, Starting Five 30%, Rivalry 15%, Dynamic Duo 15%) by the share of each tier in their pool (Rivalries and Duos
// are drawn weighted toward lower tiers). S = √(Common pulls per pack ÷ this card's)
const COMMON_PER_PACK = 7.44
const GAME_PER_PACK = { common: 7.44, rare: 4.44, standout: 1.8, legend: 0.93, icon: 0.3, goat: 0.09 }
const SPECIAL_PER_PACK = { peak: 0.4 / 15, five: 0.3 / 15, rival: 0.15 / 15, duo: 0.15 / 15 }
const RD = { goat: 1, icon: 8, legend: 60, standout: 240, rare: 1200 } // weight × cards in the tier (1, 4, 15, 30, 75)
const SPECIAL_TIERS = {
  peak: { goat: 60, icon: 219, legend: 764, standout: 976, rare: 1464, common: 1351 },
  five: { goat: 1, icon: 4, legend: 15, standout: 30, rare: 75, common: 1157 },
  rival: RD, duo: RD,
}
const share = (kind, tier) => { const T = SPECIAL_TIERS[kind], sum = Object.values(T).reduce((a, b) => a + b, 0); return (T[tier] ?? T.common ?? T.rare) / sum }
export function scarcity(kind, tier) {
  const per = SPECIAL_PER_PACK[kind] ? SPECIAL_PER_PACK[kind] * share(kind, tier) : GAME_PER_PACK[tier] ?? GAME_PER_PACK.common
  return Math.sqrt(COMMON_PER_PACK / per)
}
// A contest win: √(1 / chance), doubled for the skill it takes
export const contest = p => 2 * Math.sqrt(1 / Math.min(1, Math.max(0.0005, p || 0.0005)))
// A Player of the Day call made before the chance was recorded: the star's chance by his tier
const CALL_CHANCE = { goat: 0.15, icon: 0.08, legend: 0.04, standout: 0.02, rare: 0.01, common: 0.005 }

const OCCASION = { r1: ['First round', 1.15], r2: ['Second round', 1.2], cf: ['Conference Finals', 1.3], finals: ['Finals', 1.45], champ: ['Title clincher', 2] }
const tierOfRank = k => (k == null ? 'common' : k <= 1 ? 'goat' : k <= 5 ? 'icon' : k <= 20 ? 'legend' : k <= 50 ? 'standout' : k <= 125 ? 'rare' : 'common')
const RIVAL_SPAN = { goat: [1, 1], icon: [2, 5], legend: [6, 20], standout: [21, 50], rare: [51, 125] }
const topOfTier = (tier, rank) => { const [lo, hi] = RIVAL_SPAN[tier] || [rank, rank]; return rank == null || hi === lo ? 1 : Math.max(0, Math.min(1, 1 - (rank - lo) / (hi - lo))) }
export const SEASON_HONOR = { allStar: 0.25, allNba: { 1: 0.6, 2: 0.45, 3: 0.3 }, mvp: 1, title: 0.5 }
export const parseHonor = c => (c ? { allStar: c.includes('S'), allNba: +(c.match(/[123]/)?.[0] || 0), mvp: c.includes('M') } : {})
// A side of a duel card carries no tier of its own: it comes from his rank after the game, as on every card
const rankTier = r => tierOfRank(r?.lrp ?? r?.lr)
// Complete Set: one of every player on a team-season's roster, 100 points a player
export const SET_POINTS_PER = 100
// Reward cards (coins.js rewardCards): per All-Star, per franchise season, per franchise player
export const REWARD_POINTS = { allstar: 200, fhist: 100, fcomp: 40, banner: 150 }
const REWARD_NAME = { allstar: 'All-Star Roster', fhist: 'Franchise History', fcomp: 'Completed Franchise', banner: 'Hang the Banner' }
const TIER_WORD = { goat: 'GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare', common: 'Common' }
const x1 = v => `×${v >= 10 ? Math.round(v) : v.toFixed(1)}`

// A game card's three parts. { S, E, O, list: callouts, occ: [[label, factor]] }
function gameParts(card, tier) {
  const r = card.row || {}
  const debut = r.gp === 1
  const list = [['Game Score', gmscRarity(r.gs, debut)], ...callouts(r, card.honor)]
  const occ = []
  if (card.band) occ.push(OCCASION[card.band.level] || OCCASION.r1)
  if (debut) occ.push(['Debut', 1.4])
  if (card.date && holidayOf(card.date)) occ.push(['Holiday game', 1.1])
  return { E: significance(list), O: occ.reduce((a, [, f]) => a * f, 1), list, occ }
}
const breakdown = (S, sLabel, parts) => [[sLabel, x1(S)], [parts.list.slice().sort((a, b) => b[1] - a[1])[0]?.[0] || 'Game Score', x1(parts.E)],
  ...parts.occ.map(([l, f]) => [l, x1(f)])]

/** A card's points and how they add up: { points, bonuses: [[label, text]] }. card: the pack/binder card shape. */
export function cardPoints(card) {
  if (REWARD_POINTS[card?.kind]) return { points: REWARD_POINTS[card.kind] * (card.size || 0), bonuses: [[REWARD_NAME[card.kind], `${card.size || 0} × ${REWARD_POINTS[card.kind]}`]] }
  // Player of the Week: a 1-in-entrants win each week (shared by a tie), counted in days of packs, doubled for skill
  if (card?.kind === 'potw') {
    const n = Math.max(2, (card.entrants || 10) / (card.of || 1)), W = 2 * Math.sqrt(COMMON_PER_PACK * 7 * n)
    return { points: Math.round(10 * W * 3), bonuses: [['Player of the Week', `1 of ${Math.round(n)}`], ['Contest', x1(W)]] }
  }
  // A Final set (the season over, every player still in your binder) is worth a quarter more than an in-season one
  if (card?.kind === 'set') return { points: Math.round(SET_POINTS_PER * (card.size || 0) * (card.final === true ? 1.25 : 1)),
    bonuses: [['Complete Set', `${card.size || 0} × ${SET_POINTS_PER}`], ...(card.final === true ? [['Final', '×1.25']] : [])] }
  // Called It: the card's own points, plus the call priced by his pre-game chance of being Player of the Day
  if (card?.ruby) {
    const own = cardPoints({ ...card, ruby: undefined })
    const tier = card.tier || rankTier(card.row)
    const p = card.win ?? CALL_CHANCE[tier] ?? 0.01, W = contest(p), parts = gameParts(card, tier)
    const call = Math.round(10 * W * parts.E)
    return { points: own.points + call, bonuses: [...own.bonuses, ['Called It', `${Math.round(p * 1000) / 10}% chance · +${call.toLocaleString()}`]] }
  }
  if (card?.kind === 'peak') {
    const tier = card.tier || rankTier(card.row), S = scarcity('peak', tier), parts = gameParts(card, tier)
    return { points: Math.round(10 * S * parts.E * parts.O), bonuses: breakdown(S, 'Peak', parts) }
  }
  // Rivalry and Dynamic Duo: their pull odds by tier, up to half again at the top of the tier
  if (card?.kind === 'duo' || card?.kind === 'rival') {
    const S = scarcity(card.kind, card.tier), top = topOfTier(card.tier, card.rank)
    return { points: Math.round(10 * S * (1 + 0.5 * top)), bonuses: [[card.kind === 'duo' ? 'Dynamic Duo' : 'Rivalry', x1(S)], ['Top of its tier', x1(1 + 0.5 * top)]] }
  }
  // Starting Five: its pull odds by tier, up to half again at the top of the tier, a title team ×1.4
  if (card?.kind === 'five') {
    const tier = card.tier || 'common', S = scarcity('five', tier), top = card.rank != null && RIVAL_SPAN[tier] ? topOfTier(tier, card.rank) : 0
    return { points: Math.round(10 * S * (1 + 0.5 * top) * (card.champ ? 1.4 : 1)), bonuses: [['Starting Five', x1(S)], ['Top of its tier', x1(1 + 0.5 * top)], ...(card.champ ? [['Title team', '×1.4']] : [])] }
  }
  // Season card: 10 × his final tier's base × 8, by the share of a full season he played, with his honors on top
  if (card?.kind === 'season') {
    const SEASON_BASE = { common: 1, rare: 3, standout: 6, legend: 12, icon: 25, goat: 60 }
    const tier = tierOfRank(card.rank), base = SEASON_BASE[tier]
    const h = parseHonor(card.honors), bonuses = []
    if (h.allStar) bonuses.push(['All-Star', SEASON_HONOR.allStar])
    if (h.allNba) bonuses.push([`All-League ${['1st', '2nd', '3rd'][h.allNba - 1]}`, SEASON_HONOR.allNba[h.allNba]])
    if (h.mvp) bonuses.push(['MVP', SEASON_HONOR.mvp])
    if (card.champ) bonuses.push(['Title', SEASON_HONOR.title])
    if (card.final === true) bonuses.push(['Final', 0.25])
    const mult = 1 + bonuses.reduce((a, x) => a + x[1], 0)
    return { points: Math.max(5, Math.round(80 * base * Math.min(1.25, (card.gp || 0) / 82) * mult)), tier, bonuses: bonuses.map(([l, v]) => [l, `+${Math.round(v * 100)}%`]) }
  }
  // Duel of the Day: earned with every matchup right that day (½ each), the two Game Scores' rarity as its significance
  if (card?.kind === 'duel') {
    const n = card.n || 4, W = contest(0.5 ** n)
    const E = significance([['Game Score', gmscRarity(card.a?.row?.gs)], ['Game Score', gmscRarity(card.b?.row?.gs)]])
    return { points: Math.round(10 * W * E), bonuses: [['Duel of the Day', `${n} matchups right`], ['Contest', x1(W)], ['Two Game Scores', x1(E)]] }
  }
  // Game card
  const tier = card.tier || rankTier(card.row), S = scarcity(null, tier), parts = gameParts(card, tier)
  return { points: Math.round(10 * S * parts.E * parts.O), bonuses: breakdown(S, `${TIER_WORD[tier] || 'Common'} pull`, parts), S, E: parts.E, O: parts.O }
}
