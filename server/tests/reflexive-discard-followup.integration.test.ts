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

function seedDiscardReflexiveGame(game: any) {
  const p1 = 'p1';
  const p2 = 'p2';
  (game.state as any).players = [
    { id: p1, name: 'P1', spectator: false, life: 40 },
    { id: p2, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).turnPlayer = p1;
  (game.state as any).priority = p1;
  (game.state as any).battlefield = [
    { id: 'source_perm', controller: p1, owner: p1, card: { name: 'Discard Source', type_line: 'Enchantment' } },
    { id: 'target_creature', controller: p2, owner: p2, card: { name: 'Target Creature', type_line: 'Creature - Test' } },
    { id: 'target_walker', controller: p2, owner: p2, card: { name: 'Target Walker', type_line: 'Legendary Planeswalker - Test' }, loyalty: 4 },
  ];
  (game.state as any).stack = [
    {
      id: 'trigger_discard_reflexive_1',
      type: 'triggered_ability',
      controller: p1,
      source: 'source_perm',
      permanentId: 'source_perm',
      sourceName: 'Discard Source',
      description: 'You may discard a card. When you do, destroy target creature or planeswalker.',
      effect: 'You may discard a card. When you do, destroy target creature or planeswalker.',
      mandatory: true,
    },
  ];
  (game.state as any).zones = {
    [p1]: {
      hand: [
        {
          id: 'discard_card_1',
          name: 'Spare Spell',
          type_line: 'Sorcery',
          oracle_text: '',
          mana_cost: '{2}',
          cmc: 2,
          zone: 'hand',
        },
      ],
      handCount: 1,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
    [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
}

describe('reflexive discard follow-up prompts (integration)', () => {
  const gameId = 'test_reflexive_discard_followup';
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

  it('discovers, resolves, and replays a discard-when-you-do follow-up trigger', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedDiscardReflexiveGame(game);
    const eventStart = getEvents(gameId).length;

    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const askStep = queue.steps.find((step: any) => step?.reflexiveDiscardWhenYouDo === true && step?.reflexiveDiscardWhenYouDoStage === 'ask') as any;
    expect(askStep).toBeDefined();
    expect(askStep).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      sourceId: 'source_perm',
      sourceName: 'Discard Source',
      reflexiveDiscardWhenYouDoCount: 1,
      reflexiveDiscardWhenYouDoFollowupDescription: 'destroy target creature or planeswalker.',
    });
    expect(askStep.options.map((option: any) => option.id)).toEqual(['discard', 'decline']);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: askStep.id,
      selections: ['discard'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const discardStep = queue.steps.find((step: any) => step?.reflexiveDiscardWhenYouDo === true && step?.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();
    expect(discardStep).toMatchObject({
      sourceId: 'source_perm',
      sourceName: 'Discard Source',
      discardCount: 1,
      reflexiveDiscardWhenYouDoStage: 'select_discard',
    });
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['discard_card_1']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: discardStep.id,
      selections: ['discard_card_1'],
    });

    expect(((game.state as any).zones.p1.hand || []).map((card: any) => card.id)).toEqual([]);
    expect(((game.state as any).zones.p1.graveyard || []).map((card: any) => card.name)).toEqual(['Spare Spell']);

    const followupTrigger = ((game.state as any).stack || []).find((item: any) => String(item?.triggerType || '') === 'reflexive_discard') as any;
    expect(followupTrigger).toMatchObject({
      sourceName: 'Discard Source',
      source: 'source_perm',
      permanentId: 'source_perm',
      description: 'destroy target creature or planeswalker.',
      requiresTarget: true,
      targetType: 'creature or planeswalker',
      effectData: { discardedCardIds: ['discard_card_1'], discardCount: 1 },
    });

    const newEvents = getEvents(gameId).slice(eventStart);
    const discardEvent = [...newEvents].reverse().find((event: any) => event.type === 'discardEffect') as any;
    const resolveEvent = [...newEvents].reverse().find((event: any) => event.type === 'reflexiveDiscardResolve') as any;
    const pushEvent = [...newEvents].reverse().find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.triggerType === 'reflexive_discard') as any;
    expect(discardEvent?.payload).toMatchObject({
      playerId: 'p1',
      cardIds: ['discard_card_1'],
      destination: 'graveyard',
      resolvedStepId: discardStep.id,
      sourceId: 'source_perm',
    });
    expect(resolveEvent?.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'source_perm',
      cardIds: ['discard_card_1'],
      triggerId: followupTrigger.id,
      requiresTarget: true,
      targetType: 'creature or planeswalker',
    });
    expect(pushEvent?.payload).toMatchObject({
      triggerId: followupTrigger.id,
      sourceId: 'source_perm',
      permanentId: 'source_perm',
      triggerType: 'reflexive_discard',
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
    seedDiscardReflexiveGame(replayGame);
    (replayGame.state as any).stack = [];
    ResolutionQueueManager.addStep(replayGameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: 'p1' as any,
      sourceId: 'source_perm',
      sourceName: 'Discard Source',
      description: 'Discard Source: Discard 1 card',
      mandatory: true,
      discardCount: 1,
      hand: [{ id: 'discard_card_1', name: 'Spare Spell' }],
      reflexiveDiscardWhenYouDo: true,
      reflexiveDiscardWhenYouDoStage: 'select_discard',
    } as any);

    replayGame.applyEvent({ type: 'discardEffect', ...(discardEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'reflexiveDiscardResolve', ...(resolveEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'pushTriggeredAbility', ...(pushEvent.payload || {}) } as any);

    expect(((replayGame.state as any).zones.p1.hand || []).map((card: any) => card.id)).toEqual([]);
    expect(((replayGame.state as any).zones.p1.graveyard || []).map((card: any) => card.name)).toEqual(['Spare Spell']);
    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toHaveLength(0);

    const replayStack = (replayGame.state as any).stack || [];
    expect(replayStack).toHaveLength(1);
    expect(replayStack[0]).toMatchObject({
      id: followupTrigger.id,
      sourceName: 'Discard Source',
      triggerType: 'reflexive_discard',
      requiresTarget: true,
      targetType: 'creature or planeswalker',
    });
  });
});
