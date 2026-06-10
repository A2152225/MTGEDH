import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR change_target queue adapter', () => {
  it('queues new target selection and updates the chosen spell target on resume', () => {
    const gameId = 'oracle_ir_change_target_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'perm-a',
        controller: p1,
        owner: p1,
        card: { name: 'Target A', type_line: 'Creature' },
      },
      {
        id: 'perm-b',
        controller: p1,
        owner: p1,
        card: { name: 'Target B', type_line: 'Creature' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'spell-1',
        type: 'spell',
        controller: p1,
        name: 'Shock',
        card: { name: 'Shock' },
        targets: [{ id: 'perm-a', type: 'permanent' }],
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'change-target-source',
      sourceName: 'Deflecting Swat',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'change_target',
          target: { kind: 'raw', text: 'target spell' },
          newTarget: { kind: 'raw', text: 'any target' },
          raw: 'Change the target to any target.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const targetStep = steps.find((step) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();
    expect((targetStep as any)?.oracleIrChangeTargetPhase).toBe('choose_new_target');
    expect((targetStep as any)?.oracleIrTargetSpellId).toBe('spell-1');

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(targetStep!.id), {
      stepId: String(targetStep!.id),
      playerId: p1,
      selections: ['perm-b'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'change_target')).toBe(true);

    const stackSpell = ((game.state as any).stack || []).find((entry: any) => entry.id === 'spell-1');
    expect(stackSpell?.targets?.map((target: any) => target.id)).toEqual(['perm-b']);
  });
});
