export default async function handler(req, res) {
  const { teamId } = req.query
  if (!teamId) return res.status(400).json({ error: 'teamId required' })
  
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    const data = await r.json()
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(200).json(data)
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
}
