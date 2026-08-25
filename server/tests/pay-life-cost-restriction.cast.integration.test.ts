import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

// Oracle text copied from mtg_data.db (is_token = 0).
const ANGEL_OF_JUBILATION_ORACLE =
  "Flying\nOther nonblack creatures you control get +1/+1.\nPlayers can't pay life or sacrifice creatures to cast spells or activate abilities.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ event: string; payload: any }>) {
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

async function setupCastGame(gameId: string, withAngel: boolean) {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).stack = [];
  (game.state as any).battlefield = withAngel
    ? [{
        id: 'angel_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          name: 'Custom Jubilant Angel',
          type_line: 'Creature — Angel',
          oracle_text: ANGEL_OF_JUBILATION_ORACLE,
        },
      }]
    : [];
  (game.state as any).zones = {
    p1: {
      hand: [{
        id: 'life_spell_1',
        name: 'Blood Price',
        mana_cost: '{0}',
        type_line: 'Instant',
        oracle_text: 'As an additional cost to cast this spell, pay 2 life. Draw a card.',
        image_uris: { small: 'https://example.com/blood-price.jpg' },
      }],
      handCount: 1,
      exile: [],
      exileCount: 0,
      graveyard: [],
      graveyardCount: 0,
    },
    p2: { hand: [], handCount: 0, exile: [], exileCount: 0, graveyard: [], graveyardCount: 0 },
  };
  return game;
}

describe('castSpellFromHand pay-life additional cost restriction', () => {
  const gameId = 'test_pay_life_restriction_cast_from_hand';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('rejects a pay-life additional cost when Angel-style oracle is on the battlefield', async () => {
    const game = await setupCastGame(gameId, true);
    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId, cardId: 'life_spell_1' });

    const error = emitted.find((entry) => entry.event === 'error');
    expect(error?.payload?.code).toBe('CANNOT_PAY_COST');
    expect(error?.payload?.message).toMatch(/can't pay life/i);
    expect((game.state as any).life?.p1).toBe(40);
    expect(((game.state as any).stack || [])).toHaveLength(0);
  });

  it('still charges a pay-life additional cost when the restriction is absent', async () => {
    const game = await setupCastGame(gameId, false);
    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.castSpellFromHand({ gameId, cardId: 'life_spell_1' });

    const error = emitted.find((entry) => entry.event === 'error');
    expect(error).toBeUndefined();
    expect((game.state as any).life?.p1).toBe(38);
  });
});
