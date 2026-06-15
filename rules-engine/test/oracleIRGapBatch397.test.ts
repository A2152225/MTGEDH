import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';
import { applyRemoveCounterStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.ts';
import {
  collectStepsFromIrText,
  dryRunOracleSteps,
  enrichAuditStateAndContextForCopySteps,
  enrichAuditStateAndContextForTargets,
  buildAuditExecutionContext,
  buildAuditFixtureState,
} from '../../server/scripts/executor-coverage-audit.ts';
import { collectUnknownIrGapsFromSteps } from '../../server/scripts/trigger-coverage-audit.ts';

describe('oracle IR gap batch397', () => {
  it('repairs Spry and Mighty compound spell steps', () => {
    const text =
      'Choose exactly two creatures you control. You draw X cards and the chosen creatures get +X/+X and gain trample until end of turn, where X is the difference between the powers of those creatures.';
    const ir = parseOracleTextToIR(text, 'Spry and Mighty');
    const steps = ir.abilities?.[0]?.steps || [];
    expect(steps.some((step) => step.kind === 'grant_temporary_ability' && /trample/i.test(String(step.raw || '')))).toBe(true);
    expect(steps.some((step) => step.kind === 'draw' && (step as any).amount?.kind === 'unknown')).toBe(false);
  });

  it('executes generic remove a counter from target permanent', () => {
    const steps = collectStepsFromIrText('Remove a counter from target permanent.', 'Spinal Parasite');
    let state = buildAuditFixtureState('Spinal Parasite', 'Creature — Horror');
    let ctx = buildAuditExecutionContext('Spinal Parasite');
    const e1 = enrichAuditStateAndContextForCopySteps({ name: 'Spinal Parasite', type_line: 'Creature — Horror' }, steps, state, ctx);
    const e2 = enrichAuditStateAndContextForTargets(steps, e1.state, e1.ctx, { cardName: 'Spinal Parasite', typeLine: 'Creature — Horror' });
    const result = applyRemoveCounterStep(e2.state, steps[0] as any, e2.ctx);
    expect(result.applied).toBe(true);
    const dry = dryRunOracleSteps(steps, 'Spinal Parasite', collectUnknownIrGapsFromSteps(steps), { typeLine: 'Creature — Horror' });
    expect(dry.status).toBe('fully_applied');
  });
});
