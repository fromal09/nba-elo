import { useState, useEffect, useMemo } from 'react'
import styles from './MyPredictions.module.css'
import { useCollector, TIER_NAME } from './Collector'
import { binderLogo, binderTeamInfo } from './SeasonExplorer'
import { watchDay } from './liveFeed.js'
import { norm } from './predict'
import { usePoll, gamesHot } from './poll'
import { scoreGame } from './live.js'
import { winChance } from './predict'

/*
 * My Predictions, on the Scoreboard: for one day, every game pick, every matchup and the lineup, with live
 * scores and live Game Scores from the scoreboard feed while the games are on. The stored picks come from
 * the server (predday); grading happens there too, so a final result here matches the binder's History.
 */

const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const shortName = n => { const [f, ...r] = baseName(n).split(' '); return r.length ? `${f[0]}. ${r.join(' ')}` : f }
const tipTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const f1 = v => (v == null ? '—' : v.toFixed(1))
// Game Score from a live box-score line (the same formula as the ratings pipeline)
const gmsc = p => Math.round(((p.pts || 0) + 0.4 * (p.fg || 0) - 0.7 * (p.fga || 0) - 0.4 * ((p.fta || 0) - (p.ft || 0)) + 0.7 * (p.orb || 0) + 0.3 * (p.drb || 0)
  + (p.stl || 0) + 0.7 * (p.ast || 0) + 0.7 * (p.blk || 0) - 0.4 * (p.pf || 0) - (p.tov || 0)) * 10) / 10
// Lineup points: Game Score times the card's multiplier (a negative Game Score isn't multiplied)
export const lineupPts = (gs, mult) => (gs > 0 ? gs * (mult || 1) : gs)

const Logo = ({ t, size = 22 }) => <span className={styles.logo} style={{ width: size, height: size }}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>

// Your stored picks for a day (game picks, matchups, lineup), refreshed every minute while the day is live
export function useMyDay(day) {
  const C = useCollector()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setD(null); setErr(null)
    if (!C.me || C.down || !day) return
    let live = true
    C.predDay(day).then(x => live && setD(x)).catch(e => live && setErr(e.message))
    return () => { live = false }
  }, [day, !!C.me, C.down])
  // Today's (or last night's) picks refresh every minute while a game is on, only while the tab is visible
  const recent = day >= addDays(etToday(), -1) && day <= etToday()
  usePoll(() => C.predDay(day).then(setD).catch(() => {}), 60e3, recent && !!C.me && !C.down && gamesHot(C.preds?.slates || (d ? [d] : [])), [day])
  return { d, err }
}
const addDays = (day, k) => { const x = new Date(day + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10) }

// The scoreboard feed for a day (shared with the Games view: one fetch and one poll)
function useFeed(day) {
  const [feed, setFeed] = useState(null)
  useEffect(() => { setFeed(null); return watchDay(day, ({ data }) => data && setFeed(data), day === etToday()) }, [day])
  return feed
}

// A live game for a stored one, and a player's live Game Score in it (undefined: not in the box score yet)
function liveIndex(feed) {
  const byId = new Map(), byTeams = new Map()
  for (const g of feed?.games || []) { byId.set(String(g.id), g); byTeams.set(`${g.away}@${g.home}`, g) }
  const find = g => byId.get(String(g.id)) || byTeams.get(`${g.away}@${g.home}`) || null
  const gsOf = (lg, team, name) => {
    const rows = lg?.box?.[team]
    if (!rows) return undefined
    const r = rows.find(p => norm(p.name) === norm(name))
    return r ? gmsc(r) : undefined
  }
  return { find, gsOf }
}

const stateOf = (g, lg) => (lg?.state === 'post' || g.state === 'post' ? 'post' : lg?.state === 'in' || g.state === 'in' ? 'in' : 'pre')
const statusText = (g, lg) => {
  const st = stateOf(g, lg)
  return st === 'post' ? `Final${lg?.ot ? `/${lg.ot}` : ''}` : st === 'in' ? (lg?.detail || 'In progress') : tipTime(g.tip)
}

