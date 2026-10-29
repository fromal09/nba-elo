// Binder points: what a card is worth, from its rarity, how rare the game was, and what it calls out.
// Shared by the server (scored when a card is kept, so totals can't be edited from the browser) and the site.
// Every part is priced by how often it happens: a callout's bonus roughly doubles each time it gets 10× rarer.
//
//   points = 10 × tier base × performance × (1 + bonuses), rounded
//   tier base     Common 1 · Rare 3 · Standout 6 · Legend 12 · Icon 25 · GOAT 60
//   performance   1 + log10(N) / 2.5, where the Game Score is 1 in N player-games (no ceiling: Wilt's 100 is ×3.5);
//                 debuts against debuts
//   honors        Player of the Game +25% · Player of the Day +60%
//   playoffs      first round +15% · second round +20% · Conf. Finals +30% · Finals +45% · title clincher +100%
//   stat line     the rarest one only: 40 points +30% · triple-double +40% · 25 rebounds +45% · 20-20 +60% ·
//                 50 points or 30 rebounds +80% · 20 assists, 10 blocks, 10 steals or 10 threes +120% · 60 points +150% ·
//                 70 points +250% · 80 points or a quadruple-double +400% · 100 points +800%
//   other         debut +40% · career game +25% · career-high Elo +10%

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

// The rarest stat line on the card, and its bonus
export function statLine(r) {
  const v = k => r[k] || 0
  const tens = ['pts', 'trb', 'ast', 'stl', 'blk'].filter(k => v(k) >= 10).length
  const twenties = ['pts', 'trb', 'ast'].filter(k => v(k) >= 20).length
  const pts = v('pts')
  if (pts >= 100) return ['100-point game', 8]
  if (pts >= 80) return ['80-point game', 4]
  if (tens >= 4) return ['Quadruple-double', 4]
  if (pts >= 70) return ['70-point game', 2.5]
  if (pts >= 60) return ['60-point game', 1.5]
  if (v('ast') >= 20) return ['20 assists', 1.2]
  if (v('blk') >= 10) return ['10 blocks', 1.2]
  if (v('stl') >= 10) return ['10 steals', 1.2]
  if (v('tp') >= 10) return ['10 threes', 1.2]
  if (pts >= 50) return ['50-point game', 0.8]
  if (v('trb') >= 30) return ['30 rebounds', 0.8]
  if (twenties >= 2) return ['20-20', 0.6]
  if (v('trb') >= 25) return ['25 rebounds', 0.45]
  if (tens >= 3) return ['Triple-double', 0.4]
  if (pts >= 40) return ['40-point game', 0.3]
  return null
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
  return tens >= 3 || v('pts') >= 50 || v('trb') >= 30 || v('ast') >= 20 || v('blk') >= 10 || v('stl') >= 10 || v('tp') >= 10 || twenties >= 2
}

const PLAYOFF = { r1: ['First round', 0.15], r2: ['Second round', 0.2], cf: ['Conference Finals', 0.3], finals: ['Finals', 0.45], champ: ['Title clincher', 1] }

// Special cards price off the same scale. A Season card's foil is the tier of his final rank (as game cards);
// its honors come from Basketball-Reference (scripts/build_honors.py).
const tierOfRank = k => (k == null ? 'common' : k <= 1 ? 'goat' : k <= 5 ? 'icon' : k <= 20 ? 'legend' : k <= 50 ? 'standout' : k <= 125 ? 'rare' : 'common')
const RIVAL_SPAN = { goat: [1, 1], icon: [2, 5], legend: [6, 20], standout: [21, 50], rare: [51, 125] }
export const SEASON_HONOR = { allStar: 0.25, allNba: { 1: 0.6, 2: 0.45, 3: 0.3 }, mvp: 1, title: 0.5 }
export const parseHonor = c => (c ? { allStar: c.includes('S'), allNba: +(c.match(/[123]/)?.[0] || 0), mvp: c.includes('M') } : {})

// A side of a duel card carries no tier of its own: it comes from his rank after the game, as on every card
const rankTier = r => { const k = r?.lrp ?? r?.lr; return k == null ? 'common' : k <= 1 ? 'goat' : k <= 5 ? 'icon' : k <= 20 ? 'legend' : k <= 50 ? 'standout' : k <= 125 ? 'rare' : 'common' }
export const DUEL_MULT = 1.25

/** A card's points and how they add up: { points, base, grade, bonuses: [[label, pct]] }. card: the pack/binder card shape.
 *  Special cards:
 *    duel    both players' cards together, plus 25%
 *    peak    the game's card, plus 50%
 *    rival   10 × 6 × its tier's base, plus up to 50% for the top of its tier (GOAT 5,400 · Icon 2,250–1,500 ·
 *            Legend 1,080–720 · Standout 540–360 · Rare 270–180)
 *    five    the five players' cards from that game added up, plus 40% for a title team
 *    season  10 × 8 × his final tier's base × games / 82 (up to ×1.25 with playoffs), plus All-Star 25%,
 *            All-League 60/45/30%, MVP 100%, title 50% */
