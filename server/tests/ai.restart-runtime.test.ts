import { afterEach, describe, expect, it } from 'vitest';

import { games } from '../src/socket/socket.js';
import { isAIPlayer, rehydrateAIPlayerRuntime } from '../src/socket/ai.js';
import { createInitialGameState } from '../src/state/gameState.js';

describe('AI runtime restoration after replay', () => {
  afterEach(() => {
    games.delete('ai_restart_runtime_restore');
  });

  it('rebuilds AI runtime registration from replayed join state', () => {
    const gameId = 'ai_restart_runtime_restore';
    const game = createInitialGameState(gameId);
    games.set(gameId, game as any);

    game.applyEvent({
      type: 'join',
      playerId: 'human_1',
      name: 'Human',
      spectator: false,
      seatToken: 'seat_human',
    } as any);
    game.applyEvent({
      type: 'join',
      playerId: 'ai_1',
      name: 'AI Opponent 1',
      spectator: false,
      seatToken: 'seat_ai',
      isAI: true,
      strategy: 'basic',
      difficulty: 0.5,
    } as any);

    const replayedAI = (game.state.players || []).find((player: any) => player?.id === 'ai_1');
    expect(replayedAI?.isAI).toBe(true);
    expect(replayedAI?.strategy).toBe('basic');
    expect(replayedAI?.difficulty).toBe(0.5);

    expect(rehydrateAIPlayerRuntime(gameId, 'ai_1' as any, { refreshDeckProfile: true })).toBe(true);
    expect(isAIPlayer(gameId, 'ai_1' as any)).toBe(true);
    expect((game.state as any).autoPassPlayers instanceof Set).toBe(true);
    expect((game.state as any).autoPassPlayers.has('ai_1')).toBe(true);
  });
});