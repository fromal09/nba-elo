import { useEffect, useRef } from 'react'

// Polling that lets the database sleep: nothing runs while the tab is hidden, and it catches up the moment the tab is
// seen again. enabled: poll at all (pass false outside the hours games are on). Neon bills for every minute the
// database is awake, and an open background tab polling once a minute kept it awake all day.
export function usePoll(fn, ms, enabled = true, deps = []) {
  const f = useRef(fn)
  f.current = fn
  useEffect(() => {
    if (!enabled) return
    const run = () => { if (!document.hidden) f.current() }
    const t = setInterval(run, ms)
    const vis = () => { if (!document.hidden) f.current() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [ms, enabled, ...deps])
}

// Whether any game on these slates is on (in progress) or tips off within 20 minutes: the only time a pick, a score or
// a result can change. slates: [{ games: [{ state, tip }] }]
export function gamesHot(slates) {
  const now = Date.now()
  return (slates || []).some(s => (s.games || []).some(g => g.state === 'in' || (g.state === 'pre' && Date.parse(g.tip) - now < 20 * 60e3 && now - Date.parse(g.tip) < 4 * 36e5)))
}
