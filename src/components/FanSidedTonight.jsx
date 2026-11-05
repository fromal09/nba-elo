import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import s from './FanSidedTonight.module.css'
import { useCareerHistory } from '../history.js'

// FanSided Tonight: the Sportsbook's main TV as a produced studio show about the night's finals.
// The show is a rundown of segments; each segment is a run of beats (the anchor at the desk, then full-screen
// graphics: the real cards, career Elo charts, box scores, shooting and tale-of-the-tape graphs). Every beat's
// narration is assembled from template banks, two or three sentences per beat, so a segment reads as a full
// paragraph and has thousands of possible takes. Templates whose blanks the night can't fill are skipped.

const CHAR_MS = 72        // typing speed of the captions (about the pace of speech)
const SENTENCE_GAP = 1100 // pause between sentences
const HOLD = { anchor: 2600, gfx: 4200 } // how long a finished beat stays up

// ── Script banks: each beat lists banks; one line is drawn from each ──
const OPENERS = ['Good evening and welcome to FanSided Tonight.', 'Welcome in to FanSided Tonight.', 'You’re watching FanSided Tonight.', 'Evening, everybody, and welcome to the show.', 'Thanks for joining us on FanSided Tonight.', 'It’s FanSided Tonight, and we are rolling.', 'Pull up a chair, this is FanSided Tonight.', 'Here we go on FanSided Tonight.', 'Good to have you with us on FanSided Tonight.', 'From the FanSided desk, welcome to the show.']
const B = {
  open: {
    intro: [OPENERS,
      ['{slate} went final tonight, with {upsets} along the way.', 'We have {slate} to get through, and the forecast got burned {times}.', 'The league went {gamesN} deep tonight, and the underdogs came through {times}.', 'All {gamesN} games are in the books, including {upsets}.', 'Every favorite held serve tonight, but there was still plenty to talk about.{chalk}', 'It was a night for the chalk, but the individual performances made up for it.{chalk}', 'We had {slate} on the board, and there’s a lot to unpack.', '{slate} are final, with {liveTxt} still going.', 'We’ve got {slate} in the books and {liveTxt} still being played.'],
      ['We’ve got a Player of the Day, career nights, a duel worth your time and the biggest swings in the rankings.', 'Stick around, because the cards came out to play.', 'Let’s get to it.', 'There’s a lot to cover, so let’s not waste any time.', 'Grab your binder. You’re going to want to add a few of these.']],
    scores: [['Here’s the full board.', 'Let’s run through the finals.', 'Around the league, here’s how it went.', 'Your final scores, all in one place.', 'A quick lap around the league.', 'Here’s every final from tonight.'],
      ['The {bigW} had the easiest night, a {bigM}-point win over the {bigL}.', 'The biggest margin belonged to the {bigW}, who beat the {bigL} by {bigM}.', 'The {bigW} ran away from the {bigL}, {bigScore}.'],
      ['The {closeW} and {closeL} gave us the closest finish, {closeScore}{closeOT}.', 'The tightest one was {closeW} over {closeL}, decided by {closeM}{closeOT}.', 'And the {hiW} put up {hiPts}, the most points by anyone tonight.', 'If you like close games, {closeW} and {closeL} went down to the wire, {closeScore}.']],
    fan: [['These are tonight’s Cards of the Day.', 'Here’s what we’ll get to tonight.', 'Tonight’s featured cards, all in a row.', 'Take a look at the cards we’re talking about tonight.', 'The binder’s about to get a little heavier.'],
      ['{potd} leads the way as Player of the Day.', 'We’ll start with {potd}, then work our way through the rest.', 'Player of the Day, the duel and the biggest Elo swings, they’re all here.', '{cardCount} cards, and every one of them earned its spot.'],
      ['We’ll take them one at a time.', 'Let’s start at the top.', 'First up, the best player in the league tonight.']],
  },
  potd: {
    intro: [['Our Player of the Day is {name}.', 'Nobody did it better tonight than {name}.', 'The night belonged to {name}.', 'Tonight’s top performer: {name}.', 'Hats off to {name}.', '{name} owned the night.', 'The Player of the Day card goes to {name}.', 'If you watched one player tonight, it should have been {name}.', 'Nobody touched {name} tonight.'],
      ['He finished with {pts} points, {reb} rebounds and {ast} assists as the {team} {rv} the {opp}, {score}.', '{pts} points, {reb} rebounds and {ast} assists in a {score} {rn} against the {opp}.', 'The {team} {rv} the {opp} {score}, and he was the one everybody was talking about.', 'It came in a {score} {rn} for the {team} against the {opp}, and he put up {pts}.'],
      ['Let’s take a closer look.', 'Here’s how he did it.', 'This one deserves a full breakdown.', 'Let’s go to the card.']],
    hero: [['Here’s the card.', 'Take a look at the line.', 'Here’s the full stat line.', 'Let’s put it on the screen.', 'This is what a Player of the Day card looks like.'],
      ['A {gs} Game Score in {mins} minutes, with {stl} steals and {blk} blocks mixed in.', 'That’s a {gs} Game Score, the best in the league tonight.', 'His {gs} Game Score topped every player on the slate.', 'He was a {pm} in {mins} minutes on the floor.', 'A {gs} Game Score and a {pm} plus-minus tell you how much he controlled the game.'],
      ['His Elo moves {up} {delta} to {post}.', 'That night is worth {delta} points of Elo, and he’s now at {post}.', 'He moves from number {prev} to number {rank} in the rankings.', 'In the rankings, he goes from {prev} to {rank}.', 'His Player of the Day score, Game Score plus a sixth of his Elo gain, came out to {ns}.']],
    shoot: [['Now look at how efficient he was.', 'The shooting tells the rest of the story.', 'Here’s where it gets impressive.', 'Let’s talk about the shot-making.', 'Look at the efficiency.'],
      ['He went {fgline} from the field and {tpline}.', '{fgline} shooting, and {ftline} at the line.', 'That works out to {ts} true shooting.', '{fgpct} from the field on {fga} attempts.', 'He made {fg} of his {fga} shots.'],
      ['He averages {spts} points a game this season, so this was {ptsOver} above his norm.', 'Compare that to his {spts} points per game on the season.', 'His season average is {spts} points and a {sgs} Game Score, and tonight he blew past both.', 'Through {gp} games he’s been a {sgs} Game Score player. Tonight was {gs}.', 'That’s as efficient as it gets with that kind of volume.']],
    career: 'career',
    box: 'box',
  },
  career: [['Here’s his whole career in one line.', 'Let’s zoom out to his career.', 'Put that in context with his career Elo.', 'This is every game of his career.', 'Here’s the long view.'],
    ['He’s played {cgames} career games, peaking at {peak}.', 'His career peak is {peak}, and tonight puts him at {post}.', 'He’s {peakGap} points off his career peak of {peak}.', 'Tonight’s {post} is a new career high.{newPeak}', 'He started tonight at {pre} and leaves at {post}.'],
    ['That jump at the end is tonight.', 'You can see tonight’s spike at the far right.', 'The line doesn’t lie.', 'Every big night shows up on this chart, and this was one of them.', 'That last point on the chart is tonight.']],
  seasonGraph: [['Here’s his season so far.', 'Let’s look at his season in Elo.', 'This is every game of his season.'],
    ['He came into tonight at {pre} after {gp} games.', 'He started tonight at {pre} and leaves at {post}.', 'Tonight’s game moved him {up} {delta}.'],
    ['That last point is tonight.', 'You can see the jump at the far right.', 'The chart tells the story.']],
  box: [['Here’s the box score from that one.', 'The full box.', 'Let’s look at the whole game.', 'Here’s how the rest of the box shook out.'],
    ['{tmName} added {tmPts} for the {team}.', '{oppTop} led the {opp} with {oppPts}.', 'The {team} got {tmPts} from {tmName} as well.', 'On the other side, {oppTop} had {oppPts}.'],
    ['But this was his night.', 'His row is the one you’ll remember.', 'Final score, {score}.', 'Tap the screen to open the full box score.']],
  upset: {
    intro: [['Upset alert.', 'Stop me if you saw this coming.', 'The forecast did not see this one.', 'Biggest stunner of the night.', 'Here’s your upset of the night.', 'Nobody had this one.', 'Chalk got broken tonight.', 'We have an upset.', 'Throw out the numbers on this one.', 'Your upset special.'],
      ['The {win} came in at just {chance} and beat the {lose} {score}.', 'The {win}, given a {chance} chance, knocked off the {lose}, {score}.', 'At {chance}, the {win} took down the {lose} {score}.', 'The {lose} were {fav} favorites and still fell to the {win}, {score}.', 'The {win} beat the {lose} {score} as {chance} underdogs.'],
      ['Let’s break it down.', 'Here’s how it happened.', 'Let’s go to the numbers.']],
    wp: [['Here’s what the forecast said before tipoff.', 'Look at the pre-game win chance.', 'Before the game, the numbers were clear.', 'Here’s how lopsided it looked on paper.'],
      ['Our Elo forecast had the {lose} at {fav}.', 'The {win} were given a {chance} chance to win this game.', 'That’s roughly a one-in-{oneIn} shot for the {win}.', '{fav} for the {lose}. {chance} for the {win}.'],
      ['The {win} won anyway, {score}{otTail}.', 'And the {win} won by {margin}.', 'It didn’t matter. Final, {score}{otTail}.', 'Final score: {score}{otTail}.']],
    lineup: [['Here’s why they were favored.', 'Compare the lineups.', 'Lineup Elo tells you what each team put on the floor.'],
      ['The {lose} lineup came in rated {loseElo}, against {winElo} for the {win}.', 'That’s a {eloGap}-point gap in lineup Elo, and the {win} closed it.', 'The {win} were outrated by {eloGap} points.'],
      ['That’s why upsets move the ratings so much.', 'Beat a better team and the ratings notice.', 'The Elo swing on both rosters shows it.']],
    box: [['Here’s how they pulled it off.', 'The box score from the upset.', 'Inside the box.', 'The key lines from that one.'],
      ['{wtop} led the {win} with {wpts}.', '{wtop} carried the {win} with {wpts} points.', '{wpts} from {wtop} was the difference.', 'The {win} got {wpts} from {wtop}.'],
      ['{ltop} had {lpts} in the loss.', 'On the other side, {ltop} scored {lpts}.', '{ltop} dropped {lpts} and it wasn’t enough.', 'Even {lpts} from {ltop} couldn’t save the {lose}.']],
    hero: [['The best card from the upset belongs to {name}.', 'Give the credit to {name}.', 'The upset’s top performer was {name}.'],
      ['{pts} points, {reb} rebounds, {ast} assists and a {gs} Game Score.', 'He finished a {pm} with {pts} points.', 'A {gs} Game Score on {fgline} shooting.'],
      ['He gained {delta} Elo on the night.', 'His Elo climbs to {post}.', 'That moves him to number {rank} in the rankings.']],
  },
  careerGame: {
    intro: [['Career night alert.', 'Put this one in the scrapbook.', 'A career best tonight.', 'Never been better.', 'Personal best, right here.', 'We have a career game.', 'Circle this one.', 'Mark the date.', 'A new high-water mark.'],
      ['{name} posted a career-best {gs} Game Score against the {opp}.', '{name} went for {pts}, {reb} and {ast}, the best game of his career by Game Score.', 'A {gs} Game Score for {name}, the best he’s ever had.', '{name} had the game of his life, {pts} points on {fgline} shooting.'],
      ['Let’s look at it.', 'Here’s the card.', 'This one goes in the binder.']],
    hero: [['Here’s the card.', 'Look at this line.', 'The card for the record book.'],
      ['{pts} points, {reb} rebounds and {ast} assists, {fgline} from the field.', 'A {gs} Game Score in {mins} minutes.', 'He was a {pm} in {mins} minutes.'],
      ['The {team} {rv} the {opp}, {score}.', 'His Elo moves {up} {delta} to {post}.', 'He climbs to number {rank}.']],
    vs: [['Compare it to his season.', 'Here’s how far above his norm that was.', 'Tonight versus his season averages.'],
      ['He’s averaging {spts} points and a {sgs} Game Score through {gp} games.', 'Through {gp} games he averages {spts}, {sreb} and {sast}.', 'His career Game Score average is {cgs}.'],
      ['Tonight he went for {pts} and a {gs}.', 'That’s {ptsOver} points above his average.', 'Nights like this don’t come around often.']],
    career: 'career',
    list: [['He wasn’t the only one.', 'It was a big night for personal bests.', 'More career nights around the league.'],
      ['{careerN} players set career-best Game Scores tonight.', 'Here are the rest of tonight’s career games.', 'Here’s everybody who had the best game of his career tonight.', '{c2} had a {c2gs} of his own, the best game of his career.'],
      ['Every one of those cards gets a star.', 'That’s a lot of new career highs.', 'Tap a card on the board to open it.']],
  },
  milestone: {
    intro: [['Milestone alert.', 'Watch out for this one in the rankings.', 'Movin’ on up.', 'A big jump in the rankings.', 'Rankings shake-up.', 'New neighborhood in the rankings.', 'Look who’s climbing.'],
      ['{name} hit a milestone tonight against the {opp}.', '{name} had a night worth marking.', 'It took a {gs} Game Score from {name} to get here.'],
      ['Here’s the move.', 'Let’s look at it.', 'Take a look.']],
    rank: [['Here’s the move.', 'Look at that jump.', 'The rankings, before and after.'],
      ['{name} jumps from number {prev} to number {rank}.', 'From {prev} to {rank} for {name}.', '{name} climbs {jump} spots to number {rank}.', '{stamp}'],
      ['{stamp}', 'He went for {pts} points and a {gs} Game Score against the {opp}.', 'His Elo is up to {post}.']],
    career: 'career',
    list: [['Around the league, more milestones.', 'He wasn’t alone.', 'Here are the rest.'],
      ['There were {milN} milestones on the night.', '{milN} players hit a milestone tonight.'],
      ['Every one gets a diamond on the ticker.', 'Tap any of them on the board below.']],
  },
  movers: {
    bars: [['Let’s check the movers.', 'Biggest swings of the night.', 'Elo winners and losers.', 'Who gained, who slipped.', 'Up and down the ladder.', 'The night’s Elo swings.'],
      ['{rname} gained {rdelta}, the most of anyone.', 'Nobody climbed more than {rname}, up {rdelta}.', 'Top riser: {rname}, plus {rdelta}.', 'A {rdelta} gain for {rname}.'],
      ['{fname} dropped {fdelta}, the biggest fall.', 'On the other end, {fname} lost {fdelta}.', 'Tough night for {fname}, down {fdelta}.', 'Biggest faller: {fname}, minus {fdelta}.']],
    riser: [['Let’s look at the biggest riser.', 'Here’s the top riser’s card.', 'The biggest gain of the night.'],
      ['{name} went for {pts}, {reb} and {ast} against the {opp}.', 'A {gs} Game Score from {name}.', '{name} shot {fgline} against the {opp}.'],
      ['That moves him from {pre} to {post}.', 'He jumps from number {prev} to {rank}.', 'Big nights against good teams pay off.']],
    faller: [['And the other end.', 'Here’s the biggest drop.', 'Not every card goes up.'],
      ['{name} managed a {gs} Game Score against the {opp}.', '{name} went {fgline} from the field.', '{name} had {pts} points in {mins} minutes.'],
      ['That costs him {delta}, down to {post}.', 'He slides from {pre} to {post}.', 'He’ll get a chance to win it back.']],
  },
  duel: {
    intro: [['Duel of the Day.', 'Our heavyweight bout.', 'Main event time.', 'Best one-on-one of the night.', 'Two stars, one winner.', 'Tonight’s marquee matchup.', 'Head to head.', 'Star versus star.'],
      ['{a} and {b} squared off, and both of them delivered.', '{a} against {b}, two players rated {apre} and {bpre}.', 'It was {a} for the {ateam} against {b} for the {bteam}.'],
      ['Here’s the card.', 'Let’s go to the tape.', 'Let’s see how it played out.']],
    card: [['Here’s the duel card.', 'Look at this card.', 'The Duel of the Day card.'],
      ['{a} edged {b}, {ag} to {bg} in Game Score.', '{a} topped {b} with a {ag} Game Score to {bg}.', '{ag} for {a}, {bg} for {b}. Advantage {alast}.'],
      ['Both of them played well enough to win most nights.', 'That card is a good one.', 'Duel card unlocked.']],
    tape: [['Tale of the tape.', 'Side by side.', 'Let’s compare them stat for stat.'],
      ['{a} had {apts} points; {b} had {bpts}.', '{alast} won the Game Score battle, {ag} to {bg}.', '{a} came in rated {apre}; {b} came in at {bpre}.'],
      ['Instant classic.', 'That’s why you stay up late.', 'Give them both credit.', 'Neither one played badly.']],
    box: [['Here’s the box from that game.', 'The full box score.', 'Here are both lines in the box.'],
      ['The {winT} won it, {score}.', 'Final score, {score}.', 'Look at the two rows that matter.'],
      ['Tap the screen for the full box score.', 'Two stars, one box score.', 'Both rows are highlighted.']],
  },
  slayer: {
    intro: [['Giant-Slayer of the Day.', 'David, meet Goliath.', 'Talk about punching up.', 'Giant-slayer alert.', 'The longest odds of the night.', 'Underdog story.', 'Upset of a different kind.'],
      ['{a} outplayed {b}, who was {gap} Elo points ahead of him.', '{a} beat {b} by Game Score with a {gap}-point Elo gap.', 'Rated {gap} below {b}, {a} won the duel anyway.'],
      ['Here’s the card.', 'Let’s look at the odds.', 'Let’s go to the tape.']],
    card: [['Here’s the giant-slayer card.', 'Look at this one.', 'The Giant-Slayer card.'],
      ['The odds of {a} winning that matchup were {chance}.', 'A {chance} chance, and {a} still outscored {b}.', '{a} over {b}. The odds said {chance}.'],
      ['Big night for the little guy.', 'Respect.', 'He’ll be hearing about that one.']],
    tape: [['Tale of the tape.', 'Side by side.', 'Look at the gap.'],
      ['{a} came in at {apre}; {b} came in at {bpre}.', '{alast} won the Game Score battle, {ag} to {bg}.', '{a} had {apts} points; {b} had {bpts}.'],
      ['Goliath goes home.', 'Rare stuff.', 'Elo loves an upset.']],
  },
  close: {
    fan: [['That’s the show.', 'That’s going to do it for us.', 'And that’s a wrap.', 'That’s all for tonight.', 'We’ll leave it there.', 'That’s our time.'],
      ['One more look at tonight’s Cards of the Day.', 'Here are tonight’s cards one last time.', 'Every card from tonight is waiting on the wall.'],
      ['Tap any TV for the full box score.', 'Every box score is one tap away.', 'Check the board below for every table.', 'Make your picks before the next tip.']],
    end: [['For FanSided Tonight, good night.', 'See you next time on FanSided Tonight.', 'Thanks for watching FanSided Tonight.', 'Get some sleep, and we’ll see you next time.'],
      ['Open your pack.', 'Until next time.', 'We’ll be here tomorrow.']],
  },
}

