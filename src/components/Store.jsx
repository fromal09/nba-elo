import { useState, useEffect } from 'react'
import styles from './Store.module.css'
import { Book, Fit, Seg, usePull, useIsPhone, fromIndex } from './Binders'
import { MiniCard } from './PlayerCard'
import { Coin, TIER_NAME } from './Collector'

/*
 * The store: spend Coins on packs, or on today's On This Day cards (1 GOAT, 2 Icons, 3 Legends,
 * 4 Standouts, 5 Rares from games on this date in league history; the same for everyone, new at midnight Eastern).
 * The left page is your Coins: today's earnings against the caps, the daily challenge, how to earn more.
 */

const fmtDay = (d, o = { month: 'long', day: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)
const n0 = v => Math.round(v || 0).toLocaleString()
const PRED_KINDS = ['predict', 'predcorrect', 'upset', 'perfect', 'lock', 'lockloss', 'duelcorrect', 'lineup', 'pickweekly']
const ROWS = [['goat', 1], ['icon', 2], ['legend', 3], ['standout', 4], ['rare', 5]]
const PACK_LOOK = { standard: ['#0b3a66', '#5ec8ff'], era: ['#6d3a0c', '#f2a33a'], storeteam: ['#173657', '#c3d4e6'], playoff: ['#0b0b0b', '#e7c160'], legend: ['#6d4c0c', '#fff1c0'], goat: ['#0a0a0a', '#f5d77a'] }

function useCountdown(next) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30e3); return () => clearInterval(t) }, [])
  // Midnight Eastern, written as a UTC instant (Eastern is UTC-4 in summer, -5 in winter)
  const at = ['-04:00', '-05:00'].map(z => Date.parse(`${next}T00:00:00${z}`)).find(t => {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(t)
    return +h === 0
  })
  const ms = Math.max(0, (at || 0) - Date.now()), h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4)
  return `${h}h ${m}m`
}

