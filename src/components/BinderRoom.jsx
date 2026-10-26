import { useState, useEffect, useMemo } from 'react'
import styles from './BinderRoom.module.css'
import { MiniCard, DuelCard } from './PlayerCard'
import { LEAGUE_SETS, leagueEntries } from './Binders'
import { BinderHost, primeBinders, binderJSON, binderHeadshots, binderTeamInfo, binderLogo } from './SeasonExplorer'
import PlayerSearch from './PlayerSearch'
import { norm } from './predict'

/*
 * The Binders page: every binder in one room. League-wide sets (title clinchers, greatest debuts...),
 * franchise binders (which open each season's team binder), and any player's career binder.
 */

const baseName = n => n.replace(/\s*\(.*\)$/, '')

// A card drawn at full size and scaled down to a fixed width
function Thumb({ children, w }) {
  const k = w / 340
  return <span className={styles.thumb} style={{ width: w, height: 476 * k }}><span style={{ transform: `scale(${k})` }}>{children}</span></span>
}

function Cover({ def, list, env, onOpen }) {
  const peek = useMemo(() => leagueEntries(env, def, (list || []).slice(0, 3)), [list, def, env])
  return (
    <button type="button" className={styles.cover} style={{ '--c': def.color }} onClick={onOpen}>
      <span className={styles.coverText}>
        <small>League binder</small>
        <b>{def.title}</b>
        <span>{def.desc}</span>
        <em>{list ? `${list.length} cards` : 'Loading…'}</em>
      </span>
      <span className={styles.fan} aria-hidden="true">
        {peek.map((e, i) => (
          <span key={e.key} className={styles.fanCard} style={{ '--i': i }}>
            <Thumb w={92}>{e.duel ? <DuelCard {...e.duel} /> : <MiniCard name={e.name} row={e.row} game={e.game} team={e.team} headshot={env.headshot(e.name)} />}</Thumb>
          </span>
        ))}
      </span>
    </button>
  )
}

export default function BinderRoom({ players, onSelectPlayer }) {
  const [index, setIndex] = useState(null)
  const [league, setLeague] = useState(null)
  const [err, setErr] = useState(false)
  const [shots, setShots] = useState({})
  const [best, setBest] = useState(null)
  const [open, setOpen] = useState(null) // the binder to open: { kind, ... }
  const [past, setPast] = useState(false)
  useEffect(() => {
    binderJSON('/data/explorer/index.json').then(setIndex).catch(() => {})
    binderJSON('/data/explorer/binders/league.json').then(setLeague).catch(() => setErr(true))
    binderJSON('/data/explorer/ranks.json').then(setBest).catch(() => {})
    binderHeadshots().then(setShots)
  }, [])
  primeBinders(players, index, best)
  const env = useMemo(() => ({ teamInfo: binderTeamInfo, headshot: n => shots?.[norm(n)]?.headshot }), [shots])
  const legends = useMemo(() => [...(players || [])].sort((a, b) => b.peak_elo - a.peak_elo).slice(0, 30), [players])
  const teams = (league?.franchises || []).filter(f => f.active === !past)
  const cards = useMemo(() => (league ? Object.values(league.sets).reduce((n, l) => n + l.length, 0) : 0), [league])

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.kicker}>Binders</div>
        <h1>The Binder Room</h1>
        <p>Every game on record is a card. Open a player’s career, a franchise’s history, or a league-wide set.</p>
        <PlayerSearch players={players} variant="hero" label="Find any player’s career binder" action="to open the career binder"
          onSelect={p => setOpen({ kind: 'career', name: p.name })} />
      </header>

      <section className={styles.section}>
        <div className={styles.head}><h2>League binders</h2><span>{league ? `${LEAGUE_SETS.length} sets · ${cards.toLocaleString()} cards` : ''}</span></div>
        {err ? <p className={styles.note}>The league binders aren’t built yet. They appear after the next data update.</p>
          : <div className={styles.covers}>
            {LEAGUE_SETS.map(def => <Cover key={def.id} def={def} list={league?.sets[def.id]} env={env} onOpen={() => setOpen({ kind: 'league', set: def.id })} />)}
          </div>}
      </section>

      <section className={styles.section}>
        <div className={styles.head}>
          <h2>Franchise binders</h2>
          <div className={styles.seg} role="tablist">
            <button type="button" role="tab" aria-selected={!past} className={!past ? styles.segOn : ''} onClick={() => setPast(false)}>Current teams</button>
            <button type="button" role="tab" aria-selected={past} className={past ? styles.segOn : ''} onClick={() => setPast(true)}>Past franchises</button>
          </div>
        </div>
        <p className={styles.sub}>Every season on a shelf, each one opening that year’s team binder: Player of the Game, every game.</p>
        <div className={styles.teams}>
          {teams.map(f => {
            const logo = f.active ? binderLogo(f.code) : null
            return (
              <button key={f.code} type="button" className={styles.team} style={{ '--c': f.color || '#173657' }} onClick={() => setOpen({ kind: 'franchise', code: f.code })}>
                <span className={styles.teamMark}>{logo ? <img src={logo} alt="" loading="lazy" /> : <b>{f.code.split('@')[0]}</b>}</span>
                <span className={styles.teamText}>
                  <b>{f.name}{f.code.includes('@') ? ' (ABA)' : ''}</b>
                  <small>{f.active ? `Since ${f.first}` : `${f.first} – ${f.last}`}</small>
                </span>
                {f.titles > 0 && <span className={styles.rings} title={`${f.titles} title${f.titles === 1 ? '' : 's'}`}>{f.titles}<i>★</i></span>}
              </button>
            )
          })}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.head}><h2>Legends’ career binders</h2><span>the 30 highest peak Elo ratings</span></div>
        <div className={styles.shelf}>
          <div className={styles.spines}>
            {legends.map((p, i) => (
              <button key={p.name} type="button" className={styles.spine} onClick={() => setOpen({ kind: 'career', name: p.name })}
                style={{ '--h': `${Math.round(78 + (p.peak_elo - legends[legends.length - 1].peak_elo) / (legends[0].peak_elo - legends[legends.length - 1].peak_elo || 1) * 22)}%` }}
                title={`${p.name} · peak Elo ${Math.round(p.peak_elo).toLocaleString()}`}>
                <i>{i + 1}</i><span>{baseName(p.name)}</span><b>{Math.round(p.peak_elo).toLocaleString()}</b>
              </button>
            ))}
          </div>
          <div className={styles.plank} />
        </div>
      </section>

      {open && <BinderHost start={open} shots={shots} onClose={() => setOpen(null)}
        onProfile={n => { const p = players?.find(x => x.name === n); setOpen(null); if (p) onSelectPlayer?.(p) }} />}
    </div>
  )
}
