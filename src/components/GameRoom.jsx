import { useState, useEffect, useMemo } from 'react'
import styles from './GameRoom.module.css'
import bs from './Binders.module.css'
import { Fit, useIsPhone } from './Binders'
import { MiniCard } from './PlayerCard'
import { useCollector, Coin } from './Collector'
import { BinderHost, primeBinders, binderJSON, binderHeadshots, binderTeamInfo, binderLogo, binderNewest, binderLoadSeason, binderWithTeams, binderCardGameInfo } from './SeasonExplorer'
import { norm } from './predict'
import { PredictPages } from './Predictions'
import KingOfTheCourt from './KingOfTheCourt'
import HangBanner from './HangBanner'
import FiveChallenge from './FiveChallenge'
import PlayerOfWeek from './PlayerOfWeek'
import { FaceFit } from './TrophyRoom'
import { usePoll, gamesHot } from './poll'
import { goTo, hrefFor } from '../nav.js'
import { Explain } from './Explainer'

/*
 * The Game Room: every game on the site, out of the binder and into an arcade. A chalkboard over the room holds
 * tonight's picks, an LED board the week's pick'em leaders, and the stations around the walls each open their game full
 * screen over the room:
 *   chalkboard      Pick'em Night: winners on a bar-trivia handout, each game with its Floor Times preview clipping
 *   fight poster    Player matchups as the tale of the tape
 *   magnet board    The daily lineup
 *   tote board      Player of the Day, with your betting ticket
 *   cabinets        King of the Court (1-player groups, 2-player rivalries), Hang the Banner, Five Challenge (Pop-A-Shot)
 *   LED board       Pick'em standings · prize counter: prediction history and prize cards · champions' wall: Player of the Week
 * The room's address names the open station (/?view=gameroom&open=matchups), so any station can be linked to.
 */

