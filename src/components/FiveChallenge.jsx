import { useState, useEffect, useMemo } from 'react'
import styles from './FiveChallenge.module.css'
import { Fit, fromIndex } from './Binders'
import { MiniCard } from './PlayerCard'
import { binderLogo, binderTeamInfo } from './SeasonExplorer'
import { TIER_NAME } from './Collector'

/*
 * The weekly Five challenge, a page of My binder: three lineups to build from your own game cards (the same three
 * challenges for everyone each week), each ranked against every real five that franchise put on the floor in its scope.
 *   Easy: one franchise, every era. Medium: that franchise in one era. Hard: one season.
 * Score = total Elo: the pre-game Elo on your cards added up (up to five; fewer counts, at a disadvantage).
 * Percentile = the share of real fives below yours.
 * Coins after the week: the level's top payout × your percentile, doubled if you beat every real five.
 */

const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
const LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const teamName = fc => binderTeamInfo(fc)?.name || fc
const Logo = ({ t, size = 34 }) => <span className={styles.logo} style={{ width: size, height: size }}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>
const scopeText = L => (L.level === 'easy' ? 'Every era' : L.level === 'medium' ? `${L.spec.era.name} era · ${L.spec.era.years}` : `${L.spec.s} season`)
// Does a card fit a challenge? A game card of the franchise, in the level's years
const fits = (L, c) => {
  if (!c || c.kind || c.row?.pre == null || (MERGE[c.t] || c.t) !== L.spec.fc) return false
  const y = +String(c.s).slice(0, 4)
  return L.level === 'easy' ? true : L.level === 'medium' ? y >= L.spec.era.from && y <= L.spec.era.to : c.s === L.spec.s
}

export default function FiveChallenge({ env, tools }) {
  const C = env.collector
  const [d, setD] = useState(null), [err, setErr] = useState(null)
  const [edit, setEdit] = useState(null) // the level being built
  useEffect(() => { C.loadChallenge().then(setD).catch(e => setErr(e.message)) }, [])
  const save = async (level, ids) => { const x = await C.setChallenge(level, ids); if (x) { setD(x); setEdit(null) } }
  return (
    <div className={styles.right}>
      <div className={styles.sheetHead}><div className={styles.sheetTitle}><b>Five challenge</b><span>{d ? `week of ${fmt(d.week)} · lineups lock Sunday night` : ''}</span></div>{tools}</div>
      <div className={styles.body}>
        {err && <p className={styles.note}>{err}</p>}
        {!d && !err && <p className={styles.note}>Loading this week’s challenges…</p>}
        {d && <>
          <p className={styles.intro}>Build a lineup of up to five of your own cards for each challenge. Its total Elo (the pre-game Elo on its cards, added up) is ranked against every real five that franchise put on the floor in those years, one per game. Short a player? Play what you have; it just counts for less. After Sunday you get Coins for your percentile; beat every real five and they double.</p>
          {d.last && <div className={styles.last}>
            <b>Last week</b>
            {d.last.results.map(r => <span key={r.level}>{LEVEL[r.level]} · {r.pct}th percentile · +{r.coins} Coins</span>)}
          </div>}
          {d.levels.map(L => <Level key={L.level} L={L} env={env} onEdit={() => setEdit(L.level)} onClear={() => save(L.level, [])} />)}
        </>}
      </div>
      {edit && d && <Picker L={d.levels.find(x => x.level === edit)} env={env} cards={C.cards} onClose={() => setEdit(null)} onSave={ids => save(edit, ids)} />}
    </div>
  )
}

