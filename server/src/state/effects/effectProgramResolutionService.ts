import type { GameState } from '../../../../shared/src/index.js';
import {
  bindEffectProgramChoiceResponse,
  createEffectProgramRuntime,
  runEffectProgram,
  type EffectProgram,
  type EffectProgramChoicePause,
  type EffectProgramHandlers,
  type EffectProgramRunResult,
  type EffectProgramRuntime,
} from '../../../../rules-engine/src/effectProgram.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import type { ResolutionStep, ResolutionStepResponse } from '../resolution/index.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import {
  appendEffectProgramPromptEvent,
  createEffectProgramChoiceResponse,
  persistEffectProgramChoiceResolutionEvent,
  type EffectProgramQueueExtraConfig,
  queueEffectProgramChoice,
  readEffectProgramQueueMetadata,
} from './effectProgramQueueAdapter.js';
import { restoreEffectProgramRuntimeForPendingStep } from './effectProgramReplayRestore.js';
import {
  isOptionalEffectProgramChoiceStep,
  resolveOptionalAutoChoice,
} from './effectProgramOptionalAutoResolveUtils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import {
  bridgeOracleIrEffectProgramRunEvents,
  maybeEmitDeclinedOptionalAbilityCopyFromEffectProgram,
  maybeEmitPaidOptionalManaFromEffectProgram,
  persistEffectProgramStateMutationsFromRun,
  type EffectProgramOracleIrBridgeConfig,
} from '../modules/oracleIrEffectProgramBridge.js';
import { mirrorGraveyardCastingPermissionsToDurable } from '../modules/graveyard-permissions.js';

interface StoredEffectProgramRuntime {
  readonly runtime: EffectProgramRuntime<GameState>;
  readonly handlers: EffectProgramHandlers<GameState>;
  readonly queueExtraConfig?: EffectProgramQueueExtraConfig;
  readonly oracleIrBridge?: EffectProgramOracleIrBridgeConfig;
}

export interface StartEffectProgramResolutionArgs {
  readonly game: any;
  readonly gameId: string;
  readonly program: EffectProgram;
  readonly handlers?: EffectProgramHandlers<GameState>;
  readonly state?: GameState;
  readonly persistPrompt?: boolean;
  readonly queueExtraConfig?: EffectProgramQueueExtraConfig;
  readonly initialBindings?: Readonly<Record<string, unknown>>;
  readonly oracleIrBridge?: EffectProgramOracleIrBridgeConfig;
}

export interface ResumeEffectProgramResolutionArgs {
  readonly game: any;
  readonly gameId: string;
  readonly step: ResolutionStep;
  readonly response: ResolutionStepResponse;
  readonly persistPrompt?: boolean;
  readonly queuePendingChoices?: boolean;
}

export interface EffectProgramResolutionResult {
  readonly resumed: boolean;
  readonly status: EffectProgramRunResult<GameState>['status'] | 'runtime_not_found' | 'not_effect_program_prompt';
  readonly runResult?: EffectProgramRunResult<GameState>;
  readonly queuedStep?: ResolutionStep;
  readonly reason?: string;
}

const runtimeStore = new Map<string, Map<string, StoredEffectProgramRuntime>>();

