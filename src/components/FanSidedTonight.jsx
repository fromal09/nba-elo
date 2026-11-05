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
const OPENERS = ['Good evening and welcome to FanSided Tonight.', 'Welcome in to FanSided Tonight.', 'You’re watching FanSided Tonight.', 'Evening, everybody, and welcome to the show.', 'Thanks for joining us on FanSided Tonight.', 'It’s FanSided Tonight, and we are rolling.', 'Pull up a chair, because this is FanSided Tonight.', 'Here we go on FanSided Tonight.', 'Good to have you with us on FanSided Tonight.', 'From the FanSided desk, welcome to the show.']
// Every line is a full compound sentence, so a beat reads as a paragraph rather than a list of facts.
// The show talks about players first: games come up only as the setting for what a player did.
const B = {
  open: {
    intro: [OPENERS,
      ['We had {slate} on the board tonight, and while {upsets} kept things interesting, it was the individual performances that stole the show.',
        '{slate} went final tonight, and between the career nights, the big swings in the rankings and {upsets}, there’s a lot to get to.',
        'Every one of tonight’s {gamesN} games is in the books, and the players gave us plenty to talk about from the opening tip to the final buzzer.',
        'It was a {gamesN}-game night across the league, and the stars showed up in a big way, with {upsets} sprinkled in for good measure.',
        '{slate} are final with {liveTxt} still going, and the players have already given us more than enough for a full show.',
        'The favorites held serve across the board tonight, but the players more than made up for the lack of drama.{chalk}',
        'There was no shortage of big individual nights tonight, and with {slate} in the books, we’ve got a lot of ground to cover.'],
      ['We’ll start with {potd}, who was the best player in the league tonight, and then work our way through the cards that are about to land in your binder.',
        '{potd} leads the way as our Player of the Day, but he’s far from the only player who deserves a closer look tonight.',
        'Stick around, because between {potd}’s big night and a handful of career highs, the binders are about to get a lot heavier.',
        'We’ve got a Player of the Day, a duel worth your time and a few players who just had the best games of their careers, so let’s get right to it.']],
    top: [['Before we dig in, here are the five best Game Scores of the night, and {t1} sits at the top of the list after a {t1gs} against the {t1opp}.',
        '{t1} posted the best Game Score of the night at {t1gs}, and as you can see, the rest of this group wasn’t far behind.',
        'Here are tonight’s top performers by Game Score, led by {t1}, who put up {t1pts} points against the {t1opp}.',
        'Take a look at the five players who did the most damage tonight, starting with {t1} and his {t1gs} Game Score.'],
      ['{t2} checks in second with a {t2gs}, while {t3} rounds out the top three after a {t3pts}-point night for the {t3team}.',
        'Right behind him are {t2}, who scored {t2pts} for the {t2team}, and {t3}, who finished with {t3pts} of his own.',
        '{t2} put up {t2pts} points for the {t2team}, while {t3} answered with {t3pts}, and we’ll get to a few of these cards in more detail later on.',
        'Every one of these cards is worth a closer look, and {t2} and {t3} made it a crowded race at the top.']],
    fan: [['These are tonight’s Cards of the Day, and every one of them tells a story we’ll get to over the course of the show.',
        'Here’s the full set of tonight’s featured cards, starting with {potd} as Player of the Day and running through the biggest swings in the rankings.',
        'Take a look at the {cardCount} Cards of the Day, because each of them earned its spot and each of them is headed for somebody’s binder.',
        'This is what the binder is getting tonight, from {potd}’s Player of the Day card to the duel and the biggest Elo swings.'],
      ['We’ll take them one at a time, and we’ll start at the very top.', 'Let’s start with the best of the bunch and work our way down from there.', 'First up is the best player in the league tonight, so let’s get to him.']],
  },
  potd: {
    intro: [['Our Player of the Day is {name}, who put up {pts} points, {reb} rebounds and {ast} assists as the {team} {rv} the {opp}.',
        'Nobody in the league was better tonight than {name}, who went for {pts}, {reb} and {ast} against the {opp} and made it look easy.',
        'The night belonged to {name}, and after {pts} points on {fgline} shooting against the {opp}, it wasn’t particularly close.',
        '{name} takes home Player of the Day honors after a {pts}-point night against the {opp}, and he did it with a {gs} Game Score that topped the entire league.',
        'If you only watched one player tonight, it should have been {name}, who scored {pts} and posted a {gs} Game Score against the {opp}.',
        'The Player of the Day card goes to {name}, who filled up the box score against the {opp} with {pts} points, {reb} rebounds and {ast} assists.'],
      ['Let’s take a closer look at how he did it, because the details are even better than the headline.', 'Here’s the card, and it’s a good one.', 'This one deserves the full breakdown, so let’s start with the card.']],
    hero: [['His {gs} Game Score was the best in the league tonight, and he did it in {mins} minutes while finishing a {pm} with {stl} steals and {blk} blocks mixed in.',
        'He finished with a {gs} Game Score in {mins} minutes, and the {pm} plus-minus tells you just how much the game swung with him on the floor.',
        'That {gs} Game Score topped everyone on the slate, and he backed it up by finishing a {pm} in {mins} minutes.',
        'A {gs} Game Score was enough to top the entire league tonight, and he got there in only {mins} minutes of work.',
        'He posted a {gs} Game Score, which was the best of anyone tonight, and every part of the stat line pulled its weight.'],
      ['The performance moves his Elo {up} {delta} points to {post}, which bumps him from number {prev} to number {rank} in our rankings.',
        'His Elo climbs {delta} points to {post}, and that’s good for a jump from {prev} to {rank} in the rankings.',
        'All told, his Player of the Day score came out to {ns}, combining his Game Score with a sixth of the {delta} Elo points he gained.',
        'That’s worth {delta} points of Elo, which leaves him at {post} heading into his next game.']],
    shoot: [['What really stands out is the efficiency, because he went {fgline} from the field and {tpline} on his way to {ts} true shooting.',
        'He shot {fgline} from the field and {ftline} at the line, which works out to {ts} true shooting on a high-volume night.',
        'He made {fg} of his {fga} shots, including {tpline}, and that kind of efficiency is hard to argue with.',
        'He was {fgpct} from the field on {fga} attempts, and he never had to force anything to get there.'],
      ['He’s averaging {spts} points a game this season, so tonight was {ptsOver} above his norm and then some.',
        'Through {gp} games he’s been a {sgs} Game Score player, which makes tonight’s {gs} all the more impressive.',
        'Compare that to his {spts} points per game on the season, and you get a sense of how far above his baseline this was.',
        'That’s as efficient as it gets with that kind of volume, and his season numbers show just how rare a night like this is.']],
    vs: [['Stack tonight up against his season averages and the gap jumps right off the screen.', 'Here’s tonight next to what he usually gives you, and it isn’t close.', 'Let’s put the night in context with his season averages, because that’s where it really stands out.'],
      ['He averages {spts} points, {sreb} rebounds and {sast} assists through {gp} games, and tonight he cleared those marks with room to spare.',
        'His season Game Score sits at {sgs}, which means tonight’s {gs} was more than double his typical output.{dbl}',
        'He came into tonight averaging {spts} points a game, so the {pts} he dropped was {ptsOver} better than usual.',
        'He’s been a {sgs} Game Score player through {gp} games, and tonight he showed what his ceiling looks like.']],
  },
  career: [['Zoom out to his whole career and you can see exactly where tonight fits, with the line climbing to {post} after {cgames} career games.',
      'Here’s every game of his career in one line, and that spike on the far right is tonight pushing him up to {post}.',
      'His career Elo peaked at {peak}, and tonight put him back within {peakGap} points of that mark.',
      'Tonight’s {post} is a new career high, and you can see the line breaking through on the far right of the chart.{newPeak}',
      'He started tonight at {pre}, and after one big night he leaves at {post}, which shows up clearly at the end of the chart.'],
    ['Every big night leaves a mark on this chart, and this one stands out.', 'The line doesn’t lie, and it’s been trending in the right direction.', 'That last point on the chart is tonight, and it’s one he’ll want to remember.', 'It’s a good reminder that one great night can move the needle in a big way.']],
  seasonGraph: [['Here’s his season so far in Elo, and that jump at the far right is tonight.', 'Let’s look at his season in Elo, where tonight moved him {up} {delta} points to {post}.', 'This is every game of his season, and he came into tonight at {pre} after {gp} games.'],
    ['The chart tells the story, and the story is trending up.', 'Nights like this are what move a season, and you can see it in the line.', 'It’s been a steady climb, and tonight was one of the bigger steps.']],
  upset: {
    intro: [['Our upset of the night came from the {win}, who were given just a {chance} chance and still knocked off the {lose}, {score}.',
        'The {lose} came in as {fav} favorites, but the {win} had other plans and pulled off the biggest upset of the night, {score}.',
        'Nobody saw this one coming, because the {win} were {chance} underdogs and still walked away with a {score} win over the {lose}.',
        'The forecast had the {lose} at {fav}, and the {win} beat them anyway, {score}, for the biggest stunner of the night.'],
      ['{star} led the way for the {win}, and his {starGs} Game Score was the biggest reason the forecast missed.',
        'The difference-maker was {star}, who put up {starPts} points and carried the {win} when it mattered most.',
        'It was {star} who made the difference, finishing with {starPts} points and a {starGs} Game Score.']],
    wp: [['Before tipoff the forecast had the {lose} at {fav}, which made the {win} roughly one-in-{oneIn} underdogs, and they won anyway.',
        'The pre-game numbers gave the {win} a {chance} chance, and the {lose} were supposed to handle this one comfortably.',
        'Here’s how lopsided it looked on paper, with the {lose} at {fav} before the opening tip.'],
      ['{star} didn’t care much about the odds, and neither did his teammates.', 'It’s a reminder that the players decide these things, not the forecast.', 'Upsets like this move the ratings in a big way, and {star} was the biggest beneficiary.']],
    hero: [['{name} finished with {pts} points, {reb} rebounds and {ast} assists, and his {gs} Game Score led everyone in the game.',
        '{name} went {fgline} from the field on his way to {pts} points, and he finished a {pm} in {mins} minutes.',
        '{name} put up {pts} points and a {gs} Game Score, and he picked his spots perfectly down the stretch.'],
      ['The win moves him {up} {delta} Elo points to {post}, and he climbs to number {rank} in the rankings.',
        'He picks up {delta} Elo points in the process, which leaves him at {post}.',
        'Beating a better team pays off in the ratings, and he gains {delta} points to land at {post}.']],
  },
  careerGame: {
    intro: [['We had a career night from {name}, who posted a {gs} Game Score against the {opp}, the best mark of his career.',
        '{name} has never been better than he was tonight, putting up {pts} points, {reb} rebounds and {ast} assists for a career-best {gs} Game Score.',
        'Mark the date, because {name} had the game of his life against the {opp}, scoring {pts} on {fgline} shooting.',
        'Put this one in the scrapbook, because {name} just set a new career high with a {gs} Game Score against the {opp}.'],
      ['Let’s take a look at the card that goes along with it.', 'Here’s the card, and it’s going straight into the binder.', 'This one deserves a closer look, so let’s start with the card.']],
    hero: [['He finished with {pts} points, {reb} rebounds and {ast} assists in {mins} minutes, and he did it on {fgline} shooting.',
        'He scored {pts} on {fgline} shooting and finished a {pm} in {mins} minutes, which is about as complete as it gets.',
        'It was a {gs} Game Score in {mins} minutes, and every part of the line pulled its weight.'],
      ['The {team} {rv} the {opp}, {score}, and his Elo moves {up} {delta} points to {post}.',
        'His Elo climbs {delta} points to {post}, and he moves up to number {rank} in the rankings.',
        'That’s good for {delta} points of Elo, which leaves him at {post}.']],
    vs: [['Compare it to his season and you see just how far above his norm this was.', 'Here’s tonight against his season averages, and the gap is enormous.'],
      ['He’s averaging {spts} points and a {sgs} Game Score through {gp} games, so tonight’s {pts} points and {gs} Game Score were in a different league.',
        'His career Game Score average is {cgs}, which makes tonight’s {gs} an outlier in the best possible way.',
        'He came in averaging {spts} points a game, so tonight was {ptsOver} above his usual output, and then some.']],
    list: [['He wasn’t the only one, either, because {careerN} players set career-best Game Scores tonight.', 'It was a big night for personal bests all around the league, and here’s everybody who joined the club.'],
      ['{c2} had a {c2gs} of his own, and every one of these cards gets a star on the wall.', 'Every one of these cards gets a star, and a few of them could end up being keepers.']],
  },
  milestone: {
    intro: [['{name} hit a milestone tonight against the {opp}, and it took a {gs} Game Score to get him there.',
        '{name} had a night worth marking, putting up {pts} points against the {opp} and moving into new territory in the rankings.',
        'Here’s a milestone worth celebrating, because {name} climbed the rankings in a big way after a {pts}-point night against the {opp}.'],
      ['Here’s the card and the move that goes with it.', 'Let’s look at the card and the jump.']],
    rank: [['{name} jumps from number {prev} to number {rank} after a {gs} Game Score against the {opp}.',
        '{name} climbs {jump} spots to number {rank}, which is what a {pts}-point night will do for you.',
        'After a {gs} Game Score against the {opp}, {name} moves from {prev} to {rank} in the rankings.'],
      ['{stamp}', '{stamp} His Elo is up to {post}.', '{stamp} It’s been a long time coming.']],
    list: [['He wasn’t alone, because {milN} players hit milestones tonight, and here are a few of the biggest.', 'Around the league, {milN} players hit milestones tonight, and these are the cards that go with them.'],
      ['Each of these cards gets a diamond on the ticker, and you can tap any of them on the board below.', 'Every one of these players moved into new territory tonight, and the binders will notice.']],
  },
  movers: {
    intro: [['{rname} was the biggest riser of the night, gaining {rdelta} Elo points, while {fname} went the other way and dropped {fdelta}.',
        'Let’s check the biggest swings of the night, starting with {rname}, who gained {rdelta}, and ending with {fname}, who lost {fdelta}.',
        'Nobody gained more Elo tonight than {rname}, who picked up {rdelta} points, while {fname} had the roughest night and gave back {fdelta}.'],
      ['Here are the cards behind those numbers.', 'Let’s put the cards on the screen.']],
    fan: [['{r2} was next among the risers at {r2d}, followed by {r3} at {r3d}, and every one of them earned it with a big night.',
        'Behind {rname}, {r2} gained {r2d} and {r3} gained {r3d}, so it was a good night to be a riser.',
        'Elo rewards production against good competition, and {r2} and {r3} both cashed in, with gains of {r2d} and {r3d}.'],
      ['On the other end, {f2} had the second-biggest drop at {f2d}, so not every card is headed in the right direction.',
        '{f2} slid {f2d}, which shows you how quickly the ratings can turn on an off night.',
        'Every one of these swings came from a single game, and that’s what makes the ratings fun to watch.']],
    riser: [['{name} went for {pts}, {reb} and {ast} against the {opp}, and his {gs} Game Score was enough to make him the biggest riser of the night.',
        '{name} shot {fgline} against the {opp} and finished with a {gs} Game Score, which was worth {delta} Elo points.',
        'A {gs} Game Score from {name} against the {opp} was all it took, and he made the most of his {mins} minutes.'],
      ['That moves him from {pre} to {post}, and he climbs from number {prev} to {rank} in the rankings.', 'He jumps to {post} in the process, and big nights against good teams always pay off.']],
    faller: [['{name} managed a {gs} Game Score against the {opp}, and on a {fgline} shooting night, the ratings weren’t kind.',
        '{name} had {pts} points in {mins} minutes against the {opp}, and it wasn’t enough to keep his Elo from sliding.',
        'It was a rough one for {name}, who posted a {gs} Game Score against the {opp}.'],
      ['That costs him {delta} points, which drops him to {post}, but he’ll get a chance to win it back.', 'He slides from {pre} to {post}, and he’ll be looking to bounce back next time out.']],
  },
  duel: {
    intro: [['{a} and {b} squared off in the Duel of the Day, and while both of them delivered, {alast} came out on top.',
        '{a} for the {ateam} against {b} for the {bteam} was the best one-on-one of the night, with two players rated {apre} and {bpre} going right at each other.',
        'Our main event pitted {a} against {b}, and it lived up to the billing from start to finish.'],
      ['Here’s the card that goes with it.', 'Let’s start with the duel card.']],
    card: [['{a} edged {b} {ag} to {bg} in Game Score, and both of them played well enough to win the duel on most nights.',
        '{alast} won the Game Score battle {ag} to {bg}, and this card captures both sides of it.',
        'It was {ag} for {a} and {bg} for {b}, which was enough to give {alast} the edge in a close one.'],
      ['Both players gain from a night like this, and the card is a good one.', 'That card is a keeper, whichever side of it you were rooting for.']],
    tape: [['{a} finished with {apts} points while {b} answered with {bpts}, and the Game Score battle went to {alast}, {ag} to {bg}.',
        '{a} came in rated {apre} and {b} came in at {bpre}, so on paper this was about as even as it gets.',
        'Side by side, you can see how close it was, with {a} at {apts} points and {b} at {bpts}.'],
      ['It was an instant classic, and both cards are worth keeping.', 'Neither player had a bad night, and that’s what made this one fun.', 'That’s why you stay up late, and both of these players gave us our money’s worth.']],
  },
  slayer: {
    intro: [['{a} was our Giant-Slayer of the Day, outplaying {b}, who came in rated {gap} Elo points higher.',
        'Talk about punching up, because {a} beat {b} by Game Score despite a {gap}-point gap in Elo.',
        'The longest odds of the night belonged to {a}, who took down {b} in their head-to-head with just a {chance} chance.'],
      ['Here’s the card that goes with it.', 'Let’s look at the card and the odds.']],
    card: [['The odds of {a} winning that matchup were {chance}, and he did it anyway with a {ag} Game Score to {bg}.',
        'At {chance}, {a} still got the better of {b}, and this card is the proof.',
        '{a} over {b} came at {chance} odds, which makes this one of the rarest cards of the night.'],
      ['It was a big night for the little guy, and he’ll be hearing about it for a while.', 'Respect to him, because nights like this don’t come around often.']],
    tape: [['{a} came in at {apre} and {b} came in at {bpre}, and yet {alast} won the Game Score battle {ag} to {bg}.',
        'Side by side, {a} had {apts} points while {b} had {bpts}, and that’s how a giant falls.'],
      ['Goliath goes home, and the ratings love an upset like this.', 'It’s rare stuff, and it shows up in the Elo swing for both of them.']],
  },
  close: {
    fan: [['That’s going to do it for us tonight, so let’s take one more look at tonight’s Cards of the Day.',
        'Before we go, here are tonight’s cards one last time, and every one of them is waiting for you on the wall.',
        'That’s our show, and these are the cards that defined the night.'],
      ['Tap any TV for the full box score, and check the board below for every table from tonight.', 'Every box score is one tap away, and the board below has every table from the night.', 'Make your picks before the next tip, because there’s another set of cards on the way.']],
    end: [['If you take one thing away from tonight, let it be {potd}, and we’ll see you next time on FanSided Tonight.',
        'For everyone here at the FanSided desk, thanks for watching, and we’ll see you next time.',
        'Get some sleep and open your pack, because we’ll be back tomorrow with another night of cards.',
        'That’s FanSided Tonight, and until next time, good night.']],
  },
}

