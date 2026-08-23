from pathlib import Path
import json

md = Path(r'tools/on-cast-trigger-coverage.md')
text = md.read_text(encoding='utf-8')

# Strike remaining priorities 7-8
old = """7. **Emrakul Promised End / World Anew** - control-next-turn special flows.
8. **Lashweed Lurker** - put target permanent on top of library (non-GY destination metadata still thin)."""
new = """7. ~~**Emrakul Promised End / World Anew**~~ - **wired** (2026-08-22): generic control-next-turn (`during_that_players_next_turn` + `controlledPlayerNextTurn`) / bulk `all creatures target player controls` gain_control; preface uses `applyControlOfTargetOpponentNextTurnFromTrigger` (no card-name helper).
8. ~~**Lashweed Lurker**~~ - **wired** (2026-08-22): non-GY `targetDestination: library_top` (+ owner library) in `inferTriggeredAbilityTargetMetadata`."""
if old not in text:
    raise SystemExit('priorities 7-8 missing')
text = text.replace(old, new, 1)

anchor = '### Top remaining retest priorities'
inject = """11. **Control-next-turn / World Anew bulk control** - generic `during_that_players_next_turn` duration + applyGainControlStep handlers; preface renamed off Emrakul.
12. **Lashweed library_top metadata** - non-GY put-on-owner's-library destination inference.

"""
if 'Control-next-turn / World Anew' not in text:
    text = text.replace(anchor, inject + anchor, 1)

text = text.replace(
  '**Gap notes:** Targeted gain-control (Obligator/Flayer/Beast) should prompt; Emrakul Promised End / World Anew are special multi-turn control flows.',
  '**Gap notes:** Targeted gain-control (Obligator/Flayer/Beast) should prompt. Promised End control-next-turn + World Anew all-creatures-of-target-player use generic gain_control duration/raw handlers (no card-name path).',
  1,
)
text = text.replace(
  '**Gap notes:** Emrakul Aeons Torn shorthand + Promised End special-cased in on-cast path / dedicated Emrakul helpers.',
  '**Gap notes:** Emrakul Aeons Torn shorthand remains. Promised End uses generic control-next-turn pattern (`applyControlOfTargetOpponentNextTurnFromTrigger` / IR `during_that_players_next_turn`).',
  1,
)
text = text.replace(
  '**Gap notes:** Lashweed Lurker battlefield',
  '**Gap notes:** Wired: non-GY put-on-library sets `targetDestination: library_top` + `destinationUsesSelectedCardOwner`. Was: Lashweed Lurker battlefield',
  1,
)
# Fix if the replace made awkward text - check put_on_library_top section
# Better exact replace:
text2 = md.read_text(encoding='utf-8')  # no, use current text
# undo awkward and do exact
# find put_on_library_top gap notes
import re
text = re.sub(
    r'(\*\*Gap notes:\*\*) Wired: non-GY put-on-library sets `targetDestination: library_top` \+ `destinationUsesSelectedCardOwner`\. Was: Lashweed Lurker battlefield[^\n]*',
    r'\1 Non-GY put-on-library (Lashweed Lurker) sets `targetDestination: library_top` + `destinationUsesSelectedCardOwner` via generic oracle patterns.',
    text,
    count=1,
)
# If original wasn't replaced awkwardly, try original
if 'Non-GY put-on-library (Lashweed Lurker) sets' not in text:
    text = text.replace(
        '**Gap notes:** Lashweed Lurker battlefield→library_top: targetType inferred; destination metadata for non-GY bounce-to-library is thin vs GY path.',
        '**Gap notes:** Non-GY put-on-library (Lashweed Lurker) sets `targetDestination: library_top` + `destinationUsesSelectedCardOwner` via generic oracle patterns.',
        1,
    )
    # try unicode arrow variants
    for arrow in ['→', '->', '\u2192', '']:
        cand = f'**Gap notes:** Lashweed Lurker battlefield{arrow}library_top: targetType inferred; destination metadata for non-GY bounce-to-library is thin vs GY path.'
        if cand in text:
            text = text.replace(cand, '**Gap notes:** Non-GY put-on-library (Lashweed Lurker) sets `targetDestination: library_top` + `destinationUsesSelectedCardOwner` via generic oracle patterns.', 1)

# Update status lines for clusters
text = text.replace(
  '### gain_control\n\n- **Count:** 6\n- **Status:** `partial`',
  '### gain_control\n\n- **Count:** 6\n- **Status:** `partial`',
  1,
)
# put_on_library_top -> wired
text = text.replace(
  '### put_on_library_top\n\n- **Count:** 1\n- **Status:** `partial`',
  '### put_on_library_top\n\n- **Count:** 1\n- **Status:** `wired`',
  1,
)

md.write_text(text, encoding='utf-8')
print('md updated')

# JSON
jp = Path(r'tools/on-cast-trigger-coverage.json')
data = json.loads(jp.read_text(encoding='utf-8'))
clusters = data.get('clusters') or {}
if 'gain_control' in clusters:
    clusters['gain_control']['gap_notes'] = (
        'Targeted gain-control (Obligator/Flayer/Beast) should prompt. '
        'Promised End control-next-turn + World Anew all-creatures-of-target-player use generic gain_control duration/raw handlers.'
    )
if 'put_on_library_top' in clusters:
    clusters['put_on_library_top']['status'] = 'wired'
    clusters['put_on_library_top']['gap_notes'] = (
        'Non-GY put-on-library sets targetDestination library_top + destinationUsesSelectedCardOwner.'
    )
if 'extra_turn' in clusters:
    clusters['extra_turn']['gap_notes'] = (
        'Emrakul Aeons Torn shorthand remains. Promised End uses generic control-next-turn + take_extra_turn after-that-turn parse.'
    )

for card in data.get('cards') or []:
    name = card.get('name')
    if name == 'Lashweed Lurker':
        meta = card.setdefault('meta', {})
        meta['targetDestination'] = 'library_top'
    if name in ('Emrakul, the Promised End', 'Emrakul, the World Anew', 'Lashweed Lurker'):
        card['irWired'] = True

fixes = data.get('fixes')
if isinstance(fixes, list):
    for f in [
        'generic control-next-turn (during_that_players_next_turn + preface rename off Emrakul)',
        'World Anew-style all creatures target player controls gain_control',
        'non-GY library_top destination metadata (Lashweed)',
    ]:
        if f not in fixes:
            fixes.append(f)

jp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print('json updated')
