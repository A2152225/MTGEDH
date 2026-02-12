import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, getEvents } from '../src/db/index.js';
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

describe('Pay-life + sacrifice-self mana ability with color choice (integration)', () => {
  const gameId = 'test_pay_life_sacrifice_self_mana_color_choice';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('defers life until mana color selection submit and persists activation evidence', async () => {
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

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
      },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        isToken: false,
        card: {
          name: 'Test Mana Engine',
          type_line: 'Artifact',
          oracle_text: '{T}, Pay 2 life, Sacrifice this artifact: Add one mana of any color.',
          image_uris: { small: 'https://example.com/engine.jpg' },
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    expect(typeof handlers['submitResolutionResponse']).toBe('function');

    expect((game.state as any).life?.[p1]).toBe(40);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    // Sacrifice is paid immediately as part of activation cost.
    const battlefield = (game.state as any).battlefield || [];
    expect((battlefield as any[]).some((p: any) => p && String(p.id) === 'src_1')).toBe(false);
    const zones = (game.state as any).zones?.[p1];
    expect(Array.isArray(zones?.graveyard)).toBe(true);
    expect((zones.graveyard as any[]).some((c: any) => String(c?.name || '') === 'Test Mana Engine')).toBe(true);

    // Life is deferred until the mana color choice resolves.
    expect((game.state as any).life?.[p1]).toBe(40);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('mana_color_selection');
    expect(step.playerId).toBe(p1);
    expect(step.lifeToPayForCost).toBe(2);
    expect(Array.isArray(step.sacrificedPermanentsForCost)).toBe(true);
    expect((step.sacrificedPermanentsForCost || []).map(String)).toContain('src_1');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: 'green',
    });

    expect((game.state as any).life?.[p1]).toBe(38);
    expect((game.state as any).manaPool?.[p1]?.green).toBe(1);

    // Determinism: activation evidence should be persisted on activateBattlefieldAbility
    const events = getEvents(gameId);
    const activationEvents = events.filter((e) => String(e?.type) === 'activateBattlefieldAbility');
    expect(activationEvents.length).toBeGreaterThan(0);
    const lastActivation = activationEvents[activationEvents.length - 1] as any;
    expect(lastActivation?.payload?.lifePaidForCost).toBe(2);
    expect(Array.isArray(lastActivation?.payload?.tappedPermanents)).toBe(true);
    expect((lastActivation?.payload?.tappedPermanents || []).map(String)).toContain('src_1');
    expect(Array.isArray(lastActivation?.payload?.sacrificedPermanents)).toBe(true);
    expect((lastActivation?.payload?.sacrificedPermanents || []).map(String)).toContain('src_1');

    const manaEvents = events.filter((e) => String(e?.type) === 'activateManaAbility');
    expect(manaEvents.length).toBeGreaterThan(0);
  });

  it('does not consume the step on invalid color selection', async () => {
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

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        graveyard: [],
        exile: [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
      },
    };

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        isToken: false,
        card: {
          name: 'Test Mana Engine',
          type_line: 'Artifact',
          oracle_text: '{T}, Pay 2 life, Sacrifice this artifact: Add one mana of any color.',
          image_uris: { small: 'https://example.com/engine.jpg' },
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    // Life is still deferred.
    expect((game.state as any).life?.[p1]).toBe(40);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('mana_color_selection');

    // Submit an invalid selection (wrong type).
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: 123,
    });

    // Should emit an error and NOT consume the step.
    expect(emitted.some((e) => e.event === 'error')).toBe(true);
    expect((game.state as any).life?.[p1]).toBe(40);
    expect((game.state as any).manaPool?.[p1]?.green).toBe(0);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    expect(queue.steps[0].id).toBe(step.id);

    // Now submit a valid selection and ensure it completes.
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: 'green',
    });

    expect((game.state as any).life?.[p1]).toBe(38);
    expect((game.state as any).manaPool?.[p1]?.green).toBe(1);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(0);
  });
});
