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
  goatOnly: { goat: 1 },
}
// Slots: [source, odds]. recent = last night's games, vault = all of history, team = one franchise's history
const SLOTS = {
  daily: [['recent', 'base'], ['recent', 'base'], ['vault', 'base'], ['vault', 'base'], ['vault', 'rarePlus']],
  streak: [['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'legendPlus']],
  team: [['team', 'base'], ['team', 'base'], ['team', 'base'], ['team', 'rarePlus'], ['team', 'rarePlus']],
  // Store packs (bought with Coins)
  standard: [['vault', 'base'], ['vault', 'base'], ['vault', 'base'], ['vault', 'base'], ['vault', 'rarePlus']],
  era: [['era', 'base'], ['era', 'base'], ['era', 'base'], ['era', 'base'], ['era', 'rarePlus']],
  storeteam: [['team', 'base'], ['team', 'base'], ['team', 'base'], ['team', 'rarePlus'], ['team', 'rarePlus']],
  playoff: [['playoff', 'base'], ['playoff', 'base'], ['playoff', 'base'], ['playoff', 'rarePlus'], ['finals', 'rarePlus']],
  legend: [['vault', 'base'], ['vault', 'base'], ['vault', 'base'], ['vault', 'rarePlus'], ['vault', 'legendPlus']],
  goat: [['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'rarePlus'], ['vault', 'goatOnly']],
}

// The card designs' eras, by season start year (as PlayerCard eraOf); the store's Era pack rotates through them weekly
export const ERAS = [
  { id: 'classic', name: 'Classic', from: 1946, to: 1958, years: '1946–59' },
  { id: 'groove', name: 'Groove', from: 1959, to: 1978, years: '1960–79' },
  { id: 'stripe', name: 'Stripe', from: 1979, to: 1988, years: '1980–89' },
  { id: 'edge', name: 'Edge', from: 1989, to: 1998, years: '1990–99' },
  { id: 'refractor', name: 'Refractor', from: 1999, to: 2018, years: '2000–19' },
  { id: 'modern', name: 'Modern', from: 2019, to: 9999, years: '2020–' },
]
const seasonStart = file => +(file.match(/(\d{4})-\d{2}-\d+\.json$/)?.[1] || 0)
// Shards limited to an era's seasons, or to the end of each season (where its playoff games are)
function eraTiers(idx, era) {
  return Object.fromEntries(Object.entries(idx.tiers).map(([t, list]) => [t, list.filter(([f]) => { const y = seasonStart(f); return y >= era.from && y <= era.to })]))
}
function lastShards(idx) {
  return Object.fromEntries(Object.entries(idx.tiers).map(([t, list]) => {
    const last = new Map(); list.forEach(x => last.set(x[0].replace(/-\d+\.json$/, ''), x))
    return [t, [...last.values()]]
  }))
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
  const r = await fetch(`${origin}/data/explorer/packs/${path}`, { signal: AbortSignal.timeout(25e3) }).catch(() => ({ ok: false, status: 'unreachable' }))
  if (!r.ok) throw Object.assign(new Error(`The card pool isn’t published yet (${path}: ${r.status}).`), { status: 503 })
  return r.json()
}

export async function poolIndex(origin, maxAge = 10 * 60e3) {
  if (!indexCache || Date.now() - indexCache.at > maxAge) indexCache = { at: Date.now(), data: await getJSON(origin, 'index.json') }
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
// A card's identity. Special cards: duel (Duel of the Day), peak, rival (Rivalry), five (Starting Five), season (forged Season card)
export const refOf = c => (c.kind === 'duel' ? `duel|${c.date}` : c.kind === 'peak' ? `peak|${c.s}|${c.id}|${c.row.n}` : c.kind === 'rival' ? `rival|${c.a}|${c.b}`
  : c.kind === 'five' ? `five|${c.s}|${c.t}` : c.kind === 'season' ? `season|${c.s}|${c.t}|${c.n}` : c.kind === 'potw' ? `potw|${c.week}`
    : `${c.s}|${c.id}|${c.row.n}${c.ruby ? '|ruby' : ''}`)
export const SPECIAL_KINDS = new Set(['duel', 'peak', 'rival', 'five', 'season', 'potw'])

// About one pack in 15 swaps the last slot's first offer for a special card: a Peak, a Starting Five or a Rivalry
export const SPECIAL_EVERY = Number(process.env.SPECIAL_EVERY) || 15
const SPECIAL_MIX = { peaks: 45, fives: 35, rivals: 20 }
const RIVAL_WEIGHT = { goat: 1, icon: 2, legend: 4, standout: 8, rare: 16 }
let specialIndex = null
async function specialCard(origin, taken) {
  if (!specialIndex || Date.now() - specialIndex.at > 10 * 60e3) specialIndex = { at: Date.now(), data: await getJSON(origin, 'special/index.json').catch(() => null) }
  const idx = specialIndex.data
  if (!idx) return null
  for (let tries = 0; tries < 6; tries++) {
    const kind = roll(Object.fromEntries(Object.entries(SPECIAL_MIX).filter(([k]) => idx[k]?.length)))
    if (!kind) return null
    const list = idx[kind]
    const file = list[roll(Object.fromEntries(list.map(([, n], i) => [i, n])))][0]
    const cards = (await shard(origin, `special/${file}`)).cards
    const c = kind === 'rivals' ? cards[+roll(Object.fromEntries(cards.map((x, i) => [i, RIVAL_WEIGHT[x.tier] || 1])))] : cards[randomInt(cards.length)]
    if (c && !taken.has(refOf(c))) return { ...c, from: 'special' }
  }
  return null
}

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
// A tier at these odds and a shard of it, rolled ahead so a pack's shards can download together
function rollShard(tiers, odds) {
  const avail = Object.fromEntries(Object.entries(odds).filter(([t]) => tiers?.[t]?.length))
  const t = roll(avail); if (!t) return null
  const list = tiers[t]
  return [t, list[roll(Object.fromEntries(list.map(([, n], i) => [i, n])))][0]]
}

async function fromShards(origin, idx, tiers, odds, taken, from, avoid, rowOk, pre) {
  for (let tries = 0; tries < 12; tries++) {
    const r = tries === 0 && pre ? pre : rollShard(tiers, odds); if (!r) return null
    const file = r[1]
    const sh = await shard(origin, file)
    const rows = rowOk ? sh.rows.filter(r => rowOk(r, idx.cols)) : sh.rows
    if (!rows.length) continue
    const c = toCard(idx.cols, rows[randomInt(rows.length)], sh.teams, from)
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
export async function buildOffers(origin, kind, { taken, team, pity, era }) {
  const idx = await poolIndex(origin)
  const bandAt = idx.cols.indexOf('band')
  const isPlayoff = r => !!r[bandAt]
  const isFinals = r => r[bandAt] && (r[bandAt][0] === 'finals' || r[bandAt][0] === 'champ')
  const eraT = era ? eraTiers(idx, era) : null
  const poT = kind === 'playoff' ? lastShards(idx) : null
  const plan = SLOTS[kind].map(x => [...x])
  if (pity) plan[plan.length - 1] = [plan[plan.length - 1][0] === 'recent' ? 'vault' : plan[plan.length - 1][0], 'legendPlus']
  const teamTiers = team ? idx.teams?.[team] : null
  if ((kind === 'team' || kind === 'storeteam') && !teamTiers) throw Object.assign(new Error('That team’s cards aren’t in the pool yet.'), { status: 400 })
  const seen = new Set(taken)
  const slots = []
  // Roll every card's shard first and download them together (one at a time, a cold server took many seconds)
  const srcTiers = src => (src === 'team' ? teamTiers : src === 'era' ? eraT : src === 'playoff' || src === 'finals' ? poT : src === 'vault' ? idx.tiers : null)
  // At most two shards per tier and source in a pack: a pack needs a handful of downloads, not fifteen
  const picked = new Map()
  const rollFew = (tiers, odds, src) => {
    const r = rollShard(tiers, odds); if (!r) return null
    const k = src + '|' + r[0], have = picked.get(k) || []
    if (have.length < 2) { picked.set(k, [...have, r]); return r }
    return have[randomInt(have.length)]
  }
  const pre = plan.map(([src, oddsKey]) => [0, 1, 2].map(() => (srcTiers(src) ? rollFew(srcTiers(src), ODDS[oddsKey], src) : null)))
  const files = [...new Set(pre.flat().filter(Boolean).map(x => x[1]))]
  for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(f => shard(origin, f).catch(() => null)))
  for (const [si, [src, oddsKey]] of plan.entries()) {
    const odds = ODDS[oddsKey], cards = [], names = new Set() // three different players per slot
    for (let k = 0; k < 3; k++) {
      let c = null
      const p0 = pre[si][k]
      if (src === 'recent') c = fromRecent(idx, odds, seen, names)
      if (!c && src === 'team') c = await fromShards(origin, idx, teamTiers, odds, seen, 'team', names, null, p0)
      if (!c && src === 'era') c = await fromShards(origin, idx, eraT, odds, seen, 'era', names, null, p0)
      if (!c && src === 'playoff') c = await fromShards(origin, idx, poT, odds, seen, 'playoff', names, isPlayoff, p0)
      if (!c && src === 'finals') c = await fromShards(origin, idx, poT, odds, seen, 'playoff', names, isFinals, p0)
        || await fromShards(origin, idx, poT, odds, seen, 'playoff', names, isPlayoff)
      // Last night or the team ran out of new cards at these odds: widen to the vault
      if (!c) c = await fromShards(origin, idx, idx.tiers, odds, seen, 'vault', names, null, src === 'vault' ? p0 : null)
      if (!c) continue
      seen.add(refOf(c)); names.add(c.row.n); cards.push(c)
    }
    cards.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
    slots.push({ src, odds: oddsKey, cards })
  }
  // The special swap: the last slot's first (lowest) offer becomes a special card, shown last
  const last = slots[slots.length - 1]
  if (last?.cards.length && randomInt(SPECIAL_EVERY) === 0) {
    const sp = await specialCard(origin, seen).catch(() => null)
    if (sp) { last.cards = [...last.cards.slice(1), sp]; last.special = true }
  }
  return { slots, pity: !!pity, recentDate: idx.recent?.date || null }
}

export const teamCodes = async origin => Object.keys((await poolIndex(origin)).teams || {})
export { toCard, getJSON as poolJSON, tierOf }
export const recentDate = async (origin, maxAge) => (await poolIndex(origin, maxAge)).recent?.date || null
