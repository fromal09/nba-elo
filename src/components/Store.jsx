import { useState, useEffect } from 'react'
import { HOLIDAYS } from './holidays'
import styles from './Store.module.css'
import { Fit, usePull, fromIndex } from './Binders'
import { MiniCard } from './PlayerCard'
import { Coin, TIER_NAME, useCollector, binderFit, FitLine } from './Collector'

/*
 * The Store, as a shop counter that slides in over the Binder Room from the coin stack on your desk. Packs hang on
 * the wall shelves with their prices on tags; today's On This Day singles (1 GOAT, 2 Icons, 3 Legends, 4 Standouts,
 * 5 Rares from games on this date, the same for everyone, new at midnight Eastern) sit in the glass counter on velvet;
 * the brass till is your Coins, and its receipt is today's earnings. Recent sales wait on the returns shelf.
 */

const fmtDay = (d, o = { month: 'long', day: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)
const n0 = v => Math.round(v || 0).toLocaleString()
const PRED_KINDS = ['predict', 'predcorrect', 'upset', 'perfect', 'lock', 'lockloss', 'duelcorrect', 'lineup', 'pickweekly']
const ROWS = [['goat', 1], ['icon', 2], ['legend', 3], ['standout', 4], ['rare', 5]]
// Foil colors by pack: [dark, light, ink]
const FOIL = { holiday: ['#3a1450', '#f07c1a', '#fff3c8'], standard: ['#8e98a2', '#f6f7f8', '#173657'], era: ['#6d3a0c', '#f2a33a', '#2a1404'], storeteam: ['#173657', '#c3d4e6', '#0b1d33'],
  playoff: ['#0b0b0b', '#e7c160', '#f5d98e'], legend: ['#8a6414', '#fff3c8', '#3a2808'], goat: ['#1a1405', '#ffe48a', '#1a1405'] }

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
  const Ccards = useCollector().cards
  const C = env.collector
  const [store, setStore] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [pick, setPick] = useState(null) // the pack taken down off the shelf
  const [receipt, setReceipt] = useState(false)
  const P = usePull(env, null)
  const load = () => C.loadStore().then(setStore).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { if (store && C.me?.coins?.balance !== undefined) load() }, [C.me?.stats?.cards])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && !P.open) { if (pick) setPick(null); else onClose() } }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  })
  const left0 = useCountdown(store?.next || '2099-01-01')
  const me = C.me
  const coins = me?.coins || {}
  const bal = coins.balance ?? 0

  const buyPack = async kind => { setBusy(kind); try { await C.buyPack(kind); setPick(null); load() } finally { setBusy(null) } }
  const buyCard = async ref => { setBusy(ref); try { const s = await C.buyCard(ref); if (s) setStore(s) } finally { setBusy(null) } }
  const undo = async id => { setBusy(`s${id}`); try { const s = await C.buyback(id); if (s) setStore(s) } finally { setBusy(null) } }

  const T = coins.today || {}
  const rates = store?.rates
  const earnRows = !rates ? [] : [
    ['Daily visit', T.visit ? `+${T.visit}` : 'tomorrow', !!T.visit],
    ['Streak bonus', T.streak ? `+${T.streak}` : `${rates.streakPer}/day`, !!T.streak],
    ['Exploring', `${coins.explore?.got || 0}/${coins.explore?.cap || rates.exploreCap}`, (coins.explore?.got || 0) >= rates.exploreCap],
    ['Finished packs', T.pack ? `+${T.pack}` : `${rates.pack} ea`, !!T.pack],
    ['Legend+ pulls', T.big ? `+${T.big}` : `${rates.big} ea`, !!T.big],
    ['Predictions', PRED_KINDS.some(k => T[k]) ? `+${PRED_KINDS.reduce((a, k) => a + (T[k] || 0), 0)}` : 'pick tonight', PRED_KINDS.some(k => T[k])],
    ['Checklists, sets', T.checklist || T.set ? `+${(T.checklist || 0) + (T.set || 0)}` : '100–500', !!(T.checklist || T.set)],
  ]
  const ch = coins.challenge
  const f = store?.featured
  const pk = pick && store?.packs.find(p => p.kind === pick)

  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-label="The Store">
      <div className={styles.shop}>
        <header className={styles.top}>
          <div className={styles.sign}><small>BINDERS · COINS ONLY</small><b>The Store</b></div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Back to your desk">×</button>
        </header>

        {!store ? <p className={styles.wait}>{err || 'Opening the store…'}</p> : <>
          <div className={styles.upper}>
            <section className={styles.wall} aria-labelledby="st-packs">
              <h2 id="st-packs" className={styles.plate}>PACKS{store.era ? ` · ${store.era.name.toUpperCase()} THIS WEEK` : ''}</h2>
              <div className={styles.shelf}>
                {store.packs.map(p => {
                  const [a, b, ink] = p.hol && HOLIDAYS[p.hol] ? [HOLIDAYS[p.hol].a, HOLIDAYS[p.hol].b, HOLIDAYS[p.hol].c] : FOIL[p.kind] || FOIL.standard
                  return (
                    <button key={p.kind} type="button" className={styles.item} data-on={pick === p.kind ? '' : undefined} onClick={() => setPick(k => (k === p.kind ? null : p.kind))}
                      aria-pressed={pick === p.kind} aria-label={`${p.name}, ${n0(p.price)} Coins`}>
                      <span className={styles.foil} style={{ '--a': a, '--b': b, '--ink': ink }}><span>FPR</span><b style={{ fontSize: (n => (n > 8 ? 13 : n > 7 ? 15.5 : n > 5 ? 18 : 20))(p.name.replace(/ Pack$/, '').length) }}>{p.name.replace(/ Pack$/, '')}</b>{p.kind === 'goat' && <i>★</i>}</span>
                      <span className={styles.price}><Coin size={11} />{n0(p.price)}</span>
                    </button>
                  )
                })}
              </div>
              <div className={styles.plank} />
              {pk && <div className={styles.pickCard}>
                <span><b>{pk.name}</b>{pk.desc}</span>
                <button type="button" className={styles.buy} disabled={bal < pk.price || !!busy} onClick={() => buyPack(pk.kind)}>
                  <Coin size={14} />{busy === pk.kind ? 'Opening…' : `Buy · ${n0(pk.price)}`}
                </button>
                {bal < pk.price && <small>{n0(pk.price - bal)} more Coins</small>}
              </div>}
            </section>

            <aside className={styles.tillBox} aria-label="Your Coins">
              <button type="button" className={styles.till} onClick={() => setReceipt(r => !r)} aria-expanded={receipt}>
                <span className={styles.screen}><small>YOUR COINS</small><b>{n0(bal)}</b></span>
                <span className={styles.keys} aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} />)}</span>
                <span className={styles.tillLab}>{receipt ? 'Tear off the receipt' : `${n0(coins.earned)} earned today · see how`}</span>
              </button>
              {receipt && <div className={styles.receipt}>
                <b>TODAY’S COINS · {n0(coins.earned)}</b>
                {ch && <p className={ch.done ? styles.done : ''}>{ch.done ? '✓ ' : ''}Challenge: {ch.text} · {ch.coins}</p>}
                {earnRows.map(([l, v, done]) => <p key={l} className={done ? styles.done : ''}><span>{l}</span><span>{v}</span></p>)}
                <p className={styles.small}>Sell any card a day after you get it, for {Math.round(rates.sellRate * 100)}% of its points (up to {rates.sellCap} a day). Buy it back within {rates.buybackHours} hours.</p>
                <button type="button" className={styles.sellBtn} onClick={onMine}>Sell cards from My binder</button>
              </div>}
            </aside>
          </div>

          <section className={styles.counter} aria-labelledby="st-otd">
            <div className={styles.counterTop} />
            <div className={styles.glass}>
              <div className={styles.glassHead}>
                <h2 id="st-otd">{f.random ? 'Today’s singles' : `${fmtDay(store.day)} in league history`}</h2>
                <span>{f.random ? `No games were ever played on ${fmtDay(store.day)}, so today’s cards come from anywhere.` : `${f.partial ? 'A few are random where a tier had no game on this date. ' : ''}Fifteen cards from games played on this date.`} New cards in {left0}.</span>
              </div>
              {ROWS.map(([tier]) => {
                const row = f.cards.filter(x => x.card.tier === tier)
                if (!row.length) return null
                return (
                  <div key={tier} className={styles.tray}>
                    <span className={styles.trayLab} data-tier={tier}>{TIER_NAME[tier]}</span>
                    <div className={styles.trayRow}>
                      {row.map(x => {
                        const ref = `${x.card.s}|${x.card.id}|${x.card.row.n}`
                        const e = fromIndex(env, x.card, { key: ref })
                        const short = bal < x.price
                        return (
                          <div key={ref} className={styles.single} data-deal={x.deal ? '' : undefined}>
                            {x.deal && <span className={styles.dealTag}>Card of the Day · ½ price</span>}
                            <button type="button" className={styles.slab} onClick={() => P.pull(e)} aria-label={`${x.card.row.n}: preview`}>
                              <Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit>
                            </button>
                            <span className={styles.meta}>{x.points.toLocaleString()} pts{!x.onDate ? ' · random' : ''}</span>
                            <FitLine fit={binderFit(Ccards, x.card)} className={styles.fitLine} />
                            {x.owned ? <span className={styles.owned}>✓ In your binder</span>
                              : <button type="button" className={styles.buy} disabled={short || !!busy} onClick={() => buyCard(ref)} title={short ? `You need ${n0(x.price - bal)} more Coins` : ''}>
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
            <div className={styles.counterFront} />
          </section>

          {store.sold.length > 0 && <section className={styles.returns} aria-labelledby="st-sold">
            <h2 id="st-sold" className={styles.plate}>RETURNS SHELF · BUY BACK WITHIN {store.rates.buybackHours} HOURS</h2>
            <div className={styles.soldRow}>
              {store.sold.map(x => {
                const e = fromIndex(env, x.card, { key: `s${x.id}` })
                const hrs = Math.max(0, store.rates.buybackHours - (Date.now() - Date.parse(x.soldAt)) / 36e5)
                return (
                  <div key={x.id} className={styles.sold}>
                    <span className={styles.soldCard}><Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit></span>
                    <span className={styles.soldText}><b>{x.card.row.n}</b><small>{TIER_NAME[x.card.tier]} · sold for {x.price} · {Math.floor(hrs)}h {Math.floor((hrs % 1) * 60)}m left</small>
                      {x.owned ? <em>Back in your binder</em>
                        : <button type="button" className={styles.buy} disabled={!!busy || bal < x.price} onClick={() => undo(x.id)}><Coin size={13} />Buy back · {x.price}</button>}</span>
                  </div>
                )
              })}
            </div>
          </section>}
        </>}
      </div>
      {P.view}
    </div>
  )
}
