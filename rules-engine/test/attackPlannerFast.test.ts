/**
 * Large-board attack fast-path + sticky combat window.
 */

import { describe, expect, it } from 'vitest';
import { GameStep } from '../../shared/src/types.js';
import {
  planAttacksFast,
  shouldUseAttackPlannerFast,
} from '../src/ai/attackPlannerFast.js';
import {
  filterStickyAttacksToLegal,
  filterStickyBlocksToLegal,
  readStickyAttackPlan,
  readStickyBlockPlan,
  writeStickyAttackPlan,
  writeStickyBlockPlan,
} from '../src/ai/combatDecisionSticky.js';
import { creature } from './fixtures/combatAiFixtures.js';

function minimalState(args: {
  life: Record<string, number>;
  battlefield: ReturnType<typeof creature>['permanent'][];
  step?: GameStep;
  turnNumber?: number;
}) {
  const players = Object.keys(args.life).map((id) => ({
    id,
    name: id,
    life: args.life[id],
    spectator: false,
    isAI: id === 'ai-player',
  }));
  return {
    turn: args.turnNumber ?? 8,
    turnNumber: args.turnNumber ?? 8,
    step: args.step ?? GameStep.DECLARE_ATTACKERS,
    phase: 'combat',
    players,
    life: args.life,
    battlefield: args.battlefield,
  };
}

describe('shouldUseAttackPlannerFast', () => {
  it('triggers on large board or large attack pool', () => {
    expect(shouldUseAttackPlannerFast(25, 1)).toBe(true);
    expect(shouldUseAttackPlannerFast(10, 9)).toBe(true);
    expect(shouldUseAttackPlannerFast(24, 8)).toBe(false);
  });
});

describe('planAttacksFast', () => {
  it('keeps goaded and adds high-power voluntaries toward weakest life', () => {
    const goaded = creature('goad1', 1, 1, {}, { controllerId: 'ai-player' });
    const big = creature('big', 7, 7, {}, { controllerId: 'ai-player' });
    const small = creature('small', 1, 1, {}, { controllerId: 'ai-player' });
    const gameState = minimalState({
      life: { 'ai-player': 40, A: 12, B: 40 },
      battlefield: [goaded.permanent, big.permanent, small.permanent],
    });

    const out = planAttacksFast({
      gameState,
      playerId: 'ai-player',
      legalAttackerIds: ['goad1', 'big', 'small'],
      goaded: [{ creatureId: 'goad1', defendingPlayerId: 'B' }],
      battlefield: gameState.battlefield,
      maxVoluntary: 1,
    });

    expect(out.attackers).toEqual(
      expect.arrayContaining([
        { creatureId: 'goad1', defendingPlayerId: 'B' },
        { creatureId: 'big', defendingPlayerId: 'A' },
      ]),
    );
    expect(out.attackers.map((a) => a.creatureId)).not.toContain('small');
    expect(out.reason).toMatch(/^fast:/);
    expect(out.ms).toBeLessThan(50);
  });
});

describe('combatDecisionSticky', () => {
  it('reuses attack plan within the same step window and clears on step change', () => {
    const gameState = minimalState({
      life: { 'ai-player': 40, A: 40 },
      battlefield: [],
      step: GameStep.DECLARE_ATTACKERS,
      turnNumber: 3,
    });
    writeStickyAttackPlan(gameState, 'ai-player', [
      { creatureId: 'c1', defendingPlayerId: 'A' },
      { creatureId: 'c2', defendingPlayerId: 'A' },
    ]);
    expect(readStickyAttackPlan(gameState, 'ai-player')).toEqual([
      { creatureId: 'c1', defendingPlayerId: 'A' },
      { creatureId: 'c2', defendingPlayerId: 'A' },
    ]);
    expect(
      filterStickyAttacksToLegal(readStickyAttackPlan(gameState, 'ai-player')!, ['c1']),
    ).toEqual([{ creatureId: 'c1', defendingPlayerId: 'A' }]);

    gameState.step = GameStep.DECLARE_BLOCKERS;
    expect(readStickyAttackPlan(gameState, 'ai-player')).toBeNull();
  });

  it('keeps block sticky separate from attack sticky', () => {
    const gameState = minimalState({
      life: { 'ai-player': 40, A: 40 },
      battlefield: [],
      step: GameStep.DECLARE_BLOCKERS,
      turnNumber: 4,
    });
    writeStickyAttackPlan(gameState, 'ai-player', [
      { creatureId: 'atk', defendingPlayerId: 'A' },
    ]);
    // Attack write uses a different window kind; block write must not be clobbered by key.
    writeStickyBlockPlan(gameState, 'ai-player', [
      { blockerId: 'b1', attackerId: 'atk' },
    ]);
    expect(readStickyBlockPlan(gameState, 'ai-player')).toEqual([
      { blockerId: 'b1', attackerId: 'atk' },
    ]);
    expect(
      filterStickyBlocksToLegal(
        readStickyBlockPlan(gameState, 'ai-player')!,
        ['b1'],
        ['atk'],
      ),
    ).toEqual([{ blockerId: 'b1', attackerId: 'atk' }]);
    expect(
      filterStickyBlocksToLegal(
        readStickyBlockPlan(gameState, 'ai-player')!,
        ['b1'],
        ['other'],
      ),
    ).toEqual([]);
  });
});
