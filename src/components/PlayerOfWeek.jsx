import { useState, useEffect, useMemo } from 'react'
import styles from './PlayerOfWeek.module.css'
import { SpecialFace, weekSpan } from './SpecialCards'
import { binderLogo, binderTeamInfo } from './SeasonExplorer'
import { useLiveFeeds, liveDaysAfter, computeLive } from './liveFeed'
import { winChance } from './predict'

/*
 * The Scoreboard's PotW tab, for the week of the chosen day: the top 20 by the Player of the Day measure added up
 * (Game Score + Elo gained ÷ 6, every game; two games to qualify) beside the card. Before the week settles the card
 * is the frontrunner's; after, it's the week's Player of the Week card, with the pick'em winner(s) who got it.
 * Live: games since the last data update (tonight's, finished or in progress) are scored from the live feed the way the
 * Scoreboard scores them and added to the week's totals, so the table and the frontrunner move as games go.
 */
const addDays = (day, k) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
const r1 = v => Math.round(v * 10) / 10

// The week's running totals with the live games added, best first (two games to qualify)
function liveWeek(d, L) {
  const by = new Map((d.all || []).map(x => [x.n, { ...x, l: x.gp - x.w, pend: 0, live: false }]))
  const games = [...(L?.finals || []).map(g => [g, true]), ...(L?.inprogScored || []).map(g => [g, false])]
  for (const [g, final] of games) {
    for (const p of g.players) {
      if (p.unrated || !(p.mp > 0) || p.gs == null) continue
      const i = g.teams.indexOf(p.t), won = g.pts[i] > g.pts[1 - i]
      let x = by.get(p.n)
      if (!x) {
        const ti = binderTeamInfo(p.t)
        x = { n: p.n, t: p.t, tn: ti.name, tc: ti.color, pos: p.pos, s: d.all?.[0]?.s, gp: 0, w: 0, l: 0, pend: 0, pts: 0, trb: 0, ast: 0, gs: 0, score: 0, e0: p.pre, e1: p.pre }
        by.set(p.n, x)
      }
      x.gp++; x.pts += p.pts || 0; x.trb += p.trb || 0; x.ast += p.ast || 0; x.gs += p.gs
      x.score += p.gs + (p.post - p.pre) / 6; x.e1 = p.post; x.t = p.t
      if (final) { if (won) x.w++; else x.l++ } else { x.pend++; x.live = true }
    }
  }
  return [...by.values()].map(x => ({ ...x, qualified: x.gp >= 2, score: r1(x.score) }))
    .sort((a, b) => b.qualified - a.qualified || b.score - a.score)
}
// A row as the table and the card show it: per-game averages
const line = (x, d) => ({ kind: 'potw', tier: 'potw', week: d.week, end: d.end, s: x.s, n: x.n, t: x.t, tn: x.tn, tc: x.tc, pos: x.pos,
  gp: x.gp, w: x.w, l: x.l, pend: x.pend, live: x.live, qualified: x.qualified, pts: r1(x.pts / x.gp), trb: r1(x.trb / x.gp), ast: r1(x.ast / x.gp),
  gs: r1(x.gs / x.gp), score: x.score, elo: [x.e0, x.e1] })

const f1 = v => (v == null ? '—' : (+v).toFixed(1))
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const short = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const Logo = ({ t }) => <span className={styles.logo}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>