export function StoreBook({ env, onClose, onMine }) {
  const phone = useIsPhone()
  const C = env.collector
  const [store, setStore] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('today')
  const [busy, setBusy] = useState(null)
  const P = usePull(env, null)
  const load = () => C.loadStore().then(setStore).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { if (store && C.me?.coins?.balance !== undefined) load() }, [C.me?.stats?.cards])
  const left0 = useCountdown(store?.next || '2099-01-01')
  const me = C.me
  const coins = me?.coins || {}
  const head = <>
    <div className={styles.kicker}>Binders · Store</div>
    <h2 className={styles.title}>The Store</h2>
    <div className={styles.balance}><Coin size={30} /><b>{n0(coins.balance)}</b><span>Coins</span></div>
  </>
  if (!store) return <Book tc="#8a6414" phone={phone} onClose={onClose} head={head} left={<p className={styles.line}>{err || 'Opening the store…'}</p>} right={<div className={styles.right} />} />
  const ch = coins.challenge
  const T = coins.today || {}
  const rates = store.rates
  const earnRows = [
    ['Daily visit', T.visit ? `+${T.visit}` : 'Tomorrow', !!T.visit],
    ['Streak bonus', T.streak ? `+${T.streak}` : `${rates.streakPer}/day of streak`, !!T.streak],
    ['Exploring the site', `${coins.explore?.got || 0} / ${coins.explore?.cap || rates.exploreCap}`, (coins.explore?.got || 0) >= rates.exploreCap],
    ['Finished packs', T.pack ? `+${T.pack}` : `${rates.pack} each`, !!T.pack],
    ['Legend-or-better pulls', T.big ? `+${T.big}` : `${rates.big} each`, !!T.big],
    ['Predictions', PRED_KINDS.some(k => T[k]) ? `+${PRED_KINDS.reduce((a, k) => a + (T[k] || 0), 0)}` : 'Pick today’s games', PRED_KINDS.some(k => T[k])],
    ['Checklists and sets', T.checklist || T.set ? `+${(T.checklist || 0) + (T.set || 0)}` : '100–500', !!(T.checklist || T.set)],
  ]
  const left = <>
    <div className={styles.boxLab}>Today’s Coins · {n0(coins.earned)} earned</div>
    {ch && <div className={`${styles.challenge} ${ch.done ? styles.challengeDone : ''}`}>
      <small>Daily challenge · {ch.coins} Coins</small><b>{ch.done ? '✓ ' : ''}{ch.text}</b>
    </div>}
    <div className={styles.earn}>
      {earnRows.map(([l, v, done]) => <div key={l} className={done ? styles.earnDone : ''}><span>{l}</span><b>{v}</b></div>)}
    </div>
    <details className={styles.help}>
      <summary>How Coins work</summary>
      <p>Earn: {rates.visit} for your first visit each day, plus {rates.streakPer} per streak day (up to {rates.streakMax}); {rates.pack} for finishing a pack;
        {' '}{rates.big} for every Legend or better you keep; {rates.explore} for each part of the site you visit (up to {rates.exploreCap} a day); {rates.challenge} for the daily challenge;
        {' '}100–500 for completing a team-season checklist; 100 for every 10% of a league set; {rates.weeklyTop10} for a top-10 week on the leaderboard, {rates.weeklyTop50} for top 50.
        {rates.pred && <> Predictions: {rates.pred.pick} per pick, {rates.pred.correct} per correct pick, {rates.pred.upsetMin}–{rates.pred.upsetMax} more for calling an upset, and {rates.pred.perfectPer} a game for a perfect day; a correct Lock of the Day doubles its Coins; {rates.pred.duel} per correct matchup; 1 per Game Score point in your lineup (up to {rates.pred.lineupMax}); {rates.pred.weeklyTop10} for a top-10 pick’em week.</>}</p>
      <p>Sell: any card a day after you get it, for {Math.round(rates.sellRate * 100)}% of its points, up to {rates.sellCap} Coins a day. Starred and showcase cards can’t be sold,
        Legends and better ask to confirm, and you can buy a sold card back at the same price for {rates.buybackHours} hours. Selling lowers your binder score.</p>
    </details>
    <button type="button" className={styles.linkBtn} onClick={onMine}>Sell cards from My binder</button>
  </>

  const buyPack = async kind => { setBusy(kind); try { await C.buyPack(kind); load() } finally { setBusy(null) } }
  const buyCard = async ref => { setBusy(ref); try { const s = await C.buyCard(ref); if (s) setStore(s) } finally { setBusy(null) } }
  const undo = async id => { setBusy(`s${id}`); try { const s = await C.buyback(id); if (s) setStore(s) } finally { setBusy(null) } }
  const tabs = <Seg value={tab} onChange={setTab} options={[['today', 'On This Day'], ['packs', 'Packs'], ['sold', `Sold${store.sold.length ? ` · ${store.sold.length}` : ''}`]]} />
  let body
  if (tab === 'today') {
    const f = store.featured
    body = <>
      <div className={`${styles.otdBanner} ${f.random ? styles.otdRandom : ''}`}>
        {f.random
          ? <><b>No NBA games have ever been played on {fmtDay(store.day)}.</b><span>Today’s featured cards are completely random, from anywhere in league history.</span></>
          : <><b>{fmtDay(store.day)} in league history</b><span>{f.partial ? 'Not every tier had a game on this date, so a few cards are random picks. ' : ''}Fifteen cards from games played on this date. New cards in {left0}.</span></>}
      </div>
      <div className={styles.pyramid}>
        {ROWS.map(([tier]) => {
          const row = f.cards.filter(x => x.card.tier === tier)
          if (!row.length) return null
          return (
            <div key={tier} className={styles.tierRow} style={{ '--n': 5 }}>
              <span className={styles.tierLab} data-tier={tier}>{TIER_NAME[tier]}</span>
              <div className={styles.rowCards}>
                {row.map(x => {
                  const ref = `${x.card.s}|${x.card.id}|${x.card.row.n}`
                  const e = fromIndex(env, x.card, { key: ref })
                  const short = (me?.coins?.balance ?? 0) < x.price
                  return (
                    <div key={ref} className={`${styles.offer} ${x.deal ? styles.deal : ''}`}>
                      {x.deal && <span className={styles.dealTag}>Card of the Day · ½ price</span>}
                      <button type="button" className={styles.offerCard} onClick={() => P.pull(e)} aria-label={`${x.card.row.n}: preview`}>
                        <Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit>
                      </button>
                      <span className={styles.offerMeta}>{x.points.toLocaleString()} pts{!x.onDate ? ' · random' : ''}</span>
                      {x.owned ? <span className={styles.owned}>✓ In your binder</span>
                        : <button type="button" className={styles.buy} disabled={short || !!busy} onClick={() => buyCard(ref)} title={short ? `You need ${n0(x.price - (me?.coins?.balance || 0))} more Coins` : ''}>
                          <Coin size={13} />{busy === ref ? '…' : n0(x.price)}{x.deal && <s>{n0(x.full)}</s>}
                        </button>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </>
  } else if (tab === 'packs') {
    body = <div className={styles.packs}>
      {store.packs.map(p => {
        const [a, b] = PACK_LOOK[p.kind] || PACK_LOOK.standard
        const short = (me?.coins?.balance ?? 0) < p.price
        return (
          <div key={p.kind} className={styles.packTile} style={{ '--a': a, '--b': b }} data-kind={p.kind}>
            <div className={styles.packArt}><small>FPR</small><b>{p.name}</b>{p.kind === 'goat' && <i>★</i>}</div>
            <div className={styles.packText}>
              <p>{p.desc}</p>
              <button type="button" className={styles.buy} disabled={short || !!busy} onClick={() => buyPack(p.kind)}>
                <Coin size={13} />{busy === p.kind ? 'Opening…' : n0(p.price)}
              </button>
              {short && <small>{n0(p.price - (me?.coins?.balance || 0))} more Coins</small>}
            </div>
          </div>
        )
      })}
    </div>
  } else {
    body = store.sold.length ? <div className={styles.soldList}>
      {store.sold.map(x => {
        const e = fromIndex(env, x.card, { key: `s${x.id}` })
        const hrs = Math.max(0, store.rates.buybackHours - (Date.now() - Date.parse(x.soldAt)) / 36e5)
        return (
          <div key={x.id} className={styles.soldRow}>
            <span className={styles.soldCard}><Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit></span>
            <span className={styles.soldText}><b>{x.card.row.n}</b><small>{x.card.s} · {TIER_NAME[x.card.tier]} · {x.points.toLocaleString()} pts · sold for {x.price} Coins</small>
              <small>Buyback ends in {Math.floor(hrs)}h {Math.floor((hrs % 1) * 60)}m</small></span>
            {x.owned ? <span className={styles.owned}>Back in your binder</span>
              : <button type="button" className={styles.buy} disabled={!!busy || (me?.coins?.balance ?? 0) < x.price} onClick={() => undo(x.id)}><Coin size={13} />Buy back · {x.price}</button>}
          </div>
        )
      })}
    </div> : <div className={styles.empty}><b>Nothing sold in the last day</b><span>Sell cards from My binder: turn on Sell mode there. Sales can be undone here for 24 hours.</span></div>
  }
  const right = (
    <div className={styles.right}>
      <div className={styles.sheetHead}><div className={styles.sheetTitle}><b>{tab === 'today' ? 'On This Day' : tab === 'packs' ? 'Packs' : 'Recent sales'}</b>
        <span>{tab === 'packs' ? `${store.era.name} Pack this week: ${store.era.years}` : tab === 'today' ? `new in ${left0}` : 'undo within 24 hours'}</span></div>{tabs}</div>
      <div className={styles.body}>{body}</div>
    </div>
  )
  return <>
    <Book tc="#8a6414" phone={phone} onClose={onClose} head={head} left={left} right={right}
      summary={<span><b>{n0(coins.balance)} Coins</b> · {n0(coins.earned)} earned today</span>} onKey={() => P.open} />
    {P.view}
  </>
}
