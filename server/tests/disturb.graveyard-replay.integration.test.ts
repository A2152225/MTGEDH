import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
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

describe('disturb graveyard replay semantics (integration)', () => {
  const gameId = 'test_disturb_graveyard_replay';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('live disturb removes the card from graveyard and pushes a transformed stack item', async () => {
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
            id: 'disturb_card_1',
            name: 'Baithook Angler',
            type_line: 'Creature - Human Peasant',
            oracle_text: 'Disturb {2}{U}',
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
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const beforeNoncreatureCount = Number((game.state as any).noncreatureSpellsCastThisTurn?.[playerId] || 0);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'disturb_card_1',
      abilityId: 'disturb',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.id).toBe('disturb_card_1');
    expect(stack[0]?.card?.castWithAbility).toBe('disturb');
    expect(Boolean(stack[0]?.card?.transformed)).toBe(true);
    expect(Boolean((game.state as any).castFromGraveyardThisTurn?.[playerId])).toBe(true);
    expect(Boolean((game.state as any).cardLeftGraveyardThisTurn?.[playerId])).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('replays disturb by rebuilding the transformed stack item and graveyard-cast tracking', () => {
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
            id: 'disturb_card_1',
            name: 'Baithook Angler',
            type_line: 'Creature - Human Peasant',
            oracle_text: 'Disturb {2}{U}',
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
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'disturb_card_1',
      abilityId: 'disturb',
      stackId: 'stack_disturb_live_1',
      manaCost: '{2}{U}',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.graveyardCount).toBe(0);
    expect(Boolean((game.state as any).castFromGraveyardThisTurn?.[playerId])).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.id).toBe('stack_disturb_live_1');
    expect(stack[0]?.card?.id).toBe('disturb_card_1');
    expect(stack[0]?.card?.castWithAbility).toBe('disturb');
    expect(Boolean(stack[0]?.card?.transformed)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
  });

  it('live disturb uses the transformed back face for noncreature spell bookkeeping', async () => {
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
            id: 'disturb_aura_1',
            name: 'Lantern Bearer',
            type_line: 'Creature - Spirit',
            oracle_text: 'Disturb {3}{U}',
            layout: 'transform',
            card_faces: [
              {
                name: 'Lantern Bearer',
                type_line: 'Creature - Spirit',
                oracle_text: 'Disturb {3}{U}',
                mana_cost: '{U}',
                colors: ['U'],
              },
              {
                name: 'Lanterns\' Lift',
                type_line: 'Enchantment - Aura',
                oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has flying.',
                mana_cost: '{3}{U}',
                colors: ['U'],
              },
            ],
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const beforeNoncreatureCount = Number((game.state as any).noncreatureSpellsCastThisTurn?.[playerId] || 0);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'disturb_aura_1',
      abilityId: 'disturb',
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.name).toBe('Lanterns\' Lift');
    expect(stack[0]?.card?.type_line).toBe('Enchantment - Aura');
    expect(stack[0]?.card?.faceIndex).toBe(1);
    expect((game.state as any).noncreatureSpellsCastThisTurn?.[playerId]).toBe(beforeNoncreatureCount + 1);
  });

  it('replay disturb uses the transformed back face for noncreature spell bookkeeping', () => {
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
            id: 'disturb_aura_1',
            name: 'Lantern Bearer',
            type_line: 'Creature - Spirit',
            oracle_text: 'Disturb {3}{U}',
            layout: 'transform',
            card_faces: [
              {
                name: 'Lantern Bearer',
                type_line: 'Creature - Spirit',
                oracle_text: 'Disturb {3}{U}',
                mana_cost: '{U}',
                colors: ['U'],
              },
              {
                name: 'Lanterns\' Lift',
                type_line: 'Enchantment - Aura',
                oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1 and has flying.',
                mana_cost: '{3}{U}',
                colors: ['U'],
              },
            ],
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).stack = [];
    const beforeNoncreatureCount = Number((game.state as any).noncreatureSpellsCastThisTurn?.[playerId] || 0);

    game.applyEvent({
      type: 'activateGraveyardAbility',
      playerId,
      cardId: 'disturb_aura_1',
      abilityId: 'disturb',
      stackId: 'stack_disturb_aura_1',
      manaCost: '{3}{U}',
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.card?.name).toBe('Lanterns\' Lift');
    expect(stack[0]?.card?.type_line).toBe('Enchantment - Aura');
    expect(stack[0]?.card?.faceIndex).toBe(1);
    expect((game.state as any).noncreatureSpellsCastThisTurn?.[playerId]).toBe(beforeNoncreatureCount + 1);
  });
});