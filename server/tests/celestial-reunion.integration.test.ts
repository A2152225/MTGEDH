import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
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

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Celestial Reunion behold + search (integration)', () => {
  const gameId = 'test_celestial_reunion_integration';
  const playerId = 'p1' as PlayerID;

  const celestialOracle =
    'As an additional cost to cast this spell, you may choose a creature type and behold two creatures of that type.\n'
    + "Search your library for a creature card with mana value X or less, reveal it, put it into your hand, then shuffle. If this spell's additional cost was paid and the revealed card is the chosen type, put that card onto the battlefield instead of putting it into your hand.";

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('puts a matching creature onto the battlefield when behold was paid', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 2,
      },
    };
    (game.state as any).battlefield = [];
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'elf_hit',
          name: 'Elvish Mystic',
          type_line: 'Creature — Elf Druid',
          cmc: 1,
          power: '1',
          toughness: '1',
          mana_cost: '{G}',
        },
        {
          id: 'gob_miss',
          name: 'Goblin Guide',
          type_line: 'Creature — Goblin Scout',
          cmc: 1,
          power: '2',
          toughness: '2',
          mana_cost: '{R}',
        },
      ]],
    ]);
    (game.state as any).stack = [{
      id: 'celestial_stack_1',
      type: 'spell',
      controller: playerId,
      xValue: 3,
      additionalCostPaid: true,
      chosenCreatureType: 'Elf',
      card: {
        id: 'celestial_card_1',
        name: 'Celestial Reunion',
        type_line: 'Sorcery',
        oracle_text: celestialOracle,
        additionalCostPaid: true,
        chosenCreatureType: 'Elf',
      },
    }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeDefined();
    expect(searchStep.chosenTypeBattlefieldIfPaid).toEqual({
      chosenType: 'Elf',
      additionalCostPaid: true,
    });
    expect(searchStep.filter?.maxCmc).toBe(3);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(searchStep.id),
      selections: ['elf_hit'],
    });

    expect(emitted.filter((entry) => entry.event === 'error')).toEqual([]);

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent?.payload?.destination).toBe('battlefield');
    expect(resolvedEvent?.payload?.selectedCardIds).toEqual(['elf_hit']);

    const elfPermanent = ((game.state as any).battlefield || []).find((perm: any) => perm?.card?.id === 'elf_hit');
    expect(elfPermanent).toBeTruthy();
    expect(((game.state as any).zones?.[playerId]?.hand || []).some((card: any) => card?.id === 'elf_hit')).toBe(false);
  });

  it('puts a non-matching creature into hand when behold was not paid', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [];
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'gob_hit',
          name: 'Goblin Guide',
          type_line: 'Creature — Goblin Scout',
          cmc: 1,
          power: '2',
          toughness: '2',
          mana_cost: '{R}',
        },
      ]],
    ]);
    (game.state as any).stack = [{
      id: 'celestial_stack_2',
      type: 'spell',
      controller: playerId,
      xValue: 2,
      additionalCostPaid: false,
      card: {
        id: 'celestial_card_2',
        name: 'Celestial Reunion',
        type_line: 'Sorcery',
        oracle_text: celestialOracle,
        additionalCostPaid: false,
      },
    }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeDefined();
    expect(searchStep.chosenTypeBattlefieldIfPaid).toBeUndefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(searchStep.id),
      selections: ['gob_hit'],
    });

    expect(emitted.filter((entry) => entry.event === 'error')).toEqual([]);

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent?.payload?.destination).toBe('hand');

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand.some((card: any) => card?.id === 'gob_hit')).toBe(true);
    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.card?.id === 'gob_hit')).toBe(false);
  });
});
