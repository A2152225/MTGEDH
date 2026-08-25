/**
 * socket/resolution-handlers/mayAbilityAndOptionalTriggerHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse / handleOptionChoiceResponse).
 * Cluster moved: handleMayAbilityResponse, optional-triggered-ability choice resume,
 * auto-decline drain helpers, and extractFirstResolutionSelectionId.
 * Public entry symbols: handleMayAbilityResponse, handleOptionalTriggeredAbilityChoiceResponse,
 * isOptionalTriggeredEffectProgramStep, maybeDrainAutoDeclinedOptionalStackAfterDecline,
 * extractFirstResolutionSelectionId.
 *
 * Wired through resolutionHandlerDeps for the two step handlers. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { parseNoUntilTargetsChangeFingerprint } from "../../../../shared/src/mayAutoPreference.js";
import { buildOptionalEffectKey, findMayAutoPreferenceEntry } from "../../../../shared/src/optionalEffectKey.js";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import {
  drainPendingOptionalAutoChoices,
  persistEffectProgramChoiceResolutionEvent,
  readEffectProgramQueueMetadata,
} from "../../state/effects/index.js";
import { applyGraveyardPermissionEffectsFromText } from "../../state/modules/graveyard-permissions.js";
import { wouldAutoDeclineOptionalTriggeredAbility } from "../../state/modules/stackResolveTriggeredAbilityOptionalUtils.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { clearMayCallback, consumeMayCallback } from "../may-ability-prompts.js";
import { getSavedMayAbilityTriggerDecision } from "../trigger-shortcuts.js";
import { broadcastGame, persistAndResolveTopOfStack } from "../util.js";

export async function handleMayAbilityResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const stepAny = step as any;
  const callbackId: string = stepAny.pendingCallbackId ?? '';
  const effectText: string = stepAny.effectText || 'effect';
  const sourceName: string = step.sourceName || 'Ability';
  const choiceId = extractFirstResolutionSelectionId(response.selections) || (response.cancelled ? 'no' : 'yes');
  const accepted = !response.cancelled && choiceId !== 'no';

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'mayAbilityResolve', {
      playerId: pid,
      sourceId: String(stepAny?.sourceId || step.sourceId || '').trim() || undefined,
      sourceName,
      resolvedStepId: String((step as any)?.id || '').trim() || undefined,
      choice: accepted ? 'yes' : 'no',
      accepted,
      effectText,
      fullAbilityText: stepAny.fullAbilityText,
      effectKey: stepAny.effectKey,
      callbackId: callbackId || undefined,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(mayAbilityResolve) failed:', err);
  }

  const callbackEntry = consumeMayCallback(gameId, callbackId);

  // If cancelled == true the player said "No"
  if (!accepted) {
    if (callbackEntry?.onDecline) {
      try {
        await callbackEntry.onDecline();
      } catch (err) {
        debugError(1, `[May] Decline callback error for "${effectText}":`, err);
      }
    } else if (callbackId) {
      clearMayCallback(gameId, callbackId);
    }
    debug(2, `[May] ${pid} declined "${effectText}" for ${sourceName}`);
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    broadcastGame(io, game, gameId);
    return;
  }

  // Player said "Yes" — execute the callback
  if (callbackEntry?.onAccept) {
    try {
      await callbackEntry.onAccept();
      debug(2, `[May] ${pid} accepted "${effectText}" for ${sourceName} — executed`);
    } catch (err) {
      debugError(1, `[May] Callback error for "${effectText}":`, err);
    }
  } else {
    debug(2, `[May] No callback found for callbackId "${callbackId}" — may have already executed`);
  }

  // Broadcast updated game state
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

export function isOptionalTriggeredEffectProgramStep(step: ResolutionStep): boolean {
  const metadata = readEffectProgramQueueMetadata(step);
  return (
    metadata?.effectProgramFamily === 'optional_triggered_ability' ||
    String((step as any)?.effectProgramFamily || '').trim() === 'optional_triggered_ability'
  );
}

function playerHasAutoDeclineMayPreference(
  state: any,
  playerId: string,
  sourceName: string,
  effectText: string,
): boolean {
  if (getSavedMayAbilityTriggerDecision(state, playerId, sourceName) === 'no') {
    return true;
  }
  const effectKey = buildOptionalEffectKey(sourceName, effectText);
  const entry = findMayAutoPreferenceEntry(state?.mayAutoPreferences?.[playerId], effectKey);
  if (!entry) return false;
  if (entry.value === 'no') return true;
  return parseNoUntilTargetsChangeFingerprint(entry.value) !== undefined;
}

/**
 * After declining an optional may (Always No / no-until), drain matching
 * pending resolution-queue prompts and consecutive auto-declinable stack tops.
 */
