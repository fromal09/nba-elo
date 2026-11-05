import { useState, useEffect, useMemo, useRef } from 'react'
import styles from './BinderRoom.module.css'
import shelf from './TrophyRoom.module.css'
import { LEAGUE_SETS, cardRef, leagueEntries } from './Binders'
import { BinderHost, primeBinders, binderJSON, binderHeadshots, binderTeamInfo, binderLogo } from './SeasonExplorer'
import PlayerSearch from './PlayerSearch'
import { useCollector, Coin } from './Collector'
import TrophyRoom, { FaceFit, Plate } from './TrophyRoom'
import CardDatabase from './CardDatabase'
import { useShelf } from './ShelfFx'
import { norm } from './predict'
import { goTo } from '../nav.js'
import { usePrizes, prizeNote } from './Prizes'
import { fromIndex, Fit } from './Binders'
import { MiniCard, DuelCard } from './PlayerCard'

/*
 * The Binders page: the Binder Room, one bookcase. Your binder lies open on the desk in front of it; the shelves hold
 * the trophy case (leaderboards), the league sets, the franchise binders and the legends' career binders; the card
 * catalog at the bottom opens the card database, beside the door to the Game Room (the week's Pick'em board on it).
 */

const baseName = n => n.replace(/\s*\(.*\)$/, '')
// A franchise's spine name: the nickname ("Trail Blazers" stays whole)
const nickOf = name => { const w = name.replace(/\s*\(.*\)$/, '').split(' '); return w.length > 2 && ['Trail', 'Golden'].includes(w[w.length - 2]) ? w.slice(-2).join(' ') : w[w.length - 1] }
const SHELVES = [['br-desk', 'Your desk'], ['br-trophy', 'Trophy case'], ['br-sets', 'League sets'], ['br-teams', 'Franchises'], ['br-legends', 'Legends'], ['br-catalog', 'Card catalog']]
const DRAWERS = [['player', 'Players'], ['franchise', 'Franchises'], ['season', 'Seasons'], ['set', 'Sets'], ['special', 'Specials'], ['tier', 'Tiers']]

// Album spine hardware: raised bands, and brass caps on the four corners
const Hubs = () => <span className={styles.hubs} aria-hidden="true"><i className={styles.hub} /><i className={styles.hub} /></span>
const Corners = () => <span className={styles.corners} aria-hidden="true"><i /><i /><i /><i /></span>

// Your desk: your binder lying closed under the lamp (your best card showing through its cover window), and the
// things you use every day as objects beside it: today's foil pack, the coin stack (Store), the Pick'em notepad
// (tonight's predictions, in the Game Room), a brass nameplate with your standing and the punch card toward the next big pull
function Foil({ label, sub, tone }) {
  return <span className={styles.foil} data-tone={tone}><span>FPR</span><b>{label}</b><span>{sub}</span></span>
}

