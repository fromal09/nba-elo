import { useEffect } from 'react'
const fmtDay = (d, o) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)

// Prize cards from Pick'em: the ones waiting to be chosen and the ones already won, read off your prediction history.
// The history loads on first use (once per visit); claiming a card reloads it.
export function usePrizes(C) {
  const signed = !!C.me
  useEffect(() => { if (signed && !C.preds) C.loadPredictions?.().catch(() => {}) }, [signed])
  const H = C.preds?.history || []
  const waiting = H.flatMap(h => [
    h.games?.reward && !h.games.claimed && { day: h.day, which: 'games', label: h.games.reward === 'any' ? 'Perfect day · any card' : 'Games · Legend or below' },
    h.duels?.reward && h.duels.reward !== 'duel' && !h.duels.claimed && { day: h.day, which: 'duels', label: 'Matchups · Rare or below' },
  ]).filter(Boolean)
  const won = H.flatMap(h => [
    h.games?.claimed && { day: h.day, which: 'games', card: h.games.claimed.card },
    h.duels?.claimed && { day: h.day, which: 'duels', card: h.duels.claimed.card },
  ]).filter(Boolean)
  // the summary count arrives with your account, before the history does
  const count = Math.max(waiting.length, C.me?.predict?.unclaimed || 0)
  return { waiting, won, count, loaded: !!C.preds }
}

export const prizeNote = (P) => (P.waiting[0] ? `From ${fmtDay(P.waiting[0].day, { month: 'short', day: 'numeric' })}${P.count > 1 ? ` · ${P.count} waiting` : ''}` : `${P.count} waiting`)
