import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tour.module.css'
import { TOURS, tourById } from './tours'
import { useCollector } from './Collector'
import { goTo, viewFromUrl } from '../nav.js'

// ── The tour store: which tour is running and which ones you've seen (this device) ──
const SEEN_KEY = 'fc-tours-seen'
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const markSeen = id => { try { const s = readSeen(); s.add(id); localStorage.setItem(SEEN_KEY, JSON.stringify([...s])) } catch {} }
let state = { id: null, step: 0, n: 0 }
const subs = new Set()
const set = s => { state = { ...state, ...s }; subs.forEach(f => f()) }
const useTourState = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => state)

export const tourSeen = id => readSeen().has(id)
export function startTour(id, { from = 0 } = {}) { if (tourById(id)) set({ id, step: from, n: Date.now() }) }
export function endTour() { if (state.id) markSeen(state.id); set({ id: null, step: 0 }) }

// A room's tour starts itself the first time you walk in (signed in, nothing else running, ready = the room has drawn)
export function useAutoTour(id, ready = true) {
  const C = useCollector()
  const signed = !!C.me
  useEffect(() => {
    if (!id || !ready || !signed || state.id || tourSeen(id)) return
    const t = setTimeout(() => { if (!state.id && !tourSeen(id)) startTour(id) }, 1100)
    return () => clearTimeout(t)
  }, [id, ready, signed])
}
// The welcome tour: on your desk, the first days after you make your binder
export function useWelcomeTour(ready) {
  const C = useCollector()
  const joined = C.me?.user?.joined
  const fresh = joined && Date.now() - Date.parse(joined) < 3 * 864e5
  useAutoTour(fresh ? 'welcome' : null, ready)
}

