// Players the data renamed (one career that had been split under two names: see NAME_ALIASES in
// scripts/build_elo.py). Cards, wishes and lineups that carry an old name move to the new one, once.
export const RENAMES = {
  'Norm Van': 'Norm Van Lier', 'Dick Van': 'Dick Van Arsdale', 'Tom Van': 'Tom Van Arsdale', 'Jojo White': 'Jo Jo White',
  'Jan Van Breda Kolff': 'Jan van Breda Kolff', 'Larue Martin': 'LaRue Martin', 'Garfield Heard': 'Gar Heard',
  'Charlie Johnson': 'Charles Johnson', 'Emanuel Leaks': 'Manny Leaks', 'Fred Boyd': 'Freddie Boyd',
  'Isaac Stallworth': 'Bud Stallworth', 'John Clemens': 'Barry Clemens', 'Johnny Warren': 'John Warren',
  'Lou Dampier': 'Louie Dampier', 'Luke Rackley': 'Luther Rackley', 'Luther Burden': 'Ticky Burden',
  'Roland Taylor': 'Fatty Taylor', 'Tommy Patterson': 'Tom Patterson', 'William Averitt': 'Bird Averitt',
  'Ted, Hound': 'Ted McClain', 'Double D': 'Dwight Davis', 'Eldo Garrett': 'Dick Garrett', 'Dennis Layton': 'Mo Layton',
  'Arthur Williams': 'Art Williams',
}

export async function applyRenames(t) {
  await t`create table if not exists renames_done (old text primary key, done_at timestamptz not null default now())`
  const done = new Set((await t`select old from renames_done`).map(r => r.old))
  for (const [old, name] of Object.entries(RENAMES)) {
    if (done.has(old)) continue
    const tail = '|' + old
    // Game and Peak cards carry the name in row.n, Season cards in n; each ref ends with the name
    await t`update cards set card = jsonb_set(card, '{row,n}', to_jsonb(${name}::text)),
        ref = left(ref, length(ref) - ${tail.length}) || ${'|' + name}
      where card->'row'->>'n' = ${old} and right(ref, ${tail.length}) = ${tail}`
    await t`update cards set card = jsonb_set(card, '{n}', to_jsonb(${name}::text)),
        ref = left(ref, length(ref) - ${tail.length}) || ${'|' + name}
      where card->>'kind' = 'season' and card->>'n' = ${old} and right(ref, ${tail.length}) = ${tail}`
    await t`update wishes set name = ${name} where name = ${old}`
    await t`update lineups set player = ${name} where player = ${old}`
    await t`insert into renames_done (old) values (${old}) on conflict do nothing`
  }
}
