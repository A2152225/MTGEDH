import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { nextStep } from '../src/state/modules/turn.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

describe('nextStep replay side effects', () => {
  it('does not queue cleanup discard prompts while replaying events', () => {
    const gameId = 't_next_step_replay_cleanup';
    ResolutionQueueManager.removeQueue(gameId);

    const ctx: any = createInitialGameState(gameId);
    ctx.isReplaying = true;
    const playerId = 'p1' as PlayerID;
    ctx.applyEvent({ type: 'join', playerId, name: 'P1' });
    (ctx.state as any).turnPlayer = playerId;
    (ctx.state as any).phase = 'ending';
    (ctx.state as any).step = 'CLEANUP';
    (ctx.state as any).zones = {
      [playerId]: {
        hand: Array.from({ length: 16 }, (_, index) => ({
          id: `hand_${index + 1}`,
          name: `Card ${index + 1}`,
          type_line: 'Instant',
        })),
        handCount: 16,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    nextStep(ctx);

    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(false);
    expect(
      ResolutionQueueManager.getStepsForPlayer(gameId, playerId).some(
        (step) => step.type === ResolutionStepType.DISCARD_SELECTION,
      ),
    ).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
