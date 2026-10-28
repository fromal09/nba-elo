import { CURRENT_SEASON_YEAR } from '../season'
import { hrefFor, linkTo } from '../nav.js'
import { FeatureCard } from './Homepage'

// Elo Exploration: every deep-dive page, one card each
export default function EloExploration({ data, setView }) {
  const cards = [
    {
      icon: '⏳',
      title: 'Time Machine',
      desc: 'Build a league from any team-seasons in history, play an 82-game season and the playoffs, and open a box score for every game.',
      meta: 'Era-adjusted · shareable leagues',
      view: 'timemachine',
      color: '#f5efe0', iconColor: '#8a6414',
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
      icon: '🎮',
      title: 'Game Explorer',
      desc: 'Browse every NBA game by Elo Strength Rating. Heat-mapped rosters show how talent was distributed.',
      meta: 'Strength-sorted · Date picker · Roster heatmap',
      view: 'games',
      color: '#f0f0f0', iconColor: '#3a2a1a',
    },
    {
      icon: '🔢',
      title: 'Best Through X',
      desc: 'The Elo leader at each career game milestone — who had the highest rating through exactly N games played.',
      meta: 'Live leaderboard · #1, #2, #3 at every milestone',
      view: 'bestx',
      color: '#e8f0f5', iconColor: '#0a3a5a',
    },
    {
      icon: '🕵️',
      title: 'Mystery Player',
      desc: 'Guess the player from their Elo career chart. Three rounds, each revealing more clues.',
      meta: 'Filter by franchise · era · career length',
      view: 'mystery',
      color: '#f0e8f5', iconColor: '#3a0a5a',
    },
    {
      icon: '📈',
      title: 'Franchise Tenures',
      desc: 'Scatterplot of avg Elo vs games played for any franchise. Identifies all-time Elo Legends.',
      meta: 'Legend Score · avgElo⁰⋅⁶ × GP⁰⋅⁴',
      view: 'tenures',
      color: '#e8f0e8', iconColor: '#173657',
    },
    {
      icon: '🐐',
      title: "Who's Been Here?",
      desc: 'Pick a franchise and an Elo threshold — see every player who reached that level and when.',
      meta: 'All historical franchise names · date ranges',
      view: 'franchise',
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
      meta: `1946–${CURRENT_SEASON_YEAR + 1} · complete record`,
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
    <div style={{ fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", background: '#f4f4f4', minHeight: '100vh' }}>
      <div style={{ padding: '36px 48px 8px' }} data-m="elo-head">
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: '#888', marginBottom: 8 }}>Elo Exploration</div>
        <h1 style={{ fontFamily: "'Georgia', serif", fontSize: 32, color: '#173657', margin: 0 }}>Every way into 80 years of Elo</h1>
        <p style={{ fontSize: 14, color: '#555', maxWidth: 640, lineHeight: 1.6 }}>Historical snapshots, head-to-head comparisons, franchise histories, games and seasons, the Time Machine, and how the ratings work.</p>
      </div>
      <div style={{ padding: '16px 48px 48px' }} data-m="home-explore">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }} data-m="home-grid">
          {cards.map(card => <FeatureCard key={card.view} card={card} href={hrefFor(card.view)} onGo={() => setView(card.view)} />)}
        </div>
      </div>
    </div>
  )
}
