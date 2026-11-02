import { useState, useEffect } from 'react'
import styles from './KingOfTheCourt.module.css'
import fs from './FiveChallenge.module.css'
import { Seg } from './Binders'
import { binderLogo, binderTeamInfo } from './SeasonExplorer'

/*
 * King of the Court, a page of My binder's Games (api/_lib/koc.js has the rules). One player a game, from your own
 * cards: the Group Challenge (six to a group, each game its own contest, a bounty for every Player of the Game) and
 * Rivalries (head to head with another collector for a wager, most games won).
 */

const TIER = { goat: '★ GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare', common: 'Common' }
const TIER_C = { goat: '#c9a24a', icon: '#7b3fa0', legend: '#d4960a', standout: '#2f67a6', rare: '#3f8f5f', common: '#8a95a2' }
const baseName = n => (n || '').replace(/\s*\(.*\)$/, '')
const last = n => baseName(n).split(' ').slice(-1)[0]
const f1 = v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1))
const n0 = v => Math.round(v || 0).toLocaleString()
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const dayName = (d, today) => (d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : d === addDays(today, -1) ? 'Yesterday'
  : new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }))
const tipTime = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const Logo = ({ t, size = 22 }) => <span className={styles.logo} style={{ width: size, height: size }}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>
// Six spots on a half court: the top of the key, both wings, both corners, the low post
const SPOTS = [[50, 20], [20, 38], [80, 38], [9, 72], [91, 72], [50, 60]]

export default function KingOfTheCourt({ env, tools }) {
  const C = env.collector
  const [tab, setTab] = useState('group')
  const [day, setDay] = useState(null)
  const [d, setD] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(null)
  useEffect(() => { setErr(null); C.loadKoc(day).then(setD).catch(e => setErr(e.message)) }, [day])
  const pick = async (mode, game, card) => { setBusy(mode + game); try { const x = await C.kocPick(d.day, mode, game, card); if (x) setD(x) } finally { setBusy(null) } }
  const act = async (id, a) => { const x = await C.rivalAct(id, a, d?.day); if (x) setD(x) }
  const today = d?.today
  const days = today ? [addDays(today, -1), today, addDays(today, 1)] : []
  const rivalDays = d ? [...new Set(d.rivals.filter(r => r.status === 'accepted' || r.status === 'pending' || r.status === 'settled').map(r => r.day))].sort() : []
  return (
    <div className={fs.right}>
      <div className={fs.sheetHead}><div className={fs.sheetTitle}><b>King of the Court</b><span>{d ? dayName(d.day, today) : ''}</span></div>{tools}</div>
      <div className={styles.bar}>
        <Seg value={tab} onChange={setTab} options={[['group', 'Group Challenge'], ['rivals', `Rivalries${d?.rivals.filter(r => r.status === 'pending' && r.you === 'to').length ? ' · new' : ''}`]]} />
        {d && <Seg value={d.day} onChange={setDay} options={[...new Set([...days, ...(tab === 'rivals' ? rivalDays : [])])].sort().map(x => [x, dayName(x, today)])} />}
      </div>
      <div className={fs.body}>
        {err && <p className={styles.err}>{err}</p>}
        {!d && !err && <p className={fs.note}>Loading the slate…</p>}
        {d && tab === 'group' && <Group d={d} busy={busy} onPick={pick} />}
        {d && tab === 'rivals' && <Rivals d={d} busy={busy} onPick={pick} onAct={act} onDay={setDay} />}
      </div>
    </div>
  )
}

function Group({ d, busy, onPick }) {
  const R = d.rules, gv = d.groupView
  const picked = Object.keys(d.group).length
  return <>
    <div className={styles.bounty}><span><small>The bounty</small><b>{n0(d.bounty)}</b><em>Coins</em></span>
      <p>Every game’s Player of the Game in your picks, on a day of {R.bountyMinGames} or more games, takes it all (split if it’s shared). It grows one Coin for every collector who enters, every day, up to {n0(R.bountyCap)}.</p></div>
    {d.bountyWon && <p className={styles.won}>The bounty went to {d.bountyWon.users.length} collector{d.bountyWon.users.length === 1 ? '' : 's'} this day: {n0(d.bountyWon.each)} Coins each.</p>}
    <p className={fs.intro}>Pick one of your players in every game. Your group is six collectors of similar binder strength (computer binders fill a short group), set when the day’s first game tips. Each game is its own contest: the top score (Player of the Game score × your card’s multiplier) wins {R.winMin}–{R.winMax} Coins, {R.potg} more if he was that game’s Player of the Game, and leading every game is a clean sweep worth {R.sweep} more. Rest days carry over from one King of the Court day to the next.</p>
    {!d.entryOpen && !gv && <p className={styles.err}>Entries for this day closed at the first tipoff. Tomorrow’s slate is open.</p>}
    {!d.games.length && <p className={fs.note}>No games this day.</p>}
    {d.games.length > 0 && <p className={fs.note}>{picked} of {d.games.length} games picked{gv ? ` · your group: ${gv.members.map(m => m.you ? 'you' : m.name).join(', ')}` : ''}</p>}
    {d.games.map(g => {
      const res = gv?.games.find(x => x.id === g.id)
      return <GameBlock key={g.id} g={g} mine={d.group[g.id]} cands={d.candidates[g.id] || []} canPick={d.entryOpen && g.open} busy={busy === 'group' + g.id}
        onPick={card => onPick('group', g.id, card)} court={res?.entries} potg={res?.potg} />
    })}
  </>
}

