import { useState, useEffect, useMemo, useRef } from 'react'
import styles from './CardDatabase.module.css'
import { useCollector, refOf } from './Collector'
import { binderJSON, binderTeamInfo } from './SeasonExplorer'
import { TIERS, tierFor } from './PlayerCard'
import { LEAGUE_SETS } from './Binders'
import { norm } from './predict'
import { FaceFit, cardType } from './TrophyRoom'
import { cardPoints, hasFeat } from '../../api/_lib/points.js'
import { holidayOf } from '../../api/_lib/holidays.js'

/*
 * The card database: every card on record, searchable and filterable, 24 at a time. Nothing loads that the filters
 * don't need: a player is one file (scripts/build_packs.py packs/players/), a franchise its team shards, a few seasons
 * their tier shards, a set the league binders, a special kind its pool. With no filter, the 3,000 best cards on record.
 */

const DATA = '/data/explorer/packs/'
const PAGE = 24
const BUDGET = 36 // most shard files one search loads; past that the lower tiers drop out, with a note
const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const SPECIALS = { peak: ['peaks', 'Peak'], five: ['fives', 'Starting Five'], rival: ['rivals', 'Rivalry'], duo: ['duos', 'Dynamic Duo'] }
const TYPES = [
  ['', 'Every game card'], ['statline', 'Stat-line feats'], ['playoffs', 'Playoff games'], ['clincher', 'Title clinchers'], ['debut', 'Debuts'],
  ['holiday', 'Holiday games'], ['potd', 'Player of the Day'], ['potg', 'Player of the Game'], ['career', 'Career-best games'],
]
const SORTS = [['points', 'Points'], ['gs', 'Game Score'], ['elo', 'Elo after the game'], ['new', 'Newest'], ['old', 'Oldest']]
const TIER_COLOR = { goat: '#b8871e', icon: '#7b3fa0', legend: '#b3360f', standout: '#2f67a6', rare: '#2f7a4f', common: '#6a7684' }

// A pack shard row as the card shape (api/_lib/packs.js toCard)
function toCard(cols, r, teams) {
  const o = {}; cols.forEach((k, i) => { o[k] = r[i] })
  const team = c => teams[`${o.s}|${c}`] || teams[c] || [c, null]
  return {
    s: o.s, id: o.id, date: o.date, t: o.t, tn: team(o.t)[0], tc: team(o.t)[1], o: o.o, on: team(o.o)[0], oc: team(o.o)[1],
    home: o.home, won: o.won, score: `${o.us}–${o.them}`, ot: o.ot,
    band: o.band ? { level: o.band[0], label: o.band[1], champ: o.band[2] } : null, honor: o.honor, tier: tierFor(o.lrp ?? o.lr).id,
    row: { n: o.n, pos: o.pos, mp: o.mp, pts: o.pts, trb: o.trb, ast: o.ast, stl: o.stl, blk: o.blk, tp: o.tp, gs: o.gs, pre: o.pre, post: o.post, lr: o.lr, lrp: o.lrp, fx: o.fx, gp: o.gp, hs: o.hs || 0, sw: o.sw || 0 },
  }
}

// Shard files: fetched once per open database; a failed file is dropped so the next search tries it again
const files = new Map()
const getFile = path => {
  if (!files.has(path)) files.set(path, fetch(DATA + path).then(r => { if (!r.ok) throw new Error(path); return r.json() }).catch(e => { files.delete(path); throw e }))
  return files.get(path)
}
async function loadAll(paths, onStep) {
  const out = new Array(paths.length)
  let next = 0, done = 0
  const worker = async () => {
    while (next < paths.length) {
      const i = next++
      out[i] = await getFile(paths[i])
      onStep?.(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, paths.length) }, worker))
  return out
}

const seasonOf = sy => `${sy - 1}-${String(sy % 100).padStart(2, '0')}`
const isGame = c => !c.kind
const fcOf = c => MERGE[c.t] || c.t
const tierOf = c => (isGame(c) ? c.tier || tierFor(c.row?.lrp ?? c.row?.lr).id : c.tier || 'common')
const names = c => (c.kind === 'five' ? c.players.map(p => p.n) : c.kind === 'rival' || c.kind === 'duo' ? [c.a, c.b] : c.row?.n ? [c.row.n] : c.n ? [c.n] : [])
const seasonsOf = c => (c.kind === 'rival' ? (c.seasons || []).map(x => seasonOf(x.sy)) : c.kind === 'duo' ? (c.seasons || []).map(x => x[0]) : c.s ? [c.s] : [])
const elo = c => (c.kind === 'five' || c.kind === 'duo' ? c.elo : c.kind === 'rival' ? c.score : c.row?.post) ?? -1e9
const dateOf = c => c.date || c.last || c.peakDate || ''
const pts = new WeakMap()
const pointsOf = c => { if (!pts.has(c)) { let p = 0; try { p = cardPoints(c).points || 0 } catch { /* a card shape points.js doesn't price */ } pts.set(c, p) } return pts.get(c) }
const listOf = l => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0])
const short = n => n.replace(/\s*\(.*\)$/, '')

