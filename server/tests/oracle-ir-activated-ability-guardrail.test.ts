import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function readModule(relativePath: string): string {
  return readFileSync(join(serverRoot, relativePath), 'utf8');
}

const abilityExecutionSource = readModule('src/state/modules/oracleIrAbilityExecution.ts');
const stepWiringSource = readModule('src/state/modules/oracleIrStepWiring.ts');
const spellExecutionSource = readModule('src/state/modules/oracleIrSpellExecution.ts');
const uncategorizedFallbackSource = readModule('src/state/modules/oracleIrUncategorizedSpellFallback.ts');

describe('oracle IR activated ability guardrail', () => {
  it('applies all parsed activated steps without allowlist filtering', () => {
    expect(abilityExecutionSource.includes('steps.filter(')).toBe(false);
    expect(abilityExecutionSource.includes('ORACLE_IR_ACTIVATED_STEP_KINDS.has')).toBe(false);
    expect(abilityExecutionSource.includes('applyOracleIRStepsOnServer(ctx, state, steps,')).toBe(true);
    expect(abilityExecutionSource.includes('isActivatedAbilityEffectFullyWired(steps)')).toBe(true);
    expect(abilityExecutionSource.includes('isOracleIrActivatedAbilityHandled(steps, result')).toBe(true);
  });

  it('centralizes wiring completeness in oracleIrStepWiring', () => {
    expect(stepWiringSource.includes('isOracleIrMandatoryExecutionComplete')).toBe(true);
    expect(stepWiringSource.includes('isOracleIrActivatedAbilityHandled')).toBe(true);
    expect(spellExecutionSource.includes('isOracleIrMandatoryExecutionComplete')).toBe(true);
    expect(spellExecutionSource.includes('hasUnqueuedPlayerChoiceGap')).toBe(true);
  });

  it('refuses uncategorized spell fallback when mandatory steps would be dropped', () => {
    expect(uncategorizedFallbackSource.includes('mandatoryIncluded.length < mandatoryAll.length')).toBe(true);
    expect(uncategorizedFallbackSource.includes('isOracleIrExecutionHandled(result, queueStart, queueAfter, parsedSteps)')).toBe(true);
  });
});
