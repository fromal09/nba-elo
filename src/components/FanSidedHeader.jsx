export default function FanSidedHeader() {
  return (
    <header style={{
      background: '#173657',
      borderBottom: '3px solid #6896bd',
      flexShrink: 0,
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      zIndex: 100,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="https://fansided.com" target="_blank" rel="noopener">
            <img src="/fansided-logo.webp" alt="FanSided" style={{ height: 26, display: 'block' }} />
          </a>
          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.25)' }} />
          <div>
            <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
              Floor Performance Rankings
            </div>
            <div style={{ color: '#6896bd', fontSize: 11, fontWeight: 500 }}>
              NBA Elo Analytics Dashboard
            </div>
          </div>
        </div>
        <span style={{
          background: 'rgba(104,150,189,0.2)', border: '1px solid #6896bd',
          color: '#6896bd', fontSize: 10, fontWeight: 700, letterSpacing: 1,
          padding: '3px 10px', borderRadius: 4, textTransform: 'uppercase',
        }}>Analytics Suite</span>
      </div>
    </header>
  )
}
