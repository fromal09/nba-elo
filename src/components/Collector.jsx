import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { BRAND } from '../brand.js'
import { hrefFor, linkTo } from '../nav.js'
import styles from './Collector.module.css'
import { MiniCard, DuelCard } from './PlayerCard'
import { SpecialFace, isSpecial, specialTitle, specialLabel, specialLine } from './SpecialCards'
import { fromIndex } from './Binders'
import { binderTeamInfo, binderHeadshots, binderLogo } from './SeasonExplorer'
import { norm } from './predict'
import { holidayNear } from './holidays'
import SelectionBreakdown from './SelectionBreakdown'
import { PickStage, Results } from './PackReveal'
import { cardPoints } from '../../api/_lib/points.js'

/*
 * The card collection, client side: who's signed in, their packs, the cards they own.
 * The server (api/collect.js) builds every pack and records every pick; this shows what it returns.
 * A pack is five slots; each slot offers three cards and you keep one.
 */

const Ctx = createContext(null)
const noop = () => {}
export const useCollector = () => useContext(Ctx) || { me: null, owned: new Set(), cards: [], openAuth: noop, claim: noop, openTeam: noop, resume: noop }

export const TIER_NAME = { goat: '★ GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare', common: 'Common' }
export const refOf = c => (c.kind === 'duel' ? `duel|${c.date}` : c.kind === 'peak' ? `peak|${c.s}|${c.id}|${c.row.n}` : c.kind === 'rival' ? `rival|${c.a}|${c.b}` : c.kind === 'duo' ? `duo|${c.a}|${c.b}`
  : c.kind === 'five' ? `five|${c.s}|${c.t}` : c.kind === 'season' ? `season|${c.s}|${c.t}|${c.n}` : c.kind === 'potw' ? `potw|${c.week}` : c.kind === 'set' ? `set|${c.fc}|${c.s}` : c.kind === 'banner' ? `banner|${c.fc}` : c.kind === 'allstar' ? `allstar|${c.s}${c.aba ? '|aba' : ''}` : c.kind === 'fhist' ? `fhist|${c.fc}` : c.kind === 'fcomp' ? `fcomp|${c.fc}` : `${c.s}|${c.id}|${c.row.n}${c.ruby ? '|ruby' : ''}`)
