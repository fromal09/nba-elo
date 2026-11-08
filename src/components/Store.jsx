import { useState, useEffect, useRef } from 'react'
import { BRAND } from '../brand.js'
import { useAutoTour } from './Tour'
import { HOLIDAYS } from './holidays'
import styles from './Store.module.css'
import { Fit, usePull, fromIndex } from './Binders'
import { MiniCard } from './PlayerCard'
import { Coin, TIER_NAME, useCollector, binderFit, FitLine } from './Collector'

/*
 * The Store, a card shop that opens over the Binder Room from the coin stack on your desk. Packs hang on pegboard
 * hooks under track lights with shelf tags for prices; the brass register is your Coins (its receipt: today's
 * earnings); today's On This Day singles (1 GOAT, 2 Icons, 3 Legends, 4 Standouts, 5 Rares from games on this date,
 * the same for everyone, new at midnight Eastern) stand in a lit glass case, one row you scroll sideways. Recent
 * sales wait on the returns shelf.
 */

const fmtDay = (d, o = { month: 'long', day: 'numeric' }) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)
const n0 = v => Math.round(v || 0).toLocaleString()
const PRED_KINDS = ['predict', 'predcorrect', 'upset', 'perfect', 'lock', 'lockloss', 'duelcorrect', 'lineup', 'pickweekly']
const TIER_ORDER = ['goat', 'icon', 'legend', 'standout', 'rare']
// Foil by pack: [dark, light, ink]
const FOIL = { holiday: ['#3a1450', '#f07c1a', '#fff3c8'], standard: ['#8e98a2', '#f6f7f8', '#173657'], era: ['#6d3a0c', '#f2a33a', '#2a1404'], storeteam: ['#173657', '#c3d4e6', '#0b1d33'],
  playoff: ['#0b0b0b', '#e7c160', '#f5d98e'], legend: ['#8a6414', '#fff3c8', '#3a2808'], goat: ['#1a1405', '#ffe48a', '#1a1405'] }
const TAG = { standard: 'RARE+ LAST', era: 'ERA · THIS WEEK', storeteam: 'YOU PICK', playoff: 'FINALS LAST', legend: 'LEGEND+', goat: '★ GUARANTEED', holiday: 'HOLIDAY' }
const LAMPS = [10, 30, 50, 70, 90]

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

// A sideways row with arrows, fading edges and page pips; where you are in it (0 to 1)
function useRail() {
  const ref = useRef(null)
  const [p, setP] = useState(0)
  const [fits, setFits] = useState(false)
  const measure = () => { const el = ref.current; if (!el) return; const max = el.scrollWidth - el.clientWidth; setFits(max <= 2); setP(max > 0 ? el.scrollLeft / max : 1) }
  useEffect(() => { measure(); const ro = new ResizeObserver(measure); if (ref.current) ro.observe(ref.current); return () => ro.disconnect() }, [])
  const by = d => ref.current?.scrollBy({ left: d * Math.max(200, ref.current.clientWidth * 0.8), behavior: 'smooth' })
  return { ref, p, fits, onScroll: measure, by, measure }
}

function Pips({ p, n = 3 }) {
  const on = Math.min(n - 1, Math.floor(p * n * 0.999))
  return <span className={styles.pips} aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} data-on={i === on ? '' : undefined} />)}</span>
}

