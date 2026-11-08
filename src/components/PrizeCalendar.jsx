import { useEffect, useMemo, useState } from 'react'
import styles from './PrizeCalendar.module.css'

const D = s => new Date(s + 'T12:00:00Z')
const iso = d => d.toISOString().slice(0, 10)
const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const fmt = (s, o) => D(s).toLocaleDateString('en-US', { timeZone: 'UTC', ...o })
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0)
const shortName = n => { const p = (n || '').replace(/\s*\(.*\)$/, '').split(' '); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(' ')}` : p[0] }

// How a part of the day went: perfect (gold), good, even, rough, pending, or nothing played
const grade = (r, n) => (!n ? null : r === n ? 'perfect' : r / n >= 0.6 ? 'good' : r / n >= 0.4 ? 'even' : 'rough')
function partsOf(h) {
  const G = h.games, M = h.duels, L = h.lineup, P = h.potd
  return [
    ['Games', G ? grade(G.correct, G.total) : h.open ? 'pending' : null],
    ['Matchups', M ? grade(M.correct, M.total) : h.dopen ? 'pending' : null],
    ['Player of the Day', P ? (P.result === 'win' ? 'perfect' : P.result === 'loss' ? 'rough' : 'pending') : null],
    ['Lineup', L ? (L.total >= 120 ? 'perfect' : L.total >= 70 ? 'good' : L.total >= 35 ? 'even' : 'rough') : h.lopen ? 'pending' : null],
  ]
}
const waitingOf = h => [h.games?.reward && !h.games.claimed && 'games', h.duels?.reward && h.duels.reward !== 'duel' && !h.duels.claimed && 'duels'].filter(Boolean)
const wonOf = h => [h.games?.claimed, h.duels?.claimed].filter(Boolean).length + (h.duels?.reward === 'duel' ? 1 : 0) + (h.potd?.result === 'win' ? 1 : 0)

// The Prize Counter's history as a calendar: five weeks at a glance, a bar for each part of each day (games, matchups,
// Player of the Day, lineup) colored by how it went, gold for a perfect day, and a card mark when it earned one.
// Tap a day for its breakdown (on a phone it slides up from the bottom); "Open the full day" lists every pick.
export default function PrizeCalendar({ history, stats: s, today, onReward, renderDay, renderThumb }) {
  const byDay = useMemo(() => new Map(history.map(h => [h.day, h])), [history])
  const days = history.map(h => h.day).sort()
  const first = days[0] || today, last = days[days.length - 1] || today
  // Five weeks at a time, Sunday first, ending with this week (or the week of your latest day)
  const newest = today > last ? today : last
  const lastSunday = add(newest, -D(newest).getUTCDay())
  const [end, setEnd] = useState(lastSunday)
  const [sel, setSel] = useState(null)
  const [full, setFull] = useState(false)
  useEffect(() => setFull(false), [sel])
  useEffect(() => {
    if (!sel) return
    const k = e => { if (e.key === 'Escape') setSel(null) }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [sel])

  const gridStart = add(end, -28)
  const cells = Array.from({ length: 35 }, (_, i) => add(gridStart, i))
  const canPrev = first < gridStart, canNext = end < lastSunday
  const shift = n => { setEnd(e => { const x = add(e, n * 35); return x > lastSunday ? lastSunday : x }); setSel(null) }
  const range = `${fmt(gridStart, { month: 'short', day: 'numeric' })} – ${fmt(add(end, 6), { month: 'short', day: 'numeric' })}`

  const waiting = history.flatMap(h => waitingOf(h).map(w => ({ day: h.day, which: w, h })))
  const won = s.claimed + (s.potd?.w || 0) // claimed covers the Duel of the Day cards too
  const lu = s.lineup || {}
  const H = sel && byDay.get(sel)

  return (
    <div className={styles.wrap}>
      <div className={styles.tiles}>
        <div className={styles.gold}><small>Prize cards</small><b>{won + waiting.length}</b><span>{won} won{waiting.length ? ` · ${waiting.length} waiting` : ''}</span></div>
        <div><small>Games</small><b>{s.wins}–{s.losses}</b><span>{pct(s.wins, s.wins + s.losses)}% · {s.perfect} perfect day{s.perfect === 1 ? '' : 's'}</span></div>
        <div><small>Matchups</small><b>{s.duels.w}–{s.duels.l}</b><span>{pct(s.duels.w, s.duels.w + s.duels.l)}% · {s.duels.cards} Duel card{s.duels.cards === 1 ? '' : 's'}</span></div>
        <div><small>Player of the Day</small><b>{s.potd ? `${s.potd.w} of ${s.potd.w + s.potd.l}` : '—'}</b><span>{s.potd?.w ? `${s.potd.w} ruby card${s.potd.w === 1 ? '' : 's'}` : 'no calls yet'}</span></div>
        <div><small>Lineup</small><b>{lu.avg != null ? Math.round(lu.avg) : '—'}</b><span>{lu.days ? `average · best ${Math.round(lu.best)}` : 'no lineups yet'}</span></div>
      </div>

      {waiting.length > 0 && <div className={styles.envBar}>
        <span className={styles.env} aria-hidden="true"><i /></span>
        <span className={styles.envText}><b>{waiting.length === 1 ? '1 prize card to choose' : `${waiting.length} prize cards to choose`}</b>
          <small>{fmt(waiting[0].day, { month: 'short', day: 'numeric' })} · {waiting[0].which === 'games' ? (waiting[0].h.games.reward === 'any' ? 'perfect day · any card' : 'games · Legend or below') : 'matchups · Rare or below'}</small></span>
        <button type="button" onClick={() => onReward(waiting[0].day, waiting[0].which)}>Choose it</button>
      </div>}

      <div className={styles.cal}>
        <div className={styles.calHead}>
          <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Earlier weeks">‹</button>
          <b>{range}</b>
          <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Later weeks">›</button>
        </div>
        <div className={styles.grid} role="grid" aria-label={`Your days, ${range}`}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span key={i} className={styles.wd} aria-hidden="true">{w}</span>)}
          {cells.map(d => {
            const h = byDay.get(d), inMonth = d <= today
            if (!h) return <span key={d} className={styles.day} data-off="" data-out={inMonth ? undefined : ''} data-today={d === today ? '' : undefined}><b>{+d.slice(8) === 1 ? fmt(d, { month: 'short', day: 'numeric' }) : +d.slice(8)}</b></span>
            const parts = partsOf(h), perfect = h.games && h.games.correct === h.games.total
            const wait = waitingOf(h).length, got = wonOf(h)
            return (
              <button key={d} type="button" className={styles.day} data-perfect={perfect ? '' : undefined} data-sel={sel === d ? '' : undefined} data-out={inMonth ? undefined : ''}
                data-today={d === today ? '' : undefined} onClick={() => setSel(sel === d ? null : d)}
                aria-label={`${fmt(d, { weekday: 'long', month: 'long', day: 'numeric' })}${h.games ? `: ${h.games.correct} of ${h.games.total} games` : ''}${wait ? ', prize card waiting' : got ? ', card won' : ''}`}>
                <b>{+d.slice(8) === 1 ? fmt(d, { month: 'short', day: 'numeric' }) : +d.slice(8)}</b>
                {wait ? <i className={styles.mark} data-k="wait" title="Prize card waiting">✉</i> : got ? <i className={styles.mark} title="Card won">★</i> : null}
                <small>{h.games ? `${h.games.correct}/${h.games.total}` : h.open ? `${h.open.correct}/${h.open.graded}` : ''}</small>
                <span className={styles.bars}>{parts.map(([k, g]) => <i key={k} data-g={g || undefined} />)}</span>
              </button>
            )
          })}
        </div>
        <div className={styles.legend}>
          <span><i data-g="perfect" />perfect</span><span><i data-g="good" />good</span><span><i data-g="even" />even</span><span><i data-g="rough" />rough</span>
          <span className={styles.lgNote}>bars: games · matchups · PotD · lineup</span><span>★ card won · ✉ waiting</span>
        </div>
      </div>

      {H && <>
        <div className={styles.scrim} onClick={() => setSel(null)} aria-hidden="true" />
        <section className={styles.detail} aria-label={fmt(sel, { weekday: 'long', month: 'long', day: 'numeric' })}>
          <header>
            <span><b>{fmt(sel, { weekday: 'long', month: 'long', day: 'numeric' })}</b>
              <small>{H.games && H.games.correct === H.games.total ? 'Perfect day' : H.games?.reward ? 'Earned a card' : H.games ? `${H.games.correct} of ${H.games.total} games` : 'Still being graded'}</small></span>
            <button type="button" onClick={() => setSel(null)} aria-label="Close">×</button>
          </header>
          <div className={styles.parts}>
            <div>
              <small>Games</small>
              {H.games ? <><b>{H.games.correct} of {H.games.total}</b>
                <span>{H.games.lock ? `Lock ${H.games.lock === 'win' ? '✓' : H.games.lock === 'loss' ? '✗' : '—'} · ` : ''}{H.games.upsets ? `${H.games.upsets} upset${H.games.upsets === 1 ? '' : 's'}` : H.games.correct === H.games.total ? 'every pick right' : 'no upsets'}</span>
                {H.games.claimed ? <span className={styles.thumbRow}>{renderThumb(H.games.claimed.card)}<em>Card won</em></span>
                  : H.games.reward ? <button type="button" className={styles.claim} onClick={() => onReward(sel, 'games')}>{H.games.reward === 'any' ? 'Choose any card' : 'Choose a card'}</button> : null}</>
                : H.open ? <><b>{H.open.correct} right</b><span>{H.open.graded} of {H.open.picked} graded</span></> : <><b>—</b><span>No picks that day</span></>}
            </div>
            <div>
              <small>Matchups</small>
              {H.duels ? <><b>{H.duels.correct} of {H.duels.total}</b><span>{H.duels.reward === 'duel' ? 'Duel of the Day card won' : H.duels.reward ? 'card earned' : 'no card'}</span>
                {H.duels.claimed ? <span className={styles.thumbRow}>{renderThumb(H.duels.claimed.card)}<em>Card won</em></span>
                  : H.duels.reward && H.duels.reward !== 'duel' ? <button type="button" className={styles.claim} onClick={() => onReward(sel, 'duels')}>Matchup card</button> : null}</>
                : H.dopen ? <><b>{H.dopen.picked} called</b><span>graded when the games are final</span></> : <><b>—</b><span>No matchups that day</span></>}
            </div>
            <div>
              <small>Player of the Day</small>
              {H.potd ? <><b>{shortName(H.potd.player)}</b><span>{H.potd.result === 'win' ? '✓ called it · ruby card' : H.potd.result === 'loss' ? '✗ missed' : 'not decided yet'}{H.potd.rank ? ` · No. ${H.potd.rank}` : ''}</span></>
                : <><b>—</b><span>No ticket</span></>}
            </div>
            <div>
              <small>Lineup</small>
              {H.lineup ? <><b>{Number(H.lineup.total).toFixed(1)}</b><span>+{H.lineup.coins} coins</span></> : H.lopen ? <><b>Set</b><span>scored when the games are final</span></> : <><b>—</b><span>No lineup</span></>}
            </div>
          </div>
          <footer>
            <span>Every game, matchup and lineup slot from the day</span>
            <button type="button" onClick={() => setFull(f => !f)}>{full ? 'Hide the full day' : 'Open the full day →'}</button>
          </footer>
          {full && <div className={styles.full}>{renderDay(sel)}</div>}
        </section>
      </>}
    </div>
  )
}