export const CURRENT_TEAMS = ['ATL', 'BOS', 'BKN', 'CHO', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN',
  'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHO', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS']

async function api(action, body, query = '') {
  // Never wait forever: a request the server hasn't answered in 30 seconds fails, and the button comes back
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30e3)
  const r = await fetch(`/api/collect?action=${action}${query}`, body === undefined ? { credentials: 'same-origin', signal: ctl.signal }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
    .catch(e => { throw new Error(e?.name === 'AbortError' ? 'That took too long. Check your binder before trying again: it may have gone through.' : 'Couldn’t reach the server. Try again.') })
    .finally(() => clearTimeout(timer))
  let d = null
  try { d = await r.json() } catch { /* not JSON: the API isn't deployed */ }
  if (!r.ok || !d) throw new Error(d?.error || (r.status === 404 ? 'The collection isn’t live yet.' : 'Something went wrong. Try again.'))
  return d
}

// How an offered card goes with your binder: his cards you have, the players you have from that team-season (and
// whether he'd be new there), and your cards from the franchise. For a line under pack and store offers.
const FC_MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
export function binderFit(cards, c) {
  if (!c || c.kind || !c.row) return null
  const fcOf = t => FC_MERGE[t] || t, fc = fcOf(c.t)
  let his = 0, fr = 0
  const ts = new Set()
  for (const x of cards || []) {
    const k = x.card
    if (!k || k.kind || !k.row) continue
    if (k.row.n === c.row.n) his++
    if (fcOf(k.t) === fc) { fr++; if (k.s === c.s) ts.add(k.row.n) }
  }
  return { his, ts: ts.size, newTs: !ts.has(c.row.n), fr, nick: nick(c.tn), s: c.s }
}
export function FitLine({ fit, className }) {
  if (!fit) return null
  return <span className={className} title={`Your binder: ${fit.his} of his card${fit.his === 1 ? '' : 's'} · ${fit.ts} player${fit.ts === 1 ? '' : 's'} from the ${fit.s} ${fit.nick} · ${fit.fr} ${fit.nick} card${fit.fr === 1 ? '' : 's'}`}>
    <b>{fit.his ? `${fit.his} of his` : 'New player'}</b> · {fit.newTs ? '+1 ' : ''}{fit.s.slice(2)} {fit.nick} {fit.ts}{fit.newTs ? '→' + (fit.ts + 1) : ''} · {fit.fr} {fit.nick}</span>
}

export function CollectorProvider({ children, onOpenMine, onOpenStore, onOpenPredict }) {
  const [me, setMe] = useState(undefined)        // undefined: loading · null: signed out
  const [cards, setCards] = useState([])         // [{ id, card, pulled, pack }]
  const [auth, setAuth] = useState(null)         // 'login' | 'signup'
  const [queue, setQueue] = useState(null)       // packs to open, in order
  const [teamPick, setTeamPick] = useState(null) // 'weekly' | 'store': who the team picker is for
  const [down, setDown] = useState(false)        // the API isn't reachable (not deployed yet)
  const [toast, setToast] = useState(null)
  const [coinToasts, setCoinToasts] = useState([]) // Coins just earned
  const [reveal, setReveal] = useState([])       // cards that just went straight into the binder, shown one at a time
  const [preds, setPreds] = useState(null)       // predictions: today's and tomorrow's slates with your picks
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { if (!coinToasts.length) return; const t = setTimeout(() => setCoinToasts([]), 4200); return () => clearTimeout(t) }, [coinToasts])
  const celebrate = awards => {
    const got = (awards || []).filter(a => a.amount > 0); if (got.length) setCoinToasts(c => [...c, ...got].slice(-5))
    const card = (awards || []).find(a => a.kind === 'predreward'); if (card) setToast(`${card.label}. Choose it in Predictions.`)
    const forged = (awards || []).filter(a => a.kind === 'season' && !a.card); if (forged.length) setToast(forged.map(a => a.label).join(' · ') + '. It’s in Specials in your binder.')
    // A card that went straight into the binder gets the full reveal (once per card, however many responses report it)
    const drops = (awards || []).filter(a => a.card)
    if (drops.length) setReveal(q => { const have = new Set(q.map(a => a.label)); return [...q, ...drops.filter(a => !have.has(a.label))] })
  }

  const loadCards = useCallback(() => api('collection').then(d => { setCards(d.cards); celebrate(d.awards) }).catch(() => {}), [])
  const refresh = useCallback(() => api('me').then(d => setMe(m => (d.user ? { ...d, lastNight: d.lastNight ?? m?.lastNight } : null))).catch(() => {}), [])
  useEffect(() => {
    api('me').then(d => { setMe(d.user ? d : null); if (d.user) { loadCards(); celebrate(d.awards) } }).catch(() => { setMe(null); setDown(true) })
  }, [loadCards])
  const take = d => { setMe(m => ({ ...m, ...d, lastNight: m?.lastNight })); celebrate(d.awards) }
  const guard = fn => async (...a) => { try { return await fn(...a) } catch (x) { setToast(x.message); refresh(); return null } }

  const value = useMemo(() => ({
    me, cards, down,
    owned: new Set(cards.map(c => refOf(c.card))),
    openAuth: mode => setAuth(mode || 'login'),
    signIn: async (mode, username, password) => {
      const d = await api(mode, { username, password })
      setMe(d); setAuth(null); loadCards(); celebrate(d.awards)
      return d
    },
    signOut: async () => { await api('logout', {}).catch(() => {}); setMe(null); setCards([]); setPreds(null) },
    // Today's pack; packs left open (closed mid-pick) come first
    claim: guard(async () => {
      if (!me) { setAuth('signup'); return }
      if (me.today.claimed && me.open.length) { const d = await api('pack', undefined, `&id=${me.open[0].id}`); setQueue([d.pack]); return }
      const d = await api('claim', {})
      take(d); setQueue(d.packs)
    }),
    openTeam: () => { if (!me) setAuth('signup'); else setTeamPick('weekly') },
    claimTeam: guard(async team => { const d = await api('team', { team }); setTeamPick(null); take(d); setQueue(d.packs) }),
    resume: guard(async id => { const d = await api('pack', undefined, `&id=${id}`); setQueue([d.pack]) }),
    pick: async (pack, slot, choice) => { const d = await api('pick', { pack, slot, choice }); take(d); return d },
    star: guard(async (id, on) => { take(await api('star', { id, on })) }),
    showcase: guard(async (id, on) => { take(await api('showcase', { id, on })) }),
    saveProfile: guard(async patch => { take(await api('profile', patch)) }),
    openMine: () => onOpenMine?.(),
    openStore: () => (me ? onOpenStore?.() : setAuth('signup')),
    // Coins: exploring the site, the store, selling
    explore: section => { if (me) api('explore', { section }).then(d => { celebrate(d.awards); if (d.coins) setMe(m => (m ? { ...m, coins: d.coins } : m)) }).catch(() => {}) },
    loadStore: () => api('store').then(d => { take(d); return d.store }),
    buyPack: guard(async kind => {
      if (kind === 'storeteam') { setTeamPick('store'); return null }
      const d = await api('buy', { kind }); take(d); setQueue(d.packs); return d
    }),
    buyTeamPack: guard(async team => { const d = await api('buy', { kind: 'storeteam', team }); setTeamPick(null); take(d); setQueue(d.packs); return d }),
    buyCard: guard(async ref => { const d = await api('buycard', { ref }); take(d); loadCards(); setToast('Added to your binder.'); return d.store }),
    sell: guard(async (id, confirm) => { const d = await api('sell', { id, confirm }); take(d); loadCards(); return d }),
    buyback: guard(async id => { const d = await api('buyback', { id }); take(d); loadCards(); return d.store }),
    // Predictions: the slate and your record; picks; reward cards
    preds,
    loadPredictions: () => api('predictions').then(d => { take(d); setPreds(d.predictions); return d.predictions }),
    predict: guard(async (game, team) => { const d = await api('predict', { game, team }); take(d); setPreds(d.predictions); return d.predictions }),
    lock: guard(async (game, on = true) => { const d = await api('lock', { game, on }); take(d); setPreds(d.predictions); return d.predictions }),
    duelPick: guard(async (game, player) => { const d = await api('duelpick', { game, player }); take(d); setPreds(d.predictions); return d.predictions }),
    setLineup: guard(async (day, slot, card) => { const d = await api('lineup', { day, slot, card }); take(d); setPreds(d.predictions); return d.predictions }),
    loadChallenge: () => api('challenge').then(d => d.challenge),
    // Full Court Clash: decks, matches against the CPU (played on the server), franchise redesigns
    loadClash: () => api('clash').then(d => d.clash),
    clashDeck: guard(async b => (await api('clashdeck', b)).clash),
    clashActive: guard(async slot => (await api('clashactive', { slot })).clash),
    clashStart: guard(async b => api('clashstart', b)),
    clashMatch: guard(async id => api('clashmatch', undefined, `&id=${id}`)),
    clashTurn: guard(async (match, plays) => { const d = await api('clashturn', { match, plays }); if (d.reward?.card) { take(d); loadCards(); setToast('A card from the daily challenge is in your binder.') } return d }),
    clashClaim: guard(async b => { const d = await api('clashclaim', b); loadCards(); setToast('Redesign applied. It’s in your binder.'); return d.clash }),
    loadBanner: fc => api('banner', undefined, fc ? `&fc=${encodeURIComponent(fc)}` : '').then(d => d.banner),
    playBanner: guard(async (fc, ids, o = {}) => { const d = await api('bannerplay', { fc, ids }); take(d); const open = () => { if (d.packs?.length) setQueue(d.packs) }; if (o.defer) d.openPacks = open; else open(); if (d.result?.won) loadCards(); return d }),
    setChallenge: guard(async (level, ids) => { const d = await api('challengeset', { level, ids }); return d.challenge }),
    potdPick: guard(async (day, player, team) => { const d = await api('potdpick', { day, player, team }); take(d); setPreds(d.predictions); return d.predictions }),
    predDay: day => api('predday', undefined, `&day=${day}`).then(d => d.day),
    loadStandings: scope => api('standings', undefined, `&scope=${scope}${me ? '' : '&pub=1'}`).then(d => d.standings),
    predReward: (day, kind = 'games') => api('predreward', undefined, `&day=${day}&kind=${kind}`).then(d => d.reward),
    claimPred: guard(async (day, ref, kind = 'games') => { const d = await api('claimpred', { day, ref, kind }); take(d); setPreds(d.predictions); loadCards(); setToast('Added to your binder.'); return d.predictions }),
    openPredict: () => (me ? onOpenPredict?.() : setAuth('signup')),
    // Wish lists: three at a time; keeping a wished card fulfills it
    wish: guard(async (name, season, tier) => { const d = await api('wish', { name, season: season || null, tier: tier || null }); take(d)
      setToast(`${tier ? `${TIER_NAME[tier]} ` : ''}${name}${season ? `, ${season},` : ''} is on your wish list.`); return d.wishlist }),
    wishCards: (name, season) => api('wishcards', undefined, `&name=${encodeURIComponent(name)}${season ? `&season=${season}` : ''}`),
    unwish: guard(async id => { const d = await api('unwish', { id }); take(d); return d.wishlist }),
    loadWishes: user => api('wishes', undefined, user ? `&user=${encodeURIComponent(user)}` : ''),
  }), [me, cards, down, preds, loadCards, onOpenMine, onOpenStore, onOpenPredict])

  const closeQueue = () => { setQueue(null); loadCards(); refresh() }
  return (
    <Ctx.Provider value={value}>
      {children}
      {auth && <AuthModal mode={auth} setMode={setAuth} onClose={() => setAuth(null)} signIn={value.signIn} />}
      {teamPick && me && <TeamPicker me={me} store={teamPick === 'store'} onClose={() => setTeamPick(null)} onPick={teamPick === 'store' ? value.buyTeamPack : value.claimTeam} />}
      {toast && <div className={styles.toast} role="status" onClick={() => setToast(null)}>{toast}</div>}
      {coinToasts.length > 0 && <div className={styles.coinToasts} role="status" aria-live="polite">
        {coinToasts.map((a, i) => <div key={i} className={styles.coinToast}><Coin /><b>+{a.amount.toLocaleString()}</b><span>{a.label}</span></div>)}
      </div>}
      {reveal.length > 0 && !queue && <RewardReveal key={reveal[0].label} a={reveal[0]} more={reveal.length - 1}
        onNext={() => setReveal(q => q.slice(1))} onMine={() => { setReveal([]); loadCards(); onOpenMine?.() }} />}
      {queue && <PackOpening key={queue[0].id} pack={queue[0]} more={queue.length - 1} me={me} pick={value.pick} cards={cards}
        onNext={() => setQueue(q => (q.length > 1 ? q.slice(1) : null))} onClose={closeQueue}
        onMine={() => { closeQueue(); onOpenMine?.() }} />}
    </Ctx.Provider>
  )
}

