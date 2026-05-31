import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('after sacrifice followup target selection (integration)', () => {
  const gameId = 'test_after_sacrifice_followup_target_selection';
  const replayGameIds = [
    `${gameId}_generic_replay`,
    `${gameId}_replay`,
    `${gameId}_ask_stage_replay`,
  ];

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
    for (const replayGameId of replayGameIds) {
      await resetGame(replayGameId);
    }
  });

  afterEach(async () => {
    await resetGame(gameId);
    for (const replayGameId of replayGameIds) {
      await resetGame(replayGameId);
    }
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

    const followupEventStart = getEvents(gameId).length;

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

    const followupEvents = getEvents(gameId).slice(followupEventStart);
    const sacrificeEvent = [...followupEvents].reverse().find((event: any) => event.type === 'sacrificePermanent') as any;
    const promptEvent = [...followupEvents].reverse().find((event: any) => event.type === 'resolveTopOfStackPrompt') as any;
    expect(sacrificeEvent?.payload?.permanentId).toBe('sacrifice_me');
    expect(promptEvent?.payload?.queuedResolutionStep?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(promptEvent?.payload?.queuedResolutionStep?.action).toBe('destroy_target_creature_or_planeswalker');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: (queue.steps[0] as any).id,
      selections: ['target_walker'],
    });

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['target_creature']);
    expect(((game.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Disposable Creature']);

    const replayGameId = `${gameId}_generic_replay`;
    await resetGame(replayGameId);
    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');

    (replayGame.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (replayGame.state as any).battlefield = [
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
    (replayGame.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };

    ResolutionQueueManager.removeQueue(replayGameId);
    replayGame.applyEvent({ type: 'sacrificePermanent', ...(sacrificeEvent?.payload || {}) } as any);
    replayGame.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent?.payload || {}) } as any);

    expect(((replayGame.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual([
      'target_creature',
      'target_walker',
    ]);
    expect(((replayGame.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Disposable Creature']);
    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect(replayQueue.steps).toHaveLength(1);
    expect((replayQueue.steps[0] as any).action).toBe('destroy_target_creature_or_planeswalker');
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

    const reflexiveEventStart = getEvents(gameId).length;

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

    const events = getEvents(gameId).slice(reflexiveEventStart);
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
    expect(triggerEvent.payload?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: p1,
      owner: p1,
      card: { name: 'Blood Rite' },
    });

    const replayGameId = `${gameId}_replay`;
  await resetGame(replayGameId);
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
      sourcePermanentSnapshot: {
        id: 'source_perm',
        controller: p1,
        owner: p1,
        card: { name: 'Blood Rite' },
      },
    });

    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect(replayQueue.steps).toHaveLength(1);
    expect((replayQueue.steps[0] as any)).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      sourceId: resolveEvent.payload?.triggerId,
      targetDescription: 'any target',
    });
  });

  it('persists generic sacrifice-when-you-do follow-up metadata', async () => {
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
      { id: 'source_perm', controller: p1, owner: p1, card: { name: 'Rite Source', type_line: 'Enchantment' } },
      { id: 'vampire_1', controller: p1, owner: p1, card: { name: 'Test Vampire', type_line: 'Creature — Vampire' } },
      { id: 'target_creature', controller: p2, owner: p2, card: { name: 'Target Creature', type_line: 'Creature — Test' } },
      { id: 'target_walker', controller: p2, owner: p2, card: { name: 'Target Walker', type_line: 'Legendary Planeswalker — Test' }, loyalty: 5 },
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
      sourceName: 'Rite Source',
      validTargets: [{ id: 'vampire_1', label: 'Test Vampire', description: 'Creature — Vampire' }],
      targetTypes: ['sacrifice_target'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'Vampire you control',
      sacrificeWhenYouDo: true,
      sacrificeWhenYouDoStage: 'select_sacrifice',
      sacrificeWhenYouDoSubtype: 'Vampire',
      sacrificeWhenYouDoController: p1,
      sacrificeWhenYouDoSourceName: 'Rite Source',
      sacrificeWhenYouDoSourcePermanentId: 'source_perm',
      sacrificeWhenYouDoFollowupDescription: 'Destroy target creature or planeswalker.',
      sacrificeWhenYouDoTargetDescription: 'target creature or planeswalker',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const eventStart = getEvents(gameId).length;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['vampire_1'],
    });

    const liveStack = ((game.state as any).stack || []).filter(
      (item: any) => String(item?.sourceName || '') === 'Rite Source' && String(item?.description || '') === 'Destroy target creature or planeswalker.',
    );
    expect(liveStack).toHaveLength(1);
    expect(liveStack[0]).toMatchObject({
      sourceName: 'Rite Source',
      description: 'Destroy target creature or planeswalker.',
      requiresTarget: true,
      targetType: 'creature or planeswalker',
    });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(targetStep).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      targetDescription: 'target creature or planeswalker',
      targetedTriggeredAbility: true,
    });
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['target_creature', 'target_walker']);

    const events = getEvents(gameId).slice(eventStart);
    const resolveEvent = [...events].reverse().find((event: any) => event.type === 'sacrificeWhenYouDoResolve') as any;
    const pushEvent = [...events].reverse().find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.sourceName === 'Rite Source') as any;
    expect(resolveEvent?.payload).toMatchObject({
      description: 'Destroy target creature or planeswalker.',
      effect: 'Destroy target creature or planeswalker.',
      requiresTarget: true,
      targetType: 'creature or planeswalker',
      targetDescription: 'target creature or planeswalker',
    });
    expect(pushEvent?.payload).toMatchObject({
      triggerId: resolveEvent?.payload?.triggerId,
      requiresTarget: true,
      targetType: 'creature or planeswalker',
    });

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: targetStep.id,
      selections: ['target_walker'],
    });

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['source_perm', 'target_creature']);
  });

  it('discovers sacrifice-when-you-do prompts from triggered ability text', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).battlefield = [
      { id: 'source_perm', controller: p1, owner: p1, card: { name: 'Rite Source', type_line: 'Enchantment' } },
      { id: 'sacrifice_me', controller: p1, owner: p1, card: { name: 'Disposable Creature', type_line: 'Creature — Test' } },
      { id: 'target_creature', controller: p2, owner: p2, card: { name: 'Target Creature', type_line: 'Creature — Test' } },
      { id: 'target_walker', controller: p2, owner: p2, card: { name: 'Target Walker', type_line: 'Legendary Planeswalker — Test' }, loyalty: 5 },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_sacrifice_reflexive_1',
        type: 'triggered_ability',
        controller: p1,
        source: 'source_perm',
        permanentId: 'source_perm',
        sourceName: 'Rite Source',
        description: 'You may sacrifice a creature. When you do, destroy target creature or planeswalker.',
        effect: 'You may sacrifice a creature. When you do, destroy target creature or planeswalker.',
        mandatory: true,
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };

    const eventStart = getEvents(gameId).length;
    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const askStep = queue.steps.find((step: any) => step?.sacrificeWhenYouDo === true && step?.sacrificeWhenYouDoStage === 'ask') as any;
    expect(askStep).toBeDefined();
    expect(askStep).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      sourceId: 'source_perm',
      sourceName: 'Rite Source',
      sacrificeWhenYouDoSubtype: 'creature',
      sacrificeWhenYouDoFollowupDescription: 'destroy target creature or planeswalker.',
    });
    expect(askStep?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: p1,
      owner: p1,
      card: { name: 'Rite Source' },
    });
    expect(askStep.options.map((option: any) => option.id)).toEqual(['sacrifice', 'decline']);

    const promptEvent = getEvents(gameId).slice(eventStart).find((event: any) =>
      event.type === 'resolveTopOfStackPrompt' && event.payload?.queuedResolutionStep?.sacrificeWhenYouDoStage === 'ask'
    ) as any;
    expect(promptEvent?.payload?.queuedResolutionStep).toMatchObject({
      sacrificeWhenYouDo: true,
      sacrificeWhenYouDoStage: 'ask',
      sacrificeWhenYouDoFollowupDescription: 'destroy target creature or planeswalker.',
    });
    expect(promptEvent?.payload?.queuedResolutionStep?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: p1,
      owner: p1,
      card: { name: 'Rite Source' },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: askStep.id,
      selections: ['sacrifice'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const sacrificeStep = queue.steps.find((step: any) => step?.sacrificeWhenYouDoStage === 'select_sacrifice') as any;
    expect(sacrificeStep).toBeDefined();
    expect(sacrificeStep?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: p1,
      owner: p1,
      card: { name: 'Rite Source' },
    });
    expect((sacrificeStep.validTargets || []).map((target: any) => target.id)).toEqual(['sacrifice_me']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: sacrificeStep.id,
      selections: ['sacrifice_me'],
    });

    const liveStack = ((game.state as any).stack || []).filter((item: any) => String(item?.sourceName || '') === 'Rite Source');
    expect(liveStack).toHaveLength(1);
    expect(liveStack[0]).toMatchObject({
      description: 'destroy target creature or planeswalker.',
      requiresTarget: true,
      targetType: 'creature or planeswalker',
      sourcePermanentSnapshot: {
        id: 'source_perm',
        controller: p1,
        owner: p1,
        card: { name: 'Rite Source' },
      },
    });
    expect(((game.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Disposable Creature']);

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.targetedTriggeredAbility === true) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['target_creature', 'target_walker']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: targetStep.id,
      selections: ['target_walker'],
    });

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['source_perm', 'target_creature']);
  });

  it('persists and replays the sacrifice-when-you-do ask-stage follow-up sacrifice prompt', async () => {
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
        id: 'vampire_2',
        controller: p1,
        owner: p1,
        card: { name: 'Other Vampire', type_line: 'Creature — Vampire' },
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Blood Rite: You may sacrifice a Vampire',
      mandatory: false,
      sourceId: 'source_perm',
      sourceName: 'Blood Rite',
      options: [
        { id: 'sac', label: 'Sacrifice a Vampire' },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      sacrificeWhenYouDo: true,
      sacrificeWhenYouDoStage: 'ask',
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

    const askStagePromptStart = getEvents(gameId).length;

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: ['sac'],
    });

    const liveQueue = ResolutionQueueManager.getQueue(gameId);
    expect(liveQueue.steps).toHaveLength(1);
    expect((liveQueue.steps[0] as any)).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      sourceId: 'source_perm',
      sacrificeWhenYouDo: true,
      sacrificeWhenYouDoStage: 'select_sacrifice',
      targetDescription: 'Vampire you control',
    });
    expect((liveQueue.steps[0] as any)?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: p1,
      owner: p1,
      card: { name: 'Blood Rite' },
    });
    expect(((liveQueue.steps[0] as any).validTargets || []).map((target: any) => target.id)).toEqual([
      'vampire_1',
      'vampire_2',
    ]);

    const askStageEvents = getEvents(gameId).slice(askStagePromptStart);
    const promptEvent = [...askStageEvents].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt' &&
      event.payload?.queuedResolutionStep?.sacrificeWhenYouDoStage === 'select_sacrifice'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload?.queuedResolutionStep).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      sourceId: 'source_perm',
      sacrificeWhenYouDo: true,
      sacrificeWhenYouDoStage: 'select_sacrifice',
      targetDescription: 'Vampire you control',
    });
    expect(promptEvent.payload?.queuedResolutionStep?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: p1,
      owner: p1,
      card: { name: 'Blood Rite' },
    });

    const replayGameId = `${gameId}_ask_stage_replay`;
  await resetGame(replayGameId);
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
        id: 'vampire_2',
        controller: p1,
        owner: p1,
        card: { name: 'Other Vampire', type_line: 'Creature — Vampire' },
      },
    ];
    (replayGame.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };

    ResolutionQueueManager.removeQueue(replayGameId);
    replayGame.applyEvent({
      type: 'resolveTopOfStackPrompt',
      ...(promptEvent.payload || {}),
    } as any);

    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect(replayQueue.steps).toHaveLength(1);
    expect((replayQueue.steps[0] as any)).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      sourceId: 'source_perm',
      sacrificeWhenYouDo: true,
      sacrificeWhenYouDoStage: 'select_sacrifice',
      targetDescription: 'Vampire you control',
    });
    expect(((replayQueue.steps[0] as any).validTargets || []).map((target: any) => target.id)).toEqual([
      'vampire_1',
      'vampire_2',
    ]);
  });
});