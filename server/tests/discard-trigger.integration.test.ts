import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
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

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
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
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

describe('discard triggers (integration)', () => {
  const gameId = 'test_discard_trigger_tinybones';

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

  it('fires opponent-discard triggers from generic discard selection and resolves Tinybones token creation', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
      [p2]: {
        hand: [
          {
            id: 'discard_target_1',
            name: 'Mind Stone',
            type_line: 'Artifact',
            oracle_text: '{T}: Add {C}.',
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'tinybones_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'tinybones_card',
          name: 'Tinybones, Trinket Thief',
          type_line: 'Legendary Creature - Skeleton Rogue',
          oracle_text: 'Whenever an opponent discards a card, create a 1/1 black Rat creature token.\nAt the beginning of your end step, if an opponent discarded a card this turn, you draw a card and you lose 1 life.\n{4}{B}{B}: Each opponent with no cards in hand loses 10 life.',
          power: '1',
          toughness: '2',
          zone: 'battlefield',
        },
        basePower: 1,
        baseToughness: 2,
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: p2 as any,
      description: 'Discard a card.',
      sourceName: 'Mind Rot',
      mandatory: true,
      discardCount: 1,
      hand: [
        {
          id: 'discard_target_1',
          name: 'Mind Stone',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}.',
          zone: 'hand',
        },
      ],
      destination: 'graveyard',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, p2).find((candidate: any) => candidate.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['discard_target_1'],
    });

    const p2Zones = (game.state as any).zones?.[p2];
    expect((p2Zones?.hand || []).map((card: any) => card.id)).toEqual([]);
    expect((p2Zones?.graveyard || []).map((card: any) => card.id)).toContain('discard_target_1');

    const stack = ((game.state as any).stack || []) as any[];
    expect(stack).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'triggered_ability',
        source: 'tinybones_perm',
        sourceName: 'Tinybones, Trinket Thief',
        effect: 'create a 1/1 black Rat creature token',
        triggerType: 'opponent_discards',
      }),
    ]));
    const tinybonesTrigger = stack.find((item: any) => item?.source === 'tinybones_perm');
    expect(tinybonesTrigger?.card?.name).toBe('Tinybones, Trinket Thief');
    expect(tinybonesTrigger?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'tinybones_perm',
      controller: p1,
      card: expect.objectContaining({ name: 'Tinybones, Trinket Thief' }),
    }));
    expect(tinybonesTrigger?.discardedCard).toEqual(expect.objectContaining({ id: 'discard_target_1', name: 'Mind Stone' }));

    const triggerEvent = [...getEvents(gameId)].reverse().find((event: any) =>
      event?.type === 'pushTriggeredAbility' && String(event?.payload?.sourceName || '') === 'Tinybones, Trinket Thief'
    ) as any;
    expect(triggerEvent).toBeDefined();
    expect(triggerEvent?.payload?.effect).toBe('create a 1/1 black Rat creature token');
    expect(triggerEvent?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'tinybones_perm',
      controller: p1,
      card: expect.objectContaining({ name: 'Tinybones, Trinket Thief' }),
    }));
    expect(triggerEvent?.payload?.discardedCard).toEqual(expect.objectContaining({ id: 'discard_target_1', name: 'Mind Stone' }));

    (game.state as any).stack = [];
    game.applyEvent({ type: 'pushTriggeredAbility', ...(triggerEvent?.payload || {}) } as any);
    const replayedTinybonesTrigger = (((game.state as any).stack || []) as any[]).find((item: any) => item?.source === 'tinybones_perm');
    expect(replayedTinybonesTrigger?.sourcePermanentSnapshot?.card?.name).toBe('Tinybones, Trinket Thief');
    expect(replayedTinybonesTrigger?.discardedCard?.id).toBe('discard_target_1');

    game.resolveTopOfStack();

    const rats = (((game.state as any).battlefield || []) as any[]).filter((permanent: any) =>
      String(permanent?.controller || '') === p1
      && String(permanent?.card?.name || '').toLowerCase().includes('rat')
      && String(permanent?.card?.type_line || '').toLowerCase().includes('creature')
    );
    expect(rats).toHaveLength(1);
  });

  it('fires one-or-more discard triggers once per discard event', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'discard_batch_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '{T}: Add {U}.', zone: 'hand' },
          { id: 'discard_batch_2', name: 'Sign in Blood', type_line: 'Sorcery', oracle_text: 'Target player draws two cards and loses 2 life.', zone: 'hand' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'dying_to_serve_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'dying_to_serve_card',
          name: 'Dying to Serve',
          type_line: 'Enchantment',
          oracle_text: 'Whenever you discard one or more cards, create a tapped 2/2 black Zombie creature token. This ability triggers only once each turn.',
          zone: 'battlefield',
        },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: p1 as any,
      description: 'Discard two cards.',
      sourceName: 'Tormenting Voice',
      mandatory: true,
      discardCount: 2,
      hand: [
        { id: 'discard_batch_1', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '{T}: Add {U}.', zone: 'hand' },
        { id: 'discard_batch_2', name: 'Sign in Blood', type_line: 'Sorcery', oracle_text: 'Target player draws two cards and loses 2 life.', zone: 'hand' },
      ],
      destination: 'graveyard',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find((candidate: any) => candidate.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['discard_batch_1', 'discard_batch_2'],
    });

    const stack = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'dying_to_serve_perm');
    expect(stack).toHaveLength(1);
    expect(stack[0]).toEqual(expect.objectContaining({
      effect: 'create a tapped 2/2 black Zombie creature token',
      triggerType: 'you_discard',
    }));
    expect(stack[0]?.effectData?.discardedCardsCount).toBe(2);

    game.resolveTopOfStack();

    const zombies = (((game.state as any).battlefield || []) as any[]).filter((permanent: any) =>
      String(permanent?.controller || '') === p1
      && String(permanent?.card?.name || '').toLowerCase().includes('zombie')
      && String(permanent?.card?.type_line || '').toLowerCase().includes('creature')
    );
    expect(zombies).toHaveLength(1);
  });

  it("resolves 'that player' discard triggers against the discarding player", async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
      [p2]: {
        hand: [
          {
            id: 'caress_discard_1',
            name: 'Arcane Signet',
            type_line: 'Artifact',
            oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'caress_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'caress_card',
          name: "Liliana's Caress",
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent discards a card, that player loses 2 life.',
          zone: 'battlefield',
        },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: p2 as any,
      description: 'Discard a card.',
      sourceName: 'Mind Rot',
      mandatory: true,
      discardCount: 1,
      hand: [
        {
          id: 'caress_discard_1',
          name: 'Arcane Signet',
          type_line: 'Artifact',
          oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
          zone: 'hand',
        },
      ],
      destination: 'graveyard',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, p2).find((candidate: any) => candidate.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['caress_discard_1'],
    });

    const stack = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'caress_perm');
    expect(stack).toHaveLength(1);
    expect(stack[0]).toEqual(expect.objectContaining({
      effect: 'that player loses 2 life',
      triggeringPlayer: p2,
      targetPlayer: p2,
    }));

    game.resolveTopOfStack();

    expect((game.state as any).life?.[p2]).toBe(38);
    expect((game.state as any).life?.[p1]).toBe(40);
  });
});