// Returns { players: { normalizedName: { id, headshot, team } } } built from all 30 live ESPN rosters.
// Cached at the edge for 12h so the page costs ~31 ESPN calls per half-day, not per view.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } }

// ESPN abbreviations -> site (bbref-style) codes
const ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO', CHA: 'CHO', BKN: 'BKN' }

export const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    const t = await (await fetch(`${BASE}/teams`, UA)).json()
    const teams = t.sports[0].leagues[0].teams.map(x => x.team)
    const rosters = await Promise.all(teams.map(async team => {
      try {
        const r = await (await fetch(`${BASE}/teams/${team.id}/roster`, UA)).json()
        return { team, athletes: r.athletes || [] }
      } catch { return { team, athletes: [] } }
    }))
    const players = {}
    for (const { team, athletes } of rosters) {
      const code = ABBR[team.abbreviation] || team.abbreviation
      for (const a of athletes) {
        players[norm(a.fullName || a.displayName || '')] = {
          id: a.id,
          headshot: a.headshot?.href || `https://a.espncdn.com/i/headshots/nba/players/full/${a.id}.png`,
          team: code,
        }
      }
    }
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400')
    res.status(200).json({ fetched: new Date().toISOString(), count: Object.keys(players).length, players })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