// ── Finding a step's target ──
function findTarget(sel, text) {
  if (!sel) return null
  let list
  try { list = [...document.querySelectorAll(sel)] } catch { return null }
  for (const el of list) {
    if (el.closest('[data-tour-ui]')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (text && !(el.innerText || el.getAttribute('aria-label') || '').toLowerCase().includes(text.toLowerCase())) continue
    return el
  }
  return null
}
const waitFor = (sel, ms = 9000) => new Promise(res => {
  const t0 = Date.now()
  const tick = () => { if (!sel || findTarget(sel)) return res(true); if (Date.now() - t0 > ms) return res(false); setTimeout(tick, 150) }
  tick()
})

// ── The host: the spotlight, Everest and the card ──
export function TourHost() {
  const { id, step, n } = useTourState()
  const C = useCollector()
  const tour = id ? tourById(id) : null
  const [ready, setReady] = useState(false)
  // Get to the tour's room first, then wait for it to draw
  useEffect(() => {
    if (!tour) return
    let live = true
    setReady(false)
    const [view, opts] = tour.route
    const go = () => {
      if (view === 'binders' && opts?.open === 'mine') { if (!findTarget(tour.wait)) C.openMine?.() }
      else if (view === 'binders' && opts?.open === 'store') { if (!findTarget(tour.wait)) C.openStore?.() }
      else goTo(view, opts)
    }
    const binderish = view === 'binders' && opts?.open
    const atRoom = binderish ? !!findTarget(tour.wait)
      : viewFromUrl() === view && (view !== 'gameroom' || new URLSearchParams(window.location.search).get('open') === (opts?.open || null))
    if (!atRoom) go()
    // after a move, give the old page a moment to leave before looking for the new one
    setTimeout(() => waitFor(tour.wait).then(() => live && setTimeout(() => live && setReady(true), 350)), atRoom ? 0 : 400)
    return () => { live = false }
  }, [id, n])
  if (!tour || !ready) return null
  return createPortal(<TourStep key={`${id}-${step}-${n}`} tour={tour} step={step} />, document.body)
}

const PAD = 8
function TourStep({ tour, step }) {
  const [sel, title, body, pose, extra = {}] = tour.steps[step]
  const last = step === tour.steps.length - 1
  const [rect, setRect] = useState(null)
  const [card, setCard] = useState(null)
  const cardRef = useRef(null), nextRef = useRef(null)
  const target = useRef(null)
  const phone = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches

  // Light the target: scroll it into view, then follow it
  useEffect(() => {
    const el = findTarget(sel, extra.text)
    target.current = el
    if (!el) { setRect(null); return }
    const r0 = el.getBoundingClientRect()
    const tall = r0.height > window.innerHeight * 0.55
    // clear the sticky section bar when a tall target scrolls to the top
    el.style.scrollMarginTop = '84px'; el.style.scrollMarginBottom = '24px'
    el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' })
    let raf = 0
    const measure = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const r = el.getBoundingClientRect(); setRect({ x: r.left, y: r.top, w: r.width, h: r.height }) }) }
    const t = setTimeout(measure, 420)
    measure()
    window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true)
    return () => { clearTimeout(t); cancelAnimationFrame(raf); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [sel, extra.text])

  // Put the card beside the target: under it, over it, else docked at the bottom (phones always dock)
  useLayoutEffect(() => {
    const c = cardRef.current
    if (!c) return
    const W = window.innerWidth, H = window.innerHeight, cw = c.offsetWidth, ch = c.offsetHeight
    if (!rect) { setCard({ center: true }); return }
    if (phone) {
      const lower = rect.y + rect.h / 2 > H * 0.52
      setCard({ dock: lower ? 'top' : 'bottom' })
      return
    }
    const below = rect.y + rect.h + PAD + 14, above = rect.y - PAD - 14 - ch
    const left = Math.max(12, Math.min(W - cw - 12, rect.x + rect.w / 2 - cw / 2))
    if (below + ch < H - 10) setCard({ x: left, y: below })
    else if (above > 10) setCard({ x: left, y: above })
    else if (rect.x + rect.w + 20 + cw < W) setCard({ x: rect.x + rect.w + 20, y: Math.max(12, Math.min(H - ch - 12, rect.y)) })
    else if (rect.x - 20 - cw > 0) setCard({ x: rect.x - 20 - cw, y: Math.max(12, Math.min(H - ch - 12, rect.y)) })
    else setCard({ dock: 'bottom' })
  }, [rect, phone, step])

  const go = k => { const s = step + k; if (s < 0) return; if (s >= tour.steps.length) endTour(); else set({ step: s }) }
  const doAction = () => {
    const el = target.current
    endTour()
    if (extra.action === 'open' && el) setTimeout(() => el.click(), 60)
  }
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true })
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); endTour() }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); extra.action && last ? doAction() : go(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [step])

  const centered = !rect
  const pos = !card ? { visibility: 'hidden' } : card.center ? {} : card.dock ? {} : { left: card.x, top: card.y }
  const ev = <img className={styles.ev} src={`/everest/${pose || 'open'}.svg`} alt="" />
  return (
    <div className={styles.layer} data-tour-ui="" role="dialog" aria-modal="true" aria-label={`${tour.name}: ${title}`}>
      <div className={styles.block} onClick={e => e.stopPropagation()} />
      {rect ? <div className={styles.spot} style={{ left: rect.x - PAD, top: rect.y - PAD, width: rect.w + PAD * 2, height: rect.h + PAD * 2 }} />
        : <div className={styles.dim} />}
      <div className={`${styles.wrap} ${centered ? styles.wrapCenter : ''} ${card?.dock ? styles[`dock_${card.dock}`] : ''}`} style={pos}>
        {centered && <div className={styles.evBig}>{ev}</div>}
        <div ref={cardRef} className={`${styles.card} ${centered ? styles.cardCenter : ''}`}>
          {!centered && <div className={styles.evSmall}>{ev}</div>}
          <div className={styles.text}>
            <div className={styles.top}>
              <small>{tour.name} · {step + 1} of {tour.steps.length}</small>
              <button type="button" className={styles.skip} onClick={endTour}>{last ? 'Close' : 'Skip tour'}</button>
            </div>
            <h3>{title}</h3>
            <p>{body}</p>
            <div className={styles.foot}>
              <span className={styles.dots} aria-hidden="true">{tour.steps.map((_, i) => <i key={i} data-on={i === step ? '' : undefined} />)}</span>
              {step > 0 && <button type="button" className={styles.back} onClick={() => go(-1)}>Back</button>}
              {extra.action
                ? <button ref={nextRef} type="button" className={styles.next} onClick={doAction}>{extra.label || 'Go'}</button>
                : <button ref={nextRef} type="button" className={styles.next} onClick={() => go(1)}>{last ? 'Done' : 'Next'}</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── The Tours menu in the header: replay any tour ──
export function ToursButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const off = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const esc = e => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', off); window.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc) }
  }, [open])
  const groups = TOURS.reduce((m, t) => { (m[t.group] = m[t.group] || []).push(t); return m }, {})
  const seen = open ? readSeen() : new Set()
  return (
    <div className={styles.menuWrap} ref={ref}>
      <button type="button" className={styles.menuBtn} data-tour="tours" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="menu" title="Tours with Everest">
        <img src="/everest/open.svg" alt="" /><span>Tours</span>
      </button>
      {open && <div className={styles.menu} role="menu">
        <div className={styles.menuHead}><b>Tours with Everest</b><small>Replay any of them</small></div>
        {Object.entries(groups).map(([g, list]) => <div key={g} className={styles.menuGroup}>
          <small>{g}</small>
          {list.map(t => <button key={t.id} type="button" role="menuitem" onClick={() => { setOpen(false); startTour(t.id) }}>
            {t.name}<span>{seen.has(t.id) ? '✓' : `${t.steps.length} steps`}</span>
          </button>)}
        </div>)}
      </div>}
    </div>
  )
}
