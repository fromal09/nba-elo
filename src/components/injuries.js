// The injury report: ESPN's, through /api/schedule?only=injuries (cached a few minutes), shared by the Scoreboard's
// Injury Wire and Pick'em's Floor Times. ESPN marks a player Out or Day-To-Day; the finer status (questionable,
// doubtful, probable) is in its note.
import { useEffect, useState } from 'react'

let cache = null, at = 0
const MS = 5 * 60e3
export function useInjuries() {
  const [inj, setInj] = useState(cache)
  useEffect(() => {
    let live = true
    const load = () => {
      if (cache && Date.now() - at < MS) { setInj(cache); return }
      fetch('/api/schedule?only=injuries').then(r => (r.ok ? r.json() : null)).then(d => { if (d?.injuries && live) { cache = d.injuries; at = Date.now(); setInj(d.injuries) } }).catch(() => {})
    }
    load()
    const t = setInterval(load, MS)
    return () => { live = false; clearInterval(t) }
  }, [])
  return inj
}

export const normName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
export const INJ_ORDER = { Out: 0, Doubtful: 1, Questionable: 2, 'Day-to-day': 3, Probable: 4 }
export const INJ_TAG = { Out: 'Out', Doubtful: 'Doubt', Questionable: 'Q', 'Day-to-day': 'GTD', Probable: 'Prob' }
export const isGTD = st => st === 'Questionable' || st === 'Day-to-day' || st === 'Doubtful'
// day (YYYY-MM-DD, the game's): a note about another game ("ruled out for Sunday's game" read on Monday) says nothing
// about this one, so the player keeps ESPN's own status (Out or Day-To-Day)
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
function aboutOtherGame(t, day) {
  if (!day) return false
  const named = WEEKDAYS.find(w => new RegExp(`\\b${w}('s)?\\b`).test(t))
  if (!named) return false
  const dow = WEEKDAYS[new Date(day + 'T12:00:00Z').getUTCDay()]
  return named !== dow
}
export function injStatus(i, day) {
  const t = `${i.detail || ''}`.toLowerCase()
  const espnOut = /^out$/i.test(i.status || '')
  if (aboutOtherGame(t, day)) return espnOut ? 'Out' : 'Day-to-day'
  if (/\bprobable\b/.test(t)) return 'Probable'
  if (/\bdoubtful\b/.test(t)) return 'Doubtful'
  if (/\bquestionable\b/.test(t)) return 'Questionable'
  if (espnOut || /ruled out|will not play|won't play|is out\b/.test(t)) return 'Out'
  return 'Day-to-day'
}
// Player name → current Elo, from the ratings (set by whichever page has them)
let ELO = null
export const setInjuryRatings = players => { if (players?.length) ELO = new Map(players.map(p => [normName(p.name), { elo: Math.round(p.current_elo), rk: p.fpr_rank || null }])) }
const rated = n => ELO?.get(normName(n)) || null
// Everyone on a team's report, with status and Elo, Out first, then biggest names first
export function teamInjuries(inj, team, day) {
  return (inj?.[team] || []).map(i => { const r = rated(i.name); return { ...i, team, st: injStatus(i, day), elo: r?.elo ?? null, rk: r?.rk ?? null } })
    .sort((a, b) => INJ_ORDER[a.st] - INJ_ORDER[b.st] || (b.elo ?? 0) - (a.elo ?? 0))
}
// Players who matter to a game: anyone with a game-time call, and Out players rated 1,800+ (two-way and season-long
// names stay out of the way)
export const matters = i => i.st !== 'Out' || (i.elo ?? 0) >= 1800
export const teamReport = (inj, team, day) => teamInjuries(inj, team, day).filter(matters)
export const injCounts = (inj, team, day) => { const L = teamInjuries(inj, team, day); return { out: L.filter(i => i.st === 'Out').length, gtd: L.filter(i => isGTD(i.st)).length } }
export const injPart = i => (i.part || '').toLowerCase()
// An expected return still ahead of the game's day (a date on or before it says nothing useful)
export const retAhead = (i, day) => !!i.ret && (!day || String(i.ret).slice(0, 10) > day)
export const retShort = d => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')
// A featured player who landed on the report after his matchup was set (anything but Probable)
export const lateAdd = (inj, name, team, day) => { const i = (inj?.[team] || []).find(x => normName(x.name) === normName(name)); const st = i && injStatus(i, day); return st && st !== 'Probable' ? st : null }