// Runners-up: the podium and the near misses in every category
const RU = {
  podium: [['It wasn’t a one-man race, though, because {n2} finished second with a {s2} on the Player of the Day scale after putting up {p2line} against the {o2}.',
      'Silver goes to {n2}, who posted {p2line} against the {o2}, while {n3} took the bronze with {p3line}.',
      'Here’s the podium, and {n2} made {n1} work for it with {p2line} against the {o2}.',
      'The race for Player of the Day had three real contenders, and {n2} came closest with a {s2} after {p2line} against the {o2}.'],
    ['{n3} rounded out the podium at {s3}, and in the end {n1} won it by {gap12} points.',
      '{n3} finished third with {p3line}, but nobody caught {n1}, who won it by {gap12}.',
      'It came down to just {gap12} points at the top, which makes it one of the closer races we’ve seen.{tight}',
      'In the end it wasn’t close, because {n1} won it by {gap12} points.{wide}']],
  upsets: [['It wasn’t the only upset tonight, and each of these players had a hand in knocking off a favorite.',
      'The favorites had a rough night overall, and these are the players who made it happen.',
      'There were {upN} upsets in all tonight, and every one of them had a star of its own.'],
    ['{u2star} led the {u2w} past the {u2l} as {u2c} underdogs, while {u3star} did the same for the {u3w} at {u3c}.',
      '{u2star} carried the {u2w} to a win at {u2c} with {u2pts} points, and that’s one more card worth keeping.',
      '{u2star} scored {u2pts} to help the {u2w} beat the {u2l}, and {u3star} came through for the {u3w} too.']],
  duel: [['The runner-up duel was no slouch either, with {ra} edging {rb} {rag} to {rbg} in Game Score.',
      'Just missing the cut was {ra} against {rb}, a matchup {ra} won {rag} to {rbg}.',
      '{ra} for the {rateam} and {rb} for the {rbteam} gave us the second-best duel of the night, and it went to {ra}, {rag} to {rbg}.'],
    ['On most nights that one would have been the main event, and both cards are worth keeping.', 'It was good, just not quite as good as the main event.']],
  slayer: [['The runner-up giant-slayer was {ra}, who outplayed {rb} despite being rated {rgap} points lower.',
      'Another long shot came through when {ra} beat {rb} by Game Score, {rag} to {rbg}, at {rchance} odds.',
      'At {rchance}, {ra} still got the better of {rb}, which gives us two giant-slayers on the same night.'],
    ['It wasn’t quite as wild as the winner, but it was close.', 'Two giants fell tonight, and he deserves credit too.']],
}

