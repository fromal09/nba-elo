import { useState, useEffect, useMemo, Fragment } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import styles from './SeasonExplorer.module.css'
import PlayerCard, { tierFor } from './PlayerCard'
import { buildForecaster, blendWeight } from './predict'

// ── Team info ────────────────────────────────────────────────────────────────
// Names, colors and groups come from each season file (historical names). This
// list only fills in current teams that haven't played yet in the newest season.
const CURRENT = {
  ATL: ['Atlanta Hawks', '#C8102E', 'E'], BOS: ['Boston Celtics', '#007A33', 'E'], BKN: ['Brooklyn Nets', '#000000', 'E'],
  CHO: ['Charlotte Hornets', '#00788C', 'E'], CHI: ['Chicago Bulls', '#CE1141', 'E'], CLE: ['Cleveland Cavaliers', '#860038', 'E'],
  DAL: ['Dallas Mavericks', '#00538C', 'W'], DEN: ['Denver Nuggets', '#0E2240', 'W'], DET: ['Detroit Pistons', '#C8102E', 'E'],
  GSW: ['Golden State Warriors', '#1D428A', 'W'], HOU: ['Houston Rockets', '#CE1141', 'W'], IND: ['Indiana Pacers', '#002D62', 'E'],
  LAC: ['LA Clippers', '#C8102E', 'W'], LAL: ['Los Angeles Lakers', '#552583', 'W'], MEM: ['Memphis Grizzlies', '#5D76A9', 'W'],
  MIA: ['Miami Heat', '#98002E', 'E'], MIL: ['Milwaukee Bucks', '#00471B', 'E'], MIN: ['Minnesota Timberwolves', '#0C2340', 'W'],
  NOP: ['New Orleans Pelicans', '#0C2340', 'W'], NYK: ['New York Knicks', '#006BB6', 'E'], OKC: ['Oklahoma City Thunder', '#007AC1', 'W'],
  ORL: ['Orlando Magic', '#0077C0', 'E'], PHI: ['Philadelphia 76ers', '#006BB6', 'E'], PHO: ['Phoenix Suns', '#1D1160', 'W'],
  POR: ['Portland Trail Blazers', '#E03A3E', 'W'], SAC: ['Sacramento Kings', '#5A2D81', 'W'], SAS: ['San Antonio Spurs', '#4a4f54', 'W'],
  TOR: ['Toronto Raptors', '#CE1141', 'E'], UTA: ['Utah Jazz', '#002B5C', 'W'], WAS: ['Washington Wizards', '#002B5C', 'E'],
}
const GROUP_ORDER = ['Eastern Conference', 'Western Conference', 'BAA', 'NBA', 'ABA']
const GROUP_LABEL = { BAA: 'BAA Standings', NBA: 'NBA Standings', ABA: 'ABA Standings' }
const TWO_WORD = ['Trail Blazers', 'Red Skins']

// Set from the loaded season before children render (one season is on screen at a time)
let TEAMINFO = {}
let CAREER = { byName: {}, rank: {}, best: {} } // elo.json players, all-time peak Elo rank, best active rank
const tName = t => TEAMINFO[t]?.name || t
const tShort = t => {
  const n = tName(t)
  return TWO_WORD.find(w => n.endsWith(w)) || n.replace(/^The /, '').split(' ').slice(-1)[0]
}
const tColor = t => TEAMINFO[t]?.color || '#173657'
// Period-correct abbreviations (Basketball-Reference style) for renamed and relocated teams
const HIST_ABBR = {
  'Seattle SuperSonics': 'SEA', 'Baltimore Bullets': 'BAL', 'Capital Bullets': 'CAP', 'Washington Bullets': 'WSB',
  'New Jersey Nets': 'NJN', 'New York Nets': 'NYN', 'Philadelphia Warriors': 'PHW', 'San Francisco Warriors': 'SFW',
  'San Diego Rockets': 'SDR', 'Buffalo Braves': 'BUF', 'San Diego Clippers': 'SDC', 'Minneapolis Lakers': 'MNL',
  'Vancouver Grizzlies': 'VAN', 'Charlotte Bobcats': 'CHA', 'New Orleans Hornets': 'NOH', 'New Orleans/Oklahoma City Hornets': 'NOK',
  'Syracuse Nationals': 'SYR', 'Rochester Royals': 'ROC', 'Cincinnati Royals': 'CIN', 'Kansas City-Omaha Kings': 'KCO',
  'Kansas City Kings': 'KCK', 'New Orleans Jazz': 'NOJ', 'Toronto Huskies': 'TRH', 'Tri-Cities Blackhawks': 'TRI',
  'Milwaukee Hawks': 'MLH', 'St. Louis Hawks': 'STL', 'Chicago Stags': 'CHS', 'Cleveland Rebels': 'CLR',
  'Detroit Falcons': 'DTF', 'Fort Wayne Pistons': 'FTW', 'Oakland Oaks': 'OAK', 'Utah Stars': 'UTS',
  'New Jersey Americans': 'NJA', 'Denver Rockets': 'DNR', 'San Diego Conquistadors': 'SDA', 'Miami Floridians': 'MMF',
  'New Orleans Buccaneers': 'NOB', 'Washington Capitols': 'WSC',
}
const tCode = t => {
  const n = TEAMINFO[t]?.name, c = TEAMINFO[t]?.code || t.split('@')[0]
  if (n === 'Charlotte Hornets' && c === 'NOH') return 'CHH'
  return HIST_ABBR[n] || c
}

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

