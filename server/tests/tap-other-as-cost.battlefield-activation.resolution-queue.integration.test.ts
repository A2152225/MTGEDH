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

function createMockIo(
  emitted: Array<{ room?: string; event: string; payload: any }>,
  sockets: any[] = []
) {
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
    rooms: { has: (_room: string) => true, add: (_room: string) => {}, delete: (_room: string) => {} } as any,
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Tap-other-as-activation-cost via Resolution Queue (integration)', () => {
  const gameId = 'test_tap_other_activation_cost_resolution_queue';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('enqueues TAP_UNTAP_TARGET and resumes activation after tapping a creature you control', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    // Deterministic priority baseline.
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Device',
          type_line: 'Artifact',
          oracle_text: 'Tap an untapped creature you control: Draw a card.',
          image_uris: { small: 'https://example.com/device.jpg' },
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
          image_uris: { small: 'https://example.com/bears.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('tap_untap_target');
    expect(step.playerId).toBe(p1);
    expect(step.action).toBe('tap');
    expect(step.targetCount).toBe(1);
    expect(step.targetFilter?.controller).toBe('you');
    expect(step.targetFilter?.tapStatus).toBe('untapped');
    expect(step.tapOtherAbilityAsCost).toBe(true);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: { targetIds: ['c_1'], action: 'tap' },
    });

    const creature = (game.state as any).battlefield.find((p: any) => p.id === 'c_1');
    expect(creature).toBeDefined();
    expect(Boolean(creature.tapped)).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_1');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');

    // Sanity: stack update emitted.
    expect(emitted.some((e) => e.room === gameId && e.event === 'stackUpdate')).toBe(true);
  });

  it('supports multi-type tap-other costs (artifact creature) by requiring all types', async () => {
    const multiGameId = `${gameId}_multi_type`;

    ResolutionQueueManager.removeQueue(multiGameId);
    games.delete(multiGameId as any);

    createGameIfNotExists(multiGameId, 'commander', 40);
    const game = ensureGame(multiGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_2',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Gizmo',
          type_line: 'Artifact',
          oracle_text: 'Tap an untapped artifact creature you control: Draw a card.',
          image_uris: { small: 'https://example.com/gizmo.jpg' },
        },
      },
      {
        id: 'creature_only',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          image_uris: { small: 'https://example.com/bears.jpg' },
        },
      },
      {
        id: 'artifact_only',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Ornithopter Nest',
          type_line: 'Artifact',
          oracle_text: '',
          image_uris: { small: 'https://example.com/artifact.jpg' },
        },
      },
      {
        id: 'artifact_creature',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Ornithopter',
          type_line: 'Artifact Creature — Thopter',
          oracle_text: '',
          image_uris: { small: 'https://example.com/ornithopter.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(multiGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    await handlers['activateBattlefieldAbility']({ gameId: multiGameId, permanentId: 'src_2', abilityId: 'src_2-ability-0' });

    const queue = ResolutionQueueManager.getQueue(multiGameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('tap_untap_target');
    expect(step.targetFilter?.types).toEqual(expect.arrayContaining(['artifact', 'creature']));
    expect(step.targetFilter?.requireAllTypes).toBe(true);

    // Select a valid artifact creature.
    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({
      gameId: multiGameId,
      stepId: step.id,
      selections: { targetIds: ['artifact_creature'], action: 'tap' },
    });

    const chosen = (game.state as any).battlefield.find((p: any) => p.id === 'artifact_creature');
    expect(chosen).toBeDefined();
    expect(Boolean(chosen.tapped)).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_2');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');
  });

  it('supports tap-other costs with a simple power restriction (power 2 or less)', async () => {
    const restrictedGameId = `${gameId}_power_restriction`;
    ResolutionQueueManager.removeQueue(restrictedGameId);
    games.delete(restrictedGameId as any);

    createGameIfNotExists(restrictedGameId, 'commander', 40);
    const game = ensureGame(restrictedGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_power',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Restrictor',
          type_line: 'Artifact',
          oracle_text: 'Tap an untapped creature you control with power 2 or less: Draw a card.',
          image_uris: { small: 'https://example.com/restrictor.jpg' },
        },
      },
      {
        id: 'c_low',
        controller: p1,
        owner: p1,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          name: 'Small Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
          image_uris: { small: 'https://example.com/smallbear.jpg' },
        },
      },
      {
        id: 'c_high',
        controller: p1,
        owner: p1,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          name: 'Big Bear',
          type_line: 'Creature — Bear',
          oracle_text: '',
          image_uris: { small: 'https://example.com/bigbear.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(restrictedGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: restrictedGameId, permanentId: 'src_power', abilityId: 'src_power-ability-0' });

    const queue = ResolutionQueueManager.getQueue(restrictedGameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('tap_untap_target');
    expect(step.targetFilter?.types).toEqual(expect.arrayContaining(['creature']));
    expect(step.targetFilter?.maxPower).toBe(2);

    await handlers['submitResolutionResponse']({
      gameId: restrictedGameId,
      stepId: step.id,
      selections: { targetIds: ['c_low'], action: 'tap' },
    });

    const low = (game.state as any).battlefield.find((p: any) => p.id === 'c_low');
    expect(low).toBeDefined();
    expect(Boolean(low.tapped)).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_power');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');
  });

  it('supports tap-other costs that also pay life (deferred until target tap selection)', async () => {
    const payLifeGameId = `${gameId}_pay_life`;
    ResolutionQueueManager.removeQueue(payLifeGameId);
    games.delete(payLifeGameId as any);

    createGameIfNotExists(payLifeGameId, 'commander', 40);
    const game = ensureGame(payLifeGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_life',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Life Device',
          type_line: 'Artifact',
          oracle_text: 'Pay 2 life, Tap an untapped creature you control: Draw a card.',
          image_uris: { small: 'https://example.com/lifedevice.jpg' },
        },
      },
      {
        id: 'c_life',
        controller: p1,
        owner: p1,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          image_uris: { small: 'https://example.com/bears.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(payLifeGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: payLifeGameId, permanentId: 'src_life', abilityId: 'src_life-ability-0' });

    const queue = ResolutionQueueManager.getQueue(payLifeGameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('tap_untap_target');
    expect(step.tapOtherAbilityAsCost).toBe(true);
    expect(step.lifeToPayForCost).toBe(2);

    await handlers['submitResolutionResponse']({
      gameId: payLifeGameId,
      stepId: step.id,
      selections: { targetIds: ['c_life'], action: 'tap' },
    });

    expect(Number((game.state as any).life?.[p1] ?? 0)).toBe(38);

    const creature = (game.state as any).battlefield.find((p: any) => p.id === 'c_life');
    expect(creature).toBeDefined();
    expect(Boolean(creature.tapped)).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_life');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');
  });
});
