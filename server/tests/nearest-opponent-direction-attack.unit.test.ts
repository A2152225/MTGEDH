import { describe, expect, it } from 'vitest';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import {
  getNearestOpponentDirectionAllowedDefenderId,
  getNearestOpponentDirectionAttackViolation,
  getNearestOpponentInChosenDirection,
  parseNearestOpponentDirectionAttackLock,
} from '../src/state/modules/nearestOpponentDirectionAttackRestriction.js';
import { removeExpiredUntilNextTurnEffects } from '../src/state/modules/turn-handlers/turnExpiredUntilNextTurnEffects.js';

// Official oracle (mtg_data.db / Teyo, Geometric Tactician −2):
// "Choose left or right. Until your next turn, each player may attack only the
// nearest opponent in the last chosen direction and planeswalkers controlled by
// that opponent."
const TEYO_DIRECTION_ABILITY =
  '−2: Choose left or right. Until your next turn, each player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent.';

function fourPlayerState() {
  return {
    players: [
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' },
      { id: 'p3', name: 'Player 3' },
      { id: 'p4', name: 'Player 4' },
    ],
    turnOrder: ['p1', 'p2', 'p3', 'p4'],
    battlefield: [
      {
        id: 'teyo_1',
        controller: 'p1',
        owner: 'p1',
        card: {
          id: 'teyo_card_1',
          name: 'Teyo, Geometric Tactician',
          type_line: 'Legendary Planeswalker — Teyo',
        },
      },
      {
        id: 'pw4_1',
        controller: 'p4',
        owner: 'p4',
        card: {
          id: 'pw4_card_1',
          name: 'Liliana of the Veil',
          type_line: 'Legendary Planeswalker — Liliana',
        },
      },
      {
        id: 'pw2_1',
        controller: 'p2',
        owner: 'p2',
        card: {
          id: 'pw2_card_1',
          name: 'Chandra, Torch of Defiance',
          type_line: 'Legendary Planeswalker — Chandra',
        },
      },
    ],
    life: { p1: 40, p2: 40, p3: 40, p4: 40 },
    turnNumber: 1,
    activePlayer: 'p1',
    zones: {
      p1: { hand: [], library: [], graveyard: [], exile: [] },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
      p3: { hand: [], library: [], graveyard: [], exile: [] },
      p4: { hand: [], library: [], graveyard: [], exile: [] },
    },
  };
}

function applyTeyoRightGrant() {
  const ctx = {
    state: fourPlayerState(),
    gameId: 'test_nearest_opponent_direction_teyo',
    bumpSeq: () => {},
    libraries: new Map(),
  } as any;

  const result = tryApplyOracleIRToActivatedAbility(ctx, {
    controller: 'p1',
    sourceName: 'Teyo, Geometric Tactician',
    oracleText: TEYO_DIRECTION_ABILITY,
    sourcePermanentId: 'teyo_1',
    selectedModeIds: ['Right'],
    allowOptional: true,
  });

  return { ctx, result };
}

