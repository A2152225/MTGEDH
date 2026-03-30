import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function ensureZones(game: any, playerId: PlayerID) {
  (game.state as any).zones = (game.state as any).zones || {};
  (game.state as any).zones[playerId] = (game.state as any).zones[playerId] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
}

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
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
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
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe("Tibalt's Trickery generic live-resolution follow-up", () => {
  const gameId = 'test_tibalts_trickery_generic_resolution';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  function buildGame() {
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    ensureZones(game, p1);
    ensureZones(game, p2);

    (game.state as any).turnNumber = 6;
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).phase = 'main1';

    (game.state as any).zones[p2].library = [
      {
        id: 'mill_1',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Scry 1. Draw a card.',
      },
      {
        id: 'land_1',
        name: 'Mountain',
        type_line: 'Basic Land — Mountain',
        oracle_text: '',
      },
      {
        id: 'same_name_1',
        name: 'Furious Rise',
        type_line: 'Enchantment',
        oracle_text: 'At the beginning of your end step, exile the top card of your library.',
      },
      {
        id: 'hit_1',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
      {
        id: 'deep_1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '',
      },
    ];
    (game.state as any).zones[p2].libraryCount = (game.state as any).zones[p2].library.length;

    (game.state as any).stack = [
      {
        id: 'furious_stack',
        type: 'spell',
        controller: p2,
        card: {
          id: 'furious_card',
          name: 'Furious Rise',
          type_line: 'Enchantment',
          oracle_text: 'At the beginning of your end step, exile the top card of your library. Until the end of your next turn, you may play that card.',
        },
        targets: [],
      },
      {
        id: 'trickery_stack',
        type: 'spell',
        controller: p1,
        card: {
          id: 'trickery_card',
          name: "Tibalt's Trickery",
          type_line: 'Instant',
          oracle_text: "Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order.",
        },
        targets: [{ kind: 'stack', id: 'furious_stack' }],
      },
    ];

    games.set(gameId as any, game as any);
    return { game, p1, p2 };
  }

  it('supplements legacy counter resolution with random mill plus exile-until follow-up', () => {
    const { game, p2 } = buildGame();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      game.resolveTopOfStack();
    } finally {
      randomSpy.mockRestore();
    }

    const stack = (game.state as any).stack || [];
    const p2Zones = (game.state as any).zones[p2];
    const graveyardIds = (p2Zones.graveyard || []).map((card: any) => card.id);
    const exileIds = (p2Zones.exile || []).map((card: any) => card.id);
    const queue = ResolutionQueueManager.getQueue(gameId);
    const castPrompt = queue.steps.find((step: any) => String(step?.castFromExileCardId || '') === 'hit_1');

    expect(stack).toHaveLength(0);
    expect(graveyardIds).toContain('furious_card');
    expect(graveyardIds).toContain('mill_1');
    expect(exileIds).toEqual(['hit_1']);
    expect(castPrompt).toBeTruthy();
    expect((castPrompt as any).playerId).toBe(p2);
    expect((castPrompt as any).castFromExileDeclineDestination).toBe('library_bottom_random');
  });

  it('puts the exiled hit on the bottom of the library when the free-cast prompt is declined', async () => {
    const { game, p2 } = buildGame();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      game.resolveTopOfStack();
    } finally {
      randomSpy.mockRestore();
    }

    const queue = ResolutionQueueManager.getQueue(gameId);
    const castPrompt = queue.steps.find((step: any) => String(step?.castFromExileCardId || '') === 'hit_1');
    expect(castPrompt).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: (castPrompt as any).id, selections: 'decline' });

    const p2Zones = (game.state as any).zones[p2];
    const exileIds = (p2Zones.exile || []).map((card: any) => card.id);
    const libraryIds = (p2Zones.library || []).map((card: any) => card.id);
    const chat = emitted.find(event => event.event === 'chat');

    expect(exileIds).toEqual([]);
    expect(libraryIds[libraryIds.length - 1]).toBe('hit_1');
    expect(chat?.payload?.message).toContain('bottom of their library');
  });
});