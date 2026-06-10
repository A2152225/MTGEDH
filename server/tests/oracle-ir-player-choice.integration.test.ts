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

describe('oracle IR player_choice queue adapter', () => {
  it('queues odd/even option choice and resumes the player_choice step', () => {
    const gameId = 'oracle_ir_player_choice_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const playerChoiceStep = {
      kind: 'player_choice',
      choice: 'odd_even',
      raw: 'Choose odd or even.',
    } as const;

    const followUpStep = {
      kind: 'gain_life',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      raw: 'You gain 1 life.',
    } as const;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'choice-source-1',
      sourceName: 'Choice Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [playerChoiceStep as any, followUpStep as any],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const optionStep = steps.find((step) => step.type === ResolutionStepType.OPTION_CHOICE);
    expect(optionStep).toBeTruthy();
    expect((optionStep as any)?.oracleIrPlayerChoiceKind).toBe('odd_even');
    expect((optionStep as any)?.options?.map((option: any) => option.id)).toEqual(['odd', 'even']);

    const playerBefore = (game.state as any).players.find((entry: any) => entry.id === p1);
    const lifeBefore = playerBefore?.life ?? 40;

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(optionStep!.id), {
      stepId: String(optionStep!.id),
      playerId: p1,
      selections: ['odd'],
      cancelled: false,
      timestamp: Date.now(),
    });

    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    const playerAfter = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life).toBe(lifeBefore + 1);
  });
});
