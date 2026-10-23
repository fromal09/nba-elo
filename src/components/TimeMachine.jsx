import { useState, useEffect, useMemo, useRef } from 'react'
import styles from './TimeMachine.module.css'
import * as TM from './timemachine.js'
import { StatsTab, AwardsTab } from './TimeMachineStats.jsx'
import { DraftRoom, DRAFT_DEFAULT } from './TimeMachineDraft.jsx'

// Time Machine: build a league from any team-seasons, play a season, open any game's box score.
// The league lives in the URL (?l=...), so a link replays the same season.

const PRESET = ['E1970MIL', 'E1996CHI', 'E2012MIA', 'E2023BOS', 'E2007BOS', 'E1966PHI', 'E2005DET', 'E1969NYK',
  'W2016GSW', 'W1971LAL', 'W2012OKC', 'W2006PHO', 'W2001SAC', 'W2008LAL', 'W2024OKC', 'W1998SAS']
const presetLeague = () => ({ ...TM.DEFAULT, teams: PRESET.map(x => ({ id: x.slice(1), conf: x[0] === 'W' ? 1 : 0 })) })
const CONF = ['East', 'West']
const ODDS_N = 10000

const cache = new Map()
const getJSON = url => {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.json() }))
  return cache.get(url)
}
// One team-season's real games (the lines simulated games borrow), loaded once and shared
const sideCache = new Map()
let LEAGUES = {}
const realLog = (s, t) => getJSON(TM.logFile({ s, t })).then(d => TM.parseTeamLog(d))
const loadSide = ts => {
  if (ts.draft) {
    // A drafted team: every player's real games from his own team-season
    const key = ts.id + '|' + ts.draft.map(p => p.id).join(',')
    if (!sideCache.has(key)) {
      const src = [...new Set(ts.draft.map(p => p.s + '|' + p.t))]
      sideCache.set(key, Promise.all(src.map(k => realLog(...k.split('|')).then(l => [k, l])))
        .then(pairs => TM.draftSide(ts, new Map(pairs), p => LEAGUES[`${p.s}|${p.lg}`]?.ppg)))
    }
    return sideCache.get(key)
  }
  if (!sideCache.has(ts.id)) sideCache.set(ts.id, getJSON(TM.logFile(ts)).then(d => ({ ts, ...TM.parseTeamLog(d) })))
  return sideCache.get(ts.id)
}

