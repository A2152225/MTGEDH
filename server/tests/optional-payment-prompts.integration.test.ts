import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers, sanitizeStepForClient } from '../src/socket/resolution.js';
import { queueOptionalPaymentStep, queueShockLandPaymentStep } from '../src/socket/optional-payment-prompts.js';
import { processSpellCastTriggersForCast } from '../src/socket/game-actions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
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

describe('shared optional payment prompts (integration)', () => {
  const gameId = 'test_shared_optional_payment_prompts';
  const playerId = 'p1';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('does not consume life-payment prompts on insufficient life and succeeds after retry', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 1 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 1 };
    (game.state as any).battlefield = [
      {
        id: 'shock_1',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: {
          id: 'card_1',
          name: 'Watery Grave',
          type_line: 'Land — Island Swamp',
        },
      },
    ];

    const permanent = (game.state as any).battlefield[0];
    queueOptionalPaymentStep(gameId, {
      playerId,
      sourceName: 'Watery Grave',
      sourceId: 'shock_1',
      description: 'Watery Grave: You may pay 2 life. If you do not, it enters tapped.',
      payChoiceId: 'pay_2_life',
      payLabel: 'Pay 2 life (enter untapped)',
      declineChoiceId: 'enter_tapped',
      declineLabel: 'Have it enter tapped',
      mandatory: true,
      validationKind: 'life',
      lifeAmount: 2,
      stepData: {
        shockLandChoice: true,
        permanentId: 'shock_1',
        payLifeAmount: 2,
        cardName: 'Watery Grave',
      },
      onPay: async () => {
        const currentLife = Number((game.state as any).life[playerId] ?? 40);
        const newLife = currentLife - 2;
        (game.state as any).life[playerId] = newLife;
        (game.state as any).players[0].life = newLife;
        permanent.tapped = false;
      },
      onDecline: async () => {
        permanent.tapped = true;
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => (s as any).optionalPaymentPrompt === true);
    expect(step).toBeDefined();

    const stepId = String((step as any).id);
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay_2_life' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INSUFFICIENT_LIFE');
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => String(s.id) === stepId)).toBe(true);
    expect(Number((game.state as any).life[playerId])).toBe(1);
    expect(Boolean(permanent.tapped)).toBe(true);

    (game.state as any).life[playerId] = 5;
    (game.state as any).players[0].life = 5;

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay_2_life' });

    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => String(s.id) === stepId)).toBe(false);
    expect(Number((game.state as any).life[playerId])).toBe(3);
    expect(Boolean(permanent.tapped)).toBe(false);
  });

  it('tracks shock-land life payments as life lost this turn when the player pays', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'shock_live_1',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: {
          id: 'card_live_1',
          name: 'Watery Grave',
          type_line: 'Land — Island Swamp',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    queueShockLandPaymentStep(io as any, game as any, gameId, playerId, (game.state as any).battlefield[0], 'Watery Grave');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => (s as any).shockLandChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: 'pay_2_life',
    });

    expect(Number((game.state as any).life[playerId])).toBe(38);
    expect(Number((game.state as any).players[0]?.life)).toBe(38);
    expect(Number((game.state as any).lifeLostThisTurn?.[playerId] || 0)).toBe(2);
  });

  it('pays Emperor Mihail II optional {1} from an untapped mana source', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mihail_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'mihail_card_1',
          name: 'Emperor Mihail II',
          type_line: 'Legendary Creature — Merfolk Noble',
          oracle_text: 'Whenever you cast a Merfolk spell, you may pay {1}. If you do, create a 1/1 blue Merfolk creature token.',
        },
      },
      {
        id: 'island_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'island_card_1',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '({T}: Add {U}.)',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    processSpellCastTriggersForCast(gameId, game as any, io as any, playerId, {
      id: 'merfolk_spell_1',
      name: 'Merfolk Looter',
      type_line: 'Creature — Merfolk Rogue',
      oracle_text: '',
    });

    const step = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry?.spellCastTriggerOptionalPaymentChoice === true,
    ) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['pay_mana'],
      cancelled: false,
    });

    expect((game.state as any).battlefield.find((permanent: any) => permanent.id === 'island_1')?.tapped).toBe(true);
    expect(
      (game.state as any).battlefield.some(
        (permanent: any) => permanent?.isToken === true && /merfolk/i.test(String(permanent?.card?.name || permanent?.name || '')),
      ),
    ).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
  });

  it('marks a colored pay option unaffordable only while the player has no usable source', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];

    queueOptionalPaymentStep(gameId, {
      playerId,
      sourceName: 'Emperor Mihail II',
      description: 'Optional trigger: You may pay {U}.',
      payChoiceId: 'pay_mana',
      payLabel: 'Pay {U}',
      declineChoiceId: 'decline',
      declineLabel: 'Decline',
      validationKind: 'mana',
      manaCost: '{U}',
      onPay: async () => {},
      onDecline: async () => {},
    });

    const step = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => (entry as any).optionalPaymentPrompt === true,
    ) as any;
    expect(step).toBeDefined();

    const findPayOption = () => (sanitizeStepForClient(gameId, step).options as any[])
      .find((option: any) => option.id === 'pay_mana');

    expect(findPayOption()?.disabled).toBe(true);

    (game.state as any).battlefield = [
      {
        id: 'island_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'island_card_2',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '({T}: Add {U}.)',
        },
      },
    ];

    expect(findPayOption()?.disabled).toBeUndefined();
  });
});