// Live look-ins: games still in progress, woven through the show, led by the players in them
const L = {
  board: [['And the night isn’t over, because we’ve got {liveTxt} in progress right now, and we’ll check in on them throughout the show.',
      'Meanwhile, {liveTxt} {liveIs} still going as we speak, and we’ll bring you live look-ins as we go.',
      'We’re not done yet, either, since {liveTxt} {liveIs} still being played, and we’ll keep an eye on every one of them.']],
  intro: [['Let’s check in on a game that’s still going, where {t1} has {t1pts} points for the {t1team} {clock}.',
      'We’ve got a game in progress, and {t1} is putting on a show with {t1pts} points {clock}.',
      'Time for a live look-in, and {t1} is the story so far with {t1pts} points for the {t1team} {clock}.',
      'Let’s send it to the {away} and {home}, where {t1} already has {t1pts} points {clock}.'],
    ['The {leader} lead the {trailer} {leadScore}, and he’s a big reason why.{t1lead}', 'The {leader} are up {margin}, but the {t1team} are still within striking distance thanks to him.{t1trail}', 'It’s {leadScore} {leader} right now, and we’ll see how it plays out.', 'It’s all tied up at {tieScore}, so every bucket matters from here.']],
  box: [['{t1} has {t1pts} points, {t1reb} rebounds and {t1ast} assists so far, and his {t1gs} Game Score leads everybody on the floor.',
      'His {t1gs} Game Score is the best in the game so far, and he’s getting it done on {t1fg} shooting.',
      '{t1} has been the best player on the floor, with {t1pts} points and a {t1gs} Game Score so far.'],
    ['{t2} is doing his best to answer for the {t2team} with {t2pts} points, and we’ll see if he can keep it up.',
      'On the other side, {t2} has {t2pts} for the {t2team}, and he’s the one to watch the rest of the way.',
      '{t2} has a {t2gs} Game Score of his own, so this one has the makings of a duel.']],
  bug: [['Before tipoff the {fav} were {favPct} favorites, and right now our live model gives the {liveLead} a {livePct} chance.',
      'The {fav} came in at {favPct}, and as of now it’s {livePct} for the {liveLead}.',
      'The pre-game forecast had the {fav} at {favPct}, and with the clock running, the {liveLead} are at {livePct}.'],
    ['That’s an upset watch, so keep an eye on this one.{uw}', 'We project a final of {projLine}, and we’ll check back in later in the show.', 'There’s plenty of basketball left, so we’ll come back to this one.{early}', 'This one could come down to the wire, so stay close.{late}', 'The favorite looks to be in control, but we’ll keep watching.{safe}']],
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
// "an 18.2", "an 8-point", "an 11 of 18", but "a 33.5"
const anFix = t => t.replace(/\b([Aa]) (\d[\d,]*)/g, (m, a, num) => { const i = num.split(/[.,]/)[0]; return /^8/.test(i) || i === '11' || i === '18' ? `${a}n ${num}` : m })
const fill = (t, v) => anFix(t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '').replace(/\.\./g, '.').replace(/\.,/g, ','))
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
function buildNight({ finals, live = [], side }) {
  const wrap = ({ c, f }) => {
    const g = c.g
    const pts = { [g.teams[0]]: g.pts[0], [g.teams[1]]: g.pts[1] }
    const win = pts[g.teams[0]] > pts[g.teams[1]] ? g.teams[0] : g.teams[1]
    return { g, f, pts, win, lose: g.teams.find(t => t !== win), home: f.home, away: f.away, live: c.state === 'in' }
  }
  const G = finals.map(wrap)
  const LG = live.filter(x => x.c.g).map(wrap)
  const byId = new Map([...G, ...LG].map(x => [x.g.id, x]))
  const all = [...G, ...LG].flatMap(x => x.g.players.map(p => ({ p, x }))).filter(({ p }) => p.mp == null || p.mp > 0)
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
  for (const x of [...G, ...LG]) {
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
  const top5 = [...all].sort((a, b) => b.p.gs - a.p.gs).slice(0, 5)
  return { G, pd, ups, careers, podium, top5, duel2: dd && duels.find(d => d.x.g.id !== dd.g.id), slayer2: ss && slayers.find(d => d.x.g.id !== ss.g.id), cg, mils, mil, risers, fallers: [...risers].reverse(), duel: pick('duel'), slayer: pick('slayer'),
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
      rv: x.live ? (won ? 'lead' : 'trail') : won ? 'beat' : 'fell to', rn: x.live ? 'game still in progress' : won ? 'win' : 'loss', score: `${x.pts[x.win]}–${x.pts[x.lose]}`,
      dbl: S && p.gs >= 2 * S.gs ? '' : null,
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
    return { gfx: true, head: [c.kind === 'career' ? 'Career Elo' : 'Season Elo', bn(p.n), c.right], view: <div className={s.split2}>{card(p, x, 250)}<div className={s.chartWrap}>{c.node}</div></div>,
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
    Object.assign(v, t1 ? { t1: bn(t1.n), t1pts: t1.pts, t1reb: t1.trb ?? null, t1ast: t1.ast ?? null, t1gs: t1.gs.toFixed(1), t1team: tShort(t1.t), t1fg: t1.fga ? `${t1.fg}-of-${t1.fga}` : null,
      t1lead: leader && t1.t === leader ? '' : null, t1trail: leader && t1.t !== leader ? '' : null } : {},
      t2 ? { t2: bn(t2.n), t2pts: t2.pts, t2gs: t2.gs.toFixed(1), t2team: tShort(t2.t) } : {})
    const title = `Live: ${tCode(away)} at ${tCode(home)}`
    const open = c.g ? () => act.box(c.g) : null
    return { id: `live-${c.key}`, title, live: true, takes: combos(L.intro) * combos(L.bug) * combos(L.box), beats: [
      anchor(t1 ? <Slot h={196}>{kit.miniCard(c.g, t1)}</Slot> : <span className={s.miniBug}>{[away, home].map(t => <span key={t}><i style={{ background: tColor(t) }} /><b>{tCode(t)}</b><strong>{pts[t] ?? 0}</strong></span>)}<em><u />LIVE</em></span>, 'Live look-in', say(t1 ? L.intro : [['Let’s check in on a game that’s still going between the {away} and the {home}.'], L.intro[1]], v, r), t1 ? () => act.card(c.g, t1) : open),
      t1 && t2 && { gfx: true, head: ['Leaders so far', 'Live', `${tShort(away)} at ${tShort(home)}`], go: open,
        view: <div className={s.tape}><Slot h={250}>{kit.miniCard(c.g, t1)}</Slot><LiveLines ps={[t1, t2]} kit={kit} k={c.key} /><Slot h={250} i={1}>{kit.miniCard(c.g, t2)}</Slot></div>, line: say(L.box, v, r) },
      { gfx: true, head: ['Live', tCode(away) + ' @ ' + tCode(home), String(lv.detail || '')], view: <LiveBug k={c.key} snap={{ c, f }} kit={kit} />, line: say(L.bug, v, r), go: open },
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
  const T5 = N.top5
  const tv = T5.length >= 3 ? { t1: bn(T5[0].p.n), t1gs: T5[0].p.gs.toFixed(1), t1pts: T5[0].p.pts, t1opp: tShort(opp(T5[0].p, T5[0].x)),
    t2: bn(T5[1].p.n), t2gs: T5[1].p.gs.toFixed(1), t2pts: T5[1].p.pts, t2team: tShort(T5[1].p.t), t3: bn(T5[2].p.n), t3pts: T5[2].p.pts, t3team: tShort(T5[2].p.t) } : {}
  const topFan = <div className={s.fan}>{T5.map((m, i) => <span key={m.p.n} className={s.fanItem} style={{ '--d': `${0.25 * i + 0.2}s` }}>{card(m.p, m.x, T5.length > 4 ? 226 : 250, 0, (i - (T5.length - 1) / 2) * 3)}<small>{i + 1}. {m.p.gs.toFixed(1)} GMSC{m.x.live ? ' · LIVE' : ''}</small></span>)}</div>
  const liveBoard = ln > 0 && { gfx: true, head: ['Live right now', 'In progress', `${ln} game${ln === 1 ? '' : 's'}`], view: <LiveGrid live={live} kit={kit} onOpen={act.live} />, line: say(L.board, ov, r) }
  if (!n) seg('open', 'Tonight’s games', [
    anchor(N.top5[0] ? card(N.top5[0].p, N.top5[0].x, 196) : <><span className={s.big2}>{ln}</span><span className={s.big2l}>LIVE</span></>, 'In progress', say([OPENERS, ['No finals yet, but there’s plenty going on.', 'The night is still young.', 'Nothing’s final yet, so let’s go around the league.']], ov, r)),
    liveBoard,
    N.top5.length >= 3 && { gfx: true, head: ['Top performers so far', 'Game Score', 'Live'], view: topFan, line: say(B.open.top, tv, r) },
  ], combos(OPENERS) * tkL(L.board))
  else seg('open', 'Tonight’s finals', [
    anchor(N.pd ? card(N.pd.p, N.pd.x, 196) : <><span className={s.big2}>{n}</span><span className={s.big2l}>FINAL{n === 1 ? '' : 'S'}</span></>, N.pd ? 'Player of the Day' : 'All final', say(B.open.intro, ov, r)),
    N.top5.length >= 3 && { gfx: true, head: ['Top performers', 'Game Score', 'Tonight'], view: topFan, line: say(B.open.top, tv, r) },
    liveBoard,
    side.picks.length > 1 && { gfx: true, head: ['Cards of the Day', 'Tonight'], view: fanView(side.picks), line: say(B.open.fan, ov, r) },
  ], combos(OPENERS) * combos(B.open.top) * combos(B.open.fan))

  // 2 · Player of the Day
  if (N.pd) {
    const { p, x } = N.pd, v = facts(p, x)
    seg('potd', x.live ? 'Player of the Day race' : 'Player of the Day', [
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
      vsBeat(p, x, v, B.potd.vs, ['Tonight vs his season', 'Player of the Day', bn(p.n)]),
      chartBeat(p, x, v),
    ], tk(B.potd) * combos(B.career))
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
      winElo: eloW ? r0(eloW) : null, loseElo: eloL ? r0(eloL) : null, eloGap: eloW && eloL && eloL > eloW ? r0(eloL - eloW) : null,
      star: star && bn(star.n), starGs: star?.gs.toFixed(1), starPts: star?.pts }
    seg('upset', 'Upset alert', [
      anchor(star ? card(star, x, 196) : <><span className={s.big2}>{pct(wp[x.win])}</span><span className={s.big2l}>{tCode(x.win)} PRE-GAME</span></>, 'Upset alert', say(B.upset.intro, v, r), star ? () => act.card(g, star) : () => act.box(g)),
      star && heroBeat(star, x, facts(star, x), B.upset.hero, ['Upset star', tCode(x.win), bn(star.n)]),
      { gfx: true, head: ['Upset alert', 'Final', `${tShort(x.away)} at ${tShort(x.home)}`], go: () => act.box(g), view: <><div className={s.wpg}>
        {[x.away, x.home].map(t => <div key={t} className={s.wpRow}><span className={s.tm} style={{ '--c': tColor(t) }}>{tName(t).toUpperCase()}</span><span className={s.sc} data-w={t === x.win ? '' : undefined}>{x.pts[t]}</span></div>)}
        <div className={s.wpLab}><span>{tCode(x.away)} {pct(wp[x.away])}</span><span>PRE-GAME WIN CHANCE</span><span>{pct(wp[x.home])} {tCode(x.home)}</span></div>
        <div className={s.wpBar}><i style={{ width: `${wp[x.away] * 100}%`, background: tColor(x.away) }} /><i style={{ flex: 1, background: tColor(x.home) }} /></div>
      </div><div className={s.stamp}>UPSET</div></>, line: say(B.upset.wp, v, r) },
      N.ups.length > 1 && (() => {
        const [, u2, u3] = N.ups
        const st = y => [...y.g.players].filter(q => q.t === y.win).sort((a, b) => b.gs - a.gs)[0]
        const s2 = st(u2), s3 = u3 && st(u3)
        const uv = { u2star: s2 && bn(s2.n), u2pts: s2?.pts, u3star: s3 && bn(s3.n), u2w: tShort(u2.win), u2l: tShort(u2.lose), u2c: pct(u2.f.wp[u2.win]), u2s: `${u2.pts[u2.win]}–${u2.pts[u2.lose]}`,
          u3w: u3 ? tShort(u3.win) : null, u3l: u3 ? tShort(u3.lose) : null, u3c: u3 ? pct(u3.f.wp[u3.win]) : null, upN: N.ups.length > 2 ? N.ups.length : null }
        return { gfx: true, head: ['More upsets', 'Upset stars', `${N.ups.length} tonight`], view: <div className={s.fan}>{N.ups.slice(0, 5).map((y, i) => { const q = st(y); return q && (
          <span key={y.g.id} className={s.fanItem} style={{ '--d': `${0.25 * i + 0.2}s` }}>{card(q, y, N.ups.length > 4 ? 226 : 250, 0, (i - 2) * 3)}<small>{tCode(y.win)} over {tCode(y.lose)} · {pct(y.f.wp[y.win])}</small></span>) })}</div>,
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
      anchor(card(p, x, 196), 'Milestone ◆', say(B.milestone.intro, v, r), () => act.card(x.g, p)),
      { gfx: true, head: ['Milestone', '◆', bn(p.n)], go: () => act.card(x.g, p), view: <div className={s.split2}>{card(p, x, 300)}<div className={s.rank}>
        {p.lr != null && p.lr !== p.lrp && <><span className={s.from}>#{p.lr}</span><span className={s.arrow}>→</span></>}<span className={s.to}>#{p.lrp}</span>
        <span className={s.stamps}>{N.mil.stamps.map((t, i) => <span key={t.text} className={s.tierB} data-down={t.up ? undefined : ''} style={{ animationDelay: `${1.1 + i * 0.3}s` }}>{t.text.toUpperCase()}</span>)}</span></div></div>,
        line: say(B.milestone.rank, v, r) },
      chartBeat(p, x, v),
      N.mils.length > 1 && { gfx: true, head: ['Milestones', '◆', `${N.mils.length} tonight`], view: <div className={s.fan}>{[...N.mils].filter(m => m.p.n !== p.n).sort((a, b) => (b.stamps.some(t => t.up) ? 1 : 0) - (a.stamps.some(t => t.up) ? 1 : 0)).slice(0, 5).map((m, i, a) => <span key={m.p.n} className={s.fanItem} style={{ '--d': `${0.25 * i + 0.2}s` }}>{card(m.p, m.x, a.length > 4 ? 226 : 250, 0, (i - (a.length - 1) / 2) * 3)}<small>◆ {(m.stamps.find(t => t.up) || m.stamps[0]).text}</small></span>)}</div>,
        line: say(B.milestone.list, v, r) },
    ], tk(B.milestone) * combos(B.career))
  }

  // 6 · Elo movers
  const R = N.risers[0], F = N.fallers[0]
  if (R && F && R.p !== F.p) {
    const rows = [...N.risers.slice(0, 3), ...N.fallers.slice(0, 2)]
    seg('movers', 'Elo movers', [
      anchor(card(R.p, R.x, 196), 'Elo movers', say(B.movers.intro, { rname: bn(R.p.n), rdelta: f1(R.p.post - R.p.pre), fname: bn(F.p.n), fdelta: f1(F.p.pre - F.p.post) }, r), () => act.card(R.x.g, R.p)),
      { gfx: true, head: ['Elo movers', 'Risers & fallers', 'Tonight'], view: <div className={s.fan}>{rows.map(({ p, x }, i) => { const d = p.post - p.pre; return (
        <span key={p.n + i} className={s.fanItem} style={{ '--d': `${0.25 * i + 0.2}s` }}>{card(p, x, 226, 0, (i - 2) * 3)}<small className={d >= 0 ? s.up : s.dn}>{sgn(d)} ELO</small></span>) })}</div>,
        line: say(B.movers.fan, { rname: bn(R.p.n), r2: N.risers[1] && bn(N.risers[1].p.n), r2d: N.risers[1] && f1(N.risers[1].p.post - N.risers[1].p.pre),
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
    anchor(N.pd ? card(N.pd.p, N.pd.x, 196) : <span className={s.wordmark}><i>FS</i>TONIGHT</span>, 'FanSided Tonight', say(B.close.end, ov, r)),
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
  const segs = useMemo(() => buildShow(buildNight({ finals, live, side }), kit, seed, act, side, live), [sig, liveSig, seed, shots, hv])
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
