import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const HERD_HEIRLOOM_ORACLE =
  '{T}: Add one mana of any color. Spend this mana only to cast a creature spell.\n' +
  '{T}: Until end of turn, target creature you control with power 4 or greater gains trample and "Whenever this creature deals combat damage to a player, draw a card."';

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

describe('Herd Heirloom grant-ability tap cost', () => {
  const gameId = 'test_herd_heirloom_grant_tap';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({
      to: () => ({ emit: () => {} }),
      emit: () => {},
      sockets: { sockets: new Map() },
    } as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('pays {T} on the grant ability, restricts to power 4+, and refuses a second activation', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'heirloom_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'heirloom_card_1',
          name: 'Herd Heirloom',
          type_line: 'Artifact',
          oracle_text: HERD_HEIRLOOM_ORACLE,
        },
      },
      {
        id: 'small_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'small_card_1',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'big_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 6,
        baseToughness: 4,
        card: {
          id: 'big_card_1',
          name: 'Craw Wurm',
          type_line: 'Creature — Wurm',
          power: '6',
          toughness: '4',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'heirloom_1',
      abilityId: 'heirloom_1-ability-1',
    });

    const heirloom = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'heirloom_1');
    expect(Boolean(heirloom?.tapped)).toBe(true);

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).battlefieldAbilityTargetSelection === true);
    expect(targetStep).toBeDefined();
    expect((targetStep as any).tappedPermanentsForCost).toEqual(['heirloom_1']);
    expect((targetStep as any).validTargets.map((target: any) => target.id)).toEqual(['big_1']);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'heirloom_1',
      abilityId: 'heirloom_1-ability-1',
    });

    const alreadyTapped = emitted.find((entry) => entry.payload?.code === 'ALREADY_TAPPED');
    expect(alreadyTapped).toBeDefined();
  });
});
