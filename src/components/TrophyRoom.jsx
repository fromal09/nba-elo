import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import styles from './TrophyRoom.module.css'
import { useCollector, CardFace, cardName, tierName } from './Collector'
import { binderTeamInfo } from './SeasonExplorer'

/*
 * The Trophy Room: the Binder Room's leaderboards. A podium for the top three binders (each with its best card), the
 * rest ranked below, the most valuable cards in anyone's binder by type, and the best recent pulls. The way into the
 * card database sits at the top.
 */

const METAL = ['#e2b04a', '#c9d2dc', '#c98a5a']
const RANK_BY = [['score', 'Score'], ['cards', 'Cards'], ['players', 'Players']]
const KINDS = [['all', 'All cards'], ['player', 'Player cards'], ['contest', 'Contest wins'], ['special', 'Specials'], ['collection', 'Collection']]
const WINDOWS = [[24, 'Last 24 hours'], [168, '7 days']]

// What kind of card it is, for the tag under it
export function cardType(c) {
  if (c.ruby) return ['CALLED IT', '#a8243b']
  if (c.kind === 'duel') return ['DUEL', '#a8243b']
  if (c.kind === 'potw') return ['PLAYER OF THE WEEK', '#a8243b']
  if (['peak', 'five', 'rival', 'duo'].includes(c.kind)) return ['SPECIAL', '#7b3fa0']
  if (c.kind) return ['COLLECTION', '#8a6414']
  return ['PLAYER', '#2f67a6']
}

// A card face that fills its box's width
export function FaceFit({ card, shots, max }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const fit = () => { const x = el.clientWidth; if (x) setW(Math.min(max || x, x)) }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(el)
    return () => ro.disconnect()
  }, [max])
  return <div ref={ref} className={styles.faceBox}>{w > 0 && <CardFace card={card} shots={shots} w={w} />}</div>
}

