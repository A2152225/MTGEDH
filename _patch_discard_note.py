from pathlib import Path
import json

md_path = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.md')
md = md_path.read_text(encoding='utf-8')
old = '''### discard

- **Count:** 3
- **Status:** `partial`
- **Examples:** Depth Defiler, Distended Mindbender, Phantasmagorian
- **Static IR-wired (effect body):** 3/3
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Distended Mindbender reveal+dual CMV choose-from-it discard repaired (no grant_static). Depth Defiler kickerChooseBoth + then-discard who fixed.'''
new = '''### discard

- **Count:** 3
- **Status:** `partial`
- **Examples:** Depth Defiler, Distended Mindbender, Phantasmagorian
- **Static IR-wired (effect body):** 3/3
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Distended Mindbender reveal+dual CMV choose-from-it discard repaired (no grant_static). Depth Defiler kickerChooseBoth + then-discard who fixed. Phantasmagorian on-cast tax uses generic `any_player_may` discard window (see any_player_may_tax).'''
if old in md:
    md_path.write_text(md.replace(old, new, 1), encoding='utf-8')
    print('md discard updated')
else:
    print('md discard miss')

jp = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.json')
data = json.loads(jp.read_text(encoding='utf-8'))
if 'discard' in data.get('clusters', {}):
    data['clusters']['discard']['gap_notes'] = (
        'Distended Mindbender reveal+dual CMV choose-from-it discard repaired (no grant_static). '
        'Depth Defiler kickerChooseBoth + then-discard who fixed. '
        'Phantasmagorian on-cast tax uses generic any_player_may discard window.'
    )
    jp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('json discard updated')
