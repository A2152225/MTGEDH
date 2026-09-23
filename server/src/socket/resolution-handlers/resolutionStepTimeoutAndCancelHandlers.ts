/**
 * socket/resolution-handlers/resolutionStepTimeoutAndCancelHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (timeout, cancel side-effects, next-step emit).
 * Cluster moved: clearResolutionStepTimeout, getResolutionStepTimeoutMs,
 * emitNextPendingResolutionStep, applyCancelledResolutionStepSideEffects,
 * handleTimedOutResolutionStep, scheduleResolutionStepTimeoutForGame.
 * Public entry symbols: emitNextPendingResolutionStep, applyCancelledResolutionStepSideEffects,
 * scheduleResolutionStepTimeoutForGame, clearScheduledResolutionStepTimeout.
 * Per-step clocks start on STEP_ADDED so APNAP choices (Kynaios) reset for every
 * player when the effect is queued, and answering one seat does not rewind others.
 *
 * Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import type { GameContext } from "../../state/context.js";
import { counterStackItem } from "../../state/modules/stack-mechanics.js";
import { resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution } from "../../state/modules/oracleIrServerZoneSync.js";
import { resumeEffectProgramResolution } from "../../state/effects/effectProgramResolutionService.js";
import { restoreEffectProgramRuntimeForPendingStep } from "../../state/effects/effectProgramReplayRestore.js";
import {
  ResolutionQueueManager,
  ResolutionStepStatus,
  ResolutionStepType,
  type ResolutionStep,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { isLoopShortcutBroadcastSuppressed } from "../loopShortcutSustain.js";
import { handleDeclinedPlayerSelection } from "../player-selection.js";
import {
  appendGameEvent,
  broadcastGame,
  emitToPlayer,
  ensureGame,
  getPlayerName,
} from "../util.js";
import { buildPendingCastPaymentManaCost } from "./resolutionPendingCastPaymentPrompt.js";
import { priorityResolutionHandlerState } from "./resolutionPriorityHandlerState.js";
import { sanitizeStepForClient } from "./sanitizeStepForClient.js";

const DEFAULT_RESOLUTION_STEP_TIMEOUT_MS = Number(process.env.RESOLUTION_STEP_TIMEOUT_MS ?? 30_000);
const STEP_TIMEOUT_KEY_SEP = '::';
const resolutionStepTimeouts = new Map<string, NodeJS.Timeout>();

function stepTimeoutKey(gameId: string, stepId: string): string {
  return `${gameId}${STEP_TIMEOUT_KEY_SEP}${stepId}`;
}

function isPendingResolutionStep(step: ResolutionStep | undefined): boolean {
  return Boolean(step) && step!.status === ResolutionStepStatus.PENDING;
}

function findPendingResolutionStep(gameId: string, stepId: string): ResolutionStep | undefined {
  const queue = ResolutionQueueManager.getQueue(gameId);
  return (queue?.steps || []).find((step) =>
    String(step?.id || '') === stepId && isPendingResolutionStep(step)
  );
}

function pendingResolutionSteps(gameId: string): ResolutionStep[] {
  const queue = ResolutionQueueManager.getQueue(gameId);
  return (queue?.steps || []).filter((step) => isPendingResolutionStep(step));
}

export function clearScheduledResolutionStepTimeout(gameId: string, stepId?: string): void {
  if (stepId) {
    const key = stepTimeoutKey(gameId, stepId);
    const existingTimeout = resolutionStepTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      resolutionStepTimeouts.delete(key);
    }
    const legacyTimeout = resolutionStepTimeouts.get(gameId);
    if (legacyTimeout) {
      clearTimeout(legacyTimeout);
      resolutionStepTimeouts.delete(gameId);
    }
    return;
  }

  const prefix = `${gameId}${STEP_TIMEOUT_KEY_SEP}`;
  for (const key of [...resolutionStepTimeouts.keys()]) {
    if (key !== gameId && !key.startsWith(prefix)) continue;
    const existingTimeout = resolutionStepTimeouts.get(key);
    if (existingTimeout) clearTimeout(existingTimeout);
    resolutionStepTimeouts.delete(key);
  }
}

function getResolutionStepTimeoutMs(step: ResolutionStep | undefined): number {
  const configuredTimeout = Number((step as any)?.timeoutMs);
  if (Number.isFinite(configuredTimeout) && configuredTimeout > 0) {
    return configuredTimeout;
  }
  return DEFAULT_RESOLUTION_STEP_TIMEOUT_MS;
}

function isSimultaneousChoiceTimeoutAutoComplete(step: ResolutionStep): boolean {
  return (
    step.type === ResolutionStepType.KYNAIOS_CHOICE
    || step.type === ResolutionStepType.JOIN_FORCES
    || step.type === ResolutionStepType.TEMPTING_OFFER
  );
}


// Pending-cast cost metadata + payment prompt field builders
// -> resolution-handlers/resolutionPendingCastPaymentPrompt

/** Presentation + payment fields CastSpellModal / App read from mana_payment_choice steps. */
const MANA_PAYMENT_CLIENT_FIELD_KEYS = [
  'permanentId',
  'cardId',
  'castSpellArgs',
  'cardName',
  'activationPaymentChoice',
  'activationPaymentContext',
  'confirmLabel',
  'wardPayment',
  'wardPaymentType',
  'wardCost',
  'wardPermanentId',
  'wardPermanentName',
  'wardPermanentController',
  'wardTriggeredBy',
  'spellPaymentRequired',
  'graveyardSpellCastManaPayment',
  'phyrexianManaChoice',
  'abilityText',
  'abilityId',
  'effectId',
  'targets',
  'targetsForCast',
  'totalManaCost',
  'manaCost',
  'genericCost',
  'phyrexianChoices',
  'playerLife',
  'imageUrl',
  'costAdjustment',
  'costReduction',
  'convokeOptions',
  'harmonizeOptions',
  'sneakOptions',
  'forcedAlternateCostId',
  'preferredAlternateCostId',
  'oracleText',
  'typeLine',
  'type_line',
  'extraAlternateCosts',
  'fromZone',
  'xValue',
  'castWithoutPayingManaCost',
  'lifeToPayForCost',
  'discardedCardIdsForCost',
  'exiledCardIdsFromHandForCost',
  'exiledCardIdsFromGraveyardForCost',
  'sacrificedPermanentIdsForCost',
  'title',
] as const;


