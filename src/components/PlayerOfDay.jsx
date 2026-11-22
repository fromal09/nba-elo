import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { CardFace } from './Collector'
import { binderTeamInfo, binderHeadshots } from './SeasonExplorer'
import { norm, winChance } from './predict'
import { watchDay, etToday } from './liveFeed.js'
import { scoreGame } from './live.js'
import './PlayerOfDay.css'

/*
 * Player of the Day (api/_lib/predictions.js has the rules): one pick a day, changeable until the day's first tipoff.
 * The Player of the Day is the night's best PotD score: Game Score plus a sixth of the Elo gained, across every game.
 * Call it and his card is yours in ruby, plus Coins and pick'em points.
 *
 * Presented as what decides it, the box score: tonight's games as a page of agate, where you circle one player's line.
 * While the games are on, the lines fill in. When the night is done, the morning edition of The Floor Times names him.
 */
const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const n1 = v => (v == null ? '—' : (+v).toFixed(1))
const sg1 = v => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`)
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const last = n => baseName(n).split(' ').slice(-1)[0]
const shortName = n => { const [f, ...r] = baseName(n).split(' '); return r.length ? `${f[0]}. ${r.join(' ')}` : f }
const teamName = fc => binderTeamInfo(fc)?.name || fc
const nick = fc => { const n = teamName(fc); return /Trail Blazers$/.test(n) ? 'Trail Blazers' : n.split(' ').pop() }
const tip = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const longDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const shortDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const same = (a, b) => !!a && !!b && norm(a) === norm(b)
const pct = p => (p == null ? '' : p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`)
const SEEN = 'fpr.potdSeen'
const seen = d => { try { return (localStorage.getItem(SEEN) || '') >= d } catch { return true } }
const markSeen = d => { try { if ((localStorage.getItem(SEEN) || '') < d) localStorage.setItem(SEEN, d) } catch { /* private window */ } }

let SHOTS = null
function useShots() {
  const [s, set] = useState(SHOTS || {})
  useEffect(() => { if (!SHOTS) binderHeadshots().then(x => { SHOTS = x; set(x) }).catch(() => {}) }, [])
  return s
}

// The night's box scores while the games are on: every line scored with the current ratings, as the Scoreboard does
function useLiveBox(day, ratings, on) {
  const [feed, setFeed] = useState(null)
  useEffect(() => { if (!on) return; setFeed(null); return watchDay(day, ({ data }) => data && setFeed(data), day === etToday()) }, [day, on])
  return useMemo(() => {
    if (!on || !feed || !ratings) return null
    const sy = +day.slice(0, 4) - (+day.slice(5, 7) < 8 ? 1 : 0)
    return (feed.games || []).map(g => {
      const s = g.state !== 'pre' && g.box ? scoreGame(g, ratings, day, winChance, sy) : null
      const players = (s?.players || []).filter(p => !p.unrated && p.gs != null && (p.mp || 0) > 0)
        .map(p => ({ name: p.n, team: p.t, mp: p.mp, pts: p.pts, trb: p.trb, ast: p.ast, gs: p.gs, d: p.post - p.pre }))
      return { id: g.id, away: g.away, home: g.home, state: g.state, detail: g.detail, pts: g.pts, players }
    })
  }, [feed, ratings, day, on])
}
const potdOf = r => r.gs + r.d / 6

