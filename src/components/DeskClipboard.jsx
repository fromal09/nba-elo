import styles from './DeskClipboard.module.css'
import { goTo } from '../nav.js'
import { etToday } from './liveFeed.js'

// What each item pays, as the server's RATES (coins.js) and PRED (predictions.js) set them
const PAY = { pack: 25, challenge: 40, pick: 5, duel: 10, lineupMax: 250, potd: 25, explore: 10 }
const SLOTS = 5
const read = k => { try { return localStorage.getItem(k) } catch { return null } }
// FanSided Tonight marks the day it was watched (FanSidedTonight.jsx)
export const TONIGHT_KEY = 'fc-tonight-watched'
export const markTonight = () => { try { localStorage.setItem(TONIGHT_KEY, etToday()) } catch { /* private mode */ } }

const tipTime = t => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const dayLabel = () => new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// The daily checklist: a clipboard on the desk. Every line links to where you do it and ticks itself off once it's done.
// state: done | todo | hot (do it before the next tip) | later (not open yet: greyed, doesn't count)
export default function DeskClipboard({ C, onPrize }) {
  const me = C.me
  if (!me) return null
  const p = me.predict || {}, coins = me.coins || {}, t = me.today
  const games = p.games || 0, tipping = p.open > 0
  const room = open => () => goTo('gameroom', { open })
  const watched = read(TONIGHT_KEY) === etToday()
  const items = [
    { k: 'pack', label: 'Open your daily pack', state: t.claimed && !me.open?.length ? 'done' : 'todo', pay: `+${PAY.pack}`,
      note: me.open?.length ? `${me.open[0].picked} of ${me.open[0].total} picked` : t.waiting ? 'opens after last night’s games' : '',
      go: () => (me.open?.length ? C.resume(me.open[0].id) : C.claim()), later: t.waiting && !t.claimed },
    coins.challenge && { k: 'chal', label: 'Today’s challenge', note: coins.challenge.text, state: coins.challenge.done ? 'done' : 'todo', pay: `+${coins.challenge.coins || PAY.challenge}` },
    games > 0 && { k: 'games', label: 'Pick tonight’s games', note: `${p.picked} of ${games} picked`, pay: `+${PAY.pick} a pick`, go: room('predict'),
      state: p.picked >= games || (!tipping && p.picked > 0) ? 'done' : tipping ? 'hot' : 'later' },
    games > 0 && { k: 'lock', label: 'Set your lock', note: 'doubles one pick’s coins', go: room('predict'), state: p.locked ? 'done' : tipping ? 'hot' : 'later' },
    p.duels > 0 && { k: 'duels', label: 'Call the featured matchups', note: `${p.duels_picked} of ${p.duels} called`, pay: `+${PAY.duel} a hit`, go: room('matchups'),
      state: p.duels_picked >= p.duels ? 'done' : tipping ? 'hot' : 'later' },
    games > 0 && { k: 'lineup', label: 'Set your Daily Lineup', note: `${p.lineup || 0} of ${SLOTS} spots`, pay: `up to +${PAY.lineupMax}`, go: room('lineup'),
      state: (p.lineup || 0) >= SLOTS ? 'done' : tipping ? 'todo' : 'later' },
    games > 0 && { k: 'potd', label: 'Pick the Player of the Day', pay: `+${PAY.potd} if right`, go: room('potd'), state: p.potd ? 'done' : tipping ? 'todo' : 'later' },
    p.unclaimed > 0 && { k: 'prize', label: 'Choose your prize card', note: `${p.unclaimed} waiting`, go: onPrize, state: 'hot' },
    coins.explore && { k: 'explore', label: 'Explore the site', note: `${coins.explore.got} of ${coins.explore.cap} coins`, pay: `+${PAY.explore} a page`, go: () => goTo('elo'),
      state: coins.explore.got >= coins.explore.cap ? 'done' : 'todo' },
    games > 0 && { k: 'tonight', label: 'Watch FanSided Tonight', note: p.finals ? 'the night’s recap show' : 'after the first final', go: () => goTo('scoreboard'),
      state: watched ? 'done' : p.finals ? 'todo' : 'later' },
  ].filter(Boolean)
  const week = [
    { k: 'five', label: 'Enter the Five Challenge', note: 'due Sunday', go: room('five'), state: p.five ? 'done' : 'todo' },
    { k: 'team', label: 'Open the weekly team pack', go: () => C.openTeam(), state: me.week?.claimed ? 'done' : 'todo' },
  ]
  const counted = items.filter(x => x.state !== 'later')
  const done = counted.filter(x => x.state === 'done').length
  const hot = counted.filter(x => x.state === 'hot').length

  const Row = ({ x }) => {
    const live = x.state !== 'done' && x.state !== 'later' && x.go
    const body = <>
      <span className={styles.box} aria-hidden="true" />
      <span className={styles.t}><span className={styles.lab}>{x.label}</span>{x.note && <small> · {x.note}</small>}</span>
      {x.state === 'done' ? (x.pay && !/a |if |up to/.test(x.pay) ? <span className={styles.paid}>{x.pay}</span> : null)
        : x.pay && x.state !== 'later' ? <span className={styles.go}>{x.pay} →</span> : live ? <span className={styles.go}>Go →</span> : null}
    </>
    return live
      ? <button type="button" className={styles.ck} data-s={x.state} onClick={x.go}>{body}</button>
      : <div className={styles.ck} data-s={x.state} aria-disabled={x.state === 'later' ? 'true' : undefined}>{body}</div>
  }

  return (
    <section className={styles.clip} aria-label="Today’s checklist">
      <div className={styles.sheet}>
        <div className={styles.head}><b>Today</b><small>{dayLabel()} · {done} of {counted.length}</small></div>
        <div className={styles.sub}>
          {t.streak > 0 && <i>🔥 {t.streak}-day streak</i>}
          {p.next_tip ? <span>{t.streak > 0 ? ' · ' : ''}{hot ? `${hot} to do before the ${tipTime(p.next_tip)} tip` : `next tip ${tipTime(p.next_tip)}`}</span>
            : games ? <span>{t.streak > 0 ? ' · ' : ''}tonight’s games have tipped</span> : <span>{t.streak > 0 ? ' · ' : ''}no games today</span>}
        </div>
        <div role="list">{items.map(x => <div role="listitem" key={x.k}><Row x={x} /></div>)}</div>
        <div className={styles.grp}>This week</div>
        <div role="list">{week.map(x => <div role="listitem" key={x.k}><Row x={x} /></div>)}</div>
        <p className={styles.hand}>+{(coins.earned || 0).toLocaleString()} coins so far today</p>
      </div>
    </section>
  )
}
