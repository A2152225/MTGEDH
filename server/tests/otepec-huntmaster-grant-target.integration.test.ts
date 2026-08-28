import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const HUNTMASTER_ORACLE =
  'Dinosaur spells you cast cost {1} less to cast.\n{T}: Target Dinosaur gains haste until end of turn.';

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

describe('Otepec Huntmaster grant-ability targeting', () => {
  const gameId = 'test_otepec_huntmaster_grant_target';

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

  it('queues TARGET_SELECTION for dinosaurs only', async () => {
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
        id: 'huntmaster_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'huntmaster_card_1',
          name: 'Otepec Huntmaster',
          type_line: 'Creature — Human Shaman',
          oracle_text: HUNTMASTER_ORACLE,
        },
      },
      {
        id: 'dino_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'dino_card_1',
          name: 'Regal Behemoth',
          type_line: 'Creature — Dinosaur',
          power: '3',
          toughness: '3',
        },
      },
      {
        id: 'bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'bear_card_1',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    registerInteractionHandlers(createMockIo(emitted, [socket]), socket);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'huntmaster_1',
      abilityId: 'huntmaster_1-ability-0',
    });

    const huntmaster = (game.state as any).battlefield.find((permanent: any) => permanent.id === 'huntmaster_1');
    expect(Boolean(huntmaster?.tapped)).toBe(true);

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((queuedStep: any) => (queuedStep as any).battlefieldAbilityTargetSelection === true);
    expect(targetStep).toBeDefined();
    expect((targetStep as any).targetDescription).toBe('dinosaur');
    expect((targetStep as any).validTargets.map((target: any) => target.id)).toEqual(['dino_1']);
  });
});
