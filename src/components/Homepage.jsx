import PlayerSearch from './PlayerSearch'
import { AccountBar } from './Collector'
import { CURRENT_SEASON_YEAR } from '../season'
import { hrefFor, linkTo } from '../nav.js'

export default function Homepage({ data, setView, onSelectPlayer, onMine }) {
  const active = data.players
    .filter(p => p.is_fpr_eligible)
    .sort((a, b) => b.current_elo - a.current_elo)
    .slice(0, 5)

  const fmt = n => Math.round(n).toLocaleString()

  const nActive = data.players.filter(p => p.is_fpr_eligible).length
  const cards = [
    {
      icon: '🏅',
      title: 'Current Rankings',
      desc: 'Active players ranked by Floor Performance Rating. Filter by team, sort by Elo.',
      meta: `${nActive} active players`,
      view: 'rankings',
      color: '#e8f0e0', iconColor: '#2d5a1a',
    },
    {
      icon: '🗓️',
      title: 'Scoreboard',
      desc: 'Every game by day with live Elo, box scores and projections; standings, playoff odds and award races; and your predictions, live.',
      meta: `Games by day · Standings · My Predictions`,
      view: 'scoreboard',
      color: '#e6ecf5', iconColor: '#173657',
    },
    {
      icon: '📒',
      title: 'Binders',
      desc: 'Every game on record is a card. Open a free pack every day, predict games, and collect careers, franchises and league sets.',
      meta: 'Packs · Predictions · Store · Leaderboards',
      view: 'binders',
      color: '#f5efe0', iconColor: '#8a6414',
    },
    {
      icon: '📊',
      title: 'Elo Exploration',
      desc: 'Historical snapshots, the Time Machine, Game Explorer, Head-to-Head, franchise histories, season by season and the methodology.',
      meta: `${data.total_players.toLocaleString()} career profiles · 1946–${CURRENT_SEASON_YEAR + 1}`,
      view: 'elo',
      color: '#e0eaf8', iconColor: '#1a3a6e',
    },
  ]

  return (
    <div style={{ fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", background: '#f4f4f4', minHeight: '100vh' }}>

      {/* Hero */}
      <div style={{
        background: '#173657', color: '#fff',
        padding: '56px 48px 48px', textAlign: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ fontSize: 11, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#6896bd', marginBottom: 12 }}>
          NBA Analytics · By FanSided
        </div>
        <h1 style={{
          fontFamily: "'Georgia', serif", fontSize: 52,
          lineHeight: 1.1, color: '#fff', marginBottom: 16,
        }}>
          Floor Performance<br />Rankings
        </h1>
        <p style={{ fontSize: 15, color: '#a8c5a8', maxWidth: 520, margin: '0 auto 28px', lineHeight: 1.6 }}>
          Era-adjusted Elo ratings, head-to-head dominance, and historical depth.
          Every game. Every player. Measured properly.
        </p>
        {onSelectPlayer && <div style={{ display: 'flex', justifyContent: 'center' }}><PlayerSearch players={data.players} onSelect={onSelectPlayer} variant="hero" /></div>}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '-16px 0 32px' }}><AccountBar onMine={onMine} /></div>

        {/* Rankings card */}
        <div style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16, padding: '28px 32px',
          maxWidth: 680, margin: '0 auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>🏆</span>
            <h2 style={{ fontFamily: "'Georgia', serif", fontSize: 22, color: '#fff' }}>
              Current FPR
            </h2>
          </div>
          {active.map((p, i) => {
            const isTop3 = i < 3
            const badgeBg = i === 0 ? '#6896bd' : 'rgba(255,255,255,0.12)'
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
                  <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: '#6896bd', marginRight: 4 }}>ELO</span>{fmt(p.current_elo)}
                </div>
              </div>
            )
          })}

          <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent)', margin: '12px 0' }} />
          <a {...linkTo(hrefFor('rankings'), () => setView('rankings'))}
            style={{ background: 'none', border: 'none', color: '#6896bd', fontSize: 13, cursor: 'pointer', letterSpacing: '0.5px', textDecoration: 'none' }}
          >
            View full rankings →
          </a>
        </div>
      </div>

      {/* Feature cards */}
      <div style={{ padding: 48 }} data-m="home-explore">
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#888', marginBottom: 20 }}>
          Explore the platform
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }} data-m="home-grid">
          {cards.map(card => <FeatureCard key={card.view} card={card} href={hrefFor(card.view)} onGo={() => setView(card.view)} />)}
        </div>
      </div>
    </div>
  )
}

// One feature box: a link, so it opens in a new tab with a right-click or Cmd/Ctrl-click
export function FeatureCard({ card, href, onGo }) {
  return (
    <a {...linkTo(href, onGo)}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        background: '#fff',
        border: '0.5px solid #e0e0e0',
        borderRadius: 14, padding: 24,
        cursor: 'pointer', transition: 'all 0.2s',
        position: 'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#173657'
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(26,46,26,0.1)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#e0e0e0'
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
      <div style={{ fontSize: 12, color: '#173657', fontWeight: 500 }}>{card.meta}</div>
      <div style={{ position: 'absolute', top: 20, right: 20, color: '#ccc', fontSize: 16 }}>→</div>
    </a>
  )
}
