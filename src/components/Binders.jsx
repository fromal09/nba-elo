import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import styles from './Binders.module.css'
import { MiniCard, DuelCard, tierFor, TIERS, momentsFor } from './PlayerCard'

/*
 * Binders: a player's season (A), a player's career (C shelf + D album), a team's season (F) and a franchise (G).
 * All share one book: a left page that describes the set, brass rings, and a right page of plastic pockets.
 * On a phone the book becomes one page: a summary you can open, then the pockets two across.
 *
 * env (from SeasonExplorer) supplies what lives there: loadSeason, withTeams, cardGameInfo, teamInfo,
 * renderCard (the full card modal), renderDuel (the duel card modal), dayDuels, headshot, careerSeasons, getJSON, slug.
 */

const TIER_IDS = TIERS.map(t => t.id)
const TIER_LABEL = { goat: '★ GOAT', icon: 'Icon', legend: 'Legend', standout: 'Standout', rare: 'Rare', common: 'Common' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const r0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)
const day = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fullDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const baseName = n => n.replace(/\s*\(.*\)$/, '')
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1 && n % 10) || 0] || 'th')
const tierOfRow = row => tierFor(row.lrp ?? row.lr).id
// A team's nickname for the duel cards: "Los Angeles Lakers" -> "Lakers"
const nick = n => (/Trail Blazers$/.test(n || '') ? 'Trail Blazers' : (n || '').split(' ').pop())
const DUEL_LABEL = { duel: 'Duel of the Day', slayer: 'Giant-Slayer of the Day' }
const shortName = n => { const [f, ...r] = baseName(n).split(' '); return r.length ? `${f[0]}. ${r.join(' ')}` : f }
// A duel side in the shape DuelCard needs: row, the team as it was, headshot
const duelSide = (env, row, team) => ({ name: row.n, row, color: team.color, team: nick(team.name), abbr: team.abbr, headshot: env.headshot(row.n) })

function useIsPhone() {
  const q = '(max-width: 760px)'
  const [m, setM] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q), on = () => setM(mq.matches)
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

// A card drawn at full size (340 × 476) and scaled to whatever room its pocket has
function Fit({ children, label }) {
  const ref = useRef(null)
  const [s, setS] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (w && h) setS(Math.min(w / 340, h / 476)) // a pocket that isn't laid out yet measures 0: keep the last size
    }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className={styles.fit} aria-label={label}>
      <div className={styles.fitCard} style={{ transform: `translate(-50%, -50%) scale(${s})`, visibility: s ? 'visible' : 'hidden' }}>{children}</div>
    </div>
  )
}

// Career games always come graded; album sheets grade every card (slab = the label's wording)
const slabFor = (e, album) => (momentsFor(e.row).career ? 'Career game' : album || null)

function Pocket({ e, name, env, onPull, pulled, album }) {
  const out = pulled === e.key
  return (
    <div className={`${styles.pocket} ${e.post ? styles.pocketPo : ''}`}>
      <button type="button" className={styles.pocketBtn} disabled={out} onClick={() => onPull(e)} aria-label={`${e.label}: open card`}>
        {out ? <span className={styles.pulledOut}><b>Pulled out</b><small>Close the card to put it back</small></span>
          : e.duel ? <Fit><DuelCard {...e.duel} /></Fit>
            : <Fit><MiniCard name={e.name || name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name || name)} slab={slabFor(e, album)} /></Fit>}
        <span className={styles.glare} />
      </button>
      <div className={styles.pocketLab}>
        <span>{e.label}</span>
        {e.sub && <span style={{ color: e.subColor }}>{e.sub}</span>}
      </div>
    </div>
  )
}

// Sheets of pockets with arrows, dots, swipe and the arrow keys
function useSheets(list, per) {
  const [sheet, setSheet] = useState(0)
  const [dir, setDir] = useState(1)
  const sheets = Math.max(1, Math.ceil(list.length / per))
  const cur = Math.min(sheet, sheets - 1)
  const go = k => { const n = Math.max(0, Math.min(sheets - 1, cur + k)); if (n !== cur) { setDir(k > 0 ? 1 : -1); setSheet(n) } }
  const jump = n => { if (n !== cur) { setDir(n > cur ? 1 : -1); setSheet(n) } }
  return { cur, sheets, go, jump, dir, page: list.slice(cur * per, cur * per + per), reset: () => setSheet(0) }
}

function Sheet({ S, per, name, env, onPull, pulled, title, sub, tools, tabs, phone, album }) {
  const touch = useRef(null)
  return (
    <div className={styles.right}>
      <div className={styles.sheetHead}>
        <div className={styles.sheetTitle}><b>{title}</b>{sub && <span>{sub}</span>}</div>
        {tools}
      </div>
      {tabs && phone && <div className={styles.chips}>{tabs}</div>}
      <div className={styles.sheetBody}
        onTouchStart={ev => { touch.current = ev.touches[0].clientX }}
        onTouchEnd={ev => { if (touch.current == null) return; const dx = ev.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 50) S.go(dx < 0 ? 1 : -1); touch.current = null }}>
        <div key={S.cur} className={`${styles.pockets} ${S.dir > 0 ? styles.turnNext : styles.turnPrev}`} style={{ '--cols': phone ? 2 : 3 }}>
          {S.page.map(e => <Pocket key={e.key} e={e} name={name} env={env} onPull={onPull} pulled={pulled} album={album} />)}
          {Array.from({ length: per - S.page.length }, (_, i) => <div key={`x${i}`} className={`${styles.pocket} ${styles.pocketEmpty}`}><div className={styles.pocketBtn} /></div>)}
        </div>
      </div>
      <div className={styles.pager}>
        <button type="button" aria-label="Previous sheet" disabled={S.cur === 0} onClick={() => S.go(-1)}>‹</button>
        <div className={styles.dots}>
          {S.sheets <= 24 ? Array.from({ length: S.sheets }, (_, i) => (
            <button type="button" key={i} aria-label={`Sheet ${i + 1}`} className={i === S.cur ? styles.dotOn : ''} onClick={() => S.jump(i)} />
          )) : <span className={styles.dotText}>{S.cur + 1} / {S.sheets}</span>}
        </div>
        <button type="button" aria-label="Next sheet" className={styles.pagerNext} disabled={S.cur === S.sheets - 1} onClick={() => S.go(1)}>›</button>
      </div>
    </div>
  )
}

// The book: overlay, cover, left page, rings, right page, divider tabs; one page on a phone
function Book({ tc, onClose, onKey, left, right, tabs, phone, summary, head, stack }) {
  useEffect(() => {
    const k = e => {
      if (onKey?.(e)) return
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
    }
    addEventListener('keydown', k, true)
    return () => removeEventListener('keydown', k, true)
  })
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.book} style={{ '--tc': tc || '#173657' }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close binder">×</button>
        {phone && stack ? <>
          <div className={styles.phoneHead}>{head}</div>
          <div className={styles.stackBody}><div className={styles.stackLeft}>{left}</div>{right}</div>
        </> : phone ? <>
          <div className={styles.phoneHead}>{head}</div>
          {summary && <div className={styles.summary}>
            <button type="button" className={styles.summaryBtn} aria-expanded={open} onClick={() => setOpen(o => !o)}>
              {summary}<span className={styles.chev}>{open ? 'Hide' : 'Details'}</span>
            </button>
            {open && <div className={styles.summaryBody}>{left}</div>}
          </div>}
          {right}
        </> : <>
          <div className={styles.left}>{head}{left}</div>
          <div className={styles.rings} aria-hidden="true"><i /><i /><i /></div>
          {right}
          {tabs && <div className={styles.tabs}>{tabs}</div>}
        </>}
      </div>
    </div>
  )
}

