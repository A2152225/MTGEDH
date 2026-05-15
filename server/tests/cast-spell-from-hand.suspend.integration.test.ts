import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
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

describe('castSpellFromHand suspend alternate cost (integration)', () => {
  const gameId = 'test_cast_spell_from_hand_suspend';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('suspends Resurgent Belief from hand for its suspend cost instead of casting it', async () => {
    const playerId = 'p1';
    const opponentId = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const resurgentBelief = {
      id: 'resurgent_belief_1',
      name: 'Resurgent Belief',
      mana_cost: '',
      manaCost: '',
      type_line: 'Sorcery',
      oracle_text: 'Suspend 2—{1}{W} (Rather than cast this card from your hand, pay {1}{W} and exile it with two time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)\nReturn all enchantment cards from your graveyard to the battlefield. (Auras with nothing to enchant remain in your graveyard.)',
      image_uris: { small: 'https://example.com/resurgent-belief.jpg' },
      colors: ['W'],
      color_identity: ['W'],
    };

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ ...resurgentBelief, zone: 'hand' }],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerGameActions(io as any, socket as any);

    await handlers.castSpellFromHand({
      gameId,
      cardId: 'resurgent_belief_1',
      alternateCostId: 'suspend',
    });

    expect(emitted.filter((entry) => entry.event === 'error')).toEqual([]);

    const zones = (game.state as any).zones[playerId];
    expect((zones.hand || []).map((card: any) => card.id)).not.toContain('resurgent_belief_1');
    expect((zones.hand || []).length).toBe(0);
    expect(zones.handCount).toBe(0);

    const suspendedCard = (zones.exile || []).find((card: any) => card.id === 'resurgent_belief_1');
    expect(suspendedCard).toBeDefined();
    expect(suspendedCard.isSuspended).toBe(true);
    expect(suspendedCard.timeCounters).toBe(2);
    expect(String(suspendedCard.suspendedBy || '')).toBe(playerId);

    const manaPool = (game.state as any).manaPool[playerId];
    expect(manaPool.white).toBe(0);
    expect(manaPool.colorless).toBe(0);
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});