// The Coin mark
export const Coin = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={styles.coinIcon}>
    <circle cx="12" cy="12" r="11" fill="#e7c160" /><circle cx="12" cy="12" r="8.2" fill="#f6d77e" stroke="#b8871e" strokeWidth="1.2" />
    <text x="12" y="16.2" textAnchor="middle" fontSize="11" fontWeight="900" fill="#8a6414" fontFamily="Inter, sans-serif">C</text>
  </svg>
)

// ── Sign in / create an account ──────────────────────────────────────────────
function AuthModal({ mode, setMode, onClose, signIn }) {
  const [u, setU] = useState(''), [p, setP] = useState('')
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [mode])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [onClose])
  const submit = async e => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { await signIn(mode, u.trim(), p) } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const signup = mode === 'signup'
  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.auth} onClick={e => e.stopPropagation()} onSubmit={submit} aria-label={signup ? 'Create an account' : 'Sign in'}>
        <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.authPack} aria-hidden="true"><i /><i /><i /></div>
        <h2>{signup ? 'Start your binder' : 'Welcome back'}</h2>
        <p>{signup ? 'A free pack every day: pick five cards, one of three at a time, from last night’s games and 80 years of history. Plus a weekly pack for the team of your choice.' : 'Sign in to open today’s pack.'}</p>
        <label><span>Username</span><input ref={ref} value={u} onChange={e => setU(e.target.value)} autoComplete="username" spellCheck="false" maxLength={20} placeholder="3–20 letters, numbers or _" /></label>
        <label><span>Password</span><input type="password" value={p} onChange={e => setP(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'At least 8 characters' : ''} /></label>
        {err && <div className={styles.err} role="alert">{err}</div>}
        <button type="submit" className={styles.primary} disabled={busy || !u || !p}>{busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}</button>
        <div className={styles.swap}>{signup ? 'Have an account?' : 'New here?'} <button type="button" onClick={() => { setErr(null); setMode(signup ? 'login' : 'signup') }}>{signup ? 'Sign in' : 'Create an account'}</button></div>
        <small className={styles.fine}>No email needed. There’s no password reset yet, so keep it somewhere safe.</small>
      </form>
    </div>
  )
}

