import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
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

describe('Discard typed card as activation cost via Resolution Queue (integration)', () => {
  const gameId = 'test_discard_typed_activation_cost_resolution_queue';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

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

  it("enqueues DISCARD_SELECTION with filtered hand and resumes activation after discarding a creature card", async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Engine',
          type_line: 'Artifact',
          oracle_text: 'Discard a creature card: Draw a card.',
          image_uris: { small: 'https://example.com/engine.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'h_creature',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            mana_cost: '{1}{G}',
            image_uris: { small: 'https://example.com/bears.jpg' },
            zone: 'hand',
          },
          {
            id: 'h_instant',
            name: 'Giant Growth',
            type_line: 'Instant',
            mana_cost: '{G}',
            image_uris: { small: 'https://example.com/growth.jpg' },
            zone: 'hand',
          },
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

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('discard_selection');
    expect(step.playerId).toBe(p1);
    expect(step.discardAbilityAsCost).toBe(true);
    expect(step.discardCount).toBe(1);

    const handOptions = step.hand as any[];
    expect(Array.isArray(handOptions)).toBe(true);
    expect(handOptions.some((c: any) => String(c.id) === 'h_creature')).toBe(true);
    expect(handOptions.some((c: any) => String(c.id) === 'h_instant')).toBe(false);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['h_creature'],
    });

    const zones = (game.state as any).zones?.[p1];
    expect(zones).toBeDefined();
    expect((zones.hand as any[]).some((c: any) => c && c.id === 'h_creature')).toBe(false);
    expect((zones.graveyard as any[]).some((c: any) => c && c.id === 'h_creature')).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_1');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');

  });

  it('supports discard-as-cost that also pays life (deferred until discard selection resolves)', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).stack = [];

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
          name: 'Test Engine',
          type_line: 'Artifact',
          oracle_text: 'Pay 2 life, Discard a card: Draw a card.',
          image_uris: { small: 'https://example.com/engine.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'h_any',
            name: 'Random Card',
            type_line: 'Instant',
            mana_cost: '{G}',
            image_uris: { small: 'https://example.com/random.jpg' },
            zone: 'hand',
          },
        ],
        graveyard: [],
        exile: [],
        handCount: 1,
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

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_2', abilityId: 'src_2-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const step = queue.steps[0] as any;
    expect(step.type).toBe('discard_selection');
    expect(step.playerId).toBe(p1);
    expect(step.discardAbilityAsCost).toBe(true);
    expect(step.discardCount).toBe(1);
    expect(step.lifeToPayForCost).toBe(2);

    // Life is NOT paid until the player confirms the discard selection.
    expect(Number((game.state as any).life?.[p1])).toBe(40);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['h_any'],
    });

    expect(Number((game.state as any).life?.[p1])).toBe(38);

    const zones = (game.state as any).zones?.[p1];
    expect(zones).toBeDefined();
    expect((zones.hand as any[]).some((c: any) => c && c.id === 'h_any')).toBe(false);
    expect((zones.graveyard as any[]).some((c: any) => c && c.id === 'h_any')).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_2');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');

  });

  it('queues graveyard target selection for discard-cost recursion abilities and returns the chosen card on resolution', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).stack = [];

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_3',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Tortured Existence',
          type_line: 'Enchantment',
          oracle_text: '{B}, Discard a creature card: Return target creature card from your graveyard to your hand.',
          image_uris: { small: 'https://example.com/tortured-existence.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'h_creature_cost',
            name: 'Discarded Bear',
            type_line: 'Creature - Bear',
            mana_cost: '{1}{G}',
            image_uris: { small: 'https://example.com/discarded-bear.jpg' },
            zone: 'hand',
          },
          {
            id: 'h_noncreature_cost',
            name: 'Not a Creature',
            type_line: 'Instant',
            mana_cost: '{U}',
            image_uris: { small: 'https://example.com/not-creature.jpg' },
            zone: 'hand',
          },
        ],
        graveyard: [
          {
            id: 'g_creature_target',
            name: 'Returned Wolf',
            type_line: 'Creature - Wolf',
            mana_cost: '{2}{G}',
            image_uris: { small: 'https://example.com/returned-wolf.jpg' },
            zone: 'graveyard',
          },
          {
            id: 'g_noncreature_other',
            name: 'Dead Spell',
            type_line: 'Sorcery',
            mana_cost: '{1}{B}',
            image_uris: { small: 'https://example.com/dead-spell.jpg' },
            zone: 'graveyard',
          },
        ],
        exile: [],
        handCount: 2,
        graveyardCount: 2,
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_3', abilityId: 'src_3-ability-0' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const discardStep = queue.steps[0] as any;
    expect(discardStep.type).toBe('discard_selection');
    expect(discardStep.discardAbilityAsCost).toBe(true);
    expect((discardStep.hand as any[]).some((c: any) => String(c.id) === 'h_creature_cost')).toBe(true);
    expect((discardStep.hand as any[]).some((c: any) => String(c.id) === 'h_noncreature_cost')).toBe(false);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: discardStep.id,
      selections: ['h_creature_cost'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((step: any) => (step as any).battlefieldAbilityTargetSelection === true) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.targetTypes).toContain('graveyard_creature_card');
    expect((targetStep.validTargets as any[]).some((target: any) => String(target.id) === 'g_creature_target')).toBe(true);
    expect((targetStep.validTargets as any[]).some((target: any) => String(target.id) === 'g_noncreature_other')).toBe(false);
    expect(Number((game.state as any).manaPool?.[p1]?.black ?? -1)).toBe(0);

    const queuedActivation = [...getEvents(gameId)].reverse().find((event: any) =>
      event.type === 'activateBattlefieldAbility' &&
      String(event.payload?.queuedResolutionStep?.id || '') === String(targetStep.id)
    ) as any;
    expect(queuedActivation?.payload?.discardedCardIds).toEqual(['h_creature_cost']);
    expect(queuedActivation?.payload?.queuedResolutionStep?.type).toBe('target_selection');
    expect(queuedActivation?.payload?.queuedResolutionStep?.battlefieldAbilityTargetSelection).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: targetStep.id,
      selections: ['g_creature_target'],
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_3');
    expect(stack[0].targets).toEqual(['g_creature_target']);

    game.resolveTopOfStack();

    const zones = (game.state as any).zones?.[p1];
    expect(zones).toBeDefined();
    expect((zones.hand as any[]).some((card: any) => card && card.id === 'g_creature_target')).toBe(true);
    expect((zones.graveyard as any[]).some((card: any) => card && card.id === 'g_creature_target')).toBe(false);
    expect((zones.graveyard as any[]).some((card: any) => card && card.id === 'h_creature_cost')).toBe(true);
  });

  it('exiles a madness card discarded as an activation cost and queues a cast prompt after the activation is placed on the stack', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).stack = [];

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_madness_cost',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Engine',
          type_line: 'Artifact',
          oracle_text: 'Discard a card: Draw a card.',
          image_uris: { small: 'https://example.com/engine.jpg' },
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'h_madness_cost',
            name: 'Fiery Temper',
            type_line: 'Instant',
            mana_cost: '{1}{R}{R}',
            oracle_text: 'Madness {R}',
            image_uris: { small: 'https://example.com/fiery-temper.jpg' },
            zone: 'hand',
          },
        ],
        graveyard: [],
        exile: [],
        handCount: 1,
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

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_madness_cost', abilityId: 'src_madness_cost-ability-0' });

    const discardStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(discardStep.type).toBe('discard_selection');
    expect(discardStep.discardAbilityAsCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: discardStep.id,
      selections: ['h_madness_cost'],
    });

    const zones = (game.state as any).zones?.[p1];
    expect((zones.hand as any[]).some((card: any) => card && card.id === 'h_madness_cost')).toBe(false);
    expect((zones.graveyard as any[]).some((card: any) => card && card.id === 'h_madness_cost')).toBe(false);
    expect((zones.exile as any[]).some((card: any) => card && card.id === 'h_madness_cost')).toBe(true);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_madness_cost');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const madnessStep = queue.steps.find((queuedStep: any) => (queuedStep as any)?.madnessPrompt === true) as any;
    expect(madnessStep).toBeDefined();
    expect(madnessStep.type).toBe('option_choice');
    expect(String(madnessStep.castFromExileCardId || '')).toBe('h_madness_cost');
    expect(String(madnessStep.castFromExileForcedAlternateCostId || '')).toBe('madness');
  });
});
