import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR add_mana distribution queue adapter', () => {
  it('queues distribution mana selection and applies combined colors on resume', () => {
    const gameId = 'oracle_ir_add_mana_distribution';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'mana-dist-source',
      sourceName: 'Mana Dist Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'add_mana',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 2 },
          mana: '{W}{U}',
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: 'Add two mana in any combination of colors.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const manaStep = steps.find((step) => step.type === ResolutionStepType.MANA_COLOR_SELECTION);
    expect(manaStep).toBeTruthy();
    expect((manaStep as any)?.selectionKind).toBe('distribution');
    expect((manaStep as any)?.totalAmount).toBe(2);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(manaStep!.id), {
      stepId: String(manaStep!.id),
      playerId: p1,
      selections: { R: 1, G: 1 },
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'add_mana')).toBe(true);

    const pool = (game.state as any).manaPool?.[p1];
    expect(pool?.red).toBe(1);
    expect(pool?.green).toBe(1);
  });
});