function tryAutoResolveOptionalEffectProgramStep(
  game: any,
  gameId: string,
  step: ResolutionStep,
): boolean {
  if ((game as any)?.isReplaying) return false;
  if (!isOptionalEffectProgramChoiceStep(step)) return false;

  const playerId = String(step.playerId || '').trim() as PlayerID;
  if (!playerId) return false;

  const choice = resolveOptionalAutoChoice((game as any).state, playerId, step);
  if (!choice) return false;

  restoreEffectProgramRuntimeForPendingStep(game, gameId, step);

  const response: ResolutionStepResponse = {
    stepId: String(step.id || ''),
    playerId,
    selections: [choice],
    cancelled: false,
    timestamp: Date.now(),
  };

  const completedStep = ResolutionQueueManager.completeStep(gameId, step.id, response);
  if (!completedStep) {
    debugWarn(1, `[EffectProgram] Auto-${choice} could not complete step ${step.id}`);
    return false;
  }

  const resumed = resumeEffectProgramResolution({
    game,
    gameId,
    step: completedStep,
    response,
    persistPrompt: false,
  });

  if (!resumed.resumed) {
    debugWarn(1, `[EffectProgram] Auto-${choice} could not resume step ${step.id}:`, resumed.reason || resumed.status);
    return false;
  }

  void persistEffectProgramChoiceResolutionEvent(game, gameId, completedStep, response, choice);
  debug(2, `[EffectProgram] Auto-${choice} for ${step.sourceName || 'Ability'} (${playerId})`);
  return true;
}

export function startEffectProgramResolution(args: StartEffectProgramResolutionArgs): EffectProgramResolutionResult {
  const runtime = createEffectProgramRuntime({
    program: args.program,
    state: hydrateEffectProgramStateFromGame(args.game, args.state || (args.game as any)?.state),
    bindings: args.initialBindings ?? {},
  });

  return continueEffectProgramResolution({
    game: args.game,
    gameId: args.gameId,
    runtime,
    handlers: args.handlers || {},
    persistPrompt: args.persistPrompt ?? true,
    queueExtraConfig: args.queueExtraConfig,
    oracleIrBridge: args.oracleIrBridge,
    resumed: false,
  });
}

