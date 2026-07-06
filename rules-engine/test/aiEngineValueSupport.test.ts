import { describe, expect, it } from 'vitest';

import { evaluateCombatValue, evaluateDeathTrigger } from '../src/aiEngineValueSupport';
import { hydratePermanentCardOracle } from '../../shared/src/hydrateCardOracleText';

const ZULAPORT_ORACLE =
  'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.';

describe('evaluateDeathTrigger', () => {
  it('scores Zulaport modestly in multiplayer', () => {
    const card = {
      name: 'Zulaport Cutthroat',
      oracle_text:
        'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
    };
    expect(evaluateDeathTrigger(card, 2)).toBe(6);
  });
});

describe('evaluateCombatValue', () => {
  it('does not want Zulaport to die in combat', () => {
    const perm = {
      card: {
        name: 'Zulaport Cutthroat',
        oracle_text:
          'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
        power: '1',
        toughness: '1',
      },
      counters: {},
    } as any;

    const evaluation = evaluateCombatValue(perm, 2);
    expect(evaluation.wantsToGetKilled).toBe(false);
    expect(evaluation.combatValue).toBeLessThan(-10);
  });

  it('penalizes Zulaport after hydrating missing battlefield oracle text', () => {
    const perm = {
      card: {
        name: 'Zulaport Cutthroat',
        type_line: 'Creature — Human Rogue Ally',
        power: '1',
        toughness: '1',
      },
      counters: {},
    } as any;

    hydratePermanentCardOracle(perm, (name) =>
      name.toLowerCase() === 'zulaport cutthroat'
        ? { oracle_text: ZULAPORT_ORACLE, type_line: 'Creature — Human Rogue Ally' }
        : undefined,
    );

    const evaluation = evaluateCombatValue(perm, 2);
    expect(evaluation.wantsToGetKilled).toBe(false);
    expect(evaluation.combatValue).toBeLessThan(-10);
  });
});
