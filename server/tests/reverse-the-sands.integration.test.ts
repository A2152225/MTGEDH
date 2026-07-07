import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { sanitizeStepForClient } from '../src/socket/resolution.js';

const REVERSE_THE_SANDS_TEXT =
  "Redistribute any number of players' life totals. (Each of those players gets one life total back.)";

function joinPlayer(game: ReturnType<typeof createInitialGameState>, playerId: PlayerID, name: string) {
  game.applyEvent!({ type: 'join', playerId, name } as any);
}

describe('Reverse the Sands life redistribution integration', () => {
  it('queues LIFE_REDISTRIBUTION and applies chosen totals on resume', () => {
    const gameId = 'reverse_the_sands_life_redistribution';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    joinPlayer(game, p1, 'Alice');
    joinPlayer(game, p2, 'Bob');
    joinPlayer(game, p3, 'Carol');

    (game.state as any).life = { p1: 20, p2: 30, p3: 40 };
    for (const player of (game.state as any).players) {
      player.life = (game.state as any).life[player.id];
    }

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(REVERSE_THE_SANDS_TEXT, 'Reverse the Sands').abilities?.[0]?.steps || [];
    expect(steps.some((step: any) => step?.kind === 'redistribute_life_totals')).toBe(true);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'reverse-the-sands-1',
      sourceName: 'Reverse the Sands',
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, steps, irCtx, { allowOptional: false }, { controller: p1 });

    const queueSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const redistributionStep = queueSteps.find((step) => step.type === ResolutionStepType.LIFE_REDISTRIBUTION);
    expect(redistributionStep).toBeTruthy();
    expect((redistributionStep as any)?.players).toEqual([
      { id: 'p1', name: 'Alice', life: 20 },
      { id: 'p2', name: 'Bob', life: 30 },
      { id: 'p3', name: 'Carol', life: 40 },
    ]);

    const clientStep = sanitizeStepForClient(gameId, redistributionStep!);
    expect(clientStep.type).toBe('life_redistribution');
    expect(clientStep.players).toHaveLength(3);

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(redistributionStep!.id), {
      stepId: String(redistributionStep!.id),
      playerId: p1,
      selections: {
        lifeByPlayerId: {
          p1: 40,
          p2: 30,
          p3: 20,
        },
      },
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'redistribute_life_totals')).toBe(true);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    expect((game.state as any).life).toEqual({ p1: 40, p2: 30, p3: 20 });
  });

  it('does not auto-apply life totals without player choice', () => {
    const gameId = 'reverse_the_sands_requires_choice';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    joinPlayer(game, p1, 'Alice');
    joinPlayer(game, p2, 'Bob');
    (game.state as any).life = { p1: 25, p2: 35 };
    for (const player of (game.state as any).players) {
      player.life = (game.state as any).life[player.id];
    }

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR(REVERSE_THE_SANDS_TEXT, 'Reverse the Sands').abilities?.[0]?.steps || [];
    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'reverse-the-sands-2',
      sourceName: 'Reverse the Sands',
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, steps, irCtx, { allowOptional: false }, { controller: p1 });

    expect((game.state as any).life).toEqual({ p1: 25, p2: 35 });
    expect(
      ResolutionQueueManager.getStepsForPlayer(gameId, p1).some(
        (step) => step.type === ResolutionStepType.LIFE_REDISTRIBUTION,
      ),
    ).toBe(true);
  });
});
