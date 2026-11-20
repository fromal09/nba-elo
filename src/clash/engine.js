/*
 * Full Court Clash: the rules, shared by the server (api/_lib/clash.js runs every match) and the client (which only
 * projects what a card would score before you commit it). Plain ESM, no DOM.
 *
 * A match: two 15-card decks, six turns, three courts revealed on turns 1–3; win two. Each turn adds energy equal to the
 * turn number and unspent energy carries over. You start with 3 cards and draw 1 a turn (7 at most in hand). Plays are
 * face-down until both sides commit; who reveals first alternates (you on odd turns). Cost comes from the card's tier,
 * power from Game Score ÷ 5 capped at 10, and up to two abilities (the two rarest) from the box score.
 * Synergy at a court: same franchise +1, same franchise and season +2, same game and team +3 (the best one counts),
 * plus +1 for a Real Duo (100+ games together) and +2 at a historic building the card's team played in that season.
 *
 * State is plain JSON. A card on the board is an instance { u, k, side, turn, mod } whose card is st.cards[k];
 * hydrate() attaches .c to every instance for the rules, dehydrate() takes it off to store the state.
 */

export const TIER_COST = { common: 1, rare: 2, standout: 3, legend: 4, icon: 5, goat: 6 }
export const TIER_NAME = ['', 'Common', 'Rare', 'Standout', 'Legend', 'Icon', 'GOAT']
export const LEVELS = ['easy', 'medium', 'hard', 'brutal']
export const LEVEL_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard', brutal: 'Brutal' }
export const FRANCHISES = ['ATL', 'BOS', 'BKN', 'CHO', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL',
  'MIN', 'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHO', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS']
export const NICK = { ATL: 'Hawks', BOS: 'Celtics', BKN: 'Nets', CHO: 'Hornets', CHI: 'Bulls', CLE: 'Cavaliers', DAL: 'Mavericks', DEN: 'Nuggets', DET: 'Pistons', GSW: 'Warriors',
  HOU: 'Rockets', IND: 'Pacers', LAC: 'Clippers', LAL: 'Lakers', MEM: 'Grizzlies', MIA: 'Heat', MIL: 'Bucks', MIN: 'Timberwolves', NOP: 'Pelicans', NYK: 'Knicks', OKC: 'Thunder',
  ORL: 'Magic', PHI: '76ers', PHO: 'Suns', POR: 'Trail Blazers', SAC: 'Kings', SAS: 'Spurs', TOR: 'Raptors', UTA: 'Jazz', WAS: 'Wizards' }
export const COLOR = { ATL: '#E03A3E', BOS: '#007A33', BKN: '#000000', CHO: '#1D1160', CHI: '#CE1141', CLE: '#860038', DAL: '#00538C', DEN: '#0E2240', DET: '#C8102E', GSW: '#1D428A',
  HOU: '#CE1141', IND: '#002D62', LAC: '#C8102E', LAL: '#552583', MEM: '#5D76A9', MIA: '#98002E', MIL: '#00471B', MIN: '#0C2340', NOP: '#0C2340', NYK: '#006BB6', OKC: '#007AC1',
  ORL: '#0077C0', PHI: '#006BB6', PHO: '#1D1160', POR: '#E03A3E', SAC: '#5A2D81', SAS: '#1B1B1B', TOR: '#CE1141', UTA: '#002B5C', WAS: '#002B5C' }
export const COLOR2 = { ATL: '#C1D32F', BOS: '#BA9653', BKN: '#FFFFFF', CHO: '#00788C', CHI: '#000000', CLE: '#FDBB30', DAL: '#B8C4CA', DEN: '#FEC524', DET: '#1D42BA', GSW: '#FFC72C',
  HOU: '#C4CED4', IND: '#FDBB30', LAC: '#1D428A', LAL: '#FDB927', MEM: '#12173F', MIA: '#F9A01B', MIL: '#EEE1C6', MIN: '#78BE20', NOP: '#C8102E', NYK: '#F58426', OKC: '#EF3B24',
  ORL: '#C4CED4', PHI: '#ED174C', PHO: '#E56020', POR: '#000000', SAC: '#63727A', SAS: '#C4CED4', TOR: '#000000', UTA: '#F9A01B', WAS: '#E31837' }
const MERGE = { 'DEN@ABA': 'DEN', 'IND@ABA': 'IND', 'SAS@ABA': 'SAS', 'BKN@ABA': 'BKN' }
export const fcOf = t => MERGE[t] || t
export const sy = c => +String(c.s).slice(0, 4)
const SUF = /^(Jr\.?|Sr\.?|II|III|IV)$/
export const cleanName = n => String(n).replace(/\s*\(.*\)$/, '')
export function lastName(n) { const p = cleanName(n).split(' '); let l = p[p.length - 1]; if (SUF.test(l) && p.length > 2) l = p[p.length - 2]; return l }
export function initials(n) { const p = cleanName(n).split(' ').filter(x => !SUF.test(x)); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() }

// ---------- Abilities ----------
// Rarest first (by how often each turns up in every game on record); a card keeps its two rarest
export const AB_ORDER = ['quad', 'micro', 'perfect', 'sure', 'charity', 'heat', 'fifty', 'debut', 'triple', 'blowout', 'ot', 'splash', 'iron', 'glass', 'floor', 'swat', 'pick', 'clutch', 'home']
// c: { pts, reb, ast, stl, blk, tp, min, ot, win, margin, home }; flags: 'p' perfect night, 'c' 20+ FT made, 's' 15+ assists no turnovers, 'd' debut
export function abilitiesOf(c, flags = '') {
  const a = [], { pts, reb, ast, stl, blk, tp, min } = c
  const dd = [pts, reb, ast, stl, blk].filter(x => x != null && x >= 10).length
  if (pts >= 50) a.push('fifty')
  if (dd >= 4) a.push('quad')
  else if (pts >= 10 && reb >= 10 && ast >= 10) a.push('triple')
  if (blk != null && blk >= 3) a.push('swat')
  if (stl != null && stl >= 3) a.push('pick')
  if (ast >= 10) a.push('floor')
  if (reb >= 15) a.push('glass')
  if (tp != null && tp >= 6) a.push('splash')
  if (flags.includes('p')) a.push('perfect')
  if (flags.includes('c')) a.push('charity')
  if (min != null && min >= 45) a.push('iron')
  if (c.ot && c.win) a.push('ot')
  if (flags.includes('d')) a.push('debut')
  if (c.home) a.push('home')
  if (pts >= 30 && min != null && min <= 24) a.push('micro')
  if (c.win && c.margin >= 40) a.push('blowout')
  if (flags.includes('s')) a.push('sure')
  if (c.win && c.margin > 0 && c.margin <= 4) a.push('clutch')
  if (pts >= 50 && !c.win) a.push('heat')
  return a.sort((x, y) => AB_ORDER.indexOf(x) - AB_ORDER.indexOf(y)).slice(0, 2)
}
export const AB = {
  fifty: { n: 'Fifty Burger', k: 'On reveal', t: c => `+${1 + Math.floor((c.pts - 50) / 10)}: 1, plus 1 per 10 points over 50.`, why: c => `${c.pts} points` },
  quad: { n: 'Quadruple-Double', k: 'Ongoing', t: () => 'Your other cards here get +2.', why: () => 'four categories in double figures' },
  triple: { n: 'Triple-Double', k: 'Ongoing', t: () => 'Your other cards here get +1.', why: c => `${c.pts}-${c.reb}-${c.ast}` },
  swat: { n: 'Swat Team', k: 'On reveal', t: c => `The opponent’s strongest card here loses ${Math.max(1, Math.floor(c.blk / 3))}.`, why: c => `${c.blk} blocks` },
  pick: { n: 'Pickpocket', k: 'On reveal', t: c => `Takes ${Math.max(1, Math.floor(c.stl / 3))} power from the opponent’s strongest card here.`, why: c => `${c.stl} steals` },
  floor: { n: 'Floor General', k: 'On reveal', t: c => `Your other cards here get +${1 + Math.floor((c.ast - 10) / 5)}.`, why: c => `${c.ast} assists` },
  glass: { n: 'Glass Cleaner', k: 'Ongoing', t: () => 'Your cards here can’t lose power.', why: c => `${c.reb} rebounds` },
  splash: { n: 'Splash', k: 'On reveal', t: c => `+${1 + Math.floor((c.tp - 6) / 3)} split across your cards at the other courts.`, why: c => `${c.tp} threes` },
  perfect: { n: 'Perfect Night', k: 'Ongoing', t: () => 'Can’t lose power.', why: () => 'no missed shots on 10 or more' },
  charity: { n: 'Charity Stripe', k: 'Ongoing', t: () => '+1 each time your opponent plays a card here.', why: () => '20 or more free throws made' },
  iron: { n: 'Iron Man', k: 'Ongoing', t: () => '+1 at the end of each turn.', why: c => `${c.min} minutes` },
  ot: { n: 'Overtime', k: 'End', t: () => 'If this court is tied, you win it. Overtime cards on both sides cancel out.', why: c => `won in ${c.ot}` },
  debut: { n: 'Debut', k: 'Cost', t: () => 'Costs 1 less.', why: () => 'his first game on record' },
  home: { n: 'Home Court', k: 'Ongoing', t: c => `+3 at ${ARENA_NAME(c.fc)}.`, why: () => 'a home game' },
  micro: { n: 'Microwave', k: 'Cost', t: () => 'Costs 1 less on turns 5 and 6.', why: c => `${c.pts} points in ${c.min} minutes` },
  blowout: { n: 'Blowout', k: 'On reveal', t: () => '+4 if you lead here by 5 or more when it’s revealed.', why: c => `won by ${c.margin}` },
  sure: { n: 'Sure Hands', k: 'Ongoing', t: () => 'Your cards here can’t be stolen from.', why: () => '15 or more assists, no turnovers' },
  clutch: { n: 'Clutch', k: 'End', t: () => 'If this court is within 3 after turn 6, +3.', why: c => `won by ${c.margin}` },
  heat: { n: 'Heat Check', k: 'End', t: () => 'If you lose this court, your weakest court gets +4.', why: c => `${c.pts} points in a loss` },
}
const has = (i, a) => i.c.ab.includes(a)

// ---------- Courts ----------
// g: Arena (the 30 current), Historic, Court, Global. floor: the art the client draws. era: [fc, from, to] seasons the
// franchise played there (Era Arena). Hooks: mod(i, x) a card's bonus, endTurn(st, L), onPlay(st, L, i), cost(st),
// canPlay(st, L, side), sideBonus(st, L, side), tie(st, L), slots, max, noReveal, noHome, splashTwice, guardFirst, setToCost, beam
const L_ = []
const arena = (fc, name, rule, fx, h = {}) => L_.push({ id: fc, name, g: 'Arena', fc, rule, fx, floor: 'maple', c1: COLOR[fc], c2: COLOR2[fc], ...h })
const loc = (id, name, g, rule, fx, floor, h = {}) => L_.push({ id, name, g, rule, fx, floor, ...h })
const MOD = f => ({ mod: f })
const sides = ['p', 'c']
arena('ATL', 'State Farm Arena', 'Highlight Factory', 'End of each turn: each side’s card here from the highest-scoring night gets +1.', { endTurn(st, L) { sides.forEach(s => { const a = L[s]; if (a.length) bump(st, a.reduce((x, y) => (y.c.pts > x.c.pts ? y : x)), 1, 'Highlight Factory') }) } })
arena('BOS', 'TD Garden', 'Banner Night', 'Cards from Celtics games get +2.', MOD(i => (i.c.fc === 'BOS' || i.c.o === 'BOS' ? 2 : 0)))
arena('BKN', 'Barclays Center', 'Downtown', 'Cards with 4+ threes get +2.', MOD(i => (i.c.tp >= 4 ? 2 : 0)))
arena('CHO', 'Spectrum Center', 'Buzz', 'The first card each side plays here each turn gets +1.', { onPlay(st, L, i) { const k = i.side + st.turn; L.f[k] = (L.f[k] || 0) + 1; if (L.f[k] === 1) bump(st, i, 1, 'Buzz') } })
arena('CHI', 'United Center', 'Statue', 'Each side’s strongest card here gets +2.', MOD((i, x) => (x.own.every(o => o === i || base(o) < base(i) || (base(o) === base(i) && o.u > i.u)) ? 2 : 0)))
arena('CLE', 'Rocket Arena', 'Comeback', 'After turn 4, the side behind here: its cards here get +2.', { endTurn(st, L) { if (st.turn !== 4) return; const t = totals(st)[L.i]; const s = t.p < t.c ? 'p' : t.c < t.p ? 'c' : null; if (s) L[s].forEach(i => bump(st, i, 2, 'Comeback')) } })
arena('DAL', 'American Airlines Center', 'Step-Back', 'Cards from 40-point nights get +2.', MOD(i => (i.c.pts >= 40 ? 2 : 0)))
arena('DEN', 'Ball Arena', 'Mile High', 'After turn 4, every card here loses 1, except cards from Nuggets games.', { endTurn(st, L) { if (st.turn !== 4) return; sides.forEach(s => L[s].forEach(i => { if (i.c.fc !== 'DEN' && i.c.o !== 'DEN') bump(st, i, -1, 'Mile High') })) } })
arena('DET', 'Little Caesars Arena', 'Rebuild', 'Cards whose player ranked outside the top 100 that night get +2.', MOD(i => (i.c.lr > 100 ? 2 : 0)))
arena('GSW', 'Chase Center', 'Splash Zone', 'Splash fires twice here.', { splashTwice: true })
arena('HOU', 'Toyota Center', 'Clutch City', 'A tie here goes to the side with more cards here.', { tie(st, L) { const a = L.p.length, b = L.c.length; return a > b ? 'p' : b > a ? 'c' : null } })
arena('IND', 'Gainbridge Fieldhouse', 'Hoosier Hysteria', 'Cards with 5+ assists get +2.', MOD(i => (i.c.ast >= 5 ? 2 : 0)))
arena('LAC', 'Intuit Dome', 'The Wall', 'The side with more cards here gets +3.', { sideBonus(st, L, s) { return L[s].length > L[other(s)].length ? 3 : 0 } })
arena('LAL', 'Crypto.com Arena', 'Showtime', 'Cards with 10+ assists get +2.', MOD(i => (i.c.ast >= 10 ? 2 : 0)))
arena('MEM', 'FedExForum', 'Grit and Grind', 'Cards with 3+ steals or 3+ blocks get +2.', MOD(i => (i.c.stl >= 3 || i.c.blk >= 3 ? 2 : 0)))
arena('MIA', 'Kaseya Center', 'Heat Culture', 'Cards that played 40+ minutes get +2.', MOD(i => (i.c.min >= 40 ? 2 : 0)))
arena('MIL', 'Fiserv Forum', 'Deer District', 'Cards with 10+ rebounds and 5+ assists get +2.', MOD(i => (i.c.reb >= 10 && i.c.ast >= 5 ? 2 : 0)))
arena('MIN', 'Target Center', 'Cold Open', 'Cards played here on turns 1 and 2 get +2.', MOD(i => (i.turn <= 2 ? 2 : 0)))
arena('NOP', 'Smoothie King Center', 'Second Line', 'When you play a card here, your previous card here gets +1.', { onPlay(st, L, i) { const a = L[i.side]; if (a.length > 1) bump(st, a[a.length - 2], 1, 'Second Line') } })
arena('NYK', 'Madison Square Garden', 'The Mecca', 'Cards from road games get +3.', MOD(i => (!i.c.home ? 3 : 0)))
arena('OKC', 'Paycom Center', 'Loud City', 'On reveal abilities don’t fire here.', { noReveal: true })
arena('ORL', 'Kia Center', 'Magic Number', 'Each side’s third card here gets +3.', MOD((i, x) => (x.own.indexOf(i) === 2 ? 3 : 0)))
arena('PHI', 'Xfinity Mobile Arena', 'Trust the Process', 'End of each turn: every card here gets +1.', { endTurn(st, L) { sides.forEach(s => L[s].forEach(i => bump(st, i, 1, 'Process'))) } })
arena('PHO', 'Mortgage Matchup Center', 'Seven Seconds', 'Cards cost 1 less here on turns 1–3.', { cost: st => (st.turn <= 3 ? -1 : 0) })
arena('POR', 'Moda Center', 'Rip City', 'The last card each side played here gets +3.', MOD((i, x) => (x.own[x.own.length - 1] === i ? 3 : 0)))
arena('SAC', 'Golden 1 Center', 'Light the Beam', 'After turn 6, whoever wins here adds +2 to their weakest other court.', { beam: true })
arena('SAS', 'Frost Bank Center', 'Fundamentals', 'Cards with no ability get +3.', MOD(i => (i.c.ab.length ? 0 : 3)))
arena('TOR', 'Scotiabank Arena', 'We the North', 'The first card each side plays here can’t lose power.', { guardFirst: true })
arena('UTA', 'Delta Center', 'Pick and Roll', 'Two of your teammates from the same game here: +2 each.', MOD((i, x) => (x.own.some(o => o !== i && o.c.g === i.c.g && o.c.fc === i.c.fc) ? 2 : 0)))
arena('WAS', 'Capital One Arena', 'Monuments', 'Cards from seasons through 1980 get +2.', MOD(i => (sy(i.c) <= 1980 ? 2 : 0)))
const HIS = (id, name, rule, fx, floor, c1, c2, era, h) => loc(id, name, 'Historic', rule, fx, floor, { c1, c2, era, ...h })
HIS('hershey', 'Hershey Sports Arena', '100', 'A card from a 50-point night gets +5.', 'old', null, null, null, MOD(i => (i.c.pts >= 50 ? 5 : 0)))
HIS('bgarden', 'Boston Garden', 'Parquet', 'End of each turn: a random card here loses 1.', 'parquet', '#007A33', '#ffffff', ['BOS', 1946, 1994], { endTurn(st, L) { const a = [...L.p, ...L.c]; if (a.length) bump(st, a[Math.floor(rand(st) * a.length)], -1, 'Parquet') } })
HIS('forum', 'The Forum', 'Fabulous Forum', 'Cards from 1979–80 through 1990–91 get +2.', 'maple', '#552583', '#FDB927', ['LAL', 1967, 1998], MOD(i => (sy(i.c) >= 1979 && sy(i.c) <= 1990 ? 2 : 0)))
HIS('chistad', 'Chicago Stadium', 'Madhouse on Madison', 'After turn 5, the side leading here gets +2 more.', 'maple', '#CE1141', '#000000', ['CHI', 1967, 1993], { endTurn(st, L) { if (st.turn !== 5) return; const t = totals(st)[L.i]; L.f.mad = t.p > t.c ? 'p' : t.c > t.p ? 'c' : null }, sideBonus: (st, L, s) => (L.f.mad === s ? 2 : 0) })
HIS('spectrum', 'The Spectrum', 'Fo, Fo, Fo', 'After turn 4, the side behind here can’t play here.', 'maple', '#006BB6', '#ED174C', ['PHI', 1967, 1995], { endTurn(st, L) { if (st.turn !== 4) return; const t = totals(st)[L.i]; L.f.shut = t.p < t.c ? 'p' : t.c < t.p ? 'c' : null }, canPlay: (st, L, s) => L.f.shut !== s })
HIS('seattle', 'Seattle Center Coliseum', 'Sonic Boom', 'Cards from SuperSonics games get +3.', 'maple', '#00653A', '#FFC200', ['OKC', 1967, 2007], MOD(i => ((i.c.fc === 'OKC' || i.c.o === 'OKC') && sy(i.c) < 2008 ? 3 : 0)))
HIS('capcentre', 'Capital Centre', 'Beltway', 'Cards from the 1970s get +2.', 'maple', '#C8102E', '#002B5C', ['WAS', 1973, 1996], MOD(i => (sy(i.c) >= 1970 && sy(i.c) <= 1979 ? 2 : 0)))
HIS('summit', 'The Summit', 'Twin Towers', 'Two of your centers here: +2 each.', 'maple', '#CE1141', '#FDB927', ['HOU', 1975, 2002], MOD((i, x) => (/C/.test(i.c.pos) && x.own.some(o => o !== i && /C/.test(o.c.pos)) ? 2 : 0)))
HIS('richfield', 'Richfield Coliseum', 'Miracle', 'On turn 6, a card played here by a side down 5+ gets +4.', 'maple', '#860038', '#FDBB30', ['CLE', 1974, 1993], { onPlay(st, L, i) { if (st.turn !== 6) return; const t = totals(st, i)[L.i]; if (t[other(i.side)] - t[i.side] >= 5) bump(st, i, 4, 'Miracle') } })
HIS('msa', 'Market Square Arena', 'Old Gym', 'Cards from 25-point nights get +2.', 'maple', '#002D62', '#FDBB30', ['IND', 1974, 1998], MOD(i => (i.c.pts >= 25 ? 2 : 0)))
HIS('omni', 'The Omni', 'Highlight Film', 'Cards from 30-point nights get +2.', 'maple', '#E03A3E', '#C1D32F', ['ATL', 1972, 1996], MOD(i => (i.c.pts >= 30 ? 2 : 0)))
HIS('reunion', 'Reunion Arena', 'Reunion', 'Two of your cards from the same franchise here: +2 each.', 'maple', '#00538C', '#B8C4CA', ['DAL', 1980, 2000], MOD((i, x) => (x.own.some(o => o !== i && o.c.fc === i.c.fc) ? 2 : 0)))
HIS('palace', 'The Palace of Auburn Hills', 'Bad Boys', 'Cards with 10+ rebounds get +2.', 'maple', '#1D42BA', '#C8102E', ['DET', 1988, 2016], MOD(i => (i.c.reb >= 10 ? 2 : 0)))
HIS('hive', 'Charlotte Coliseum', 'The Hive', 'If you have 3+ cards here, each gets +1.', 'maple', '#00788C', '#1D1160', ['CHO', 1988, 2001], MOD((i, x) => (x.own.length >= 3 ? 1 : 0)))
HIS('arco', 'ARCO Arena', 'Cowbells', 'Cards cost 1 more here.', 'maple', '#5A2D81', '#63727A', ['SAC', 1988, 2015], { cost: () => 1 })
HIS('hemisfair', 'HemisFair Arena', 'Small House', 'Three card slots per side.', 'maple', '#1B1B1B', '#C4CED4', ['SAS', 1973, 1992], { slots: 3 })
HIS('kiel', 'Kiel Auditorium', 'Old School', 'Cards from before 1970 get +2.', 'old', null, null, ['ATL', 1955, 1967], MOD(i => (sy(i.c) < 1970 ? 2 : 0)))
HIS('mpls', 'Minneapolis Auditorium', 'Mikan Drill', 'Cards with 10+ rebounds get +1.', 'old', null, null, ['LAL', 1947, 1959], MOD(i => (i.c.reb >= 10 ? 1 : 0)))
HIS('oakland', 'Oakland Arena', 'Roaracle', 'Cards from home games get +2.', 'maple', '#1D428A', '#FFC72C', ['GSW', 1971, 2018], MOD(i => (i.c.home ? 2 : 0)))
loc('rucker', 'Rucker Park', 'Court', 'Rucker Rules', 'The single strongest card here wins, not the total.', 'asphalt', { max: true })
loc('cage', 'The Cage', 'Court', 'Tight Court', 'Two card slots per side. Each card here gets +2.', 'asphalt', { slots: 2, ...MOD(() => 2) })
loc('drew', 'Drew League', 'Court', 'Pickup Run', 'A card with no franchise-mate on its side here gets +2.', 'asphalt', MOD((i, x) => (x.own.some(o => o !== i && o.c.fc === i.c.fc) ? 0 : 2)))
loc('goodman', 'Goodman League', 'Court', 'Summer Run', 'Cards from 20-point, 30-minute nights get +2.', 'asphalt', MOD(i => (i.c.pts >= 20 && i.c.min >= 30 ? 2 : 0)))
loc('palestra', 'The Palestra', 'Court', 'Cathedral', 'Debut cards get +3.', 'maple', { c1: '#8a1c2b', c2: '#ffffff', ...MOD(i => (has(i, 'debut') ? 3 : 0)) })
loc('ymca', 'Springfield YMCA, 1891', 'Court', 'Peach Baskets', 'Every card here has power equal to its cost.', 'ymca', { setToCost: true })
loc('venice', 'Venice Beach', 'Court', 'Sun Glare', 'Cards played here on turns 4–6 get −1.', 'concrete', MOD(i => (i.turn >= 4 ? -1 : 0)))
loc('o2', 'The O2', 'Global', 'Global Game', 'Home Court doesn’t work here.', 'maple', { c1: '#1a2a6c', c2: '#e03a3e', noHome: true })
loc('accor', 'Accor Arena', 'Global', 'Jet Lag', 'Cards played on turns 1–2 get −1; on turns 5–6, +1.', 'maple', { c1: '#0b2a6b', c2: '#ef4135', ...MOD(i => (i.turn <= 2 ? -1 : i.turn >= 5 ? 1 : 0)) })
loc('cdmx', 'Arena CDMX', 'Global', 'Altitude', 'After turn 5, cards here lose 1, except Iron Man cards.', 'maple', { c1: '#006847', c2: '#ce1126', endTurn(st, L) { if (st.turn !== 5) return; sides.forEach(s => L[s].forEach(i => { if (!has(i, 'iron')) bump(st, i, -1, 'Altitude') })) } })
loc('badalona', 'Badalona, 1992', 'Global', 'Dream Team', 'Three All-Time 100 cards on one side here: +3 each.', 'fiba', MOD((i, x) => (x.st.at100.includes(i.c.n) && x.own.filter(o => x.st.at100.includes(o.c.n)).length >= 3 ? 3 : 0)))
loc('tmobile', 'T-Mobile Arena', 'Global', 'Knockout', 'After turn 4, this court locks: no more cards here.', 'cup', { endTurn(st, L) { if (st.turn === 4) L.f.lock = true }, canPlay: (st, L) => !L.f.lock })
export const LOCS = L_
export const LOCBY = Object.fromEntries(L_.map(l => [l.id, l]))
export function ARENA_NAME(fc) { return LOCBY[fc]?.name || 'his home arena' }
// A franchise's courts: its arena, then the old buildings it played in
export const venues = fc => [fc, ...L_.filter(l => l.era && l.era[0] === fc).map(l => l.id)].slice(0, 3)

// ---------- Random numbers (serializable: a seed and a counter) ----------
function mulberry(a) { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
export const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
export const rng = seed => { let n = 0; return () => mulberry(seed + 7919 * n++) }
function rand(st) { if (st.sim) return 0.5; st.rn = (st.rn || 0) + 1; return mulberry(st.seed + 7919 * st.rn) }
export const shuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

// ---------- Rules ----------
export const other = s => (s === 'p' ? 'c' : 'p')
const NODEF = {}
export const DEF = L => (L.revealed ? LOCBY[L.id] : NODEF)
export const slotsOf = L => DEF(L).slots || 4
const base = i => i.c.pw + i.mod
function protectedFrom(st, i) {
  if (has(i, 'perfect')) return true
  const L = st.locs[i.li]
  if (L[i.side].some(o => has(o, 'glass'))) return true
  if (DEF(L).guardFirst && L[i.side][0] === i) return true
  return false
}
function fx(st, i, t, col) { st.fx.push({ u: i.u, t, c: col }) }
function bump(st, i, v, why) {
  if (v < 0 && protectedFrom(st, i)) { fx(st, i, 'Protected', 'good'); return false }
  i.mod += v; fx(st, i, `${v > 0 ? '+' : ''}${v} ${why}`, v > 0 ? 'up' : 'down'); return true
}
const pairN = (st, a, b) => st.pairs[[a, b].sort().join('|')] || 0
function synergy(st, i, own) {
  const out = []
  let tier = 0
  own.forEach(o => { if (o === i || o.c.fc !== i.c.fc) return; const t = o.c.g === i.c.g ? 3 : o.c.s === i.c.s ? 2 : 1; if (t > tier) tier = t })
  if (tier) out.push([tier, tier === 3 ? 'Same game' : tier === 2 ? 'Same season' : 'Same franchise', 'syn'])
  if (own.some(o => o !== i && o.c.n !== i.c.n && pairN(st, o.c.n, i.c.n) >= 100)) out.push([1, 'Real Duo', 'syn'])
  return out
}
// A card's power where it stands, row by row: [value, label, kind]
export function breakdown(st, i) {
  const L = st.locs[i.li], def = DEF(L)
  const own = L[i.side], opp = L[other(i.side)]
  if (def.setToCost) return { rows: [[i.c.cost, 'Peach Baskets: power equals cost', 'loc']], total: i.c.cost }
  const rows = [[i.c.pw, `Game Score ${i.c.gs} ÷ 5${i.c.gs / 5 > 10.5 ? ', capped at 10' : ''}`, 'base']]
  if (i.mod) rows.push([i.mod, 'Effects so far', 'mod'])
  if (def.mod) { const v = def.mod(i, { own, opp, st, L }); if (v) rows.push([v, def.rule, 'loc']) }
  own.forEach(o => { if (o === i) return; if (has(o, 'quad')) rows.push([2, `Quadruple-Double (${lastName(o.c.n)})`, 'ab']); else if (has(o, 'triple')) rows.push([1, `Triple-Double (${lastName(o.c.n)})`, 'ab']) })
  if (has(i, 'home') && def.fc === i.c.fc && !def.noHome) rows.push([3, 'Home Court', 'ab'])
  if (def.era && def.era[0] === i.c.fc && sy(i.c) >= def.era[1] && sy(i.c) <= def.era[2]) rows.push([2, 'Era Arena', 'syn'])
  synergy(st, i, own).forEach(r => rows.push(r))
  let total = rows.reduce((s, r) => s + r[0], 0)
  if (total < i.c.pw + Math.max(0, i.mod) && protectedFrom(st, i)) total = i.c.pw + Math.max(0, i.mod)
  return { rows, total: Math.max(0, total) }
}
export const power = (st, i) => breakdown(st, i).total
export function totals(st, ignore) {
  return st.locs.map(L => {
    const t = {}
    sides.forEach(s => {
      const ps = L[s].filter(i => i !== ignore).map(i => power(st, i))
      t[s] = DEF(L).max ? (ps.length ? Math.max(...ps) : 0) : ps.reduce((a, b) => a + b, 0)
      if (DEF(L).sideBonus) t[s] += DEF(L).sideBonus(st, L, s)
      t[s] += L.extra[s] || 0
    })
    return t
  })
}
export function costOf(st, c, li) {
  let k = c.cost
  if (c.ab.includes('debut')) k -= 1
  if (c.ab.includes('micro') && st.turn >= 5) k -= 1
  if (li != null && DEF(st.locs[li]).cost) k += DEF(st.locs[li]).cost(st)
  return Math.max(0, k)
}
export function canPlayAt(st, side, li, extra = 0) {
  const L = st.locs[li]
  if (L[side].length + extra >= slotsOf(L)) return false
  if (DEF(L).canPlay && !DEF(L).canPlay(st, L, side)) return false
  return true
}
function strongest(st, arr) { let b = null, bp = -1; arr.forEach(i => { const p = power(st, i); if (p > bp) { b = i; bp = p } }); return b }
export function place(st, side, c, li) {
  const i = { u: st.uid++, k: c.k, c, side, turn: st.turn, mod: 0, li }
  st.locs[li][side].push(i)
  return i
}
export function reveal(st, i) {
  const L = st.locs[i.li], o = other(i.side), def = DEF(L)
  L[o].forEach(x => { if (has(x, 'charity')) bump(st, x, 1, 'Charity Stripe') })
  if (def.onPlay) def.onPlay(st, L, i)
  if (def.noReveal) return
  for (const a of i.c.ab) {
    if (a === 'fifty') bump(st, i, 1 + Math.floor((i.c.pts - 50) / 10), 'Fifty Burger')
    if (a === 'swat') { const t = strongest(st, L[o]); if (t) bump(st, t, -Math.max(1, Math.floor(i.c.blk / 3)), 'Swat Team') }
    if (a === 'pick') {
      const t = strongest(st, L[o])
      if (t) {
        if (L[o].some(x => has(x, 'sure'))) fx(st, t, 'Sure Hands', 'good')
        else { const v = Math.max(1, Math.floor(i.c.stl / 3)); if (bump(st, t, -v, 'Pickpocket')) bump(st, i, v, 'Pickpocket') }
      }
    }
    if (a === 'floor') { const v = 1 + Math.floor((i.c.ast - 10) / 5); L[i.side].forEach(x => { if (x !== i) bump(st, x, v, 'Floor General') }) }
    if (a === 'blowout') { const t = totals(st, i)[i.li]; if (t[i.side] - t[o] >= 5) bump(st, i, 4, 'Blowout') }
    if (a === 'splash') {
      let n = (1 + Math.floor((i.c.tp - 6) / 3)) * (def.splashTwice ? 2 : 1)
      const others = st.locs.filter(x => x !== L && x[i.side].length)
      let k = 0
      while (n > 0 && others.length) { const X = others[k % others.length]; bump(st, strongest(st, X[i.side]), 1, 'Splash'); n--; k++ }
    }
  }
}
function endOfTurn(st) {
  st.locs.forEach(L => sides.forEach(s => L[s].forEach(i => { if (has(i, 'iron')) bump(st, i, 1, 'Iron Man') })))
  st.locs.forEach(L => { if (L.revealed && LOCBY[L.id].endTurn) LOCBY[L.id].endTurn(st, L) })
}
function finalScore(st) {
  const log = []
  const t0 = totals(st)
  st.locs.forEach((L, li) => sides.forEach(s => {
    if (L[s].some(i => has(i, 'clutch')) && Math.abs(t0[li][s] - t0[li][other(s)]) <= 3) { L.extra[s] = (L.extra[s] || 0) + 3; log.push([s, `Clutch +3 at ${LOCBY[L.id].name}`]) }
  }))
  let t = totals(st)
  st.locs.forEach((L, li) => sides.forEach(s => {
    if (L[s].some(i => has(i, 'heat')) && t[li][s] < t[li][other(s)]) {
      const weak = [0, 1, 2].filter(k => k !== li).sort((a, b) => t[a][s] - t[b][s])[0]
      st.locs[weak].extra[s] = (st.locs[weak].extra[s] || 0) + 4; log.push([s, `Heat Check +4 at ${LOCBY[st.locs[weak].id].name}`])
    }
  }))
  t = totals(st)
  const win = st.locs.map((L, li) => {
    const a = t[li].p, b = t[li].c
    if (a !== b) return a > b ? 'p' : 'c'
    const op = L.p.some(i => has(i, 'ot')), oc = L.c.some(i => has(i, 'ot'))
    if (op && !oc) return 'p'
    if (oc && !op) return 'c'
    return LOCBY[L.id].tie ? LOCBY[L.id].tie(st, L) : null
  })
  st.locs.forEach((L, li) => {
    const s = win[li]
    if (LOCBY[L.id].beam && s) { const weak = [0, 1, 2].filter(k => k !== li).sort((a, b) => t[a][s] - t[b][s])[0]; st.locs[weak].extra[s] = (st.locs[weak].extra[s] || 0) + 2; log.push([s, `Light the Beam +2 at ${LOCBY[st.locs[weak].id].name}`]) }
  })
  t = totals(st)
  const w = st.locs.map((L, li) => (t[li].p !== t[li].c ? (t[li].p > t[li].c ? 'p' : 'c') : win[li]))
  const np = w.filter(x => x === 'p').length, nc = w.filter(x => x === 'c').length
  let winner = np > nc ? 'p' : nc > np ? 'c' : null
  if (!winner) { const sp = t.reduce((s, x) => s + x.p, 0), sc = t.reduce((s, x) => s + x.c, 0); winner = sp > sc ? 'p' : sc > sp ? 'c' : null }
  return { t, w, winner, np, nc, log }
}

// ---------- Matches ----------
// opts: { pDeck, cDeck: [card], locs: [court ids] (fills to 3 at random), seed, pairs: {"a|b": n}, at100: [names], meta }
export function newMatch({ pDeck, cDeck, locs = [], seed, pairs = {}, at100 = [], meta = {} }) {
  const r = rng(seed)
  const cards = {}
  pDeck.forEach(c => { cards[c.k] = c }); cDeck.forEach(c => { cards[c.k] = c })
  const ids = locs.filter(id => LOCBY[id]).slice(0, 3)
  for (const l of shuffle(LOCS, r)) { if (ids.length >= 3) break; if (!ids.includes(l.id)) ids.push(l.id) }
  const st = {
    v: 1, ...meta, seed: (seed * 31 + 17) >>> 0, rn: 0, uid: 1, turn: 0, energy: { p: 0, c: 0 },
    deck: { p: shuffle(pDeck.map(c => c.k), r), c: shuffle(cDeck.map(c => c.k), r) }, hand: { p: [], c: [] },
    locs: ids.map((id, i) => ({ i, id, revealed: false, p: [], c: [], f: {}, extra: {} })),
    cards, pairs, at100, fx: [], log: [], over: null,
  }
  hydrate(st)
  for (let k = 0; k < 3; k++) { draw(st, 'p'); draw(st, 'c') }
  startTurn(st)
  return st
}
function draw(st, s) { if (st.deck[s].length && st.hand[s].length < 7) st.hand[s].push(st.deck[s].shift()) }
function startTurn(st) {
  st.turn += 1
  if (st.turn <= 3) st.locs[st.turn - 1].revealed = true
  st.energy.p += st.turn; st.energy.c += st.turn
  draw(st, 'p'); draw(st, 'c')
}
export function hydrate(st) { st.locs.forEach((L, li) => sides.forEach(s => L[s].forEach(i => { i.c = st.cards[i.k]; i.li = li }))); st.fx = st.fx || []; return st }
export function dehydrate(st) {
  const out = { ...st, locs: st.locs.map(L => ({ ...L, p: L.p.map(({ c, ...i }) => i), c: L.c.map(({ c, ...i }) => i) })) }
  delete out.fx; delete out.sim
  return out
}
// Check and play a turn. plays: [{ k: a card in your hand, li }]. Returns the reveal, step by step, for the client
export function playTurn(st, plays) {
  if (st.over) throw new Error('This match is over.')
  plays = (plays || []).map(p => ({ k: String(p.k), li: +p.li }))
  const hand = st.hand.p.slice()
  let spent = 0
  const per = [0, 0, 0]
  for (const p of plays) {
    const at = hand.indexOf(p.k)
    if (at < 0) throw new Error('That card isn’t in your hand.')
    if (!(p.li >= 0 && p.li <= 2)) throw new Error('Pick a court.')
    if (!canPlayAt(st, 'p', p.li, per[p.li])) throw new Error('No room there.')
    hand.splice(at, 1); per[p.li]++
    spent += costOf(st, st.cards[p.k], p.li)
  }
  if (spent > st.energy.p) throw new Error('Not enough energy.')
  const cplan = cpuPlan(st, plays)
  st.energy.p -= spent
  cplan.forEach(x => { st.energy.c -= costOf(st, x.c, x.li); st.hand.c.splice(st.hand.c.indexOf(x.c.k), 1) })
  st.hand.p = hand
  const pp = plays.map(p => ({ side: 'p', c: st.cards[p.k], li: p.li })), cp = cplan.map(x => ({ side: 'c', c: x.c, li: x.li }))
  const order = st.turn % 2 ? [...pp, ...cp] : [...cp, ...pp]
  const steps = []
  for (const p of order) {
    st.fx = []
    if (!canPlayAt(st, p.side, p.li)) { steps.push({ side: p.side, k: p.c.k, li: p.li, skip: true, fx: [], board: board(st) }); continue }
    const i = place(st, p.side, p.c, p.li)
    reveal(st, i)
    steps.push({ side: p.side, k: p.c.k, u: i.u, li: p.li, fx: st.fx, board: board(st) })
    st.log.push([p.side, `${cleanName(p.c.n)} to ${LOCBY[st.locs[p.li].id].name}${st.fx.length ? ` · ${st.fx.map(f => f.t).join(', ')}` : ''}`])
  }
  st.fx = []
  endOfTurn(st)
  steps.push({ end: true, fx: st.fx, board: board(st) })
  st.fx = []
  if (st.turn >= 6) { st.over = finalScore(st); st.over.log.forEach(x => st.log.push(x)); delete st.over.log }
  else startTurn(st)
  st.log = st.log.slice(-12)
  return steps
}
// The board as both players see it
export function board(st) {
  const t = totals(st)
  return st.locs.map((L, li) => ({ id: L.revealed ? L.id : null, f: { lock: !!L.f.lock, shut: L.f.shut || null }, t: t[li],
    p: L.p.map(i => ({ u: i.u, k: i.k, pw: power(st, i), mod: i.mod, turn: i.turn })), c: L.c.map(i => ({ u: i.u, k: i.k, pw: power(st, i), mod: i.mod, turn: i.turn })) }))
}
// What the player may see: the board, your hand, both sides' energy and counts, every card on the board or in your hand
export function publicView(st) {
  const seen = new Set(st.hand.p)
  st.locs.forEach(L => sides.forEach(s => L[s].forEach(i => seen.add(i.k))))
  const cards = {}; seen.forEach(k => { cards[k] = st.cards[k] })
  return {
    turn: st.turn, energy: st.energy, hand: st.hand.p, handC: st.hand.c.length, deckP: st.deck.p.length, deckC: st.deck.c.length,
    locs: st.locs.map(L => ({ i: L.i, id: L.revealed ? L.id : null, revealed: L.revealed, f: L.f, extra: L.extra, p: L.p.map(({ c, li, ...i }) => i), c: L.c.map(({ c, li, ...i }) => i) })),
    cards, pairs: st.pairs, at100: st.at100, over: st.over, log: st.log, uid: st.uid,
  }
}
// The client's copy of a public view, rebuilt as a state the rules can project on (no CPU hand: it only places your cards)
export function fromPublic(v) {
  const st = { ...v, seed: 1, rn: 0, sim: true, fx: [], deck: { p: [], c: [] }, hand: { p: v.hand.slice(), c: [] },
    locs: v.locs.map(L => ({ ...L, id: L.id || '_hidden', f: { ...L.f }, extra: { ...L.extra }, p: L.p.map(i => ({ ...i })), c: L.c.map(i => ({ ...i })) })) }
  st.locs.forEach(L => { if (!L.revealed) L.id = '_hidden' })
  return hydrate(st)
}
LOCBY._hidden = { id: '_hidden', name: 'Unrevealed court', rule: '', fx: '' }
// What a card would do at a court this turn, given the cards you've already put down this turn
export function project(st, staged, k, li) {
  const x = clone(st); x.sim = true
  staged.forEach(sp => reveal(x, place(x, 'p', x.cards[sp.k], sp.li)))
  const before = totals(x)[li]
  x.fx = []
  const i = place(x, 'p', x.cards[k], li)
  reveal(x, i)
  const after = totals(x)[li], bd = breakdown(x, i)
  return { you: after.p, opp: after.c, d: after.p - before.p, pw: bd.total, rows: bd.rows, fx: x.fx.filter(f => f.u !== i.u) }
}

// ---------- The CPU ----------
// The same at every level: it sees where you put this turn's cards (not which ones, which it guesses from the strength of
// your cards already on the board) and searches every play of up to four cards from its hand at every court.
function clone(st) {
  const locs = st.locs.map(L => ({ ...L, f: { ...L.f }, extra: { ...L.extra }, p: L.p.map(x => ({ ...x })), c: L.c.map(x => ({ ...x })) }))
  return { ...st, locs, fx: [], log: [], sim: true }
}
function evalSt(st, s, turn) {
  const t = totals(st), o = other(s)
  const diffs = t.map(x => x[s] - x[o])
  if (turn >= 6) return diffs.filter(d => d > 0).length * 40 - diffs.filter(d => d < 0).length * 40 + diffs.reduce((a, b) => a + Math.max(-6, Math.min(6, b)), 0)
  const sorted = diffs.slice().sort((a, b) => b - a)
  const cush = 3 + (6 - turn) * 1.5
  let v = 0
  diffs.forEach(d => { v += Math.tanh(d / cush) * 10 })
  v += Math.tanh(sorted[1] / cush) * 12
  v -= Math.max(0, sorted[0] - cush * 2) * 0.4
  return v
}
const GHOST = { n: '?', fc: '', o: '', s: '0000', d: '', g: '', home: 0, win: 0, margin: 0, ot: '', pos: '', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tp: 0, min: 0, gs: 0, lr: 999, cost: 0, ab: [] }
function reserveValue(st, energyLeft, handLeft) {
  if (st.turn >= 6) return 0
  const next = energyLeft + st.turn + 1
  return handLeft.filter(c => c.cost > st.turn + 1 && c.cost <= next).reduce((m, c) => Math.max(m, c.pw), 0) * 0.9
}
export function cpuPlan(st, pStaged) {
  const hand = st.hand.c.map(k => st.cards[k]), E = st.energy.c, lis = [0, 1, 2]
  const seen = []; st.locs.forEach(L => L.p.forEach(i => seen.push(i.c.pw)))
  const est = seen.length ? Math.round(seen.reduce((a, b) => a + b, 0) / seen.length) : 5
  const b0 = clone(st)
  ;(pStaged || []).forEach((x, n) => { if (canPlayAt(b0, 'p', x.li)) place(b0, 'p', { ...GHOST, k: `ghost${n}`, g: `ghost${n}`, pw: est }, x.li) })
  let best = { v: evalSt(b0, 'c', st.turn) + reserveValue(st, E, hand), plays: [] }
  const n = hand.length, combos = []
  for (let a = 0; a < n; a++) { combos.push([a]); for (let b = a + 1; b < n; b++) { combos.push([a, b]); for (let c = b + 1; c < n; c++) { combos.push([a, b, c]); for (let d = c + 1; d < n; d++) combos.push([a, b, c, d]) } } }
  const PL = [null, lis.map(a => [a]), lis.flatMap(a => lis.map(b => [a, b])), lis.flatMap(a => lis.flatMap(b => lis.map(c => [a, b, c]))), lis.flatMap(a => lis.flatMap(b => lis.flatMap(c => lis.map(d => [a, b, c, d]))))]
  for (const cb of combos) {
    const cs = cb.map(k => hand[k])
    if (cs.reduce((m, c) => m + Math.max(0, c.cost - 2), 0) > E) continue
    for (const pl of PL[cs.length]) {
      let used = 0, ok = true
      const plays = []
      for (let k = 0; k < cs.length; k++) {
        const kc = costOf(b0, cs[k], pl[k])
        if (used + kc > E || !canPlayAt(b0, 'c', pl[k], plays.filter(p => p.li === pl[k]).length)) { ok = false; break }
        used += kc; plays.push({ c: cs[k], li: pl[k] })
      }
      if (!ok) continue
      const x = clone(b0)
      plays.forEach(p => reveal(x, place(x, 'c', p.c, p.li)))
      const v = evalSt(x, 'c', st.turn) + reserveValue(st, E - used, hand.filter((_, k) => !cb.includes(k)))
      if (v > best.v) best = { v, plays }
    }
  }
  return best.plays
}

// ---------- Cards ----------
// A row of clash/decks.json as a card
export function cardFromRow(K, row, idx) { const c = { k: `c${idx}` }; K.forEach((f, j) => { c[f] = row[j] }); return c }
// A binder card (its stored JSON) as a card. flags: that game's letters from clash/flags.json
export function cardFromBinder(id, card, flags = '') {
  const r = card.row || {}
  const [us, them] = String(card.score || '').split(/[–-]/).map(Number)
  const c = { k: `u${id}`, id: Number(id), n: r.n, fc: fcOf(card.t), o: fcOf(card.o), d: card.date, s: card.s, g: card.id, home: card.home ? 1 : 0, win: card.won ? 1 : 0,
    margin: Number.isFinite(us - them) ? us - them : 0, ot: card.ot || '', pos: r.pos || '', pts: r.pts || 0, reb: r.trb || 0, ast: r.ast || 0, stl: r.stl ?? null, blk: r.blk ?? null,
    tp: r.tp ?? null, min: r.mp ?? null, gs: r.gs ?? 0, lr: r.lr ?? 999, cost: TIER_COST[card.tier] || 1, tier: card.tier, ruby: !!card.ruby, tn: card.tn, on: card.on }
  c.pw = Math.max(0, Math.min(10, Math.round((c.gs || 0) / 5)))
  c.ab = abilitiesOf(c, flags)
  return c
}
// Can this binder card play? Game cards only (no special cards), from one of today's 30 franchises
export const playable = card => !!card && !card.kind && card.row?.gs != null && FRANCHISES.includes(fcOf(card.t))

// ---------- Daily decks ----------
// Four decks a day from every franchise's cards, the same for everyone; the level sets how good the nights are
export function dailyDeck(D, day, lv) {
  const r = rng(hash(day + lv))
  const pool = D.daily.map(i => cardFromRow(D.K, D.cards[i], i))
  const byCost = {}
  pool.forEach(c => { (byCost[c.cost] = byCost[c.cost] || []).push(c) })
  Object.values(byCost).forEach(a => a.sort((x, y) => (y.pw + 0.8 * y.ab.length) - (x.pw + 0.8 * x.ab.length)))
  const CURVE = { 1: 4, 2: 3, 3: 3, 4: 2, 5: 2, 6: 1 }
  const band = { easy: [0.5, 1], medium: [0.25, 0.6], hard: [0.08, 0.3], brutal: [0, 0.1] }[lv]
  const out = [], per = {}
  Object.entries(CURVE).forEach(([k, n]) => {
    const a = byCost[k] || [], lo = Math.floor(a.length * band[0]), hi = Math.max(lo + n + 2, Math.floor(a.length * band[1]))
    let got = 0
    for (const c of shuffle(a.slice(lo, hi), r)) { if (got >= n) break; if (per[c.n]) continue; out.push(c); per[c.n] = 1; got++ }
  })
  for (const c of shuffle(pool, r)) { if (out.length >= 15) break; if (!per[c.n]) { out.push(c); per[c.n] = 1 } }
  return out.slice(0, 15)
}
export const deckOf = (D, ids) => ids.map(i => cardFromRow(D.K, D.cards[i], i))
