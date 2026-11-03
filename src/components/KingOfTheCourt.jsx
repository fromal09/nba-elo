import { useState, useEffect } from 'react'
import styles from './KingOfTheCourt.module.css'
import fs from './FiveChallenge.module.css'
import { Seg, Fit, fromIndex } from './Binders'
import { MiniCard } from './PlayerCard'
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
const initials = n => baseName(n).split(' ').map(w => w[0]).slice(0, 2).join('')
const f1 = v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1))
const n0 = v => Math.round(v || 0).toLocaleString()
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const dayName = (d, today) => (d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : d === addDays(today, -1) ? 'Yesterday'
  : new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }))
const tipTime = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const Logo = ({ t, size = 22 }) => <span className={styles.logo} style={{ width: size, height: size }}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>

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
        {d && tab === 'group' && <Group env={env} d={d} busy={busy} onPick={pick} />}
        {d && tab === 'rivals' && <Rivals env={env} d={d} busy={busy} onPick={pick} onAct={act} onDay={setDay} onReload={() => C.loadKoc(day).then(setD).catch(() => {})} />}
      </div>
    </div>
  )
}

function Group({ env, d, busy, onPick }) {
  const R = d.rules, gv = d.groupView
  const picked = Object.keys(d.group).length
  return <>
    <div className={styles.bounty}><span><small>The bounty</small><b>{n0(d.bounty)}</b><em>Coins</em></span>
      <p>Every game’s Player of the Game in your picks, on a day of {R.bountyMinGames} or more games, takes it all (split if it’s shared). It grows one Coin for every collector who enters, every day, up to {n0(R.bountyCap)}.</p></div>
    {d.bountyWon && <p className={styles.won}>The bounty went to {d.bountyWon.users.length} collector{d.bountyWon.users.length === 1 ? '' : 's'} this day: {n0(d.bountyWon.each)} Coins each.</p>}
    <p className={fs.intro}>Pick one of your players in every game. Your group is six collectors of similar binder strength (computer binders fill a short group), set when the day’s first game tips. Each game is its own contest: the top score (Player of the Game score × your card’s multiplier; a tie goes to the higher-Elo card) wins {R.winMin}–{R.winMax} Coins, {R.potg} more if he was that game’s Player of the Game, and leading every game is a clean sweep worth {R.sweep} more. Rest days carry over from one King of the Court day to the next.</p>
    {!d.entryOpen && !gv && <p className={styles.err}>Entries for this day closed at the first tipoff. Tomorrow’s slate is open.</p>}
    {!d.games.length && <p className={fs.note}>No games this day.</p>}
    {d.games.length > 0 && <p className={fs.note}>{picked} of {d.games.length} games picked{gv ? ` · your group: ${gv.members.map(m => m.you ? 'you' : m.name).join(', ')}` : ''}</p>}
    {d.games.map(g => {
      const res = gv?.games.find(x => x.id === g.id)
      return <GameBlock key={g.id} env={env} g={g} mine={d.group[g.id]} cands={d.candidates[g.id] || []} canPick={d.entryOpen && g.open} busy={busy === 'group' + g.id}
        onPick={card => onPick('group', g.id, card)} court={res?.entries && <Court env={env} entries={res.entries} potg={res.potg} provisional={res.provisional} live={g.state === 'in'} settled={gv.settled} />} />
    })}
  </>
}

