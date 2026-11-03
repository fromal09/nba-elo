import { useState, useEffect, useMemo, useRef } from 'react'
import styles from './BinderRoom.module.css'
import shelf from './TrophyRoom.module.css'
import { LEAGUE_SETS, cardRef } from './Binders'
import { BinderHost, primeBinders, binderJSON, binderHeadshots, binderTeamInfo, binderLogo } from './SeasonExplorer'
import PlayerSearch from './PlayerSearch'
import { useCollector, Meter, Coin } from './Collector'
import TrophyRoom, { FaceFit, Plate } from './TrophyRoom'
import CardDatabase from './CardDatabase'

/*
 * The Binders page: the Binder Room, one bookcase. Your binder lies open on the desk in front of it; the shelves hold
 * the trophy case (leaderboards), the league sets, the franchise binders and the legends' career binders; the card
 * catalog at the bottom opens the card database, beside the week's Pick'em board.
 */

const baseName = n => n.replace(/\s*\(.*\)$/, '')
// A franchise's spine name: the nickname ("Trail Blazers" stays whole)
const nickOf = name => { const w = name.replace(/\s*\(.*\)$/, '').split(' '); return w.length > 2 && ['Trail', 'Golden'].includes(w[w.length - 2]) ? w.slice(-2).join(' ') : w[w.length - 1] }
const SHELVES = [['br-desk', 'Your desk'], ['br-trophy', 'Trophy case'], ['br-sets', 'League sets'], ['br-teams', 'Franchises'], ['br-legends', 'Legends'], ['br-catalog', 'Card catalog']]
const DRAWERS = [['player', 'Players'], ['franchise', 'Franchises'], ['season', 'Seasons'], ['set', 'Sets'], ['special', 'Specials'], ['tier', 'Tiers']]

// Album spine hardware: raised bands, and brass caps on the four corners
const Hubs = () => <span className={styles.hubs} aria-hidden="true"><i className={styles.hub} /><i className={styles.hub} /></span>
const Corners = () => <span className={styles.corners} aria-hidden="true"><i /><i /><i /><i /></span>

