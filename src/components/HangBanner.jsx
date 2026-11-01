import { useState, useEffect, useMemo } from 'react'
import styles from './HangBanner.module.css'
import fs from './FiveChallenge.module.css'
import { Fit, fromIndex } from './Binders'
import { MiniCard } from './PlayerCard'
import { binderLogo, binderTeamInfo } from './SeasonExplorer'
import { TIER_NAME } from './Collector'

/*
 * Hang the Banner, a page of My binder (api/_lib/banner.js has the rules). Every franchise has a ladder, one rung per
 * finished NBA season, weakest best five first. Beat a rung's five (its average pre-game Elo) with five of your own
 * cards of the franchise to see the next one; the card window narrows by stage. Every win opens a pack of the
 * franchise's cards; beating every rung hangs the franchise's Banner card in your binder.
 */

const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const last = n => baseName(n).split(' ').slice(-1)[0]
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const teamName = fc => binderTeamInfo(fc)?.name || fc
const Logo = ({ t, size = 34 }) => <span className={styles.logo} style={{ width: size, height: size }}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>
const PACK_TEXT = ['', 'Five slots of the franchise’s cards', 'The last slot Rare or better', 'Two slots Rare or better', 'Every slot Rare or better, the last Standout or better',
  'Two slots Legend or better', 'Two slots Legend or better, the last Icon or better']
const yr = s => +String(s).slice(0, 4)
const NBA_MERGED = new Set(['DEN', 'IND', 'SAS', 'BKN'])
const nbaSeason = (fc, s) => !fc.includes('@') && s >= (NBA_MERGED.has(fc) ? '1976-77' : '1949-50')
const fits = (fc, cur, c) => {
  if (!c || c.kind || c.row?.pre == null || c.t !== fc || !nbaSeason(fc, c.s)) return false
  return !cur.window || (yr(c.s) >= cur.window[0] && yr(c.s) <= cur.window[1])
}
const windowText = cur => (!cur.window ? 'any season in franchise history' : cur.window[0] === cur.window[1] ? `the ${cur.s} season only`
  : `${cur.window[0]}-${String(cur.window[0] + 1).slice(2)} to ${cur.window[1]}-${String(cur.window[1] + 1).slice(2)}`)