function GameBlock({ env, g, mine, cands, canPick, busy, onPick, court, versus }) {
  const label = g.state === 'pre' ? tipTime(g.tip) : g.state === 'post' ? `Final ${g.as}–${g.hs}` : `${g.detail || 'Live'} · ${g.as}–${g.hs}`
  const [open, setOpen] = useState(false)
  const ok = cands.filter(c => !c.out && !c.resting).length
  return (
    <section className={styles.game}>
      <header><Logo t={g.away} /><b>{g.away}</b><i>@</i><Logo t={g.home} /><b>{g.home}</b><span className={styles.when}>{label}</span></header>
      {canPick ? <div className={styles.pickRow}>
        {mine && <span className={styles.mine}><i style={{ background: TIER_C[mine.tier] }} />{baseName(mine.player)} ×{mine.mult}</span>}
        <button type="button" className={styles.chooseBtn} disabled={busy || !cands.length} onClick={() => setOpen(true)}>
          {!cands.length ? 'None of your players play in this game' : busy ? 'Saving…' : mine ? 'Change your player' : `Choose your player · ${ok} available`}</button>
      </div> : mine ? <div className={styles.pickRow}><span className={styles.mine}><i style={{ background: TIER_C[mine.tier] }} />Your pick: {baseName(mine.player)} ({mine.team}) ×{mine.mult}{mine.score != null ? ` · ${f1(mine.score)}` : ''}</span></div>
        : <p className={fs.note}>{g.open ? 'No pick.' : 'No pick in this game.'}</p>}
      {open && <PickModal env={env} g={g} label={label} cands={cands} mine={mine} onClose={() => setOpen(false)} onPick={card => { setOpen(false); onPick(card) }} />}
      {court}
      {versus}
    </section>
  )
}

