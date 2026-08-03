import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockSocket(playerId: string, emitted: Array<{ event: string; payload: any }>, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, fn: Function) => {
      handlers[event] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('requestCastSpell sorcery-speed timing', () => {
  const gameId = 'test_request_cast_sorcery_timing';
  const playerId = 'p1';

  async function reset() {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await reset();
  });

  afterEach(async () => {
    await reset();
  });

  it('rejects queuing payment for a sorcery-speed enchantment while the stack is non-empty', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [{
      id: 'stack_stuck_spell',
      type: 'spell',
      controller: playerId,
      oracleIrDeferredFinalize: true,
      card: { id: 'other_spell', name: 'Vampiric Tutor', type_line: 'Instant' },
    }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{
          id: 'anointed_1',
          name: 'Anointed Procession',
          type_line: 'Enchantment',
          mana_cost: '{3}{W}',
          oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
          zone: 'hand',
        }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 4, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    registerGameActions({ to: () => ({ emit: () => undefined }), emit: () => undefined } as any, socket);

    await handlers['requestCastSpell']({ gameId, cardId: 'anointed_1' });

    const err = emitted.find((e) => e.event === 'error');
    expect(err?.payload?.code).toBe('SORCERY_TIMING');
    const paymentSteps = ResolutionQueueManager.getQueue(gameId).steps.filter(
      (step: any) => step.type === 'mana_payment_choice' && step.spellPaymentRequired === true,
    );
    expect(paymentSteps).toHaveLength(0);
  });
});