// Runners-up: the podium and the near misses in every category
const RU = {
  podium: [['Here’s the podium.', 'Let’s see the top three.', 'The Player of the Day podium.', 'It wasn’t a one-man race.', 'Here’s how the race for Player of the Day finished.'],
    ['{n2} finished second with a {s2} on the Player of the Day scale, {p2line} against the {o2}.', 'Silver goes to {n2}, who put up {p2line} against the {o2}.', '{n2} came in second at {s2}, with {p2line}.', 'The runner-up was {n2}: {p2line} against the {o2}.'],
    ['{n3} took the bronze with {p3line}.', '{n3} rounded out the podium at {s3}.', 'Third place went to {n3}, {p3line} against the {o3}.', '{n3} grabbed the last spot on the podium, a {s3}.'],
    ['But nobody caught {n1}, at {s1}.', 'The gap between first and second was {gap12} points.', '{n1} won it by {gap12}.', 'It was close at the top, just {gap12} points.{tight}', 'This one wasn’t close. {n1} won by {gap12}.{wide}']],
  upsets: [['It wasn’t the only upset.', 'There were more surprises around the league.', 'The favorites had a rough night overall.', 'Here are the rest of tonight’s upsets.'],
    ['The {u2w} beat the {u2l} as {u2c} underdogs.', 'The {u2w} also won at {u2c}, beating the {u2l} {u2s}.', 'At {u2c}, the {u2w} knocked off the {u2l}.'],
    ['The {u3w} pulled one off too, at {u3c}.', 'And the {u3w} took down the {u3l} at {u3c}.', 'That’s {upN} upsets on the night.', 'Check your pick’em sheet.']],
  duel: [['The runner-up duel.', 'Honorable mention goes to another matchup.', 'Just missing the cut was this one.', 'The second-best duel of the night.'],
    ['{ra} and {rb} went at it, {rag} to {rbg} in Game Score.', '{ra} edged {rb}, {rag} to {rbg}.', '{ra} for the {rateam} against {rb} for the {rbteam}, {rag} to {rbg}.'],
    ['That one would have won most nights.', 'Good, just not quite the main event.', 'A strong second place.', 'Both of those cards are worth keeping too.']],
  slayer: [['The runner-up giant-slayer.', 'Another long shot came through.', 'Honorable mention for punching up.', 'One more giant fell tonight.'],
    ['{ra} outplayed {rb}, who was rated {rgap} points higher.', '{ra} beat {rb} by Game Score, {rag} to {rbg}, at {rchance} odds.', 'At {rchance}, {ra} still got the better of {rb}.'],
    ['Not quite as wild, but close.', 'Two giants fell tonight.', 'Respect to him too.']],
}

