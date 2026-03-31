import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { registerPermanentTriggers } from '../src/state/modules/triggered-abilities.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
    sockets: {
      sockets: new Map(),
    },
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

describe('Tymna postcombat main integration', () => {
  const gameId = 'test_tymna_postcombat_main';
  const p1 = 'p1';
  const p2 = 'p2';
  const p3 = 'p3';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('prompts to pay life equal to opponents dealt combat damage and draws that many cards on accept', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'END_COMBAT';
    (game.state as any).battlefield = [];
    (game.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: {
        attacker_a: { creatureName: 'Attacker A', totalDamage: 2 },
      },
      [p3]: {
        attacker_b: { creatureName: 'Attacker B', totalDamage: 3 },
      },
    };

    game.importDeckResolved(p1 as any, [
      { id: 'draw_1', name: 'Card 1', type_line: 'Sorcery' } as any,
      { id: 'draw_2', name: 'Card 2', type_line: 'Sorcery' } as any,
      { id: 'draw_3', name: 'Card 3', type_line: 'Sorcery' } as any,
    ]);

    const tymna = {
      id: 'tymna_perm',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      summoningSickness: false,
      card: {
        id: 'tymna_card',
        name: 'Tymna the Weaver',
        type_line: 'Legendary Creature — Human Cleric',
        oracle_text:
          'At the beginning of each of your postcombat main phases, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.',
        power: '2',
        toughness: '2',
      },
    };

    (game.state as any).battlefield.push(tymna);
    registerPermanentTriggers(game as any, tymna as any);

    game.applyEvent({ type: 'nextStep' });

    const trigger = ((game.state as any).stack || []).find((item: any) => item?.type === 'triggered_ability' && item?.source === 'tymna_perm');
    expect(trigger).toBeTruthy();

    const handBefore = Number((game.state as any).zones?.[p1]?.handCount || 0);
    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const optionalTriggerStep = queue.steps.find((queuedStep: any) => (queuedStep as any)?.optionalTriggeredAbilityPrompt === true);
    expect(optionalTriggerStep).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((optionalTriggerStep as any).id),
      selections: ['yes'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((queuedStep: any) => (queuedStep as any)?.optionalPaymentPrompt === true);
    expect(paymentStep).toBeDefined();
    expect(String((paymentStep as any)?.description || '')).toContain('pay 2 life');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((paymentStep as any).id),
      selections: ['pay_life'],
      cancelled: false,
    });

    expect(Number((game.state as any).life?.[p1] || 40)).toBe(38);
    expect(Number((game.state as any).zones?.[p1]?.handCount || 0)).toBe(handBefore + 2);
  });
});