import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: {
      sockets: new Map(),
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

function getQueuedOrActiveStep(queue: any): any {
  return queue?.activeStep || (Array.isArray(queue?.steps) ? queue.steps[0] : undefined);
}

describe('venture and initiative support (integration)', () => {
  const venturePromptGameId = 'test_venture_prompt_integration';
  const ventureChoiceGameId = 'test_venture_choice_integration';
  const ventureChoiceScryGameId = 'test_venture_choice_scry_integration';
  const ventureBranchPromptGameId = 'test_venture_branch_prompt_integration';
  const ventureBranchChoiceGameId = 'test_venture_branch_choice_integration';
  const ventureForgeChoiceGameId = 'test_venture_forge_choice_integration';
  const ventureTrapChoiceGameId = 'test_venture_trap_choice_integration';
  const ventureArenaChoiceGameId = 'test_venture_arena_choice_integration';
  const ventureVeilsChoiceGameId = 'test_venture_veils_choice_integration';
  const ventureSandfallChoiceGameId = 'test_venture_sandfall_choice_integration';
  const ventureOublietteChoiceGameId = 'test_venture_oubliette_choice_integration';
  const ventureStashChoiceGameId = 'test_venture_stash_choice_integration';
  const ventureFungiChoiceGameId = 'test_venture_fungi_choice_integration';
  const ventureRunestoneChoiceGameId = 'test_venture_runestone_choice_integration';
  const ventureAutoRoomGameId = 'test_venture_auto_room_integration';
  const ventureCradleAutoRoomGameId = 'test_venture_cradle_auto_room_integration';
  const ventureTwistedChoiceGameId = 'test_venture_twisted_choice_integration';
  const ventureMadWizardAutoRoomGameId = 'test_venture_mad_wizard_auto_room_integration';
  const ventureThroneAutoRoomGameId = 'test_venture_throne_auto_room_integration';
  const initiativeTakeGameId = 'test_initiative_take_integration';
  const initiativeAdvanceGameId = 'test_initiative_advance_integration';
  const initiativeUpkeepGameId = 'test_initiative_upkeep_integration';
  const initiativeSpellGameId = 'test_initiative_spell_integration';
  const resetGameIds = [
    venturePromptGameId,
    ventureChoiceGameId,
    ventureChoiceScryGameId,
    ventureBranchPromptGameId,
    ventureBranchChoiceGameId,
    ventureForgeChoiceGameId,
    ventureTrapChoiceGameId,
    ventureArenaChoiceGameId,
    ventureVeilsChoiceGameId,
    ventureSandfallChoiceGameId,
    ventureOublietteChoiceGameId,
    ventureStashChoiceGameId,
    ventureFungiChoiceGameId,
    ventureRunestoneChoiceGameId,
    ventureAutoRoomGameId,
    ventureCradleAutoRoomGameId,
    ventureTwistedChoiceGameId,
    ventureMadWizardAutoRoomGameId,
    ventureThroneAutoRoomGameId,
    initiativeTakeGameId,
    initiativeAdvanceGameId,
    initiativeUpkeepGameId,
    initiativeSpellGameId,
  ];

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const gameId of resetGameIds) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of resetGameIds) {
      await resetGame(gameId);
    }
  });

  it('queues and persists the AFR dungeon choice when a trigger says venture into the dungeon', () => {
    createGameIfNotExists(venturePromptGameId, 'commander', 40);
    const game = ensureGame(venturePromptGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = venturePromptGameId;
    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_venture_1',
        type: 'triggered_ability',
        controller: 'p1',
        sourceName: 'Test Venture Trigger',
        description: 'Venture into the dungeon.',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(venturePromptGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect((queue.steps[0] as any).ventureChooseDungeon).toBe(true);
    expect(((queue.steps[0] as any).options || []).map((option: any) => option.id)).toEqual([
      'lost_mine',
      'mad_mage',
      'tomb',
    ]);

    const promptEvent = getEvents(venturePromptGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'trigger_venture_1',
      queuedResolutionStep: {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: 'p1',
        ventureChooseDungeon: true,
      },
    });

    const replayGameId = `${venturePromptGameId}_replay`;
    ResolutionQueueManager.removeQueue(replayGameId);
    const replayGame = createInitialGameState(replayGameId);
    replayGame.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    replayGame.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent.payload || {}) } as any);
    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect(replayQueue.steps).toHaveLength(1);
    expect((replayQueue.steps[0] as any).ventureChooseDungeon).toBe(true);
  });

  it('persists and replays the chosen dungeon after the venture choice is answered', async () => {
    createGameIfNotExists(ventureChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    game.libraries.set(playerId as any, [
      { id: 'mad_mage_top_1', name: 'Top Card', type_line: 'Instant', oracle_text: 'Draw a card.' } as any,
    ]);

    const step = ResolutionQueueManager.addStep(ventureChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose a dungeon to enter',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'lost_mine', label: 'Lost Mine of Phandelver' },
        { id: 'mad_mage', label: 'Dungeon of the Mad Mage' },
        { id: 'tomb', label: 'Tomb of Annihilation' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseDungeon: true,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureChoiceGameId, stepId: step.id, selections: 'mad_mage' });

    expect(((game.state as any).dungeonProgress || {})[playerId]).toMatchObject({
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      roomIndex: 0,
      currentRoomId: 'yawning_portal',
      currentRoomName: 'Yawning Portal',
      roomPath: ['yawning_portal'],
    });
    expect(((game.state as any).life || {})[playerId] ?? (game.state as any).players[0]?.life).toBe(41);

    const persistedEvent = [...getEvents(ventureChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'ventureChooseDungeonResolve'
    ) as any;
    expect(persistedEvent).toBeDefined();

    const replayGame = createInitialGameState(`${ventureChoiceGameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    replayGame.applyEvent({ type: 'ventureChooseDungeonResolve', ...(persistedEvent.payload || {}) } as any);

    expect((((replayGame.state as any).dungeonProgress || {})[playerId])).toMatchObject({
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      roomIndex: 0,
      currentRoomId: 'yawning_portal',
      currentRoomName: 'Yawning Portal',
      roomPath: ['yawning_portal'],
    });
    expect((((replayGame.state as any).life || {})[playerId] ?? (replayGame.state as any).players?.[0]?.life)).toBe(41);
  });

  it('queues and replays a Scry prompt when the chosen dungeon enters Cave Entrance', async () => {
    createGameIfNotExists(ventureChoiceScryGameId, 'commander', 40);
    const game = ensureGame(ventureChoiceScryGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    game.libraries.set(playerId as any, [
      { id: 'lost_mine_top_1', name: 'Top Card', type_line: 'Instant', oracle_text: 'Draw a card.' } as any,
    ]);

    const step = ResolutionQueueManager.addStep(ventureChoiceScryGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose a dungeon to enter',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'lost_mine', label: 'Lost Mine of Phandelver' },
        { id: 'mad_mage', label: 'Dungeon of the Mad Mage' },
        { id: 'tomb', label: 'Tomb of Annihilation' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseDungeon: true,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureChoiceScryGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureChoiceScryGameId, stepId: step.id, selections: 'lost_mine' });

    expect(((game.state as any).dungeonProgress || {})[playerId]).toMatchObject({
      dungeonId: 'lost_mine',
      dungeonName: 'Lost Mine of Phandelver',
      roomIndex: 0,
      currentRoomId: 'cave_entrance',
      currentRoomName: 'Cave Entrance',
      roomPath: ['cave_entrance'],
    });

    const queue = ResolutionQueueManager.getQueue(ventureChoiceScryGameId);
    const queuedScryStep = getQueuedOrActiveStep(queue);
    expect(queuedScryStep).toBeDefined();
    expect((queuedScryStep as any)?.type).toBe(ResolutionStepType.SCRY);
    expect(Number((queuedScryStep as any)?.scryCount || 0)).toBe(1);

    const persistedEvent = [...getEvents(ventureChoiceScryGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'ventureChooseDungeonResolve'
    ) as any;
    expect(persistedEvent).toBeDefined();

    const promptEvent = [...getEvents(ventureChoiceScryGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
        && String(event?.payload?.queuedResolutionStep?.type || '') === String(ResolutionStepType.SCRY)
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId,
      queuedResolutionStep: {
        type: ResolutionStepType.SCRY,
        playerId,
        scryCount: 1,
      },
    });

    const replayGame = createInitialGameState(`${ventureChoiceScryGameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    replayGame.applyEvent({ type: 'ventureChooseDungeonResolve', ...(persistedEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent.payload || {}) } as any);

    const replayQueue = ResolutionQueueManager.getQueue(`${ventureChoiceScryGameId}_replay`);
    const replayQueuedScryStep = getQueuedOrActiveStep(replayQueue);
    expect(replayQueuedScryStep).toBeDefined();
    expect((replayQueuedScryStep as any)?.type).toBe(ResolutionStepType.SCRY);
    expect(Number((replayQueuedScryStep as any)?.scryCount || 0)).toBe(1);
  });

  it('applies deterministic final-room effects when venturing through a non-branching room transition', () => {
    createGameIfNotExists(ventureAutoRoomGameId, 'commander', 40);
    const game = ensureGame(ventureAutoRoomGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'lost_mine',
        dungeonName: 'Lost Mine of Phandelver',
        roomIndex: 2,
        currentRoomId: 'dark_pool',
        currentRoomName: 'Dark Pool',
        currentRoomEffect: 'Each opponent loses 1 life and you gain 1 life.',
        roomPath: ['cave_entrance', 'goblin_lair', 'dark_pool'],
      },
    };
    game.libraries.set(playerId as any, [
      {
        id: 'drawn_1',
        name: 'Drawn Card',
        zone: 'library',
      } as any,
    ]);
    (game.state as any).stack = [
      {
        id: 'trigger_venture_auto_1',
        type: 'triggered_ability',
        controller: playerId,
        sourceName: 'Test Venture Trigger',
        description: 'Venture into the dungeon.',
      },
    ];

    game.resolveTopOfStack();

    expect((((game.state as any).dungeonProgress || {})[playerId])).toBeUndefined();
    expect((((game.state as any).completedDungeons || {})[playerId])).toBe(1);
    expect((((game.state as any).completedDungeonNames || {})[playerId] || [])).toContain('Lost Mine of Phandelver');
    expect((((game.state as any).zones || {})[playerId]?.hand || []).map((card: any) => card.id)).toContain('drawn_1');
  });

  it('queues and persists a branch-room choice when venturing from a room with multiple next rooms', () => {
    createGameIfNotExists(ventureBranchPromptGameId, 'commander', 40);
    const game = ensureGame(ventureBranchPromptGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).dungeonProgress = {
      p1: {
        dungeonId: 'undercity',
        dungeonName: 'Undercity',
        roomIndex: 0,
        currentRoomId: 'secret_entrance',
        currentRoomName: 'Secret Entrance',
        currentRoomEffect: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
        roomPath: ['secret_entrance'],
      },
    };
    (game.state as any).stack = [
      {
        id: 'trigger_venture_branch_1',
        type: 'triggered_ability',
        controller: 'p1',
        sourceName: 'Test Venture Trigger',
        description: 'Venture into the dungeon.',
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(ventureBranchPromptGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).ventureChooseRoom).toBe(true);
    expect(((queue.steps[0] as any).options || []).map((option: any) => option.id)).toEqual([
      'forge',
      'lost_well',
    ]);

    const promptEvent = getEvents(ventureBranchPromptGameId).find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      sourceId: 'trigger_venture_branch_1',
      queuedResolutionStep: {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: 'p1',
        ventureChooseRoom: true,
        ventureDungeonId: 'undercity',
        ventureCurrentRoomId: 'secret_entrance',
      },
    });
  });

  it('creates and persists a replay-safe Treasure token when choosing Stash', async () => {
    createGameIfNotExists(ventureStashChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureStashChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'undercity',
        dungeonName: 'Undercity',
        roomIndex: 1,
        currentRoomId: 'lost_well',
        currentRoomName: 'Lost Well',
        currentRoomEffect: 'Scry 2.',
        roomPath: ['secret_entrance', 'lost_well'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureStashChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Undercity',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'arena', label: 'Arena - Goad target creature.' },
        { id: 'stash', label: 'Stash - Create a Treasure token.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'undercity',
      ventureCurrentRoomId: 'lost_well',
      ventureRoomPath: ['secret_entrance', 'lost_well'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureStashChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureStashChoiceGameId, stepId: step.id, selections: 'stash' });

    expect(((game.state as any).dungeonProgress || {})[playerId]).toMatchObject({
      dungeonId: 'undercity',
      currentRoomId: 'stash',
      roomPath: ['secret_entrance', 'lost_well', 'stash'],
    });

    const treasureTokens = ((game.state as any).battlefield || []).filter((permanent: any) => {
      return permanent?.isToken === true && String(permanent?.card?.type_line || '').includes('Treasure');
    });
    expect(treasureTokens).toHaveLength(1);

    const tokenEvent = [...getEvents(ventureStashChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'executeEffect'
        && String(event?.payload?.effectType || '') === 'createToken'
        && String(event?.payload?.tokenData?.typeLine || '').includes('Treasure')
    ) as any;
    expect(tokenEvent).toBeDefined();
    expect(tokenEvent.payload).toMatchObject({
      controllerId: playerId,
      tokenData: {
        id: treasureTokens[0].id,
        name: 'Treasure',
        typeLine: 'Token Artifact — Treasure',
      },
    });
  });

  it('queues Veils of Fear discard payment for players with cards and auto-applies life loss for players without a hand', async () => {
    createGameIfNotExists(ventureVeilsChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureVeilsChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const discardCardId = 'veils_hand_card_1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, p2: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: discardCardId,
            name: 'Island',
            type_line: 'Basic Land — Island',
            image_uris: {},
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      p2: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'tomb',
        dungeonName: 'Tomb of Annihilation',
        roomIndex: 0,
        currentRoomId: 'trapped_entry',
        currentRoomName: 'Trapped Entry',
        currentRoomEffect: 'Each player loses 1 life.',
        roomPath: ['trapped_entry'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureVeilsChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Tomb of Annihilation',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'veils_of_fear', label: 'Veils of Fear - Each player loses 2 life unless they discard a card.' },
        { id: 'oubliette', label: 'Oubliette - Discard a card and sacrifice a creature, an artifact, and a land.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'tomb',
      ventureCurrentRoomId: 'trapped_entry',
      ventureRoomPath: ['trapped_entry'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureVeilsChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureVeilsChoiceGameId, stepId: step.id, selections: 'veils_of_fear' });

    expect(((game.state as any).life || {}).p2).toBe(38);
    const penaltyChoiceStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureVeilsChoiceGameId));
    expect((penaltyChoiceStep as any)?.dungeonRoomPenaltyChoice).toMatchObject({
      dungeonId: 'tomb',
      roomId: 'veils_of_fear',
      paymentType: 'discard',
      amount: 2,
    });

    await handlers['submitResolutionResponse']({
      gameId: ventureVeilsChoiceGameId,
      stepId: (penaltyChoiceStep as any).id,
      selections: 'discard_card',
    });

    const discardStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureVeilsChoiceGameId));
    expect((discardStep as any)?.type).toBe(ResolutionStepType.DISCARD_SELECTION);
    expect((discardStep as any)?.dungeonRoomPayment).toMatchObject({
      dungeonId: 'tomb',
      roomId: 'veils_of_fear',
      paymentType: 'discard',
    });

    await handlers['submitResolutionResponse']({
      gameId: ventureVeilsChoiceGameId,
      stepId: (discardStep as any).id,
      selections: [discardCardId],
    });

    expect(((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id)).not.toContain(discardCardId);
    expect(((game.state as any).zones?.[playerId]?.graveyard || []).map((card: any) => card.id)).toContain(discardCardId);
    expect(((game.state as any).life || {})[playerId]).toBe(40);

    const choiceEvent = [...getEvents(ventureVeilsChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'dungeonRoomPenaltyChoiceResolve'
    ) as any;
    expect(choiceEvent?.payload?.choice).toBe('discard');

    const discardEvent = [...getEvents(ventureVeilsChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'discardEffect'
    ) as any;
    expect(discardEvent?.payload?.dungeonRoomPayment).toMatchObject({
      dungeonId: 'tomb',
      roomId: 'veils_of_fear',
      paymentType: 'discard',
    });
  });

  it('queues Sandfall Cell sacrifice payment for players with valid permanents and auto-applies life loss otherwise', async () => {
    createGameIfNotExists(ventureSandfallChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureSandfallChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const creatureId = 'sandfall_creature_1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [playerId]: 40, p2: 40 };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: creatureId,
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'sandfall_creature_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
          image_uris: {},
        },
      },
      {
        id: 'sandfall_enchantment_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'sandfall_enchantment_card_1',
          name: 'Pacifism',
          type_line: 'Enchantment — Aura',
          image_uris: {},
        },
      },
    ];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'tomb',
        dungeonName: 'Tomb of Annihilation',
        roomIndex: 1,
        currentRoomId: 'veils_of_fear',
        currentRoomName: 'Veils of Fear',
        currentRoomEffect: 'Each player loses 2 life unless they discard a card.',
        roomPath: ['trapped_entry', 'veils_of_fear'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureSandfallChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Tomb of Annihilation',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'sandfall_cell', label: 'Sandfall Cell - Each player loses 2 life unless they sacrifice a creature, artifact, or land.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'tomb',
      ventureCurrentRoomId: 'veils_of_fear',
      ventureRoomPath: ['trapped_entry', 'veils_of_fear'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureSandfallChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureSandfallChoiceGameId, stepId: step.id, selections: 'sandfall_cell' });

    expect(((game.state as any).life || {}).p2).toBe(38);
    const penaltyChoiceStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureSandfallChoiceGameId));
    expect((penaltyChoiceStep as any)?.dungeonRoomPenaltyChoice).toMatchObject({
      dungeonId: 'tomb',
      roomId: 'sandfall_cell',
      paymentType: 'sacrifice',
      amount: 2,
    });

    await handlers['submitResolutionResponse']({
      gameId: ventureSandfallChoiceGameId,
      stepId: (penaltyChoiceStep as any).id,
      selections: 'sacrifice_permanent',
    });

    const sacrificeStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureSandfallChoiceGameId));
    expect((sacrificeStep as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((sacrificeStep as any)?.dungeonRoomPayment).toMatchObject({
      dungeonId: 'tomb',
      roomId: 'sandfall_cell',
      paymentType: 'sacrifice',
    });

    await handlers['submitResolutionResponse']({
      gameId: ventureSandfallChoiceGameId,
      stepId: (sacrificeStep as any).id,
      selections: [creatureId],
    });

    expect(((game.state as any).battlefield || []).some((permanent: any) => permanent.id === creatureId)).toBe(false);
    expect(((game.state as any).zones?.[playerId]?.graveyard || []).map((card: any) => card.name)).toContain('Runeclaw Bear');
    expect(((game.state as any).life || {})[playerId]).toBe(40);

    const sacrificeEvent = [...getEvents(ventureSandfallChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'sacrificePermanent'
    ) as any;
    expect(sacrificeEvent?.payload?.dungeonRoomPayment).toMatchObject({
      dungeonId: 'tomb',
      roomId: 'sandfall_cell',
      paymentType: 'sacrifice',
    });
  });

  it('queues Oubliette as sequential discard and sacrifice payments', async () => {
    createGameIfNotExists(ventureOublietteChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureOublietteChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const discardCardId = 'oubliette_hand_card_1';
    const creatureId = 'oubliette_creature_1';
    const artifactId = 'oubliette_artifact_1';
    const landId = 'oubliette_land_1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: discardCardId,
            name: 'Swamp',
            type_line: 'Basic Land — Swamp',
            image_uris: {},
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: creatureId,
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { id: 'oubliette_creature_card_1', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2', image_uris: {} },
      },
      {
        id: artifactId,
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { id: 'oubliette_artifact_card_1', name: 'Sol Ring', type_line: 'Artifact', image_uris: {} },
      },
      {
        id: landId,
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { id: 'oubliette_land_card_1', name: 'Wastes', type_line: 'Basic Land', image_uris: {} },
      },
    ];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'tomb',
        dungeonName: 'Tomb of Annihilation',
        roomIndex: 0,
        currentRoomId: 'trapped_entry',
        currentRoomName: 'Trapped Entry',
        currentRoomEffect: 'Each player loses 1 life.',
        roomPath: ['trapped_entry'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureOublietteChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Tomb of Annihilation',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'veils_of_fear', label: 'Veils of Fear - Each player loses 2 life unless they discard a card.' },
        { id: 'oubliette', label: 'Oubliette - Discard a card and sacrifice a creature, an artifact, and a land.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'tomb',
      ventureCurrentRoomId: 'trapped_entry',
      ventureRoomPath: ['trapped_entry'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureOublietteChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureOublietteChoiceGameId, stepId: step.id, selections: 'oubliette' });

    expect(ResolutionQueueManager.getQueue(ventureOublietteChoiceGameId).steps).toHaveLength(4);

    let queuedStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureOublietteChoiceGameId));
    expect((queuedStep as any)?.type).toBe(ResolutionStepType.DISCARD_SELECTION);
    await handlers['submitResolutionResponse']({
      gameId: ventureOublietteChoiceGameId,
      stepId: (queuedStep as any).id,
      selections: [discardCardId],
    });

    queuedStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureOublietteChoiceGameId));
    expect((queuedStep as any)?.description).toContain('Sacrifice a creature');
    await handlers['submitResolutionResponse']({
      gameId: ventureOublietteChoiceGameId,
      stepId: (queuedStep as any).id,
      selections: [creatureId],
    });

    queuedStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureOublietteChoiceGameId));
    expect((queuedStep as any)?.description).toContain('Sacrifice an artifact');
    await handlers['submitResolutionResponse']({
      gameId: ventureOublietteChoiceGameId,
      stepId: (queuedStep as any).id,
      selections: [artifactId],
    });

    queuedStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureOublietteChoiceGameId));
    expect((queuedStep as any)?.description).toContain('Sacrifice a land');
    await handlers['submitResolutionResponse']({
      gameId: ventureOublietteChoiceGameId,
      stepId: (queuedStep as any).id,
      selections: [landId],
    });

    expect(((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id)).not.toContain(discardCardId);
    expect(((game.state as any).battlefield || []).some((permanent: any) => [creatureId, artifactId, landId].includes(permanent.id))).toBe(false);
    expect(((game.state as any).zones?.[playerId]?.graveyard || []).map((card: any) => card.name)).toEqual(
      expect.arrayContaining(['Swamp', 'Grizzly Bears', 'Sol Ring', 'Wastes']),
    );

    const discardEvents = getEvents(ventureOublietteChoiceGameId).filter(
      (event: any) => String(event?.type || '') === 'discardEffect'
    );
    const sacrificeEvents = getEvents(ventureOublietteChoiceGameId).filter(
      (event: any) => String(event?.type || '') === 'sacrificePermanent'
    );
    expect(discardEvents).toHaveLength(1);
    expect(sacrificeEvents).toHaveLength(3);
  });

  it('queues and persists Fungi Cavern target-creature resolution after choosing the room', async () => {
    createGameIfNotExists(ventureFungiChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureFungiChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const targetCreatureId = 'fungi_target_1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 6;
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'fungi_target_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
          image_uris: {},
        },
      },
    ];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'lost_mine',
        dungeonName: 'Lost Mine of Phandelver',
        roomIndex: 1,
        currentRoomId: 'mine_tunnels',
        currentRoomName: 'Mine Tunnels',
        currentRoomEffect: 'Create a Treasure token.',
        roomPath: ['cave_entrance', 'mine_tunnels'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureFungiChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Lost Mine of Phandelver',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'dark_pool', label: 'Dark Pool - Each opponent loses 1 life and you gain 1 life.' },
        { id: 'fungi_cavern', label: 'Fungi Cavern - Target creature gets -4/-0 until your next turn.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'lost_mine',
      ventureCurrentRoomId: 'mine_tunnels',
      ventureRoomPath: ['cave_entrance', 'mine_tunnels'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureFungiChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureFungiChoiceGameId, stepId: step.id, selections: 'fungi_cavern' });

    const queue = ResolutionQueueManager.getQueue(ventureFungiChoiceGameId);
    const queuedTargetStep = getQueuedOrActiveStep(queue);
    expect((queuedTargetStep as any)?.dungeonTargetCreatureEffect).toMatchObject({
      dungeonId: 'lost_mine',
      roomId: 'fungi_cavern',
      powerDelta: -4,
      toughnessDelta: 0,
    });

    await handlers['submitResolutionResponse']({
      gameId: ventureFungiChoiceGameId,
      stepId: (queuedTargetStep as any).id,
      selections: [targetCreatureId],
    });

    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(Array.isArray(targetCreature?.untilNextTurnPtMods) ? targetCreature.untilNextTurnPtMods : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ power: -4, toughness: 0, controllerId: playerId, turnApplied: 6 }),
      ]),
    );

    const resolveEvent = [...getEvents(ventureFungiChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'dungeonTargetCreatureResolve'
    ) as any;
    expect(resolveEvent?.payload).toMatchObject({
      playerId,
      selectedPermanentId: targetCreatureId,
      dungeonId: 'lost_mine',
      currentRoomId: 'fungi_cavern',
      powerDelta: -4,
      toughnessDelta: 0,
    });
  });

  it('exiles the top two cards for Runestone Caverns and marks them playable from exile', async () => {
    createGameIfNotExists(ventureRunestoneChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureRunestoneChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const runestoneCardA = {
      id: 'runestone_top_1',
      name: 'Opt',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text: 'Scry 1. Draw a card.',
      image_uris: {},
    };
    const runestoneCardB = {
      id: 'runestone_top_2',
      name: 'Island',
      type_line: 'Basic Land — Island',
      image_uris: {},
    };
    const runestoneCardC = {
      id: 'runestone_top_3',
      name: 'Swamp',
      type_line: 'Basic Land — Swamp',
      image_uris: {},
    };

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 3 },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    game.libraries.set(playerId, [runestoneCardA, runestoneCardB, runestoneCardC]);
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'mad_mage',
        dungeonName: 'Dungeon of the Mad Mage',
        roomIndex: 2,
        currentRoomId: 'lost_level',
        currentRoomName: 'Lost Level',
        currentRoomEffect: 'Scry 2.',
        roomPath: ['yawning_portal', 'dungeon_level', 'lost_level'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureRunestoneChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Dungeon of the Mad Mage',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'runestone_caverns', label: 'Runestone Caverns - Exile the top two cards of your library. You may play them.' },
        { id: 'muirals_graveyard', label: "Muiral's Graveyard - Create two 1/1 black Skeleton creature tokens." },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'mad_mage',
      ventureCurrentRoomId: 'lost_level',
      ventureRoomPath: ['yawning_portal', 'dungeon_level', 'lost_level'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureRunestoneChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureRunestoneChoiceGameId, stepId: step.id, selections: 'runestone_caverns' });

    expect((((game.state as any).zones?.[playerId]?.exile || []) as any[]).map((card: any) => card.id)).toEqual(['runestone_top_1', 'runestone_top_2']);
    expect(Array.isArray(game.libraries.get(playerId)) ? game.libraries.get(playerId).map((card: any) => card.id) : []).toEqual(['runestone_top_3']);
    expect((game.state as any).playableFromExile?.[playerId]?.runestone_top_1).toBe(true);
    expect((game.state as any).playableFromExile?.[playerId]?.runestone_top_2).toBe(true);

    const executeEffectEvent = [...getEvents(ventureRunestoneChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'executeEffect'
        && String(event?.payload?.effectType || '') === 'dungeonExileCards'
    ) as any;
    expect(executeEffectEvent?.payload?.exiledCards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'runestone_top_1', name: 'Opt' }),
        expect.objectContaining({ id: 'runestone_top_2', name: 'Island' }),
      ]),
    );
  });

  it('persists and replays the chosen next room after a branch-room choice is answered', async () => {
    createGameIfNotExists(ventureBranchChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureBranchChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).dungeonProgress = {
      p1: {
        dungeonId: 'undercity',
        dungeonName: 'Undercity',
        roomIndex: 0,
        currentRoomId: 'secret_entrance',
        currentRoomName: 'Secret Entrance',
        currentRoomEffect: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
        roomPath: ['secret_entrance'],
      },
    };
    game.libraries.set(playerId as any, [
      { id: 'lost_well_top_1', name: 'Top One', type_line: 'Instant', oracle_text: 'Draw a card.' } as any,
      { id: 'lost_well_top_2', name: 'Top Two', type_line: 'Sorcery', oracle_text: 'Draw a card.' } as any,
    ]);

    const step = ResolutionQueueManager.addStep(ventureBranchChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Undercity',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'forge', label: 'Forge - Put two +1/+1 counters on target creature.' },
        { id: 'lost_well', label: 'Lost Well - Scry 2.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'undercity',
      ventureCurrentRoomId: 'secret_entrance',
      ventureRoomPath: ['secret_entrance'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureBranchChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureBranchChoiceGameId, stepId: step.id, selections: 'lost_well' });

    expect(((game.state as any).dungeonProgress || {})[playerId]).toMatchObject({
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 1,
      currentRoomId: 'lost_well',
      currentRoomName: 'Lost Well',
      roomPath: ['secret_entrance', 'lost_well'],
    });

    const queue = ResolutionQueueManager.getQueue(ventureBranchChoiceGameId);
    const queuedScryStep = getQueuedOrActiveStep(queue);
    expect(queuedScryStep).toBeDefined();
    expect((queuedScryStep as any)?.type).toBe(ResolutionStepType.SCRY);
    expect(Number((queuedScryStep as any)?.scryCount || 0)).toBe(2);

    const persistedEvent = [...getEvents(ventureBranchChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'ventureChooseRoomResolve'
    ) as any;
    expect(persistedEvent).toBeDefined();
    expect(persistedEvent.payload).toMatchObject({
      playerId,
      dungeonId: 'undercity',
      currentRoomId: 'lost_well',
      roomPath: ['secret_entrance', 'lost_well'],
      completed: false,
    });

    const promptEvent = [...getEvents(ventureBranchChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
        && String(event?.payload?.queuedResolutionStep?.type || '') === String(ResolutionStepType.SCRY)
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId,
      queuedResolutionStep: {
        type: ResolutionStepType.SCRY,
        playerId,
        scryCount: 2,
      },
    });

    const replayGame = createInitialGameState(`${ventureBranchChoiceGameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    replayGame.applyEvent({ type: 'ventureChooseRoomResolve', ...(persistedEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent.payload || {}) } as any);

    expect((((replayGame.state as any).dungeonProgress || {})[playerId])).toMatchObject({
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 1,
      currentRoomId: 'lost_well',
      currentRoomName: 'Lost Well',
      roomPath: ['secret_entrance', 'lost_well'],
    });
    const replayQueue = ResolutionQueueManager.getQueue(`${ventureBranchChoiceGameId}_replay`);
    const replayQueuedScryStep = getQueuedOrActiveStep(replayQueue);
    expect(replayQueuedScryStep).toBeDefined();
    expect((replayQueuedScryStep as any)?.type).toBe(ResolutionStepType.SCRY);
  });

  it('queues and persists Trap target-player resolution after choosing the room', async () => {
    createGameIfNotExists(ventureTrapChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureTrapChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const targetPlayerId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: targetPlayerId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'undercity',
        dungeonName: 'Undercity',
        roomIndex: 1,
        currentRoomId: 'forge',
        currentRoomName: 'Forge',
        currentRoomEffect: 'Put two +1/+1 counters on target creature.',
        roomPath: ['secret_entrance', 'forge'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureTrapChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Undercity',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'trap', label: 'Trap! - Target player loses 5 life.' },
        { id: 'arena', label: 'Arena - Goad target creature.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'undercity',
      ventureCurrentRoomId: 'forge',
      ventureRoomPath: ['secret_entrance', 'forge'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureTrapChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureTrapChoiceGameId, stepId: step.id, selections: 'trap' });

    expect(((game.state as any).dungeonProgress || {})[playerId]).toMatchObject({
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 2,
      currentRoomId: 'trap',
      currentRoomName: 'Trap!',
      roomPath: ['secret_entrance', 'forge', 'trap'],
    });

    const queue = ResolutionQueueManager.getQueue(ventureTrapChoiceGameId);
    const queuedPlayerChoice = getQueuedOrActiveStep(queue);
    expect(queuedPlayerChoice).toBeDefined();
    expect((queuedPlayerChoice as any)?.type).toBe(ResolutionStepType.PLAYER_CHOICE);
    expect((queuedPlayerChoice as any)?.dungeonTargetPlayerEffect).toMatchObject({
      dungeonId: 'undercity',
      roomId: 'trap',
      amount: 5,
    });

    const promptEvent = [...getEvents(ventureTrapChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
        && String(event?.payload?.queuedResolutionStep?.type || '') === String(ResolutionStepType.PLAYER_CHOICE)
        && event?.payload?.queuedResolutionStep?.dungeonTargetPlayerEffect != null
    ) as any;
    expect(promptEvent).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: ventureTrapChoiceGameId,
      stepId: (queuedPlayerChoice as any).id,
      selections: targetPlayerId,
    });

    expect((((game.state as any).life || {})[targetPlayerId] ?? (game.state as any).players?.find((p: any) => p.id === targetPlayerId)?.life)).toBe(35);

    const resolveEvent = [...getEvents(ventureTrapChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'dungeonTargetPlayerResolve'
    ) as any;
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent.payload).toMatchObject({
      playerId,
      selectedPlayerId: targetPlayerId,
      resolvedStepId: (queuedPlayerChoice as any).id,
      dungeonId: 'undercity',
      currentRoomId: 'trap',
      amount: 5,
    });
  });

  it('queues and persists Forge target-creature resolution after choosing the room', async () => {
    createGameIfNotExists(ventureForgeChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureForgeChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const targetCreatureId = 'forge_target_1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'forge_target_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature — Cat',
          power: '2',
          toughness: '2',
          image_uris: {},
        },
      },
    ];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'undercity',
        dungeonName: 'Undercity',
        roomIndex: 0,
        currentRoomId: 'secret_entrance',
        currentRoomName: 'Secret Entrance',
        currentRoomEffect: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
        roomPath: ['secret_entrance'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureForgeChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Undercity',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'forge', label: 'Forge - Put two +1/+1 counters on target creature.' },
        { id: 'lost_well', label: 'Lost Well - Scry 2.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'undercity',
      ventureCurrentRoomId: 'secret_entrance',
      ventureRoomPath: ['secret_entrance'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureForgeChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureForgeChoiceGameId, stepId: step.id, selections: 'forge' });

    expect(((game.state as any).dungeonProgress || {})[playerId]).toMatchObject({
      dungeonId: 'undercity',
      currentRoomId: 'forge',
      roomPath: ['secret_entrance', 'forge'],
    });

    const queue = ResolutionQueueManager.getQueue(ventureForgeChoiceGameId);
    const queuedTargetStep = getQueuedOrActiveStep(queue);
    expect(queuedTargetStep).toBeDefined();
    expect((queuedTargetStep as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queuedTargetStep as any)?.dungeonTargetCreatureEffect).toMatchObject({
      dungeonId: 'undercity',
      roomId: 'forge',
      amount: 2,
      counterType: '+1/+1',
    });

    const promptEvent = [...getEvents(ventureForgeChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
        && String(event?.payload?.queuedResolutionStep?.type || '') === String(ResolutionStepType.TARGET_SELECTION)
        && event?.payload?.queuedResolutionStep?.dungeonTargetCreatureEffect?.roomId === 'forge'
    ) as any;
    expect(promptEvent).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: ventureForgeChoiceGameId,
      stepId: (queuedTargetStep as any).id,
      selections: [targetCreatureId],
    });

    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId);
    expect((targetCreature as any)?.counters?.['+1/+1']).toBe(2);

    const resolveEvent = [...getEvents(ventureForgeChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'dungeonTargetCreatureResolve'
    ) as any;
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent.payload).toMatchObject({
      playerId,
      selectedPermanentId: targetCreatureId,
      resolvedStepId: (queuedTargetStep as any).id,
      dungeonId: 'undercity',
      currentRoomId: 'forge',
      amount: 2,
      counterType: '+1/+1',
    });
  });

  it('creates and persists a replay-safe Atropal token on an automatic room transition', () => {
    createGameIfNotExists(ventureCradleAutoRoomGameId, 'commander', 40);
    const game = ensureGame(ventureCradleAutoRoomGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game as any).gameId = ventureCradleAutoRoomGameId;
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'tomb',
        dungeonName: 'Tomb of Annihilation',
        roomIndex: 1,
        currentRoomId: 'oubliette',
        currentRoomName: 'Oubliette',
        currentRoomEffect: 'Discard a card and sacrifice a creature, an artifact, and a land.',
        roomPath: ['trapped_entry', 'oubliette'],
      },
    };
    (game.state as any).stack = [
      {
        id: 'trigger_venture_cradle_1',
        type: 'triggered_ability',
        controller: playerId,
        sourceName: 'Test Venture Trigger',
        description: 'Venture into the dungeon.',
      },
    ];

    game.resolveTopOfStack();

    expect((((game.state as any).dungeonProgress || {})[playerId])).toBeUndefined();
    expect((((game.state as any).completedDungeons || {})[playerId])).toBe(1);

    const atropal = ((game.state as any).battlefield || []).find((permanent: any) => String(permanent?.card?.name || '') === 'The Atropal');
    expect(atropal).toBeDefined();
    expect(String((atropal as any)?.card?.type_line || '')).toContain('Legendary Creature — God Horror');
    expect(Array.isArray((atropal as any)?.card?.keywords) ? (atropal as any).card.keywords : []).toContain('Deathtouch');

    const tokenEvent = [...getEvents(ventureCradleAutoRoomGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'executeEffect'
        && String(event?.payload?.effectType || '') === 'createToken'
        && String(event?.payload?.tokenData?.name || '') === 'The Atropal'
    ) as any;
    expect(tokenEvent).toBeDefined();
    expect(tokenEvent.payload).toMatchObject({
      controllerId: playerId,
      tokenData: {
        id: (atropal as any).id,
        name: 'The Atropal',
        typeLine: 'Token Legendary Creature — God Horror',
        power: 4,
        toughness: 4,
      },
    });
  });

  it('draws three cards for Mad Wizard\'s Lair and lets you free-cast one of the revealed spells', async () => {
    createGameIfNotExists(ventureMadWizardAutoRoomGameId, 'commander', 40);
    const game = ensureGame(ventureMadWizardAutoRoomGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const spellCard = {
      id: 'mad_wizard_draw_1',
      name: 'Opt',
      type_line: 'Instant',
      mana_cost: '{U}',
      oracle_text: 'Scry 1. Draw a card.',
      image_uris: {},
    };
    const landCard = {
      id: 'mad_wizard_draw_2',
      name: 'Island',
      type_line: 'Basic Land — Island',
      image_uris: {},
    };
    const secondSpellCard = {
      id: 'mad_wizard_draw_3',
      name: 'Negate',
      type_line: 'Instant',
      mana_cost: '{1}{U}',
      oracle_text: 'Counter target noncreature spell.',
      image_uris: {},
    };

    (game as any).gameId = ventureMadWizardAutoRoomGameId;
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).phase = 'MAIN1';
    (game.state as any).priority = playerId;
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 3 },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    game.libraries.set(playerId, [spellCard, landCard, secondSpellCard]);
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'mad_mage',
        dungeonName: 'Dungeon of the Mad Mage',
        roomIndex: 3,
        currentRoomId: 'deep_mines',
        currentRoomName: 'Deep Mines',
        currentRoomEffect: 'Scry 3.',
        roomPath: ['yawning_portal', 'dungeon_level', 'lost_level', 'deep_mines'],
      },
    };
    (game.state as any).stack = [
      {
        id: 'trigger_venture_mad_wizard_1',
        type: 'triggered_ability',
        controller: playerId,
        sourceName: 'Test Venture Trigger',
        description: 'Venture into the dungeon.',
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureMadWizardAutoRoomGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    game.resolveTopOfStack();

    expect((((game.state as any).zones?.[playerId]?.hand || []) as any[]).map((card: any) => card.id)).toEqual([
      'mad_wizard_draw_1',
      'mad_wizard_draw_2',
      'mad_wizard_draw_3',
    ]);

    const castChoiceStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureMadWizardAutoRoomGameId));
    expect((castChoiceStep as any)?.dungeonRoomFreeCastFromHandChoice).toMatchObject({
      dungeonId: 'mad_mage',
      roomId: 'mad_wizards_lair',
    });

    await handlers['submitResolutionResponse']({
      gameId: ventureMadWizardAutoRoomGameId,
      stepId: (castChoiceStep as any).id,
      selections: 'mad_wizard_draw_1',
    });

    const pendingSpellCasts = Object.values(((game.state as any).pendingSpellCasts || {})) as any[];
    const queue = ResolutionQueueManager.getQueue(ventureMadWizardAutoRoomGameId);
    const queuedOrActiveCastStep = getQueuedOrActiveStep(queue);
    const castStarted = Array.isArray((game.state as any).stack)
      ? (game.state as any).stack.some((item: any) => String(item?.card?.id || '') === 'mad_wizard_draw_1')
      : false;
    const pendingCastExists = pendingSpellCasts.some((entry: any) => String(entry?.cardId || '') === 'mad_wizard_draw_1');
    const queuedCastStepExists = Array.isArray(queue?.steps)
      ? queue.steps.some((queuedStep: any) => String(queuedStep?.spellCardId || queuedStep?.cardId || queuedStep?.spellCastContext?.cardId || '') === 'mad_wizard_draw_1')
      : false;
    const activeCastStepExists = String(
      (queuedOrActiveCastStep as any)?.spellCardId ||
      (queuedOrActiveCastStep as any)?.cardId ||
      (queuedOrActiveCastStep as any)?.spellCastContext?.cardId ||
      '',
    ) === 'mad_wizard_draw_1';
    expect(castStarted || pendingCastExists || queuedCastStepExists || activeCastStepExists).toBe(true);

    const drawEffectEvent = [...getEvents(ventureMadWizardAutoRoomGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'executeEffect'
        && String(event?.payload?.effectType || '') === 'dungeonDrawCards'
    ) as any;
    expect(drawEffectEvent?.payload?.drawnCards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mad_wizard_draw_1', name: 'Opt' }),
        expect.objectContaining({ id: 'mad_wizard_draw_2', name: 'Island' }),
        expect.objectContaining({ id: 'mad_wizard_draw_3', name: 'Negate' }),
      ]),
    );

    const freeCastChoiceEvent = [...getEvents(ventureMadWizardAutoRoomGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'dungeonRoomFreeCastChoiceResolve'
    ) as any;
    expect(freeCastChoiceEvent?.payload?.choice).toBe('cast');
  });

  it('queues and resolves Throne of the Dead Three by putting a revealed creature onto the battlefield with counters and hexproof', async () => {
    createGameIfNotExists(ventureThroneAutoRoomGameId, 'commander', 40);
    const game = ensureGame(ventureThroneAutoRoomGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const chosenCreature = {
      id: 'throne_top_1',
      name: 'Hill Giant',
      type_line: 'Creature — Giant',
      mana_cost: '{3}{R}',
      power: '3',
      toughness: '3',
      image_uris: {},
    };
    const fillerCards = Array.from({ length: 9 }, (_, index) => ({
      id: `throne_fill_${index + 1}`,
      name: `Filler ${index + 1}`,
      type_line: index % 2 === 0 ? 'Instant' : 'Basic Land — Plains',
      image_uris: {},
    }));

    (game as any).gameId = ventureThroneAutoRoomGameId;
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 7;
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 10 },
      p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    game.libraries.set(playerId, [chosenCreature, ...fillerCards]);
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'undercity',
        dungeonName: 'Undercity',
        roomIndex: 3,
        currentRoomId: 'archives',
        currentRoomName: 'Archives',
        currentRoomEffect: 'Draw a card.',
        roomPath: ['secret_entrance', 'forge', 'trap', 'archives'],
      },
    };
    (game.state as any).stack = [
      {
        id: 'trigger_venture_throne_1',
        type: 'triggered_ability',
        controller: playerId,
        sourceName: 'Test Venture Trigger',
        description: 'Venture into the dungeon.',
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureThroneAutoRoomGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    game.resolveTopOfStack();

    const throneStep = getQueuedOrActiveStep(ResolutionQueueManager.getQueue(ventureThroneAutoRoomGameId));
    expect((throneStep as any)?.dungeonRoomThroneChoice).toMatchObject({
      dungeonId: 'undercity',
      roomId: 'throne_of_the_dead_three',
    });

    await handlers['submitResolutionResponse']({
      gameId: ventureThroneAutoRoomGameId,
      stepId: (throneStep as any).id,
      selections: 'throne_top_1',
    });

    const battlefieldPermanent = ((game.state as any).battlefield || []).find((permanent: any) => String(permanent?.card?.name || '') === 'Hill Giant') as any;
    expect(battlefieldPermanent).toBeDefined();
    expect((battlefieldPermanent?.counters || {})['+1/+1']).toBe(3);
    expect(
      Array.isArray(battlefieldPermanent?.grantedAbilities)
        ? battlefieldPermanent.grantedAbilities.map((ability: any) => String(ability).toLowerCase())
        : [],
    ).toContain('hexproof');
    expect(Array.isArray(battlefieldPermanent?.untilNextTurnGrants) ? battlefieldPermanent.untilNextTurnGrants : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ controllerId: playerId, turnApplied: 7, kind: 'hexproof' }),
      ]),
    );

    const throneResolveEvent = [...getEvents(ventureThroneAutoRoomGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'dungeonRoomThroneResolve'
    ) as any;
    expect(throneResolveEvent?.payload?.selectedCard).toMatchObject({ id: 'throne_top_1', name: 'Hill Giant' });
  });

  it('queues and persists Twisted Caverns target-creature resolution after choosing the room', async () => {
    createGameIfNotExists(ventureTwistedChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureTwistedChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const targetCreatureId = 'twisted_target_1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 5;
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'twisted_target_card_1',
          name: 'Hill Giant',
          type_line: 'Creature — Giant',
          power: '3',
          toughness: '3',
          image_uris: {},
        },
      },
    ];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'mad_mage',
        dungeonName: 'Dungeon of the Mad Mage',
        roomIndex: 1,
        currentRoomId: 'dungeon_level',
        currentRoomName: 'Dungeon Level',
        currentRoomEffect: 'Scry 1.',
        roomPath: ['yawning_portal', 'dungeon_level'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureTwistedChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Dungeon of the Mad Mage',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'goblin_bazaar', label: 'Goblin Bazaar - Create a Treasure token.' },
        { id: 'twisted_caverns', label: "Twisted Caverns - Target creature can't attack until your next turn." },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'mad_mage',
      ventureCurrentRoomId: 'dungeon_level',
      ventureRoomPath: ['yawning_portal', 'dungeon_level'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureTwistedChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureTwistedChoiceGameId, stepId: step.id, selections: 'twisted_caverns' });

    const queue = ResolutionQueueManager.getQueue(ventureTwistedChoiceGameId);
    const queuedTargetStep = getQueuedOrActiveStep(queue);
    expect((queuedTargetStep as any)?.dungeonTargetCreatureEffect).toMatchObject({
      dungeonId: 'mad_mage',
      roomId: 'twisted_caverns',
      grantText: "This creature can't attack (until your next turn)",
    });

    await handlers['submitResolutionResponse']({
      gameId: ventureTwistedChoiceGameId,
      stepId: (queuedTargetStep as any).id,
      selections: [targetCreatureId],
    });

    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(
      Array.isArray(targetCreature?.grantedAbilities)
        ? targetCreature.grantedAbilities.map((ability: any) => String(ability).toLowerCase())
        : [],
    ).toContain("this creature can't attack (until your next turn)");
    expect(Array.isArray(targetCreature?.untilNextTurnGrants) ? targetCreature.untilNextTurnGrants : []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ controllerId: playerId, turnApplied: 5, kind: 'cant_attack' }),
      ]),
    );
  });

  it('queues and persists Arena target-creature resolution after choosing the room', async () => {
    createGameIfNotExists(ventureArenaChoiceGameId, 'commander', 40);
    const game = ensureGame(ventureArenaChoiceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const targetCreatureId = 'arena_target_1';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnNumber = 3;
    (game.state as any).battlefield = [
      {
        id: targetCreatureId,
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'arena_target_card_1',
          name: 'Hill Giant',
          type_line: 'Creature — Giant',
          power: '3',
          toughness: '3',
          image_uris: {},
        },
      },
    ];
    (game.state as any).dungeonProgress = {
      [playerId]: {
        dungeonId: 'undercity',
        dungeonName: 'Undercity',
        roomIndex: 1,
        currentRoomId: 'forge',
        currentRoomName: 'Forge',
        currentRoomEffect: 'Put two +1/+1 counters on target creature.',
        roomPath: ['secret_entrance', 'forge'],
      },
    };

    const step = ResolutionQueueManager.addStep(ventureArenaChoiceGameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'Choose the next room in Undercity',
      mandatory: true,
      sourceName: 'Test Venture',
      options: [
        { id: 'trap', label: 'Trap! - Target player loses 5 life.' },
        { id: 'arena', label: 'Arena - Goad target creature.' },
      ],
      minSelections: 1,
      maxSelections: 1,
      ventureChooseRoom: true,
      ventureDungeonId: 'undercity',
      ventureCurrentRoomId: 'forge',
      ventureRoomPath: ['secret_entrance', 'forge'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, ventureArenaChoiceGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId: ventureArenaChoiceGameId, stepId: step.id, selections: 'arena' });

    expect(((game.state as any).dungeonProgress || {})[playerId]).toMatchObject({
      dungeonId: 'undercity',
      currentRoomId: 'arena',
      roomPath: ['secret_entrance', 'forge', 'arena'],
    });

    const queue = ResolutionQueueManager.getQueue(ventureArenaChoiceGameId);
    const queuedTargetStep = getQueuedOrActiveStep(queue);
    expect(queuedTargetStep).toBeDefined();
    expect((queuedTargetStep as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queuedTargetStep as any)?.dungeonTargetCreatureEffect).toMatchObject({
      dungeonId: 'undercity',
      roomId: 'arena',
    });

    const promptEvent = [...getEvents(ventureArenaChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
        && String(event?.payload?.queuedResolutionStep?.type || '') === String(ResolutionStepType.TARGET_SELECTION)
        && event?.payload?.queuedResolutionStep?.dungeonTargetCreatureEffect?.roomId === 'arena'
    ) as any;
    expect(promptEvent).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: ventureArenaChoiceGameId,
      stepId: (queuedTargetStep as any).id,
      selections: [targetCreatureId],
    });

    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === targetCreatureId) as any;
    expect(Array.isArray(targetCreature?.goadedBy) ? targetCreature.goadedBy : []).toContain(playerId);
    expect((targetCreature?.goadedUntil || {})[playerId]).toBe(4);

    const resolveEvent = [...getEvents(ventureArenaChoiceGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'dungeonTargetCreatureResolve'
    ) as any;
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent.payload).toMatchObject({
      playerId,
      selectedPermanentId: targetCreatureId,
      resolvedStepId: (queuedTargetStep as any).id,
      dungeonId: 'undercity',
      currentRoomId: 'arena',
      goadedByPlayerId: playerId,
    });
  });

  it('taking the initiative pushes an Undercity trigger and enters Undercity when no dungeon is active', () => {
    createGameIfNotExists(initiativeTakeGameId, 'commander', 40);
    const game = ensureGame(initiativeTakeGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    game.libraries.set('p1' as any, [
      {
        id: 'basic_land_1',
        name: 'Plains',
        type_line: 'Basic Land — Plains',
        oracle_text: '',
      } as any,
      {
        id: 'spell_1',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Scry 1. Draw a card.',
      } as any,
    ]);
    (game.state as any).stack = [
      {
        id: 'trigger_initiative_1',
        type: 'triggered_ability',
        controller: 'p1',
        sourceName: 'Test Initiative Trigger',
        description: 'You take the initiative.',
      },
    ];

    game.resolveTopOfStack();

    expect((game.state as any).initiative).toBe('p1');
    expect(Array.isArray((game.state as any).stack) ? (game.state as any).stack : []).toHaveLength(1);
    expect(String(((game.state as any).stack[0] as any).description || '')).toBe('Venture into Undercity.');

    game.resolveTopOfStack();

    expect((((game.state as any).dungeonProgress || {})['p1'])).toMatchObject({
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 0,
      currentRoomId: 'secret_entrance',
      currentRoomName: 'Secret Entrance',
      roomPath: ['secret_entrance'],
    });

    const queue = ResolutionQueueManager.getQueue(initiativeTakeGameId);
    const queuedSearchStep = getQueuedOrActiveStep(queue);
    expect(queuedSearchStep).toBeDefined();
    expect((queuedSearchStep as any)?.type).toBe(ResolutionStepType.LIBRARY_SEARCH);
    expect((queuedSearchStep as any)?.searchCriteria).toBe('a basic land card');

    const promptEvent = [...getEvents(initiativeTakeGameId)].reverse().find(
      (event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt'
        && String(event?.payload?.queuedResolutionStep?.type || '') === String(ResolutionStepType.LIBRARY_SEARCH)
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: 'p1',
      queuedResolutionStep: {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: 'p1',
        searchCriteria: 'a basic land card',
      },
    });

    const replayGame = createInitialGameState(`${initiativeTakeGameId}_replay`);
    replayGame.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    replayGame.applyEvent({
      type: 'ventureChooseDungeonResolve',
      playerId: 'p1',
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 0,
      currentRoomId: 'secret_entrance',
      currentRoomName: 'Secret Entrance',
      currentRoomEffect: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      roomPath: ['secret_entrance'],
    } as any);
    replayGame.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent.payload || {}) } as any);
    const replayQueue = ResolutionQueueManager.getQueue(`${initiativeTakeGameId}_replay`);
    const replayQueuedSearchStep = getQueuedOrActiveStep(replayQueue);
    expect(replayQueuedSearchStep).toBeDefined();
    expect((replayQueuedSearchStep as any)?.type).toBe(ResolutionStepType.LIBRARY_SEARCH);
  });

  it('taking the initiative while in another dungeon advances that dungeon instead of starting Undercity', () => {
    createGameIfNotExists(initiativeAdvanceGameId, 'commander', 40);
    const game = ensureGame(initiativeAdvanceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).dungeonProgress = {
      p1: {
        dungeonId: 'mad_mage',
        dungeonName: 'Dungeon of the Mad Mage',
        roomIndex: 2,
        currentRoomId: 'goblin_bazaar',
        currentRoomName: 'Goblin Bazaar',
        currentRoomEffect: 'Create a Treasure token.',
        roomPath: ['yawning_portal', 'dungeon_level', 'goblin_bazaar'],
      },
    };
    (game.state as any).stack = [
      {
        id: 'trigger_initiative_2',
        type: 'triggered_ability',
        controller: 'p1',
        sourceName: 'Test Initiative Trigger',
        description: 'You take the initiative.',
      },
    ];

    game.resolveTopOfStack();
    game.resolveTopOfStack();

    expect((((game.state as any).dungeonProgress || {})['p1'])).toMatchObject({
      dungeonId: 'mad_mage',
      dungeonName: 'Dungeon of the Mad Mage',
      roomIndex: 3,
      currentRoomId: 'lost_level',
      currentRoomName: 'Lost Level',
      roomPath: ['yawning_portal', 'dungeon_level', 'goblin_bazaar', 'lost_level'],
    });
  });

  it('a spell that says take the initiative pushes the same Undercity trigger flow', () => {
    createGameIfNotExists(initiativeSpellGameId, 'commander', 40);
    const game = ensureGame(initiativeSpellGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).stack = [
      {
        id: 'spell_initiative_1',
        type: 'spell',
        controller: 'p1',
        targets: [],
        card: {
          id: 'spell_initiative_card',
          name: 'Test Initiative Spell',
          type_line: 'Sorcery',
          oracle_text: 'You take the initiative.',
        },
      },
    ];

    game.resolveTopOfStack();

    expect((game.state as any).initiative).toBe('p1');
    expect(Array.isArray((game.state as any).stack) ? (game.state as any).stack : []).toHaveLength(1);
    expect(((game.state as any).stack[0] as any).initiativeVentureTrigger).toBe(true);

    game.resolveTopOfStack();

    expect((((game.state as any).dungeonProgress || {})['p1'])).toMatchObject({
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 0,
      currentRoomId: 'secret_entrance',
      currentRoomName: 'Secret Entrance',
      roomPath: ['secret_entrance'],
    });
  });

  it('the initiative holder gets an upkeep trigger that ventures into Undercity', () => {
    createGameIfNotExists(initiativeUpkeepGameId, 'commander', 40);
    const game = ensureGame(initiativeUpkeepGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
    (game.state as any).initiative = 'p1';
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).turnPlayer = 'p1';
    (game.state as any).priority = 'p1';
    (game.state as any).turnNumber = 2;
    (game.state as any).turn = 2;

    game.nextStep();

    expect(String((game.state as any).step || '')).toBe('UPKEEP');
    expect(Array.isArray((game.state as any).stack) ? (game.state as any).stack : []).toHaveLength(1);
    expect(((game.state as any).stack[0] as any).initiativeVentureTrigger).toBe(true);

    game.resolveTopOfStack();

    expect((((game.state as any).dungeonProgress || {})['p1'])).toMatchObject({
      dungeonId: 'undercity',
      dungeonName: 'Undercity',
      roomIndex: 0,
      currentRoomId: 'secret_entrance',
      currentRoomName: 'Secret Entrance',
      roomPath: ['secret_entrance'],
    });
  });
});