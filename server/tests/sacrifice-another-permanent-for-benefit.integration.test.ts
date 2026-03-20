import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
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

describe('sacrifice another permanent for benefit (integration)', () => {
  const gameId = 'test_sacrifice_another_permanent_for_benefit';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
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

    await handlers['submitResolutionResponse']({ gameId, stepId: (queue.steps[0] as any).id, selections: ['other_perm'] });

    expect(((game.state as any).battlefield || []).map((p: any) => p.id)).toEqual(['source_perm']);
    expect(((game.state as any).zones[p1].graveyard || []).map((c: any) => c.name)).toEqual(['Treasure Token']);
    expect((game.state as any).life[p1]).toBe(43);
    expect(drawnCards).toBe(1);
    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['draw_1']);
    expect((game.state as any).zones[p1].libraryCount).toBe(0);
  });
});