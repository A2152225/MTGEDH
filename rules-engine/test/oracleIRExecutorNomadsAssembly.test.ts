import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe("Oracle IR Nomads' Assembly create_token for each creature", () => {
  const effectText = 'Create a 1/1 white Kor Soldier creature token for each creature you control.';
  const fullOracle =
    "Create a 1/1 white Kor Soldier creature token for each creature you control.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)";

  it('creates one Kor Soldier per creature you control', () => {
    const p1 = 'p1' as PlayerID;
    const steps = collectOracleEffectSteps(effectText, "Nomads' Assembly");
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 'c1', controller: p1, card: { type_line: 'Creature — Human' } },
        { id: 'c2', controller: p1, card: { type_line: 'Creature — Soldier' } },
        { id: 'c3', controller: p1, card: { type_line: 'Creature — Kor Warrior' } },
        { id: 'l1', controller: p1, card: { type_line: 'Basic Land — Plains' } },
        { id: 'opp1', controller: 'p2', card: { type_line: 'Creature — Goblin' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'nomads_1',
      sourceName: "Nomads' Assembly",
      sourceObjectType: 'spell',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;
    const tokens = nextState.battlefield?.filter((perm) => perm.isToken) ?? [];

    expect(steps[0]).toMatchObject({ kind: 'create_token', amount: { kind: 'x' } });
    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['create_token']);
    expect(tokens).toHaveLength(3);
    expect(
      tokens.every((token) =>
        /soldier/i.test(String(token.card?.name || token.name || token.card?.type_line || '')),
      ),
    ).toBe(true);
    expect(tokens.every((token) => token.controller === p1)).toBe(true);
  });

  it('still counts creatures when Rebound reminder text is present', () => {
    const p1 = 'p1' as PlayerID;
    const steps = collectOracleEffectSteps(fullOracle, "Nomads' Assembly").filter(
      (step) => step.kind === 'create_token',
    );
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 'c1', controller: p1, card: { type_line: 'Creature — Human' } },
        { id: 'c2', controller: p1, card: { type_line: 'Creature — Soldier' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'nomads_2',
      sourceName: "Nomads' Assembly",
      sourceObjectType: 'spell',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;

    expect(steps[0]).toMatchObject({ kind: 'create_token', amount: { kind: 'x' } });
    expect(nextState.battlefield?.filter((perm) => perm.isToken)).toHaveLength(2);
  });
});
