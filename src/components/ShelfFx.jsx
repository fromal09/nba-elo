import { useState, useEffect, useMemo, useRef } from 'react'
import fx from './ShelfFx.module.css'
import { AnyFace } from './Binders'

/*
 * The Binder Room's shelf effects. With a mouse: hover or focus an album and it tips out of the row with a preview
 * card above it; click it and it flies off the shelf, turns and opens before the binder takes over. On a touch screen
 * a tap opens a preview sheet first. Reduced motion: no flight, the binder opens at once.
 *
 * An item: { key, kind, title, color, desc, meta, fan: [entries], logo, target } (target: what BinderHost opens)
 */

function Mini({ children, w }) {
  const k = w / 340
  return <span className={fx.mini} style={{ width: w, height: 476 * k }}><span style={{ transform: `scale(${k})` }}>{children}</span></span>
}

function Cover({ item, env, big }) {
  const w = big ? 70 : 62
  return (
    <span className={fx.cover} style={{ '--c': item.color }} aria-hidden="true">
      {item.fan?.length ? item.fan.slice(0, 3).map((e, i) => (
        <span key={e.key} className={fx.fanCard} data-i={i}><Mini w={w}><AnyFace e={e} env={env} /></Mini></span>
      )) : item.logo ? <img className={fx.logo} src={item.logo} alt="" /> : <b className={fx.initials}>{item.initials}</b>}
    </span>
  )
}

function Peek({ p, env }) {
  return (
    <div className={fx.peek} style={{ left: p.x, bottom: p.bottom }} role="tooltip">
      <Cover item={p.item} env={env} />
      <span className={fx.peekText}>
        <small>{p.item.kind}</small>
        <b style={{ color: p.item.ink }}>{p.item.title}</b>
        {p.item.desc && <span>{p.item.desc}</span>}
        {p.item.meta && <em>{p.item.meta}</em>}
      </span>
    </div>
  )
}

function Sheet({ item, env, onOpen, onClose }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className={fx.dim} onClick={onClose}>
      <div className={fx.sheet} role="dialog" aria-modal="true" aria-label={`${item.title} preview`} onClick={e => e.stopPropagation()}>
        <span className={fx.grab} aria-hidden="true" />
        <div className={fx.sheetRow}>
          <Cover item={item} env={env} big />
          <span className={fx.peekText}>
            <small>{item.kind}</small>
            <b style={{ color: item.ink }}>{item.title}</b>
            {item.desc && <span>{item.desc}</span>}
            {item.meta && <em>{item.meta}</em>}
          </span>
        </div>
        <button type="button" className={fx.openBtn} onClick={onOpen} autoFocus>Open the binder</button>
      </div>
    </div>
  )
}

// The album flies from its place on the shelf to the middle of the screen, turns to face you and opens
function Flight({ item, rect, onDone }) {
  const done = useRef(false)
  const finish = () => { if (!done.current) { done.current = true; onDone() } }
  useEffect(() => { const t = setTimeout(finish, 1150); return () => clearTimeout(t) }, [])
  const W = Math.min(780, innerWidth - 32), H = Math.round(W * 0.64)
  const vars = {
    width: W, height: H, '--c': item.color,
    '--fx': `${rect.left + rect.width / 2 - innerWidth / 2}px`, '--fy': `${rect.top + rect.height / 2 - innerHeight / 2}px`,
    '--sx': (rect.width / W).toFixed(3), '--sy': (rect.height / H).toFixed(3),
  }
  return (
    <div className={fx.layer} onClick={finish} aria-hidden="true">
      <div className={fx.book} style={vars}>
        <div className={fx.spread}>
          <div className={fx.paper}><small>{item.kind}</small><b style={{ color: item.color }}>{item.title}</b></div>
          <div className={fx.rings}><i /><i /><i /></div>
          <div className={fx.sleeve}>{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>
        </div>
        <div className={fx.lid}><b>{item.title}</b></div>
      </div>
    </div>
  )
}

export function useShelf(open, env) {
  const [hover, reduce] = useMemo(() => (typeof matchMedia === 'undefined' ? [true, false]
    : [matchMedia('(hover: hover) and (pointer: fine)').matches, matchMedia('(prefers-reduced-motion: reduce)').matches]), [])
  const [peek, setPeek] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [flight, setFlight] = useState(null)
  const show = (item, el) => {
    const sec = el.closest('section'); if (!sec) return
    const s = sec.getBoundingClientRect(), r = el.getBoundingClientRect()
    const x = Math.max(8, Math.min(s.width - 328, r.left - s.left + r.width / 2 - 160))
    setPeek({ item, bay: sec.id, x, bottom: s.bottom - r.top + 12 })
  }
  const hide = key => setPeek(p => (p && p.item.key === key ? null : p))
  const bind = item => ({
    'data-up': peek?.item.key === item.key ? '' : undefined,
    onMouseEnter: e => hover && show(item, e.currentTarget),
    onMouseLeave: () => hide(item.key),
    onFocus: e => hover && e.currentTarget.matches(':focus-visible') && show(item, e.currentTarget),
    onBlur: () => hide(item.key),
    onClick: e => {
      setPeek(null)
      if (!hover) { setSheet(item); return }
      if (reduce) { open(item.target); return }
      setFlight({ item, rect: e.currentTarget.getBoundingClientRect() })
    },
  })
  const peekIn = bay => (peek && peek.bay === bay ? <Peek p={peek} env={env} /> : null)
  const layers = <>
    {sheet && <Sheet item={sheet} env={env} onClose={() => setSheet(null)} onOpen={() => { const t = sheet.target; setSheet(null); open(t) }} />}
    {flight && <Flight key={flight.item.key} item={flight.item} rect={flight.rect} onDone={() => { const t = flight.item.target; setFlight(null); open(t) }} />}
  </>
  return { bind, peekIn, layers }
}