export function maybeDrainAutoDeclinedOptionalStackAfterDecline(
  game: any,
  gameId: string,
  playerId: string,
  sourceName: string,
  step: ResolutionStep,
): void {
  const state = game?.state as any;
  if (!state) return;

  const stepData = step as any;
  const effectText = String(
    stepData?.effectText
    || stepData?.fullAbilityText
    || step.description
    || ''
  ).trim();

  if (!playerHasAutoDeclineMayPreference(state, playerId, sourceName, effectText)) {
    return;
  }

  drainPendingOptionalAutoChoices(game, gameId, playerId);

  const stack = Array.isArray(state.stack) ? state.stack : [];
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  if (!top || !wouldAutoDeclineOptionalTriggeredAbility(state, top)) {
    return;
  }

  persistAndResolveTopOfStack(game, gameId, {
    playerId,
    sourceName,
    reason: 'optionalTriggeredAbilityAutoDeclineDrain',
  });
}

export async function handleOptionalTriggeredAbilityChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  void io;

  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;
  const choiceId = extractFirstResolutionSelectionId(selectedOption) || (response.cancelled ? 'no' : null) || 'no';
  const shouldResolve = !response.cancelled && choiceId === 'yes';
  const deferredTriggeredAbilityItem = stepData?.deferredTriggeredAbilityItem;
  const sourceName = String(stepData?.sourceName || step.sourceName || 'Ability');
  const effectProgramMetadata = readEffectProgramQueueMetadata(step);

  await persistEffectProgramChoiceResolutionEvent(
    game,
    gameId,
    step,
    response,
    shouldResolve ? 'yes' : 'no',
  );

  if (!shouldResolve) {
    debug(2, `[Resolution] Declined deferred optional triggered ability for ${sourceName}`);
    // Always No / no-until / shortcut-no: drain remaining auto-declinable tops
    // without requiring Resolve All / pass priority for each skipped trigger.
    maybeDrainAutoDeclinedOptionalStackAfterDecline(game, gameId, playerId, sourceName, step);
    return;
  }

  if (!deferredTriggeredAbilityItem || typeof deferredTriggeredAbilityItem !== 'object') {
    debugWarn(1, `[Resolution] Missing deferred trigger payload for ${sourceName}`);
    return;
  }

  const directEffectText = String(
    stepData?.effectText
    || (deferredTriggeredAbilityItem as any)?.effect
    || stepData?.fullAbilityText
    || (deferredTriggeredAbilityItem as any)?.description
    || ''
  ).trim();
  const directlyApplied = applyGraveyardPermissionEffectsFromText(
    game as GameContext,
    playerId as PlayerID,
    sourceName,
    directEffectText,
    deferredTriggeredAbilityItem,
  );
  if (directlyApplied > 0) {
    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }
    debug(2, `[Resolution] Applied deferred optional graveyard permission effect directly for ${sourceName}`);
    return;
  }

  game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
  game.state.stack.push({
    ...(deferredTriggeredAbilityItem as any),
    optionalTriggeredAbilityDecisionApplied: true,
  });

  if (persistAndResolveTopOfStack(game, gameId, {
    playerId,
    sourceName,
    reason: 'optionalTriggeredAbilityAccept',
  })) {
    debug(2, `[Resolution] Resolved deferred optional triggered ability for ${sourceName}`);
  } else {
    debugWarn(1, `[Resolution] Game missing resolveTopOfStack while handling ${sourceName}`);
  }
}

export function extractFirstResolutionSelectionId(selection: any): string | null {
  if (typeof selection === 'string') return selection;
  if (Array.isArray(selection) && selection.length > 0) {
    return typeof selection[0] === 'string' ? selection[0] : (selection[0] as any)?.id || null;
  }
  if (selection && typeof selection === 'object') return (selection as any).id || (selection as any).value || null;
  return null;
}

