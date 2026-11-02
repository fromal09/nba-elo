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
const yr = s => +String(s).slice(0, 4)
const NBA_MERGED = new Set(['DEN', 'IND', 'SAS', 'BKN'])
const nbaSeason = (fc, s) => !fc.includes('@') && s >= (NBA_MERGED.has(fc) ? '1976-77' : '1949-50')
const fits = (fc, cur, c) => {
  if (!c || c.kind || c.row?.pre == null || c.t !== fc || !nbaSeason(fc, c.s)) return false
  return !cur.window || (yr(c.s) >= cur.window[0] && yr(c.s) <= cur.window[1])
}
const windowText = cur => (!cur.window ? 'any season in franchise history' : cur.window[0] === cur.window[1] ? `the ${cur.s} season only`
  : `${cur.window[0]}-${String(cur.window[0] + 1).slice(2)} to ${cur.window[1]}-${String(cur.window[1] + 1).slice(2)}`)

const SEEN = 'fpr.bannerSeen'
const seenGet = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]')) } catch { return new Set() } }
const seenAdd = k => { try { const x = seenGet(); x.add(k); localStorage.setItem(SEEN, JSON.stringify([...x].slice(-400))) } catch { /* private window */ } }
const TIER_REST = t => ({ goat: 10, icon: 8, legend: 6, standout: 4, rare: 2 })[t] || 0
// Lineup spots on a half court, guards up top and bigs underneath
const SPOTS = [['PG', 50, 24], ['SG', 16, 42], ['SF', 84, 42], ['PF', 31, 75], ['C', 69, 75]]
const posRank = p => (/^PG|^G$/.test(p || '') ? 0 : /SG|G/.test(p || '') ? 1 : /SF/.test(p || '') ? 2 : /PF|F/.test(p || '') ? 3 : /C/.test(p || '') ? 4 : 2)

export default function HangBanner({ env, tools }) {
  const C = env.collector
  const [list, setList] = useState(null), [fc, setFc] = useState(null), [d, setD] = useState(null), [err, setErr] = useState(null)
  const [court, setCourt] = useState(false), [res, setRes] = useState(null)
  useEffect(() => { C.loadBanner().then(setList).catch(e => setErr(e.message)) }, [])
  useEffect(() => { if (!fc) return; setD(null); setRes(null); C.loadBanner(fc).then(setD).catch(e => setErr(e.message)) }, [fc])
  const det = d?.detail, cur = det?.current
  const seen = cur ? seenGet().has(`${fc}|${cur.s}`) : false
  const order = list ? [...list.franchises].sort((a, b) => (b.cleared > 0) - (a.cleared > 0) || b.cleared / b.rungs - a.cleared / a.rungs || teamName(a.fc).localeCompare(teamName(b.fc))) : []
  return (
    <div className={fs.right}>
      <div className={fs.sheetHead}><div className={fs.sheetTitle}><b>Hang the Banner</b><span>{fc ? teamName(fc) : list ? `${list.franchises.filter(f => f.banner).length} banner${list.franchises.filter(f => f.banner).length === 1 ? '' : 's'} hung` : ''}</span></div>{tools}</div>
      <div className={fs.body}>
        {err && <p className={styles.err}>{err}</p>}
        {!fc && <>
          <p className={fs.intro}>Every franchise has a ladder: one rung for each of its NBA seasons, its weakest best five first and its greatest last. Challenge a rung to unveil the five you’re up against, then set your own five from your cards of the franchise. As the rungs get harder, your cards have to come from closer to that season, until the final stretch takes cards from that season alone. Every win opens a pack of the franchise’s cards, better the higher you climb, and a winning card rests for a few rungs by its tier. Beat them all to hang its Banner.</p>
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
                const head = k === 0 || det.ladder[k - 1].stage !== r.stage, S = d.stages[r.stage - 1]
                return <div key={r.i}>
                  {head && <div className={styles.stage}>{S.name}<small>{S.win == null ? 'any season' : S.win === 0 ? 'that season only' : `${S.win} season${S.win === 1 ? '' : 's'} either side`}</small></div>}
                  <div className={styles.rung} data-st={r.status}>
                    <span className={styles.n}>{r.i}</span>
                    {r.status === 'locked' || (r.status === 'current' && !seen) ? <span><b>• • • •</b><small>{r.status === 'current' ? 'challenge it to unveil' : 'locked'}</small></span>
                      : <span><b>{r.s}</b><small>{r.status === 'won' ? `${n0(r.score)} beat ${n0(r.target)}` : `target ${n0(r.target)}`}</small></span>}
                    <span className={styles.st}>{r.status === 'won' ? '✓' : r.status === 'current' ? 'Now' : '🔒'}</span>
                  </div>
                </div>
              })}
            </div>
            <div className={styles.board}>
              {!cur ? <div className={styles.done}><b>★ Banner hung</b><p>Every {teamName(fc)} rung beaten. New seasons join the ladder in the offseason; your Banner card stays yours.</p></div> : <>
                <div className={styles.next} style={{ '--c': binderTeamInfo(fc)?.color || '#173657' }}>
                  <small>Rung {cur.i} of {det.rungs} · stage {cur.stage}</small>
                  <b>{cur.stageName}</b>
                  <span>{seen ? <>The {cur.s} five · {n0(cur.elo)} average Elo</> : 'A mystery five. Challenge it to unveil the season, its strength and its cards.'}</span>
                  <span>Your cards: {windowText(cur)}</span>
                  <span>Win: a {teamName(fc)} pack · {cur.pack}</span>
                  <button type="button" className={fs.primary} onClick={() => { setCourt(true); setRes(null) }}>{seen ? 'Back to the court' : 'Challenge this rung'}</button>
                </div>
                <div className={styles.rule}><b>Rest:</b> a card in a winning five sits out the next rungs of this ladder: GOAT 10, Icon 8, Legend 6, Standout 4, Rare 2. Commons never rest.</div>
              </>}
              {res?.won && <p className={styles.won}>Rung {res.rung} beaten, {n0(res.score)} to {n0(res.target)}. Your pack is open.{res.banner ? ' The Banner card is in your binder.' : ''}</p>}
            </div>
          </div>}
        </>}
      </div>
      {court && cur && <CourtModal env={env} fc={fc} cur={cur} rungs={det.rungs} resting={det.resting || {}} reveal={!seen}
        onSeen={() => seenAdd(`${fc}|${cur.s}`)} onClose={() => setCourt(false)}
        onPlay={async ids => { const x = await C.playBanner(fc, ids); if (x) { setD(x.banner); if (x.result.won) { setRes(x.result); setCourt(false) } } return x?.result }} />}
    </div>
  )
}

