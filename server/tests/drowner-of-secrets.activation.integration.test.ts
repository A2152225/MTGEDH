import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
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

describe('Drowner of Secrets activation (integration)', () => {
  const gameId = 'test_drowner_of_secrets_activation';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues Judge of Currents after the tapped-Merfolk activation cost completes', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'drowner',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Drowner of Secrets',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: 'Tap an untapped Merfolk you control: Target player mills a card.',
          image_uris: { small: 'https://example.com/drowner.jpg' },
        },
      },
      {
        id: 'judge',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Judge of Currents',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: 'Whenever a Merfolk you control becomes tapped, you may gain 1 life.',
          image_uris: { small: 'https://example.com/judge.jpg' },
        },
      },
      {
        id: 'bear',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
          image_uris: { small: 'https://example.com/bear.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
      [p2]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'drowner', abilityId: 'drowner-ability-0' });

    const initialQueue = ResolutionQueueManager.getQueue(gameId);
    expect(initialQueue.steps).toHaveLength(1);

    const tapStep = initialQueue.steps[0] as any;
    expect(tapStep.type).toBe('tap_untap_target');
    expect(tapStep.targetFilter?.types).toEqual(expect.arrayContaining(['creature', 'merfolk']));
    expect(tapStep.targetFilter?.requireAllTypes).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: tapStep.id,
      selections: { targetIds: ['judge'], action: 'tap' },
    });

    const judge = (game.state as any).battlefield.find((perm: any) => perm.id === 'judge');
    expect(Boolean(judge?.tapped)).toBe(true);

    const queueAfterTap = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterTap.steps).toHaveLength(1);
    const playerStep = queueAfterTap.steps[0] as any;
    expect(playerStep.type).toBe('target_selection');
    expect(playerStep.targetTypes).toContain('player');
    expect(playerStep.validTargets.map((target: any) => target.id).sort()).toEqual([p1, p2]);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(0);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: playerStep.id,
      selections: [p2],
    });

    const queueAfterTarget = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterTarget.steps).toHaveLength(1);
    const judgeStep = queueAfterTarget.steps[0] as any;
    expect(judgeStep.type).toBe('option_choice');
    expect(judgeStep.mayAbilityPrompt).toBe(true);
    expect(judgeStep.sourceName).toBe('Judge of Currents');
    expect(judgeStep.effectText).toBe('you may gain 1 life');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: judgeStep.id,
      selections: 'yes',
    });

    const stackAfterJudge = (game.state as any).stack || [];
    expect(stackAfterJudge).toHaveLength(2);
    expect(stackAfterJudge.map((item: any) => item.sourceName)).toEqual(
      expect.arrayContaining(['Drowner of Secrets', 'Judge of Currents'])
    );

    const triggerPushEvents = getEvents(gameId).filter((event) => String(event?.type) === 'pushTriggeredAbility');
    expect(triggerPushEvents.length).toBeGreaterThan(0);
    const lastTriggerPush = triggerPushEvents[triggerPushEvents.length - 1] as any;
    expect(String(lastTriggerPush?.payload?.sourceName || '')).toBe('Judge of Currents');
    expect(String(lastTriggerPush?.payload?.triggerType || '')).toBe('tap');
    expect(Boolean(lastTriggerPush?.payload?.mandatory)).toBe(false);
    expect(String(lastTriggerPush?.payload?.triggeringPermanentId || '')).toBe('judge');
  });

  it('mills the chosen player when the live targeted activation resolves', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'drowner',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Drowner of Secrets',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: 'Tap an untapped Merfolk you control: Target player mills a card.',
          image_uris: { small: 'https://example.com/drowner.jpg' },
        },
      },
      {
        id: 'helper',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Merfolk Helper',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: '',
          image_uris: { small: 'https://example.com/helper.jpg' },
        },
      },
    ];

    game.importDeckResolved(p2 as any, [
      {
        id: 'milled_1',
        name: 'Top Card',
        type_line: 'Artifact',
        oracle_text: '',
      },
    ] as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'drowner', abilityId: 'drowner-ability-0' });

    const tapStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(tapStep.type).toBe('tap_untap_target');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: tapStep.id,
      selections: { targetIds: ['helper'], action: 'tap' },
    });

    const playerStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(playerStep.type).toBe('target_selection');
    expect(playerStep.targetTypes).toContain('player');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: playerStep.id,
      selections: [p2],
    });

    const stackBeforeResolve = (game.state as any).stack || [];
    expect(stackBeforeResolve).toHaveLength(1);
    expect(String(stackBeforeResolve[0]?.description || '')).toBe('target player mills a card.');
    expect(stackBeforeResolve[0]?.targets).toEqual([p2]);

    game.resolveTopOfStack();

    expect((game.state as any).zones[p2].libraryCount).toBe(0);
    expect((game.state as any).zones[p2].graveyard).toHaveLength(1);
    expect((game.state as any).zones[p2].graveyard[0]?.id).toBe('milled_1');

    const helper = (game.state as any).battlefield.find((perm: any) => perm.id === 'helper');
    expect(Boolean(helper?.tapped)).toBe(true);
  });
});
