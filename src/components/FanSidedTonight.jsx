import { useState, useEffect, useRef, useMemo } from 'react'
import s from './FanSidedTonight.module.css'
import { tierFor } from './PlayerCard'
import { norm } from './predict'

// FanSided Tonight: the Sportsbook's main TV as a studio show about the night's finals. An illustrated anchor
// reads a script built from the box scores, cutting between the desk and full-screen graphics. Every line is a
// template picked from a bank (opener, body, kicker per segment), so each segment has hundreds of possible takes
// and "New take" reshuffles the whole show. Templates whose blanks the night can't fill are skipped.

const B = {
  open: [
    ['Good evening and welcome to FanSided Tonight.', 'Welcome in to FanSided Tonight.', 'You’re watching FanSided Tonight.', 'Evening, everybody, and welcome to the show.', 'Thanks for joining us on FanSided Tonight.', 'It’s FanSided Tonight, and we are rolling.', 'Welcome to the desk.', 'Pull up a chair, this is FanSided Tonight.', 'Here we go on FanSided Tonight.', 'Good to have you with us.'],
    ['{slate} on the board tonight', 'We had a full {gamesN}-game slate', '{slate} in the books', 'All {gamesN} games are final', 'Every one of tonight’s {gamesN} games is final', 'The league went {gamesN} deep tonight', '{slate} to get through', 'A {gamesN}-game night across the league', 'We’ve got {slate} to cover'],
    ['with {upsets} along the way.', 'including {upsets}.', 'and the forecast got burned {times}.', 'and {upsets} shook up the board.', 'and the underdogs came through {times}.', 'and every favorite held serve.{chalk}', 'and the chalk held up all night.{chalk}', 'and nobody pulled an upset.{chalk}', 'so let’s get to it.'],
  ],
  potd: [
    ['Our Player of the Day is {name}.', 'Nobody did it better tonight than {name}.', 'The night belonged to {name}.', 'Tonight’s top performer: {name}.', 'Hats off to {name}.', '{name} owned the night.', 'Let’s start with the best of the best: {name}.', 'The Player of the Day card goes to {name}.', 'If you watched one player tonight, it should have been {name}.', 'Nobody touched {name} tonight.'],
    ['{pts} points, {reb} rebounds and {ast} assists against the {opp}.', 'He went for {pts}, {reb} and {ast} on the {opp}.', '{pts} points on {fg} shooting against the {opp}.', 'A {pts}-point night against the {opp}, {fg} from the field.', 'He put up {pts} on the {opp} in {mins} minutes.', '{pts}, {reb}, {ast}. That’s the line against the {opp}.', 'He hung {pts} on the {opp}.', 'A {gs} Game Score against the {opp}.'],
    ['That’s a {ns} on the Player of the Day scale.', 'His Elo jumps {delta} points to {post}.', 'He climbs to number {rank} in the league.', 'The {team} {result}, but nobody topped that line.', 'That’s a {gs} Game Score.', 'Good for {delta} points of Elo.', 'He moves up to number {rank} in our rankings.', 'That one’s going in the binder.'],
  ],
  upset: [
    ['Upset alert.', 'Stop me if you saw this coming.', 'The forecast did not see this one.', 'Biggest stunner of the night.', 'Here’s your upset of the night.', 'Nobody had this one.', 'Chalk got broken tonight.', 'We have an upset.', 'Throw out the numbers on this one.', 'Your upset special.'],
    ['The {win} came in at just {chance} and beat the {lose} {score}.', 'The {win}, given a {chance} chance, knocked off the {lose}, {score}.', 'At {chance}, the {win} took down the {lose} {score}.', 'The {lose} were {fav} favorites and still fell to the {win}, {score}.', 'The {win} beat the {lose} {score} as {chance} underdogs.', '{chance}. That was the win chance for the {win}, and they won {score}.'],
    ['The {lose} had the better roster on paper.', 'That’s why they play the games.', 'Somebody check the bracket.', 'The pick’em board just got shaken up.', 'A rough night for the favorites.', 'And the Elo swing shows it.', 'Let’s go to the box score.', 'The numbers tell the story.'],
  ],
  box: [
    ['Here’s how it happened.', 'Let’s look at the box.', 'Inside the numbers.', 'The box score, top to bottom.', 'How they got it done.', 'The key lines from that one.', 'Breaking down the box.', 'The guys who decided it.'],
    ['{wtop} led the {win} with {wpts}.', '{wtop} carried the {win} with {wpts} points.', '{wpts} from {wtop} was the difference.', 'It was {wtop}, {wpts} points, for the {win}.', '{wtop} went for {wpts}.', 'The {win} got {wpts} from {wtop}.'],
    ['{ltop} had {lpts} in the loss.', 'On the other side, {ltop} scored {lpts}.', '{ltop} dropped {lpts} and it wasn’t enough.', 'Even {lpts} from {ltop} couldn’t save the {lose}.', '{ltop} kept the {lose} close with {lpts}.', 'The {lose} got {lpts} from {ltop}.'],
  ],
  career: [
    ['Career night alert.', 'Put this one in the scrapbook.', 'A career best tonight.', 'Never been better.', 'Personal best, right here.', 'We have a career game.', 'Circle this one.', 'Mark the date.', 'History for one player tonight.', 'A new high-water mark.'],
    ['{name} posted a career-best {gs} Game Score against the {opp}.', '{name} went for {pts}, {reb} and {ast}, the best game of his career by Game Score.', 'A {gs} Game Score for {name}, the best he’s ever had.', '{name} had the game of his life, {pts} points on {fg}.', '{name}: {pts} points, {gs} Game Score, a career high.', 'His best ever: {name} with a {gs} against the {opp}.'],
    ['The {team} {result}.', 'He climbs to number {rank}.', 'His Elo is up {delta}.', 'That card is going to be a keeper.', 'Remember the name.', 'A night he won’t forget.', 'That’s a star on the wall.', 'Frame that one.'],
  ],
  climb: [
    ['Milestone alert.', 'Watch out for this one in the rankings.', 'Movin’ on up.', 'A big jump in the rankings.', 'Here’s a riser.', 'Rankings shake-up.', 'Somebody just leapfrogged a lot of people.', 'New neighborhood in the rankings.', 'Look who’s climbing.', 'Rankings alert.'],
    ['{name} jumps from number {prev} to number {rank}.', '{name} goes from {prev} to {rank} after tonight.', 'From {prev} to {rank} for {name}.', '{name} climbs {jump} spots to number {rank}.', '{name} moves up {jump} places, all the way to {rank}.', 'Number {rank} now for {name}, up from {prev}.', '{name} had a night worth marking.'],
    ['{stamp}', '{stamp} Keep an eye on him.', '{stamp} The binders will notice.', '{stamp} One big night will do that.', '{stamp} Not bad at all.', '{stamp} That’s a diamond on the ticker.'],
  ],
  movers: [
    ['Let’s check the movers.', 'Biggest swings of the night.', 'Elo winners and losers.', 'Who gained, who slipped.', 'Up and down the ladder.', 'The Elo board.', 'Risers and fallers.', 'Movement in the ratings.', 'The night’s Elo swings.', 'Who helped himself tonight?'],
    ['{rname} gained {rdelta}, the most of anyone.', 'Nobody climbed more than {rname}, up {rdelta}.', 'Top riser: {rname}, plus {rdelta}.', '{rname} jumps {rdelta} in Elo.', 'A {rdelta} gain for {rname}.', '{rname} leads the risers at {rdelta}.'],
    ['{fname} dropped {fdelta}, the biggest fall.', 'On the other end, {fname} lost {fdelta}.', 'Tough night for {fname}, down {fdelta}.', '{fname} slides {fdelta}.', 'Biggest faller: {fname}, minus {fdelta}.', '{fname} gave back {fdelta}.'],
  ],
  duel: [
    ['Duel of the Day.', 'Our heavyweight bout.', 'Main event time.', 'Best one-on-one of the night.', 'Two stars, one winner.', 'Tonight’s marquee matchup.', 'Here’s the duel.', 'Head to head.', 'The matchup everyone was watching.', 'Star versus star.'],
    ['{a} edged {b}, {ag} to {bg} in Game Score.', '{a} topped {b} with a {ag} Game Score to {bg}.', '{a} won the duel over {b}, {ag} to {bg}.', '{ag} for {a}, {bg} for {b}. Advantage {alast}.', '{a} got the better of {b}, {ag} to {bg}.', 'It went to {a}, {ag} to {bg} over {b}.'],
    ['Both of them were great.', 'That card is a good one.', 'You could watch that one twice.', 'Duel card unlocked.', 'Neither one played badly.', 'Instant classic.', 'That’s why you stay up late.', 'Give them both credit.'],
  ],
  slayer: [
    ['Giant-Slayer of the Day.', 'David, meet Goliath.', 'Talk about punching up.', 'Giant-slayer alert.', 'The longest odds of the night.', 'Nobody expected this matchup result.', 'Here’s a shocker.', 'Underdog story.', 'Size doesn’t matter, Elo does.', 'Upset of a different kind.'],
    ['{a} outplayed {b}, who was {gap} Elo points ahead of him.', '{a} beat {b} by Game Score with a {gap}-point Elo gap.', 'A {chance} chance, and {a} still outscored {b}.', '{a} took down {b}, {ag} to {bg}, at {chance} odds.', 'Rated {gap} below {b}, {a} won the duel anyway.', '{a} over {b}. The odds said {chance}.'],
    ['That’s the giant-slayer card.', 'Big night for the little guy.', 'Respect.', 'Remember that one.', 'He’ll be hearing about that.', 'Goliath goes home.', 'Rare stuff.', 'Elo loves an upset.'],
  ],
  close: [
    ['That’s the show.', 'That’s going to do it for us.', 'And that’s a wrap.', 'That’s all for tonight.', 'We’ll leave it there.', 'That’s our time.', 'Before we go, one reminder.', 'That’s FanSided Tonight.', 'And that’s the night.', 'Thanks for watching.'],
    ['Tap any TV for the full box score.', 'Every box score is one tap away on the wall.', 'The full box scores are on the wall.', 'Hit any screen for the box.', 'All {gamesN} box scores are waiting for you.', 'Check the board for every table.'],
    ['See you tomorrow.', 'Good night.', 'Back tomorrow with more.', 'Make your picks before the next tip.', 'Get some sleep.', 'Until next time.', 'Open your pack.', 'We’ll be here next time.'],
  ],
}

