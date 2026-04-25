import type { GameState } from '../../../../shared/src/index.js';
import {
  bindEffectProgramChoiceResponse,
  createEffectProgramRuntime,
  runEffectProgram,
  type EffectProgram,
  type EffectProgramHandlers,
  type EffectProgramRunResult,
  type EffectProgramRuntime,
} from '../../../../rules-engine/src/effectProgram.js';
import type { ResolutionStep, ResolutionStepResponse } from '../resolution/index.js';
import {
  appendEffectProgramPromptEvent,
  createEffectProgramChoiceResponse,
  type EffectProgramQueueExtraConfig,
  queueEffectProgramChoice,
  readEffectProgramQueueMetadata,
} from './effectProgramQueueAdapter.js';

interface StoredEffectProgramRuntime {
  readonly runtime: EffectProgramRuntime<GameState>;
  readonly handlers: EffectProgramHandlers<GameState>;
  readonly queueExtraConfig?: EffectProgramQueueExtraConfig;
}

export interface StartEffectProgramResolutionArgs {
  readonly game: any;
  readonly gameId: string;
  readonly program: EffectProgram;
  readonly handlers?: EffectProgramHandlers<GameState>;
  readonly state?: GameState;
  readonly persistPrompt?: boolean;
  readonly queueExtraConfig?: EffectProgramQueueExtraConfig;
}

export interface ResumeEffectProgramResolutionArgs {
  readonly game: any;
  readonly gameId: string;
  readonly step: ResolutionStep;
  readonly response: ResolutionStepResponse;
  readonly persistPrompt?: boolean;
}

export interface EffectProgramResolutionResult {
  readonly resumed: boolean;
  readonly status: EffectProgramRunResult<GameState>['status'] | 'runtime_not_found' | 'not_effect_program_prompt';
  readonly runResult?: EffectProgramRunResult<GameState>;
  readonly queuedStep?: ResolutionStep;
  readonly reason?: string;
}

const runtimeStore = new Map<string, Map<string, StoredEffectProgramRuntime>>();

export function startEffectProgramResolution(args: StartEffectProgramResolutionArgs): EffectProgramResolutionResult {
  const runtime = createEffectProgramRuntime({
    program: args.program,
    state: args.state || (args.game as any)?.state,
  });

  return continueEffectProgramResolution({
    game: args.game,
    gameId: args.gameId,
    runtime,
    handlers: args.handlers || {},
    persistPrompt: args.persistPrompt ?? true,
    queueExtraConfig: args.queueExtraConfig,
    resumed: false,
  });
}

export function resumeEffectProgramResolution(args: ResumeEffectProgramResolutionArgs): EffectProgramResolutionResult {
  const metadata = readEffectProgramQueueMetadata(args.step);
  if (!metadata) {
    return { resumed: false, status: 'not_effect_program_prompt' };
  }

  const stored = getRuntimeForStep(args.gameId, args.step.id);
  if (!stored) {
    return {
      resumed: false,
      status: 'runtime_not_found',
      reason: `No EffectProgram runtime for step ${args.step.id}`,
    };
  }

  deleteRuntimeForStep(args.gameId, args.step.id);

  const choiceResponse = createEffectProgramChoiceResponse(args.step, args.response);
  const runtime = bindEffectProgramChoiceResponse(stored.runtime, choiceResponse, metadata.effectProgramBindingKey);

  return continueEffectProgramResolution({
    game: args.game,
    gameId: args.gameId,
    runtime,
    handlers: stored.handlers,
    persistPrompt: args.persistPrompt ?? true,
    queueExtraConfig: stored.queueExtraConfig,
    resumed: true,
  });
}

export function clearEffectProgramRuntimes(gameId: string): void {
  runtimeStore.delete(gameId);
}

export function getEffectProgramRuntimeForStep(
  gameId: string,
  stepId: string
): EffectProgramRuntime<GameState> | undefined {
  return getRuntimeForStep(gameId, stepId)?.runtime;
}

function continueEffectProgramResolution(args: {
  readonly game: any;
  readonly gameId: string;
  readonly runtime: EffectProgramRuntime<GameState>;
  readonly handlers: EffectProgramHandlers<GameState>;
  readonly persistPrompt: boolean;
  readonly queueExtraConfig?: EffectProgramQueueExtraConfig;
  readonly resumed: boolean;
}): EffectProgramResolutionResult {
  const runResult = runEffectProgram(args.runtime, args.handlers);
  applyRunResultState(args.game, runResult);

  if (runResult.status === 'waiting_for_choice' && runResult.pendingChoice) {
    const queuedStep = queueEffectProgramChoice(args.gameId, runResult.pendingChoice, args.queueExtraConfig);
    storeRuntimeForStep(args.gameId, queuedStep.id, {
      runtime: runResult.pendingChoice.runtime,
      handlers: args.handlers,
      queueExtraConfig: args.queueExtraConfig,
    });

    if (args.persistPrompt) {
      appendEffectProgramPromptEvent(args.game, args.gameId, queuedStep);
    }

    return {
      resumed: args.resumed,
      status: runResult.status,
      runResult,
      queuedStep,
    };
  }

  return {
    resumed: args.resumed,
    status: runResult.status,
    runResult,
    reason: runResult.reason,
  };
}

function applyRunResultState(game: any, runResult: EffectProgramRunResult<GameState>): void {
  if (!game || !runResult.state) {
    return;
  }

  (game as any).state = runResult.state;
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

function getRuntimeForStep(gameId: string, stepId: string): StoredEffectProgramRuntime | undefined {
  return runtimeStore.get(gameId)?.get(stepId);
}

function storeRuntimeForStep(gameId: string, stepId: string, runtime: StoredEffectProgramRuntime): void {
  let gameRuntimes = runtimeStore.get(gameId);
  if (!gameRuntimes) {
    gameRuntimes = new Map();
    runtimeStore.set(gameId, gameRuntimes);
  }

  gameRuntimes.set(stepId, runtime);
}

function deleteRuntimeForStep(gameId: string, stepId: string): void {
  const gameRuntimes = runtimeStore.get(gameId);
  if (!gameRuntimes) {
    return;
  }

  gameRuntimes.delete(stepId);
  if (gameRuntimes.size === 0) {
    runtimeStore.delete(gameId);
  }
}