// buildPendingCastPaymentManaCost -> resolution-handlers/resolutionPendingCastPaymentPrompt

export function emitNextPendingResolutionStep(io: Server, gameId: string, playerId: string): void {
  const remainingSteps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as PlayerID);
  if (remainingSteps.length === 0) return;

  try {
    const game = ensureGame(gameId);
    if (isLoopShortcutBroadcastSuppressed(game)) return;
  } catch {
    // best-effort; still emit if game lookup fails
  }

  emitToPlayer(io, playerId, 'resolutionStepPrompt', {
    gameId,
    step: sanitizeStepForClient(gameId, remainingSteps[0]),
  });
}

function restorePriorityAfterResolutionRecovery(game: any, gameId: string): void {
  const summary = ResolutionQueueManager.getPendingSummary(gameId);
  if (summary.hasPending) return;
  if ((game.state as any)?.priority !== null) return;

  const turnPlayer = String((game.state as any)?.turnPlayer || '').trim();
  if (!turnPlayer) return;

  (game.state as any).priority = turnPlayer;
  (game.state as any).priorityPassedBy = new Set<string>();
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

export function applyCancelledResolutionStepSideEffects(
  io: Server,
  game: any,
  gameId: string,
  cancelledStep: ResolutionStep,
  playerId: string,
): string[] {
  const additionallyCancelledStepIds: string[] = [];

  if ((cancelledStep as any)?.effectProgramPrompt === true) {
    restoreEffectProgramRuntimeForPendingStep(game, gameId, cancelledStep);
    resumeEffectProgramResolution({
      game,
      gameId,
      step: cancelledStep,
      response: {
        stepId: String(cancelledStep.id || ''),
        playerId: playerId as PlayerID,
        selections: [],
        cancelled: true,
        timestamp: Date.now(),
      },
      persistPrompt: true,
    });
  }

  const cancelledGroupId = String((cancelledStep as any)?.rulesChoiceGroupId || '').trim();
  if (cancelledGroupId) {
    const remainingGroupSteps = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .filter((queuedStep: any) => queuedStep?.rulesChoiceGroupId === cancelledGroupId);
    for (const remainingStep of remainingGroupSteps) {
      const cancelledGroupStep = ResolutionQueueManager.cancelStep(gameId, remainingStep.id);
      if (cancelledGroupStep) {
        additionallyCancelledStepIds.push(String(cancelledGroupStep.id || ''));
      }
    }
  }

  if (cancelledStep.type === ResolutionStepType.PLAYER_CHOICE) {
    const effectData = (cancelledStep as any)?.effectData;
    if (effectData) {
      const cardName = (cancelledStep as any)?.sourceName || 'Choose Player';
      handleDeclinedPlayerSelection(io, gameId, playerId as PlayerID, cardName, effectData);
    }
  }

  if (cancelledStep.type === ResolutionStepType.TARGET_SELECTION) {
    const effectId =
      (cancelledStep as any)?.spellCastContext?.effectId ||
      (cancelledStep as any)?.sourceId;
    const pending = (game.state as any)?.pendingSpellCasts;
    if (effectId && pending?.[effectId]) {
      delete pending[effectId];
    }

    const cardId = (cancelledStep as any)?.spellCastContext?.cardId;
    const pendingForetell = cardId ? (game.state as any)?.pendingForetellCasts?.[cardId] : undefined;
    if (cardId && pendingForetell && pendingForetell.playerId === playerId) {
      const zones = game.state.zones?.[playerId];
      if (zones) {
        if (Array.isArray((zones as any).hand)) {
          const handIdx = (zones.hand as any[]).findIndex((c: any) => c?.id === cardId);
          if (handIdx !== -1) {
            (zones.hand as any[]).splice(handIdx, 1);
            (zones as any).handCount = (zones.hand as any[]).length;
          }
        }

        (zones as any).exile = Array.isArray((zones as any).exile) ? (zones as any).exile : [];
        ((zones as any).exile as any[]).push({ ...(pendingForetell.originalCard as any), zone: 'exile', faceDown: true, foretold: true });
        (zones as any).exileCount = ((zones as any).exile as any[]).length;
      }

      delete (game.state as any).pendingForetellCasts[cardId];
    }

    if ((cancelledStep as any)?.opponentSelection === true) {
      const opponentSelectionEffectId = String((cancelledStep as any)?.effectId || (cancelledStep as any)?.sourceId || '').trim();
      if (opponentSelectionEffectId) {
        (game.state as any).pendingOpponentSelections = (game.state as any).pendingOpponentSelections || {};
        (game.state as any).pendingOpponentSelections[opponentSelectionEffectId] = {
          selectedOpponentIds: [],
          playerId,
          timestamp: Date.now(),
        };
      }
    }
  }

  // Battlefield ability target selection cancelled: untap any permanents that were tapped as
  // activation costs and emit a cancel chat message.  Mana costs are not refunded (MTG rules:
  // once costs are paid they cannot be taken back), but the ability becomes immediately
  // re-activatable since no stack item was pushed.
  if (cancelledStep.type === ResolutionStepType.TARGET_SELECTION &&
      Boolean((cancelledStep as any)?.battlefieldAbilityTargetSelection)) {
    const tappedForCost = Array.isArray((cancelledStep as any)?.tappedPermanentsForCost)
      ? (cancelledStep as any).tappedPermanentsForCost as string[]
      : [];
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    for (const permId of tappedForCost) {
      const perm = battlefield.find((p: any) => p?.id === permId);
      if (perm && (perm as any).tapped) {
        (perm as any).tapped = false;
      }
    }
    const cardName = String((cancelledStep as any)?.cardName || cancelledStep.sourceName || 'ability');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} cancelled ${cardName} activation (target selection).`,
      ts: Date.now(),
    });
  }

  if ((cancelledStep as any)?.keywordBlight === true && String((cancelledStep as any)?.keywordBlightStage || '') === 'ward_payment') {
    const stackId = String((cancelledStep as any)?.keywordBlightTriggeredBy || (cancelledStep as any)?.sourceId || '');
    if (stackId) {
      const ctx = {
        state: game.state,
        bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
        zones: game.state?.zones,
        gameId,
      } as unknown as GameContext;

      counterStackItem(ctx, stackId, String((cancelledStep as any)?.keywordBlightWardController || 'system'));
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Ward — Blight: ${getPlayerName(game, playerId)} didn't pay ward; the spell/ability was countered.`,
        ts: Date.now(),
      });
    }
  }

  if ((cancelledStep as any)?.oracleIrAnyPlayerMayPaymentSelection === true) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution(ctx, cancelledStep, {
      cancelled: true,
      selections: [],
    });
  }

  restorePriorityAfterResolutionRecovery(game, gameId);
  broadcastGame(io, game, gameId);
  emitNextPendingResolutionStep(io, gameId, playerId);

  return additionallyCancelledStepIds;
}

