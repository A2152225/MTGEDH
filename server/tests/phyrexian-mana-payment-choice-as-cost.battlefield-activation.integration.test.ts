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

describe('Phyrexian mana payment choice as activation cost (integration)', () => {
  const gameId = 'test_phyrexian_mana_payment_choice_activation_cost';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('enqueues MANA_PAYMENT_CHOICE, then applies tap + life on submit and persists evidence for replay', async () => {
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
          name: 'Test Phyrexian Device',
          type_line: 'Artifact',
          oracle_text: '{T}, {G/P}: You gain 1 life.',
          image_uris: { small: 'https://example.com/device.jpg' },
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

    const permanentBefore = ((game.state as any).battlefield as any[]).find((p: any) => String(p?.id) === 'src_1');
    expect(permanentBefore?.tapped).toBe(false);
    expect((game.state as any).life?.[p1]).toBe(40);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    // Should not have paid tap or life yet (interactive cost choice pending).
    const permanentAfterActivate = ((game.state as any).battlefield as any[]).find((p: any) => String(p?.id) === 'src_1');
    expect(permanentAfterActivate?.tapped).toBe(false);
    expect((game.state as any).life?.[p1]).toBe(40);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('mana_payment_choice');
    expect(step.playerId).toBe(p1);
    expect(step.phyrexianManaChoice).toBe(true);

    // Choose to pay with life.
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: [{ index: 0, payWithLife: true }],
    });

    const permanentAfterSubmit = ((game.state as any).battlefield as any[]).find((p: any) => String(p?.id) === 'src_1');
    expect(permanentAfterSubmit?.tapped).toBe(true);
    expect((game.state as any).life?.[p1]).toBe(38);

    // Determinism: activation evidence should be persisted on activateBattlefieldAbility
    const events = getEvents(gameId);
    const activationEvents = events.filter((e) => String(e?.type) === 'activateBattlefieldAbility');
    expect(activationEvents.length).toBeGreaterThan(0);
    const lastActivation = activationEvents[activationEvents.length - 1] as any;

    expect(lastActivation?.payload?.lifePaidForCost).toBe(2);
    expect(Array.isArray(lastActivation?.payload?.tappedPermanents)).toBe(true);
    expect((lastActivation?.payload?.tappedPermanents || []).map(String)).toContain('src_1');
  });

  it('allows cancelling MANA_PAYMENT_CHOICE without applying costs or persisting activation evidence', async () => {
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
          name: 'Test Phyrexian Device',
          type_line: 'Artifact',
          oracle_text: '{T}, {G/P}: You gain 1 life.',
          image_uris: { small: 'https://example.com/device.jpg' },
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    const eventsBefore = getEvents(gameId);
    const activationBefore = eventsBefore.filter((e) => String(e?.type) === 'activateBattlefieldAbility').length;

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('mana_payment_choice');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: [],
      cancelled: true,
    });

    const permanentAfterCancel = ((game.state as any).battlefield as any[]).find((p: any) => String(p?.id) === 'src_1');
    expect(permanentAfterCancel?.tapped).toBe(false);
    expect((game.state as any).life?.[p1]).toBe(40);

    const eventsAfter = getEvents(gameId);
    const activationAfter = eventsAfter.filter((e) => String(e?.type) === 'activateBattlefieldAbility').length;
    expect(activationAfter).toBe(activationBefore);
  });
});
