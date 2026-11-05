import { useState, useEffect, useRef } from 'react'
import sb from './Sportsbook.module.css'
import { momentsFor } from './PlayerCard'
import { lineupPts } from './MyPredictions'
import { TIER_NAME } from './Collector'
import { norm } from './predict'
import { goTo } from '../nav.js'
import FanSidedTonight from './FanSidedTonight'

/*
 * The Sportsbook Scoreboard: the same Scoreboard, dressed as a casino sportsbook. Every piece comes from the Classic one
 * (src/components/SeasonExplorer.jsx): the TVs read the game cards' facts (gameFacts), the display cases hold the day's
 * honor cards, the board shows the Classic tables one category at a time, and Standings, My Predictions and Player of
 * the Week render in full on a lit monitor. Box scores, previews and cards open exactly as they do in Classic.
 * A switch at the top of both picks the look; the first visit asks, and the choice is kept on the device.
 */

const MODE_KEY = 'fpr.scoreboard'
const ASKED_KEY = 'fpr.scoreboardAsked'
export function useScoreMode() {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem(MODE_KEY) } catch { return 'classic' } })
  const set = m => { setMode(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode */ } }
  return [mode === 'book' || mode === 'classic' ? mode : null, set]
}

export function ScoreModeSwitch({ mode, onChange }) {
  return (
    <div className={sb.switch} data-mode={mode} role="group" aria-label="Scoreboard style">
      {[['classic', 'Classic'], ['book', 'Sportsbook']].map(([m, l]) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)}>{l}</button>
      ))}
    </div>
  )
}

// First visit: both looks side by side, pick one (or decide later, which asks again next visit)
export function ScoreModeChooser({ onPick }) {
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem(ASKED_KEY) === '1' } catch { return false } })
  useEffect(() => {
    if (later) return
    const k = e => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [later])
  if (later) return null
  const dismiss = () => { setLater(true); try { sessionStorage.setItem(ASKED_KEY, '1') } catch { /* private mode */ } }
  return (
    <div className={sb.chooser} role="dialog" aria-modal="true" aria-labelledby="sb-choose">
      <div className={sb.chooseBox}>
        <h2 id="sb-choose">Pick your Scoreboard</h2>
        <p>Same games, same numbers, two looks. You can switch any time from the top of the Scoreboard.</p>
        <div className={sb.choices}>
          <button type="button" className={sb.choice} onClick={() => onPick('classic')}>
            <span className={sb.prevClassic} aria-hidden="true">
              <i className={sb.pcHero} />
              <span className={sb.pcGrid}>{Array.from({ length: 6 }, (_, k) => <i key={k}><b /><b /><u /></i>)}</span>
              <span className={sb.pcSide}><i /><i /></span>
            </span>
            <b>Classic</b><small>Game cards, tables and a sidebar of the night’s honors</small>
          </button>
          <button type="button" className={sb.choice} onClick={() => onPick('book')}>
            <span className={sb.prevBook} aria-hidden="true">
              <i className={sb.pbMarquee}>THE SCOREBOARD</i>
              <span className={sb.pbWall}><i className={sb.pbBig} />{Array.from({ length: 6 }, (_, k) => <i key={k} />)}</span>
              <span className={sb.pbBoard}><u /><u /><u /></span>
            </span>
            <b>Sportsbook</b><small>Every game on a wall of TVs, the night’s cards in display cases, the tables on one big board</small>
          </button>
        </div>
        <button type="button" className={sb.later} onClick={dismiss}>Decide later</button>
      </div>
    </div>
  )
}

const FIRST_DAY = '1946-11-01'
const fmtDay = (d, o) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', o)

