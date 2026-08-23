from pathlib import Path
import json
from datetime import datetime

# Update markdown coverage
md_path = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.md')
md = md_path.read_text(encoding='utf-8')

# Update remaining priorities paragraph
old = '''Named retest priorities 1-8 are cleared. Remaining paper on-cast gaps are mostly cluster-level: **Brain Gorgers** any-player sacrifice tax UX; targeted Obligator/Flayer/Beast gain-control prompts; Dash Hopes / Temporal Extortion / Phantasmagorian any-player payment windows; Mutated Cultist remove-counters cost-reduce.'''

new = '''Named retest priorities 1-8 are cleared. Leftover clusters wired (2026-08-22 evening):
9. ~~**Brain Gorgers / Dash Hopes / Temporal Extortion / Phantasmagorian**~~ - **wired**: generic `any_player_may` IR + APNAP optional payment window (life / half-life / discard / sacrifice) with nested counter-on-pay.
10. ~~**Eldrazi Obligator / Flayer of Loyalties / The Beast / Hideous Taskmaster**~~ - **wired**: compound gain-control rider repair; creature target metadata; for-each-opponent multi maxTargets; `applyGainControlStep` until-EOT transfer.
11. ~~**Mutated Cultist**~~ - **wired**: `remove_counter` all/any from up-to-one permanent or opponent + `grant_next_spell_cost_reduction` for each counter removed this way.'''

if old in md:
    md = md.replace(old, new, 1)
else:
    print('WARN: remaining paragraph not found exactly')

# Update cluster gap notes
replacements = [
(
'''### gain_control

- **Count:** 6
- **Status:** `partial`
- **Examples:** Eldrazi Obligator, Emrakul, the Promised End, Emrakul, the World Anew, Flayer of Loyalties, Hideous Taskmaster
- **Static IR-wired (effect body):** 6/6
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Targeted gain-control (Obligator/Flayer/Beast) should prompt. Promised End control-next-turn + World Anew all-creatures-of-target-player use generic gain_control duration/raw handlers (no card-name path).''',
'''### gain_control

- **Count:** 6
- **Status:** `wired`
- **Examples:** Eldrazi Obligator, Emrakul, the Promised End, Emrakul, the World Anew, Flayer of Loyalties, Hideous Taskmaster
- **Static IR-wired (effect body):** 6/6
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Targeted gain-control (Obligator/Flayer/Beast) prompts + until-EOT transfer via repaired gain_control steps. Hideous Taskmaster for-each-opponent sets multi maxTargets. Promised End / World Anew remain on generic control-next-turn / bulk handlers.'''
),
(
'''### sacrifice

- **Count:** 4
- **Status:** `partial`
- **Examples:** Bearer of Silence, Brain Gorgers, Gluttonous Hellkite, Mana Vortex
- **Static IR-wired (effect body):** 4/4
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Bearer optional pay->opponent sacrifice wired via generic pay/If-you-do path. Mana Vortex on-cast counter-unless-sacrifice-land uses generic `unless_sacrifices`. Brain Gorgers any-player tax still special.''',
'''### sacrifice

- **Count:** 4
- **Status:** `wired`
- **Examples:** Bearer of Silence, Brain Gorgers, Gluttonous Hellkite, Mana Vortex
- **Static IR-wired (effect body):** 4/4
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Bearer optional pay->opponent sacrifice wired via generic pay/If-you-do path. Mana Vortex uses generic `unless_sacrifices`. Brain Gorgers uses generic `any_player_may` sacrifice payment window.'''
),
(
'''### any_player_may_tax

- **Count:** 2
- **Status:** `partial`
- **Examples:** Dash Hopes, Temporal Extortion
- **Static IR-wired (effect body):** 2/2
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Dash Hopes / Temporal Extortion / Brain Gorgers / Phantasmagorian: any-player payment window is specialized UX.''',
'''### any_player_may_tax

- **Count:** 2
- **Status:** `wired`
- **Examples:** Dash Hopes, Temporal Extortion
- **Static IR-wired (effect body):** 2/2
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Generic `any_player_may` IR + server OPTION_CHOICE APNAP window covers Dash Hopes / Temporal Extortion / Phantasmagorian / Brain Gorgers (life / half-life / discard / sacrifice).'''
),
(
'''### remove_counters_cost_reduce

- **Count:** 1
- **Status:** `unknown`
- **Examples:** Mutated Cultist
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Mutated Cultist remove-counters + cost reduction is uncommon.''',
'''### remove_counters_cost_reduce

- **Count:** 1
- **Status:** `wired`
- **Examples:** Mutated Cultist
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Generic remove-all-counters from up-to-one permanent/opponent + `grant_next_spell_cost_reduction` deferred via `nextSpellCostReduction` grants.'''
),
]

for a,b in replacements:
    if a in md:
        md = md.replace(a,b,1)
        print('replaced cluster block')
    else:
        print('MISS cluster block')

# Fixes landed bullet
if 'any_player_may tax windows' not in md:
    md = md.replace(
        '12. **Lashweed library_top metadata** - non-GY put-on-owner\'s-library destination inference.',
        '12. **Lashweed library_top metadata** - non-GY put-on-owner\'s-library destination inference.\n13. **Any-player-may tax windows** - generic `any_player_may` (life/half-life/discard/sacrifice) + APNAP prompts; Brain Gorgers / Dash Hopes / Temporal Extortion / Phantasmagorian.\n14. **Targeted gain-control on-cast** - Obligator compound rider repair; Flayer/Beast transfer; Taskmaster for-each-opponent maxTargets.\n15. **Mutated Cultist** - remove-all-counters + next-spell cost reduce for counters removed.',
        1,
    )
    print('added fixes landed bullets')

md_path.write_text(md, encoding='utf-8')
print('md updated')

# Update JSON if structured
jp = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.json')
data = json.loads(jp.read_text(encoding='utf-8'))

def touch_cluster(clusters, name, status, gap):
    if isinstance(clusters, list):
        for c in clusters:
            if c.get('pattern') == name or c.get('id') == name or c.get('name') == name:
                c['status'] = status
                c['gapNotes'] = gap
                c['gap_notes'] = gap
                return True
    elif isinstance(clusters, dict):
        if name in clusters:
            clusters[name]['status'] = status
            if 'gapNotes' in clusters[name]:
                clusters[name]['gapNotes'] = gap
            if 'gap_notes' in clusters[name]:
                clusters[name]['gap_notes'] = gap
            return True
    return False

# discover structure
print('json top keys', list(data.keys())[:20] if isinstance(data, dict) else type(data))
