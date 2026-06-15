#!/usr/bin/env python3
"""Run after build_elo.py to verify output contract is intact."""
import json, sys

print("Validating elo.json...")
data = json.load(open('public/data/elo.json'))
players = data['players']
errors = []

# Check required fields
required = ['name','current_elo','peak_elo','games_played','team','last_played',
            'is_fpr_eligible','fpr_rank','current_tpr_rank','peak_fpr_rank',
            'elo_history','team_history','badges']
for field in required:
    missing = [p['name'] for p in players[:10] if field not in p]
    if missing:
        errors.append(f"Missing field '{field}' on: {missing}")

# Check elo_history entry format (5 elements)
for p in players[:100]:
    for e in (p.get('elo_history') or [])[:5]:
        if len(e) != 5:
            errors.append(f"{p['name']}: elo_history entry has {len(e)} elements (expected 5): {e}")
            break

# Check fpr_rank is assigned for eligible players
eligible = [p for p in players if p.get('is_fpr_eligible')]
no_rank = [p['name'] for p in eligible if p.get('fpr_rank') is None]
if no_rank:
    errors.append(f"Eligible players missing fpr_rank: {no_rank[:5]}")

# Check fpr_rank #1 is most eligible player by current_elo
rank1 = next((p for p in players if p.get('fpr_rank') == 1), None)
best_elo = max(eligible, key=lambda p: p['current_elo'])
if rank1 and rank1['name'] != best_elo['name']:
    errors.append(f"fpr_rank #1 is {rank1['name']} but highest elo eligible is {best_elo['name']}")

# Check no retired players are eligible
for p in eligible:
    if p['last_played'] < '2025-01-01':
        errors.append(f"Retired player marked eligible: {p['name']} last played {p['last_played']}")

print(f"  {len(players)} players, {len(eligible)} eligible")

print("Validating games.json...")
games = json.load(open('public/data/games.json'))['games']
max_score = max(g['score'] for g in games)
min_score = min(g['score'] for g in games)
if abs(max_score - 100.0) > 0.5:
    errors.append(f"Games not normalized to 100: max={max_score}")
if not games:
    errors.append("games.json is empty")
print(f"  {len(games):,} games, score range {min_score:.1f}–{max_score:.1f}")

if errors:
    print(f"\n❌ VALIDATION FAILED ({len(errors)} errors):")
    for e in errors:
        print(f"  • {e}")
    sys.exit(1)
else:
    print("\n✅ All checks passed")
