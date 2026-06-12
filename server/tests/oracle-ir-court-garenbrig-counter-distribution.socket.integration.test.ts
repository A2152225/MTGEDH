import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import {
  initializePriorityResolutionHandler,
  registerResolutionHandlers,
  sanitizeStepForClient,
} from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  GameManager.deleteGame(gameId);
}

function setupCourtGame(gameId: string) {
  const game = createInitialGameState(gameId);
  const playerId = 'p1' as PlayerID;
  game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);
  (game as any).gameId = gameId;
  (game.state as any).battlefield = [
    {
      id: 'court_1',
      controller: playerId,
      owner: playerId,
      card: {
        name: 'Court of Garenbrig',
        type_line: 'Legendary Enchantment',
        oracle_text:
          'When Court of Garenbrig enters the battlefield, you become the monarch.\n' +
          'At the beginning of your upkeep, distribute two +1/+1 counters among up to two target creatures.',
      },
    },
    { id: 't1', controller: playerId, owner: playerId, card: { name: 'Merfolk A', type_line: 'Creature — Merfolk' }, counters: {} },
    { id: 't2', controller: playerId, owner: playerId, card: { name: 'Merfolk B', type_line: 'Creature — Merfolk' }, counters: {} },
  ];
  games.set(gameId, game as any);
  ResolutionQueueManager.removeQueue(gameId);
  return { game, playerId };
}

