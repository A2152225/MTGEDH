from pathlib import Path

# ---------- Main loop: import + case ----------
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorMainLoop.ts')
text = p.read_text(encoding='utf-8')

if 'evaluateAnyPlayerMayStep' not in text:
    # add import near evaluateUnlessSacrificesStep
    needle = 'evaluateUnlessSacrificesStep,'
    if needle in text:
        text = text.replace(needle, needle + '\n  evaluateAnyPlayerMayStep,', 1)
    else:
        # add standalone import
        lines = text.splitlines(True)
        last_import = 0
        for i, line in enumerate(lines[:120]):
            if line.startswith('import '):
                last_import = i
        lines.insert(last_import + 1, "import { evaluateAnyPlayerMayStep } from './oracleIRExecutorAnyPlayerMayStep';\n")
        text = ''.join(lines)
    print('import path for evaluateAnyPlayerMayStep')

# Fix import - check if evaluateUnlessSacrificesStep is imported from battlefield handlers
if "from './oracleIRExecutorAnyPlayerMayStep'" not in text and 'evaluateAnyPlayerMayStep' in text:
    # might have been added to a destructuring import from battlefield - check
    if 'evaluateAnyPlayerMayStep,' in text and "oracleIRExecutorAnyPlayerMayStep" not in text:
        # remove bad insert and add proper import
        text = text.replace('\n  evaluateAnyPlayerMayStep,', '', 1)
        lines = text.splitlines(True)
        last_import = 0
        for i, line in enumerate(lines[:150]):
            if line.startswith('import '):
                last_import = i
        lines.insert(last_import + 1, "import { evaluateAnyPlayerMayStep } from './oracleIRExecutorAnyPlayerMayStep';\n")
        text = ''.join(lines)
        print('fixed to dedicated import')

# Add case next to unless_sacrifices
if "case 'any_player_may'" not in text:
    needle = "      case 'unless_sacrifices': {"
    idx = text.find(needle)
    if idx < 0:
        raise SystemExit('unless_sacrifices case missing')
    # find end of that case (break;)
    # insert before unless_sacrifices case
    case_block = '''      case 'any_player_may': {
        const result = evaluateAnyPlayerMayStep(nextState, step as any, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep((result as any).innerStep ?? step, result.message, result.reason, {
            ...result.options,
          });
          if (result.state) nextState = result.state;
          break;
        }
        if (result.state) nextState = result.state;
        if (result.log?.length) appliedLogs.push(...result.log);
        appliedSteps.push(step);
        if (result.shouldApplyNestedSteps && Array.isArray((step as any).steps)) {
          const nested = executeOracleIRSteps(nextState, (step as any).steps, currentCtx, options);
          nextState = nested.state;
          appliedSteps.push(...(nested.appliedSteps || []));
          if (nested.log?.length) appliedLogs.push(...nested.log);
          if (nested.automationGaps?.length) {
            for (const gap of nested.automationGaps) automationGaps.push(gap);
          }
        }
        break;
      }
'''
    text = text[:idx] + case_block + text[idx:]
    print('added any_player_may case')
else:
    print('any_player_may case present')

# Also need grant_next_spell_cost_reduction case - simple no-op in engine + server bridge
# Look at how grant_static_ability is handled - server syncs casting modifiers.
# For grant_next_spell_cost_reduction, mark applied and let server sync via countersRemovedThisWay.

if "case 'grant_next_spell_cost_reduction'" not in text:
    needle = "      case 'any_player_may': {"
    idx = text.find(needle)
    case_block = '''      case 'grant_next_spell_cost_reduction': {
        const per = Boolean((step as any).perCountersRemoved);
        const countersRemoved = Number((currentCtx as any).countersRemovedThisWay ?? 0);
        const mana = String((step as any).mana || '{1}').trim();
        const genericFromMana = (mana.match(/\\{(\\d+)\\}/) || [])[1];
        const perAmount = Number.parseInt(String(genericFromMana || '1'), 10);
        const amount = per
          ? Math.max(0, countersRemoved) * (Number.isFinite(perAmount) ? perAmount : 1)
          : Number((step as any).amount || perAmount || 0);
        (currentCtx as any).pendingNextSpellCostReduction = {
          genericAmount: amount,
          mana,
          sourceName: String(currentCtx.sourceName || ''),
        };
        appliedSteps.push(step);
        appliedLogs.push(`Granted next-spell cost reduction of {${amount}} (countersRemoved=${countersRemoved})`);
        break;
      }
'''
    text = text[:idx] + case_block + text[idx:]
    print('added grant_next_spell_cost_reduction case')

p.write_text(text, encoding='utf-8')

# Ensure evaluateAnyPlayerMayStep isn't incorrectly in battlefield import list
# Check import lines
for line in text.splitlines():
    if 'evaluateAnyPlayerMayStep' in line or 'oracleIRExecutorAnyPlayerMayStep' in line:
        print('IMPORT LINE:', line[:200])

print('main loop done')
