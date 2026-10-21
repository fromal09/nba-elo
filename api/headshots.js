// Returns { players: { normalizedName: { id, headshot, alt, team } } } built from all 30 live ESPN rosters.
// Cached at the edge for 12h so the page costs ~31 ESPN calls per half-day, not per view.
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
const UA = { headers: { 'User-Agent': 'Mozilla/5.0' } }

// ESPN abbreviations -> site (bbref-style) codes
const ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO', CHA: 'CHO', BKN: 'BKN' }

const espnImg = id => `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`
const nbaImg = id => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`

// Players whose ESPN roster entry has no usable headshot. Keyed by norm(name); values are NBA.com person IDs.
const NBA_IDS = {
  'kevin porter': 1629645,
}

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
        const key = norm(a.fullName || a.displayName || '')
        const nba = NBA_IDS[key]
        const espn = a.headshot?.href || espnImg(a.id)
        players[key] = {
          id: a.id,
          headshot: nba ? nbaImg(nba) : espn,
          alt: nba ? espn : null,
          team: code,
        }
      }
    }
    // Override players missing from every roster (injured list, two-way, mid-trade)
    for (const [key, nba] of Object.entries(NBA_IDS)) {
      if (!players[key]) players[key] = { id: null, headshot: nbaImg(nba), alt: null, team: null }
    }
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400')
    res.status(200).json({ fetched: new Date().toISOString(), count: Object.keys(players).length, players })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
