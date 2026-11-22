import { useState, useEffect, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { binderTeamInfo, binderHeadshots } from './SeasonExplorer'
import { TIER_NAME } from './Collector'
import { norm } from './predict'
import './DailyLineup.css'

/*
 * The Daily Lineup (api/_lib/predictions.js has the rules): five cards from your binder, of players who play that day.
 * Each slot scores its player's Game Score times the card's multiplier, 1 Coin a point up to the cap. Slots lock at
 * their game's tipoff; the best cards rest between lineups. Same rules and flow as the Pick'em tab, laid out as an app:
 * the day, your five, then your player pool.
 */
const MULT_TIERS = ['goat', 'icon', 'legend', 'standout', 'rare', 'common']
const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const n1 = v => (v == null ? '—' : (+v).toFixed(1))
const xFmt = m => `${+Number(m || 1).toFixed(2)}×`
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const shortName = n => { const [f, ...r] = baseName(n).split(' '); return r.length ? `${f[0]}. ${r.join(' ')}` : f }
const tip = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const shortDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const tColor = fc => binderTeamInfo(fc)?.color || '#3a4656'
const restText = r => (r.until ? `Resting until ${shortDay(r.until)}` : `In your ${shortDay(r.next)} lineup · needs ${r.days} days between`)
const DAYS = [['-1', 'Yesterday'], ['0', 'Today'], ['1', 'Tomorrow']]

let SHOTS = null
function useShots() {
  const [s, set] = useState(SHOTS || {})
  useEffect(() => { if (!SHOTS) binderHeadshots().then(x => { SHOTS = x; set(x) }).catch(() => {}) }, [])
  return s
}
const Avatar = ({ name, team, shots, size = 40 }) => {
  const h = shots?.[norm(name)]?.headshot
  return <span className="dl-av" style={{ width: size, height: size, '--tc': tColor(team) }}>{h ? <img src={h} alt="" /> : <b>{baseName(name).split(' ').map(w => w[0]).slice(0, 2).join('')}</b>}</span>
}
const Tier = ({ tier, mult, on, onClick, rest }) => {
  const El = onClick ? 'button' : 'span'
  return <El type={onClick ? 'button' : undefined} className="dl-tier" data-tier={tier} aria-pressed={onClick ? !!on : undefined} data-rest={rest ? '' : undefined} onClick={onClick}>
    {TIER_NAME[tier] || tier}<b>{xFmt(mult)}</b></El>
}

export default function DailyLineup({ env, onClose }) {
  const C = env.collector
  const [err, setErr] = useState(null)
  const [di, setDi] = useState('0')
  const [busy, setBusy] = useState(false)
  const [rules, setRules] = useState(false)
  useEffect(() => { C.loadPredictions().catch(e => setErr(e.message)) }, [])
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } }, [])
  const d = C.preds
  const R = d?.rates || {}
  const slate = !d ? null : di === '-1' ? (d.prev || { day: '', games: [], lineup: { slots: [], candidates: [], graded: null } }) : d.slates[+di]
  const set = async (slot, cardId) => { setBusy(true); try { await C.setLineup(slate.day, slot, cardId) } finally { setBusy(false) } }
  return createPortal(<div className="dl">
    <div className="dl-app">
      <header className="dl-top">
        <button type="button" className="dl-icon" onClick={onClose} aria-label="Back to the Game Room"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg></button>
        <h1>Daily Lineup</h1>
        <button type="button" className="dl-icon" onClick={() => setRules(true)} aria-label="How the Daily Lineup scores"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg></button>
      </header>
      <div className="dl-days" role="tablist">{DAYS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={di === k} onClick={() => setDi(k)}>{l}</button>)}</div>
      {err && <p className="dl-err" role="alert">{err}</p>}
      {!d ? <div className="dl-skel" aria-label="Loading"><i /><i /><i /><i /></div>
        : <Day key={slate.day + di} slate={slate} di={di} R={R} busy={busy} set={set} />}
    </div>
    {rules && <Rules R={R} close={() => setRules(false)} />}
  </div>, document.body)
}

