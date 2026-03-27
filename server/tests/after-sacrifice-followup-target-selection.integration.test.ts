import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists, getEvents } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, fn: Function) => {
      handlers[event] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('after sacrifice followup target selection (integration)', () => {
  const gameId = 'test_after_sacrifice_followup_target_selection';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues and resolves a generic target-selection action after sacrificing a creature', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'sacrifice_me',
        controller: p1,
        owner: p1,
        card: { name: 'Disposable Creature', type_line: 'Creature — Test' },
      },
      {
        id: 'target_creature',
        controller: p2,
        owner: p2,
        card: { name: 'Target Creature', type_line: 'Creature — Test' },
      },
      {
        id: 'target_walker',
        controller: p2,
        owner: p2,
        card: { name: 'Target Walker', type_line: 'Legendary Planeswalker — Test' },
        loyalty: 4,
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.UPKEEP_SACRIFICE,
      playerId: p1,
      description: 'Source: You may sacrifice a creature',
      mandatory: false,
      sourceName: 'Source',
      allowSourceSacrifice: false,
      hasCreatures: true,
      afterSacrificeFollowupTargetSelection: true,
      afterSacrificeFollowupDescription: 'Source: Destroy target creature or planeswalker',
      afterSacrificeFollowupAction: 'destroy_target_creature_or_planeswalker',
      afterSacrificeFollowupTargetTypes: ['creature', 'planeswalker'],
      afterSacrificeFollowupTargetDescription: 'target creature or planeswalker',
      creatures: [
        {
          id: 'sacrifice_me',
          name: 'Disposable Creature',
          power: '1',
          toughness: '1',
        },
      ],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: { type: 'creature', creatureId: 'sacrifice_me' },
    });

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any).action).toBe('destroy_target_creature_or_planeswalker');
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => target.id)).toEqual([
      'target_creature',
      'target_walker',
    ]);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: (queue.steps[0] as any).id,
      selections: ['target_walker'],
    });

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['target_creature']);
    expect(((game.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Disposable Creature']);
  });

  it('persists and replays sacrifice-when-you-do reflexive target selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'source_perm',
        controller: p1,
        owner: p1,
        card: { name: 'Blood Rite', type_line: 'Artifact' },
      },
      {
        id: 'vampire_1',
        controller: p1,
        owner: p1,
        card: { name: 'Test Vampire', type_line: 'Creature — Vampire' },
      },
      {
        id: 'target_creature',
        controller: p2,
        owner: p2,
        card: { name: 'Target Creature', type_line: 'Creature — Test' },
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: p1,
      description: 'Choose a Vampire to sacrifice',
      mandatory: true,
      sourceId: 'source_perm',
      sourceName: 'Blood Rite',
      validTargets: [{ id: 'vampire_1', label: 'Test Vampire', description: 'Creature — Vampire' }],
      targetTypes: ['sacrifice_target'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'Vampire you control',
      sacrificeWhenYouDo: true,
      sacrificeWhenYouDoStage: 'select_sacrifice',
      sacrificeWhenYouDoSubtype: 'Vampire',
      sacrificeWhenYouDoDamage: 2,
      sacrificeWhenYouDoLifeGain: 2,
      sacrificeWhenYouDoController: p1,
      sacrificeWhenYouDoSourceName: 'Blood Rite',
      sacrificeWhenYouDoSourcePermanentId: 'source_perm',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['vampire_1'],
    });

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['source_perm', 'target_creature']);
    expect(((game.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Test Vampire']);

    const liveStack = (game.state as any).stack || [];
    expect(liveStack).toHaveLength(1);
    expect(liveStack[0]).toMatchObject({
      type: 'triggered_ability',
      controller: p1,
      source: 'source_perm',
      permanentId: 'source_perm',
      sourceName: 'Blood Rite',
      requiresTarget: true,
      targetType: 'any_target',
    });

    const liveQueue = ResolutionQueueManager.getQueue(gameId);
    expect(liveQueue.steps).toHaveLength(1);
    expect((liveQueue.steps[0] as any)).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      sourceId: liveStack[0].id,
      targetDescription: 'any target',
    });

    const events = getEvents(gameId);
    const resolveEvent = [...events].reverse().find((event: any) => event.type === 'sacrificeWhenYouDoResolve') as any;
    const triggerEvent = [...events].reverse().find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.sourceName === 'Blood Rite') as any;
    expect(resolveEvent).toBeDefined();
    expect(triggerEvent).toBeDefined();
    expect(resolveEvent.payload).toMatchObject({
      playerId: p1,
      sourceName: 'Blood Rite',
      sourcePermanentId: 'source_perm',
      sacrificedPermanentId: 'vampire_1',
      damage: 2,
      lifeGain: 2,
    });
    expect(triggerEvent.payload).toMatchObject({
      triggerId: resolveEvent.payload?.triggerId,
      sourceId: 'source_perm',
      permanentId: 'source_perm',
      sourceName: 'Blood Rite',
      requiresTarget: true,
      targetType: 'any_target',
    });

    const replayGameId = `${gameId}_replay`;
    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');

    (replayGame.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (replayGame.state as any).battlefield = [
      {
        id: 'source_perm',
        controller: p1,
        owner: p1,
        card: { name: 'Blood Rite', type_line: 'Artifact' },
      },
      {
        id: 'vampire_1',
        controller: p1,
        owner: p1,
        card: { name: 'Test Vampire', type_line: 'Creature — Vampire' },
      },
      {
        id: 'target_creature',
        controller: p2,
        owner: p2,
        card: { name: 'Target Creature', type_line: 'Creature — Test' },
      },
    ];
    (replayGame.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };

    ResolutionQueueManager.removeQueue(replayGameId);
    replayGame.applyEvent({
      type: 'sacrificeWhenYouDoResolve',
      ...(resolveEvent.payload || {}),
    });
    replayGame.applyEvent({
      type: 'pushTriggeredAbility',
      ...(triggerEvent.payload || {}),
    });

    expect(((replayGame.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['source_perm', 'target_creature']);
    expect(((replayGame.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Test Vampire']);

    const replayStack = (replayGame.state as any).stack || [];
    expect(replayStack).toHaveLength(1);
    expect(replayStack[0]).toMatchObject({
      id: resolveEvent.payload?.triggerId,
      source: 'source_perm',
      permanentId: 'source_perm',
      sourceName: 'Blood Rite',
      requiresTarget: true,
      targetType: 'any_target',
    });

    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect(replayQueue.steps).toHaveLength(1);
    expect((replayQueue.steps[0] as any)).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      sourceId: resolveEvent.payload?.triggerId,
      targetDescription: 'any target',
    });
  });
});