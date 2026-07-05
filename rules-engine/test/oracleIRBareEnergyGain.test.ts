import { describe, expect, it } from 'vitest';

import { parseBareTriggerEffectFragmentSteps } from '../src/oracleIRParserPostprocess';

describe('parseBareTriggerEffectFragmentSteps energy gain', () => {
  it('parses you get two {E} as add_player_counter energy', () => {
    expect(parseBareTriggerEffectFragmentSteps('You get two {E}.')).toMatchObject([
      {
        kind: 'add_player_counter',
        counter: 'energy',
        amount: { kind: 'number', value: 2 },
      },
    ]);
  });

  it('parses compound gain life and energy', () => {
    expect(parseBareTriggerEffectFragmentSteps('You gain 2 life and get two {E}.')).toMatchObject([
      {
        kind: 'gain_life',
        amount: { kind: 'number', value: 2 },
      },
      {
        kind: 'add_player_counter',
        counter: 'energy',
        amount: { kind: 'number', value: 2 },
        sequence: 'then',
      },
    ]);
  });
});
