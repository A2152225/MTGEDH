import { describe, expect, it } from 'vitest';

import { AbilityType, parseOracleText } from '../src/oracleTextParser';
import { parseOracleTextToIR } from '../src/oracleIRParser';

describe('oracleTextParser ability classification (fast debug)', () => {
  it('classifies standalone look-top-X as spell ability, not static', () => {
    const parsed = parseOracleText(
      'Look at the top X cards of your library, where X is the number of lands you control.',
      'Test Card'
    );
    expect(parsed.abilities).toHaveLength(1);
    expect(parsed.abilities[0]?.type).toBe(AbilityType.SPELL);
  });

  it('classifies Mindskinner as replacement, Desmond as triggered, Mindcrank as triggered', () => {
    const cases: Array<{ name: string; text: string; type: AbilityType }> = [
      {
        name: 'Mindskinner',
        text: 'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.',
        type: AbilityType.REPLACEMENT,
      },
      {
        name: 'Desmond',
        text: 'Whenever Desmond Miles deals combat damage to a player, surveil X, where X is the amount of damage it dealt to that player.',
        type: AbilityType.TRIGGERED,
      },
      {
        name: 'Mindcrank',
        text: 'Whenever an opponent loses life, that player mills that many cards.',
        type: AbilityType.TRIGGERED,
      },
    ];

    for (const sample of cases) {
      const parsed = parseOracleText(sample.text, sample.name);
      expect(parsed.abilities[0]?.type, sample.name).toBe(sample.type);
    }
  });

  it('parses Mindskinner, Desmond, and Mindcrank IR steps', () => {
    const samples = [
      {
        name: 'Mindskinner',
        text: 'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.',
        expectedKinds: ['conditional'],
      },
      {
        name: 'Desmond',
        text: 'Whenever Desmond Miles deals combat damage to a player, surveil X, where X is the amount of damage it dealt to that player.',
        expectedKinds: ['surveil'],
      },
      {
        name: 'Mindcrank',
        text: 'Whenever an opponent loses life, that player mills that many cards.',
        expectedKinds: ['mill'],
      },
    ] as const;

    for (const sample of samples) {
      const ir = parseOracleTextToIR(sample.text, sample.name);
      const kinds = ir.abilities.flatMap(ability => ability.steps.map(step => step.kind));
      for (const kind of sample.expectedKinds) {
        expect(kinds, sample.name).toContain(kind);
      }
    }
  });
});