// Live look-ins: games still in progress, woven through the show
const L = {
  board: [['And the night isn’t over.', 'We’re not done yet, either.', 'Meanwhile, the action is still going.', 'But first, a look at what’s still being played.'],
    ['We’ve got {liveTxt} in progress right now.', 'There {liveAre} still {liveTxt} going as we speak.', '{liveTxt} {liveIs} still on the floor.'],
    ['We’ll check in on them throughout the show.', 'We’ll bring you live look-ins as we go.', 'Stay with us for updates all show long.', 'We’ll keep an eye on every one of them.']],
  intro: [['Let’s take a quick look at a game in progress.', 'We’ve got a game going right now.', 'Live look-in time.', 'Let’s check in on a game that’s still going.', 'Time for a live update.', 'Somewhere in the league, they’re still playing.', 'Let’s send it to a game in progress.', 'Quick check on a game that’s still on.'],
    ['It’s the {away} at the {home}, and the {leader} lead {leadScore} {clock}.', 'The {leader} are up {margin} on the {trailer} {clock}.', 'The {away} and the {home} are all tied up at {tieScore} {clock}.', '{away} at {home}, {leadScore} {leader} {clock}.'],
    ['Here’s where it stands.', 'Let’s look at the live numbers.', 'Here’s the live picture.', 'Let’s go to the board.']],
  bug: [['Before tipoff, the {fav} were {favPct} favorites.', 'The pre-game forecast had the {fav} at {favPct}.', 'Coming in, the {fav} were the pick at {favPct}.', 'The {fav} came in as {favPct} favorites.'],
    ['Right now our live model gives the {liveLead} a {livePct} chance.', 'With the clock running, the {liveLead} are at {livePct}.', 'The live win chance has the {liveLead} at {livePct}.', 'As of now, it’s {livePct} for the {liveLead}.'],
    ['That’s an upset watch.{uw}', 'The underdog has the edge right now, so keep an eye on this one.{uw}', 'We project a final of {projLine}.', 'Our projected final: {projLine}.', 'There’s plenty of basketball left.{early}', 'This one could come down to the wire.{late}', 'The favorite is in control.{safe}']],
  box: [['Here’s who’s carrying the load so far.', 'The top performers so far.', 'The live leaders.', 'Here’s who’s shining in this one.'],
    ['{t1} has {t1pts} points, {t1reb} rebounds and {t1ast} assists for the {t1team}.', '{t1} leads everybody with a {t1gs} Game Score so far.', '{t1} is up to {t1pts} points for the {t1team}.', '{t1} has been the best player on the floor, {t1pts} points and counting.'],
    ['{t2} has {t2pts} for the {t2team}.', 'On the other side, {t2} has {t2pts}.', '{t2} is keeping the {t2team} in it with {t2pts}.', '{t2} has a {t2gs} Game Score of his own.'],
    ['We’ll come back to this one.', 'We’ll check back in later in the show.', 'Back to the rest of the night.', 'Keep it here for updates.']],
}
const LiveCtx = createContext(null)
const ORD = ['first', 'second', 'third', 'fourth']
function clockText(live) {
  const d = String(live?.detail || ''), per = live?.period || 0
  if (/half/i.test(d)) return 'at halftime'
  const ord = per > 4 ? (per === 5 ? 'overtime' : `${per - 4}OT`) : ORD[per - 1]
  if (!ord) return 'early on'
  if (/end/i.test(d)) return per > 4 ? 'at the end of overtime' : `at the end of the ${ord}`
  const t = d.match(/\b(\d{1,2}:\d{2}|\d{1,2}\.\d)\b/)
  if (t) return per > 4 ? `with ${t[1]} left in ${ord}` : `with ${t[1]} left in the ${ord}`
  return per > 4 ? `in ${ord}` : `in the ${ord}`
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
const say = (banks, v, r) => banks.map(b => { const ok = b.filter(t => usable(t, v)); if (!ok.length) return ''; return fill(ok[Math.floor(r() * ok.length)], v) }).filter(Boolean).join(' ')
const combos = banks => banks.reduce((n, b) => n * b.length, 1)
const bn = n => n.replace(/\s*\(.*\)$/, '')
const lastName = n => bn(n).split(' ').slice(1).join(' ') || bn(n)
const pct = v => `${Math.max(1, Math.min(99, Math.round(v * 100)))}%`
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1)
const r0 = v => Math.round(v).toLocaleString()
const f1 = v => (Math.round(v * 10) / 10).toFixed(1)
const SIZE = { desk: [960, 540], phone: [640, 500] }

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

// Closed captions: the beat's narration one sentence at a time, typed at speaking pace
const sentences = t => {
  // split after . ! ? followed by a space and a capital or digit, but not after initials (A.J.), Jr. or Sr.
  const out = []
  for (const piece of t.split(/(?<=[.!?]["”’]?)\s+(?=[A-Z0-9“"‘])/)) {
    if (out.length && /(?:\b[A-Z]|\b[A-Z]\.[A-Z]|\bJr|\bSr|\bSt|\bvs)\.$/.test(out[out.length - 1])) out[out.length - 1] += ' ' + piece
    else out.push(piece)
  }
  return out.map(x => x.trim()).filter(Boolean)
}
function Caption({ text, run, instant, onTalk, onDone }) {
  const parts = useMemo(() => sentences(text || ' '), [text])
  const [i, setI] = useState(0)
  const [n, setN] = useState(instant ? Infinity : 0)
  const cur = parts[Math.min(i, parts.length - 1)] || ''
  const typed = n >= cur.length
  const last = i >= parts.length - 1
  useEffect(() => {
    if (!run) { onTalk(false); return }
    if (!typed) { onTalk(true); const t = setTimeout(() => setN(v => v + 1), CHAR_MS); return () => clearTimeout(t) }
    onTalk(false)
    if (!last) { const t = setTimeout(() => { setI(v => v + 1); setN(instant ? Infinity : 0) }, instant ? SENTENCE_GAP * 2.5 : SENTENCE_GAP); return () => clearTimeout(t) }
    onDone()
  }, [n, i, run, typed, last])
  return <div className={s.cap}>{cur.slice(0, n)}{!typed && <span className={s.cur} />}</div>
}

// A real site card, drawn at its native 340×476 and scaled to height h
const Slot = ({ h, children, i = 0, tilt = 0 }) => (
  <span className={s.slot} style={{ width: 340 * h / 476, height: h, '--d': `${i * 0.18}s`, '--r': `${tilt}deg` }}>
    <span className={s.slotIn} style={{ transform: `scale(${h / 476})` }}>{children}</span>
  </span>
)
const Stat = ({ l, v, sub, i, c }) => <div className={s.stat} style={{ '--d': `${0.25 * i + 0.4}s`, '--c': c || '#c9a24a' }}><small>{l}</small><b>{v}</b>{sub && <span>{sub}</span>}</div>

// Elo over a career (or a season): the line draws itself, the peak and tonight are marked
function EloChart({ pts, labels, peakIdx, color, note }) {
  const Wc = 860, Hc = 250, pad = 34
  const lo = Math.min(...pts), hi = Math.max(...pts), span = Math.max(hi - lo, 40)
  const x = i => pad + (i / Math.max(1, pts.length - 1)) * (Wc - pad * 2)
  const y = v => Hc - 22 - ((v - lo) / span) * (Hc - 56)
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const end = pts.length - 1
  return (
    <svg className={s.chart} viewBox={`0 0 ${Wc} ${Hc}`} aria-hidden="true">
      <defs><linearGradient id="fstArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".45" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {[0, 0.25, 0.5, 0.75, 1].map(f => <g key={f}><line x1={pad} x2={Wc - pad} y1={y(lo + span * f)} y2={y(lo + span * f)} className={s.grid} /><text x={4} y={y(lo + span * f) + 4} className={s.axis}>{r0(lo + span * f)}</text></g>)}
      {labels.map(([i, t]) => <g key={i}><line x1={x(i)} x2={x(i)} y1={20} y2={Hc - 22} className={s.grid} /><text x={x(i) + 4} y={Hc - 6} className={s.axis}>{t}</text></g>)}
      <path d={`${d}L${x(end)},${Hc - 22}L${x(0)},${Hc - 22}Z`} fill="url(#fstArea)" className={s.area} />
      <path d={d} pathLength="1" className={s.line} style={{ stroke: color }} />
      {peakIdx != null && peakIdx !== end && <g className={s.peak}><circle cx={x(peakIdx)} cy={y(pts[peakIdx])} r="6" /><text x={x(peakIdx)} y={y(pts[peakIdx]) - 12} textAnchor="middle">PEAK {r0(pts[peakIdx])}</text></g>}
      <g className={s.now}><circle cx={x(end)} cy={y(pts[end])} r="8" /><circle cx={x(end)} cy={y(pts[end])} r="8" className={s.ping} />
        <text x={x(end) - 12} y={y(pts[end]) - 14} textAnchor="end">{note} {r0(pts[end])}</text></g>
    </svg>
  )
}

// Paired bars: tonight against the season average
function VsBars({ rows, color }) {
  const mx = Math.max(...rows.flatMap(r => [r.a, r.b ?? 0]), 1)
  return (
    <div className={s.vsb}>
      {rows.map((r, i) => (
        <div key={r.l} className={s.vsRow} style={{ '--d': `${0.3 * i + 0.3}s` }}>
          <small>{r.l}</small>
          <span className={s.vsTrack}><i style={{ width: `${r.a / mx * 100}%`, background: r.c || color }} /><b>{r.fa ?? r.a}</b></span>
          {r.b != null && <span className={`${s.vsTrack} ${s.vsSea}`}><i style={{ width: `${r.b / mx * 100}%` }} /><b>{f1(r.b)}</b></span>}
        </div>
      ))}
      <div className={s.legend}><span><i style={{ background: color }} />Tonight</span><span><i className={s.legSea} />Season average</span></div>
    </div>
  )
}

