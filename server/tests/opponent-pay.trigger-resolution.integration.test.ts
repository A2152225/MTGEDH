import { beforeAll, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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

function seedOpponentPayTrigger(game: any, decidingPlayer: string, sourceController: string) {
  (game.state as any).players = [
    { id: decidingPlayer, name: 'Caster', spectator: false, life: 40 },
    { id: sourceController, name: 'Controller', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [decidingPlayer]: 40, [sourceController]: 40 };
  (game.state as any).manaPool = {
    [decidingPlayer]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    [sourceController]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).stack = [
    {
      id: 'trigger_rhystic_1',
      type: 'triggered_ability',
      controller: sourceController,
      source: 'rhystic_1',
      sourceName: 'Rhystic Study',
      description: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}',
      triggerType: 'rhystic_study',
      mandatory: false,
      targetPlayer: decidingPlayer,
      triggeringPlayer: decidingPlayer,
      effectData: {
        casterId: decidingPlayer,
        paymentCost: '{1}',
        benefitIfNotPaid: 'draw a card',
      },
    },
  ];
}

describe('opponent-pay trigger resolution integration', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('queues an opponent-pay prompt from resolveTopOfStack and resolves the declined draw effect', async () => {
    const gameId = `test_opponent_pay_live_decline_${Date.now()}`;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);

    seedOpponentPayTrigger(game, 'p1', 'p2');
    game.importDeckResolved('p2', [
      {
        id: 'draw_card_1',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '({T}: Add {U}.)',
      },
    ]);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).opponentMayPayChoice === true);
    expect(step).toBeDefined();
    expect(queue.steps.some((queuedStep: any) => (queuedStep as any).optionalTriggeredAbilityPrompt === true)).toBe(false);
    expect((game.state as any).zones?.p2?.handCount || 0).toBe(0);
    expect((game.state as any).stack).toHaveLength(0);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['decline'],
      cancelled: false,
    });

    expect((game.state as any).zones?.p2?.handCount || 0).toBe(1);

    const opponentPayEvents = getEvents(gameId).filter((event: any) => event?.type === 'opponentMayPayResolve');
    expect(opponentPayEvents).toHaveLength(1);
    expect(opponentPayEvents[0]?.payload).toMatchObject({
      playerId: 'p1',
      decidingPlayer: 'p1',
      sourceName: 'Rhystic Study',
      sourceController: 'p2',
      manaCost: '{1}',
      willPay: false,
    });

    games.delete(gameId as any);
  });

  it('pushes a Smothering Tithe trigger from drawCards and resolves the declined Treasure outcome', async () => {
    const gameId = `test_smothering_tithe_live_decline_${Date.now()}`;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);

    (game.state as any).players = [
      { id: 'p1', name: 'Drawer', spectator: false, life: 40 },
      { id: 'p2', name: 'Tithe Controller', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { p1: 40, p2: 40 };
    (game.state as any).manaPool = {
      p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'smothering_tithe_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'smothering_tithe_card',
          name: 'Smothering Tithe',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.',
        },
      },
    ];
    game.importDeckResolved('p1', [
      {
        id: 'draw_card_1',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '({T}: Add {W}.)',
      },
    ]);

    game.drawCards('p1', 1);

    expect((game.state as any).zones?.p1?.handCount || 0).toBe(1);
    expect((game.state as any).stack).toHaveLength(1);

    const triggerEvents = getEvents(gameId).filter((event: any) => event?.type === 'pushTriggeredAbility');
    expect(triggerEvents.some((event: any) => event?.payload?.sourceName === 'Smothering Tithe')).toBe(true);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).opponentMayPayChoice === true);
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['decline'],
      cancelled: false,
    });

    const treasures = ((game.state as any).battlefield || []).filter(
      (perm: any) => perm?.controller === 'p2' && perm?.card?.name === 'Treasure'
    );
    expect(treasures).toHaveLength(1);

    games.delete(gameId as any);
  });

  it('replays resolveTopOfStack without applying the effect until opponentMayPayResolve arrives', () => {
    const game = createInitialGameState('t_opponent_pay_replay_sequence');

    game.applyEvent({ type: 'join', playerId: 'p1', name: 'Caster' } as any);
    game.applyEvent({ type: 'join', playerId: 'p2', name: 'Controller' } as any);
    (game.state as any).manaPool = {
      p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    game.importDeckResolved('p2' as any, [
      {
        id: 'draw_card_1',
        name: 'Island',
        type_line: 'Basic Land — Island',
        oracle_text: '({T}: Add {U}.)',
      },
    ]);

    game.replay([
      {
        type: 'pushTriggeredAbility',
        triggerId: 'trigger_rhystic_1',
        sourceId: 'rhystic_1',
        sourceName: 'Rhystic Study',
        controllerId: 'p2',
        description: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}',
        triggerType: 'rhystic_study',
        mandatory: false,
        targetPlayer: 'p1',
        triggeringPlayer: 'p1',
        effectData: {
          casterId: 'p1',
          paymentCost: '{1}',
          benefitIfNotPaid: 'draw a card',
        },
      } as any,
      { type: 'resolveTopOfStack', playerId: 'p2' } as any,
      {
        type: 'opponentMayPayResolve',
        playerId: 'p1',
        decidingPlayer: 'p1',
        promptId: 'opponent_pay_trigger_rhystic_1',
        willPay: false,
        sourceName: 'Rhystic Study',
        sourceController: 'p2',
        manaCost: '{1}',
        declineEffect: 'draw a card',
        triggerText: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}',
      } as any,
    ]);

    expect((game.state as any).stack).toHaveLength(0);
    expect(ResolutionQueueManager.getQueue('t_opponent_pay_replay_sequence').steps).toHaveLength(0);
    expect((game.state as any).zones?.p2?.handCount || 0).toBe(1);
  });
});