// ── Opening a pack: pick one of three, five times ───────────────────────────
// Read lazily: SeasonExplorer and this module import each other
const env = { teamInfo: (...a) => binderTeamInfo(...a) }
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const nick = n => (/Trail Blazers$/.test(n || '') ? 'Trail Blazers' : (n || '').split(' ').pop())

function useShots() {
  const [shots, setShots] = useState({})
  useEffect(() => { binderHeadshots().then(setShots) }, [])
  return shots
}
function useWidth() {
  const [w, setW] = useState(() => (typeof innerWidth === 'number' ? innerWidth : 1200))
  useEffect(() => { const f = () => setW(innerWidth); addEventListener('resize', f); return () => removeEventListener('resize', f) }, [])
  return w
}

export function CardFace({ card, shots, w = 280, live }) {
  const e = fromIndex({ ...env, headshot: n => shots?.[norm(n)]?.headshot }, card)
  const k = w / 340
  return (
    <span className={styles.face} data-still={live ? undefined : ''} style={{ width: w, height: 476 * k }}>
      <span style={{ transform: `scale(${k})` }}>
        {isSpecial(card) ? <SpecialFace card={card} /> : e.duel ? <DuelCard {...e.duel} /> : <MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={shots?.[norm(e.name)]?.headshot} />}
      </span>
    </span>
  )
}

