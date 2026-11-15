// The all-time rankings' data (scripts/build_alltime.py): the list, the live layer and the rank through each game.
// Kept apart from AllTime.jsx so the cards can read it without importing the pages.
import { useState, useEffect } from 'react'

let cache = null, pending = null
export function loadAllTime() {
  if (cache) return Promise.resolve(cache)
  if (!pending) pending = fetch('/data/alltime.json').then(r => (r.ok ? r.json() : null)).then(d => {
    if (d?.players) { d.by = new Map(d.players.map(x => [x.name, x])); cache = d }
    pending = null
    return cache
  }).catch(() => { pending = null; return null })
  return pending
}
export function useAllTime() {
  const [d, set] = useState(cache)
  useEffect(() => { let on = true; if (!cache) loadAllTime().then(x => on && set(x)); return () => { on = false } }, [])
  return d
}

// Rank through each of a player's games (cards' backs): /data/alltime/<shard>.json, delta-encoded in elo_history order
const SHARDS = 64
export const shard = name => { let h = 0; for (const c of name) h = (h * 31 + c.codePointAt(0)) % SHARDS; return h }
const files = new Map()
const getShard = k => {
  if (!files.has(k)) files.set(k, fetch(`/data/alltime/${k}.json`).then(r => (r.ok ? r.json() : null)).catch(() => { files.delete(k); return null }))
  return files.get(k)
}
export async function gameRanks(name) {
  const d = await getShard(shard(name))
  const a = d?.[name]
  if (!a) return null
  let t = 0
  return a.map(x => (t += x))
}


// What one more game at this Elo adds to a score (the career part only)
export function perGame(AT, elo) {
  const { top, base } = AT.now
  const lvl = Math.max(0, (elo - base) / Math.max(1, top - base))
  return (100 * AT.weights.career * lvl) / AT.scale.career
}

// The list with tonight's games counted: finals since the nightly update and games in progress add to the career part.
// Each row: { ...nightly row, score, rank (live), base (nightly rank), live (in progress), today (games added) }
export function liveAllTime(AT, players) {
  if (!AT) return null
  const add = new Map()
  for (const p of players || []) {
    const n = (p.last_played > AT.night ? 1 : 0) + (p.live ? 1 : 0)
    if (n && AT.by.has(p.name)) add.set(p.name, { n, gain: n * perGame(AT, p.current_elo), live: !!p.live })
  }
  if (!add.size) return { rows: AT.players.map(x => ({ ...x, base: x.rank })), by: AT.by, any: false }
  const rows = AT.players.map(x => {
    const a = add.get(x.name)
    return a ? { ...x, score: x.score + a.gain, base: x.rank, live: a.live, today: a.n } : { ...x, base: x.rank }
  }).sort((a, b) => b.score - a.score || a.base - b.base)
  rows.forEach((x, i) => { x.rank = i + 1 })
  return { rows, by: new Map(rows.map(x => [x.name, x])), any: true }
}

