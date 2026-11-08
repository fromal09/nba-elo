import { useEffect, useMemo, useState } from 'react'
import styles from './Homepage.module.css'
import { useCollector } from './Collector'
import { binderHeadshots } from './SeasonExplorer'
import { norm } from './predict'
import { hrefFor, linkTo, ELO_SUBS } from '../nav.js'
import { BRAND } from '../brand.js'
import { ICONS } from './SectionIcons'

const baseName = n => n.replace(/\s*\(.*\)$/, '')
const lastName = n => { const p = baseName(n).split(' '); return p.length > 1 ? p.slice(1).join(' ') : p[0] }
const initials = n => baseName(n).split(' ').map(w => w[0]).join('').slice(0, 2)

// The home page: the site as one building in cutaway. Current Rankings is the billboard on the roof, My Desk and the
// Library share the top floor, the Scoreboard and the Game Room are at street level, the Store has the awning and
// Elo Exploration is the vault downstairs. On a phone it's a narrow tower you scroll down.
export default function Homepage({ players, live, setView, onMine, onStore }) {
  const C = useCollector()
  const [shots, setShots] = useState({})
  useEffect(() => { binderHeadshots().then(setShots).catch(() => {}) }, [])
  const top5 = useMemo(() => (players || []).filter(p => p.is_fpr_eligible).sort((a, b) => b.current_elo - a.current_elo).slice(0, 5), [players])
  const me = C.me
  const go = id => linkTo(hrefFor(id), () => setView(id))
  const t = me?.today, pr = me?.predict
  const deskNote = !me ? 'Sign up for a free pack every day' : !t?.claimed ? 'Today’s pack is waiting' : me.open?.[0] ? 'Finish today’s pack' : `${t.streak}-day streak · pack opened`
  const gameNote = pr?.games ? `Pick’em: ${pr.picked} of ${pr.games} picked today` : 'Pick’em, matchups, lineup, daily games'
  const scoreNote = live?.inprog.length ? `${live.inprog.length} game${live.inprog.length === 1 ? '' : 's'} live now` : 'Games, live win chances, FanSided Tonight'
  const shot = n => shots?.[norm(n)]?.headshot

  return (
    <div className={styles.page}>
      <div className={styles.sky} aria-hidden="true" />
      <header className={styles.title}>
        <small>NBA · Since 1946</small>
        <h1>{BRAND.full}</h1>
        <p>Every game since 1946 as Elo ratings and collectible cards. Pick a room.</p>
      </header>

      <div className={styles.tower}>
        <div className={styles.roof}>
          <a className={styles.bill} {...go('rankings')} aria-label="Current Rankings">
            <span className={styles.billHead}><small>On the roof</small><b>Current Rankings</b></span>
            <ol>
              {top5.map((p, i) => (
                <li key={p.name}>
                  <span className={styles.hs}>{initials(p.name)}{shot(p.name) && <img src={shot(p.name)} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />}</span>
                  <span className={styles.who}><b>{i + 1}. {lastName(p.name)}</b><small>{Math.round(p.current_elo).toLocaleString()}</small></span>
                </li>
              ))}
            </ol>
          </a>
        </div>

        <div className={styles.floors}>
          <a className={`${styles.room} ${styles.rDesk}`} {...go('binders')}>
            <span className={styles.art} aria-hidden="true">
              <span className={styles.binder}>
                <i className={styles.rings}><i /><i /><i /></i>
                <i className={styles.window} />
                <i className={styles.plate}><small>My binder</small><b>{me?.user?.username || 'Yours'}</b></i>
                <i className={styles.strap} />
              </span>
            </span>
            <span className={styles.sign}>{ICONS.binders}<span><b>My Desk</b><small>{deskNote}</small></span></span>
          </a>
          <a className={`${styles.room} ${styles.rLib}`} {...go('library')}>
            <span className={styles.art} aria-hidden="true">
              <Shelf n={16} seed={1} /><Shelf n={16} seed={7} low />
            </span>
            <span className={styles.sign}>{ICONS.library}<span><b>The Library</b><small>Season binders, sets, franchises, legends, the catalog</small></span></span>
          </a>
          <a className={`${styles.room} ${styles.rScore}`} {...go('scoreboard')}>
            <span className={styles.art} aria-hidden="true"><span className={styles.marquee}><i>Tonight</i><i>Live odds</i><i>Standings</i></span></span>
            <span className={styles.sign}>{ICONS.scoreboard}<span><b>The Scoreboard</b><small>{scoreNote}</small></span></span>
          </a>
          <a className={`${styles.room} ${styles.rGame}`} {...go('gameroom')}>
            <span className={styles.art} aria-hidden="true"><span className={styles.neon}>Game Room</span></span>
            <span className={styles.sign}>{ICONS.gameroom}<span><b>The Game Room</b><small>{gameNote}</small></span></span>
          </a>
          <a className={`${styles.room} ${styles.rStore}`} {...linkTo(hrefFor('binders', { open: 'store' }), onStore)}>
            <span className={styles.art} aria-hidden="true"><span className={styles.awning} /><span className={styles.coins}><i /><i /><i /><i /></span></span>
            <span className={styles.sign}>{ICONS.store}<span><b>The Store</b><small>{me ? `${(me.coins?.balance ?? 0).toLocaleString()} coins to spend on packs and specials` : 'Spend coins on packs and specials'}</small></span></span>
          </a>
        </div>

        <div className={styles.base}>
          <a className={styles.vault} {...go('elo')}>
            <span className={styles.dial} aria-hidden="true" />
            <span className={styles.vaultText}><b>Elo Exploration</b><small>The archive downstairs: every rating since 1946</small></span>
            <span className={styles.chips}>
              {ELO_SUBS.slice(0, 4).map(s => <span key={s.view}>{s.label}</span>)}
              <span>+{ELO_SUBS.length - 4} more</span>
            </span>
          </a>
        </div>
      </div>
      <div className={styles.street} aria-hidden="true" />
    </div>
  )
}

// A shelf of book spines in the team colors of the Library
const SPINES = ['#552583', '#007A33', '#CE1141', '#1D428A', '#c9a24a', '#006BB6', '#98002E', '#0C2340', '#00471B', '#E56020', '#5a3519', '#860038']
function Shelf({ n, seed, low }) {
  return (
    <span className={`${styles.shelf} ${low ? styles.shelfLow : ''}`}>
      {Array.from({ length: n }, (_, i) => <i key={i} style={{ background: SPINES[(i * 5 + seed) % SPINES.length], height: `${74 + ((i * 7 + seed * 3) % 5) * 6}%` }} />)}
    </span>
  )
}