function GameBlock({ g, mine, cands, canPick, busy, onPick, court, potg, versus }) {
  const label = g.state === 'pre' ? tipTime(g.tip) : g.state === 'post' ? `Final ${g.as}–${g.hs}` : `${g.detail || 'Live'} · ${g.as}–${g.hs}`
  return (
    <section className={styles.game}>
      <header><Logo t={g.away} /><b>{g.away}</b><i>@</i><Logo t={g.home} /><b>{g.home}</b><span className={styles.when}>{label}</span></header>
      {canPick ? <div className={styles.pickRow}>
        <select value={mine?.cardId || ''} disabled={busy} onChange={e => onPick(e.target.value ? Number(e.target.value) : null)} aria-label={`Your pick, ${g.away} at ${g.home}`}>
          <option value="">{cands.length ? 'Pick a player…' : 'None of your players play in this game'}</option>
          {cands.map(c => <option key={c.cardId} value={c.cardId} disabled={!!c.resting || c.out}>
            {baseName(c.name)} · {c.team} · {TIER[c.tier]} ×{c.mult}{c.proj != null ? ` · proj ${f1(c.proj)}` : ''}{c.out ? ' · out' : c.resting ? ' · resting' : ''}</option>)}
        </select>
        {mine && <span className={styles.mine}><i style={{ background: TIER_C[mine.tier] }} />{baseName(mine.player)} ×{mine.mult}</span>}
      </div> : mine ? <div className={styles.pickRow}><span className={styles.mine}><i style={{ background: TIER_C[mine.tier] }} />Your pick: {baseName(mine.player)} ({mine.team}) ×{mine.mult}{mine.score != null ? ` · ${f1(mine.score)}` : ''}</span></div>
        : <p className={fs.note}>{g.open ? 'No pick.' : 'No pick in this game.'}</p>}
      {court && <Court entries={court} potg={potg} />}
      {versus}
    </section>
  )
}

// The group's picks for a game, on a half court; the leader glows
function Court({ entries, potg }) {
  const top = Math.max(...entries.map(e => e.score ?? -1e9))
  return (
    <div className={styles.court}>
      <svg viewBox="0 0 100 62" preserveAspectRatio="none" aria-hidden="true">
        <rect x="0" y="0" width="100" height="62" fill="#d9a066" />
        <g fill="none" stroke="rgba(255,255,255,.75)" strokeWidth=".6">
          <rect x=".5" y=".5" width="99" height="61" /><rect x="38" y="40" width="24" height="21.5" /><path d="M38 40 A12 12 0 0 1 62 40" />
          <path d="M6 61.5 L6 50 A44 44 0 0 1 94 50 L94 61.5" /><circle cx="50" cy="57" r="1.4" />
        </g>
      </svg>
      {entries.slice(0, 6).map((e, i) => {
        const [x, y] = SPOTS[i], win = e.win || (e.score != null && e.score === top && top > 0)
        return <div key={e.who} className={styles.spot} data-win={win ? '' : undefined} data-you={e.you || undefined} style={{ left: `${x}%`, top: `${y}%`, '--tc': TIER_C[e.tier] }}>
          <b>{last(e.player)}{potg && baseName(potg) === baseName(e.player) ? ' ★' : ''}</b><small>{e.name}{e.bot ? ' · cpu' : ''}</small><em>{e.score != null ? f1(e.score) : `×${e.mult}`}{e.coins ? ` · +${e.coins}` : ''}</em></div>
      })}
    </div>
  )
}