function typeOk(c, type) {
  if (!type) return true
  if (SPECIALS[type]) return c.kind === type
  if (!isGame(c)) return false
  const r = c.row || {}
  if (type === 'statline') return hasFeat(r)
  if (type === 'playoffs') return !!c.band
  if (type === 'clincher') return !!c.band?.champ
  if (type === 'debut') return r.gp === 1
  if (type === 'holiday') return !!(c.date && holidayOf(c.date))
  if (type === 'potd') return c.honor === 'potd'
  if (type === 'potg') return c.honor === 'potg'
  if (type === 'career') return !!(r.fx & 1) && (r.gp || 0) >= 20
  return true
}

function PlayerPick({ list, value, onPick }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const hits = useMemo(() => {
    const k = norm(q.trim())
    if (!list || k.length < 2) return []
    const out = []
    for (const p of list) { if (norm(p[0]).includes(k)) { out.push(p); if (out.length >= 40) break } }
    return out.sort((a, b) => (norm(b[0]).startsWith(k) - norm(a[0]).startsWith(k)) || b[4] - a[4]).slice(0, 8)
  }, [q, list])
  if (value) return (
    <div className={styles.picked}>
      <span><b>{short(value[0])}</b><small>{value[2] === value[3] ? value[2] : `${value[2]} – ${value[3]}`} · {value[4].toLocaleString()} cards</small></span>
      <button type="button" aria-label={`Clear ${value[0]}`} onClick={() => onPick(null)}>×</button>
    </div>
  )
  const pick = p => { onPick(p); setQ(''); setOpen(false) }
  return (
    <div className={styles.search}>
      <input type="search" value={q} placeholder={list ? 'Search any player' : 'Loading players…'} disabled={!list} aria-label="Player"
        role="combobox" aria-expanded={open && hits.length > 0} aria-controls="db-player-list" aria-autocomplete="list"
        onChange={e => { setQ(e.target.value); setOpen(true); setHi(0) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(hits.length - 1, h + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)) }
          else if (e.key === 'Enter' && hits[hi]) { e.preventDefault(); pick(hits[hi]) }
          else if (e.key === 'Escape') setOpen(false)
        }} />
      {open && hits.length > 0 && <ul id="db-player-list" role="listbox" className={styles.hits}>
        {hits.map((p, i) => (
          <li key={p[1]} role="option" aria-selected={i === hi} data-hi={i === hi ? '' : undefined} onMouseDown={e => { e.preventDefault(); pick(p) }} onMouseEnter={() => setHi(i)}>
            <b>{short(p[0])}</b><small>{p[2] === p[3] ? p[2] : `${p[2]} – ${p[3]}`} · {p[4].toLocaleString()} cards</small>
          </li>
        ))}
      </ul>}
    </div>
  )
}

