import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import styles from './PlayerModal.module.css'
import { binderTeamInfo, binderLogo, binderHeadshots } from './SeasonExplorer'
import { norm } from './predict'
import { TIERS as CARD_TIERS, tierFor } from './PlayerCard'
import { useAllTime, liveAllTime, AllTimeProfile, Foil as AtFoil } from './AllTime'

/*
 * The player card: a career profile (not a collectible). The hero (headshot, team, rank seal), four headline numbers, where he
 * ranked month by month (or his Elo), badges as medals, career highs, his decades, and the season-by-season ledger.
 *
 * Ranks wear the card foils, by the cards' own tiers (PlayerCard.jsx TIERS): No. 1 is a GOAT, 2–5 Icon, 6–20 Legend, 21–50 Standout,
 * 51–125 Rare, Common past that.
 *
 * Season, decade and monthly lines come from /data/careers/<shard>.json (scripts/build_careers.py, nightly): each season's games,
 * Elo at its end, peak and average with where each ranked among players with 20+ rated games, per-game box scores and the best game;
 * each decade's games, average and peak with their ranks; and his rank among active players at every month's end. Until a
 * player's file is there, the card builds the Elo part of each season and decade from his game-by-game history and leaves the
 * ranks and box scores out.
 */

const SHARDS = 64
const shard = name => { let h = 0; for (const c of name) h = (h * 31 + c.codePointAt(0)) % SHARDS; return h }
const cache = new Map()
const getJSON = url => {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null))
  return cache.get(url)
}

const fmt = v => (v == null ? '—' : Math.round(v).toLocaleString())
const md = (d, year = true) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
const tInfo = t => binderTeamInfo(t) || {}
const tColor = t => tInfo(t).color || '#3a5578'
const initials = n => n.replace(/\s*\(.*\)$/, '').split(/[\s-]+/).map(w => w[0]).join('').slice(0, 3).toUpperCase()
// Card tiers by rank, straight from the cards (PlayerCard.jsx), for the foils: [id, name, ranks]
const TIERS = CARD_TIERS.map((t, i) => {
  const lo = i ? CARD_TIERS[i - 1].max + 1 : 1
  return [t.id, t.label.replace('★ ', ''), t.max === Infinity ? `${lo}+` : lo === t.max ? `No. ${lo}` : `${lo}–${t.max}`]
})
const tierOf = r => (!r ? 'none' : tierFor(r).id)

// Season lines from the game-by-game history, for a player whose career file isn't built yet (no ranks or box scores)
function seasonsFromHistory(h) {
  const S = new Map()
  for (const [d, e, , , t] of h || []) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7), s0 = m >= 8 ? y : y - 1, s = `${s0}-${String(s0 + 1).slice(2)}`
    if (!S.has(s)) S.set(s, [])
    S.get(s).push([e, t])
  }
  let prev = null
  return [...S].map(([s, L]) => {
    const es = L.map(x => x[0])
    const line = { s, t: [...new Set(L.map(x => x[1]))], g: L.length, st: Math.round(prev ?? es[0]), en: Math.round(es.at(-1)), pk: Math.round(Math.max(...es)), av: Math.round(es.reduce((a, b) => a + b, 0) / es.length) }
    prev = es.at(-1)
    return line
  })
}

// Decades by season start year (2009-10 is in the 2000s), from the game-by-game history: no ranks
function decadesFromHistory(h) {
  const D = new Map()
  for (const [d, e] of h || []) {
    const y = +d.slice(0, 4), m = +d.slice(5, 7), dk = Math.floor((m >= 8 ? y : y - 1) / 10) * 10
    if (!D.has(dk)) D.set(dk, { d: dk, g: 0, sum: 0, pk: 0, ss: new Set() })
    const r = D.get(dk); r.g++; r.sum += e; r.pk = Math.max(r.pk, e); r.ss.add(m >= 8 ? y : y - 1)
  }
  return [...D.values()].map(r => ({ d: r.d, n: r.ss.size, g: r.g, av: Math.round(r.sum / r.g), pk: Math.round(r.pk) }))
}
const decOf = s => Math.floor(+s.s.slice(0, 4) / 10) * 10