function SeasonSwitch({ label, sub, prev, next, loading }) {
  return (
    <div className={styles.switch}>
      <button type="button" aria-label="Previous season" disabled={!prev || loading} onClick={prev}>‹</button>
      <div><b>{loading ? 'Loading…' : label}</b>{sub && <small>{sub}</small>}</div>
      <button type="button" aria-label="Next season" disabled={!next || loading} onClick={next}>›</button>
    </div>
  )
}

function Seg({ value, onChange, options }) {
  return (
    <div className={styles.seg} role="tablist">
      {options.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? styles.segOn : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

function TierTally({ counts }) {
  return (
    <div className={styles.tally}>
      {TIER_IDS.map((t, i) => (
        <div key={t} className={`${styles.tallyBox} ${counts[i] ? '' : styles.tallyNone}`} data-tier={t}>
          <b>{counts[i]}</b><small>{TIER_LABEL[t]}</small>
        </div>
      ))}
    </div>
  )
}

function PathChart({ path, color, shade, label }) {
  if (path.length < 2) return null
  const W = 460, H = 96, lo = Math.min(...path), hi = Math.max(...path), span = hi - lo || 1
  const x = i => (i / (path.length - 1)) * W, y = v => 6 + (1 - (v - lo) / span) * (H - 12)
  const pts = path.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const pk = path.indexOf(hi)
  return (
    <div className={styles.box}>
      <div className={styles.boxHead}><span>{label}</span><span className={styles.light}>{r0(lo)} – {r0(hi)}</span></div>
      <svg className={styles.path} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {shade && <rect x={x(shade[0])} y="0" width={Math.max(2, x(shade[1]) - x(shade[0]))} height={H} fill="#173657" opacity=".08" />}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={x(pk)} cy={y(hi)} r="4" fill="#b07d1a" />
      </svg>
    </div>
  )
}

function Checklist({ entries, per, cur, onJump, label }) {
  return (
    <div className={styles.box}>
      <div className={styles.boxHead}><span>{label}</span><span className={styles.light}>outlined: this sheet</span></div>
      <div className={styles.check}>
        {entries.map((e, i) => (
          <button type="button" key={e.key} data-tier={e.tier} data-res={e.res} title={e.label}
            className={Math.floor(i / per) === cur ? styles.checkOn : ''} onClick={() => onJump(Math.floor(i / per))} />
        ))}
      </div>
    </div>
  )
}

function SmallCard({ e, name, env, onPull, title, line, sub }) {
  return (
    <button type="button" className={styles.small} onClick={() => onPull(e)}>
      <span className={styles.smallCard}><Fit><MiniCard name={e.name || name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name || name)} /></Fit></span>
      <span className={styles.smallText}>
        {title && <small>{title}</small>}
        <b>{line}</b>
        {sub && <span>{sub}</span>}
      </span>
    </button>
  )
}

// A card from a pipeline index (career / franchise files) in the shape a pocket needs
function fromIndex(env, c, extra = {}) {
  const team = env.teamInfo(c.t, c.tn, c.tc), opp = env.teamInfo(c.o, c.on, c.oc)
  return {
    key: `${c.s}|${c.id}|${c.row.n}`, name: c.row.n, row: c.row, post: !!c.band, season: c.s, id: c.id, tier: tierOfRow(c.row),
    team, game: { date: c.date, home: c.home, oppAbbr: opp.abbr, oppLogo: opp.logo, oppColor: opp.color, won: c.won, score: c.score, ot: c.ot, band: c.band, honor: c.honor },
    ...extra,
  }
}

// Pulling a card: the full card, flippable, with its season. Index cards load their season first.
function usePull(env, sd, owner) {
  const [pulled, setPulled] = useState(null) // { key, name, g, sd, duel }
  const pull = e => {
    const set = (g, s) => setPulled({ key: e.key, name: e.name || owner, g, sd: s, duel: e.duel ? { kind: e.duel.kind, an: e.duel.a.name, bn: e.duel.b.name } : null })
    if (e.g && sd) { set(e.g, sd); return }
    env.loadSeason(e.season).then(s => {
      const g = s.games.find(x => x.id === e.id)
      if (g) set(g, s)
    }).catch(() => {})
  }
  const close = () => setPulled(null)
  const view = pulled && <div onClick={ev => ev.stopPropagation()}>{pulled.duel
    ? env.renderDuel({ ...pulled.duel, scope: 'day', g: pulled.g, sd: pulled.sd, onClose: close })
    : env.renderCard({ name: pulled.name, g: pulled.g, sd: pulled.sd, onClose: close })}</div>
  return { pulled: pulled?.key, pull, view, open: !!pulled }
}

// ── A · A player's season ────────────────────────────────────────────────────
export function SeasonBinder({ name, sd: startSd, env, onClose, onCareer }) {
  const phone = useIsPhone()
  const per = phone ? 6 : 9
  const [sd, setSd] = useState(startSd)
  const [loading, setLoading] = useState(false)
  const [order, setOrder] = useState('chrono')
  const seasons = env.careerSeasons(name, startSd.season)
  const si = seasons.indexOf(sd.season)
  const P = usePull(env, sd, name)
  const goSeason = k => {
    const lab = seasons[si + k]; if (!lab) return
    setLoading(true)
    env.loadSeason(lab).then(d => { setSd(d); S.reset() }).catch(() => {}).finally(() => setLoading(false))
  }
  const entries = useMemo(() => env.withTeams(sd, () => {
    const list = []; let reg = 0
    const games = [...sd.games].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    for (const g of games) {
      const p = g.players.find(x => x.n === name); if (!p) continue
      if (!g.post) reg++
      const info = env.cardGameInfo(g, p.t, sd, p)
      const d = p.post - p.pre
      list.push({
        key: g.id, g, row: p, game: info, team: env.teamInfo(p.t), post: !!g.post, tier: tierOfRow(p), t: p.t,
        month: g.post ? 'Playoffs' : MONTHS[+g.date.slice(5, 7) - 1],
        label: g.post ? info.band.label : `G${reg} · ${info.home === false ? '@' : 'vs'} ${info.oppAbbr}`,
        sub: sgn(d), subColor: d >= 0 ? '#1a7a4a' : '#a83232', gs: p.gs || 0, d,
      })
    }
    return list
  }), [name, sd, env])
  // Duel of the Day (both players) and Giant-Slayer of the Day (the winner) cards, each after its game
  const cards = useMemo(() => env.withTeams(sd, () => {
    const dd = env.dayDuels(sd), out = []
    for (const e of entries) {
      out.push(e)
      const day = dd.get(e.g.date); if (!day) continue
      for (const kind of ['duel', 'slayer']) {
        const x = day[kind]
        if (!x || x.g.id !== e.g.id || !(x.a.n === name || (kind === 'duel' && x.b.n === name))) continue
        const me = x.a.n === name ? x.a : x.b, other = me === x.a ? x.b : x.a
        out.push({
          key: `${e.g.id}|${kind}`, g: e.g, row: me, gs: me.gs || 0, tier: kind, month: e.month, post: e.post, kind,
          duel: { kind, scope: 'day', date: e.g.date, a: duelSide(env, x.a, env.teamInfo(x.a.t)), b: duelSide(env, x.b, env.teamInfo(x.b.t)) },
          label: DUEL_LABEL[kind], sub: `${me === x.a ? (kind === 'slayer' ? 'beat' : 'over') : 'vs'} ${shortName(other.n)}`, subColor: me === x.a ? '#1a7a4a' : '#6b7783',
        })
      }
    }
    return out
  }), [entries, name, sd, env])
  const duelN = cards.filter(e => e.kind === 'duel').length, slayerN = cards.filter(e => e.kind === 'slayer').length
  const HONOR_RANK = { duel: -2, slayer: -1 }
  const rankOf = t => HONOR_RANK[t] ?? TIER_IDS.indexOf(t)
  const sorted = useMemo(() => order === 'chrono' ? cards
    : order === 'best' ? [...cards].sort((a, b) => b.gs - a.gs || !!a.duel - !!b.duel)
      : [...cards].sort((a, b) => rankOf(a.tier) - rankOf(b.tier) || b.gs - a.gs), [cards, order])
  const S = useSheets(sorted, per)
  const last = entries[entries.length - 1]
  const team = last?.t, tinfo = team && sd.teams[team]
  // Traded mid-season: each team he played for, in order, with its card count
  const stints = useMemo(() => {
    const out = []
    entries.forEach(e => { const s = out[out.length - 1]; if (s && s.t === e.t) s.n++; else out.push({ t: e.t, n: 1, name: e.team.name }) })
    return out
  }, [entries])
  const tc = last?.team.color || '#173657'
  const counts = TIER_IDS.map(t => entries.filter(e => e.tier === t).length)
  const path = entries.length ? [entries[0].row.pre, ...entries.map(e => e.row.post)] : []
  const best = entries.reduce((b, e) => (!b || e.gs > b.gs ? e : b), null)
  const reg = entries.filter(e => !e.post).length, po = entries.length - reg
  const champ = env.champion(sd, team)
  // Shade the Elo path under this sheet's games (path index = game number)
  const shade = useMemo(() => {
    if (order !== 'chrono') return null
    const idx = S.page.filter(e => !e.duel).map(e => entries.indexOf(e)).filter(i => i >= 0)
    return idx.length ? [idx[0], idx[idx.length - 1] + 1] : null
  }, [order, S.page, entries])
  const tabs = order === 'chrono' && monthTabs(sorted, per, S)

  const head = <>
    <div className={styles.kicker}>Season binder</div>
    <h2 className={styles.title} style={{ color: tc }}>{baseName(name)}</h2>
    <div className={styles.headRow}>
      <SeasonSwitch label={sd.season} sub={seasons.length > 1 ? `vol. ${si + 1} of ${seasons.length}` : null} loading={loading}
        prev={si > 0 ? () => goSeason(-1) : null} next={si >= 0 && si < seasons.length - 1 ? () => goSeason(1) : null} />
      {onCareer && <button type="button" className={styles.linkBtn} onClick={() => onCareer(name)}>Career binder</button>}
    </div>
  </>
  const left = <>
    <p className={styles.line}>{stints.length > 1 ? stints.map(s => `${s.name} (${s.n})`).join(' → ') : tinfo?.name || team} · {entries.length} card{entries.length === 1 ? '' : 's'}{po ? ` · ${reg} regular season · ${po} playoffs` : ''}</p>
    {tinfo && <div className={`${styles.record} ${champ ? styles.recordChamp : ''}`}>
      {champ && <Trophy />}
      <span><b>{champ ? 'Champions' : po ? 'Playoffs' : 'Regular season'}</b>{stints.length > 1 ? ` with ${tinfo.name}` : ''} · {tinfo.w}–{tinfo.l}{tinfo.pw + tinfo.pl ? `, ${tinfo.pw}–${tinfo.pl} in the playoffs` : ''}</span>
    </div>}
    <div className={styles.boxLab}>Pulls by tier</div>
    <TierTally counts={counts} />
    {(duelN > 0 || slayerN > 0) && <div className={styles.duelTally}>
      {duelN > 0 && <span data-k="duel"><b>{duelN}</b> Duel of the Day</span>}
      {slayerN > 0 && <span data-k="slayer"><b>{slayerN}</b> Giant-Slayer of the Day</span>}
    </div>}
    <PathChart path={path} color={tc} shade={shade && [shade[0], shade[1]]} label="Elo through the season" />
    <Checklist entries={sorted} per={per} cur={S.cur} onJump={S.jump} label={`Checklist · ${cards.length} cards`} />
    {best && <SmallCard e={best} name={name} env={env} onPull={P.pull} title="Best pull"
      line={`${day(best.g.date)} ${best.game.home === false ? '@' : 'vs'} ${best.game.oppAbbr} · ${best.row.pts ?? 0} pts, ${best.gs.toFixed(1)} Game Score`}
      sub={`${best.row.lrp ? `No. ${best.row.lrp} in the league that night · ` : ''}Elo ${sgn(best.d)}`} />}
  </>
  const first = S.page[0], lastP = S.page[S.page.length - 1]
  const right = <Sheet S={S} per={per} name={name} env={env} onPull={P.pull} pulled={P.pulled} phone={phone} tabs={tabs}
    title={`Sheet ${S.cur + 1} of ${S.sheets}`}
    sub={first && order === 'chrono' ? `${day(first.g.date)} – ${day(lastP.g.date)}` : order === 'best' ? 'best Game Score first' : order === 'tier' ? 'rarest first' : ''}
    tools={<Seg value={order} onChange={v => { setOrder(v); S.reset() }} options={[['chrono', 'Chronological'], ['best', 'Best first'], ['tier', 'By tier']]} />} />
  return <>
    <Book tc={tc} phone={phone} onClose={onClose} head={head} left={left} right={right} tabs={tabs}
      summary={<span><b>{counts[0] ? `${counts[0]} ★ GOAT · ` : ''}{cards.length} cards</b>{tinfo ? ` · ${tinfo.w}–${tinfo.l}${champ ? ' · Champions' : ''}` : ''}</span>}
      onKey={e => { if (P.open) return true; if (e.key === 'ArrowRight') { S.go(1); return true } if (e.key === 'ArrowLeft') { S.go(-1); return true } }} />
    {P.view}
  </>
}

function monthTabs(sorted, per, S) {
  const firstAt = {}
  sorted.forEach((e, i) => { if (firstAt[e.month] == null) firstAt[e.month] = i })
  return Object.entries(firstAt).map(([m, i]) => {
    const sheet = Math.floor(i / per)
    const on = sorted.slice(S.cur * per, S.cur * per + per).some(e => e.month === m)
    return <button key={m} type="button" className={`${styles.tab} ${on ? styles.tabOn : ''} ${m === 'Playoffs' ? styles.tabPo : ''}`} onClick={() => S.jump(sheet)}>{m}</button>
  })
}

function Trophy() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></svg>
}

// ── C + D · A player's career ────────────────────────────────────────────────
export function CareerBinder({ name, env, onClose, onSeason }) {
  const phone = useIsPhone()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  const [view, setView] = useState('shelf')
  const [sel, setSel] = useState(null)
  const [albumPage, setAlbumPage] = useState(0)
  const [albumSet, setAlbumSet] = useState('best')
  const P = usePull(env, null, name)
  useEffect(() => {
    env.getJSON(`/data/explorer/binders/p/${env.slug(name)}.json`).then(d => { setData(d); setSel(d.seasons.reduce((b, s) => (!b || s.peak > b.peak ? s : b), null)?.s) }).catch(() => setErr(true))
  }, [name])
  const vols = data?.seasons || []
  const s = vols.find(v => v.s === sel)
  const tc = s?.best ? (s.best.tc || '#173657') : '#173657'
  const tot = useMemo(() => {
    const t = [0, 0, 0, 0, 0]; vols.forEach(v => v.tiers.forEach((n, i) => { t[i] += n })); return t
  }, [vols])
  const peak = vols.reduce((m, v) => Math.max(m, v.peak), 0)
  const bestRank = data?.milestones.best_rank?.row.lrp
  const maxN = Math.max(1, ...vols.map(v => v.n))

  const head = <>
    <div className={styles.kicker}>Career binder</div>
    <h2 className={styles.title} style={{ color: tc }}>{baseName(name)}</h2>
    <div className={styles.headRow}><Seg value={view} onChange={setView} options={[['shelf', 'Shelf'], ['album', 'Album']]} /></div>
  </>
  if (err || !data) {
    return <Book tc="#173657" phone={phone} onClose={onClose} head={head}
      left={<p className={styles.line}>{err ? 'This career binder isn’t built yet. It appears after the next data update.' : 'Loading…'}</p>}
      right={<div className={styles.right} />} />
  }
  const stats = (
    <div className={styles.stats}>
      <div><b>{data.games.toLocaleString()}</b><small>Game cards</small></div>
      <div><b>{vols.length}</b><small>Volumes</small></div>
      <div><b className={styles.gold}>{r0(peak)}</b><small>Peak Elo</small></div>
      <div><b>{bestRank ? `#${bestRank}` : '—'}</b><small>Best rank</small></div>
      <div><b>{tot[0]}</b><small>★ GOAT pulls</small></div>
    </div>
  )
  const MS = [
    ['debut', 'Debut', '#173657'], ['high_pts', 'Career high', '#a83232'], ['best_gs', 'Best Game Score', '#1a7a4a'],
    ['peak_elo', 'Peak Elo', '#b07d1a'], ['best_rank', 'Best rank', '#6b3fa0'], ['swing', 'Biggest swing', '#2b4c72'], ['title', 'Title clincher', '#8a6a12'],
  ]
  const miles = MS.filter(([k]) => data.milestones[k]).map(([k, cap, col]) => {
    const c = data.milestones[k]
    const capText = k === 'high_pts' ? `${cap} · ${c.row.pts} pts` : k === 'peak_elo' ? `${cap} · ${r0(c.row.post)}` : k === 'best_rank' ? `${cap} · #${c.row.lrp}`
      : k === 'swing' ? `${cap} · ${sgn(c.row.post - c.row.pre)}` : k === 'best_gs' ? `${cap} · ${c.row.gs}` : cap
    return fromIndex(env, c, { label: capText, cap: capText, capColor: col, sub: `${fullDay(c.date)} · ${env.teamInfo(c.o, c.on, c.oc).abbr}` })
  })
  const bests = vols.filter(v => v.best).map(v => fromIndex(env, v.best, { label: `${v.s} · ${env.teamInfo(v.best.t, v.best.tn).abbr}`, sub: `${v.best.row.gs} GmSc` }))
  // Duel of the Day and Giant-Slayer of the Day cards across the career (from the pipeline's index)
  const duels = (data.duels || []).map(d => {
    const side = c => duelSide(env, c.row, env.teamInfo(c.t, c.tn, c.tc))
    const me = d.a.row.n === name ? d.a : d.b, other = me === d.a ? d.b : d.a
    return {
      key: `${d.s}|${d.id}|${d.k}`, season: d.s, id: d.id, kind: d.k,
      duel: { kind: d.k, scope: 'day', date: d.date, a: side(d.a), b: side(d.b) },
      label: `${d.s} · ${d.k === 'slayer' ? 'Giant-Slayer' : 'Duel'}`, sub: `${me === d.a ? (d.k === 'slayer' ? 'beat' : 'over') : 'vs'} ${shortName(other.row.n)}`,
      subColor: me === d.a ? '#1a7a4a' : '#6b7783',
    }
  })

  let left, right
  if (view === 'shelf') {
    left = <>
      {stats}
      {s && <div className={styles.volPanel}>
        <div className={styles.boxLab}>Vol. {vols.indexOf(s) + 1} · {s.s}{s.champ ? ' · Champions' : ''}</div>
        <b className={styles.volLine}>{s.n} cards · {s.tiers.map((n, i) => n ? `${n} ${TIER_LABEL[TIER_IDS[i]]}` : null).filter(Boolean).join(', ')}</b>
        <span className={styles.light}>Elo {r0(s.start)} → {r0(s.end)} · peak {r0(s.peak)}</span>
        {s.best && <SmallCard e={fromIndex(env, s.best)} name={name} env={env} onPull={P.pull} title="Best pull"
          line={`${day(s.best.date)} vs ${env.teamInfo(s.best.o, s.best.on).abbr} · ${s.best.row.pts ?? 0} pts`} sub={`${s.best.row.gs} Game Score`} />}
        <button type="button" className={styles.primary} onClick={() => onSeason(name, s.s)}>Open {s.s} binder</button>
      </div>}
      <PathChart path={vols.map(v => v.end)} color={tc} label="Elo at the end of each season" />
    </>
    right = (
      <div className={`${styles.right} ${styles.shelfPage}`}>
        <div className={styles.sheetHead}><div className={styles.sheetTitle}><b>The shelf</b><span>thicker volumes hold more cards</span></div></div>
        <div className={styles.shelf}>
          <div className={styles.shelfRow}>
            {vols.map(v => {
              const c = v.best?.tc || '#173657', top = v.tiers.findIndex(n => n > 0)
              return (
                <button key={v.s} type="button" className={`${styles.spine} ${v.s === sel ? styles.spineOn : ''}`} aria-label={`${v.s}, ${v.n} cards`} aria-pressed={v.s === sel}
                  style={{ '--c': c, width: `${Math.round(30 + (v.n / maxN) * 34)}px` }} onClick={() => setSel(v.s)} onDoubleClick={() => onSeason(name, v.s)}>
                  <i className={styles.spineBand} />
                  <span className={styles.spineYear}>{v.s}</span>
                  <span className={styles.gems}>{v.champ && <span className={styles.spineTrophy}><Trophy /></span>}<i data-tier={TIER_IDS[top]} /></span>
                  <span className={styles.spineTeam}>{v.teams.map(t => env.teamInfo(t, v.best?.t === t ? v.best.tn : undefined).abbr).join('/')}</span>
                  <b className={styles.spineN}>{v.n}</b>
                  <i className={styles.spineBand} />
                </button>
              )
            })}
          </div>
          <div className={styles.plank} />
        </div>
      </div>
    )
  } else {
    left = <>
      {stats}
      <div className={styles.boxLab}>Milestones</div>
      <div className={styles.miles}>
        {miles.map(e => (
          <div key={e.key + e.cap} className={styles.mile}>
            <div className={styles.mileCap} style={{ background: e.capColor }}>{e.cap}</div>
            <div className={styles.mileCard}><button type="button" className={styles.pocketBtn} onClick={() => P.pull(e)} aria-label={`${e.cap}: open card`}><Fit><MiniCard name={name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(name)} slab={slabFor(e, e.cap)} /></Fit></button></div>
            <small>{e.sub}</small>
          </div>
        ))}
      </div>
    </>
    const set = albumSet === 'duels' && duels.length ? duels : bests
    const per = phone ? 6 : 9, pages = Math.max(1, Math.ceil(set.length / per)), pg = Math.min(albumPage, pages - 1)
    const S = { cur: pg, sheets: pages, dir: 1, page: set.slice(pg * per, pg * per + per), go: k => setAlbumPage(Math.max(0, Math.min(pages - 1, pg + k))), jump: setAlbumPage }
    const nd = duels.filter(d => d.kind === 'duel').length, ns = duels.length - nd
    right = <Sheet S={S} per={per} name={name} env={env} onPull={P.pull} pulled={P.pulled} phone={phone}
      title={set === duels ? 'Duels' : 'Best of every season'}
      sub={set === duels ? [nd && `${nd} Duel of the Day`, ns && `${ns} Giant-Slayer of the Day`].filter(Boolean).join(' · ') : 'highest Game Score each season'}
      album={set === duels ? null : 'Season best'}
      tools={duels.length > 0 && <Seg value={set === duels ? 'duels' : 'best'} onChange={v => { setAlbumSet(v); setAlbumPage(0) }} options={[['best', 'Season bests'], ['duels', `Duels · ${duels.length}`]]} />} />
  }
  return <>
    <Book tc={tc} phone={phone} stack onClose={onClose} head={head} left={left} right={right}
      summary={<span><b>{data.games.toLocaleString()} cards · {vols.length} seasons</b> · peak {r0(peak)}</span>}
      onKey={() => P.open} />
    {P.view}
  </>
}

// ── F · A team's season: every game's Player of the Game ────────────────────
export function TeamBinder({ team, sd: startSd, env, onClose, onFranchise }) {
  const phone = useIsPhone()
  const per = phone ? 6 : 9
  const [sd, setSd] = useState(startSd)
  const [loading, setLoading] = useState(false)
  const [order, setOrder] = useState('chrono')
  const [fran, setFran] = useState(null)
  const P = usePull(env, sd)
  const fcode = env.franchiseOf(team)
  useEffect(() => { env.getJSON(`/data/explorer/binders/f/${fcode.replace('@', '_')}.json`).then(setFran).catch(() => {}) }, [fcode])
  const seasons = fran ? fran.seasons.map(s => s.s) : [sd.season]
  const si = seasons.indexOf(sd.season)
  const codeIn = d => (fran ? (fran.seasons.find(s => s.s === d.season)?.code || team) : team)
  const t = codeIn(sd)
  const goSeason = k => {
    const lab = seasons[si + k]; if (!lab) return
    setLoading(true)
    env.loadSeason(lab).then(d => { setSd(d); S.reset() }).catch(() => {}).finally(() => setLoading(false))
  }
  const entries = useMemo(() => env.withTeams(sd, () => {
    const list = []; let reg = 0
    const games = sd.games.filter(g => g.teams.includes(t)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    for (const g of games) {
      const mine = g.players.filter(p => p.t === t); if (!mine.length) continue
      const p = mine.reduce((b, x) => (!b || env.nightScore(x) > env.nightScore(b) ? x : b), null)
      if (!g.post) reg++
      const info = env.cardGameInfo(g, t, sd, p)
      list.push({
        key: g.id, g, name: p.n, row: p, game: info, team: env.teamInfo(t), post: !!g.post, tier: tierOfRow(p), res: info.won ? 'w' : 'l',
        month: g.post ? 'Playoffs' : MONTHS[+g.date.slice(5, 7) - 1], gs: p.gs || 0,
        label: g.post ? info.band.label : `G${reg} · ${info.home === false ? '@' : 'vs'} ${info.oppAbbr}`,
        sub: `${info.won ? 'W' : 'L'} ${info.score}`, subColor: info.won ? '#1a7a4a' : '#a83232',
      })
    }
    return list
  }), [sd, t, env])
  const sorted = useMemo(() => order === 'chrono' ? entries : order === 'best' ? [...entries].sort((a, b) => b.gs - a.gs)
    : [...entries].sort((a, b) => a.name.localeCompare(b.name) || a.g.date.localeCompare(b.g.date)), [entries, order])
  const S = useSheets(sorted, per)
  const tinfo = sd.teams[t] || {}
  const tc = tinfo.color || '#173657'
  const champ = env.champion(sd, t)
  // Each player's Elo rank after his last game of the season (current, for a season in progress)
  const roster = useMemo(() => {
    const last = {}, gp = {}, other = {}
    sd.games.forEach(g => g.players.forEach(p => {
      if (p.t !== t) { if (!other[p.n] || g.date > other[p.n].date) other[p.n] = { date: g.date, t: p.t }; return }
      gp[p.n] = (gp[p.n] || 0) + 1; if (!last[p.n] || g.date >= last[p.n].date) last[p.n] = { date: g.date, rank: p.lrp ?? p.lr, elo: p.post }
    }))
    // Traded away: his rank when he left, marked with where he went
    // Regulars: 5+ games, or for a season just started, about a third of the team's games so far
    const teamGames = sd.games.filter(g => g.teams.includes(t)).length
    const minGp = Math.max(1, Math.min(5, Math.ceil(teamGames / 3)))
    return Object.entries(last).map(([n, x]) => ({ n, ...x, gp: gp[n], left: other[n] && other[n].date > x.date ? env.teamInfo(other[n].t).abbr : null })).filter(x => x.gp >= minGp)
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, 12)
  }, [sd, t])
  const reg = entries.filter(e => !e.post).length, po = entries.length - reg
  const tabs = order === 'chrono' && monthTabs(sorted, per, S)
  const newest = sd.season === seasons[seasons.length - 1]

  const head = <>
    <div className={styles.kicker}>Team binder · Player of the Game, every game</div>
    <h2 className={styles.title} style={{ color: tc }}>{tinfo.name || t}</h2>
    <div className={styles.headRow}>
      <SeasonSwitch label={sd.season} loading={loading} prev={si > 0 ? () => goSeason(-1) : null} next={si >= 0 && si < seasons.length - 1 ? () => goSeason(1) : null} />
      {onFranchise && <button type="button" className={styles.linkBtn} onClick={() => onFranchise(fcode)}>Franchise binder</button>}
    </div>
  </>
  const left = <>
    <p className={styles.line}>{entries.length} cards · {reg} regular season{po ? ` · ${po} playoffs` : ''}</p>
    <div className={`${styles.record} ${champ ? styles.recordChamp : ''}`}>
      {champ && <Trophy />}
      <span><b>{champ ? 'Champions' : tinfo.pw + tinfo.pl ? 'Playoffs' : newest ? 'In progress' : 'Missed the playoffs'}</b> · {tinfo.w}–{tinfo.l}{tinfo.pw + tinfo.pl ? `, ${tinfo.pw}–${tinfo.pl} in the playoffs` : ''}</span>
    </div>
    <Checklist entries={sorted} per={per} cur={S.cur} onJump={S.jump} label="Every game" />
    <div className={styles.box}>
      <div className={styles.boxHead}><span>Roster · {newest ? 'current' : 'season-end'} Elo rank</span><span className={styles.light}>league-wide</span></div>
      {roster.map(r => (
        <div key={r.n} className={styles.rosterRow}>
          <span className={styles.rankPill} data-tier={tierFor(r.rank).id}>{r.rank ? `#${r.rank}` : '—'}</span>
          <span className={styles.rosterName}>{r.n.replace(/\s*\(.*\)$/, '')}</span>
          <span className={styles.light}>{r.left ? `to ${r.left} · ` : ''}{r.gp} game{r.gp === 1 ? '' : 's'}</span>
          <b>{r0(r.elo)}</b>
        </div>
      ))}
    </div>
  </>
  const first = S.page[0]
  const right = <Sheet S={S} per={per} name="" env={env} onPull={P.pull} pulled={P.pulled} phone={phone} tabs={tabs}
    title={`Sheet ${S.cur + 1} of ${S.sheets}`} sub={first && order === 'chrono' ? `Games ${S.cur * per + 1}–${S.cur * per + S.page.length}` : order === 'best' ? 'best Game Score first' : order === 'player' ? 'by player' : ''}
    tools={<Seg value={order} onChange={v => { setOrder(v); S.reset() }} options={[['chrono', 'Schedule'], ['best', 'Best first'], ['player', 'By player']]} />} />
  return <>
    <Book tc={tc} phone={phone} onClose={onClose} head={head} left={left} right={right} tabs={tabs}
      summary={<span><b>{tinfo.w}–{tinfo.l}{champ ? ' · Champions' : ''}</b> · {entries.length} cards</span>}
      onKey={e => { if (P.open) return true; if (e.key === 'ArrowRight') { S.go(1); return true } if (e.key === 'ArrowLeft') { S.go(-1); return true } }} />
    {P.view}
  </>
}

// ── G · A franchise: every season on a shelf, legends and signature cards ─────
export function FranchiseBinder({ code, env, onClose, onSeason }) {
  const phone = useIsPhone()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(false)
  const [sel, setSel] = useState(null)
  const [view, setView] = useState('shelf')
  const [albumPage, setAlbumPage] = useState(-1) // -1: open on the newest sheet
  const P = usePull(env, null)
  useEffect(() => { env.getJSON(`/data/explorer/binders/f/${code.replace('@', '_')}.json`).then(x => { setD(x); setSel(x.seasons[x.seasons.length - 1]?.s) }).catch(() => setErr(true)) }, [code])
  const tc = d?.color || '#173657'
  const head = <>
    <div className={styles.kicker}>Franchise binder{d ? ` · since ${d.seasons[0].s}` : ''}</div>
    <h2 className={styles.title} style={{ color: tc }}>{d?.name || code}</h2>
    <div className={styles.headRow}><Seg value={view} onChange={setView} options={[['shelf', 'Shelf'], ['album', 'Album']]} /></div>
  </>
  if (err || !d) {
    return <Book tc="#173657" phone={phone} onClose={onClose} head={head} left={<p className={styles.line}>{err ? 'This franchise binder isn’t built yet. It appears after the next data update.' : 'Loading…'}</p>} right={<div className={styles.right} />} />
  }
  const s = d.seasons.find(x => x.s === sel)
  const sig = d.signature.map(c => fromIndex(env, c, { label: `${baseName(c.row.n).split(' ').slice(-1)[0]} · ${c.s}` }))
  const R = d.records
  const kindOf = x => (x.champ ? 'champ' : x.live ? 'live' : x.pw + x.pl ? 'po' : 'miss')
  if (view === 'album') return <FranchiseAlbum d={d} env={env} phone={phone} head={head} tc={tc} onClose={onClose} page={albumPage} setPage={setAlbumPage} />
  const left = <>
    <div className={styles.banners}>
      {d.titles.length ? d.titles.map(y => <div key={y} className={styles.banner}><small>Champions</small><b>{y.slice(0, 2)}{y.slice(5)}</b></div>)
        : <p className={styles.light}>No titles yet.</p>}
    </div>
    <p className={styles.line}>{d.seasons.length} seasons · {d.titles.length} title{d.titles.length === 1 ? '' : 's'} · {d.seasons.filter(x => x.pw + x.pl > 0 && !x.live).length} playoff trips</p>
    <div className={styles.boxLab}>Signature cards · best game in this uniform</div>
    <div className={styles.sigRow}>
      {sig.map(e => (
        <div key={e.key} className={styles.sig}>
          <button type="button" className={styles.pocketBtn} onClick={() => P.pull(e)} aria-label={`${e.label}: open card`}><Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} /></Fit></button>
          <small>{e.label}</small>
        </div>
      ))}
    </div>
    <div className={styles.box}>
      <div className={styles.boxHead}><span>Legends · peak Elo with the franchise</span></div>
      {d.legends.map((l, i) => (
        <div key={l.n} className={styles.rosterRow}>
          <span className={styles.light} style={{ width: 18 }}>{i + 1}</span>
          <span className={styles.rosterName}>{baseName(l.n)}</span>
          <span className={styles.light}>{l.s} · {l.games} games</span>
          <b>{r0(l.peak)}</b>
        </div>
      ))}
    </div>
  </>
  const best = s?.best && fromIndex(env, s.best)
  const right = (
    <div className={`${styles.right} ${styles.shelfPage}`}>
      <div className={styles.sheetHead}>
        <div className={styles.sheetTitle}><b>Every season</b><span>height = win %</span></div>
        <div className={styles.legend}><span data-k="champ">Title</span><span data-k="po">Playoffs</span><span data-k="miss">Missed</span>{d.seasons.some(x => x.live) && <span data-k="live">In progress</span>}</div>
      </div>
      <div className={styles.wallWrap}>
        <div className={styles.wall}>
          {d.seasons.map(x => {
            const pct = x.w + x.l ? x.w / (x.w + x.l) : 0.5
            return <button key={x.s} type="button" title={`${x.s} · ${x.name} · ${x.w}–${x.l}`} aria-label={`${x.s}, ${x.w}–${x.l}`} aria-pressed={x.s === sel}
              className={`${styles.bar} ${x.s === sel ? styles.barOn : ''}`} data-k={kindOf(x)}
              style={{ height: `${Math.round(18 + pct * 82)}%` }} onClick={() => setSel(x.s)} />
          })}
        </div>
        <div className={styles.plank} />
        <div className={styles.wallAxis}><span>{d.seasons[0].s}</span><span>{d.seasons[d.seasons.length - 1].s}</span></div>
      </div>
      {s && <div className={styles.selPanel}>
        {best && <span className={styles.selCard}><button type="button" className={styles.pocketBtn} onClick={() => P.pull(best)} aria-label="Open best card"><Fit><MiniCard name={best.name} row={best.row} game={best.game} team={best.team} headshot={env.headshot(best.name)} /></Fit></button></span>}
        <div className={styles.selText}>
          <small>{s.s} · {s.name}</small>
          <b>{s.w}–{s.l}{s.champ ? ' · Champions' : s.live ? (s.pw + s.pl ? ` · ${s.pw}–${s.pl} in the playoffs, in progress` : ' · in progress') : s.pw + s.pl ? ` · ${s.pw}–${s.pl} in the playoffs` : ''}</b>
          {s.potg && <span>Most Player of the Game cards: {baseName(s.potg[0])}, {s.potg[1]}</span>}
          {best && <span>Best game: {baseName(best.name)}, {s.best.row.pts} pts, {s.best.row.gs} Game Score</span>}
        </div>
        <button type="button" className={styles.primary} onClick={() => onSeason(s.code, s.s)}>Open season binder</button>
      </div>}
      <div className={styles.records}>
        <div><b>{R.best_record.w}–{R.best_record.l}</b><small>Best record · {R.best_record.s}</small></div>
        <div><b>{R.most_cards.games.toLocaleString()}</b><small>Most cards · {baseName(R.most_cards.n)}</small></div>
        <div><b>{R.best_gs.row.gs}</b><small>Best Game Score · {baseName(R.best_gs.row.n)} {R.best_gs.s.slice(2, 4)}</small></div>
        <div><b>{R.most_pts.row.pts}</b><small>Most points · {baseName(R.most_pts.row.n)} {R.most_pts.s.slice(2, 4)}</small></div>
      </div>
    </div>
  )
  return <>
    <Book tc={tc} phone={phone} stack onClose={onClose} head={head} left={left} right={right}
      summary={<span><b>{d.titles.length} title{d.titles.length === 1 ? '' : 's'}</b> · {d.seasons.length} seasons</span>} onKey={() => P.open} />
    {P.view}
  </>
}

