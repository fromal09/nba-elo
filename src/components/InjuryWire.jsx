import { useEffect, useState } from 'react'
import styles from './InjuryWire.module.css'
import { teamInjuries, matters, isGTD, INJ_TAG, injPart, retShort, retAhead } from './injuries'

// The Injury Wire: the injury report for the day's games that haven't tipped, beside the Sportsbook wall.
// Desktop: a side panel, folded to a slim rail with « (remembered on this device). Phone: a tab on the right edge
// that slides the same panel in as a drawer. Inside: tonight's totals, the biggest absences by Elo, then one line per
// game that opens to both teams' lists.
const FOLD_KEY = 'fc.injWire'
const tagOf = st => <span className={styles.tag} data-s={st} title={st}>{INJ_TAG[st]}</span>

export function useWireFold() {
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === 'folded' } catch { return false } })
  const set = v => { setFolded(v); try { localStorage.setItem(FOLD_KEY, v ? 'folded' : 'open') } catch { /* private mode */ } }
  return [folded, set]
}

export default function InjuryWire({ inj, games, day, kit, shots, phone, folded, setFolded, updated }) {
  const { Headshot, tCode, tShort, tColor } = kit
  const [filter, setFilter] = useState('all')   // all | out | gtd
  const [rotation, setRotation] = useState(true) // hide Out players under 1,800 Elo
  const [openGame, setOpenGame] = useState(null)
  const [drawer, setDrawer] = useState(false)
  useEffect(() => {
    if (!drawer) return
    const k = e => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [drawer])
  if (!inj || !games.length) return null

  const keep = i => (!rotation || matters(i)) && (filter === 'all' || (filter === 'out' ? i.st === 'Out' : isGTD(i.st)))
  const rows = games.map(g => {
    const a = teamInjuries(inj, g.away, day), h = teamInjuries(inj, g.home, day)
    const all = [...a, ...h].filter(i => !rotation || matters(i)) // counts match the tile badges while Rotation is on
    return { ...g, a, h, out: all.filter(i => i.st === 'Out').length, gtd: all.filter(i => isGTD(i.st)).length }
  })
  const tot = rows.reduce((t, r) => ({ out: t.out + r.out, gtd: t.gtd + r.gtd }), { out: 0, gtd: 0 })
  const top = rows.flatMap(r => [...r.a, ...r.h].map(i => ({ ...i, g: r }))).filter(i => i.st !== 'Probable' && i.elo).sort((x, y) => y.elo - x.elo).slice(0, 5)
  const counts = (o, q) => <span className={styles.ct}>{o > 0 && <i data-s="Out">{o}</i>}{q > 0 && <i data-s="Questionable">{q}</i>}</span>
  const team = (t, L) => {
    const shown = L.filter(keep), hid = L.length - shown.length
    return (
      <div className={styles.team} style={{ '--c': tColor(t) }}>
        <h5><i />{tShort(t)}</h5>
        {shown.length ? shown.map(i => (
          <div key={i.name} className={styles.pl}>
            {tagOf(i.st)}
            <span className={styles.nm}>{i.name}</span>
            <span className={styles.ret}>{i.st === 'Out' ? (retAhead(i, day) ? `back ~${retShort(i.ret)}` : 'out') : i.st === 'Probable' ? 'likely plays' : 'game-time'}</span>
            <span className={styles.why}>{[injPart(i), i.elo ? `${i.elo.toLocaleString()} Elo` : ''].filter(Boolean).join(' · ') || i.status}</span>
          </div>
        )) : <div className={styles.none}>{L.length ? 'Nobody under this filter' : 'Nobody on the report'}</div>}
        {hid > 0 && filter === 'all' && <button type="button" className={styles.more} onClick={() => setRotation(false)}>+ {hid} more (two-way, long-term)</button>}
      </div>
    )
  }

  const panel = (
    <aside className={styles.panel} aria-label="Injury Wire">
      <div className={styles.head}>
        <b>Injury Wire</b>
        <button type="button" className={styles.fold} onClick={() => (phone ? setDrawer(false) : setFolded(true))} aria-label={phone ? 'Close the Injury Wire' : 'Fold the Injury Wire'} title={phone ? 'Close' : 'Fold'}>{phone ? '×' : '«'}</button>
      </div>
      <div className={styles.tot}><span><i data-s="Out">{tot.out}</i> out</span><span><i data-s="Questionable">{tot.gtd}</i> game-time</span>{updated && <small>ESPN · {updated}</small>}</div>
      <div className={styles.tools}>
        <span className={styles.seg} role="group" aria-label="Show">
          {[['all', 'All'], ['out', 'Out'], ['gtd', 'GTD']].map(([v, l]) => <button key={v} type="button" data-on={filter === v ? '' : undefined} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>)}
        </span>
        <button type="button" className={styles.rot} data-on={rotation ? '' : undefined} aria-pressed={rotation} onClick={() => setRotation(v => !v)} title="Hide Out players under 1,800 Elo">Rotation</button>
      </div>
      {top.length > 0 && <>
        <div className={styles.lab}>Biggest absences</div>
        {top.map(i => (
          <button key={i.name} type="button" className={styles.ab} onClick={() => setOpenGame(i.g.key)}>
            <span className={styles.hs}><Headshot name={i.name} shots={shots} color={tColor(i.team)} /></span>
            <span className={styles.abn}><b>{i.name}</b><small>{tCode(i.g.away)} @ {tCode(i.g.home)}{injPart(i) ? ` · ${injPart(i)}` : ''}</small></span>
            {tagOf(i.st)}
          </button>
        ))}
      </>}
      <div className={styles.lab}>By game <small>tap a game</small></div>
      {rows.map(r => {
        const on = openGame === r.key
        return (
          <div key={r.key} className={styles.game} data-on={on ? '' : undefined}>
            <button type="button" className={styles.gh} onClick={() => setOpenGame(on ? null : r.key)} aria-expanded={on}>
              <span className={styles.tm} style={{ '--c': tColor(r.away) }}>{tCode(r.away)}</span><span className={styles.at}>@</span>
              <span className={styles.tm} style={{ '--c': tColor(r.home) }}>{tCode(r.home)}</span><small>{r.tip}</small>
              {counts(r.out, r.gtd)}<span className={styles.cv}>{on ? '▾' : '▸'}</span>
            </button>
            {on && <div className={styles.gb}>{team(r.away, r.a)}{team(r.home, r.h)}</div>}
          </div>
        )
      })}
      <p className={styles.foot}>Q = questionable · GTD = day-to-day · games leave the wire at tipoff</p>
    </aside>
  )

  if (phone) return <>
    <button type="button" className={styles.etab} onClick={() => setDrawer(true)} aria-label={`Injury Wire: ${tot.out} out, ${tot.gtd} game-time decisions`}>
      <span>Injuries</span><i data-s="Out">{tot.out}</i><i data-s="Questionable">{tot.gtd}</i>
    </button>
    {drawer && <div className={styles.scrim} onClick={() => setDrawer(false)}><div className={styles.drawer} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Injury Wire">{panel}</div></div>}
  </>
  if (folded) return (
    <button type="button" className={styles.rail} onClick={() => setFolded(false)} aria-label={`Open the Injury Wire: ${tot.out} out, ${tot.gtd} game-time decisions`}>
      <span className={styles.fold}>»</span><span className={styles.rv}>Injury Wire</span>
      <span className={styles.rc}><i data-s="Out">{tot.out}</i><i data-s="Questionable">{tot.gtd}</i></span>
      {top.slice(0, 4).map(i => <span key={i.name} className={styles.rd} title={`${i.name} · ${i.st}`}><span className={styles.hs}><Headshot name={i.name} shots={shots} color={tColor(i.team)} /></span><em data-s={i.st} /></span>)}
    </button>
  )
  return panel
}

// A tile's badge: "2 out · 1 GTD" for a game that hasn't tipped
export function InjuryBadge({ inj, away, home, day }) {
  if (!inj) return null
  const L = [...teamInjuries(inj, away, day), ...teamInjuries(inj, home, day)].filter(matters)
  const o = L.filter(i => i.st === 'Out').length, q = L.filter(i => isGTD(i.st)).length
  if (!o && !q) return null
  return <span className={styles.badge}>{o > 0 && <i data-s="Out">{o} out</i>}{q > 0 && <i data-s="Questionable">{q} GTD</i>}</span>
}
