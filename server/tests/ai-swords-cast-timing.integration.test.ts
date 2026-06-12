import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: undefined },
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

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[]) {
  return {
    to(_room: string) {
      return {
        emit(event: string, payload: any) {
          emitted.push({ room: _room, event, payload });
        },
      };
    },
    emit(event: string, payload: any) {
      emitted.push({ event, payload });
    },
    in(_room: string) {
      return {
        fetchSockets: async () => sockets,
      };
    },
  } as any;
}

describe('AI Swords cast timing integration', () => {
  const playerId = 'ai_caster';
  const opponentId = 'opp_defender';
  const trackedGameIds: string[] = [];

  function createTestGameId(label: string): string {
    const gameId = `test_ai_swords_cast_${label}_${Math.random().toString(36).slice(2, 10)}`;
    trackedGameIds.push(gameId);
    return gameId;
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    trackedGameIds.length = 0;
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
    }
  });

  it('does not offer hexproof creatures as Swords targets when Asceticism is on the battlefield', async () => {
    const gameId = createTestGameId('hexproof_filter');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const swordsId = 'swords_hand_1';
    const gwennaId = 'perm_gwenna';
    const asceticismId = 'perm_asceticism';

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: opponentId, name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_own_creature',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'own_creature_card',
          name: 'Soldier Token',
          type_line: 'Creature — Soldier',
          oracle_text: '',
        },
      },
      {
        id: gwennaId,
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        card: {
          id: 'gwenna_card',
          name: 'Gwenna, Eyes of Gaea',
          type_line: 'Legendary Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
          power: '2',
          toughness: '3',
        },
      },
      {
        id: asceticismId,
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        card: {
          id: 'asceticism_card',
          name: 'Asceticism',
          type_line: 'Enchantment',
          oracle_text: 'Creatures you control have hexproof.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: swordsId,
            name: 'Swords to Plowshares',
            type_line: 'Instant',
            oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
            mana_cost: '{W}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io, socket);
    registerGameActions(io, socket);

    await handlers['requestCastSpell']?.({ gameId, cardId: swordsId });

    const requestErrors = emitted.filter((entry) => entry.event === 'error');
    expect(requestErrors, JSON.stringify(requestErrors)).toEqual([]);

    const pendingCasts = Object.values((game.state as any).pendingSpellCasts || {}) as any[];
    expect(pendingCasts.length).toBeGreaterThan(0);
    const validTargetIds = pendingCasts[0]?.validTargetIds || [];
    expect(validTargetIds).toContain('perm_own_creature');
    expect(validTargetIds).not.toContain(gwennaId);
  });

  it('aborts completeCastSpell when priority was lost before the spell reaches the stack', async () => {
    const gameId = createTestGameId('timing_abort');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const swordsId = 'swords_hand_2';
    const effectId = `cast_${swordsId}_effect`;

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, life: 40 },
      { id: opponentId, name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = opponentId;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'draw';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_target_creature',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        card: {
          id: 'target_creature_card',
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          oracle_text: '{T}: Add {G}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: swordsId,
            name: 'Swords to Plowshares',
            type_line: 'Instant',
            oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
            mana_cost: '{W}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).pendingSpellCasts = {
      [effectId]: {
        cardId: swordsId,
        cardName: 'Swords to Plowshares',
        manaCost: '{W}',
        rawManaCost: '{W}',
        fromZone: 'hand',
        playerId,
        validTargetIds: ['perm_target_creature'],
        targets: ['perm_target_creature'],
        finalManaCost: '{W}',
        card: (game.state as any).zones[playerId].hand[0],
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io, socket);
    registerGameActions(io, socket);

    await handlers['completeCastSpell']?.({
      gameId,
      cardId: swordsId,
      effectId,
      targets: ['perm_target_creature'],
      payment: [],
    });

    expect((game.state as any).stack || []).toHaveLength(0);
    expect(((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id)).toEqual([swordsId]);
    expect(emitted.some((entry) => entry.event === 'error' && entry.payload?.code === 'CAST_TIMING_LOST')).toBe(true);
    expect((game.state as any).manaPool[playerId].white).toBe(1);
  });
});