export default function PlayerOfDay({ env, ratings, onClose, liveOverride }) {
  const C = env.collector
  const [P, setP] = useState(null), [err, setErr] = useState(null)
  const [which, setWhich] = useState(0) // 0 today, 1 tomorrow, 'past'
  const [morning, setMorning] = useState(null) // a finished night to show as the morning edition
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    C.loadPredictions().then(x => {
      setP(x)
      const today = x?.slates?.[0], prev = x?.prev
      const fin = today?.potd?.winner ? today : prev?.potd?.winner && prev.potd.pick ? prev : null
      if (fin && !seen(fin.day)) setMorning(fin)
    }).catch(e => setErr(e.message))
  }, [])
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])
  const slate = typeof which === 'number' ? P?.slates?.[which] : null
  const potd = slate?.potd
  const live = !!(slate && which === 0 && !potd?.open && !potd?.winner && slate.games?.length)
  const box0 = useLiveBox(slate?.day || etToday(), ratings, live && !liveOverride)
  const box = liveOverride || box0
  const circle = async c => {
    if (!potd?.open || busy) return
    setBusy(true)
    try { const x = await C.potdPick(slate.day, c ? c.name : '', c ? c.team : ''); if (x) setP(o => ({ ...o, ...x })) } finally { setBusy(false) }
  }
  const fin = slate && which === 0 && potd?.winner ? slate : null
  return createPortal(<div className="pd">
    {err && <p className="pd-err" role="alert">{err}</p>}
    {morning ? <Morning env={env} s={morning} done={() => { markSeen(morning.day); setMorning(null) }} />
      : <div className="pd-page">
        <header className="pd-mast">
          {onClose && <button type="button" className="pd-close" onClick={onClose} aria-label="Back to the Game Room">‹ Game Room</button>}
          <b>The Floor Times</b>
          <div className="pd-dateline"><span>{slate ? longDay(slate.day) : which === 'past' ? 'Your past circles' : ''}</span><span>Player of the Day</span></div>
        </header>
        {!P ? <p className="pd-wait">Setting the type…</p>
          : which === 'past' ? <Past history={P.history || []} back={() => setWhich(0)} />
          : fin ? <Night s={fin} again={() => setMorning(fin)} />
          : !slate?.games?.length ? <p className="pd-wait">No games {which ? 'tomorrow' : 'today'}.</p>
          : live ? <Live potd={potd} box={box} />
          : <Pick potd={potd} games={slate.games} onCircle={circle} busy={busy} />}
        {P && <footer className="pd-foot">
          {which !== 0 && <button type="button" onClick={() => setWhich(0)}>Today’s box</button>}
          {which !== 1 && P.slates?.[1]?.games?.length > 0 && <button type="button" onClick={() => setWhich(1)}>Tomorrow’s box →</button>}
          {which !== 'past' && <button type="button" onClick={() => setWhich('past')}>Your past circles{P.stats?.potd ? ` · ${P.stats.potd.w}–${P.stats.potd.l}` : ''}</button>}
        </footer>}
      </div>}
  </div>, document.body)
}

const Rule = () => <p className="pd-rule"><b>PotD</b> = Game Score + Elo gained ÷ 6. The night’s best PotD is the Player of the Day.</p>

// ── Before tipoff: tonight's box, projected. Circle one line ──
function Pick({ potd, games, onCircle, busy }) {
  const [open, setOpen] = useState({})
  const [q, setQ] = useState('')
  const C0 = potd?.candidates || []
  const mine = potd?.pick
  const byGame = useMemo(() => games.map(g => ({ g, rows: C0.filter(c => c.team === g.away || c.team === g.home).sort((a, b) => (b.proj?.gs ?? -99) - (a.proj?.gs ?? -99)) })), [games, C0])
  const hit = q ? C0.filter(c => norm(c.name).includes(norm(q))).slice(0, 8) : null
  return <div className="pd-body">
    <Rule />
    <p className="pd-how">{mine ? <>Your circle: <b>{baseName(mine.player)}</b>. Circle another line to move it until the first tip at {tip(potd.lock)}.</>
      : <>Circle one line before the first tip at {potd?.lock ? tip(potd.lock) : 'tipoff'}. Call it and his card is yours in ruby.</>}</p>
    <input className="pd-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a player" aria-label="Find a player" />
    {hit ? <Agate head="Search" rows={hit} mine={mine} onCircle={onCircle} busy={busy} pre />
      : byGame.map(({ g, rows }) => {
        const full = open[g.id] || rows.some(c => same(c.name, mine?.player) && rows.indexOf(c) >= 5)
        return <section key={g.id} className="pd-game">
          <h3><span>{nick(g.away)} at {nick(g.home)}</span><small>{tip(g.tip)}</small></h3>
          <Agate rows={full ? rows : rows.slice(0, 5)} mine={mine} onCircle={onCircle} busy={busy} pre />
          {rows.length > 5 && <button type="button" className="pd-full" onClick={() => setOpen(o => ({ ...o, [g.id]: !full }))}>{full ? 'Top five' : `Full box · ${rows.length}`}</button>}
        </section>
      })}
  </div>
}

