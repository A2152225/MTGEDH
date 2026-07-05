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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('sacrifice another permanent for benefit (integration)', () => {
  const gameId = 'test_sacrifice_another_permanent_for_benefit';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('lets the controller sacrifice another permanent to gain life and draw cards', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'source_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Source Walker',
          type_line: 'Legendary Planeswalker',
          image_uris: { small: 'https://example.com/source.jpg' },
        },
      },
      {
        id: 'other_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Treasure Token',
          type_line: 'Artifact',
          image_uris: { small: 'https://example.com/treasure.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: {
        library: [
          { id: 'draw_1', name: 'Drawn Card', type_line: 'Instant', zone: 'library' },
        ],
        libraryCount: 1,
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    let drawnCards = 0;
    (game as any).drawCards = (playerId: string, count: number) => {
      const playerZones = (game.state as any).zones?.[playerId];
      if (!playerZones) return;
      playerZones.hand = playerZones.hand || [];
      playerZones.library = playerZones.library || [];
      for (let i = 0; i < count; i++) {
        const nextCard = playerZones.library.shift();
        if (!nextCard) break;
        playerZones.hand.push(nextCard);
        drawnCards += 1;
      }
      playerZones.handCount = playerZones.hand.length;
      playerZones.libraryCount = playerZones.library.length;
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source Walker: You may sacrifice another permanent. If you do, you gain 3 life and draw a card.',
      mandatory: true,
      sourceName: 'Source Walker',
      sourceId: 'source_perm',
      options: [
        { id: 'sac', label: 'Sacrifice a permanent' },
        { id: 'dont', label: "Don't sacrifice" },
      ],
      minSelections: 1,
      maxSelections: 1,
      sacrificeAnotherPermanentForBenefitChoice: true,
      sacrificeAnotherPermanentForBenefitStage: 'ask',
      sacrificeAnotherPermanentForBenefitController: p1,
      sacrificeAnotherPermanentForBenefitSourceName: 'Source Walker',
      sacrificeAnotherPermanentForBenefitSourcePermanentId: 'source_perm',
      sacrificeAnotherPermanentForBenefitLifeGain: 3,
      sacrificeAnotherPermanentForBenefitDrawCount: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'sac' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(((queue.steps[0] as any).validTargets || []).map((t: any) => t.id)).toEqual(['other_perm']);

    const choiceEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'sacrificeAnotherPermanentForBenefitChoiceResolve') as any;
    expect(choiceEvent).toBeDefined();
    expect(choiceEvent.payload).toMatchObject({
      playerId: p1,
      controllerId: p1,
      sourceId: 'source_perm',
      sourceName: 'Source Walker',
      resolvedStepId: step.id,
      choice: 'sacrifice',
      sourcePermanentId: 'source_perm',
      lifeGain: 3,
      drawCount: 1,
      validTargetIds: ['other_perm'],
    });
    expect(choiceEvent.payload.queuedResolutionStep).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: p1,
      sacrificeAnotherPermanentForBenefitChoice: true,
      sacrificeAnotherPermanentForBenefitStage: 'select_sacrifice',
    });

    const promptEvent = getEvents(gameId).find((event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: p1,
      sourceId: 'source_perm',
      queuedResolutionStep: {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        sacrificeAnotherPermanentForBenefitChoice: true,
        sacrificeAnotherPermanentForBenefitStage: 'select_sacrifice',
      },
    });

    const targetStepId = (queue.steps[0] as any).id;
    await handlers['submitResolutionResponse']({ gameId, stepId: targetStepId, selections: ['other_perm'] });

    expect(((game.state as any).battlefield || []).map((p: any) => p.id)).toEqual(['source_perm']);
    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.name)).toEqual(['Treasure Token']);
    expect((game.state as any).life[p1]).toBe(43);
    expect(drawnCards).toBe(1);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['draw_1']);
    expect((game.state as any).zones[p1].libraryCount).toBe(0);

    const resolveEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'sacrificeAnotherPermanentForBenefitResolve') as any;
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent.payload).toMatchObject({
      playerId: p1,
      controllerId: p1,
      sourceId: 'source_perm',
      sourceName: 'Source Walker',
      resolvedStepId: targetStepId,
      sacrificedPermanentId: 'other_perm',
      sacrificedName: 'Treasure Token',
      lifeGain: 3,
      drawCount: 1,
    });
  });

  it('queues the sacrifice benefit choice from generic triggered stack text (IR primary Effect Program)', async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'source_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Source Walker',
          type_line: 'Legendary Planeswalker',
          image_uris: { small: 'https://example.com/source.jpg' },
        },
      },
      {
        id: 'other_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Treasure Token',
          type_line: 'Artifact',
          image_uris: { small: 'https://example.com/treasure.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: {
        library: [{ id: 'draw_1', name: 'Drawn Card', type_line: 'Instant', zone: 'library' }],
        libraryCount: 1,
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (game as any).libraries = new Map([[p1, [{ id: 'draw_1', name: 'Drawn Card', type_line: 'Instant' }]]]);
    (game.state as any).players[0].library = [{ id: 'draw_1', name: 'Drawn Card', type_line: 'Instant' }];
    (game.state as any).stack = [
      {
        id: 'trigger_sacrifice_another_permanent_for_benefit',
        type: 'triggered_ability',
        controller: p1,
        source: 'source_perm',
        permanentId: 'source_perm',
        sourceName: 'Source Walker',
        description: 'You may sacrifice another permanent. If you do, you gain 3 life and draw a card.',
        effect: 'You may sacrifice another permanent. If you do, you gain 3 life and draw a card.',
        mandatory: true,
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    game.resolveTopOfStack();

    expect((game.state as any).life[p1]).toBe(40);
    expect(((game.state as any).zones[p1].hand || []).map((card: any) => card.id)).toEqual([]);

    const askStep = ResolutionQueueManager.getQueue(gameId).steps.find((candidate: any) =>
      candidate?.type === ResolutionStepType.OPTION_CHOICE &&
      candidate?.effectProgramPrompt === true &&
      String(candidate?.description || '').toLowerCase().includes('sacrifice another permanent')
    ) as any;
    expect(askStep).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      sourceId: 'source_perm',
      sourceName: 'Source Walker',
      mandatory: false,
      effectProgramPrompt: true,
    });
    expect(askStep.sacrificeAnotherPermanentForBenefitChoice).not.toBe(true);
    expect((askStep.options || []).map((option: any) => option.id)).toEqual(
      expect.arrayContaining(['yes', 'no']),
    );

    await handlers['submitResolutionResponse']({ gameId, stepId: askStep.id, selections: 'yes' });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((candidate: any) =>
      candidate?.type === ResolutionStepType.TARGET_SELECTION &&
      String(candidate?.description || '').toLowerCase().includes('sacrifice')
    ) as any;
    expect(targetStep).toMatchObject({
      type: ResolutionStepType.TARGET_SELECTION,
      sourceId: 'source_perm',
      sourceName: 'Source Walker',
    });
    expect(targetStep.sacrificeAnotherPermanentForBenefitChoice).not.toBe(true);
    expect((targetStep.validTargets || []).map((target: any) => target.id)).toEqual(['other_perm']);

    await handlers['submitResolutionResponse']({ gameId, stepId: targetStep.id, selections: ['other_perm'] });

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['source_perm']);
    expect(((game.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Treasure Token']);
    expect((game.state as any).life[p1]).toBe(43);
    expect(((game.state as any).zones[p1].hand || []).map((card: any) => card.id)).toEqual(['draw_1']);

    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
  });
});