describe('Court of Garenbrig counter distribute socket E2E', () => {
  const gameId = 'oracle_ir_court_garenbrig_counter_socket';
  const playerId = 'p1' as PlayerID;
  const courtUpkeepText = 'distribute two +1/+1 counters among up to two target creatures';

  beforeAll(async () => {
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
  });

  it('queues target selection then auto-applies a 1+1 split through submitResolutionResponse', async () => {
    const { game, playerId } = setupCourtGame(gameId);

    executeTriggerEffect(
      game as any,
      playerId,
      'Court of Garenbrig',
      courtUpkeepText,
      {
        type: 'triggered_ability',
        controller: playerId,
        source: 'court_1',
        permanentId: 'court_1',
        id: 'court_upkeep',
        triggerType: 'upkeep',
      },
    );

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();
    expect((targetStep as any)?.maxTargets).toBe(2);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.submitResolutionResponse?.({
      gameId,
      stepId: String(targetStep!.id),
      selections: ['t1', 't2'],
    });

    const refreshed = games.get(gameId)!;
    expect(refreshed.state.battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(1);
    expect(refreshed.state.battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('doubles distributed +1/+1 counters when Branching Evolution is on the battlefield', async () => {
    const branchingGameId = `${gameId}_branching`;
    await resetGame(branchingGameId);
    const game = createInitialGameState(branchingGameId);
    game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);
    (game as any).gameId = branchingGameId;
    (game.state as any).battlefield = [
      {
        id: 'branching_1',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'Branching Evolution',
          type_line: 'Enchantment',
          oracle_text:
            'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on that creature instead.',
        },
      },
      {
        id: 'court_1',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'Court of Garenbrig',
          type_line: 'Legendary Enchantment',
          oracle_text:
            'When Court of Garenbrig enters the battlefield, you become the monarch.\n' +
            'At the beginning of your upkeep, distribute two +1/+1 counters among up to two target creatures.',
        },
      },
      { id: 't1', controller: playerId, owner: playerId, card: { name: 'Merfolk A', type_line: 'Creature — Merfolk' }, counters: {} },
      { id: 't2', controller: playerId, owner: playerId, card: { name: 'Merfolk B', type_line: 'Creature — Merfolk' }, counters: {} },
    ];
    games.set(branchingGameId, game as any);
    ResolutionQueueManager.removeQueue(branchingGameId);

    executeTriggerEffect(
      game as any,
      playerId,
      'Court of Garenbrig',
      courtUpkeepText,
      {
        type: 'triggered_ability',
        controller: playerId,
        source: 'court_1',
        permanentId: 'court_1',
        id: 'court_upkeep_branching',
        triggerType: 'upkeep',
        targets: ['t1', 't2'],
      },
    );

    expect(
      (game.state as any).battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1'],
    ).toBe(2);
    expect(
      (game.state as any).battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1'],
    ).toBe(2);
    expect(ResolutionQueueManager.getQueue(branchingGameId).steps).toHaveLength(0);
  });

  it('doubles distributed counters after target-selection resume with Branching Evolution', async () => {
    const branchingGameId = `${gameId}_branching_resume`;
    await resetGame(branchingGameId);
    const game = createInitialGameState(branchingGameId);
    game.applyEvent!({ type: 'join', playerId, name: 'P1' } as any);
    (game as any).gameId = branchingGameId;
    (game.state as any).battlefield = [
      {
        id: 'branching_1',
        controller: playerId,
        owner: playerId,
        card: {
          name: 'Branching Evolution',
          type_line: 'Enchantment',
          oracle_text:
            'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on that creature instead.',
        },
      },
      {
        id: 'court_1',
        controller: playerId,
        owner: playerId,
        card: { name: 'Court of Garenbrig', type_line: 'Legendary Enchantment' },
      },
      { id: 't1', controller: playerId, owner: playerId, card: { name: 'Merfolk A', type_line: 'Creature — Merfolk' }, counters: {} },
      { id: 't2', controller: playerId, owner: playerId, card: { name: 'Merfolk B', type_line: 'Creature — Merfolk' }, counters: {} },
    ];
    games.set(branchingGameId, game as any);
    ResolutionQueueManager.removeQueue(branchingGameId);

    executeTriggerEffect(
      game as any,
      playerId,
      'Court of Garenbrig',
      courtUpkeepText,
      {
        type: 'triggered_ability',
        controller: playerId,
        source: 'court_1',
        permanentId: 'court_1',
        id: 'court_upkeep_branching_resume',
        triggerType: 'upkeep',
      },
    );

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(branchingGameId, playerId)
      .find((step) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(branchingGameId, String(targetStep!.id), {
      stepId: String(targetStep!.id),
      playerId,
      selections: ['t1', 't2'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(game as any, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'add_counter')).toBe(true);
    maybeResumeOracleIRStepsAfterResolution(game as any, completedStep);

    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(2);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(2);
  });

  it('doubles distributed counters through target selection and socket resume with Branching Evolution', async () => {
    const { game, playerId: controllerId } = setupCourtGame(gameId);
    (game.state as any).battlefield.unshift({
      id: 'branching_1',
      controller: playerId,
      owner: playerId,
      card: {
        name: 'Branching Evolution',
        type_line: 'Enchantment',
        oracle_text:
          'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on that creature instead.',
      },
    });

    executeTriggerEffect(
      game as any,
      playerId,
      'Court of Garenbrig',
      courtUpkeepText,
      {
        type: 'triggered_ability',
        controller: playerId,
        source: 'court_1',
        permanentId: 'court_1',
        id: 'court_upkeep_branching',
        triggerType: 'upkeep',
      },
    );

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.submitResolutionResponse?.({
      gameId,
      stepId: String(targetStep!.id),
      selections: ['t1', 't2'],
    });

    const refreshed = ensureGame(gameId)!;
    expect(refreshed.state.battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(2);
    expect(refreshed.state.battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(2);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues counter distribution after targets when total exceeds target count', async () => {
    const { game, playerId } = setupCourtGame(gameId);

    const distributeThreeText = 'distribute three +1/+1 counters among up to two target creatures';

    executeTriggerEffect(
      game as any,
      playerId,
      'Court of Garenbrig',
      distributeThreeText,
      {
        type: 'triggered_ability',
        controller: playerId,
        source: 'court_1',
        permanentId: 'court_1',
        id: 'court_upkeep_three',
        triggerType: 'upkeep',
      },
    );

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.submitResolutionResponse?.({
      gameId,
      stepId: String(targetStep!.id),
      selections: ['t1', 't2'],
    });

    const distributionStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.COUNTER_DISTRIBUTION);
    expect(distributionStep).toBeTruthy();

    const clientStep = sanitizeStepForClient(gameId, distributionStep!);
    expect(clientStep).toMatchObject({
      type: 'counter_distribution',
      counterType: '+1/+1',
      totalAmount: 3,
      minPerTarget: 1,
    });
    expect(clientStep.validTargets).toEqual([
      expect.objectContaining({ id: 't1', label: 'Merfolk A' }),
      expect.objectContaining({ id: 't2', label: 'Merfolk B' }),
    ]);

    const resolutionPrompt = emitted.find((entry) => entry.event === 'resolutionStepPrompt');
    expect(resolutionPrompt?.payload?.step?.type).toBe('counter_distribution');

    await handlers.submitResolutionResponse?.({
      gameId,
      stepId: String(distributionStep!.id),
      selections: { t1: 2, t2: 1 },
    });

    const refreshed = games.get(gameId)!;
    expect(refreshed.state.battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(2);
    expect(refreshed.state.battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