export default function CardDatabase({ league, shots, onOpen, onClose, covered, focus }) {
  const C = useCollector()
  const [index, setIndex] = useState(null)
  const [plist, setPlist] = useState(null)
  const [player, setPlayer] = useState(null)
  const [fc, setFc] = useState('')
  const [s0, setS0] = useState('')
  const [s1, setS1] = useState('')
  const [set, setSet] = useState('')
  const [type, setType] = useState('')
  const [tiers, setTiers] = useState([])
  const [sort, setSort] = useState('points')
  const [own, setOwn] = useState('all')
  const [shown, setShown] = useState(PAGE)
  const [src, setSrc] = useState({ cards: null, key: '', note: '', label: '' })
  const [prog, setProg] = useState(null)
  const [err, setErr] = useState(null)
  const [retry, setRetry] = useState(0)
  const boxRef = useRef(null)
  const over = useRef(covered)
  over.current = covered

  useEffect(() => {
    binderJSON(DATA + 'index.json').then(setIndex).catch(() => setErr('The card index didn’t load.'))
    fetch(DATA + 'players.json').then(r => (r.ok ? r.json() : Promise.reject(new Error('players')))).then(setPlist).catch(() => setPlist([]))
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = e => { if (e.key === 'Escape' && !over.current) onClose() }
    window.addEventListener('keydown', esc)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', esc); files.clear() }
  }, [])

  // Opened from a card-catalog drawer: that filter takes the focus once its options are in
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current || !focus || !index || (focus === 'player' && !plist)) return
    const sel = { player: 'input[aria-label=Player]', franchise: '#db-fc', season: '#db-from', set: '#db-set', special: '#db-type', tier: '[aria-label=Tiers] button' }[focus]
    const el = sel && boxRef.current?.querySelector(sel)
    if (el) { focused.current = true; setTimeout(() => el.focus(), 30) }
  }, [focus, index, plist])

  const seasons = useMemo(() => (index ? [...new Set(Object.values(index.tiers).flat().map(([f]) => f.split('/')[1].replace(/-\d+\.json$/, '')))].sort() : []), [index])
  const franchises = useMemo(() => (league?.franchises || []).slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)), [league])
  const lo = s0 && s1 && s0 > s1 ? s1 : s0, hi = s0 && s1 && s0 > s1 ? s0 : s1
  const inRange = s => (!lo || s >= lo) && (!hi || s <= hi)
  const ranged = !!(lo || hi)
  const want = tiers.length ? tiers : TIERS.map(t => t.id)

  // Where the cards come from: the narrowest file set that holds every match
  const plan = useMemo(() => {
    if (!index) return null
    if (set) return { key: `set|${set}`, label: LEAGUE_SETS.find(d => d.id === set)?.title || 'Set' }
    if (SPECIALS[type]) return { key: `special|${type}`, label: `${SPECIALS[type][1]} cards` }
    if (player) return { key: `player|${player[1]}`, label: short(player[0]), paths: [`players/${player[1]}.json`] }
    const trim = byTier => {
      const keep = TIERS.map(t => t.id).filter(t => want.includes(t))
      const dropped = []
      let paths = keep.flatMap(t => byTier(t))
      while (paths.length > BUDGET && keep.length > 3) { dropped.unshift(keep.pop()); paths = keep.flatMap(t => byTier(t)) }
      // The tiers left out still show their biggest cards: the 3,000 best on record ride along
      return { paths: dropped.length ? [...paths, 'top.json'] : paths, dropped }
    }
    if (fc) {
      const T = index.teams[fc] || {}
      const { paths, dropped } = trim(t => (T[t] || []).map(([f]) => f))
      return { key: `team|${fc}|${paths.join()}`, label: `${binderTeamInfo(fc).name} history`, paths, dropped }
    }
    if (ranged) {
      const { paths, dropped } = trim(t => (index.tiers[t] || []).map(([f]) => f).filter(f => inRange(f.split('/')[1].replace(/-\d+\.json$/, ''))))
      return { key: `seasons|${paths.join()}`, label: lo === hi || !hi || !lo ? (lo || hi) : `${lo} to ${hi}`, paths, dropped }
    }
    return { key: 'top', label: 'The 3,000 best cards on record', paths: ['top.json'], top: true }
  }, [index, set, type, player, fc, lo, hi, tiers.join()])

  useEffect(() => {
    if (!plan || src.key === plan.key) return
    let live = true
    setErr(null)
    const done = (cards, extra = {}) => { if (live) { setSrc({ cards, key: plan.key, label: plan.label, dropped: plan.dropped || [], top: !!plan.top, ...extra }); setProg(null) } }
    const fail = () => { if (live) { setErr('Some cards didn’t load.'); setProg(null) } }
    if (plan.key.startsWith('set|')) { done((league?.sets?.[set] || []).map(c => (isGame(c) && !c.tier ? { ...c, tier: tierOf(c) } : c))); return }
    if (plan.key.startsWith('special|')) {
      const [file] = SPECIALS[type]
      getFile('special/index.json').then(ix => {
        const paths = (ix[file] || []).map(([f]) => `special/${f}`)
        setProg([0, paths.length])
        return loadAll(paths, n => live && setProg([n, paths.length]))
      }).then(list => done(list.flatMap(d => d.cards))).catch(fail)
      return () => { live = false }
    }
    setProg([0, plan.paths.length])
    loadAll(plan.paths, n => live && setProg([n, plan.paths.length]))
      .then(list => {
        const seen = new Set()
        done(list.flatMap(d => d.rows.map(r => toCard(index.cols, r, d.teams || {}))).filter(c => { const k = refOf(c); if (seen.has(k)) return false; seen.add(k); return true }))
      }).catch(fail)
    return () => { live = false }
  }, [plan?.key, retry])

  const owned = C.me ? C.owned : null
  const result = useMemo(() => {
    if (!src.cards) return null
    const pn = player?.[0]
    let l = src.cards.filter(c => {
      if (pn && !names(c).includes(pn)) return false
      if (fc && (c.kind === 'rival' || (c.kind === 'five' ? c.fc : fcOf(c)) !== fc)) return false
      if (ranged && !seasonsOf(c).some(inRange)) return false
      if (tiers.length && !tiers.includes(tierOf(c))) return false
      if (!typeOk(c, type)) return false
      if (owned && own !== 'all' && owned.has(refOf(c)) !== (own === 'mine')) return false
      return true
    })
    const by = sort === 'gs' ? (a, b) => (b.row?.gs ?? -1e9) - (a.row?.gs ?? -1e9) : sort === 'elo' ? (a, b) => elo(b) - elo(a)
      : sort === 'new' ? (a, b) => dateOf(b).localeCompare(dateOf(a)) : sort === 'old' ? (a, b) => dateOf(a).localeCompare(dateOf(b)) : null
    l = by ? l.sort((a, b) => by(a, b) || pointsOf(b) - pointsOf(a)) : l.sort((a, b) => pointsOf(b) - pointsOf(a))
    return l
  }, [src, player?.[1], fc, lo, hi, tiers.join(), type, own, sort, owned])

  useEffect(() => { setShown(PAGE) }, [src.key, player?.[1], fc, lo, hi, tiers.join(), type, own, sort])
  const loading = !!plan && src.key !== plan.key && !err
  const toggleTier = t => setTiers(l => (l.includes(t) ? l.filter(x => x !== t) : [...l, t]))
  const clear = () => { setPlayer(null); setFc(''); setS0(''); setS1(''); setSet(''); setType(''); setTiers([]); setOwn('all'); setSort('points') }
  const any = player || fc || s0 || s1 || set || type || tiers.length || own !== 'all' || sort !== 'points'
  const sub = c => {
    if (c.kind === 'rival' || c.kind === 'duo') return `${SPECIALS[c.kind][1]} · ${c.kind === 'duo' ? c.tn || '' : `${c.w}–${c.l}`}`
    if (c.kind === 'five') return `${c.s} · ${binderTeamInfo(c.t, c.tn, c.tc).abbr}`
    if (c.kind && !c.date) return c.s || ''
    return `${c.date ? new Date(c.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : c.s} · ${binderTeamInfo(c.t, c.tn, c.tc).abbr}${c.o ? ` vs ${binderTeamInfo(c.o, c.on, c.oc).abbr}` : ''}`
  }
  const title = c => (c.kind === 'rival' || c.kind === 'duo' ? `${short(c.a)} & ${short(c.b)}` : c.kind === 'five' ? `${c.tn} Five` : c.kind && !c.row ? (c.tn || c.n || '') : short(c.row?.n || ''))
  const line = c => (isGame(c) && c.row ? [c.row.pts != null && `${c.row.pts} pts`, c.row.trb != null && `${c.row.trb} reb`, c.row.ast != null && `${c.row.ast} ast`].filter(Boolean).join(' · ') : '')

  return (
    <div className={styles.layer} role="dialog" aria-modal="true" aria-labelledby="db-title" ref={boxRef}>
      <div className={styles.page}>
        <header className={styles.head}>
          <div>
            <div className={styles.kicker}>THE BINDER ROOM</div>
            <h2 id="db-title" className={styles.title}>Card database</h2>
            <p className={styles.lede}>{index ? `${index.total.toLocaleString()} game cards from every season on record, plus every Peak, Starting Five, Rivalry and Dynamic Duo.` : 'Every card on record.'}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close the card database">×</button>
        </header>

        <div className={styles.filters}>
          <div className={styles.fRow}>
            <label className={styles.field} data-wide="">
              <span>Player</span>
              <PlayerPick list={plist} value={player} onPick={setPlayer} />
            </label>
            <label className={styles.field}>
              <span>Franchise</span>
              <select id="db-fc" value={fc} onChange={e => setFc(e.target.value)}>
                <option value="">Every team</option>
                <optgroup label="Current teams">{franchises.filter(f => f.active).map(f => <option key={f.code} value={f.code}>{f.name}</option>)}</optgroup>
                <optgroup label="Past franchises">{franchises.filter(f => !f.active).map(f => <option key={f.code} value={f.code}>{f.name}{f.code.includes('@') ? ' (ABA)' : ''}</option>)}</optgroup>
              </select>
            </label>
            <div className={styles.field} data-full="">
              <span id="db-seasons">Seasons</span>
              <div className={styles.pair} role="group" aria-labelledby="db-seasons">
                <select id="db-from" value={s0} onChange={e => { setS0(e.target.value); if (!s1 || e.target.value > s1) setS1(e.target.value) }} aria-label="From season">
                  <option value="">From</option>{seasons.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <span aria-hidden="true">–</span>
                <select value={s1} onChange={e => setS1(e.target.value)} aria-label="To season">
                  <option value="">To</option>{seasons.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className={styles.fRow}>
            <label className={styles.field}>
              <span>Card type</span>
              <select id="db-type" value={type} onChange={e => setType(e.target.value)}>
                <optgroup label="Game cards">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
                <optgroup label="Special cards">{Object.entries(SPECIALS).map(([v, [, l]]) => <option key={v} value={v}>{l}</option>)}</optgroup>
              </select>
            </label>
            <label className={styles.field}>
              <span>League set</span>
              <select id="db-set" value={set} onChange={e => setSet(e.target.value)}>
                <option value="">Any set</option>
                {LEAGUE_SETS.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>Sort by</span>
              <select value={sort} onChange={e => setSort(e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            {owned && <div className={styles.field}>
              <span id="db-own">Your binder</span>
              <div className={styles.seg} role="group" aria-labelledby="db-own">
                {[['all', 'All'], ['mine', 'Have'], ['missing', 'Need']].map(([v, l]) => <button key={v} type="button" aria-pressed={own === v} data-on={own === v ? '' : undefined} onClick={() => setOwn(v)}>{l}</button>)}
              </div>
            </div>}
          </div>
          <div className={styles.tierRow} role="group" aria-label="Tiers">
            {TIERS.map(t => <button key={t.id} type="button" className={styles.tier} style={{ '--tc': TIER_COLOR[t.id] }} aria-pressed={tiers.includes(t.id)} data-on={tiers.includes(t.id) ? '' : undefined} onClick={() => toggleTier(t.id)}>{t.label}</button>)}
            {any && <button type="button" className={styles.reset} onClick={clear}>Clear filters</button>}
          </div>
        </div>

        <div className={styles.status} aria-live="polite">
          {err ? <span className={styles.err}>{err} <button type="button" onClick={() => { setSrc(s => ({ ...s, key: '' })); setRetry(n => n + 1) }}>Try again</button></span>
          : loading ? <span>Loading {plan.label}{prog && prog[1] > 1 ? ` · ${prog[0]} of ${prog[1]} files` : '…'}</span>
          : result && <>
            <span><b>{result.length.toLocaleString()}</b> card{result.length === 1 ? '' : 's'} · {src.label}</span>
            {src.top && <span className={styles.hint}>Pick a player, team, season or set to search all of them.</span>}
            {src.dropped?.length > 0 && <span className={styles.hint}>{listOf(src.dropped.map(t => TIERS.find(x => x.id === t).label))} cards are left out of a search this wide, apart from the best of them. Narrow the seasons or pick a player to see them all.</span>}
          </>}
        </div>

        {result && !loading && (result.length ? <ol className={styles.grid}>
          {result.slice(0, shown).map((c, i) => {
            const [tag, bg] = cardType(c)
            const have = owned?.has(refOf(c))
            return (
              <li key={`${refOf(c)}|${i}`}>
                <button type="button" className={styles.tile} onClick={() => onOpen({ kind: 'card', card: c })}>
                  <span className={styles.face}><FaceFit card={c} shots={shots} /><span className={styles.rank}>{i + 1}</span>{have && <span className={styles.have} title="In your binder">✓</span>}</span>
                  <span className={styles.tLine}><b>{title(c)}</b><b className={styles.gold}>{pointsOf(c).toLocaleString()}</b></span>
                  <span className={styles.tSub}>{sub(c)}</span>
                  <span className={styles.tMeta}><i style={{ background: c.kind ? bg : TIER_COLOR[tierOf(c)] }}>{c.kind ? (SPECIALS[c.kind]?.[1] || tag).toUpperCase() : TIERS.find(t => t.id === tierOf(c)).label.replace('★ ', '').toUpperCase()}</i>{line(c)}</span>
                </button>
              </li>
            )
          })}
        </ol> : <p className={styles.empty}>No cards match. Try fewer filters.</p>)}
        {result && !loading && result.length > shown && <div className={styles.more}>
          <button type="button" onClick={() => setShown(n => n + PAGE)}>Show {Math.min(PAGE, result.length - shown)} more</button>
          <small>{shown.toLocaleString()} of {result.length.toLocaleString()}</small>
        </div>}
      </div>
    </div>
  )
}