const PACK_NAMES = { daily: 'Daily Pack', streak: 'Streak Pack', standard: 'Standard Pack', era: 'Era Pack', playoff: 'Playoff Pack', legend: 'Legend Pack', goat: 'GOAT Pack' }
const packTitle = p => ((p.kind === 'team' || p.kind === 'storeteam') ? `${nick(binderTeamInfo(p.team).name)} Pack` : p.kind === 'holiday' ? `${holidayNear(p.day)?.name || 'Holiday'} Pack` : p.kind?.startsWith('banner') ? `${nick(binderTeamInfo(p.team).name)} Banner Pack` : PACK_NAMES[p.kind] || 'Pack')
const slotLabel = (pack, slot, lastNight) => {
  const s = pack.slots[slot]
  if (pack.pity && slot === pack.slots.length - 1) return 'Guaranteed big pull · Legend or better'
  if (s.src === 'recent') return `From last night${lastNight ? ` · ${fmtDay(lastNight)}` : ''}`
  if (s.src === 'team') return `From ${binderTeamInfo(pack.team).name} history`
  if (s.odds === 'goatOnly') return 'Guaranteed ★ GOAT'
  if (s.src === 'holiday') { const H = holidayNear(pack.day); return `From ${H ? H.name : 'holiday'} games${s.odds === 'rarePlus' ? ' · Rare or better' : ' · every era'}` }
  if (s.src === 'finals') return 'From the Finals'
  if (s.src === 'playoff') return s.odds === 'rarePlus' ? 'From the playoffs · Rare or better' : 'From the playoffs'
  if (s.src === 'era') return s.odds === 'rarePlus' ? 'From this era · Rare or better' : 'From this era'
  return s.odds === 'legendPlus' ? 'From the vault · Legend or better' : s.odds === 'rarePlus' ? 'From the vault · Rare or better' : 'From the vault · any era'
}
// Why a card is worth what it is: "Legend ×12 · game ×1.8 · Player of the Game +25%"
const pointsWhy = c => cardPoints(c).bonuses.map(([l, v]) => (v ? `${l} ${v}` : l)).join(' · ')
export const tierName = c => (isSpecial(c) || c.kind === 'duel' ? specialLabel(c) : `${c.ruby ? 'Ruby ' : ''}${TIER_NAME[c.tier]}`)
export const cardName = c => (isSpecial(c) || c.kind === 'duel' ? specialTitle(c) : c.row.n)
const line = c => (isSpecial(c) ? specialLine(c) : null) || [c.row?.pts != null && `${c.row.pts} pts`, c.row.trb && `${c.row.trb} reb`, c.row.ast && `${c.row.ast} ast`].filter(Boolean).join(' · ')

