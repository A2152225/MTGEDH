import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
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
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Activation-cost mana prevalidation prevents partial costs (integration)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    // Each test uses its own game id.
  });

  it('does not tap targets (and does not consume step) when tap-other activation cost has insufficient mana', async () => {
    const gameId = 'test_activation_cost_tap_other_no_partial_when_insufficient_mana';
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    // No mana available.
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Device',
          type_line: 'Artifact',
          oracle_text: '{U}, Tap an untapped creature you control: Draw a card.',
        },
      },
      {
        id: 'c_1',
        controller: p1,
        owner: p1,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('tap_untap_target');
    expect(step.tapOtherAbilityAsCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: { targetIds: ['c_1'], action: 'tap' },
    });

    // Step should remain (not consumed).
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.length).toBe(1);

    // No partial cost: creature stays untapped, stack unchanged.
    const creature = (game.state as any).battlefield.find((p: any) => p.id === 'c_1');
    expect(Boolean(creature?.tapped)).toBe(false);
    expect(((game.state as any).stack || []).length).toBe(0);

    const socketErrors = emitted.filter((e) => e.event === 'error');
    expect(socketErrors.length).toBeGreaterThan(0);
    expect(String(socketErrors[socketErrors.length - 1]?.payload?.code || '')).toBe('INSUFFICIENT_MANA');
  });

  it('does not move a card out of hand (and does not consume step) when exile-from-hand activation cost has insufficient mana', async () => {
    const gameId = 'test_activation_cost_exile_hand_no_partial_when_insufficient_mana';
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Relic',
          type_line: 'Artifact',
          oracle_text: '{U}, Exile a card from your hand: Draw a card.',
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'h_1', name: 'Hand Card 1', type_line: 'Creature', zone: 'hand' },
          { id: 'h_2', name: 'Hand Card 2', type_line: 'Instant', zone: 'hand' },
        ],
        graveyard: [],
        exile: [],
        handCount: 2,
        graveyardCount: 0,
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('discard_selection');
    expect(step.exileFromHandAbilityAsCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['h_1'],
    });

    // Step should remain (not consumed).
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.length).toBe(1);

    // No partial cost: card stays in hand, not exiled.
    const zones = (game.state as any).zones?.[p1];
    expect((zones.hand as any[]).some((c: any) => c && c.id === 'h_1')).toBe(true);
    expect((zones.exile as any[]).some((c: any) => c && c.id === 'h_1')).toBe(false);
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('does not remove counters (and does not consume step) when remove-counters activation cost has insufficient mana', async () => {
    const gameId = 'test_activation_cost_remove_counters_no_partial_when_insufficient_mana';
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Engine',
          type_line: 'Artifact',
          oracle_text: '{U}, Remove a charge counter from an artifact you control: Draw a card.',
        },
      },
      {
        id: 'a_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { charge: 2 },
        card: {
          name: 'Battery',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.removeCountersAbilityAsCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['a_1'],
    });

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.length).toBe(1);

    const battery = (game.state as any).battlefield.find((p: any) => p.id === 'a_1');
    expect(Number(battery?.counters?.charge || 0)).toBe(2);
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('does not sacrifice a permanent (and does not consume step) when sacrifice activation cost has insufficient mana', async () => {
    const gameId = 'test_activation_cost_sacrifice_no_partial_when_insufficient_mana';
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Altar',
          type_line: 'Artifact',
          oracle_text: '{U}, Sacrifice a creature: Draw a card.',
        },
      },
      {
        id: 'cre_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Creature',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    (game.state as any).zones = { [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 } };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.sacrificeAbilityAsCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['cre_1'],
    });

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.length).toBe(1);

    const battlefieldAfter = (game.state as any).battlefield || [];
    expect((battlefieldAfter as any[]).some((p: any) => p && String(p.id) === 'cre_1')).toBe(true);
    const zones = (game.state as any).zones?.[p1];
    expect(Array.isArray(zones?.graveyard) ? zones.graveyard.length : 0).toBe(0);
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('does not return a permanent to hand (and does not consume step) when return-to-hand activation cost has insufficient mana', async () => {
    const gameId = 'test_activation_cost_return_to_hand_no_partial_when_insufficient_mana';
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Portal',
          type_line: 'Artifact',
          oracle_text: '{U}, Return a creature you control to its owner\'s hand: Draw a card.',
        },
      },
      {
        id: 'cre_1',
        controller: p1,
        owner: p1,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        summoningSickness: false,
        card: {
          name: 'Test Creature',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.returnToHandAbilityAsCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['cre_1'],
    });

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.length).toBe(1);

    const battlefieldAfter = (game.state as any).battlefield || [];
    expect((battlefieldAfter as any[]).some((p: any) => p && String(p.id) === 'cre_1')).toBe(true);
    const zones = (game.state as any).zones?.[p1];
    expect(Array.isArray(zones?.hand) ? zones.hand.length : 0).toBe(0);
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});