// Your players in one game, as the actual cards you'd play: tap one to pick him
function PickModal({ env, g, label, cands, mine, onClose, onPick }) {
  const byId = new Map((env.collector.cards || []).map(x => [Number(x.id), x.card]))
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [])
  return (
    <div className={styles.pmOverlay} onClick={onClose}>
      <div className={styles.pm} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Choose your player, ${g.away} at ${g.home}`}>
        <button type="button" className={fs.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.pmHead}><small>{g.away} @ {g.home} · {label}</small><b>Choose your player</b>
          <span>Your best card of each player in this game. Score = his Player of the Game score × the card’s multiplier.</span></div>
        <div className={styles.pmGrid}>
          {cands.map(c => {
            const card = byId.get(c.cardId), e = card && fromIndex(env, card, { key: String(c.cardId) })
            const off = c.out || !!c.resting, on = mine?.cardId === c.cardId
            return <button key={c.cardId} type="button" className={styles.pmCard} data-on={on ? '' : undefined} disabled={off} onClick={() => onPick(c.cardId)}>
              <span className={styles.pmFace}>{e ? <Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit>
                : <i style={{ background: TIER_C[c.tier] }}>{last(c.name)}</i>}</span>
              <b>{baseName(c.name)}</b>
              <small><em style={{ color: TIER_C[c.tier] }}>{TIER[c.tier]} ×{c.mult}</em>{c.proj != null ? ` · proj ${f1(c.proj)}` : ''}</small>
              {c.out ? <strong>Out tonight</strong> : c.resting ? <strong>Resting</strong> : on ? <strong data-on="">Your pick</strong> : null}
            </button>
          })}
        </div>
        {mine && <div className={styles.pmFoot}><button type="button" className={styles.clearBtn} onClick={() => onPick(null)}>Clear my pick</button></div>}
      </div>
    </div>
  )
}

// One pick's card: the actual card a collector played, or a stand-in for a computer binder (it has no cards)
function PickCard({ env, e }) {
  const x = e.card && fromIndex(env, e.card, { key: String(e.cardId) })
  return x ? <Fit><MiniCard name={x.name} row={x.row} game={x.game} team={x.team} headshot={env.headshot(x.name)} /></Fit>
    : <span className={styles.botCard} style={{ '--tc': TIER_C[e.tier] }}><i>{initials(e.player)}</i><b>{last(e.player)}</b><small>{TIER[e.tier]}{e.bot ? ' · cpu' : ''}</small></span>
}

// The group's picks for a game: their cards on a half court, best first (the leader at the top of the key), then the
// standings. Scores so far until the day settles; a tie on score goes to the higher-Elo card
const CARD_SPOTS = [[50, 25], [19, 25], [81, 25], [50, 71], [19, 71], [81, 71]]
function Court({ env, entries, potg, provisional, live, settled }) {
  const scored = entries.some(e => e.score != null)
  const isLead = e => e.win || e.lead
  return <>
    <div className={styles.court}>
      <svg viewBox="0 0 100 78" preserveAspectRatio="none" aria-hidden="true">
        <rect x="0" y="0" width="100" height="78" fill="#d9a066" />
        <g fill="none" stroke="rgba(255,255,255,.7)" strokeWidth=".6">
          <rect x=".5" y=".5" width="99" height="77" /><rect x="38" y="52" width="24" height="25.5" /><path d="M38 52 A12 12 0 0 1 62 52" />
          <path d="M6 77.5 L6 62 A44 44 0 0 1 94 62 L94 77.5" /><circle cx="50" cy="72" r="1.4" />
        </g>
      </svg>
      {entries.slice(0, 6).map((e, i) => {
        const [x, y] = CARD_SPOTS[i]
        return <div key={e.who} className={styles.cspot} data-win={scored && isLead(e) ? '' : undefined} data-you={e.you ? '' : undefined} style={{ left: `${x}%`, top: `${y}%`, '--tc': TIER_C[e.tier] }}>
          <span className={styles.cface}><PickCard env={env} e={e} /></span>
          <span className={styles.clab}><b>{scored ? `${e.rank}. ` : ''}{e.you ? 'You' : e.name}</b>{scored && <em>{f1(e.score)}</em>}</span>
        </div>
      })}
    </div>
    <div className={styles.stand}>
      <div className={styles.standHead}><b>{!scored ? 'Picks' : settled || !provisional ? 'Final standings' : live ? 'Standings · live' : 'Standings · final box score'}</b>
        <span>{!scored ? 'Scores come in as the game goes.' : provisional ? 'Game Score plus a sixth of the Elo swing, from the live box score. Official once the night’s data is in. Ties go to the higher-Elo card.' : 'Ties go to the higher-Elo card.'}</span></div>
      <table>
        <thead><tr><th>#</th><th>Collector</th><th>Player</th><th className={styles.num}>Card Elo</th><th className={styles.num}>×</th><th className={styles.num}>Score</th></tr></thead>
        <tbody>{entries.map(e => (
          <tr key={e.who} data-win={scored && isLead(e) ? '' : undefined} data-you={e.you ? '' : undefined}>
            <td>{scored ? e.rank : '—'}</td>
            <td>{e.you ? 'You' : e.name}{e.bot ? <small> · cpu</small> : null}</td>
            <td><i style={{ background: TIER_C[e.tier] }} />{baseName(e.player)}{potg && baseName(potg) === baseName(e.player) ? ' ★' : ''}</td>
            <td className={styles.num}>{e.elo ? n0(e.elo) : '—'}</td>
            <td className={styles.num}>{e.mult}</td>
            <td className={styles.num}><b>{e.score != null ? f1(e.score) : '—'}</b>{e.coins ? <small> +{e.coins}</small> : null}</td>
          </tr>))}</tbody>
      </table>
      {potg && <p className={styles.potgNote}>★ Player of the Game: {baseName(potg)}</p>}
    </div>
  </>
}

function Rivals({ env, d, busy, onPick, onAct, onDay, onReload }) {
  const [chal, setChal] = useState(false)
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
    <div className={styles.chalRow}><button type="button" className={styles.chooseBtn} onClick={() => setChal(true)}>⚔ Challenge a collector</button></div>
    {chal && <ChallengeModal C={env.collector} onClose={() => { setChal(false); onReload() }} />}
    <p className={fs.intro}>Challenge another collector here or from their binder: pick a day and a wager. Yours is held when you send it; theirs when they accept, before that day’s first tipoff. Then it’s one player a game, head to head: most games won takes both wagers; a tie on games goes to the higher total score. Their picks show as each game tips off.</p>
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
            <span data-win={rg?.w && rg.w === (r.you === 'from' ? 'a' : 'b') ? '' : undefined}>{x.mine?.card && <span className={styles.vsCard}><PickCard env={env} e={x.mine} /></span>}<small>You</small><b>{x.mine ? baseName(x.mine.player) : '—'}</b><em>{f1(mine?.score ?? x.mine?.score)}{!rg && x.mine?.provisional ? ' so far' : ''}</em></span>
            <i>vs</i>
            <span data-win={rg?.w && rg.w !== (r.you === 'from' ? 'a' : 'b') ? '' : undefined}>{x.theirs?.card && <span className={styles.vsCard}><PickCard env={env} e={x.theirs} /></span>}<small>{r.opp}</small><b>{x.theirs ? (x.theirs.hidden ? 'Picked · hidden until tip' : baseName(x.theirs.player)) : '—'}</b><em>{f1(theirs?.score ?? x.theirs?.score)}{!rg && x.theirs?.provisional ? ' so far' : ''}</em></span>
          </div>
          return <GameBlock key={g.id} env={env} g={g} mine={x.mine} cands={d.candidates[g.id] || []} canPick={g.open && (r.status === 'accepted' || r.status === 'pending')} busy={busy === `r${r.id}${g.id}`}
            onPick={card => onPick(`r${r.id}`, g.id, card)} versus={versus} />
        })}
      </div>
    ))}
    {past.length > 0 && <><div className={styles.lab}>Earlier</div>{past.map(row)}</>}
    {!d.rivals.length && <p className={fs.note}>No rivalries yet.</p>}
  </>
}

// From someone else's binder: challenge them to a day, for a wager
export function ChallengeModal({ C, to: fixed, onClose }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [day, setDay] = useState(today), [wager, setWager] = useState(100), [busy, setBusy] = useState(false)
  // From the Rivalries page: name anyone, with the leaderboard as suggestions
  const [who, setWho] = useState(''), [names, setNames] = useState([])
  useEffect(() => {
    if (fixed) return
    fetch('/api/collect?action=leaders', { credentials: 'same-origin' }).then(r => r.json())
      .then(d => setNames((d.leaders || []).map(x => x.username).filter(n => n && n !== C.me?.username))).catch(() => {})
  }, [fixed])
  const to = fixed || who.trim()
  const opts = Array.from({ length: 8 }, (_, i) => addDays(today, i))
  const coins = C.me?.coins?.balance ?? 0
  return (
    <div className={fs.overlay} onClick={onClose}>
      <div className={`${fs.picker} ${styles.chal}`} onClick={e => e.stopPropagation()} role="dialog" aria-label="Challenge to a Rivalry">
        <button type="button" className={fs.x} onClick={onClose} aria-label="Close">×</button>
        <div className={fs.pickHead}><small>King of the Court · Rivalry</small><b>{fixed ? `Challenge ${fixed}` : 'Challenge a collector'}</b><span>One player a game, head to head. Most games won takes both wagers.</span></div>
        <div className={styles.chalBody}>
          {!fixed && <label>Collector<input list="koc-names" value={who} onChange={e => setWho(e.target.value)} placeholder="Their username" autoFocus />
            <datalist id="koc-names">{names.map(n => <option key={n} value={n} />)}</datalist></label>}
          <label>Day<select value={day} onChange={e => setDay(e.target.value)}>{opts.map(x => <option key={x} value={x}>{dayName(x, today)}</option>)}</select></label>
          <label>Wager (Coins each)<input type="number" min="10" step="10" value={wager} onChange={e => setWager(e.target.value)} /><small>You have {n0(coins)}. Yours is held now; it comes back if they decline or the day starts first.</small></label>
        </div>
        <div className={fs.pickFoot}><span /><button type="button" className={fs.primary} disabled={busy || !to || !(wager >= 10) || wager > coins}
          onClick={async () => { setBusy(true); try { if (await C.rival(to, day, Math.floor(wager))) onClose() } finally { setBusy(false) } }}>Send challenge</button></div>
      </div>
    </div>
  )
}