// The room around every tab: marquee, date (or season), the four tabs, the switch
const FONTS = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=VT323&display=swap'
export function SportsbookFrame({ view, setView, day, setDay, weekOf, addDays, etToday, hrefFor, linkTo, seasons, season, setSeason, onMode, children }) {
  useEffect(() => {
    if (document.getElementById('sb-fonts')) return
    const l = document.createElement('link'); l.id = 'sb-fonts'; l.rel = 'stylesheet'; l.href = FONTS
    document.head.appendChild(l)
  }, [])
  const potw = view === 'potw'
  // The calendar: any day from the first night of the BAA (November 1, 1946) through the end of the schedule
  const cal = useRef(null)
  const openCal = () => { const el = cal.current; if (!el) return; try { el.showPicker() } catch { el.focus(); el.click() } }
  const yr = d => (d.slice(0, 4) !== etToday().slice(0, 4) ? { year: 'numeric' } : {})
  const tabs = [['today', 'Tonight’s games', 'scoreboard'], ['standings', 'Standings', 'explorer'], ['picks', 'My predictions', 'mypicks'], ['potw', 'Player of the Week', 'potw']]
  return (
    <div className={sb.book}>
      {/* No z-index on the room's layers: the box score and cards open fixed over the whole page, above the site header */}
      <div className={sb.carpet} aria-hidden="true" />
      <div className={sb.ceil} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <div className={sb.top}>
        <div className={sb.marquee}><b>The Scoreboard</b><small>Every game · every screen</small></div>
        <div className={sb.topSwitch}><ScoreModeSwitch mode="book" onChange={onMode} /></div>
      </div>
      {view === 'standings' ? (
        <div className={sb.nav}>
          <label className={sb.season}><span>Season</span>
            <select value={season} onChange={e => setSeason(e.target.value)}>
              {seasons.map(x => <option key={x.season} value={x.season}>{x.season}{x.leagues?.includes('ABA') ? ' · NBA & ABA' : x.leagues?.includes('BAA') ? ' · BAA' : ''}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className={sb.nav}>
          <button type="button" onClick={() => setDay(d => addDays(d, potw ? -7 : -1))} aria-label={potw ? 'Previous week' : 'Previous day'}>◀ <span>{fmtDay(addDays(day, potw ? -7 : -1), { weekday: potw ? undefined : 'short', month: 'short', day: 'numeric' })}</span></button>
          <button type="button" className={sb.dateLab} onClick={openCal} aria-label="Pick any day in NBA history">
            <strong>{potw ? `Week of ${fmtDay(weekOf(day), { month: 'long', day: 'numeric', ...yr(weekOf(day)) })}` : fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric', ...yr(day) })}</strong>
          </button>
          <button type="button" onClick={() => setDay(d => addDays(d, potw ? 7 : 1))} aria-label={potw ? 'Next week' : 'Next day'}><span>{fmtDay(addDays(day, potw ? 7 : 1), { weekday: potw ? undefined : 'short', month: 'short', day: 'numeric' })}</span> ▶</button>
          {(potw ? weekOf(day) !== weekOf(etToday()) : day !== etToday()) && <button type="button" className={sb.today} onClick={() => setDay(etToday())}>{potw ? 'This week' : 'Today'}</button>}
          <span className={sb.cal}>
            <button type="button" onClick={openCal} aria-label="Pick any day in NBA history" title="Pick any day in NBA history">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M8 14h2M14 14h2M8 17h2" /></svg>
            </button>
            <input ref={cal} type="date" value={day} min={FIRST_DAY} max={addDays(etToday(), 240)} tabIndex={-1} aria-hidden="true"
              onChange={e => e.target.value && setDay(e.target.value)} />
          </span>
        </div>
      )}
      <nav className={sb.tabs} role="tablist">
        {tabs.map(([v, l, nv]) => <a key={v} role="tab" aria-selected={view === v} data-on={view === v ? '' : undefined} {...linkTo(hrefFor(nv), () => setView(v))}>{l}</a>)}
      </nav>
      {view === 'today' ? <div className={sb.floor}>{children}</div> : <div className={sb.monitorWrap}><div className={sb.monitor}>{children}</div></div>}
    </div>
  )
}

const BOARD_KEY = 'fpr.sbBoard'

// Tonight's games: the moments crawl, the wall of TVs, the cards of the day, the board, the windows
export function SportsbookDay({ kit, day, cards, scored, side, tables, pickCard, openBox, openCard, onPreview, shots, myDay, phone, loading, feedErr, unmatched, provisional, onView }) {
  const { gameFacts, TeamMark, Headshot, shortName, r0, sgn, tCode, tShort, tColor } = kit
  const [boardId, setBoardId] = useState(() => { try { return localStorage.getItem(BOARD_KEY) || 'perf' } catch { return 'perf' } })
  const pickBoard = id => { setBoardId(id); try { localStorage.setItem(BOARD_KEY, id) } catch { /* private mode */ } }
  const moments = [
    ...side.careerGames.map(({ g, p }) => ({ g, p, star: true, text: `Career game · ${p.gs.toFixed(1)} GmSc · ${p.pts}-${p.trb}-${p.ast}` })),
    ...side.milestones.map(({ g, p, m }) => ({ g, p, text: m.stamps.map(x => x.text).join(' · ') })),
  ]
  // Breaking news: a career game or milestone that lands while you're watching takes over the ticker for a few
  // seconds, one at a time, then the crawl resumes. What's already there when the day loads just scrolls.
  const momentKey = x => x.g.id + '|' + x.p.n + (x.star ? '|*' : '')
  const keys = moments.map(momentKey).join('~')
  const seen = useRef({ day: null, keys: null })
  const [breaking, setBreaking] = useState([])
  useEffect(() => {
    const r = seen.current
    if (r.day !== day) { r.day = day; r.keys = null; setBreaking([]) }
    if (loading || !cards.length) return
    if (!r.keys) { r.keys = new Set(moments.map(momentKey)); return }
    const fresh = moments.filter(x => !r.keys.has(momentKey(x)))
    fresh.forEach(x => r.keys.add(momentKey(x)))
    if (fresh.length) setBreaking(q => [...q, ...fresh])
  }, [day, keys, loading, cards.length])
  useEffect(() => {
    if (!breaking.length) return
    const t = setTimeout(() => setBreaking(q => q.slice(1)), 7000)
    return () => clearTimeout(t)
  }, [breaking])
  const news = breaking[0]
  // The main TV: FanSided Tonight once any game has tipped (finals and live look-ins), else the featured game; either can be picked
  const [tvPick, setTvPick] = useState(null)
  useEffect(() => { setTvPick(null) }, [day])
  if (loading) return <div className={sb.msg}>Warming up the screens…</div>
  if (feedErr && !cards.length) return <div className={sb.msg}>Couldn’t load the games: {feedErr}</div>
  if (!cards.length) return <div className={sb.msg}>No games on {fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}.</div>

  const F = cards.map(c => ({ c, f: gameFacts(c) }))
  // Your lineup: each slot's player found in the day's box scores, his Game Score and the lineup points it's worth
  const slots = myDay?.lineup?.slots || []
  const mine = slots.map(s => {
    let hit = null
    for (const g of scored) { const p = g.players.find(x => norm(x.n) === norm(s.player)); if (p) { hit = { g, p }; break } }
    const gs = s.gs ?? hit?.p.gs ?? null
    const pts = gs == null ? null : Math.round(lineupPts(gs, s.mult || 1) * 10) / 10
    const card = cards.find(c => (c.g ? c.g.teams : [c.x.home, c.x.away]).includes(s.team))
    return { s, hit, gs, pts, st: hit ? (hit.g.live?.state || 'post') : card?.state || 'pre', card }
  })
  const lineupTotal = myDay?.lineup?.graded ? +myDay.lineup.graded.total : mine.reduce((a, x) => a + (x.pts || 0), 0)
  const mineIn = c => mine.filter(x => x.card === c)
  // The jumbotron: a game going down to the wire, else the night's biggest upset, else the tightest forecast
  const pick = () => {
    const live = F.filter(x => x.c.state === 'in')
    if (live.length) return live.sort((a, b) => Math.abs(a.f.pts[a.f.home] - a.f.pts[a.f.away]) - Math.abs(b.f.pts[b.f.home] - b.f.pts[b.f.away]))[0]
    const ups = F.filter(x => x.c.state === 'post' && x.f.upset && x.f.wp)
    if (ups.length) return ups.sort((a, b) => a.f.wp[a.f.lead] - b.f.wp[b.f.lead])[0]
    const pre = F.filter(x => x.c.state === 'pre' && x.f.wp)
    if (pre.length) return pre.sort((a, b) => Math.abs(a.f.wp[a.f.home] - 0.5) - Math.abs(b.f.wp[b.f.home] - 0.5))[0]
    return F[0]
  }
  const feat = pick()
  const finals = F.filter(x => x.c.state === 'post' && x.c.g)
  const liveCount = F.filter(x => x.c.state === 'in').length
  const liveF = F.filter(x => x.c.state === 'in')
  // The show covers finals and games in progress, so it's the main TV whenever anything has tipped
  const showOn = finals.length + liveF.length > 0 && (tvPick || 'show') === 'show'
  const why = feat.c.state === 'in' ? 'Closest game on now' : feat.c.state === 'post' && feat.f.upset ? 'Biggest upset of the night' : feat.c.state === 'pre' ? 'Tightest forecast on the slate' : 'Featured'
  const marks = g => {
    if (!g) return { car: 0, mil: 0 }
    let car = 0, mil = 0
    for (const p of g.players) { const m = momentsFor(p); if (m.career) car++; if (m.stamps.length) mil++ }
    return { car, mil }
  }
  const open = c => (c.g ? () => openBox(c.g) : c.fg ? () => onPreview(c) : null)

  const tv = ({ c, f }, big, beside) => {
    const { g, home, away, pts, started, lead, wp, status, preProj, fav, upset, pLiveHome } = f
    const m = marks(g)
    const go = open(c)
    return (
      <div key={c.key} className={`${sb.cell} ${big ? sb.bigCell : ''} ${beside ? sb.sideCell : ''}`}>
        <button type="button" className={`${sb.tv} ${c.state === 'in' ? sb.tvLive : ''}`} data-mine={mineIn(c).length ? '' : undefined} onClick={go || undefined} disabled={!go}
          aria-label={`${tShort(away)} at ${tShort(home)}${go ? (c.g ? ', box score' : ', preview') : ''}`}>
          <span className={sb.scr}>
            <span className={sb.bug}>
              {mineIn(c).length > 0 && <span className={sb.yours} title="Your lineup">{mineIn(c).map(x => <b key={x.s.slot}>{shortName(x.s.player).split(' ').slice(-1)[0]} {x.pts != null ? x.pts.toFixed(1) : '—'}</b>)}</span>}
              <span className={sb.marks}>{m.car > 0 && <span title="Career games in this game">★{m.car > 1 ? m.car : ''}</span>}{m.mil > 0 && <u title="Milestones in this game">◆{m.mil}</u>}</span>
              <span className={sb.tags}>{(g || c.x)?.post && <em className={sb.po}>Playoffs</em>}{upset && <em className={sb.up}>{c.state === 'in' ? 'Upset watch' : `Upset${wp && lead ? ` · ${Math.round(wp[lead] * 100)}%` : ''}`}</em>}<i data-state={c.state}>{status}</i></span>
            </span>
            {big && <span className={sb.why}>Featured · {why}</span>}
            {[away, home].map(t => (
              <span key={t} className={sb.row} style={{ '--c': tColor(t) }} data-trail={started && lead && lead !== t ? '' : undefined}>
                <TeamMark t={t} size={big ? 44 : 26} />
                <b>{tCode(t)}</b>
                <span className={sb.nm}>{tShort(t)}</span>
                {!started && preProj && <small className={sb.proj} title="Projected score">{preProj[t]}</small>}
                <strong data-wp={!started ? '' : undefined}>{started ? pts[t] ?? '–' : wp ? `${Math.round(wp[t] * 100)}%` : ''}</strong>
              </span>
            ))}
            {/* During a game, the live win chance gets its own bar above the pre-game one */}
            {pLiveHome != null && <span className={`${sb.wp} ${sb.wpLive}`}><i style={{ width: `${(1 - pLiveHome) * 100}%`, background: tColor(away) }} /><i style={{ flex: 1, background: tColor(home) }} /></span>}
            {wp && <span className={sb.wp}><i style={{ width: `${wp[away] * 100}%`, background: tColor(away) }} /><i style={{ flex: 1, background: tColor(home) }} /></span>}
            {/* Win chances only: before tipoff the forecast; during a game the live chance in a row above the pre-game one; after it the pre-game one */}
            <span className={`${sb.tick} ${pLiveHome != null ? sb.tickLive : ''}`}>
              {pLiveHome != null && (lv => <span className={sb.liveRow}><i className={sb.liveDot} />{big ? 'Live win chance' : 'Live'} <b>{Math.round(Math.max(lv, 1 - lv) * 100)}% {tCode(lv >= 0.5 ? home : away)}</b></span>)(pLiveHome)}
              {wp ? <span>{big ? (started ? 'Pre-game win chance' : 'Win chance') : started ? 'Pre-game' : 'Win chance'} <b>{Math.round(wp[fav] * 100)}% {tCode(fav)}</b></span>
                : started ? 'Box score loading…' : 'Forecast loading…'}
            </span>
            {go && <span className={sb.open}>▶ {c.g ? 'Box score' : 'Preview'}</span>}
          </span>
        </button>
      </div>
    )
  }

  const rest = showOn ? F : F.filter(x => x !== feat)
  const ups = F.filter(x => x.c.state === 'post' && x.f.upset).length
  const liveN = F.filter(x => x.c.state === 'in').length
  // Fill the wall's last row with the night's numbers and moments
  const fill = phone ? 0 : (4 - ((rest.length + (showOn ? 6 : 4)) % 4)) % 4
  const tiles = [
    <div key="n" className={sb.tile}><h6>Tonight in numbers</h6>
      <p><b>{F.length}</b> game{F.length === 1 ? '' : 's'}{liveN ? <> · <b>{liveN}</b> live</> : ''}{scored.length ? <> · <b>{ups}</b> upset{ups === 1 ? '' : 's'}</> : ''}</p>
      {side.picks[0]?.[1]?.p && <p>Player of the Day <b>{shortName(side.picks[0][1].p.n)}</b></p>}
      {side.picks.find(x => x[0] === 'Biggest Elo riser')?.[1]?.p && (x => <p>Top riser <b>{shortName(x.n)} {sgn(x.post - x.pre)}</b></p>)(side.picks.find(x => x[0] === 'Biggest Elo riser')[1].p)}
    </div>,
    <button key="m" type="button" className={sb.tile} onClick={() => { pickBoard('moments'); document.getElementById('sb-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
      <h6>★ Career games · ◆ Milestones</h6>
      {side.careerGames.slice(0, 3).map(({ g, p }) => <p key={g.id + p.n}><span className={sb.star}>★</span> {shortName(p.n)} <b>{p.gs.toFixed(1)}</b></p>)}
      <p><span className={sb.dia}>◆</span> {side.milestones.length} milestone{side.milestones.length === 1 ? '' : 's'} →</p>
    </button>,
  ].slice(0, fill)

  // The board: every Classic table, one at a time, plus career games and milestones
  const momentsNode = (
    <div className={sb.moments}>
      <header><h3>Career games &amp; milestones</h3><span>★ a career-best Game Score (20+ career games) · ◆ tier moves, the Top 100, a new #1, career-high rank or Elo</span></header>
      {moments.length ? moments.map(x => (
        <button key={x.g.id + x.p.n + (x.star ? '*' : '')} type="button" onClick={() => openCard(x.g, x.p)}>
          <span className={x.star ? sb.star : sb.dia}>{x.star ? '★' : '◆'}</span><b>{x.p.n}</b><small>{tCode(x.p.t)}</small><em>{x.text}</em>
        </button>
      )) : <p>No career games or milestones yet.</p>}
    </div>
  )
  const board = [...tables.filter(t => t.id !== 'honors'), ...(scored.length ? [{ id: 'moments', g: 'Moments', title: 'Career games & milestones', lead: moments[0] ? `${shortName(moments[0].p.n)}` : '—', node: momentsNode }] : [])]
  const cur = board.find(t => t.id === boardId) || board[0]

  return (
    <div className={sb.day}>
      <div className={sb.bar}>
        <span><b>{F.length}</b> game{F.length === 1 ? '' : 's'}{liveN ? <> · <span className={sb.liveTxt}><i />{liveN} live</span></> : ''}</span>
        {provisional && <span>Live games use ratings through the last data update; Elo is provisional until the next one.</span>}
        {finals.length + liveF.length > 0 && <span className={sb.tvSwitch} role="group" aria-label="Main TV"><small>Main TV</small>
          <button type="button" data-on={showOn ? '' : undefined} onClick={() => setTvPick('show')}>FanSided Tonight</button>
          <button type="button" data-on={!showOn ? '' : undefined} onClick={() => setTvPick('game')}>{feat.c.state === 'in' ? 'Live game' : 'Featured game'}</button></span>}
      </div>
      {moments.length > 0 && <div className={sb.crawl} data-breaking={news ? '' : undefined} aria-live="polite"><span className={sb.crawlLab}>{news ? 'Breaking' : 'Moments'}</span>
        {news ? <button key={momentKey(news)} type="button" className={sb.news} onClick={() => openCard(news.g, news.p)}>
          <span className={news.star ? sb.star : sb.dia}>{news.star ? '★' : '◆'}</span> {news.p.n.toUpperCase()} · {news.text.toUpperCase()}
          {breaking.length > 1 && <small>+{breaking.length - 1} more</small>}
        </button> : <div className={sb.run} style={{ animationDuration: `${Math.max(30, moments.length * 7)}s` }}>
          {moments.map(x => <button key={x.g.id + x.p.n + (x.star ? '*' : '')} type="button" onClick={() => openCard(x.g, x.p)}>
            <span className={x.star ? sb.star : sb.dia}>{x.star ? '★' : '◆'}</span> {x.p.n.toUpperCase()} · {x.text.toUpperCase()}</button>)}
        </div>}</div>}
      {mine.length > 0 && <div className={sb.ticket}>
        <span className={sb.stub}><small>Your lineup</small><b>{lineupTotal.toFixed(1)}</b><small>{myDay.lineup.graded ? `final · +${myDay.lineup.graded.coins} Coins` : 'points so far'}</small></span>
        <span className={sb.legs}>{mine.map(x => (
          <button key={x.s.slot} type="button" className={sb.leg} data-state={x.st} style={{ '--tc': `var(--t-${x.s.tier || 'common'})` }}
            onClick={() => (x.hit ? openCard(x.hit.g, x.hit.p) : x.card?.g ? openBox(x.card.g) : x.card?.fg ? onPreview(x.card) : null)}
            title={`${x.s.player} · ${TIER_NAME[x.s.tier] || x.s.tier || ''} ×${+(x.s.mult || 1).toFixed(2)}`}>
            <TeamMark t={x.s.team} size={22} />
            <span><b>{shortName(x.s.player)}</b>
              <small>{x.st === 'in' ? <><i className={sb.liveDot} />Live · </> : x.st === 'post' ? 'Final · ' : 'Tonight · '}{TIER_NAME[x.s.tier] || ''} ×{+(x.s.mult || 1).toFixed(2)}</small></span>
            <strong>{x.pts != null ? x.pts.toFixed(1) : '—'}<small>{x.gs != null ? `${x.gs.toFixed(1)} GmSc` : 'pts'}</small></strong>
          </button>
        ))}</span>
      </div>}
      <div className={sb.wallF}><div className={sb.wall} data-show={showOn ? '' : undefined}>
        {showOn ? <div className={`${sb.cell} ${sb.showCell}`}><FanSidedTonight kit={kit} day={day} finals={finals} live={liveF} side={side} shots={shots} phone={phone}
          openBox={openBox} openCard={openCard} liveN={liveCount} onLive={() => setTvPick('game')} /></div> : tv(feat, true)}
        {rest.map((x, i) => tv(x, false, showOn && !phone && i < 2))}{tiles}
      </div></div>

      {side.picks.length > 0 && <>
        <div className={sb.lab}><b>Cards of the Day</b><span>The night’s featured cards · tap one to open it</span></div>
        <div className={sb.reel}>{side.picks.map(pickCard)}</div>
      </>}

      {board.length > 0 && <>
        <div className={sb.lab} id="sb-board"><b>The Board</b><span>Every table from the night, one board · pick a category</span></div>
        <div className={sb.board}>
          <div className={sb.cats} role="tablist">
            {board.map(t => <button key={t.id} type="button" role="tab" aria-selected={t.id === cur.id} data-on={t.id === cur.id ? '' : undefined} onClick={() => pickBoard(t.id)}>
              <b>{t.title}</b><small>{t.lead || '—'}</small></button>)}
          </div>
          <div className={sb.screen}>{cur.node}</div>
        </div>
      </>}

      <div className={sb.windows}>
        <button type="button" className={sb.win} onClick={() => goTo('gameroom', { open: 'predict' })}><small>Window 1</small><b>Make your picks</b><span>Every winner and matchup · in the Game Room</span></button>
        <button type="button" className={sb.win} onClick={() => goTo('gameroom', { open: 'potd' })}><small>Window 2</small><b>Player of the Day</b><span>One ticket a day · the ruby card if you call it</span></button>
        <button type="button" className={sb.win} onClick={() => onView?.('picks')}><small>Window 3</small><b>My tickets</b><span>The day’s picks and how they’re doing</span></button>
      </div>
      {unmatched.length > 0 && <p className={sb.note}>Rated as new players (no ratings match): {unmatched.join(', ')}</p>}
    </div>
  )
}
