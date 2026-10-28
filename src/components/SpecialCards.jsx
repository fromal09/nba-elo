import { useState, useRef, useLayoutEffect, useMemo, useEffect as useEffect_ } from 'react'
import styles from './SpecialCards.module.css'
import { binderSeasonSummary, binderCareerPath, binderPeaks, binderHistory, binderHeadshots } from './SeasonExplorer'

/*
 * Special cards, each drawn at 340 × 476 like MiniCard and DuelCard:
 *   PeakCard     a player's career-high Elo (after his rookie year): one reigning Peak per career. Each earlier
 *                career high he carried out of a season is a Former Peak, with the dates it stood. All are pullable;
 *                when he climbs higher, the reigning card becomes a Former Peak (its points stay).
 *   SeasonCard   a player's season with one team, forged by owning his games: a mosaic of tiles, one per game,
 *                each cleared by owning that game's card. Fully revealed at 100%.
 *   RivalryCard  two players' career head-to-head in Game Score duels (random pull).
 *   FiveCard     a team's best single-day five: the five highest pre-game Elo players who played that day (random pull).
 *   PotwCard     Player of the Week: the NBA's best player of a week, a numbered gold superfractor for that week's
 *                pick'em winner (k of n when a tie shares it). The back names the winner(s) and their week of picks.
 *   Serial       the "#k of n" tab: your copy's order among everyone who owns the card.
 */

const r0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const f1 = v => (v == null ? '—' : (+v).toFixed(1))
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const split = n => { const [f, ...r] = baseName(n).split(' '); return { first: f, last: r.join(' ') || f } }
const initials = n => baseName(n).split(' ').map(w => w[0]).slice(0, 2).join('')
const AP = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']
const ap = d => `${AP[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`
const nick = n => (/Trail Blazers$/.test(n || '') ? 'Trail Blazers' : (n || '').split(' ').pop())

function useFit(ref, max, min, dep) {
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const fit = () => { let s = max; el.style.fontSize = s + 'px'; while (el.scrollWidth > el.clientWidth + 1 && s > min) el.style.fontSize = --s + 'px' }
    fit(); document.fonts?.ready.then(fit)
  }, [dep, max, min])
}

function FitName({ children, max = 22, min = 13 }) {
  const ref = useRef(null)
  useFit(ref, max, min, children)
  return <b ref={ref}>{children}</b>
}

// A rivalry with the leader first: the side with more duel wins
export function leaderFirst(r) {
  if (r.w >= r.l) return r
  const n = r.w + r.l
  return { ...r, a: r.b, b: r.a, ac: r.bc, bc: r.ac, at: r.bt, bt: r.at, teamsA: r.teamsB, teamsB: r.teamsA, peakA: r.peakB, peakB: r.peakA, w: r.l, l: r.w, xw: Math.round((n - r.xw) * 10) / 10,
    seasons: r.seasons.map(x => ({ ...x, w: x.l, l: x.w, xw: x.w + x.l - x.xw })), teamW: r.games - r.teamW, poW: r.po - r.poW, bestA: r.bestB, bestB: r.bestA,
    ...(r.bestA ? { bestA: flipDuel(r.bestB), bestB: flipDuel(r.bestA) } : {}) }
}
const flipDuel = x => ({ ...x, ag: x.bg, bg: x.ag, ap: x.bp, bp: x.ap, aw: !x.aw })

function Medal({ name, headshot, color, size, cls }) {
  const [bad, setBad] = useState(false)
  return (
    <span className={`${styles.medal} ${cls || ''}`} style={{ '--c': color || '#173657', width: size, height: size }}>
      {headshot && !bad ? <img src={headshot} alt="" onError={() => setBad(true)} /> : <i style={{ fontSize: size * 0.42 }}>{initials(name)}</i>}
    </span>
  )
}

// An Elo path as a filled ridge: [elo, ...] scaled into w × h
function ridge(path, w, h, lo, hi) {
  const n = path.length - 1 || 1
  const y = v => h - ((v - lo) / (hi - lo || 1)) * h
  const pts = path.map((v, i) => [(i / n) * w, y(v)])
  return { line: pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join(''), last: pts[pts.length - 1], y }
}

