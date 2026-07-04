import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import {
  clearEffectProgramRuntimes,
  getEffectProgramRuntimeForStep,
  resumeEffectProgramResolution,
} from '../src/state/effects/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { finalizeGameStateAfterReplay } from '../src/state/modules/replay-prompt-cleanup.js';
import {
  restoreAllPendingEffectProgramRuntimes,
  restoreEffectProgramRuntimeForPendingStep,
} from '../src/state/effects/effectProgramReplayRestore.js';
import type { PlayerID } from '../../shared/src';

const gameId = 't_effect_program_replay_restore';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('effect program replay restore', () => {
  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    clearEffectProgramRuntimes(gameId);
  });

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    clearEffectProgramRuntimes(gameId);
  });

  it('rebuilds effect-program runtime after replay for optional trigger prompt', () => {
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).priority = null;

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'auriok_1',
      effectProgram: {
        effectProgramId: 'trigger:auriok_1:0',
        effectProgramFamily: 'trigger_resolution',
        effectProgramSourceId: 'auriok_1',
        effectProgramSourceName: 'Auriok Champion',
        effectProgramCursor: 0,
        effectProgramStepId: 'trigger:auriok_1:0:choice',
        effectProgramBindingKey: 'trigger:auriok_1:0:decision',
      },
      queuedResolutionStep: {
        id: 'queued_auriok_prompt',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'auriok_1',
        sourceName: 'Auriok Champion',
        description: 'Auriok Champion: you may gain 1 life.',
        mandatory: false,
        effectProgramPrompt: true,
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: 1,
        maxSelections: 1,
        deferredTriggeredAbilityItem: {
          id: 'trigger_1',
          type: 'triggered_ability',
          controller: playerId,
          source: 'auriok_1',
          sourceName: 'Auriok Champion',
          description: 'you may gain 1 life.',
          effect: 'you may gain 1 life.',
          triggerType: 'creature_etb',
        },
      },
    } as any);

    expect(getEffectProgramRuntimeForStep(gameId, 'queued_auriok_prompt')).toBeUndefined();

    const restored = restoreAllPendingEffectProgramRuntimes(game, gameId);
    expect(restored).toBe(1);
    expect(getEffectProgramRuntimeForStep(gameId, 'queued_auriok_prompt')).toBeDefined();

    const completedStep = ResolutionQueueManager.completeStep(gameId, 'queued_auriok_prompt', {
      stepId: 'queued_auriok_prompt',
      playerId,
      selections: ['yes'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = resumeEffectProgramResolution({
      game,
      gameId,
      step: completedStep!,
      response: completedStep!.response!,
      persistPrompt: false,
    });

    expect(resumed.status).not.toBe('runtime_not_found');
    if (resumed.status === 'completed') {
      expect((game.state as any).life[playerId]).toBe(41);
    }
  });

  it('rebuilds effect-program runtime for spell color choice on stack', () => {
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).stack = [{
      id: 'stack_brave_1',
      type: 'spell',
      controller: playerId,
      sourceName: 'Brave the Elements',
      card: {
        id: 'brave_card_1',
        name: 'Brave the Elements',
        oracle_text: 'Choose a color. White creatures you control are protected from the chosen color until end of turn.',
      },
    }];

    const step = {
      id: 'queued_brave_color',
      type: ResolutionStepType.COLOR_CHOICE,
      playerId,
      sourceId: 'stack_brave_1',
      sourceName: 'Brave the Elements',
      description: 'Brave the Elements: Choose a color.',
      mandatory: true,
      effectProgramPrompt: true,
      effectProgramId: 'spell:stack_brave_1:effect-program',
      effectProgramFamily: 'spell_resolution',
      effectProgramSourceId: 'stack_brave_1',
      effectProgramSourceName: 'Brave the Elements',
      effectProgramCursor: 0,
      effectProgramStepId: 'spell:stack_brave_1:effect-program:clause-0:choice',
      effectProgramBindingKey: 'spell:stack_brave_1:effect-program:clause-0:binding',
    } as any;

    ResolutionQueueManager.addStep(gameId, step);

    expect(restoreEffectProgramRuntimeForPendingStep(game, gameId, step)).toBe(true);
    expect(getEffectProgramRuntimeForStep(gameId, 'queued_brave_color')).toBeDefined();
  });

  it('finalizeGameStateAfterReplay keeps resolution mode when pending steps exist', () => {
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = null;
    (game.state as any)._priorityAfterResolution = playerId;

    ResolutionQueueManager.addStep(gameId, {
      id: 'pending_step_1',
      type: ResolutionStepType.COLOR_CHOICE,
      playerId,
      description: 'Choose a color',
      mandatory: true,
    } as any);

    finalizeGameStateAfterReplay(game as any);

    expect((game.state as any).priority).toBeNull();
    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(true);
  });

  it('replays trigger_resolution optional yes without re-prompting', () => {
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).stack = [{
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'auriok_1',
      sourceName: 'Auriok Champion',
      description: 'you may gain 1 life.',
      effect: 'you may gain 1 life.',
      triggerType: 'creature_etb',
    }];

    const effectProgram = {
      effectProgramId: 'trigger:auriok_1:0',
      effectProgramFamily: 'trigger_resolution',
      effectProgramSourceId: 'auriok_1',
      effectProgramSourceName: 'Auriok Champion',
      effectProgramCursor: 0,
      effectProgramStepId: 'trigger:auriok_1:0:choice',
      effectProgramBindingKey: 'trigger:auriok_1:0:decision',
    };

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId,
      sourceId: 'auriok_1',
      effectProgram,
      queuedResolutionStep: {
        id: 'queued_auriok_prompt',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId,
        sourceId: 'auriok_1',
        sourceName: 'Auriok Champion',
        description: 'Auriok Champion: you may gain 1 life.',
        mandatory: false,
        effectProgramPrompt: true,
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
        minSelections: 1,
        maxSelections: 1,
      },
    } as any);

    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(true);

    game.applyEvent({
      type: 'optionalTriggeredAbilityChoice',
      playerId,
      sourceId: 'auriok_1',
      sourceName: 'Auriok Champion',
      resolvedStepId: 'queued_auriok_prompt',
      choice: 'yes',
      effectProgram,
    } as any);

    game.applyEvent({
      type: 'adjustLife',
      playerId,
      delta: 1,
      effectProgramMutation: true,
      effectProgramSourceName: 'Auriok Champion',
    } as any);

    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(false);
    expect((game.state as any).life[playerId]).toBe(41);
  });
});