const fromUrl = () => {
  const p = new URLSearchParams(window.location.search).get('l')
  return p ? TM.decodeLeague(p) : null
}
const pct = v => (v >= 0.995 ? '>99%' : v < 0.0005 ? '—' : v < 0.01 ? '<1%' : `${Math.round(v * 100)}%`)
const fmt = n => Math.round(n).toLocaleString()
const md = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function Seg({ value, options, onChange, disabled }) {
  return (
    <div className={styles.seg}>
      {options.map(([v, label]) => (
        <button key={v} type="button" className={v === value ? styles.segOn : ''} disabled={disabled?.(v)} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

function Year({ ts, big }) {
  return <b className={big ? styles.yearBig : styles.year} style={{ color: ts.color }}>{TM.yearLabel(ts.s)}</b>
}

// ── Builder ────────────────────────────────────────────────────────────────
function Builder({ lg, setLg, cat, byId, onSimulate }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('best')
  const [decade, setDecade] = useState('all')
  const [target, setTarget] = useState(null)
  const rated = r => TM.ratingFor(r, lg.mode, lg.era !== false)
  const full = lg.teams.length >= lg.size
  const inLeague = new Set(lg.teams.map(t => t.id))
  const franchises = new Set(lg.teams.map(t => byId[t.id]?.t.replace(/@.*/, '')))
  const confCount = c => lg.teams.filter(t => t.conf === c).length
  const cap = lg.confs === 2 ? lg.size / 2 : lg.size
  const canAdd = r => !full && !inLeague.has(r.id) && !(lg.uniq && franchises.has(r.t.replace(/@.*/, '')))
  const pickConf = () => {
    if (lg.confs !== 2) return 0
    if (target != null && confCount(target) < cap) return target
    return confCount(0) <= confCount(1) ? 0 : 1
  }
  const add = r => { if (canAdd(r)) setLg({ ...lg, teams: [...lg.teams, { id: r.id, conf: pickConf() }] }) }
  const remove = id => setLg({ ...lg, teams: lg.teams.filter(t => t.id !== id) })
  const move = id => setLg({ ...lg, teams: lg.teams.map(t => (t.id === id ? { ...t, conf: 1 - t.conf } : t)) })

  const fill = () => {
    const teams = [...lg.teams], have = new Set(teams.map(t => t.id)), fr = new Set(teams.map(t => byId[t.id]?.t.replace(/@.*/, '')))
    for (const r of [...cat].sort((a, b) => rated(b) - rated(a))) {
      if (teams.length >= lg.size) break
      const f = r.t.replace(/@.*/, '')
      if (have.has(r.id) || (lg.uniq && fr.has(f))) continue
      const c0 = teams.filter(t => t.conf === 0).length, c1 = teams.length - c0
      teams.push({ id: r.id, conf: lg.confs === 2 ? (c0 <= c1 ? 0 : 1) : 0 }); have.add(r.id); fr.add(f)
    }
    setLg({ ...lg, teams })
  }
  const random = () => {
    const pool = [...cat].sort((a, b) => rated(b) - rated(a)).slice(0, 400)
    const R = TM.rng(Date.now() >>> 0), teams = [], fr = new Set()
    while (teams.length < lg.size && pool.length) {
      const r = pool.splice(Math.floor(R() * pool.length), 1)[0], f = r.t.replace(/@.*/, '')
      if (lg.uniq && fr.has(f)) continue
      fr.add(f); teams.push({ id: r.id, conf: teams.length % 2 })
    }
    setLg({ ...lg, teams, seed: (R() * 1e6) | 0 })
  }
  const setSize = size => setLg({ ...lg, size, teams: lg.teams.slice(0, size), po: Math.min(lg.po, lg.confs === 2 ? size / 2 : size) })
  const setConfs = confs => {
    const teams = lg.teams.map((t, i) => ({ ...t, conf: confs === 2 ? i % 2 : 0 }))
    const max = confs === 2 ? lg.size / 2 : lg.size
    setLg({ ...lg, confs, teams, po: Math.max(confs === 2 ? 2 : 4, Math.min(lg.po, max)) })
  }

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    let list = cat.filter(r => {
      if (decade !== 'all' && r.s.slice(0, 3) !== decade) return false
      if (sort === 'champs' && !r.champ) return false
      if (sort === 'live' && !r.live) return false
      const hay = `${r.name} ${r.s} ${r.t} ${r.lg}`.toLowerCase()
      return words.every(w => (/^\d{2}$/.test(w) ? r.s.slice(2, 4) === w || r.s.slice(5) === w : hay.includes(w)))
    })
    list = list.sort(sort === 'new' ? (a, b) => b.s.localeCompare(a.s) || rated(b) - rated(a) : (a, b) => rated(b) - rated(a))
    return { n: list.length, rows: list.slice(0, 60) }
  }, [cat, q, sort, decade, lg.mode])

  const ranked = [...lg.teams].map(t => byId[t.id]).filter(Boolean).sort((a, b) => rated(b) - rated(a))
  const rankOf = new Map(ranked.map((r, i) => [r.id, i + 1]))
  const decades = [...new Set(cat.map(r => r.s.slice(0, 3)))].sort()

  const tile = t => {
    const r = byId[t.id]
    if (!r) return null
    return (
      <div key={t.id} className={styles.tile} style={{ '--tc': r.color }}>
        <Year ts={r} big />
        <div className={styles.tileMain}>
          <b>{r.name}{r.champ ? <span className={styles.ring} title="Won the title">🏆</span> : null}</b>
          <small>{r.live ? <><span className={styles.liveTag}>In progress</span> {r.w}-{r.l} so far</> : <>{r.w}-{r.l} in real life{r.lg !== 'NBA' ? ` · ${r.lg}` : ''}</>}</small>
        </div>
        <div className={styles.tileRate}><b>{fmt(rated(r))}</b><small>#{rankOf.get(r.id)} of {lg.teams.length}</small></div>
        <div className={styles.tileBtns}>
          {lg.confs === 2 && <button type="button" title={`Move to the ${CONF[1 - t.conf]}`} disabled={confCount(1 - t.conf) >= cap} onClick={() => move(t.id)}>⇄</button>}
          <button type="button" title="Remove" onClick={() => remove(t.id)}>×</button>
        </div>
      </div>
    )
  }
  const column = c => {
    const ts = lg.teams.filter(t => lg.confs === 1 || t.conf === c).sort((a, b) => rated(byId[b.id] || {}) - rated(byId[a.id] || {}))
    const empty = Math.max(0, cap - ts.length)
    return (
      <div className={styles.col}>
        <div className={styles.colHead}>{lg.confs === 2 ? CONF[c] : 'League'}<span>{ts.length}/{cap}</span></div>
        <div className={styles.tiles}>
          {ts.map(tile)}
          {Array.from({ length: empty }, (_, i) => (
            <button key={'e' + i} type="button" className={`${styles.slot} ${target === c ? styles.slotOn : ''}`} onClick={() => setTarget(c)}>
              + Empty slot{lg.confs === 2 ? ` · ${CONF[c]}` : ''}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.builder}>
      <aside className={`${styles.card} ${styles.settings}`}>
        <div><div className={styles.lab}>Teams</div>
          <Seg value={lg.size} options={TM.SIZES.map(n => [n, n])} onChange={setSize} /></div>
        <div><div className={styles.lab}>Conferences</div>
          <Seg value={lg.confs} options={[[1, 'One table'], [2, 'Two']]} onChange={setConfs} /></div>
        <div><div className={styles.lab}>Schedule</div>
          <Seg value={lg.games} options={TM.LENGTHS.map(n => [n, n])} onChange={games => setLg({ ...lg, games })} />
          <p className={styles.hint}>Every team plays every other team, and conference rivals meet more often.</p></div>
        <div><div className={styles.lab}>Playoffs</div>
          <Seg value={lg.po} options={TM.playoffChoices(lg).map(n => [n, n])} onChange={po => setLg({ ...lg, po })} />
          <p className={styles.hint}>{lg.confs === 2 ? 'Per conference' : 'Total'} · best of 7, 2-2-1-1-1{lg.po === 6 ? ' · top 2 seeds get a bye' : ''}</p></div>
        <div><div className={styles.lab}>Team rating</div>
          <Seg value={lg.mode} options={Object.entries(TM.MODES)} onChange={mode => setLg({ ...lg, mode })} />
          <p className={styles.hint}>{lg.mode === 'r' ? 'Margin of victory' : lg.mode === 'e' ? 'Season-average lineup Elo' : 'Half margin of victory, half lineup Elo'}, as a z-score against its own league that season. Leagues under 15 teams count less.</p></div>
        <label className={styles.toggle}><span>Era adjustment</span><input type="checkbox" checked={lg.era !== false} onChange={e => setLg({ ...lg, era: e.target.checked })} /><i /></label>
        <p className={styles.hint} style={{ marginTop: -10 }}>Early seasons count less: before 1954-55 a team's edge counts 60%, through 1966-67 75%, through 1975-76 88%.</p>
        <label className={styles.toggle}><span>Home court</span><input type="checkbox" checked={lg.home} onChange={e => setLg({ ...lg, home: e.target.checked })} /><i /></label>
        <label className={styles.toggle}><span>One season per franchise</span><input type="checkbox" checked={lg.uniq} onChange={e => setLg({ ...lg, uniq: e.target.checked })} /><i /></label>
      </aside>

      <div className={styles.cols} data-one={lg.confs === 1 ? '' : undefined}>
        {lg.confs === 2 ? <>{column(0)}{column(1)}</> : column(0)}
      </div>

      <aside className={`${styles.card} ${styles.picker}`}>
        <div className={styles.pickHead}>
          <div className={styles.lab}>Add a team-season{target != null && lg.confs === 2 ? ` · to the ${CONF[target]}` : ''}</div>
          <div className={styles.search}>
            <span>⌕</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Team, city or year (Bulls 96)" />
            <small>{results.n.toLocaleString()}</small>
          </div>
          <div className={styles.filters}>
            {[['best', 'Best first'], ['champs', 'Champions'], ['new', 'Newest'], ['live', 'This season']].map(([v, l]) => (
              <button key={v} type="button" className={sort === v ? styles.fOn : ''} onClick={() => setSort(v)}>{l}</button>
            ))}
            <select value={decade} onChange={e => setDecade(e.target.value)}>
              <option value="all">All decades</option>
              {decades.map(d => <option key={d} value={d}>{d}0s</option>)}
            </select>
          </div>
        </div>
        <div className={styles.pickList}>
          {results.rows.map(r => (
            <div key={r.id} className={`${styles.pick} ${inLeague.has(r.id) ? styles.pickIn : ''}`}>
              <Year ts={r} />
              <div className={styles.pickMain}>
                <b>{r.name}{r.champ ? <span className={styles.ring}>🏆</span> : null}</b>
                <small>{r.live ? <><span className={styles.liveTag}>In progress</span> {r.w}-{r.l} so far · rated on current rosters</> : <>{r.w}-{r.l} · {r.mov >= 0 ? '+' : ''}{r.mov} margin{r.lg !== 'NBA' ? ` · ${r.lg}` : ''}</>}</small>
              </div>
              <b className={styles.pickRate}>{fmt(rated(r))}</b>
              {inLeague.has(r.id) ? <span className={styles.inTag}>In</span>
                : <button type="button" className={styles.add} disabled={!canAdd(r)} onClick={() => add(r)} aria-label={`Add ${r.s} ${r.name}`}>+</button>}
            </div>
          ))}
          {!results.rows.length && <p className={styles.none}>No team-seasons match.</p>}
        </div>
        <p className={styles.formula}>Rating = 2,000 + {TM.RATING_SD} × era z-score</p>
      </aside>

      <div className={styles.buildBar}>
        <button type="button" className={styles.btn} onClick={() => setLg({ ...lg, teams: [] })}>Clear</button>
        <button type="button" className={styles.btn} onClick={random}>Random league</button>
        <button type="button" className={styles.btn} onClick={fill} disabled={full}>Auto-fill best</button>
        <button type="button" className={`${styles.btn} ${styles.pri}`} disabled={!full} onClick={onSimulate}>
          {full ? 'Simulate season ▸' : `Add ${lg.size - lg.teams.length} more`}
        </button>
      </div>
    </div>
  )
}

// ── Box score ──────────────────────────────────────────────────────────────
function BoxModal({ game, onClose }) {
  const [box, setBox] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    Promise.all([loadSide(game.home), loadSide(game.away)]).then(([sh, sa]) => {
      if (!live) return
      const b = TM.boxScore(game.key, sh, sa, game.hw)
      if (b) setBox(b); else setErr('No box scores on file for one of these team-seasons.')
    }).catch(() => live && setErr("Couldn't load the season data."))
    return () => { live = false }
  }, [game])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const side = (ts, b, won) => {
    const has = k => k === 'mp' ? b.lines.some(p => p.mp != null) : b.lines.some(p => p[k])
    const cols = [['mp', 'MIN'], ['pts', 'PTS'], ['trb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['tov', 'TO']].filter(([k]) => has(k))
    const shoot = (m, a) => (b.lines.some(p => p[a] != null) ? [m, a] : null)
    return (
      <section className={styles.boxSide}>
        <header style={{ '--tc': ts.color }}>
          <Year ts={ts} /><b>{ts.name}</b><span className={styles.boxPts}>{b.pts}</span>{won && <i className={styles.wTag}>W</i>}
        </header>
        <div className={styles.boxScroll}>
          <table className={styles.boxTable}>
            <thead><tr><th className={styles.pl}>Player</th>{cols.map(([, l]) => <th key={l}>{l}</th>)}
              <th>FG</th>{shoot('tp', 'tpa') && <th>3PT</th>}<th>FT</th><th>GmSc</th><th>Duels</th></tr></thead>
            <tbody>
              {b.lines.map(p => (
                <tr key={p.n} className={p.potg ? styles.potg : ''}>
                  <td className={styles.pl}>{p.n}{p.potg && <span className={styles.potgTag}>Player of the Game</span>}</td>
                  {cols.map(([k]) => <td key={k}>{p[k] ?? '—'}</td>)}
                  <td>{p.fg ?? 0}-{p.fga ?? '?'}</td>{shoot('tp', 'tpa') && <td>{p.tp ?? 0}-{p.tpa ?? 0}</td>}
                  <td>{p.ft ?? 0}-{p.fta ?? '?'}</td><td><b>{p.gs.toFixed(1)}</b></td><td className={styles.muted}>{p.dw}-{p.dl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.src}>{b.src.synthetic
          ? ts.draft ? <>Drafted team: each player's line is one of his own games from that season, pace-adjusted, fitted to the minutes this roster gives him, and scaled so the team shares one ball</>
            : <>Season in progress: each player's line is one of his own recent games, fitted to 240 team minutes and scaled ×{b.src.f.toFixed(2)} to a {TM.PACE}-point pace</>
          : <>Lines from {md(b.src.date)} {b.src.home ? 'vs' : '@'} {b.src.opp.replace(/@.*/, '')} ({b.src.us > b.src.them ? 'W' : 'L'} {b.src.us}-{b.src.them}), scaled ×{b.src.f.toFixed(2)} to a {TM.PACE}-point pace</>}</p>
      </section>
    )
  }
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.kick}>{game.title}</div>
            {box ? <h2><Year ts={game.away} /> {TM.nickname(game.away.name)} {box.away.pts}, <Year ts={game.home} /> {TM.nickname(game.home.name)} {box.home.pts}{box.ot ? ' (OT)' : ''}</h2>
              : <h2>{err || 'Building the box score…'}</h2>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        {box && <>
          {side(game.away, box.away, !game.hw)}
          {side(game.home, box.home, game.hw)}
          <p className={styles.boxNote}>The result comes from the team ratings. Each team's lines are one of its real games that season, a win for the winner and a loss for the loser. Duels are each player's Game Score record against everyone else in this game.</p>
        </>}
      </div>
    </div>
  )
}

// ── Season ─────────────────────────────────────────────────────────────────
function Season({ lg, setLg, byId, onEdit, shareUrl, origin }) {
  const [tab, setTab] = useState('standings')
  const [box, setBox] = useState(null)
  const [odds, setOdds] = useState(null)
  const [focus, setFocus] = useState(0)
  const [copied, setCopied] = useState(false)
  const T = lg.teams.map(t => byId[t.id])
  const ratings = useMemo(() => T.map(r => TM.ratingFor(r, lg.mode, lg.era !== false)), [lg.teams, lg.mode, lg.era, byId])
  const sched = useMemo(() => TM.makeSchedule(lg, TM.hash(TM.encodeLeague({ ...lg, seed: 0 }))), [lg.teams, lg.games, lg.confs])
  const proj = useMemo(() => TM.expectedWins(sched, ratings, lg.home), [sched, ratings, lg.home])
  const S = useMemo(() => TM.runSeason(lg, sched, ratings), [lg, sched, ratings])
  const key = TM.encodeLeague(lg)
  useEffect(() => { setOdds(null) }, [key])
  useEffect(() => {
    if (tab !== 'odds' || odds) return
    return TM.runOdds(lg, sched, ratings, ODDS_N, setOdds)
  }, [tab, odds, key])

  const N = T.length, w = S.w
  // Per-team game logs, L10 and streak
  const logs = useMemo(() => {
    const L = T.map(() => [])
    sched.forEach((g, j) => {
      const hw = S.results[j]
      L[g.h].push({ g, j, won: hw, opp: g.a, home: true })
      L[g.a].push({ g, j, won: !hw, opp: g.h, home: false })
    })
    return L
  }, [S, sched])
  const streak = i => { const l = logs[i]; const last = l[l.length - 1].won; let n = 0; for (let k = l.length - 1; k >= 0 && l[k].won === last; k--) n++; return (last ? 'W' : 'L') + n }
  const l10 = i => logs[i].slice(-10).filter(x => x.won).length
  const groups = lg.confs === 2 ? [0, 1].map(c => T.map((_, i) => i).filter(i => lg.teams[i].conf === c)) : [T.map((_, i) => i)]
  const champ = S.po.champ
  const playoffTeams = new Set(S.po.seeds.flat())

  const openRegular = (j) => {
    const g = sched[j]
    setBox({ key: `${key}|r${j}`, home: T[g.h], away: T[g.a], hw: S.results[j], title: `Regular season · day ${g.day + 1}` })
  }
  const openPlayoff = (s, n) => {
    const gm = s.games[n]
    setBox({ key: `${key}|p${s.label}${s.round}${s.hi}-${s.lo}g${n}`, home: T[gm.h], away: T[gm.a], hw: gm.hw, title: `${roundName(s)} · Game ${n + 1}` })
  }
  const roundName = s => s.label === 'Finals' ? 'Finals' : `${s.label === 'League' ? '' : s.label + ' '}${s.round === s.of - 1 ? (s.label === 'League' ? 'Final' : 'final') : s.of - s.round === 2 ? 'semis' : `round ${s.round + 1}`}`.trim()

  // Box scores for every game, added up into season stats and awards (built when those tabs open)
  const [sides, setSides] = useState(null)
  const [stats, setStats] = useState(null)
  useEffect(() => {
    let live = true
    setSides(null)
    Promise.all(T.map(loadSide)).then(x => live && setSides(x)).catch(() => live && setSides('error'))
    return () => { live = false }
  }, [lg.teams])
  const poGames = useMemo(() => {
    const series = [...S.po.conf.flatMap(b => b.rounds.flat()), ...(lg.confs === 2 ? [S.po.finals] : [])]
    return series.flatMap(s => s.games.map((gm, n) => ({ ...gm, key: `${key}|p${s.label}${s.round}${s.hi}-${s.lo}g${n}`, finals: s === S.po.finals })))
  }, [S, key])
  useEffect(() => { setStats(null) }, [key])
  useEffect(() => {
    if (!['stats', 'awards'].includes(tab) || stats || !Array.isArray(sides)) return
    const t = setTimeout(() => {
      const list = TM.seasonStats(key, sched, S.results, sides, poGames.filter(g => g.finals))
      setStats({ list, awards: TM.awards(list, S.w, lg.games, S.po.champ) })
    }, 30)
    return () => clearTimeout(t)
  }, [tab, stats, sides, key])

  const share = () => {
    const url = shareUrl || window.location.origin + '/timemachine?l=' + encodeURIComponent(key)
    ;(navigator.clipboard?.writeText(url) || Promise.reject()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => window.prompt('Copy this link', url))
  }

  const table = (ids, label) => {
    const order = TM.seedOrder(ids, w, ratings)
    const top = order[0]
    return (
      <div className={styles.card} key={label}>
        <div className={styles.hd}><h3>{label}</h3><span>Top {Math.min(lg.po, ids.length)} make the playoffs</span></div>
        <div className={styles.tblWrap}>
          <table className={styles.tbl}>
            <thead><tr><th>#</th><th className={styles.left}>Team-season</th><th>W-L</th><th>GB</th><th>Proj</th><th>vs Proj</th><th>L10</th><th>Strk</th><th>Rating</th></tr></thead>
            <tbody>
              {order.map((i, k) => {
                const gb = w[top] - w[i]
                const dv = w[i] - proj[i]
                return [
                  k === Math.min(lg.po, ids.length) && <tr key={'cut' + k} className={styles.cut}><td colSpan={9} /></tr>,
                  <tr key={i} className={i === champ ? styles.champRow : ''} onClick={() => { setFocus(i); setTab('schedule') }}>
                    <td className={styles.muted}>{k + 1}</td>
                    <td className={styles.left}><span className={styles.teamCell}><Year ts={T[i]} /><b>{TM.nickname(T[i].name)}</b>{i === champ && <span className={styles.champTag} title="Champion">🏆</span>}</span></td>
                    <td><b>{w[i]}-{lg.games - w[i]}</b></td>
                    <td className={styles.muted}>{gb === 0 ? '—' : gb}</td>
                    <td>{Math.round(proj[i])}</td>
                    <td className={dv >= 3 ? styles.up : dv <= -3 ? styles.down : styles.muted}><b>{dv >= 0 ? '+' : ''}{Math.round(dv)}</b></td>
                    <td>{l10(i)}-{10 - l10(i)}</td>
                    <td className={streak(i)[0] === 'W' ? styles.up : styles.down}>{streak(i)}</td>
                    <td className={styles.muted}>{fmt(ratings[i])}</td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const seedOf = new Map()
  S.po.seeds.forEach(s => s.forEach((t, k) => seedOf.set(t, k + 1)))
  const seriesBox = s => (
    <div className={styles.series} key={s.label + s.round + s.hi}>
      {[s.hi, s.lo].map(t => (
        <div key={t} className={t === s.win ? styles.sWin : styles.sLose}>
          <small>{seedOf.get(t)}</small><Year ts={T[t]} /><span>{TM.nickname(T[t].name)}</span><b>{t === s.hi ? s.score[0] : s.score[1]}</b>
        </div>
      ))}
      <div className={styles.sGames}>
        {s.games.map((g, n) => (
          <button key={n} type="button" onClick={() => openPlayoff(s, n)} title={`Game ${n + 1}: ${T[g.hw ? g.h : g.a].name} win`}
            style={{ background: T[g.hw ? g.h : g.a].color }}>G{n + 1}</button>
        ))}
      </div>
    </div>
  )
  const bracketCols = []
  S.po.conf.forEach((b, c) => b.rounds.forEach((r, k) => bracketCols.push({ c, k, label: roundName(r[0]), series: r })))
  if (lg.confs === 2) {
    const east = bracketCols.filter(x => x.c === 0), west = bracketCols.filter(x => x.c === 1).reverse()
    bracketCols.length = 0
    bracketCols.push(...east, { label: 'Finals', series: [S.po.finals], fin: true }, ...west)
  }

  // Storylines
  const stories = useMemo(() => {
    const out = []
    const best = [...T.keys()].sort((a, b) => w[b] - w[a])[0]
    out.push(['Best record', `${TM.fullName(T[best])} go ${w[best]}-${lg.games - w[best]}.`])
    const dv = [...T.keys()].map(i => [i, w[i] - proj[i]])
    const over = dv.reduce((m, x) => (x[1] > m[1] ? x : m)), flop = dv.reduce((m, x) => (x[1] < m[1] ? x : m))
    if (over[1] >= 2) out.push(['Overachiever', `${TM.fullName(T[over[0]])}: ${w[over[0]]} wins on a ${Math.round(proj[over[0]])}-win projection.`])
    if (flop[1] <= -2) out.push(['Flop', `${TM.fullName(T[flop[0]])}: ${w[flop[0]]} wins, ${Math.round(-flop[1])} below projection.`])
    const all = [...S.po.conf.flatMap(b => b.rounds.flat()), ...(lg.confs === 2 ? [S.po.finals] : [])]
    const ups = all.filter(s => s.win === s.lo && s.label !== 'Finals' && seedOf.get(s.lo) > seedOf.get(s.hi)).sort((a, b) => (ratings[b.hi] - ratings[b.lo]) - (ratings[a.hi] - ratings[a.lo]))[0]
    if (ups) out.push(['Upset', `No. ${seedOf.get(ups.lo)} ${TM.yearLabel(T[ups.lo].s)} ${TM.nickname(T[ups.lo].name)} knock out No. ${seedOf.get(ups.hi)} ${TM.yearLabel(T[ups.hi].s)} ${TM.nickname(T[ups.hi].name)}, ${ups.score[1]}-${ups.score[0]}.`])
    const [a, b] = [...T.keys()].sort((x, y) => ratings[y] - ratings[x])
    const h2h = logs[a].filter(x => x.opp === b)
    const aw = h2h.filter(x => x.won).length
    if (h2h.length) out.push(['Marquee matchup', `${TM.yearLabel(T[a].s)} ${TM.nickname(T[a].name)} vs ${TM.yearLabel(T[b].s)} ${TM.nickname(T[b].name)}: ${aw > h2h.length - aw ? TM.nickname(T[a].name) : aw < h2h.length - aw ? TM.nickname(T[b].name) : 'split'} ${Math.max(aw, h2h.length - aw)}-${Math.min(aw, h2h.length - aw)}${aw === h2h.length - aw ? '' : ' in the season series'}.`])
    return out
  }, [S, logs])

  const fin = S.po.finals
  const ct = T[champ]
  return (
    <div className={styles.season}>
      <div className={styles.seasonBar}>
        <div className={styles.tabs}>
          {[['standings', 'Standings'], ['schedule', 'Schedule'], ['playoffs', 'Playoffs'], ['stats', 'Player stats'], ['awards', 'Awards'], ['odds', 'Odds']].map(([v, l]) => (
            <button key={v} type="button" className={tab === v ? styles.tabOn : ''} onClick={() => setTab(v)}>{l}</button>
          ))}
        </div>
        <div className={styles.barBtns}>
          <button type="button" className={styles.btn} onClick={onEdit}>Edit league</button>
          <button type="button" className={styles.btn} onClick={() => setLg({ ...lg, seed: lg.seed + 1 })}>Run it back</button>
          <button type="button" className={`${styles.btn} ${styles.pri}`} onClick={share}>{copied ? 'Link copied' : 'Share'}</button>
        </div>
      </div>
      <div className={styles.seasonGrid}>
        <div className={styles.main}>
          {tab === 'standings' && <div className={styles.tables} data-two={groups.length === 2 ? '' : undefined}>
            {groups.map((ids, c) => table(ids, lg.confs === 2 ? CONF[c] : 'Standings'))}
          </div>}
          {tab === 'playoffs' && <div className={`${styles.card} ${styles.bracket}`}>
            {bracketCols.map((col, k) => (
              <div key={k} className={`${styles.bCol} ${col.fin ? styles.bFin : ''}`}>
                <div className={styles.rl}>{col.label}</div>
                {col.series.map(seriesBox)}
              </div>
            ))}
          </div>}
          {tab === 'schedule' && <div className={styles.card}>
            <div className={styles.hd}><h3>Game log</h3>
              <select value={focus} onChange={e => setFocus(+e.target.value)} className={styles.teamSel}>
                {T.map((r, i) => <option key={i} value={i}>{TM.fullName(r)}</option>)}
              </select></div>
            <div className={styles.log}>
              {(() => { let ww = 0, ll = 0; return logs[focus].map(x => {
                if (x.won) ww++; else ll++
                const o = T[x.opp]
                return (
                  <button key={x.j} type="button" className={styles.logRow} onClick={() => openRegular(x.j)}>
                    <span className={styles.muted}>Day {x.g.day + 1}</span>
                    <span className={styles.logOpp}>{x.home ? 'vs' : '@'} <Year ts={o} /> {TM.nickname(o.name)}</span>
                    <b className={x.won ? styles.up : styles.down}>{x.won ? 'W' : 'L'}</b>
                    <span className={styles.muted}>{ww}-{ll}</span>
                    <span className={styles.boxLink}>Box ›</span>
                  </button>
                )
              }) })()}
            </div>
          </div>}
          {(tab === 'stats' || tab === 'awards') && (sides === 'error' ? <p className={styles.none}>Couldn't load the game logs for these team-seasons.</p>
            : !stats ? <p className={styles.none}>Building {(sched.length).toLocaleString()} box scores…</p>
            : tab === 'stats' ? <StatsTab stats={stats.list} T={T} games={lg.games} origin={origin} />
            : <AwardsTab A={stats.awards} T={T} games={lg.games} origin={origin} />)}
          {tab === 'odds' && <div className={styles.card}>
            <div className={styles.hd}><h3>Odds</h3><span>{ODDS_N.toLocaleString()} simulated seasons</span></div>
            {!odds ? <p className={styles.none}>Simulating {ODDS_N.toLocaleString()} seasons…</p> : (
              <div className={styles.tblWrap}><table className={styles.tbl}>
                <thead><tr><th className={styles.left}>Team-season</th><th>Rating</th><th>Avg wins</th><th>Playoffs</th><th>Top seed</th><th>Finals</th><th>Title</th></tr></thead>
                <tbody>{[...T.keys()].sort((a, b) => odds.title[b] - odds.title[a] || ratings[b] - ratings[a]).map(i => (
                  <tr key={i}>
                    <td className={styles.left}><span className={styles.teamCell}><Year ts={T[i]} /><b>{TM.nickname(T[i].name)}</b>{lg.confs === 2 && <small className={styles.muted}>{CONF[lg.teams[i].conf]}</small>}</span></td>
                    <td className={styles.muted}>{fmt(ratings[i])}</td><td>{odds.wins[i].toFixed(1)}</td>
                    <td>{pct(odds.po[i])}</td><td>{pct(odds.seed1[i])}</td><td>{pct(odds.fin[i])}</td>
                    <td><span className={styles.titleBar}><i style={{ width: `${Math.min(100, odds.title[i] * 250)}%` }} /></span><b>{pct(odds.title[i])}</b></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>}
        </div>
        <aside className={styles.side}>
          <div className={styles.banner}>
            <span>🏆</span>
            <div><small>Champion</small><b>{TM.fullName(ct)}</b>
              <p>{w[champ]}-{lg.games - w[champ]}, {lg.confs === 2 ? `the ${CONF[lg.teams[champ].conf]}'s` : 'the'} No. {seedOf.get(champ)} seed · beat the {TM.yearLabel(T[fin.win === fin.hi ? fin.lo : fin.hi].s)} {TM.nickname(T[fin.win === fin.hi ? fin.lo : fin.hi].name)} {Math.max(...fin.score)}-{Math.min(...fin.score)} in the Finals</p></div>
          </div>
          <div className={styles.card}>
            <div className={styles.storyHead}>Storylines</div>
            {stories.map(([a, b]) => <div key={a} className={styles.story}><div className={styles.rl}>{a}</div><p>{b}</p></div>)}
          </div>
          <div className={`${styles.card} ${styles.finals}`}>
            <div className={styles.storyHead}>Finals · box scores</div>
            <div className={styles.sGames}>{fin.games.map((g, n) => (
              <button key={n} type="button" onClick={() => openPlayoff(fin, n)} style={{ background: T[g.hw ? g.h : g.a].color }}>G{n + 1}</button>
            ))}</div>
          </div>
        </aside>
      </div>
      {box && <BoxModal game={box} onClose={() => setBox(null)} />}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function TimeMachine() {
  const [cat, setCat] = useState(null)
  const [pool, setPool] = useState(null)
  const [err, setErr] = useState(null)
  const initial = useRef(fromUrl())
  const initialDraft = useRef((() => { const p = new URLSearchParams(window.location.search).get('d'); return p ? TM.decodeDraft(p) : null })())
  const [kind, setKind] = useState(initialDraft.current ? 'draft' : 'teams')
  const [lg, setLg] = useState(() => initial.current || presetLeague())
  const [dl, setDl] = useState(() => (initialDraft.current ? { ...DRAFT_DEFAULT, ...initialDraft.current, type: 'commish' } : DRAFT_DEFAULT))
  const [view, setView] = useState(() => {
    if (initialDraft.current) return initialDraft.current.picks.flat().length >= initialDraft.current.size * initialDraft.current.roster ? 'season' : 'build'
    return initial.current && initial.current.teams.length >= initial.current.size ? 'season' : 'build'
  })

  useEffect(() => {
    getJSON('/data/explorer/timemachine.json').then(d => { LEAGUES = d.leagues; setCat(TM.parseCatalog(d)) }).catch(() => setErr("Couldn't load the team-season catalog."))
  }, [])
  useEffect(() => {
    if (kind !== 'draft' || pool) return
    getJSON('/data/explorer/draft.json').then(d => setPool(TM.parseDraftPool(d))).catch(() => setErr("Couldn't load the draft pool."))
  }, [kind, pool])
  const byId = useMemo(() => Object.fromEntries((cat || []).map(r => [r.id, r])), [cat])
  // Drop team-seasons the catalog doesn't know (an old link, a renamed franchise)
  useEffect(() => {
    if (!cat) return
    const ok = lg.teams.filter(t => byId[t.id])
    if (ok.length !== lg.teams.length) { setLg({ ...lg, teams: ok }); if (kind === 'teams') setView('build') }
  }, [cat])
  useEffect(() => {
    const url = kind === 'draft' ? '/timemachine?d=' + encodeURIComponent(TM.encodeDraft(dl)) : '/timemachine?l=' + encodeURIComponent(TM.encodeLeague(lg))
    window.history.replaceState(null, '', url)
  }, [lg, dl, kind])

  // A finished draft becomes a league of pseudo team-seasons the season view can play
  const draft = useMemo(() => {
    if (kind !== 'draft' || !pool) return null
    TM.applyEra(pool, dl.era !== false)
    const rows = dl.picks.slice(0, dl.size).map((ids, i) => TM.draftTeam(ids.map(id => pool.byId[id]).filter(Boolean), pool.coef, i, null, dl.roster, dl.depth?.[i]))
    const league = { size: dl.size, confs: dl.confs, games: dl.games, po: dl.po, mode: dl.mode, home: dl.home, uniq: false, seed: dl.seed, era: false,
      teams: rows.map((r, i) => ({ id: r.id, conf: dl.confs === 2 ? i % 2 : 0 })) }
    const where = new Map(rows.flatMap((r, i) => r.draft.map(p => [i + '|' + p.n, p])))
    return { rows, league, byId: Object.fromEntries(rows.map(r => [r.id, r])), origin: x => { const p = where.get(x.team + '|' + x.n); return p ? `${TM.yearLabel(p.s)} ${p.t.replace(/@.*/, '')}` : '' } }
  }, [kind, pool, dl])
  const full = kind === 'draft' ? !!draft && dl.picks.flat().length >= dl.size * dl.roster : lg.teams.length >= lg.size
  const switchKind = k => { setKind(k); setView('build') }
  const shown = kind === 'draft' ? draft?.league : lg

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <div className={styles.kicker}>Time Machine</div>
          <div className={styles.title}>{view === 'season' ? <>Season results <span>· run {shown?.seed}</span></> : kind === 'draft' ? 'Draft a league' : 'Build a league'}</div>
          <p className={styles.sub}>{kind === 'draft'
            ? 'Draft players from any season since 1946-47. Each player is rated against his own league that year, and box scores use his real games from that season.'
            : 'Any team-season from 1946-47 to today. Each team is rated against its own league that year, then everyone plays on one scale.'}</p>
          {view === 'build' && <div className={styles.kindTabs}>
            <button type="button" className={kind === 'teams' ? styles.kindOn : ''} onClick={() => switchKind('teams')}>Team-seasons</button>
            <button type="button" className={kind === 'draft' ? styles.kindOn : ''} onClick={() => switchKind('draft')}>Player draft</button>
          </div>}
        </div>
        {shown && <div className={styles.heroStats}>
          <span><b>{shown.size}</b> teams</span><span><b>{shown.games}</b> games</span><span><b>{TM.MODES[shown.mode]}</b> ratings</span>
        </div>}
      </div>
      {err && <p className={styles.none}>{err}</p>}
      {(!cat || (kind === 'draft' && !pool)) && !err && <p className={styles.none}>Loading {kind === 'draft' ? 'player-seasons' : 'team-seasons'}…</p>}
      {cat && kind === 'teams' && (view === 'season' && full
        ? <Season lg={lg} setLg={setLg} byId={byId} onEdit={() => setView('build')} />
        : <Builder lg={lg} setLg={setLg} cat={cat} byId={byId} onSimulate={() => setView('season')} />)}
      {cat && kind === 'draft' && pool && (view === 'season' && full
        ? <Season lg={draft.league} setLg={x => setDl(d => ({ ...d, seed: x.seed }))} byId={draft.byId} origin={draft.origin}
            shareUrl={window.location.origin + '/timemachine?d=' + encodeURIComponent(TM.encodeDraft(dl))} onEdit={() => setView('build')} />
        : <DraftRoom pool={pool} dl={dl} setDl={setDl} catalogLeagues={LEAGUES} onSimulate={() => setView('season')} />)}
    </div>
  )
}
