import json
from pathlib import Path

jp = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.json')
data = json.loads(jp.read_text(encoding='utf-8'))

updates = {
  'gain_control': (
    'wired',
    'Targeted gain-control (Obligator/Flayer/Beast) prompts + until-EOT transfer via repaired gain_control steps. Hideous Taskmaster for-each-opponent sets multi maxTargets. Promised End / World Anew remain on generic control-next-turn / bulk handlers.',
  ),
  'sacrifice': (
    'wired',
    'Bearer optional pay->opponent sacrifice wired via generic pay/If-you-do path. Mana Vortex uses generic unless_sacrifices. Brain Gorgers uses generic any_player_may sacrifice payment window.',
  ),
  'any_player_may_tax': (
    'wired',
    'Generic any_player_may IR + server OPTION_CHOICE APNAP window covers Dash Hopes / Temporal Extortion / Phantasmagorian / Brain Gorgers (life / half-life / discard / sacrifice).',
  ),
  'remove_counters_cost_reduce': (
    'wired',
    'Generic remove-all-counters from up-to-one permanent/opponent + grant_next_spell_cost_reduction deferred via nextSpellCostReduction grants.',
  ),
}

for key, (status, gap) in updates.items():
    if key not in data['clusters']:
        print('MISS', key)
        continue
    data['clusters'][key]['status'] = status
    data['clusters'][key]['gap_notes'] = gap
    print('updated', key)

fixes = data.get('fixes')
if isinstance(fixes, list):
    fixes.append({
        'id': 13,
        'title': 'Any-player-may tax windows',
        'detail': 'Generic any_player_may (life/half-life/discard/sacrifice) + APNAP prompts; Brain Gorgers / Dash Hopes / Temporal Extortion / Phantasmagorian.',
    })
    fixes.append({
        'id': 14,
        'title': 'Targeted gain-control on-cast',
        'detail': 'Obligator compound rider repair; Flayer/Beast transfer; Taskmaster for-each-opponent maxTargets.',
    })
    fixes.append({
        'id': 15,
        'title': 'Mutated Cultist remove-counters cost-reduce',
        'detail': 'remove-all-counters + next-spell cost reduce for counters removed this way.',
    })
elif isinstance(fixes, dict):
    fixes['any_player_may'] = 'generic any_player_may tax windows'
    fixes['gain_control_targeted'] = 'Obligator/Flayer/Beast/Taskmaster gain-control'
    fixes['mutated_cultist'] = 'remove counters + next spell cost reduce'
else:
    data['fixes'] = [
        'any_player_may tax windows',
        'targeted gain-control on-cast',
        'Mutated Cultist remove-counters cost-reduce',
    ]

# Per-card notes if present
cards = data.get('cards')
if isinstance(cards, dict):
    for name in ['Brain Gorgers', 'Dash Hopes', 'Temporal Extortion', 'Phantasmagorian',
                 'Eldrazi Obligator', 'Flayer of Loyalties', 'The Beast, Deathless Prince',
                 'Hideous Taskmaster', 'Mutated Cultist']:
        if name in cards and isinstance(cards[name], dict):
            cards[name]['status'] = 'wired'
            cards[name]['gap_notes'] = 'Leftover cluster wired 2026-08-22'
            print('card', name)

data['audited_at'] = '2026-08-22T21:55:00-04:00'
jp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print('json written')
