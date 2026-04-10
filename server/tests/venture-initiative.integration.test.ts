import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
  const ventureAutoRoomGameId = 'test_venture_auto_room_integration';
  const initiativeTakeGameId = 'test_initiative_take_integration';
  const initiativeAdvanceGameId = 'test_initiative_advance_integration';
  const initiativeUpkeepGameId = 'test_initiative_upkeep_integration';
  const initiativeSpellGameId = 'test_initiative_spell_integration';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    for (const gameId of [
      venturePromptGameId,
      ventureChoiceGameId,
      ventureChoiceScryGameId,
      ventureBranchPromptGameId,
      ventureBranchChoiceGameId,
      ventureForgeChoiceGameId,
      ventureTrapChoiceGameId,
      ventureArenaChoiceGameId,
      ventureAutoRoomGameId,
      initiativeTakeGameId,
      initiativeAdvanceGameId,
      initiativeUpkeepGameId,
      initiativeSpellGameId,
    ]) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      deleteGame(gameId);
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