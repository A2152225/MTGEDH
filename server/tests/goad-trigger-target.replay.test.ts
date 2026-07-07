import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('goad trigger target replay (P0)', () => {
  it('replays goadPermanent by restoring goadedBy and goadedUntil', () => {
    const gameId = 't_goad_permanent_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).turnNumber = 5;
    (game.state as any).battlefield = [{
      id: 'target_creature',
      controller: p2,
      owner: p2,
      counters: {},
      card: { id: 'target_card', name: 'Target Bear', type_line: 'Creature — Bear' },
    }];

    game.applyEvent({
      type: 'goadPermanent',
      permanentId: 'target_creature',
      goaderId: p1,
      expiryTurn: 6,
      oracleIrReplayMutation: true,
    } as any);

    const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === 'target_creature');
    expect(perm?.goadedBy).toContain(p1);
    expect(perm?.goadedUntil?.[p1]).toBe(6);
  });

  it('replays assignTriggeredAbilityTargets and clears the restored target prompt', () => {
    const gameId = 't_goad_target_prompt_clear_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    ResolutionQueueManager.removeQueue(gameId);
    (game.state as any).stack = [{
      id: 'trigger_goad_1',
      type: 'triggered_ability',
      controller: p1,
      sourceName: 'Vengeful Ancestor',
      effect: 'Goad target creature.',
      targets: [],
    }];

    ResolutionQueueManager.addStep(gameId, {
      id: 'goad_target_step',
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: p1,
      sourceId: 'trigger_goad_1',
      sourceName: 'Vengeful Ancestor',
      description: 'Goad target creature.',
      mandatory: true,
    } as any);

    game.applyEvent({
      type: 'assignTriggeredAbilityTargets',
      triggerStackItemId: 'trigger_goad_1',
      targets: ['target_creature'],
      resolvedStepId: 'goad_target_step',
    } as any);

    const stackItem = (game.state as any).stack.find((entry: any) => entry?.id === 'trigger_goad_1');
    expect(stackItem?.targets).toEqual(['target_creature']);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.steps.some((step: any) => String(step?.id || '') === 'goad_target_step')).toBe(false);
    expect(queue.activeStep?.id).not.toBe('goad_target_step');

    ResolutionQueueManager.removeQueue(gameId);
  });
});