export function StoreBook({ env, onClose, onMine }) {
  useAutoTour('store')
  const Ccards = useCollector().cards
  const C = env.collector
  const [store, setStore] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [pick, setPick] = useState(null) // the pack taken off its hook
  const [receipt, setReceipt] = useState(false)
  const P = usePull(env, null)
  const wall = useRail(), rail = useRail()
  const load = () => C.loadStore().then(setStore).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => { if (store && C.me?.coins?.balance !== undefined) load() }, [C.me?.stats?.cards])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  useEffect(() => { wall.measure(); rail.measure() }, [store])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && !P.open) { if (pick) setPick(null); else if (receipt) setReceipt(false); else onClose() } }
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
  const singles = f ? [...f.cards].sort((a, b) => TIER_ORDER.indexOf(a.card.tier) - TIER_ORDER.indexOf(b.card.tier) || b.points - a.points) : []
  const deal = singles.find(x => x.deal)
  const foilOf = p => (p.hol && HOLIDAYS[p.hol] ? [HOLIDAYS[p.hol].a, HOLIDAYS[p.hol].b, HOLIDAYS[p.hol].c] : FOIL[p.kind] || FOIL.standard)
  const short = name => name.replace(/ Pack$/, '')
  const fs = name => (n => (n > 8 ? 14 : n > 7 ? 16 : n > 5 ? 19 : 21))(short(name).length)

  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-label="The Store">
      <div className={styles.ceiling} aria-hidden="true"><span className={styles.track} />{LAMPS.map(x => <i key={x} className={styles.lamp} style={{ left: `${x}%` }} />)}</div>
      <div className={styles.shop}>
        <header className={styles.top}>
          <div className={styles.sign}><small>BINDERS · COINS ONLY</small><b>The Store</b></div>
          <button type="button" className={styles.mini} onClick={() => setReceipt(r => !r)} aria-label={`Your Coins: ${n0(bal)}. Show today’s receipt`}><Coin size={14} />{n0(bal)}</button>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Back to your desk">×</button>
        </header>

        {!store ? <p className={styles.wait}>{err || 'Opening the store…'}</p> : <>
          <div className={styles.upper}>
            <section className={styles.peg} aria-labelledby="st-packs">
              {LAMPS.slice(0, 4).map(x => <i key={x} className={styles.cone} style={{ left: `${x + 3}%` }} aria-hidden="true" />)}
              <h2 id="st-packs" className={styles.plate}>PACKS · PULL ONE OFF THE HOOK</h2>
              <div className={styles.hooks} ref={wall.ref} onScroll={wall.onScroll}>
                {store.packs.map(p => {
                  const [a, b, ink] = foilOf(p)
                  return (
                    <button key={p.kind} type="button" className={styles.col} data-on={pick === p.kind ? '' : undefined} onClick={() => setPick(k => (k === p.kind ? null : p.kind))}
                      aria-pressed={pick === p.kind} aria-label={`${p.name}, ${n0(p.price)} Coins`}>
                      <span className={styles.hook} aria-hidden="true" />
                      <span className={styles.stack} style={{ '--a': a, '--b': b, '--ink': ink }}>
                        <span className={styles.pk} data-back="2" /><span className={styles.pk} data-back="1" />
                        <span className={styles.pk}><span>{BRAND.short}</span><b style={{ fontSize: fs(p.name) }}>{short(p.name)}</b>{p.kind === 'goat' && <i>★</i>}</span>
                      </span>
                      <span className={styles.talker}><small>{p.kind === 'era' ? `${(store.era?.years || '').toUpperCase()}` : TAG[p.kind] || 'PACK'}</small><Coin size={11} />{n0(p.price)}</span>
                    </button>
                  )
                })}
              </div>
              {!wall.fits && <>
                <span className={styles.wallFade} data-off={wall.p >= 0.99 ? '' : undefined} aria-hidden="true" />
                <span className={styles.swipe} aria-hidden="true">{store.packs.length} PACKS · SWIPE <Pips p={wall.p} /></span>
              </>}
              {pk && <div className={styles.sheetDim} onClick={() => setPick(null)}>
                <div className={styles.pickCard} role="dialog" aria-label={pk.name} onClick={e => e.stopPropagation()}>
                  <span className={styles.grab} aria-hidden="true" />
                  <span className={styles.pickPack} style={{ '--a': foilOf(pk)[0], '--b': foilOf(pk)[1], '--ink': foilOf(pk)[2] }}><span className={styles.pk}><span>{BRAND.short}</span><b style={{ fontSize: fs(pk.name) }}>{short(pk.name)}</b></span></span>
                  <span className={styles.pickText}><small>{TAG[pk.kind] || 'PACK'}</small><b>{pk.name}</b>{pk.desc}</span>
                  <span className={styles.pickBuy}>
                    <button type="button" className={styles.buy} disabled={bal < pk.price || !!busy} onClick={() => buyPack(pk.kind)}>
                      <Coin size={14} />{busy === pk.kind ? 'Opening…' : `Buy · ${n0(pk.price)}`}
                    </button>
                    {bal < pk.price && <small>{n0(pk.price - bal)} more Coins to go</small>}
                  </span>
                </div>
              </div>}
            </section>

            <aside className={styles.side}>
              <div className={styles.neon} aria-hidden="true">OPEN</div>
              <div className={styles.board}>
                <small>TODAY ON THE BOARD</small>
                <span>{fmtDay(store.day, { month: 'short', day: 'numeric' })} singles · new in {left0}</span>
                {deal && <span>Card of the Day ½ price</span>}
                {store.era && <span>{store.era.name} packs all week</span>}
              </div>
            </aside>
          </div>

          <section className={styles.counter} aria-labelledby="st-otd">
            <div className={styles.register}>
              {receipt && <div className={styles.receipt} role="region" aria-label="Today’s Coins">
                <b>TODAY’S COINS · {n0(coins.earned)}</b>
                {ch && <p className={ch.done ? styles.done : ''}>{ch.done ? '✓ ' : ''}Challenge: {ch.text} · {ch.coins}</p>}
                {earnRows.map(([l, v, done]) => <p key={l} className={done ? styles.done : ''}><span>{l}</span><span>{v}</span></p>)}
                <p className={styles.small}>Sell any card a day after you get it, for {Math.round(rates.sellRate * 100)}% of its points (up to {rates.sellCap} a day). Buy it back within {rates.buybackHours} hours.</p>
                <button type="button" className={styles.sellBtn} onClick={onMine}>Sell cards from My binder</button>
              </div>}
              <button type="button" className={styles.till} onClick={() => setReceipt(r => !r)} aria-expanded={receipt}>
                <span className={styles.disp}><small>YOUR COINS</small><b>{n0(bal)}</b></span>
                <span className={styles.keys} aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</span>
                <span className={styles.tillLab}>{receipt ? 'Tear off the receipt' : `${n0(coins.earned)} earned today · receipt`}</span>
              </button>
            </div>
            <div className={styles.ctop} />
            <div className={styles.case}>
              <div className={styles.caseHead}>
                <h2 id="st-otd">{f.random ? 'Today’s singles' : `${fmtDay(store.day, { month: 'short', day: 'numeric' }).toUpperCase()} IN LEAGUE HISTORY`}</h2>
                <span className={styles.count}>{singles.length} SINGLES{rail.fits ? '' : ' · SCROLL FOR MORE'}{!rail.fits && <Pips p={rail.p} />}</span>
              </div>
              <div className={styles.rail} ref={rail.ref} onScroll={rail.onScroll} aria-label="Today’s singles">
                {singles.map(x => {
                  const ref = `${x.card.s}|${x.card.id}|${x.card.row.n}`
                  const e = fromIndex(env, x.card, { key: ref })
                  const poor = bal < x.price
                  return (
                    <div key={ref} className={styles.single} data-tier={x.card.tier}>
                      {x.deal && <span className={styles.dealTag}>CARD OF THE DAY · ½ PRICE</span>}
                      <button type="button" className={styles.slab} onClick={() => P.pull(e)} aria-label={`${x.card.row.n}, ${TIER_NAME[x.card.tier]}: preview`}>
                        <Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit>
                      </button>
                      <span className={styles.stand} aria-hidden="true" />
                      <span className={styles.sticker} data-deal={x.deal ? '' : undefined}>{n0(x.price)}</span>
                      <span className={styles.under}>
                        <span className={styles.meta}>{TIER_NAME[x.card.tier]} · {x.points.toLocaleString()} pts{!x.onDate ? ' · random' : ''}</span>
                        {x.owned ? <span className={styles.owned}>✓ In your binder</span>
                          : <button type="button" className={styles.buy} data-small="" disabled={poor || !!busy} onClick={() => buyCard(ref)} title={poor ? `You need ${n0(x.price - bal)} more Coins` : ''}>
                            <Coin size={12} />{busy === ref ? '…' : n0(x.price)}{x.deal && <s>{n0(x.full)}</s>}
                          </button>}
                        <FitLine fit={binderFit(Ccards, x.card)} className={styles.fitLine} />
                      </span>
                    </div>
                  )
                })}
              </div>
              {!rail.fits && <>
                <span className={styles.fadeL} data-off={rail.p <= 0.01 ? '' : undefined} aria-hidden="true" />
                <span className={styles.fadeR} data-off={rail.p >= 0.99 ? '' : undefined} aria-hidden="true" />
                <button type="button" className={styles.arrow} data-side="l" onClick={() => rail.by(-1)} disabled={rail.p <= 0.01} aria-label="Scroll singles left">‹</button>
                <button type="button" className={styles.arrow} data-side="r" onClick={() => rail.by(1)} disabled={rail.p >= 0.99} aria-label="Scroll singles right">›</button>
              </>}
              <span className={styles.glare} aria-hidden="true" />
            </div>
            <div className={styles.base} />
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
                        : <button type="button" className={styles.buy} data-small="" disabled={!!busy || bal < x.price} onClick={() => undo(x.id)}><Coin size={12} />Buy back · {x.price}</button>}</span>
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