// The reveal for a card that goes straight into your binder (a Duel of the Day sweep, a ruby Player of the Day, a forged
// Season card, a Complete Set): spotlight, rays, confetti, the card flipping in, then where it went
const REVEAL_KICK = { duelcard: 'Duel of the Day', potdcard: 'Called it', season: 'Season card forged', setcard: 'Complete Set' }
function RewardReveal({ a, more, onNext, onMine }) {
  const [shots, setShots] = useState({})
  const [shown, setShown] = useState(false)
  useEffect(() => { binderHeadshots().then(setShots).catch(() => {}) }, [])
  useEffect(() => { const t = setTimeout(() => setShown(true), 60); return () => clearTimeout(t) }, [])
  useEffect(() => { const k = e => { if (e.key === 'Escape') onNext() }; addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [])
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth
  const W = vw < 520 ? Math.min(240, vw - 110) : 300
  const c = a.card
  const pts = (() => { try { return cardPoints(c).points } catch { return null } })()
  return (
    <div className={styles.reveal} data-on={shown ? '' : undefined} role="dialog" aria-modal="true" aria-label="A new card for your binder" onClick={onNext}>
      <div className={styles.rvRays} aria-hidden="true" />
      <div className={styles.rvConfetti} aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--d': `${(i % 9) * 0.12}s`, '--r': `${(i * 47) % 360}deg`, '--h': (i * 53) % 360 }} />)}</div>
      <div className={styles.rvStage} onClick={e => e.stopPropagation()}>
        <span className={styles.rvKick}>{REVEAL_KICK[a.kind] || 'New card'}</span>
        <b className={styles.rvWhy}>{a.why || 'A new card'}</b>
        <div className={styles.rvCard} style={{ width: W }}>
          <div className={styles.rvFlip}><span className={styles.rvBack} /><span className={styles.rvFront}><CardFace card={c} shots={shots} w={W} />{c.ruby && <i className={styles.rvRuby} />}<i className={styles.rvShine} /></span></div>
        </div>
        <span className={styles.rvName}>{cardName(c)}{pts ? <small> · {pts.toLocaleString()} points</small> : ''}</span>
        <span className={styles.rvWhere}>It’s already in your binder.</span>
        <div className={styles.rvBtns}>
          <button type="button" className={styles.rvGo} onClick={onMine}>See it in my binder</button>
          <button type="button" onClick={onNext}>{more ? `Next card (${more} more)` : 'Nice'}</button>
        </div>
      </div>
    </div>
  )
}

function PackOpening({ pack: start, more, me, pick, onNext, onClose, onMine, cards }) {
  const shots = useShots()
  const vw = useWidth()
  const [pack, setPack] = useState(start)
  const [stage, setStage] = useState(start.picks.length ? 'pick' : 'sealed') // sealed | tearing | pick | done
  const [up, setUp] = useState([false, false, false]) // cards of this slot turned face up: you flip them yourself
  const [sel, setSel] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // The binder and your standing as they were when this pack opened, for the results' before and after
  const [cards0] = useState(cards)
  const [me0] = useState(me)
  const slot = pack.picks.length
  const offer = pack.slots[slot]
  const kept = pack.picks.map((k, i) => pack.slots[i].cards[k])
  const W = vw < 520 ? Math.floor((vw - 64) / 3) : vw < 900 ? 190 : 230

  // Deal face down; you turn each one over (or all at once)
  useEffect(() => {
    if (stage !== 'pick') return
    setUp([false, false, false]); setSel(null)
  }, [stage, slot])
  const n = offer ? offer.cards.length : 3
  const shown = up.slice(0, n).filter(Boolean).length
  const all = shown >= n
  const flip = i => setUp(u => { const v = [...u]; v[i] = true; return v })
  const flipAll = () => setUp([true, true, true])
  const tear = () => { if (stage !== 'sealed') return; setStage('tearing'); setTimeout(() => setStage('pick'), 1000) }
  const keep = async () => {
    if (sel == null || busy) return
    setBusy(true); setErr(null)
    try {
      const d = await pick(pack.id, slot, sel)
      setPack(d.pack)
      if (d.pack.status === 'done') setStage('done')
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') onClose()
      else if (stage === 'sealed' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); tear() }
      else if (stage === 'pick' && !all && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); const i = up.findIndex(x => !x); if (i >= 0) flip(i) }
      else if (stage === 'pick' && all) {
        if (['1', '2', '3'].includes(e.key)) setSel(+e.key - 1)
        else if (e.key === 'ArrowLeft') setSel(s => (s == null ? 0 : Math.max(0, s - 1)))
        else if (e.key === 'ArrowRight') setSel(s => (s == null ? 0 : Math.min(2, s + 1)))
        else if (e.key === 'Enter' && sel != null) keep()
      }
    }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  })
  const kind = pack.kind
  const chosen = sel != null && offer?.cards[sel]
  return (
    <div className={`${styles.overlay} ${styles.deskLayer}`}>
      <div className={`${styles.opening} ${stage === 'pick' ? styles.openingWide : ''}`} role="dialog" aria-modal="true" aria-label="Open your pack">
        <button type="button" className={styles.x} onClick={onClose} aria-label="Close (your picks so far are saved)" title="Close. Your picks are saved; finish the pack later.">×</button>
        {(stage === 'sealed' || stage === 'tearing') && <>
          <div className={styles.kick}>{kind === 'streak' ? `${me?.today?.streak}-day streak bonus` : kind === 'team' ? `Team pack · week of ${fmtDay(pack.day)}` : kind === 'daily' ? `Daily pack · ${fmtDay(pack.day)}` : kind.startsWith('banner') ? `Hang the Banner · stage ${kind.slice(6)} reward` : 'From the store'}</div>
          <button type="button" className={`${styles.pack} ${kind === 'streak' || kind === 'legend' ? styles.packGold : ''} ${stage === 'tearing' ? styles.torn : ''}`}
            style={kind === 'team' || kind === 'storeteam' || kind.startsWith('banner') ? { '--pc': binderTeamInfo(pack.team).color || '#173657' } : kind === 'holiday' && holidayNear(pack.day) ? { '--pc': holidayNear(pack.day).b } : undefined} data-kind={kind === 'storeteam' || kind === 'holiday' || kind.startsWith('banner') ? 'team' : kind} onClick={tear} aria-label="Tear the pack open">
            <span className={styles.packTop} />
            <span className={styles.packBody}>
              <small>{BRAND.name}</small>
              <b>{packTitle(pack)}</b>
              <em>Pick {pack.slots.length} · one of three at a time</em>
              {pack.pity && <strong>★ Guaranteed big pull inside</strong>}
              <i>{kind === 'team' || kind === 'storeteam' || kind.startsWith('banner') ? binderTeamInfo(pack.team).abbr : kind === 'goat' ? '★' : BRAND.short}</i>
            </span>
          </button>
          <div className={styles.hintLine}>Tap the pack to tear it open</div>
        </>}

        {stage === 'pick' && offer && <PickStage pack={pack} slot={slot} slotLabel={slotLabel(pack, slot, me?.lastNight)} kept={kept} cards0={cards0} shots={shots} busy={busy} err={err}
          W={vw < 520 ? Math.floor((vw - 48) / 3) : vw < 900 ? 170 : 200} onClose={onClose} onKeep={async i => {
            if (busy) return
            setBusy(true); setErr(null)
            try { const d = await pick(pack.id, slot, i); setPack(d.pack); if (d.pack.status === 'done') setStage('done') } catch (x) { setErr(x.message) } finally { setBusy(false) }
          }} />}

        {stage === 'done' && <Results pack={pack} title={packTitle(pack)} kept={kept} cards0={cards0} me={me} me0={me0} shots={shots} more={more} onNext={onNext} onMine={onMine} onClose={onClose}
          foot={!more && (kind === 'daily' || kind === 'streak') ? <p className="pk-hint">Next pack once tonight’s games are final and in the data{me?.today ? ` · ${me.today.untilBonus} more day${me.today.untilBonus === 1 ? '' : 's'} to a streak bonus` : ''}</p> : null} />}
      </div>
    </div>
  )
}

