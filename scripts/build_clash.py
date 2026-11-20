"""
build_clash.py — the data behind Full Court Clash (the Game Room's card table; src/clash/engine.js has the rules).

Reads the season files (public/data/explorer/YYYY-YY.json) and the all-time rankings (public/data/alltime.json) and
writes public/data/clash/:

  decks.json   {"K": [field names], "cards": [[...], ...],
                "franchise": {fc: {"easy"|"medium"|"hard"|"brutal": {"ids": [card index x15], "anchor": season|null}}},
                "lineups": [{"id", "name", "desc", "fixed"?, "easy"…: [ids]}],
                "daily": [card indexes: a spread of every franchise's cards, by cost, for the daily decks],
                "at100": [names in the All-Time top 100],
                "teams": {fc: {"name", "color"}}, "built": "YYYY-MM-DD"}
  pairs.json   [[name, name, games together]] every pair of teammates with 100+ games together (Real Duo)
  flags.json   {"<season>|<game id>|<name>": "p"|"c"|"s"|"d"…} the few abilities a binder card's stored line can't show:
               p Perfect Night (10+ shots, none missed), c Charity Stripe (20+ free throws made), s Sure Hands
               (15+ assists, no turnovers), d Debut (a player's first game on record)

A CPU deck is 15 cards from one franchise's history (or, for a lineup, any franchise in a decade). Cost comes from the
card's tier (the player's league rank that night, as packs grade it), power from Game Score ÷ 5 capped at 10. Every
level gets the same cost curve; the level sets how good the nights are:
  easy    the bottom half of the franchise's cards at each cost
  medium  the 15th–50th percentile from the top
(One card per player in every deck, as in yours.)
  hard    the 7th–20th percentile
  brutal  the top 8%, pulled toward the franchise's strongest season so its same-season bonuses stack
Run after split_elo.py (it calls this):  python3 scripts/build_clash.py
"""
import collections, json, random
from datetime import date
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
EX = DATA / "explorer"
OUT = DATA / "clash"
FR = ['ATL', 'BOS', 'BKN', 'CHO', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW', 'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL',
      'MIN', 'NOP', 'NYK', 'OKC', 'ORL', 'PHI', 'PHO', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS']
# Seasons a code covers that aren't the franchise (the Chicago Stags played as CHI before the Bulls existed)
NOT_FRANCHISE = {('CHI', s) for s in [f"{y}-{str(y + 1)[2:]}" for y in range(1946, 1966)]}
CURVE = {1: 4, 2: 3, 3: 3, 4: 2, 5: 2, 6: 1}
K = ['n', 'fc', 'o', 'd', 's', 'g', 'home', 'win', 'margin', 'ot', 'pos', 'pts', 'reb', 'ast', 'stl', 'blk', 'tp', 'min',
     'gs', 'lr', 'cost', 'pw', 'ab']


def tier_cost(rank):
    if rank is None: return 1
    return 6 if rank <= 1 else 5 if rank <= 5 else 4 if rank <= 20 else 3 if rank <= 50 else 2 if rank <= 125 else 1


def abilities(c):
    """Every ability a line earns (the engine fires the two rarest); mirrors src/clash/engine.js abilitiesOf()"""
    a = []
    pts, reb, ast, stl, blk, tp, mn = c['pts'], c['reb'], c['ast'], c['stl'], c['blk'], c['tp'], c['min']
    dd = sum(1 for x in (pts, reb, ast, stl, blk) if x is not None and x >= 10)
    if pts >= 50: a.append('fifty')
    if dd >= 4: a.append('quad')
    elif pts >= 10 and reb >= 10 and ast >= 10: a.append('triple')
    if blk is not None and blk >= 3: a.append('swat')
    if stl is not None and stl >= 3: a.append('pick')
    if ast >= 10: a.append('floor')
    if reb >= 15: a.append('glass')
    if tp is not None and tp >= 6: a.append('splash')
    if 'p' in c['flags']: a.append('perfect')
    if 'c' in c['flags']: a.append('charity')
    if mn is not None and mn >= 45: a.append('iron')
    if c['ot'] and c['win']: a.append('ot')
    if 'd' in c['flags']: a.append('debut')
    if c['home']: a.append('home')
    if pts >= 30 and mn is not None and mn <= 24: a.append('micro')
    if c['win'] and c['margin'] >= 40: a.append('blowout')
    if 's' in c['flags']: a.append('sure')
    if c['win'] and 0 < c['margin'] <= 4: a.append('clutch')
    if pts >= 50 and not c['win']: a.append('heat')
    return a


# Rarest first: the engine keeps a card's two rarest abilities. Fixed so a card's abilities don't shift night to night
AB_ORDER = ['quad', 'micro', 'perfect', 'sure', 'charity', 'heat', 'fifty', 'debut', 'triple', 'blowout', 'ot', 'splash',
            'iron', 'glass', 'floor', 'swat', 'pick', 'clutch', 'home']


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    seen, rows, flags = set(), [], {}
    pairs = collections.Counter()
    teams = {}
    for f in sorted(EX.glob('[0-9]*.json')):
        d = json.loads(f.read_text())
        C, s = d['cols'], d['season']
        for code, tm in d['teams'].items():
            teams[code] = {'name': tm['name'], 'color': tm.get('color')}
        for g in sorted(d['games'], key=lambda g: (g['date'], g['id'])):
            if min(g['pts']) < 50: continue  # a bad box score in the data
            pts = dict(zip(g['teams'], g['pts']))
            by_team = collections.defaultdict(list)
            for r in g['rows']:
                p = dict(zip(C, r))
                n, t = p['n'], p['t']
                fl = ''
                if n not in seen: fl += 'd'
                seen.add(n)
                if (p['fga'] or 0) >= 10 and p['fg'] == p['fga']: fl += 'p'
                if (p['ft'] or 0) >= 20: fl += 'c'
                if (p['ast'] or 0) >= 15 and p['tov'] == 0: fl += 's'
                if fl: flags[f"{s}|{g['id']}|{n}"] = fl
                if p['mp'] is None or p['mp'] > 0: by_team[t].append(n)
                if '@' in t or t not in FR or (t, s) in NOT_FRANCHISE: continue
                if p['gs'] is None or (p['mp'] is not None and p['mp'] < 10): continue
                o = [x for x in g['teams'] if x != t][0]
                win = pts[t] > pts[o]
                c = dict(n=n, fc=t, o=o, d=g['date'], s=s, g=g['id'], home=int(g['home'] == t), win=int(win), margin=pts[t] - pts[o],
                         ot=g['ot'] or '', pos=p['pos'] or '', pts=p['pts'] or 0, reb=p['trb'] or 0, ast=p['ast'] or 0, stl=p['stl'],
                         blk=p['blk'], tp=p['tp'], min=p['mp'], gs=p['gs'], lr=p['lr'], cost=tier_cost(p['lrp'] if p['lrp'] is not None else p['lr']),
                         flags=fl)
                c['ab'] = sorted(abilities(c), key=AB_ORDER.index)[:2]
                c['pw'] = max(0, min(10, round(c['gs'] / 5)))
                c['v'] = c['pw'] + 0.8 * len(c['ab'])
                rows.append(c)
            for names in by_team.values():
                for a, b in combinations(sorted(set(names)), 2): pairs[(a, b)] += 1
    print(f"  clash: {len(rows):,} franchise rows, {len(flags):,} flags")

    alltime = json.loads((DATA / 'alltime.json').read_text())['players'] if (DATA / 'alltime.json').exists() else []
    at100 = {p['name'] for p in alltime if p['rank'] <= 100}

    def build_deck(pool, mode, rng):
        by = collections.defaultdict(list)
        for c in pool: by[c['cost']].append(c)
        for k in by: by[k].sort(key=lambda c: -c['v'])
        need = dict(CURVE)
        for k in (6, 5, 4, 3, 2):  # costs a franchise lacks fall to the next lower cost
            have = len(by.get(k, []))
            keep = min(need[k], have // 2 if have >= 2 else have)
            need[k - 1] += need[k] - keep; need[k] = keep
        anchor = None
        if mode == 'brutal':
            bys = collections.defaultdict(list)
            for c in pool: bys[c['s']].append(c['v'])
            ss = {k: sum(sorted(v, reverse=True)[:12]) for k, v in bys.items()}
            anchor = max(ss, key=ss.get) if ss else None
        deck, per, ids = [], collections.Counter(), set()
        for k in sorted(need, reverse=True):
            lst = by.get(k, []); n = len(lst)
            if mode == 'brutal': lst = sorted(lst, key=lambda c: -(c['v'] + (3 if c['s'] == anchor else 0)))[:max(4, n // 10)]
            elif mode == 'hard': lst = lst[n // 14: max(n // 14 + 3, n // 5)]
            elif mode == 'medium': lst = lst[n // 6: max(n // 6 + 3, n // 2)]
            else: lst = lst[n // 2: max(n // 2 + 3, int(n * .85))]
            if mode in ('medium', 'easy'): lst = lst[:]; rng.shuffle(lst)
            got = 0
            for c in lst:
                if got >= need[k]: break
                if per[c['n']] >= 1 or id(c) in ids: continue
                deck.append(c); ids.add(id(c)); per[c['n']] += 1; got += 1
        rest = sorted(pool, key=lambda c: -c['v'])
        if mode == 'medium': rest = rest[len(rest) // 6:]
        if mode == 'easy': rest = rest[len(rest) // 2:]
        for c in rest:
            if len(deck) >= 15: break
            if per[c['n']] >= 1 or id(c) in ids: continue
            deck.append(c); ids.add(id(c)); per[c['n']] += 1
        return deck, anchor

    used, index = [], {}
    def use(c):
        if id(c) not in index: index[id(c)] = len(used); used.append(c)
        return index[id(c)]

    by_fc = collections.defaultdict(list)
    for c in rows: by_fc[c['fc']].append(c)
    franchise = {}
    for fc in FR:
        franchise[fc] = {}
        for mode in ('easy', 'medium', 'hard', 'brutal'):
            deck, anchor = build_deck(by_fc[fc], mode, random.Random(fc + mode))
            franchise[fc][mode] = {'ids': [use(c) for c in deck], 'anchor': anchor}

    lineups = []
    for y in range(1960, 2030, 10):
        lab = f"{y}s"
        pool = [c for c in rows if y <= int(c['s'][:4]) < y + 10]
        if len(pool) < 200: continue
        L = {'id': lab, 'name': f'The {lab}', 'desc': f'Cards from the {lab} seasons, any franchise.'}
        for mode in ('easy', 'medium', 'hard', 'brutal'):
            L[mode] = [use(c) for c in build_deck(pool, mode, random.Random(lab + mode))[0]]
        lineups.append(L)
    top = [p['name'] for p in sorted(alltime, key=lambda p: p['rank'])][:40]
    best = {}
    for c in rows:
        if c['n'] in top and (c['n'] not in best or c['v'] > best[c['n']]['v']): best[c['n']] = c
    at15 = [best[n] for n in top if n in best][:15]
    if len(at15) == 15:
        lineups.insert(0, {'id': 'at15', 'name': 'The All-Time 15', 'fixed': True,
                           'desc': 'The best card of each of the top 15 players in the All-Time rankings.', 'brutal': [use(c) for c in at15]})

    rng = random.Random(7)
    daily = []
    for fc in FR:
        pool = sorted(by_fc[fc], key=lambda c: -c['v'])
        for k in range(1, 7):
            lst = [c for c in pool if c['cost'] == k]
            n = len(lst)
            if not n: continue
            picks = lst[:3] + rng.sample(lst[n // 6:n // 2], min(3, max(0, n // 2 - n // 6))) + rng.sample(lst[n // 2:], min(3, n - n // 2))
            daily += [use(c) for c in picks]

    out = {
        'K': K, 'cards': [[c[k] for k in K] for c in used],
        'franchise': franchise, 'lineups': lineups, 'daily': daily,
        'at100': sorted(at100), 'teams': {fc: teams.get(fc, {'name': fc, 'color': None}) for fc in FR},
        'built': date.today().isoformat(),
    }
    (OUT / 'decks.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    duo = sorted([[a, b, n] for (a, b), n in pairs.items() if n >= 100], key=lambda x: -x[2])
    (OUT / 'pairs.json').write_text(json.dumps(duo, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (OUT / 'flags.json').write_text(json.dumps(flags, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f"  clash/decks.json {len(used):,} cards · pairs.json {len(duo):,} duos · flags.json {len(flags):,}")


if __name__ == '__main__':
    main()
