import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Nykthos devotion ability self-payment guard', () => {
  const gameId = 'test_nykthos_self_payment';
  const playerId = 'p1';

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

  it('rejects paying the devotion ability cost with Nykthos itself when the ability also taps it', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      players: [{ id: playerId, name: 'P1', spectator: false, life: 40 }],
      startingLife: 40,
      life: { [playerId]: 40 },
      phase: 'precombatMain',
      turnPlayer: playerId,
      priority: playerId,
      stack: [],
      manaPool: {
        [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      battlefield: [
        {
          id: 'nykthos_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          card: {
            id: 'nykthos_card',
            name: 'Nykthos, Shrine to Nyx',
            type_line: 'Legendary Land',
            oracle_text: '{T}: Add {C}.\n{2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.',
          },
        },
        {
          id: 'forest_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          card: {
            id: 'forest_card',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
          },
        },
      ],
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'nykthos_1',
      abilityId: 'nykthos_card-ability-1',
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.manaCost).toBe('{2}');
    expect(paymentStep.requiresTap).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: 'nykthos_1', mana: 'C', abilityId: 'nykthos_card-ability-0' }],
      },
    });

    // Newer payment prevalidation rejects the activating permanent as a mana source
    // (INVALID_PAYMENT_SOURCE) before the generic insufficient-mana check. The
    // ability still cannot resolve and Nykthos stays untapped.
    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(errorEvent?.payload?.code).toBe('INVALID_PAYMENT_SOURCE');
    expect(String(errorEvent?.payload?.message || '')).toMatch(/cannot use .+ to pay for its own activation cost/i);

    const nykthos = (game.state as any).battlefield.find((entry: any) => entry.id === 'nykthos_1');
    expect(Boolean(nykthos?.tapped)).toBe(false);
  });
});
