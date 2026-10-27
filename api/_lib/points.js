// Binder points: what a card is worth, from its rarity, how good the game was, and its card design.
// Shared by the server (scored when a card is kept, so totals can't be edited from the browser) and the site.
//
//   points = 10 × tier base × performance × (1 + design bonuses), rounded
//   tier base     Common 1 · Rare 3 · Standout 6 · Legend 12 · Icon 25 · GOAT 60
//   performance   1 + grade / 10: the slab grade (0–10) from the game's Game Score percentile; debuts graded against debuts
//   design        Player of the Game +25% · Player of the Day +60% · playoffs +15% (Conf. Finals +25%, Finals +40%,
//                 title clincher +75%) · stat-line insert +50% · debut +40% · career game +25% · career-high Elo +10%

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

const PLAYOFF = { r1: ['Playoffs', 0.15], r2: ['Playoffs', 0.15], cf: ['Conference Finals', 0.25], finals: ['Finals', 0.4], champ: ['Title clincher', 0.75] }

// A side of a duel card carries no tier of its own: it comes from his rank after the game, as on every card
const rankTier = r => { const k = r?.lrp ?? r?.lr; return k == null ? 'common' : k <= 1 ? 'goat' : k <= 5 ? 'icon' : k <= 20 ? 'legend' : k <= 50 ? 'standout' : k <= 125 ? 'rare' : 'common' }
export const DUEL_MULT = 1.25

/** A card's points and how they add up: { points, base, grade, bonuses: [[label, pct]] }. card: the pack/binder card shape.
 *  A Duel of the Day card (kind 'duel') is worth both players' cards together, plus 25%. */
export function cardPoints(card) {
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
  if (hasFeat(r) && !debut) bonuses.push(['Stat-line insert', 0.5])
  if (debut) bonuses.push(['Debut', 0.4])
  if (r.fx & 1) bonuses.push(['Career game', 0.25])
  if (r.fx & 4) bonuses.push(['Career-high Elo', 0.1])
  const mult = 1 + bonuses.reduce((s, b) => s + b[1], 0)
  return { points: Math.round(10 * base * (1 + grade / 10) * mult), base, grade, bonuses }
}
