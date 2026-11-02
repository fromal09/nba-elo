import { useState, useEffect, useMemo } from 'react'
import styles from './SelectionBreakdown.module.css'

/*
 * Selection Breakdown: what keeping an offered card would do to your collection. Under the card you've chosen in a pack,
 * and on Store offers: his cards, the team-season roster, his Season card, the franchise all-time, its NBA history and
 * every player in it, and the season's All-Stars. Each line shows where it stands now and where the card takes it.
 */

const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const fcOf = t => MERGE[t] || t
const nbaSeason = (fc, s) => !!fc && !fc.includes('@') && s >= (['DEN', 'IND', 'SAS', 'BKN'].includes(fc) ? '1976-77' : '1949-50')
const nick = n => (/Trail Blazers$/.test(n || '') ? 'Trail Blazers' : (n || '').split(' ').pop())
const baseName = n => (n || '').replace(/\s*\(.*\)$/, '')
const ord = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

// The checklists, All-Stars and franchise rosters, fetched once per page
const cache = new Map()
const getJSON = path => { if (!cache.has(path)) cache.set(path, fetch(`/data/explorer/${path}`).then(r => (r.ok ? r.json() : null)).catch(() => null)); return cache.get(path) }
function useData(fc) {
  const [d, setD] = useState({})
  useEffect(() => {
    let on = true
    Promise.all([getJSON('binders/checklist.json'), getJSON('binders/honors.json'), fc ? getJSON(`binders/roster/${fc.replace('@', '_')}.json`) : null])
      .then(([check, honors, roster]) => on && setD({ check, honors, roster }))
    return () => { on = false }
  }, [fc])
  return d
}

export function breakdown(cards, c, { check, honors, roster }) {
  if (!c || c.kind || !c.row) return null
  const fc = fcOf(c.t), s = c.s, n = c.row.n
  const mine = (cards || []).map(x => x.card).filter(k => k && !k.kind && k.row)
  const his = mine.filter(k => k.row.n === n)
  const fr = mine.filter(k => fcOf(k.t) === fc)
  const ts = new Set(fr.filter(k => k.s === s).map(k => k.row.n))
  const games = new Set(his.filter(k => fcOf(k.t) === fc && k.s === s).map(k => k.id))
  const R = roster?.[s] || [], gp = R.find(x => x[0] === n)?.[1] || null
  const F = check?.franchises?.[fc], tn = nick(c.tn)
  const lines = []
  // The player
  lines.push(his.length ? { k: 'Player', main: `${baseName(n)}: your ${ord(his.length + 1)} card of his`, sub: games.size ? `${games.size} already from his ${s} ${tn} season` : `First of his ${s} ${tn} season`, up: false }
    : { k: 'Player', main: `${baseName(n)}: new to your binder`, sub: 'Your first card of him', up: true })
  // The team-season roster (the team set card)
  if (R.length) lines.push({ k: `${s} ${tn} roster`, now: ts.size, next: ts.has(n) ? ts.size : ts.size + 1, of: R.length, up: !ts.has(n),
    sub: ts.has(n) ? 'Already have him on this roster' : ts.size ? `${R.length - ts.size - 1} to go for the team set card` : 'Your first player from this team-season' })
  // His Season card
  if (gp) lines.push({ k: `His ${s} season`, now: games.size, next: games.has(c.id) ? games.size : games.size + 1, of: gp, up: !games.has(c.id), sub: `Every game forges his Season card` })
  // The franchise all-time
  const frP = new Set(fr.map(k => k.row.n))
  if (F) lines.push({ k: `${tn} all-time`, now: frP.size, next: frP.has(n) ? frP.size : frP.size + 1, of: F.players, up: !frP.has(n),
    sub: frP.has(n) ? `He’s already in your ${tn} players` : 'A new player in your franchise collection' })
  // NBA history: a season for Franchise History, a player for Completed Franchise
  if (F && nbaSeason(fc, s)) {
    const nbaS = new Set(fr.filter(k => k.t === fc && nbaSeason(fc, k.s)).map(k => k.s))
    const nbaP = new Set(fr.filter(k => k.t === fc && nbaSeason(fc, k.s)).map(k => k.row.n))
    const nbaN = F.nba?.[0] ?? Object.keys(F.seasons || {}).filter(x => nbaSeason(fc, x)).length
    lines.push({ k: 'Franchise History', now: nbaS.size, next: nbaS.has(s) ? nbaS.size : nbaS.size + 1, of: nbaN, up: !nbaS.has(s),
      sub: nbaS.has(s) ? `You already have a ${s} ${tn} card` : `Your first ${s} ${tn} card` })
    if (F.nba?.[1]) lines.push({ k: 'Completed Franchise', now: nbaP.size, next: nbaP.has(n) ? nbaP.size : nbaP.size + 1, of: F.nba[1], up: !nbaP.has(n),
      sub: 'Every player in its NBA history' })
  }
  // The season's All-Stars
  const code = honors?.[s]?.[n]
  if (code?.includes('S')) {
    const aba = code.includes('A')
    const stars = Object.entries(honors[s]).filter(([, x]) => x.includes('S') && x.includes('A') === aba).map(([m]) => m)
    const have = new Set(mine.filter(k => k.s === s && stars.includes(k.row.n)).map(k => k.row.n))
    lines.push({ k: `${s}${aba ? ' ABA' : ''} All-Stars`, now: have.size, next: have.has(n) ? have.size : have.size + 1, of: stars.length, up: !have.has(n),
      sub: have.has(n) ? 'He’s already on your list' : 'An All-Star that season' })
  }
  return lines
}

export default function SelectionBreakdown({ cards, card, compact, dark }) {
  const d = useData(card && !card.kind ? fcOf(card.t) : null)
  const lines = useMemo(() => breakdown(cards, card, d), [cards, card, d])
  if (!lines) return null
  return (
    <div className={styles.box} data-compact={compact ? '' : undefined} data-dark={dark ? '' : undefined}>
      <div className={styles.head}>Selection Breakdown</div>
      {lines.map(x => (
        <div key={x.k} className={styles.row} data-up={x.up ? '' : undefined}>
          <span className={styles.k}>{x.k}</span>
          {x.main ? <b className={styles.main}>{x.main}</b>
            : <b className={styles.count}>{x.now}{x.next !== x.now && <><i>→</i><em>{x.next}</em></>}<small> of {x.of ?? '—'}</small></b>}
          {!compact && x.sub && <small className={styles.sub}>{x.sub}</small>}
          {x.of ? <span className={styles.bar}><i style={{ width: `${Math.min(100, (x.now / x.of) * 100)}%` }} /><em style={{ width: `${Math.min(100, ((x.next - x.now) / x.of) * 100)}%` }} /></span> : null}
        </div>
      ))}
    </div>
  )
}
