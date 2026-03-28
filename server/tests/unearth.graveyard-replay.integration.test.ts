import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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

describe('unearth graveyard replay semantics (integration)', () => {
  const gameId = 'test_unearth_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('returns the card from graveyard to battlefield marked as unearthed during live activation', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'unearth_card_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'unearth_card_1',
      abilityId: 'unearth',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.card?.id).toBe('unearth_card_1');
    expect(Boolean(battlefield[0]?.wasUnearthed)).toBe(true);
    expect(Boolean(battlefield[0]?.unearthed)).toBe(true);
    expect(Boolean(battlefield[0]?.card?.wasUnearthed)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays unearth by rebuilding the battlefield permanent with unearthed markers', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'unearth_card_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'unearth_card_1',
      abilityId: 'unearth',
      manaCost: '{1}{R}',
      createdPermanentIds: ['perm_unearth_live_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('perm_unearth_live_1');
    expect(battlefield[0]?.card?.id).toBe('unearth_card_1');
    expect(Boolean(battlefield[0]?.wasUnearthed)).toBe(true);
    expect(Boolean(battlefield[0]?.unearthed)).toBe(true);
    expect(Boolean(battlefield[0]?.card?.wasUnearthed)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('falls back to deterministic unearth permanent ids for legacy events without created ids', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'unearth_card_1',
            name: 'Hellspark Elemental',
            type_line: 'Creature - Elemental',
            oracle_text: 'Trample, haste\nUnearth {1}{R}',
            power: '3',
            toughness: '1',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'unearth_card_1',
      abilityId: 'unearth',
      manaCost: '{1}{R}',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).toMatch(/^perm_/);
    expect(battlefield[0]?.id).not.toBe('perm_unearth_live_1');
  });
});