// The big-pull meter: packs since your last Legend-or-better pick, out of 10
export function Meter({ meter, dark }) {
  if (!meter) return null
  return (
    <div className={`${styles.meter} ${dark ? styles.meterDark : ''}`} title="At most ten packs between Legend-or-better pulls">
      <div className={styles.meterBar}>{Array.from({ length: meter.every }, (_, i) => <i key={i} className={i < meter.since ? styles.meterOn : ''} />)}</div>
      <span>{meter.until === 1 ? 'Next pack guarantees a Legend or better' : `Legend or better guaranteed within ${meter.until} packs`}</span>
    </div>
  )
}

// ── The weekly team pack: pick the team ──────────────────────────────────────
function TeamPicker({ me, onClose, onPick, store }) {
  const [busy, setBusy] = useState(null)
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [onClose])
  const fav = me.user.favoriteTeam
  const teams = [...CURRENT_TEAMS].map(c => ({ c, ...binderTeamInfo(c) })).sort((a, b) => (b.c === fav) - (a.c === fav) || a.name.localeCompare(b.name))
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.picker} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Choose this week’s team pack">
        <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.kickDark}>{store ? 'Store · Team Pack · 400 Coins' : `Team pack · week of ${fmtDay(me.week.start)}`}</div>
        <h2>Pick a team</h2>
        <p>{store ? 'Five picks, one of three at a time, from every season of that franchise’s history.' : 'Five picks, one of three at a time, from every season of that franchise’s history. One free team pack a week; a new one Monday.'}</p>
        <div className={styles.teamGrid}>
          {teams.map(t => (
            <button key={t.c} type="button" disabled={!!busy} className={`${styles.teamBtn} ${t.c === fav ? styles.teamFav : ''}`} style={{ '--c': t.color || '#173657' }}
              onClick={async () => { setBusy(t.c); await onPick(t.c); setBusy(null) }}>
              <span className={styles.teamLogo}>{binderLogo(t.c) ? <img src={binderLogo(t.c)} alt="" /> : <b>{t.abbr}</b>}</span>
              <span>{busy === t.c ? 'Opening…' : nick(t.name)}</span>
              {t.c === fav && <small>Favorite</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Header controls ──────────────────────────────────────────────────────────
// The nav: Sign in, or the pack waiting (or half-picked) and your name
export function AccountBar({ onMine, compact }) {
  const { me, down, openAuth, claim, resume, openStore, openMine } = useCollector()
  if (me === undefined || down) return null
  if (!me) return (
    <div className={styles.bar}>
      <button type="button" className={styles.packBtn} onClick={() => openAuth('signup')}><Gift />{compact ? 'Free pack' : 'Get a free daily pack'}</button>
      <button type="button" className={styles.signIn} onClick={() => openAuth('login')}>Sign in</button>
    </div>
  )
  const t = me.today, open = me.open?.[0]
  return (
    <div className={styles.bar}>
      {open && t.claimed
        ? <button type="button" className={`${styles.packBtn} ${styles.packReady}`} onClick={() => resume(open.id)}><Gift />{compact ? `Pick ${open.picked + 1}/5` : `Finish your pack · ${open.picked}/${open.total}`}</button>
        : !t.claimed
          ? <button type="button" className={`${styles.packBtn} ${styles.packReady}`} onClick={claim}><Gift />{t.bonusToday ? 'Open 2 packs' : compact ? 'Open pack' : 'Open today’s pack'}</button>
          : <span className={styles.streak} title={`${t.untilBonus} more day${t.untilBonus === 1 ? '' : 's'} to a bonus pack`}><Flame />{t.streak}<small>day{t.streak === 1 ? '' : 's'}</small></span>}
      <a className={styles.coinChip} {...linkTo(hrefFor('binders', { open: 'store' }), openStore)} title="Coins · open the store"><Coin />{(me.coins?.balance ?? 0).toLocaleString()}</a>
      <a className={styles.user} {...linkTo(hrefFor('binders', { open: 'mine' }), () => (onMine ? onMine() : openMine()))} title="My binder"><span>{me.user.username[0].toUpperCase()}</span>{!compact && me.user.username}</a>
    </div>
  )
}

const Gift = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="13" rx="1.5" /><path d="M12 8v13M3 12h18M12 8S10.5 3 7.5 3.8C5.6 4.3 6.4 8 12 8zM12 8s1.5-5 4.5-4.2C18.4 4.3 17.6 8 12 8z" /></svg>
const Flame = () => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2s1 3.5-1.5 6S7 12.5 7 15a5 5 0 0 0 10 0c0-2-1-3.6-2-4.6.3 1.6-.4 2.9-1.5 3.1C14.6 10.8 14 5.6 12 2z" /></svg>
