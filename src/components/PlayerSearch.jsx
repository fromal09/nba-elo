import { useState, useEffect, useMemo, useRef } from 'react'
import styles from './PlayerSearch.module.css'

/*
 * Player search: every player in players.json, 1946-47 to today. Opens from the nav (or / and Ctrl/Cmd+K),
 * matches without accents or case, word starts first, and opens the player's profile.
 */

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.'’]/g, '')
const r0 = v => (v == null ? '—' : Math.round(v).toLocaleString())
const DAY = 864e5

export function useIndex(players) {
  return useMemo(() => {
    if (!players?.length) return { list: [], recent: '' }
    const newest = players.reduce((m, p) => (p.last_played > m ? p.last_played : m), '')
    const recent = new Date(Date.parse(newest) - 300 * DAY).toISOString().slice(0, 10)
    const list = players.map(p => {
      const f = fold(p.name)
      const teams = [...new Set((p.team_history || []).map(t => t[1]))]
      const first = p.team_history?.[0]?.[0]
      return {
        p, f, words: f.split(/[\s-]+/), teams,
        years: first ? `${first.slice(0, 4)}–${p.last_played >= recent ? '' : p.last_played.slice(0, 4)}` : '',
        active: p.last_played >= recent,
      }
    })
    return { list, recent }
  }, [players])
}

// Full-name start beats a word start beats anywhere in the name; then all-time peak Elo
export function search(list, q) {
  const fq = fold(q.trim())
  if (!fq) return []
  const toks = fq.split(/\s+/)
  const out = []
  for (const e of list) {
    let score
    if (e.f.startsWith(fq)) score = 3
    else if (toks.every(t => e.words.some(w => w.startsWith(t)))) score = 2
    else if (e.f.includes(fq)) score = 1
    else continue
    out.push([score, e])
  }
  out.sort((a, b) => b[0] - a[0] || b[1].p.peak_elo - a[1].p.peak_elo)
  return out.slice(0, 12).map(x => x[1])
}

export default function PlayerSearch({ players, onSelect, variant = 'nav', label, action }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (variant !== 'nav') return
    const k = e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setOpen(true) }
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [variant])
  return <>
    <button type="button" className={variant === 'hero' ? styles.heroBtn : styles.navBtn} onClick={() => setOpen(true)} aria-label="Search players">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
      <span>{label || (variant === 'hero' ? 'Search any player, 1946 to today' : 'Search players')}</span>
      <kbd>/</kbd>
    </button>
    {open && <Palette players={players} action={action} onClose={() => setOpen(false)} onSelect={p => { setOpen(false); onSelect(p) }} />}
  </>
}

function Palette({ players, onClose, onSelect, action }) {
  const { list } = useIndex(players)
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const inputRef = useRef(null), listRef = useRef(null)
  const hits = useMemo(() => search(list, q), [list, q])
  // Before typing: the top of the all-time peak list, so the box is never empty
  const legends = useMemo(() => [...list].sort((a, b) => b.p.peak_elo - a.p.peak_elo).slice(0, 8), [list])
  const shown = q.trim() ? hits : legends
  useEffect(() => { inputRef.current?.focus(); document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  useEffect(() => { setAt(0) }, [q])
  useEffect(() => { listRef.current?.children[at]?.scrollIntoView({ block: 'nearest' }) }, [at])
  const key = e => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(shown.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && shown[at]) onSelect(shown[at].p)
  }
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.box} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search players">
        <div className={styles.field}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={key} placeholder="Search 4,400+ players: Cousy, Mikan, Jokic…"
            aria-label="Player name" aria-controls="ps-list" aria-activedescendant={shown[at] ? `ps-${at}` : undefined} autoComplete="off" spellCheck="false" />
          <button type="button" className={styles.esc} onClick={onClose}>Esc</button>
        </div>
        <div className={styles.cap}>{q.trim() ? (hits.length ? `${hits.length === 12 ? 'Top 12' : hits.length} match${hits.length === 1 ? '' : 'es'}` : 'No players match') : 'Highest peak Elo of all time'}</div>
        <ul id="ps-list" ref={listRef} className={styles.list} role="listbox">
          {shown.map((e, i) => (
            <li key={e.p.name} id={`ps-${i}`} role="option" aria-selected={i === at}>
              <button type="button" className={i === at ? styles.on : ''} onMouseMove={() => setAt(i)} onClick={() => onSelect(e.p)}>
                <span className={styles.ini}>{e.p.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</span>
                <span className={styles.who}>
                  <b>{e.p.name}{e.active && <i className={styles.live}>Active</i>}</b>
                  <small>{e.years}{e.teams.length ? ` · ${e.teams.slice(0, 5).join(', ')}${e.teams.length > 5 ? ` +${e.teams.length - 5}` : ''}` : ''} · {e.p.games_played.toLocaleString()} games</small>
                </span>
                <span className={styles.elo}><b>{r0(e.p.peak_elo)}</b><small>Peak Elo</small></span>
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.foot}><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> {action || 'to open the profile'}</span></div>
      </div>
    </div>
  )
}