function Splits({ p, S }) {
  const rows = [['FG', p.fg, p.fga, S && S.fga ? S.fg / S.fga : null], ['3PT', p.tp, p.tpa, S && S.tpa ? S.tp / S.tpa : null], ['FT', p.ft, p.fta, S && S.fta ? S.ft / S.fta : null]].filter(r => r[2])
  return (
    <div className={s.splits}>
      {rows.map(([l, m, a, sea], i) => (
        <div key={l} className={s.spRow} style={{ '--d': `${0.35 * i + 0.3}s` }}>
          <b>{l}</b><span className={s.spMade}>{m}<small>/{a}</small></span>
          <span className={s.spTrack}><i style={{ width: `${(m / a) * 100}%` }} />{sea != null && <u style={{ left: `${sea * 100}%` }} title="Season" />}</span>
          <strong>{Math.round((m / a) * 100)}%</strong>
          {sea != null && <em>season {Math.round(sea * 100)}%</em>}
        </div>
      ))}
    </div>
  )
}

function BoxView({ x, hi, kit, rows = 7 }) {
  const g = x.g
  return (
    <div className={s.bx}>{[x.win, x.lose].map(t => (
      <table key={t}>
        <caption><i style={{ background: kit.tColor(t) }} />{kit.tName(t).toUpperCase()}<b>{x.pts[t]}</b></caption>
        <thead><tr><th>Player</th><th data-m>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th data-x>FG</th><th>GMSC</th><th data-x>ELO ±</th></tr></thead>
        <tbody>{g.players.filter(p => p.t === t).sort((a, b) => b.gs - a.gs).slice(0, rows).map((p, i) => (
          <tr key={p.n} data-hi={hi.includes(p.n) ? '' : undefined} style={{ animationDelay: `${0.12 * i + 0.3}s` }}>
            <td><b>{bn(p.n)}</b></td><td data-m>{p.mp ?? '—'}</td><td><b>{p.pts}</b></td><td>{p.trb ?? '—'}</td><td>{p.ast ?? '—'}</td>
            <td data-x>{p.fga ? `${p.fg}-${p.fga}` : '—'}</td><td><b>{p.gs.toFixed(1)}</b></td><td data-x className={p.post >= p.pre ? s.up : s.dn}>{sgn(p.post - p.pre)}</td></tr>))}</tbody>
      </table>))}</div>
  )
}

function Tape({ a, b, kit, rows }) {
  return (
    <div className={s.tape}>
      <Slot h={300}>{kit.miniCard(a.g, a.p)}</Slot>
      <div className={s.tapeMid}>
        {rows.map(([l, va, vb, fa, fb], i) => {
          const mx = Math.max(Math.abs(va), Math.abs(vb), 1e-9)
          return (
            <div key={l} className={s.tRow} style={{ '--d': `${0.3 * i + 0.4}s` }}>
              <b data-w={va > vb ? '' : undefined}>{fa ?? va}</b>
              <span className={s.tL}><i style={{ width: `${va / mx * 100}%`, background: kit.tColor(a.p.t) }} /></span>
              <small>{l}</small>
              <span className={s.tR}><i style={{ width: `${vb / mx * 100}%`, background: kit.tColor(b.p.t) }} /></span>
              <b data-w={vb > va ? '' : undefined}>{fb ?? vb}</b>
            </div>
          )
        })}
      </div>
      <Slot h={300} i={1}>{kit.miniCard(b.g, b.p)}</Slot>
    </div>
  )
}

function Podium({ rows, kit }) {
  const order = [1, 0, 2].filter(i => rows[i])
  return (
    <div className={s.podium}>{order.map(i => { const { p, x, ns } = rows[i]; return (
      <div key={p.n} className={s.step} data-place={i + 1} style={{ '--d': `${(2 - i) * 0.9 + 0.3}s` }}>
        <Slot h={i === 0 ? 214 : 176}>{kit.miniCard(x.g, p)}</Slot>
        <div className={s.block}><b>{i + 1}</b><span>{bn(p.n)}</span><small>{ns.toFixed(1)} · {p.pts}-{p.trb ?? '—'}-{p.ast ?? '—'}</small></div>
      </div>) })}</div>
  )
}

// Live graphics read the newest numbers from context, so scores keep moving while the script stays put
const useLive = (k, snap) => useContext(LiveCtx)?.get(k) || snap
function LiveGrid({ live, kit, onOpen }) {
  const ctx = useContext(LiveCtx)
  return (
    <div className={s.scores} data-live>{live.map((x0, i) => { const { c, f } = ctx?.get(x0.c.key) || x0; const lv = c.g?.live || c.x || {}; const pl = f.pLiveHome; return (
      <button key={c.key} type="button" style={{ animationDelay: `${0.08 * i}s` }} onClick={() => c.g && onOpen(c.g)}>
        {[f.away, f.home].map(t => <span key={t} data-w={f.lead === t ? '' : undefined}><i style={{ background: kit.tColor(t) }} /><b>{kit.tCode(t)}</b><b>{f.pts[t] ?? 0}</b></span>)}
        <em data-l><u />{String(lv.detail || 'LIVE').toUpperCase()}{pl != null ? ` · ${kit.tCode(pl >= 0.5 ? f.home : f.away)} ${pct(Math.max(pl, 1 - pl))}` : ''}</em>
        {f.upset && <em>UPSET WATCH</em>}
      </button>) })}</div>
  )
}
function LiveBug({ k, snap, kit }) {
  const { c, f } = useLive(k, snap)
  const lv = c.g?.live || c.x || {}
  const { home, away, pts, wp, pLiveHome: pl } = f
  const proj = Array.isArray(f.liveProj) ? f.liveProj : null
  return (
    <div className={s.wpg}>
      {[away, home].map(t => <div key={t} className={s.wpRow}><span className={s.tm} style={{ '--c': kit.tColor(t) }}>{kit.tName(t).toUpperCase()}</span>
        <span className={s.sc} data-w={f.lead === t || !f.lead ? '' : undefined}>{pts[t] ?? 0}</span>
        {proj && <span className={s.lu}>Proj. <b>{t === home ? proj[0] : proj[1]}</b></span>}</div>)}
      <div className={s.liveTag}><u />LIVE · {String(lv.detail || '').toUpperCase()}</div>
      {wp && <><div className={s.wpLab}><span>{kit.tCode(away)} {pct(wp[away])}</span><span>PRE-GAME WIN CHANCE</span><span>{pct(wp[home])} {kit.tCode(home)}</span></div>
        <div className={s.wpBar} data-thin><i style={{ width: `${wp[away] * 100}%`, background: kit.tColor(away) }} /><i style={{ flex: 1, background: kit.tColor(home) }} /></div></>}
      {pl != null && <><div className={s.wpLab}><span>{kit.tCode(away)} {pct(1 - pl)}</span><span>LIVE WIN CHANCE</span><span>{pct(pl)} {kit.tCode(home)}</span></div>
        <div className={s.wpBar}><i style={{ width: `${(1 - pl) * 100}%`, background: kit.tColor(away), transition: 'width 1.2s' }} /><i style={{ flex: 1, background: kit.tColor(home) }} /></div></>}
      {f.upset && <div className={s.stamp} data-watch>UPSET WATCH</div>}
    </div>
  )
}
function LiveLines({ ps, kit, k }) {
  const cur = useContext(LiveCtx)?.get(k)
  const rows = ps.map(p => cur?.c.g?.players.find(q => q.n === p.n) || p)
  return (
    <div className={s.liveLines}>{rows.map((p, i) => (
      <div key={p.n} style={{ animationDelay: `${0.4 + i * 0.4}s` }}><b>{bn(p.n)}</b><small>{kit.tShort(p.t)} · so far</small>
        <span>{p.pts}<i>PTS</i></span><span>{p.trb ?? '—'}<i>REB</i></span><span>{p.ast ?? '—'}<i>AST</i></span><span>{p.gs.toFixed(1)}<i>GMSC</i></span></div>))}</div>
  )
}

// The night, read off the finals
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
  const careers = side.careerGames.map(m => ({ p: m.p, x: byId.get(m.g.id) })).filter(m => m.x)
  const cg = careers.find(m => !used.has(m.p.n))
  if (cg) used.add(cg.p.n)
  const mils = side.milestones.map(m => ({ p: m.p, x: byId.get(m.g.id), stamps: m.m.stamps })).filter(m => m.x)
  const mil = mils.map(m => ({ ...m, stamp: m.stamps.find(t => t.up && stampLine(t.text)) })).find(m => m.stamp && !used.has(m.p.n))
  const risers = [...all].sort((a, b) => (b.p.post - b.p.pre) - (a.p.post - a.p.pre))
  const pick = k => { const v = side.picks.find(x => x[2] === k)?.[1]; return v && byId.get(v.g.id) ? { ...v, x: byId.get(v.g.id) } : null }
  const margin = x => Math.abs(x.pts[x.win] - x.pts[x.lose])
  const ns = p => p.gs + (p.post - p.pre) / 6
  const podium = [...all].sort((a, b) => ns(b.p) - ns(a.p)).slice(0, 3).map(o => ({ ...o, ns: ns(o.p) }))
  // Each game's best duel and widest giant-slayer gap; the runner-up comes from a different game than the winner
  const duels = [], slayers = []
  for (const x of G) {
    const ps = x.g.players
    let d = null, sl = null
    for (const a of ps) for (const b of ps) {
      if (a.t !== b.t && a.n < b.n && a.gs >= 10 && b.gs >= 10 && (a.mp == null || a.mp >= 20) && (b.mp == null || b.mp >= 20)) {
        const sc = Math.min(a.gs, b.gs) * Math.min(a.pre, b.pre) / 2500
        if (!d || sc > d.sc) d = { a: a.gs >= b.gs ? a : b, b: a.gs >= b.gs ? b : a, sc, x }
      }
      if ((a.mp || 0) >= 12 && (b.mp || 0) >= 12 && a.gs >= 10 && a.gs > b.gs && b.pre > a.pre && (!sl || b.pre - a.pre > sl.gap)) sl = { a, b, gap: b.pre - a.pre, wc: 1 / (1 + 10 ** ((b.pre - a.pre) / 620)), x }
    }
    if (d) duels.push(d); if (sl) slayers.push(sl)
  }
  duels.sort((a, b) => b.sc - a.sc); slayers.sort((a, b) => b.gap - a.gap)
  const dd = pick('duel'), ss = pick('slayer')
  return { G, pd, ups, careers, podium, duel2: dd && duels.find(d => d.x.g.id !== dd.g.id), slayer2: ss && slayers.find(d => d.x.g.id !== ss.g.id), cg, mils, mil, risers, fallers: [...risers].reverse(), duel: pick('duel'), slayer: pick('slayer'),
    big: [...G].sort((a, b) => margin(b) - margin(a))[0] || null, close: [...G].sort((a, b) => margin(a) - margin(b))[0] || null,
    hi: G.flatMap(x => [x.win, x.lose].map(t => ({ t, v: x.pts[t] }))).sort((a, b) => b.v - a.v)[0] || null }
}

