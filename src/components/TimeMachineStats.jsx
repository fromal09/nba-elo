import { useState, useMemo } from 'react'
import styles from './TimeMachine.module.css'
import * as TM from './timemachine.js'

// Season stats and awards for a simulated Time Machine season. Stats come from every regular-season
// box score; each box borrows real lines from that team-season, scaled to a 110-point pace.

const Year = ({ ts }) => <b className={styles.year} style={{ color: ts.color }}>{TM.yearLabel(ts.s)}</b>
const pct = (m, a) => (a ? (m / a * 100).toFixed(1) : '—')

const COLS = [
  { k: 'gp', l: 'GP', v: x => x.gp, total: true },
  { k: 'st', l: 'GS', v: x => x.st, total: true, title: 'Games started (one of the five who played the most minutes)' },
  { k: 'mp', l: 'MIN', per: true },
  { k: 'pts', l: 'PTS', per: true },
  { k: 'trb', l: 'REB', per: true },
  { k: 'ast', l: 'AST', per: true },
  { k: 'stl', l: 'STL', per: true },
  { k: 'blk', l: 'BLK', per: true },
  { k: 'tov', l: 'TO', per: true },
  { k: 'fgp', l: 'FG%', v: x => (x.has.fga && x.fga ? (x.fgm || 0) / x.fga : null), fmt: (v, x) => (x.has.fga ? pct(x.fgm || 0, x.fga) : '—') },
  { k: 'tpp', l: '3P%', v: x => (x.has.tpa && x.tpa ? x.tp / x.tpa : null), fmt: (v, x) => (x.has.tpa ? pct(x.tp, x.tpa) : '—') },
  { k: 'ftp', l: 'FT%', v: x => (x.has.fta && x.fta ? (x.ftm || 0) / x.fta : null), fmt: (v, x) => (x.has.fta ? pct(x.ftm || 0, x.fta) : '—') },
  { k: 'gs', l: 'GmSc', per: true, bold: true },
  { k: 'duel', l: 'Duel %', v: x => (x.dw + x.dl ? x.dw / (x.dw + x.dl) : null), fmt: v => (v == null ? '—' : (v * 100).toFixed(0)), title: 'Share of Game Score duels won against everyone in the game' },
  { k: 'potg', l: 'PotG', v: x => x.potg, total: true, title: 'Player of the Game awards' },
]