function Level({ L, env, onEdit, onClear }) {
  const e = L.entry, P = L.pool
  const tc = binderTeamInfo(L.spec.fc)?.color || '#173657'
  // Where the lineup sits between the real fives' middle and best (a guide; the percentile is exact)
  return (
    <section className={styles.level} style={{ '--c': tc }} data-level={L.level}>
      <header>
        <span className={styles.badge}>{LEVEL[L.level]}</span>
        <Logo t={L.spec.fc} />
        <span className={styles.scope}><b>{teamName(L.spec.fc)}</b><small>{scopeText(L)}</small></span>
        <span className={styles.max}>up to <b>{L.max}</b> Coins<small>×2 for beating every real five</small></span>
      </header>
      <div className={styles.poolLine}>{P.n ? <>{P.n.toLocaleString()} real fives over {P.seasons} season{P.seasons === 1 ? '' : 's'} · middle {n0(P.median)} · top 10% {n0(P.p90)} · best {n0(P.best)}</> : 'No real fives in the data for this one.'}</div>
      <div className={styles.slots}>
        {[0, 1, 2, 3, 4].map(i => {
          const x = e?.cards[i]
          if (!x) return <button key={i} type="button" className={styles.slotEmpty} onClick={onEdit}><span>+</span></button>
          const c = fromIndex(env, x.card, { key: `f${i}` })
          return <div key={i} className={styles.slot}><span className={styles.slotCard}><Fit><MiniCard name={c.name} row={c.row} game={c.game} team={c.team} headshot={env.headshot(c.name)} /></Fit></span>
            <small>{baseName(c.name).split(' ').slice(-1)[0]} · {n0(x.card.row.pre)}</small></div>
        })}
      </div>
      {e ? <div className={styles.result}>
        <span><small>Total Elo{e.cards.length < 5 ? ` · ${e.cards.length} of 5` : ''}</small><b>{n0(e.five)}</b></span>
        <span className={styles.bar}><i style={{ width: `${e.pct || 0}%` }} /><em>{e.pct}th percentile</em></span>
        <span><small>{e.five > P.best ? 'Beats them all' : 'Coins now'}</small><b className={styles.coins}>+{e.coins}</b></span>
      </div> : <p className={styles.note}>No lineup yet. Up to five of your {teamName(L.spec.fc)} game cards from {L.level === 'easy' ? 'any season' : L.level === 'medium' ? `${L.spec.era.years}` : L.spec.s}, one per player.</p>}
      <div className={styles.btns}>
        <button type="button" className={styles.primary} onClick={onEdit}>{e ? 'Change lineup' : 'Build lineup'}</button>
        {e && <button type="button" className={styles.ghost} onClick={onClear}>Clear</button>}
      </div>
    </section>
  )
}

// Choose five: your eligible cards, best Elo first; one card per player
function Picker({ L, env, cards, onClose, onSave }) {
  const elig = useMemo(() => (cards || []).filter(x => fits(L, x.card)).sort((a, b) => b.card.row.pre - a.card.row.pre), [cards, L])
  const [sel, setSel] = useState(() => (L.entry?.cards || []).map(x => x.id).filter(id => elig.some(x => Number(x.id) === id)))
  const [busy, setBusy] = useState(false)
  const chosen = sel.map(id => elig.find(x => Number(x.id) === id)).filter(Boolean)
  const five = chosen.length ? chosen.reduce((a, x) => a + x.card.row.pre, 0) : null
  const toggle = x => {
    const id = Number(x.id)
    if (sel.includes(id)) return setSel(sel.filter(v => v !== id))
    const same = chosen.find(y => y.card.row.n === x.card.row.n) // one card per player: swap it in
    const next = same ? sel.filter(v => v !== Number(same.id)) : sel
    if (next.length >= 5) return
    setSel([...next, id])
  }
  const auto = () => { const seen = new Set(), out = []; for (const x of elig) { if (seen.has(x.card.row.n)) continue; seen.add(x.card.row.n); out.push(Number(x.id)); if (out.length === 5) break } setSel(out) }
  const players = new Set(elig.map(x => x.card.row.n)).size
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.picker} onClick={e => e.stopPropagation()} role="dialog" aria-label="Choose five">
        <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.pickHead}>
          <small>{LEVEL[L.level]} · {teamName(L.spec.fc)} · {scopeText(L)}</small>
          <b>Choose five</b>
          <span>{elig.length} eligible card{elig.length === 1 ? '' : 's'} of {players} player{players === 1 ? '' : 's'}{players && players < 5 ? ` · you can play ${players}; a full five scores more` : ''}</span>
        </div>
        <div className={styles.pickBody}>
          {!elig.length && <p className={styles.note}>None of your cards fit this one yet. Team packs, Era packs and the store are the way in.</p>}
          {elig.map(x => {
            const c = fromIndex(env, x.card, { key: `p${x.id}` }), on = sel.includes(Number(x.id))
            return (
              <button key={x.id} type="button" className={`${styles.row} ${on ? styles.rowOn : ''}`} onClick={() => toggle(x)} aria-pressed={on}>
                <span className={styles.rowCard}><Fit><MiniCard name={c.name} row={c.row} game={c.game} team={c.team} headshot={env.headshot(c.name)} /></Fit></span>
                <span className={styles.rowText}><b>{baseName(c.name)}</b><small>{x.card.s} · {fmt(x.card.date)} vs {x.card.o} · {TIER_NAME[x.card.tier] || ''}</small></span>
                <strong>{n0(x.card.row.pre)}<small>Elo</small></strong>
                <i>{on ? '✓' : ''}</i>
              </button>
            )
          })}
        </div>
        <div className={styles.pickFoot}>
          <span><b>{chosen.length}/5</b>{five != null ? ` · Total Elo ${n0(five)}` : ''}</span>
          {players > 0 && <button type="button" className={styles.ghost} onClick={auto}>{players >= 5 ? 'Best five' : `Best ${players}`}</button>}
          <button type="button" className={styles.primary} disabled={!chosen.length || busy} onClick={async () => { setBusy(true); try { await onSave(sel) } finally { setBusy(false) } }}>{busy ? 'Saving…' : 'Save lineup'}</button>
        </div>
      </div>
    </div>
  )
}