const STAMP_LINE = {
  'New #1': 'He’s the new number one in the league.',
  'Career-high Elo': 'That’s the highest Elo of his career.',
  'Enters Top 100': 'Welcome to the Top 100.',
}
const stampLine = t => STAMP_LINE[t] || (t.startsWith('Promoted to ') ? `That makes him a ${t.slice(12)} card.` : t.startsWith('Career-high rank') ? 'That’s the highest he’s ever been ranked.' : null)

const rng = seed => { let x = seed % 2147483647 || 1; return () => (x = (x * 48271) % 2147483647) / 2147483647 }
const usable = (t, v) => [...t.matchAll(/\{(\w+)\}/g)].every(m => v[m[1]] != null)
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '').replace(/\.\./g, '.').replace(/\.,/g, ',')
// [what the anchor says on camera, what he says over the graphic]
const say = (banks, v, r) => {
  const p = banks.map(b => { const ok = b.filter(t => usable(t, v)); const pool = ok.length ? ok : b; return fill(pool[Math.floor(r() * pool.length)], v) })
  return [p[0], p.slice(1).join(' ').trim()]
}
const bn = n => n.replace(/\s*\(.*\)$/, '')
const lastName = n => bn(n).split(' ').slice(1).join(' ') || bn(n)
const pct = v => `${Math.max(1, Math.min(99, Math.round(v * 100)))}%`
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)
const r0 = v => Math.round(v).toLocaleString()
const W = { desk: [960, 540], phone: [640, 500] }

