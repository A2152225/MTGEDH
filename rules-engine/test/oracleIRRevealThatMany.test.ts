import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { applyRevealTopStep } from '../src/oracleIRExecutorPlayerSurveilLookRevealSteps.js';
import {
  isThatManyOrMuchRevealAmount,
  resolveThatManyRevealAmountForPlayer,
} from '../src/oracleIRExecutorRevealThatManyAmount.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

const WARP_WORLD_TEXT =
  "Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library.";

const leftoverRevealStep = {
  kind: 'reveal_top' as const,
  who: { kind: 'each_player' as const },
  amount: { kind: 'unknown' as const, raw: 'that many' },
  raw: 'then reveals that many cards from the top of their library',
};

function libraryCards(owner: string, count: number, typeLine = 'Instant'): any[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `card_${owner}_${index}`,
    name: `${owner} Card ${index}`,
    type_line: typeLine,
  }));
}

describe('Warp World reveal that many', () => {
  it('treats leftover JSON amounts as that many', () => {
    expect(isThatManyOrMuchRevealAmount({ kind: 'unknown', raw: 'that many' })).toBe(true);
    expect(isThatManyOrMuchRevealAmount(
      { kind: 'reference_amount', raw: 'then reveals that many cards from the top of their library' },
    )).toBe(true);
    expect(isThatManyOrMuchRevealAmount({ kind: 'number', value: 3 }, 'reveals that many cards')).toBe(false);
  });

  it('does not abort the whole reveal when one player is missing from the shuffle map', () => {
    expect(resolveThatManyRevealAmountForPlayer({
      playerId: 'p_missing',
      amount: { kind: 'reference_amount', raw: 'that many' },
      lastMovedCountByPlayer: { p_zxn0o5zz: 29, p_auypksa3: 24, p_5ggmq3yn: 31 },
    })).toBe(0);
    expect(resolveThatManyRevealAmountForPlayer({
      playerId: 'P_5GGMQ3YN',
      amount: { kind: 'reference_amount', raw: 'that many' },
      lastMovedCountByPlayer: { p_5ggmq3yn: 31 },
    })).toBe(31);
  });

  it('falls back to lastMovedCards owners when the count map is missing', () => {
    expect(resolveThatManyRevealAmountForPlayer({
      playerId: 'p1',
      amount: { kind: 'unknown', raw: 'that many' },
      ctx: {
        controllerId: 'p1' as PlayerID,
        lastMovedCards: [
          { id: 'a', owner: 'p1' },
          { id: 'b', owner: 'p1' },
          { id: 'c', ownerId: 'p2' },
        ],
      },
    })).toBe(2);
  });

  it('reveals leftover remaining steps after 903.9a even with an extra seat and unknown amount', () => {
    const p1 = 'p_zxn0o5zz' as PlayerID;
    const p2 = 'p_auypksa3' as PlayerID;
    const p3 = 'p_5ggmq3yn' as PlayerID;
    const extra = 'p_spectator' as PlayerID;
    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: libraryCards('p1', 29, 'Creature — Bear') },
        { id: p2, hand: [], graveyard: [], library: libraryCards('p2', 24, 'Land') },
        { id: p3, hand: [], graveyard: [], library: libraryCards('p3', 31, 'Enchantment') },
        { id: extra, hand: [], graveyard: [], library: libraryCards('extra', 4, 'Instant') },
      ],
      battlefield: [],
      life: { [p1]: 40, [p2]: 40, [p3]: 40, [extra]: 40 },
    } as unknown as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p3,
      sourceId: 'warp_world_copy',
      sourceName: 'Warp World',
      sourceObjectType: 'spell',
      lastMovedCountByPlayer: { [p1]: 29, [p2]: 24, [p3]: 31 },
    });
    const result = applyOracleIRStepsToGameState(state, [leftoverRevealStep as any], ctx, { allowOptional: true });

    expect(result.skippedSteps?.map((step) => step.kind)).not.toContain('reveal_top');
    expect(result.appliedSteps?.map((step) => step.kind)).toContain('reveal_top');
    expect(result.log?.some((line) => String(line).includes(`${p3} reveals`))).toBe(true);
    expect(result.log?.some((line) => /Skipped reveal-top/i.test(String(line)))).toBe(false);
  });

  it('uses lastMovedCards when leftover resume lost lastMovedCountByPlayer on currentCtx', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: libraryCards('p1', 3, 'Creature — Bear') },
        { id: p2, hand: [], graveyard: [], library: libraryCards('p2', 2, 'Land') },
      ],
      battlefield: [],
      life: { [p1]: 40, [p2]: 40 },
    } as unknown as GameState;

    const result = applyRevealTopStep(state, leftoverRevealStep as any, {
      controllerId: p1,
      lastMovedCards: [
        { id: 's1', owner: p1 },
        { id: 's2', owner: p1 },
        { id: 's3', owner: p2 },
      ],
    });

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.log.some((line) => String(line).includes(`${p1} reveals`))).toBe(true);
    expect((result as { lastRevealedCardCount?: number }).lastRevealedCardCount).toBe(3);
  });

  it('still reveals that many on the full Warp World path when a seat owns nothing', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const state = {
      players: [
        { id: p1, hand: [], graveyard: [], library: [{ id: 'card_p1_bolt', name: 'Bolt', type_line: 'Instant' }] },
        { id: p2, hand: [], graveyard: [], library: [{ id: 'card_p2_island', name: 'Island', type_line: 'Basic Land — Island' }] },
        { id: p3, hand: [], graveyard: [], library: [{ id: 'card_p3_forest', name: 'Forest', type_line: 'Basic Land — Forest' }] },
      ],
      battlefield: [
        {
          id: 'perm_p1',
          owner: p1,
          controller: p1,
          card: { id: 'card_p1_bear', name: 'Bear Cub', type_line: 'Creature — Bear' },
        },
        {
          id: 'perm_p2',
          owner: p2,
          controller: p2,
          card: { id: 'card_p2_land', name: 'Island', type_line: 'Basic Land — Island' },
        },
      ],
      life: { [p1]: 40, [p2]: 40, [p3]: 40 },
    } as unknown as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World'),
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp_world_spell',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
      }),
      { allowOptional: true },
    );

    expect(result.skippedSteps?.map((step) => step.kind)).not.toContain('reveal_top');
    expect(result.appliedSteps?.map((step) => step.kind)).toContain('reveal_top');
    expect(result.lastMovedCountByPlayer).toEqual({ [p1]: 1, [p2]: 1, [p3]: 0 });
  });
});
