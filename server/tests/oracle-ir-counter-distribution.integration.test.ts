import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { sanitizeStepForClient } from '../src/socket/resolution.js';

describe('oracle IR counter distribution queue adapter', () => {
  it('queues counter distribution and applies chosen split on resume', () => {
    const gameId = 'oracle_ir_counter_distribution';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 't1', controller: p1, card: { name: 'A', type_line: 'Creature — Elf' }, counters: {} },
      { id: 't2', controller: p1, card: { name: 'B', type_line: 'Creature — Elf' }, counters: {} },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = [
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 3 },
        counter: '+1/+1',
        distribution: 'among',
        target: { kind: 'raw', text: 'up to two target creatures' },
        raw: 'Distribute three +1/+1 counters among up to two target creatures.',
      },
    ] as any[];

    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: p1,
        sourceId: 'court_1',
        sourceName: 'Court of Garenbrig',
        selectorContext: { chosenObjectIds: ['t1', 't2'] },
      },
      { chosenObjectIds: ['t1', 't2'] },
    );

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      irCtx,
      { allowOptional: true },
      { controller: p1, triggerItem: { targets: ['t1', 't2'] } },
    );

    const queueSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const distributionStep = queueSteps.find((step) => step.type === ResolutionStepType.COUNTER_DISTRIBUTION);
    expect(distributionStep).toBeTruthy();
    expect((distributionStep as any)?.totalAmount).toBe(3);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(distributionStep!.id), {
      stepId: String(distributionStep!.id),
      playerId: p1,
      selections: { t1: 2, t2: 1 },
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'add_counter')).toBe(true);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(2);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(1);
  });

  it('auto-applies variable reference-amount distribute when total equals target count', () => {
    const gameId = 'oracle_ir_counter_distribution_variable';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 't1', controller: p1, card: { name: 'A', type_line: 'Creature — Elf' }, counters: {} },
      { id: 't2', controller: p1, card: { name: 'B', type_line: 'Creature — Elf' }, counters: {} },
      { id: 't3', controller: p1, card: { name: 'C', type_line: 'Creature — Elf' }, counters: {} },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = [
      {
        kind: 'add_counter',
        amount: { kind: 'reference_amount', raw: 'the number of creatures you control' },
        counter: '+1/+1',
        distribution: 'among',
        target: { kind: 'raw', text: 'any number of creatures you control' },
        raw: 'Distribute a number of +1/+1 counters equal to the number of creatures you control among any number of creatures you control.',
      },
    ] as any[];

    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: p1,
        sourceId: 'source_1',
        sourceName: 'Variable Distribute',
        selectorContext: { chosenObjectIds: ['t1', 't2', 't3'] },
      },
      { chosenObjectIds: ['t1', 't2', 't3'] },
    );

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      irCtx,
      { allowOptional: true },
      { controller: p1, triggerItem: { targets: ['t1', 't2', 't3'] } },
    );

    const queueSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(queueSteps.some((step) => step.type === ResolutionStepType.COUNTER_DISTRIBUTION)).toBe(false);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(1);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(1);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't3')?.counters?.['+1/+1']).toBe(1);
  });

  it('queues variable reference-amount distribute when total exceeds bound target count', () => {
    const gameId = 'oracle_ir_counter_distribution_variable_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 't1', controller: p1, card: { name: 'A', type_line: 'Creature — Elf' }, counters: {} },
      { id: 't2', controller: p1, card: { name: 'B', type_line: 'Creature — Elf' }, counters: {} },
      { id: 't3', controller: p1, card: { name: 'C', type_line: 'Creature — Elf' }, counters: {} },
      { id: 't4', controller: p1, card: { name: 'D', type_line: 'Creature — Elf' }, counters: {} },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = [
      {
        kind: 'add_counter',
        amount: { kind: 'reference_amount', raw: 'the number of creatures you control' },
        counter: '+1/+1',
        distribution: 'among',
        target: { kind: 'raw', text: 'up to two target creatures' },
        raw: 'Distribute a number of +1/+1 counters equal to the number of creatures you control among up to two target creatures.',
      },
    ] as any[];

    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: p1,
        sourceId: 'source_1',
        sourceName: 'Variable Distribute',
        selectorContext: { chosenObjectIds: ['t1', 't2'] },
      },
      { chosenObjectIds: ['t1', 't2'] },
    );

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      irCtx,
      { allowOptional: true },
      { controller: p1, triggerItem: { targets: ['t1', 't2'] } },
    );

    const queueSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const distributionStep = queueSteps.find((step) => step.type === ResolutionStepType.COUNTER_DISTRIBUTION);
    expect(distributionStep).toBeTruthy();
    expect((distributionStep as any)?.totalAmount).toBe(4);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(distributionStep!.id), {
      stepId: String(distributionStep!.id),
      playerId: p1,
      selections: { t1: 3, t2: 1 },
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'add_counter')).toBe(true);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(3);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(1);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 't3')?.counters?.['+1/+1']).toBeUndefined();
  });

  it('queues stun counter distribute among tapped opponent creatures and resumes', () => {
    const gameId = 'oracle_ir_counter_distribution_stun';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).battlefield = [
      { id: 'opp1', controller: p2, tapped: true, card: { name: 'A', type_line: 'Creature — Human' }, counters: {} },
      { id: 'opp2', controller: p2, tapped: true, card: { name: 'B', type_line: 'Creature — Human' }, counters: {} },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = [
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 3 },
        counter: 'stun',
        distribution: 'among',
        target: { kind: 'raw', text: 'any number of tapped creatures your opponents control' },
        raw: 'then distribute three stun counters among any number of tapped creatures your opponents control.',
      },
    ] as any[];

    const irCtx = buildOracleIRExecutionContext({ controllerId: p1 });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      irCtx,
      { allowOptional: true },
      { controller: p1 },
    );

    const queueSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const distributionStep = queueSteps.find((step) => step.type === ResolutionStepType.COUNTER_DISTRIBUTION);
    expect(distributionStep).toBeTruthy();
    expect((distributionStep as any)?.counterType).toBe('stun');
    expect((distributionStep as any)?.totalAmount).toBe(3);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(distributionStep!.id), {
      stepId: String(distributionStep!.id),
      playerId: p1,
      selections: { opp1: 2, opp2: 1 },
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'add_counter')).toBe(true);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'opp1')?.counters?.stun).toBe(2);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'opp2')?.counters?.stun).toBe(1);
  });

  it('sanitizes queued counter distribution steps for client modal wiring', () => {
    const gameId = 'oracle_ir_counter_distribution_client_shape';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 't1', controller: p1, card: { name: 'A', type_line: 'Creature — Elf' }, counters: {} },
      { id: 't2', controller: p1, card: { name: 'B', type_line: 'Creature — Elf' }, counters: {} },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'add_counter',
          amount: { kind: 'number', value: 3 },
          counter: '+1/+1',
          distribution: 'among',
          target: { kind: 'raw', text: 'up to two target creatures' },
          raw: 'Distribute three +1/+1 counters among up to two target creatures.',
        },
      ] as any[],
      buildOracleIRExecutionContext(
        {
          controllerId: p1,
          sourceId: 'court_1',
          sourceName: 'Court of Garenbrig',
          selectorContext: { chosenObjectIds: ['t1', 't2'] },
        },
        { chosenObjectIds: ['t1', 't2'] },
      ),
      { allowOptional: true },
      { controller: p1, triggerItem: { targets: ['t1', 't2'] } },
    );

    const queuedStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.COUNTER_DISTRIBUTION);
    expect(queuedStep).toBeTruthy();

    const clientStep = sanitizeStepForClient(gameId, queuedStep!);
    expect(clientStep).toMatchObject({
      type: 'counter_distribution',
      playerId: p1,
      counterType: '+1/+1',
      totalAmount: 3,
      minPerTarget: 1,
      sourceName: 'Court of Garenbrig',
    });
    expect(clientStep.validTargets).toEqual([
      expect.objectContaining({ id: 't1', label: 'A' }),
      expect.objectContaining({ id: 't2', label: 'B' }),
    ]);
    expect(typeof clientStep.message === 'string' || typeof clientStep.description === 'string').toBe(true);
  });
});
