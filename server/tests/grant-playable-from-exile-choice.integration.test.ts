import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(
  emitted: Array<{ room?: string; event: string; payload: any }>,
  sockets: any[] = []
) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId?: string
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('grant playable-from-exile choice (integration)', () => {
  const gameId = 'test_grant_playable_from_exile_choice';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('grants play permission only to the selected exiled card', async () => {
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnNumber = 7;
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          { id: 'exiled_a', name: 'Card A', type_line: 'Sorcery', zone: 'exile' },
          { id: 'exiled_b', name: 'Card B', type_line: 'Land', zone: 'exile' },
        ],
        exileCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose an exiled card. You may play it this turn.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'exiled_a', label: 'Card A' },
        { id: 'exiled_b', label: 'Card B' },
      ],
      minSelections: 1,
      maxSelections: 1,
      grantPlayableFromExileChoice: true,
      grantPlayableFromExileController: p1,
      grantPlayableFromExileSourceName: 'Source',
      grantPlayableFromExileCardIds: ['exiled_a', 'exiled_b'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'exiled_b' });

    expect((game.state as any).playableFromExile?.[p1]?.exiled_a).toBeUndefined();
    expect((game.state as any).playableFromExile?.[p1]?.exiled_b).toBe(7);

    const chat = emitted.find((event) => event.event === 'chat');
    expect(chat?.payload?.message).toContain('chose an exiled card to play this turn');
  });
});