export function resumeEffectProgramResolution(args: ResumeEffectProgramResolutionArgs): EffectProgramResolutionResult {
  const metadata = readEffectProgramQueueMetadata(args.step);
  if (!metadata) {
    return { resumed: false, status: 'not_effect_program_prompt' };
  }

  let stored = getRuntimeForStep(args.gameId, args.step.id);
  if (!stored) {
    restoreEffectProgramRuntimeForPendingStep(args.game, args.gameId, args.step);
    stored = getRuntimeForStep(args.gameId, args.step.id);
  }
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
    queuePendingChoices: args.queuePendingChoices,
    queueExtraConfig: stored.queueExtraConfig,
    oracleIrBridge: stored.oracleIrBridge,
    resumed: true,
    resolvedStepId: String(args.step.id || '').trim() || undefined,
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

export function restoreEffectProgramRuntimeStoreEntry(
  gameId: string,
  stepId: string,
  entry: StoredEffectProgramRuntime,
): void {
  storeRuntimeForStep(gameId, stepId, entry);
}

function buildTeamworkChooseBothQueueExtras(
  pause: EffectProgramChoicePause<any>,
  oracleIrBridge?: EffectProgramOracleIrBridgeConfig,
): EffectProgramQueueExtraConfig {
  if ((oracleIrBridge?.irCtx as any)?.teamworkWasPaid !== true) {
    return {};
  }
  const payload = (pause.choiceEvent as any)?.payload || pause.step?.choiceRequest?.payload;
  const oracleStepKind = String((payload as any)?.oracleStepKind || '');
  const oracleStep = (payload as any)?.oracleStep as any;
  if (oracleStepKind !== 'choose_mode' || !oracleStep?.teamworkChooseBoth) {
    return {};
  }
  const modes = Array.isArray((payload as any)?.modes)
    ? (payload as any).modes
    : Array.isArray(oracleStep?.modes)
      ? oracleStep.modes
      : [];
  const modeCount = modes.length > 0 ? modes.length : 2;
  return {
    maxModes: Math.min(2, modeCount),
    teamworkChooseBoth: true,
    teamworkWasPaid: true,
  };
}

function continueEffectProgramResolution(args: {
  readonly game: any;
  readonly gameId: string;
  readonly runtime: EffectProgramRuntime<GameState>;
  readonly handlers: EffectProgramHandlers<GameState>;
  readonly persistPrompt: boolean;
  readonly queuePendingChoices?: boolean;
  readonly queueExtraConfig?: EffectProgramQueueExtraConfig;
  readonly oracleIrBridge?: EffectProgramOracleIrBridgeConfig;
  readonly resumed: boolean;
  readonly resolvedStepId?: string;
}): EffectProgramResolutionResult {
  const runResult = runEffectProgram(args.runtime, args.handlers);
  applyRunResultState(args.game, runResult);

  if (args.oracleIrBridge) {
    persistEffectProgramStateMutationsFromRun(
      args.game,
      runResult.events,
      args.oracleIrBridge,
    );
    bridgeOracleIrEffectProgramRunEvents(
      args.game,
      (args.game as any).state,
      runResult.events,
      args.oracleIrBridge,
    );
    if (runResult.status === 'completed') {
      maybeEmitPaidOptionalManaFromEffectProgram(
        args.game,
        runResult,
        args.oracleIrBridge,
        args.resolvedStepId,
      );
      maybeEmitDeclinedOptionalAbilityCopyFromEffectProgram(
        args.game,
        runResult,
        runResult.events,
        args.oracleIrBridge,
      );
    }
  }

  if (runResult.status === 'waiting_for_choice' && runResult.pendingChoice) {
    if (args.queuePendingChoices === false) {
      return {
        resumed: args.resumed,
        status: runResult.status,
        runResult,
        reason: 'choice_still_pending_without_queue',
      };
    }

    const teamworkExtras = buildTeamworkChooseBothQueueExtras(runResult.pendingChoice, args.oracleIrBridge);
    const queuedStep = queueEffectProgramChoice(args.gameId, runResult.pendingChoice, {
      ...(args.queueExtraConfig || {}),
      ...teamworkExtras,
    });
    storeRuntimeForStep(args.gameId, queuedStep.id, {
      runtime: runResult.pendingChoice.runtime,
      handlers: args.handlers,
      queueExtraConfig: args.queueExtraConfig,
      oracleIrBridge: args.oracleIrBridge,
    });

    if (tryAutoResolveOptionalEffectProgramStep(args.game, args.gameId, queuedStep)) {
      return {
        resumed: args.resumed,
        status: 'completed',
        runResult,
        reason: 'auto_resolved_optional_choice',
      };
    }

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
  mirrorGraveyardCastingPermissionsToDurable((game as any).state);
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
  let didSyncLife = false;
  const life = { ...(((state as any).life || {}) as Record<string, number>) };

  const players = (state.players || []).map(player => {
    const playerId = String((player as any)?.id || '').trim();
    if (!playerId) {
      return player;
    }

    const originalPlayer = originalPlayers.get(playerId);
    let nextPlayer = player as any;

    if (typeof (player as any).life === 'number') {
      life[playerId] = (player as any).life;
      didSyncLife = true;
    }

    if (Array.isArray((player as any).hand)) {
      const hand = ((player as any).hand as any[]).map(card => ({ ...card, zone: 'hand' }));
      zones[playerId] = {
        ...(zones[playerId] || {}),
        hand,
        handCount: hand.length,
      };
      didSyncZones = true;

      if (!originalPlayer || !Object.prototype.hasOwnProperty.call(originalPlayer, 'hand')) {
        const { hand: _hand, ...playerWithoutHand } = nextPlayer;
        nextPlayer = playerWithoutHand;
      }
    }

    if (Array.isArray((player as any).library)) {
      const library = ((player as any).library as any[]).map(card => ({ ...card, zone: 'library' }));
      (game as any).libraries.set(playerId, library);
      zones[playerId] = {
        ...(zones[playerId] || {}),
        library,
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

  if (!didSyncZones && !didSyncLife) {
    return state;
  }

  return {
    ...state,
    players,
    ...(didSyncLife ? { life } : {}),
    ...(didSyncZones ? { zones } : {}),
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
