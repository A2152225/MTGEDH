import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const THREE_TREE_ORACLE =
  'As Three Tree City enters, choose a creature type.\n{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Three Tree City colorless tap with 0 chosen-type creatures', () => {
  const gameId = 'test_three_tree_city_colorless_tap';
  const playerId = 'p1';

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

  function seedCityGame() {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      players: [{ id: playerId, name: 'P1', spectator: false, life: 40 }],
      startingLife: 40,
      life: { [playerId]: 40 },
      phase: 'precombatMain',
      step: 'MAIN1',
      turnPlayer: playerId,
      priority: playerId,
      stack: [],
      manaPool: {
        [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      battlefield: [
        {
          id: 'ttc_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          chosenCreatureType: 'Dinosaur',
          card: {
            id: 'ttc_card',
            name: 'Three Tree City',
            type_line: 'Legendary Land',
            oracle_text: THREE_TREE_ORACLE,
          },
        },
      ],
    });
    return game;
  }

  it('adds {C} when activating {T}: Add {C} with no dinosaurs on the battlefield', async () => {
    const game = seedCityGame();
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'ttc_1',
      abilityId: 'ttc_card-ability-0',
    });

    const city = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'ttc_1');
    expect(Boolean(city?.tapped)).toBe(true);
    expect(Number((game.state as any).manaPool[playerId].colorless || 0)).toBe(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('adds {C} on a simple tap when no dinosaurs are present', async () => {
    const game = seedCityGame();
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['tapPermanent']({ gameId, permanentId: 'ttc_1' });

    const city = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'ttc_1');
    expect(Boolean(city?.tapped)).toBe(true);
    expect(Number((game.state as any).manaPool[playerId].colorless || 0)).toBe(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});
