// Same-origin copy of a card image (headshot, Wikimedia photo, team logo) for "Save card image". The renderer draws the
// card to a canvas, and a canvas can only use another site's image if that site allows it (CORS), which NBA.com and
// Wikimedia's redirects don't. Only image hosts the cards use; cached at the edge for a week.
const HOSTS = [/(^|\.)espncdn\.com$/, /^cdn\.nba\.com$/, /^(commons|upload)\.wikimedia\.org$/]
const UA = 'FPR card images (https://nba-elo.vercel.app)'

export default async function handler(req, res) {
  let u
  try { u = new URL(String(req.query.u || '')) } catch { return res.status(400).end() }
  if (u.protocol !== 'https:' || !HOSTS.some(h => h.test(u.hostname))) return res.status(400).end()
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://www.nba.com/' }, redirect: 'follow', signal: AbortSignal.timeout(10e3) })
    const type = r.headers.get('content-type') || ''
    if (!r.ok || !type.startsWith('image/')) return res.status(r.ok ? 415 : r.status).end()
    // Wherever a redirect landed, it has to be one of the hosts too
    if (!HOSTS.some(h => h.test(new URL(r.url).hostname))) return res.status(400).end()
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 6e6) return res.status(413).end()
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800')
    res.status(200).send(buf)
  } catch {
    res.status(502).end()
  }
}
