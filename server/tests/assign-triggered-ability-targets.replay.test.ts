import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('assignTriggeredAbilityTargets replay semantics (later11)', () => {
  it('replays assignTriggeredAbilityTargets by stamping target ids onto the matching trigger stack item', () => {
    const gameId = 't_assign_triggered_ability_targets_replay';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    // Seed the stack with a triggered-ability item awaiting a graveyard target.
    (game.state as any).stack = [
      {
        id: 'trigger_stack_1',
        type: 'triggered_ability',
        controller: p1,
        sourceName: 'Test Gearhulk',
        targets: [],
        targetZone: 'graveyard',
        targetDestination: 'battlefield',
        source: 'gearhulk_perm',
        permanentId: 'gearhulk_perm',
        triggerType: 'etb',
      },
    ];

    game.applyEvent({
      type: 'assignTriggeredAbilityTargets',
      triggerStackItemId: 'trigger_stack_1',
      targets: ['grizzly_bears_card'],
    });

    const stack: any[] = (game.state as any).stack;
    const item = stack.find((s) => s?.id === 'trigger_stack_1');
    expect(item).toBeDefined();
    expect(item.targets).toEqual(['grizzly_bears_card']);
  });

  it('replays assignTriggeredAbilityTargets as a no-op when the stack item is missing', () => {
    const gameId = 't_assign_triggered_ability_targets_replay_missing';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).stack = [];
    expect(() =>
      game.applyEvent({
        type: 'assignTriggeredAbilityTargets',
        triggerStackItemId: 'missing_trigger',
        targets: ['some_card'],
      })
    ).not.toThrow();
    expect((game.state as any).stack).toEqual([]);
  });
});