function Anchor({ talk, gest }) {
  return (
    <svg viewBox="0 0 300 420" className={`${talk ? s.talk : ''} ${gest ? s.gest : ''}`} aria-hidden="true">
      <path d="M40 420 C 40 330, 80 300, 150 296 C 220 300, 260 330, 260 420 Z" fill="#14294a" />
      <path d="M150 300 L 122 300 L 150 380 L 178 300 Z" fill="#f4f4f4" />
      <path d="M150 310 L 142 322 L 150 372 L 158 322 Z" fill="#c8102e" />
      <path d="M122 300 L 108 312 L 140 372 L 150 380 Z" fill="#1d3a66" /><path d="M178 300 L 192 312 L 160 372 L 150 380 Z" fill="#1d3a66" />
      <circle cx="198" cy="336" r="6" fill="#c9a24a" />
      <g className={s.armR}><path d="M232 330 C 262 350, 270 392, 250 420 L 214 420 C 224 392, 222 360, 212 340 Z" fill="#14294a" /><circle cx="238" cy="410" r="13" fill="#c98e6b" /></g>
      <path d="M68 330 C 40 350, 34 392, 52 420 L 88 420 C 78 392, 80 360, 90 340 Z" fill="#14294a" />
      <rect x="134" y="250" width="32" height="52" rx="12" fill="#b97f5d" />
      <g className={s.head}>
        <ellipse cx="150" cy="190" rx="66" ry="78" fill="#c98e6b" />
        <ellipse cx="86" cy="196" rx="11" ry="17" fill="#b97f5d" /><ellipse cx="214" cy="196" rx="11" ry="17" fill="#b97f5d" />
        <path d="M84 168 C 80 108, 120 96, 152 98 C 196 98, 222 120, 218 170 C 206 146, 186 132, 150 134 C 120 134, 98 146, 84 168 Z" fill="#2b1d16" />
        <path d="M108 148 C 130 136, 168 132, 196 146" stroke="#3a2a20" strokeWidth="5" fill="none" strokeLinecap="round" />
        <g className={s.eyes}><ellipse cx="124" cy="190" rx="7" ry="9" fill="#1d1410" /><ellipse cx="176" cy="190" rx="7" ry="9" fill="#1d1410" /><circle cx="126" cy="187" r="2" fill="#fff" /><circle cx="178" cy="187" r="2" fill="#fff" /></g>
        <path d="M110 172 Q 124 164 138 170" stroke="#2b1d16" strokeWidth="5" fill="none" strokeLinecap="round" /><path d="M162 170 Q 176 164 190 172" stroke="#2b1d16" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M150 196 Q 144 216 150 222 Q 156 224 158 220" stroke="#a8704f" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path className={s.mouthC} d="M128 238 Q 150 250 172 238" stroke="#7a3b2c" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path className={s.mouthO} d="M130 236 Q 150 232 170 236 Q 166 258 150 260 Q 134 258 130 236 Z" fill="#5a2018" />
      </g>
    </svg>
  )
}