const STATIONS = {
  predict: { tab: 'games', title: 'Pick’em Night', kicker: 'The chalkboard · winners' },
  matchups: { tab: 'matchups', title: 'Tale of the Tape', kicker: 'Player matchups' },
  lineup: { tab: 'lineup', title: 'Daily Lineup', kicker: 'The magnet board' },
  potd: { tab: 'potd', title: 'Player of the Day', kicker: 'The tote board' },
  standings: { tab: 'standings', title: 'High Scores', kicker: 'Pick’em standings' },
  history: { tab: 'history', title: 'Prize Counter', kicker: 'Prediction history and prize cards' },
  koc: { title: 'King of the Court', kicker: '1-player · groups' },
  rivals: { title: 'King of the Court', kicker: '2-player · rivalries' },
  banner: { title: 'Hang the Banner', kicker: 'A ladder per franchise' },
  five: { title: 'Five Challenge', kicker: 'This week’s lineups' },
  potw: { title: 'Player of the Week', kicker: 'The champions’ wall' },
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Bungee&family=Caveat:wght@500;700&family=Permanent+Marker&family=Playfair+Display:wght@700;900&family=Special+Elite&family=VT323&display=swap'
function useFonts() {
  useEffect(() => {
    if (document.getElementById('gr-fonts')) return
    const l = document.createElement('link'); l.id = 'gr-fonts'; l.rel = 'stylesheet'; l.href = FONTS
    document.head.appendChild(l)
  }, [])
}

const stationFromUrl = () => { const o = new URLSearchParams(window.location.search).get('open'); return o && STATIONS[o] ? o : null }
const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const fmtDay = (d, o = { weekday: 'long', month: 'long', day: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)
const tipTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`)
const n0 = v => Math.round(v || 0).toLocaleString()
const baseName = n => String(n || '').replace(/\s*\(.*\)$/, '')
const lastName = n => { const w = baseName(n).split(' '); return w.length > 1 ? w.slice(1).join(' ') : w[0] }
const shortName = n => { const [f, ...r] = baseName(n).split(' '); return r.length ? `${f[0]}. ${r.join(' ')}` : f }
const teamName = t => binderTeamInfo(t)?.name || t
const nick = t => { const n = teamName(t); return /Trail Blazers$/.test(n) ? 'Trail Blazers' : n.split(' ').pop() }
const statusOf = g => (g.state === 'pre' ? (g.open ? tipTime(g.tip) : 'Tipping off') : g.state === 'post' ? 'Final' : g.detail ? `Live · ${g.detail}` : 'Live')
const Logo = ({ t, size = 22 }) => <span className={styles.logo} style={{ width: size, height: size }}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>

// ── The stations, full screen ──────────────────────────────────────────────────────────────────────────────────────

// Each player's most recent game card (this season, else last season): the photo in a preview or on a fight poster
function useLastCards(env, names) {
  const [map, setMap] = useState({})
  const key = [...new Set(names)].sort().join('|')
  useEffect(() => {
    if (!key) return
    let live = true
    const want = key.split('|')
    const newest = binderNewest()
    const prevOf = s => `${+s.slice(0, 4) - 1}-${s.slice(2, 4)}`
    const find = (sd, out, list) => {
      const left = new Set(list)
      for (let i = sd.games.length - 1; i >= 0 && left.size; i--) {
        const g = sd.games[i]
        for (const p of g.players) if (left.has(p.n) && p.mp > 0 && (!out[p.n] || out[p.n].g.date < g.date)) { out[p.n] = { g, row: p, sd }; left.delete(p.n) }
      }
      return [...left]
    }
    env.loadSeason(newest).then(async sd => {
      const out = {}
      const miss = find(sd, out, want)
      if (miss.length) { try { find(await env.loadSeason(prevOf(newest)), out, miss) } catch {} }
      // This season's Elo change: from his first game of the newest season to his latest
      const first = {}
      for (const g of sd.games) for (const p of g.players) if (out[p.n]?.sd === sd && !(p.n in first) && p.pre != null) first[p.n] = p.pre
      for (const n of Object.keys(out)) if (n in first) out[n] = { ...out[n], start: first[n], season: sd.season || newest }
      if (live) setMap(out)
    }).catch(() => {})
    return () => { live = false }
  }, [key])
  return map
}

function LastCard({ name, x, env, big }) {
  const blank = <span className={styles.photoBlank}>{baseName(name).split(' ').map(w => w[0]).join('').slice(0, 3)}</span>
  if (!x) return <span className={styles.photoCard} data-big={big ? '' : undefined}>{blank}</span>
  const { info, team } = env.withTeams(x.sd, () => ({ info: env.cardGameInfo(x.g, x.row.t, x.sd, x.row), team: env.teamInfo(x.row.t) }))
  return <span className={styles.photoCard} data-big={big ? '' : undefined}><Fit label={`${baseName(name)}’s last game card`}><MiniCard name={x.row.n} row={x.row} game={info} team={team} headshot={env.headshot(x.row.n)} /></Fit></span>
}
const lastLine = x => (x ? `Last game, ${fmtDay(x.g.date, { month: 'short', day: 'numeric' })}: ${x.row.pts} pts, ${x.row.trb} reb, ${x.row.ast} ast, ${(+x.row.gs).toFixed(1)} Game Score` : 'No recent game on record')


// ── The injury report (ESPN's, through /api/schedule?only=injuries: refreshed every few minutes) ──
// ESPN marks a player Out or Day-To-Day; the finer status (questionable, doubtful, probable) is in its note
let injCache = null, injAt = 0
const INJ_MS = 5 * 60e3
function useInjuries() {
  const [inj, setInj] = useState(injCache)
  useEffect(() => {
    let live = true
    const load = () => {
      if (injCache && Date.now() - injAt < INJ_MS) { setInj(injCache); return }
      fetch('/api/schedule?only=injuries').then(r => (r.ok ? r.json() : null)).then(d => { if (d?.injuries && live) { injCache = d.injuries; injAt = Date.now(); setInj(d.injuries) } }).catch(() => {})
    }
    load()
    const t = setInterval(load, INJ_MS)
    return () => { live = false; clearInterval(t) }
  }, [])
  return inj
}
const normName = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const INJ_ORDER = { Out: 0, Doubtful: 1, Questionable: 2, 'Day-to-day': 3, Probable: 4 }
const INJ_TAG = { Out: 'Out', Doubtful: 'Doubt', Questionable: 'Q', 'Day-to-day': 'GTD', Probable: 'Prob' }
function injStatus(i) {
  const t = `${i.detail || ''}`.toLowerCase()
  if (/\bprobable\b/.test(t)) return 'Probable'
  if (/\bdoubtful\b/.test(t)) return 'Doubtful'
  if (/\bquestionable\b/.test(t)) return 'Questionable'
  if (/^out$/i.test(i.status || '') || /ruled out|will not play|won't play|is out\b/.test(t)) return 'Out'
  return 'Day-to-day'
}
// A team's report as the notes print it: game-time decisions always; Out only for players who matter (1,800+ Elo),
// so two-way and season-long names don't crowd the column
let ELO = null // player name (normalized) → current Elo, set by the Game Room from the ratings
function teamReport(inj, team) {
  return (inj?.[team] || []).map(i => ({ ...i, st: injStatus(i), elo: ELO?.get(normName(i.name)) ?? null }))
    .filter(i => i.st !== 'Out' || (i.elo ?? 0) >= 1800)
    .sort((a, b) => INJ_ORDER[a.st] - INJ_ORDER[b.st] || (b.elo ?? 0) - (a.elo ?? 0))
}
const injPart = i => (i.part || '').toLowerCase()
const retShort = d => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')
function InjuryNotes({ inj, g }) {
  if (!inj) return null
  const side = t => {
    const L = teamReport(inj, t)
    return <div key={t}>
      <h6>{teamName(t)}</h6>
      {L.length ? L.slice(0, 6).map(i => <p key={i.name}><span className={styles.injTag} data-s={i.st}>{INJ_TAG[i.st]}</span><b>{lastName(i.name)}</b>
        {injPart(i) ? ` (${injPart(i)})` : ''}{i.st === 'Out' && i.ret ? `, back ~${retShort(i.ret)}` : ''}.</p>)
        : <p className={styles.injClean}>A clean bill of health.</p>}
      {L.length > 6 && <p className={styles.injClean}>and {L.length - 6} more</p>}
    </div>
  }
  return <aside className={styles.injNotes} aria-label="Injury notes"><h5>Injury Notes</h5>{side(g.away)}{side(g.home)}</aside>
}
// A featured player who landed on the report after his matchup was set (anything but Probable)
const lateAdd = (inj, name, team) => { const i = (inj?.[team] || []).find(x => normName(x.name) === normName(name)); const st = i && injStatus(i); return st && st !== 'Probable' ? st : null }

// The Floor Times: a newspaper preview of one game, its featured matchup's last cards printed in it.
// With onDuel, the two photos are the matchup pick: tap the player you think posts the higher Game Score
function Clipping({ g, env, last, day, onDuel, busyDuel, inj }) {
  const d = g.duel || g.line?.duel
  const pH = g.line?.pHome
  const fav = pH == null ? null : pH >= 0.5 ? g.home : g.away, dog = fav && (fav === g.home ? g.away : g.home)
  const favP = pH == null ? null : Math.max(pH, 1 - pH)
  const head = g.state === 'post' && g.winner ? `${nick(g.winner)} win, ${Math.max(g.hs, g.as)}–${Math.min(g.hs, g.as)}`
    : g.state === 'in' ? `Under way: ${nick(g.away)} ${g.as ?? 0}, ${nick(g.home)} ${g.hs ?? 0}`
    : !fav ? `${nick(g.away)} visit the ${nick(g.home)}`
    : favP >= 0.7 ? `${nick(fav)} heavy favorites over ${nick(dog)}` : favP >= 0.56 ? `${nick(fav)} favored against ${nick(dog)}` : `Toss-up: ${nick(g.away)} at ${nick(g.home)}`
  const bonus = dog && g.upset?.[dog]
  const late = d && !d.void && g.state === 'pre' ? [[d.a, g.away], [d.b, g.home]].map(([n, t]) => [n, lateAdd(inj, n, t)]).filter(x => x[1]) : []
  return (
    <article className={styles.clip}>
      <div className={styles.mast}><b>The Floor Times</b><span>{fmtDay(day, { weekday: 'short', month: 'short', day: 'numeric' })} · {statusOf(g)}</span></div>
      <h4>{head}</h4>
      <div className={styles.clipBody}>
      <p className={styles.dek}>{fav ? <>The Elo forecast gives the {teamName(fav)} a {pct(favP)} chance{bonus > 0 ? <>; calling the {nick(dog)} pays an upset bonus of {bonus} Coins</> : ''}.</> : <>{teamName(g.away)} at {teamName(g.home)}.</>}
        {g.crowd ? <> {pct(Math.max(g.crowd.home, 1 - g.crowd.home))} of collectors in the room are on the {nick(g.crowd.home >= 0.5 ? g.home : g.away)}.</> : ''}</p>
      {d && <div className={styles.photos}>
        {[[d.a, d.ae, g.away], [d.b, d.be, g.home]].map(([n, e, t]) => {
          const pickable = onDuel && g.duel && !d.void
          const mine = g.duel?.pick === n
          const inner = <>
            <LastCard name={n} x={last[n]} env={env} />
            {late.some(x => x[0] === n) && <i className={styles.injStamp}>{late.find(x => x[0] === n)[1] === 'Day-to-day' ? 'Day-to-day' : late.find(x => x[0] === n)[1]}</i>}
            {mine && <i className={styles.photoStamp} data-r={d.result || undefined}>{d.result === 'win' ? '✓ Called it' : d.result === 'loss' ? '✗ Beaten' : 'Your pick'}</i>}
            <figcaption><b>{baseName(n)}</b> <span>{nick(t)} · {n0(e)} Elo</span><span>{lastLine(last[n])}</span></figcaption>
          </>
          return pickable
            ? <button key={n} type="button" className={styles.photoPick} data-mine={mine ? '' : undefined} disabled={!g.open || busyDuel} aria-pressed={mine}
              onClick={() => onDuel(g, n)} aria-label={`Matchup pick: ${baseName(n)} posts the higher Game Score`}><figure>{inner}</figure></button>
            : <figure key={n}>{inner}</figure>
        })}
      </div>}
      {d && <p className={styles.dek}>Featured matchup: {baseName(d.a)} against {baseName(d.b)}{d.ae && d.be ? `, ${n0(Math.abs(d.ae - d.be))} Elo apart` : ''}.
        {d.void ? ' Off: a player was ruled out.' : onDuel && g.duel && g.open ? (g.duel.pick ? ` You have ${baseName(g.duel.pick)} for the higher Game Score.` : ' Tap a photo to call the higher Game Score.') : ''}</p>}
      {late.length > 0 && <p className={styles.voidLine}>{late.map(([n, st]) => `${baseName(n)} is ${st === 'Day-to-day' ? 'day-to-day' : st.toLowerCase()}`).join(' and ')}, listed after this matchup was set. If {late.length > 1 ? 'either' : 'he'} doesn’t play, the matchup is void and won’t count.</p>}
      {g.state === 'pre' && <InjuryNotes inj={inj} g={g} />}</div>
    </article>
  )
}

// One question on the trivia handout: two answers, the one you picked circled in pen
const Circle = () => <svg className={styles.circle} viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M14,30 C10,10 120,2 186,16 C204,24 196,48 150,54 C100,60 30,58 12,40 C6,32 18,18 40,14" /></svg>
function Question({ g, i, env, busy, lockFixed, onPick, onLock }) {
  const opt = (team, letter) => {
    const info = env.teamInfo(team) || {}
    const home = team === g.home
    const chance = g.line?.pHome == null ? null : home ? g.line.pHome : 1 - g.line.pHome
    const mine = g.pick === team
    const score = home ? g.hs : g.as
    return (
      <button type="button" className={styles.opt} data-mine={mine ? '' : undefined} data-won={g.winner === team ? '' : undefined} disabled={!g.open || busy} onClick={() => onPick(g, team)}
        aria-pressed={mine} aria-label={`Pick ${info.name || team}`}>
        <i>{letter}</i>
        <Logo t={team} />
        <span className={styles.optName}>{info.name || team}<small>{home ? 'home' : 'away'}{chance != null ? ` · ${pct(chance)}` : ''}</small></span>
        {g.upset?.[team] > 0 && g.state === 'pre' && <em className={styles.bonus}>+{g.upset[team] * (mine && g.lock ? 2 : 1)} upset</em>}
        {score != null && <strong>{score}</strong>}
        {mine && <Circle />}
        {mine && g.result && <b className={styles.mark} data-r={g.result}>{g.result === 'win' ? '✓' : '✗'}</b>}
      </button>
    )
  }
  return (
    <div className={styles.qMain}>
      <div className={styles.qTop}><b>{i + 1}.</b><span>{nick(g.away)} at {nick(g.home)}</span><small>{statusOf(g)}</small></div>
      <div className={styles.opts}>{opt(g.away, 'A')}{opt(g.home, 'B')}</div>
      <div className={styles.qFoot}>
        {g.lock ? <button type="button" className={styles.lockInk} data-on="" disabled={!g.open || busy} onClick={() => onLock(g, false)} title={g.open ? 'Take the lock off' : 'Your Lock of the Day'}>★ my lock{g.result === 'win' ? ' · doubled' : ''}</button>
          : g.pick && g.open && !lockFixed ? <button type="button" className={styles.lockInk} disabled={busy} onClick={() => onLock(g, true)} title="Double Coins if right; costs the day’s pick Coins if wrong">☆ make it my lock</button> : null}
        {g.result === 'win' && g.bonus > 0 && <span className={styles.inkNote}>upset called · +{g.bonus * (g.lock ? 2 : 1)}</span>}
        {!g.open && !g.pick && g.state !== 'pre' && <span className={styles.inkNote}>no answer</span>}
      </div>
    </div>
  )
}

function Handout({ games, slate, env, busy, lockFixed, dayWord, need, onPick, onLock, onDuel }) {
  const C = env.collector
  const last = useLastCards(env, games.flatMap(g => { const d = g.duel || g.line?.duel; return d ? [d.a, d.b] : [] }))
  const inj = useInjuries()
  const picked = games.filter(g => g.pick).length, right = games.filter(g => g.result === 'win').length, graded = games.filter(g => g.result === 'win' || g.result === 'loss').length
  const night = dayWord === 'today' ? 'tonight' : dayWord
  return (
    <div className={styles.handout}>
      <header className={styles.hHead}>
        <span className={styles.hKick}>FPR Pick’em Night · Round 1</span>
        <h3>Who wins?</h3>
        <div className={styles.hBlanks}>
          <span>Team name <b className={styles.ink}>{C.me?.user.username}</b></span>
          <span>Date <b className={styles.ink}>{fmtDay(slate.day, { month: 'numeric', day: 'numeric' })}</b></span>
          <span>Score <b className={styles.ink}>{graded ? `${right} / ${graded}` : `${picked} / ${games.length}`}</b></span>
        </div>
        <div className={styles.hRules}><span>Circle a team in each game. Tap a player’s photo to call the featured matchup.</span>
          <Explain title="How Pick’em Night pays">
            <p>Circle one team per game, any time before it tips off. Get {need} of {games.length} right for a Legend-or-below card from {night}’s games; all {games.length} for any card.</p>
            <p>Star one answer as your lock: double Coins if right, the day’s pick Coins if wrong.</p>
            <p>Each clipping prints the game’s featured matchup. Tap the player you think posts the higher Game Score; it counts on the Tale of the Tape too.</p>
          </Explain></div>
      </header>
      <ol className={styles.qs}>
        {games.map((g, i) => (
          <li key={g.id} className={styles.q} data-lock={g.lock ? '' : undefined}>
            <Question g={g} i={i} env={env} busy={busy === g.id} lockFixed={lockFixed} onPick={onPick} onLock={onLock} />
            <Clipping g={g} env={env} last={last} day={slate.day} onDuel={onDuel} busyDuel={busy === `d${g.id}`} inj={inj} />
          </li>
        ))}
      </ol>
    </div>
  )
}

// Head-to-head duel records for each pair: { 'a|b': { w, l, t } } from a's rivals file (every game the two played on
// opposite sides, won by the higher Game Score), seasons summed
function useHeadToHead(env, pairs) {
  const [map, setMap] = useState({})
  const key = pairs.map(p => p.join('|')).sort().join('||')
  useEffect(() => {
    if (!key || !env.rivals) return
    let live = true
    Promise.all(pairs.map(async ([a, b]) => {
      const f = await env.rivals(a)
      const L = f?.o?.[b] || []
      let w = 0, l = 0, t = 0
      for (let i = 0; i + 5 < L.length + 1; i += 6) { w += L[i + 1] || 0; l += L[i + 2] || 0; t += L[i + 3] || 0 }
      return [`${a}|${b}`, { w, l, t }]
    })).then(rows => { if (live) setMap(Object.fromEntries(rows)) }).catch(() => {})
    return () => { live = false }
  }, [key])
  return map
}
const sgnN = v => (v > 0 ? `+${n0(v)}` : v < 0 ? `−${n0(-v)}` : '0')
const boxLine = r => (r ? `${r.pts} pts · ${r.trb} reb · ${r.ast} ast` : '—')
const shotLine = r => (r && r.fga != null ? `${r.fg}–${r.fga} FG${r.tpa ? ` · ${r.tp}–${r.tpa} 3P` : ''}${r.stl || r.blk ? ` · ${r.stl || 0} stl · ${r.blk || 0} blk` : ''}` : '')

// Player matchups: one fight poster per game, the tale of the tape under the two corners
function Poster({ g, env, last, h2h, busy, onPick }) {
  const d = g.duel
  const corner = (name, team, side) => {
    const mine = d.pick === name, out = d.void && (d.out || []).includes(name)
    return (
      <button type="button" className={styles.corner} data-side={side} data-mine={mine ? '' : undefined} data-out={out ? '' : undefined} style={{ '--c': binderTeamInfo(team)?.color || '#173657' }}
        disabled={!g.open || busy || !!d.void} onClick={() => onPick(g, name)} aria-pressed={mine} aria-label={`Pick ${baseName(name)}`}>
        <LastCard name={name} x={last[name]} env={env} big />
        <b className={styles.fName}>{lastName(name)}</b>
        <small>{nick(team)}</small>
        {mine && <i className={styles.stamp} data-r={d.result || undefined}>{d.result === 'win' ? 'Winner' : d.result === 'loss' ? 'Beaten' : 'Your corner'}</i>}
      </button>
    )
  }
  const xa = last[d.a], xb = last[d.b], la = xa?.row, lb = xb?.row
  const cur = (x, e) => (x?.row?.post != null ? x.row.post : e)
  const season = xa?.season || xb?.season
  const delta = x => (x?.start != null && x.row?.post != null ? sgnN(Math.round(x.row.post - x.start)) : '—')
  const hh = h2h[`${d.a}|${d.b}`]
  const rows = [
    ['Elo', n0(cur(xa, d.ae)), n0(cur(xb, d.be))],
    [season ? `${season} Elo` : 'This season', delta(xa), delta(xb)],
    ['Last game', la ? `${(+la.gs).toFixed(1)} GmSc` : '—', lb ? `${(+lb.gs).toFixed(1)} GmSc` : '—'],
    ['Box score', <>{boxLine(la)}{shotLine(la) && <small>{shotLine(la)}</small>}</>, <>{boxLine(lb)}{shotLine(lb) && <small>{shotLine(lb)}</small>}</>],
    ['Head-to-head', hh ? hh.w : '…', hh ? hh.l : '…'],
  ]
  const hhNote = hh && (hh.w + hh.l + hh.t ? `${hh.w + hh.l + hh.t} career duels${hh.t ? `, ${hh.t} tied` : ''} · higher Game Score wins` : 'First meeting')
  const foot = d.void ? `Bout off · ${(d.out || []).map(baseName).join(' and ') || 'a player'} ruled out` : d.result === 'void' ? 'No contest (a player sat)'
    : d.result ? (d.result === 'win' ? 'Called it · +10 Coins' : 'Missed') : g.state === 'post' ? 'Judges’ cards are in: grading…' : !g.open ? 'In progress' : 'Pick the higher Game Score'
  return (
    <article className={styles.poster} data-void={d.void ? '' : undefined}>
      <header><small>{statusOf(g)} · {g.away} at {g.home}</small><b>Tonight</b></header>
      <div className={styles.bout}>{corner(d.a, g.away, 'a')}<span className={styles.vs}>VS</span>{corner(d.b, g.home, 'b')}</div>
      <table className={styles.tot}><tbody>{rows.map(r => <tr key={r[0]}><td>{r[1]}</td><th>{r[0]}</th><td>{r[2]}</td></tr>)}</tbody></table>
      {hhNote && <p className={styles.hhNote}>{hhNote}</p>}
      <footer>{foot}</footer>
    </article>
  )
}
function TaleOfTape({ games, env, busy, need, voided, onPick, dayWord }) {
  const last = useLastCards(env, games.flatMap(g => [g.duel.a, g.duel.b]))
  const h2h = useHeadToHead(env, games.map(g => [g.duel.a, g.duel.b]))
  const live = games.filter(g => !g.duel.void)
  const picked = live.filter(g => g.duel.pick).length, right = live.filter(g => g.duel.result === 'win').length
  return (
    <div className={styles.tape}>
      <div className={styles.tapeLede}><span><b>{picked} of {live.length} picked{right ? ` · ${right} right` : ''}</b> Who posts the higher Game Score {dayWord}?{voided ? ` ${voided} bout${voided === 1 ? ' is' : 's are'} off.` : ''}</span>
        <Explain title="Tale of the Tape" tone="light">
          <p>Each game has a featured matchup: one player from each side, drawn at random from those rated 2,000 or more who aren’t on the injury report, so some bouts are lopsided and the underdog can be worth calling.</p>
          <p>Pick who posts the higher Game Score. Get {need} right for a Rare or Common from the day; all {live.length} for the Duel of the Day card. Each correct call pays 10 Coins.</p>
          <p>If a player is ruled out before tipoff or doesn’t play, the bout is off and doesn’t count. Head-to-head is every game the two have played against each other: the higher Game Score wins the duel.</p>
        </Explain></div>
      <div className={styles.posters}>{games.map(g => <Poster key={g.id} g={g} env={env} last={last} h2h={h2h} busy={busy === `d${g.id}`} onPick={onPick} />)}</div>
    </div>
  )
}

export function GameScreen({ station, env, onClose, ratings, onSelectPlayer }) {
  const phone = useIsPhone()
  const C = env.collector
  const st = STATIONS[station] || STATIONS.predict
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])
  let body
  if (st.tab) body = (
    <PredictPages env={env} phone={phone} arcade initialTab={st.tab} renderGames={p => <Handout {...p} />} renderMatchups={p => <TaleOfTape {...p} />}>
      {p => <div className={styles.predGrid} data-tab={p.tab}>
        <div className={`${bs.arcade} ${styles.predMain}`}>{p.right}</div>
        <aside className={styles.scorecard}><div className={styles.scoreHead}><b>Your scorecard</b>{p.summary}</div>{p.left}</aside>
      </div>}
    </PredictPages>
  )
  else if (station === 'potw') body = <div className={styles.potwWall}><PlayerOfWeek day={etToday()} ratings={ratings} onSelect={n => { onClose(); onSelectPlayer?.(n) }} /></div>
  else body = (
    <div className={styles.cabinet} data-game={station}>
      <div className={styles.bezel}>
        <div className={`${bs.arcade} ${styles.cabScreen}`}>
          {station === 'banner' ? <HangBanner env={env} tools={null} /> : station === 'five' ? <FiveChallenge env={env} tools={null} />
            : <KingOfTheCourt env={env} tools={null} initialTab={station === 'rivals' ? 'rivals' : 'group'} />}
        </div>
      </div>
    </div>
  )
  return (
    <div className={styles.screen} data-station={station} role="dialog" aria-modal="true" aria-label={st.title}>
      <header className={styles.marquee}>
        <button type="button" className={styles.back} onClick={onClose} aria-label="Back to the Game Room">← <span>Game Room</span></button>
        <div className={styles.mTitle}><small>{st.kicker}</small><b>{st.title}</b></div>
        {C.me && <span className={styles.token}><Coin size={14} />{(C.me.coins?.balance ?? 0).toLocaleString()}</span>}
      </header>
      <div className={styles.stage}>{body}</div>
    </div>
  )
}

// ── The room ───────────────────────────────────────────────────────────────────────────────────────────────────────

// The chalkboard: tonight's slate. Tap a team to pick it right here (no previews needed), or open any of the four pick sheets
function Chalkboard({ C, preds, go }) {
  const me = C.me
  const S = preds?.slates || []
  const slate = S[0]?.games.length ? S[0] : S[1]?.games.length ? S[1] : S[0]
  const when = slate && slate === S[1] ? 'Tomorrow' : 'Tonight'
  const games = slate?.games || []
  const picked = games.filter(g => g.pick).length
  const lu = slate?.lineup, slots = preds?.rates?.slots || 5
  const duels = games.filter(g => g.duel && !g.duel.void), dPicked = duels.filter(g => g.duel.pick).length
  const [busy, setBusy] = useState(null)
  const pick = async (g, t) => { if (busy || !g.open || g.pick === t) return; setBusy(g.id); try { await C.predict(g.id, t) } catch {} finally { setBusy(null) } }
  const team = (g, t) => {
    const attrs = { 'data-pick': g.pick === t ? '' : undefined, 'data-won': g.winner === t ? '' : undefined }
    return me && g.open
      ? <button type="button" className={styles.chalkTeam} {...attrs} disabled={busy === g.id} onClick={() => pick(g, t)} aria-pressed={g.pick === t} aria-label={`Pick ${nick(t)}`}>{t}</button>
      : <span {...attrs}>{t}</span>
  }
  const open = games.some(g => g.open)
  const sheets = [
    ['predict', 'Games', `${picked}/${games.length}`, open && picked < games.filter(g => g.open || g.pick).length],
    ['matchups', 'Matchups', duels.length ? `${dPicked}/${duels.length}` : '—', open && dPicked < duels.filter(g => g.open || g.duel.pick).length],
    ['lineup', 'Lineup', lu ? `${lu.slots.length}/${slots}` : '—', open && lu && lu.slots.length < slots],
    ['potd', 'Player of the Day', slate?.potd?.pick ? '✓' : '—', !!(slate?.potd?.open && !slate.potd.pick)],
  ]
  return (
    <section className={styles.chalk} aria-label="Tonight’s predictions">
      <div className={styles.slate}>
        <div className={styles.chalkHead}>
          <h2>{when}{slate ? <small> · {fmtDay(slate.day, { weekday: 'short', month: 'short', day: 'numeric' })}</small> : ''}</h2>
          {me && games.length > 0 && <span className={styles.tally}>{open ? 'Tap a team to pick it' : `${picked} of ${games.length} picked`}</span>}
        </div>
        {!me ? <p className={styles.chalkLine}>Pick every winner, call the matchups, set a lineup. <button type="button" onClick={() => C.openAuth('signup')}>Sign in to play →</button></p>
          : !preds ? <p className={styles.chalkLine}>Chalking up the slate…</p>
          : !games.length ? <p className={styles.chalkLine}>No games on the board. Check back when the schedule resumes.</p>
          : <ul className={styles.chalkGames}>
            {games.slice(0, 15).map(g => (
              <li key={g.id} data-busy={busy === g.id ? '' : undefined}>
                {team(g, g.away)}
                <i>@</i>
                {team(g, g.home)}
                {g.lock && <b className={styles.star} title="Your lock">★</b>}
                <small>{g.state === 'post' ? `F ${g.as}–${g.hs}` : g.state === 'in' ? 'LIVE' : tipTime(g.tip)}</small>
              </li>
            ))}
          </ul>}
        {me && <div className={styles.chalkBtns}>
          <span className={styles.chalkLab}>Your picks</span>
          {sheets.map(([k, label, n, todo]) => (
            <button key={k} type="button" className={todo ? styles.chalkGo : undefined} onClick={() => go(k)}>{label} <em>{n}</em></button>
          ))}
        </div>}
      </div>
      <div className={styles.tray} aria-hidden="true"><i /><i /><b /></div>
    </section>
  )
}

function HighScores({ C, picks, go }) {
  const rows = picks?.leaders?.slice(0, 6) || []
  const you = picks?.you
  return (
    <button type="button" className={styles.led} onClick={() => go('standings')} aria-label="Pick’em standings">
      <span className={styles.ledHead}>HIGH SCORES <small>THIS WEEK</small></span>
      <span className={styles.ledRows}>
        {rows.length ? rows.map(l => (
          <span key={l.username} className={styles.ledRow} data-you={C.me?.user.username === l.username ? '' : undefined}>
            <b>{String(l.rank).padStart(2, '0')}</b><span>{l.username.toUpperCase()}</span><strong>{String(l.score).padStart(3, '0')}</strong>
          </span>
        )) : <span className={styles.ledRow}><span>{picks ? 'NO SCORES YET · BE FIRST' : 'LOADING…'}</span></span>}
        {you && you.rank > 6 && <span className={styles.ledRow} data-you=""><b>{you.rank}</b><span>{you.username.toUpperCase()}</span><strong>{String(you.score).padStart(3, '0')}</strong></span>}
      </span>
      <span className={styles.ledFoot}>{picks ? `${picks.entrants} PLAYERS · TOP 10 WIN ${picks.payouts?.top10 ?? ''} COINS` : ''}</span>
    </button>
  )
}

// The stations along the walls, each a doorway to its game
function Stations({ C, preds, go, env }) {
  const S = preds?.slates || []
  const slate = S[0]?.games.length ? S[0] : S[1]?.games.length ? S[1] : S[0]
  const games = slate?.games || []
  const duels = games.filter(g => g.duel && !g.duel.void)
  const top = [...duels].sort((a, b) => Math.min(b.duel.ae, b.duel.be) - Math.min(a.duel.ae, a.duel.be))[0]?.duel
  const lu = slate?.lineup, slots = preds?.rates?.slots || 5
  const potd = slate?.potd
  const cands = (potd?.candidates || []).slice(0, 4)
  const RV = C.me?.rivals || {}
  const last = useLastCards(env, top ? [top.a, top.b] : [])
  return (
    <div className={styles.stWrap}>
    <p className={styles.swipe}>Swipe the stations →</p>
    <div className={styles.stations} role="list">
      <div className={styles.stGroup} data-g="pred">
      <button type="button" role="listitem" className={`${styles.st} ${styles.fight}`} onClick={() => go('matchups')}>
        <span className={styles.fightTop}>Tonight · {duels.length || 'no'} bout{duels.length === 1 ? '' : 's'}</span>
        {top ? <span className={styles.fightBout}>
          {[[top.a, top.ae], [top.b, top.be]].map(([n, e], i) => <span key={n} className={styles.fighterMini} data-side={i ? 'b' : 'a'}>
            <LastCard name={n} x={last[n]} env={env} />
            <b>{lastName(n)}</b><small>{n0(e)} Elo</small>
          </span>)}
          <i className={styles.vsMini}>VS</i>
        </span> : <>
          <span className={styles.fightNames}><b>Tale of the Tape</b></span>
          <span className={styles.fightSub}>Matchups appear before tipoff</span>
        </>}
        <span className={styles.stTag}>Player Matchups · {duels.filter(g => g.duel.pick).length} of {duels.length} called</span>
      </button>

      <button type="button" role="listitem" className={`${styles.st} ${styles.magnet}`} onClick={() => go('lineup')}>
        <span className={styles.wbTitle}>Daily Lineup</span>
        <span className={styles.magnets}>{Array.from({ length: slots }, (_, i) => {
          const s = lu?.slots.find(x => x.slot === i)
          return <span key={i} className={styles.hang} data-on={s ? '' : undefined}>
            <i className={styles.mag} data-c={i} aria-hidden="true" />
            {s && <span className={styles.hungCard}>{s.card ? <FaceFit card={s.card} shots={env.shots} /> : <span className={styles.hungName}>{lastName(s.player)}</span>}</span>}
          </span>
        })}</span>
        <span className={styles.stTag}>The magnet board · {lu ? `${lu.slots.length} of ${slots} on the board` : 'Five of your players'}</span>
      </button>

      <button type="button" role="listitem" className={`${styles.st} ${styles.tote}`} onClick={() => go('potd')}>
        <span className={styles.toteHead}>PLAYER OF THE DAY</span>
        <span className={styles.toteRows}>{cands.length ? cands.map((c, i) => <span key={c.name + c.team}><b>{i + 1}</b><span>{lastName(c.name).toUpperCase()}</span><small>{n0(c.elo)}</small></span>)
          : <span><span>{potd?.winner ? `WINNER · ${lastName(potd.winner.name).toUpperCase()}` : 'BOARD OPENS BEFORE TIPOFF'}</span></span>}</span>
        <span className={styles.ticket}>{potd?.pick ? <>Your ticket · <b>{shortName(potd.pick.player)}</b></> : 'Place your ticket'}</span>
      </button>

      </div>
      <h3 className={styles.zoneHead} data-z="play">Play your cards</h3>
      <div className={styles.stGroup} data-g="play">
      <button type="button" role="listitem" className={`${styles.st} ${styles.cab}`} data-c="koc" onClick={() => go('koc')}>
        <span className={styles.cabMarquee}>King of the Court</span>
        <span className={styles.cabScreenMini}><b>FIGHT!</b><small>{RV.live ? `${RV.live} rivalr${RV.live === 1 ? 'y' : 'ies'} live` : 'Groups · tonight’s games'}</small></span>
        <span className={styles.panel}><i className={styles.stick} /><i className={styles.btnA} /><i className={styles.btnB} /><i className={styles.btnC} /></span>
        <span className={styles.coinDoor}>1P START</span>
      </button>

      <button type="button" role="listitem" className={`${styles.st} ${styles.cab}`} data-c="banner" onClick={() => go('banner')}>
        <span className={styles.cabMarquee}>Hang the Banner</span>
        <span className={styles.cabScreenMini} data-court="">
          <svg viewBox="0 0 120 70" aria-hidden="true"><rect x="2" y="2" width="116" height="66" rx="2" /><line x1="60" y1="2" x2="60" y2="68" /><circle cx="60" cy="35" r="10" /><path d="M2,20 h22 v30 h-22" /><path d="M118,20 h-22 v30 h22" /><path d="M24,35 m-10,0 a10,10 0 0 1 20,0" transform="rotate(90 24 35)" /><path d="M96,35 m-10,0 a10,10 0 0 0 20,0" transform="rotate(90 96 35)" /></svg>
          <small>Climb a franchise’s ladder</small>
        </span>
        <span className={styles.panel}><i className={styles.stick} /><i className={styles.btnA} /><i className={styles.btnB} /></span>
        <span className={styles.coinDoor}>INSERT COIN</span>
      </button>

      <button type="button" role="listitem" className={`${styles.st} ${styles.cab} ${styles.pop}`} data-c="five" onClick={() => go('five')}>
        <span className={styles.cabMarquee}>Five Challenge</span>
        <span className={styles.hoop} aria-hidden="true"><span className={styles.board}><i /></span><span className={styles.rim} /><span className={styles.net} /></span>
        <span className={styles.ramp} aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span className={styles.coinDoor}>THIS WEEK’S LINEUPS</span>
      </button>

      <button type="button" role="listitem" className={`${styles.st} ${styles.insert}`} onClick={() => go('rivals')}>
        <span className={styles.slot2} aria-hidden="true"><i /></span>
        <b>INSERT COIN</b><span>2-PLAYER · RIVALRIES</span>
        <small>{RV.waiting ? `${RV.waiting} challenge${RV.waiting === 1 ? '' : 's'} waiting on you` : RV.sent ? `${RV.sent} sent · waiting` : 'Challenge a collector'}</small>
      </button>
      </div>
    </div>
    </div>
  )
}

function PrizeCounter({ preds, go }) {
  const h = (preds?.history || []).slice(0, 6)
  const s = preds?.stats
  const prize = preds?.history?.filter(x => (x.games?.reward && !x.games.claimed) || (x.duels?.reward && x.duels.reward !== 'duel' && !x.duels.claimed)).length || 0
  return (
    <button type="button" className={styles.prize} onClick={() => go('history')}>
      <span className={styles.prizeSign}>PRIZE COUNTER</span>
      <span className={styles.stubs}>{h.length ? h.map(x => (
        <span key={x.day} className={styles.stub} data-perfect={x.games && x.games.correct === x.games.total ? '' : undefined}>
          <small>{fmtDay(x.day, { month: 'short', day: 'numeric' })}</small><b>{x.games ? `${x.games.correct}/${x.games.total}` : x.open ? `${x.open.correct}✓` : '—'}</b>
        </span>
      )) : <span className={styles.stub}><small>ADMIT ONE</small><b>—</b></span>}</span>
      <span className={styles.prizeLine}>{prize ? <b>{prize} prize card{prize === 1 ? '' : 's'} to claim</b> : 'Prediction history'}{s ? ` · record ${s.wins}–${s.losses}` : ''}</span>
    </button>
  )
}

function ChampWall({ shots, go }) {
  const [w, setW] = useState({})
  useEffect(() => {
    const day = etToday()
    const get = d => fetch(`/api/collect?action=potw&day=${d}`, { credentials: 'same-origin' }).then(r => r.json()).catch(() => null)
    Promise.all([get(day), get(addDays(day, -7))]).then(([now, prev]) => setW({ now, prev }))
  }, [])
  const card = w.prev?.settled?.card
  // This week's leader on the court (two games to qualify; the front-runner before that) and in the pick'em race
  const lead = w.now?.leader || w.now?.top?.[0]
  const race = w.now?.race?.[0]
  const who = (card?.winners || w.prev?.settled?.winners || []).map(x => (typeof x === 'string' ? x : x?.username)).filter(Boolean)
  return (
    <button type="button" className={styles.champ} onClick={() => go('potw')}>
      <span className={styles.champSign}>Player of the Week</span>
      <span className={styles.frames}>
        <span className={styles.frame}>{card ? <FaceFit card={card} shots={shots} /> : <span className={styles.frameBlank}>Last week’s champion</span>}</span>
        <span className={styles.plaque}>
          <small>{w.now?.leader ? 'This week’s leader' : 'This week’s front-runner'}</small>
          <b>{lead ? baseName(lead.n) : 'No games yet'}</b>
          {lead?.gs != null && <span>{lead.gp} game{lead.gp === 1 ? '' : 's'} · {(+lead.gs).toFixed(1)} Game Score a game</span>}
          <small className={styles.plaqueRule}>{race ? `Pick’em leader: ${race.username}, ${race.score} pts` : 'The week’s pick’em winner gets the card'}</small>
          {who.length > 0 && <small>Last week’s card went to {who.join(', ')}</small>}
        </span>
      </span>
    </button>
  )
}

export default function GameRoom({ players, onSelectPlayer, ratings }) {
  useFonts()
  const C = useCollector()
  const [shots, setShots] = useState({})
  const [index, setIndex] = useState(null)
  const [best, setBest] = useState(null)
  const [picks, setPicks] = useState(null)
  // The station open over the room: { station, n }. n is new on every open, so it restarts the host
  const [open, setOpenRaw] = useState(() => { const s = stationFromUrl(); return s ? { station: s, n: 1 } : null })
  const setOpen = s => setOpenRaw(s ? { station: s, n: Date.now() + Math.random() } : null)
  useEffect(() => {
    binderJSON('/data/explorer/index.json').then(setIndex).catch(() => {})
    binderJSON('/data/explorer/ranks.json').then(setBest).catch(() => {})
    binderHeadshots().then(setShots)
    const onPop = () => { const s = stationFromUrl(); setOpenRaw(o => (s === (o?.station || null) ? o : s ? { station: s, n: Date.now() } : null)) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  primeBinders(players, index, best)
  useMemo(() => { if (players?.length) ELO = new Map(players.map(p => [normName(p.name), Math.round(p.current_elo)])) }, [players])
  const ready = !C.down && C.me !== undefined
  useEffect(() => { if (ready && C.me) C.loadPredictions().catch(() => {}) }, [ready, !!C.me])
  useEffect(() => { if (ready) C.loadStandings?.('week').then(setPicks).catch(() => {}) }, [ready])
  usePoll(() => C.loadPredictions().catch(() => {}), 60e3, ready && !!C.me && !open && gamesHot(C.preds?.slates))
  // Signed out: a linked station asks you to sign in first, and opens once you have
  useEffect(() => { if (open && ready && !C.me) C.openAuth('login') }, [open?.n, ready])
  // The address names the open station
  useEffect(() => {
    const url = hrefFor('gameroom', open ? { open: open.station } : {})
    if (new URLSearchParams(window.location.search).get('view') === 'gameroom' && window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url)
  }, [open?.station, open?.n])
  const go = s => (C.me ? setOpen(s) : C.openAuth('signup'))
  const preds = C.me ? C.preds : null
  // Enough of a binder's env to draw game cards in the room (the fight poster's fighters)
  const env = useMemo(() => ({ loadSeason: binderLoadSeason, withTeams: binderWithTeams, cardGameInfo: binderCardGameInfo, teamInfo: binderTeamInfo,
    headshot: n => shots?.[norm(n)]?.headshot, shots }), [shots])
  const fav = C.me?.user.favoriteTeam
  const pennants = useMemo(() => [fav, 'BOS', 'LAL', 'CHI', 'GSW', 'SAS'].filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 5), [fav])

  return (
    <div className={styles.room}>
      <div className={styles.rafters}>
        {pennants.slice(0, 2).map(t => <span key={t} className={styles.pennant} style={{ '--c': binderTeamInfo(t)?.color || '#173657' }}><Logo t={t} size={26} /></span>)}
        <button type="button" className={styles.bigBanner} onClick={() => go('banner')}><small>Hang the</small><b>Banner</b><span>Every franchise · every season</span></button>
        {pennants.slice(2).map(t => <span key={t} className={styles.pennant} style={{ '--c': binderTeamInfo(t)?.color || '#173657' }}><Logo t={t} size={26} /></span>)}
      </div>
      <header className={styles.sign}>
        <h1><span>The</span> Game Room</h1>
        <p>Every game on the site under one roof. Call tonight’s slate on the chalkboard, play your cards at the cabinets, and cash in at the prize counter.</p>
        <a className={styles.doorBack} href="/desk" onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); goTo('binders') }}>← My Desk</a>
      </header>
      <div className={styles.hall}>
        <h3 className={styles.zoneHead} data-z="tonight">Tonight’s picks</h3>
        <h3 className={styles.zoneHead} data-z="res">Results</h3>
        <Chalkboard C={C} preds={preds} go={go} />
        <HighScores C={C} picks={picks} go={go} />
        <Stations C={C} preds={preds} go={go} env={env} />
        <PrizeCounter preds={preds} go={go} />
        <ChampWall shots={shots} go={go} />
      </div>
      <div className={styles.carpet} aria-hidden="true" />
      {open && C.me && <BinderHost key={open.n} start={{ kind: 'game', station: open.station, ratings, onSelectPlayer: n => { const p = players?.find(x => x.name === n); if (p) onSelectPlayer?.(p) } }}
        shots={shots} onClose={() => setOpen(null)}
        onProfile={n => { const p = players?.find(x => x.name === n); setOpen(null); if (p) onSelectPlayer?.(p) }} />}
    </div>
  )
}