export default function PlayerOfWeek({ day, onSelect, ratings }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    setD(null); setErr(null)
    fetch(`/api/collect?action=potw&day=${day}`, { credentials: 'same-origin' }).then(r => r.json())
      .then(x => { if (!live) return; if (x.error) setErr(x.error); else setD(x) }).catch(() => live && setErr('Couldn’t load the week.'))
    return () => { live = false }
  }, [day])

  // Days in this week after the last data update, through today: from the live feed (polled while games are on)
  const liveDays = useMemo(() => (!d || d.settled || !d.all || !ratings ? [] :
    liveDaysAfter(d.through || addDays(d.week, -1)).filter(x => x >= d.week && x <= d.end)), [d, ratings])
  const feeds = useLiveFeeds(liveDays)
  const L = useMemo(() => {
    if (!liveDays.length || !ratings) return null
    const sy = +d.week.slice(0, 4) - (+d.week.slice(5, 7) < 8 ? 1 : 0)
    return computeLive({ ratings, feeds, days: liveDays, winChance, sy })
  }, [liveDays, feeds, ratings, d])
  const liveRows = useMemo(() => (L && (L.finals.length || L.inprogScored.length) ? liveWeek(d, L) : null), [L, d])

  if (err) return <div className={styles.empty}>{err}</div>
  if (!d) return <div className={styles.empty}>Loading the week…</div>

  const settled = d.settled
  const top = liveRows ? liveRows.slice(0, 20).map(x => line(x, d)) : d.top
  const leader = liveRows ? (liveRows[0]?.qualified ? { ...(d.leader?.n === liveRows[0].n ? d.leader : {}), ...line(liveRows[0], d) } : null) : d.leader
  const live = !!liveRows, going = L?.inprog.length > 0
  const card = settled?.card || leader
  const status = settled ? 'Player of the Week' : going ? 'Frontrunner · live' : d.complete ? 'Final standings · the card goes out once the week settles'
    : live ? `Frontrunner · with ${short(liveDays[liveDays.length - 1])}’s games` : d.through ? `Frontrunner · through ${short(d.through)}` : 'No games yet this week'
  return (
    <div className={styles.wrap}>
      <div className={styles.layout}>
        <section className={styles.tableBox}>
          <header><h3>{settled || d.complete ? 'The week’s top 20' : 'The race so far · top 20'}</h3>
            <span>{going ? <><i className={styles.liveDot} />Live · {L.inprog.length} game{L.inprog.length === 1 ? '' : 's'} in progress</> : live ? `Games through ${short(liveDays[liveDays.length - 1])}, tonight’s from the live feed` : d.through ? `Games through ${short(d.through)}` : ''}
              {!settled && !live && !d.complete && d.through ? ' · updates live as games go' : ''}{L?.fetched && live ? ` · updated ${new Date(L.fetched).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span></header>
          {top.length ? <div className={styles.scroll}><table className={styles.table}>
            <thead><tr><th>#</th><th className={styles.pl}>Player</th><th>GP</th><th>W–L</th><th>PPG</th><th>RPG</th><th>APG</th><th>GmSc</th><th>Elo Δ</th><th className={styles.sc}>Score</th></tr></thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.n} className={`${i === 0 && r.qualified ? styles.lead : ''} ${r.qualified ? '' : styles.out}`} onClick={() => onSelect?.(r.n)}>
                  <td className={styles.rk}>{i + 1}</td>
                  <td className={styles.pl}><span><Logo t={r.t} /><b>{baseName(r.n)}</b><small>{r.live && <><i className={styles.liveDot} />live · </>}{r.t}{r.qualified ? '' : ' · needs a 2nd game'}</small></span></td>
                  <td>{r.gp}</td><td>{r.w}–{r.l ?? r.gp - r.w}</td><td>{f1(r.pts)}</td><td>{f1(r.trb)}</td><td>{f1(r.ast)}</td><td>{f1(r.gs)}</td>
                  <td className={r.elo[1] >= r.elo[0] ? styles.up : styles.down}>{sgn(r.elo[1] - r.elo[0])}</td>
                  <td className={styles.sc}><b>{f1(r.score)}</b></td>
                </tr>
              ))}
            </tbody>
          </table></div> : <p className={styles.note}>No games in the data for this week yet.</p>}
          <p className={styles.note}>Score: each game’s Game Score plus a sixth of the Elo it gained, added up for the week. GmSc is per game.</p>
        </section>

        <aside className={styles.side}>
          <div className={styles.status} data-final={settled ? '' : undefined}>{status}</div>
          {card ? <div className={styles.cardBox}><span className={styles.cardScale}><span className={styles.cardIn}><SpecialFace card={card} label={settled ? undefined : d.complete ? 'FINAL · AWAITING THE WINNER' : 'FRONTRUNNER'} /></span></span></div>
            : <div className={styles.cardEmpty}>No one has two games yet</div>}
          {settled && <div className={styles.box}>
            <h4>Won by</h4>
            {settled.winners.map((w, i) => (
              <div key={w.username} className={styles.raceRow}><b>{w.username}</b><span>{settled.winners.length > 1 ? `copy ${i + 1} of ${settled.winners.length} · ` : ''}{w.score} pts · picks {w.picks[0]}–{w.picks[1]}</span></div>
            ))}
          </div>}
          {!settled && d.race.length > 0 && <div className={styles.box}>
            <h4>Pick’em race <small>No. 1 wins this card</small></h4>
            {d.race.map(r => (
              <div key={r.username} className={styles.raceRow}><b>{r.rank}. {r.username}</b><span>{r.score} pts · picks {r.picks[0]}–{r.picks[1]} · {sgn(r.over)} vs forecast</span></div>
            ))}
          </div>}
          {card && <p className={styles.note}>Week of {weekSpan({ week: d.week, end: d.end })}</p>}
        </aside>
      </div>
    </div>
  )
}
