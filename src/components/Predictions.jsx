import { useState, useEffect, useMemo } from 'react'
import styles from './Predictions.module.css'
import { Fit, Seg, fromIndex, usePull } from './Binders'
import { MiniCard, DuelCard } from './PlayerCard'
import { Coin, TIER_NAME, useCollector } from './Collector'
import { binderLogo, binderTeamInfo } from './SeasonExplorer'

/*
 * Predictions, a page of My binder, for today's and tomorrow's games. Everything locks at each game's tipoff
 * and can change until then.
 *   Games     pick every winner; one pick is your Lock of the Day (double Coins if right, that day's pick Coins if wrong).
 *             More than half right: choose a Legend-or-below card from the day. Every game right: any card.
 *   Matchups  each game's top player matchup (the Scoreboard's): who posts the higher Game Score?
 *             More than half right: choose a Rare or Common from the day. All right: the Duel of the Day card.
 *   Lineup    five players from your binder who play that day; you score their Game Scores.
 *   Standings pick'em points by week and season.  History: every day you played.
 * Beat the Forecast (left page) compares your wins with the wins the Elo forecast expected from your picks.
 */

const fmtDay = (d, o = { weekday: 'long', month: 'long', day: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)
const tipTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`)
const n0 = v => Math.round(v || 0).toLocaleString()
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)
const need = total => Math.floor(total / 2) + 1
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const shortName = n => { const [f, ...r] = baseName(n).split(' '); return r.length ? `${f[0]}. ${r.join(' ')}` : f }
const teamName = t => binderTeamInfo(t)?.name || t
const nick = t => { const n = teamName(t); return /Trail Blazers$/.test(n) ? 'Trail Blazers' : n.split(' ').pop() }
const Logo = ({ t, size = 34 }) => <span className={styles.logo} style={{ width: size, height: size }}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" style={{ width: size, height: size }} /> : <b>{t}</b>}</span>
const statusOf = g => (g.state === 'pre' ? (g.open ? tipTime(g.tip) : 'In progress') : g.state === 'post' ? 'Final' : g.detail ? `In progress · ${g.detail}` : 'In progress')

// ── Games ────────────────────────────────────────────────────────────────────
function Side({ g, team, env, onPick, busy }) {
  const info = env.teamInfo(team) || {}
  const home = team === g.home
  const chance = g.line?.pHome == null ? null : home ? g.line.pHome : 1 - g.line.pHome
  const mine = g.pick === team
  const won = g.winner === team
  const bonus = g.upset?.[team] || 0
  const score = home ? g.hs : g.as
  return (
    <button type="button" className={`${styles.side} ${mine ? styles.mine : ''} ${g.winner && !won ? styles.lost : ''}`} style={{ '--c': info.color || '#173657' }}
      disabled={!g.open || busy} onClick={() => onPick(g, team)} aria-pressed={mine} aria-label={`Pick ${info.name || team}`}>
      <Logo t={team} />
      <span className={styles.sideText}>
        <b>{info.name || team}</b>
        <small>{home ? 'Home' : 'Away'}{chance != null ? ` · ${pct(chance)} Elo forecast` : ''}</small>
        {bonus > 0 && g.state === 'pre' && <em className={styles.dog}>Underdog · +{bonus * (mine && g.lock ? 2 : 1)} if right</em>}
        {g.result && mine && g.bonus > 0 && <em className={styles.dog}>Upset called · +{g.bonus * (g.lock ? 2 : 1)}</em>}
      </span>
      {score != null && <strong className={won ? styles.winScore : ''}>{score}</strong>}
      {mine && <i className={styles.tick}>{g.result === 'win' ? '✓' : g.result === 'loss' ? '✗' : g.lock ? '★' : '●'}</i>}
    </button>
  )
}

function GameRow({ g, env, onPick, onLock, busy, lockFixed }) {
  return (
    <div className={`${styles.game} ${!g.open ? styles.locked : ''} ${g.lock ? styles.isLock : ''}`}>
      <div className={styles.gameTop}>
        <span className={styles.status} data-state={g.state}>{statusOf(g)}</span>
        <span className={styles.gameTools}>
          {g.crowd && <span className={styles.crowd} title={`${g.crowd.n} collector${g.crowd.n === 1 ? '' : 's'} picked this game`}>
            <i style={{ width: `${(1 - g.crowd.home) * 100}%` }} />{pct(1 - g.crowd.home)} {g.away} · {pct(g.crowd.home)} {g.home}</span>}
          {g.lock ? <button type="button" className={`${styles.lockBtn} ${styles.lockOn}`} disabled={!g.open || busy} onClick={() => onLock(g, false)} title={g.open ? 'Take the lock off' : 'Your Lock of the Day'}>★ Lock of the Day</button>
            : g.pick && g.open && !lockFixed && <button type="button" className={styles.lockBtn} disabled={busy} onClick={() => onLock(g, true)} title="Double Coins if right; costs the day’s pick Coins if wrong">☆ Make it your lock</button>}
        </span>
      </div>
      <div className={styles.sides}>
        <Side g={g} team={g.away} env={env} onPick={onPick} busy={busy} />
        <span className={styles.at}>@</span>
        <Side g={g} team={g.home} env={env} onPick={onPick} busy={busy} />
      </div>
    </div>
  )
}

function Goal({ items, total, text }) {
  if (!total) return null
  const picked = items.filter(x => x.pick).length, open = items.filter(x => x.open && !x.pick).length
  const right = items.filter(x => x.r === 'win').length, graded = items.filter(x => x.r === 'win' || x.r === 'loss').length
  return (
    <div className={styles.goal}>
      <div className={styles.goalBar}>{items.map(x => <i key={x.id} data-r={x.r || (x.pick ? 'picked' : x.open ? 'open' : 'missed')} />)}</div>
      <span><b>{picked} of {total} picked</b>{graded ? ` · ${right} of ${graded} right so far` : ''}{open ? ` · ${open} still open` : ''}</span>
      <span className={styles.goalText}>{text}</span>
    </div>
  )
}

// ── Matchups ─────────────────────────────────────────────────────────────────
function MatchupRow({ g, onPick, busy }) {
  const d = g.duel
  const side = (name, team, elo) => {
    const mine = d.pick === name
    const info = binderTeamInfo(team) || {}
    return (
      <button type="button" className={`${styles.side} ${mine ? styles.mine : ''}`} style={{ '--c': info.color || '#173657' }} disabled={!g.open || busy}
        onClick={() => onPick(g, name)} aria-pressed={mine} aria-label={`Pick ${name}`}>
        <Logo t={team} size={28} />
        <span className={styles.sideText}><b>{baseName(name)}</b><small>{nick(team)} · {n0(elo)} Elo</small></span>
        {mine && <i className={styles.tick}>{d.result === 'win' ? '✓' : d.result === 'loss' ? '✗' : '●'}</i>}
      </button>
    )
  }
  return (
    <div className={`${styles.game} ${!g.open ? styles.locked : ''}`}>
      <div className={styles.gameTop}>
        <span className={styles.status} data-state={g.state}>{statusOf(g)} · {g.away} at {g.home}</span>
        <span className={styles.crowd}>{d.result === 'void' ? 'No contest (a player sat)' : d.result ? (d.result === 'win' ? 'Called it · +10' : 'Missed') : g.state === 'post' ? 'Grading…' : !g.open ? 'In progress' : 'Higher Game Score?'}</span>
      </div>
      <div className={styles.sides}>
        {side(d.a, g.away, d.ae)}
        <span className={styles.at}>vs</span>
        {side(d.b, g.home, d.be)}
      </div>
    </div>
  )
}

// ── Lineup ───────────────────────────────────────────────────────────────────
const MULT_TIERS = ['goat', 'icon', 'legend', 'standout', 'rare', 'common']
const xFmt = m => `${+Number(m).toFixed(2)}×`
const shortDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const restText = r => r.until ? `resting, can play again ${shortDay(r.until)}` : `in your ${shortDay(r.next)} lineup, needs ${r.days} days between games`
function TierX({ tier, mult }) {
  return <span className={styles.tierX} data-tier={tier}>{TIER_NAME[tier] || tier} <b>{xFmt(mult)}</b></span>
}

function LineupTab({ day, dayWord, lu, env, busy, onSet, slots, R }) {
  const [q, setQ] = useState('')
  const [pickCard, setPickCard] = useState({}) // player name → chosen card id
  const taken = new Set(lu.slots.map(s => s.player))
  const free = [...Array(slots).keys()].find(i => !lu.slots.some(s => s.slot === i))
  const total = lu.slots.reduce((a, s) => a + (s.pts ?? 0), 0)
  const list = lu.candidates.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.team.toLowerCase() === q.toLowerCase())
  const M = R.lineupMult || {}, Rest = R.lineupRest || {}
  return <>
    <div className={styles.goal}>
      <span><b>{lu.slots.length} of {slots} slots filled</b>{lu.graded ? ` · ${lu.graded.total} points · +${lu.graded.coins} Coins` : ''}</span>
      <span className={styles.goalText}>Put five cards from your binder in your lineup, of players who play {dayWord}. Each scores its player’s Game Score times the card’s multiplier: 1 Coin a point, up to {R.lineupMax}. Each slot locks when that player’s game tips off and scores once every game of the day is final.</span>
    </div>
    <div className={styles.multRow}>
      {MULT_TIERS.map(t => <span key={t} className={styles.multCell} data-tier={t}><b>{xFmt(M[t] || 1)}</b><small>{TIER_NAME[t]}{Rest[t] ? ` · ${Rest[t]}-day rest` : ''}</small></span>)}
    </div>
    <div className={styles.lineup}>
      {[...Array(slots).keys()].map(i => {
        const s = lu.slots.find(x => x.slot === i)
        if (!s) return <div key={i} className={styles.slotEmpty}><span>Slot {i + 1}</span><small>Add a player below</small></div>
        const e = s.card && fromIndex(env, s.card, { key: `l${i}` })
        return (
          <div key={i} className={styles.slot}>
            <span className={styles.slotCard}>{e && <Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit>}</span>
            <b>{shortName(s.player)}</b>
            {s.tier && <TierX tier={s.tier} mult={s.mult} />}
            <small>{s.team} {s.home ? 'vs' : '@'} {s.opp || '—'}{s.tip && s.open ? ` · ${tipTime(s.tip)}` : ''}</small>
            {s.gs != null ? <strong>{s.pts.toFixed(1)} <small>pts</small>{s.mult > 1 && s.gs > 0 && <em className={styles.slotRaw}>{s.gs.toFixed(1)} GmSc</em>}</strong>
              : s.open ? <button type="button" className={styles.ghostSm} disabled={busy} onClick={() => onSet(day, i, null)}>Remove</button>
                : <span className={styles.slotLock}>In progress</span>}
          </div>
        )
      })}
    </div>
    {lu.graded && <p className={styles.light}>Total {total.toFixed(1)} points.</p>}
    {lu.candidates.length > 0 && <>
      <div className={styles.candHead}><span className={styles.boxLab}>Your players {dayWord} · {lu.candidates.length}</span>
        <input className={styles.search} value={q} onChange={e => setQ(e.target.value)} placeholder="Find a player or team" aria-label="Find a player" /></div>
      <div className={styles.cands}>
        {list.map(c => {
          const cards = c.cards || [{ cardId: c.cardId, tier: c.tier, mult: c.mult, resting: c.resting }]
          const chosen = cards.find(x => x.cardId === pickCard[c.name]) || cards[0]
          const inIt = taken.has(c.name) || lu.slots.some(s => s.cardId === chosen.cardId)
          return (
            <div key={c.name} className={`${styles.cand} ${c.out ? styles.candOut : ''}`}>
              <Logo t={c.team} size={26} />
              <span className={styles.candText}><b>{baseName(c.name)}</b>
                <small>{c.team} {c.home ? 'vs' : '@'} {c.opp} · {c.open ? tipTime(c.tip) : 'tipped off'} · {n0(c.elo)} Elo{c.mp ? ` · ${c.mp} min` : ''}{c.status ? ` · ${c.status}` : ''}</small>
                {chosen.resting && <small className={styles.candRest}>{TIER_NAME[chosen.tier]} card: {restText(chosen.resting)}</small>}</span>
              {cards.length > 1
                ? <select className={styles.cardSel} value={chosen.cardId} onChange={e => setPickCard(v => ({ ...v, [c.name]: +e.target.value }))} aria-label={`Which ${baseName(c.name)} card`}>
                    {cards.map(x => <option key={x.cardId} value={x.cardId}>{TIER_NAME[x.tier]} {xFmt(x.mult)}{x.resting ? ' · resting' : ''}</option>)}
                  </select>
                : <TierX tier={chosen.tier} mult={chosen.mult} />}
              <button type="button" className={styles.claimBtn} disabled={busy || inIt || !c.open || free == null || !!chosen.resting} onClick={() => onSet(day, free, chosen.cardId)}>
                {inIt ? 'In lineup' : !c.open ? 'In progress' : chosen.resting ? 'Resting' : free == null ? 'Full' : 'Add'}</button>
            </div>
          )
        })}
      </div>
    </>}
    {!lu.candidates.length && !lu.slots.length && <div className={styles.empty}><b>{dayWord === 'yesterday' ? 'No lineup yesterday' : `None of your players play ${dayWord}`}</b><span>Game cards of current players count, from any season. Open packs to find some.</span></div>}
  </>
}

// ── Predict the Player of the Day ────────────────────────────────────────────
const fold = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
function PotdTab({ dayWord, p, env, busy, onPick, R }) {
  const [q, setQ] = useState('')
  const [more, setMore] = useState(false)
  const pick = p.pick
  const list = p.candidates.filter(c => !q || fold(c.name).includes(fold(q)) || c.team.toLowerCase() === q.toLowerCase())
  const shown = q || more ? list : list.slice(0, 30)
  const W = p.winner
  const thumb = W && (() => { const e = fromIndex(env, W.ruby ? { ...W.card, ruby: true } : W.card, { key: 'potd' }); return <span className={styles.potdThumb}><Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit></span> })()
  return <>
    <div className={styles.goal}>
      <span><b>{pick ? `Your pick: ${baseName(pick.player)}` : 'No pick yet'}</b>{p.lock ? ` · ${p.open ? `locks at ${tipTime(p.lock)}, the first tipoff` : 'locked at the first tipoff'}` : ''}</span>
      <span className={styles.goalText}>Who will be the Player of the Day {dayWord}? It’s the night’s best Game Score plus a sixth of the Elo gained, across every game. Call it and you get that card in ruby, at twice its points, plus {R.potd} Coins and {R.potdStand} pick’em points. One pick a day; change it until the first game tips off.</span>
    </div>
    {pick && <div className={styles.potdMine} data-r={pick.result || (p.open ? 'open' : 'live')}>
      <Logo t={pick.team} size={34} />
      <span className={styles.potdWho}><b>{baseName(pick.player)}</b><small>{teamName(pick.team)}</small></span>
      <em>{pick.result === 'win' ? '✓ Called it · the ruby card is in your binder' : pick.result === 'loss' ? '✗ Not this time' : p.open ? 'Your nomination' : W ? 'Grading…' : 'In progress'}</em>
      {p.open && <button type="button" className={styles.ghostSm} disabled={busy} onClick={() => onPick(null)}>Remove</button>}
    </div>}
    {W && <div className={styles.potdWin}>
      {thumb}
      <span><small>Player of the Day</small><b>{baseName(W.name)}</b><span>{teamName(W.team)} · {W.pts} pts · {W.trb} reb · {W.ast} ast · {W.gs?.toFixed(1)} Game Score</span>
        {W.ruby && <em>Yours in ruby</em>}</span>
    </div>}
    {p.open && p.candidates.length > 0 && <>
      <div className={styles.candHead}><span className={styles.boxLab}>Players {dayWord} · by Elo</span>
        <input className={styles.search} value={q} onChange={e => setQ(e.target.value)} placeholder="Find a player or team" aria-label="Find a player" /></div>
      <div className={styles.cands}>
        {shown.map(c => {
          const on = pick && fold(pick.player) === fold(c.name)
          return (
            <div key={c.name + c.team} className={styles.cand}>
              <Logo t={c.team} size={26} />
              <span className={styles.candText}><b>{baseName(c.name)}</b>
                <small>{c.team} {c.home ? 'vs' : '@'} {c.opp} · {tipTime(c.tip)} · {n0(c.elo)} Elo{c.mp ? ` · ${c.mp} min` : ''}{c.status ? ` · ${c.status}` : ''}</small></span>
              <button type="button" className={styles.claimBtn} disabled={busy || on} onClick={() => onPick(c)}>{on ? 'Your pick' : pick ? 'Switch' : 'Nominate'}</button>
            </div>
          )
        })}
      </div>
      {!q && !more && list.length > 30 && <button type="button" className={styles.histBtn} onClick={() => setMore(true)}>Show all {list.length} players</button>}
    </>}
    {!p.open && !pick && !W && <div className={styles.empty}><b>No pick {dayWord}</b><span>Player of the Day picks close at the day’s first tipoff.</span></div>}
  </>
}

// ── Standings ────────────────────────────────────────────────────────────────
function StandingsTab() {
  const C = useCollector()
  const [scope, setScope] = useState('week')
  const [d, setD] = useState({})
  useEffect(() => { C.loadStandings(scope).then(x => setD(v => ({ ...v, [scope]: x }))).catch(() => {}) }, [scope])
  const s = d[scope]
  const row = (x, you) => (
    <div key={x.username + (you ? '-you' : '')} className={`${styles.stRow} ${C.me?.user.username === x.username ? styles.stYou : ''}`}>
      <b className={styles.stRank} data-top={x.rank <= 3 ? x.rank : undefined}>{x.rank}</b>
      <span className={styles.stWho}><b>{x.username}{you ? ' (you)' : ''}</b>
        <small>Picks {x.picks[0]}–{x.picks[1]} · matchups {x.matchups[0]}–{x.matchups[1]}{x.locks ? ` · ${x.locks} lock${x.locks === 1 ? '' : 's'}` : ''}{x.potd?.[0] ? ` · PotD ${x.potd[0]}` : ''} · {sgn(x.over)} vs forecast</small></span>
      <strong>{x.score}<small>pts</small></strong>
    </div>
  )
  return <>
    <div className={styles.stHead}>
      <Seg value={scope} onChange={setScope} options={[['week', 'This week'], ['season', 'Season']]} />
      {s && <span className={styles.light}>{s.entrants} collector{s.entrants === 1 ? '' : 's'}{s.payouts ? ` · top 10 win ${s.payouts.top10} Coins, top 50 win ${s.payouts.top50}, paid Monday` : ''}</span>}
    </div>
    <p className={styles.light}>1 point for each correct pick, 1 for each correct matchup, 1 more for a correct lock, 2 for a correct Player of the Day. Ties go to whoever beat the forecast by more. The week’s No. 1 also gets that week’s Player of the Week card; a tie for No. 1 shares it, numbered.</p>
    {!s ? <p className={styles.light}>Loading…</p> : s.leaders.length ? <div className={styles.stList}>
      {s.leaders.map(x => row(x))}
      {s.you && s.you.rank > 25 && row(s.you, true)}
    </div> : <div className={styles.empty}><b>No picks graded yet {scope === 'week' ? 'this week' : 'this season'}</b><span>Standings fill in as games finish.</span></div>}
  </>
}

// ── History ──────────────────────────────────────────────────────────────────
function HistoryRow({ h, env, onReward, all }) {
  const G = h.games, D = h.duels, L = h.lineup
  const perfect = G && G.correct === G.total
  const [open, setOpen] = useState(!!all)
  useEffect(() => setOpen(!!all), [all])
  const thumb = card => { const c = fromIndex(env, card, { key: card.date + card.kind }); return <span className={styles.histThumb}><Fit>{c.duel ? <DuelCard {...c.duel} /> : <MiniCard name={c.name} row={c.row} game={c.game} team={c.team} headshot={env.headshot(c.name)} />}</Fit></span> }
  return (
    <div className={styles.histWrap}>
    <div className={`${styles.hist} ${perfect ? styles.histPerfect : G?.reward ? styles.histWin : ''} ${open ? styles.histOpen : ''}`}
      role="button" tabIndex={0} aria-expanded={open} onClick={e => { if (!e.target.closest('button')) setOpen(o => !o) }} onKeyDown={e => { if (e.key === 'Enter') setOpen(o => !o) }}>
      <span className={styles.histDay}><b>{fmtDay(h.day, { month: 'short', day: 'numeric' })}</b><small>{fmtDay(h.day, { weekday: 'short' })}</small></span>
      <span className={styles.histParts}>
        <span className={styles.histPart}>
          <small>Games</small>
          {G ? <><b>{G.correct} of {G.total}{perfect ? ' · Perfect' : ''}</b>
            <span className={styles.setBar} style={{ '--c': perfect ? '#c99a2e' : '#1a7a4a' }}><em style={{ width: `${(G.correct / G.total) * 100}%` }} /></span>
            <small>{G.lock ? `Lock ${G.lock === 'win' ? '✓' : G.lock === 'loss' ? '✗' : '—'} · ` : ''}{G.upsets ? `${G.upsets} upset${G.upsets === 1 ? '' : 's'}` : 'no upsets'}</small></>
            : h.open ? <><b>{h.open.correct} right</b><small>{h.open.graded} of {h.open.picked} graded</small></> : <small>—</small>}
        </span>
        <span className={styles.histPart}>
          <small>Matchups</small>
          {D ? <><b>{D.correct} of {D.total}</b><small>{D.reward === 'duel' ? 'Duel of the Day card won' : D.reward ? 'card earned' : `${Math.max(0, need(D.total) - D.correct)} short`}</small></>
            : h.dopen ? <small>{h.dopen.picked} picked · graded when the games are final</small> : <small>—</small>}
        </span>
        <span className={styles.histPart}>
          <small>PotD</small>
          {h.potd ? <><b>{shortName(h.potd.player)}</b><small>{h.potd.result === 'win' ? '✓ called it · ruby card' : h.potd.result === 'loss' ? '✗ missed' : h.day >= etToday() ? 'not decided yet' : 'graded when the day’s cards are in'}</small></> : <small>—</small>}
        </span>
        <span className={styles.histPart}>
          <small>Lineup</small>
          {L ? <><b>{Number(L.total).toFixed(1)}</b><small>+{L.coins} Coins</small></> : h.lopen ? <small>set · scored when the games are final</small> : <small>—</small>}
        </span>
      </span>
      <span className={styles.histRewards}>
        {G?.claimed ? thumb(G.claimed.card) : G?.reward && <button type="button" className={styles.claimBtn} onClick={() => onReward(h.day, 'games')}>{G.reward === 'any' ? 'Choose any card' : 'Choose a card'}</button>}
        {D?.claimed ? thumb(D.claimed.card) : D?.reward && D.reward !== 'duel' && <button type="button" className={styles.claimBtn} onClick={() => onReward(h.day, 'duels')}>Matchup card</button>}
      </span>
      <span className={styles.histChev}>{open ? '▴' : '▾'}</span>
    </div>
    {open && <DayDetail day={h.day} env={env} />}
    </div>
  )
}

// A day in full: each game and your pick, each matchup, the lineup
const pctS = p => (p == null ? '' : `${Math.round(p * 100)}%`)
function DayDetail({ day, env }) {
  const C = env.collector
  const [d, setD] = useState(null), [err, setErr] = useState(null)
  useEffect(() => { C.predDay(day).then(setD).catch(e => setErr(e.message)) }, [day])
  if (err) return <div className={styles.dayBox}><p className={styles.light}>{err}</p></div>
  if (!d) return <div className={styles.dayBox}><p className={styles.light}>Loading the day…</p></div>
  const mark = r => (r === 'win' ? <b className={styles.mWin}>✓</b> : r === 'loss' ? <b className={styles.mLoss}>✗</b> : r === 'void' ? <b className={styles.mVoid}>void</b> : <b className={styles.mWait}>•</b>)
  return (
    <div className={styles.dayBox}>
      <h4>Games</h4>
      {d.games.length ? d.games.map(g => {
        const fin = g.state === 'post', mine = g.pick
        const chance = mine ? (mine === g.home ? g.pHome : g.pHome == null ? null : 1 - g.pHome) : null
        return (
          <div key={g.id} className={styles.dayRow}>
            <span className={styles.dayTeams}>
              <span className={g.winner === g.away ? styles.dayWon : ''}><Logo t={g.away} size={18} />{g.away}{fin ? ` ${g.as}` : ''}</span>
              <small>@</small>
              <span className={g.winner === g.home ? styles.dayWon : ''}><Logo t={g.home} size={18} />{g.home}{fin ? ` ${g.hs}` : ''}</span>
            </span>
            <span className={styles.dayPick}>{mine ? <>Your pick <b>{mine}</b>{g.lock ? <em className={styles.dayLock}>Lock</em> : null}<small>{pctS(chance)} forecast{g.bonus ? ` · +${g.bonus} upset` : ''}</small></> : <small>No pick</small>}</span>
            <span className={styles.dayMark}>{mine ? mark(g.result) : null}</span>
          </div>
        )
      }) : <p className={styles.light}>No games.</p>}
      {d.matchups.length > 0 && <>
        <h4>Matchups</h4>
        {d.matchups.map(m => (
          <div key={m.id} className={styles.dayRow}>
            <span className={styles.dayTeams}><span className={m.result && m.pick === m.a && m.result === 'win' ? styles.dayWon : ''}>{shortName(m.a)}</span><small>vs</small><span>{shortName(m.b)}</span></span>
            <span className={styles.dayPick}>{m.pick ? <>Your pick <b>{shortName(m.pick)}</b></> : <small>No pick</small>}
              <small>{m.ag != null && m.bg != null ? `Game Score ${m.ag.toFixed(1)}–${m.bg.toFixed(1)}` : m.state === 'post' ? 'grading…' : m.state === 'in' ? 'in progress' : 'not played yet'}</small></span>
            <span className={styles.dayMark}>{m.pick ? mark(m.result) : null}</span>
          </div>
        ))}
      </>}
      {(d.potd?.pick || d.potd?.winner) && <>
        <h4>Player of the Day</h4>
        <div className={styles.dayRow}>
          <span className={styles.dayTeams}>{d.potd.pick ? <span><Logo t={d.potd.pick.team} size={18} />{shortName(d.potd.pick.player)}</span> : <small>No pick</small>}</span>
          <span className={styles.dayPick}>{d.potd.winner ? <small>Player of the Day: <b>{shortName(d.potd.winner.name)}</b> · {d.potd.winner.gs?.toFixed(1)} Game Score</small> : <small>{d.games.every(g => g.state === 'post') ? 'graded when the day’s cards are in' : 'not decided yet'}</small>}</span>
          <span className={styles.dayMark}>{d.potd.pick ? mark(d.potd.pick.result) : null}</span>
        </div>
      </>}
      {d.lineup.slots.length > 0 && <>
        <h4>Lineup {d.lineup.graded ? <small>{d.lineup.graded.total} points · +{d.lineup.graded.coins} Coins</small> : null}</h4>
        {d.lineup.slots.map(s => (
          <div key={s.slot} className={styles.dayRow}>
            <span className={styles.dayTeams}><span><Logo t={s.team} size={18} />{shortName(s.player)}</span></span>
            <span className={styles.dayPick}><small>{s.tier ? `${s.tier[0].toUpperCase()}${s.tier.slice(1)} ×${+(s.mult || 1).toFixed(2)}` : ''}</small></span>
            <span className={styles.dayMark}>{s.pts != null ? <b>{s.pts}</b> : <b className={styles.mWait}>•</b>}</span>
          </div>
        ))}
      </>}
    </div>
  )
}

// Choose one card from the day's games: Legend or below / any (game picks), Rare or below (matchups)
function RewardPicker({ day, kind, env, onClose, onDone }) {
  const C = env.collector
  const [data, setData] = useState(null), [err, setErr] = useState(null)
  const [sel, setSel] = useState(null), [busy, setBusy] = useState(false)
  const P = usePull(env, null)
  useEffect(() => { C.predReward(day, kind).then(setData).catch(e => setErr(e.message)) }, [day, kind])
  useEffect(() => { const k = e => { if (e.key === 'Escape' && !P.open) onClose() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [P.open])
  const games = useMemo(() => {
    if (!data?.cards) return []
    const by = new Map()
    data.cards.forEach(x => { const k = x.card.id; if (!by.has(k)) by.set(k, []); by.get(k).push(x) })
    return [...by.values()].map(list => {
      list.sort((a, b) => (b.ok - a.ok) || b.points - a.points)
      const w = list.find(x => x.card.won) || list[0]
      return { id: list[0].card.id, w: w.card, list }
    })
  }, [data])
  const take = async () => {
    setBusy(true)
    try { const r = await C.claimPred(day, sel.ref, kind); if (r) onDone() } finally { setBusy(false) }
  }
  const title = data?.reward === 'any' ? 'Perfect day: choose any card' : data?.reward === 'rare' ? 'Matchups: choose a Rare or a Common' : 'Choose a card, Legend or below'
  const sub = data?.reward === 'any' ? 'Every player from every game that day. Icons and GOATs included.'
    : data?.reward === 'rare' ? 'Every player from that day’s games, Rare and below. Get every matchup right for the Duel of the Day card.'
      : 'Every player from that day’s games. Icons and GOATs are for perfect days.'
  const lockLabel = data?.reward === 'rare' ? '🔒 Rare or below' : '🔒 Perfect day'
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.picker} onClick={e => e.stopPropagation()} role="dialog" aria-label="Choose your card">
        <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.pickHead}>
          <small>{kind === 'duels' ? 'Matchup reward' : 'Prediction reward'} · {fmtDay(day)}</small>
          <b>{title}</b><span>{sub}</span>
        </div>
        <div className={styles.pickBody}>
          {err && <p className={styles.note}>{err}</p>}
          {!data && !err && <p className={styles.note}>Loading the day’s cards…</p>}
          {data?.pending && <p className={styles.note}><b>The day’s cards aren’t published yet.</b> They arrive with the morning data update; come back then to choose yours.</p>}
          {games.map(gm => (
            <section key={gm.id} className={styles.pickGame}>
              <h4>{gm.w.tn} {gm.w.score.split('–')[0]}, {gm.w.on} {gm.w.score.split('–')[1]}{gm.w.ot ? ` (${gm.w.ot})` : ''}</h4>
              <div className={styles.pickGrid}>
                {gm.list.map(x => {
                  const ref = `${x.card.s}|${x.card.id}|${x.card.row.n}`
                  const e = fromIndex(env, x.card, { key: ref })
                  const off = x.owned || !x.ok
                  return (
                    <div key={ref} className={`${styles.pickCard} ${sel?.ref === ref ? styles.picked : ''} ${off ? styles.off : ''}`}>
                      <button type="button" className={styles.pickFace} onClick={() => (off ? P.pull(e) : setSel({ ref, x, e }))} aria-label={`${x.card.row.n}${off ? '' : ': choose'}`}>
                        <Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit>
                        {off && <span className={styles.lock}>{x.owned ? '✓ Owned' : lockLabel}</span>}
                      </button>
                      <span className={styles.pickMeta}>{TIER_NAME[x.card.tier]} · {n0(x.points)} pts</span>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
        <div className={styles.pickFoot}>
          {sel ? <>
            <span><b>{sel.x.card.row.n}</b> · {TIER_NAME[sel.x.card.tier]} · {n0(sel.x.points)} pts</span>
            <button type="button" className={styles.ghost} onClick={() => P.pull(sel.e)}>Look closer</button>
            <button type="button" className={styles.claimBtn} disabled={busy} onClick={take}>{busy ? 'Adding…' : 'Add to my binder'}</button>
          </> : <span className={styles.light}>Tap a card to choose it. You get one.</span>}
        </div>
      </div>
      {P.view}
    </div>
  )
}

// ── The book ─────────────────────────────────────────────────────────────────
// The Predictions view of My binder: its left and right pages, handed to the binder's own book (render prop),
// so it keeps the binder's colors and header. tools = the binder's view tabs.
export function PredictPages({ env, phone, tools, children }) {
  const C = env.collector
  const d = C.preds
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('games')
  const [di, setDi] = useState('0') // '-1' yesterday, '0' today (the default), '1' tomorrow
  const [busy, setBusy] = useState(null)
  const [reward, setReward] = useState(null) // { day, kind }
  const [allOpen, setAllOpen] = useState(false) // History: every day expanded
  useEffect(() => {
    C.loadPredictions().catch(e => setErr(e.message))
    const t = setInterval(() => C.loadPredictions().catch(() => {}), 60e3)
    return () => clearInterval(t)
  }, [])
  if (!d) return children({
    left: <p className={styles.line}>{err || 'Loading the slate…'}</p>,
    right: <div className={styles.right}><div className={styles.sheetHead}><div className={styles.sheetTitle}><b>Predictions</b><span>loading…</span></div>{tools}</div></div>,
    summary: <span>Predictions</span>,
  })
  const s = d.stats, R = d.rates, F = s.forecast
  const run = async (key, fn) => { setBusy(key); try { await fn() } finally { setBusy(null) } }
  const slate = di === '-1' ? (d.prev || { day: '', games: [], lineup: { slots: [], candidates: [], graded: null } }) : d.slates[+di]
  const dayWord = di === '-1' ? 'yesterday' : di === '0' ? 'today' : 'tomorrow'
  const lockGame = slate.games.find(g => g.lock)
  const lockFixed = lockGame && !lockGame.open
  const unclaimed = d.history.flatMap(h => [h.games?.reward && !h.games.claimed && { day: h.day, kind: 'games' }, h.duels?.reward && h.duels.reward !== 'duel' && !h.duels.claimed && { day: h.day, kind: 'duels' }]).filter(Boolean)
  const envX = { ...env, today: d.slates[0].day }

  const left = <>
    <div className={styles.boxLab}>Predictions</div>
    {!phone && <p className={styles.line}>Pick winners, matchups and a lineup. Everything locks at tipoff and can change until then.</p>}
    <div className={styles.stats}>
      <div className={styles.statWide}><b className={styles.green}>{s.wins}–{s.losses}</b><small>Record</small></div>
      <div><b>{pct(s.pct)}</b><small>Right</small></div>
      <div><b>{s.streak}</b><small>Streak</small></div>
      <div><b>{s.best}</b><small>Best run</small></div>
    </div>
    <div className={`${styles.beat} ${F.over > 0 ? styles.beatUp : F.over < 0 ? styles.beatDown : ''}`}>
      <small>Beat the Forecast</small>
      <b>{F.rated ? `${sgn(F.over)} wins` : '—'}</b>
      <span>{F.rated ? <>You’re {F.wins}–{F.rated - F.wins} on forecast games; the Elo forecast expected {F.expected.toFixed(1)} wins from your picks. Its favorites went {F.favW}–{F.favL} in them.</>
        : 'Once your picks are graded, this compares your wins with what the Elo forecast expected from them.'}</span>
    </div>
    <div className={styles.stats}>
      <div><b>{s.locks.w}–{s.locks.l}</b><small>Locks</small></div>
      <div><b>{s.duels.w}–{s.duels.l}</b><small>Matchups</small></div>
      <div><b>{s.upsets}<span className={styles.of}>/{s.dogPicks}</span></b><small>Upsets</small></div>
      <div><b>{s.lineup.best ? s.lineup.best.toFixed(1) : '—'}</b><small>Best lineup</small></div>
      <div><b>{s.perfect}</b><small>Perfect days</small></div>
    </div>
    <div className={styles.stats}>
      <div><b>{s.claimed}</b><small>Cards won</small></div>
      <div><b>{s.duels.cards}</b><small>Duel cards</small></div>
      <div><b>{s.potd ? `${s.potd.w}–${s.potd.l}` : '—'}</b><small>PotD</small></div>
      <div className={styles.statWide} style={{ gridColumn: 'span 2' }}><b className={styles.goldC}><Coin size={16} /> {n0(s.coins)}</b><small>Coins from predictions</small></div>
    </div>
    {unclaimed.length > 0 && <button type="button" className={styles.claimBig} onClick={() => setReward(unclaimed[0])}>
      {unclaimed.length === 1 ? `Choose your card from ${fmtDay(unclaimed[0].day, { month: 'short', day: 'numeric' })}` : `${unclaimed.length} cards to choose`}</button>}
    <div className={styles.boxLab}>Rewards</div>
    <div className={styles.rules}>
      <div><b>Every pick</b><span>+{R.pick}</span></div>
      <div><b>Correct pick</b><span>+{R.correct}</span></div>
      <div><b>Upset called</b><span>+{R.upsetMin}–{R.upsetMax}</span></div>
      <div><b>Lock of the Day</b><span>×2 if right · lose the day’s pick Coins if wrong</span></div>
      <div><b>Perfect day</b><span>+{R.perfectPer} a game · any card from the day</span></div>
      <div><b>More than half the games</b><span>a Legend-or-below card</span></div>
      <div><b>Correct matchup</b><span>+{R.duel}</span></div>
      <div><b>More than half the matchups</b><span>a Rare or Common</span></div>
      <div><b>Every matchup</b><span>the Duel of the Day card</span></div>
      <div><b>Lineup</b><span>Game Score × card multiplier, 1 Coin a point, up to {R.lineupMax}</span></div>
      <div><b>Player of the Day called</b><span>+{R.potd} · that card in ruby</span></div>
      <div><b>No. 1 in the weekly standings</b><span>the Player of the Week card</span></div>
    </div>
    <details className={styles.help}>
      <summary>How it works</summary>
      <p>Pick a winner in each of the day’s games, any time before it tips off. You can change a pick until that game starts; then it locks. You can also pick from the game cards on the Scoreboard.
        The underdog is the team the site’s Elo forecast (the one on the Scoreboard) gives under 50% when the game tips off; calling one pays (50% − its chance) × 200 Coins, from {R.upsetMin} to {R.upsetMax}.</p>
      <p>Make one pick a day your Lock of the Day. If it’s right, its Coins double, upset bonus included. If it’s wrong, you lose the Coins you earned for that day’s picks. You can move the lock until its game tips off.</p>
      <p>Matchups are each game’s top player matchup, each side’s highest-Elo healthy player: pick who posts the higher Game Score. A matchup is void if either player sits or they tie. Matchups and lineups are graded from the box scores once the day’s games are final.</p>
      <p>A day closes when its last game is final. Games you didn’t pick count as misses. Standings: 1 point per correct pick or matchup, 1 more for a correct lock; the week’s top 10 win {R.weeklyTop10} Coins and the top 50 win {R.weeklyTop50}, paid Monday.</p>
    </details>
    {s.teams.length > 0 && <>
      <div className={styles.boxLab}>Teams you pick most</div>
      <div className={styles.teamsList}>{s.teams.map(t => <span key={t.team}><b>{t.team}</b> {t.w}–{t.l}</span>)}</div>
    </>}
  </>

  // Three toggles: what to pick (games, matchups, lineup), which day, and the record (standings, history)
  const picking = ['games', 'matchups', 'lineup', 'potd'].includes(tab)
  const sub_ = <Seg value={picking ? tab : ''} onChange={setTab} options={[['games', 'Games'], ['matchups', 'Matchups'], ['lineup', 'Lineup'], ['potd', 'PotD']]} />
  const dayTabs = <Seg value={picking ? di : ''} onChange={v => { setDi(v); if (!picking) setTab('games') }} options={[['-1', 'Yesterday'], ['0', 'Today'], ['1', 'Tomorrow']]} />
  const recTabs = <Seg value={picking ? '' : tab} onChange={setTab} options={[['standings', 'Standings'], ['history', 'History']]} />
  const games = slate.games
  let body, title, sub
  if (tab === 'standings') { title = 'Pick’em standings'; sub = 'picks, matchups and locks'; body = <StandingsTab /> }
  else if (tab === 'history') {
    title = 'Your days'; sub = `${s.days} day${s.days === 1 ? '' : 's'} closed · ${s.rewards} earned a card`
    body = d.history.length ? <>
      <div className={styles.histTools}><span className={styles.light}>{d.history.length} day{d.history.length === 1 ? '' : 's'} played · tap a day for every pick</span>
        <button type="button" className={styles.histBtn} onClick={() => setAllOpen(v => !v)}>{allOpen ? 'Collapse all' : 'Show every pick'}</button></div>
      <div className={styles.histList}>{d.history.map(h => <HistoryRow key={h.day} h={h} env={env} all={allOpen} onReward={(day, kind) => setReward({ day, kind })} />)}</div>
    </>
      : <div className={styles.empty}><b>No days played yet</b><span>Make your picks for today’s games. Your record, streaks and rewards show up here.</span></div>
  } else {
    title = fmtDay(slate.day); sub = `${games.length} game${games.length === 1 ? '' : 's'} · times in your time zone`
    if (!games.length) body = <div className={styles.empty}><b>No games {dayWord}</b><span>{di === '0' && d.slates[1].games.length ? 'Tomorrow’s slate is open.' : di === '-1' ? 'Nothing to look back on.' : 'Check back when the schedule resumes.'}</span></div>
    else if (tab === 'games') {
      const k = need(games.length)
      body = <>
        <Goal items={games.map(g => ({ id: g.id, pick: g.pick, open: g.open, r: g.result }))} total={games.length}
          text={`Get ${k} right to choose a Legend-or-below card from the day’s games. Get all ${games.length} for any card. Star one pick as your Lock of the Day.`} />
        <div className={styles.games}>{games.map(g => <GameRow key={g.id} g={g} env={env} busy={busy === g.id} lockFixed={lockFixed}
          onPick={(g_, t) => g_.pick !== t && run(g_.id, () => C.predict(g_.id, t))} onLock={(g_, on) => run(g_.id, () => C.lock(g_.id, on))} />)}</div>
      </>
    } else if (tab === 'matchups') {
      const m = games.filter(g => g.duel)
      body = m.length ? <>
        <Goal items={m.map(g => ({ id: g.id, pick: g.duel.pick, open: g.open, r: g.duel.result }))} total={m.length}
          text={`Who posts the higher Game Score in each game’s top player matchup? Get ${need(m.length)} right to choose a Rare or Common from the day. Get all ${m.length} for the Duel of the Day card.`} />
        <div className={styles.games}>{m.map(g => <MatchupRow key={g.id} g={g} busy={busy === `d${g.id}`} onPick={(g_, p) => g_.duel.pick !== p && run(`d${g_.id}`, () => C.duelPick(g_.id, p))} />)}</div>
      </> : <div className={styles.empty}><b>Matchups aren’t set yet</b><span>They come from the Elo forecast and appear before tipoff.</span></div>
    } else if (tab === 'potd') body = <PotdTab dayWord={dayWord} env={envX} R={R} busy={busy === 'potd'} p={slate.potd || { pick: null, open: false, candidates: [], winner: null }}
      onPick={c => run('potd', () => C.potdPick(slate.day, c ? c.name : '', c ? c.team : ''))} />
    else body = <LineupTab day={slate.day} dayWord={dayWord} lu={slate.lineup} env={envX} slots={R.slots} R={R} busy={!!busy} onSet={(day, slot, card) => run('lineup', () => C.setLineup(day, slot, card))} />
  }
  const right = (
    <div className={styles.right}>
      <div className={styles.sheetHead}><div className={styles.sheetTitle}><b>{title}</b><span>{sub}</span></div>{tools}</div>
      <div className={styles.tabRow}>{sub_}{dayTabs}{recTabs}</div>
      <div className={styles.body}>{body}</div>
    </div>
  )
  return <>
    {children({ left, right, summary: <span><b>Predictions {s.wins}–{s.losses}</b> · {F.rated ? `${sgn(F.over)} vs forecast` : pct(s.pct) + ' right'} · {s.perfect} perfect day{s.perfect === 1 ? '' : 's'}</span> })}
    {reward && <RewardPicker day={reward.day} kind={reward.kind} env={env} onClose={() => setReward(null)} onDone={() => setReward(null)} />}
  </>
}

// ── On the Scoreboard: a pick bar under each of today's and tomorrow's game cards ──
const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
export function usePredSlate(day) {
  const C = useCollector()
  const today = etToday(), tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)
  const live = day === today || day === tomorrow
  useEffect(() => {
    if (!live || !C.me || C.down) return
    C.loadPredictions().catch(() => {})
    const t = setInterval(() => C.loadPredictions().catch(() => {}), 120e3)
    return () => clearInterval(t)
  }, [day, live, !!C.me])
  return live
}

export function PickBar({ day, home, away, state, tip }) {
  const C = useCollector()
  const [busy, setBusy] = useState(false)
  const sl = C.preds?.slates.find(x => x.day === day)
  const g = sl?.games.find(x => x.home === home && x.away === away)
  const openNow = state === 'pre' && (!tip || Date.parse(tip) > Date.now())
  if (C.down || C.me === undefined) return null
  if (!C.me) return openNow ? <div className={styles.bar}><span className={styles.barLab}>Predict the winner</span>
    <button type="button" className={styles.barLink} onClick={() => C.openAuth('signup')}>Sign in to pick</button></div> : null
  if (!g) return null
  const run = async fn => { if (busy) return; setBusy(true); try { await fn() } finally { setBusy(false) } }
  const lockGame = sl.games.find(x => x.lock), lockFixed = lockGame && !lockGame.open
  const d = g.duel
  const btn = (t, on, label, extra, onClick, color) => (
    <button key={t} type="button" className={`${styles.barBtn} ${on ? styles.barOn : ''}`} style={{ '--c': color || '#173657' }} disabled={busy} onClick={onClick} aria-pressed={on}>
      {label}{extra}
    </button>
  )
  if (!g.open) {
    if (!g.pick && !d?.pick) return null
    const res = g.result === 'win' ? `✓ +${(15 + (g.bonus || 0)) * (g.lock ? 2 : 1)} Coins` : g.result === 'loss' ? '✗ Missed' : 'In progress'
    return <div className={`${styles.bar} ${g.result === 'win' ? styles.barWin : g.result === 'loss' ? styles.barLoss : ''}`}>
      {g.pick && <><span className={styles.barLab}>{g.lock ? '★ Lock' : 'Your pick'}</span><b className={styles.barPick}><span className={styles.barLogo}>{binderLogo(g.pick) && <img src={binderLogo(g.pick)} alt="" />}</span>{nick(g.pick)}</b>
        <span className={styles.barRes}>{res}</span></>}
      {d?.pick && <span className={styles.barSub}>Matchup: <b>{shortName(d.pick)}</b> {d.result === 'win' ? '✓' : d.result === 'loss' ? '✗' : d.result === 'void' ? '(void)' : '· in progress'}</span>}
    </div>
  }
  return (
    <div className={styles.bar}>
      <span className={styles.barLab}>{g.pick ? 'Your pick' : 'Pick a winner'}</span>
      <span className={styles.barBtns}>
        {[g.away, g.home].map(t => btn(t, g.pick === t, <><span className={styles.barLogo}>{binderLogo(t) && <img src={binderLogo(t)} alt="" />}</span>{nick(t)}</>,
          g.upset?.[t] > 0 && <em>+{g.upset[t]}</em>, () => g.pick !== t && run(() => C.predict(g.id, t)), binderTeamInfo(t)?.color))}
      </span>
      {g.pick && (g.lock ? <button type="button" className={`${styles.barStar} ${styles.barStarOn}`} disabled={busy} onClick={() => run(() => C.lock(g.id, false))} title="Your Lock of the Day: tap to take it off">★</button>
        : !lockFixed && <button type="button" className={styles.barStar} disabled={busy} onClick={() => run(() => C.lock(g.id, true))} title="Make this your Lock of the Day: double Coins if right">☆</button>)}
      {d && <span className={styles.barRow}>
        <span className={styles.barLab}>Higher GmSc</span>
        <span className={styles.barBtns}>
          {[[d.a, g.away], [d.b, g.home]].map(([n, t]) => btn(n, d.pick === n, shortName(n), null, () => d.pick !== n && run(() => C.duelPick(g.id, n)), binderTeamInfo(t)?.color))}
        </span>
      </span>}
      <button type="button" className={styles.barLink} onClick={() => C.openPredict()}>All picks</button>
    </div>
  )
}
