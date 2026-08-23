from pathlib import Path
import re

# ---------- postprocess: import + call repairs ----------
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
text = p.read_text(encoding='utf-8')

imports = '''import { repairAnyPlayerMayTaxSteps } from './oracleIRAnyPlayerMay';
import { repairGainControlCompoundRiderSteps } from './oracleIRGainControlCompoundRepair';
import { repairRemoveCountersCostReduceSteps } from './oracleIRRemoveCountersCostReduce';
'''

if 'repairAnyPlayerMayTaxSteps' not in text:
    # insert after first import block line
    # find last import near top - just prepend after existing imports that start with import
    m = re.search(r'(import .+?\n)(?!import )', text, re.S)
    # simpler: find first line starting with export or const after imports
    lines = text.splitlines(True)
    last_import = 0
    for i, line in enumerate(lines[:80]):
        if line.startswith('import '):
            last_import = i
    lines.insert(last_import + 1, imports)
    text = ''.join(lines)
    print('imports added')
else:
    print('imports present')

old = '''function repairAbilityExecutionSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const repairedFlat = mergeAdjacentCreateTokenFollowupSteps(
    repairFightDamageSourceSteps(
    repairFroghemothCounterAndLifeSteps(
      repairEmblemWithNestedConditionalSteps(
        repairEventideDrawLoseLifeSteps(
          repairCompoundExileLookSteps(
            repairGraveyardChooseThenReturnSteps(
              repairCopyRetargetTailSteps(
                repairRevealHandChooseFromItDiscardSteps(
                  repairTargetPlayerDrawThenDiscardSteps(
                    repairThatPlayerHandBottomThenDrawSteps(
                      repairMoveZoneSelectorSteps(steps),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
  );'''

new = '''function repairAbilityExecutionSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const repairedFlat = mergeAdjacentCreateTokenFollowupSteps(
    repairFightDamageSourceSteps(
    repairFroghemothCounterAndLifeSteps(
      repairEmblemWithNestedConditionalSteps(
        repairEventideDrawLoseLifeSteps(
          repairCompoundExileLookSteps(
            repairGraveyardChooseThenReturnSteps(
              repairCopyRetargetTailSteps(
                repairRevealHandChooseFromItDiscardSteps(
                  repairTargetPlayerDrawThenDiscardSteps(
                    repairThatPlayerHandBottomThenDrawSteps(
                      repairRemoveCountersCostReduceSteps(
                        repairGainControlCompoundRiderSteps(
                          repairAnyPlayerMayTaxSteps(
                            repairMoveZoneSelectorSteps(steps),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
  );'''

if 'repairAnyPlayerMayTaxSteps(' not in text:
    if old not in text:
        raise SystemExit('repairAbilityExecutionSteps block not found exactly')
    text = text.replace(old, new, 1)
    print('repair pipeline updated')
else:
    print('repair pipeline already updated')

p.write_text(text, encoding='utf-8')

# ---------- also try early parse of compound in ZoneAndRemoval or SimpleAction ----------
# Add tryParse at start of a clause parser in ZoneAndRemovalActions where unless_sacrifices lives
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserZoneAndRemovalActions.ts')
text = p.read_text(encoding='utf-8')
if 'tryParseAnyPlayerMayCompoundClause' not in text:
    # add import
    if "from './oracleIRAnyPlayerMay'" not in text:
        # find imports
        lines = text.splitlines(True)
        last_import = 0
        for i, line in enumerate(lines[:60]):
            if line.startswith('import '):
                last_import = i
        lines.insert(last_import + 1, "import { tryParseAnyPlayerMayCompoundClause } from './oracleIRAnyPlayerMay';\n")
        text = ''.join(lines)

    needle = "  const counterSelfUnlessSacrificeMatch = clause.match("
    insert = '''  const anyPlayerMayCompound = tryParseAnyPlayerMayCompoundClause(clause);
  if (anyPlayerMayCompound) {
    return withMeta(anyPlayerMayCompound as any);
  }

''' + needle
    if needle not in text:
        raise SystemExit('counterSelfUnlessSacrificeMatch missing')
    text = text.replace(needle, insert, 1)
    p.write_text(text, encoding='utf-8')
    print('zone parser early any_player_may added')
else:
    print('zone parser already has any_player_may')

# ---------- SimpleActionClauses: remove all counters + next spell cost reduce + gain_control compound ----------
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserSimpleActionClauses.ts')
text = p.read_text(encoding='utf-8')
if 'tryParseRemoveAllCountersFromTargetClause' not in text:
    lines = text.splitlines(True)
    last_import = 0
    for i, line in enumerate(lines[:80]):
        if line.startswith('import '):
            last_import = i
    lines.insert(
        last_import + 1,
        "import { tryParseRemoveAllCountersFromTargetClause, tryParseNextSpellCostReduceForCountersRemovedClause } from './oracleIRRemoveCountersCostReduce';\n",
    )
    text = ''.join(lines)

    # Insert before removeCounters match
    needle = "    const removeCounters = clause.match(/^remove\\s+((?:up\\s+to\\s+)?"
    insert = '''    const removeAllCountersTarget = tryParseRemoveAllCountersFromTargetClause(clause);
    if (removeAllCountersTarget) {
      return withMeta(removeAllCountersTarget as any);
    }

    const nextSpellCostReduceCounters = tryParseNextSpellCostReduceForCountersRemovedClause(clause);
    if (nextSpellCostReduceCounters) {
      return withMeta(nextSpellCostReduceCounters as any);
    }

''' + needle
    if needle not in text:
        raise SystemExit('removeCounters match missing')
    text = text.replace(needle, insert, 1)
    print('simple action remove-all/cost-reduce added')
else:
    print('simple action already has remove-all')

# Fix gain_control regex to prefer clean what + leave riders for sentence split
# Replace the gainControl match block to stop at until EOT and not require end of string for riders
old_gc = '''    const gainControl = clause.match(
      new RegExp(`^(?:for\\\\s+each\\\\s+opponent,\\\\s+)?${PLAYER_SUBJECT_PREFIX}gain(?:s)?\\\\s+control\\\\s+of\\\\s+(.+?)(?:\\\\s+(until\\\\s+end\\\\s+of\\\\s+turn|during\\\\s+that\\\\s+(?:player|opponent)['\\\\u2019]?s\\\\s+next\\\\s+turn|for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura\\\\s+is\\\\s+attached\\\\s+to\\\\s+it|for\\\\s+as\\\\s+long\\\\s+as\\\\s+you\\\\s+control\\\\s+[^.]+))?$`, 'i')
    );'''

# Actually the file uses template literal - let's find exact text
idx = text.find('const gainControl = clause.match(')
print('gainControl at', idx)
print(repr(text[idx:idx+450]))

p.write_text(text, encoding='utf-8')
print('simple action file written')
