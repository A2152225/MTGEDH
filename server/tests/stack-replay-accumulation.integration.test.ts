import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { reset, replay } from '../src/state/modules/applyEvent.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('stack replay accumulation', () => {
  it('replays pushTriggeredAbility + resolveTopOfStack pairs without leaving stale triggers', () => {
    const gameId = 'stack_replay_push_resolve_pairs';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const triggerId = 'howling_mine_draw_trigger';

    const replayEvents = [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'pushTriggeredAbility',
        triggerId,
        sourceId: 'howling_mine_perm',
        sourceName: 'Howling Mine',
        controllerId: p1,
        description: 'that player draws an additional card.',
        triggerType: 'draw_step',
        effect: 'that player draws an additional card.',
        permanentId: 'howling_mine_perm',
      },
      { type: 'resolveTopOfStack' },
      {
        type: 'pushTriggeredAbility',
        triggerId: `${triggerId}_2`,
        sourceId: 'howling_mine_perm',
        sourceName: 'Howling Mine',
        controllerId: p1,
        description: 'that player draws an additional card.',
        triggerType: 'draw_step',
        effect: 'that player draws an additional card.',
        permanentId: 'howling_mine_perm',
      },
      { type: 'resolveTopOfStack' },
      { type: 'passPriority', by: p1 },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    reset(ctx, true);
    replay(ctx, replayEvents as any);

    expect((game.state as any).stack || []).toHaveLength(0);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('scrubs stale triggered abilities when replay ends after resolves, not on a push', () => {
    const gameId = 'stack_replay_finalize_scrub';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    const replayEvents = [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'pushTriggeredAbility',
        triggerId: 'stale_trigger_1',
        sourceId: 'source_1',
        sourceName: 'Stale Source',
        controllerId: p1,
        description: 'do something',
        triggerType: 'upkeep',
        effect: 'do something',
      },
      { type: 'nextStep' },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    reset(ctx, true);
    replay(ctx, replayEvents as any);

    expect((game.state as any).stack || []).toHaveLength(0);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('keeps a pending trigger when the event log ends on pushTriggeredAbility', () => {
    const gameId = 'stack_replay_pending_trigger';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    const replayEvents = [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'pushTriggeredAbility',
        triggerId: 'pending_trigger_1',
        sourceId: 'myrel_perm',
        sourceName: 'Myrel, Shield of Argive',
        controllerId: p1,
        description: 'Create a token.',
        triggerType: 'attacks',
        effect: 'Create a token.',
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    reset(ctx, true);
    replay(ctx, replayEvents as any);

    expect((game.state as any).stack || []).toHaveLength(1);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