// Official logos (ESPN CDN) for teams that still carry their current identity;
// relocated or renamed teams keep the abbreviation mark.
const ESPN_LOGO = {
  ATL: 'atl', BOS: 'bos', BKN: 'bkn', CHO: 'cha', CHI: 'chi', CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det', GSW: 'gs',
  HOU: 'hou', IND: 'ind', LAC: 'lac', LAL: 'lal', MEM: 'mem', MIA: 'mia', MIL: 'mil', MIN: 'min', NOP: 'no', NYK: 'ny',
  OKC: 'okc', ORL: 'orl', PHI: 'phi', PHO: 'phx', POR: 'por', SAC: 'sac', SAS: 'sa', TOR: 'tor', UTA: 'utah', WAS: 'wsh',
}
const logoUrl = t => {
  const info = TEAMINFO[t], code = info?.code || t
  if (t.includes('@') || !ESPN_LOGO[code] || !info || HIST_ABBR[info.name]) return null
  const cur = CURRENT[code]?.[0]
  if (!cur || tShort(t) !== (TWO_WORD.find(w => cur.endsWith(w)) || cur.split(' ').slice(-1)[0])) return null
  return `https://a.espncdn.com/i/teamlogos/nba/500/${ESPN_LOGO[code]}.png`
}

function TeamMark({ t, size = 28 }) {
  const [bad, setBad] = useState(false)
  const src = logoUrl(t)
  if (src && !bad) return <img className={styles.logo} src={src} alt={tName(t)} width={size} height={size} loading="lazy" onError={() => setBad(true)} />
  return <span className={styles.mark} style={{ background: tColor(t), width: size, height: size, fontSize: size * 0.34 }}>{tCode(t)}</span>
}

// ── Team-level Elo ───────────────────────────────────────────────────────────
// Lineup Elo: minutes-weighted average of the players who played.
// Win chance: the duel formula refit on 53,674 games with team ratings and home court.
// Pre-1970 ratings separate teams less, so that era gets its own fit.
const WP = sy => (sy < 1970 ? { scale: 1540, home: 420 } : { scale: 410, home: 75 })
function lineupElo(ps, key) {
  const m = ps.reduce((s, p) => s + (p.mp || 0), 0)
  return m ? ps.reduce((s, p) => s + p[key] * (p.mp || 0), 0) / m : ps.reduce((s, p) => s + p[key], 0) / ps.length
}
function winChance(sy, eloA, eloB, homeA) {
  const { scale, home } = WP(sy)
  return 1 / (1 + 10 ** (-(eloA - eloB + (homeA == null ? 0 : homeA ? home : -home)) / scale))
}
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th')

// ── Season loading ───────────────────────────────────────────────────────────
function loadSeason(label, newest) {
  return getJSON(`/data/explorer/${label}.json`).then(d => {
    if (d._ready) return d
    const C = d.cols, sy = +d.season.slice(0, 4)
    // team -> lineup Elo after its most recent game. Teams start from last season's final
    // lineup Elo, so ranks cover the whole league from opening night.
    const inSeason = new Set(Object.keys(d.teams))
    if (newest && Object.values(d.teams).some(t => t.group.endsWith('Conference'))) Object.keys(CURRENT).forEach(c => inSeason.add(c))
    const latest = Object.fromEntries(Object.entries(d.seed || {}).filter(([t]) => inSeason.has(t)))
    const rankOf = (t, v) => {
      const others = Object.entries(latest).filter(([k]) => k !== t && !k.includes('@') === !t.includes('@'))
      return { rank: 1 + others.filter(([, x]) => x > v).length, of: others.length + 1 }
    }
    d.games.forEach(g => {
      g.players = g.rows.map(r => { const o = {}; C.forEach((k, i) => { o[k] = r[i] }); return o })
      delete g.rows
      const [a, b] = g.teams
      g.elo = {}
      for (const t of g.teams) {
        const ps = g.players.filter(p => p.t === t)
        g.elo[t] = { pre: lineupElo(ps, 'pre'), post: lineupElo(ps, 'post') }
        Object.assign(g.elo[t], { preRank: rankOf(t, g.elo[t].pre) })
      }
      g.wp = {}
      g.wp[a] = winChance(sy, g.elo[a].pre, g.elo[b].pre, g.home == null ? null : g.home === a)
      g.wp[b] = 1 - g.wp[a]
      for (const t of g.teams) latest[t] = g.elo[t].post
      for (const t of g.teams) g.elo[t].postRank = rankOf(t, g.elo[t].post)
    })
    d.has = new Set(d.stats || [])
    d.sy = sy
    d._ready = true
    return d
  })
}