function handleTimedOutResolutionStep(io: Server, gameId: string, stepId: string, timeoutMs: number): void {
  clearScheduledResolutionStepTimeout(gameId, stepId);

  const game = ensureGame(gameId);
  if (!game) return;

  const timedOutStep = findPendingResolutionStep(gameId, stepId);
  if (!timedOutStep) return;

  if (isSimultaneousChoiceTimeoutAutoComplete(timedOutStep)) {
    debug(
      2,
      `[ResolutionTimeout] Auto-completing timed out ${timedOutStep.type} ${stepId} for ${timedOutStep.playerId} in ${gameId}`,
    );
    void import('../resolution.js').then(async (resolutionModule) => {
      try {
        if (typeof resolutionModule.handleAIResolutionStep === 'function') {
          await resolutionModule.handleAIResolutionStep(io, gameId, timedOutStep, { force: true });
        }
      } catch (err) {
        debugWarn(1, '[ResolutionTimeout] Failed to auto-complete timed out choice step:', err);
      }
    }).catch((err) => {
      debugWarn(1, '[ResolutionTimeout] Failed to load resolution handler for timed out choice:', err);
    });
    return;
  }

  const cancelledStep = ResolutionQueueManager.cancelStep(gameId, stepId);
  if (!cancelledStep) return;

  const playerId = String(cancelledStep.playerId || '').trim();
  const sourceName = String((cancelledStep as any)?.sourceName || (cancelledStep as any)?.sourceId || cancelledStep.description || 'Unknown source').trim();

  emitToPlayer(io, playerId, 'resolutionStepCancelled', {
    gameId,
    stepId,
    success: true,
    reason: 'timeout',
  });

  const additionalCancelledStepIds = applyCancelledResolutionStepSideEffects(io, game, gameId, cancelledStep, playerId);
  const cancelledStepIds = [stepId, ...additionalCancelledStepIds].filter(Boolean);

  appendGameEvent(game, gameId, 'resolutionStepTimeoutRecovery', {
    stepId,
    cancelledStepIds,
    playerId,
    stepType: cancelledStep.type,
    sourceId: cancelledStep.sourceId,
    sourceName: cancelledStep.sourceName,
    description: cancelledStep.description,
    timeoutMs,
  });

  debugWarn(
    1,
    `[ResolutionTimeout] Timed out resolution step ${stepId} (${cancelledStep.type}) from ${sourceName} in game ${gameId}; cancelled prompt and restored priority.`,
  );

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName} timed out during resolution, was marked as broken for this game, and priority was restored.`,
    ts: Date.now(),
  });
}

export function scheduleResolutionStepTimeoutForGame(gameId: string, step?: ResolutionStep): void {
  const io = priorityResolutionHandlerState.io;
  if (!io) return;

  const game = ensureGame(gameId);
  if (!game || !(game.state as any)?.active) return;

  const targets = step ? [step] : pendingResolutionSteps(gameId);
  for (const target of targets) {
    const targetId = String(target?.id || '').trim();
    if (!targetId || !isPendingResolutionStep(target)) continue;

    const key = stepTimeoutKey(gameId, targetId);
    if (!step && resolutionStepTimeouts.has(key)) continue;

    const existingTimeout = resolutionStepTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      resolutionStepTimeouts.delete(key);
    }

    const timeoutMs = getResolutionStepTimeoutMs(target);
    resolutionStepTimeouts.set(
      key,
      setTimeout(() => {
        handleTimedOutResolutionStep(io, gameId, targetId, timeoutMs);
      }, timeoutMs),
    );
  }
}
