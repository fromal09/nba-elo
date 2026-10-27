// Achievements: badges on a binder, worked out from what's already recorded (cards, the Coin ledger,
// predictions), so nothing new has to be tracked except the best login streak.
// Each: { id, name, desc, group, earned, progress: [have, need] }
const DEFS = [
  // Collecting
  { id: 'legend', group: 'Collecting', name: 'Gold Standard', desc: 'Keep a Legend or better', need: 1, of: x => x.big },
  { id: 'icon', group: 'Collecting', name: 'Iconic', desc: 'Keep an Icon', need: 1, of: x => x.icon },
  { id: 'goat', group: 'Collecting', name: 'The GOAT', desc: 'Keep a GOAT card', need: 1, of: x => x.goat },
  { id: 'cards100', group: 'Collecting', name: 'Hundred Club', desc: 'Own 100 cards', need: 100, of: x => x.cards },
  { id: 'cards500', group: 'Collecting', name: 'Archivist', desc: 'Own 500 cards', need: 500, of: x => x.cards },
  { id: 'checklist', group: 'Collecting', name: 'Full Roster', desc: 'Complete a team-season checklist', need: 1, of: x => x.checklists },
  { id: 'set', group: 'Collecting', name: 'Set Builder', desc: 'Reach 10% of a league set', need: 1, of: x => x.sets },
  { id: 'duelcard', group: 'Collecting', name: 'Duelist', desc: 'Win a Duel of the Day card', need: 1, of: x => x.duelCards },
  // Showing up
  { id: 'streak7', group: 'Showing up', name: 'Regular', desc: 'A 7-day streak', need: 7, of: x => x.bestStreak },
  { id: 'streak30', group: 'Showing up', name: 'Season Ticket', desc: 'A 30-day streak', need: 30, of: x => x.bestStreak },
  { id: 'top10', group: 'Showing up', name: 'Top Ten', desc: 'Finish a week in the top 10 of the binder or pick’em standings', need: 1, of: x => x.top10 },
  // Predictions
  { id: 'perfect', group: 'Predictions', name: 'Clean Sheet', desc: 'A perfect day of picks', need: 1, of: x => x.perfect },
  { id: 'perfect10', group: 'Predictions', name: 'Oracle', desc: '10 perfect days', need: 10, of: x => x.perfect },
  { id: 'upsets10', group: 'Predictions', name: 'Giant Killer', desc: 'Call 10 upsets', need: 10, of: x => x.upsets },
  { id: 'beatfc', group: 'Predictions', name: 'Beat the Forecast', desc: 'Win 5 more picks than the Elo forecast expected', need: 5, of: x => Math.floor(x.over) },
  { id: 'locks5', group: 'Predictions', name: 'Lockdown', desc: 'Win 5 Locks of the Day', need: 5, of: x => x.locks },
  { id: 'matchups', group: 'Predictions', name: 'Scout', desc: 'Get every matchup right on a day', need: 1, of: x => x.duelPerfect },
  { id: 'lineup100', group: 'Predictions', name: 'Starting Five', desc: 'A lineup worth 100 Game Score', need: 100, of: x => Math.floor(x.lineupBest) },
]

export async function achievements(sql, userId) {
  const [x] = await sql`select
      (select count(*)::int from cards where user_id = ${userId}) as cards,
      (select count(*)::int from cards where user_id = ${userId} and tier in ('legend', 'icon', 'goat')) as big,
      (select count(*)::int from cards where user_id = ${userId} and tier in ('icon', 'goat')) as icon,
      (select count(*)::int from cards where user_id = ${userId} and tier = 'goat') as goat,
      (select count(*)::int from cards where user_id = ${userId} and tier = 'duel') as "duelCards",
      (select count(*)::int from coin_ledger where user_id = ${userId} and kind = 'checklist') as checklists,
      (select count(*)::int from coin_ledger where user_id = ${userId} and kind = 'set') as sets,
      (select greatest(best_streak, streak) from users where id = ${userId}) as "bestStreak",
      (select count(*)::int from coin_ledger where user_id = ${userId} and ((kind = 'weekly' and amount >= 500) or (kind = 'pickweekly' and amount >= 300))) as top10,
      (select count(*)::int from pred_days where user_id = ${userId} and correct = total) as perfect,
      (select count(*)::int from predictions where user_id = ${userId} and result = 'win' and bonus > 0) as upsets,
      (select coalesce(sum(case when result = 'win' then 1 else 0 end - chance), 0)::float from predictions where user_id = ${userId} and result in ('win', 'loss') and chance is not null) as over,
      (select count(*)::int from predictions where user_id = ${userId} and lock and result = 'win') as locks,
      (select count(*)::int from duel_days where user_id = ${userId} and total > 0 and correct = total) as "duelPerfect",
      (select coalesce(max(total), 0)::float from lineup_days where user_id = ${userId}) as "lineupBest"`
  return DEFS.map(d => { const have = Math.max(0, d.of(x) || 0); return { id: d.id, group: d.group, name: d.name, desc: d.desc, earned: have >= d.need, progress: [Math.min(have, d.need), d.need] } })
}
