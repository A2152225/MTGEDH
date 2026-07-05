import { describe, expect, it } from 'vitest';

import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';

describe('parseBareTriggerEffectFragmentSteps counter from among', () => {
  it('parses compound +1/+1 and keyword counter-from-among on it', () => {
    expect(
      parseBareTriggerEffectFragmentSteps(
        'Put a +1/+1 counter and a counter from among flying, first strike, lifelink, or vigilance on it.',
      ),
    ).toMatchObject([
      {
        kind: 'add_counter',
        counter: '+1/+1',
        amount: { kind: 'number', value: 1 },
        target: { text: 'it' },
      },
      {
        kind: 'player_choice',
        choice: 'generic',
        options: ['flying', 'first strike', 'lifelink', 'vigilance'],
        sequence: 'then',
      },
    ]);
  });

  it('parses single choice of counter from among on this permanent', () => {
    expect(
      parseBareTriggerEffectFragmentSteps(
        'Put your choice of a counter from among first strike, vigilance, deathtouch, and lifelink on this permanent.',
      ),
    ).toMatchObject([
      {
        kind: 'player_choice',
        choice: 'generic',
        target: { text: 'this permanent' },
        options: ['first strike', 'vigilance', 'deathtouch', 'lifelink'],
      },
    ]);
  });
});
