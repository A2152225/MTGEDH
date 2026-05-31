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

function seedGraveyardExileReflexiveGame(game: any) {
  const p1 = 'p1';
  const p2 = 'p2';
  (game.state as any).players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).turnPlayer = p1;
  (game.state as any).priority = p1;
  (game.state as any).battlefield = [
    { id: 'source_perm', controller: p1, owner: p1, card: { name: 'Graveyard Exile Source', type_line: 'Enchantment' } },
    { id: 'target_creature', controller: p2, owner: p2, card: { name: 'Target Creature', type_line: 'Creature - Test' } },
    { id: 'target_walker', controller: p2, owner: p2, card: { name: 'Target Walker', type_line: 'Legendary Planeswalker - Test' }, loyalty: 4 },
  ];
  (game.state as any).stack = [
    {
      id: 'trigger_graveyard_exile_reflexive_1',
      type: 'triggered_ability',
      controller: p1,
      source: 'source_perm',
      permanentId: 'source_perm',
      sourceName: 'Graveyard Exile Source',
      description: 'You may exile a creature card from your graveyard. When you do, destroy target creature or planeswalker.',
      effect: 'You may exile a creature card from your graveyard. When you do, destroy target creature or planeswalker.',
      mandatory: true,
    },
  ];
  (game.state as any).zones = {
    [p1]: {
      hand: [],
      handCount: 0,
      graveyard: [
        {
          id: 'grave_creature_1',
          name: 'Spent Creature',
          type_line: 'Creature - Test',
          oracle_text: '',
          mana_cost: '{2}',
          cmc: 2,
          zone: 'graveyard',
        },
        {
          id: 'grave_instant_1',
          name: 'Spent Instant',
          type_line: 'Instant',
          oracle_text: '',
          mana_cost: '{U}',
          cmc: 1,
          zone: 'graveyard',
        },
      ],
      graveyardCount: 2,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
    [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
}

describe('reflexive graveyard-exile follow-up prompts (integration replay)', () => {
  const gameId = 'test_reflexive_graveyard_exile_followup';
  const replayGameId = `${gameId}_replay`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('discovers, resolves, and replays a graveyard-exile-when-you-do follow-up trigger', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedGraveyardExileReflexiveGame(game);
    const eventStart = getEvents(gameId).length;

    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const askStep = queue.steps.find((step: any) => step?.reflexiveGraveyardExileWhenYouDo === true && step?.reflexiveGraveyardExileWhenYouDoStage === 'ask') as any;
    expect(askStep).toBeDefined();
    expect(askStep).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      sourceId: 'source_perm',
      sourceName: 'Graveyard Exile Source',
      reflexiveGraveyardExileWhenYouDoCount: 1,
      reflexiveGraveyardExileWhenYouDoCardType: 'creature',
      reflexiveGraveyardExileWhenYouDoFollowupDescription: 'destroy target creature or planeswalker.',
    });
    expect(askStep?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: 'p1',
      owner: 'p1',
      card: { name: 'Graveyard Exile Source' },
    });
    expect((askStep.reflexiveGraveyardExileWhenYouDoValidTargets || []).map((card: any) => card.id)).toEqual(['grave_creature_1']);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: askStep.id,
      selections: ['exile'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const exileStep = queue.steps.find((step: any) => step?.reflexiveGraveyardExileWhenYouDo === true && step?.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    expect(exileStep).toBeDefined();
    expect(exileStep).toMatchObject({
      sourceId: 'source_perm',
      sourceName: 'Graveyard Exile Source',
      minTargets: 1,
      maxTargets: 1,
      destination: 'exile',
      targetPlayerId: 'p1',
      reflexiveGraveyardExileWhenYouDoStage: 'select_exile',
    });
    expect(exileStep?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: 'p1',
      owner: 'p1',
      card: { name: 'Graveyard Exile Source' },
    });
    expect((exileStep.validTargets || []).map((card: any) => card.id)).toEqual(['grave_creature_1']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: exileStep.id,
      selections: ['grave_creature_1'],
    });

    expect(((game.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual(['grave_instant_1']);
    expect(((game.state as any).zones.p1.exile || []).map((card: any) => card.name)).toEqual(['Spent Creature']);

    const followupTrigger = ((game.state as any).stack || []).find((item: any) => String(item?.triggerType || '') === 'reflexive_graveyard_exile') as any;
    expect(followupTrigger).toMatchObject({
      sourceName: 'Graveyard Exile Source',
      source: 'source_perm',
      permanentId: 'source_perm',
      description: 'destroy target creature or planeswalker.',
      requiresTarget: true,
      targetType: 'creature or planeswalker',
      effectData: { exiledCardIds: ['grave_creature_1'], exileCount: 1 },
    });
    expect(followupTrigger?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: 'p1',
      owner: 'p1',
      card: { name: 'Graveyard Exile Source' },
    });

    const newEvents = getEvents(gameId).slice(eventStart);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    const resolveEvent = [...newEvents].reverse().find((event: any) => event.type === 'reflexiveGraveyardExileResolve') as any;
    const pushEvent = [...newEvents].reverse().find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.triggerType === 'reflexive_graveyard_exile') as any;
    expect(confirmEvent?.payload).toMatchObject({
      playerId: 'p1',
      selectedCardIds: ['grave_creature_1'],
      destination: 'exile',
      targetPlayerId: 'p1',
    });
    expect(resolveEvent?.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'source_perm',
      cardIds: ['grave_creature_1'],
      triggerId: followupTrigger.id,
      requiresTarget: true,
      targetType: 'creature or planeswalker',
    });
    expect(pushEvent?.payload).toMatchObject({
      triggerId: followupTrigger.id,
      sourceId: 'source_perm',
      permanentId: 'source_perm',
      triggerType: 'reflexive_graveyard_exile',
    });
    expect(pushEvent?.payload?.sourcePermanentSnapshot).toMatchObject({
      id: 'source_perm',
      controller: 'p1',
      owner: 'p1',
      card: { name: 'Graveyard Exile Source' },
    });

    game.resolveTopOfStack();

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['target_creature', 'target_walker']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: targetStep.id,
      selections: ['target_walker'],
    });

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['source_perm', 'target_creature']);

    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    seedGraveyardExileReflexiveGame(replayGame);
    (replayGame.state as any).stack = [];
    ResolutionQueueManager.addStep(replayGameId, {
      type: ResolutionStepType.GRAVEYARD_SELECTION,
      playerId: 'p1' as any,
      sourceId: 'source_perm',
      sourceName: 'Graveyard Exile Source',
      effectId: 'replay_graveyard_exile_step',
      cardName: 'Graveyard Exile Source',
      title: 'Graveyard Exile Source - Exile from graveyard',
      description: 'Graveyard Exile Source: Exile a creature card from your graveyard',
      mandatory: true,
      targetPlayerId: 'p1',
      minTargets: 1,
      maxTargets: 1,
      destination: 'exile',
      validTargets: [{ id: 'grave_creature_1', name: 'Spent Creature', typeLine: 'Creature - Test', zoneOwnerId: 'p1' }],
      reflexiveGraveyardExileWhenYouDo: true,
      reflexiveGraveyardExileWhenYouDoStage: 'select_exile',
    } as any);

    replayGame.applyEvent({ type: 'confirmGraveyardTargets', ...(confirmEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'reflexiveGraveyardExileResolve', ...(resolveEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'pushTriggeredAbility', ...(pushEvent.payload || {}) } as any);

    expect(((replayGame.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual(['grave_instant_1']);
    expect(((replayGame.state as any).zones.p1.exile || []).map((card: any) => card.name)).toEqual(['Spent Creature']);
    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toHaveLength(0);

    const replayStack = (replayGame.state as any).stack || [];
    expect(replayStack).toHaveLength(1);
    expect(replayStack[0]).toMatchObject({
      id: followupTrigger.id,
      sourceName: 'Graveyard Exile Source',
      triggerType: 'reflexive_graveyard_exile',
      requiresTarget: true,
      targetType: 'creature or planeswalker',
      sourcePermanentSnapshot: {
        id: 'source_perm',
        controller: 'p1',
        owner: 'p1',
        card: { name: 'Graveyard Exile Source' },
      },
    });
  });
});
