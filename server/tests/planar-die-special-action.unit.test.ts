import { describe, expect, it } from 'vitest';

import {
  canTakePlanarDieAction,
  getPlanarDieActionCost,
  performPlanarDieSpecialAction,
} from '../src/state/modules/planarDieSpecialAction.js';

/** CR 901.9: roll in your own main phase, empty stack, with priority. 1st free, then {1}, {2}... */

function mainPhaseState(overrides: Record<string, unknown> = {}) {
  return {
    houseRules: { enablePlanechase: true },
    turnPlayer: 'p1',
    step: 'MAIN1',
    phase: 'precombatMain',
    stack: [],
    priority: 'p1',
    currentPlane: { id: 'plane-1', name: 'Plane 1', type_line: 'Plane — Test' },
    planarDeckFaceDown: [{ id: 'plane-2', name: 'Plane 2', type_line: 'Plane — Test' }],
    manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
    ...overrides,
  } as any;
}

const reason = (state: any, playerId = 'p1') => {
  const result = canTakePlanarDieAction(state, playerId);
  return result.ok ? 'ok' : result.reason;
};

describe('canTakePlanarDieAction (CR 901.9)', () => {
  it('allows the active player in main phase 1 or 2 with an empty stack and priority', () => {
    expect(canTakePlanarDieAction(mainPhaseState(), 'p1')).toEqual({ ok: true, cost: 0 });
    expect(canTakePlanarDieAction(mainPhaseState({ step: 'MAIN2' }), 'p1')).toEqual({ ok: true, cost: 0 });
  });

  it('refuses when Planechase is off, there is no planar deck, or it is not your turn', () => {
    expect(reason(mainPhaseState({ houseRules: {} }))).toMatch(/not enabled/);
    expect(reason(mainPhaseState({ currentPlane: undefined, planarDeckFaceDown: [] }))).toMatch(/no planar deck/);
    expect(reason(mainPhaseState(), 'p2')).toMatch(/active player/);
  });

  it('refuses outside a main phase, with a non-empty stack, or without priority', () => {
    expect(reason(mainPhaseState({ step: 'DECLARE_ATTACKERS' }))).toMatch(/main phase/);
    expect(reason(mainPhaseState({ stack: [{ id: 'x' }] }))).toMatch(/stack must be empty/);
    expect(reason(mainPhaseState({ priority: 'p2' }))).toMatch(/priority/);
  });

  it('charges generic mana equal to the rolls already taken this turn', () => {
    const state = mainPhaseState({ planarDieSpecialActionsThisTurn: { p1: 2 } });
    expect(getPlanarDieActionCost(state, 'p1')).toBe(2);
    expect(canTakePlanarDieAction(state, 'p1')).toEqual({ ok: true, cost: 2 });
    expect(getPlanarDieActionCost(state, 'p2')).toBe(0);
  });
});

describe('performPlanarDieSpecialAction', () => {
  const ctxOf = (state: any) => ({ state, gameId: '', bumpSeq() {} }) as any;

  it('pays a paid roll from the floating pool and spends nothing when short', () => {
    const state = mainPhaseState({ planarDieSpecialActionsThisTurn: { p1: 2 } });
    state.manaPool.p1.green = 1;
    state.manaPool.p1.colorless = 0;
    const short = performPlanarDieSpecialAction(ctxOf(state), 'p1', { face: 'blank' });
    expect(short.ok).toBe(false);
    expect(state.manaPool.p1.green).toBe(1);
    expect(state.planarDieSpecialActionsThisTurn.p1).toBe(2);

    state.manaPool.p1.red = 1;
    const paid = performPlanarDieSpecialAction(ctxOf(state), 'p1', { face: 'blank' });
    expect(paid).toMatchObject({ ok: true, cost: 2, actionsThisTurn: 3 });
    expect(state.manaPool.p1.green + state.manaPool.p1.red).toBe(0);
  });

  it('uses the injected random source to pick a face', () => {
    const state = mainPhaseState();
    const result = performPlanarDieSpecialAction(ctxOf(state), 'p1', { random: () => 0 }); // first face: chaos
    expect(result).toMatchObject({ ok: true, face: 'chaos' });
    expect(state.lastPlanarDieRoll).toMatchObject({ playerId: 'p1', face: 'chaos' });
  });
});
