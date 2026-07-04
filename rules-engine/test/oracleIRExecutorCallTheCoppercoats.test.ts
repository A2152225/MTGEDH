import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR Call the Coppercoats create_token X', () => {
  const effectText =
    'Create X 1/1 white Human Soldier creature tokens, where X is the number of creatures target opponents control.';

  it('creates tokens equal to creatures controlled by targeted opponents', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const steps = collectOracleEffectSteps(effectText, 'Call the Coppercoats');
    const state = {
      players: [{ id: p1 }, { id: p2 }, { id: p3 }],
      battlefield: [
        { id: 'c1', controller: p2, card: { type_line: 'Creature — Soldier' } },
        { id: 'c2', controller: p2, card: { type_line: 'Creature — Knight' } },
        { id: 'c3', controller: p3, card: { type_line: 'Creature — Goblin' } },
        { id: 'c4', controller: p1, card: { type_line: 'Creature — Elf' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'coppercoats_1',
      sourceName: 'Call the Coppercoats',
      sourceObjectType: 'spell',
      selectorContext: {
        chosenObjectIds: [p2, p3],
      },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['create_token']);
    expect(nextState.battlefield?.filter((perm) => perm.isToken)).toHaveLength(3);
    expect(nextState.battlefield?.every((perm) => !perm.isToken || perm.controller === p1)).toBe(true);
  });

  it('falls back to all opponents when no targets are bound', () => {
    const p1 = 'p1' as PlayerID;
    const steps = collectOracleEffectSteps(effectText, 'Call the Coppercoats');
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 'c1', controller: 'p2', card: { type_line: 'Creature — Soldier' } },
        { id: 'c2', controller: 'p2', card: { type_line: 'Creature — Knight' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'coppercoats_2',
      sourceName: 'Call the Coppercoats',
      sourceObjectType: 'spell',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['create_token']);
    expect(nextState.battlefield?.filter((perm) => perm.isToken)).toHaveLength(2);
  });
});
