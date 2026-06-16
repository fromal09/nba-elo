import { useState } from 'react'

const NAV_ITEMS = [
  { label: 'NFL', href: 'https://fansided.com/nfl' },
  { label: 'NBA', href: 'https://fansided.com/nba', active: true },
  { label: 'MLB', href: 'https://fansided.com/mlb' },
  { label: 'NHL', href: 'https://fansided.com/nhl' },
  { label: 'More', href: '#' },
]

export default function FanSidedHeader({ currentView, onNavigate }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header style={{
      background: '#003594',
      borderBottom: '3px solid #d4002a',
      flexShrink: 0,
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      zIndex: 100,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 52, maxWidth: '100%',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="https://fansided.com" target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
            <div style={{
              background: '#fff', borderRadius: 4, padding: '4px 10px',
              fontWeight: 900, fontSize: 18, color: '#003594',
              letterSpacing: -0.5, lineHeight: 1,
            }}>
              FAN<span style={{ color: '#d4002a' }}>SIDED</span>
            </div>
          </a>
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)' }} />
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: 600, letterSpacing: 0.5 }}>
            FPR Dashboard
          </span>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {NAV_ITEMS.map(item => (
            <a key={item.label} href={item.href} target={item.href !== '#' ? '_blank' : undefined}
              rel="noopener"
              style={{
                color: item.active ? '#fff' : 'rgba(255,255,255,0.7)',
                fontWeight: item.active ? 700 : 500,
                fontSize: 13, textDecoration: 'none',
                padding: '4px 12px', borderRadius: 4,
                borderBottom: item.active ? '2px solid #d4002a' : '2px solid transparent',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = item.active ? '#fff' : 'rgba(255,255,255,0.7)'}
            >{item.label}</a>
          ))}
        </nav>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            background: '#d4002a', color: '#fff',
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase',
          }}>Beta</span>
          <a href="https://fansided.com" target="_blank" rel="noopener"
            style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, textDecoration: 'none' }}>
            fansided.com
          </a>
        </div>
      </div>
    </header>
  )
}
