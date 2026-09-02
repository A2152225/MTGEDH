import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const THUMB_TEXT = 'If you would flip a coin, instead flip two coins and ignore one.';

describe('oracle IR coin ignore-one OPTION_CHOICE adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queues keep-first-or-second and resumes the locked flips', () => {
    const gameId = 'oracle_ir_coin_ignore_one';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      {
        id: 'perm_thumb',
        controller: p1,
        card: { name: "Krark's Thumb", oracle_text: THUMB_TEXT },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    let flip = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (flip++ % 2 === 0 ? 0.1 : 0.9));

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'flip_coin',
          who: { kind: 'you' },
          call: 'heads',
          raw: 'Flip a coin.',
        } as any,
      ],
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'thumb-source',
        sourceName: "Krark's Thumb",
      }),
      { allowOptional: false },
      { controller: p1 },
    );

    const optionStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE);
    expect(optionStep).toBeTruthy();
    expect((optionStep as any)?.coinIgnoreOneChoice).toBe(true);
    expect((optionStep as any)?.pendingCoinFirst).toBe('heads');
    expect((optionStep as any)?.pendingCoinSecond).toBe('tails');

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(optionStep!.id), {
      stepId: String(optionStep!.id),
      playerId: p1,
      selections: ['second'],
      cancelled: false,
      timestamp: Date.now(),
    });
    maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    maybeResumeOracleIRStepsAfterResolution(ctx, completedStep);

    expect((game.state as any).lastCoinFlip?.result).toBe('tails');
    expect((game.state as any).lastCoinFlip?.won).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });
});