export default function MyPredictions({ day, ratings }) {
  const C = useCollector()
  const { d, err } = useMyDay(day)
  const feed = useFeed(day)
  const L = useMemo(() => liveIndex(feed), [feed])
  // The Player of the Day race while games are on: every player's Game Score + Elo gained ÷ 6, scored from the live
  // feed with the current ratings (as the Scoreboard does), best first
  const race = useMemo(() => {
    if (!ratings) return null
    const sy = +day.slice(0, 4) - (+day.slice(5, 7) < 8 ? 1 : 0)
    return (feed?.games || []).filter(g => g.state !== 'pre' && g.box).map(g => scoreGame(g, ratings, day, winChance, sy)).filter(Boolean)
      .flatMap(g => g.players.filter(p => !p.unrated && p.gs != null && (p.mp || 0) > 0).map(p => ({ name: p.n, team: p.t, gs: p.gs, score: Math.round((p.gs + (p.post - p.pre) / 6) * 10) / 10 })))
      .sort((a, b) => b.score - a.score)
  }, [feed, ratings, day])

  if (C.down) return <div className={styles.empty}>Predictions are offline right now.</div>
  if (C.me === undefined) return <div className={styles.empty}>Loading…</div>
  if (!C.me) return (
    <div className={styles.empty}>
      <b>Sign in to see your predictions</b>
      <span>Pick every game’s winner, each game’s top player matchup and a five-player lineup from your binder.</span>
      <button type="button" className={styles.cta} onClick={() => C.openAuth('signup')}>Create an account</button>
    </div>
  )
  if (err) return <div className={styles.empty}>{err}</div>
  if (!d) return <div className={styles.empty}>Loading your picks…</div>

  // ── Games ──
  const games = d.games.map(g => {
    const lg = L.find(g), st = stateOf(g, lg)
    const hs = lg?.hs ?? g.hs, as = lg?.as ?? g.as
    const mine = g.pick
    let tone = 'none', line = mine ? '' : 'No pick'
    if (mine) {
      const my = mine === g.home ? hs : as, op = mine === g.home ? as : hs
      if (g.result === 'win' || (st === 'post' && !g.result && my > op)) { tone = 'win'; line = g.result ? 'Won' : 'Won · grading' }
      else if (g.result === 'loss' || (st === 'post' && !g.result && my < op)) { tone = 'loss'; line = g.result ? 'Lost' : 'Lost · grading' }
      else if (g.result === 'void') { tone = 'none'; line = 'Void' }
      else if (st === 'in') { const m = (my ?? 0) - (op ?? 0); tone = m > 0 ? 'up' : m < 0 ? 'down' : 'even'; line = m > 0 ? `Leading by ${m}` : m < 0 ? `Trailing by ${-m}` : 'Tied' }
      else { tone = 'wait'; line = 'Not started' }
    }
    const chance = mine && g.pHome != null ? (mine === g.home ? g.pHome : 1 - g.pHome) : null
    return { g, lg, st, hs, as, tone, line, chance }
  })
  const gRight = games.filter(x => x.tone === 'win').length, gWrong = games.filter(x => x.tone === 'loss').length
  const gUp = games.filter(x => x.tone === 'up').length, gPicked = games.filter(x => x.g.pick).length

  // ── Matchups ──
  const matchups = d.matchups.map(m => {
    const g = d.games.find(x => x.id === m.id) || m
    const lg = L.find(g), st = stateOf(g, lg)
    const ag = m.ag ?? L.gsOf(lg, m.away, m.a) ?? null, bg = m.bg ?? L.gsOf(lg, m.home, m.b) ?? null
    let tone = 'none', line = m.pick ? '' : 'No pick'
    if (m.void) { tone = 'none'; line = `Void · ${(m.out || []).map(baseName).join(' and ')} ruled out` }
    else if (m.pick) {
      const mineA = m.pick === m.a
      const my = mineA ? ag : bg, op = mineA ? bg : ag
      if (m.result === 'win') { tone = 'win'; line = 'Won' }
      else if (m.result === 'loss') { tone = 'loss'; line = 'Lost' }
      else if (m.result === 'void' || m.void) { tone = 'none'; line = m.void ? `Void · ${(m.out || []).map(baseName).join(' and ')} ruled out` : 'Void · a player sat or they tied' }
      else if (st === 'pre') { tone = 'wait'; line = 'Not started' }
      else if (my == null || op == null) { tone = 'even'; line = st === 'post' ? 'Grading…' : 'In progress' }
      else { const x = my - op; tone = x > 0 ? (st === 'post' ? 'win' : 'up') : x < 0 ? (st === 'post' ? 'loss' : 'down') : 'even'; line = `${x > 0 ? 'Ahead' : x < 0 ? 'Behind' : 'Even'}${x ? ` by ${f1(Math.abs(x))}` : ''}${st === 'post' ? ' · grading' : ''}` }
    }
    return { m, st, ag, bg, tone, line, lg }
  })
  const mRight = matchups.filter(x => x.tone === 'win').length, mPicked = matchups.filter(x => x.m.pick).length

  // ── Lineup ──
  const slots = d.lineup.slots.map(s => {
    const g = d.games.find(x => x.home === s.team || x.away === s.team)
    const lg = g ? L.find(g) : null, st = g ? stateOf(g, lg) : 'post'
    const live = s.gs ?? L.gsOf(lg, s.team, s.player)
    const gs = live === undefined ? null : live
    const pts = gs == null ? null : Math.round(lineupPts(gs, s.mult || 1) * 10) / 10
    return { s, g, lg, st, gs, pts }
  })
  const lTotal = slots.reduce((a, x) => a + (x.pts || 0), 0)

  // ── Player of the Day ──
  // While games are on: your nominee's Game Score, and the night's Game Score leader so far (the Player of the Day
  // also counts Elo gained, so the leader is a guide until the day's cards decide it)
  const P = d.potd || {}
  const liveRows = (feed?.games || []).filter(g => g.state !== 'pre').flatMap(g => Object.entries(g.box || {}).flatMap(([t, rows]) => rows.map(r => ({ name: r.name, team: t, gs: gmsc(r) }))))
  const leader = race?.[0] || liveRows.sort((a, b) => b.gs - a.gs)[0] || null
  const nomGs = P.pick ? (liveRows.find(r => norm(r.name) === norm(P.pick.player))?.gs ?? null) : null
  // Your call's place in the race: final from the day's cards, live from the feed until then
  const nomAt = P.pick && race ? race.findIndex(r => norm(r.name) === norm(P.pick.player)) : -1
  const nom = P.pick?.rank ? { rank: P.pick.rank, score: P.pick.score, of: P.pick.of } : nomAt >= 0 ? { rank: nomAt + 1, score: race[nomAt].score, of: race.length, live: true } : null
  const anyStarted = d.games.some(g => stateOf(g, L.find(g)) !== 'pre')
  const pTone = P.pick?.result === 'win' ? 'win' : P.pick?.result === 'loss' ? 'loss' : !P.pick ? 'none' : !anyStarted ? 'wait' : leader && norm(leader.name) === norm(P.pick.player) ? 'up' : 'even'
  const nothing = !gPicked && !mPicked && !slots.length && !P.pick
  const isFuture = day > etToday()
  return (
    <div className={styles.wrap}>
      <div className={styles.summary}>
        <div><small>Games</small><b>{gRight}–{gWrong}</b><span>{gPicked} of {games.length} picked{gUp ? ` · ${gUp} leading` : ''}</span></div>
        <div><small>Matchups</small><b>{mRight} right</b><span>{mPicked} of {matchups.length} picked</span></div>
        <div><small>PotD</small><b>{P.pick ? shortName(P.pick.player) : '—'}</b><span>{P.pick?.result === 'win' ? 'Called it' : P.pick?.result === 'loss' ? 'Missed' : P.pick ? (nomGs != null ? `${f1(nomGs)} GmSc so far` : 'Not started') : 'No pick'}</span></div>
        <div><small>Lineup</small><b>{d.lineup.graded ? d.lineup.graded.total : lTotal.toFixed(1)} <i>pts</i></b><span>{d.lineup.graded ? `+${d.lineup.graded.coins} Coins` : slots.some(x => x.st === 'in') ? 'live' : `${slots.length} of 5 set`}</span></div>
        {(day >= etToday() || day === addDays(etToday(), -1)) && <button type="button" className={styles.cta} onClick={() => C.openPredict()}>{day >= etToday() && d.games.some(g => g.state === 'pre') ? 'Make or change picks' : 'Open Predictions'}</button>}
      </div>
      {feed?.fetched && <p className={styles.note}>Live scores updated {new Date(feed.fetched).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</p>}

      {nothing && <div className={styles.empty}><b>No picks {isFuture ? 'yet' : ''} for this day</b><span>{d.games.length ? (isFuture || day === etToday() ? 'Pick winners, matchups and a lineup before each game tips off.' : 'You didn’t play this day.') : 'No games this day.'}</span></div>}

      {d.games.length > 0 && <section className={styles.sec}>
        <h3>Games <span>{gPicked} picked</span></h3>
        <div className={styles.list}>
          {games.map(({ g, lg, st, hs, as, tone, line, chance }) => (
            <div key={g.id} className={styles.row} data-tone={tone}>
              <span className={styles.teams}>
                <span className={st === 'post' && g.winner === g.away ? styles.won : ''}><Logo t={g.away} />{g.away}{st !== 'pre' && <b>{as}</b>}</span>
                <span className={st === 'post' && g.winner === g.home ? styles.won : ''}><Logo t={g.home} />{g.home}{st !== 'pre' && <b>{hs}</b>}</span>
              </span>
              <span className={styles.mid}>
                <small className={st === 'in' ? styles.liveTxt : ''}>{st === 'in' && <i className={styles.dot} />}{statusText(g, lg)}</small>
                {g.pick ? <span>Your pick <b style={{ color: binderTeamInfo(g.pick)?.color }}>{g.pick}</b>{g.lock && <em className={styles.lock}>★ Lock</em>}{chance != null && <small> · {Math.round(chance * 100)}% forecast</small>}</span> : <span className={styles.muted}>No pick</span>}
                <Crowd c={g.crowd} a={g.away} b={g.home} la={g.away} lb={g.home} />
              </span>
              <span className={styles.res}>{g.pick && line}</span>
            </div>
          ))}
        </div>
      </section>}

      {matchups.length > 0 && <section className={styles.sec}>
        <h3>Matchups <span>higher Game Score wins</span></h3>
        <div className={styles.list}>
          {matchups.map(({ m, st, ag, bg, tone, line, lg }) => (
            <div key={m.id} className={styles.row} data-tone={tone}>
              <span className={styles.teams}>
                <span className={m.pick === m.a ? styles.picked : ''}><Logo t={m.away} />{shortName(m.a)}{st !== 'pre' && <b>{f1(ag)}</b>}</span>
                <span className={m.pick === m.b ? styles.picked : ''}><Logo t={m.home} />{shortName(m.b)}{st !== 'pre' && <b>{f1(bg)}</b>}</span>
              </span>
              <span className={styles.mid}>
                <small className={st === 'in' ? styles.liveTxt : ''}>{st === 'in' && <i className={styles.dot} />}{statusText(d.games.find(x => x.id === m.id) || m, lg)} · {m.away} at {m.home}</small>
                {m.pick ? <span>Your pick <b>{shortName(m.pick)}</b></span> : <span className={styles.muted}>No pick</span>}
                <Crowd c={m.crowd} a={m.a} b={m.b} la={shortName(m.a)} lb={shortName(m.b)} />
              </span>
              <span className={styles.res}>{(m.pick || m.void) && line}</span>
            </div>
          ))}
        </div>
      </section>}

      {(P.pick || P.winner || leader) && d.games.length > 0 && <section className={styles.sec}>
        <h3>Player of the Day <span>Game Score + Elo gained ÷ 6</span></h3>
        <div className={styles.list}>
          <div className={styles.row} data-tone={pTone}>
            <span className={styles.teams}>{P.pick ? <span><Logo t={P.pick.team} />{baseName(P.pick.player)}{nom ? <b title="PotD score: Game Score + Elo gained ÷ 6">No. {nom.rank} · {f1(nom.score)}</b> : nomGs != null && <b>{f1(nomGs)}</b>}</span> : <span className={styles.muted}>No pick</span>}</span>
            <span className={styles.mid}>
              <small>{P.winner ? 'Final' : anyStarted ? 'In progress' : P.lock ? `Picks lock at ${tipTime(P.lock)}` : ''}</small>
              <span>{P.winner ? <>Player of the Day <b>{baseName(P.winner.name)}</b><small> · {P.winner.score != null ? `${f1(P.winner.score)} PotD score · ` : ''}{f1(P.winner.gs)} GmSc</small></>
                : leader ? <>{leader.score != null ? 'PotD leader' : 'Game Score leader'} <b>{shortName(leader.name)}</b><small> · {f1(leader.score ?? leader.gs)}</small></> : 'Not started'}</span>
            </span>
            <span className={styles.res}>{P.pick?.result === 'win' ? 'Called it · ruby card' : P.pick?.result === 'loss' ? 'Missed' : P.pick ? (P.winner ? 'Grading…' : anyStarted ? (pTone === 'up' ? 'Leading' : 'In progress') : 'Not started') : ''}</span>
          </div>
        </div>
      </section>}

      {slots.length > 0 && <section className={styles.sec}>
        <h3>Lineup <span>Game Score × card multiplier · +{d.rates?.lineupPotd ?? 10} with the Player of the Day</span></h3>
        <div className={styles.list}>
          {slots.map(({ s, g, lg, st, gs, pts }) => (
            <div key={s.slot} className={styles.row} data-tone={pts == null ? 'wait' : pts > 0 ? 'up' : 'down'}>
              <span className={styles.teams}><span><Logo t={s.team} />{baseName(s.player)}</span></span>
              <span className={styles.mid}>
                <small className={st === 'in' ? styles.liveTxt : ''}>{st === 'in' && <i className={styles.dot} />}{g ? `${statusText(g, lg)} · ${g.away} at ${g.home}` : 'No game'}</small>
                <span>{TIER_NAME[s.tier] || s.tier} card <b>×{+(s.mult || 1).toFixed(2)}</b>{gs != null && <small> · {f1(gs)} GmSc</small>}</span>
              </span>
              <span className={styles.res}>{pts != null ? <><b>{pts.toFixed(1)}</b> pts</> : st === 'pre' ? 'Not started' : st === 'post' ? 'Didn’t play' : '—'}</span>
            </div>
          ))}
          <div className={styles.total}><span>{d.lineup.graded ? 'Final' : slots.some(x => x.st === 'in') ? 'Live total' : 'Total'}</span><b>{d.lineup.graded ? d.lineup.graded.total : lTotal.toFixed(1)} pts</b></div>
        </div>
      </section>}

      {d.crowd?.potd?.length > 0 && <section className={styles.sec}>
        <h3>Everyone’s Player of the Day calls <span>{d.crowd.potd.reduce((a, x) => a + x.n, 0)} calls</span></h3>
        <div className={styles.crowdList}>
          {d.crowd.potd.map(x => {
            const tot = d.crowd.potd.reduce((a, y) => a + y.n, 0)
            const won = P.winner && norm(P.winner.name) === norm(x.player)
            return <div key={x.player + x.team} className={styles.crowdRow} data-won={won ? '' : undefined} data-you={P.pick && norm(P.pick.player) === norm(x.player) ? '' : undefined}>
              <Logo t={x.team} /><b>{baseName(x.player)}</b>
              <span className={styles.crowdBar}><em style={{ width: `${(x.n / tot) * 100}%` }} /></span>
              <small>{x.n} · {Math.round((x.n / tot) * 100)}%{won ? ' · ✓ Player of the Day' : ''}</small>
            </div>
          })}
        </div>
      </section>}

      {d.crowd?.lineups?.length > 0 && <section className={styles.sec}>
        <h3>Lineup leaderboard <span>{d.crowd.lineups.length} lineup{d.crowd.lineups.length === 1 ? '' : 's'} · players show once their game tips off</span></h3>
        <div className={styles.list}>
          {d.crowd.lineups.map(l => {
            // Final totals once graded; live, each shown slot's Game Score from the feed × its multiplier
            const live = l.slots.reduce((a, x) => { if (x.hidden) return a; const g = d.games.find(y => y.home === x.team || y.away === x.team); const gs = x.gs ?? (g ? L.gsOf(L.find(g), x.team, x.player) : null); return a + (gs == null ? 0 : lineupPts(gs, x.mult)) }, 0)
            return { ...l, score: l.total ?? Math.round(live * 10) / 10 }
          }).sort((a, b) => b.score - a.score).map((l, i) => (
            <div key={l.username} className={`${styles.lbRow} ${l.you ? styles.lbYou : ''}`}>
              <b className={styles.lbRank}>{i + 1}</b>
              <span className={styles.lbWho}><b>{l.username}{l.you ? ' (you)' : ''}</b>
                <small>{l.slots.map((x, k) => <span key={k} className={styles.lbSlot} data-tier={x.tier}>{x.hidden ? '•••' : shortName(x.player)}</span>)}</small></span>
              <strong>{l.score.toFixed(1)}<small>{l.total != null ? (l.potdBonus ? ` pts · +${l.potdBonus} PotD` : ' pts') : ' live'}</small></strong>
            </div>
          ))}
        </div>
      </section>}
    </div>
  )
}

// Everyone's split on a pick: each side's share
function Crowd({ c, a, b, la, lb }) {
  if (!c?.n) return null
  const pa = Math.round(((c.by[a] || 0) / c.n) * 100)
  return <span className={styles.crowd} title={`${c.n} pick${c.n === 1 ? '' : 's'}`}><i style={{ width: `${pa}%` }} /><small>{la} {pa}% · {lb} {100 - pa}% <em>of {c.n}</em></small></span>
}

// On the Games view: your lineup for the day, each player's Game Score as it happens
// d: useMyDay(day).d, from the page (it also marks the lineup in box scores)
export function LineupStrip({ d, games }) {
  const slots = d?.lineup?.slots || []
  if (!slots.length) return null
  // games: the scoreboard's scored games (live or final), players with Game Scores
  const find = s => {
    for (const g of games) { const p = g.players.find(x => norm(x.n) === norm(s.player)); if (p) return { g, p } }
    return null
  }
  let total = 0
  const rows = slots.map(s => {
    const hit = find(s)
    const gs = s.gs ?? hit?.p.gs ?? null
    const pts = gs == null ? null : Math.round(lineupPts(gs, s.mult || 1) * 10) / 10
    total += pts || 0
    const st = hit ? (hit.g.live?.state || 'post') : null
    return { s, gs, pts, st }
  })
  return (
    <div className={styles.strip}>
      <span className={styles.stripLab}>Your lineup<b>{(d.lineup.graded ? +d.lineup.graded.total : total).toFixed(1)} pts</b></span>
      <span className={styles.stripRow}>
        {rows.map(({ s, gs, pts, st }) => (
          <span key={s.slot} className={styles.chip} data-state={st || 'pre'} title={`${baseName(s.player)} · ${TIER_NAME[s.tier] || s.tier} ×${+(s.mult || 1).toFixed(2)}`}>
            <Logo t={s.team} size={18} />
            <span><b>{shortName(s.player)}</b><small>{gs != null ? `${f1(gs)} GmSc${(s.mult || 1) !== 1 ? ` · ${pts.toFixed(1)} pts` : ''}` : 'Not started'}</small></span>
            {st === 'in' && <i className={styles.dot} />}
          </span>
        ))}
      </span>
    </div>
  )
}
