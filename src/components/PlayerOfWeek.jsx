import { useState, useEffect } from 'react'
import styles from './PlayerOfWeek.module.css'
import { SpecialFace, weekSpan } from './SpecialCards'
import { binderLogo } from './SeasonExplorer'

/*
 * The Scoreboard's PotW tab, for the week of the chosen day: the top 20 by the Player of the Day measure added up
 * (Game Score + Elo gained ÷ 6, every game; two games to qualify) beside the card. Before the week settles the card
 * is the frontrunner's; after, it's the week's Player of the Week card, with the pick'em winner(s) who got it.
 */

const f1 = v => (v == null ? '—' : (+v).toFixed(1))
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const short = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const Logo = ({ t }) => <span className={styles.logo}>{binderLogo(t) ? <img src={binderLogo(t)} alt="" /> : <b>{t}</b>}</span>

export default function PlayerOfWeek({ day, onSelect }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    setD(null); setErr(null)
    fetch(`/api/collect?action=potw&day=${day}`, { credentials: 'same-origin' }).then(r => r.json())
      .then(x => { if (!live) return; if (x.error) setErr(x.error); else setD(x) }).catch(() => live && setErr('Couldn’t load the week.'))
    return () => { live = false }
  }, [day])
  if (err) return <div className={styles.empty}>{err}</div>
  if (!d) return <div className={styles.empty}>Loading the week…</div>

  const settled = d.settled
  const card = settled?.card || d.leader
  const status = settled ? 'Player of the Week' : d.complete ? 'Final standings · the card goes out once the week settles' : d.through ? `Frontrunner · through ${short(d.through)}` : 'No games yet this week'
  return (
    <div className={styles.wrap}>
      <div className={styles.layout}>
        <section className={styles.tableBox}>
          <header><h3>{settled || d.complete ? 'The week’s top 20' : 'The race so far · top 20'}</h3>
            <span>{d.through ? `Games through ${short(d.through)}` : ''}{!d.complete && d.through ? ' · updates with each morning’s data' : ''}</span></header>
          {d.top.length ? <div className={styles.scroll}><table className={styles.table}>
            <thead><tr><th>#</th><th className={styles.pl}>Player</th><th>GP</th><th>W–L</th><th>PPG</th><th>RPG</th><th>APG</th><th>GmSc</th><th>Elo Δ</th><th className={styles.sc}>Score</th></tr></thead>
            <tbody>
              {d.top.map((r, i) => (
                <tr key={r.n} className={`${i === 0 && r.qualified ? styles.lead : ''} ${r.qualified ? '' : styles.out}`} onClick={() => onSelect?.(r.n)}>
                  <td className={styles.rk}>{i + 1}</td>
                  <td className={styles.pl}><span><Logo t={r.t} /><b>{baseName(r.n)}</b><small>{r.t}{r.qualified ? '' : ' · needs a 2nd game'}</small></span></td>
                  <td>{r.gp}</td><td>{r.w}–{r.gp - r.w}</td><td>{f1(r.pts)}</td><td>{f1(r.trb)}</td><td>{f1(r.ast)}</td><td>{f1(r.gs)}</td>
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
