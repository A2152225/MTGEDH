import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
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

describe('choose player for looked-at cards (integration)', () => {
  const gameId = 'test_choose_player_for_looked_at_cards';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('lets the chosen player pick a revealed card for another player and exiles the other', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [p1]: {
        library: [
          { id: 'top_1', name: 'Top One', type_line: 'Artifact', zone: 'library' },
          { id: 'top_2', name: 'Top Two', type_line: 'Instant', zone: 'library' },
        ],
        libraryCount: 2,
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
      [p2]: { hand: [], handCount: 0, exile: [], exileCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose an opponent to make the choice',
      mandatory: true,
      sourceName: 'Source',
      options: [{ id: p2, label: 'P2' }],
      minSelections: 1,
      maxSelections: 1,
      choosePlayerForLookedAtCardsChoice: true,
      choosePlayerForLookedAtCardsController: p1,
      choosePlayerForLookedAtCardsSourceName: 'Source',
      choosePlayerForLookedAtCardsDescription: `Source: Choose a card to put into P1's hand`,
      choosePlayerForLookedAtCardsOptions: [
        { id: 'top_1', name: 'Top One', type_line: 'Artifact' },
        { id: 'top_2', name: 'Top Two', type_line: 'Instant' },
      ],
      choosePlayerForLookedAtCardsDestinationController: p1,
      choosePlayerForLookedAtCardsDestinationSourceName: 'Source',
      choosePlayerForLookedAtCardsDestinationTopCardIds: ['top_1', 'top_2'],
      choosePlayerForLookedAtCardsDestinationChosenZone: 'hand',
      choosePlayerForLookedAtCardsDestinationOtherZone: 'exile',
      choosePlayerForLookedAtCardsDestinationOtherCardPatch: { silverCounters: 1, exiledBy: 'Source' },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: socket1, handlers: handlers1 } = createMockSocket(p1, emitted, gameId);
    const { socket: socket2, handlers: handlers2 } = createMockSocket(p2, emitted, gameId);
    const io = createMockIo(emitted, [socket1, socket2]);
    registerResolutionHandlers(io as any, socket1 as any);
    registerResolutionHandlers(io as any, socket2 as any);

    await handlers1['submitResolutionResponse']({ gameId, stepId: step.id, selections: p2 });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).playerId).toBe(p2);

    await handlers2['submitResolutionResponse']({ gameId, stepId: (queue.steps[0] as any).id, selections: 'top_2' });

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['top_2']);
    expect(((game.state as any).zones[p1].exile || []).map((c: any) => c.id)).toEqual(['top_1']);
    expect(((game.state as any).zones[p1].exile || [])[0].silverCounters).toBe(1);
  });
});