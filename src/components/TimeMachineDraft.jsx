import { useState, useMemo, useEffect } from 'react'
import styles from './TimeMachine.module.css'
import * as TM from './timemachine.js'

// Draft room: build a league from player-seasons. Snake draft against the computer, commissioner mode
// (you pick for every team), or a full auto-draft.

export const DRAFT_DEFAULT = { size: 8, roster: 10, confs: 1, games: 82, po: 4, mode: 'b', home: true, seed: 1, you: 0, type: 'snake', era: true, picks: [], depth: [] }
const yl = s => TM.yearLabel(s)

function Seg({ value, options, onChange }) {
  return (
    <div className={styles.seg}>
      {options.map(([v, label]) => <button key={v} type="button" className={v === value ? styles.segOn : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  )
}

export function DraftRoom({ pool, dl, setDl, onSimulate, catalogLeagues }) {
  const [q, setQ] = useState('')
  const [decade, setDecade] = useState('all')
  const [posF, setPosF] = useState('all')
  const [edit, setEdit] = useState(null)   // { team, slot } being changed
  TM.applyEra(pool, dl.era !== false)
  const [uniqPlayer, setUniqPlayer] = useState(true)
  const N = dl.size, total = N * dl.roster
  const picks = dl.picks.length === N ? dl.picks : Array.from({ length: N }, (_, i) => dl.picks[i] || [])
  const made = picks.reduce((s, p) => s + p.length, 0)
  const done = made >= total
  const onClock = done ? -1 : TM.snakeTeam(made, N)
  const taken = new Set(picks.flat())
  const takenNames = new Set(picks.flat().map(id => pool.byId[id]?.n))
  const okPick = r => !taken.has(r.id) && !(uniqPlayer && takenNames.has(r.n))
  const sorted = useMemo(() => [...pool.rows].sort((a, b) => b.value - a.value), [pool, dl.era])
  const available = useMemo(() => sorted.filter(okPick), [sorted, made, uniqPlayer])
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return available.filter(r => {
      if (decade !== 'all' && r.s.slice(0, 3) !== decade) return false
      if (posF !== 'all' && r.pos !== posF) return false
      const hay = `${r.n} ${r.s} ${r.t}`.toLowerCase()
      return words.every(w => (/^\d{2}$/.test(w) ? r.s.slice(2, 4) === w || r.s.slice(5) === w : hay.includes(w)))
    }).slice(0, 80)
  }, [available, q, decade, posF])
  const decades = useMemo(() => [...new Set(pool.rows.map(r => r.s.slice(0, 3)))].sort(), [pool])

  const setPicks = next => setDl({ ...dl, picks: next, depth: [] })
  const pick = r => {
    if (done || !okPick(r)) return
    const next = picks.map(p => [...p])
    next[onClock].push(r.id)
    setPicks(advance(next))
  }
  // The computer picks until it's a human's turn (snake: your team; commissioner: never; auto: never stops)
  const advance = (next, all = false) => {
    const R = TM.rng(TM.hash('draft', dl.seed, next.flat().length))
    const tk = new Set(next.flat()), names = new Set(next.flat().map(id => pool.byId[id]?.n))
    let k = next.reduce((s, p) => s + p.length, 0)
    while (k < total) {
      const t = TM.snakeTeam(k, N)
      const human = dl.type === 'commish' || (dl.type === 'snake' && t === dl.you)
      if (human && !all) break
      const avail = sorted.filter(r => !tk.has(r.id) && !(uniqPlayer && names.has(r.n))).slice(0, 40)
      const r = TM.cpuPick(avail, next[t].map(id => pool.byId[id]).filter(Boolean), pool.coef, R, dl.roster, R)
      if (!r) break
      next[t].push(r.id); tk.add(r.id); names.add(r.n); k++
    }
    return next
  }
  useEffect(() => {
    // Start: let the computer pick ahead of you
    if (made === 0 && dl.type !== 'commish') setPicks(advance(picks.map(p => [...p]), dl.type === 'auto'))
  }, [dl.type, dl.you, N, dl.roster, dl.seed, made === 0])

  const teams = picks.map((ids, i) => TM.draftTeam(ids.map(id => pool.byId[id]).filter(Boolean), pool.coef, i, null, dl.roster, dl.depth?.[i]))
  const canEdit = i => picks[i].length === dl.roster && (dl.type !== 'snake' || i === dl.you)
  // Put player id into slot k of team i (swapping with wherever he was)
  const place = (i, k, id) => {
    const order = teams[i].depth.map(p => p?.id || null)
    const from = order.indexOf(id)
    if (from < 0) return
    ;[order[k], order[from]] = [order[from], order[k]]
    const depth = [...(dl.depth || [])]
    while (depth.length < N) depth.push(null)
    depth[i] = order
    setDl({ ...dl, depth })
    setEdit(null)
  }
  const autoDepth = i => { const depth = [...(dl.depth || [])]; depth[i] = null; setDl({ ...dl, depth }) }
  const rating = t => TM.ratingFor(t, dl.mode)
  const reset = patch => setDl({ ...dl, ...patch, picks: [], depth: [] })
  const ppgOf = p => catalogLeagues[`${p.s}|${p.lg}`]?.ppg

  return (
    <div className={styles.builder} data-draft="">
      <aside className={`${styles.card} ${styles.settings}`}>
        <div><div className={styles.lab}>Draft</div>
          <Seg value={dl.type} options={[['snake', 'Vs computer'], ['commish', 'Pick all'], ['auto', 'Auto']]} onChange={type => reset({ type })} />
          <p className={styles.hint}>{dl.type === 'snake' ? 'Snake draft: you pick for one team, the computer drafts the rest.' : dl.type === 'commish' ? 'You make every pick for every team.' : 'The computer drafts every team.'}</p></div>
        <div><div className={styles.lab}>Teams</div>
          <Seg value={N} options={[4, 6, 8, 10, 12, 16].map(n => [n, n])} onChange={size => reset({ size, you: Math.min(dl.you, size - 1), confs: size >= 8 ? dl.confs : 1, po: Math.min(dl.po, size >= 8 && dl.confs === 2 ? size / 2 : size) })} /></div>
        <div><div className={styles.lab}>Roster</div>
          <Seg value={dl.roster} options={[8, 10, 12].map(n => [n, n])} onChange={roster => reset({ roster })} /></div>
        {dl.type === 'snake' && <div><div className={styles.lab}>Your pick</div>
          <select className={styles.teamSel} value={dl.you} onChange={e => reset({ you: +e.target.value })}>
            {Array.from({ length: N }, (_, i) => <option key={i} value={i}>No. {i + 1} · {TM.DRAFT_NAMES[i]}</option>)}
          </select></div>}
        <div><div className={styles.lab}>Conferences</div>
          <Seg value={dl.confs} options={[[1, 'One table'], ...(N >= 8 ? [[2, 'Two']] : [])]} onChange={confs => setDl({ ...dl, confs, po: Math.min(dl.po, confs === 2 ? N / 2 : N) })} /></div>
        <div><div className={styles.lab}>Schedule</div>
          <Seg value={dl.games} options={TM.LENGTHS.map(n => [n, n])} onChange={games => setDl({ ...dl, games })} /></div>
        <div><div className={styles.lab}>Playoffs</div>
          <Seg value={dl.po} options={TM.playoffChoices(dl).map(n => [n, n])} onChange={po => setDl({ ...dl, po })} /></div>
        <div><div className={styles.lab}>Team rating</div>
          <Seg value={dl.mode} options={Object.entries(TM.MODES)} onChange={mode => setDl({ ...dl, mode })} />
          <p className={styles.hint}>Each player is a z-score against his own league that season. A roster's minutes-weighted average maps to a team rating fitted on every real team-season.</p></div>
        <label className={styles.toggle}><span>One season per player</span><input type="checkbox" checked={uniqPlayer} onChange={e => setUniqPlayer(e.target.checked)} /><i /></label>
        <label className={styles.toggle}><span>Era adjustment</span><input type="checkbox" checked={dl.era !== false} onChange={e => setDl({ ...dl, era: e.target.checked })} /><i /></label>
        <p className={styles.hint} style={{ marginTop: -10 }}>Early seasons count less: before 1954-55 a player's edge counts 60%, through 1966-67 75%, through 1975-76 88%.</p>
      </aside>

      <div className={styles.draftMain}>
        <div className={`${styles.card} ${styles.clock}`}>
          {done ? <><b>Draft complete</b><span>{total} picks</span></>
            : <><b>Round {Math.floor(made / N) + 1} · Pick {made + 1} of {total}</b>
              <span style={{ color: teams[onClock].color }}>{teams[onClock].name}{dl.type === 'snake' && onClock === dl.you ? ' (you)' : ''} on the clock</span></>}
        </div>
        <div className={styles.draftTeams}>
          {teams.map((t, i) => (
            <div key={i} className={`${styles.card} ${styles.dTeam} ${i === onClock ? styles.dOn : ''}`} style={{ '--tc': t.color }}>
              <div className={styles.dHead}><b>{t.name}{dl.type === 'snake' && i === dl.you ? ' ★' : ''}</b>
                <span>{picks[i].length ? TM.ratingFor(t, dl.mode, false).toLocaleString() : '—'}</span></div>
              {t.slots.map((slot, k) => {
                const p = t.depth[k]
                const pen = p ? TM.penaltyFor(p, slot) : 0
                const open = edit && edit.team === i && edit.slot === k
                return (
                  <div key={k} className={`${styles.dRow} ${slot.starter ? '' : styles.dBench}`}>
                    <span className={styles.dSlot}>{slot.label.replace(' · 2nd', '').replace(' · bench', '')}</span>
                    {open ? (
                      <select autoFocus className={styles.dSel} value={p?.id || ''} onChange={e => place(i, k, e.target.value)} onBlur={() => setEdit(null)}>
                        {t.depth.filter(Boolean).map(x => <option key={x.id} value={x.id}>{x.n} ({x.pos}{TM.penaltyFor(x, slot) ? ` · −${TM.penaltyFor(x, slot)}` : ''})</option>)}
                      </select>
                    ) : (
                      <button type="button" className={styles.dWho} disabled={!canEdit(i) || !p} onClick={() => setEdit({ team: i, slot: k })}
                        title={p ? `${p.s} ${p.n}, ${p.pos}${pen ? ` · out of position: −${pen} value` : ''}` : ''}>
                        {p ? <><b className={styles.year}>{yl(p.s)}</b> {p.n}</> : <i>—</i>}
                      </button>
                    )}
                    {p && <em className={pen ? styles.dPen : ''}>{p.pos}</em>}
                    <em>{Math.round(slot.mp)}</em>
                  </div>
                )
              })}
              {canEdit(i) && dl.depth?.[i] && <button type="button" className={styles.dAuto} onClick={() => autoDepth(i)}>Reset to best depth chart</button>}
            </div>
          ))}
        </div>
      </div>

      <aside className={`${styles.card} ${styles.picker}`}>
        <div className={styles.pickHead}>
          <div className={styles.lab}>Available player-seasons</div>
          <div className={styles.search}><span>⌕</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Player, team or year (Jordan 96)" /><small>{available.length.toLocaleString()}</small></div>
          <div className={styles.filters}>
            {['all', ...TM.POS].map(x => <button key={x} type="button" className={posF === x ? styles.fOn : ''} onClick={() => setPosF(x)}>{x === 'all' ? 'All' : x}</button>)}
            <select value={decade} onChange={e => setDecade(e.target.value)}>
              <option value="all">All decades</option>
              {decades.map(d => <option key={d} value={d}>{d}0s</option>)}
            </select>
          </div>
        </div>
        <div className={styles.pickList}>
          {results.map(r => (
            <div key={r.id} className={styles.pick}>
              <b className={styles.year}>{yl(r.s)}</b>
              <div className={styles.pickMain}>
                <b>{r.n} <span className={styles.posTag}>{r.pos}</span></b>
                <small>{r.t.replace(/@.*/, '')} · {r.pts ?? '—'} pts · {r.trb ?? '—'} reb · {r.ast ?? '—'} ast · {r.gs} GmSc</small>
              </div>
              <b className={styles.pickRate} title="What he adds to a team rating: his Elo z-score against his own league, from the fit that rates rosters">{r.value >= 0 ? '+' : ''}{r.value.toFixed(2)}</b>
              <button type="button" className={styles.add} disabled={done || (dl.type === 'snake' && onClock !== dl.you)} onClick={() => pick(r)} aria-label={`Draft ${r.s} ${r.n}`}>+</button>
            </div>
          ))}
          {!results.length && <p className={styles.none}>No player-seasons match.</p>}
        </div>
        <p className={styles.formula}>Value = what he adds to a team rating (Elo z-score against his own league)</p>
      </aside>

      <div className={styles.buildBar}>
        <button type="button" className={styles.btn} onClick={() => reset({ seed: (Date.now() % 1e6) | 0 })}>Restart draft</button>
        <button type="button" className={styles.btn} disabled={done} onClick={() => setPicks(advance(picks.map(p => [...p]), true))}>Auto-draft the rest</button>
        <button type="button" className={`${styles.btn} ${styles.pri}`} disabled={!done} onClick={onSimulate}>{done ? 'Simulate season ▸' : `${total - made} picks to go`}</button>
      </div>
    </div>
  )
}