// Types the line out two characters at a time; remounted (keyed) for every new line
function Caption({ text, run, instant, onTalk, onDone }) {
  const [n, setN] = useState(instant ? text.length : 0)
  const end = n >= text.length
  useEffect(() => {
    if (!run || end) return
    onTalk(true)
    const t = setTimeout(() => setN(v => Math.min(text.length, v + 2)), 55)
    return () => clearTimeout(t)
  }, [n, run, end])
  useEffect(() => { if (run && end) { onTalk(false); onDone() } }, [run, end])
  return <div className={s.cap}>{text.slice(0, n)}{!end && <span className={s.cur} />}</div>
}

function Card({ p, g, kit, shots, big }) {
  const { tShort, tCode, tColor } = kit
  const [bad, setBad] = useState(false)
  const tier = tierFor(p.lrp ?? p.lr)
  const src = shots?.[norm(p.n)]?.headshot
  const w = bn(p.n).split(' ')
  const opp = g.teams.find(t => t !== p.t)
  return (
    <span className={`${s.card} ${big ? s.gCard : ''}`} style={{ '--fr': `var(--t-${tier.id}, #7c8896)`, '--c': tColor(p.t) }}>
      <span className={s.in}>
        <span className={s.rk}><small>RANK</small>{p.lrp != null ? `#${p.lrp}` : '—'}</span>
        <span className={s.ph}>{src && !bad ? <img src={src} alt="" onError={() => setBad(true)} /> : <i>{w.map(x => x[0]).join('').slice(0, 2)}</i>}</span>
        <span className={s.nm}><small>{w[0]}</small>{w.slice(1).join(' ') || w[0]}</span>
        <span className={s.ln}>
          {[['pts', 'PTS'], ['trb', 'REB'], ['ast', 'AST']].map(([k, l]) => <span key={k}><b>{p[k] ?? '—'}</b><small>{l}</small></span>)}
          <span><b>{p.gs.toFixed(1)}</b><small>GMSC</small></span>
        </span>
        <span className={s.el}><span>{tShort(p.t).toUpperCase()} {g.home === p.t ? 'vs' : '@'} {tCode(opp)}</span><span>{sgn(p.post - p.pre)}</span></span>
      </span>
    </span>
  )
}

const Stat = ({ l, v, sub, i, c }) => <div className={s.stat} style={{ '--d': `${0.15 * i + 0.3}s`, '--c': c || '#c9a24a' }}><small>{l}</small><b>{v}</b>{sub && <span>{sub}</span>}</div>

// The night, read off the finals: who the show talks about and in what order
function buildNight({ finals, side }) {
  const G = finals.map(({ c, f }) => {
    const g = c.g
    const pts = { [g.teams[0]]: g.pts[0], [g.teams[1]]: g.pts[1] }
    const win = pts[g.teams[0]] > pts[g.teams[1]] ? g.teams[0] : g.teams[1]
    return { g, f, pts, win, lose: g.teams.find(t => t !== win), home: f.home, away: f.away }
  })
  const byId = new Map(G.map(x => [x.g.id, x]))
  const all = G.flatMap(x => x.g.players.map(p => ({ p, x }))).filter(({ p }) => p.mp == null || p.mp > 0)
  const potd = side.picks.find(x => x[0] === 'Player of the Day')?.[1]
  const pd = potd && byId.get(potd.g.id) && { p: potd.p, x: byId.get(potd.g.id) }
  const ups = G.filter(x => x.f.upset && x.f.wp).sort((a, b) => a.f.wp[a.win] - b.f.wp[b.win])
  const used = new Set(pd ? [pd.p.n] : [])
  const cg = side.careerGames.map(m => ({ p: m.p, x: byId.get(m.g.id) })).find(m => m.x && !used.has(m.p.n))
  if (cg) used.add(cg.p.n)
  const mil = side.milestones.map(m => ({ p: m.p, x: byId.get(m.g.id), stamp: m.m.stamps.find(t => t.up && stampLine(t.text)) }))
    .find(m => m.x && m.stamp && !used.has(m.p.n))
  const risers = [...all].sort((a, b) => (b.p.post - b.p.pre) - (a.p.post - a.p.pre))
  const pick = k => { const v = side.picks.find(x => x[2] === k)?.[1]; return v && byId.get(v.g.id) ? { ...v, x: byId.get(v.g.id) } : null }
  return { G, pd, ups, cg, mil, risers, fallers: [...risers].reverse(), duel: pick('duel'), slayer: pick('slayer') }
}

