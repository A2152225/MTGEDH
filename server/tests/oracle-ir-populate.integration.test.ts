import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  resumeOracleIRStepWithChoiceFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR populate queue adapter', () => {
  it('queues populate target selection when multiple creature tokens exist', () => {
    const gameId = 'oracle_ir_populate_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'token-bear',
        controller: p1,
        owner: p1,
        isToken: true,
        card: { id: 'bear-token', name: 'Bear Token', type_line: 'Creature — Bear' },
      },
      {
        id: 'token-elf',
        controller: p1,
        owner: p1,
        isToken: true,
        card: { id: 'elf-token', name: 'Elf Token', type_line: 'Creature — Elf' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'populate-source-1',
      sourceName: 'Growing Ranks',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'populate',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Populate.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const populateStep = steps.find((step) => step.type === ResolutionStepType.TARGET_SELECTION);

    expect(populateStep).toBeTruthy();
    expect((populateStep as any)?.validTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'token-bear' }),
        expect.objectContaining({ id: 'token-elf' }),
      ])
    );
    expect(String((populateStep as any)?.oracleIrChoiceStepJson || '')).toContain('populate');

    const resumed = resumeOracleIRStepWithChoiceFromResolution(ctx, {
      controller: p1,
      sourceId: 'populate-source-1',
      sourceName: 'Growing Ranks',
      steps: [
        {
          kind: 'populate',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Populate.',
        } as any,
      ],
      chosenObjectIds: ['token-bear'],
    });

    expect(resumed?.appliedSteps.map((step) => step.kind)).toEqual(['populate']);
    expect((game.state as any).battlefield).toHaveLength(3);
    expect((game.state as any).battlefield.some((perm: any) => perm.id !== 'token-bear' && perm.id !== 'token-elf')).toBe(true);
  });
});
