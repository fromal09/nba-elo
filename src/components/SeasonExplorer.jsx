import { useState, useEffect, useMemo, Fragment } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import styles from './SeasonExplorer.module.css'

// ── Reference data ───────────────────────────────────────────────────────────
const TEAMS = {
  ATL: ['Atlanta', 'Hawks', '#C8102E', 'E'], BOS: ['Boston', 'Celtics', '#007A33', 'E'],
  BKN: ['Brooklyn', 'Nets', '#000000', 'E'], CHO: ['Charlotte', 'Hornets', '#00788C', 'E'],
  CHI: ['Chicago', 'Bulls', '#CE1141', 'E'], CLE: ['Cleveland', 'Cavaliers', '#860038', 'E'],
  DAL: ['Dallas', 'Mavericks', '#00538C', 'W'], DEN: ['Denver', 'Nuggets', '#0E2240', 'W'],
  DET: ['Detroit', 'Pistons', '#C8102E', 'E'], GSW: ['Golden State', 'Warriors', '#1D428A', 'W'],
  HOU: ['Houston', 'Rockets', '#CE1141', 'W'], IND: ['Indiana', 'Pacers', '#002D62', 'E'],
  LAC: ['LA', 'Clippers', '#C8102E', 'W'], LAL: ['Los Angeles', 'Lakers', '#552583', 'W'],
  MEM: ['Memphis', 'Grizzlies', '#5D76A9', 'W'], MIA: ['Miami', 'Heat', '#98002E', 'E'],
  MIL: ['Milwaukee', 'Bucks', '#00471B', 'E'], MIN: ['Minnesota', 'Timberwolves', '#0C2340', 'W'],
  NOP: ['New Orleans', 'Pelicans', '#0C2340', 'W'], NYK: ['New York', 'Knicks', '#006BB6', 'E'],
  OKC: ['Oklahoma City', 'Thunder', '#007AC1', 'W'], ORL: ['Orlando', 'Magic', '#0077C0', 'E'],
  PHI: ['Philadelphia', '76ers', '#006BB6', 'E'], PHO: ['Phoenix', 'Suns', '#1D1160', 'W'],
  POR: ['Portland', 'Trail Blazers', '#E03A3E', 'W'], SAC: ['Sacramento', 'Kings', '#5A2D81', 'W'],
  SAS: ['San Antonio', 'Spurs', '#4a4f54', 'W'], TOR: ['Toronto', 'Raptors', '#CE1141', 'E'],
  UTA: ['Utah', 'Jazz', '#002B5C', 'W'], WAS: ['Washington', 'Wizards', '#002B5C', 'E'],
}
const tName = t => TEAMS[t] ? `${TEAMS[t][0]} ${TEAMS[t][1]}` : t
const tShort = t => TEAMS[t]?.[1] || t
const tColor = t => TEAMS[t]?.[2] || '#173657'

const LINE_COLORS = ['#1a5fa8', '#d4960a', '#c0392b', '#1a7a4a', '#7b3fa0', '#e67e22', '#0e8c99', '#b0306a',
  '#5d6d7e', '#8e6b2f', '#2e86de', '#6ab04c', '#8c564b', '#686de0', '#30336b', '#22a6b3']

// ── Helpers ──────────────────────────────────────────────────────────────────
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '')
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s*\(\d{4}\)$/, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const initials = n => n.replace(/\s*\(.*\)$/, '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', opts)
const r0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d)
const shortName = n => { const b = n.replace(/\s*\(.*\)$/, ''); const i = b.indexOf(' '); return i < 0 ? b : `${b[0]}. ${b.slice(i + 1)}` }
const pct = (m, a) => (a ? `${m}-${a}` : '0-0')

