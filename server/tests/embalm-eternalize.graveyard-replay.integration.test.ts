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

describe('embalm and eternalize graveyard replay semantics (integration)', () => {
  const gameId = 'test_embalm_eternalize_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('live embalm exiles the original card and creates a token copy', async () => {
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
            id: 'embalm_card_1',
            name: 'Sacred Cat',
            type_line: 'Creature - Cat',
            oracle_text: 'Lifelink\nEmbalm {W}',
            power: '1',
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
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'embalm_card_1',
      abilityId: 'embalm',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('embalm_card_1');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(Boolean(battlefield[0]?.isToken)).toBe(true);
    expect(String(battlefield[0]?.card?.name || '')).toContain('(Zombie)');
    expect(String(battlefield[0]?.card?.type_line || '')).toContain('Zombie');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays eternalize by exiling the original card and rebuilding the 4/4 token copy', () => {
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
            id: 'eternalize_card_1',
            name: 'Champion of Wits',
            type_line: 'Creature - Naga Wizard',
            oracle_text: 'When Champion of Wits enters, you may draw cards.\nEternalize {5}{U}{U}',
            power: '2',
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
      [playerId]: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 5 },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'eternalize_card_1',
      abilityId: 'eternalize',
      manaCost: '{5}{U}{U}',
      createdPermanentIds: ['token_eternalize_live_1'],
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(zones?.exileCount).toBe(1);
    expect((zones?.exile || [])[0]?.id).toBe('eternalize_card_1');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(battlefield[0]?.id).toBe('token_eternalize_live_1');
    expect(Boolean(battlefield[0]?.isToken)).toBe(true);
    expect(String(battlefield[0]?.card?.name || '')).toContain('(4/4 Zombie)');
    expect(String(battlefield[0]?.card?.type_line || '')).toContain('Zombie');
    expect(battlefield[0]?.basePower).toBe(4);
    expect(battlefield[0]?.baseToughness).toBe(4);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('falls back to deterministic embalm token ids for legacy events without created ids', () => {
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
            id: 'embalm_card_1',
            name: 'Sacred Cat',
            type_line: 'Creature - Cat',
            oracle_text: 'Lifelink\nEmbalm {W}',
            power: '1',
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
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'embalm_card_1',
      abilityId: 'embalm',
      manaCost: '{W}',
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);
    expect(String(battlefield[0]?.id || '')).toMatch(/^token_embalm_/);
    expect(battlefield[0]?.id).not.toBe('token_eternalize_live_1');
  });
});