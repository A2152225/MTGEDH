import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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

describe('choose discard plan choice (integration)', () => {
  const gameId = 'test_choose_discard_plan_choice';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues a filtered discard step for the preferred type', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'artifact_1', name: 'Relic', type_line: 'Artifact' },
          { id: 'spell_1', name: 'Bolt', type_line: 'Instant' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose discard option',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'discard_artifact', label: 'Discard an artifact card' },
        { id: 'discard_two', label: 'Discard two cards' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseDiscardPlanChoice: true,
      chooseDiscardPlanPlayerId: p1,
      chooseDiscardPlanSourceName: 'Source',
      chooseDiscardPlanPreferredOptionId: 'discard_artifact',
      chooseDiscardPlanPreferredType: 'artifact',
      chooseDiscardPlanPreferredCount: 1,
      chooseDiscardPlanFallbackCount: 2,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'discard_artifact' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe('discard_selection');
    expect((queue.steps[0] as any).discardCount).toBe(1);
    expect(((queue.steps[0] as any).hand || []).map((card: any) => card.id)).toEqual(['artifact_1']);
  });

  it('falls back to the broader discard count when the preferred branch is unavailable', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'spell_1', name: 'Bolt', type_line: 'Instant' },
          { id: 'spell_2', name: 'Opt', type_line: 'Instant' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose discard option',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'discard_artifact', label: 'Discard an artifact card' },
        { id: 'discard_two', label: 'Discard two cards' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseDiscardPlanChoice: true,
      chooseDiscardPlanPlayerId: p1,
      chooseDiscardPlanSourceName: 'Source',
      chooseDiscardPlanPreferredOptionId: 'discard_artifact',
      chooseDiscardPlanPreferredType: 'artifact',
      chooseDiscardPlanPreferredCount: 1,
      chooseDiscardPlanFallbackCount: 2,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'discard_artifact' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe('discard_selection');
    expect((queue.steps[0] as any).discardCount).toBe(2);
    expect(((queue.steps[0] as any).hand || []).map((card: any) => card.id)).toEqual(['spell_1', 'spell_2']);
  });
});