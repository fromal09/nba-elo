export default function Homepage({ data, setView }) {
  const active = data.players
    .filter(p => p.is_fpr_eligible)
    .sort((a, b) => b.current_elo - a.current_elo)
    .slice(0, 5)

  const fmt = n => Math.round(n).toLocaleString()

  const cards = [
    {
      icon: '🏅',
      title: 'Current Rankings',
      desc: 'Active players ranked by Floor Performance Rating. Filter by team, sort by Elo.',
      meta: `${data.players.filter(p => p.is_fpr_eligible).length} active players`,
      view: 'rankings',
      color: '#e8f0e0', iconColor: '#2d5a1a',
    },
    {
      icon: '📊',
      title: 'Historical Elo Snapshots',
      desc: 'All-time rankings sorted by peak Elo, plus rankings on any day in league history. Covers 1946 to present.',
      meta: `${data.total_players.toLocaleString()} career profiles`,
      view: 'historical',
      color: '#e0eaf8', iconColor: '#1a3a6e',
    },
    {
      icon: '🐐',
      title: 'GOAT Rankings',
      desc: 'Customizable composite rankings with adjustable weights across peak Elo, average Elo, and longevity.',
      meta: '3 dimensions · adjustable weights',
      view: 'goat',
      color: '#faf0dc', iconColor: '#7a4f0a',
    },
    {
      icon: '⚔️',
      title: 'Head-to-Head',
      desc: 'Compare any two players across Elo history, career stats, and shared game performance.',
      meta: 'Pairwise records from shared games',
      view: 'h2h',
      color: '#ede8f8', iconColor: '#4a2a8a',
    },
    {
      icon: '🏀',
      title: 'Team Breakdown',
      desc: 'Pick any current NBA team and see every player\'s current Elo and FPR rank.',
      meta: '30 teams · current rosters',
      view: 'teams',
      color: '#e0f0ee', iconColor: '#0a5a52',
    },
    {
      icon: '📅',
      title: 'Season by Season',
      desc: 'Top five players by Elo at the close of every season from 1946–47 to present.',
      meta: '1946–2026 · complete record',
      view: 'seasons',
      color: '#faeee0', iconColor: '#7a3a0a',
    },
    {
      icon: '📆',
      title: 'Daily Changes',
      desc: 'Most recent day\'s Elo delta and FPR rank change for every player who appeared.',
      meta: 'Updated after every game',
      view: 'daily',
      color: '#f8e8e8', iconColor: '#7a1a1a',
    },
    {
      icon: '📐',
      title: 'Methodology',
      desc: 'Full technical documentation covering K-factors, era adjustments, Elo calibration, and FPR eligibility.',
      meta: 'Open and transparent',
      view: 'methodology',
      color: '#e8e8e8', iconColor: '#2a2a2a',
    },
  ]

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#f5f3ee', minHeight: '100vh' }}>

      {/* Hero */}
      <div style={{
        background: '#1a2e1a', color: '#fff',
        padding: '56px 48px 48px', textAlign: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ fontSize: 11, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#7aaa7a', marginBottom: 12 }}>
          NBA Analytics · By FanSided
        </div>
        <h1 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 52,
          lineHeight: 1.1, color: '#fff', marginBottom: 16,
        }}>
          Floor Performance<br />Rankings
        </h1>
        <p style={{ fontSize: 15, color: '#a8c5a8', maxWidth: 520, margin: '0 auto 40px', lineHeight: 1.6 }}>
          Era-adjusted Elo ratings, head-to-head dominance, and historical depth.
          Every game. Every player. Measured properly.
        </p>

        {/* Rankings card */}
        <div style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16, padding: '28px 32px',
          maxWidth: 680, margin: '0 auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>🏆</span>
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: '#fff' }}>
              Current FPR
            </h2>
          </div>
          {active.map((p, i) => {
            const isTop3 = i < 3
            const badgeBg = i === 0 ? '#c9920a' : 'rgba(255,255,255,0.12)'
            return (
              <div
                key={p.name}
                onClick={() => setView('rankings')}
                style={{
                  display: 'flex', alignItems: 'center',
                  padding: '7px 10px', borderRadius: 8, marginBottom: 2,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: i === 0 ? '#ffd700' : 'rgba(255,255,255,0.4)', minWidth: 24, flexShrink: 0 }}>
                  #{i + 1}
                </div>
                <div style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#fff' }}>{p.name}</div>
                <div style={{ fontSize: 13, color: '#e8f0e8', fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#7aaa7a', marginRight: 4 }}>ELO</span>{fmt(p.current_elo)}
                </div>
              </div>
            )
          })}

          <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)', margin: '12px 0' }} />
          <button
            onClick={() => setView('rankings')}
            style={{ background: 'none', border: 'none', color: '#7aaa7a', fontSize: 13, cursor: 'pointer', letterSpacing: '0.5px' }}
          >
            View full rankings →
          </button>
        </div>
      </div>

      {/* Feature cards */}
      <div style={{ padding: 48 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#888', marginBottom: 20 }}>
          Explore the platform
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
          {cards.map(card => (
            <div
              key={card.view}
              onClick={() => setView(card.view)}
              style={{
                background: '#fff',
                border: '0.5px solid #e0ddd6',
                borderRadius: 14, padding: 24,
                cursor: 'pointer', transition: 'all 0.2s',
                position: 'relative',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#1a2e1a'
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(26,46,26,0.1)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#e0ddd6'
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: card.color, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 14, fontSize: 18,
              }}>
                {card.icon}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 }}>{card.title}</div>
              <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 12 }}>{card.desc}</div>
              <div style={{ fontSize: 12, color: '#1a2e1a', fontWeight: 500 }}>{card.meta}</div>
              <div style={{ position: 'absolute', top: 20, right: 20, color: '#ccc', fontSize: 16 }}>→</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
