import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { isNoOpOptionalCombatDamagePayLife } from '../src/oracleIRExecutorCombatDamageCounts.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('combat damage draw reference_amount', () => {
  it('draws equal to opponents dealt combat damage this turn', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const state = {
      players: [
        { id: p1, name: 'P1', hand: [], library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
        { id: p2, name: 'P2', hand: [], library: [] },
        { id: p3, name: 'P3', hand: [], library: [] },
      ],
      battlefield: [],
      creaturesThatDealtDamageToPlayer: {
        [p2]: { atk1: { creatureName: 'Attacker', totalDamage: 2 } },
        [p3]: { atk2: { creatureName: 'Attacker', totalDamage: 3 } },
      },
    } as unknown as GameState;

    const effect = 'Draw cards equal to the number of opponents who were dealt combat damage this turn.';
    const steps = collectOracleEffectSteps(effect, 'Moonshae Pixie');
    const ctx = buildOracleIRExecutionContext({ controllerId: p1, sourceName: 'Moonshae Pixie' });
    const result = applyOracleIRStepsToGameState(state, steps, ctx);

    expect(result.skippedSteps).toEqual([]);
    expect(result.state.players.find((p: any) => p.id === p1)?.hand?.length).toBe(2);
  });

  it('draws and loses life for combat-damage-by-source count', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const state = {
      players: [
        { id: p1, name: 'P1', hand: [], library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], life: 40 },
        { id: p2, name: 'P2', hand: [], library: [], life: 40 },
        { id: p3, name: 'P3', hand: [], library: [], life: 40 },
      ],
      life: { [p1]: 40, [p2]: 40, [p3]: 40 },
      battlefield: [
        {
          id: 'estinien_perm',
          controller: p1,
          card: { name: 'Estinien Varlineau', type_line: 'Creature — Human Knight' },
        },
        {
          id: 'dragon_perm',
          controller: p1,
          card: { name: 'Test Dragon', type_line: 'Creature — Dragon' },
        },
      ],
      creaturesThatDealtDamageToPlayer: {
        [p2]: { estinien_perm: { creatureName: 'Estinien Varlineau', totalDamage: 3 } },
        [p3]: { dragon_perm: { creatureName: 'Test Dragon', totalDamage: 4 } },
      },
    } as unknown as GameState;

    const effect =
      'you draw x cards and lose x life, where x is the number of your opponents who were dealt combat damage by this permanent or a dragon this turn';
    const steps = collectOracleEffectSteps(effect, 'Estinien Varlineau');
    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'estinien_perm',
      sourceName: 'Estinien Varlineau',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx);

    expect(result.skippedSteps).toEqual([]);
    expect(result.state.players.find((p: any) => p.id === p1)?.hand?.length).toBe(2);
    expect(result.state.players.find((p: any) => p.id === p1)?.life).toBe(38);
  });

  it('pays X life and draws X for opponents dealt combat damage this turn', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const state = {
      players: [
        { id: p1, name: 'P1', hand: [], library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], life: 40 },
        { id: p2, name: 'P2', hand: [], library: [], life: 40 },
        { id: p3, name: 'P3', hand: [], library: [], life: 40 },
      ],
      life: { [p1]: 40, [p2]: 40, [p3]: 40 },
      battlefield: [],
      creaturesThatDealtDamageToPlayer: {
        [p2]: { atk1: { creatureName: 'Attacker A', totalDamage: 2 } },
        [p3]: { atk2: { creatureName: 'Attacker B', totalDamage: 3 } },
      },
    } as unknown as GameState;

    const effect =
      'you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.';
    const steps = collectOracleEffectSteps(effect, 'Tymna the Weaver');
    expect(steps.some((step) => step.kind === 'lose_life' && (step as any).optional === true)).toBe(true);
    expect(steps.some((step) => (
      step.kind === 'conditional'
      && String((step as any).condition?.raw || '') === 'you do'
      && Array.isArray((step as any).steps)
      && (step as any).steps.some((inner: any) => inner.kind === 'draw')
    ))).toBe(true);

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceName: 'Tymna the Weaver',
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });

    expect(result.skippedSteps).toEqual([]);
    expect(result.state.players.find((p: any) => p.id === p1)?.hand?.length).toBe(2);
    expect(result.state.players.find((p: any) => p.id === p1)?.life).toBe(38);
  });

  it('treats optional pay-X-life as a no-op when no opponents took combat damage', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const effect =
      'you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.';
    const empty = {
      players: [{ id: p1 }, { id: p2 }],
      creaturesThatDealtDamageToPlayer: {},
    } as unknown as GameState;
    const damaged = {
      players: [{ id: p1 }, { id: p2 }],
      creaturesThatDealtDamageToPlayer: {
        [p2]: { atk: { creatureName: 'Attacker', totalDamage: 1 } },
      },
    } as unknown as GameState;

    expect(isNoOpOptionalCombatDamagePayLife(empty, p1, effect)).toBe(true);
    expect(isNoOpOptionalCombatDamagePayLife(damaged, p1, effect)).toBe(false);
  });
});