export default function HangBanner({ env, tools }) {
  const C = env.collector
  const [list, setList] = useState(null), [fc, setFc] = useState(null), [d, setD] = useState(null), [err, setErr] = useState(null)
  const [pick, setPick] = useState(false), [sel, setSel] = useState([]), [res, setRes] = useState(null), [busy, setBusy] = useState(false)
  useEffect(() => { C.loadBanner().then(setList).catch(e => setErr(e.message)) }, [])
  useEffect(() => { if (!fc) return; setD(null); setSel([]); setRes(null); C.loadBanner(fc).then(setD).catch(e => setErr(e.message)) }, [fc])
  const det = d?.detail, cur = det?.current
  const chosen = useMemo(() => sel.map(id => (C.cards || []).find(x => Number(x.id) === id)).filter(Boolean), [sel, C.cards])
  const score = chosen.length === 5 ? chosen.reduce((a, x) => a + x.card.row.pre, 0) / 5 : null
  const play = async () => {
    setBusy(true); setErr(null)
    try { const x = await C.playBanner(fc, sel); if (x) { setRes(x.result); setD(x.banner); if (x.result.won) setSel([]) } } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const order = list ? [...list.franchises].sort((a, b) => (b.cleared > 0) - (a.cleared > 0) || b.cleared / b.rungs - a.cleared / a.rungs || teamName(a.fc).localeCompare(teamName(b.fc))) : []
  return (
    <div className={fs.right}>
      <div className={fs.sheetHead}><div className={fs.sheetTitle}><b>Hang the Banner</b><span>{fc ? teamName(fc) : list ? `${list.franchises.filter(f => f.banner).length} banner${list.franchises.filter(f => f.banner).length === 1 ? '' : 's'} hung` : ''}</span></div>{tools}</div>
      <div className={fs.body}>
        {err && <p className={styles.err}>{err}</p>}
        {!fc && <>
          <p className={fs.intro}>Every franchise has a ladder: one rung for each of its NBA seasons, its weakest best five first and its greatest last. Beat a rung’s five with five of your own cards of the franchise to see the next one. As the rungs get harder, your cards have to come from closer to that season, until the last rung takes cards from that season alone. Every win opens a pack of the franchise’s cards, better the higher you climb. Beat them all to hang its Banner.</p>
          {!list && !err && <p className={fs.note}>Loading the ladders…</p>}
          <div className={styles.grid}>
            {order.map(f => (
              <button key={f.fc} type="button" className={styles.tile} style={{ '--c': binderTeamInfo(f.fc)?.color || '#173657' }} onClick={() => setFc(f.fc)}>
                <Logo t={f.fc} size={36} />
                <span className={styles.tileText}><b>{teamName(f.fc)}</b><small>{f.banner ? '★ Banner hung' : f.cleared ? `Rung ${Math.min(f.cleared + 1, f.rungs)} of ${f.rungs}` : `${f.rungs} rungs`}</small>
                  <span className={styles.meter}><i style={{ width: `${(f.cleared / f.rungs) * 100}%` }} /></span></span>
              </button>
            ))}
          </div>
        </>}
        {fc && <>
          <button type="button" className={styles.back} onClick={() => { setFc(null); C.loadBanner().then(setList).catch(() => {}) }}>← All franchises</button>
          {!det && <p className={fs.note}>Loading the {teamName(fc)} ladder…</p>}
          {det && <div className={styles.lad} style={{ '--c': binderTeamInfo(fc)?.color || '#173657' }}>
            <div className={styles.rungs}>
              <div className={styles.ladHead}><Logo t={fc} size={30} /><span><b>{det.cleared} of {det.rungs}</b><small>{det.banner ? '★ Banner hung' : 'rungs beaten'}</small></span></div>
              {det.ladder.map((r, k) => {
                const head = k === 0 || det.ladder[k - 1].stage !== r.stage
                return <div key={r.i}>
                  {head && <div className={styles.stage}>{d.stages[r.stage - 1].name}<small>{d.stages[r.stage - 1].win == null ? 'any season' : d.stages[r.stage - 1].win === 0 ? 'that season only' : `within ${d.stages[r.stage - 1].win} yrs`}</small></div>}
                  <div className={styles.rung} data-st={r.status}>
                    <span className={styles.n}>{r.i}</span>
                    {r.status === 'locked' ? <span><b>• • • •</b><small>locked</small></span>
                      : <span><b>{r.s}</b><small>{r.status === 'won' ? `${n0(r.score)} beat ${n0(r.target)}` : `target ${n0(r.target)}`}</small></span>}
                    <span className={styles.st}>{r.status === 'won' ? '✓' : r.status === 'current' ? 'Now' : '🔒'}</span>
                  </div>
                </div>
              })}
            </div>
            <div className={styles.board}>
              {!cur ? <div className={styles.done}><b>★ Banner hung</b><p>Every {teamName(fc)} rung beaten. New seasons join the ladder in the offseason; your Banner card stays yours.</p></div> : <>
                <div className={styles.boardHead}><small>Rung {cur.i} of {det.rungs} · stage {cur.stage}: {cur.stageName}</small>
                  <b>Beat the {cur.s} five</b><span>{fmt(cur.date)} vs {cur.opp} · {cur.won ? 'W' : 'L'} {cur.score}</span></div>
                <div className={styles.vs}>
                  <div className={styles.side}><h5>Their five <span>avg pre-game Elo</span></h5><div className={styles.avg}>{n0(cur.elo)}<small>target</small></div>
                    {cur.five.map(n => <div key={n} className={styles.pl}><b>{baseName(n)}</b></div>)}</div>
                  <div className={styles.side}><h5>Your five <span>avg pre-game Elo</span></h5>
                    <div className={styles.avg} data-win={score != null ? (score > cur.elo ? 'y' : 'n') : undefined}>{score != null ? n0(score) : '—'}<small>{score == null ? `${chosen.length} of 5` : score > cur.elo ? 'beats it' : `${n0(cur.elo - score + 1)} short`}</small></div>
                    {[0, 1, 2, 3, 4].map(i => { const x = chosen[i]; return x
                      ? <div key={i} className={styles.slot}><b title={baseName(x.card.row.n)}>{last(x.card.row.n)}</b><em>{x.card.s}</em><span>{n0(x.card.row.pre)}</span></div>
                      : <button key={i} type="button" className={styles.slotEmpty} onClick={() => setPick(true)}>+ Add a card</button> })}
                  </div>
                </div>
                <div className={styles.rule}><b>{cur.stageName}:</b> cards from {windowText(cur)}. Five different players, each a game card of the {teamName(fc)}. A card counts its pre-game Elo, the number on the card; your five’s average has to be higher than theirs.</div>
                <div className={styles.btns}>
                  <button type="button" className={fs.ghost} onClick={() => setPick(true)}>{chosen.length ? 'Change cards' : 'Choose five'}</button>
                  <button type="button" className={fs.primary} disabled={chosen.length !== 5 || busy} onClick={play}>{busy ? 'Playing…' : 'Play this rung'}</button>
                </div>
                {res && !res.won && <p className={styles.lost}>Not this time: {n0(res.score)} against {n0(res.target)}. Try a stronger five.</p>}
                <div className={styles.reward}><small>Win this rung</small><b>{teamName(fc)} pack</b><span>{PACK_TEXT[cur.stage]}</span></div>
              </>}
              {res?.won && <p className={styles.won}>Rung {res.rung} beaten, {n0(res.score)} to {n0(res.target)}. Your pack is open.{res.banner ? ' The Banner card is in your binder.' : ''}</p>}
            </div>
          </div>}
        </>}
      </div>
      {pick && cur && <Picker fc={fc} cur={cur} env={env} cards={C.cards} sel={sel} onClose={() => setPick(false)} onDone={v => { setSel(v); setPick(false); setRes(null) }} />}
    </div>
  )
}

// Choose five: your cards that fit the rung, best pre-game Elo first; one card per player
function Picker({ fc, cur, env, cards, sel: sel0, onClose, onDone }) {
  const elig = useMemo(() => (cards || []).filter(x => fits(fc, cur, x.card)).sort((a, b) => b.card.row.pre - a.card.row.pre), [cards, fc, cur])
  const [sel, setSel] = useState(() => sel0.filter(id => elig.some(x => Number(x.id) === id)))
  const chosen = sel.map(id => elig.find(x => Number(x.id) === id)).filter(Boolean)
  const avg = chosen.length ? chosen.reduce((a, x) => a + x.card.row.pre, 0) / chosen.length : null
  const toggle = x => {
    const id = Number(x.id)
    if (sel.includes(id)) return setSel(sel.filter(v => v !== id))
    const same = chosen.find(y => y.card.row.n === x.card.row.n)
    const next = same ? sel.filter(v => v !== Number(same.id)) : sel
    if (next.length >= 5) return
    setSel([...next, id])
  }
  const auto = () => { const seen = new Set(), out = []; for (const x of elig) { if (seen.has(x.card.row.n)) continue; seen.add(x.card.row.n); out.push(Number(x.id)); if (out.length === 5) break } setSel(out) }
  const players = new Set(elig.map(x => x.card.row.n)).size
  return (
    <div className={fs.overlay} onClick={onClose}>
      <div className={fs.picker} onClick={e => e.stopPropagation()} role="dialog" aria-label="Choose five">
        <button type="button" className={fs.x} onClick={onClose} aria-label="Close">×</button>
        <div className={fs.pickHead}>
          <small>{teamName(fc)} · rung {cur.i} · {windowText(cur)}</small>
          <b>Choose five</b>
          <span>{elig.length} card{elig.length === 1 ? '' : 's'} fit, of {players} player{players === 1 ? '' : 's'} · target {n0(cur.elo)}</span>
        </div>
        <div className={fs.pickBody}>
          {players < 5 && <p className={fs.note}>{players ? `Only ${players} of your players fit this rung. You need five.` : 'None of your cards fit this rung yet.'} Team packs, Era packs and the store are the way in.</p>}
          {elig.map(x => {
            const c = fromIndex(env, x.card, { key: `b${x.id}` }), on = sel.includes(Number(x.id))
            return (
              <button key={x.id} type="button" className={`${fs.row} ${on ? fs.rowOn : ''}`} onClick={() => toggle(x)} aria-pressed={on}>
                <span className={fs.rowCard}><Fit><MiniCard name={c.name} row={c.row} game={c.game} team={c.team} headshot={env.headshot(c.name)} /></Fit></span>
                <span className={fs.rowText}><b>{baseName(c.name)}</b><small>{x.card.s} · {fmt(x.card.date)} vs {x.card.o} · {TIER_NAME[x.card.tier] || ''}</small></span>
                <strong>{n0(x.card.row.pre)}<small>Elo</small></strong>
                <i>{on ? '✓' : ''}</i>
              </button>
            )
          })}
        </div>
        <div className={fs.pickFoot}>
          <span><b>{chosen.length}/5</b>{avg != null ? ` · average ${n0(avg)}${chosen.length === 5 ? (avg > cur.elo ? ' · beats it' : ' · short') : ''}` : ''}</span>
          {players >= 5 && <button type="button" className={fs.ghost} onClick={auto}>Best five</button>}
          <button type="button" className={fs.primary} disabled={chosen.length !== 5} onClick={() => onDone(sel)}>Use these five</button>
        </div>
      </div>
    </div>
  )
}
