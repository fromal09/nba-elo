import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './Explainer.module.css'

// The site's rules and scoring live behind a small ⓘ button instead of filling the page: tap it and they open in a card.
//   <Explain title="How Pick’em pays">…paragraphs…</Explain>
// label: the button's text (default "How it works"); icon: just the ⓘ, for tight spots (the label is still its name);
// tone: 'light' on dark backgrounds, 'dark' on paper (default)
export function Explain({ title, label = 'How it works', icon = false, tone = 'dark', className = '', children }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const k = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    addEventListener('keydown', k, true)
    return () => removeEventListener('keydown', k, true)
  }, [open])
  return <>
    <button type="button" className={`${styles.btn} ${className}`} data-tone={tone} data-icon={icon ? '' : undefined}
      onClick={e => { e.stopPropagation(); setOpen(true) }} aria-haspopup="dialog" aria-label={icon ? `${label}: ${title}` : undefined}>
      <i aria-hidden="true">i</i>{!icon && <span>{label}</span>}
    </button>
    {open && createPortal(
      <div className={styles.back} onClick={() => setOpen(false)}>
        <div className={styles.card} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
          <header><b>{title}</b><button type="button" onClick={() => setOpen(false)} aria-label="Close">×</button></header>
          <div className={styles.body}>{children}</div>
          <footer><button type="button" onClick={() => setOpen(false)}>Got it</button></footer>
        </div>
      </div>, document.body)}
  </>
}

// A two-column list of rewards inside an explainer: [[what, pays], ...]
export function PayList({ rows }) {
  return <div className={styles.pay}>{rows.map(([a, b]) => <div key={a}><b>{a}</b><span>{b}</span></div>)}</div>
}
