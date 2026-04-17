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
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('choose pile from split choice (integration)', () => {
  const gameId = 'test_choose_pile_from_split_choice';
  const replayGameIds = [
    `${gameId}_choose_player_replay`,
    `${gameId}_split_replay`,
    `${gameId}_move_replay`,
    `${gameId}_sac_replay`,
  ];

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
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

  it('chooses a player to perform a two-pile split and enqueues the split step', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a player to split cards',
      mandatory: true,
      sourceName: 'Source',
      options: [{ id: p2, label: 'P2' }],
      minSelections: 1,
      maxSelections: 1,
      choosePlayerForTwoPileSplitChoice: true,
      choosePlayerForTwoPileSplitController: p1,
      choosePlayerForTwoPileSplitSourceName: 'Source',
      choosePlayerForTwoPileSplitDescription: 'Source: Separate the revealed cards into two piles',
      choosePlayerForTwoPileSplitItems: [
        { id: 'c1', label: 'Card 1' },
        { id: 'c2', label: 'Card 2' },
        { id: 'c3', label: 'Card 3' },
      ],
      choosePlayerForTwoPileSplitMinPerPile: 0,
      choosePileFromSplitChoice: true,
      choosePileFromSplitChooserPlayerId: p1,
      choosePileFromSplitSourceName: 'Source',
      choosePileFromSplitItems: [
        { id: 'c1', name: 'Card 1' },
        { id: 'c2', name: 'Card 2' },
        { id: 'c3', name: 'Card 3' },
      ],
      choosePileFromSplitOriginalOrder: ['c1', 'c2', 'c3'],
      choosePileFromSplitChosenAction: 'move_cards',
      choosePileFromSplitChosenDestination: 'hand',
      choosePileFromSplitOtherDestination: 'library',
      choosePileFromSplitMovePlayerId: p1,
      choosePileFromSplitChoiceDescription: 'Source: Choose a pile',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: p2 });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe('two_pile_split');
    expect((queue.steps[0] as any).playerId).toBe(p2);
    expect((queue.steps[0] as any).choosePileFromSplitChoice).toBe(true);

    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt' &&
      event.payload?.queuedResolutionStep?.type === ResolutionStepType.TWO_PILE_SPLIT
    ) as any;
    expect(promptEvent).toBeDefined();

    const replayGameId = `${gameId}_choose_player_replay`;
    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    (replayGame.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    ResolutionQueueManager.removeQueue(replayGameId);
    replayGame.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent.payload || {}) } as any);
    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect(replayQueue.steps).toHaveLength(1);
    expect((replayQueue.steps[0] as any).type).toBe(ResolutionStepType.TWO_PILE_SPLIT);
    expect((replayQueue.steps[0] as any).playerId).toBe(p2);
  });

  it('persists and replays the choose-pile prompt after a two-pile split is submitted', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TWO_PILE_SPLIT,
      playerId: p2,
      description: 'Source: Separate the revealed cards into two piles',
      mandatory: true,
      sourceName: 'Source',
      items: [
        { id: 'c1', label: 'Card 1' },
        { id: 'c2', label: 'Card 2' },
        { id: 'c3', label: 'Card 3' },
      ],
      minPerPile: 0,
      choosePileFromSplitChoice: true,
      choosePileFromSplitChooserPlayerId: p1,
      choosePileFromSplitSourceName: 'Source',
      choosePileFromSplitItems: [
        { id: 'c1', name: 'Card 1' },
        { id: 'c2', name: 'Card 2' },
        { id: 'c3', name: 'Card 3' },
      ],
      choosePileFromSplitOriginalOrder: ['c1', 'c2', 'c3'],
      choosePileFromSplitChosenAction: 'move_cards',
      choosePileFromSplitChosenDestination: 'hand',
      choosePileFromSplitOtherDestination: 'library',
      choosePileFromSplitMovePlayerId: p1,
      choosePileFromSplitChoiceDescription: 'Source: Choose a pile',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: { pileA: ['c1', 'c3'], pileB: ['c2'] },
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).choosePileFromSplitChoice).toBe(true);
    expect((queue.steps[0] as any).choosePileFromSplitPileA).toEqual(['c1', 'c3']);
    expect((queue.steps[0] as any).choosePileFromSplitPileB).toEqual(['c2']);

    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt' &&
      event.payload?.queuedResolutionStep?.choosePileFromSplitChoice === true
    ) as any;
    expect(promptEvent).toBeDefined();

    const replayGameId = `${gameId}_split_replay`;
    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    (replayGame.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    ResolutionQueueManager.removeQueue(replayGameId);
    replayGame.applyEvent({ type: 'resolveTopOfStackPrompt', ...(promptEvent.payload || {}) } as any);
    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect(replayQueue.steps).toHaveLength(1);
    expect((replayQueue.steps[0] as any).choosePileFromSplitChoice).toBe(true);
    expect((replayQueue.steps[0] as any).choosePileFromSplitPileA).toEqual(['c1', 'c3']);
    expect((replayQueue.steps[0] as any).choosePileFromSplitPileB).toEqual(['c2']);
  });

  it('moves the chosen pile to hand and the other pile to library', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a pile',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'pileA', label: 'Pile A' },
        { id: 'pileB', label: 'Pile B' },
      ],
      minSelections: 1,
      maxSelections: 1,
      choosePileFromSplitChoice: true,
      choosePileFromSplitChooserPlayerId: p1,
      choosePileFromSplitSourceName: 'Source',
      choosePileFromSplitItems: [
        { id: 'c1', name: 'Card 1' },
        { id: 'c2', name: 'Card 2' },
        { id: 'c3', name: 'Card 3' },
      ],
      choosePileFromSplitOriginalOrder: ['c1', 'c2', 'c3'],
      choosePileFromSplitChosenAction: 'move_cards',
      choosePileFromSplitChosenDestination: 'hand',
      choosePileFromSplitOtherDestination: 'library',
      choosePileFromSplitMovePlayerId: p1,
      choosePileFromSplitPileA: ['c1', 'c3'],
      choosePileFromSplitPileB: ['c2'],
      choosePileFromSplitChatMessage: 'Source: P1 chose a pile.',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'pileA' });

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['c1', 'c3']);
    expect(((game.state as any).zones[p1].library || []).map((c: any) => c.id)).toEqual(['c2']);

    const resolveEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'choosePileFromSplitResolve') as any;
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent.payload).toMatchObject({
      action: 'move_cards',
      movePlayerId: p1,
      chosenDestination: 'hand',
      otherDestination: 'library',
    });
    expect((resolveEvent.payload?.chosenCards || []).map((card: any) => card.id)).toEqual(['c1', 'c3']);
    expect((resolveEvent.payload?.otherCards || []).map((card: any) => card.id)).toEqual(['c2']);

    const replayGameId = `${gameId}_move_replay`;
    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    replayGame.applyEvent({ type: 'choosePileFromSplitResolve', ...(resolveEvent.payload || {}) } as any);
    expect(((replayGame.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['c1', 'c3']);
    expect(((replayGame.state as any).zones[p1].library || []).map((c: any) => c.id)).toEqual(['c2']);
  });

  it('sacrifices the chosen pile of permanents', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [
      { id: 'perm1', controller: p1, owner: p1, card: { name: 'Perm 1', type_line: 'Creature' } },
      { id: 'perm2', controller: p1, owner: p1, isToken: true, card: { id: 'perm2_card', name: 'Perm 2', type_line: 'Artifact' } },
      { id: 'perm3', controller: p1, owner: p1, card: { name: 'Perm 3', type_line: 'Enchantment' } },
    ];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a pile to sacrifice',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'pileA', label: 'Pile A' },
        { id: 'pileB', label: 'Pile B' },
      ],
      minSelections: 1,
      maxSelections: 1,
      choosePileFromSplitChoice: true,
      choosePileFromSplitChooserPlayerId: p1,
      choosePileFromSplitSourceName: 'Source',
      choosePileFromSplitChosenAction: 'sacrifice_permanents',
      choosePileFromSplitTargetPlayerId: p1,
      choosePileFromSplitPileA: ['perm1', 'perm3'],
      choosePileFromSplitPileB: ['perm2'],
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'pileB' });

    expect(((game.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual(['perm1', 'perm3']);
    expect((((game.state as any).zones?.[p1]?.graveyard) || []).map((card: any) => card.name)).toEqual(['Perm 2']);

    const resolveEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'choosePileFromSplitResolve') as any;
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent.payload).toEqual({
      action: 'sacrifice_permanents',
      targetPlayerId: p1,
      permanentIds: ['perm2'],
    });

    const replayGameId = `${gameId}_sac_replay`;
    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };
    (replayGame.state as any).battlefield = [
      { id: 'perm1', controller: p1, owner: p1, card: { name: 'Perm 1', type_line: 'Creature' } },
      { id: 'perm2', controller: p1, owner: p1, isToken: true, card: { id: 'perm2_card', name: 'Perm 2', type_line: 'Artifact' } },
      { id: 'perm3', controller: p1, owner: p1, card: { name: 'Perm 3', type_line: 'Enchantment' } },
    ];
    replayGame.applyEvent({ type: 'choosePileFromSplitResolve', ...(resolveEvent.payload || {}) } as any);
    expect(((replayGame.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual(['perm1', 'perm3']);
    expect((((replayGame.state as any).zones?.[p1]?.graveyard) || []).map((card: any) => card.name)).toEqual(['Perm 2']);
  });
});