import { useState, useEffect, useMemo } from 'react'
import { scoreGame, assignRanks, advanceRatings } from './live.js'

// One live ESPN feed per day, shared by every view that wants it (the scoreboard, standings, odds,
// award races). Each day is fetched once and polled while anyone is watching: every 30 seconds while
// games are live, every 2 minutes before tip-off today, and not at all once the day is final.
const days = new Map() // day -> { subs, data, err, timer, stopped }

function load(day, e, isToday) {
  fetch(`/api/live?date=${day}`).then(r => r.json()).then(d => {
    if (e.stopped) return
    e.data = d
    e.err = !d.games?.length && d.errors?.length ? d.errors[0] : null
    e.subs.forEach(f => f({ data: e.data, err: e.err }))
    const wait = d.live ? 30000 : d.games?.some(g => g.state === 'pre') && isToday ? 120000 : 0
    if (wait) e.timer = setTimeout(() => load(day, e, isToday), wait)
  }).catch(err => {
    if (e.stopped) return
    e.err = err.message
    e.subs.forEach(f => f({ data: e.data, err: e.err }))
    e.timer = setTimeout(() => load(day, e, isToday), 60000)
  })
}

// Calls back with { data, err } now (if the day is already loaded) and on every update.
// Returns an unsubscribe function; the last one out stops the polling.
export function watchDay(day, cb, isToday) {
  let e = days.get(day)
  if (!e) {
    e = { subs: new Set(), data: null, err: null, timer: null, stopped: false }
    days.set(day, e)
    load(day, e, isToday)
  }
  e.subs.add(cb)
  if (e.data || e.err) cb({ data: e.data, err: e.err })
  return () => {
    e.subs.delete(cb)
    if (!e.subs.size) { clearTimeout(e.timer); e.stopped = true; days.delete(day) }
  }
}

// ── Live layer: everything since the last pipeline update ──────────────────

export const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (day, k) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }

// Days after `asof` (the last day the ratings include) through today, at most a week
export function liveDaysAfter(asof) {
  const today = etToday(), floor = addDays(today, -6), out = []
  let d = asof ? addDays(asof, 1) : floor
  if (d < floor) d = floor
  for (; d <= today && out.length < 7; d = addDays(d, 1)) out.push(d)
  return out
}

// Live feeds for a list of days, as { day: feed }; re-renders on every poll
export function useLiveFeeds(days) {
  const [feeds, setFeeds] = useState({})
  const key = days.join(',')
  useEffect(() => {
    setFeeds({})
    const offs = days.map(d => watchDay(d, ({ data }) => { if (data) setFeeds(f => ({ ...f, [d]: data })) }, d === etToday()))
    return () => offs.forEach(off => off())
  }, [key])
  return feeds
}

export const gameKey = (day, a, b) => `${day}|${[a, b].sort().join('|')}`

// Scores every final and in-progress game in the feeds, day by day. Finals advance the ratings, so a
// second unprocessed day starts from the first day's post-game Elo. `have` holds gameKeys to skip
// (games the pipeline already has). Games in progress are scored provisionally from the same ratings.
export function computeLive({ ratings, feeds, days, have = new Set(), winChance, sy }) {
  let R = ratings
  const finals = [], inprog = [], inprogScored = []
  let fetched = null
  for (const day of days) {
    const f = feeds[day]
    if (!f) continue
    if (f.fetched && (!fetched || f.fetched > fetched)) fetched = f.fetched
    const done = [], going = []
    for (const x of f.games || []) {
      if (have.has(gameKey(day, x.home, x.away))) continue
      if (x.state === 'post' && x.box) {
        const g = scoreGame(x, R, day, winChance, sy)
        if (g) { g.post = false; done.push(g) }
      } else if (x.state === 'in') {
        inprog.push({ ...x, day })
        if (x.box) going.push(x)
      }
    }
    if (done.length) { assignRanks(done, R); finals.push(...done) }
    for (const x of going) { const g = scoreGame(x, R, day, winChance, sy); if (g) inprogScored.push(g) }
    if (done.length) R = advanceRatings(R, done)
  }
  return { finals, inprog, inprogScored, fetched, any: finals.length + inprog.length > 0 }
}

// elo.json players with the live layer applied: finals move Elo, games played and career history;
// games in progress move Elo provisionally (marked `live`). Ranks are recomputed from the new Elo.
export function patchPlayers(base, live) {
  if (!live?.any) return base
  const touch = new Map()
  const entry = n => { if (!touch.has(n)) touch.set(n, { hist: [], gp: 0 }); return touch.get(n) }
  for (const g of live.finals) {
    const [a, b] = g.teams
    for (const p of g.players) {
      if (p.unrated) continue
      const e = entry(p.n), i = g.teams.indexOf(p.t)
      e.post = p.post; e.gp++; e.team = p.t; e.date = g.date
      e.hist.push([g.date, p.post, p.t === a ? b : a, g.pts[i] > g.pts[1 - i], p.t])
      e.today = (e.today || 0) + (p.post - p.pre)
    }
  }
  for (const g of live.inprogScored) {
    for (const p of g.players) {
      if (p.unrated) continue
      const e = entry(p.n)
      e.post = p.post; e.team = p.t
      e.live = { delta: p.post - p.pre, detail: g.live?.detail || 'Live', opp: g.teams.find(t => t !== p.t) }
    }
  }
  if (!touch.size) return base
  const out = base.map(p => {
    const e = touch.get(p.name)
    if (!e) return p
    return {
      ...p, current_elo: e.post, peak_elo: Math.max(p.peak_elo, e.post), games_played: p.games_played + e.gp,
      last_played: e.date || p.last_played, team: e.team || p.team,
      elo_history: p.elo_history && e.hist.length ? [...p.elo_history, ...e.hist] : p.elo_history,
      live: e.live || null, live_change: Math.round((e.post - p.current_elo) * 10) / 10, base_elo: p.current_elo,
    }
  })
  // current_tpr_rank: every player by Elo; fpr_rank: FPR-eligible players only (as build_elo.py)
  const all = out.map((p, i) => i).sort((x, y) => out[y].current_elo - out[x].current_elo)
  const tpr = new Array(out.length), fpr = new Array(out.length)
  let k = 0
  all.forEach((i, r) => { tpr[i] = r + 1; if (out[i].is_fpr_eligible) fpr[i] = ++k })
  return out.map((p, i) => {
    const t = tpr[i], f = out[i].is_fpr_eligible ? fpr[i] : null
    if (p.current_tpr_rank === t && p.fpr_rank === f) return p
    const q = p === base[i] ? { ...p } : p
    q.base_fpr_rank = base[i].fpr_rank
    q.current_tpr_rank = t; q.fpr_rank = f
    return q
  })
}

// The whole live layer for pages that read elo.json players (rankings, profiles, history pages):
// returns the patched players and the live games behind them. `ratings` comes from buildRatings(base);
// histReady re-applies once career histories are in, so they get today's games too.
export function useLivePlayers(base, ratings, histReady) {
  const asof = useMemo(() => (base || []).reduce((m, p) => (p.last_played > m ? p.last_played : m), ''), [base])
  const days = useMemo(() => (base ? liveDaysAfter(asof) : []), [base, asof])
  const feeds = useLiveFeeds(days)
  const live = useMemo(() => (ratings && days.length ? computeLive({ ratings, feeds, days, winChance: () => 0.5, sy: 0 }) : null),
    [ratings, feeds, days])
  const players = useMemo(() => (base ? patchPlayers(base, live) : base), [base, live, histReady])
  return { players, live, asof }
}
