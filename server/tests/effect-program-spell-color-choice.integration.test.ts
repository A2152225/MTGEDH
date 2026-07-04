import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildEffectProgramFromOracleIR, createEffectProgramRuntime, runEffectProgram } from '../../rules-engine/src/effectProgram.js';
import { createOracleIREffectProgramHandlers } from '../../rules-engine/src/effectProgramOracleRunner.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import {
  clearEffectProgramRuntimes,
  queueEffectProgramChoice,
  readEffectProgramQueueMetadata,
  restoreEffectProgramRuntimeForPendingStep,
  startEffectProgramResolution,
} from '../src/state/effects/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

const gameId = 't_effect_program_spell_color';

describe('effect program spell color choice', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    clearEffectProgramRuntimes(gameId);
  });

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    clearEffectProgramRuntimes(gameId);
  });

  it('restores runtime and resumes spell color choice after server restart', () => {
    const game = createInitialGameState(gameId);
    const playerId = 'p1';
    game.applyEvent({ type: 'join', playerId, name: 'P1' });

    (game.state as any).stack = [{
      id: 'stack_brave_1',
      type: 'spell',
      controller: playerId,
      oracleIrDeferredFinalize: true,
      card: {
        id: 'brave_card_1',
        name: 'Brave the Elements',
        type_line: 'Instant',
        oracle_text: 'Choose a color. White creatures you control gain protection from the chosen color until end of turn.',
        colors: ['W'],
      },
    }];
    (game.state as any).battlefield = [{
      id: 'soldier_1',
      controller: playerId,
      card: {
        id: 'soldier_card',
        name: 'Soldier',
        type_line: 'Creature — Soldier',
        colors: ['W'],
      },
    }];

    const program = buildEffectProgramFromOracleIR({
      id: 'spell:stack_brave_1:effect-program',
      controllerId: playerId,
      sourceId: 'stack_brave_1',
      sourceName: 'Brave the Elements',
      steps: [
        {
          kind: 'choose_color',
          who: { kind: 'you' },
          raw: 'Choose a color.',
        } as any,
        {
          kind: 'grant_protection',
          who: { kind: 'you_control' },
          color: { kind: 'chosen' },
          filter: { type: 'creature', colors: ['W'] },
          duration: 'end_of_turn',
          raw: 'White creatures you control gain protection from the chosen color until end of turn.',
        } as any,
      ],
    });

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'stack_brave_1',
      sourceName: 'Brave the Elements',
      sourceObjectType: 'spell',
    }, {});

    const started = startEffectProgramResolution({
      game,
      gameId,
      program,
      handlers: createOracleIREffectProgramHandlers({ ...irCtx, deferStackSpellCopiesToServer: true }) as any,
      persistPrompt: false,
      oracleIrBridge: {
        irCtx: { ...irCtx, deferStackSpellCopiesToServer: true },
        controller: playerId as any,
        sourceName: 'Brave the Elements',
        sourceId: 'stack_brave_1',
      },
    });

    expect(started.status).toBe('waiting_for_choice');
    expect(started.queuedStep).toBeDefined();

    clearEffectProgramRuntimes(gameId);

    const step = started.queuedStep!;
    expect(restoreEffectProgramRuntimeForPendingStep(game, gameId, step)).toBe(true);

    const completedStep = ResolutionQueueManager.completeStep(gameId, step.id, {
      stepId: step.id,
      playerId,
      selections: ['green'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const metadata = readEffectProgramQueueMetadata(step);
    expect(metadata).toBeDefined();

    const paused = runEffectProgram(createEffectProgramRuntime({
      program,
      state: (game.state as any),
      cursor: metadata!.effectProgramCursor,
    }));
    expect(paused.status).toBe('waiting_for_choice');
    expect(completedStep).toBeDefined();
  });
});
