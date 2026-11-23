/*
 * Full Court Clash: the rules, shared by the server (api/_lib/clash.js runs every match) and the client (which only
 * projects what a card would score before you commit it). Plain ESM, no DOM.
 *
 * A match: two 15-card decks, six turns, three courts revealed on turns 1–3; win two. Each turn adds energy equal to the
 * turn number and unspent energy carries over. You start with 3 cards and draw 1 a turn (7 at most in hand). Plays are
 * face-down until both sides commit; a jump ball decides who reveals first on turn 1, then the possession arrow
 * alternates it. Each turn you may use one franchise power: the power of a franchise you played a card from that turn. Cost comes from the card's tier,
 * power from the tier's range placed by Game Score (POWER_RANGE), up to two box-score abilities on cost 1–3 cards, and
 * one signature move on cost 4–6 cards (SIG).
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
export const AB_ORDER = ['quad', 'micro', 'perfect', 'sure', 'charity', 'heat', 'fifty', 'debut', 'triple', 'blowout', 'ot', 'splash', 'iron', 'glass', 'floor', 'swat', 'pick', 'clutch']
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
// Home Court: +3 for a card from a home game, at the building that game was played in. Today's arenas from the date
// they opened (or the team moved in); the old buildings by the seasons in their era. Not the 2020 bubble, the Raptors'
// Tampa season or the Hornets' Oklahoma City seasons.
const ARENA_FROM = { ATL: '1999-09-01', BOS: '1995-09-01', BKN: '2012-09-01', CHO: '2005-09-01', CHI: '1994-09-01', CLE: '1994-09-01', DAL: '2001-09-01',
  DEN: '1999-09-01', DET: '2017-09-01', GSW: '2019-09-01', HOU: '2003-09-01', IND: '1999-09-01', LAC: '2024-09-01', LAL: '1999-09-01', MEM: '2004-09-01',
  MIA: '2000-01-01', MIL: '2018-09-01', MIN: '1990-09-01', NOP: '2002-09-01', NYK: '1968-02-14', OKC: '2008-09-01', ORL: '2010-09-01', PHI: '1996-09-01',
  PHO: '1992-06-01', POR: '1995-09-01', SAC: '2016-09-01', SAS: '2002-09-01', TOR: '1999-02-20', UTA: '1991-09-01', WAS: '1997-12-01' }
const AWAY_SPELLS = [['', '2020-07-01', '2020-10-31'], ['TOR', '2020-12-01', '2021-06-30'], ['NOP', '2005-09-01', '2007-06-30']]
export function homeAt(def, c) {
  if (!c?.home || !def) return false
  const d = String(c.d || '')
  if (AWAY_SPELLS.some(([fc, a, b]) => (!fc || fc === c.fc) && d >= a && d <= b)) return false
  if (def.fc && def.g === 'Arena') return def.fc === c.fc && d >= (ARENA_FROM[c.fc] || '9999')
  if (def.era) return def.era[0] === c.fc && sy(c) >= def.era[1] && sy(c) <= def.era[2]
  return false
}
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
  if (has(i, 'perfect') || i.guard) return true
  const L = st.locs[i.li]
  if (L.f.culture?.[i.side]) return true
  if (L.f.help?.[i.side] === st.turn || st.dna?.[i.side]) return true
  if (L[i.side].some(o => has(o, 'glass'))) return true
  if (DEF(L).guardFirst && L[i.side][0] === i) return true
  return false
}
function fx(st, i, t, col) { st.fx.push({ u: i.u, t, c: col }) }
function bump(st, i, v, why) {
  if (v < 0 && protectedFrom(st, i)) { fx(st, i, 'Protected', 'good'); return false }
  const L = st.locs[i.li]
  if (v > 0 && L?.f.nogain?.[i.side] === st.turn) { fx(st, i, 'Lockdown', 'down'); return false }
  i.mod += v; fx(st, i, `${v > 0 ? '+' : ''}${v} ${why}`, v > 0 ? 'up' : 'down')
  // Putback: the first time each turn one of your other cards here loses power, this card gains it
  if (v < 0 && L) { const pb = L[i.side].find(x => x !== i && x.c.ab.includes('putback') && x.pb !== st.turn); if (pb) { pb.pb = st.turn; bump(st, pb, -v, 'Putback') } }
  return true
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
  if (homeAt(def, i.c) && !def.noHome) rows.push([3, 'Home Court', 'ab'])
  for (const a of i.c.ab) if (SIG[a]?.mod) { const v = SIG[a].mod(st, i, own, opp); if (v) rows.push([v, SIG[a].n, 'ab']) }
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
  if (L.f.rim?.[side] === st.turn || L.f.wall?.[side]) return false
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
  if (st.boost?.[i.side] === i.k) { delete st.boost[i.side]; bump(st, i, 1, 'Thunder Up') }
  if (L.f.line?.[i.side]) { const v = L.f.line[i.side]; delete L.f.line[i.side]; bump(st, i, v, 'Second Line') }
  if (L.f.boxout?.[i.side]) { delete L.f.boxout[i.side]; bump(st, i, -2, 'Box Out') }
  if (st.lights?.[i.side]) bump(st, i, -1, 'Lights Out')
  L[o].forEach(x => { if (has(x, 'charity')) bump(st, x, 1, 'Charity Stripe') })
  if (def.onPlay) def.onPlay(st, L, i)
  if (def.noReveal) return
  for (const a of i.c.ab) {
    if (SIG[a]?.reveal) { SIG[a].reveal(st, i); continue }
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
  // Signature moves that work at the end of each turn
  st.locs.forEach(L => sides.forEach(s => L[s].forEach(i => { for (const a of i.c.ab) if (SIG[a]?.endTurn) SIG[a].endTurn(st, i) })))
  // Franchise powers that wait for the end of the turn
  st.locs.forEach(L => sides.forEach(s => L[s].forEach(i => { if (i.proc > 0) { i.proc--; bump(st, i, 1, 'The Process') } })))
  st.locs.forEach(L => sides.forEach(s => { if (L.f.mile?.[s] === st.turn) { delete L.f.mile[s]; L[s].forEach(i => bump(st, i, 1, 'Mile High')) } }))
  st.locs.forEach((L, li) => sides.forEach(s => {
    if (L.f.beamFP?.[s] !== st.turn) return
    delete L.f.beamFP[s]
    const t = totals(st)
    if (t[li][s] <= t[li][other(s)]) return
    const weak = [0, 1, 2].filter(k => k !== li && st.locs[k][s].length).sort((a, b) => t[a][s] - t[b][s])[0]
    if (weak != null) bump(st, strongest(st, st.locs[weak][s]), 3, 'Light the Beam')
  }))
  st.locs.forEach(L => { if (L.revealed && LOCBY[L.id].endTurn) LOCBY[L.id].endTurn(st, L) })
}
function finalScore(st) {
  const log = []
  // Signature moves that wait for the final buzzer
  st.locs.forEach(L => sides.forEach(s => L[s].forEach(i => { for (const a of i.c.ab) if (SIG[a]?.final) { const m = SIG[a].final(st, i); if (m) log.push([s, m]) } })))
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
    if (st.tieWin) return st.tieWin
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



// ---------- Signature moves ----------
// Every Legend, Icon and GOAT card (cost 4–6) has one power: a signature move, in place of box-score abilities. His best
// category that night (points against 30, rebounds against 12, assists against 10, steals and blocks against 5) picks
// the group, and the card itself (player and game) picks one move from it, so it never changes. All-Time 100 players can
// also draw from the 'other' group. Cheaper cards keep up to two box-score abilities. Legend moves are worth about +3,
// Icon about +5, GOAT about +8 or a swing that bends the match.
const myCards = (st, s) => st.locs.flatMap(L => L[s])
const playedNow = (st, i) => myCards(st, i.side).filter(x => x.turn === st.turn)
const weakestAt = (st, arr) => { let b = null, bp = 1e9; arr.forEach(x => { const v = power(st, x); if (v < bp) { b = x; bp = v } }); return b }
const moveTo = (st, x, to) => { const L = st.locs[x.li]; L[x.side].splice(L[x.side].indexOf(x), 1); x.li = to; st.locs[to][x.side].push(x) }
const sig = (id, tier, grp, n, k, t, h) => ({ id, tier, grp, n, k, t, ...h })
const SIG_LIST = [
  // Legend (4)
  sig('heatup', 4, 'pts', 'Heat Up', 'On reveal', '+2, plus 1 for each card you played this turn, this one included.', { reveal: (st, i) => bump(st, i, playedNow(st, i).length + 2, 'Heat Up') }),
  sig('bucket', 4, 'pts', 'Bucket Getter', 'On reveal', '+2, or +3 if an opposing card here has more power.', { reveal: (st, i) => bump(st, i, st.locs[i.li][other(i.side)].some(x => power(st, x) > power(st, i)) ? 3 : 2, 'Bucket Getter') }),
  sig('closer', 4, 'pts', 'Closer', 'On reveal', '+4 if played on possession 5 or 6. Otherwise +1.', { reveal: (st, i) => bump(st, i, st.turn >= 5 ? 4 : 1, 'Closer') }),
  sig('boxout', 4, 'reb', 'Box Out', 'On reveal', '+2, and the opponent’s next card played here loses 2.', { reveal: (st, i) => { bump(st, i, 2, 'Box Out'); const L = st.locs[i.li]; L.f.boxout = { ...(L.f.boxout || {}), [other(i.side)]: 1 } } }),
  sig('putback', 4, 'reb', 'Putback', 'Ongoing', '+3. The first time each turn one of your other cards here loses power, this card gains that much.', { reveal: (st, i) => bump(st, i, 3, 'Putback') }),
  sig('kickout', 4, 'ast', 'Kick Out', 'On reveal', 'Your weakest card at another court gets +3. If you have none, +2 here.', { reveal: (st, i) => { const o = st.locs.filter((L, k) => k !== i.li).flatMap(L => L[i.side]); const w = weakestAt(st, o); if (w) bump(st, w, 3, 'Kick Out'); else bump(st, i, 2, 'Kick Out') } }),
  sig('extrapass', 4, 'ast', 'Extra Pass', 'On reveal', '+1, and you get 1 more energy next turn. On the final possession, +3 instead.', { reveal: (st, i) => { if (st.turn >= 6) bump(st, i, 3, 'Extra Pass'); else { bump(st, i, 1, 'Extra Pass'); st.bonusE = { ...(st.bonusE || {}), [i.side]: (st.bonusE?.[i.side] || 0) + 1 } } } }),
  sig('lockdown', 4, 'def', 'Lockdown', 'On reveal', '+3, and opposing cards here can’t gain power this turn.', { reveal: (st, i) => { bump(st, i, 3, 'Lockdown'); const L = st.locs[i.li]; L.f.nogain = { ...(L.f.nogain || {}), [other(i.side)]: st.turn } } }),
  sig('help', 4, 'def', 'Help Defense', 'On reveal', '+3, and your cards here can’t lose power this turn.', { reveal: (st, i) => { bump(st, i, 3, 'Help Defense'); const L = st.locs[i.li]; L.f.help = { ...(L.f.help || {}), [i.side]: st.turn } } }),
  sig('momentum', 4, 'other', 'Momentum', 'Ongoing', '+2 now, and +1 at the end of each turn you lead here.', { reveal: (st, i) => bump(st, i, 2, 'Momentum'), endTurn: (st, i) => { const t = totals(st)[i.li]; if (t[i.side] > t[other(i.side)]) bump(st, i, 1, 'Momentum') } }),
  sig('sixth', 4, 'other', 'Sixth Man', 'On reveal', '+3 if he’s the only card you played this turn. Otherwise +1.', { reveal: (st, i) => bump(st, i, playedNow(st, i).length === 1 ? 3 : 1, 'Sixth Man') }),
  sig('road', 4, 'other', 'Road Warrior', 'On reveal', '+4 if his game was a road win. Otherwise +2.', { reveal: (st, i) => bump(st, i, !i.c.home && i.c.win ? 4 : 2, 'Road Warrior') }),
  sig('takeover', 5, 'pts', 'Takeover', 'End', 'At the final buzzer, two-thirds of his power counts again here.', { final: (st, i) => { const L = st.locs[i.li], v = Math.ceil(power(st, i) * 2 / 3); L.extra[i.side] = (L.extra[i.side] || 0) + v; return `Takeover +${v} at ${LOCBY[L.id].name}` } }),
  sig('title', 5, 'pts', 'Scoring Title', 'On reveal', '+1 for every 8 points he scored, at least +4 and at most +7.', { reveal: (st, i) => bump(st, i, Math.max(4, Math.min(7, Math.floor((i.c.pts || 0) / 8))), 'Scoring Title') }),
  sig('iso', 5, 'pts', 'Iso', 'Ongoing', '+7 while he’s your only card here. Otherwise +2.', { mod: (st, i, own) => (own.length === 1 ? 7 : 2) }),
  sig('rim', 5, 'reb', 'Rim Protector', 'On reveal', '+2, and the opponent can’t play cards here next turn.', { reveal: (st, i) => { bump(st, i, 2, 'Rim Protector'); const L = st.locs[i.li]; L.f.rim = { ...(L.f.rim || {}), [other(i.side)]: st.turn + 1 } } }),
  sig('gravity', 5, 'reb', 'Gravity', 'On reveal', 'Every opposing card here loses 1, and he gains what they lose (+2 if there are none).', { reveal: (st, i) => { const o = st.locs[i.li][other(i.side)].slice(); if (!o.length) { bump(st, i, 2, 'Gravity'); return } let g = 0; o.forEach(x => { if (bump(st, x, -1, 'Gravity')) g++ }); if (g) bump(st, i, g, 'Gravity') } }),
  sig('offense', 5, 'ast', 'Run the Offense', 'On reveal', 'Your other cards at every court get +1.', { reveal: (st, i) => { const o = myCards(st, i.side).filter(x => x !== i); if (!o.length) bump(st, i, 2, 'Run the Offense'); o.forEach(x => bump(st, x, 1, 'Run the Offense')) } }),
  sig('spacer', 5, 'ast', 'Floor Spacer', 'On reveal', 'Your strongest card at each other court gets +2. If you have none there, +2 here.', { reveal: (st, i) => { let n = 0; st.locs.forEach((L, k) => { if (k !== i.li && L[i.side].length) { bump(st, strongest(st, L[i.side]), 2, 'Floor Spacer'); n++ } }); if (!n) bump(st, i, 2, 'Floor Spacer') } }),
  sig('pullup', 5, 'ast', 'Pull-Up', 'On reveal', '+1, and draw the highest-cost card left in your deck.', { reveal: (st, i) => { bump(st, i, 1, 'Pull-Up'); const d = st.deck[i.side]; if (!d.length || st.hand[i.side].length >= 7) return; let b = 0; d.forEach((k, j) => { if (st.cards[k].cost > st.cards[d[b]].cost) b = j }); st.hand[i.side].push(d.splice(b, 1)[0]); fx(st, i, 'Drew his best card left', 'up') } }),
  sig('shut', 5, 'def', 'Shut Down', 'On reveal', '+1, and the opponent’s strongest card here loses everything it has gained, plus 1.', { reveal: (st, i) => { bump(st, i, 1, 'Shut Down'); const t = strongest(st, st.locs[i.li][other(i.side)]); if (t) bump(st, t, -(Math.max(0, t.mod) + 1), 'Shut Down') } }),
  sig('clearout', 5, 'def', 'Clear Out', 'On reveal', 'Your weakest other card here moves to another court, and he gains its base power. With none, +2.', { reveal: (st, i) => { const L = st.locs[i.li], w = weakestAt(st, L[i.side].filter(x => x !== i)), to = [0, 1, 2].find(k => k !== i.li && canPlayAt(st, i.side, k)); if (!w || to == null) { bump(st, i, 2, 'Clear Out'); return } moveTo(st, w, to); fx(st, w, 'Clear Out: moved', 'up'); bump(st, i, w.c.pw, 'Clear Out') } }),
  sig('glue', 5, 'other', 'Glue Guy', 'On reveal', '+2 for each ability your other cards here have, at least +4 and at most +7.', { reveal: (st, i) => bump(st, i, Math.max(4, Math.min(7, 2 * st.locs[i.li][i.side].filter(x => x !== i).reduce((a, x) => a + x.c.ab.length, 0))), 'Glue Guy') }),
  sig('fourth', 5, 'other', 'Fourth Quarter', 'End', 'At the final buzzer, +5 here if this court is within 5.', { final: (st, i) => { const L = st.locs[i.li], t = totals(st)[i.li]; if (Math.abs(t.p - t.c) <= 5) { L.extra[i.side] = (L.extra[i.side] || 0) + 5; return `Fourth Quarter +5 at ${LOCBY[L.id].name}` } } }),
  // GOAT (6)
  sig('lights', 6, 'pts', 'Lights Out', 'On reveal', '+6, and every opposing card played after this, anywhere, gets −1.', { reveal: (st, i) => { bump(st, i, 6, 'Lights Out'); st.lights = { ...(st.lights || {}), [other(i.side)]: true } } }),
  sig('shot', 6, 'pts', 'The Shot', 'End', '+4. At the final buzzer, if you’re within 8 here, you win this court.', { reveal: (st, i) => bump(st, i, 4, 'The Shot'), final: (st, i) => { const L = st.locs[i.li], t = totals(st)[i.li], d = t[other(i.side)] - t[i.side]; if (d >= 0 && d <= 8) { L.extra[i.side] = (L.extra[i.side] || 0) + d + 1; return `The Shot wins ${LOCBY[L.id].name}` } } }),
  sig('relentless', 6, 'pts', 'Relentless', 'Ongoing', '+4 now, and +2 at the end of every turn for the rest of the match.', { reveal: (st, i) => bump(st, i, 4, 'Relentless'), endTurn: (st, i) => bump(st, i, 2, 'Relentless') }),
  sig('dna', 6, 'reb', 'Championship DNA', 'On reveal', '+7, and your cards everywhere can’t lose power for the rest of the match.', { reveal: (st, i) => { bump(st, i, 7, 'Championship DNA'); st.dna = { ...(st.dna || {}), [i.side]: true } } }),
  sig('wall', 6, 'reb', 'The Wall', 'On reveal', '+5, and the opponent can’t play cards here for the rest of the match.', { reveal: (st, i) => { bump(st, i, 5, 'The Wall'); const L = st.locs[i.li]; L.f.wall = { ...(L.f.wall || {}), [other(i.side)]: true } } }),
  sig('callup', 6, 'ast', 'Call Up', 'On reveal', '+4, and a random 3- or 4-cost card from your deck goes onto another court for free.', { reveal: (st, i) => {
    const d = st.deck[i.side], pool = d.filter(k => st.cards[k].cost === 3 || st.cards[k].cost === 4), to = [0, 1, 2].filter(k => k !== i.li && canPlayAt(st, i.side, k))
    bump(st, i, 4, 'Call Up')
    if (!pool.length || !to.length) { bump(st, i, 2, 'Call Up'); return }
    const k = pool[Math.floor(rand(st) * pool.length)]; d.splice(d.indexOf(k), 1)
    const x = place(st, i.side, st.cards[k], to[Math.floor(rand(st) * to.length)]); fx(st, i, `Call Up: ${lastName(x.c.n)}`, 'up'); reveal(st, x) } }),
  sig('dynasty', 6, 'ast', 'Dynasty', 'On reveal', '+2, and every other card you have, anywhere, gets +1.', { reveal: (st, i) => { bump(st, i, 2, 'Dynasty'); myCards(st, i.side).filter(x => x !== i).forEach(x => bump(st, x, 1, 'Dynasty')) } }),
  sig('pace', 6, 'ast', 'Pace and Space', 'On reveal', '+5, and 1 more energy every turn for the rest of the match. On the final possession, +8 instead.', { reveal: (st, i) => { if (st.turn >= 6) bump(st, i, 8, 'Pace and Space'); else { bump(st, i, 5, 'Pace and Space'); st.pace = { ...(st.pace || {}), [i.side]: true } } } }),
  sig('shutdown', 6, 'def', 'Shutdown', 'On reveal', 'The opponent’s strongest card here loses 4, and their strongest at each other court loses 1.', { reveal: (st, i) => { let n = 0; st.locs.forEach((L, k) => { const t = strongest(st, L[other(i.side)]); if (t) { bump(st, t, k === i.li ? -4 : -1, 'Shutdown'); n++ } }); if (!n) bump(st, i, 3, 'Shutdown') } }),
  sig('coronation', 6, 'def', 'Coronation', 'On reveal', '+4, and the opponent’s strongest card here loses 5.', { reveal: (st, i) => { bump(st, i, 4, 'Coronation'); const t = strongest(st, st.locs[i.li][other(i.side)]); if (t) bump(st, t, -5, 'Coronation') } }),
  sig('legacy', 6, 'other', 'Legacy', 'End', 'At the final buzzer, three-quarters of his power also counts at your weakest other court.', { final: (st, i) => { const t = totals(st), k = [0, 1, 2].filter(x => x !== i.li).sort((a, b) => t[a][i.side] - t[b][i.side])[0], v = Math.ceil(power(st, i) * 3 / 4); st.locs[k].extra[i.side] = (st.locs[k].extra[i.side] || 0) + v; return `Legacy +${v} at ${LOCBY[st.locs[k].id].name}` } }),
  sig('comeback', 6, 'other', 'Comeback Kid', 'On reveal', '+10 if you’re winning fewer courts. Otherwise +6.', { reveal: (st, i) => { const t = totals(st), a = t.filter(x => x[i.side] > x[other(i.side)]).length, b = t.filter(x => x[other(i.side)] > x[i.side]).length; bump(st, i, a < b ? 10 : 6, 'Comeback Kid') } }),
  sig('banner', 6, 'other', 'Banner Raised', 'On reveal', '+7, and you win every tie, at every court.', { reveal: (st, i) => { bump(st, i, 7, 'Banner Raised'); if (!st.tieWin) st.tieWin = i.side } }),
]
export const SIG = Object.fromEntries(SIG_LIST.map(x => [x.id, x]))
export const SIG_GROUP = { pts: 'Scoring', reb: 'Rebounding', ast: 'Playmaking', def: 'Defense', other: 'All-Time 100' }
// The moves read like abilities everywhere a card's abilities show
SIG_LIST.forEach(x => { AB[x.id] = { n: x.n, k: x.k, t: () => x.t, why: () => `${['', '', '', '', 'Legend', 'Icon', 'GOAT'][x.tier]} signature move · ${SIG_GROUP[x.grp]}`, sig: x.tier } })
// Which group a night falls in: his best category against what counts as a big night
export function sigGroup(c) {
  const sc = [['pts', (c.pts || 0) / 30], ['reb', (c.reb || 0) / 12], ['ast', (c.ast || 0) / 10], ['def', ((c.stl || 0) + (c.blk || 0)) / 5]]
  return sc.sort((a, b) => b[1] - a[1])[0][0]
}
export function sigOf(c, top) {
  const tier = Math.min(6, c.cost)
  if (tier < 4) return null
  const g = sigGroup(c)
  const pool = SIG_LIST.filter(x => x.tier === tier && (x.grp === g || (top && x.grp === 'other')))
  return pool[hash(`${c.n}|${c.g}|${c.s}`) % pool.length].id
}
// Power follows cost: each tier has a range, and that night's Game Score places the card in it
// Tuned by simulation: a normal curve beats an all-cheap deck about 7 in 10 and splits about even with an all-expensive one
export const POWER_RANGE = { 1: [2, 4], 2: [3, 5], 3: [3, 6], 4: [4, 7], 5: [4, 8], 6: [5, 9] }
export const powerOf = c => { const [lo, hi] = POWER_RANGE[c.cost] || [1, 3]; return lo + Math.round((hi - lo) * Math.max(0, Math.min(1, (c.gs || 0) / 40))) }
// A card as it plays: power from its tier and night; a Legend, Icon or GOAT trades its box-score abilities for its move
export const RULES = { powerByCost: true, signatures: true }
export function finalize(c, top) {
  if (c.ab0 == null) c.ab0 = (c.ab || []).filter(a => a !== 'home')
  c.pw = RULES.powerByCost ? powerOf(c) : Math.max(0, Math.min(10, Math.round((c.gs || 0) / 5)))
  const m = RULES.signatures ? sigOf(c, top) : null
  c.ab = m ? [m] : c.ab0.slice()
  return c
}

// ---------- Franchise powers ----------
// Each turn a side may use one: the power of a franchise it played a card from that turn. It fires when the first card
// of that franchise played that turn is revealed, after the card's own abilities. Every power is worth about +3.
const mine = (st, i) => st.locs[i.li][i.side]
const theirs = (st, i) => st.locs[i.li][other(i.side)]
const courtsWon = (st, s) => { const t = totals(st); return t.filter(x => x[s] > x[other(s)]).length }
export const FP = {
  ATL: { n: 'Highlight Film', t: '+2, or +4 if this card scored 30 or more.', run: (st, i) => bump(st, i, i.c.pts >= 30 ? 4 : 2, 'Highlight Film') },
  BOS: { n: 'Banner Night', t: 'This card gets +2 and your other cards here get +1.', run: (st, i) => mine(st, i).forEach(x => bump(st, x, x === i ? 2 : 1, 'Banner Night')) },
  BKN: { n: 'Crossover', t: '+1, and the opponent’s strongest card here moves to another court with room. If none has room, it loses 2.', run: (st, i) => {
    bump(st, i, 1, 'Crossover')
    const o = other(i.side), L = st.locs[i.li], tgt = strongest(st, L[o]); if (!tgt) return
    const to = [0, 1, 2].filter(k => k !== i.li && canPlayAt(st, o, k)).sort((a, b) => { const t = totals(st); return (t[b][o] - t[b][i.side]) - (t[a][o] - t[a][i.side]) })[0]
    if (to == null || protectedFrom(st, tgt)) { bump(st, tgt, -2, 'Crossover'); return }
    L[o].splice(L[o].indexOf(tgt), 1); tgt.li = to; st.locs[to][o].push(tgt); fx(st, tgt, 'Crossover: moved', 'down') } },
  CHO: { n: 'The Hive', t: 'With 2 or more of your cards here, each gets +1. Otherwise this card gets +1.', run: (st, i) => { const a = mine(st, i); if (a.length >= 2) a.forEach(x => bump(st, x, 1, 'The Hive')); else bump(st, i, 1, 'The Hive') } },
  CHI: { n: 'Triangle', t: '+3 if you have cards at all three courts. Otherwise +1.', run: (st, i) => bump(st, i, st.locs.every(L => L[i.side].length) ? 3 : 1, 'Triangle') },
  CLE: { n: 'Comeback', t: '+4 if you trail here. Otherwise +1.', run: (st, i) => { const t = totals(st)[i.li]; bump(st, i, t[i.side] < t[other(i.side)] ? 4 : 1, 'Comeback') } },
  DAL: { n: 'Fadeaway', t: '+2, and this card can’t lose power.', run: (st, i) => { bump(st, i, 2, 'Fadeaway'); i.guard = true } },
  DEN: { n: 'Mile High', t: '+1 now. At the end of next turn, your cards here get +1.', run: (st, i) => { bump(st, i, 1, 'Mile High'); const L = st.locs[i.li]; L.f.mile = { ...(L.f.mile || {}), [i.side]: st.turn + 1 } } },
  DET: { n: 'Bad Boys', t: 'Every opposing card here loses 1. If there are none, +1.', run: (st, i) => { const o = theirs(st, i).slice(); if (!o.length) bump(st, i, 1, 'Bad Boys'); o.forEach(x => bump(st, x, -1, 'Bad Boys')) } },
  GSW: { n: 'Strength in Numbers', t: 'Draw a card on turns 1 and 2. Later, +1 instead.', run: (st, i) => { if (st.turn >= 3 || !st.deck[i.side].length) bump(st, i, 1, 'Strength in Numbers'); else { draw(st, i.side); fx(st, i, 'Drew a card', 'up') } } },
  HOU: { n: 'Moreyball', t: '+1 for every two threes this card made, at least +2 and at most +4.', run: (st, i) => bump(st, i, Math.max(2, Math.min(4, Math.floor((i.c.tp || 0) / 2))), 'Moreyball') },
  IND: { n: 'Miller Time', t: '+4 on the final possession. Otherwise +1.', run: (st, i) => bump(st, i, st.turn >= 6 ? 4 : 1, 'Miller Time') },
  LAC: { n: 'Lob City', t: '+2, and your other cards played here this turn get +1.', run: (st, i) => { bump(st, i, 2, 'Lob City'); mine(st, i).filter(x => x !== i && x.turn === st.turn).forEach(x => bump(st, x, 1, 'Lob City')) } },
  LAL: { n: 'Showtime', t: 'This card gets +2 and every other card you played this turn gets +1.', run: (st, i) => st.locs.forEach(L => L[i.side].forEach(x => { if (x.turn === st.turn) bump(st, x, x === i ? 2 : 1, 'Showtime') })) },
  MEM: { n: 'Grit and Grind', t: '+1 for each opposing card here after the first, at least +1 and at most +3.', run: (st, i) => bump(st, i, Math.max(1, Math.min(3, theirs(st, i).length - 1)), 'Grit and Grind') },
  MIA: { n: 'Heat Culture', t: '+1, and your cards here can’t lose power for the rest of the match.', run: (st, i) => { bump(st, i, 1, 'Heat Culture'); const L = st.locs[i.li]; L.f.culture = { ...(L.f.culture || {}), [i.side]: true } } },
  MIL: { n: 'Fear the Deer', t: '+3 if this is your only card here. Otherwise +1.', run: (st, i) => bump(st, i, mine(st, i).length === 1 ? 3 : 1, 'Fear the Deer') },
  MIN: { n: 'Twin Towers', t: 'With exactly two of your cards here, both get +2. Otherwise this card gets +1.', run: (st, i) => { const a = mine(st, i); if (a.length === 2) a.forEach(x => bump(st, x, 2, 'Twin Towers')); else bump(st, i, 1, 'Twin Towers') } },
  NOP: { n: 'Second Line', t: 'The next card you play here gets +2.', run: (st, i) => { fx(st, i, 'Second Line', 'up'); const L = st.locs[i.li]; L.f.line = { ...(L.f.line || {}), [i.side]: 2 } } },
  NYK: { n: 'The Mecca', t: '+1 for every other card at this court, both sides, at least +1 and at most +3.', run: (st, i) => { const L = st.locs[i.li]; bump(st, i, Math.max(1, Math.min(3, L.p.length + L.c.length - 1)), 'The Mecca') } },
  OKC: { n: 'Thunder Up', t: '+1, and the strongest card in your hand gets +1 when you play it.', run: (st, i) => { bump(st, i, 1, 'Thunder Up'); const h = st.hand[i.side].map(k => st.cards[k]).sort((a, b) => b.pw - a.pw)[0]; if (h) st.boost = { ...(st.boost || {}), [i.side]: h.k } } },
  ORL: { n: 'Disappearing Act', t: '+1, and the opponent’s weakest card here goes back to their hand.', run: (st, i) => {
    const o = other(i.side), L = st.locs[i.li]; let w = null, wp = 99; L[o].forEach(x => { const v = power(st, x); if (v < wp) { w = x; wp = v } })
    bump(st, i, 1, 'Disappearing Act')
    if (!w) return
    if (protectedFrom(st, w)) { fx(st, w, 'Protected', 'good'); return }
    L[o].splice(L[o].indexOf(w), 1); if (st.hand[o].length < 7) st.hand[o].push(w.k); fx(st, i, `Disappearing Act: ${lastName(w.c.n)} back to the hand`, 'up') } },
  PHI: { n: 'The Process', t: 'This card gets +1 at the end of each turn, up to +2.', run: (st, i) => { i.proc = 2; fx(st, i, 'The Process', 'up') } },
  PHO: { n: 'Seven Seconds', t: '+1, and you get 1 more energy next turn. On the final possession, +3 instead.', run: (st, i) => { if (st.turn >= 6) bump(st, i, 3, 'Seven Seconds'); else { bump(st, i, 1, 'Seven Seconds'); st.bonusE = { ...(st.bonusE || {}), [i.side]: 1 }; fx(st, i, '+1 energy next turn', 'up') } } },
  POR: { n: 'Rip City', t: '+3 if you’re winning fewer courts than the opponent. Otherwise +1.', run: (st, i) => bump(st, i, courtsWon(st, i.side) < courtsWon(st, other(i.side)) ? 3 : 1, 'Rip City') },
  SAC: { n: 'Light the Beam', t: 'If you lead here at the end of this turn, your strongest card at your weakest other court gets +3.', run: (st, i) => { const L = st.locs[i.li]; L.f.beamFP = { ...(L.f.beamFP || {}), [i.side]: st.turn }; fx(st, i, 'Light the Beam', 'up') } },
  SAS: { n: 'Fundamentals', t: '+2 if this card has no ability. Otherwise +1.', run: (st, i) => bump(st, i, i.c.ab.length ? 1 : 2, 'Fundamentals') },
  TOR: { n: 'Raptor Claw', t: 'Takes 1 power from the opponent’s strongest card here.', run: (st, i) => {
    const o = theirs(st, i).slice().sort((a, b) => power(st, b) - power(st, a)).slice(0, 1)
    if (!o.length) { bump(st, i, 1, 'Raptor Claw'); return }
    o.forEach(x => { if (bump(st, x, -1, 'Raptor Claw')) bump(st, i, 1, 'Raptor Claw') }) } },
  UTA: { n: 'Pick and Roll', t: 'With another of your cards here from the same season, both get +2. Otherwise this card gets +1.', run: (st, i) => { const m = mine(st, i).find(x => x !== i && x.c.s === i.c.s); if (m) { bump(st, i, 2, 'Pick and Roll'); bump(st, m, 2, 'Pick and Roll') } else bump(st, i, 1, 'Pick and Roll') } },
  WAS: { n: 'Monuments', t: 'Your strongest card at each other court gets +1.', run: (st, i) => { let n = 0; st.locs.forEach((L, k) => { if (k !== i.li && L[i.side].length) { bump(st, strongest(st, L[i.side]), 1, 'Monuments'); n++ } }); if (!n) bump(st, i, 1, 'Monuments') } },
}
// The franchises a side could use this turn: the ones it played a card from
export const fpChoices = cs => [...new Set(cs.map(c => c.fc).filter(fc => FP[fc]))]
// Place and reveal one turn's cards in order, firing each side's chosen power on its first card of that franchise
function runPlays(st, order, fp, steps) {
  const fired = {}
  for (const p of order) {
    st.fx = []
    if (!canPlayAt(st, p.side, p.li)) { steps?.push({ side: p.side, k: p.c.k, li: p.li, skip: true, fx: [], board: board(st) }); continue }
    const i = place(st, p.side, p.c, p.li)
    reveal(st, i)
    let used = null
    if (fp?.[p.side] && !fired[p.side] && p.c.fc === fp[p.side]) { fired[p.side] = true; used = fp[p.side]; FP[used].run(st, i); st.fps = [...(st.fps || []), { turn: st.turn, side: p.side, fc: used }] }
    if (steps) {
      steps.push({ side: p.side, k: p.c.k, u: i.u, li: p.li, fx: st.fx, board: board(st), ...(used ? { fp: used } : {}) })
      st.log.push([p.side, `${cleanName(p.c.n)} to ${LOCBY[st.locs[p.li].id].name}${used ? ` · ${FP[used].n}` : ''}${st.fx.length ? ` · ${st.fx.map(f => f.t).join(', ')}` : ''}`])
    }
  }
}

// ---------- Matches ----------
// opts: { pDeck, cDeck: [card], locs: [court ids] (fills to 3 at random), seed, pairs: {"a|b": n}, at100: [names], meta }
export function newMatch({ pDeck, cDeck, locs = [], seed, pairs = {}, at100 = [], meta = {} }) {
  const r = rng(seed)
  const cards = {}
  const top = new Set(at100)
  pDeck.forEach(c => { cards[c.k] = finalize({ ...c }, top.has(c.n)) }); cDeck.forEach(c => { cards[c.k] = finalize({ ...c }, top.has(c.n)) })
  const ids = locs.filter(id => LOCBY[id]).slice(0, 3)
  for (const l of shuffle(LOCS, r)) { if (ids.length >= 3) break; if (!ids.includes(l.id)) ids.push(l.id) }
  const st = {
    v: 1, ...meta, seed: (seed * 31 + 17) >>> 0, rn: 0, uid: 1, turn: 0, energy: { p: 0, c: 0 },
    deck: { p: shuffle(pDeck.map(c => c.k), r), c: shuffle(cDeck.map(c => c.k), r) }, hand: { p: [], c: [] },
    locs: ids.map((id, i) => ({ i, id, revealed: false, p: [], c: [], f: {}, extra: {} })),
    cards, pairs, at100, fx: [], log: [], over: null, first: r() < 0.5 ? 'p' : 'c', fps: [],
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
  sides.forEach(s => { if (st.bonusE?.[s]) { st.energy[s] += st.bonusE[s]; delete st.bonusE[s] } if (st.pace?.[s]) st.energy[s] += 1 })
  draw(st, 'p'); draw(st, 'c')
}
// Who reveals first this turn: the jump ball's winner on odd turns, the other side on even ones (the possession arrow)
export const firstThisTurn = st => (st.turn % 2 ? (st.first || 'p') : other(st.first || 'p'))
export function hydrate(st) { st.locs.forEach((L, li) => sides.forEach(s => L[s].forEach(i => { i.c = st.cards[i.k]; i.li = li }))); st.fx = st.fx || []; return st }
export function dehydrate(st) {
  const out = { ...st, locs: st.locs.map(L => ({ ...L, p: L.p.map(({ c, ...i }) => i), c: L.c.map(({ c, ...i }) => i) })) }
  delete out.fx; delete out.sim
  return out
}
// Check and play a turn. plays: [{ k: a card in your hand, li }]. Returns the reveal, step by step, for the client
export function playTurn(st, plays, fpP) {
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
  if (fpP && !fpChoices(plays.map(p => st.cards[p.k])).includes(fpP)) throw new Error('That franchise power isn’t yours this turn.')
  const cplan = cpuPlan(st, plays), fpC = st.cpuNoPower ? null : cplan.fp
  delete cplan.fp
  st.energy.p -= spent
  cplan.forEach(x => { st.energy.c -= costOf(st, x.c, x.li); st.hand.c.splice(st.hand.c.indexOf(x.c.k), 1) })
  st.hand.p = hand
  const pp = plays.map(p => ({ side: 'p', c: st.cards[p.k], li: p.li })), cp = cplan.map(x => ({ side: 'c', c: x.c, li: x.li }))
  const order = firstThisTurn(st) === 'p' ? [...pp, ...cp] : [...cp, ...pp]
  const steps = []
  runPlays(st, order, { p: fpP || null, c: fpC || null }, steps)
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
    cards, pairs: st.pairs, at100: st.at100, over: st.over, log: st.log, uid: st.uid, first: st.first || 'p', fps: st.fps || [],
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
  // Then the franchise power that does the most for that play
  const out = best.plays.slice()
  const opts = fpChoices(out.map(p => p.c))
  if (opts.length) {
    let bv = -Infinity
    for (const fc of opts) {
      const x = clone(b0); x.deck = { p: [], c: [] }; x.hand = { p: [], c: st.hand.c.filter(k => !out.some(p => p.c.k === k)) }
      runPlays(x, out.map(p => ({ side: 'c', c: p.c, li: p.li })), { c: fc })
      const v = evalSt(x, 'c', st.turn) + (FP[fc] && (fc === 'PHO' || fc === 'GSW' || fc === 'OKC' || fc === 'NOP' || fc === 'DEN' || fc === 'PHI' || fc === 'SAC') && st.turn < 6 ? 2 : 0)
      if (v > bv) { bv = v; out.fp = fc }
    }
  }
  return out
}

// ---------- Cards ----------
// A row of clash/decks.json as a card
export function cardFromRow(K, row, idx) { const c = { k: `c${idx}` }; K.forEach((f, j) => { c[f] = row[j] }); if (Array.isArray(c.ab)) c.ab = c.ab.filter(a => a !== 'home'); return finalize(c, false) }
// A binder card (its stored JSON) as a card. flags: that game's letters from clash/flags.json
export function cardFromBinder(id, card, flags = '', top = false) {
  const r = card.row || {}
  const [us, them] = String(card.score || '').split(/[–-]/).map(Number)
  const c = { k: `u${id}`, id: Number(id), n: r.n, fc: fcOf(card.t), o: fcOf(card.o), d: card.date, s: card.s, g: card.id, home: card.home ? 1 : 0, win: card.won ? 1 : 0,
    margin: Number.isFinite(us - them) ? us - them : 0, ot: card.ot || '', pos: r.pos || '', pts: r.pts || 0, reb: r.trb || 0, ast: r.ast || 0, stl: r.stl ?? null, blk: r.blk ?? null,
    tp: r.tp ?? null, min: r.mp ?? null, gs: r.gs ?? 0, lr: r.lr ?? 999, cost: TIER_COST[card.tier] || 1, tier: card.tier, ruby: !!card.ruby, tn: card.tn, on: card.on }
  c.ab = abilitiesOf(c, flags)
  return finalize(c, top)
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
