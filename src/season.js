// Season helpers. A season "starts" in September: Oct 2026 is 2026-27, Jun 2027 is still 2026-27.
export const seasonStartYear = (d = new Date()) => (d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1)
export const seasonLabel = (y = seasonStartYear(), sep = '-') => `${y}${sep}${String(y + 1).slice(-2)}`
export const CURRENT_SEASON_YEAR = seasonStartYear()
export const CURRENT_SEASON = seasonLabel(CURRENT_SEASON_YEAR)
