// Everest's tours. Each tour belongs to a place on the site (route: the view and its options) and is a list of steps:
//   [target, title, body, pose, extra]
// target: a CSS selector for the thing to light up (the first visible match), or null for a step in the middle of the
// screen. extra.text keeps only matches whose text includes it; extra.action adds a button that does something
// (open: click the target and end the tour, so the next room's tour can start).
// Room tours start themselves the first time you walk into that room; the welcome tour starts on your desk after you
// make your binder. The Tours menu in the header replays any of them.
import { BRAND } from '../brand.js'

const ST = cls => `[class*="_st_"][class*="_${cls}_"]`

export const TOURS = [
  {
    id: 'welcome', name: 'Welcome to the building', group: 'Start here', route: ['binders'], wait: '[class*="_albumBtn_"]',
    steps: [
      [null, 'Welcome. I’m Everest.', `This is ${BRAND.full}, and your binder is ready. Give me two minutes and I’ll show you where everything is: the rooms, your desk and your binder.`, 'wave2'],
      ['nav[aria-label="Sections"]', 'Seven rooms', 'The whole site is one building with seven rooms. This bar sits at the top of every page, on your phone too. I’ll walk you along it.', 'open'],
      ['[data-tour="tile-binders"]', 'My Desk', 'Your room. Your binder, today’s pack, your coins, your prize cards and today’s checklist. You’re standing in it.', 'chest_wave'],
      ['[data-tour="tile-library"]', 'The Library', 'Every league-wide binder: the Trophy case, league sets, a binder for every season, every franchise, the all-time legends and a catalog of every card.', 'open'],
      ['[data-tour="tile-scoreboard"]', 'The Scoreboard', 'Tonight’s games with live win chances, box scores, standings, Player of the Week and FanSided Tonight, our nightly show.', 'open'],
      ['[data-tour="tile-gameroom"]', 'The Game Room', 'Every game you can play: Pick’em, matchups, the Daily Lineup, Player of the Day, King of the Court, Hang the Banner and the Five Challenge.', 'hands_up'],
      ['[data-tour="tile-store"]', 'The Store', 'Spend coins on packs, and on cards from this day in league history.', 'shrug'],
      ['[data-tour="tile-rankings"]', 'Current Rankings', 'Every active player ranked by Elo, updated after every game, live while games are on.', 'open'],
      ['[data-tour="tile-elo"]', 'Elo Exploration', 'The archive: twelve ways into 80 years of ratings, from the Time Machine to Head-to-Head.', 'open'],
      ['[class*="_albumBtn_"]', 'Your binder', 'Every card you keep lands in here, nine to a sheet. Your best card shows through the cover window.', 'chest_wave'],
      ['[class*="_clip_"]', 'Today’s checklist', 'Everything worth doing today and what it pays. It ticks itself off as you go; tap a line to go do it.', 'open'],
      ['[class*="_obj_"]', 'A free pack every day', 'Open it here. You keep five cards, choosing one of three at a time. Keep a daily streak going for bonus packs, and claim a team pack every week.', 'hands_up'],
      ['[class*="_obj_"]', 'Coins', 'The coin stack opens the Store. You earn coins by opening packs, exploring the site and calling games right.', 'shrug', { text: 'STORE' }],
      ['[class*="_prizeObj_"], [class*="_envelope_"]', 'Prize cards', 'Win in the Game Room and a sealed envelope shows up here. Open it to choose your card. Cards you’ve won stand on the rack.', 'open'],
      ['[data-tour="tours"]', 'Come back any time', 'Every room has its own short tour the first time you walk in. This button replays any of them, including this one.', 'wave2'],
      ['[class*="_albumBtn_"]', 'Open your binder', 'Let’s look inside. I’ll show you how to find your way around it.', 'chest_wave', { action: 'open', label: 'Open my binder' }],
    ],
  },
  {
    id: 'binder', name: 'Your binder', group: 'My Desk', route: ['binders', { open: 'mine' }], wait: '[class*="_pocketBtn_"], [class*="_emptySheet_"]',
    steps: [
      [null, 'Your binder', 'Every card you own, in sheets of nine. Here’s how to get around it.', 'chest_wave'],
      ['[class*="_pocketBtn_"]', 'Pull a card out', 'Tap any card to pull it from its pocket: the full card, its back with the game it came from, what it’s worth in points, and Sell if you want coins for it.', 'open'],
      ['[class*="_pin_"]', 'Star your favorites', 'The star keeps a card in your Starred chapter. Starred cards are the ones you can put in your showcase.', 'open'],
      ['[class*="_showcase_"]', 'Your showcase', 'Three cards on the front page, the first thing other collectors see when they open your binder. Fill it from your starred cards.', 'chest_wave'],
      ['[class*="_navBtns_"] button', 'Table of Contents', 'The way around your binder. Chapter I is My Cards, by franchise, by decade or just the specials. II is your Wish List, III your Starred cards, IV the Checklists and V your Achievements.', 'open'],
      ['[class*="_navBtns_"] button', 'The Wish List', 'Wish for a player: any of his cards, one season’s or one tier’s, up to three at a time. Wished cards show up in your packs more often, and a meter guarantees one after enough near misses. Keep one and the wish is fulfilled.', 'hands_up'],
      ['[class*="_navBtns_"] button', 'Checklists', 'Every franchise’s rosters season by season, the special sets and the rewards, with what you have and what you’re missing. Finish a team-season for its Complete Set card.', 'open'],
      ['[class*="_findBox_"]', 'Find a player', 'Type a name to see only his cards.', 'open'],
      ['[class*="_sortSel_"]', 'Sort your sheets', 'Newest pulls, most points, highest Elo, rarest first, by game date or by name.', 'open'],
      ['[class*="_chip_"], [class*="_dock"] button', 'Sell cards', 'Turn cards you don’t need into coins. You’ll be asked before anything sells.', 'shrug', { text: 'Sell' }],
      ['[class*="_pagerNext_"], [class*="_pager"]', 'Turn the page', 'The arrows and dots turn sheets, and on a phone you can swipe. Your arrow keys work too.', 'open'],
      ['[class*="_lBtn_"], [class*="_dockHot_"]', 'Shortcuts', 'Your pack, your prize cards, the Store and the Game Room are one tap from your binder.', 'open'],
      [null, 'That’s your binder', 'Close it with the × or Esc. Next, walk into any room and I’ll show you around it.', 'wave2'],
    ],
  },
  {
    id: 'library', name: 'The Library', group: 'The Library', route: ['library'], wait: '#br-trophy',
    steps: [
      [null, 'The Library', 'Every binder that isn’t yours: the league’s leaders, every set, every season and every franchise.', 'open'],
      ['[class*="_heroBtn_"]', 'Find any career', 'Search any player since 1946 to open his career binder, every game he played as a card.', 'open'],
      ['#br-trophy', 'The Trophy case', 'The collectors with the best binders, scored the same way for everyone, and a gallery of the best cards pulled lately.', 'hands_up'],
      ['#br-sets', 'League sets', 'Fifteen sets of the greatest moments: title clinchers, the best games and debuts, 60-point nights, coronations, rivalries and more. A gold ribbon marks the sets you’ve started.', 'open'],
      ['#br-seasons', 'Seasons', 'A binder for every season, newest first, in the champion’s colors. Each holds that season’s Player of the Day and Player of the Week cards.', 'open'],
      ['#br-teams', 'Franchises', 'Every franchise, current and past, with every season on its shelf. Stars count titles.', 'open'],
      ['#br-legends', 'Legends', 'The 30 highest peak Elo ratings ever, each a career binder.', 'chest_wave'],
      ['#br-catalog', 'The card catalog', 'Every card on the site in one drawer cabinet: look up any player, season, set or tier.', 'open'],
    ],
  },
  {
    id: 'gameroom', name: 'The Game Room', group: 'The Game Room', route: ['gameroom'], wait: '[class*="_chalkGo_"]',
    steps: [
      [null, 'The Game Room', 'Every game on the site under one roof. Most of them pay coins, and the best days win cards. Let me walk you around the walls.', 'hands_up'],
      ['[class*="_chalkTeam_"]', 'Pick’em on the chalkboard', 'Tap a team to pick it to win, right on the board. The buttons under it open each pick sheet.', 'open'],
      ['[class*="_chalkGo_"]', 'Four pick sheets', 'Games (pick winners and set a lock), Matchups, your Lineup and the Player of the Day. The counts show what you’ve done today.', 'open'],
      [ST('fight'), 'Tale of the Tape', 'Each game’s featured matchup: two players, one from each team. Call who posts the higher Game Score.', 'f_flex'],
      [ST('magnet'), 'Daily Lineup', 'Put five of your own cards into tonight’s games. They score their Game Score times the card’s multiplier, and rarer cards multiply more.', 'open'],
      [ST('tote'), 'Player of the Day', 'Nominate the player you think has the best night. Call it and his card is yours in ruby.', 'hands_up'],
      [`${ST('cab')}`, 'King of the Court', 'One of your cards a game against a group of six, with a bounty for every Player of the Game. The 2-player cabinet is Rivalries: you against another collector, for a wager.', 'f_claws', { text: 'King' }],
      [`${ST('cab')}`, 'Hang the Banner', 'Every franchise has a ladder of its seasons. Beat each rung’s five with five of your own cards of that team. Every win opens a pack; climb the whole ladder and the Banner card is yours.', 'hands_high', { text: 'Banner' }],
      [`${ST('cab')}`, 'Five Challenge', 'Three lineups a week, the same for everyone: build a five from your cards and see how it ranks against every real five that franchise put on the floor.', 'open', { text: 'Five' }],
      ['[class*="_led_"]', 'High scores', 'This week’s Pick’em standings. The top 10 and top 50 are paid on Monday, and No. 1 wins the Player of the Week card.', 'open'],
      ['[class*="_prize_"]', 'The Prize Counter', 'Your record day by day on a calendar, and the prize cards you’ve won and haven’t chosen yet.', 'chest_wave'],
      ['[class*="_champ_"]', 'The champions’ wall', 'Player of the Week: the race this week and last week’s winner.', 'open'],
    ],
  },
  {
    id: 'pickem', name: 'Pick’em Night', group: 'The Game Room', route: ['gameroom', { open: 'predict' }], wait: '[class*="_opt_"]',
    steps: [
      ['[class*="_opt_"]', 'Circle a winner', 'Tap a team to pick it. Underdogs pay an upset bonus, and you can change a pick until its game tips off.', 'open'],
      ['[class*="_lockInk_"]', 'Your lock', 'One pick a day can be your Lock: its coins double if it’s right, and you lose the day’s pick coins if it’s wrong.', 'f_palms'],
      ['[class*="_photoPick_"]', 'The featured matchup', 'Tap a player’s photo in The Floor Times to call him for the higher Game Score.', 'open'],
      ['[class*="_btn_"]', 'How it works', 'The rules and the rewards live behind these buttons, so they stay out of your way.', 'shrug', { text: 'Rules' }],
    ],
  },
  {
    id: 'tape', name: 'Tale of the Tape', group: 'The Game Room', route: ['gameroom', { open: 'matchups' }], wait: '[class*="_tape"], [class*="_bout"]',
    steps: [
      [null, 'Tale of the Tape', 'Every game has a featured matchup: a player from each team rated 2,000 or better and off the injury report. Some are lopsided on purpose, so an underdog call can pay.', 'f_flex'],
      ['[class*="_tape"], [class*="_bout"]', 'Read the tape', 'Current Elo, this season’s change, the last game’s Game Score and box score, and their head-to-head record. Tap a card to take his corner.', 'open'],
    ],
  },
  {
    id: 'lineup', name: 'Daily Lineup', group: 'The Game Room', route: ['gameroom', { open: 'lineup' }], wait: '[class*="_teamSel_"]',
    steps: [
      [null, 'Daily Lineup', 'Five slots, filled from your own cards of players in tonight’s games. Each scores his Game Score times the card’s multiplier, 1 coin a point.', 'open'],
      ['[class*="_search_"]', 'Find your players', 'Search by name, or pick a team from the menu next to it.', 'open'],
      ['[class*="_claimBtn_"]', 'Add him', 'Rarer cards multiply more but need rest days after they play.', 'hands_up'],
    ],
  },
  {
    id: 'potd', name: 'Player of the Day', group: 'The Game Room', route: ['gameroom', { open: 'potd' }], wait: '[class*="_teamSel_"]',
    steps: [
      [null, 'Player of the Day', 'Call the night’s best player: the best Game Score plus a sixth of his Elo change. Get it right and his card is yours in ruby.', 'hands_up'],
      ['[class*="_claimBtn_"]', 'Nominate', 'One nomination a day. You can change it until his game tips off.', 'open'],
    ],
  },
  {
    id: 'koc', name: 'King of the Court', group: 'The Game Room', route: ['gameroom', { open: 'koc' }], wait: '[class*="_chooseBtn_"], [class*="_seg"]',
    steps: [
      [null, 'King of the Court', 'Play one of your cards in a game tonight. Highest Game Score in your group wins the game, and every Player of the Game carries a bounty.', 'f_claws'],
      ['[class*="_chooseBtn_"]', 'Choose your player', 'Pick from your cards of players in tonight’s games.', 'open'],
      ['button', 'Rivalries', 'Head to head with another collector for a wager: whoever wins more of the day’s games takes it.', 'f_flex', { text: 'Rivalries' }],
    ],
  },
  {
    id: 'banner', name: 'Hang the Banner', group: 'The Game Room', route: ['gameroom', { open: 'banner' }], wait: 'main, body',
    steps: [
      [null, 'Hang the Banner', 'Pick a franchise. Its ladder has a rung for every finished season, weakest first. Beat a rung’s five with five of your cards of that team, and the window of seasons your cards can come from narrows as you climb. Every win opens a pack; the top rung hangs the Banner card in your binder.', 'hands_high'],
    ],
  },
  {
    id: 'five', name: 'Five Challenge', group: 'The Game Room', route: ['gameroom', { open: 'five' }], wait: '[class*="_slotEmpty_"], [class*="_primary_"]',
    steps: [
      [null, 'Five Challenge', 'Three challenges a week, the same for everyone. Easy is one franchise in any era, Medium that franchise in one era, Hard one season.', 'open'],
      ['[class*="_primary_"]', 'Build a lineup', 'Up to five of your cards that fit. Your score is their combined Elo, ranked against every real five that franchise played. Coins pay out after the week.', 'hands_up'],
    ],
  },
  {
    id: 'prizes', name: 'The Prize Counter', group: 'The Game Room', route: ['gameroom', { open: 'history' }], wait: '[class*="_day_"]',
    steps: [
      ['[class*="_day_"]', 'Your calendar', 'Every day you played, with how your picks went. Tap a day to see every pick.', 'open'],
      [null, 'Prize cards', 'A day that won a card shows an envelope. Choose it here or from your desk.', 'chest_wave'],
    ],
  },
  {
    id: 'scoreboard', name: 'The Scoreboard', group: 'The Scoreboard', route: ['scoreboard'], wait: 'h1',
    steps: [
      [null, 'The Scoreboard', 'Every game by day, live. Choose Classic or Sportsbook, and switch any time.', 'open'],
      ['a:not([class*="_subBtn_"])', 'Its four tabs', 'Games by day, the Standings with playoff odds and award races, your predictions, and Player of the Week.', 'open', { text: 'Standings' }],
      ['input[type="date"], [class*="_switch_"]', 'Any day', 'Step back or ahead a day, or jump to a date.', 'open'],
      [null, 'Open a game', 'Tap any game for its box score, live win chance and every player’s Elo change. When games are final, FanSided Tonight recaps the night.', 'hands_up'],
    ],
  },
  {
    id: 'store', name: 'The Store', group: 'The Store', route: ['binders', { open: 'store' }], wait: '#st-packs',
    steps: [
      ['#st-packs', 'Packs', 'Pull one off the hook. Standard, an era, a team you pick, Playoff, Legend and GOAT, each with what it guarantees.', 'hands_up'],
      ['#st-otd', 'This day in history', 'Single cards from games played on today’s date, priced by rarity.', 'open'],
      ['[class*="_till_"]', 'Your coins', 'What you have and what you’ve earned today.', 'shrug'],
    ],
  },
  {
    id: 'rankings', name: 'Current Rankings', group: 'Current Rankings', route: ['rankings'], wait: 'main, h1',
    steps: [
      [null, 'Current Rankings', 'Every active player by current Elo. The top three stand on the podium, and every row shows his last move and his last 20 games.', 'open'],
      ['select, input', 'Search, filter and sort', 'Search a name, pick a team, switch between active and all players, and sort by Elo, peak, Game Score or games played.', 'open'],
      [null, 'Tap a player', 'Any player opens his full profile: his career Elo, his best games and his badges.', 'chest_wave'],
    ],
  },
  {
    id: 'elo', name: 'Elo Exploration', group: 'Elo Exploration', route: ['elo'], wait: 'h1',
    steps: [
      [null, 'Elo Exploration', 'The archive. Every rating since 1946, twelve ways in. Here’s each one.', 'open'],
      ['a:not([class*="_subBtn_"])', 'Time Machine', 'Build a league from any team-seasons in history, play an 82-game season and the playoffs, and open every box score.', 'hands_up', { text: 'Time Machine' }],
      ['a:not([class*="_subBtn_"])', 'Historical Elo Snapshots', 'The all-time rankings by peak Elo, and the rankings on any day in league history.', 'open', { text: 'Historical Elo Snapshots' }],
      ['a:not([class*="_subBtn_"])', 'Game Explorer', 'Every game, graded by the strength of the players in it.', 'open', { text: 'Game Explorer' }],
      ['a:not([class*="_subBtn_"])', 'Best Through X', 'Who had the highest Elo through exactly N games of his career.', 'open', { text: 'Best Through X' }],
      ['a:not([class*="_subBtn_"])', 'Mystery Player', 'Guess the player from his Elo chart, with a clue each round.', 'shrug', { text: 'Mystery Player' }],
      ['a:not([class*="_subBtn_"])', 'Franchise Tenures', 'Every player who wore a team’s jersey, by average Elo and games played.', 'open', { text: 'Franchise Tenures' }],
      ['a:not([class*="_subBtn_"])', 'Who’s Been Here?', 'Pick a franchise and an Elo level and see everyone who reached it there.', 'open', { text: 'Been Here' }],
      ['a:not([class*="_subBtn_"])', 'Head-to-Head', 'Two players side by side: their Elo, their stats and every game they shared.', 'f_flex', { text: 'Head-to-Head' }],
      ['a:not([class*="_subBtn_"])', 'Team Breakdown', 'Any current team, every player’s Elo and rank.', 'open', { text: 'Team Breakdown' }],
      ['a:not([class*="_subBtn_"])', 'Season by Season', 'The top five by Elo at the end of every season.', 'open', { text: 'Season by Season' }],
      ['a:not([class*="_subBtn_"])', 'Daily Changes', 'The latest day’s Elo moves and rank changes.', 'open', { text: 'Daily Changes' }],
      ['a:not([class*="_subBtn_"])', 'Methodology', 'How it all works: K-factors, era adjustments and who qualifies.', 'chest_wave', { text: 'Methodology' }],
    ],
  },
]

export const tourById = id => TOURS.find(t => t.id === id)
// Which tour a page starts on its first visit
export const ROOM_TOUR = { library: 'library', gameroom: 'gameroom', scoreboard: 'scoreboard', rankings: 'rankings', elo: 'elo' }
export const STATION_TOUR = { predict: 'pickem', matchups: 'tape', lineup: 'lineup', potd: 'potd', koc: 'koc', banner: 'banner', five: 'five', history: 'prizes' }
