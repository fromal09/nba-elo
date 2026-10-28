// Site navigation: the four top-level sections, the Elo Exploration pages under them, and a URL for every view,
// so any menu item opens in a new tab (right-click, or Cmd/Ctrl-click). /scoreboard, /binders and /timemachine have
// their own paths; every other view is /?view=<id>.

export const TOP = [
  { id: 'rankings', label: 'Current Rankings' },
  { id: 'scoreboard', label: 'Scoreboard' },
  { id: 'binders', label: 'Binders' },
  { id: 'elo', label: 'Elo Exploration' },
]

export const ELO_SUBS = [
  { view: 'timemachine', label: 'Time Machine' },
  { view: 'historical', label: 'Historical Elo Snapshots' },
  { view: 'games', label: 'Game Explorer' },
  { view: 'bestx', label: 'Best Through X' },
  { view: 'mystery', label: 'Mystery Player' },
  { view: 'tenures', label: 'Franchise Tenures' },
  { view: 'franchise', label: "Who's Been Here?" },
  { view: 'h2h', label: 'Head-to-Head' },
  { view: 'teams', label: 'Team Breakdown' },
  { view: 'seasons', label: 'Season by Season' },
  { view: 'daily', label: 'Daily Changes' },
  { view: 'methodology', label: 'Methodology' },
]
const SUB_IDS = new Set(ELO_SUBS.map(s => s.view))
// The Scoreboard's three tabs: games by day, standings (the season explorer), my predictions
export const SCOREBOARD_VIEWS = ['scoreboard', 'explorer', 'mypicks', 'potw']
const KNOWN = new Set(['home', 'rankings', 'elo', 'binders', ...SCOREBOARD_VIEWS, ...SUB_IDS])

// Which top-level section a view sits under
export const topOf = v => (v === 'elo' || SUB_IDS.has(v) ? 'elo' : SCOREBOARD_VIEWS.includes(v) ? 'scoreboard' : v)

export function hrefFor(view, opts = {}) {
  if (view === 'home') return '/'
  if (view === 'scoreboard') return '/scoreboard'
  if (view === 'explorer') return '/scoreboard?tab=standings'
  if (view === 'mypicks') return '/scoreboard?tab=picks'
  if (view === 'potw') return '/scoreboard?tab=potw'
  if (view === 'timemachine') return '/timemachine'
  if (view === 'binders') return opts.open ? `/binders?open=${opts.open}` : '/binders'
  return `/?view=${view}`
}

export function viewFromUrl() {
  const p = window.location.pathname.replace(/\/+$/, '')
  const q = new URLSearchParams(window.location.search)
  if (p === '/scoreboard') return q.get('tab') === 'standings' ? 'explorer' : q.get('tab') === 'picks' ? 'mypicks' : q.get('tab') === 'potw' ? 'potw' : 'scoreboard'
  if (p === '/timemachine') return 'timemachine'
  if (p === '/binders') return 'binders'
  const v = q.get('view')
  return v && KNOWN.has(v) ? v : 'home'
}

// Props for an <a> that navigates in place on a plain click and keeps every browser behavior otherwise
// (new tab, new window, copy link, right-click menu)
export const linkTo = (href, go) => ({
  href,
  onClick: e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    go()
  },
})

export const TITLES = { scoreboard: 'Scoreboard', explorer: 'Standings', mypicks: 'My Predictions', potw: 'Player of the Week', binders: 'Binders', rankings: 'Current Rankings', elo: 'Elo Exploration',
  ...Object.fromEntries(ELO_SUBS.map(s => [s.view, s.label])) }
