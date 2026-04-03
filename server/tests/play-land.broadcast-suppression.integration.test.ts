import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { broadcastGame, ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: undefined },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('play land broadcast automation suppression (integration)', () => {
  const gameId = 'test_play_land_broadcast_suppression';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('suppresses exactly one broadcast-driven auto-pass after a manual land play', async () => {
    vi.useFakeTimers();
    try {
      createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
      const game = ensureGame(gameId);
      if (!game) throw new Error('ensureGame returned undefined');

      (game.state as any).players = [
        { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
        { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
      ];
      (game.state as any).startingLife = 40;
      (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
      (game.state as any).phase = 'precombatMain';
      (game.state as any).step = 'MAIN1';
      (game.state as any).turnPlayer = playerId;
      (game.state as any).priority = playerId;
      (game.state as any).stack = [];
      (game.state as any).battlefield = [];
      (game.state as any).manaPool = {
        [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      };
      (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
      (game.state as any).autoPassPlayers = new Set<string>();
      (game.state as any).autoPassForTurn = { [playerId]: true };
      (game.state as any).priorityClaimed = new Set<string>();
      (game.state as any).zones = {
        [playerId]: {
          hand: [
            {
              id: 'forest_1',
              name: 'Forest',
              type_line: 'Basic Land — Forest',
              oracle_text: '{T}: Add {G}.',
              image_uris: { small: 'https://example.com/forest.jpg' },
            },
          ],
          handCount: 1,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
          library: [],
          libraryCount: 0,
        },
        [opponentId]: {
          hand: [],
          handCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
          library: [],
          libraryCount: 0,
        },
      };

      const passPriority = vi.fn(() => ({ changed: false, resolvedNow: false, advanceStep: false }));
      (game as any).passPriority = passPriority;

      const emitted: Array<{ room?: string; event: string; payload: any }> = [];
      const { socket, handlers } = createMockSocket(playerId, emitted);
      socket.data.gameId = gameId;
      socket.rooms.add(gameId);
      const io = createMockIo(emitted, [socket]);

      registerGameActions(io as any, socket as any);

      await handlers['playLand']({ gameId, cardId: 'forest_1' });

      const battlefield = (game.state as any).battlefield || [];
      expect(battlefield).toHaveLength(1);
      expect(battlefield[0]?.card?.name).toBe('Forest');
      expect((game.state as any).phase).toBe('precombatMain');
      expect((game.state as any).step).toBe('MAIN1');
      expect(passPriority).not.toHaveBeenCalled();
      expect((game.state as any)._suppressAutomationOnNextBroadcast).toBeUndefined();
      expect(Number((game.state as any)._suppressAutomationUntil || 0)).toBeGreaterThan(Date.now());

      broadcastGame(io as any, game as any, gameId);
      expect(passPriority).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1499);
      expect(passPriority).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(passPriority).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});