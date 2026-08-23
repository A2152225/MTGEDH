from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorMainLoop.ts')
text = p.read_text(encoding='utf-8')

old = '''      case 'any_player_may': {
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

new = '''      case 'any_player_may': {
        const result = evaluateAnyPlayerMayStep(nextState, step as any, currentCtx);
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

        const anyPlayerMayNestedResult = recurse(nextState, (step as any).steps || [], currentCtx, options);
        nextState = anyPlayerMayNestedResult.state;
        log.push(...anyPlayerMayNestedResult.log);
        appliedSteps.push(...anyPlayerMayNestedResult.appliedSteps);
        skippedSteps.push(...anyPlayerMayNestedResult.skippedSteps);
        automationGaps.push(...anyPlayerMayNestedResult.automationGaps);
        pendingOptionalSteps.push(...anyPlayerMayNestedResult.pendingOptionalSteps);
        absorbExecutionReplayMutations(anyPlayerMayNestedResult);
        mergeNestedExecutionOutcome(anyPlayerMayNestedResult);
        appliedSteps.push(step);
        break;
      }
'''

if old not in text:
    raise SystemExit('old any_player_may case not found')
text = text.replace(old, new, 1)

# Fix grant_next_spell_cost_reduction to use log not appliedLogs
old2_start = text.find("case 'grant_next_spell_cost_reduction'")
if old2_start < 0:
    raise SystemExit('grant case missing')
# replace appliedLogs if present
text2 = text
# find the grant case block roughly
end = text.find("case 'any_player_may'", old2_start)
block = text[old2_start:end]
block2 = block.replace('appliedLogs.push', 'log.push')
text = text[:old2_start] + block2 + text[end:]

p.write_text(text, encoding='utf-8')
print('fixed main loop cases')
