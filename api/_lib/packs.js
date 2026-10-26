// Building packs on the server, from the card pool build_packs.py publishes under /data/explorer/packs.
// A pack is five slots; each slot offers three cards and the collector keeps one. Offers never repeat a
// card the collector owns, one already on offer in another open pack, or another card in the same pack.
import { randomInt } from 'node:crypto'

export const TIER_ORDER = ['common', 'rare', 'standout', 'legend', 'icon', 'goat']
export const BIG = new Set(['legend', 'icon', 'goat'])
export const PITY_EVERY = 10 // at most this many packs between Legend-or-better pulls

// Per-card odds, out of 10,000
const ODDS = {
  base: { common: 6200, rare: 2200, standout: 900, legend: 500, icon: 150, goat: 50 },
  rarePlus: { rare: 6000, standout: 2400, legend: 1100, icon: 400, goat: 100 },
  legendPlus: { legend: 7500, icon: 2000, goat: 500 },
}
// Slots: [source, odds]. recent = last night's games, vault = all of history, team = one franchise's history
const SLOTS = {
  daily: [['recent', 'base'], ['recent', 'base'], ['vault', 'base'], ['vault', 'base'], ['vault', 'rarePlus']],
  streak: [['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'legendPlus']],
  team: [['team', 'base'], ['team', 'base'], ['team', 'base'], ['team', 'rarePlus'], ['team', 'rarePlus']],
}

const roll = weights => {
  const entries = Object.entries(weights).filter(([, w]) => w > 0)
  if (!entries.length) return null
  let r = randomInt(entries.reduce((s, [, w]) => s + w, 0))
  for (const [k, w] of entries) { if ((r -= w) < 0) return k }
  return entries[entries.length - 1][0]
}

// Module-level caches survive between requests on a warm function
let indexCache = null
const shardCache = new Map()

async function getJSON(origin, path) {
  const r = await fetch(`${origin}/data/explorer/packs/${path}`).catch(() => ({ ok: false, status: 'unreachable' }))
  if (!r.ok) throw Object.assign(new Error(`The card pool isn’t published yet (${path}: ${r.status}).`), { status: 503 })
  return r.json()
}

export async function poolIndex(origin) {
  if (!indexCache || Date.now() - indexCache.at > 10 * 60e3) indexCache = { at: Date.now(), data: await getJSON(origin, 'index.json') }
  return indexCache.data
}

function shard(origin, file) {
  if (shardCache.has(file)) return shardCache.get(file)
  const p = getJSON(origin, file)
  shardCache.set(file, p)
  if (shardCache.size > 60) shardCache.delete(shardCache.keys().next().value)
  p.catch(() => shardCache.delete(file))
  return p
}

const tierOf = rank => (rank == null ? 'common' : rank <= 1 ? 'goat' : rank <= 5 ? 'icon' : rank <= 20 ? 'legend' : rank <= 50 ? 'standout' : rank <= 125 ? 'rare' : 'common')
export const refOf = c => `${c.s}|${c.id}|${c.row.n}`

// A pool row as the card the site renders (the binder index shape, plus what stat-line inserts read)
function toCard(cols, r, teams, from) {
  const o = {}; cols.forEach((k, i) => { o[k] = r[i] })
  const team = c => teams[`${o.s}|${c}`] || teams[c] || [c, null]
  return {
    s: o.s, id: o.id, date: o.date, t: o.t, tn: team(o.t)[0], tc: team(o.t)[1], o: o.o, on: team(o.o)[0], oc: team(o.o)[1],
    home: o.home, won: o.won, score: `${o.us}–${o.them}`, ot: o.ot,
    band: o.band ? { level: o.band[0], label: o.band[1], champ: o.band[2] } : null, honor: o.honor, tier: tierOf(o.lrp ?? o.lr), from,
    row: { n: o.n, pos: o.pos, mp: o.mp, pts: o.pts, trb: o.trb, ast: o.ast, stl: o.stl, blk: o.blk, tp: o.tp, gs: o.gs, pre: o.pre, post: o.post, lr: o.lr, lrp: o.lrp, fx: o.fx, gp: o.gp },
  }
}

// One card from a set of shards ({tier: [[file, n], ...]}) at these odds, skipping cards in `taken`
async function fromShards(origin, idx, tiers, odds, taken, from, avoid) {
  const avail = Object.fromEntries(Object.entries(odds).filter(([t]) => tiers[t]?.length))
  for (let tries = 0; tries < 12; tries++) {
    const t = roll(avail); if (!t) return null
    const list = tiers[t]
    const file = list[roll(Object.fromEntries(list.map(([, n], i) => [i, n])))][0]
    const sh = await shard(origin, file)
    const c = toCard(idx.cols, sh.rows[randomInt(sh.rows.length)], sh.teams, from)
    if (!taken.has(refOf(c)) && !(avoid?.has(c.row.n) && tries < 8)) return c
  }
  return null
}

function fromRecent(idx, odds, taken, avoid) {
  const rec = idx.recent
  if (!rec?.rows?.length) return null
  const byTier = {}
  rec.rows.forEach(r => { const c = toCard(idx.cols, r, rec.teams, 'recent'); if (!taken.has(refOf(c)) && !avoid?.has(c.row.n)) (byTier[c.tier] = byTier[c.tier] || []).push(c) })
  const t = roll(Object.fromEntries(Object.entries(odds).filter(([k]) => byTier[k])))
    || roll(Object.fromEntries(Object.keys(byTier).map(k => [k, 1]))) // nothing left at these odds: any card from last night
  if (!t) return null
  const list = byTier[t]
  return list[randomInt(list.length)]
}

/**
 * The offers for a new pack: five slots of three cards, each slot sorted rarest last.
 * taken = refs the collector owns or has on offer elsewhere. pity = make the last slot Legend or better.
 * Returns { slots: [{ src, label, cards: [card, card, card] }], pity }
 */
export async function buildOffers(origin, kind, { taken, team, pity }) {
  const idx = await poolIndex(origin)
  const plan = SLOTS[kind].map(x => [...x])
  if (pity) plan[plan.length - 1] = [plan[plan.length - 1][0] === 'recent' ? 'vault' : plan[plan.length - 1][0], 'legendPlus']
  const teamTiers = team ? idx.teams?.[team] : null
  if (kind === 'team' && !teamTiers) throw Object.assign(new Error('That team’s cards aren’t in the pool yet.'), { status: 400 })
  const seen = new Set(taken)
  const slots = []
  for (const [src, oddsKey] of plan) {
    const odds = ODDS[oddsKey], cards = [], names = new Set() // three different players per slot
    for (let k = 0; k < 3; k++) {
      let c = null
      if (src === 'recent') c = fromRecent(idx, odds, seen, names)
      if (!c && src === 'team') c = await fromShards(origin, idx, teamTiers, odds, seen, 'team', names)
      // Last night or the team ran out of new cards at these odds: widen to the vault
      if (!c) c = await fromShards(origin, idx, idx.tiers, odds, seen, 'vault', names)
      if (!c) continue
      seen.add(refOf(c)); names.add(c.row.n); cards.push(c)
    }
    cards.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
    slots.push({ src, odds: oddsKey, cards })
  }
  return { slots, pity: !!pity, recentDate: idx.recent?.date || null }
}

export const teamCodes = async origin => Object.keys((await poolIndex(origin)).teams || {})
export const recentDate = async origin => (await poolIndex(origin)).recent?.date || null
