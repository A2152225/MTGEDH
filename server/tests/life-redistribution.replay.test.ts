import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function joinPlayer(game: ReturnType<typeof createInitialGameState>, playerId: PlayerID, name: string) {
  game.applyEvent!({ type: 'join', playerId, name } as any);
}

describe('lifeRedistributionResolve replay semantics', () => {
  it('replays chosen life totals and clears the restored redistribution prompt', () => {
    const gameId = 't_life_redistribution_resolve_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    joinPlayer(game, p1, 'Alice');
    joinPlayer(game, p2, 'Bob');
    joinPlayer(game, p3, 'Carol');

    (game.state as any).life = { p1: 20, p2: 30, p3: 40 };
    for (const player of (game.state as any).players) {
      player.life = (game.state as any).life[player.id];
    }

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'life_redistribution_step',
      type: ResolutionStepType.LIFE_REDISTRIBUTION,
      playerId: p1,
      redistributionId: 'reverse-the-sands:redistribute',
      description: 'Redistribute life totals',
      mandatory: true,
      players: [
        { id: 'p1', name: 'Alice', life: 20 },
        { id: 'p2', name: 'Bob', life: 30 },
        { id: 'p3', name: 'Carol', life: 40 },
      ],
    } as any);

    game.applyEvent({
      type: 'lifeRedistributionResolve',
      playerId: p1,
      resolvedStepId: 'life_redistribution_step',
      redistributionId: 'reverse-the-sands:redistribute',
      lifeByPlayerId: {
        p1: 40,
        p2: 30,
        p3: 20,
      },
    } as any);

    expect((game.state as any).life).toEqual({ p1: 40, p2: 30, p3: 20 });
    expect((game.state as any).players.map((player: any) => [player.id, player.life])).toEqual([
      ['p1', 40],
      ['p2', 30],
      ['p3', 20],
    ]);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.steps.some((step: any) => String(step?.id || '') === 'life_redistribution_step')).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
