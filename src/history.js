// Career Elo histories load after the page is up: players.json renders the site, history.json
// (packed, see scripts/split_elo.py) fills in every player's elo_history in place.
let promise = null
export function loadHistory(players) {
  if (promise) return promise
  promise = fetch('/data/history.json').then(r => { if (!r.ok) throw new Error('history'); return r.json() }).then(d => {
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
    return true
  })
  return promise
}
