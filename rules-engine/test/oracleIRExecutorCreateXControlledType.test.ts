import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR create_token X by controlled type count', () => {
  it('creates Goblin tokens equal to Goblins you control (Krenko)', () => {
    const p1 = 'p1' as PlayerID;
    const effectText =
      'Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.';
    const steps = collectOracleEffectSteps(effectText, 'Krenko, Mob Boss');
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 'g1', controller: p1, card: { type_line: 'Creature — Goblin' } },
        { id: 'g2', controller: p1, card: { type_line: 'Creature — Goblin' } },
        { id: 'g3', controller: p1, card: { type_line: 'Creature — Goblin' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'krenko_1',
      sourceName: 'Krenko, Mob Boss',
      sourceObjectType: 'ability',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;
    const tokens = nextState.battlefield?.filter((perm) => perm.isToken) ?? [];

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['create_token']);
    expect(tokens).toHaveLength(3);
    expect(tokens.every((token) => token.card?.name === 'Goblin')).toBe(true);
    expect(tokens.every((token) => token.controller === p1)).toBe(true);
  });

  it('creates Human Soldier tokens equal to Humans you control when card name overlaps token type', () => {
    const p1 = 'p1' as PlayerID;
    const effectText =
      'Create X 1/1 white Human Soldier creature tokens, where X is the number of Humans you control.';
    const steps = collectOracleEffectSteps(effectText, 'Human Soldier');
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 'h1', controller: p1, card: { type_line: 'Creature — Human' } },
        { id: 'h2', controller: p1, card: { type_line: 'Creature — Human' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'horn_1',
      sourceName: 'Human Soldier',
      sourceObjectType: 'ability',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;
    const tokens = nextState.battlefield?.filter((perm) => perm.isToken) ?? [];

    expect(steps[0]?.token).toBe('1/1 white Human Soldier');
    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.card?.name === 'Human Soldier')).toBe(true);
  });

  it('creates colorless Soldier artifact tokens equal to Soldiers you control (Myrel)', () => {
    const p1 = 'p1' as PlayerID;
    const effectText =
      'Create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.';
    const steps = collectOracleEffectSteps(effectText, 'Myrel, Shield of Argive');
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 's1', controller: p1, card: { type_line: 'Creature — Soldier' } },
        { id: 's2', controller: p1, card: { type_line: 'Creature — Soldier' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'myrel_1',
      sourceName: 'Myrel, Shield of Argive',
      sourceObjectType: 'ability',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;
    const tokens = nextState.battlefield?.filter((perm) => perm.isToken) ?? [];

    expect(result.appliedSteps?.map((step) => step.kind)).toEqual(['create_token']);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.card?.name === 'Soldier')).toBe(true);
    expect(tokens.every((token) => String(token.card?.type_line || '').toLowerCase().includes('artifact'))).toBe(true);
    expect(tokens.every((token) => (token.card?.colors || []).length === 0)).toBe(true);
    expect(tokens.every((token) => token.controller === p1)).toBe(true);
  });
});