function buildShow(N, kit, seed, act, side, live) {
  const { tShort, tName, tColor, tCode } = kit
  const r = rng(seed)
  const segs = []
  const opp = (p, x) => x.g.teams.find(t => t !== p.t)
  const facts = (p, x) => {
    const S = kit.seasonOf(p.n), C = kit.career(p.n), won = x.win === p.t
    const ts = p.fga >= 5 ? Math.round(p.pts / (2 * (p.fga + 0.44 * (p.fta || 0))) * 100) : null
    const mates = x.g.players.filter(q => q.t === p.t && q.n !== p.n).sort((a, b) => b.pts - a.pts)
    const oppTop = x.g.players.filter(q => q.t !== p.t).sort((a, b) => b.pts - a.pts)[0]
    const peak = C?.peak_elo != null ? Math.max(C.peak_elo, p.post) : null
    return {
      name: bn(p.n), last: lastName(p.n), team: tShort(p.t), opp: tShort(opp(p, x)), pts: p.pts ?? null, reb: p.trb ?? null, ast: p.ast ?? null,
      stl: p.stl >= 2 ? p.stl : null, blk: p.blk >= 2 ? p.blk : null, mins: p.mp || null, pm: p.pm != null ? (p.pm > 0 ? `plus-${p.pm}` : p.pm < 0 ? `minus-${-p.pm}` : 'even') : null,
      gs: p.gs.toFixed(1), fg: p.fga ? p.fg : null, fga: p.fga || null, fgline: p.fga ? `${p.fg} of ${p.fga}` : null, fgpct: p.fga >= 5 ? `${Math.round(p.fg / p.fga * 100)}%` : null,
      tpline: p.tpa >= 3 ? `${p.tp} of ${p.tpa} from three` : null, ftline: p.fta >= 3 ? `${p.ft} of ${p.fta}` : null, ts: ts ? `${ts}%` : null,
      delta: Math.abs(p.post - p.pre).toFixed(1), up: p.post >= p.pre ? 'up' : 'down', pre: r0(p.pre), post: r0(p.post),
      rank: p.lrp != null && p.lrp <= 150 ? p.lrp : null, prev: p.lr != null && p.lr <= 300 ? p.lr : null, ns: (p.gs + (p.post - p.pre) / 6).toFixed(1),
      rv: won ? 'beat' : 'fell to', rn: won ? 'win' : 'loss', score: `${x.pts[x.win]}–${x.pts[x.lose]}`,
      spts: S ? f1(S.pts) : null, sreb: S ? f1(S.trb) : null, sast: S ? f1(S.ast) : null, sgs: S ? f1(S.gs) : null, gp: S?.gp ?? null,
      ptsOver: S && p.pts - S.pts >= 3 ? `${Math.round(p.pts - S.pts)} points` : null,
      peak: peak ? r0(peak) : null, peakGap: peak && peak - p.post >= 5 ? r0(peak - p.post) : null, newPeak: peak && p.post >= peak ? '' : null,
      cgames: C?.games_played || null, cgs: C?.career_gmsc_avg != null ? f1(C.career_gmsc_avg) : null,
      tmName: mates[0] && mates[0].pts >= 10 ? bn(mates[0].n) : null, tmPts: mates[0]?.pts ?? null, oppTop: oppTop ? bn(oppTop.n) : null, oppPts: oppTop?.pts ?? null,
    }
  }
  const card = (p, x, h, i, tilt) => <Slot h={h} i={i} tilt={tilt}>{kit.miniCard(x.g, p)}</Slot>
  // Career Elo (or this season's, before the histories arrive), ending on tonight
  const chartFor = (p, x) => {
    const C = kit.career(p.n), H = C?.elo_history
    const day = x.g.date
    if (H?.length > 5) {
      let pts = H.filter(e => e[0] < day).map(e => e[1]); pts.push(p.post)
      let dates = H.filter(e => e[0] < day).map(e => e[0]); dates.push(day)
      const step = Math.ceil(pts.length / 420)
      if (step > 1) { const keep = (v, i) => i % step === 0 || i === pts.length - 1; pts = pts.filter(keep); dates = dates.filter(keep) }
      const labels = []; let lastY = null
      dates.forEach((d, i) => { const yv = +d.slice(0, 4) + (+d.slice(5, 7) >= 9 ? 1 : 0); if (yv !== lastY) { lastY = yv; labels.push([i, `’${String(yv).slice(2)}`]) } })
      const every = Math.ceil(labels.length / 9)
      const peakIdx = pts.indexOf(Math.max(...pts))
      return { kind: 'career', node: <EloChart pts={pts} labels={labels.filter((_, i) => i % every === 0)} peakIdx={peakIdx} color={tColor(p.t)} note="TONIGHT" />,
        right: `${(C.games_played || pts.length).toLocaleString()} games · peak ${r0(Math.max(...pts))}` }
    }
    const S = kit.seasonOf(p.n)
    if (S && S.path.length > 2) {
      const pts = [...S.path, p.post]
      const labels = S.dates.map((d, i) => [i + 1, d]).filter((_, i, a) => i === 0 || a[i][1].slice(5, 7) !== a[i - 1][1].slice(5, 7))
        .map(([i, d]) => [i, new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' }).toUpperCase()])
      return { kind: 'season', node: <EloChart pts={pts} labels={labels} peakIdx={pts.indexOf(Math.max(...pts))} color={tColor(p.t)} note="TONIGHT" />, right: `${S.gp + 1} games this season` }
    }
    return null
  }
  const chartBeat = (p, x, v) => {
    const c = chartFor(p, x)
    if (!c) return null
    return { gfx: true, head: [c.kind === 'career' ? 'Career Elo' : 'Season Elo', bn(p.n), c.right], view: <div className={s.chartWrap}>{c.node}</div>,
      line: say(c.kind === 'career' ? B.career : B.seasonGraph, v, r), go: () => act.card(x.g, p) }
  }
  const vsBeat = (p, x, v, banks, head) => {
    const S = kit.seasonOf(p.n)
    if (!S) return null
    return { gfx: true, head, go: () => act.card(x.g, p),
      view: <div className={s.split2}>{card(p, x, 300)}<VsBars color={tColor(p.t)} rows={[{ l: 'Points', a: p.pts, b: S.pts }, { l: 'Rebounds', a: p.trb ?? 0, b: S.trb }, { l: 'Assists', a: p.ast ?? 0, b: S.ast }, { l: 'Game Score', a: p.gs, fa: p.gs.toFixed(1), b: S.gs }]} /></div>,
      line: say(banks, v, r) }
  }
  const heroBeat = (p, x, v, banks, head) => ({ gfx: true, head, go: () => act.card(x.g, p),
    view: <div className={s.split2}>{card(p, x, 330)}<div className={s.stats}>
      <Stat l="Points" v={p.pts} sub={p.fga ? `${p.fg}-${p.fga} FG${p.tpa ? ` · ${p.tp}-${p.tpa} 3PT` : ''}` : null} i={0} />
      <Stat l="Rebounds" v={p.trb ?? '—'} i={1} /><Stat l="Assists" v={p.ast ?? '—'} i={2} />
      <Stat l="Game Score" v={p.gs.toFixed(1)} sub={p.mp ? `${p.mp} minutes` : null} i={3} c="#ffd34d" />
      <Stat l="Elo" v={sgn(p.post - p.pre)} sub={`${r0(p.pre)} → ${r0(p.post)}`} i={4} c="#6bff95" />
      <Stat l="League rank" v={p.lrp != null ? `#${p.lrp}` : '—'} sub={p.lr != null ? `from #${p.lr}` : null} i={5} c="#7ef0ff" />
    </div></div>, line: say(banks, v, r) })
  const boxBeat = (x, hi, v, banks, head) => ({ gfx: true, head, go: () => act.box(x.g), view: <BoxView x={x} hi={hi} kit={kit} />, line: say(banks, v, r) })
  const anchor = (ots, lab, line, go) => ({ ots, lab, line, go })
  const seg = (id, title, beats, banksAll) => { const b = beats.filter(Boolean); if (b.length) segs.push({ id, title, beats: b, takes: banksAll }) }
  const tk = obj => Object.values(obj).filter(Array.isArray).reduce((n, b) => n * combos(b), 1)
  const tkL = b => combos(b)

  // A live look-in: the scorebug with pre-game and live win chances, then who's leading the box so far
  function liveSeg({ c, f }) {
    const { home, away, pts } = f
    const lv = c.g?.live || c.x || {}
    const hs = pts[home] ?? 0, as = pts[away] ?? 0
    const leader = hs === as ? null : hs > as ? home : away, trailer = leader && (leader === home ? away : home)
    const pl = f.pLiveHome, liveLead = pl == null ? null : pl >= 0.5 ? home : away
    const per = lv.period || 0
    const proj = Array.isArray(f.liveProj) ? f.liveProj : null
    const v = { away: tShort(away), home: tShort(home), leader: leader && tShort(leader), trailer: trailer && tShort(trailer),
      leadScore: leader ? `${Math.max(hs, as)}–${Math.min(hs, as)}` : null, margin: leader ? Math.abs(hs - as) : null, tieScore: leader ? null : hs, clock: clockText(lv),
      fav: f.wp ? tShort(f.fav) : null, favPct: f.wp ? pct(f.wp[f.fav]) : null, liveLead: liveLead && tShort(liveLead), livePct: pl == null ? null : pct(Math.max(pl, 1 - pl)),
      uw: f.upset ? '' : null, projLine: proj ? `${tShort(proj[0] >= proj[1] ? home : away)} ${Math.max(...proj)}, ${tShort(proj[0] >= proj[1] ? away : home)} ${Math.min(...proj)}` : null,
      early: per && per <= 2 && !f.upset ? '' : null, late: per >= 4 && Math.abs(hs - as) <= 6 ? '' : null, safe: pl != null && Math.max(pl, 1 - pl) >= 0.9 && liveLead === f.fav ? '' : null }
    const ps = c.g ? [...c.g.players].filter(p => p.gs != null).sort((a, b) => b.gs - a.gs) : []
    const t1 = ps[0], t2 = t1 && ps.find(p => p.t !== t1.t)
    Object.assign(v, t1 ? { t1: bn(t1.n), t1pts: t1.pts, t1reb: t1.trb ?? null, t1ast: t1.ast ?? null, t1gs: t1.gs.toFixed(1), t1team: tShort(t1.t) } : {},
      t2 ? { t2: bn(t2.n), t2pts: t2.pts, t2gs: t2.gs.toFixed(1), t2team: tShort(t2.t) } : {})
    const title = `Live: ${tCode(away)} at ${tCode(home)}`
    const open = c.g ? () => act.box(c.g) : null
    return { id: `live-${c.key}`, title, live: true, takes: combos(L.intro) * combos(L.bug) * combos(L.box), beats: [
      anchor(<span className={s.miniBug}>{[away, home].map(t => <span key={t}><i style={{ background: tColor(t) }} /><b>{tCode(t)}</b><strong>{pts[t] ?? 0}</strong></span>)}<em><u />LIVE</em></span>, 'Live look-in', say(L.intro, v, r), open),
      { gfx: true, head: ['Live', tCode(away) + ' @ ' + tCode(home), String(lv.detail || '')], view: <LiveBug k={c.key} snap={{ c, f }} kit={kit} />, line: say(L.bug, v, r), go: open },
      t1 && t2 && { gfx: true, head: ['Leaders so far', 'Live', `${tShort(away)} at ${tShort(home)}`], go: open,
        view: <div className={s.tape}><Slot h={250}>{kit.miniCard(c.g, t1)}</Slot><LiveLines ps={[t1, t2]} kit={kit} k={c.key} /><Slot h={250} i={1}>{kit.miniCard(c.g, t2)}</Slot></div>, line: say(L.box, v, r) },
    ].filter(Boolean) }
  }

  // 1 · Open
  const n = N.G.length, u = N.ups.length
  const bigM = N.big ? Math.abs(N.big.pts[N.big.win] - N.big.pts[N.big.lose]) : 0, closeM = N.close ? Math.abs(N.close.pts[N.close.win] - N.close.pts[N.close.lose]) : 0
  const ln = live.length
  const ov = n === 0 ? { liveTxt: ln === 1 ? 'one game' : `${ln} games`, liveAre: ln === 1 ? 'is' : 'are', liveIs: ln === 1 ? 'is' : 'are', cardCount: null, potd: null } : {
    liveTxt: ln ? (ln === 1 ? 'one game' : `${ln} games`) : null, liveAre: ln === 1 ? 'is' : 'are', liveIs: ln === 1 ? 'is' : 'are',
    slate: n === 1 ? 'one game' : `${n} games`, gamesN: n > 1 ? n : null, upsets: u ? (u === 1 ? 'one upset' : `${u} upsets`) : null, times: u ? (u === 1 ? 'once' : `${u} times`) : null, chalk: u ? null : '',
    bigW: n > 1 ? tShort(N.big.win) : null, bigL: tShort(N.big.lose), bigM, bigScore: `${N.big.pts[N.big.win]}–${N.big.pts[N.big.lose]}`,
    closeW: n > 2 ? tShort(N.close.win) : null, closeL: tShort(N.close.lose), closeM: closeM === 1 ? 'a single point' : `${closeM} points`, closeScore: `${N.close.pts[N.close.win]}–${N.close.pts[N.close.lose]}`,
    closeOT: N.close.g.ot ? ` in ${N.close.g.ot === 'OT' ? 'overtime' : N.close.g.ot}` : '', hiW: tShort(N.hi.t), hiPts: N.hi.v,
    potd: N.pd ? bn(N.pd.p.n) : null, cardCount: side.picks.length > 2 ? side.picks.length : null,
  }
  const fanView = picks => <div className={s.fan}>{picks.map(([label, v, kind], i) => (
    <span key={label} className={s.fanItem} style={{ '--d': `${0.25 * i + 0.2}s` }}>
      <Slot h={picks.length > 4 ? 226 : 250} tilt={(i - (picks.length - 1) / 2) * 4}>{kind ? kit.duelCard(kind, v) : kit.miniCard(v.g, v.p)}</Slot><small>{label}</small></span>))}</div>
  const liveBoard = ln > 0 && { gfx: true, head: ['Live right now', 'In progress', `${ln} game${ln === 1 ? '' : 's'}`], view: <LiveGrid live={live} kit={kit} onOpen={act.live} />, line: say(L.board, ov, r) }
  if (!n) seg('open', 'Tonight’s games', [
    anchor(<><span className={s.big2}>{ln}</span><span className={s.big2l}>LIVE</span></>, 'In progress', say([OPENERS, ['No finals yet, but there’s plenty going on.', 'The night is still young.', 'Nothing’s final yet, so let’s go around the league.']], ov, r)),
    liveBoard,
  ], combos(OPENERS) * tkL(L.board))
  else seg('open', 'Tonight’s finals', [
    anchor(<><span className={s.big2}>{n}</span><span className={s.big2l}>FINAL{n === 1 ? '' : 'S'}</span></>, 'All final', say(B.open.intro, ov, r)),
    { gfx: true, head: ['Around the league', 'Final'], view: <div className={s.scores}>{N.G.map((x, i) => (
      <button key={x.g.id} type="button" style={{ animationDelay: `${0.08 * i}s` }} onClick={() => act.box(x.g)}>
        {[x.away, x.home].map(t => <span key={t} data-w={t === x.win ? '' : undefined}><i style={{ background: tColor(t) }} /><b>{tCode(t)}</b><b>{x.pts[t]}</b></span>)}
        {x.f.upset && x.f.wp ? <em>UPSET · {pct(x.f.wp[x.win])}</em> : <em data-q>FINAL{x.g.ot ? `/${x.g.ot}` : ''}</em>}
      </button>))}</div>, line: say(B.open.scores, ov, r) },
    liveBoard,
    side.picks.length > 1 && { gfx: true, head: ['Cards of the Day', 'Tonight'], view: fanView(side.picks), line: say(B.open.fan, ov, r) },
  ], tk(B.open))

  // 2 · Player of the Day
  if (N.pd) {
    const { p, x } = N.pd, v = facts(p, x)
    seg('potd', 'Player of the Day', [
      anchor(card(p, x, 196), 'Player of the Day', say(B.potd.intro, v, r), () => act.card(x.g, p)),
      heroBeat(p, x, v, B.potd.hero, ['Player of the Day', 'Top performer', `${tShort(p.t)} vs ${tShort(opp(p, x))}`]),
      N.podium.length >= 3 && N.podium[0].p === p && (() => {
        const [a1, a2, a3] = N.podium, line = q => `${q.p.pts} points, ${q.p.trb ?? 0} rebounds and ${q.p.ast ?? 0} assists`
        const gap = a1.ns - a2.ns
        const pv = { n1: bn(a1.p.n), s1: a1.ns.toFixed(1), n2: bn(a2.p.n), s2: a2.ns.toFixed(1), p2line: line(a2), o2: tShort(opp(a2.p, a2.x)), n3: bn(a3.p.n), s3: a3.ns.toFixed(1), p3line: line(a3), o3: tShort(opp(a3.p, a3.x)),
          gap12: gap.toFixed(1), tight: gap < 3 ? '' : null, wide: gap >= 10 ? '' : null }
        return { gfx: true, head: ['The podium', 'Player of the Day', 'Game Score + Elo gain ÷ 6'], view: <Podium rows={N.podium} kit={kit} />, line: say(RU.podium, pv, r) }
      })(),
      p.fga ? { gfx: true, head: ['Shooting', bn(p.n), p.fga >= 5 ? `${Math.round(p.pts / (2 * (p.fga + 0.44 * (p.fta || 0))) * 100)}% true shooting` : ''],
        view: <div className={s.split2}>{card(p, x, 300)}<Splits p={p} S={kit.seasonOf(p.n)} /></div>, line: say(B.potd.shoot, v, r), go: () => act.card(x.g, p) } : null,
      chartBeat(p, x, v),
      boxBeat(x, [p.n], v, B.box, ['The box score', 'Final', `${tShort(x.win)} ${x.pts[x.win]}, ${tShort(x.lose)} ${x.pts[x.lose]}`]),
    ], tk(B.potd) * combos(B.career) * combos(B.box))
  }

  // 3 · Upset
  if (N.ups[0]) {
    const x = N.ups[0], g = x.g, wp = x.f.wp
    const top = t => [...g.players].filter(p => p.t === t).sort((a, b) => b.pts - a.pts)[0]
    const w = top(x.win), l = top(x.lose)
    const star = [...g.players].filter(p => p.t === x.win).sort((a, b) => b.gs - a.gs)[0]
    const eloW = g.elo?.[x.win]?.pre, eloL = g.elo?.[x.lose]?.pre
    const v = { win: tShort(x.win), lose: tShort(x.lose), chance: pct(wp[x.win]), fav: pct(wp[x.lose]), score: `${x.pts[x.win]}–${x.pts[x.lose]}`,
      oneIn: wp[x.win] < 0.34 ? Math.round(1 / wp[x.win]) : null, margin: (m => (m === 1 ? 'a single point' : `${m}`))(x.pts[x.win] - x.pts[x.lose]),
      otTail: g.ot ? ` in ${g.ot === 'OT' ? 'overtime' : g.ot}` : '', wtop: w && bn(w.n), wpts: w?.pts, ltop: l && bn(l.n), lpts: l?.pts,
      winElo: eloW ? r0(eloW) : null, loseElo: eloL ? r0(eloL) : null, eloGap: eloW && eloL && eloL > eloW ? r0(eloL - eloW) : null }
    seg('upset', 'Upset alert', [
      anchor(<><span className={s.big2}>{pct(wp[x.win])}</span><span className={s.big2l}>{tCode(x.win)} PRE-GAME</span></>, 'Upset alert', say(B.upset.intro, v, r), () => act.box(g)),
      { gfx: true, head: ['Upset alert', 'Final', `${tShort(x.away)} at ${tShort(x.home)}`], go: () => act.box(g), view: <><div className={s.wpg}>
        {[x.away, x.home].map(t => <div key={t} className={s.wpRow}><span className={s.tm} style={{ '--c': tColor(t) }}>{tName(t).toUpperCase()}</span><span className={s.sc} data-w={t === x.win ? '' : undefined}>{x.pts[t]}</span></div>)}
        <div className={s.wpLab}><span>{tCode(x.away)} {pct(wp[x.away])}</span><span>PRE-GAME WIN CHANCE</span><span>{pct(wp[x.home])} {tCode(x.home)}</span></div>
        <div className={s.wpBar}><i style={{ width: `${wp[x.away] * 100}%`, background: tColor(x.away) }} /><i style={{ flex: 1, background: tColor(x.home) }} /></div>
      </div><div className={s.stamp}>UPSET</div></>, line: say(B.upset.wp, v, r) },
      v.eloGap && { gfx: true, head: ['The lineups', 'Elo', `${v.eloGap} points apart`], go: () => act.box(g),
        view: <VsBars color={tColor(x.win)} rows={[x.win, x.lose].map(t => ({ l: `${tName(t)} lineup`, a: Math.max(1, g.elo[t].pre - Math.min(eloW, eloL) + 120), fa: r0(g.elo[t].pre), c: t === x.win ? '#ffd34d' : '#d6223a' }))} />, line: say(B.upset.lineup, v, r), noLegend: true },
      w && l && boxBeat(x, [w.n, l.n], v, B.upset.box, ['The box score', 'Final', `${tShort(x.win)} ${x.pts[x.win]}, ${tShort(x.lose)} ${x.pts[x.lose]}`]),
      star && heroBeat(star, x, facts(star, x), B.upset.hero, ['Upset star', tCode(x.win), bn(star.n)]),
      N.ups.length > 1 && (() => {
        const [, u2, u3] = N.ups
        const uv = { u2w: tShort(u2.win), u2l: tShort(u2.lose), u2c: pct(u2.f.wp[u2.win]), u2s: `${u2.pts[u2.win]}–${u2.pts[u2.lose]}`,
          u3w: u3 ? tShort(u3.win) : null, u3l: u3 ? tShort(u3.lose) : null, u3c: u3 ? pct(u3.f.wp[u3.win]) : null, upN: N.ups.length > 2 ? N.ups.length : null }
        return { gfx: true, head: ['More upsets', 'Final', `${N.ups.length} tonight`], view: <div className={s.list}>{N.ups.map((y, i) => (
          <button key={y.g.id} type="button" style={{ animationDelay: `${0.25 * i + 0.3}s` }} onClick={() => act.box(y.g)} data-first={i === 0 ? '' : undefined}>
            <span className={s.upPct}>{pct(y.f.wp[y.win])}</span><b>{tName(y.win)}</b><small>over {tCode(y.lose)}</small>
            <em className={s.upBar}><i style={{ width: `${y.f.wp[y.win] * 100}%` }} /><span>{y.pts[y.win]}–{y.pts[y.lose]}{y.g.ot ? ` ${y.g.ot}` : ''}</span></em></button>))}</div>,
          line: say(RU.upsets, uv, r) }
      })(),
    ], tk(B.upset))
  }

  // 4 · Career game
  if (N.cg) {
    const { p, x } = N.cg, v = facts(p, x)
    const others = N.careers.filter(m => m.p.n !== p.n)
    v.careerN = N.careers.length > 1 ? N.careers.length : null
    if (others[0]) Object.assign(v, { c2: bn(others[0].p.n), c2gs: others[0].p.gs.toFixed(1) })
    seg('career', 'Career night', [
      anchor(card(p, x, 196), 'Career game ★', say(B.careerGame.intro, v, r), () => act.card(x.g, p)),
      heroBeat(p, x, v, B.careerGame.hero, ['Career game', '★', `${tShort(p.t)} vs ${tShort(opp(p, x))}`]),
      vsBeat(p, x, v, B.careerGame.vs, ['Tonight vs his season', '★', bn(p.n)]),
      chartBeat(p, x, v),
      others.length > 0 && { gfx: true, head: ['Career games', '★', `${N.careers.length} tonight`],
        view: <div className={s.fan}>{N.careers.slice(0, 5).map((m, i) => <span key={m.p.n} className={s.fanItem} style={{ '--d': `${0.25 * i + 0.2}s` }}>{card(m.p, m.x, Math.min(N.careers.length, 5) > 4 ? 226 : 250, 0, (i - 2) * 3)}<small>★ {m.p.gs.toFixed(1)} GMSC</small></span>)}</div>,
        line: say(B.careerGame.list, v, r) },
    ], tk(B.careerGame) * combos(B.career))
  }

  // 5 · Milestone
  if (N.mil) {
    const { p, x, stamp } = N.mil
    const v = { ...facts(p, x), jump: p.lr != null && p.lrp != null && p.lr > p.lrp ? p.lr - p.lrp : null, stamp: stampLine(stamp.text), milN: N.mils.length > 1 ? N.mils.length : null }
    if (!(p.lr > p.lrp)) { v.prev = null; v.rank = null }
    seg('climb', 'Milestone', [
      anchor(<><span className={s.big2}>#{p.lrp}</span><span className={s.big2l}>{lastName(p.n).toUpperCase()}</span></>, 'Milestone ◆', say(B.milestone.intro, v, r), () => act.card(x.g, p)),
      { gfx: true, head: ['Milestone', '◆', bn(p.n)], go: () => act.card(x.g, p), view: <div className={s.split2}>{card(p, x, 300)}<div className={s.rank}>
        {p.lr != null && p.lr !== p.lrp && <><span className={s.from}>#{p.lr}</span><span className={s.arrow}>→</span></>}<span className={s.to}>#{p.lrp}</span>
        <span className={s.stamps}>{N.mil.stamps.map((t, i) => <span key={t.text} className={s.tierB} data-down={t.up ? undefined : ''} style={{ animationDelay: `${1.1 + i * 0.3}s` }}>{t.text.toUpperCase()}</span>)}</span></div></div>,
        line: say(B.milestone.rank, v, r) },
      chartBeat(p, x, v),
      N.mils.length > 1 && { gfx: true, head: ['Milestones', '◆', `${N.mils.length} tonight`], view: <div className={s.list}>{N.mils.slice(0, 7).map((m, i) => (
        <button key={m.p.n} type="button" style={{ animationDelay: `${0.2 * i + 0.3}s` }} onClick={() => act.card(m.x.g, m.p)}><span className={s.dia}>◆</span><b>{bn(m.p.n)}</b><small>{tCode(m.p.t)}</small><em>{m.stamps.map(t => t.text).join(' · ')}</em></button>))}</div>,
        line: say(B.milestone.list, v, r) },
    ], tk(B.milestone) * combos(B.career))
  }

  // 6 · Elo movers
  const R = N.risers[0], F = N.fallers[0]
  if (R && F && R.p !== F.p) {
    const rows = [...N.risers.slice(0, 3), ...N.fallers.slice(0, 2)]
    const mx = Math.max(R.p.post - R.p.pre, F.p.pre - F.p.post, 1)
    seg('movers', 'Elo movers', [
      anchor(card(R.p, R.x, 196), 'Elo movers', say(B.movers.bars, { rname: bn(R.p.n), rdelta: f1(R.p.post - R.p.pre), fname: bn(F.p.n), fdelta: f1(F.p.pre - F.p.post) }, r)),
      { gfx: true, head: ['Elo movers', 'Risers & fallers', 'Tonight'], view: <div className={s.movers}>{rows.map(({ p, x }, i) => { const d = p.post - p.pre; return (
        <button key={p.n + i} type="button" className={s.mv} onClick={() => act.card(x.g, p)} style={{ animationDelay: `${0.25 * i + 0.2}s` }}><span><b>{kit.shortName(p.n)}</b><small>{tCode(p.t)} · {r0(p.pre)} → {r0(p.post)}</small></span>
          <span className={s.mvBar}><i style={{ left: `${d >= 0 ? 50 : 50 - Math.abs(d) / mx * 50}%`, width: `${Math.abs(d) / mx * 50}%`, background: d >= 0 ? '#2fae5c' : '#d6223a', animationDelay: `${0.25 * i + 0.4}s` }} /><i className={s.mid} /></span>
          <strong className={d >= 0 ? s.up : s.dn}>{sgn(d)}</strong></button>) })}</div>,
        line: say([['The full board.', 'Here are the top three risers and the two biggest fallers.', 'Up top, the gainers. Down below, the drops.'],
          ['{r2} was next, up {r2d}, followed by {r3} at {r3d}.', 'Behind him, {r2} gained {r2d} and {r3} gained {r3d}.', '{r2} finished second among the risers at {r2d}.', '{f2} had the second-biggest drop, {f2d}.'], ['Big nights against highly rated opponents are what move the needle.', 'Elo rewards production against good competition.', 'Every one of these swings came from a single game.']], { r2: N.risers[1] && bn(N.risers[1].p.n), r2d: N.risers[1] && f1(N.risers[1].p.post - N.risers[1].p.pre),
          r3: N.risers[2] && bn(N.risers[2].p.n), r3d: N.risers[2] && f1(N.risers[2].p.post - N.risers[2].p.pre), f2: N.fallers[1] && bn(N.fallers[1].p.n), f2d: N.fallers[1] && f1(N.fallers[1].p.pre - N.fallers[1].p.post) }, r) },
      heroBeat(R.p, R.x, facts(R.p, R.x), B.movers.riser, ['Top riser', sgn(R.p.post - R.p.pre), bn(R.p.n)]),
      chartBeat(R.p, R.x, facts(R.p, R.x)),
      heroBeat(F.p, F.x, facts(F.p, F.x), B.movers.faller, ['Biggest faller', sgn(F.p.post - F.p.pre), bn(F.p.n)]),
    ], tk(B.movers) * combos(B.career))
  }

  // 7 · Duel and 8 · Giant-Slayer
  const pair = (kind, D, banks, title, R2) => {
    const { a, b, x } = D, A = { p: a, g: x.g }, Bp = { p: b, g: x.g }
    const v = { a: bn(a.n), b: bn(b.n), alast: lastName(a.n), ag: a.gs.toFixed(1), bg: b.gs.toFixed(1), apts: a.pts, bpts: b.pts, apre: r0(a.pre), bpre: r0(b.pre),
      ateam: tShort(a.t), bteam: tShort(b.t), gap: D.gap ? r0(D.gap) : null, chance: D.wc != null ? pct(D.wc) : null, score: `${x.pts[x.win]}–${x.pts[x.lose]}`, winT: tShort(x.win) }
    const rowsT = [['PRE-GAME ELO', a.pre, b.pre, r0(a.pre), r0(b.pre)], ['GAME SCORE', a.gs, b.gs, a.gs.toFixed(1), b.gs.toFixed(1)], ['POINTS', a.pts, b.pts], ['REBOUNDS', a.trb ?? 0, b.trb ?? 0], ['ASSISTS', a.ast ?? 0, b.ast ?? 0],
      ...(a.fga && b.fga ? [['FG%', a.fg / a.fga, b.fg / b.fga, `${Math.round(a.fg / a.fga * 100)}%`, `${Math.round(b.fg / b.fga * 100)}%`]] : []), ['ELO ±', Math.max(0, a.post - a.pre), Math.max(0, b.post - b.pre), sgn(a.post - a.pre), sgn(b.post - b.pre)]]
    seg(kind, title, [
      anchor(<Slot h={196}>{kit.duelCard(kind, D)}</Slot>, title, say(banks.intro, v, r), () => act.card(x.g, a)),
      { gfx: true, head: [title, kind === 'duel' ? 'Head to head' : 'Long odds', `${tShort(a.t)} vs ${tShort(b.t)}`], go: () => act.card(x.g, a),
        view: <div className={s.vs}><Slot h={340}>{kit.duelCard(kind, D)}</Slot>
          <div className={s.vsSide}>{kind === 'slayer' ? <><b>{pct(D.wc)}</b><small>CHANCE OF WINNING THE MATCHUP</small><em>{r0(D.gap)} Elo apart</em></> : <><b>{a.gs.toFixed(1)}<i>–</i>{b.gs.toFixed(1)}</b><small>GAME SCORE</small><em>Duel score {(Math.min(a.gs, b.gs) * Math.min(a.pre, b.pre) / 2500).toFixed(1)}</em></>}</div></div>,
        line: say(banks.card, v, r) },
      { gfx: true, head: ['Tale of the tape', kind === 'duel' ? 'Duel' : 'Giant-Slayer', bn(a.n) + ' · ' + bn(b.n)], go: () => act.box(x.g), view: <Tape a={A} b={Bp} kit={kit} rows={rowsT} />, line: say(banks.tape, v, r) },
      banks.box && boxBeat(x, [a.n, b.n], v, banks.box, ['The box score', 'Final', `${tShort(x.win)} ${x.pts[x.win]}, ${tShort(x.lose)} ${x.pts[x.lose]}`]),
      R2 && (() => {
        const rv = { ra: bn(R2.a.n), rb: bn(R2.b.n), rag: R2.a.gs.toFixed(1), rbg: R2.b.gs.toFixed(1), rateam: tShort(R2.a.t), rbteam: tShort(R2.b.t), rgap: R2.gap ? r0(R2.gap) : null, rchance: R2.wc != null ? pct(R2.wc) : null }
        return { gfx: true, head: [kind === 'duel' ? 'Runner-up duel' : 'Runner-up giant-slayer', '2nd', `${tShort(R2.a.t)} vs ${tShort(R2.b.t)}`], go: () => act.box(R2.x.g),
          view: <div className={s.vs}><Slot h={290}>{kit.miniCard(R2.x.g, R2.a)}</Slot>
            <div className={s.vsSide}>{kind === 'slayer' ? <><b>{pct(R2.wc)}</b><small>CHANCE</small><em>{r0(R2.gap)} Elo apart</em></> : <><b>{R2.a.gs.toFixed(1)}<i>–</i>{R2.b.gs.toFixed(1)}</b><small>GAME SCORE</small><em>Duel score {R2.sc.toFixed(1)} · winner {D.score != null ? D.score.toFixed(1) : ''}</em></>}</div>
            <Slot h={290} i={1}>{kit.miniCard(R2.x.g, R2.b)}</Slot></div>,
          line: say(kind === 'duel' ? RU.duel : RU.slayer, rv, r) }
      })(),
    ], tk(banks))
  }
  if (N.duel) pair('duel', N.duel, B.duel, 'Duel of the Day', N.duel2)
  if (N.slayer) pair('slayer', N.slayer, B.slayer, 'Giant-Slayer', N.slayer2)

  // Live look-ins woven through: after every other segment, one in-progress game at a time
  if (ln) {
    const looks = live.map(x => liveSeg(x)).filter(Boolean)
    if (looks.length) {
      const out = [segs[0]]
      let k = 0
      segs.slice(1).forEach((x, i) => { out.push(x); if (i % 2 === 0) { out.push({ ...looks[k % looks.length], id: `${looks[k % looks.length].id}-${k}` }); k++ } })
      if (segs.length === 1) out.push(...looks)
      segs.length = 0; segs.push(...out)
    }
  }

  // 9 · Sign-off
  seg('close', 'Sign-off', [
    side.picks.length > 1 ? { gfx: true, head: ['Cards of the Day', 'One more look'], view: fanView(side.picks), line: say(B.close.fan, ov, r) } : null,
    anchor(<span className={s.wordmark}><i>FS</i>TONIGHT</span>, 'FanSided Tonight', say(ln ? [['We’ll keep watching the games still going.', 'There’s still basketball being played, so keep the TVs on.', 'The live games are on the wall.'], ...B.close.end] : B.close.end, ov, r)),
  ], tk(B.close))
  return segs
}

export default function FanSidedTonight({ kit, day, finals, live = [], side, shots, phone, openBox, openCard, liveN, onLive }) {
  const hv = useCareerHistory(true)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2e9) + 1)
  const sig = finals.map(x => x.c.g.id + x.c.g.pts.join('-')).join('|')
  const act = { box: g => openBox(g), card: (g, p) => openCard(g, p), live: g => openBox(g) }
  // The script is rewritten when a game ends or a new one tips; live scores update inside the graphics
  const liveSig = live.map(x => x.c.key).join('|')
  const liveMap = useMemo(() => new Map(live.map(x => [x.c.key, x])), [live])
  const segs = useMemo(() => buildShow(buildNight({ finals, side }), kit, seed, act, side, live), [sig, liveSig, seed, shots, hv])
  const [seg, setSeg] = useState(0)
  const [beat, setBeat] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [visible, setVisible] = useState(true)
  const [talk, setTalk] = useState(false)
  const [wipe, setWipe] = useState(0)
  const [k, setK] = useState(phone ? 0.5 : 0.8)
  const box = useRef(null)
  const timers = useRef([])
  const reduce = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const [Wd, Ht] = phone ? SIZE.phone : SIZE.desk
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms))
  const si = Math.min(seg, segs.length - 1)
  // The segment on air stays as written until it ends, even if the rundown is rebuilt underneath it
  const fz = useRef({ k: null, S: null })
  if (fz.current.k !== `${si}|${seed}`) fz.current = { k: `${si}|${seed}`, S: segs[si] }
  const S = fz.current.S || segs[si]
  const bi = Math.min(beat, S.beats.length - 1)
  const Bt = S.beats[bi]
  // Next beat within a segment cuts straight over; a new segment gets the FanSided wipe
  const go = (i, b = 0) => {
    clear()
    const ni = ((i % segs.length) + segs.length) % segs.length
    if (ni !== si && !reduce) { setWipe(w => w + 1); later(() => { setSeg(ni); setBeat(b) }, 480) } else { setSeg(ni); setBeat(b) }
  }
  const doneRef = useRef(null)
  doneRef.current = () => { clear(); later(() => (bi < S.beats.length - 1 ? go(si, bi + 1) : go(si + 1, 0)), (Bt.gfx ? HOLD.gfx : HOLD.anchor) + (reduce ? 2000 : 0)) }
  useEffect(() => () => clear(), [])
  useEffect(() => { clear(); setSeg(0); setBeat(0) }, [day])
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
  const dateLab = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  const key = `${si}-${bi}-${seed}`
  const takes = segs.reduce((n, x) => n * x.takes, 1)

  return (
    <LiveCtx.Provider value={liveMap}><div className={s.wrap}>
      <div className={s.box} ref={box} style={{ aspectRatio: `${Wd} / ${Ht}` }}>
        <div className={s.stage} data-phone={phone ? '' : undefined} data-rm={reduce ? '' : undefined} style={{ width: Wd, height: Ht, transform: `scale(${k})` }}>
          <div className={s.studio}>
            <div className={s.led}>{finals.slice(0, 12).map((x, i) => <i key={x.c.key} style={{ '--c': kit.tColor(x.c.g.pts[0] > x.c.g.pts[1] ? x.c.g.teams[0] : x.c.g.teams[1]), '--d': `${-i * 0.5}s` }} />)}</div>
            <div className={s.skyline} />
            {!Bt.gfx && <button key={`o${key}`} type="button" className={s.ots} onClick={Bt.go || undefined} disabled={!Bt.go} tabIndex={-1}>
              <span className={s.art}>{Bt.ots}</span><span className={s.lab}>{Bt.lab}</span></button>}
            <div className={s.anchor}><Anchor talk={talk && !Bt.gfx} gest={(si + bi) % 2 === 1} /></div>
            <div className={s.desk}><span className={s.wordmark}><i>FS</i>FANSIDED TONIGHT</span></div>
          </div>
          {Bt.gfx && <div key={`g${key}`} className={s.gfx}>
            <div className={s.gHead}><b>{Bt.head[0]}</b>{Bt.head[1] && <i>{Bt.head[1]}</i>}{Bt.head[2] && <span>{Bt.head[2]}</span>}{Bt.go && <button type="button" className={s.openB} onClick={Bt.go}>▶ Open</button>}</div>
            <div className={s.gBody} data-nolegend={Bt.noLegend ? '' : undefined}>{Bt.view}</div>
            <div className={s.pip}><Anchor talk={talk} /></div>
          </div>}
          <div className={s.lower}>
            <div className={s.strip}><span className={s.bug}>FANSIDED <small>TONIGHT</small></span><span key={si} className={s.title}>{S.title}</span>
              <span className={s.dots}>{S.beats.map((_, i) => <i key={i} data-on={i === bi ? '' : undefined} data-past={i < bi ? '' : undefined} />)}</span>
              <span className={s.clock}>{S.live ? <><u className={s.liveDot} />LIVE</> : live.length ? `FINALS & LIVE · ${dateLab}` : `FINALS · ${dateLab}`}</span></div>
            <Caption key={key} text={Bt.line || ' '} run={run} instant={reduce} onTalk={setTalk} onDone={() => doneRef.current()} />
          </div>
          {!reduce && <div key={wipe} className={s.wipe} data-go={wipe ? '' : undefined}><i /><i /><i /><i /><span>FANSIDED</span></div>}
        </div>
      </div>
      <div className={s.ctl}>
        <button type="button" onClick={() => (bi > 0 ? go(si, bi - 1) : go(si - 1, 0))} aria-label="Back">◀</button>
        <button type="button" onClick={() => setPlaying(v => !v)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <button type="button" onClick={() => (bi < S.beats.length - 1 ? go(si, bi + 1) : go(si + 1, 0))} aria-label="Skip">▶▶</button>
        <span className={s.rund}>{segs.map((x, i) => <button key={x.id} type="button" data-on={i === si ? '' : undefined} onClick={() => go(i, 0)}>{x.title}</button>)}</span>
        <button type="button" onClick={() => { clear(); setSeed(Math.floor(Math.random() * 2e9) + 1); setBeat(0) }} title={`Rewrite the script (about ${takes.toExponential(0).replace('e+', '×10^')} possible shows tonight)`}>↻ New take</button>
        {liveN > 0 && <button type="button" className={s.live} onClick={onLive}><i />Live game</button>}
      </div>
    </div></LiveCtx.Provider>
  )
}
