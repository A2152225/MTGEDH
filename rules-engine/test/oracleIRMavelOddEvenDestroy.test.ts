import { describe, expect, it } from 'vitest';

import { collectStepsFromIrText, dryRunOracleSteps } from '../../server/scripts/executor-coverage-audit';
import { parseDestroyChosenQualityTarget } from '../src/oracleIRExecutorZoneOps';

describe('marvel odd-even destroy IR', () => {
  it('parses destroy targets with chosen mana value parity', () => {
    expect(
      parseDestroyChosenQualityTarget({
        kind: 'raw',
        text: 'each other creature with mana value of the chosen quality',
      }),
    ).toEqual({ metric: 'mana_value', excludeSource: true });
  });

  it('dry-runs Thanos power-up odd-even destroy effect', () => {
    const text =
      'Put two +1/+1 counters on Thanos. Choose odd or even. Destroy each other creature with mana value of the chosen quality.';
    const steps = collectStepsFromIrText(text, 'Thanos, the Mad Titan');
    expect(steps.some((step) => step.kind === 'player_choice' && (step as any).choice === 'odd_even')).toBe(true);
    expect(
      steps.some(
        (step) =>
          step.kind === 'destroy'
          && String((step as any).target?.text || '').includes('mana value of the chosen quality'),
      ),
    ).toBe(true);

    const record = dryRunOracleSteps(steps, 'Thanos, the Mad Titan', [], {
      typeLine: 'Legendary Creature — Eternal Villain',
    });
    expect(['fully_applied', 'choice_required']).toContain(record.status);
    expect(record.reasonCodes.unsupported_selector || 0).toBe(0);
  });
});