// One block of agate. Before tipoff: projected lines and each player's chance; live: the real line and PotD
function Agate({ head, rows, mine, onCircle, busy, pre, leader }) {
  return <table className="pd-agate">
    <thead><tr><th>{head || ''}</th>{pre ? <><th>Pts</th><th>Reb</th><th>Ast</th><th>GmSc</th><th>Win</th></> : <><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>GmSc</th><th>Elo</th><th>PotD</th></>}</tr></thead>
    <tbody>{rows.map(r => {
      const on = same(r.name, mine?.player)
      const cells = pre ? [r.proj?.pts, r.proj?.trb, r.proj?.ast, n1(r.proj?.gs), pct(r.p)] : [r.mp, r.pts, r.trb, r.ast, n1(r.gs), sg1(r.d), n1(potdOf(r))]
      return <tr key={r.name + r.team} data-on={on ? '' : undefined} data-lead={leader && same(r.name, leader) ? '' : undefined}
        onClick={pre && onCircle && !busy ? () => onCircle(r) : undefined} tabIndex={pre ? 0 : undefined}
        onKeyDown={pre && onCircle ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCircle(r) } } : undefined}
        aria-label={pre ? `${baseName(r.name)}${on ? ', your circle' : ', circle him'}` : undefined}>
        <td><span className="pd-nm">{shortName(r.name)}{head && <small> {r.team}</small>}{on && <svg className="pd-ring" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="M2,16 C2,6 50,1 92,5 C100,8 100,24 84,27 C55,31 8,30 1,20 C-1,12 10,4 34,3" /></svg>}</span></td>
        {cells.map((v, i) => <td key={i}>{v ?? '—'}</td>)}
      </tr>
    })}</tbody>
  </table>
}

// ── While the games are on: the lines fill in ──
function Live({ potd, box }) {
  const all = (box || []).flatMap(g => g.players.map(p => ({ ...p, g })))
  const lead = [...all].sort((a, b) => potdOf(b) - potdOf(a))
  const mine = potd?.pick, mi = lead.findIndex(r => same(r.name, mine?.player))
  return <div className="pd-body">
    <Rule />
    <section className="pd-leaders">
      <h3><span>Tonight’s leaders</span><small>{box ? `${box.filter(g => g.state === 'post').length} of ${box.length} final` : 'Waiting on the first box score'}</small></h3>
      {lead.length ? <Agate head="Player" rows={lead.slice(0, 5)} mine={mine} leader={lead[0]?.name} /> : <p className="pd-wait">No lines yet.</p>}
      {mine && <p className="pd-yours">{mi >= 0 ? <>Your circle, <b>{baseName(mine.player)}</b>, is No. {mi + 1} with {n1(potdOf(lead[mi]))}{mi > 0 ? `, ${n1(potdOf(lead[0]) - potdOf(lead[mi]))} back` : ', in front'}.</>
        : <>Your circle, <b>{baseName(mine.player)}</b>, hasn’t played yet.</>}</p>}
    </section>
    {(box || []).map(g => {
      const rows = [...g.players].sort((a, b) => potdOf(b) - potdOf(a))
      const top = rows.slice(0, 5), m = rows.find(r => same(r.name, mine?.player))
      return <section key={g.id} className="pd-game">
        <h3><span>{nick(g.away)} {g.pts?.[0] ?? ''}, {nick(g.home)} {g.pts?.[1] ?? ''}</span><small>{g.state === 'post' ? 'Final' : g.state === 'in' ? g.detail || 'Live' : 'Later'}</small></h3>
        {rows.length ? <Agate rows={m && !top.includes(m) ? [...top, m] : top} mine={mine} leader={lead[0]?.name} /> : <p className="pd-later">Box score after tipoff.</p>}
      </section>
    })}
    <p className="pd-fine">Live lines are unofficial until every game is final and the night’s cards are in.</p>
  </div>
}