// G · album: the franchise's milestones, then the best game of every season, newest sheet first
function FranchiseAlbum({ d, env, phone, head, tc, onClose, page, setPage }) {
  const P = usePull(env, null)
  const M = d.milestones || {}, R = d.records
  const abbr = c => env.teamInfo(c.o, c.on, c.oc).abbr
  const mk = (c, cap, color, sub) => c && fromIndex(env, c, { cap, capColor: color, sub: sub || `${baseName(c.row.n)} · ${fullDay(c.date)}` })
  const miles = [
    M.first && mk(M.first, 'First game', '#173657'),
    ...(M.clinch || []).map(c => mk(c, `Title · ${c.s}`, '#b07d1a', `${baseName(c.row.n)} · ${c.score} vs ${abbr(c)}`)),
    mk(R.best_gs, `Best Game Score · ${R.best_gs.row.gs}`, '#1a7a4a'),
    mk(R.most_pts, `Most points · ${R.most_pts.row.pts}`, '#a83232'),
    M.peak_elo && mk(M.peak_elo, `Peak Elo · ${r0(M.peak_elo.row.post)}`, '#6b3fa0'),
    M.swing && mk(M.swing, `Biggest swing · ${sgn(M.swing.row.post - M.swing.row.pre)}`, '#2b4c72'),
  ].filter(Boolean)
  const bests = d.seasons.filter(x => x.best).map(x => fromIndex(env, x.best, { label: `${x.s} · ${baseName(x.best.row.n).split(' ').slice(-1)[0]}`, sub: x.champ ? 'Champions' : x.live ? 'In progress' : `${x.w}–${x.l}`, subColor: x.champ ? '#b07d1a' : '#6a7684' }))
  const per = phone ? 6 : 9, pages = Math.max(1, Math.ceil(bests.length / per))
  const pg = page < 0 ? pages - 1 : Math.min(page, pages - 1)
  const page0 = bests.slice(pg * per, pg * per + per)
  const S = { cur: pg, sheets: pages, dir: 1, page: page0, go: k => setPage(Math.max(0, Math.min(pages - 1, pg + k))), jump: setPage }
  const left = <>
    <div className={styles.boxLab}>Milestones</div>
    <div className={styles.miles}>
      {miles.map(e => (
        <div key={e.key + e.cap} className={styles.mile}>
          <div className={styles.mileCap} style={{ background: e.capColor }}>{e.cap}</div>
          <div className={styles.mileCard}><button type="button" className={styles.pocketBtn} onClick={() => P.pull(e)} aria-label={`${e.cap}: open card`}><Fit><MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} slab={slabFor(e, e.cap)} /></Fit></button></div>
          <small>{e.sub}</small>
        </div>
      ))}
    </div>
  </>
  const right = <Sheet S={S} per={per} name="" env={env} onPull={P.pull} pulled={P.pulled} phone={phone} album="Season best"
    title="Best of every season" sub={page0.length ? `${page0[0].season} – ${page0[page0.length - 1].season}` : ''} />
  return <>
    <Book tc={tc} phone={phone} stack onClose={onClose} head={head} left={left} right={right}
      summary={<span><b>{d.titles.length} title{d.titles.length === 1 ? '' : 's'}</b> · {d.seasons.length} seasons</span>}
      onKey={e => { if (P.open) return true; if (e.key === 'ArrowRight') { S.go(1); return true } if (e.key === 'ArrowLeft') { S.go(-1); return true } }} />
    {P.view}
  </>
}

