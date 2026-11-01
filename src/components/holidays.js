// Holiday games for holiday cards (scripts/holidays.py has the same dates): a card from a game played on one of
// these dates is a holiday card. Halloween, Thanksgiving (fourth Thursday of November), Christmas, MLK Day (third
// Monday of January, since 1986) and Valentine's Day.
export const HOLIDAYS = {
  hal: { name: 'Halloween', short: 'Halloween', a: '#1c0f2e', b: '#f07c1a', c: '#ffe8c4', d: '#5b2a86' },
  thx: { name: 'Thanksgiving', short: 'Thanksgiving', a: '#5a2a12', b: '#d98a2b', c: '#fff1d6', d: '#a8441c' },
  xmas: { name: 'Christmas', short: 'Christmas', a: '#0f4d2c', b: '#c8202f', c: '#fff7ea', d: '#e9c46a' },
  mlk: { name: 'MLK Day', short: 'MLK Day', a: '#141a3a', b: '#d8b04a', c: '#fffaf0', d: '#4b3a8c' },
  val: { name: "Valentine's Day", short: "Valentine's", a: '#7a0d2c', b: '#ff6f9a', c: '#fff0f4', d: '#ffd1de' },
}
const nth = (y, m, wd, n) => { const d = new Date(Date.UTC(y, m - 1, 1)); d.setUTCDate(1 + ((wd - d.getUTCDay() + 7) % 7) + 7 * (n - 1)); return d.getUTCDate() }
export function holidayOf(day) {
  if (!day) return null
  const y = +day.slice(0, 4), m = +day.slice(5, 7), d = +day.slice(8, 10)
  if (m === 10 && d === 31) return 'hal'
  if (m === 12 && d === 25) return 'xmas'
  if (m === 2 && d === 14) return 'val'
  if (m === 11 && d === nth(y, 11, 4, 4)) return 'thx'
  if (m === 1 && y >= 1986 && d === nth(y, 1, 1, 3)) return 'mlk'
  return null
}
// The holiday whose week this is (three days either side of the date), for the store's holiday pack and the
// daily pack's holiday slot: { k, ...HOLIDAYS[k], day } or null
const addDays = (day, k) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
export function holidayNear(day) {
  for (let k = -3; k <= 3; k++) { const d = addDays(day, k), h = holidayOf(d); if (h) return { k: h, ...HOLIDAYS[h], day: d } }
  return null
}