// Mirrors build_elo.py: every player duels every other player in the game on Game Score.
const kFactor = n => (n < 20 ? 40 : n < 100 ? 50 : 28)
function duel(a, b, N) {
  const exp = 1 / (1 + 10 ** ((b.pre - a.pre) / 620))
  const act = a.gs > b.gs ? 1 : a.gs === b.gs ? 0.5 : 0
  const mf = Math.max(0.5, Math.min(2, Math.log1p(Math.abs(a.gs - b.gs)) / Math.log1p(20)))
  return { exp, act, delta: (kFactor(a.gp) / Math.sqrt(N)) * mf * (act - exp) }
}

// ── Data loading (module-level caches) ───────────────────────────────────────
const cache = new Map()
const getJSON = url => {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.json() }))
  return cache.get(url)
}
let headshotPromise = null
const getHeadshots = () => {
  if (!headshotPromise) headshotPromise = fetch('/api/headshots').then(r => r.json()).then(d => d.players || {}).catch(() => ({}))
  return headshotPromise
}

function Headshot({ name, shots, color }) {
  const [bad, setBad] = useState(false)
  const src = shots?.[norm(name)]?.headshot
  return (
    <span className={styles.hs} style={{ '--c': color }}>
      {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : <i>{initials(name)}</i>}
    </span>
  )
}

function TeamMark({ t, size = 28 }) {
  return <span className={styles.mark} style={{ background: tColor(t), width: size, height: size, fontSize: size * 0.34 }}>{t}</span>
}