// ── League binders: sets drawn from every season (built by build_binders.py into league.json) ──
export const LEAGUE_SETS = [
  { id: 'titles', title: 'Title clinchers', short: 'Clinchers', color: '#8a6414', chrono: true, album: 'Title clincher',
    desc: 'The Player of the Game from every title-clinching game, NBA and ABA.' },
  { id: 'games', title: 'Greatest games', short: 'Greatest games', color: '#1a5c3a', album: 'All-time great',
    desc: 'The 54 highest Game Scores on record.' },
  { id: 'debuts', title: 'Greatest debuts', short: 'Debuts', color: '#173657', album: 'Debut',
    desc: 'The 54 best first games, by Game Score, graded against every debut on record.' },
  { id: 'stat', title: 'Stat-line legends', short: 'Stat lines', color: '#6b2d8a', chrono: true,
    desc: 'Every 60-point game, quadruple-double, 40-rebound game and 25-assist game on record.' },
  { id: 'crowns', title: 'Coronations', short: 'Coronations', color: '#9a2a2a', chrono: true,
    desc: 'The night each player first reached No. 1 in the Elo rankings (100 career games or more).' },
  { id: 'peaks', title: 'Peak Elo', short: 'Peaks', color: '#2b4c72', album: 'Peak Elo',
    desc: 'The 54 highest peak ratings ever: the card from the night each player hit his peak.' },
  { id: 'swings', title: 'Biggest swings', short: 'Swings', color: '#0f6a6a',
    desc: 'The 54 largest one-game Elo gains.' },
  { id: 'slayers', title: 'Giant-Slayers', short: 'Giant-Slayers', color: '#7a5a10', duel: 'slayer',
    desc: 'The 54 widest Elo gaps ever closed by a Giant-Slayer of the Day.' },
  { id: 'duels', title: 'Greatest duels', short: 'Duels', color: '#0b5f9e', duel: 'duel',
    desc: 'The 54 Duels of the Day with the highest combined Game Score.' },
]

