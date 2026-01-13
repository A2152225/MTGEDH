import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Resolution TARGET_SELECTION distinct-target enforcement', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    // Ensure no cross-test queue bleed (each test uses a unique gameId, but be extra safe)
    ResolutionQueueManager.removeQueue('test_resolution_distinct_cross_step');
    ResolutionQueueManager.removeQueue('test_resolution_distinct_single_step');
    games.delete('test_resolution_distinct_cross_step' as any);
    games.delete('test_resolution_distinct_single_step' as any);
  });

  it('rejects selecting the same id across sequential TARGET_SELECTION steps for the same sourceId', async () => {
    const gameId = 'test_resolution_distinct_cross_step';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted);
    registerResolutionHandlers(io as any, socket as any);

    const step1 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose a target',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'permanent' },
        { id: 'B', label: 'Target B', description: 'permanent' },
      ],
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'a target',
    } as any);

    const step2 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose another target',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'permanent' },
        { id: 'B', label: 'Target B', description: 'permanent' },
      ],
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'another target',
      disallowPreviouslyChosenTargets: true,
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

    const prompt = emitted.find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['B']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['A'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');

    // Step remains pending (not completed on invalid input)
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some(s => s.id === step2.id)).toBe(true);
  });

  it('rejects duplicate selection within a single multi-target TARGET_SELECTION step', async () => {
    const gameId = 'test_resolution_distinct_single_step';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose two targets',
      mandatory: true,
      sourceId: 'spell_multi',
      sourceName: 'Test Multi-Target Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'permanent' },
        { id: 'B', label: 'Target B', description: 'permanent' },
      ],
      targetTypes: ['permanent'],
      minTargets: 2,
      maxTargets: 2,
      targetDescription: 'two targets',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['A', 'A'] });

    const errorEvt = emitted.find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Duplicate target selected');

    // Step remains pending
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some(s => s.id === step.id)).toBe(true);
  });
});
