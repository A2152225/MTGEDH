import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const KAVARON_ORACLE =
  '{T}: Add {R}.\n' +
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 12+.)\n" +
  '12+ | {1}{R}, {T}, Sacrifice a land: Create a 2/2 colorless Robot artifact creature token, then creatures you control get +1/+0 and gain haste until end of turn.';

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

describe('Kavaron 12+ threshold activated ability socket flow (integration)', () => {
  const gameId = 'test_kavaron_threshold_socket';

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

  it('queues Station with inline at 12+ threshold on a Planet', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'kavaron_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 0 },
        card: {
          id: 'kavaron_card_1',
          name: 'Kavaron, Memorial World',
          type_line: 'Land — Planet',
          oracle_text: KAVARON_ORACLE.replace('Spacecraft', 'Planet'),
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'creature_card_1',
          name: 'Test Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'kavaron_1',
      abilityId: 'station',
    });

    const step = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(step?.type).toBe('station_creature_selection');
    expect(Number(step?.station?.threshold || 0)).toBe(12);
    expect(String(step?.title || '')).toBe('Station 12');
  });

  it('resolves Kavaron 12+ ability on the stack through Oracle IR', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'kavaron_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 12 },
        card: {
          id: 'kavaron_card_1',
          name: 'Kavaron, Memorial World',
          type_line: 'Land — Spacecraft',
          oracle_text: KAVARON_ORACLE,
        },
      },
      {
        id: 'mountain_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'mountain_card_1',
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
      {
        id: 'bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
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
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'kavaron_1',
      abilityId: 'kavaron_card_1-ability-1',
    });

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBeGreaterThan(0);
    const sacrificeStep = queue.steps[0] as any;
    expect(sacrificeStep.type).toBe('target_selection');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(sacrificeStep.id),
      selections: ['mountain_1'],
    });

    expect(((game.state as any).stack || []).length).toBe(1);
    const stackItem = (game.state as any).stack[0] as any;
    expect(String(stackItem?.activatedAbilityText || '')).toMatch(/^12\+\s*\|/);
    expect(String(stackItem?.description || '')).toMatch(/create a 2\/2 colorless robot/i);

    game.resolveTopOfStack();

    expect(((game.state as any).stack || []).length).toBe(0);
    const tokens = ((game.state as any).battlefield || []).filter((perm: any) => perm.isToken);
    expect(tokens.length).toBe(1);
    expect(String(tokens[0]?.card?.type_line || '')).toMatch(/Robot/i);

    const bear = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'bear_1');
    expect(
      Number(bear?.powerBoost || 0) > 0
      || Number(bear?.tempPowerBoost || 0) > 0
      || Array.isArray(bear?.grantedAbilities) && bear.grantedAbilities.length > 0,
    ).toBe(true);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});