function buildShow(N, kit, seed, actions) {
  const { tShort, tName, tColor } = kit
  const r = rng(seed)
  const segs = []
  const won = (p, x) => x.win === p.t
  const opp = (p, x) => x.g.teams.find(t => t !== p.t)
  const facts = (p, x) => ({
    name: bn(p.n), last: lastName(p.n), team: tShort(p.t), opp: tShort(opp(p, x)), pts: p.pts ?? null, reb: p.trb ?? null, ast: p.ast ?? null,
    gs: p.gs.toFixed(1), fg: p.fga ? `${p.fg} of ${p.fga}` : null, delta: Math.abs(p.post - p.pre).toFixed(1), post: r0(p.post),
    rank: p.lrp != null && p.lrp <= 150 ? p.lrp : null, prev: p.lr ?? null, ns: (p.gs + (p.post - p.pre) / 6).toFixed(1),
    result: won(p, x) ? 'won' : 'still lost', mins: p.mp || null,
  })
  const n = N.G.length, u = N.ups.length
  segs.push({
    id: 'open', title: 'Tonight’s finals', lab: 'All final',
    ots: <><span className={s.big2}>{n}</span><span className={s.big2l}>FINAL{n === 1 ? '' : 'S'}</span></>,
    head: ['Around the league', 'Final'],
    body: <div className={s.scores}>{N.G.map((x, i) => (
      <button key={x.g.id} type="button" style={{ animationDelay: `${0.05 * i}s` }} onClick={() => actions.box(x.g)}>
        {[x.away, x.home].map(t => <span key={t} data-w={t === x.win ? '' : undefined}><b>{kit.tCode(t)}</b><b>{x.pts[t]}</b></span>)}
        {x.f.upset && x.f.wp && <em>UPSET · {pct(x.f.wp[x.win])}</em>}
      </button>))}</div>,
    lines: say(B.open, { slate: n === 1 ? 'one game' : `${n} games`, gamesN: n > 1 ? n : null, upsets: u ? (u === 1 ? 'one upset' : `${u} upsets`) : null, times: u ? (u === 1 ? 'once' : `${u} times`) : null, chalk: u ? null : '' }, r),
  })
  if (N.pd) {
    const { p, x } = N.pd
    segs.push({
      id: 'potd', title: 'Player of the Day', lab: 'Player of the Day', go: () => actions.card(x.g, p),
      ots: <Card p={p} g={x.g} kit={kit} shots={actions.shots} />,
      head: ['Player of the Day', 'Top performer', `${tShort(p.t)} vs ${tShort(opp(p, x))}`],
      body: <><Card p={p} g={x.g} kit={kit} shots={actions.shots} big /><div className={s.stats}>
        <Stat l="Points" v={p.pts} sub={p.fga ? `${p.fg}-${p.fga} FG${p.tpa ? ` · ${p.tp}-${p.tpa} 3PT` : ''}` : null} i={0} />
        <Stat l="Rebounds" v={p.trb ?? '—'} i={1} /><Stat l="Assists" v={p.ast ?? '—'} i={2} />
        <Stat l="Game Score" v={p.gs.toFixed(1)} i={3} c="#ffd34d" />
        <Stat l="Elo" v={sgn(p.post - p.pre)} sub={`${r0(p.pre)} → ${r0(p.post)}`} i={4} c="#6bff95" />
        <Stat l="League rank" v={p.lrp != null ? `#${p.lrp}` : '—'} sub={p.lr != null ? `from #${p.lr}` : null} i={5} c="#7ef0ff" />
      </div></>,
      lines: say(B.potd, facts(p, x), r),
    })
  }
  if (N.ups[0]) {
    const x = N.ups[0], g = x.g, wp = x.f.wp
    const top = t => [...g.players].filter(p => p.t === t).sort((a, b) => b.pts - a.pts)[0]
    const w = top(x.win), l = top(x.lose)
    const score = `${x.pts[x.win]}–${x.pts[x.lose]}`
    const v = { win: tShort(x.win), lose: tShort(x.lose), chance: pct(wp[x.win]), fav: pct(wp[x.lose]), score, wtop: w && bn(w.n), wpts: w?.pts, ltop: l && bn(l.n), lpts: l?.pts }
    segs.push({
      id: 'upset', title: 'Upset alert', lab: 'Upset alert', go: () => actions.box(g),
      ots: <><span className={s.big2}>{pct(wp[x.win])}</span><span className={s.big2l}>{kit.tCode(x.win)} PRE-GAME</span></>,
      head: ['Upset alert', 'Final', `${tShort(x.away)} at ${tShort(x.home)}`],
      body: <><div className={s.wpg}>
        {[x.away, x.home].map(t => <div key={t} className={s.wpRow}><span className={s.tm} style={{ '--c': tColor(t) }}>{tName(t).toUpperCase()}</span><span className={s.sc} data-w={t === x.win ? '' : undefined}>{x.pts[t]}</span></div>)}
        <div className={s.wpLab}><span>{kit.tCode(x.away)} {pct(wp[x.away])}</span><span>PRE-GAME WIN CHANCE</span><span>{pct(wp[x.home])} {kit.tCode(x.home)}</span></div>
        <div className={s.wpBar}><i style={{ width: `${wp[x.away] * 100}%`, background: tColor(x.away) }} /><i style={{ flex: 1, background: tColor(x.home) }} /></div>
      </div><div className={s.stamp}>UPSET</div></>,
      lines: say(B.upset, v, r),
    })
    if (w && l) segs.push({
      id: 'box', title: 'Inside the box', lab: 'The box score', go: () => actions.box(g),
      ots: <><Card p={w} g={g} kit={kit} shots={actions.shots} /><Card p={l} g={g} kit={kit} shots={actions.shots} /></>,
      head: ['The box score', 'Final', `${tShort(x.win)} ${x.pts[x.win]}, ${tShort(x.lose)} ${x.pts[x.lose]}`],
      body: <div className={s.bx}>{[x.win, x.lose].map(t => (
        <table key={t}><caption>{tName(t).toUpperCase()}</caption>
          <thead><tr><th>Player</th><th data-x>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>GMSC</th><th data-x>ELO ±</th></tr></thead>
          <tbody>{g.players.filter(p => p.t === t).sort((a, b) => b.gs - a.gs).slice(0, 5).map((p, i) => (
            <tr key={p.n} style={{ animationDelay: `${0.1 * i + 0.2}s` }}><td><b>{bn(p.n)}</b></td><td data-x>{p.mp ?? '—'}</td><td><b>{p.pts}</b></td><td>{p.trb ?? '—'}</td><td>{p.ast ?? '—'}</td><td><b>{p.gs.toFixed(1)}</b></td>
              <td data-x className={p.post >= p.pre ? s.up : s.dn}>{sgn(p.post - p.pre)}</td></tr>))}</tbody>
        </table>))}</div>,
      lines: say(B.box, v, r),
    })
  }
  if (N.cg) {
    const { p, x } = N.cg
    segs.push({
      id: 'career', title: 'Career night', lab: 'Career game ★', go: () => actions.card(x.g, p),
      ots: <Card p={p} g={x.g} kit={kit} shots={actions.shots} />,
      head: ['Career game', '★', `${tShort(p.t)} vs ${tShort(opp(p, x))}`],
      body: <><Card p={p} g={x.g} kit={kit} shots={actions.shots} big /><div className={s.stats}>
        <Stat l="Game Score" v={p.gs.toFixed(1)} sub="a career best" i={0} c="#ffd34d" />
        <Stat l="Points" v={p.pts} sub={p.fga ? `${p.fg} of ${p.fga} shooting` : null} i={1} />
        <Stat l="Rebounds" v={p.trb ?? '—'} i={2} /><Stat l="Assists" v={p.ast ?? '—'} i={3} />
        <Stat l="League rank" v={p.lrp != null ? `#${p.lrp}` : '—'} sub={p.lr != null ? `from #${p.lr}` : null} i={4} c="#7ef0ff" />
        <Stat l="Elo" v={sgn(p.post - p.pre)} sub={`to ${r0(p.post)}`} i={5} c="#6bff95" />
      </div></>,
      lines: say(B.career, facts(p, x), r),
    })
  }
  if (N.mil) {
    const { p, x, stamp } = N.mil
    const v = { ...facts(p, x), jump: p.lr != null && p.lrp != null && p.lr > p.lrp ? p.lr - p.lrp : null, stamp: stampLine(stamp.text) }
    if (!(p.lr > p.lrp)) { v.prev = null; v.rank = null }
    segs.push({
      id: 'climb', title: 'Milestone', lab: 'Milestone ◆', go: () => actions.card(x.g, p),
      ots: <><span className={s.big2}>#{p.lrp}</span><span className={s.big2l}>{lastName(p.n).toUpperCase()}</span></>,
      head: ['Milestone', '◆', bn(p.n)],
      body: <div className={s.rank}>{p.lr != null && p.lr !== p.lrp && <><span className={s.from}>#{p.lr}</span><span className={s.arrow}>→</span></>}<span className={s.to}>#{p.lrp}</span>
        <span className={s.tierB}>{stamp.text.toUpperCase()}</span></div>,
      lines: say(B.climb, v, r),
    })
  }
  const R = N.risers[0]?.p, F = N.fallers[0]?.p
  if (R && F && R !== F) {
    const rows = [...N.risers.slice(0, 3), ...N.fallers.slice(0, 2)]
    const mx = Math.max(R.post - R.pre, F.pre - F.post, 1)
    segs.push({
      id: 'movers', title: 'Elo movers', lab: 'Elo movers',
      ots: <span className={`${s.big2} ${s.up}`}>{sgn(R.post - R.pre)}</span>,
      head: ['Elo movers', 'Risers & fallers', 'Tonight'],
      body: <div className={s.movers}>{rows.map(({ p, x }, i) => { const d = p.post - p.pre; return (
        <button key={p.n + i} type="button" className={s.mv} onClick={() => actions.card(x.g, p)}><span><b>{kit.shortName(p.n)}</b><small>{kit.tCode(p.t)} · {r0(p.pre)} → {r0(p.post)}</small></span>
          <span className={s.mvBar}><i style={{ left: `${d >= 0 ? 50 : 50 - Math.abs(d) / mx * 50}%`, width: `${Math.abs(d) / mx * 50}%`, background: d >= 0 ? '#2fae5c' : '#d6223a', animationDelay: `${0.15 * i}s` }} /><i className={s.mid} /></span>
          <strong className={d >= 0 ? s.up : s.dn}>{sgn(d)}</strong></button>) })}</div>,
      lines: say(B.movers, { rname: bn(R.n), rdelta: (R.post - R.pre).toFixed(1), fname: bn(F.n), fdelta: (F.pre - F.post).toFixed(1) }, r),
    })
  }
  if (N.duel) {
    const { a, b, x } = N.duel
    segs.push({
      id: 'duel', title: 'Duel of the Day', lab: 'Duel of the Day', go: () => actions.card(x.g, a),
      ots: <><Card p={a} g={x.g} kit={kit} shots={actions.shots} /><Card p={b} g={x.g} kit={kit} shots={actions.shots} /></>,
      head: ['Duel of the Day', 'Head to head', `${tShort(a.t)} vs ${tShort(b.t)}`],
      body: <div className={s.vs}><Card p={a} g={x.g} kit={kit} shots={actions.shots} big /><span className={s.vsMid}>VS</span><Card p={b} g={x.g} kit={kit} shots={actions.shots} big /></div>,
      lines: say(B.duel, { a: bn(a.n), b: bn(b.n), alast: lastName(a.n), ag: a.gs.toFixed(1), bg: b.gs.toFixed(1) }, r),
    })
  }
  if (N.slayer) {
    const { a, b, gap, wc, x } = N.slayer
    segs.push({
      id: 'slayer', title: 'Giant-Slayer', lab: 'Giant-Slayer', go: () => actions.card(x.g, a),
      ots: <><span className={s.big2}>{pct(wc)}</span><span className={s.big2l}>CHANCE</span></>,
      head: ['Giant-Slayer', 'Long odds', `${r0(gap)} Elo apart`],
      body: <div className={s.vs}><Card p={a} g={x.g} kit={kit} shots={actions.shots} big /><span className={s.vsMid}><b>{pct(wc)}</b>CHANCE</span><Card p={b} g={x.g} kit={kit} shots={actions.shots} big /></div>,
      lines: say(B.slayer, { a: bn(a.n), b: bn(b.n), ag: a.gs.toFixed(1), bg: b.gs.toFixed(1), gap: r0(gap), chance: pct(wc) }, r),
    })
  }
  segs.push({
    id: 'close', title: 'Sign-off', lab: 'FanSided Tonight',
    ots: <span className={s.wordmark}><i>FS</i>TONIGHT</span>,
    head: ['FanSided Tonight', 'See you next time'],
    body: <div className={s.endCard}><span className={s.wordmark}><i>FS</i>FANSIDED TONIGHT</span></div>,
    lines: say(B.close, { gamesN: n > 1 ? n : null }, r),
  })
  return segs
}

export default function FanSidedTonight({ kit, day, finals, side, shots, phone, openBox, openCard, liveN, onLive }) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2e9) + 1)
  const sig = finals.map(x => x.c.g.id + x.c.g.pts.join('-')).join('|')
  const actions = { box: g => openBox(g), card: (g, p) => openCard(g, p), shots }
  const segs = useMemo(() => buildShow(buildNight({ finals, side }), kit, seed, actions), [sig, side, seed, shots])
  const [seg, setSeg] = useState(0)
  const [phase, setPhase] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [visible, setVisible] = useState(true)
  const [talk, setTalk] = useState(false)
  const [wipe, setWipe] = useState(0)
  const [k, setK] = useState(phone ? 0.5 : 0.8)
  const box = useRef(null)
  const timers = useRef([])
  const reduce = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const [Wd, Ht] = phone ? W.phone : W.desk
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms))
  const cur = Math.min(seg, segs.length - 1)
  const go = (i, p) => {
    clear()
    if (!reduce) setWipe(w => w + 1)
    later(() => { setSeg(((i % segs.length) + segs.length) % segs.length); setPhase(p) }, reduce ? 0 : 480)
  }
  const doneRef = useRef(null)
  doneRef.current = () => { clear(); later(() => (phase === 0 ? go(cur, 1) : go(cur + 1, 0)), (phase === 0 ? 1300 : 2600) + (reduce ? 1500 : 0)) }
  useEffect(() => () => clear(), [])
  useEffect(() => { clear(); setSeg(0); setPhase(0) }, [day])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setK(e.contentRect.width / Wd))
    ro.observe(el)
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 })
    io.observe(el)
    return () => { ro.disconnect(); io.disconnect() }
  }, [Wd])
  const run = playing && visible
  useEffect(() => { if (!run) { clear(); setTalk(false) } }, [run])
  const S = segs[cur]
  const [l1, l2] = S.lines
  const [h1, tag, right] = S.head
  const dateLab = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()

  return (
    <div className={s.wrap}>
      <div className={s.box} ref={box} style={{ aspectRatio: `${Wd} / ${Ht}` }}>
        <div className={s.stage} data-phone={phone ? '' : undefined} data-rm={reduce ? '' : undefined} style={{ width: Wd, height: Ht, transform: `scale(${k})` }}>
          <div className={s.studio}>
            <div className={s.led}>{finals.slice(0, 12).map((x, i) => <i key={x.c.key} style={{ '--c': kit.tColor(buildWin(x)), '--d': `${-i * 0.5}s` }} />)}</div>
            <div className={s.skyline} />
            {phase === 0 && <button key={`o${cur}-${seed}`} type="button" className={s.ots} onClick={S.go || undefined} disabled={!S.go} tabIndex={-1}>
              <span className={s.art}>{S.ots}</span><span className={s.lab}>{S.lab}</span></button>}
            <div className={s.anchor}><Anchor talk={talk && phase === 0} gest={cur % 2 === 1} /></div>
            <div className={s.desk}><span className={s.wordmark}><i>FS</i>FANSIDED TONIGHT</span></div>
          </div>
          {phase === 1 && <div key={`g${cur}-${seed}`} className={s.gfx}>
            <div className={s.gHead}><b>{h1}</b>{tag && <i>{tag}</i>}{right && <span>{right}</span>}{S.go && <button type="button" className={s.openB} onClick={S.go}>▶ Open</button>}</div>
            <div className={s.gBody}>{S.body}</div>
            <div className={s.pip}><Anchor talk={talk} /></div>
          </div>}
          <div className={s.lower}>
            <div className={s.strip}><span className={s.bug}>FANSIDED <small>TONIGHT</small></span><span key={cur} className={s.title}>{S.title}</span><span className={s.clock}>FINALS · {dateLab}</span></div>
            <Caption key={`${cur}-${phase}-${seed}`} text={(phase === 0 ? l1 : l2) || ' '} run={run} instant={reduce} onTalk={setTalk} onDone={() => doneRef.current()} />
          </div>
          {!reduce && <div key={wipe} className={s.wipe} data-go={wipe ? '' : undefined}><i /><i /><i /><i /><span>FANSIDED</span></div>}
        </div>
      </div>
      <div className={s.ctl}>
        <button type="button" onClick={() => go(cur - 1, 0)} aria-label="Previous segment">◀</button>
        <button type="button" onClick={() => setPlaying(v => !v)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <button type="button" onClick={() => go(cur + 1, 0)} aria-label="Next segment">▶▶</button>
        <span className={s.rund}>{segs.map((x, i) => <button key={x.id} type="button" data-on={i === cur ? '' : undefined} onClick={() => go(i, 0)}>{x.title}</button>)}</span>
        <button type="button" onClick={() => { clear(); setSeed(Math.floor(Math.random() * 2e9) + 1); setPhase(0) }} title="Rewrite the script">↻ New take</button>
        {liveN > 0 && <button type="button" className={s.live} onClick={onLive}><i />Live game</button>}
      </div>
    </div>
  )
}

function buildWin({ c }) { const g = c.g; return g.pts[0] > g.pts[1] ? g.teams[0] : g.teams[1] }