// Player of the Week: one per week, to the pick'em winner (numbered when a tie shares it)
export const POTW_POINTS = 2500
// Complete Set: one of every player on a team-season's roster, 100 points a player
export const SET_POINTS_PER = 100
export function cardPoints(card) {
  if (card?.kind === 'potw') return { points: POTW_POINTS, base: 0, grade: 0, bonuses: [['Player of the Week', 0]] }
  // A Final set (the season over, every player still in your binder) is worth a quarter more than an in-season one
  if (card?.kind === 'set') return { points: Math.round(SET_POINTS_PER * (card.size || 0) * (card.final === true ? 1.25 : 1)), base: 0, grade: 0,
    bonuses: [['Complete Set', 0], ...(card.final === true ? [['Final', 0.25]] : [])] }
  // Ruby: the Player of the Day card you called, at twice its points
  if (card?.ruby) {
    const p = cardPoints({ ...card, ruby: undefined })
    return { ...p, points: p.points * 2, bonuses: [...p.bonuses, ['Ruby · called it', 1]] }
  }
  if (card?.kind === 'peak') {
    const p = cardPoints({ ...card, kind: undefined, tier: card.tier || rankTier(card.row) })
    return { ...p, points: Math.round(p.points * 1.5), bonuses: [...p.bonuses, ['Peak', 0.5]] }
  }
  // Rivalry: a great game's worth at its tier (10 × base × 6), up to half again for the top of its tier
  // Dynamic Duo: priced like a Rivalry of its tier
  if (card?.kind === 'duo') {
    const base = TIER_BASE[card.tier] ?? 3, [lo, hi] = RIVAL_SPAN[card.tier] || [card.rank, card.rank]
    const top = card.rank == null || hi === lo ? 1 : 1 - (card.rank - lo) / (hi - lo)
    return { points: Math.round(60 * base * (1 + 0.5 * top)), base, grade: 0, bonuses: [['Dynamic Duo', 5], ['Top of its tier', 0.5 * top]] }
  }
  if (card?.kind === 'rival') {
    const base = TIER_BASE[card.tier] ?? 3, [lo, hi] = RIVAL_SPAN[card.tier] || [card.rank, card.rank]
    const top = card.rank == null || hi === lo ? 1 : 1 - (card.rank - lo) / (hi - lo)
    return { points: Math.round(60 * base * (1 + 0.5 * top)), base, grade: 0, bonuses: [['Rivalry', 5], ['Top of its tier', 0.5 * top]] }
  }
  // Starting Five: the five players' own cards from that game, together; a title team adds 40%
  if (card?.kind === 'five') {
    const each = (card.players || []).map(p => cardPoints({ tier: rankTier(p), honor: p.honor || null, band: card.band || null,
      row: { ...p, post: p.post, gp: p.gp } }).points)
    const sum = each.reduce((a, x) => a + x, 0)
    return { points: Math.round(sum * (card.champ ? 1.4 : 1)), base: 0, grade: 0, bonuses: [['Starting Five', 0], ...(card.champ ? [['Title team', 0.4]] : [])], five: each }
  }
  // Season card: 10 × his final tier's base × 8, by the share of a full season he played, with his honors on top
  if (card?.kind === 'season') {
    const tier = tierOfRank(card.rank), base = TIER_BASE[tier]
    const h = parseHonor(card.honors), bonuses = []
    if (h.allStar) bonuses.push(['All-Star', SEASON_HONOR.allStar])
    if (h.allNba) bonuses.push([`All-League ${['1st', '2nd', '3rd'][h.allNba - 1]}`, SEASON_HONOR.allNba[h.allNba]])
    if (h.mvp) bonuses.push(['MVP', SEASON_HONOR.mvp])
    if (card.champ) bonuses.push(['Title', SEASON_HONOR.title])
    // Final: the season over with every game in your binder (in-season cards cover the games so far)
    if (card.final === true) bonuses.push(['Final', 0.25])
    const mult = 1 + bonuses.reduce((a, x) => a + x[1], 0)
    return { points: Math.max(5, Math.round(80 * base * Math.min(1.25, (card.gp || 0) / 82) * mult)), base, grade: 0, tier, bonuses }
  }
  if (card?.kind === 'duel') {
    const a = cardPoints({ ...card.a, tier: card.a.tier || rankTier(card.a.row) }).points, b = cardPoints({ ...card.b, tier: card.b.tier || rankTier(card.b.row) }).points
    return { points: Math.round((a + b) * DUEL_MULT), base: 0, grade: 0, bonuses: [['Duel of the Day', DUEL_MULT - 1]], duel: [a, b] }
  }
  const r = card.row || {}
  const debut = r.gp === 1
  const base = TIER_BASE[card.tier] ?? 1
  const grade = gradeOf(r.gs, debut)
  const bonuses = []
  if (card.honor === 'potd') bonuses.push(['Player of the Day', 0.6])
  else if (card.honor === 'potg') bonuses.push(['Player of the Game', 0.25])
  if (card.band) bonuses.push(PLAYOFF[card.band.level] || PLAYOFF.r1)
  const line = debut ? null : statLine(r)
  if (line) bonuses.push(line)
  if (debut) bonuses.push(['Debut', 0.4])
  if (r.fx & 1) bonuses.push(['Career game', 0.25])
  if (r.fx & 4) bonuses.push(['Career-high Elo', 0.1])
  const mult = 1 + bonuses.reduce((s, b) => s + b[1], 0)
  const perf = performance(r.gs, debut)
  return { points: Math.round(10 * base * perf * mult), base, grade, perf, bonuses }
}
