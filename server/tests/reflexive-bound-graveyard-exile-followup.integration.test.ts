import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
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

function seedBoundSelfExileGame(game: any) {
  const playerId = 'p1';
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).battlefield = [
    {
      id: 'undead_butler_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      basePower: 1,
      baseToughness: 2,
      card: {
        id: 'undead_butler_card',
        name: 'Undead Butler',
        type_line: 'Creature - Zombie Butler',
        oracle_text: 'When this creature dies, you may exile it. When you do, return target creature card from your graveyard to your hand.',
        zone: 'battlefield',
        power: '1',
        toughness: '2',
      },
    },
  ];
  (game.state as any).stack = [];
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      graveyard: [
        {
          id: 'return_target_card',
          name: 'Gravedigger',
          type_line: 'Creature - Zombie',
          oracle_text: '',
          mana_cost: '{3}{B}',
          cmc: 4,
          zone: 'graveyard',
        },
      ],
      graveyardCount: 1,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
  };
}

function seedBoundSelfExileIfYouDoGame(game: any) {
  seedBoundSelfExileGame(game);
  const permanent = (game.state as any).battlefield[0];
  permanent.id = 'greenwarden_perm';
  permanent.basePower = 5;
  permanent.baseToughness = 4;
  permanent.card = {
    id: 'greenwarden_card',
    name: 'Greenwarden of Murasa',
    type_line: 'Creature - Elemental',
    oracle_text: 'When this creature dies, you may exile it. If you do, return target card from your graveyard to your hand.',
    zone: 'battlefield',
    power: '5',
    toughness: '4',
  };
}

function seedThenSelfExilePreludeGame(game: any) {
  const playerId = 'p1';
  const opponentId = 'p2';
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).battlefield = [
    {
      id: 'flitting_guerrilla_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      basePower: 2,
      baseToughness: 2,
      card: {
        id: 'flitting_guerrilla_card',
        name: 'Flitting Guerrilla',
        type_line: 'Creature - Faerie Rogue',
        oracle_text: 'When this creature dies, each player mills two cards. Then you may exile this card. When you do, put target creature or battle card from your graveyard on top of your library.',
        zone: 'battlefield',
        power: '2',
        toughness: '2',
      },
    },
  ];
  (game.state as any).stack = [];
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 2,
    },
    [opponentId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 2,
    },
  };

  (game as any).libraries.set(playerId, [
    { id: 'milled_creature_card', name: 'Helpful Recruit', type_line: 'Creature - Soldier', oracle_text: '', zone: 'library' },
    { id: 'milled_land_card', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '', zone: 'library' },
  ]);
  (game as any).libraries.set(opponentId, [
    { id: 'opponent_milled_one', name: 'Island', type_line: 'Basic Land - Island', oracle_text: '', zone: 'library' },
    { id: 'opponent_milled_two', name: 'Cancel', type_line: 'Instant', oracle_text: '', zone: 'library' },
  ]);
}