describe('nearest-opponent direction attack lock', () => {
  it('parses chosen-direction text from the generic grant payload', () => {
    expect(parseNearestOpponentDirectionAttackLock(
      'Until your next turn, each player may attack only the nearest opponent to the right and planeswalkers controlled by that opponent',
    )).toMatchObject({ direction: 'right' });
    expect(parseNearestOpponentDirectionAttackLock(
      'Until your next turn, each player may attack only the nearest opponent to the left and planeswalkers controlled by that opponent',
    )).toMatchObject({ direction: 'left' });
    expect(parseNearestOpponentDirectionAttackLock(
      'Until your next turn, each player may attack only the nearest opponent in the last chosen direction and planeswalkers controlled by that opponent',
      { nearestOpponentAttackDirection: 'right', attackLock: 'nearest_opponent_in_direction' },
    )).toMatchObject({ direction: 'right' });
  });

  it('treats left as next-in-turn-order and right as previous', () => {
    const state = fourPlayerState();
    expect(getNearestOpponentInChosenDirection(state, 'p1', 'right')).toBe('p4');
    expect(getNearestOpponentInChosenDirection(state, 'p1', 'left')).toBe('p2');
    expect(getNearestOpponentInChosenDirection(state, 'p2', 'right')).toBe('p1');
    expect(getNearestOpponentInChosenDirection(state, 'p3', 'right')).toBe('p2');
  });

  it('after Teyo chooses Right, a player may attack only the nearest opponent that way and that opponent’s planeswalkers', () => {
    const { ctx, result } = applyTeyoRightGrant();
    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThanOrEqual(1);

    const grants = Array.isArray(ctx.state.staticAbilityGrantEffects)
      ? ctx.state.staticAbilityGrantEffects
      : [];
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.some((grant: any) =>
      /nearest opponent to the right/i.test(String(grant?.raw || ''))
      || (Array.isArray(grant?.effectText) && grant.effectText.some((text: string) => /nearest opponent to the right/i.test(text))),
    )).toBe(true);

    expect(getNearestOpponentDirectionAllowedDefenderId(ctx.state, 'p1')).toBe('p4');

    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p4',
    }).illegal).toBe(false);
    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p4',
    }).allowedDefenderId).toBe('p4');

    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p2',
    }).illegal).toBe(true);
    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p3',
    }).illegal).toBe(true);

    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p2',
      defendingPlayerId: 'p1',
    }).illegal).toBe(false);
    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p2',
      defendingPlayerId: 'p3',
    }).illegal).toBe(true);
  });

  it('does not use a card-name check: a structured nearest-opponent grant is enough', () => {
    const state = fourPlayerState();
    state.staticAbilityGrantEffects = [{
      id: 'generic:temp-static-grant:1',
      controllerId: 'p1',
      duration: 'until_next_turn',
      target: { kind: 'player_selector', text: 'each player' },
      nearestOpponentAttackDirection: 'right',
      attackLock: 'nearest_opponent_in_direction',
      effectText: ['Until your next turn, each player may attack only the nearest opponent to the right and planeswalkers controlled by that opponent'],
      raw: 'Until your next turn, each player may attack only the nearest opponent to the right and planeswalkers controlled by that opponent',
    }];

    expect(getNearestOpponentDirectionAttackViolation({
      state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p4',
    }).illegal).toBe(false);
    expect(getNearestOpponentDirectionAttackViolation({
      state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p2',
    }).illegal).toBe(true);
  });

  it('stamps turnApplied and drops the lock on the source controller’s next turn only', () => {
    const { ctx } = applyTeyoRightGrant();
    const grants = Array.isArray(ctx.state.staticAbilityGrantEffects)
      ? ctx.state.staticAbilityGrantEffects
      : [];
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.every((grant: any) => Number(grant?.turnApplied) === 1)).toBe(true);

    ctx.state.activePlayer = 'p2';
    ctx.state.turnNumber = 2;
    removeExpiredUntilNextTurnEffects(ctx, 'p2', 2);
    expect(Array.isArray(ctx.state.staticAbilityGrantEffects) ? ctx.state.staticAbilityGrantEffects.length : 0)
      .toBeGreaterThan(0);
    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p2',
    }).illegal).toBe(true);

    ctx.state.activePlayer = 'p3';
    ctx.state.turnNumber = 3;
    removeExpiredUntilNextTurnEffects(ctx, 'p3', 3);
    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p2',
    }).illegal).toBe(true);

    ctx.state.activePlayer = 'p1';
    ctx.state.turnNumber = 5;
    removeExpiredUntilNextTurnEffects(ctx, 'p1', 5);
    expect(ctx.state.staticAbilityGrantEffects || []).toEqual([]);
    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p2',
    }).illegal).toBe(false);
    expect(getNearestOpponentDirectionAllowedDefenderId(ctx.state, 'p1')).toBeUndefined();
  });

  it('allows a battle the locked opponent defends and rejects a battle someone else defends', () => {
    const { ctx } = applyTeyoRightGrant();
    ctx.state.battlefield.push(
      {
        id: 'battle_locked',
        controller: 'p1',
        owner: 'p1',
        protectorId: 'p4',
        defendingPlayerId: 'p4',
        card: {
          id: 'battle_locked_card',
          name: 'Invasion of Fiora',
          type_line: 'Battle — Siege',
        },
      },
      {
        id: 'battle_other',
        controller: 'p3',
        owner: 'p3',
        protectorId: 'p2',
        defendingPlayerId: 'p2',
        card: {
          id: 'battle_other_card',
          name: 'Invasion of Amonkhet',
          type_line: 'Battle — Siege',
        },
      },
    );

    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p1',
      targetPermanentId: 'battle_locked',
    }).illegal).toBe(false);
    expect(getNearestOpponentDirectionAttackViolation({
      state: ctx.state,
      attackerPlayerId: 'p1',
      defendingPlayerId: 'p3',
      targetPermanentId: 'battle_other',
    }).illegal).toBe(true);
  });
});