// ── Peak ─────────────────────────────────────────────────────────────────────
export function PeakCard({ card, team, headshot, status = 'reigning', peakNo, of, until, next, path, pathAll, serial }) {
  const { first, last } = split(card.row.n)
  const ref = useRef(null)
  useFit(ref, 46, 22, card.row.n)
  const former = status === 'former'
  const W = 316, H = 118
  const all = pathAll || path
  const lo = Math.min(...all) - 40, hi = Math.max(...all) + 30
  const R = ridge(path, former && pathAll ? W * (path.length / pathAll.length) : W, H, lo, hi)
  // The climb that topped it: the rest of the career, from this peak on
  const RA = former && pathAll ? (() => { const i0 = Math.min(pathAll.length - 1, Math.round((path.length / pathAll.length) * (pathAll.length - 1))); const x0 = W * (path.length / pathAll.length)
    const rest = ridge(pathAll.slice(i0), W - x0, H, lo, hi); return { line: rest.line.replace(/([ML])([\d.]+),/g, (m, c, x) => `${c}${(+x + x0).toFixed(1)},`) } })() : null
  const where = card.home === false ? '@' : 'vs'
  return (
    <div className={styles.peak} data-status={status} style={{ '--c': team?.color || card.tc || '#173657' }}>
      <div className={styles.peakHead}><span>Peak</span><small>{former ? 'Former career high' : 'Career-high Elo'}</small></div>
      <div className={styles.peakBody}>
        <div className={styles.peakSky} />
        <div className={styles.peakNo}><b>{card.s}</b><small>{nick(card.tn)}</small></div>
        <Medal name={card.row.n} headshot={headshot} color={team?.color || card.tc} size={92} cls={styles.peakMedal} />
        <div className={styles.peakElo}><b>{r0(card.row.post)}</b><small>Elo · {card.s}</small></div>
        <svg className={styles.peakRidge} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`pk-${status}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          </defs>
          {RA && <path d={RA.line} className={styles.peakLater} />}
          <path d={`${R.line}L${R.last[0]},${H}L0,${H}Z`} fill={`url(#pk-${status})`} />
          <path d={R.line} className={styles.peakLine} />
          <line x1="0" x2={W} y1={R.last[1]} y2={R.last[1]} className={styles.peakRule} />
          <g transform={`translate(${R.last[0]},${R.last[1]})`}>
            <line y1="0" y2="-22" className={styles.peakPole} />
            <path d="M0,-22 L13,-17.5 L0,-13 Z" className={styles.peakFlag} />
            <circle r="3.4" className={styles.peakDot} />
          </g>
        </svg>
        <div className={styles.peakName}><small>{first}</small><b ref={ref}>{last}</b></div>
        <div className={styles.peakGame}>
          <span>{ap(card.date)} {where} {card.o}</span>
          <em className={card.won ? styles.won : ''}>{card.won ? 'W' : 'L'} {card.score}</em>
        </div>
        <div className={styles.peakStats}>
          <div><b>{card.row.pts}</b><small>PTS</small></div><div><b>{card.row.trb}</b><small>REB</small></div>
          <div><b>{card.row.ast}</b><small>AST</small></div><div><b>{f1(card.row.gs)}</b><small>GmSc</small></div>
        </div>
        {former && <div className={styles.peakStamp}>Surpassed{next ? ` · +${r0(next - card.row.post)}` : ''}</div>}
      </div>
      <div className={styles.peakFoot}>{former
        ? <><span>Former Peak</span><span>{ap(card.date)} – {ap(until)}</span></>
        : <><span>★ Reigning Peak</span><span>{nick(card.tn)} · {card.s}</span></>}{serial}</div>
    </div>
  )
}

// ── Season ───────────────────────────────────────────────────────────────────
// owned: a Set of game indexes (0-based, in game order) you own; full reveal when every game is owned
// A Season card's foil is the tier of where he finished: his final Elo rank, on the same scale as game cards
const SEASON_TIERS = [['goat', 1], ['icon', 5], ['legend', 20], ['standout', 50], ['rare', 125]]
export const seasonTier = rank => (rank ? (SEASON_TIERS.find(([, top]) => rank <= top) || ['common'])[0] : 'common')
const ORD = n => ['1st', '2nd', '3rd'][n - 1] || `${n}th`
const lgName = (s, h) => (h?.aba ? 'All-ABA' : +s.s.slice(0, 4) < 1949 ? 'All-BAA' : 'All-NBA')
// "All-Star · All-NBA 1st · MVP"
export const honorList = s => { const h = s.honors; if (!h) return []
  return [h.mvp && (h.aba ? 'ABA MVP' : 'MVP'), h.allNba && `${lgName(s, h)} ${ORD(h.allNba)}`, h.allStar && (h.aba ? 'ABA All-Star' : 'All-Star')].filter(Boolean) }
// Laurel for an MVP season: two branches of leaves around the medal
function Laurel({ size = 124 }) {
  const c = size / 2, r = size / 2 - 8
  const leaves = []
  const leaf = (deg, k, side) => {
    const t = deg * Math.PI / 180, x = c + r * Math.cos(t), y = c + r * Math.sin(t)
    leaves.push(<ellipse key={k} cx={x} cy={y} rx="3.6" ry="8.5" transform={`rotate(${deg + side * 14} ${x} ${y})`} />)
  }
  for (let i = 0; i < 10; i++) { leaf(108 + i * 13, `l${i}`, 1); leaf(72 - i * 13, `r${i}`, -1) }
  return <svg className={styles.laurel} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    {leaves}<path d={`M${c - 7},${c + r + 3} Q${c},${c + r - 3} ${c + 7},${c + r + 3}`} fill="none" stroke="#f5d77a" strokeWidth="2.4" strokeLinecap="round" /></svg>
}

export function SeasonCard({ s, owned, headshot, serial }) {
  const { first, last } = split(s.name)
  const ref = useRef(null)
  useFit(ref, 50, 24, s.name)
  const N = s.gp, have = owned ? owned.size : N
  const done = have >= N
  const cols = 9, rows = Math.ceil(N / cols), cells = cols * rows
  const W = 292, H = 74
  const lo = Math.min(...s.path) - 30, hi = Math.max(...s.path) + 20
  const R = ridge(s.path, W, H, lo, hi)
  const best = s.best
  const po = s.po, champ = po?.champ
  const tier = s.tier || seasonTier(s.rank)
  const H_ = s.honors || {}, nba = H_.allNba || 0
  return (
    <div className={styles.season} data-tier={tier} data-done={done ? '' : undefined} data-champ={champ ? '' : undefined}
      data-allstar={H_.allStar ? '' : undefined} data-allnba={nba || undefined} data-mvp={H_.mvp ? '' : undefined} style={{ '--c': s.tc || '#173657' }}>
      <div className={styles.seasonHead}><span>{H_.mvp ? 'MVP' : champ ? 'Champions' : 'Season'}</span><small>{s.s} · {nick(s.tn)}</small></div>
      {po && <div className={styles.seasonPo} data-champ={champ ? '' : undefined}>{champ ? <>★ {+s.s.slice(0, 4) + 1} NBA champions <b>{po.w}–{po.l}</b></>
        : <>Playoffs · {poResult(po)}{po.series.length > 1 && <b>· {po.w}–{po.l}</b>}</>}</div>}
      <div className={styles.seasonBody}>
        <div className={styles.seasonBg} />
        <div className={styles.seasonFoil} />
        {H_.allStar && <div className={styles.seasonStars} />}
        {nba > 0 && <div className={styles.seasonPins} />}
        {H_.mvp && <div className={styles.seasonRays} />}
        <div className={styles.seasonTop}>
          {H_.mvp && <Laurel />}
          <Medal name={s.name} headshot={headshot} color={s.tc} size={86} cls={styles.seasonMedal} />
          {nba > 0 && <span className={styles.nbaShield} data-team={nba} title={`${lgName(s, H_)} ${ORD(nba)} Team`}><small>{lgName(s, H_)}</small><b>{ORD(nba)}</b></span>}
          {H_.allStar && <span className={styles.starBadge} title="All-Star">★<small>All-Star</small></span>}
          <div className={styles.seasonRec}><FitName max={44} min={26}>{`${s.w}–${s.l}`}</FitName><small>{nick(s.tn)}</small></div>
          <div className={styles.seasonRank} data-long={s.rank >= 100 ? '' : undefined}><small>Final rank</small><b>{s.rank ? `#${s.rank}` : '—'}</b><em>{tier === 'goat' ? '★ GOAT' : tier}</em></div>
        </div>
        <div className={styles.seasonName}><small>{first}</small><b ref={ref}>{last}</b></div>
        <div className={styles.seasonChart}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={`${R.line}L${W},${H}L0,${H}Z`} className={styles.seasonFill} />
            <path d={R.line} className={styles.seasonLine} />
          </svg>
          <div className={styles.seasonAxis}><span>Elo {r0(s.start)}</span><span>peak {r0(s.peak)}</span><span>{r0(s.end)}</span></div>
        </div>
        <div className={styles.seasonStats}>
          <div><b>{f1(s.pts)}</b><small>PPG</small></div><div><b>{f1(s.trb)}</b><small>RPG</small></div>
          <div><b>{f1(s.ast)}</b><small>APG</small></div><div><b>{f1(s.gs)}</b><small>GmSc</small></div><div><b>{s.gp}</b><small>Games</small></div>
        </div>
        <div className={styles.seasonBest}><small>Best game</small><span>{ap(best.date)} {best.home === false ? '@' : 'vs'} {best.o} · {best.row.pts} PTS · {f1(best.row.gs)} GmSc</span></div>
        {/* The mosaic: a tile per game, cleared by owning that game's card */}
        {!done && <div className={styles.mosaic} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
          {Array.from({ length: cells }, (_, c) => {
            const g = Math.min(N - 1, Math.floor((c * N) / cells))
            return <i key={c} className={owned.has(g) ? styles.tileOn : ''} />
          })}
        </div>}
      </div>
      <div className={styles.seasonFoot}>
        {done ? <><span>★ Season complete</span><span>{N} of {N} games</span>{serial}</>
          : <><span>{have} of {N} games · {Math.floor((have / N) * 100)}%</span><span className={styles.seasonBar}><em style={{ width: `${(have / N) * 100}%` }} /></span></>}
      </div>
    </div>
  )
}

// The round a playoff run ended in
const ROUND = { R1: 'first round', R2: 'second round', 'Conf. Finals': 'conference finals', Finals: 'NBA Finals' }
const roundOf = x => ROUND[(x.round || '').split(' · ')[0]] || 'playoffs'
const poResult = po => { const x = po.series[po.series.length - 1]; return po.champ ? 'Champions' : `Lost ${roundOf(x)} ${x.w}–${x.l}` }

// The back of a Season card: every game as a tile, month by month, the best games and the playoff run
export function SeasonBack({ s }) {
  const heat = gs => (gs >= 40 ? 5 : gs >= 30 ? 4 : gs >= 22 ? 3 : gs >= 15 ? 2 : gs >= 8 ? 1 : 0)
  const maxM = Math.max(...s.months.map(m => m.gs))
  return (
    <div className={styles.back} style={{ '--c': s.tc || '#173657' }}>
      <div className={styles.backHead}><div><FitName>{baseName(s.name)}</FitName><small>{s.tn} · {s.s}</small></div>
        <span>{s.po?.champ ? '★ Champions' : `#${s.rank} final`}</span></div>
      {honorList(s).length > 0 && <div className={styles.backHonors}>{honorList(s).map(x => <span key={x}>{x}</span>)}</div>}
      <section>
        <h4>Every game <em>{s.reg} regular season{s.po ? ` · ${s.po.w + s.po.l} playoffs` : ''}</em></h4>
        <div className={styles.gameTiles}>
          {s.tiles.map((t, i) => <i key={i} data-h={heat(t.gs)} data-post={t.post ? '' : undefined} data-l={t.w ? undefined : ''} title={`${t.d} ${t.o}: ${t.gs} GmSc, ${t.w ? 'W' : 'L'}`} />)}
        </div>
        <div className={styles.tileKey}><span><i data-h="1" />8+</span><span><i data-h="3" />22+</span><span><i data-h="5" />40+ GmSc</span><span><i data-l="" data-h="2" />loss</span>{s.po && <span><i data-post="" data-h="2" />playoffs</span>}</div>
      </section>
      <section>
        <h4>By month <em>Game Score</em></h4>
        <div className={styles.months}>
          {s.months.map(m => <span key={m.m}><b style={{ height: `${(m.gs / maxM) * 100}%` }}><em>{f1(m.gs)}</em></b><small>{m.m}</small></span>)}
        </div>
      </section>
      <section>
        <h4>Best games</h4>
        {s.top.map(g => <div key={g.date} className={styles.backRow}><span>{ap(g.date)} {g.home ? 'vs' : '@'} {g.o}{g.post ? ' · playoffs' : ''}</span><span>{g.pts}-{g.trb}-{g.ast}</span><b>{f1(g.gs)}</b></div>)}
      </section>
      {s.po ? <section>
        <h4>Playoffs <em>{s.po.w}–{s.po.l} · {f1(s.po.pts)} PPG</em></h4>
        <div className={styles.series}>{s.po.series.map(x => <span key={x.o} data-won={x.w > x.l ? '' : undefined}><small>{(x.round || '').split(' · ')[0]}</small><b>{x.o}</b><em>{x.w}–{x.l}</em></span>)}</div>
      </section> : <section><h4>Playoffs</h4><p className={styles.backNote}>Missed the playoffs ({s.w}–{s.l}).</p></section>}
      <div className={styles.backFoot}><span>Elo {r0(s.start)} → {r0(s.end)} · peak {r0(s.peak)}</span><span>{s.potd} Player of the Day · {s.potg} of the Game</span></div>
    </div>
  )
}

// ── Rivalry ──────────────────────────────────────────────────────────────────
// r: { a, b, ac, bc, at, bt, w, l, t, xw, seasons: [{ sy, w, l }], peakA, peakB, first, last }  a = the leader
export function RivalryCard({ r: r0_, shotA, shotB, serial }) {
  const r1 = leaderFirst(r0_)
  const r = { ...r1, at: r1.at || (r1.teamsA || []).slice(0, 3).join(' · '), bt: r1.bt || (r1.teamsB || []).slice(0, 3).join(' · ') }
  const A = split(r.a), B = split(r.b)
  const ra = useRef(null), rb = useRef(null)
  useFit(ra, 34, 18, r.a); useFit(rb, 34, 18, r.b)
  const n = r.w + r.l + r.t
  const over = r.w - r.xw
  const maxN = Math.max(...r.seasons.map(x => x.w + x.l + (x.t || 0)))
  return (
    <div className={styles.rival} data-tier={r.tier} style={{ '--a': r.ac, '--b': r.bc }}>
      <div className={styles.rivalHead}><span>Rivalry</span><small>{TIER_LABEL[r.tier]} · No. {r.rank}</small></div>
      <div className={styles.rivalBody}>
        <div className={styles.rivalA} /><div className={styles.rivalB} />
        <Medal name={r.a} headshot={shotA} color={r.ac} size={104} cls={styles.rivalMedA} />
        <Medal name={r.b} headshot={shotB} color={r.bc} size={92} cls={styles.rivalMedB} />
        <div className={styles.rivalNameA}><small>{A.first}</small><b ref={ra}>{A.last}</b><em>{r.at} · peak Elo {r0(r.peakA)}</em></div>
        <div className={styles.rivalNameB}><small>{B.first}</small><b ref={rb}>{B.last}</b><em>{r.bt} · peak Elo {r0(r.peakB)}</em></div>
        <div className={styles.rivalScore}>
          <small>{A.last} leads</small>
          <b>{r.w}<i>–</i>{r.l}{r.t ? <i>–{r.t}</i> : null}</b>
          <span>{over >= 0 ? '+' : '−'}{Math.abs(over).toFixed(1)} over expected</span>
        </div>
        <div className={styles.rivalBars} data-many={r.seasons.length > 13 ? '' : undefined}>
          {r.seasons.map(x => {
            const k = x.w + x.l + (x.t || 0)
            return (
              <span key={x.sy} title={`${x.sy}-${String(x.sy + 1).slice(2)}: ${x.w}–${x.l}`}>
                <i style={{ height: `${(k / maxN) * 100}%` }}><em style={{ height: `${k ? (x.w / k) * 100 : 0}%` }} /></i>
                <small>’{String(x.sy + 1).slice(2)}</small>
              </span>
            )
          })}
        </div>
      </div>
      <div className={styles.rivalFoot}><span>{r.first}–{r.last} · {n} duels</span><span>{A.last} {Math.round((r.w / n) * 100)}%</span>{serial}</div>
    </div>
  )
}

const TIER_LABEL = { goat: '★ GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare' }

// A player's teams in the rivalry, most games first: two, then "+N"
const teamList = ts => (ts.length > 2 ? `${ts.slice(0, 2).join(' · ')} +${ts.length - 2}` : ts.join(' · '))

// The back of a Rivalry card: season by season, their teams' games, the best duel for each side, and both Elo paths
export function RivalryBack({ r: r0_ }) {
  const r = leaderFirst(r0_)
  const A = split(r.a), B = split(r.b)
  const yrs = [...new Set([...Object.keys(r.elo[r.a]), ...Object.keys(r.elo[r.b])])].sort()
  const all = yrs.flatMap(y => [r.elo[r.a][y], r.elo[r.b][y]]).filter(Boolean)
  const lo = Math.min(...all) - 40, hi = Math.max(...all) + 40, W = 292, H = 70
  const line = n => yrs.map((y, i) => r.elo[n][y] == null ? null : [(i / (yrs.length - 1)) * W, H - ((r.elo[n][y] - lo) / (hi - lo)) * H]).filter(Boolean)
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const n = r.w + r.l + r.t
  const duel = (x, who) => <div className={styles.backRow}><span>{ap(x.d)}{x.post ? ' · playoffs' : ''}</span><span>{who === 'a' ? `${x.ap} pts to ${x.bp}` : `${x.bp} pts to ${x.ap}`}</span><b>{f1(who === 'a' ? x.ag : x.bg)}–{f1(who === 'a' ? x.bg : x.ag)}</b></div>
  return (
    <div className={styles.back} data-rival="" style={{ '--a': r.ac, '--b': r.bc }}>
      <div className={styles.backHead}><div><FitName>{`${A.last} vs. ${B.last}`}</FitName><small>{TIER_LABEL[r.tier]} rivalry · No. {r.rank} all-time</small></div><span>{r.w}–{r.l}</span></div>
      <section>
        <h4>Season by season <em>Game Score duels</em></h4>
        <div className={styles.rivalTable} data-cols={r.seasons.length > 21 ? 4 : r.seasons.length > 12 ? 3 : 2}>
          {r.seasons.map(x => <span key={x.sy}><small>{r.seasons.length > 12 ? `’${String(x.sy).slice(2)}-${String(x.sy + 1).slice(2)}` : `${x.sy}-${String(x.sy + 1).slice(2)}`}</small><i><em style={{ width: `${(x.w / (x.w + x.l + (x.t || 0) || 1)) * 100}%` }} /></i><b>{x.w}–{x.l}</b></span>)}
        </div>
      </section>
      <section>
        <h4>Their teams <em>{r.games} games</em></h4>
        <div className={styles.backGrid}>
          <div><b>{r.teamW}–{r.games - r.teamW}</b><small>{A.last}’s teams</small></div>
          <div><b>{r.po}</b><small>Playoff games</small></div>
          <div><b>{r.poW}–{r.po - r.poW}</b><small>In the playoffs</small></div>
          <div><b>{(r.w - r.xw >= 0 ? '+' : '−') + Math.abs(r.w - r.xw).toFixed(1)}</b><small>Over expected</small></div>
        </div>
      </section>
      <section>
        <h4>Best duel for each</h4>
        <div className={styles.backSub}>{A.last}</div>{duel(r.bestA, 'a')}
        <div className={styles.backSub}>{B.last}</div>{duel(r.bestB, 'b')}
      </section>
      <section>
        <h4>Elo, season by season</h4>
        <svg className={styles.backChart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"><path d={line(r.a)} className={styles.lineA} /><path d={line(r.b)} className={styles.lineB} /></svg>
        <div className={styles.chartKey}><span><i className={styles.keyA} />{A.last} · peak {r0(r.peakA)}</span><span><i className={styles.keyB} />{B.last} · peak {r0(r.peakB)}</span></div>
      </section>
      <div className={styles.backFoot}><span>{teamList(r.teamsA)} vs. {teamList(r.teamsB)}</span><span>{n} duels</span></div>
    </div>
  )
}

// ── Starting Five ────────────────────────────────────────────────────────────
const FIVE_TIER = { goat: '★ GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare', common: 'Common' }
const SPOTS = [[24, 27], [76, 27], [50, 52], [22, 77], [78, 77]] // % positions: two up top, one in the middle, two below
export function FiveCard({ f, shots = {}, serial }) {
  const ps = [...f.players].sort((a, b) => b.pre - a.pre)
  return (
    <div className={styles.five} data-tier={f.tier || 'common'} style={{ '--c': f.tc || '#173657' }}>
      <div className={styles.fiveHead}><span>Starting Five</span><small>{f.rank && f.rank <= 125 ? `${FIVE_TIER[f.tier]} · No. ${f.rank}` : `Best five of ${f.s}`}</small></div>
      <div className={styles.fiveBody}>
        <div className={styles.fiveFoil} />
        <svg className={styles.fiveCourt} viewBox="0 0 316 300" preserveAspectRatio="none" aria-hidden="true">
          <rect x="98" y="0" width="120" height="150" /><circle cx="158" cy="150" r="46" /><path d="M18,0 L18,60 A150,150 0 0 0 298,60 L298,0" /><circle cx="158" cy="300" r="46" />
        </svg>
        {ps.map((p, i) => (
          <div key={p.n} className={styles.fiveSpot} style={{ left: `${SPOTS[i][0]}%`, top: `${SPOTS[i][1]}%` }}>
            <Medal name={p.n} headshot={shots[p.n]} color={f.tc} size={i === 0 ? 74 : 64} cls={i === 0 ? styles.fiveTop : ''} />
            <b>{split(p.n).last}</b>
            <small>{r0(p.pre)} · {p.pts} PTS</small>
          </div>
        ))}
        <div className={styles.fiveElo}><b>{r0(f.elo)}</b><small>Five Elo</small></div>
      </div>
      <div className={styles.fiveFoot}>
        <span>{ap(f.date)} {f.home ? 'vs' : '@'} {f.o} · <em className={f.won ? styles.won : styles.lost}>{f.won ? 'W' : 'L'} {f.score}</em></span>
        <span>{f.tw}–{f.tl}</span>{serial}
      </div>
    </div>
  )
}

// The back of a Starting Five card: each player's line that day, how the five did together, the season
export function FiveBack({ f, b }) {
  const ps = [...b.lines].sort((x, y) => y.pre - x.pre)
  return (
    <div className={styles.back} style={{ '--c': f.tc || '#173657' }}>
      <div className={styles.backHead}><div><FitName>{`The ${nick(f.tn)}’ best five`}</FitName><small>{f.s} · {ap(f.date)} {f.home ? 'vs' : '@'} {f.o}</small></div><span>{r0(f.elo)}</span></div>
      <section>
        <h4>That day <em>{f.won ? 'W' : 'L'} {f.score}</em></h4>
        <div className={styles.boxTable}>
          <span className={styles.boxHeadRow}><b /><small>MIN</small><small>PTS</small><small>REB</small><small>AST</small><small>GmSc</small><small>Elo</small></span>
          {ps.map(p => <span key={p.n}><b>{split(p.n).last}</b><small>{p.mp}</small><small>{p.pts}</small><small>{p.trb}</small><small>{p.ast}</small><small>{f1(p.gs)}</small><small>{r0(p.pre)}</small></span>)}
        </div>
      </section>
      <section>
        <h4>This five, together</h4>
        <div className={styles.backGrid}>
          <div><b>{b.together}</b><small>Games all five played</small></div>
          <div><b>{b.tw}–{b.tl}</b><small>Record in them</small></div>
          <div><b>{f.tw}–{f.tl}</b><small>Season</small></div>
          <div><b>{b.po[0]}–{b.po[1]}</b><small>{b.champ ? '★ Champions' : 'Playoffs'}</small></div>
        </div>
      </section>
      <section>
        <h4>Five Elo <em>the five’s average pre-game Elo</em></h4>
        <div className={styles.fiveBars}>{ps.map(p => <span key={p.n}><b style={{ width: `${((p.pre - 1800) / (ps[0].pre - 1800)) * 100}%` }} /><small>{split(p.n).last} {r0(p.pre)}</small></span>)}</div>
      </section>
      <div className={styles.backFoot}><span>Ranked by pre-game Elo, among players who played</span><span>{f.s}</span></div>
    </div>
  )
}

// ── Serial number tab: bottom-right, clear of the flip button ────────────────
// ── Player of the Week ───────────────────────────────────────────────────────
const SHORT_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const md = d => `${SHORT_MO[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`
export const weekSpan = c => (c.week.slice(5, 7) === c.end.slice(5, 7) ? `${md(c.week)}–${+c.end.slice(8, 10)}` : `${md(c.week)} – ${md(c.end)}`) + `, ${c.end.slice(0, 4)}`
const sg1 = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)

export function PotwCard({ card: c, headshot }) {
  const [bad, setBad] = useState(false)
  const { first, last } = split(c.n)
  return (
    <div className={styles.potw} style={{ '--c': c.tc || '#173657' }}>
      <div className={styles.potwSwirl} />
      <div className={styles.potwGlass} />
      <div className={styles.potwBadge}>PLAYER OF THE WEEK</div>
      <div className={styles.potwShot}>{headshot && !bad ? <img src={headshot} alt={baseName(c.n)} onError={() => setBad(true)} /> : <b>{initials(c.n)}</b>}</div>
      <div className={styles.potwName}><small>{first !== last ? first : ''}</small><FitName max={40} min={22}>{last}</FitName></div>
      <div className={styles.potwWeek}>{nick(c.tn).toUpperCase()} · {weekSpan(c).replace(/, \d{4}$/, '').toUpperCase()} · {c.gp} GAMES · {c.w}–{c.gp - c.w}</div>
      <div className={styles.potwStats}>
        <div><b>{f1(c.pts)}</b><small>PPG</small></div><div><b>{f1(c.trb)}</b><small>RPG</small></div>
        <div><b>{f1(c.ast)}</b><small>APG</small></div><div><b>{f1(c.gs)}</b><small>GmSc</small></div>
      </div>
      <div className={styles.potwNo}>— {c.k || 1} / {c.of || 1} —</div>
    </div>
  )
}

export function PotwBack({ card: c }) {
  const W = c.winners || []
  return (
    <div className={styles.back} style={{ '--c': '#9a6d12' }}>
      <div className={styles.backHead}><div><FitName>{baseName(c.n)}</FitName><small>Player of the Week · {weekSpan(c)}</small></div><span>{c.k || 1}/{c.of || 1}</span></div>
      <section>
        <h4>Won by <em>{W.length > 1 ? `a ${W.length}-way tie for No. 1` : 'the week’s No. 1'} of {c.entrants || W.length} in pick’em</em></h4>
        {W.map((w, i) => (
          <div key={w.username} className={styles.potwWin} data-me={i + 1 === c.k ? '' : undefined}>
            <span><b>{w.username}{W.length > 1 ? <i> · copy {i + 1} of {W.length}</i> : null}</b>
              <small>Picks {w.picks[0]}–{w.picks[1]} · matchups {w.matchups[0]}–{w.matchups[1]}{w.locks ? ` · ${w.locks} lock${w.locks === 1 ? '' : 's'}` : ''}{w.potd?.[0] ? ` · PotD ${w.potd[0]}` : ''} · {sg1(w.over)} vs the forecast</small></span>
            <strong>{w.score}<small>pts</small></strong>
          </div>
        ))}
      </section>
      <section>
        <h4>His week <em>{c.gp} games · Elo {r0(c.elo[0])} → {r0(c.elo[1])}</em></h4>
        {(c.games || []).map(g => (
          <div key={g.date} className={styles.backRow}>
            <span>{md(g.date)} {g.home === false ? '@' : 'vs'} {g.o} · {g.won ? 'W' : 'L'} {g.score}</span>
            <span>{g.pts} pts · {g.trb} reb · {g.ast} ast</span><b>{f1(g.gs)}</b>
          </div>
        ))}
      </section>
      <section>
        <p className={styles.backNote}>The week’s best by the Player of the Day measure added up: Game Score plus a sixth of the Elo gained, every game ({f1(c.score)}). One card a week, only for the pick’em winner.</p>
      </section>
      <div className={styles.backFoot}><span>Player of the Week</span><span>{c.k || 1} of {c.of || 1}</span></div>
    </div>
  )
}

export function Serial({ k, n, flip, inline, pocket }) {
  return <span className={styles.serial} data-flip={flip ? '' : undefined} data-inline={inline ? '' : undefined} data-pocket={pocket ? '' : undefined} title={`Copy ${k} of ${n} in collectors’ binders`}><b>#{k}</b><i>/</i>{n}</span>
}

// ── Any special card, anywhere: binder pockets, pack openings, showcases ─────

export const SPECIAL = new Set(['peak', 'rival', 'five', 'season', 'potw'])
export const isSpecial = c => SPECIAL.has(c?.kind)
const KIND_NAME = { peak: 'Peak', rival: 'Rivalry', five: 'Starting Five', season: 'Season card', duel: 'Duel of the Day', potw: 'Player of the Week' }
export const specialTitle = c => (c.kind === 'peak' ? `${baseName(c.row.n)} · ${c.until ? 'Former Peak' : 'Peak'}` : c.kind === 'rival' ? `${split(c.a).last} vs. ${split(c.b).last}`
  : c.kind === 'five' ? `${c.s} ${nick(c.tn)} · Starting Five` : c.kind === 'season' ? `${baseName(c.n)} · ${c.s} Season` : c.kind === 'duel' ? `${baseName(c.a.row.n)} · Duel of the Day`
  : c.kind === 'potw' ? `${baseName(c.n)} · Player of the Week` : '')
export const specialLabel = c => (c.kind === 'rival' ? `Rivalry · ${TIER_LABEL[c.tier] || ''}` : KIND_NAME[c.kind] || '')
export const specialLine = c => (c.kind === 'peak' ? `Career-high Elo ${r0(c.row.post)} · ${ap(c.date)} ${c.home === false ? '@' : 'vs'} ${c.o}`
  : c.kind === 'rival' ? `${c.w}–${c.l} in ${c.w + c.l + (c.t || 0)} duels · No. ${c.rank} all-time` : c.kind === 'five' ? `Five Elo ${r0(c.elo)} · ${ap(c.date)} vs ${c.o} · ${c.won ? 'W' : 'L'} ${c.score}`
    : c.kind === 'season' ? `${c.gp} games with the ${nick(c.tn)}` : c.kind === 'potw' ? `Week of ${weekSpan(c)} · ${c.k || 1} of ${c.of || 1}` : '')

// Shared, cached lookups for Peak cards
let peaksP = null, shotsP = null
const usePeaks = () => {
  const [d, setD] = useState(null)
  useEffect_(() => { (peaksP = peaksP || binderPeaks().catch(() => ({}))).then(setD) }, [])
  return d
}
const useShots = () => {
  const [d, setD] = useState(null)
  useEffect_(() => { (shotsP = shotsP || binderHeadshots()).then(setD) }, [])
  return d
}
const useHistoryTick = () => { const [, setT] = useState(0); useEffect_(() => { binderHistory()?.then(() => setT(1)).catch(() => {}) }, []); return null }
const shotOf = (shots, n) => {
  const k = n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
  return shots?.[k]?.headshot
}

// A Peak's standing from the published list: reigning, or Former with the date he passed it and the next Peak's Elo
function peakState(card, list) {
  const mine = list?.[card.row.n]
  const i = mine ? mine.findIndex(x => x[1] === card.id) : -1
  if (i < 0) return { status: card.until ? 'former' : 'reigning', until: card.until, next: card.next }
  const until = mine[i][4]
  return { status: until ? 'former' : 'reigning', until, next: mine[i + 1]?.[2] ?? null, list: mine, at: i }
}

function SeasonFront({ card, owned, serial }) {
  // The Greatest Seasons binder ships each card's front with it; any other Season card builds it from the season's games
  const [s, setS] = useState(card.sum && !owned ? card.sum : null)
  useEffect_(() => { if (card.sum && !owned) return; binderSeasonSummary(card.s, card.n, card.t).then(setS).catch(() => {}) }, [card.s, card.n, card.t])
  const shots = useShots()
  if (!s) return <div className={styles.season} style={{ '--c': card.tc || '#173657' }}><div className={styles.seasonHead}><span>Season</span><small>{card.s} · {nick(card.tn)}</small></div>
    <div className={styles.seasonBody}><div className={styles.seasonBg} /></div><div className={styles.seasonFoot}><span>{baseName(card.n)}</span></div></div>
  // owned: the game ids you own (a partial reveal); none means the whole card
  const idx = owned ? new Set(s.tiles.map((t, i) => (owned.has(t.id) ? i : -1)).filter(i => i >= 0)) : undefined
  return <SeasonCard s={s} owned={idx && idx.size < s.tiles.length ? idx : undefined} headshot={shotOf(shots, card.n)} serial={serial} />
}

function SpecialFaceIn({ card, owned, serial }) {
  const peaks = usePeaks()
  const shots = useShots()
  useHistoryTick()
  if (card.kind === 'peak') {
    const st = peakState(card, peaks)
    const cp = binderCareerPath(card.row.n, card.date)
    const path = cp?.path || [card.row.pre, card.row.post]
    return <PeakCard card={card} team={{ color: card.tc }} headshot={shotOf(shots, card.row.n)} status={st.status} until={st.until} next={st.next}
      path={path} pathAll={st.status === 'former' ? cp?.pathAll : null} serial={serial} />
  }
  if (card.kind === 'rival') return <RivalryCard r={card} shotA={shotOf(shots, card.a)} shotB={shotOf(shots, card.b)} serial={serial} />
  if (card.kind === 'five') return <FiveCard f={card} shots={Object.fromEntries(card.players.map(p => [p.n, shotOf(shots, p.n)]))} serial={serial} />
  if (card.kind === 'season') return <SeasonFront card={card} owned={owned} serial={serial} />
  if (card.kind === 'potw') return <PotwCard card={card} headshot={shotOf(shots, card.n)} />
  return null
}
// Tagged for "Save card image" (right-click)
export function SpecialFace(props) {
  const c = props.card
  return <div style={{ display: 'contents' }} data-card-shot={`${specialTitle(c)} ${c.row?.n || c.n || c.a || ''} ${c.s || c.date || ''}`}><SpecialFaceIn {...props} /></div>
}

// The back of a Peak card: this game's line and every Peak of his career, this one marked
export function PeakBack({ card }) {
  const peaks = usePeaks()
  const st = peakState(card, peaks)
  const list = st.list || []
  const r = card.row
  return (
    <div className={styles.back} style={{ '--c': card.tc || '#173657' }}>
      <div className={styles.backHead}><div><FitName>{baseName(r.n)}</FitName><small>{card.tn} · {card.s}</small></div><span>{r0(r.post)}</span></div>
      <section>
        <h4>The game <em>{ap(card.date)} {card.home === false ? '@' : 'vs'} {card.o} · {card.won ? 'W' : 'L'} {card.score}</em></h4>
        <div className={styles.backGrid}>
          <div><b>{r.pts ?? '—'}</b><small>PTS</small></div><div><b>{r.trb ?? '—'}</b><small>REB</small></div>
          <div><b>{r.ast ?? '—'}</b><small>AST</small></div><div><b>{f1(r.gs)}</b><small>GmSc</small></div>
        </div>
      </section>
      <section>
        <h4>Elo <em>{r0(r.pre)} → {r0(r.post)}</em></h4>
        <p className={styles.backNote}>{st.status === 'former' ? `His career high from ${ap(card.date)} until ${ap(st.until)}${st.next ? `, when he climbed toward ${r0(st.next)}` : ''}.` : `His career high since ${ap(card.date)}. It becomes a Former Peak if he climbs higher.`}</p>
      </section>
      <section>
        <h4>Every Peak <em>{list.length} card{list.length === 1 ? '' : 's'} · one per season he finished at a new high</em></h4>
        {list.map((x, i) => (
          <div key={x[1]} className={styles.backRow} style={i === st.at ? { fontWeight: 800 } : undefined}>
            <span>{x[0]} · {ap(x[3])}{i === st.at ? ' · this card' : ''}</span><span>{x[4] ? 'Former' : '★ Reigning'}</span><b>{r0(x[2])}</b>
          </div>
        ))}
      </section>
      <div className={styles.backFoot}><span>Peak cards start after a player’s rookie season</span><span>{card.s}</span></div>
    </div>
  )
}

function SpecialBack({ card }) {
  if (card.kind === 'peak') return <PeakBack card={card} />
  if (card.kind === 'rival') return <RivalryBack r={card} />
  if (card.kind === 'five') return <FiveBack f={card} b={{ lines: card.players, together: card.together, tw: card.togW, tl: card.together - card.togW, po: card.po || [0, 0], champ: card.champ }} />
  if (card.kind === 'season') return <SeasonBackLoader card={card} />
  if (card.kind === 'potw') return <PotwBack card={card} />
  return null
}
function SeasonBackLoader({ card }) {
  const [s, setS] = useState(null)
  useEffect_(() => { binderSeasonSummary(card.s, card.n, card.t).then(setS).catch(() => {}) }, [card.s, card.n, card.t])
  return s ? <SeasonBack s={s} /> : <div className={styles.back} />
}

// Full size, flippable: tap the card (or the button, or F) to turn it over
export function SpecialModal({ card, serial, onClose, locked, extra }) {
  const [flip, setFlip] = useState(false)
  const [k, setK] = useState(1)
  useEffect_(() => {
    const fit = () => setK(Math.min(1.25, (innerHeight - 110) / 476, (innerWidth - 32) / 340))
    fit(); addEventListener('resize', fit)
    const key = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() } else if ((e.key === 'f' || e.key === 'F') && !locked) setFlip(v => !v) }
    addEventListener('keydown', key, true)
    return () => { removeEventListener('resize', fit); removeEventListener('keydown', key, true) }
  }, [onClose, locked])
  return (
    <div className={styles.modal} onClick={onClose}>
      <div className={styles.modalStage} style={{ width: 340 * k, height: 476 * k }} onClick={e => e.stopPropagation()}>
        <div className={styles.modalScale} style={{ transform: `scale(${k})` }}>
          <div className={`${styles.modalFlip} ${flip ? styles.flipped : ''}`} onClick={() => !locked && setFlip(v => !v)}>
            <div className={styles.modalFace}><SpecialFace card={card} serial={serial} owned={card.owned} /></div>
            <div className={`${styles.modalFace} ${styles.modalBack}`}>{!locked && <SpecialBack card={card} />}</div>
          </div>
        </div>
      </div>
      <div className={styles.modalHint} onClick={e => e.stopPropagation()}>{locked ? locked : 'Tap the card to flip · Esc to close'}{extra}
        <button type="button" onClick={onClose}>Close</button></div>
    </div>
  )
}