// ═══════════════════════════════════════════════════════════════════════════
export default function SeasonExplorer({ players, onSelectPlayer }) {
  const [index, setIndex] = useState(null)
  const [err, setErr] = useState(null)
  const [season, setSeason] = useState(null)
  const [open, setOpen] = useState(null)
  const [shots, setShots] = useState({})

  useEffect(() => {
    getJSON('/data/explorer/index.json')
      .then(d => { setIndex(d); setSeason(d.seasons[0]?.season) })
      .catch(() => setErr('Season data not found. Run the build pipeline to generate it.'))
    getHeadshots().then(setShots)
  }, [])

  const byName = useMemo(() => {
    const m = {}; players?.forEach(p => { m[p.name] = p }); return m
  }, [players])
  const selectPlayer = n => byName[n] && onSelectPlayer?.(byName[n])

  if (err) return <div className={styles.page}><div className={styles.empty}>{err}</div></div>
  if (!index) return <div className={styles.page}><div className={styles.empty}>Loading season…</div></div>

  const s = index.seasons.find(x => x.season === season) || index.seasons[0]

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <div className={styles.kicker}>Season Explorer</div>
          <h1 className={styles.title}>{s.season} <span>NBA season</span></h1>
          <p className={styles.sub}>
            {s.games.toLocaleString()} games through {fmtDate(s.last, { month: 'long', day: 'numeric', year: 'numeric' })}.
            Pick a team for its schedule, box scores with pre- and post-game Elo, and every player's Elo path.
          </p>
        </div>
        {index.seasons.length > 1 && (
          <div className={styles.seasonPick}>
            {index.seasons.map(x => (
              <button key={x.season} className={x.season === s.season ? styles.on : ''}
                onClick={() => { setSeason(x.season); setOpen(null) }}>{x.season}</button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.confs}>
        {[['E', 'Eastern Conference'], ['W', 'Western Conference']].map(([c, label]) => (
          <Standings key={c} label={label} conf={c} s={s} open={open}
            setOpen={t => setOpen(o => (o === t ? null : t))}
            shots={shots} selectPlayer={selectPlayer} />
        ))}
      </div>
    </div>
  )
}

// ── Standings table with expandable team rows ───────────────────────────────
function Standings({ label, conf, s, open, setOpen, shots, selectPlayer }) {
  const rows = Object.keys(TEAMS).filter(t => TEAMS[t][3] === conf).map(t => {
    const x = s.teams[t] || { w: 0, l: 0, pw: 0, pl: 0, gp: 0, elo: null }
    return { t, ...x, pct: x.w + x.l ? x.w / (x.w + x.l) : 0 }
  }).sort((a, b) => b.pct - a.pct || b.w - a.w || (b.elo || 0) - (a.elo || 0))
  const lead = rows[0]
  const anyPost = rows.some(r => r.pw + r.pl)

  return (
    <section className={styles.conf} style={{ '--cols': `minmax(0, 1fr) 44px 44px 58px 50px ${anyPost ? '74px ' : ''}104px` }}>
      <h2 className={styles.confHead}>{label}</h2>
      <div className={styles.standHead}>
        <span>Team</span><span>W</span><span>L</span><span>Pct</span><span>GB</span>
        {anyPost && <span className={styles.hideSm}>Playoffs</span>}
        <span title="Average Elo of the eight players with the most minutes for this team">Roster Elo</span>
      </div>
      {rows.map((r, i) => {
        const gb = (lead.w - r.w + r.l - lead.l) / 2
        const isOpen = open === r.t
        return (
          <Fragment key={r.t}>
            <button className={`${styles.standRow} ${isOpen ? styles.rowOpen : ''}`} disabled={!r.gp}
              onClick={() => setOpen(r.t)} style={{ '--tc': tColor(r.t) }}>
              <span className={styles.teamCell}>
                <em>{i + 1}</em><TeamMark t={r.t} />
                <b className={styles.full}>{tName(r.t)}</b><b className={styles.abbr}>{tShort(r.t)}</b>
              </span>
              <span>{r.w}</span><span>{r.l}</span>
              <span>{r.w + r.l ? r.pct.toFixed(3).replace(/^0/, '') : '—'}</span>
              <span>{gb ? gb.toFixed(1) : '—'}</span>
              {anyPost && <span className={styles.hideSm}>{r.pw + r.pl ? `${r.pw}-${r.pl}` : '—'}</span>}
              <span className={styles.eloCell}>{r0(r.elo)}<i>{isOpen ? '▴' : '▾'}</i></span>
            </button>
            {isOpen && <TeamPanel team={r.t} season={s.season} shots={shots} selectPlayer={selectPlayer} />}
          </Fragment>
        )
      })}
    </section>
  )
}

// ── Team panel: schedule + Elo progression ──────────────────────────────────
function TeamPanel({ team, season, shots, selectPlayer }) {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('schedule')
  const [box, setBox] = useState(null)

  useEffect(() => {
    setData(null)
    getJSON(`/data/explorer/${season}/${team}.json`).then(setData).catch(() => setData({ games: [] }))
  }, [team, season])

  if (!data) return <div className={styles.panel}><div className={styles.empty}>Loading {tName(team)}…</div></div>

  return (
    <div className={styles.panel} style={{ '--tc': tColor(team) }}>
      <div className={styles.tabs}>
        <button className={tab === 'schedule' ? styles.on : ''} onClick={() => setTab('schedule')}>Schedule & Box Scores</button>
        <button className={tab === 'elo' ? styles.on : ''} onClick={() => setTab('elo')}>Elo Progression</button>
      </div>
      {tab === 'schedule'
        ? <Schedule team={team} games={data.games} onBox={setBox} />
        : <Progression team={team} games={data.games} selectPlayer={selectPlayer} />}
      {box && <BoxScore team={team} game={box} shots={shots} selectPlayer={selectPlayer} onClose={() => setBox(null)} />}
    </div>
  )
}

function teamSummary(g, team) {
  const mine = g.players.filter(p => p.t === team)
  const net = mine.reduce((a, p) => a + p.post - p.pre, 0)
  const star = mine.reduce((b, p) => (!b || p.post - p.pre > b.post - b.pre ? p : b), null)
  return { net, star }
}

function Schedule({ team, games, onBox }) {
  const parts = [['Regular Season', games.filter(g => !g.post)], ['Postseason', games.filter(g => g.post)]]
  return (
    <div className={styles.sched}>
      {parts.map(([label, gs]) => gs.length > 0 && (
        <div key={label}>
          <div className={styles.schedLabel}>{label}</div>
          <div className={styles.tableWrap}>
            <table className={styles.schedTable}>
              <thead><tr>
                <th>Date</th><th>Opponent</th><th>Result</th><th>W-L</th>
                <th>Elo Riser</th><th title="Sum of every player's Elo change for this team">Team ΔElo</th><th></th>
              </tr></thead>
              <tbody>
                {gs.map(g => {
                  const { net, star } = teamSummary(g, team)
                  return (
                    <tr key={g.id} onClick={() => onBox(g)}>
                      <td className={styles.date}>{fmtDate(g.date)}</td>
                      <td><span className={styles.opp}>
                        <i>{g.home === false ? '@' : 'vs'}</i><TeamMark t={g.opp} size={22} />
                        <span className={styles.full}>{tName(g.opp)}</span><span className={styles.abbr}>{g.opp}</span>
                      </span></td>
                      <td><b className={g.res === 'W' ? styles.win : styles.loss}>{g.res}</b> {g.pts}-{g.opp_pts}{g.ot && <small> {g.ot}</small>}</td>
                      <td className={styles.num}>{g.rec}</td>
                      <td>{star && <span className={styles.riser}>{shortName(star.n)} <b>{sgn(star.post - star.pre)}</b></span>}</td>
                      <td className={`${styles.num} ${net >= 0 ? styles.up : styles.down}`}>{sgn(net)}</td>
                      <td><span className={styles.boxBtn}>Box Score</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Box score ────────────────────────────────────────────────────────────────
function BoxScore({ team, game, shots, selectPlayer, onClose }) {
  const [focus, setFocus] = useState(null)
  const P = game.players, N = P.length
  const opp = game.opp
  const home = game.home === false ? opp : team
  const away = home === team ? opp : team
  const pts = { [team]: game.pts, [opp]: game.opp_pts }

  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose()
    addEventListener('keydown', k); document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])

  const story = useMemo(() => {
    const d = p => p.post - p.pre
    const climb = [...P].sort((a, b) => d(b) - d(a))[0]
    const drop = [...P].sort((a, b) => d(a) - d(b))[0]
    let gk = null
    for (const a of P) for (const b of P) {
      // A real upset: both played real minutes and the winner cleared the loser by 5+ Game Score
      if ((a.mp || 0) >= 12 && (b.mp || 0) >= 12 && a.gs - b.gs >= 5 && b.pre - a.pre > (gk ? gk.gap : 0)) gk = { a, b, gap: b.pre - a.pre }
    }
    const edge = {}
    for (const t of [team, opp]) {
      const ps = P.filter(p => p.t === t), m = ps.reduce((s, p) => s + (p.mp || 0), 0)
      edge[t] = m ? ps.reduce((s, p) => s + p.pre * (p.mp || 0), 0) / m : ps.reduce((s, p) => s + p.pre, 0) / ps.length
    }
    return { climb, drop, gk, edge }
  }, [P, team, opp])

  const fav = story.edge[team] >= story.edge[opp] ? team : opp
  const favWon = (fav === team) === (game.res === 'W')
  const winner = game.res === 'W' ? team : opp

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <div className={styles.scoreboard}>
          {[away, home].map((t, i) => (
            <Fragment key={t}>
              {i === 1 && <div className={styles.final}>
                <b>Final{game.ot ? `/${game.ot}` : ''}</b>
                <span>{fmtDate(game.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                {game.post && <span className={styles.postTag}>Postseason</span>}
              </div>}
              <div className={`${styles.sbTeam} ${i ? styles.sbHome : ''} ${t === winner ? styles.sbWin : ''}`}>
                <TeamMark t={t} size={44} />
                <div><div className={styles.sbName}>{tShort(t)}</div><div className={styles.sbElo}>Elo {r0(story.edge[t])}</div></div>
                <div className={styles.sbPts}>{pts[t]}</div>
              </div>
            </Fragment>
          ))}
        </div>

        <div className={styles.cards}>
          <StoryCard tag="Elo Edge" tone={favWon ? 'blue' : 'gold'}>
            <b>{tShort(fav)}</b> brought the higher minutes-weighted Elo ({r0(story.edge[fav])} vs {r0(story.edge[fav === team ? opp : team])})
            {favWon ? ' and won.' : ' and lost. Upset.'}
          </StoryCard>
          <StoryCard tag="Biggest Climb" tone="up">
            <b>{story.climb.n}</b> {r0(story.climb.pre)} → {r0(story.climb.post)} <em className={styles.up}>{sgn(story.climb.post - story.climb.pre)}</em>
          </StoryCard>
          <StoryCard tag="Biggest Drop" tone="down">
            <b>{story.drop.n}</b> {r0(story.drop.pre)} → {r0(story.drop.post)} <em className={styles.down}>{sgn(story.drop.post - story.drop.pre)}</em>
          </StoryCard>
          {story.gk && <StoryCard tag="Giant Killer" tone="gold">
            <b>{story.gk.a.n}</b> ({r0(story.gk.a.pre)}) out-scored <b>{story.gk.b.n}</b> ({r0(story.gk.b.pre)}) on Game Score, {story.gk.a.gs} to {story.gk.b.gs}: a {r0(story.gk.gap)}-point Elo gap.
          </StoryCard>}
        </div>

        {[away, home].map(t => (
          <TeamBox key={t} t={t} rows={P.filter(p => p.t === t)} N={N} shots={shots}
            focus={focus} setFocus={setFocus} selectPlayer={selectPlayer} />
        ))}

        <DuelGrid P={P} focus={focus} setFocus={setFocus} />
      </div>
    </div>
  )
}

function StoryCard({ tag, tone, children }) {
  return <div className={`${styles.card} ${styles['t_' + tone]}`}><div className={styles.cardTag}>{tag}</div><div>{children}</div></div>
}

function TeamBox({ t, rows, N, shots, focus, setFocus, selectPlayer }) {
  const sorted = [...rows].sort((a, b) => (b.st - a.st) || (b.mp || 0) - (a.mp || 0))
  const max = Math.max(8, ...rows.map(p => Math.abs(p.post - p.pre)))
  const tot = k => rows.reduce((s, p) => s + (p[k] || 0), 0)
  const net = rows.reduce((s, p) => s + p.post - p.pre, 0)
  const split = (m, a) => (m == null ? '—' : `${m}-${a}`)

  return (
    <div className={styles.teamBox} style={{ '--tc': tColor(t) }}>
      <div className={styles.teamBoxHead}><TeamMark t={t} size={24} /> {tName(t)}</div>
      <div className={styles.tableWrap}>
        <table className={styles.box}>
          <thead><tr>
            <th className={styles.sticky}>Player</th>
            <th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th>
            <th>FG</th><th>3PT</th><th>FT</th><th>+/-</th>
            <th className={styles.gsH}>GmSc</th>
            <th className={styles.eloH} title={`Head-to-head duels won against the other ${N - 1} players in the game, with the number Elo expected`}>Duels</th>
            <th className={styles.eloH}>Pre</th><th className={styles.eloH}>Post</th>
            <th className={`${styles.eloH} ${styles.swingH}`}>Elo Swing</th>
          </tr></thead>
          <tbody>
            {sorted.map((p, i) => {
              const d = p.post - p.pre
              return (
                <tr key={p.n} className={`${focus === p.n ? styles.focus : ''} ${i > 0 && !p.st && sorted[i - 1].st ? styles.benchStart : ''}`}
                  onMouseEnter={() => setFocus(p.n)} onMouseLeave={() => setFocus(null)}>
                  <td className={styles.sticky}>
                    <span className={styles.pl}>
                      <Headshot name={p.n} shots={shots} color={tColor(t)} />
                      <span><button className={styles.pName} onClick={() => selectPlayer(p.n)}>{shortName(p.n)}</button>
                        <small>{p.pos}{p.st ? '' : ' · Bench'}</small></span>
                    </span>
                  </td>
                  <td>{p.mp ?? '—'}</td><td className={styles.pts}>{p.pts}</td><td>{p.trb}</td><td>{p.ast}</td>
                  <td>{p.stl}</td><td>{p.blk}</td><td>{p.tov}</td>
                  <td>{split(p.fg, p.fga)}</td><td>{split(p.tp, p.tpa)}</td><td>{split(p.ft, p.fta)}</td>
                  <td>{p.pm == null ? '—' : p.pm > 0 ? `+${p.pm}` : p.pm}</td>
                  <td className={styles.gs}>{p.gs.toFixed(1)}</td>
                  <td className={styles.duels} title={`Won ${p.w} of ${N - 1}; Elo expected ${p.xw.toFixed(1)}`}>
                    {Number.isInteger(p.w) ? p.w : p.w.toFixed(1)}<small>/{N - 1}</small>
                    <i className={p.w >= p.xw ? styles.up : styles.down}>{sgn(p.w - p.xw)}</i>
                  </td>
                  <td className={styles.elo}>{r0(p.pre)}</td>
                  <td className={styles.elo}><b>{r0(p.post)}</b></td>
                  <td className={styles.swing}><span className={styles.swingIn}>
                    <span className={styles.bar}>
                      <span className={d >= 0 ? styles.barUp : styles.barDown} style={{ width: `${Math.min(50, (Math.abs(d) / max) * 50)}%` }} />
                    </span>
                    <b className={d >= 0 ? styles.up : styles.down}>{sgn(d)}</b>
                  </span></td>
                </tr>
              )
            })}
            <tr className={styles.totals}>
              <td className={styles.sticky}>Team</td>
              <td></td><td className={styles.pts}>{tot('pts')}</td><td>{tot('trb')}</td><td>{tot('ast')}</td>
              <td>{tot('stl')}</td><td>{tot('blk')}</td><td>{tot('tov')}</td>
              <td>{split(tot('fg'), tot('fga'))}</td><td>{split(tot('tp'), tot('tpa'))}</td><td>{split(tot('ft'), tot('fta'))}</td>
              <td></td><td></td><td></td><td></td><td></td>
              <td className={styles.swing}><b className={net >= 0 ? styles.up : styles.down}>{sgn(net)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// The differentiator: FPR scores a game as a round robin. Every cell is one duel.
function DuelGrid({ P, focus, setFocus }) {
  const [hover, setHover] = useState(null)
  const N = P.length
  const order = useMemo(() => [...P].sort((a, b) => b.gs - a.gs), [P])
  const cells = useMemo(() => order.map(a => order.map(b => (a === b ? null : duel(a, b, N)))), [order, N])
  const max = Math.max(1, ...cells.flat().filter(Boolean).map(c => Math.abs(c.delta)))
  const shade = v => {
    const a = Math.min(1, Math.abs(v) / max) ** 0.6
    return v >= 0 ? `rgba(26,122,74,${0.12 + a * 0.85})` : `rgba(168,50,50,${0.12 + a * 0.85})`
  }
  const h = hover && { a: order[hover[0]], b: order[hover[1]], c: cells[hover[0]][hover[1]] }
  const lab = p => shortName(p.n).replace(/^(.)\. /, '$1.')

  return (
    <div className={styles.duel}>
      <div className={styles.duelHead}>
        <h3>The Duel Grid</h3>
        <p>FPR scores every game as a round robin. Each player faces all {N - 1} others on the floor, from both teams, and wins a duel by posting the higher Game Score. The Elo he gains or loses in each duel depends on how much the rating expected him to win. Upsets pay more. Rows are sorted by Game Score; read across to see one player's {N - 1} results.</p>
      </div>
      <div className={styles.duelReadout}>
        {h ? <>
          <b>{h.a.n}</b> {h.c.act === 1 ? 'beat' : h.c.act === 0 ? 'lost to' : 'tied'} <b>{h.b.n}</b> · GmSc {h.a.gs} vs {h.b.gs} ·
          {' '}win chance {(h.c.exp * 100).toFixed(0)}% · <span className={h.c.delta >= 0 ? styles.up : styles.down}>{sgn(h.c.delta, 2)} Elo</span>
        </> : <span className={styles.duelHint}>Hover a cell to see one duel.</span>}
      </div>
      <div className={styles.tableWrap}>
        <div className={styles.grid} style={{ gridTemplateColumns: `minmax(120px,max-content) repeat(${N}, 18px) 64px` }}
          onMouseLeave={() => { setHover(null); setFocus(null) }}>
          <span />
          {order.map((b, j) => (
            <span key={j} className={`${styles.colLab} ${focus === b.n ? styles.lit : ''}`} style={{ '--tc': tColor(b.t) }}>{lab(b)}</span>
          ))}
          <span className={styles.colLab}>Net</span>
          {order.map((a, i) => (
            <Fragment key={a.n}>
              <span className={`${styles.rowLab} ${focus === a.n ? styles.lit : ''}`} style={{ '--tc': tColor(a.t) }}>
                {shortName(a.n)} <small>{a.gs}</small>
              </span>
              {order.map((b, j) => {
                const c = cells[i][j]
                const lit = hover && (hover[0] === i || hover[1] === j)
                return c
                  ? <span key={j} className={`${styles.cell} ${lit ? styles.cellLit : ''} ${focus === a.n || focus === b.n ? styles.cellFocus : ''}`}
                    style={{ background: shade(c.delta) }}
                    onMouseEnter={() => { setHover([i, j]); setFocus(a.n) }} />
                  : <span key={j} className={styles.diag} />
              })}
              <span className={`${styles.net} ${a.post >= a.pre ? styles.up : styles.down}`}>{sgn(a.post - a.pre)}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Elo progression chart ────────────────────────────────────────────────────
function Progression({ team, games, selectPlayer }) {
  const roster = useMemo(() => {
    const m = {}
    games.forEach((g, gi) => g.players.forEach(p => {
      if (p.t !== team) return
      const r = m[p.n] || (m[p.n] = { n: p.n, gp: 0, min: 0, first: gi, start: p.pre, pts: {}, peak: p.post })
      r.gp++; r.min += p.mp || 0; r.pts[gi] = p.post; r.cur = p.post; r.peak = Math.max(r.peak, p.post)
    }))
    return Object.values(m).sort((a, b) => b.min - a.min).map((r, i) => ({ ...r, color: LINE_COLORS[i % LINE_COLORS.length] }))
  }, [games, team])

  const [shown, setShown] = useState(() => new Set(roster.slice(0, 8).map(r => r.n)))
  const [hl, setHl] = useState(null)
  useEffect(() => { setShown(new Set(roster.slice(0, 8).map(r => r.n))) }, [roster])

  // x = 0 is the season start; x = i + 1 is after the team's i-th game
  const data = useMemo(() => {
    const rows = [{ x: 0, label: 'Start' }, ...games.map((g, i) => ({
      x: i + 1, label: `G${i + 1} ${g.home === false ? '@' : 'vs'} ${g.opp}`, res: `${g.res} ${g.pts}-${g.opp_pts}`, date: g.date,
    }))]
    roster.forEach(r => {
      rows[r.first][r.n] = r.start
      Object.entries(r.pts).forEach(([gi, v]) => { rows[+gi + 1][r.n] = v })
    })
    return rows
  }, [games, roster])

  const vis = roster.filter(r => shown.has(r.n))
  const vals = vis.flatMap(r => [r.start, ...Object.values(r.pts)])
  const lo = vals.length ? Math.floor((Math.min(...vals) - 25) / 50) * 50 : 1400
  const hi = vals.length ? Math.ceil((Math.max(...vals) + 25) / 50) * 50 : 2000
  const toggle = n => setShown(s => { const t = new Set(s); t.has(n) ? t.delete(n) : t.add(n); return t })

  const Tip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const row = data[label]
    const items = payload.filter(p => p.value != null).sort((a, b) => b.value - a.value)
    return (
      <div className={styles.tip}>
        <div className={styles.tipHead}>{row.label}{row.res && <span> · {row.res}</span>}{row.date && <small> {fmtDate(row.date)}</small>}</div>
        {items.map(p => {
          const prev = (() => { for (let x = label - 1; x >= 0; x--) { const v = data[x][p.dataKey]; if (v != null) return v } return null })()
          const played = label > 0 && roster.find(r => r.n === p.dataKey)?.pts[label - 1] != null
          return (
            <div key={p.dataKey} className={styles.tipRow}>
              <i style={{ background: p.stroke }} />{shortName(p.dataKey)}<b>{r0(p.value)}</b>
              {played && prev != null && <em className={p.value >= prev ? styles.up : styles.down}>{sgn(p.value - prev)}</em>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={styles.prog}>
      <div className={styles.chips}>
        {roster.map(r => (
          <button key={r.n} className={shown.has(r.n) ? styles.chipOn : styles.chip} style={{ '--lc': r.color }}
            onClick={() => toggle(r.n)} onMouseEnter={() => shown.has(r.n) && setHl(r.n)} onMouseLeave={() => setHl(null)}>
            <i />{shortName(r.n)}
          </button>
        ))}
        <button className={styles.chipAct} onClick={() => setShown(new Set(roster.map(r => r.n)))}>All</button>
        <button className={styles.chipAct} onClick={() => setShown(new Set())}>None</button>
      </div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="#e8e8e8" vertical={false} />
            <XAxis dataKey="x" type="number" domain={[0, games.length]} allowDecimals={false}
              tickFormatter={x => (x ? `G${x}` : 'Start')} tick={{ fontSize: 11, fill: '#888' }}
              interval="preserveStartEnd" minTickGap={18} />
            <YAxis domain={[lo, hi]} tick={{ fontSize: 11, fill: '#888' }} width={46} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<Tip />} />
            {vis.map(r => (
              <Line key={r.n} dataKey={r.n} stroke={r.color} connectNulls isAnimationActive={false}
                strokeWidth={hl === r.n ? 3.5 : 2} strokeOpacity={hl && hl !== r.n ? 0.15 : 1}
                dot={games.length <= 20 ? { r: 2.5, strokeWidth: 0, fill: r.color } : false} activeDot={{ r: 4 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.movers}>
          <thead><tr><th>Player</th><th>GP</th><th>MIN</th><th>Start</th><th>Now</th><th>Peak</th><th>Season Δ</th></tr></thead>
          <tbody>
            {[...roster].sort((a, b) => (b.cur - b.start) - (a.cur - a.start)).map(r => (
              <tr key={r.n} onMouseEnter={() => shown.has(r.n) && setHl(r.n)} onMouseLeave={() => setHl(null)}>
                <td><span className={styles.dot} style={{ background: r.color }} />
                  <button className={styles.pName} onClick={() => selectPlayer(r.n)}>{r.n}</button></td>
                <td>{r.gp}</td><td>{Math.round(r.min)}</td><td>{r0(r.start)}</td><td><b>{r0(r.cur)}</b></td><td>{r0(r.peak)}</td>
                <td className={r.cur >= r.start ? styles.up : styles.down}><b>{sgn(r.cur - r.start)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
