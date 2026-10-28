// Career Elo histories load after the page is up: players.json renders the site, history.json
// (packed, see scripts/split_elo.py) fills in every player's elo_history in place.
let fetched = null   // the packed file, fetched once
let ready = null     // resolves once the latest players array has its histories
const applied = new WeakSet()

function apply(d, players) {
  if (applied.has(players)) return
  const epoch = Date.parse(d.epoch + 'T00:00:00Z'), DAY = 86400000
  const dates = new Map()
  const ds = n => {
    let s = dates.get(n)
    if (!s) { s = new Date(epoch + n * DAY).toISOString().slice(0, 10); dates.set(n, s) }
    return s
  }
  const C = d.codes
  d.h.forEach((a, i) => {
    const p = players[i]
    if (!p) return
    const hist = new Array(a.length / 4)
    let day = 0
    for (let j = 0, k = 0; j < a.length; j += 4, k++) {
      day += a[j]
      hist[k] = [ds(day), a[j + 1] / 10, C[a[j + 2]], (a[j + 3] & 1) === 1, C[a[j + 3] >> 1]]
    }
    p.elo_history = hist
  })
  applied.add(players)
}

// Safe to call more than once (React's dev mode loads players.json twice): every array passed in gets histories
export function loadHistory(players) {
  if (!fetched) fetched = fetch('/data/history.json').then(r => { if (!r.ok) throw new Error('history'); return r.json() })
  ready = fetched.then(d => { apply(d, players); return true })
  return ready
}

// Resolves once histories are in (null before loadHistory has been called)
export const historyReady = () => ready

// The full history is big (every game of every career), so nothing loads it until something needs it:
// pages that chart careers, a player's profile, a card's back or a career binder. registerPlayers keeps the
// players array to fill in; ensureHistory starts the load (once) and returns the same promise every time.
let registered = null
const waiters = new Set()
export function registerPlayers(players) {
  registered = players
  if (ready) ensureHistory()
}
export function ensureHistory() {
  if (!registered) return null
  const p = loadHistory(registered)
  p.then(() => waiters.forEach(f => f())).catch(() => {})
  return p
}
// Call back when histories arrive (for components that redraw then)
export function onHistory(f) { waiters.add(f); return () => waiters.delete(f) }

// Hook for components that draw careers: starts the load when mounted (when `on`), redraws when it lands
import { useEffect, useState } from 'react'
export function useCareerHistory(on = true) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    let live = true
    ensureHistory()?.then(() => live && tick(t => t + 1)).catch(() => {})
    return () => { live = false }
  }, [on])
}