// ── A finished night on the page ──
function Night({ s, again }) {
  const W = s.potd.winner, mine = s.potd.pick
  return <div className="pd-body">
    <Rule />
    <section className="pd-leaders">
      <h3><span>Final · Player of the Day</span><small>{shortDay(s.day)}</small></h3>
      <table className="pd-agate"><thead><tr><th>Player</th><th>PotD</th></tr></thead>
        <tbody>{(W.board || [{ name: W.name, team: W.team, score: W.score }]).map((r, i) => <tr key={r.name} data-on={same(r.name, mine?.player) ? '' : undefined} data-lead={!i ? '' : undefined}>
          <td><span className="pd-nm">{i + 1}. {shortName(r.name)}<small> {r.team}</small></span></td><td>{n1(r.score)}</td></tr>)}</tbody></table>
      {mine && <p className="pd-yours">{mine.result === 'win' ? 'You circled him. His ruby card is in your binder.' : <>Your circle, <b>{baseName(mine.player)}</b>{mine.rank ? `, finished No. ${mine.rank} of ${mine.of}` : ''}.</>}</p>}
    </section>
    <button type="button" className="pd-full pd-again" onClick={again}>Read the morning edition</button>
  </div>
}

// ── The morning edition ──
function Morning({ env, s, done }) {
  const shots = useShots()
  const W = s.potd.winner, mine = s.potd.pick, won = mine?.result === 'win'
  const d = (W.score - W.gs) * 6
  const card = won ? { ...W.card, ruby: true } : W.card
  const next = new Date(s.day + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1)
  return <div className="pd-morning">
    <article className="pd-front">
      <header className="pd-mast pd-mast2"><b>The Floor Times</b><div className="pd-dateline"><span>{longDay(next.toISOString().slice(0, 10))}</span><span>Morning edition</span></div></header>
      <h1>{last(W.name)} is Player of the Day</h1>
      <h2>{W.pts} points, {W.trb} rebounds, {W.ast} assists for the {nick(W.team)}</h2>
      <div className="pd-photo">{card && <CardFace card={card} shots={shots} w={190} />}{won && <span className="pd-stamp">Called it</span>}</div>
      <div className="pd-math"><span><b>{n1(W.gs)}</b><small>Game Score</small></span><i>+</i><span><b>{sg1(d)}</b><small>Elo gained</small></span><i>÷ 6 =</i><span><b>{n1(W.score)}</b><small>PotD</small></span></div>
      <p className="pd-lede">{won ? `You circled him. His ruby card is in your binder, with your Coins and pick’em points.`
        : mine ? `Your circle, ${baseName(mine.player)}, ${mine.rank ? `finished No. ${mine.rank} of ${mine.of}` : 'didn’t make the board'}.` : 'No circle on this night.'}</p>
    </article>
    <button type="button" className="pd-turn" onClick={done}>Turn the page</button>
  </div>
}

// ── Your past circles ──
function Past({ history, back }) {
  const rows = history.filter(h => h.potd)
  const w = rows.filter(h => h.potd.result === 'win').length, l = rows.filter(h => h.potd.result === 'loss').length
  return <div className="pd-body">
    <section className="pd-leaders">
      <h3><span>Your circles</span><small>{w}–{l}</small></h3>
      {rows.length ? <table className="pd-agate"><thead><tr><th>Date</th><th>Circle</th><th>PotD</th><th>Fin</th></tr></thead>
        <tbody>{rows.map(h => <tr key={h.day} data-lead={h.potd.result === 'win' ? '' : undefined}>
          <td>{shortDay(h.day)}</td><td><span className="pd-nm">{shortName(h.potd.player)}<small> {h.potd.team}</small></span></td><td>{n1(h.potd.score)}</td>
          <td>{h.potd.result === 'win' ? '1 ✓' : h.potd.rank ?? (h.potd.result ? '—' : 'live')}</td></tr>)}</tbody></table>
        : <p className="pd-wait">No circles yet.</p>}
    </section>
  </div>
}