function Day({ slate, di, R, busy, set }) {
  const shots = useShots()
  const lu = slate.lineup || { slots: [], candidates: [], graded: null }
  const N = R.slots || 5
  const dayWord = di === '-1' ? 'yesterday' : di === '0' ? 'today' : 'tomorrow'
  const free = [...Array(N).keys()].find(i => !lu.slots.some(s => s.slot === i))
  const byName = useMemo(() => new Map(lu.candidates.map(c => [c.name, c])), [lu.candidates])
  // Projected points for each filled slot: his projected Game Score × the card's multiplier
  const projOf = s => { const c = byName.get(s.player); return c?.proj ? c.proj.gs * (s.mult || 1) : null }
  const scored = lu.slots.some(s => s.pts != null)
  const total = lu.graded ? +lu.graded.total : scored ? lu.slots.reduce((a, s) => a + (s.pts ?? 0), 0) : lu.slots.reduce((a, s) => a + (projOf(s) ?? 0), 0)
  const firstLock = lu.slots.filter(s => s.open && s.tip).map(s => s.tip).sort()[0] || lu.candidates.filter(c => c.open).map(c => c.tip).sort()[0]
  const max = R.lineupMax || 250
  return <div className="dl-scroll">
    <section className="dl-sum">
      <div className="dl-sumtop">
        <span><small>{lu.graded ? 'Final' : scored ? 'Scored' : 'Projected'}</small><b>{lu.slots.length ? n1(total) : '—'}<em>pts</em></b></span>
        <span className="dl-sumr"><small>{lu.graded ? 'Coins earned' : 'Coins'}</small><b>+{lu.graded ? n0(lu.graded.coins) : lu.slots.length ? n0(Math.min(max, total)) : 0}</b></span>
      </div>
      <div className="dl-bar"><i style={{ width: `${Math.min(100, (total / max) * 100)}%` }} /></div>
      <div className="dl-sumfoot"><span>{lu.slots.length} of {N} filled</span><span>{lu.graded ? shortDay(slate.day) : firstLock ? `First lock ${tip(firstLock)}` : `Up to ${max} Coins`}</span></div>
    </section>

    <section className="dl-five">
      {[...Array(N).keys()].map(i => {
        const s = lu.slots.find(x => x.slot === i)
        if (!s) return <div key={i} className="dl-slot dl-empty"><span className="dl-num">{i + 1}</span><span className="dl-plus" aria-hidden="true">+</span><span className="dl-et">{free === i && lu.candidates.length ? 'Add a player from your pool' : 'Open slot'}</span></div>
        const pj = projOf(s)
        return <div key={i} className="dl-slot" style={{ '--tc': tColor(s.team) }}>
          <span className="dl-num">{i + 1}</span>
          <Avatar name={s.player} team={s.team} shots={shots} size={42} />
          <span className="dl-st"><b>{shortName(s.player)}</b><small>{s.team} {s.home ? 'vs' : '@'} {s.opp || '—'}{s.tip && s.open ? ` · ${tip(s.tip)}` : ''}</small>{s.tier && <Tier tier={s.tier} mult={s.mult} />}</span>
          <span className="dl-sr">
            {s.gs != null ? <><b>{n1(s.pts)}</b><small>{s.mult > 1 ? `${n1(s.gs)} GmSc` : 'pts'}</small></>
              : <><b className="dl-proj">{pj != null ? n1(pj) : '—'}</b><small>{s.open ? 'proj' : 'live'}</small></>}
          </span>
          {s.open && s.gs == null ? <button type="button" className="dl-x" disabled={busy} onClick={() => set(i, null)} aria-label={`Remove ${baseName(s.player)}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            : <span className="dl-lock" aria-label="Locked"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>}
        </div>
      })}
    </section>

    {lu.candidates.length > 0 ? <Pool lu={lu} dayWord={dayWord} R={R} busy={busy} free={free} add={(cardId) => set(free, cardId)} shots={shots} />
      : !lu.slots.length && <div className="dl-emptystate"><b>{di === '-1' ? 'No lineup yesterday' : `None of your players play ${dayWord}`}</b><span>Game cards of current players count, from any season. Open packs to find some.</span></div>}
  </div>
}

function Pool({ lu, dayWord, R, busy, free, add, shots }) {
  const [q, setQ] = useState('')
  const [team, setTeam] = useState('')
  const [sort, setSort] = useState('proj')
  const [pick, setPick] = useState({}) // player → chosen card id
  const [showOut, setShowOut] = useState(false)
  const taken = new Set(lu.slots.map(s => s.player))
  const teams = [...new Set(lu.candidates.map(c => c.team))].sort()
  const top3 = new Map([...lu.candidates].filter(c => c.proj && !c.out).sort((a, b) => b.proj.gs - a.proj.gs).slice(0, 3).map((c, i) => [c.name, i + 1]))
  const f = norm(q)
  const list = lu.candidates.filter(c => (!team || c.team === team) && (!q || norm(c.name).includes(f)))
  const chosenOf = c => { const cards = c.cards || [{ cardId: c.cardId, tier: c.tier, mult: c.mult, resting: c.resting }]; return [cards, cards.find(x => x.cardId === pick[c.name]) || cards[0]] }
  const val = c => (c.proj?.gs ?? -99) * (chosenOf(c)[1].mult || 1)
  const sorted = [...list].sort((a, b) => b.open - a.open || (sort === 'proj' ? val(b) - val(a) : b.elo - a.elo))
  const ok = sorted.filter(c => !c.out), out = sorted.filter(c => c.out)
  const row = c => {
    const [cards, ch] = chosenOf(c)
    const inIt = taken.has(c.name) || lu.slots.some(s => s.cardId === ch.cardId)
    const why = inIt ? 'In lineup' : !c.open ? 'Started' : ch.resting ? 'Resting' : free == null ? 'Full' : null
    return <div key={c.name} className="dl-p" data-in={inIt ? '' : undefined} data-out={c.out ? '' : undefined} style={{ '--tc': tColor(c.team) }}>
      <Avatar name={c.name} team={c.team} shots={shots} size={40} />
      <div className="dl-pt">
        <b>{baseName(c.name)}{top3.has(c.name) && <em>Proj #{top3.get(c.name)}</em>}</b>
        <small>{c.team} {c.home ? 'vs' : '@'} {c.opp} · {c.open ? tip(c.tip) : 'started'}{c.status ? ` · ${c.status}` : ''}</small>
        {!c.out && c.proj && <small className="dl-pp">{c.proj.pts}/{c.proj.trb}/{c.proj.ast} · {n1(c.proj.gs)} GmSc{ch.mult > 1 ? <> → <b>{n1(c.proj.gs * ch.mult)} pts</b></> : ''}</small>}
        <div className="dl-tiers">{cards.length > 1 ? cards.map(x => <Tier key={x.cardId} tier={x.tier} mult={x.mult} rest={!!x.resting} on={x.cardId === ch.cardId} onClick={() => setPick(v => ({ ...v, [c.name]: x.cardId }))} />) : <Tier tier={ch.tier} mult={ch.mult} rest={!!ch.resting} />}</div>
        {ch.resting && <small className="dl-rest">{TIER_NAME[ch.tier]} card · {restText(ch.resting)}</small>}
      </div>
      <button type="button" className="dl-add" disabled={busy || !!why} onClick={() => add(ch.cardId)} aria-label={why || `Add ${baseName(c.name)}`}>
        {inIt ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg> : why ? <span>{why}</span> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>}
      </button>
    </div>
  }
  return <section className="dl-pool">
    <div className="dl-ph"><h2>Your players {dayWord}</h2><span>{list.length < lu.candidates.length ? `${list.length} of ` : ''}{lu.candidates.length}</span></div>
    <div className="dl-tools">
      <label className="dl-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search players" type="search" aria-label="Search players" /></label>
      <select className="dl-sel" value={team} onChange={e => setTeam(e.target.value)} aria-label="Filter by team"><option value="">All teams</option>{teams.map(t => <option key={t} value={t}>{t}</option>)}</select>
    </div>
    <div className="dl-chips">
      {[['proj', 'Projected pts'], ['elo', 'Elo']].map(([k, l]) => <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}
      <span className="dl-mults">{MULT_TIERS.map(t => <span key={t} data-tier={t} title={TIER_NAME[t]}>{xFmt(R.lineupMult?.[t])}</span>)}</span>
    </div>
    <div className="dl-list">{ok.map(row)}</div>
    {out.length > 0 && <>
      <button type="button" className="dl-outhead" onClick={() => setShowOut(v => !v)} aria-expanded={showOut}>Ruled out · {out.length}<svg viewBox="0 0 24 24" aria-hidden="true"><path d={showOut ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg></button>
      {showOut && <div className="dl-list">{out.map(row)}</div>}
    </>}
  </section>
}

function Rules({ R, close }) {
  const M = R.lineupMult || {}, Rest = R.lineupRest || {}
  return <div className="dl-sheetwrap" onClick={close}>
    <div className="dl-sheet" role="dialog" aria-label="How the Daily Lineup scores" onClick={e => e.stopPropagation()}>
      <span className="dl-grab" aria-hidden="true" />
      <h3>How it scores</h3>
      <p>Put five cards from your binder in your lineup, of players who play that day. Each scores its player’s Game Score times the card’s multiplier: 1 Coin a point, up to {R.lineupMax ?? 250}.</p>
      <p>Each slot locks when that player’s game tips off and scores once every game of the day is final. Have the Player of the Day in it and it scores {R.lineupPotd ?? 10} more, Coins included.</p>
      <div className="dl-mtable">{MULT_TIERS.map(t => <div key={t} data-tier={t}><span className="dl-tier" data-tier={t}>{TIER_NAME[t]}</span><b>{xFmt(M[t])}</b><small>{Rest[t] ? `${Rest[t]}-day rest` : 'No rest'}</small></div>)}</div>
      <button type="button" className="dl-done" onClick={close}>Got it</button>
    </div>
  </div>
}