const featLine = r => {
  const v = k => r[k] || 0
  const tens = ['pts', 'trb', 'ast', 'stl', 'blk'].filter(k => v(k) >= 10).length
  if (tens >= 4) return `${tens === 5 ? 'Quintuple' : 'Quadruple'}-double`
  if (v('pts') >= 60) return `${v('pts')} points`
  if (v('trb') >= 40) return `${v('trb')} rebounds`
  return `${v('ast')} assists`
}

export function leagueEntries(env, def, list) {
  return list.map((c, i) => {
    if (def.duel) {
      const side = x => duelSide(env, x.row, env.teamInfo(x.t, x.tn, x.tc))
      return {
        key: `${c.s}|${c.id}|${c.k}`, season: c.s, id: c.id, kind: c.k, rank: i + 1, date: c.date, gs: c.sum ?? c.gap ?? 0, tier: c.k,
        duel: { kind: c.k, scope: 'day', date: c.date, a: side(c.a), b: side(c.b) },
        label: `${i + 1}. ${shortName(c.a.row.n)}`, sub: c.k === 'slayer' ? `gap ${r0(c.gap)}` : `${c.sum} GmSc`,
      }
    }
    const r = c.row, abbr = env.teamInfo(c.t, c.tn, c.tc).abbr
    const sub = { titles: `${c.s}`, games: `${r.gs} GmSc`, debuts: `${r.gs} GmSc`, stat: featLine(r), crowns: fullDay(c.date),
      peaks: `Elo ${r0(r.post)}`, swings: sgn(r.post - r.pre) }[def.id]
    const label = def.id === 'titles' ? `${shortName(r.n)} · ${abbr}` : def.chrono ? shortName(r.n) : `${i + 1}. ${shortName(r.n)}`
    return fromIndex(env, c, { rank: i + 1, date: c.date, gs: r.gs || 0, label, sub, subColor: def.id === 'swings' ? '#1a7a4a' : undefined })
  })
}

