from pathlib import Path

# casting-modifiers: import + add to getDynamicBattlefieldCostReduction
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/casting-modifiers.ts')
text = p.read_text(encoding='utf-8')
if 'getActiveNextSpellCostReduction' not in text:
    lines = text.splitlines(True)
    last_import = 0
    for i, line in enumerate(lines[:40]):
        if line.startswith('import '):
            last_import = i
    lines.insert(
        last_import + 1,
        "import { getActiveNextSpellCostReduction } from './nextSpellCostReduction.js';\n",
    )
    text = ''.join(lines)

    needle = '''  if (!card) return reduction;

  const cardTypeLineValue = getCardTypeLine(card);'''
    insert = '''  if (!card) return reduction;

  const deferredNextSpell = getActiveNextSpellCostReduction(state, playerId);
  if (deferredNextSpell > 0) {
    reduction.generic += deferredNextSpell;
    reduction.messages.push(`Next-spell cost reduction: -{${deferredNextSpell}}`);
  }

  const cardTypeLineValue = getCardTypeLine(card);'''
    if needle not in text:
        raise SystemExit('getDynamic needle missing')
    text = text.replace(needle, insert, 1)
    p.write_text(text, encoding='utf-8')
    print('hooked dynamic cost reduction')
else:
    print('already hooked casting-modifiers')

# Consume on cast - find consumeConvokeGrantsAfterCast call sites in game-actions
p2 = Path(r'D:/Git/MTGEDH/server/src/socket/game-actions.ts')
text2 = p2.read_text(encoding='utf-8')
if 'consumeNextSpellCostReductionAfterCast' not in text2:
    # add import near other casting-modifier imports
    if "from '../state/modules/casting-modifiers" in text2 or "casting-modifiers.js" in text2:
        text2 = text2.replace(
            "from '../state/modules/casting-modifiers.js';",
            "from '../state/modules/casting-modifiers.js';\nimport { consumeNextSpellCostReductionAfterCast } from '../state/modules/nextSpellCostReduction.js';",
            1,
        )
        if 'consumeNextSpellCostReductionAfterCast' not in text2.split('nextSpellCostReduction')[0]:
            # try alternate import path styles
            pass
    if "from '../state/modules/nextSpellCostReduction.js'" not in text2:
        # find a casting-modifiers import
        import re
        m = re.search(r"import \{[^}]+\} from '\.\./state/modules/casting-modifiers\.js';", text2)
        if m:
            text2 = text2[:m.end()] + "\nimport { consumeNextSpellCostReductionAfterCast } from '../state/modules/nextSpellCostReduction.js';" + text2[m.end():]
        else:
            # prepend near top imports - find first import from state/modules
            m = re.search(r"import .+ from '\.\./state/modules/[^']+';\n", text2)
            if not m:
                raise SystemExit('no state modules import')
            text2 = text2[:m.end()] + "import { consumeNextSpellCostReductionAfterCast } from '../state/modules/nextSpellCostReduction.js';\n" + text2[m.end():]

    # call near consumeConvokeGrantsAfterCast
    if 'consumeConvokeGrantsAfterCast' in text2:
        text2 = text2.replace(
            'consumeConvokeGrantsAfterCast(',
            'consumeNextSpellCostReductionAfterCast(game.state as any, playerId as any);\n      consumeConvokeGrantsAfterCast(',
            1,
        )
        print('consume hooked near convoke')
    else:
        print('WARNING: consumeConvokeGrantsAfterCast not found - manual hook needed')

    p2.write_text(text2, encoding='utf-8')
else:
    print('consume already in game-actions')

print('cost reduction hooks done')
