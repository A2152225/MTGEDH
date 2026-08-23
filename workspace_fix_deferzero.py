from pathlib import Path
path = Path(r"D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorMainLoop.ts")
text = path.read_text(encoding="utf-8")
old = """      case 'copy_spell': {
        if (shouldDeferStackSpellCopyToServer(currentCtx, step)) {
          const copyCount = Math.max(0, resolveCopySpellCount(nextState, controllerId, step, currentCtx));
          if (copyCount <= 0) {
            setLastStepOutcome(step, 'applied', { count: 0 });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copy spell produced 0 copies: ${step.raw}`);
            break;
          }

          const deferMessage = `Deferred ${copyCount} stack spell cop${copyCount === 1 ? 'y' : 'ies'} to server: ${step.raw}`;
          const gap = createOracleAutomationGapRecord({
            state: nextState,
            ctx: currentCtx,
            step,
            reasonCode: 'server_stack_copy_required',
            message: deferMessage,
            sequence: ++automationGapSequence,
            classification: 'ambiguous',
            metadata: { copyCount },
          });
          localAutomationGaps.push(gap);
          automationGaps.push(gap);
          appliedSteps.push(step);
          setLastStepOutcome(step, 'applied', { count: copyCount });
          log.push(`[oracle-ir] ${deferMessage}`);
          break;
        }
"""
new = """      case 'copy_spell': {
        if (shouldDeferStackSpellCopyToServer(currentCtx, step)) {
          // Always emit the server bridge gap — even when IR counts 0.
          // Sticky copyCount:0 / missing tax on a transient state must not swallow
          // commander-CZ (Storm suite / Hatut) or storm-count copies; the server
          // re-resolves from authoritative tax / cast ledgers.
          const copyCount = Math.max(0, resolveCopySpellCount(nextState, controllerId, step, currentCtx));
          const deferMessage = copyCount > 0
            ? `Deferred ${copyCount} stack spell cop${copyCount === 1 ? 'y' : 'ies'} to server: ${step.raw}`
            : `Deferred stack spell copy to server for re-resolve (IR count 0): ${step.raw}`;
          const gap = createOracleAutomationGapRecord({
            state: nextState,
            ctx: currentCtx,
            step,
            reasonCode: 'server_stack_copy_required',
            message: deferMessage,
            sequence: ++automationGapSequence,
            classification: 'ambiguous',
            metadata: { copyCount },
          });
          localAutomationGaps.push(gap);
          automationGaps.push(gap);
          appliedSteps.push(step);
          setLastStepOutcome(step, 'applied', { count: copyCount });
          log.push(`[oracle-ir] ${deferMessage}`);
          break;
        }
"""
if old not in text:
    raise SystemExit('main loop defer copy_spell block not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('patched oracleIRExecutorMainLoop.ts defer-on-zero')
print('size KB', round(path.stat().st_size/1024, 1))