export function LeagueBinder({ set: startSet, env, onClose, onCareer }) {
  const phone = useIsPhone()
  const per = phone ? 6 : 9
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  const [set, setSet] = useState(startSet || 'titles')
  const [order, setOrder] = useState('set')
  const P = usePull(env, null)
  useEffect(() => { env.getJSON('/data/explorer/binders/league.json').then(setData).catch(() => setErr(true)) }, [])
  const def = LEAGUE_SETS.find(x => x.id === set) || LEAGUE_SETS[0]
  const entries = useMemo(() => (data ? leagueEntries(env, def, data.sets[def.id] || []) : []), [data, def, env])
  const sorted = useMemo(() => order === 'set' ? entries
    : order === 'chrono' ? [...entries].sort((a, b) => a.date.localeCompare(b.date))
      : [...entries].sort((a, b) => b.gs - a.gs), [entries, order])
  const S = useSheets(sorted, per)
  const head = <>
    <div className={styles.kicker}>League binder</div>
    <h2 className={styles.title} style={{ color: def.color }}>{def.title}</h2>
  </>
  if (err || !data) {
    return <Book tc={def.color} phone={phone} onClose={onClose} head={head}
      left={<p className={styles.line}>{err ? 'The league binders aren’t built yet. They appear after the next data update.' : 'Loading…'}</p>} right={<div className={styles.right} />} />
  }
  const years = entries.length ? [entries.reduce((m, e) => (e.date < m ? e.date : m), entries[0].date), entries.reduce((m, e) => (e.date > m ? e.date : m), entries[0].date)] : null
  const people = new Set(entries.map(e => (e.duel ? e.duel.a.name : e.name)))
  const most = [...entries.reduce((m, e) => { const n = e.duel ? e.duel.a.name : e.name; m.set(n, (m.get(n) || 0) + 1); return m }, new Map())].sort((a, b) => b[1] - a[1])[0]
  const switchSet = id => { setSet(id); setOrder('set'); S.reset() }
  const left = <>
    <p className={styles.line}>{def.desc}{years ? ` ${years[0].slice(0, 4)}–${years[1].slice(0, 4)}.` : ''}</p>
    <div className={styles.stats}>
      <div><b>{entries.length}</b><small>Cards</small></div>
      <div><b>{people.size}</b><small>Players</small></div>
      {most && most[1] > 1 && <div className={styles.statWide}><b>{most[1]}</b><small>Most: {baseName(most[0])}</small></div>}
    </div>
    {most && most[1] > 1 && onCareer && <button type="button" className={styles.linkBtn} onClick={() => onCareer(most[0])}>{baseName(most[0])}’s career binder</button>}
    <div className={styles.boxLab}>League binders</div>
    <div className={styles.setList}>
      {LEAGUE_SETS.map(x => (
        <button key={x.id} type="button" className={x.id === def.id ? styles.setOn : ''} style={{ '--c': x.color }} onClick={() => switchSet(x.id)}>
          <i />{x.title}<span>{(data.sets[x.id] || []).length}</span>
        </button>
      ))}
    </div>
    <Checklist entries={sorted} per={per} cur={S.cur} onJump={S.jump} label={`Checklist · ${entries.length} cards`} />
  </>
  const options = def.chrono ? [['set', 'Chronological'], ['best', 'Best first']] : [['set', 'Ranked'], ['chrono', 'Chronological']]
  const right = <Sheet S={S} per={per} name="" env={env} onPull={P.pull} pulled={P.pulled} phone={phone}
    title={`Sheet ${S.cur + 1} of ${S.sheets}`} sub={def.chrono && order === 'set' && S.page[0] ? `${S.page[0].date.slice(0, 4)} – ${S.page[S.page.length - 1].date.slice(0, 4)}` : ''}
    album={def.album} tools={<Seg value={order} onChange={v => { setOrder(v); S.reset() }} options={options} />} />
  return <>
    <Book tc={def.color} phone={phone} onClose={onClose} head={head} left={left} right={right}
      summary={<span><b>{entries.length} cards</b> · {def.desc}</span>}
      onKey={e => { if (P.open) return true; if (e.key === 'ArrowRight') { S.go(1); return true } if (e.key === 'ArrowLeft') { S.go(-1); return true } }} />
    {P.view}
  </>
}
