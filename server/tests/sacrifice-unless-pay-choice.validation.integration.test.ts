import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function initializePromenadePaymentGame(game: any, playerId: string, battlefield: any[]) {
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    [playerId]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
  };
  (game.state as any).battlefield = battlefield;
}

function queuePromenadeManaPaymentChoice(gameId: string, playerId: string) {
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.MANA_PAYMENT_CHOICE,
    playerId: playerId as any,
    description: 'Transguild Promenade: Pay {1} to keep it. Cancel to sacrifice it.',
    mandatory: false,
    activationPaymentChoice: true,
    confirmLabel: 'Pay {1}',
    sacrificeUnlessPayChoice: true,
    permanentId: 'promenade_1',
    cardName: 'Transguild Promenade',
    manaCost: '{1}',
  } as any);
}

describe('sacrificeUnlessPayChoice validate-before-complete (integration)', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => {
    const gameId = `test_sacrifice_unless_pay_choice_validate_before_complete_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    trackedGameIds.add(gameId);
    return gameId;
  };

  async function resetTrackedGames() {
    const gameIds = [...trackedGameIds];
    trackedGameIds.clear();
    for (const gameId of gameIds) {
      await resetGame(gameId);
    }
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetTrackedGames();
  });

  afterEach(async () => {
    await resetTrackedGames();
  });

  it('does not consume the step or sacrifice on insufficient mana', async () => {
    const gameId = createGameId();
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'Transguild Promenade enters the battlefield tapped. When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Sacrifice unless you pay {1}',
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'pay_cost', label: 'Pay {1}' },
        { id: 'decline', label: 'Decline (sacrifice)' },
      ],

      sacrificeUnlessPayChoice: true,
      permanentId: 'promenade_1',
      cardName: 'Transguild Promenade',
      manaCost: '{1}',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).sacrificeUnlessPayChoice === true);
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay_cost' });

    // Step should still be pending.
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Permanent should still be on battlefield.
    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);

    // Now add mana and retry; should complete and keep permanent.
    (game.state as any).manaPool[p1].colorless = 1;
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay_cost' });

    const queueAfterPay = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterPay.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);
    expect(Number((game.state as any).manaPool[p1].colorless || 0)).toBe(0);
  });

  it('can pay from an untapped mana source while priority is null', async () => {
    const gameId = createGameId();
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'Transguild Promenade enters the battlefield tapped. When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
      {
        id: 'forest_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Sacrifice unless you pay {1}',
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'pay_cost', label: 'Pay {1}' },
        { id: 'decline', label: 'Decline (sacrifice)' },
      ],
      sacrificeUnlessPayChoice: true,
      permanentId: 'promenade_1',
      cardName: 'Transguild Promenade',
      manaCost: '{1}',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).sacrificeUnlessPayChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: 'pay_cost' });

    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);
    const tappedForestCount = (game.state as any).battlefield.filter((p: any) =>
      (p.id === 'forest_1' || p.id === 'forest_2') && p.tapped === true
    ).length;
    expect(tappedForestCount).toBe(1);
    expect(Number((game.state as any).manaPool[p1].green || 0)).toBe(0);
    expect(Number((game.state as any).manaPool[p1].colorless || 0)).toBe(0);
  });

  it('can pay with a Treasure through the mana payment choice prompt', async () => {
    const gameId = createGameId();
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
      {
        id: 'treasure_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Treasure',
          type_line: 'Token Artifact - Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
        },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: p1 as any,
      description: 'Transguild Promenade: Pay {1} to keep it. Cancel to sacrifice it.',
      mandatory: false,
      activationPaymentChoice: true,
      confirmLabel: 'Pay {1}',
      sacrificeUnlessPayChoice: true,
      permanentId: 'promenade_1',
      cardName: 'Transguild Promenade',
      manaCost: '{1}',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'mana_payment_choice' && (s as any).sacrificeUnlessPayChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: {
        payment: [{ permanentId: 'treasure_1', mana: 'W' }],
      },
      cancelled: false,
    });

    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'treasure_1')).toBe(false);
    expect(Number((game.state as any).manaPool[p1].white || 0)).toBe(0);
    expect(Number((game.state as any).manaPool[p1].colorless || 0)).toBe(0);
    expect(((game.state as any).zones?.[p1]?.graveyard || []).some((card: any) => card.name === 'Treasure')).toBe(true);
  });

  it('accepts the selected simple mana line even when another line has additional costs', async () => {
    const gameId = createGameId();
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    initializePromenadePaymentGame(game, p1, [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
      {
        id: 'relay_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'relay_card_1',
          name: 'Choice Relay',
          type_line: 'Artifact',
          oracle_text: '{1}, {T}: Add {U}{R}.\n{T}: Add {C}.',
        },
      },
    ]);
    queuePromenadeManaPaymentChoice(gameId, p1);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'mana_payment_choice' && (s as any).sacrificeUnlessPayChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: {
        payment: [{ permanentId: 'relay_1', mana: 'C', abilityId: 'relay_card_1-ability-1' }],
      },
      cancelled: false,
    });

    expect(emitted.find((event) => event.event === 'error')).toBeUndefined();
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => String(s.id) === String((step as any).id))).toBe(false);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'relay_1')?.tapped).toBe(true);
    expect(((game.state as any).zones?.[p1]?.graveyard || []).some((card: any) => card.name === 'Choice Relay')).toBe(false);
    expect(Number((game.state as any).manaPool[p1].colorless || 0)).toBe(0);
  });

  it('rejects a selected costed mana line even when another line on the source is simple', async () => {
    const gameId = createGameId();
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    initializePromenadePaymentGame(game, p1, [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
      {
        id: 'relay_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'relay_card_1',
          name: 'Choice Relay',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}.\n{1}, {T}: Add {U}{R}.',
        },
      },
    ]);
    queuePromenadeManaPaymentChoice(gameId, p1);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'mana_payment_choice' && (s as any).sacrificeUnlessPayChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: {
        payment: [{ permanentId: 'relay_1', mana: 'U', count: 1, abilityId: 'relay_card_1-ability-1' }],
      },
      cancelled: false,
    });

    const errorEvent = emitted.find((event) => event.event === 'error');
    expect(errorEvent?.payload?.code).toBe('INVALID_PAYMENT');
    expect(String(errorEvent?.payload?.message || '')).toContain('unsupported additional activation cost');
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => String(s.id) === String((step as any).id))).toBe(true);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'relay_1')?.tapped).toBe(false);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);
    expect(Number((game.state as any).manaPool[p1].blue || 0)).toBe(0);
    expect(Number((game.state as any).manaPool[p1].colorless || 0)).toBe(0);
  });

  it('does not sacrifice a selected reusable mana line just because another line self-sacrifices', async () => {
    const gameId = createGameId();
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    initializePromenadePaymentGame(game, p1, [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
      {
        id: 'azure_dynamo_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'azure_dynamo_card_1',
          name: 'Azure Dynamo',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice this artifact: Add {U}.\n{T}: Add {U}{U}.',
        },
      },
    ]);
    queuePromenadeManaPaymentChoice(gameId, p1);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'mana_payment_choice' && (s as any).sacrificeUnlessPayChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: {
        payment: [{ permanentId: 'azure_dynamo_1', mana: 'U', count: 1, abilityId: 'azure_dynamo_card_1-ability-1' }],
      },
      cancelled: false,
    });

    expect(emitted.find((event) => event.event === 'error')).toBeUndefined();
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => String(s.id) === String((step as any).id))).toBe(false);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'azure_dynamo_1')?.tapped).toBe(true);
    expect(((game.state as any).zones?.[p1]?.graveyard || []).some((card: any) => card.name === 'Azure Dynamo')).toBe(false);
    expect(Number((game.state as any).manaPool[p1].blue || 0)).toBe(1);
  });

  it('auto-pays with a self-sacrifice mana source when it is the only option', async () => {
    const gameId = createGameId();
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
      {
        id: 'petal_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Lotus Petal',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice Lotus Petal: Add one mana of any color.',
        },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Sacrifice unless you pay {1}',
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'pay_cost', label: 'Pay {1}' },
        { id: 'decline', label: 'Decline (sacrifice)' },
      ],
      sacrificeUnlessPayChoice: true,
      permanentId: 'promenade_1',
      cardName: 'Transguild Promenade',
      manaCost: '{1}',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).sacrificeUnlessPayChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: 'pay_cost' });

    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'petal_1')).toBe(false);
    expect(((game.state as any).zones?.[p1]?.graveyard || []).some((card: any) => card.name === 'Lotus Petal')).toBe(true);
    expect(Number((game.state as any).manaPool[p1].colorless || 0)).toBe(0);
  });

  it('prefers reusable mana sources over Treasure for generic auto-pay', async () => {
    const gameId = createGameId();
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).commandZone = {
      [p1]: {
        commanderCards: [
          { id: 'commander_1', name: 'Aurelia, the Warleader', color_identity: ['W', 'R'] },
        ],
      },
    };

    (game.state as any).battlefield = [
      {
        id: 'promenade_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Transguild Promenade',
          type_line: 'Land',
          oracle_text: 'When Transguild Promenade enters the battlefield, sacrifice it unless you pay {1}.',
        },
      },
      {
        id: 'treasure_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Treasure',
          type_line: 'Token Artifact - Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
        },
      },
      {
        id: 'signet_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Arcane Signet',
          type_line: 'Artifact',
          oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
        },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Sacrifice unless you pay {1}',
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      options: [
        { id: 'pay_cost', label: 'Pay {1}' },
        { id: 'decline', label: 'Decline (sacrifice)' },
      ],
      sacrificeUnlessPayChoice: true,
      permanentId: 'promenade_1',
      cardName: 'Transguild Promenade',
      manaCost: '{1}',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).sacrificeUnlessPayChoice === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: 'pay_cost' });

    expect((game.state as any).battlefield.some((p: any) => p.id === 'promenade_1')).toBe(true);
    expect((game.state as any).battlefield.find((p: any) => p.id === 'signet_1')?.tapped).toBe(true);
    expect((game.state as any).battlefield.some((p: any) => p.id === 'treasure_1')).toBe(true);
    expect(((game.state as any).zones?.[p1]?.graveyard || []).some((card: any) => card.name === 'Treasure')).toBe(false);
  });
});