function Rivals({ d, busy, onPick, onAct, onDay }) {
  const open = d.rivals.filter(r => r.status === 'pending'), on = d.rivals.filter(r => r.status === 'accepted'), past = d.rivals.filter(r => !['pending', 'accepted'].includes(r.status))
  const row = r => (
    <div key={r.id} className={styles.rival}>
      <span><b>{r.you === 'from' ? `You challenged ${r.opp}` : `${r.opp} challenged you`}</b>
        <small>{dayName(r.day, d.today)} · {n0(r.wager)} Coins each{r.status === 'settled' ? ` · ${r.winner === 'you' ? 'you won' : r.winner === 'opp' ? `${r.opp} won` : 'tied, wagers back'}${r.result ? ` (${r.you === 'from' ? r.result.won.join('–') : [...r.result.won].reverse().join('–')})` : ''}` : r.status !== 'pending' && r.status !== 'accepted' ? ` · ${r.status}` : ''}</small></span>
      {r.status === 'pending' && r.you === 'to' && <><button type="button" className={fs.primary} onClick={() => onAct(r.id, 'accept')}>Accept · {n0(r.wager)}</button><button type="button" className={fs.ghost} onClick={() => onAct(r.id, 'decline')}>Decline</button></>}
      {r.status === 'pending' && r.you === 'from' && <button type="button" className={fs.ghost} onClick={() => onAct(r.id, 'cancel')}>Cancel</button>}
      {(r.status === 'accepted' || r.status === 'settled') && r.day !== d.day && <button type="button" className={fs.ghost} onClick={() => onDay(r.day)}>Open</button>}
    </div>
  )
  const here = [...on, ...past, ...open].filter(r => r.day === d.day && r.games)
  return <>
    <p className={fs.intro}>Challenge another collector from their binder (the Challenge button under their name): pick a day and a wager. Yours is held when you send it; theirs when they accept, before that day’s first tipoff. Then it’s one player a game, head to head: most games won takes both wagers; a tie on games goes to the higher total score. Their picks show as each game tips off.</p>
    {open.length > 0 && <><div className={styles.lab}>Waiting on an answer</div>{open.map(row)}</>}
    {on.length > 0 && <><div className={styles.lab}>On</div>{on.map(row)}</>}
    {here.map(r => (
      <div key={'g' + r.id} className={styles.rivalDay}>
        <div className={styles.lab}>{r.you === 'from' ? 'You' : r.opp} vs {r.you === 'from' ? r.opp : 'you'} · {dayName(r.day, d.today)}</div>
        {d.games.map(g => {
          const x = r.games.find(y => y.id === g.id) || {}
          const rg = r.result?.games?.find(y => y.id === g.id)
          const mine = r.you === 'from' ? rg?.a : rg?.b, theirs = r.you === 'from' ? rg?.b : rg?.a
          const versus = <div className={styles.vs}>
            <span data-win={rg?.w && rg.w === (r.you === 'from' ? 'a' : 'b') ? '' : undefined}><small>You</small><b>{x.mine ? baseName(x.mine.player) : '—'}</b><em>{f1(mine?.score ?? x.mine?.score)}</em></span>
            <i>vs</i>
            <span data-win={rg?.w && rg.w !== (r.you === 'from' ? 'a' : 'b') ? '' : undefined}><small>{r.opp}</small><b>{x.theirs ? (x.theirs.hidden ? 'Picked · hidden until tip' : baseName(x.theirs.player)) : '—'}</b><em>{f1(theirs?.score ?? x.theirs?.score)}</em></span>
          </div>
          return <GameBlock key={g.id} g={g} mine={x.mine} cands={d.candidates[g.id] || []} canPick={g.open && (r.status === 'accepted' || r.status === 'pending')} busy={busy === `r${r.id}${g.id}`}
            onPick={card => onPick(`r${r.id}`, g.id, card)} versus={versus} />
        })}
      </div>
    ))}
    {past.length > 0 && <><div className={styles.lab}>Earlier</div>{past.map(row)}</>}
    {!d.rivals.length && <p className={fs.note}>No rivalries yet.</p>}
  </>
}

// From someone else's binder: challenge them to a day, for a wager
export function ChallengeModal({ C, to, onClose }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [day, setDay] = useState(today), [wager, setWager] = useState(100), [busy, setBusy] = useState(false)
  const opts = Array.from({ length: 8 }, (_, i) => addDays(today, i))
  const coins = C.me?.coins?.balance ?? 0
  return (
    <div className={fs.overlay} onClick={onClose}>
      <div className={`${fs.picker} ${styles.chal}`} onClick={e => e.stopPropagation()} role="dialog" aria-label="Challenge to a Rivalry">
        <button type="button" className={fs.x} onClick={onClose} aria-label="Close">×</button>
        <div className={fs.pickHead}><small>King of the Court · Rivalry</small><b>Challenge {to}</b><span>One player a game, head to head. Most games won takes both wagers.</span></div>
        <div className={styles.chalBody}>
          <label>Day<select value={day} onChange={e => setDay(e.target.value)}>{opts.map(x => <option key={x} value={x}>{dayName(x, today)}</option>)}</select></label>
          <label>Wager (Coins each)<input type="number" min="10" step="10" value={wager} onChange={e => setWager(e.target.value)} /><small>You have {n0(coins)}. Yours is held now; it comes back if they decline or the day starts first.</small></label>
        </div>
        <div className={fs.pickFoot}><span /><button type="button" className={fs.primary} disabled={busy || !(wager >= 10) || wager > coins}
          onClick={async () => { setBusy(true); try { if (await C.rival(to, day, Math.floor(wager))) onClose() } finally { setBusy(false) } }}>Send challenge</button></div>
      </div>
    </div>
  )
}
