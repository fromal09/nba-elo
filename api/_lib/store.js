// The store: packs bought with Coins, and the On This Day storefront, which rotates at midnight Eastern.
// On This Day offers 1 GOAT, 2 Icons, 3 Legends, 4 Standouts and 5 Rares from games played on today's
// calendar date in past seasons; the same fifteen for everyone. One of them is the Card of the Day, half price.
import { poolIndex, poolJSON, toCard, ERAS } from './packs.js'
import { cardPoints } from './points.js'

export const PACK_PRICES = { standard: 300, era: 400, storeteam: 400, playoff: 600, legend: 1500, goat: 10000 }
export const FEATURED_MIX = [['goat', 1], ['icon', 2], ['legend', 3], ['standout', 4], ['rare', 5]]
const COINS_PER_POINT = 3

const weekNo = day => Math.floor((Date.parse(day + 'T12:00:00Z') / 864e5 + 3) / 7) // weeks since 1970, Monday to Sunday
export const eraOfWeek = day => ERAS[weekNo(day) % ERAS.length]

export function catalog(day) {
  const era = eraOfWeek(day)
  return [
    { kind: 'standard', name: 'Standard Pack', price: PACK_PRICES.standard, desc: 'Five picks from all of history. The last slot is Rare or better.' },
    { kind: 'era', name: `${era.name} Pack`, price: PACK_PRICES.era, era: era.id, desc: `Five picks from ${era.years} only. The era changes every Monday.` },
    { kind: 'storeteam', name: 'Team Pack', price: PACK_PRICES.storeteam, desc: 'Five picks from one franchise’s history. You choose the team.', team: true },
    { kind: 'playoff', name: 'Playoff Pack', price: PACK_PRICES.playoff, desc: 'Playoff games only. The last slot comes from the Finals.' },
    { kind: 'legend', name: 'Legend Pack', price: PACK_PRICES.legend, desc: 'A guaranteed Legend or better in the last slot.' },
    { kind: 'goat', name: 'GOAT Pack', price: PACK_PRICES.goat, desc: 'A guaranteed ★ GOAT card in the last slot. Every other slot Rare or better.' },
  ]
}

// A deterministic random stream for the day, so every collector sees the same storefront
function seeded(str) {
  let h = 2166136261
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296 }
}

const cache = new Map()
export async function featured(origin, day) {
  if (cache.has(day)) return cache.get(day)
  const p = buildFeatured(origin, day)
  cache.set(day, p); if (cache.size > 4) cache.delete(cache.keys().next().value)
  p.catch(() => cache.delete(day))
  return p
}

async function buildFeatured(origin, day) {
  const idx = await poolIndex(origin)
  const md = day.slice(5)
  const rnd = seeded(`otd|${day}`)
  const otd = await poolJSON(origin, `onthisday/${md}.json`).catch(() => null)
  const thisYear = +day.slice(0, 4)
  const cards = [], seen = new Set()
  const add = (c, onDate) => { const ref = `${c.s}|${c.id}|${c.row.n}`; if (seen.has(ref)) return false; seen.add(ref); cards.push({ card: c, onDate }); return true }
  let fromDate = 0
  for (const [tier, n] of FEATURED_MIX) {
    // From this calendar date in past years first (the pool keeps each tier's 40 best games by Game Score)
    const list = (otd?.tiers?.[tier] || []).filter(r => +r[2].slice(0, 4) < thisYear || r[2].slice(0, 10) < day)
    const pool = [...list]
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]] }
    const picks = pool.slice(0, n)
    for (const r of picks) if (add(toCard(idx.cols, r, otd.teams, 'store'), true)) fromDate++
    // Not enough games on this date at this tier: random cards of the tier from the whole pool
    let need = n - picks.length, tries = 0
    while (need > 0 && tries++ < 40) {
      const shards = idx.tiers[tier] || []
      if (!shards.length) break
      const [file] = shards[Math.floor(rnd() * shards.length)]
      const sh = await poolJSON(origin, file)
      if (add(toCard(idx.cols, sh.rows[Math.floor(rnd() * sh.rows.length)], sh.teams, 'store'), false)) need--
    }
  }
  const deal = Math.floor(rnd() * cards.length)
  return {
    day, random: fromDate === 0, partial: fromDate > 0 && fromDate < cards.length,
    cards: cards.map(({ card, onDate }, i) => {
      const pts = cardPoints(card).points, full = Math.max(10, Math.ceil((pts * COINS_PER_POINT) / 10) * 10)
      return { card, onDate, points: pts, price: i === deal ? Math.ceil(full / 20) * 10 : full, full, deal: i === deal }
    }),
  }
}