function Desk({ C, shots, setOpen, env }) {
  const prizes = usePrizes(C)
  const me = C.me
  const lc = (me?.user.favoriteTeam && binderTeamInfo(me.user.favoriteTeam)?.color) || '#173657'
  const show = me ? (me.user.showcase.length ? me.user.showcase[0].card : me.stats.best?.card) : null
  const pack = !me ? null : me.open?.length ? { label: 'Your pack', sub: `${me.open[0].picked} OF ${me.open[0].total}`, tag: `Finish your pack · ${me.open[0].picked}/${me.open[0].total}`, go: () => C.resume(me.open[0].id) }
    : !me.today.claimed ? { label: me.today.bonusToday ? 'Two packs' : 'Daily pack', sub: '5 PICKS', tag: me.today.bonusToday ? 'Tear open 2 packs' : 'Tear open today’s pack', go: () => C.claim() }
    : null
  const p = me?.predict
  const pad = !me ? null : p?.unclaimed ? ['Cards waiting', `Choose your prediction card${p.unclaimed > 1 ? 's' : ''}`] : p?.open ? [`Tonight · ${p.games} games`, `${p.picked} of ${p.games} picked`] : ['Predictions', 'Make tonight’s picks']
  return (
    <div className={styles.scene}>
      <button type="button" className={styles.albumBtn} style={{ '--lc': lc }} onClick={() => (me ? setOpen({ kind: 'mine' }) : C.openAuth('signup'))} aria-label={me ? 'Open my binder' : 'Create an account to start a binder'}>
        <span className={styles.album}>
          <span className={styles.aSpine} aria-hidden="true"><i /><i /><i /><i /></span>
          <span className={styles.aWindow}>{show ? <FaceFit card={show} shots={shots} /> : <span className={styles.aEmpty}>Your best card shows here</span>}</span>
          <span className={styles.aLabel}><small>{me ? 'MY BINDER' : 'YOUR BINDER'}</small><b>{me ? me.user.username : 'START ONE'}</b></span>
          <span className={styles.aStrap} aria-hidden="true" />
          <span className={styles.aCorner} data-c="tr" aria-hidden="true" /><span className={styles.aCorner} data-c="br" aria-hidden="true" />
        </span>
        <span className={styles.tag}>{me ? 'Open my binder' : 'Start your binder'}</span>
      </button>

      <div className={styles.props}>
        <div className={styles.nameplate}>
          {me ? <>
            <span>{me.standing?.rank ? `NO. ${me.standing.rank} OF ${me.standing.of}` : 'UNRANKED'} · {me.stats.cards.toLocaleString()} CARDS · {me.today.streak}-DAY STREAK</span>
            <b>{(me.standing?.score || 0).toLocaleString()} POINTS</b>
          </> : <>
            <span>PICK FIVE CARDS, ONE OF THREE AT A TIME</span>
            <b>A FREE PACK EVERY DAY</b>
          </>}
        </div>
        <div className={styles.objects}>
          {!me ? <>
            <button type="button" className={styles.obj} onClick={() => C.openAuth('signup')}><Foil label="Daily pack" sub="FREE" /><span className={styles.tag}>Create an account</span></button>
            <button type="button" className={styles.obj} onClick={() => C.openAuth('login')}><span className={styles.key} aria-hidden="true"><i /><b /></span><span className={styles.tag}>Sign in</span></button>
          </> : <>
            {pack ? <button type="button" className={styles.obj} onClick={pack.go}><Foil label={pack.label} sub={pack.sub} /><span className={styles.tag}>{pack.tag}</span></button>
              : <div className={styles.obj} data-done=""><span className={styles.wrapper} aria-hidden="true" /><span className={styles.tag}>Today’s pack is open · next one tomorrow</span></div>}
            {!me.week.claimed && <button type="button" className={styles.obj} onClick={() => C.openTeam()}><Foil label="Team pack" sub="WEEKLY" tone="team" /><span className={styles.tag}>Weekly team pack</span></button>}
            <button type="button" className={styles.obj} onClick={() => setOpen({ kind: 'store' })}>
              <span className={styles.coins} aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ '--i': i }} />)}</span>
              <span className={styles.tag}><Coin size={14} />Store · {(me.coins?.balance ?? 0).toLocaleString()}</span>
            </button>
            {(prizes.count > 0 || prizes.won.length > 0) && <div className={styles.prizeObj}>
              <div className={styles.stand}>
                {prizes.won.slice(-3).map((w, i, a) => { const e = fromIndex(env, w.card, { key: w.day + w.which })
                  return <button key={w.day + w.which} type="button" className={styles.standCard} style={{ '--i': i - (a.length - 1) / 2 }} onClick={() => setOpen({ kind: 'card', card: w.card })}
                    aria-label={`Prize card from ${w.day}: ${e.name}`}>
                    <Fit>{e.duel ? <DuelCard {...e.duel} /> : <MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} />}</Fit></button> })}
                {prizes.count > 0 && <button type="button" className={styles.envelope} disabled={!prizes.waiting[0]} onClick={() => setOpen({ kind: 'prize', day: prizes.waiting[0].day, which: prizes.waiting[0].which })}
                  aria-label="Choose your prize card"><span className={styles.seal}>{prizes.count}</span><b>PRIZE</b><small>{prizes.count === 1 ? 'CARD' : 'CARDS'}</small></button>}
              </div>
              <span className={styles.tag}>{prizes.count > 0 ? `Choose your prize card · ${prizeNote(prizes)}` : `Prize cards · ${prizes.won.length} won`}</span>
            </div>}
            <button type="button" className={styles.obj} onClick={() => goTo('gameroom', { open: p?.unclaimed ? 'history' : 'predict' })}>
              <span className={styles.pad}><b>{pad[0]}</b><span>{pad[1]}</span></span>
              <span className={styles.tag}>Predictions · Game Room</span>
            </button>
          </>}
        </div>
        {me?.meter && <div className={styles.punch} title="At most ten packs between Legend-or-better pulls">
          <span>{me.meter.until === 1 ? 'NEXT PACK GUARANTEES A LEGEND OR BETTER' : `LEGEND OR BETTER WITHIN ${me.meter.until} PACKS`}</span>
          <span className={styles.holes} aria-hidden="true">{Array.from({ length: me.meter.every }, (_, i) => <i key={i} data-on={i < me.meter.since ? '' : undefined} />)}</span>
        </div>}
      </div>
    </div>
  )
}