describe('reflexive bound graveyard self-exile follow-up prompts (integration replay)', () => {
  const gameId = 'test_reflexive_bound_graveyard_exile_followup';
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

  it('discovers, resolves, and replays a bound self-exile death-trigger follow-up', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBoundSelfExileGame(game);
    const eventStart = getEvents(gameId).length;

    expect(movePermanentToGraveyard(game as any, 'undead_butler_perm')).toBe(true);

    const deathTrigger = ((game.state as any).stack || [])[0] as any;
    expect(deathTrigger).toMatchObject({
      sourceName: 'Undead Butler',
      description: 'you may exile it. when you do, return target creature card from your graveyard to your hand.',
      boundGraveyardCardId: 'undead_butler_card',
      boundGraveyardOwnerId: 'p1',
    });

    game.resolveTopOfStack();

    let queue = ResolutionQueueManager.getQueue(gameId);
    const askStep = queue.steps.find((step: any) => step?.reflexiveBoundGraveyardSelfExileWhenYouDo === true) as any;
    expect(askStep).toBeDefined();
    expect(askStep).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      sourceId: 'undead_butler_perm',
      sourceName: 'Undead Butler',
      reflexiveBoundGraveyardSelfExileWhenYouDoStage: 'ask',
      reflexiveBoundGraveyardSelfExileWhenYouDoBoundCardId: 'undead_butler_card',
      reflexiveBoundGraveyardSelfExileWhenYouDoBoundOwnerId: 'p1',
      reflexiveBoundGraveyardSelfExileWhenYouDoFollowupDescription: 'return target creature card from your graveyard to your hand.',
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: askStep.id,
      selections: ['exile'],
    });

    expect(((game.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual(['return_target_card']);
    expect(((game.state as any).zones.p1.exile || []).map((card: any) => card.id)).toEqual(['undead_butler_card']);

    const followupTrigger = ((game.state as any).stack || []).find((item: any) => String(item?.triggerType || '') === 'reflexive_graveyard_exile') as any;
    expect(followupTrigger).toMatchObject({
      sourceName: 'Undead Butler',
      source: 'undead_butler_perm',
      permanentId: 'undead_butler_perm',
      description: 'return target creature card from your graveyard to your hand.',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'hand',
      targetFilterTypes: ['creature'],
      effectData: {
        exiledCardIds: ['undead_butler_card'],
        exileCount: 1,
        boundGraveyardCardId: 'undead_butler_card',
        boundGraveyardOwnerId: 'p1',
      },
    });

    const newEvents = getEvents(gameId).slice(eventStart);
    const resolveEvent = [...newEvents].reverse().find((event: any) => event.type === 'reflexiveGraveyardExileResolve') as any;
    const pushEvent = [...newEvents].reverse().find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.triggerType === 'reflexive_graveyard_exile') as any;
    expect(resolveEvent?.payload).toMatchObject({
      playerId: 'p1',
      zoneOwnerId: 'p1',
      sourceId: 'undead_butler_perm',
      cardIds: ['undead_butler_card'],
      triggerId: followupTrigger.id,
      targetZone: 'graveyard',
      targetDestination: 'hand',
    });
    expect(pushEvent?.payload).toMatchObject({
      triggerId: followupTrigger.id,
      sourceId: 'undead_butler_perm',
      permanentId: 'undead_butler_perm',
      triggerType: 'reflexive_graveyard_exile',
    });

    game.resolveTopOfStack();

    queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((step: any) => step?.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((card: any) => card.id)).toEqual(['return_target_card']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: targetStep.id,
      selections: ['return_target_card'],
    });

    expect(((game.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual([]);
    expect(((game.state as any).zones.p1.hand || []).map((card: any) => card.id)).toEqual(['return_target_card']);

    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    seedBoundSelfExileGame(replayGame);
    (replayGame.state as any).battlefield = [];
    (replayGame.state as any).stack = [];
    (replayGame.state as any).zones.p1.graveyard.push({
      id: 'undead_butler_card',
      name: 'Undead Butler',
      type_line: 'Creature - Zombie Butler',
      oracle_text: 'When this creature dies, you may exile it. When you do, return target creature card from your graveyard to your hand.',
      zone: 'graveyard',
    });
    (replayGame.state as any).zones.p1.graveyardCount = 2;
    ResolutionQueueManager.addStep(replayGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1' as any,
      sourceId: 'undead_butler_perm',
      sourceName: 'Undead Butler',
      description: 'Undead Butler: You may exile Undead Butler.',
      mandatory: false,
      options: [{ id: 'exile', label: 'Exile Undead Butler' }, { id: 'decline', label: 'Decline' }],
      minSelections: 1,
      maxSelections: 1,
      reflexiveBoundGraveyardSelfExileWhenYouDo: true,
      reflexiveBoundGraveyardSelfExileWhenYouDoStage: 'ask',
    } as any);

    replayGame.applyEvent({ type: 'reflexiveGraveyardExileResolve', ...(resolveEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'pushTriggeredAbility', ...(pushEvent.payload || {}) } as any);

    expect(((replayGame.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual(['return_target_card']);
    expect(((replayGame.state as any).zones.p1.exile || []).map((card: any) => card.id)).toEqual(['undead_butler_card']);
    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toHaveLength(0);
    expect(((replayGame.state as any).stack || [])[0]).toMatchObject({
      id: followupTrigger.id,
      sourceName: 'Undead Butler',
      triggerType: 'reflexive_graveyard_exile',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'hand',
    });
  });

  it('supports if-you-do wording for bound self-exile death-trigger follow-ups', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBoundSelfExileIfYouDoGame(game);

    expect(movePermanentToGraveyard(game as any, 'greenwarden_perm')).toBe(true);

    const deathTrigger = ((game.state as any).stack || [])[0] as any;
    expect(deathTrigger).toMatchObject({
      sourceName: 'Greenwarden of Murasa',
      description: 'you may exile it. if you do, return target card from your graveyard to your hand.',
      boundGraveyardCardId: 'greenwarden_card',
      boundGraveyardOwnerId: 'p1',
    });

    game.resolveTopOfStack();

    const askStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.reflexiveBoundGraveyardSelfExileWhenYouDo === true) as any;
    expect(askStep).toBeDefined();
    expect(askStep).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      sourceId: 'greenwarden_perm',
      sourceName: 'Greenwarden of Murasa',
      reflexiveBoundGraveyardSelfExileWhenYouDoBoundCardId: 'greenwarden_card',
      reflexiveBoundGraveyardSelfExileWhenYouDoBoundOwnerId: 'p1',
      reflexiveBoundGraveyardSelfExileWhenYouDoFollowupConnector: 'if',
      reflexiveBoundGraveyardSelfExileWhenYouDoFollowupDescription: 'return target card from your graveyard to your hand.',
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: askStep.id,
      selections: ['exile'],
    });

    expect(((game.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual(['return_target_card']);
    expect(((game.state as any).zones.p1.exile || []).map((card: any) => card.id)).toEqual(['greenwarden_card']);

    const followupTrigger = ((game.state as any).stack || []).find((item: any) => String(item?.triggerType || '') === 'reflexive_graveyard_exile') as any;
    expect(followupTrigger).toMatchObject({
      sourceName: 'Greenwarden of Murasa',
      source: 'greenwarden_perm',
      description: 'return target card from your graveyard to your hand.',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'hand',
      effectData: {
        exiledCardIds: ['greenwarden_card'],
        boundGraveyardCardId: 'greenwarden_card',
        boundGraveyardOwnerId: 'p1',
      },
    });
  });

  it('resolves and replays a mill prelude before then-self-exile follow-up prompts', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedThenSelfExilePreludeGame(game);
    const eventStart = getEvents(gameId).length;

    expect(movePermanentToGraveyard(game as any, 'flitting_guerrilla_perm')).toBe(true);

    const deathTrigger = ((game.state as any).stack || [])[0] as any;
    expect(deathTrigger).toMatchObject({
      sourceName: 'Flitting Guerrilla',
      description: 'each player mills two cards. then you may exile this card. when you do, put target creature or battle card from your graveyard on top of your library.',
      boundGraveyardCardId: 'flitting_guerrilla_card',
      boundGraveyardOwnerId: 'p1',
    });

    game.resolveTopOfStack();

    const millPreludeEvents = getEvents(gameId)
      .slice(eventStart)
      .filter((event: any) => event.type === 'mill' && event.payload?.reason === 'reflexive_bound_graveyard_self_exile_prelude');
    expect(millPreludeEvents.map((event: any) => event.payload?.playerId).sort()).toEqual(['p1', 'p2']);
    expect(millPreludeEvents.every((event: any) => Number(event.payload?.count) === 2)).toBe(true);

    expect(((game.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual([
      'flitting_guerrilla_card',
      'milled_creature_card',
      'milled_land_card',
    ]);
    expect(((game.state as any).zones.p2.graveyard || []).map((card: any) => card.id)).toEqual([
      'opponent_milled_one',
      'opponent_milled_two',
    ]);

    const askStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.reflexiveBoundGraveyardSelfExileWhenYouDo === true) as any;
    expect(askStep).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      sourceId: 'flitting_guerrilla_perm',
      sourceName: 'Flitting Guerrilla',
      reflexiveBoundGraveyardSelfExileWhenYouDoBoundCardId: 'flitting_guerrilla_card',
      reflexiveBoundGraveyardSelfExileWhenYouDoBoundOwnerId: 'p1',
      reflexiveBoundGraveyardSelfExileWhenYouDoFollowupConnector: 'when',
      reflexiveBoundGraveyardSelfExileWhenYouDoFollowupDescription: 'put target creature or battle card from your graveyard on top of your library.',
    });

    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    seedThenSelfExilePreludeGame(replayGame);
    for (const event of millPreludeEvents) {
      replayGame.applyEvent({ type: 'mill', ...(event.payload || {}) } as any);
    }
    expect(((replayGame.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual([
      'milled_creature_card',
      'milled_land_card',
    ]);
    expect(((replayGame.state as any).zones.p2.graveyard || []).map((card: any) => card.id)).toEqual([
      'opponent_milled_one',
      'opponent_milled_two',
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: askStep.id,
      selections: ['exile'],
    });

    expect(((game.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual([
      'milled_creature_card',
      'milled_land_card',
    ]);
    expect(((game.state as any).zones.p1.exile || []).map((card: any) => card.id)).toEqual(['flitting_guerrilla_card']);

    const followupTrigger = ((game.state as any).stack || []).find((item: any) => String(item?.triggerType || '') === 'reflexive_graveyard_exile') as any;
    expect(followupTrigger).toMatchObject({
      sourceName: 'Flitting Guerrilla',
      source: 'flitting_guerrilla_perm',
      description: 'put target creature or battle card from your graveyard on top of your library.',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'library_top',
      targetFilterTypes: ['creature', 'battle'],
      effectData: {
        exiledCardIds: ['flitting_guerrilla_card'],
        boundGraveyardCardId: 'flitting_guerrilla_card',
        boundGraveyardOwnerId: 'p1',
      },
    });

    game.resolveTopOfStack();

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.type === ResolutionStepType.GRAVEYARD_SELECTION) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((card: any) => card.id)).toEqual(['milled_creature_card']);
    expect(targetStep).toMatchObject({
      destination: 'library_top',
      targetPlayerId: 'p1',
    });

    await handlers.submitResolutionResponse({
      gameId,
      stepId: targetStep.id,
      selections: ['milled_creature_card'],
    });

    expect(((game.state as any).zones.p1.graveyard || []).map((card: any) => card.id)).toEqual(['milled_land_card']);
    expect(((game as any).libraries.get('p1') || []).map((card: any) => card.id)).toEqual(['milled_creature_card']);
  });
});