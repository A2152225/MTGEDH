from pathlib import Path
import json
from datetime import datetime

md = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.md')
text = md.read_text(encoding='utf-8')

# Update remaining retest priorities
old = """4. **Commander *Storm* suite** (Echo/Fury/Genesis/Empyrial/Skull + Hatut) - copy count from CZ casts.
5. **Depth Defiler** - modal + kicker choose-both.
6. **Distended Mindbender / Mana Vortex** - not IR-fully-wired."""
new = """4. ~~**Commander *Storm* suite** (Echo/Fury/Genesis/Empyrial/Skull + Hatut)~~ - **wired** (2026-08-22): generic `resolveCommanderCastsFromCommandZoneThisGame` (taxById/2) feeds `resolveCopySpellCount` / server copy_spell push for all suite cards.
5. ~~**Depth Defiler**~~ - **wired** (2026-08-22): `kickerChooseBoth` on choose_mode; unkicked min=max=1; kicked auto-resolves both; target-player draw-then-discard who repair.
6. ~~**Distended Mindbender / Mana Vortex**~~ - **wired** (2026-08-22): reveal_hand+dual-filter discard repair; `unless_sacrifices` wraps counter_spell; both IR-fully-wired."""
if old not in text:
    raise SystemExit('md priorities missing')
text = text.replace(old, new, 1)

# Update executive summary fixes if present
if '### Fixes landed this pass' in text:
    # append items 9-11 before Top remaining
    anchor = '### Top remaining retest priorities'
    inject = """8. **Commander Storm CZ copy suite** - one generic taxById/2 cast count feeding copy_spell for Echo/Fury/Genesis/Empyrial/Skull (+ Hatut).
9. **Depth Defiler** - kickerChooseBoth forced-both when kicked; draw-then-discard subject repair inside modes.
10. **Distended Mindbender / Mana Vortex** - reveal_hand choose-from-it discard repair; unless_sacrifices for counter-unless-sacrifice-land.

"""
    if 'Commander Storm CZ copy suite' not in text:
        text = text.replace(anchor, inject + anchor, 1)

# Pattern cluster updates
text = text.replace(
  '**Gap notes:** Hatut commander-CZ copy path recently fixed (tax/2 + stack copies). Other *Storm commander-copy spells share the pattern but need retest per card.',
  '**Gap notes:** Generic `resolveCommanderCastsFromCommandZoneThisGame` (taxById sum/2) feeds `resolveCopySpellCount` + server deferred copy push. Suite unit tests cover Echo/Fury/Genesis/Empyrial/Skull + Hatut.',
  1,
)
text = text.replace(
  '**Gap notes:** Distended Mindbender hand-reveal choose-two not fully IR-wired (reveal_hand+grant_static+discard).',
  '**Gap notes:** Distended Mindbender reveal+dual CMV choose-from-it discard repaired (no grant_static). Depth Defiler kickerChooseBoth + then-discard who fixed.',
  1,
)
text = text.replace(
  '**Gap notes:** Bearer optional pay->opponent sacrifice wired via generic pay/If-you-do path. Brain Gorgers / Mana Vortex any-player tax still special.',
  '**Gap notes:** Bearer optional pay->opponent sacrifice wired via generic pay/If-you-do path. Mana Vortex on-cast counter-unless-sacrifice-land uses generic `unless_sacrifices`. Brain Gorgers any-player tax still special.',
  1,
)
text = text.replace(
  '| Distended Mindbender | discard | no | yes |',
  '| Distended Mindbender | discard | yes | yes |',
  1,
)
text = text.replace(
  '| Mana Vortex | sacrifice | no | no |',
  '| Mana Vortex | sacrifice | yes | no |',
  1,
)
text = text.replace(
  '**Static IR-wired (effect body):** 2/3',
  '**Static IR-wired (effect body):** 3/3',
  1,
)
text = text.replace(
  '**Static IR-wired (effect body):** 3/4',
  '**Static IR-wired (effect body):** 4/4',
  1,
)
# commander_cast_copy status
text = text.replace(
  '### commander_cast_copy\n\n- **Count:** 6\n- **Status:** `partial`',
  '### commander_cast_copy\n\n- **Count:** 6\n- **Status:** `wired`',
  1,
)

md.write_text(text, encoding='utf-8')
print('md updated')

# JSON
jp = Path(r'D:/Git/MTGEDH/tools/on-cast-trigger-coverage.json')
data = json.loads(jp.read_text(encoding='utf-8'))

def walk(obj):
  if isinstance(obj, dict):
    name = obj.get('name') or obj.get('card') or obj.get('cardName')
    if name in ('Distended Mindbender', 'Mana Vortex', 'Depth Defiler', 'Echo Storm', 'Fury Storm', 'Genesis Storm', 'Empyrial Storm', 'Skull Storm', 'Hatut Zeraze Strike Force'):
      if 'irWired' in obj: obj['irWired'] = True
      if 'ir_wired' in obj: obj['ir_wired'] = True
      if 'status' in obj and obj['status'] in ('partial', 'unknown', 'gap'):
        obj['status'] = 'wired'
    if obj.get('id') == 'commander_cast_copy' or obj.get('pattern') == 'commander_cast_copy':
      if 'status' in obj: obj['status'] = 'wired'
    for v in obj.values():
      walk(v)
  elif isinstance(obj, list):
    for v in obj:
      walk(v)

walk(data)
# bump date if present
if 'date' in data:
  data['date'] = '2026-08-22'
if 'updated' in data:
  data['updated'] = '2026-08-22'
jp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print('json updated')