// Schedule rows from one team's point of view, with running records
function teamGames(sd, team) {
  const rec = { false: [0, 0], true: [0, 0] }
  return sd.games.filter(g => g.teams.includes(team)).map(g => {
    const i = g.teams.indexOf(team), o = g.teams[1 - i]
    const won = g.pts[i] > g.pts[1 - i], r = rec[g.post]
    r[won ? 0 : 1]++
    return {
      id: g.id, date: g.date, opp: o, home: g.home == null ? null : g.home === team,
      pts: g.pts[i], opp_pts: g.pts[1 - i], ot: g.ot, res: won ? 'W' : 'L', post: g.post,
      rec: `${r[0]}-${r[1]}`, players: g.players, elo: g.elo, wp: g.wp, sy: sd.sy,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
export default function SeasonExplorer({ players, onSelectPlayer }) {
  const [index, setIndex] = useState(null)
  const [err, setErr] = useState(null)
  const [season, setSeason] = useState(null)
  const [sd, setSd] = useState(null)
  const [open, setOpen] = useState(null)
  const [shots, setShots] = useState({})
  const [sched, setSched] = useState(null)       // ESPN schedule + injuries (current season only)
  const [rotation, setRotation] = useState(null) // recent minutes per player
  const [best, setBest] = useState({})           // best rank among active players, per player

  useEffect(() => {
    getJSON('/data/explorer/index.json')
      .then(d => { setIndex(d); setSeason(d.seasons[0]?.season) })
      .catch(() => setErr('Season data not found. Run the build pipeline to generate it.'))
    getHeadshots().then(setShots)
    getJSON('/data/explorer/ranks.json').then(setBest).catch(() => {})
  }, [])

  const newest = !!index && season === index.seasons[0]?.season
  useEffect(() => {
    if (!newest || sched) return
    getJSON('/api/schedule').then(d => d.games && setSched(d)).catch(() => {})
    getJSON('/data/explorer/rotation.json').then(setRotation).catch(() => setRotation({ players: {} }))
  }, [newest, sched])

  useEffect(() => {
    if (!season) return
    setSd(null); setOpen(null)
    loadSeason(season, season === index?.seasons[0]?.season).then(setSd).catch(() => setErr(`Couldn't load ${season}.`))
  }, [season])

  const byName = useMemo(() => {
    const m = {}; players?.forEach(p => { m[p.name] = p }); return m
  }, [players])
  const selectPlayer = n => byName[n] && onSelectPlayer?.(byName[n])
  const peakRank = useMemo(() => {
    const m = {}; [...(players || [])].sort((a, b) => b.peak_elo - a.peak_elo).forEach((p, i) => { m[p.name] = i + 1 }); return m
  }, [players])
  CAREER = { byName, rank: peakRank, best }

  const teams = useMemo(() => {
    if (!sd) return {}
    const t = { ...sd.teams }
    // Newest season: list every current team, even before its first game
    if (index && sd.season === index.seasons[0].season && Object.values(t).some(x => x.group.endsWith('Conference'))) {
      Object.entries(CURRENT).forEach(([c, [name, color, conf]]) => {
        if (!t[c]) t[c] = { code: c, name, color, group: conf === 'E' ? 'Eastern Conference' : 'Western Conference', w: 0, l: 0, pw: 0, pl: 0, gp: 0, elo: null }
      })
    }
    return t
  }, [sd, index])
  TEAMINFO = teams

  // Forecasts for the newest season: remaining games per team and projected records
  const fc = useMemo(() => {
    if (!newest || !sd || !sched || !rotation || !players) return null
    const roster = Object.fromEntries(Object.entries(shots || {}).filter(([, v]) => v.team))
    const gamesPlayed = Object.fromEntries(Object.entries(teams).map(([t, x]) => [t, x.gp]))
    const f = buildForecaster({ players, roster, rotation, injuries: sched.injuries, fetched: sched.fetched, gamesPlayed, winChance, sy: sd.sy })
    const through = sd.games.length ? sd.games[sd.games.length - 1].date : '0000-00-00'
    const upcoming = {}, proj = {}
    Object.keys(teams).forEach(t => { upcoming[t] = []; proj[t] = [teams[t].w, teams[t].l] })
    for (const g of sched.games) {
      if (g.day <= through || !teams[g.home] || !teams[g.away]) continue
      const fg = g.done ? null : f.game(g.home, g.away, g.day)
      for (const t of [g.home, g.away]) {
        const home = t === g.home, p = fg ? (home ? fg.pHome : fg.pAway) : null
        const won = g.done ? (home ? g.hs > g.as : g.as > g.hs) : null
        upcoming[t].push({ ...g, opp: home ? g.away : g.home, isHome: home, p, won, fg })
        proj[t][0] += g.done ? +won : p
        proj[t][1] += g.done ? +!won : 1 - p
      }
    }
    return { f, upcoming, proj, through, fetched: sched.fetched }
  }, [newest, sd, sched, rotation, players, shots, teams])

  if (err) return <div className={styles.page}><div className={styles.empty}>{err}</div></div>
  if (!index) return <div className={styles.page}><div className={styles.empty}>Loading seasons…</div></div>

  const s = index.seasons.find(x => x.season === season) || index.seasons[0]
  const groups = GROUP_ORDER.filter(g => Object.values(teams).some(t => t.group === g))
  const league = s.leagues?.length ? ['BAA', 'NBA', 'ABA'].filter(l => s.leagues.includes(l)).join(' & ') : 'NBA'

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <div className={styles.kicker}>Season Explorer</div>
          <h1 className={styles.title}>{s.season} <span>{league} season</span></h1>
          <p className={styles.sub}>
            {s.games.toLocaleString()} games, {fmtDate(s.first, { month: 'short', day: 'numeric', year: 'numeric' })} to {fmtDate(s.last, { month: 'short', day: 'numeric', year: 'numeric' })}.
            Pick a team for its schedule, box scores with pre- and post-game Elo, and every player's Elo path.
          </p>
        </div>
        <label className={styles.seasonPick}>
          <span>Season</span>
          <select value={s.season} onChange={e => setSeason(e.target.value)}>
            {index.seasons.map(x => <option key={x.season} value={x.season}>{x.season}{x.leagues?.includes('ABA') ? ' · NBA & ABA' : x.leagues?.includes('BAA') ? ' · BAA' : ''}</option>)}
          </select>
        </label>
      </div>

      {!sd ? <div className={styles.empty}>Loading {s.season}…</div> : (
        <div className={styles.confs}>
          {groups.map(g => (
            <Standings key={g} label={GROUP_LABEL[g] || g} group={g} sd={sd} teams={teams} open={open} fc={fc}
              setOpen={t => setOpen(o => (o === t ? null : t))}
              shots={shots} selectPlayer={selectPlayer} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Standings table with expandable team rows ───────────────────────────────
function Standings({ label, group, sd, teams, open, setOpen, shots, selectPlayer, fc }) {
  const rows = Object.entries(teams).filter(([, x]) => x.group === group).map(([t, x]) =>
    ({ t, ...x, pct: x.w + x.l ? x.w / (x.w + x.l) : 0 })
  ).sort((a, b) => b.pct - a.pct || b.w - a.w || (b.elo || 0) - (a.elo || 0))
  const lead = rows[0]
  const anyPost = rows.some(r => r.pw + r.pl)

  return (
    <section className={styles.conf} style={{ '--cols': `minmax(0, 1fr) 44px 44px 58px 50px ${anyPost ? '74px ' : ''}${fc ? '84px ' : ''}104px` }}>
      <h2 className={styles.confHead}>{label}</h2>
      <div className={styles.standHead}>
        <span>Team</span><span>W</span><span>L</span><span>Pct</span><span>GB</span>
        {anyPost && <span className={styles.hideSm}>Playoffs</span>}
        {fc && <span className={styles.hideSm} title="Current record plus the Elo win chance of every remaining game">Proj W-L</span>}
        <span title="Average Elo of the eight players with the most minutes for this team">Roster Elo</span>
      </div>
      {rows.map((r, i) => {
        const gb = (lead.w - r.w + r.l - lead.l) / 2
        const isOpen = open === r.t
        return (
          <Fragment key={r.t}>
            <button className={`${styles.standRow} ${isOpen ? styles.rowOpen : ''}`} disabled={!r.gp && !fc?.upcoming[r.t]?.length}
              onClick={() => setOpen(r.t)} style={{ '--tc': tColor(r.t) }}>
              <span className={styles.teamCell}>
                <em>{i + 1}</em><TeamMark t={r.t} />
                <b className={styles.full}>{tName(r.t)}</b><b className={styles.abbr}>{tShort(r.t)}</b>
              </span>
              <span>{r.w}</span><span>{r.l}</span>
              <span>{r.w + r.l ? r.pct.toFixed(3).replace(/^0/, '') : '—'}</span>
              <span>{r.gp && gb ? gb.toFixed(1) : '—'}</span>
              {anyPost && <span className={styles.hideSm}>{r.pw + r.pl ? `${r.pw}-${r.pl}` : '—'}</span>}
              {fc && <span className={`${styles.hideSm} ${styles.projCell}`}>{fc.proj[r.t] ? `${Math.round(fc.proj[r.t][0])}-${Math.round(fc.proj[r.t][1])}` : '—'}</span>}
              <span className={styles.eloCell}>{r0(r.elo)}<i>{r.gp || fc?.upcoming[r.t]?.length ? (isOpen ? '▴' : '▾') : ''}</i></span>
            </button>
            {isOpen && <TeamPanel team={r.t} sd={sd} shots={shots} selectPlayer={selectPlayer} fc={fc} />}
          </Fragment>
        )
      })}
    </section>
  )
}

// ── Team panel: schedule + Elo progression ──────────────────────────────────
function TeamPanel({ team, sd, shots, selectPlayer, fc }) {
  const [tab, setTab] = useState('schedule')
  const [box, setBox] = useState(null)
  const [preview, setPreview] = useState(null)
  const [card, setCard] = useState(null) // player name, from a box-score click
  const games = useMemo(() => teamGames(sd, team), [sd, team])
  const cardRow = card && box?.players.find(p => p.n === card)

  return (
    <div className={styles.panel} style={{ '--tc': tColor(team) }}>
      <div className={styles.tabs}>
        <button className={tab === 'schedule' ? styles.on : ''} onClick={() => setTab('schedule')}>Schedule & Box Scores</button>
        <button className={tab === 'elo' ? styles.on : ''} onClick={() => setTab('elo')}>Elo Progression</button>
      </div>
      {tab === 'schedule'
        ? <Schedule team={team} games={games} onBox={setBox} upcoming={fc?.upcoming[team] || []} onPreview={setPreview} fetched={fc?.fetched} />
        : <Progression team={team} games={games} selectPlayer={selectPlayer} />}
      {preview && <Preview g={preview} shots={shots} fetched={fc?.fetched} onClose={() => setPreview(null)} />}
      {box && <BoxScore team={team} game={box} has={sd.has} shots={shots} onCard={setCard} onClose={() => setBox(null)} />}
      {cardRow && (
        <PlayerCard name={card} row={cardRow} sd={sd}
          game={{ id: box.id, date: box.date, home: cardRow.t === team ? box.home : box.home == null ? null : !box.home, oppAbbr: tCode(cardRow.t === team ? box.opp : team), players: box.players }}
          team={{ name: tName(cardRow.t), color: tColor(cardRow.t), abbr: tCode(cardRow.t) }}
          logo={logoUrl(cardRow.t)} headshot={shots?.[norm(card)]?.headshot}
          career={CAREER.byName[card] || null} peakRank={CAREER.rank[card]} bestRank={CAREER.best[card]}
          onProfile={n => { setCard(null); setBox(null); selectPlayer(n) }}
          onClose={() => setCard(null)} />
      )}
    </div>
  )
}

function teamSummary(g, team) {
  const mine = g.players.filter(p => p.t === team)
  const net = mine.reduce((a, p) => a + p.post - p.pre, 0)
  const star = mine.reduce((b, p) => (!b || p.post - p.pre > b.post - b.pre ? p : b), null)
  return { net, star }
}

function Schedule({ team, games, onBox, upcoming = [], onPreview, fetched }) {
  const parts = [['Regular Season', games.filter(g => !g.post)], ['Postseason', games.filter(g => g.post)]]
  return (
    <div className={styles.sched}>
      {games.length === 0 && upcoming.length === 0 && <div className={styles.empty}>No games yet.</div>}
      {parts.map(([label, gs]) => gs.length > 0 && (
        <div key={label}>
          <div className={styles.schedLabel}>{label}</div>
          <div className={styles.tableWrap}>
            <table className={styles.schedTable}>
              <thead><tr>
                <th>Date</th><th>Opponent</th>
                <th title="Pre-game win chance from the two lineups' Elo and home court">Elo Win %</th>
                <th>Result</th><th>W-L</th>
                <th>Elo Riser</th><th title="Sum of every player's Elo change for this team">Team ΔElo</th><th></th>
              </tr></thead>
              <tbody>
                {gs.map(g => {
                  const { net, star } = teamSummary(g, team)
                  const wp = g.wp[team], upset = (wp < 0.5) === (g.res === 'W')
                  return (
                    <tr key={g.id} onClick={() => onBox(g)}
                      className={upset ? (g.res === 'W' ? styles.rowUpsetW : styles.rowUpsetL) : (g.res === 'W' ? styles.rowW : styles.rowL)}>
                      <td className={styles.date}>{fmtDate(g.date)}</td>
                      <td><span className={styles.opp}>
                        <i>{g.home === false ? '@' : 'vs'}</i><TeamMark t={g.opp} size={22} />
                        <span className={styles.full}>{tName(g.opp)}</span><span className={styles.abbr}>{tCode(g.opp)}</span>
                      </span></td>
                      <td className={styles.num}><span className={styles.wpCell}>
                        <span className={styles.wpBar}><span style={{ width: `${wp * 100}%` }} /></span>
                        {Math.round(wp * 100)}%
                      </span></td>
                      <td><b className={g.res === 'W' ? styles.win : styles.loss}>{g.res}</b> {g.pts}-{g.opp_pts}{g.ot && <small> {g.ot}</small>}
                        {upset && <span className={styles.upsetTag}>{g.res === 'W' ? 'Upset' : 'Upset loss'}</span>}</td>
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
      {upcoming.length > 0 && (
        <div>
          <div className={styles.schedLabel}>Upcoming · Elo forecast
            <small>Current Elo, recent minutes, injury report{fetched ? ` as of ${fmtDate(fetched.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}</small></div>
          <div className={styles.tableWrap}>
            <table className={`${styles.schedTable} ${styles.upTable}`}>
              <thead><tr><th>Date</th><th>Opponent</th><th>Elo Win %</th><th>Projected</th><th>Out</th><th></th></tr></thead>
              <tbody>
                {upcoming.map(g => {
                  const mine = g.fg && (g.isHome ? g.fg.home : g.fg.away)
                  const outs = mine ? mine.rows.filter(r => r.out) : []
                  return (
                    <tr key={g.id} onClick={() => g.fg && onPreview(g)} className={g.done ? `${styles.pending} ${g.won ? styles.rowW : styles.rowL}` : ''}>
                      <td className={styles.date}>{fmtDate(g.day)}</td>
                      <td><span className={styles.opp}>
                        <i>{g.isHome ? 'vs' : '@'}</i><TeamMark t={g.opp} size={22} />
                        <span className={styles.full}>{tName(g.opp)}</span><span className={styles.abbr}>{tCode(g.opp)}</span>
                      </span></td>
                      {g.done ? <>
                        <td colSpan={3}><b className={g.won ? styles.win : styles.loss}>{g.won ? 'W' : 'L'}</b> {g.isHome ? `${g.hs}-${g.as}` : `${g.as}-${g.hs}`} <small className={styles.muted}>Box score after the next data update</small></td>
                        <td></td>
                      </> : <>
                        <td className={styles.num}><span className={styles.wpCell}>
                          <span className={styles.wpBar}><span style={{ width: `${g.p * 100}%` }} /></span>
                          {Math.round(g.p * 100)}%
                        </span></td>
                        <td>{g.p >= 0.5 ? <span className={styles.favTag}>Favored</span> : <span className={styles.dogTag}>Underdog</span>}</td>
                        <td className={styles.outs}>{outs.length ? outs.map(r => r.name).join(', ') : '—'}</td>
                        <td><span className={styles.boxBtn}>Preview</span></td>
                      </>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Game preview (forecast) ──────────────────────────────────────────────────
function Preview({ g, shots, fetched, onClose }) {
  const { home, away, pHome, pAway } = g.fg
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose()
    addEventListener('keydown', k); document.body.style.overflow = 'hidden'
    return () => { removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  const P = { [home.team]: pHome, [away.team]: pAway }
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.scoreboard}>
          {[away, home].map((x, i) => (
            <Fragment key={x.team}>
              {i === 1 && <div className={styles.final}>
                <b>Preview</b>
                <span>{fmtDate(g.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <div className={styles.wp}>
                  <em className={styles.wpCap}>Pre-game Elo win chance</em>
                  <div className={styles.wpLab}><span>{Math.round(pAway * 100)}%</span><span>{Math.round(pHome * 100)}%</span></div>
                  <div className={styles.wpTrack}>
                    <span style={{ width: `${pAway * 100}%`, background: tColor(away.team) }} />
                    <span style={{ width: `${pHome * 100}%`, background: tColor(home.team) }} />
                  </div>
                </div>
              </div>}
              <div className={`${styles.sbTeam} ${i ? styles.sbHome : ''} ${styles.sbWin}`}>
                <span className={styles.sbLogo}><TeamMark t={x.team} size={52} /></span>
                <div className={styles.sbInfo}>
                  <div className={styles.sbName}>{tShort(x.team)}</div>
                  <div className={styles.sbCap}>Forecast rating</div>
                  <div className={styles.sbElo}><span>{r0(x.rating)}</span></div>
                </div>
                <div className={styles.sbPts}>{Math.round(P[x.team] * 100)}<small>%</small></div>
              </div>
            </Fragment>
          ))}
        </div>
        <div className={styles.cards}>
          <StoryCard tag="How the forecast works" tone="blue">
            Each team's rating blends its <b>rotation Elo</b> (current player Elo weighted by projected minutes) with its <b>roster Elo</b> (top 8 healthy players, unweighted).
            The rotation gets more weight as the season's sample grows: {Math.round(blendWeight(home.n) * 100)}% for {tShort(home.team)} after {home.n} game{home.n === 1 ? '' : 's'}.
          </StoryCard>
          <StoryCard tag="Injury report" tone="gold">
            Players listed out are removed and their minutes go to the rest of the rotation{fetched ? `. Report as of ${fmtDate(fetched.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}.
          </StoryCard>
        </div>
        {[away, home].map(x => <ProjBox key={x.team} x={x} shots={shots} />)}
      </div>
    </div>
  )
}

function ProjBox({ x, shots }) {
  const rows = x.rows.filter(r => r.mp > 0.5 || r.out || r.status)
  return (
    <div className={styles.teamBox} style={{ '--tc': tColor(x.team) }}>
      <div className={styles.teamBoxHead}><TeamMark t={x.team} size={30} /><span>{tName(x.team)}</span>
        <span className={styles.projSum}>Rotation {r0(x.rot)} × {Math.round(x.w * 100)}% + Roster {r0(x.raw)} × {Math.round((1 - x.w) * 100)}% = <b>{r0(x.rating)}</b></span></div>
      <div className={styles.tableWrap}>
        <table className={`${styles.box} ${styles.projTable}`}>
          <thead><tr>
            <th className={styles.sticky}>Player</th><th>Status</th><th>Current Elo</th><th>Proj MIN</th><th className={styles.swingH}>Share of rotation</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className={r.out ? styles.outRow : ''}>
                <td className={styles.sticky}><span className={styles.pl}><Headshot name={r.name} shots={shots} color={tColor(x.team)} />
                  <span><b className={styles.pName}>{shortName(r.name)}</b>{!r.rated && <small>No Elo yet · 1,500</small>}</span></span></td>
                <td>{r.status ? <span className={r.out ? styles.outTag : styles.dtdTag} title={r.detail}>{r.status}</span> : ''}</td>
                <td className={styles.elo}><b>{r0(r.elo)}</b></td>
                <td>{r.out ? '—' : r.mp.toFixed(1)}</td>
                <td className={styles.swing}><span className={styles.swingIn}><span className={styles.bar}>
                  <span className={styles.barUp} style={{ left: 0, width: `${(r.mp / 42) * 100}%` }} /></span></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Box score ────────────────────────────────────────────────────────────────
function BoxScore({ team, game, has, shots, onCard, onClose }) {
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
      if ((a.mp || 0) >= 12 && (b.mp || 0) >= 12 && a.gs >= 10 && a.gs - b.gs >= 5 && b.pre - a.pre > (gk ? gk.gap : 0)) gk = { a, b, gap: b.pre - a.pre }
    }
    return { climb, drop, gk }
  }, [P])

  const avail = useMemo(() => new Set(['mp', 'trb', 'ast', 'stl', 'blk', 'tov', 'tpa', 'fga', 'fta'].filter(k => P.some(p => (p[k] || 0) > 0))), [P])
  const winner = game.res === 'W' ? team : opp
  const fav = game.wp[team] >= 0.5 ? team : opp
  const favWon = fav === winner
  const favPct = Math.round(game.wp[fav] * 100)
  const venue = game.home == null ? '' : fav === home ? ' at home' : ' on the road'

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>

        <div className={styles.scoreboard}>
          {[away, home].map((t, i) => {
            const e = game.elo[t], d = e.post - e.pre
            return (
              <Fragment key={t}>
                {i === 1 && <div className={styles.final}>
                  <b>Final{game.ot ? `/${game.ot}` : ''}</b>
                  <span>{fmtDate(game.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  {game.post && <span className={styles.postTag}>Postseason</span>}
                  <div className={styles.wp}>
                    <em className={styles.wpCap}>Pre-game Elo win chance</em>
                    <div className={styles.wpLab}><span>{Math.round(game.wp[away] * 100)}%</span><span>{Math.round(game.wp[home] * 100)}%</span></div>
                    <div className={styles.wpTrack}>
                      <span style={{ width: `${game.wp[away] * 100}%`, background: tColor(away) }} />
                      <span style={{ width: `${game.wp[home] * 100}%`, background: tColor(home) }} />
                    </div>
                  </div>
                </div>}
                <div className={`${styles.sbTeam} ${i ? styles.sbHome : ''} ${t === winner ? styles.sbWin : ''}`}>
                  <span className={styles.sbLogo}><TeamMark t={t} size={52} /></span>
                  <div className={styles.sbInfo}>
                    <div className={styles.sbName}>{tShort(t)}</div>
                    <div className={styles.sbCap} title="Average Elo of the players who played, weighted by their minutes. The schedule's Roster Elo is the unweighted top-8 average.">Lineup Elo · minutes-weighted</div>
                    <div className={styles.sbElo}>
                      <span><small>Pre</small>{r0(e.pre)}<i>{ord(e.preRank.rank)} of {e.preRank.of}</i></span>
                      <span className={styles.sbArrow}>→</span>
                      <span><small>Post</small>{r0(e.post)}<i>{ord(e.postRank.rank)} of {e.postRank.of}</i></span>
                      <b className={d >= 0 ? styles.sbUp : styles.sbDown}>{sgn(d)}</b>
                    </div>
                  </div>
                  <div className={styles.sbPts}>{pts[t]}</div>
                </div>
              </Fragment>
            )
          })}
        </div>

        <div className={styles.cards}>
          <StoryCard tag="Elo Forecast" tone={favWon ? 'blue' : 'gold'}>
            <b>{tShort(fav)}</b> were {favPct}% favorites{venue}
            {favWon ? ' and won.' : '. Upset.'}
          </StoryCard>
          <StoryCard tag="Biggest Climb" tone="up">
            <b>{story.climb.n}</b> {r0(story.climb.pre)} → {r0(story.climb.post)} <em className={styles.up}>{sgn(story.climb.post - story.climb.pre)}</em>
          </StoryCard>
          <StoryCard tag="Biggest Drop" tone="down">
            <b>{story.drop.n}</b> {r0(story.drop.pre)} → {r0(story.drop.post)} <em className={styles.down}>{sgn(story.drop.post - story.drop.pre)}</em>
          </StoryCard>
          {story.gk && <StoryCard tag="Giant Killer" tone="gold">
            <b>{story.gk.a.n}</b> ({r0(story.gk.a.pre)}) out-scored <b>{story.gk.b.n}</b> ({r0(story.gk.b.pre)}): a {r0(story.gk.gap)}-point Elo gap.
          </StoryCard>}
        </div>

        {[away, home].map(t => (
          <TeamBox key={t} t={t} rows={P.filter(p => p.t === t)} N={N} has={has} avail={avail} shots={shots}
            focus={focus} setFocus={setFocus} onCard={onCard} />
        ))}

        <DuelGrid P={P} focus={focus} setFocus={setFocus} />
      </div>
    </div>
  )
}

function StoryCard({ tag, tone, children }) {
  return <div className={`${styles.card} ${styles['t_' + tone]}`}><div className={styles.cardTag}>{tag}</div><div>{children}</div></div>
}

// Box score columns in three groups. `need`: the season must have recorded the stat.
// `any`: hide when nobody in this game has a nonzero value (older box scores log unrecorded stats as 0).
const fmtPct = (m, a) => (a ? (m / a).toFixed(3).replace(/^0/, '') : '—')
const ts = p => { const d = 2 * ((p.fga || 0) + 0.44 * (p.fta || 0)); return d ? (p.pts || 0) / d : null }
const BOX_GROUPS = [
  { g: 'Raw Stats', cls: 'gRaw', cols: [
    { h: 'MIN', need: 'mp', any: 'mp', v: p => p.mp ?? '—', tot: () => '' },
    { h: 'PTS', v: p => p.pts ?? '—', cls: 'pts', sum: 'pts' },
    { h: 'REB', any: 'trb', v: p => p.trb ?? '—', sum: 'trb' },
    { h: 'AST', any: 'ast', v: p => p.ast ?? '—', sum: 'ast' },
    { h: 'STL', need: 'stl', any: 'stl', v: p => p.stl ?? '—', sum: 'stl' },
    { h: 'BLK', need: 'blk', any: 'blk', v: p => p.blk ?? '—', sum: 'blk' },
    { h: 'TO', need: 'tov', any: 'tov', v: p => p.tov ?? '—', sum: 'tov' },
    { h: '+/-', need: 'pm', v: p => (p.pm == null ? '—' : p.pm > 0 ? `+${p.pm}` : p.pm), tot: () => '' },
  ] },
  { g: 'Shooting', cls: 'gShoot', cols: [
    { h: 'FG', pair: ['fg', 'fga'] },
    { h: 'FG%', any: 'fga', pct: ['fg', 'fga'] },
    { h: '3PT', need: 'tp', any: 'tpa', pair: ['tp', 'tpa'] },
    { h: '3P%', need: 'tp', any: 'tpa', pct: ['tp', 'tpa'] },
    { h: 'FT', pair: ['ft', 'fta'] },
    { h: 'FT%', any: 'fta', pct: ['ft', 'fta'] },
    { h: 'TS%', any: 'fga', v: p => { const v = ts(p); return v == null ? '—' : v.toFixed(3).replace(/^0/, '') },
      tot: rows => { const v = ts({ pts: sum(rows, 'pts'), fga: sum(rows, 'fga'), fta: sum(rows, 'fta') }); return v == null ? '—' : v.toFixed(3).replace(/^0/, '') } },
  ] },
]
const sum = (rows, k) => rows.reduce((s, p) => s + (p[k] || 0), 0)
const split = (m, a, showA = true) => (m == null ? '—' : showA ? `${m}-${a ?? '—'}` : `${m}`)

function TeamBox({ t, rows, N, has, avail, shots, focus, setFocus, onCard }) {
  const groups = BOX_GROUPS.map(G => ({ ...G, cols: G.cols.filter(c => (!c.need || has?.has(c.need)) && (!c.any || avail.has(c.any))) }))
    .filter(G => G.cols.length)
  const cell = c => p => c.pair ? split(p[c.pair[0]], p[c.pair[1]], avail.has(c.pair[1]))
    : c.pct ? fmtPct(p[c.pct[0]] || 0, p[c.pct[1]] || 0) : c.v(p)
  const total = c => c.pair ? split(sum(rows, c.pair[0]), sum(rows, c.pair[1]), avail.has(c.pair[1]))
    : c.pct ? fmtPct(sum(rows, c.pct[0]), sum(rows, c.pct[1])) : c.sum ? sum(rows, c.sum) : c.tot ? c.tot(rows) : ''
  const starters = has?.has('st') && rows.some(p => p.st)
  const sorted = [...rows].sort((a, b) => (starters ? b.st - a.st : 0) || (b.mp || 0) - (a.mp || 0) || (b.pts || 0) - (a.pts || 0))
  const sections = starters ? [['Starters', sorted.filter(p => p.st)], ['Bench', sorted.filter(p => !p.st)]] : [[null, sorted]]
  const max = Math.max(8, ...rows.map(p => Math.abs(p.post - p.pre)))
  const net = rows.reduce((s, p) => s + p.post - p.pre, 0)
  const width = 1 + groups.reduce((s, G) => s + G.cols.length, 0) + 5
  const ELO_COLS = 5

  const row = p => {
    const d = p.post - p.pre
    return (
      <tr key={p.n} className={focus === p.n ? styles.focus : ''} onMouseEnter={() => setFocus(p.n)} onMouseLeave={() => setFocus(null)}>
        <td className={styles.sticky}>
          <span className={styles.pl}>
            <Headshot name={p.n} shots={shots} color={tColor(t)} />
            <span><button className={styles.pName} onClick={() => onCard(p.n)} title="Open player card">{shortName(p.n)}</button>
              <small>{[p.pos, tierFor(p.lr).id !== 'common' && tierFor(p.lr).label].filter(Boolean).join(' · ')}</small></span>
          </span>
        </td>
        {groups.map(G => G.cols.map((c, j) => (
          <td key={G.g + c.h} className={`${styles[G.cls]} ${j === 0 ? styles.gStart : ''} ${c.cls ? styles[c.cls] : ''}`}>{cell(c)(p)}</td>
        )))}
        <td className={`${styles.gElo} ${styles.gStart} ${styles.gs}`}>{p.gs.toFixed(1)}</td>
        <td className={`${styles.gElo} ${styles.duels}`} title={`Won ${p.w} of ${N - 1}; Elo expected ${p.xw.toFixed(1)}`}>
          {Number.isInteger(p.w) ? p.w : p.w.toFixed(1)}<small>/{N - 1}</small>
          <i className={p.w >= p.xw ? styles.up : styles.down}>{sgn(p.w - p.xw)}</i>
        </td>
        <td className={`${styles.gElo} ${styles.elo}`}>{r0(p.pre)}</td>
        <td className={`${styles.gElo} ${styles.elo}`}><b>{r0(p.post)}</b></td>
        <td className={`${styles.gElo} ${styles.swing}`}><span className={styles.swingIn}>
          <span className={styles.bar}>
            <span className={d >= 0 ? styles.barUp : styles.barDown} style={{ width: `${Math.min(50, (Math.abs(d) / max) * 50)}%` }} />
          </span>
          <b className={d >= 0 ? styles.up : styles.down}>{sgn(d)}</b>
        </span></td>
      </tr>
    )
  }

  return (
    <div className={styles.teamBox} style={{ '--tc': tColor(t) }}>
      <div className={styles.teamBoxHead}><TeamMark t={t} size={30} /><span>{tName(t)}</span></div>
      <div className={styles.tableWrap}>
        <table className={styles.box}>
          <thead>
            <tr className={styles.groupRow}>
              <th className={styles.sticky} />
              {groups.map(G => <th key={G.g} colSpan={G.cols.length} className={`${styles[G.cls]} ${styles.gStart}`}><span>{G.g}</span></th>)}
              <th colSpan={ELO_COLS} className={`${styles.gElo} ${styles.gStart}`}><span>Elo Stats</span></th>
            </tr>
            <tr>
              <th className={styles.sticky}>Player</th>
              {groups.map(G => G.cols.map((c, j) => <th key={G.g + c.h} className={`${styles[G.cls]} ${j === 0 ? styles.gStart : ''}`}>{c.h}</th>))}
              <th className={`${styles.gElo} ${styles.gStart}`} title="Game Score: the stat every duel is decided on">GmSc</th>
              <th className={styles.gElo} title={`Head-to-head duels won against the other ${N - 1} players in the game, with the number Elo expected`}>Duels</th>
              <th className={styles.gElo}>Pre</th><th className={styles.gElo}>Post</th>
              <th className={`${styles.gElo} ${styles.swingH}`}>Elo Swing</th>
            </tr>
          </thead>
          {sections.map(([label, ps]) => (
            <tbody key={label || 'all'} className={label === 'Bench' ? styles.benchBody : undefined}>
              {label && <tr className={styles.section}><td className={styles.sticky}>{label}</td><td colSpan={width - 1} /></tr>}
              {ps.map(row)}
            </tbody>
          ))}
          <tbody>
            <tr className={styles.totals}>
              <td className={styles.sticky}>Team</td>
              {groups.map(G => G.cols.map((c, j) => (
                <td key={G.g + c.h} className={`${styles[G.cls]} ${j === 0 ? styles.gStart : ''} ${c.cls ? styles[c.cls] : ''}`}>{total(c)}</td>
              )))}
              <td className={`${styles.gElo} ${styles.gStart}`} /><td className={styles.gElo} /><td className={styles.gElo} /><td className={styles.gElo} />
              <td className={`${styles.gElo} ${styles.swing}`}><b className={net >= 0 ? styles.up : styles.down}>{sgn(net)}</b></td>
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
      x: i + 1, label: `G${i + 1} ${g.home === false ? '@' : 'vs'} ${tCode(g.opp)}`, res: `${g.res} ${g.pts}-${g.opp_pts}`, date: g.date,
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