// "955 Games at No. 1" → 955 on the medal, "Games at No. 1" under it; "Peak Rank Top 5 (#3)" → #3
function medalOf(b) {
  let label = b.label, tag = ''
  let m = label.match(/^([\d,]+) (Games? at No\. 1)$/)
  if (m) { tag = m[1]; label = 'Games at No. 1' }
  m = label.match(/^(.*?)\s*\((#\d+)\)$/)
  if (m) { label = m[1]; tag = m[2] }
  return { ...b, label, tag }
}
const CAT = { fpr: 'Rank', elo: 'Elo', longevity: 'Longevity', era: 'Era' }

function usePhone() {
  const q = '(max-width: 760px)'
  const [p, setP] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches)
  useEffect(() => { const m = matchMedia(q), h = () => setP(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h) }, [])
  return p
}

export default function PlayerModal({ player, allPlayers, onClose }) {
  const backdropRef = useRef(null)
  const handleKey = useCallback(e => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = '' }
  }, [handleKey])

  const name = player.name
  const [career, setCareer] = useState(undefined), [shots, setShots] = useState(null)
  useEffect(() => {
    let on = true
    setCareer(undefined)
    // A file from before the latest format (no monthly ranks) can still be in a browser or edge cache for a few minutes after a
    // rebuild: fetch past the cache once
    const url = `/data/careers/${shard(name)}.json`
    getJSON(url).then(d => {
      const c = d?.[name] || null
      if (c && (Array.isArray(c) || !c.m)) return getJSON(`${url}?t=${Math.floor(Date.now() / 6e4)}`).then(f => f?.[name] || c)
      return c
    }).then(c => on && setCareer(c))
    binderHeadshots().then(s => on && setShots(s))
    return () => { on = false }
  }, [name])
  const phone = usePhone()
  // All-time standing (scripts/build_alltime.py), with tonight's games counted
  const AT = useAllTime()
  const AL = useMemo(() => liveAllTime(AT, allPlayers), [AT, allPlayers])
  const atx = AL?.by.get(name)
  const atMove = atx ? (atx.pre && atx.active && atx.pre !== atx.rank ? `${atx.pre > atx.rank ? '▲' : '▼'}${Math.abs(atx.pre - atx.rank)} this season` : atx.active ? 'no change this season' : atx.years) : ''

  const hist = player.elo_history || []
  // A career file is {s: seasons, d: decades, m: monthly ranks} (older files were a bare list of seasons)
  const cs = Array.isArray(career) ? career : career?.s
  const seasons = useMemo(() => cs || seasonsFromHistory(hist), [cs, hist])
  const decades = useMemo(() => (career && !Array.isArray(career) && career.d) || decadesFromHistory(hist), [career, hist])
  const full = !!cs // box scores and ranks
  const monthly = career && !Array.isArray(career) ? career.m : null
  const team = player.team, info = tInfo(team), color = tColor(team)
  const y1 = hist[0]?.[0]?.slice(0, 4), y2 = hist.at(-1)?.[0]?.slice(0, 4)
  const active = player.last_played && (Date.now() - Date.parse(player.last_played)) / 864e5 < 400
  const years = !y1 ? '' : active ? `${y1}–present` : y1 === y2 ? y1 : `${y1}–${y2}`
  const avgElo = hist.length ? Math.round(hist.reduce((s, x) => s + x[1], 0) / hist.length) : Math.round(player.current_elo)
  const peakRank = 1 + (allPlayers || []).filter(p => p.peak_elo > player.peak_elo).length
  const ranked = seasons.filter(s => s.g >= 20)
  const bestSeason = (ranked.length ? ranked : seasons).reduce((a, b) => (b.av > a.av ? b : a), seasons[0])
  const jump = seasons.slice(1).reduce((a, b) => (!a || b.en - b.st > a.en - a.st ? b : a), null)
  const bestGame = full ? seasons.filter(s => s.b).map(s => s.b).reduce((a, b) => (!a || b.gs > a.gs ? b : a), null) : null
  const mostPts = full ? seasons.filter(s => s.h).map(s => s.h).reduce((a, b) => (!a || b.pts > a.pts ? b : a), null) : null
  const src = shots?.[norm(name)]?.headshot
  const logo = binderLogo(team)
  const seal = active && player.is_fpr_eligible && player.fpr_rank <= 99 ? { top: 'FPR', n: `#${player.fpr_rank}`, sub: 'today' } : peakRank <= 99 ? { top: 'Peak', n: `#${peakRank}`, sub: 'all-time' } : null
  // Badges from data built before v185 (day counts at No. 1, the streak, today's rank) are left off: the card shows today's rank live
  const medals = (player.badges || []).filter(b => b.cat !== 'era' && b.id !== 'streak_at_1' && !b.id.startsWith('current_') && !(b.id === 'games_at_1' && b.label.includes('×'))).map(medalOf)

  return (
    <div ref={backdropRef} className={styles.back} onClick={e => e.target === backdropRef.current && onClose()} role="dialog" aria-modal="true" aria-label={`${name} career`} data-m="pm-back">
      <div className={styles.card} style={{ '--team': color }} data-m="pm-box">
        <button type="button" className={styles.x} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.hero}>
          <div className={styles.hs}>
            {src ? <img src={src} alt="" onError={e => { e.currentTarget.style.display = 'none' }} /> : null}
            <b className={styles.ini}>{initials(name)}</b>
            <TeamChip team={team} logo={logo} title={info.name || team} />
          </div>
          <div className={styles.who}>
            <div className={styles.kick}>{info.name || team}{years ? ` · ${years}` : ''}</div>
            <h2 className={styles.nm}>{name}</h2>
            <div className={styles.sub}><b>{fmt(player.games_played)}</b> games{player.career_gmsc_avg != null && <> · career GmSc <b>{player.career_gmsc_avg}</b></>}{player.last_played && <> · last played {md(player.last_played, !active)}</>}</div>
          </div>
          {seal && <div className={styles.seal}><span><small>{seal.top}</small><b>{seal.n}</b><small>{seal.sub}</small></span></div>}
        </div>

        <div className={`${styles.tiles} ${atx ? styles.five : ''}`}>
          {atx && <div className={styles.atTile}><small>All-time{atx.live ? ' · live' : ''}</small><b><AtFoil r={atx.rank} className={styles.atChip}>#{atx.rank.toLocaleString()}</AtFoil></b><em>score {atx.score.toFixed(1)} · {atMove}</em></div>}
          <div><small>{active ? (player.live ? 'Current Elo · live' : 'Current Elo') : 'Final Elo'}</small><b>{fmt(player.current_elo)}</b>
            <em>{active ? (player.is_fpr_eligible ? `#${player.fpr_rank} in the league` : `#${player.current_tpr_rank} rated · not enough recent games`) : `last game ${md(player.last_played)}`}</em></div>
          <div><small>Peak Elo</small><b className={styles.gold}>{fmt(player.peak_elo)}</b><em>#{peakRank} highest ever</em></div>
          <div><small>Career average</small><b>{fmt(avgElo)}</b><em>every rated game</em></div>
          <div><small>Best season</small><b>{bestSeason?.s || '—'}</b><em>{bestSeason ? `${fmt(bestSeason.av)} avg${bestSeason.rk ? ` · #${bestSeason.rk}` : ''}` : ''}</em></div>
        </div>

        <section className={styles.sec}>
          <Trajectory hist={hist} monthly={monthly} seasons={seasons} name={name} />
        </section>

        {atx && AL && <section className={styles.sec}>
          <Head right={<span className={styles.dim}>of {AT.players.length.toLocaleString()} players</span>}>All-time</Head>
          <AllTimeProfile x={atx} L={AL} AT={AT} players={allPlayers} />
        </section>}

        {(medals.length > 0 || bestGame || jump) && <section className={`${styles.sec} ${styles.two}`}>
          {medals.length > 0 && <div>
            <Head>Badges</Head>
            <div className={styles.medals}>{medals.map(b => (
              <div key={b.id} className={styles.md} data-c={b.cat} title={b.label}>
                <div className={styles.disc}><span>{b.emoji}</span>{b.tag && <b>{b.tag}</b>}</div>
                <span>{b.label}</span><small>{CAT[b.cat] || ''}</small>
              </div>))}</div>
          </div>}
          <div>
            <Head>Career highs</Head>
            <div className={styles.facts}>
              {bestGame && <Fact icon="🎯" title={`Best game: ${bestGame.gs} GmSc`} sub={`${bestGame.pts} pts, ${bestGame.trb} reb, ${bestGame.ast} ast vs ${bestGame.o} · ${md(bestGame.d)}${bestGame.p ? ' · playoffs' : ''}`} />}
              {mostPts && <Fact icon="💥" title={`Career high: ${mostPts.pts} points`} sub={`vs ${mostPts.o} · ${md(mostPts.d)}${mostPts.p ? ' · playoffs' : ''}`} />}
              {bestSeason && <Fact icon="📈" title={`Best season: ${bestSeason.s}`} sub={`${fmt(bestSeason.av)} average Elo${bestSeason.rk ? ` · finished #${bestSeason.rk}` : ''}`} />}
              {jump && jump.en > jump.st && <Fact icon="🚀" title={`Biggest jump: ${jump.s}`} sub={`▲${fmt(jump.en - jump.st)} Elo${jump.rk && prevRank(seasons, jump) ? ` · #${prevRank(seasons, jump)} to #${jump.rk}` : ''}`} />}
            </div>
          </div>
        </section>}

        {decades.length > 0 && <section className={styles.sec}>
          <Head>By decade</Head>
          <div className={styles.decades}>{decades.map(d => <Decade key={d.d} d={d} />)}</div>
          {decades.some(d => d.pr) && <p className={styles.note}>Average rank: among players with 82+ rated games that decade. Peak rank: among everyone who played in it. Seasons count toward the decade they started in.</p>}
        </section>}

        <section className={styles.sec}>
          <Head>Year by year</Head>
          <TierKey />
          {phone ? <SeasonHeat seasons={seasons} full={full} decades={decades} /> : <SeasonTable seasons={seasons} full={full} decades={decades} />}
          <p className={styles.note}>{full ? <>Ranks: among players with 20+ rated games that season, by the Elo he ended it with, his peak and his average.{seasons.at(-1)?.now ? ` ${seasons.at(-1).s} is in progress: its ranks are among players with ${seasons.at(-1).rmin}+ games so far, and End is where he stands now.` : ''} GP and per-game numbers: regular season.</> : 'Ranks and box scores fill in after tonight’s update.'}</p>
        </section>
      </div>
    </div>
  )
}

function TeamChip({ team, logo, title }) {
  const [bad, setBad] = useState(false)
  return <span className={styles.tchip} title={title}>{logo && !bad ? <img src={logo} alt="" onError={() => setBad(true)} /> : team}</span>
}
const prevRank = (seasons, s) => { const i = seasons.indexOf(s); return i > 0 ? seasons[i - 1].rk : null }
const Head = ({ children, right }) => <div className={styles.sh}><h3>{children}</h3><i />{right}</div>
const Fact = ({ icon, title, sub }) => <div className={styles.fact}><i>{icon}</i><b>{title}</b><small>{sub}</small></div>
const Team = ({ t }) => <span className={styles.tm} style={{ background: tColor(t) }}>{t}</span>
// A rank in its card foil
const Foil = ({ r, className = '', children, title }) => <span className={`${styles.f} ${className}`} data-t={tierOf(r)} title={title}>{children ?? (r ? `#${r}` : '—')}</span>
const TierKey = () => <div className={styles.key}>{TIERS.map(([t, l, r]) => <span key={t} className={styles.f} data-t={t}><b>{l}</b><small>{r}</small></span>)}</div>

function Decade({ d }) {
  return (
    <div className={styles.dec} data-top={d.ar === 1 || d.pr === 1 ? '' : undefined}>
      <b className={styles.decName}>{d.d}s</b>
      <span className={styles.decSub}>{d.n} season{d.n === 1 ? '' : 's'} · {fmt(d.g)} games</span>
      <div className={styles.decRow}><small>Average</small><b>{fmt(d.av)}</b>{d.ar && <Foil r={d.ar} className={styles.chip} title={d.an ? `of ${d.an.toLocaleString()}` : undefined} />}</div>
      <div className={styles.decRow}><small>Peak</small><b>{fmt(d.pk)}</b>{d.pr && <Foil r={d.pr} className={styles.chip} title={d.pn ? `of ${d.pn.toLocaleString()}` : undefined} />}</div>
    </div>
  )
}
const bestText = g => (g ? <><b>{g.pts} pts</b> vs {g.o}, {md(g.d, false)}{g.p ? ' (playoffs)' : ''}</> : '—')

// Newest season first, with the decade rows and any seasons he missed in the middle of his career
function ledger(seasons, decades) {
  const dmap = new Map(decades.map(d => [d.d, d])), out = []
  let prevY = null, cur = null
  for (const se of [...seasons].reverse()) {
    const y = +se.s.slice(0, 4)
    if (prevY != null) for (let k = prevY - 1; k > y; k--) { const dk = Math.floor(k / 10) * 10; if (dk !== cur) { cur = dk; dmap.get(dk) && out.push({ dec: dmap.get(dk) }) } out.push({ gap: `${k}-${String(k + 1).slice(2)}` }) }
    const dk = decOf(se)
    if (dk !== cur) { cur = dk; dmap.get(dk) && out.push({ dec: dmap.get(dk) }) }
    out.push({ se })
    prevY = y
  }
  return out
}
const DecLine = ({ d }) => <>{d.d}s <span className={styles.dim}>· {d.n} season{d.n === 1 ? '' : 's'} · {fmt(d.g)} games{d.ar || d.pr ? '' : ` · average ${fmt(d.av)} · peak ${fmt(d.pk)}`}</span>
  {d.ar && <> <Foil r={d.ar} className={styles.mini}>Avg #{d.ar}</Foil></>}{d.pr && <> <Foil r={d.pr} className={styles.mini}>Peak #{d.pr}</Foil></>}</>

// Phone: the ranks as foil blocks (end, peak, average), the Elo under each; tap a season for its box-score line
function SeasonHeat({ seasons, full, decades }) {
  const rows = ledger(seasons, decades)
  const [open, setOpen] = useState(null)
  return (
    <table className={styles.hm}>
      <thead><tr><th>Season</th><th>End</th><th>Peak</th><th>Average</th></tr></thead>
      <tbody>{rows.map((r, i) => {
        if (r.dec) return <tr key={`d${r.dec.d}`} className={styles.hdec}><td colSpan={4}><DecLine d={r.dec} /></td></tr>
        if (r.gap) return <tr key={r.gap} className={styles.miss}><td className={styles.hs0}><b>{r.gap}</b></td><td colSpan={3}>didn’t play</td></tr>
        const s = r.se, on = open === s.s
        const cell = (rk, v) => <td><Foil r={rk} className={styles.cell}><b>{rk ? `#${rk}` : '—'}</b><small>{fmt(v)}</small></Foil></td>
        return [
          <tr key={s.s} className={styles.hrow} onClick={() => full && setOpen(on ? null : s.s)} aria-expanded={full ? on : undefined}>
            <td className={styles.hs0}><b>{s.s}</b><small>{full ? s.gp || s.g : s.g} GP · {s.t.at(-1)}</small>{s.now && <em className={styles.sofar}>so far</em>}</td>
            {cell(s.rk, s.en)}{cell(s.pr, s.pk)}{cell(s.ar, s.av)}
          </tr>,
          on && <tr key={`${s.s}x`} className={styles.hx}><td colSpan={4}>
            <span>{s.t.map(t => <Team key={t} t={t} />)}</span>
            {s.pts != null && <span><b>{s.pts}</b> pts · <b>{s.trb}</b> reb · <b>{s.ast}</b> ast · GmSc <b>{s.gs}</b></span>}
            {s.b && <span>Best game: {bestText(s.b)}</span>}
          </td></tr>,
        ]
      })}</tbody>
    </table>
  )
}

// Desktop: the full ledger, ranks as foil chips
function SeasonTable({ seasons, full, decades }) {
  const rows = ledger(seasons, decades), cols = full ? 11 : 8
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr className={styles.grpRow}><th colSpan={4} /><th colSpan={2} className={styles.grp}>Peak</th><th colSpan={2} className={styles.grp}>Average</th>{full && <th colSpan={3} className={styles.bl} />}</tr>
          <tr><th className={styles.l}>Season</th><th className={styles.l}>Team</th><th>{full ? 'GP' : 'Games'}</th><th>End rank</th><th className={styles.bl}>Elo</th><th>Rank</th><th className={styles.bl}>Elo</th><th>Rank</th>{full && <><th className={styles.bl}>Pts / Reb / Ast</th><th>GmSc</th><th className={styles.l}>Best game</th></>}</tr>
        </thead>
        <tbody>{rows.map(r => {
          if (r.dec) return <tr key={`d${r.dec.d}`} className={styles.decTr}><td colSpan={cols}><DecLine d={r.dec} /></td></tr>
          if (r.gap) return <tr key={r.gap} className={styles.miss}><td className={styles.l}><b>{r.gap}</b></td><td className={styles.l} colSpan={cols - 1}>didn’t play</td></tr>
          const s = r.se
          return (
            <tr key={s.s}>
              <td className={`${styles.l} ${styles.s}`}>{s.s}{s.now && <em className={styles.sofar}>so far</em>}</td>
              <td className={styles.l}><span className={styles.tms}>{s.t.map(t => <Team key={t} t={t} />)}</span></td>
              <td title={full ? `${s.g} rated games, playoffs included` : undefined}>{full ? s.gp || s.g : s.g}</td>
              <td><Foil r={s.rk} className={styles.chip} title={s.rn ? `of ${s.rn}` : undefined} /></td>
              <td className={`${styles.bl} ${styles.w}`}>{fmt(s.pk)}</td><td><Foil r={s.pr} className={styles.chip} /></td>
              <td className={`${styles.bl} ${styles.w}`}>{fmt(s.av)}</td><td><Foil r={s.ar} className={styles.chip} /></td>
              {full && <><td className={styles.bl}>{s.pts != null ? `${s.pts} / ${s.trb} / ${s.ast}` : '—'}</td><td>{s.gs ?? '—'}</td><td className={`${styles.l} ${styles.bg}`}>{bestText(s.b)}</td></>}
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

// Where he ranked among active players at each month's end (No. 1 at the top, a log scale down to 500), shaded by card tier, with
// a dot at each season's final rank; or his Elo. His teams run in a strip underneath. Hover or touch for the month.
const RMAX = 500
// the chart's tier bands, from the card tiers (each band runs to half a rank past its tier's last rank)
const BANDS = CARD_TIERS.map((t, i) => [i ? CARD_TIERS[i - 1].max + 0.5 : 1, t.max === Infinity ? 500 : t.max + (i ? 0.5 : 0.45), t.id])
const monthEnd = (f, k) => { const y = +f.slice(0, 4), m = +f.slice(5, 7) - 1 + k; return new Date(Date.UTC(y + Math.floor(m / 12), (m % 12) + 1, 0)).toISOString().slice(0, 10) }
function Trajectory({ hist, monthly, seasons, name }) {
  const wrap = useRef(null), [w, setW] = useState(0), [mode, setMode] = useState('rank'), [tip, setTip] = useState(null)
  useEffect(() => {
    const el = wrap.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width))); ro.observe(el); return () => ro.disconnect()
  }, [])
  const view = monthly ? mode : 'elo'
  const H = w < 500 ? 250 : 300, pl = 40, pr = w < 500 ? 12 : 64, pt = 14, pb = 50
  const geo = useMemo(() => {
    if (!hist.length || !w) return null
    const t0 = Date.parse(hist[0][0]) - 40 * 864e5, t1 = Date.parse(hist.at(-1)[0]) + 25 * 864e5
    const X = d => pl + ((Date.parse(d) - t0) / (t1 - t0)) * (w - pl - pr), plotB = H - pb
    const eloAt = d => { let lo = 0, hi = hist.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (hist[m][0] <= d) { k = m; lo = m + 1 } else hi = m - 1 } return k < 0 ? null : hist[k] }
    // team stints for the strip
    const stints = []
    for (const x of hist) { if (!stints.length || stints.at(-1).t !== x[4]) stints.push({ t: x[4], a: x[0], b: x[0] }); stints.at(-1).b = x[0] }
    const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), span = y1 - y0
    const stepY = [1, 2, 3, 5, 10].find(s => span / s <= (w - pl - pr) / 46) || 10
    const years = []; for (let y = Math.ceil((y0 + 1) / stepY) * stepY; y <= y1; y += stepY) years.push(y)
    if (view === 'rank') {
      const Y = r => pt + (Math.log(Math.min(r, RMAX)) / Math.log(RMAX)) * (plotB - pt)
      const pts = monthly.r.map((r, k) => ({ d: monthEnd(monthly.f, k), r })).filter(p => Date.parse(p.d) >= t0 - 31 * 864e5)
      const runs = []
      let cur = null
      for (const p of pts) { if (!p.r) { cur = null; continue } if (!cur) runs.push(cur = []); cur.push(p) }
      // each season's final rank, at his last active month of that season
      const dots = seasons.filter(s => s.rk).map(s => { const y = +s.s.slice(0, 4), last = pts.filter(p => p.r && p.d > `${y}-08-01` && p.d < `${y + 1}-08-01`).at(-1); return last ? { d: last.d, r: s.rk, s: s.s } : null }).filter(Boolean)
      const best = pts.filter(p => p.r).reduce((a, p) => (!a || p.r < a.r ? p : a), null)
      return { X, Y, runs, dots, best, pts: pts.filter(p => p.r), stints, years, plotB, eloAt }
    }
    let lo = Math.min(...hist.map(x => x[1])), hi = Math.max(...hist.map(x => x[1]))
    lo = Math.floor((lo - 60) / 100) * 100; hi = Math.ceil((hi + 60) / 100) * 100
    const Y = v => pt + (1 - (v - lo) / (hi - lo)) * (plotB - pt)
    const step = Math.max(1, Math.floor(hist.length / (w - pl - pr)))
    const pkI = hist.reduce((a, x, i) => (x[1] > hist[a][1] ? i : a), 0)
    const pts = hist.filter((x, i) => i % step === 0 || i === pkI || i === hist.length - 1)
    const grid = []; for (let v = Math.ceil(lo / 200) * 200; v <= hi; v += 200) grid.push(v)
    return { X, Y, pts, pk: hist[pkI], grid, stints, years, plotB, eloAt, lo, hi }
  }, [hist, monthly, seasons, w, view, H, pr])
  const move = e => {
    if (!geo) return
    const rc = e.currentTarget.getBoundingClientRect(), cx = ((e.touches?.[0] || e).clientX - rc.left) * (w / rc.width)
    let best = null, bd = 1e9
    for (const p of geo.pts) { const d = Math.abs(geo.X(p.d || p[0]) - cx); if (d < bd) { bd = d; best = p } }
    if (!best) return
    if (view === 'rank') { const h = geo.eloAt(best.d); setTip({ x: geo.X(best.d), y: geo.Y(best.r), when: new Date(`${best.d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), r: best.r, e: h?.[1], t: h?.[4] }) }
    else setTip({ x: geo.X(best[0]), y: geo.Y(best[1]), when: md(best[0]), e: best[1], t: best[4] })
  }
  const line = P => `M${P.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}`
  const tierLab = { goat: 'GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare', common: 'Common' }
  return (
    <>
      <Head right={monthly && <span className={styles.seg} role="group" aria-label="Show">{[['rank', 'Rank'], ['elo', 'Elo']].map(([v, l]) => <button key={v} type="button" data-on={view === v ? '' : undefined} aria-pressed={view === v} onClick={() => { setMode(v); setTip(null) }}>{l}</button>)}</span>}>{view === 'rank' ? 'Where he ranked' : 'Career Elo'}</Head>
      <div className={styles.chart} ref={wrap}>
        {geo && <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} onMouseMove={move} onTouchMove={move} onMouseLeave={() => setTip(null)} role="img" aria-label={view === 'rank' ? `${name}'s rank among active players, month by month` : `${name}'s Elo over his career`}>
          <defs><linearGradient id="pmIcon" x1="0" x2="1"><stop offset="0" stopColor="#ff2d95" /><stop offset=".25" stopColor="#ffd32d" /><stop offset=".5" stopColor="#2dffb4" /><stop offset=".75" stopColor="#2d9bff" /><stop offset="1" stopColor="#b42dff" /></linearGradient></defs>
          {view === 'rank' ? <>
            {BANDS.map(([a, b, t]) => <rect key={t} x={pl} y={geo.Y(a)} width={w - pl - pr} height={geo.Y(b) - geo.Y(a)} className={styles[`b_${t}`]} fill={t === 'icon' ? 'url(#pmIcon)' : undefined} />)}
            {[1, 5, 20, 50, 125, 250, 500].map(r => <g key={r}><line x1={pl} x2={w - pr} y1={geo.Y(r)} y2={geo.Y(r)} className={r === 1 ? styles.g1 : styles.gl} /><text x={pl - 6} y={geo.Y(r) + 3.5} textAnchor="end" className={styles.ax}>#{r}</text></g>)}
            {pr > 30 && BANDS.map(([a, b, t]) => <text key={t} x={w - pr + 6} y={(geo.Y(a) + geo.Y(Math.min(b, RMAX))) / 2 + 3.5} className={`${styles.bl_} ${styles[`bt_${t}`]}`}>{tierLab[t]}</text>)}
            {geo.runs.map((R, i) => <path key={i} d={line(R.map(p => [geo.X(p.d), geo.Y(p.r)]))} className={styles.rline} />)}
            {geo.dots.map(d => <circle key={d.s} cx={geo.X(d.d)} cy={geo.Y(d.r)} r={3.6} className={`${styles.dot} ${styles[`d_${tierOf(d.r)}`]}`}><title>{`${d.s}: finished #${d.r}`}</title></circle>)}
          </> : <>
            {geo.grid.map(v => <g key={v}><line x1={pl} x2={w - pr} y1={geo.Y(v)} y2={geo.Y(v)} className={styles.gl} /><text x={pl - 6} y={geo.Y(v) + 3} textAnchor="end" className={styles.ax}>{v}</text></g>)}
            <path d={line(geo.pts.map(x => [geo.X(x[0]), geo.Y(x[1])]))} className={styles.rline} />
            <circle cx={geo.X(geo.pk[0])} cy={geo.Y(geo.pk[1])} r={4.5} className={styles.pkDot} />
            <text x={geo.X(geo.pk[0]) + (geo.X(geo.pk[0]) > w * 0.6 ? -8 : 8)} y={Math.max(11, geo.Y(geo.pk[1]) - 8)} textAnchor={geo.X(geo.pk[0]) > w * 0.6 ? 'end' : 'start'} className={styles.pkTxt}>Peak {fmt(geo.pk[1])} · {md(geo.pk[0])}</text>
          </>}
          {geo.stints.map((s, i) => { const a = geo.X(s.a), b = Math.max(a + 3, geo.X(s.b)); return <g key={i}><rect x={a} y={geo.plotB + 8} width={b - a} height={18} rx={3} fill={tColor(s.t)} className={styles.stint} />{b - a > 34 && <text x={(a + b) / 2} y={geo.plotB + 21} textAnchor="middle" className={styles.stTxt}>{s.t}</text>}</g> })}
          {geo.years.map(y => <text key={y} x={geo.X(`${y}-01-01`)} y={H - 6} textAnchor="middle" className={styles.ax}>{geo.years.length > 8 ? `’${String(y).slice(2)}` : y}</text>)}
          {tip && <g><line x1={tip.x} x2={tip.x} y1={pt - 4} y2={geo.plotB} className={styles.cross} /><circle cx={tip.x} cy={tip.y} r={4} fill="#fff" stroke="#0b121d" strokeWidth={1.5} /></g>}
        </svg>}
        {tip && <div className={styles.tip} style={{ left: tip.x, top: tip.y }} data-r={tip.x > w * 0.62 ? '' : undefined}><b>{tip.when}</b>{tip.r && <span>Ranked <em>#{tip.r}</em></span>}{tip.e != null && <span>Elo {fmt(tip.e)}</span>}{tip.t && <span>{tInfo(tip.t).name || tip.t}</span>}</div>}
        {view === 'rank' && geo && <div className={styles.legend}>{geo.best && <span className={styles.bestTxt}>Best: #{geo.best.r}, first in {new Date(`${geo.best.d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>}<span><i className={styles.lDot} />Season’s final rank</span><span>Ranked among players active in the last 250 days</span></div>}
        {!monthly && <div className={styles.legend}><span>His month-by-month rank arrives with tonight’s update.</span></div>}
      </div>
    </>
  )
}