// The rung's actual five, from the season file: the cards behind its average
function useRungCards(env, fc, cur) {
  const [cards, setCards] = useState(null)
  useEffect(() => {
    let on = true
    env.getJSON(`/data/explorer/${cur.s}.json`).then(sd => {
      const g = sd.games.find(x => x.date === cur.date && x.teams.includes(fc))
      if (!g) { on && setCards([]); return }
      const C_ = sd.cols, i = g.teams.indexOf(fc), o = g.teams[1 - i]
      const rows = (g.rows || []).map(r => Object.fromEntries(C_.map((k, j) => [k, r[j]])))
      const tn = sd.teams?.[fc] || {}, on_ = sd.teams?.[o] || {}
      const out = cur.five.map(n => rows.find(r => r.n === n)).filter(Boolean).map(row => ({
        s: cur.s, id: g.id, date: g.date, t: fc, tn: tn.name || teamName(fc), tc: tn.color, o, on: on_.name || o, oc: on_.color,
        home: g.home == null ? null : g.home === fc, won: g.pts[i] > g.pts[1 - i], score: `${g.pts[i]}–${g.pts[1 - i]}`, ot: g.ot || '', band: null, honor: null, row }))
      on && setCards(out.sort((a, b) => posRank(a.row.pos) - posRank(b.row.pos)))
    }).catch(() => on && setCards([]))
    return () => { on = false }
  }, [fc, cur.s])
  return cards
}

