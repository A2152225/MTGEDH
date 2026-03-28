import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
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

describe('tapPermanent replay semantics', () => {
  const gameId = 'test_tap_permanent_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('replays recorded mana deltas, mana costs, and life loss on tapPermanent', () => {
    const game = createInitialGameState('t_tap_permanent_recorded_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).battlefield = [
      {
        id: 'land_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'land_card_1',
          name: 'Test Grove',
          type_line: 'Land',
          oracle_text: '{2}, {T}: Add {G}. Test Grove deals 1 damage to you.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'tapPermanent',
      playerId: p1,
      permanentId: 'land_1',
      manaCost: '{2}',
      addedMana: { green: 1 },
      lifeLost: 1,
    } as any);

    expect((game.state as any).battlefield[0]?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 });
    expect((game.state as any).life?.[p1]).toBe(39);
    expect((game.state as any).players?.find((player: any) => player.id === p1)?.life).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[p1]).toBe(1);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(1);
  });

  it('keeps legacy tapPermanent events as tap-only when no resource deltas were persisted', () => {
    const game = createInitialGameState('t_tap_permanent_legacy_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_legacy_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'legacy_card_1',
          name: 'Legacy Permanent',
          type_line: 'Artifact',
          oracle_text: '{T}: Do a thing.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'tapPermanent',
      playerId: p1,
      permanentId: 'perm_legacy_1',
    } as any);

    expect((game.state as any).battlefield[0]?.tapped).toBe(true);
    expect((game.state as any).manaPool?.[p1]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('persists recorded mana deltas for simple live tapPermanent mana production', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'forest_card_1',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
          zone: 'battlefield',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['tapPermanent']({ gameId, permanentId: 'forest_1' });

    const tapEvent = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'tapPermanent') as any;
    expect(tapEvent?.payload?.permanentId).toBe('forest_1');
    expect(tapEvent?.payload?.addedMana).toEqual({ green: 1 });
    expect(tapEvent?.payload?.manaCost).toBeUndefined();
    expect(tapEvent?.payload?.lifeLost).toBeUndefined();
  });
});