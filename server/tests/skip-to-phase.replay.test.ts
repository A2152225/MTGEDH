import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('skipToPhase replay semantics', () => {
  it('replays trigger-stopped skips by restoring pendingPhaseSkip and TRIGGER_ORDER state', () => {
    const gameId = 't_skip_to_phase_trigger_stop_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    ResolutionQueueManager.removeQueue(gameId);
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'skip_trigger_1',
      sourceId: 'perm_1',
      sourceName: 'Trigger Source A',
      controllerId: p1,
      description: 'Draw a card.',
      triggerType: 'begin_combat',
      effect: 'Draw a card.',
      mandatory: true,
      triggeringPlayer: p1,
    } as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'skip_trigger_2',
      sourceId: 'perm_2',
      sourceName: 'Trigger Source B',
      controllerId: p1,
      description: 'Create a token.',
      triggerType: 'begin_combat',
      effect: 'Create a token.',
      mandatory: true,
      triggeringPlayer: p1,
    } as any);

    game.applyEvent({
      type: 'skipToPhase',
      playerId: p1,
      from: 'MAIN1',
      to: 'BEGIN_COMBAT',
      targetPhase: 'combat',
      targetStep: 'BEGIN_COMBAT',
      finalTargetPhase: 'postcombatMain',
      finalTargetStep: 'MAIN2',
      pendingPhaseSkip: {
        targetPhase: 'postcombatMain',
        targetStep: 'MAIN2',
        requestedBy: p1,
      },
      priority: p1,
      triggerOrderRequests: [
        {
          playerId: p1,
          description: 'Choose the order to put 2 triggered abilities on the stack',
          requireAll: true,
          triggers: [
            {
              id: 'skip_trigger_1',
              sourceName: 'Trigger Source A',
              effect: 'Draw a card.',
            },
            {
              id: 'skip_trigger_2',
              sourceName: 'Trigger Source B',
              effect: 'Create a token.',
            },
          ],
        },
      ],
    } as any);

    expect(String((game.state as any).phase || '')).toBe('combat');
    expect(String((game.state as any).step || '')).toBe('BEGIN_COMBAT');
    expect(String((game.state as any).priority || '')).toBe(p1);
    expect((game.state as any).pendingPhaseSkip).toEqual({
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
      requestedBy: p1,
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(2);
    expect(stack.map((item: any) => String(item.id))).toEqual(['skip_trigger_1', 'skip_trigger_2']);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('trigger_order');
    expect(String((queue.steps[0] as any)?.playerId || '')).toBe(p1);
    expect(((queue.steps[0] as any)?.triggers || []).map((trigger: any) => String(trigger.id))).toEqual([
      'skip_trigger_1',
      'skip_trigger_2',
    ]);
  });

  it('replays auto-continued skips by inferring the target phase from pendingPhaseSkip', () => {
    const gameId = 't_skip_to_phase_auto_continue_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'skipToPhase',
      playerId: p1,
      from: 'MAIN1',
      to: 'BEGIN_COMBAT',
      targetPhase: 'combat',
      targetStep: 'BEGIN_COMBAT',
      pendingPhaseSkip: {
        targetPhase: 'postcombatMain',
        targetStep: 'MAIN2',
        requestedBy: p1,
      },
      priority: p1,
    } as any);

    game.applyEvent({
      type: 'skipToPhase',
      playerId: p1,
      from: 'BEGIN_COMBAT',
      to: 'MAIN2',
      auto: true,
      reason: 'combat_triggers_resolved',
    } as any);

    expect(String((game.state as any).phase || '')).toBe('postcombatMain');
    expect(String((game.state as any).step || '')).toBe('MAIN2');
    expect((game.state as any).pendingPhaseSkip).toBeUndefined();
  });
});