function Desk({ C, shots, setOpen }) {
  if (!C.me) return (
    <div className={styles.binder} data-out="">
      <div className={styles.page1}>
        <div className={styles.who}>
          <span className={styles.avatar}>★</span>
          <div><small>Start collecting</small><b>A free pack every day</b></div>
        </div>
        <p className={styles.pitch}>Pick five cards, one of three at a time, from last night’s games and 80 years of history. Plus a weekly pack for the team you choose.</p>
        <div className={styles.deskBtns}>
          <button type="button" className={styles.goldBtn} onClick={() => C.openAuth('signup')}>Create an account</button>
          <button type="button" className={styles.navyBtn} onClick={() => C.openAuth('login')}>Sign in</button>
        </div>
      </div>
      <div className={styles.rings} aria-hidden="true"><i /><i /><i /></div>
      <div className={styles.page2} data-out="">
        <small className={styles.pageKick}>YOUR SHOWCASE</small>
        <div className={styles.pockets}>{[0, 1, 2].map(i => <span key={i} className={styles.pocket} data-empty="" />)}</div>
      </div>
    </div>
  )
  const me = C.me
  const show = me.user.showcase.length ? me.user.showcase.map(x => x.card) : me.stats.best ? [me.stats.best.card] : []
  return (
    <div className={styles.binder}>
      <div className={styles.page1}>
        <div className={styles.who}>
          <span className={styles.avatar}>{me.user.username[0].toUpperCase()}</span>
          <div><small>My binder</small><b>{me.user.username}</b></div>
        </div>
        <div className={styles.stats}>
          <div><b>{(me.standing?.score || 0).toLocaleString()}</b><small>points</small></div>
          <div><b>{me.standing?.rank ? `No. ${me.standing.rank}` : '—'}</b><small>{me.standing?.of ? `of ${me.standing.of} binders` : 'rank'}</small></div>
          <div><b>{me.stats.cards.toLocaleString()}</b><small>cards</small></div>
          <div><b>{me.today.streak} day{me.today.streak === 1 ? '' : 's'}</b><small>streak</small></div>
        </div>
        <Meter meter={me.meter} />
        <div className={styles.deskBtns}>
          {me.open?.length > 0
            ? <button type="button" className={styles.goldBtn} onClick={() => C.resume(me.open[0].id)}>Finish your pack · {me.open[0].picked}/{me.open[0].total}</button>
            : !me.today.claimed && <button type="button" className={styles.goldBtn} onClick={() => C.claim()}>{me.today.bonusToday ? 'Open 2 packs' : 'Open today’s pack'}</button>}
          {!me.week.claimed && <button type="button" className={styles.teamBtn} onClick={() => C.openTeam()}>Weekly team pack</button>}
          <button type="button" className={styles.predictBtn} onClick={() => setOpen({ kind: 'predict' })}>{me.predict?.unclaimed ? `Choose your prediction card${me.predict.unclaimed > 1 ? 's' : ''}` : me.predict?.open ? `Predict today’s games · ${me.predict.picked}/${me.predict.games}` : 'Predictions'}</button>
          <button type="button" className={styles.storeBtn} onClick={() => setOpen({ kind: 'store' })}><Coin size={18} />Store · {(me.coins?.balance ?? 0).toLocaleString()}</button>
          <button type="button" className={styles.navyBtn} onClick={() => setOpen({ kind: 'mine' })}>Open my binder</button>
        </div>
      </div>
      <div className={styles.rings} aria-hidden="true"><i /><i /><i /></div>
      <div className={styles.page2}>
        <small className={styles.pageKick}>SHOWCASE</small>
        <div className={styles.pockets}>
          {[0, 1, 2].map(i => show[i]
            ? <button key={i} type="button" className={styles.pocket} onClick={() => setOpen({ kind: 'card', card: show[i] })} title="Open the card"><FaceFit card={show[i]} shots={shots} /></button>
            : <span key={i} className={styles.pocket} data-empty="" />)}
        </div>
        {me.user.showcase.length < 3 && <small className={styles.pageNote}>Star cards in your binder to show them here.</small>}
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
  // Asked from elsewhere (the account bar, a /binders?open= link): open my binder, the store or Predictions once signed in
  const used = useRef(null)
  useEffect(() => {
    if (!start || used.current === start.n || C.me === undefined) return
    used.current = start.n
    if (C.me) setOpen({ kind: start.kind }); else C.openAuth('login')
  }, [start?.n, C.me === undefined, !!C.me])
  // The address names the open page of yours, so it can be shared or opened in a new tab
  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/, '') !== '/binders') return
    const url = open && ['mine', 'store', 'predict'].includes(open.kind) ? `/binders?open=${open.kind}` : '/binders'
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

      {ready && <section id="br-desk" className={styles.desk} aria-label="Your desk"><Desk C={C} shots={shots} setOpen={setOpen} /></section>}

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
                    onClick={() => setOpen({ kind: 'league', set: def.id })} title={def.desc} aria-label={`${def.title}: ${n ?? '…'} cards${have ? `, you have ${have}` : ''}`}>
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
                  <button key={f.code} type="button" className={styles.tspine} style={{ '--c': f.color || '#173657' }} onClick={() => setOpen({ kind: 'franchise', code: f.code })}
                    title={`${f.name}${f.code.includes('@') ? ' (ABA)' : ''} · ${f.active ? `since ${f.first}` : `${f.first} – ${f.last}`}`}
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
            <div className={shelf.plank} />
          </section>

          <section id="br-legends" className={shelf.bay} aria-labelledby="br-legends-h">
            <div className={shelf.bayHead}>
              <Plate id="br-legends-h">Legends · top 30 peak Elo</Plate>
              <span className={shelf.lede}>Spine height follows peak Elo</span>
            </div>
            <div className={styles.row} data-tall="">
              {legends.map((p, i) => (
                <button key={p.name} type="button" className={styles.gspine} data-gold={i < 5 ? '' : undefined} onClick={() => setOpen({ kind: 'career', name: p.name })}
                  style={{ '--h': `${Math.round(74 + (p.peak_elo - lo) / (hi - lo || 1) * 26)}%` }} title={`${p.name} · peak Elo ${Math.round(p.peak_elo).toLocaleString()}`}>
                  <i className={styles.hub} aria-hidden="true" />
                  <em>{i + 1}</em>
                  <span className={styles.frame}><b>{baseName(p.name)}</b></span>
                  <small>{Math.round(p.peak_elo).toLocaleString()}</small>
                  <i className={styles.hub} aria-hidden="true" />
                  <Corners />
                </button>
              ))}
            </div>
            <div className={shelf.plank} />
          </section>

          <section id="br-catalog" className={`${shelf.bay} ${styles.lastBay}`} aria-label="Card catalog and Pick’em">
            <div className={styles.cabinets}>
              <div className={styles.catalog}>
                <Plate as="h2">Card catalog</Plate>
                <div className={styles.drawers}>
                  {DRAWERS.map(([k, l]) => <button key={k} type="button" className={styles.drawer} onClick={() => setDb({ focus: k })}><span>{l}</span><i aria-hidden="true" /></button>)}
                </div>
                <small className={styles.cabNote}>Every card on record, searchable. Each drawer opens the card database ready to filter that way.</small>
              </div>
              {picks && picks.leaders.length > 0 && <div className={styles.chalk}>
                <Plate as="h2">Pick’em this week</Plate>
                <div className={styles.board}>
                  {picks.leaders.slice(0, 5).map(l => (
                    <button key={l.username} type="button" data-you={C.me?.user.username === l.username ? '' : undefined} onClick={() => C.openPredict()}>
                      <b>{l.rank}</b><span>{l.username}</span><small>{l.picks[0]}–{l.picks[1]}</small><strong>{l.score}</strong>
                    </button>
                  ))}
                  {picks.you?.rank > 5 && <button type="button" data-you="" onClick={() => C.openPredict()}>
                    <b>{picks.you.rank}</b><span>{picks.you.username} (you)</span><small>{picks.you.picks[0]}–{picks.you.picks[1]}</small><strong>{picks.you.score}</strong>
                  </button>}
                  <small className={styles.chalkNote}>{picks.entrants} collector{picks.entrants === 1 ? '' : 's'} · top 10 win {picks.payouts?.top10} Coins</small>
                </div>
              </div>}
            </div>
          </section>
        </div>
        <div className={styles.base} />
      </div>

      {db && <CardDatabase league={league} shots={shots} focus={db.focus} covered={!!open} onOpen={setOpen} onClose={() => setDb(null)} />}
      {open && <BinderHost key={open.n} start={open} shots={shots} onClose={() => setOpen(null)}
        onProfile={n => { const p = players?.find(x => x.name === n); setOpen(null); if (p) onSelectPlayer?.(p) }} />}
    </div>
  )
}
