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
    state: hydrateEffectProgramStateFromGame(args.game, args.state || (args.game as any)?.state),
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

  (game as any).state = syncEffectProgramStateToGame(game, runResult.state);
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

function hydrateEffectProgramStateFromGame(game: any, state: GameState): GameState {
  if (!game || !state || !Array.isArray((state as any).players) || typeof (game as any).libraries?.get !== 'function') {
    return state;
  }

  return {
    ...state,
    players: (state.players || []).map(player => {
      const playerId = String((player as any)?.id || '').trim();
      if (!playerId) {
        return player;
      }

      const library = (game as any).libraries.get(playerId);
      if (!Array.isArray(library)) {
        return player;
      }

      return {
        ...player,
        library: library.map(card => ({ ...card })),
      } as any;
    }),
  };
}

function syncEffectProgramStateToGame(game: any, state: GameState): GameState {
  if (!game || !state || !Array.isArray((state as any).players) || typeof (game as any).libraries?.set !== 'function') {
    return state;
  }

  const originalPlayers = new Map<string, any>(
    (((game as any).state?.players || []) as any[])
      .map(player => [String(player?.id || '').trim(), player])
      .filter(([playerId]) => Boolean(playerId)) as [string, any][]
  );
  const zones = { ...((state as any).zones || {}) } as Record<string, any>;
  let didSyncZones = false;

  const players = (state.players || []).map(player => {
    const playerId = String((player as any)?.id || '').trim();
    if (!playerId) {
      return player;
    }

    const originalPlayer = originalPlayers.get(playerId);
    let nextPlayer = player as any;

    if (Array.isArray((player as any).library)) {
      const library = ((player as any).library as any[]).map(card => ({ ...card, zone: 'library' }));
      (game as any).libraries.set(playerId, library);
      zones[playerId] = {
        ...(zones[playerId] || {}),
        libraryCount: library.length,
      };
      didSyncZones = true;

      if (!originalPlayer || !Object.prototype.hasOwnProperty.call(originalPlayer, 'library')) {
        const { library: _library, ...playerWithoutLibrary } = nextPlayer;
        nextPlayer = playerWithoutLibrary;
      }
    }

    if (Array.isArray((player as any).graveyard)) {
      const graveyard = ((player as any).graveyard as any[]).map(card => ({ ...card, zone: 'graveyard', faceDown: false }));
      zones[playerId] = {
        ...(zones[playerId] || {}),
        graveyard,
        graveyardCount: graveyard.length,
      };
      didSyncZones = true;

      if (!originalPlayer || !Object.prototype.hasOwnProperty.call(originalPlayer, 'graveyard')) {
        const { graveyard: _graveyard, ...playerWithoutGraveyard } = nextPlayer;
        nextPlayer = playerWithoutGraveyard;
      }
    }

    return nextPlayer;
  });

  if (!didSyncZones) {
    return state;
  }

  return {
    ...state,
    players,
    zones,
  };
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