export default function BinderRoom({ players, onSelectPlayer, start }) {
  const [index, setIndex] = useState(null)
  const [league, setLeague] = useState(null)
  const [err, setErr] = useState(false)
  const [shots, setShots] = useState({})
  const [best, setBest] = useState(null)
  // The binder open on top of the room: { kind, ..., n }. n is new on every open, so a new request restarts the host
  const [open, setOpenRaw] = useState(null)
  const setOpen = b => setOpenRaw(b ? { ...b, n: Date.now() + Math.random() } : null)
  const [past, setPast] = useState(false)
  const [db, setDb] = useState(null) // the card database, open: { focus }
  const C = useCollector()
  const [picks, setPicks] = useState(null)
  useEffect(() => { if (!C.down && C.me !== undefined) C.loadStandings?.('week').then(setPicks).catch(() => {}) }, [C.down, C.me === undefined])
  // Asked from elsewhere (the account bar, a /binders?open= link): open my binder or the store once signed in
  const used = useRef(null)
  useEffect(() => {
    if (!start || used.current === start.n || C.me === undefined) return
    used.current = start.n
    if (C.me) setOpen({ kind: start.kind }); else C.openAuth('login')
  }, [start?.n, C.me === undefined, !!C.me])
  // The address names the open page of yours, so it can be shared or opened in a new tab
  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/binders') return
    const url = open && ['mine', 'store'].includes(open.kind) ? `/binders?open=${open.kind}` : '/binders'
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url)
  }, [open?.kind, open?.n])
  useEffect(() => {
    binderJSON('/data/explorer/index.json').then(setIndex).catch(() => {})
    binderJSON('/data/explorer/binders/league.json').then(setLeague).catch(() => setErr(true))
    binderJSON('/data/explorer/ranks.json').then(setBest).catch(() => {})
    binderHeadshots().then(setShots)
  }, [])
  primeBinders(players, index, best)
  const legends = useMemo(() => [...(players || [])].sort((a, b) => b.peak_elo - a.peak_elo).slice(0, 30), [players])
  const teams = (league?.franchises || []).filter(f => f.active === !past)
  const cards = useMemo(() => (league ? Object.values(league.sets).reduce((n, l) => n + l.length, 0) : 0), [league])
  const owned = C.me ? C.owned : null
  const setsHave = useMemo(() => Object.fromEntries(LEAGUE_SETS.map(d => [d.id, owned && !d.duel ? (league?.sets[d.id] || []).filter(c => owned.has(cardRef(c))).length : 0])), [league, owned])
  const started = Object.values(setsHave).filter(n => n > 0).length
  // Hover previews, the flight off the shelf and the phone preview sheet; the binder opens when they finish
  const env = useMemo(() => ({ teamInfo: binderTeamInfo, headshot: n => shots?.[norm(n)]?.headshot }), [shots])
  const fx = useShelf(setOpen, env)
  const fans = useMemo(() => Object.fromEntries(LEAGUE_SETS.map(d => [d.id, league?.sets[d.id] ? leagueEntries(env, d, league.sets[d.id].slice(0, 3)) : []])), [league, env])
  const goTo = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const ready = !C.down && C.me !== undefined
  const lo = legends.length ? legends[legends.length - 1].peak_elo : 0, hi = legends.length ? legends[0].peak_elo : 1

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.plaque}>
          <span>EST. 1946</span>
          <h1>The Binder Room</h1>
        </div>
        <p>Every game on record is a card. One bookcase holds them all: your binder, the leaders, every set, every franchise and every legend.</p>
        <PlayerSearch players={players} variant="hero" label="Find any player’s career binder" action="to open the career binder"
          onSelect={p => setOpen({ kind: 'career', name: p.name })} />
        <nav className={styles.jump} aria-label="Shelves">
          {SHELVES.filter(([id]) => id !== 'br-desk' || ready).map(([id, label]) => <button key={id} type="button" onClick={() => goTo(id)}>{label}</button>)}
        </nav>
      </header>

      {ready && <section id="br-desk" className={styles.desk} aria-label="Your desk"><Desk C={C} shots={shots} setOpen={setOpen} env={env} /></section>}

      <div className={styles.caseWrap}>
        <div className={styles.bookcase}>
          <TrophyRoom id="br-trophy" shots={shots} onOpen={setOpen} />

          <section id="br-sets" className={shelf.bay} aria-labelledby="br-sets-h">
            <div className={shelf.bayHead}>
              <Plate id="br-sets-h">League sets · {LEAGUE_SETS.length}</Plate>
              <span className={shelf.lede}>{league ? `${cards.toLocaleString()} cards${owned ? ` · a gold ribbon marks the ${started === 1 ? 'set' : `${started} sets`} you’ve started` : ''}` : ''}</span>
            </div>
            {err ? <p className={styles.note}>The league binders aren’t built yet. They appear after the next data update.</p>
            : <div className={styles.row} data-tall="">
              {LEAGUE_SETS.map((def, i) => {
                const n = league?.sets[def.id]?.length, have = setsHave[def.id]
                return (
                  <button key={def.id} type="button" className={styles.lspine} style={{ '--c': def.color, '--h': `${86 + ((i * 37) % 4) * 4}%`, '--fs': def.title.length > 14 ? 17 : def.title.length > 11 ? 20 : 23 }}
                    {...fx.bind({ key: `l-${def.id}`, kind: 'League binder', title: def.title, color: def.color, ink: def.color, desc: def.desc, meta: n != null ? `${n} cards${owned ? ` · you have ${have}` : ''}` : '', fan: fans[def.id], target: { kind: 'league', set: def.id } })} aria-label={`${def.title}: ${n ?? '…'} cards${have ? `, you have ${have}` : ''}`}>
                    {have > 0 && <span className={styles.ribbon} aria-hidden="true" />}
                    <Hubs />
                    <span className={styles.frame}><b>{def.title}</b></span>
                    <span className={styles.foot}><i className={styles.hub} aria-hidden="true" /><small>{have > 0 ? `${have}/${n}` : n ?? ''}</small></span>
                    <Corners />
                  </button>
                )
              })}
              <span className={styles.bookend} aria-hidden="true" />
            </div>}
            {fx.peekIn('br-sets')}
            <div className={shelf.plank} />
          </section>

          <section id="br-teams" className={shelf.bay} aria-labelledby="br-teams-h">
            <div className={shelf.bayHead}>
              <Plate id="br-teams-h">Franchises · {teams.length || ''}</Plate>
              <span className={shelf.lede}>Every season on a shelf, each opening that year’s team binder · stars are titles</span>
              <div className={shelf.seg} role="group" aria-label="Franchises">
                <button type="button" aria-pressed={!past} data-on={!past ? '' : undefined} onClick={() => setPast(false)}>Current teams</button>
                <button type="button" aria-pressed={past} data-on={past ? '' : undefined} onClick={() => setPast(true)}>Past franchises</button>
              </div>
            </div>
            <div className={styles.row} data-teams="">
              {teams.map(f => {
                const logo = f.active ? binderLogo(f.code) : null
                return (
                  <button key={f.code} type="button" className={styles.tspine} style={{ '--c': f.color || '#173657' }}
                    {...fx.bind({ key: `f-${f.code}`, kind: f.active ? 'Franchise binder' : 'Past franchise', title: `${f.name}${f.code.includes('@') ? ' (ABA)' : ''}`, color: f.color || '#173657', ink: f.color || '#173657',
                      desc: `${f.active ? `Since ${f.first}` : `${f.first} – ${f.last}`}. Every season on a shelf, each opening that year’s team binder.`, meta: f.titles ? `${f.titles} title${f.titles === 1 ? '' : 's'}` : '',
                      logo, initials: f.code.split('@')[0], target: { kind: 'franchise', code: f.code } })}
                    aria-label={`${f.name}${f.code.includes('@') ? ' (ABA)' : ''}${f.titles ? `, ${f.titles} title${f.titles === 1 ? '' : 's'}` : ''}`}>
                    <i className={styles.hub} aria-hidden="true" />
                    <em>{logo ? <img src={logo} alt="" loading="lazy" /> : f.code.split('@')[0]}</em>
                    <span className={styles.frame}><b>{nickOf(f.name)}{f.code.includes('@') ? ' · ABA' : ''}</b></span>
                    <small>{f.titles > 0 ? `${f.titles}★` : ''}</small>
                    <i className={styles.hub} aria-hidden="true" />
                    <Corners />
                  </button>
                )
              })}
            </div>
            {fx.peekIn('br-teams')}
            <div className={shelf.plank} />
          </section>

          <section id="br-legends" className={shelf.bay} aria-labelledby="br-legends-h">
            <div className={shelf.bayHead}>
              <Plate id="br-legends-h">Legends · top 30 peak Elo</Plate>
              <span className={shelf.lede}>Spine height follows peak Elo</span>
            </div>
            <div className={styles.row} data-tall="">
              {legends.map((p, i) => (
                <button key={p.name} type="button" className={styles.gspine} data-gold={i < 5 ? '' : undefined} aria-label={`${p.name}, peak Elo ${Math.round(p.peak_elo).toLocaleString()}`}
                  {...fx.bind({ key: `g-${p.name}`, kind: 'Career binder', title: baseName(p.name), color: i < 5 ? '#b8902e' : '#173657', ink: '#173657',
                    desc: `Peak Elo ${Math.round(p.peak_elo).toLocaleString()}, No. ${i + 1} on record. Every game of his career, season by season.`, meta: '', initials: baseName(p.name).split(' ').map(w => w[0]).join('').slice(0, 3), target: { kind: 'career', name: p.name } })}
                  style={{ '--h': `${Math.round(74 + (p.peak_elo - lo) / (hi - lo || 1) * 26)}%` }}>
                  <i className={styles.hub} aria-hidden="true" />
                  <em>{i + 1}</em>
                  <span className={styles.frame}><b>{baseName(p.name)}</b></span>
                  <small>{Math.round(p.peak_elo).toLocaleString()}</small>
                  <i className={styles.hub} aria-hidden="true" />
                  <Corners />
                </button>
              ))}
            </div>
            {fx.peekIn('br-legends')}
            <div className={shelf.plank} />
          </section>

          <section id="br-catalog" className={`${shelf.bay} ${styles.lastBay}`} aria-label="Card catalog and the door to the Game Room">
            <div className={styles.cabinets}>
              <div className={styles.catalog}>
                <Plate as="h2">Card catalog</Plate>
                <div className={styles.drawers}>
                  {DRAWERS.map(([k, l]) => <button key={k} type="button" className={styles.drawer} onClick={() => setDb({ focus: k })}><span>{l}</span><i aria-hidden="true" /></button>)}
                </div>
                <small className={styles.cabNote}>Every card on record, searchable. Each drawer opens the card database ready to filter that way.</small>
              </div>
              <div className={styles.chalk}>
                <Plate as="h2">To the Game Room</Plate>
                <a className={styles.door} href="/?view=gameroom" onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); goTo('gameroom') }}>
                  <b>THE GAME ROOM</b><span>Predictions · King of the Court · Hang the Banner · Five Challenge</span><i aria-hidden="true">→</i>
                </a>
                {picks && picks.leaders.length > 0 && <div className={styles.board}>
                  {picks.leaders.slice(0, 5).map(l => (
                    <button key={l.username} type="button" data-you={C.me?.user.username === l.username ? '' : undefined} onClick={() => goTo('gameroom', { open: 'standings' })}>
                      <b>{l.rank}</b><span>{l.username}</span><small>{l.picks[0]}–{l.picks[1]}</small><strong>{l.score}</strong>
                    </button>
                  ))}
                  {picks.you?.rank > 5 && <button type="button" data-you="" onClick={() => goTo('gameroom', { open: 'standings' })}>
                    <b>{picks.you.rank}</b><span>{picks.you.username} (you)</span><small>{picks.you.picks[0]}–{picks.you.picks[1]}</small><strong>{picks.you.score}</strong>
                  </button>}
                  <small className={styles.chalkNote}>Pick’em this week · {picks.entrants} collector{picks.entrants === 1 ? '' : 's'} · top 10 win {picks.payouts?.top10} Coins</small>
                </div>}
              </div>
            </div>
          </section>
        </div>
        <div className={styles.base} />
      </div>

      {fx.layers}
      {db && <CardDatabase league={league} shots={shots} focus={db.focus} covered={!!open} onOpen={setOpen} onClose={() => setDb(null)} />}
      {open && <BinderHost key={open.n} start={open} shots={shots} onClose={() => setOpen(null)}
        onProfile={n => { const p = players?.find(x => x.name === n); setOpen(null); if (p) onSelectPlayer?.(p) }} />}
    </div>
  )
}