const ago = t => { const m = Math.max(1, Math.round((Date.now() - Date.parse(t)) / 60e3)); return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} days ago` }
const shortDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmt = n => (n || 0).toLocaleString()

function Seg({ value, options, onChange, label }) {
  return (
    <div className={styles.seg} role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} data-on={value === v ? '' : undefined} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

function useJSON(url, deps) {
  const [data, setData] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!url) return
    let live = true
    const get = (n = 0) => fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); if (live) setData(d) })
      .catch(e => { if (!live) return; if (n < 2) setTimeout(() => live && get(n + 1), 1500 * (n + 1)); else setData(v => (v && !v.failed ? v : { failed: String(e?.message || e) })) })
    get()
    return () => { live = false }
  }, [url, tick, ...deps])
  return [data, () => { setData(null); setTick(t => t + 1) }]
}

export default function TrophyRoom({ shots, onOpen, onBrowse, total }) {
  const C = useCollector()
  const ready = !C.down && C.me !== undefined
  const [by, setBy] = useState('score')
  const [kind, setKind] = useState('all')
  const [hours, setHours] = useState(24)
  const [more, setMore] = useState(false)
  const meScore = C.me?.standing?.score
  const [leaders, retry] = useJSON(ready ? `/api/collect?action=leaders${by === 'score' ? '' : `&by=${by}`}${C.me ? '' : '&pub=1'}` : null, [meScore])
  const [tops] = useJSON(ready ? `/api/collect?action=topcards${kind === 'all' ? '' : `&kind=${kind}`}${hours === 24 ? '' : `&h=${hours}`}` : null, [meScore])
  // Keep the last board on screen while a new ranking loads
  const [lb, setLb] = useState(null)
  useEffect(() => { if (leaders && !leaders.failed && (leaders.by || 'score') === by) setLb(leaders) }, [leaders, by])
  const [tc, setTc] = useState(null)
  useEffect(() => { if (tops && !tops.failed) setTc(tops) }, [tops])
  if (!ready) return null

  const list = lb?.leaders || []
  const val = l => l[by]
  const unit = by === 'score' ? 'pts' : by
  const podium = list.slice(0, 3)
  const rest = list.slice(3, more ? 50 : 13)
  const topVal = Math.max(1, ...rest.map(val))
  const you = C.me?.user.username
  const meta = l => [by !== 'score' && `${fmt(l.score)} pts`, by !== 'cards' && `${fmt(l.cards)} cards`, by !== 'players' && `${fmt(l.players)} players`, l.favoriteTeam && binderTeamInfo(l.favoriteTeam).name].filter(Boolean).join(' · ')

  return (
    <section className={styles.room} aria-labelledby="trophy-title">
      <div className={styles.inner}>
        <header className={styles.top}>
          <div className={styles.titleBox}>
            <div className={styles.kicker}>THE BINDER ROOM</div>
            <h2 id="trophy-title" className={styles.title}>Leaderboards</h2>
            <div className={styles.lede}>{lb ? `${fmt(lb.binders)} binder${lb.binders === 1 ? '' : 's'} · every card scored the same way` : ' '}</div>
          </div>
          <button type="button" className={styles.dbBtn} onClick={onBrowse}>
            <span className={styles.dbIcon} aria-hidden="true"><i /><i /><i /></span>
            <span><b>Card database</b><small>{total ? `Search all ${fmt(total)} cards` : 'Search every card on record'}</small></span>
          </button>
        </header>

        <div className={styles.block}>
          <div className={styles.blockHead}>
            <h3>Top binders</h3>
            <Seg value={by} options={RANK_BY} onChange={setBy} label="Rank binders by" />
          </div>
          {!lb && !leaders?.failed ? <div className={styles.wait}><span /><span /><span /></div>
          : !lb ? <div className={styles.fail}><span>The leaderboard didn’t load.</span><button type="button" onClick={retry}>Try again</button></div>
          : !list.length ? <div className={styles.fail}><span>No binders yet. Open a pack to start one.</span></div>
          : <>
            <div className={styles.podium}>
              {podium.map((l, i) => (
                <button key={l.username} type="button" className={styles.step} data-rank={i + 1} style={{ '--metal': METAL[i] }}
                  onClick={() => onOpen(l.username === you ? { kind: 'mine' } : { kind: 'public', name: l.username })}>
                  <span className={styles.stepCard}>
                    {l.best ? <FaceFit card={l.best} shots={shots} /> : <span className={styles.noCard} />}
                    <span className={styles.medal}>{l.rank}</span>
                  </span>
                  <span className={styles.plinth}>
                    <b className={styles.plName}>{l.username}{l.username === you ? ' (you)' : ''}</b>
                    <b className={styles.plScore}>{fmt(val(l))}<small> {unit}</small></b>
                    <small className={styles.plMeta}>{meta(l)}</small>
                  </span>
                </button>
              ))}
            </div>
            {rest.length > 0 && <div className={styles.ranks}>
              {rest.map(l => (
                <button key={l.username} type="button" className={styles.rankRow} data-you={l.username === you ? '' : undefined}
                  onClick={() => onOpen(l.username === you ? { kind: 'mine' } : { kind: 'public', name: l.username })}>
                  <span className={styles.rankNo}>{l.rank}</span>
                  <span className={styles.rankWho}><b>{l.username}{l.username === you ? ' (you)' : ''}</b><small>{meta(l)}</small></span>
                  <span className={styles.bar} aria-hidden="true"><i style={{ width: `${Math.max(2, (val(l) / topVal) * 100)}%` }} /></span>
                  <b className={styles.rankScore}>{fmt(val(l))}</b>
                </button>
              ))}
            </div>}
            <div className={styles.under}>
              {list.length > 13 && <button type="button" className={styles.linkBtn} onClick={() => setMore(m => !m)}>{more ? 'Show the top 13' : `Show the top ${list.length}`}</button>}
              {lb.you && (!lb.you.rank || lb.you.rank > (more ? 50 : 13)) && <button type="button" className={styles.youRow} onClick={() => onOpen({ kind: 'mine' })}>
                You: {lb.you.rank ? `No. ${lb.you.rank} of ${fmt(lb.you.of)}` : 'not ranked yet'} · {fmt(lb.you[by])} {unit}
              </button>}
            </div>
          </>}
        </div>

        <div className={styles.block}>
          <div className={styles.blockHead}>
            <h3>Top cards in binders</h3>
            <div className={styles.chips} role="group" aria-label="Card type">
              {KINDS.map(([k, l]) => <button key={k} type="button" className={styles.chip} aria-pressed={kind === k} data-on={kind === k ? '' : undefined} onClick={() => setKind(k)}>{l}</button>)}
            </div>
          </div>
          {!tc ? <div className={styles.wait}><span /><span /><span /></div>
          : !tc.top.length ? <div className={styles.fail}><span>No cards of this kind in any binder yet.</span></div>
          : <div className={styles.gallery} data-busy={tops === null || (tc.kind || 'all') !== kind ? '' : undefined}>
            {tc.top.map((x, i) => {
              const [tag, bg] = cardType(x.card)
              return (
                <button key={i} type="button" className={styles.galCard} onClick={() => onOpen({ kind: 'card', card: x.card })} title="Open the card">
                  <span className={styles.galFace}><FaceFit card={x.card} shots={shots} /><span className={styles.galRank}>{i + 1}</span></span>
                  <span className={styles.galLine}><b>{cardName(x.card)}</b><b className={styles.gold}>{fmt(x.points)}</b></span>
                  <span className={styles.galMeta}><i style={{ background: bg }}>{tag}</i>{x.owners > 1 ? `${x.first} + ${x.owners - 1} more` : x.first}</span>
                </button>
              )
            })}
          </div>}
        </div>

        <div className={styles.block}>
          <div className={styles.blockHead}>
            <h3>Top pulls</h3>
            <Seg value={hours} options={WINDOWS} onChange={setHours} label="Window" />
          </div>
          {!tc ? null : !tc.recent.length ? <div className={styles.fail}><span>No pulls in the {hours === 24 ? 'last day' : 'last week'} yet.</span></div>
          : <div className={styles.pulls} data-busy={tops === null || (tc.hours || 24) !== hours ? '' : undefined}>
            {tc.recent.map((x, i) => (
              <button key={i} type="button" className={styles.pull} onClick={() => onOpen({ kind: 'card', card: x.card })} title="Open the card">
                <span className={styles.pullFace}><CardFace card={x.card} shots={shots} w={62} /></span>
                <span className={styles.pullText}>
                  <b>{cardName(x.card)}</b>
                  <small>{tierName(x.card)}{x.card.date ? ` · ${shortDate(x.card.date)}` : ''}</small>
                  <small>{x.forged ? 'Forged by' : 'Pulled by'} {x.username} · {ago(x.at)}</small>
                  <b className={styles.gold}>{fmt(x.points)}</b>
                </span>
              </button>
            ))}
          </div>}
        </div>
      </div>
    </section>
  )
}
