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
import { hydrateOracleIRPlayerZonesFromContext } from '../modules/oracleIrServerZoneSync.js';

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

  const storedRuntime = getRuntimeForStep(gameId, String(step.id || ''));
  const choice = resolveOptionalAutoChoice((game as any).state, playerId, step, {
    programSteps: storedRuntime?.runtime?.program?.steps,
  });
  if (!choice) return false;

  restoreEffectProgramRuntimeForPendingStep(game, gameId, step);

  const response: ResolutionStepResponse = {
    stepId: String(step.id || ''),
    playerId,
    selections: [choice],
    cancelled: choice === 'no',
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
    // After server restart EP runtimes may be unrestorable. Declining optional
    // triggered abilities is a no-op (item already left the stack), so treat
    // completeStep alone as success for auto-no.
    if (choice === 'no') {
      debug(2, `[EffectProgram] Auto-no completed without EP resume for ${step.sourceName || 'Ability'} (${playerId})`);
      return true;
    }
    debugWarn(1, `[EffectProgram] Auto-${choice} could not resume step ${step.id}:`, resumed.reason || resumed.status);
    return false;
  }

  void persistEffectProgramChoiceResolutionEvent(game, gameId, completedStep, response, choice);
  debug(2, `[EffectProgram] Auto-${choice} for ${step.sourceName || 'Ability'} (${playerId})`);
  return true;
}

/**
 * Apply Always Yes/No / no-until preferences to optional may prompts already
 * sitting in the resolution queue (e.g. after restart with hundreds of Aura
 * Shards prompts, or Always No clicked while many are pending).
 */
export function drainPendingOptionalAutoChoices(
  game: any,
  gameId: string,
  playerId: string,
): number {
  if ((game as any)?.isReplaying) return 0;
  const normalizedPlayerId = String(playerId || '').trim();
  if (!gameId || !normalizedPlayerId) return 0;

  let drained = 0;
  let guard = 0;

  // Re-scan each pass: completing one step can change queue ordering / prefs (Yes×N).
  while (guard++ < 512) {
    const pending = ResolutionQueueManager.getStepsForPlayer(gameId, normalizedPlayerId as PlayerID)
      .filter((step) => {
        if (!isOptionalEffectProgramChoiceStep(step)) return false;
        const storedRuntime = getRuntimeForStep(gameId, String(step.id || ''));
        return Boolean(resolveOptionalAutoChoice((game as any).state, normalizedPlayerId, step, {
          programSteps: storedRuntime?.runtime?.program?.steps,
        }));
      });

    if (pending.length === 0) break;

    let progressed = false;
    for (const step of pending) {
      // Skip steps that were already completed in this pass.
      if (!ResolutionQueueManager.getStepsForPlayer(gameId, normalizedPlayerId as PlayerID)
        .some((entry) => entry.id === step.id)) {
        continue;
      }
      if (tryAutoResolveOptionalEffectProgramStep(game, gameId, step)) {
        drained += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  if (drained > 0) {
    debug(2, `[EffectProgram] Drained ${drained} pending optional auto-choice step(s) for ${normalizedPlayerId}`);
  }
  return drained;
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

/**
 * Live game fields that can change while an Effect Program prompt is pending
 * (Always Yes/No, trigger shortcuts, auto-pass yields). EP runtimes snapshot
 * state at prompt time; writing that snapshot back would wipe these.
 */
const EFFECT_PROGRAM_PRESERVE_LIVE_STATE_KEYS = [
  'mayAutoPreferences',
  'triggerShortcuts',
  'autoYesOptional',
  'yieldToTriggerSourcesForAutoPass',
] as const;

function mergePreservedLiveEffectProgramState(
  previousState: any,
  nextState: GameState,
): GameState {
  if (!previousState || typeof previousState !== 'object' || !nextState) {
    return nextState;
  }

  let merged: any = nextState;
  for (const key of EFFECT_PROGRAM_PRESERVE_LIVE_STATE_KEYS) {
    if (previousState[key] === undefined) {
      continue;
    }
    if (merged === nextState) {
      merged = { ...(nextState as any) };
    }
    merged[key] = previousState[key];
  }
  return merged as GameState;
}

function applyRunResultState(game: any, runResult: EffectProgramRunResult<GameState>): void {
  if (!game || !runResult.state) {
    return;
  }

  const previousState = (game as any).state;
  const synced = syncEffectProgramStateToGame(game, runResult.state);
  (game as any).state = mergePreservedLiveEffectProgramState(previousState, synced);
  mirrorGraveyardCastingPermissionsToDurable((game as any).state);
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

function hydrateEffectProgramStateFromGame(game: any, state: GameState): GameState {
  if (!game || !state || !Array.isArray((state as any).players)) {
    return state;
  }

  // Player objects often keep stale empty hand/graveyard/exile arrays while the
  // authoritative copies live on state.zones / game.libraries. Copy those onto
  // players before Effect Program runs — otherwise syncEffectProgramStateToGame
  // overwrites zones.graveyard with player.graveyard=[] and cards vanish live.
  const nextState: GameState = {
    ...state,
    players: (state.players || []).map((player) => ({ ...player })) as any,
    zones: { ...((state as any).zones || {}) },
  };

  try {
    hydrateOracleIRPlayerZonesFromContext(game, nextState);
  } catch (err) {
    debugWarn(1, '[EffectProgram] Failed to hydrate player zones from game context:', err);
    return state;
  }

  return nextState;
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
