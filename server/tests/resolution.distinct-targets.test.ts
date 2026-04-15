import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId?: string
) {
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

const distinctTargetGameIds = [
  'test_resolution_distinct_cross_step',
  'test_resolution_distinct_non_target_another',
  'test_resolution_distinct_other_target',
  'test_resolution_distinct_second_target',
  'test_resolution_distinct_new_target',
  'test_resolution_distinct_other_targets_plural',
  'test_resolution_distinct_different_creature_target',
  'test_resolution_distinct_another_permanent_target',
  'test_resolution_distinct_other_than_that_target',
  'test_resolution_distinct_other_than_chosen_target',
  'test_resolution_distinct_single_step',
];

describe('Resolution TARGET_SELECTION distinct-target enforcement', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of distinctTargetGameIds) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of distinctTargetGameIds) {
      await resetGame(gameId);
    }
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
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
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
  const beforeFirst = emitted.length;
  await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

  const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
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

  it('does not infer cross-step distinctness from "another" when target wording is absent', async () => {
    const gameId = 'test_resolution_distinct_non_target_another';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
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
      description: 'Choose another card',
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
      targetDescription: 'a card',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
  const beforeFirst = emitted.length;
  await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

  const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['A', 'B']);
  });

  it('infers cross-step distinctness from "other target" without an explicit flag', async () => {
    const gameId = 'test_resolution_distinct_other_target';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
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
      description: 'Choose other target',
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
      targetDescription: 'other target',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
  const beforeFirst = emitted.length;
  await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

  const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['B']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['A'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');
  });

  it('infers cross-step distinctness from "second target" without an explicit flag', async () => {
    const gameId = 'test_resolution_distinct_second_target';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
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
      description: 'Choose a second target',
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
      targetDescription: 'second target',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
  const beforeFirst = emitted.length;
  await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

  const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['B']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['A'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');
  });

  it('infers cross-step distinctness from "new target" without an explicit flag', async () => {
    const gameId = 'test_resolution_distinct_new_target';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
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
      description: 'Choose a new target',
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
      targetDescription: 'new target',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
  const beforeFirst = emitted.length;
  await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

  const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['B']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['A'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');
  });

  it('infers cross-step distinctness from plural "other targets" without an explicit flag', async () => {
    const gameId = 'test_resolution_distinct_other_targets_plural';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
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
        { id: 'C', label: 'Target C', description: 'permanent' },
      ],
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'a target',
    } as any);

    const step2 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose other targets',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'permanent' },
        { id: 'B', label: 'Target B', description: 'permanent' },
        { id: 'C', label: 'Target C', description: 'permanent' },
      ],
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 2,
      targetDescription: 'other targets',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    const beforeFirst = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

    const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['B', 'C']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['A'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');
  });

  it('infers cross-step distinctness from "different creature target" without an explicit flag', async () => {
    const gameId = 'test_resolution_distinct_different_creature_target';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    registerResolutionHandlers(io as any, socket as any);

    const step1 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose a target',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'creature' },
        { id: 'B', label: 'Target B', description: 'creature' },
      ],
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'a target',
    } as any);

    const step2 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose a different creature target',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'creature' },
        { id: 'B', label: 'Target B', description: 'creature' },
      ],
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'a different creature target',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
  const beforeFirst = emitted.length;
  await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

  const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['B']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['A'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');
  });

  it('infers cross-step distinctness from "another permanent target" without an explicit flag', async () => {
    const gameId = 'test_resolution_distinct_another_permanent_target';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
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
      description: 'Choose another permanent target',
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
      targetDescription: 'another permanent target',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
  const beforeFirst = emitted.length;
  await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

  const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['B']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['A'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');
  });

  it('infers cross-step distinctness from "target ... other than that target" without an explicit flag', async () => {
    const gameId = 'test_resolution_distinct_other_than_that_target';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    registerResolutionHandlers(io as any, socket as any);

    const step1 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose a target',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'creature' },
        { id: 'B', label: 'Target B', description: 'creature' },
      ],
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'a target',
    } as any);

    const step2 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose target creature other than that target',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'creature' },
        { id: 'B', label: 'Target B', description: 'creature' },
      ],
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'target creature other than that target',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
  const beforeFirst = emitted.length;
  await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['A'] });

  const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['B']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['A'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');
  });

  it('infers cross-step distinctness from "other than the chosen target" without an explicit flag', async () => {
    const gameId = 'test_resolution_distinct_other_than_chosen_target';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];
    (game.state as any).stack = [{ id: 'spell_1', type: 'spell' }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    registerResolutionHandlers(io as any, socket as any);

    const step1 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose a target',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'creature' },
        { id: 'B', label: 'Target B', description: 'creature' },
      ],
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'a target',
    } as any);

    const step2 = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose target creature other than the chosen target',
      mandatory: true,
      sourceId: 'spell_1',
      sourceName: 'Test Spell',
      validTargets: [
        { id: 'A', label: 'Target A', description: 'creature' },
        { id: 'B', label: 'Target B', description: 'creature' },
      ],
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'target creature other than the chosen target',
    } as any);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    const beforeFirst = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step1.id, selections: ['B'] });

    const prompt = emitted.slice(beforeFirst).find(e => e.event === 'resolutionStepPrompt');
    expect(prompt).toBeDefined();
    expect(prompt!.payload.step.id).toBe(step2.id);
    expect((prompt!.payload.step.validTargets || []).map((t: any) => t.id)).toEqual(['A']);

    const beforeSecond = emitted.length;
    await handlers['submitResolutionResponse']({ gameId, stepId: step2.id, selections: ['B'] });

    const errorEvt = emitted.slice(beforeSecond).find(e => e.event === 'error');
    expect(errorEvt).toBeDefined();
    expect(errorEvt!.payload.code).toBe('INVALID_SELECTION');
    expect(errorEvt!.payload.message).toBe('Must choose a different target');
  });

  it('rejects duplicate selection within a single multi-target TARGET_SELECTION step', async () => {
    const gameId = 'test_resolution_distinct_single_step';
    createGameIfNotExists(gameId, 'commander', 40);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
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
