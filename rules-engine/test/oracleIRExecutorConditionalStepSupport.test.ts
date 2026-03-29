import { describe, expect, it } from 'vitest';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';

describe('oracleIRExecutorConditionalStepSupport', () => {
  it('treats contextual battlefield type checks as current-state permanent checks', () => {
    const state = {
      id: 'game1',
      format: 'commander',
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      startingLife: 40,
      life: {},
      turnPlayer: 'p1',
      priority: 'p1',
      stack: [],
      battlefield: [
        {
          id: 'target-perm',
          ownerId: 'p1',
          controller: 'p1',
          name: 'Transmuted Blessing',
          cardType: 'Enchantment',
          type_line: 'Enchantment',
          effectiveTypes: ['Enchantment', 'Artifact'],
          tapped: false,
          counters: {},
        },
      ],
      commandZone: {},
      phase: 'pre_game',
      active: true,
    } as any;

    const result = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: 'that permanent is an artifact' } as any,
      nextState: state,
      controllerId: 'p1' as any,
      ctx: { controllerId: 'p1', targetPermanentId: 'target-perm' } as any,
      lastActionOutcome: null,
    });

    expect(result).toBe(true);
  });
});