export function StatsTab({ stats, T, games, origin }) {
  const [mode, setMode] = useState('per')
  const [sort, setSort] = useState({ k: 'pts', dir: -1 })
  const [team, setTeam] = useState('all')
  const [minGp, setMinGp] = useState(Math.round(games * 0.25))
  const [q, setQ] = useState('')
  const val = (c, x) => {
    if (c.v) return c.v(x)
    if (!x.has[c.k]) return null
    return mode === 'per' && c.per ? TM.perGame(x, c.k) : x[c.k]
  }
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase()
    const list = stats.filter(x => x.gp >= minGp && (team === 'all' || x.team === +team) && (!qq || x.n.toLowerCase().includes(qq)))
    const c = COLS.find(c => c.k === sort.k) || { v: x => x.n }
    return list.sort((a, b) => {
      if (sort.k === 'n') return sort.dir * a.n.localeCompare(b.n)
      const va = val(c, a), vb = val(c, b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return sort.dir * (va - vb)
    })
  }, [stats, sort, team, minGp, q, mode])
  const head = (k, l, title) => (
    <th key={k} title={title} className={`${styles.sortable} ${sort.k === k ? styles.sorted : ''} ${k === 'n' ? styles.left : ''}`}
      onClick={() => setSort(s => ({ k, dir: s.k === k ? -s.dir : k === 'n' ? 1 : -1 }))}>
      {l}{sort.k === k ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}
    </th>
  )
  const show = (c, x) => {
    const v = val(c, x)
    if (c.fmt) return c.fmt(v, x)
    if (v == null) return '—'
    return mode === 'per' && c.per ? v.toFixed(1) : Math.round(v).toLocaleString()
  }
  return (
    <div className={styles.card}>
      <div className={styles.hd}><h3>Player stats</h3><span>{rows.length} players · regular season</span></div>
      <div className={styles.statBar}>
        <div className={styles.seg}>
          <button type="button" className={mode === 'per' ? styles.segOn : ''} onClick={() => setMode('per')}>Per game</button>
          <button type="button" className={mode === 'tot' ? styles.segOn : ''} onClick={() => setMode('tot')}>Totals</button>
        </div>
        <select value={team} onChange={e => setTeam(e.target.value)} className={styles.teamSel}>
          <option value="all">All teams</option>
          {T.map((r, i) => <option key={i} value={i}>{r.s} {r.name}</option>)}
        </select>
        <label className={styles.minGp}>Min GP <input type="number" min={0} max={games} value={minGp} onChange={e => setMinGp(Math.max(0, +e.target.value || 0))} /></label>
        <input className={styles.statSearch} value={q} onChange={e => setQ(e.target.value)} placeholder="Find a player" />
      </div>
      <div className={styles.tblWrap}>
        <table className={`${styles.tbl} ${styles.statTbl}`}>
          <thead><tr><th>#</th>{head('n', 'Player')}<th className={styles.left}>Team</th>{COLS.map(c => head(c.k, c.l, c.title))}</tr></thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={x.id}>
                <td className={styles.muted}>{i + 1}</td>
                <td className={styles.left}><b>{x.n}</b>{x.rookie && <span className={styles.rkTag} title="Rookie season">R</span>}{origin && <small className={styles.origin}>{origin(x)}</small>}</td>
                <td className={styles.left}><span className={styles.teamCell}><Year ts={T[x.team]} />{TM.nickname(T[x.team].name)}</span></td>
                {COLS.map(c => <td key={c.k} className={sort.k === c.k ? styles.sortedCell : ''}>{c.bold ? <b>{show(c, x)}</b> : show(c, x)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.statNote}>Each simulated game borrows every player's line from one of his team's real games that season, scaled to a {TM.PACE}-point pace. Steals, blocks and turnovers weren't recorded before 1973-74, and threes before 1979-80; those show as —.</p>
    </div>
  )
}

function Line({ x, games }) {
  const g = x.gp, pg = k => TM.perGame(x, k).toFixed(1)
  const bits = [`${pg('pts')} pts`]
  if (x.has.trb) bits.push(`${pg('trb')} reb`)
  if (x.has.ast) bits.push(`${pg('ast')} ast`)
  bits.push(`${pg('gs')} GmSc`)
  return <small>{bits.join(' · ')} · {g}/{games} games</small>
}
function Entry({ r, T, games, rank, share, extra, origin }) {
  const ts = T[r.x.team]
  return (
    <div className={`${styles.award} ${rank === 0 ? styles.awardTop : ''}`}>
      <span className={styles.awardRank}>{rank + 1}</span>
      <div className={styles.awardMain}>
        <b>{r.x.n}{origin && <small className={styles.origin}>{origin(r.x)}</small>}</b>
        <span className={styles.teamCell}><Year ts={ts} />{TM.nickname(ts.name)}</span>
        {extra || <Line x={r.x} games={games} />}
      </div>
      {share != null && <span className={styles.awardShare}><i style={{ width: `${Math.max(4, share * 250)}%` }} /><em>{Math.round(share * 100)}%</em></span>}
    </div>
  )
}

export function AwardsTab({ A, T, games, origin }) {
  const card = (title, list, opts = {}) => (
    <section className={`${styles.card} ${styles.awardCard}`} key={title}>
      <div className={styles.hd}><h3>{title}</h3>{opts.sub && <span>{opts.sub}</span>}</div>
      {list.length ? list.map((r, i) => <Entry key={r.x.id} r={r} T={T} games={games} rank={i} share={opts.share ? r.share : null} extra={opts.extra?.(r)} origin={origin} />)
        : <p className={styles.none}>No one qualifies.</p>}
    </section>
  )
  const lead = (k, l) => A.leaders[k].length ? (
    <div className={styles.leadCol} key={k}>
      <div className={styles.rl}>{l}</div>
      {A.leaders[k].map((r, i) => (
        <div key={r.x.id} className={styles.leadRow}><span>{i + 1}</span><b>{r.x.n}</b><Year ts={T[r.x.team]} /><em>{r.v.toFixed(1)}</em></div>
      ))}
    </div>
  ) : null
  const fx = r => <small>{(r.x.post.pts / r.x.post.gp).toFixed(1)} pts · {(r.x.post.trb / r.x.post.gp).toFixed(1)} reb · {(r.x.post.ast / r.x.post.gp).toFixed(1)} ast · {(r.x.post.gs / r.x.post.gp).toFixed(1)} GmSc in the Finals</small>
  return (
    <div className={styles.awards}>
      {card('Most Valuable Player', A.mvp.slice(0, 5), { share: true, sub: 'Vote share' })}
      <div className={styles.awardGrid}>
        {card('Defensive Player of the Year', A.dpoy.slice(0, 3), { sub: 'Steals, blocks, defensive boards' })}
        {card('Rookie of the Year', A.roy.slice(0, 3), { sub: 'First season in the league' })}
        {card('Sixth Man of the Year', A.sixth.slice(0, 3), { sub: 'Started under 40% of games' })}
        {card('Finals MVP', A.fmvp.slice(0, 1), { sub: 'Champion’s best Finals', extra: fx })}
      </div>
      <section className={styles.card}>
        <div className={styles.hd}><h3>All-League teams</h3><span>Top 15 by the MVP formula · no positions in the data</span></div>
        <div className={styles.allTeams}>
          {A.teams.map((tm, k) => (
            <div key={k}>
              <div className={styles.rl}>{['First team', 'Second team', 'Third team'][k]}</div>
              {tm.map(r => <div key={r.x.id} className={styles.leadRow}><b>{r.x.n}</b><Year ts={T[r.x.team]} /><em>{(r.x.gs / r.x.gp).toFixed(1)}</em></div>)}
            </div>
          ))}
        </div>
      </section>
      <section className={styles.card}>
        <div className={styles.hd}><h3>Stat leaders</h3><span>Per game · {Math.round(games * 0.65)}+ games</span></div>
        <div className={styles.leaders}>
          {lead('pts', 'Points')}{lead('trb', 'Rebounds')}{lead('ast', 'Assists')}{lead('stl', 'Steals')}{lead('blk', 'Blocks')}{lead('gs', 'Game Score')}
        </div>
      </section>
      <p className={styles.statNote}>MVP: Game Score per game × availability × team winning percentage, with vote shares from the top 10. DPOY: steals, blocks and defensive rebounds per game (rebounds before 1973-74), weighted by winning. Rookies are players in their first season in the data. A player on two team-seasons in one league can win once, for his better season.</p>
    </div>
  )
}
