from pathlib import Path

p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorMainLoop.ts')
text = p.read_text(encoding='utf-8')

# Add import next to applySacrificeStep
if 'evaluateUnlessSacrificesStep' not in text:
    old = 'applySacrificeStep,'
    if old not in text:
        raise SystemExit('applySacrificeStep import missing')
    text = text.replace(old, 'applySacrificeStep,\n  evaluateUnlessSacrificesStep,', 1)

# Add case after unless_discards
old_case = """      case 'unless_discards': {
        const result = evaluateUnlessDiscardsStep(nextState, step, currentCtx);"""
# Find the full unless_discards case end - insert after it before unless_pays_mana
marker = "      case 'unless_pays_mana': {"
if marker not in text:
    raise SystemExit('unless_pays_mana case missing')

new_case = """      case 'unless_sacrifices': {
        const result = evaluateUnlessSacrificesStep(nextState, step, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep((result as any).innerStep ?? step, result.message, result.reason, {
            ...result.options,
            metadata: normalizeSkipMetadata(result.options?.metadata),
          });
          break;
        }

        if (result.state) {
          nextState = result.state;
        }
        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          appliedSteps.push(step);
          break;
        }

        const unlessSacrificesNestedResult = recurse(nextState, step.steps, currentCtx, options);
        nextState = unlessSacrificesNestedResult.state;
        log.push(...unlessSacrificesNestedResult.log);
        appliedSteps.push(...unlessSacrificesNestedResult.appliedSteps);
        skippedSteps.push(...unlessSacrificesNestedResult.skippedSteps);
        automationGaps.push(...unlessSacrificesNestedResult.automationGaps);
        pendingOptionalSteps.push(...unlessSacrificesNestedResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(unlessSacrificesNestedResult);
        mergeNestedExecutionOutcome(unlessSacrificesNestedResult);
        appliedSteps.push(step);
        break;
      }
      case 'unless_pays_mana': {"""

if 'case \'unless_sacrifices\'' in text:
    print('case already present')
else:
    text = text.replace(marker, new_case, 1)

# Check evaluateUnlessDiscardsStep import path - evaluateUnlessSacrifices from Battlefield
# Check current import block for Battlefield handlers
if 'from \'./oracleIRExecutorBattlefieldStepHandlers\'' in text or 'from "./oracleIRExecutorBattlefieldStepHandlers"' in text:
    print('battlefield import present')
else:
    # find applySacrificeStep import source
    idx = text.find('applySacrificeStep')
    print(repr(text[max(0,idx-200):idx+100]))

p.write_text(text, encoding='utf-8')
print('main loop patched')