function CourtModal({ env, fc, cur, rungs, resting, reveal, onSeen, onClose, onPlay }) {
  const C = env.collector
  const theirs = useRungCards(env, fc, cur)
  const [shown, setShown] = useState(reveal ? 0 : 5)
  const [sel, setSel] = useState([]), [busy, setBusy] = useState(false), [out, setOut] = useState(null), [err, setErr] = useState(null)
  // Unveil their five one at a time, the first time this rung is challenged
  useEffect(() => {
    if (!theirs || shown >= 5) return
    const t = setTimeout(() => setShown(v => v + 1), shown === 0 ? 900 : 750)
    return () => clearTimeout(t)
  }, [theirs, shown])
  useEffect(() => { if (theirs && shown >= 5) onSeen() }, [theirs, shown])
  const elig = useMemo(() => (C.cards || []).filter(x => fits(fc, cur, x.card)).sort((a, b) => b.card.row.pre - a.card.row.pre), [C.cards, fc, cur])
  const chosen = sel.map(id => elig.find(x => Number(x.id) === id)).filter(Boolean)
  const used = new Set(chosen.map(x => x.card.row.n))
  // One row per player you could still add: his best card that isn't resting, his others behind it
  const pool = useMemo(() => {
    const by = new Map()
    for (const x of elig) { if (used.has(x.card.row.n)) continue; const k = x.card.row.n; if (!by.has(k)) by.set(k, []); by.get(k).push(x) }
    return [...by.values()].map(l => l.sort((a, b) => !!resting[Number(a.id)] - !!resting[Number(b.id)] || b.card.row.pre - a.card.row.pre))
  }, [elig, sel, resting])
  const avg = chosen.length ? chosen.reduce((a, x) => a + x.card.row.pre, 0) / chosen.length : null
  const add = x => { if (chosen.length < 5 && !resting[Number(x.id)]) { setSel([...sel, Number(x.id)]); setOut(null) } }
  const play = async () => { setBusy(true); setErr(null); try { const r = await onPlay(sel); if (r) setOut(r) } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const face = c => { const e = fromIndex(env, c, { key: `${c.s}|${c.id}|${c.row.n}` }); return <Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit> }
  const tc = binderTeamInfo(fc)?.color || '#173657'
  return (
    <div className={styles.cmOverlay} onClick={onClose}>
      <div className={styles.cm} style={{ '--c': tc }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Challenge the rung">
        <button type="button" className={fs.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.cmHead}>
          <small>{teamName(fc)} · rung {cur.i} of {rungs} · {cur.stageName}</small>
          <b className={shown >= 1 ? styles.in : styles.hid}>The {cur.s} {teamName(fc).split(' ').pop()}</b>
          <span className={shown >= 1 ? styles.in : styles.hid}>{fmt(cur.date)} vs {cur.opp} · {cur.won ? 'W' : 'L'} {cur.score} · <b>{n0(cur.elo)}</b> average pre-game Elo</span>
        </div>
        <div className={styles.courts}>
          <div className={styles.side2}>
            <div className={styles.cTitle}><span>Their five</span><b>{n0(cur.elo)}</b></div>
            <div className={styles.court}>
              {SPOTS.map(([p, x, y], i) => <div key={p} className={styles.spot} style={{ left: `${x}%`, top: `${y}%` }}>
                {theirs && theirs[i] && i < shown ? <div className={styles.flipIn}>{face(theirs[i])}<em>{last(theirs[i].row.n)} · {n0(theirs[i].row.pre)}</em></div>
                  : <div className={styles.cardBack}><i>{p}</i></div>}
              </div>)}
            </div>
          </div>
          <div className={styles.side2}>
            <div className={styles.cTitle}><span>Your five</span><b data-win={chosen.length === 5 ? (avg > cur.elo ? 'y' : 'n') : undefined}>{avg != null ? n0(avg) : '—'}</b></div>
            <div className={`${styles.court} ${styles.courtMine}`}>
              {SPOTS.map(([p, x, y], i) => <div key={p} className={styles.spot} style={{ left: `${x}%`, top: `${y}%` }}>
                {chosen[i] ? <button type="button" className={styles.placed} onClick={() => setSel(sel.filter(v => v !== Number(chosen[i].id)))} title="Take him off the court">{face(chosen[i].card)}<em>{last(chosen[i].card.row.n)} · {n0(chosen[i].card.row.pre)}</em></button>
                  : <div className={styles.empty}><i>{i === chosen.length ? '+' : p}</i></div>}
              </div>)}
            </div>
          </div>
        </div>
        <div className={styles.cmRule}>Your cards: {windowText(cur)}, five different players. Tap a player to put him on the court; tap him there to take him off.</div>
        <div className={styles.pool}>
          {shown < 5 && reveal ? <p className={fs.note}>Unveiling their five…</p>
            : !pool.length && chosen.length < 5 ? <p className={fs.note}>{chosen.length ? 'No more of your players fit this rung.' : 'None of your cards fit this rung yet. Team packs, Era packs and the store are the way in.'}</p>
            : pool.map(l => {
              const x = l[0], rest = resting[Number(x.id)]
              return <button key={x.card.row.n} type="button" className={styles.prow} disabled={!!rest || chosen.length >= 5} onClick={() => add(x)}>
                <span className={styles.pcard}>{face(x.card)}</span>
                <span className={styles.ptext}><b>{baseName(x.card.row.n)}</b><small>{x.card.s} · {fmt(x.card.date)} vs {x.card.o} · {TIER_NAME[x.card.tier] || ''}{l.length > 1 ? ` · ${l.length} cards` : ''}</small>
                  {rest ? <em>Resting {rest} more rung{rest === 1 ? '' : 's'}</em> : TIER_REST(x.card.tier) ? <em className={styles.restNote}>Rests {TIER_REST(x.card.tier)} rungs if he wins</em> : null}</span>
                <strong>{n0(x.card.row.pre)}<small>Elo</small></strong>
              </button>
            })}
        </div>
        <div className={styles.cmFoot}>
          {out && !out.won && <span className={styles.lost}>Not this time: {n0(out.score)} against {n0(out.target)}.</span>}
          {err && <span className={styles.lost}>{err}</span>}
          <span className={styles.gapTxt}>{chosen.length === 5 ? (avg > cur.elo ? `Beats it by ${n0(avg - cur.elo)}` : `${n0(cur.elo - avg + 1)} short`) : `${chosen.length} of 5 on the court`}</span>
          <button type="button" className={fs.primary} disabled={chosen.length !== 5 || busy} onClick={play}>{busy ? 'Playing…' : 'Play this rung'}</button>
        </div>
      </div>
    </div>
  )
}
