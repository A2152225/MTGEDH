import { describe, expect, it } from 'vitest';
import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';
import { parseOracleTextToIR } from '../src/oracleIRParser';

describe('blight fragment parsing', () => {
  it('parses target opponent blights via bare fragment', () => {
    const steps = parseBareTriggerEffectFragmentSteps('Target opponent blights 2.');
    expect(steps).toEqual([
      {
        kind: 'blight',
        who: { kind: 'target_opponent' },
        amount: { kind: 'number', value: 2 },
        raw: 'Target opponent blights 2',
      },
    ]);
  });

  it('parses target opponent blights via full card IR', () => {
    expect(parseOracleTextToIR('Target opponent blights 2.', 'Blight Ray').abilities[0]?.steps).toEqual([
      {
        kind: 'blight',
        who: { kind: 'target_opponent' },
        amount: { kind: 'number', value: 2 },
        raw: 'Target opponent blights 2',
      },
    ]);
  });
});
