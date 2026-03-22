import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {},
    }),
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

describe('Boast generic ability routing (integration)', () => {
  beforeAll(async () => {
    await initDb();
    await new Promise(resolve => setTimeout(resolve, 0));
    createNoopIo();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue('test_boast_generic_activation');
    ResolutionQueueManager.removeQueue('test_boast_requires_attack');
    ResolutionQueueManager.removeQueue('test_boast_once_per_turn');
    games.delete('test_boast_generic_activation' as any);
    games.delete('test_boast_requires_attack' as any);
    games.delete('test_boast_once_per_turn' as any);
  });

  it('activates boast through the parser-emitted id after the creature attacked this turn', async () => {
    const gameId = 'test_boast_generic_activation';
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'boaster_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        attackedThisTurn: true,
        card: {
          id: 'boast_card_1',
          name: 'Varragoth, Bloodsky Sire',
          type_line: 'Legendary Creature - Demon Rogue',
          oracle_text: 'Deathtouch\nBoast - {1}: Target player searches their library for a card, then shuffles and puts that card on top.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'boaster_1', abilityId: 'boast_card_1-boast-0' });

    const permanent = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'boaster_1');
    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.description).toContain('target player searches their library');
    expect(permanent?.activatedThisTurn).toBe(true);
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);
  });

  it('rejects boast when the source creature did not attack this turn', async () => {
    const gameId = 'test_boast_requires_attack';
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'boaster_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'boast_card_2',
          name: 'Varragoth, Bloodsky Sire',
          type_line: 'Legendary Creature - Demon Rogue',
          oracle_text: 'Deathtouch\nBoast - {1}: Target player searches their library for a card, then shuffles and puts that card on top.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'boaster_2', abilityId: 'boast_card_2-boast-0' });

    const stack = (game.state as any).stack || [];
    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(stack).toHaveLength(0);
    expect(errorEvent?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(1);
  });

  it('rejects boast after it has already been activated this turn', async () => {
    const gameId = 'test_boast_once_per_turn';
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'boaster_3',
        controller: playerId,
        owner: playerId,
        tapped: false,
        attackedThisTurn: true,
        activatedThisTurn: true,
        card: {
          id: 'boast_card_3',
          name: 'Varragoth, Bloodsky Sire',
          type_line: 'Legendary Creature - Demon Rogue',
          oracle_text: 'Deathtouch\nBoast - {1}: Target player searches their library for a card, then shuffles and puts that card on top.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'boaster_3', abilityId: 'boast_card_3-boast-0' });

    const stack = (game.state as any).stack || [];
    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(stack).toHaveLength(0);
    expect(errorEvent?.payload?.code).toBe('ABILITY_ALREADY_USED');
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(1);
  });
});