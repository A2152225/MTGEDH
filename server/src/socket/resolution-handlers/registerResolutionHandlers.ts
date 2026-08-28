/**
 * socket/resolution-handlers/registerResolutionHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts.
 * Cluster moved: registerResolutionHandlers (socket.on query/submit/cancel/preference/disconnect).
 * Public entry symbols: registerResolutionHandlers.
 *
 * Parent re-exports this symbol. Must not import resolution.ts.
 */

import type { Server, Socket } from "socket.io";
import {
  buildNoUntilTargetsChangeValue,
  fingerprintArtifactEnchantmentTargets,
  NO_UNTIL_TARGETS_CHANGE_REQUEST,
  parseNoUntilTargetsChangeFingerprint,
} from "../../../../shared/src/mayAutoPreference.js";
import { appendEvent } from "../../db/index.js";
import { drainPendingOptionalAutoChoices, restoreAllPendingEffectProgramRuntimes, restoreEffectProgramRuntimeForPendingStep } from "../../state/effects/index.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../../state/modules/oracleIrDeferredStackFinalize.js";
import { wouldAutoDeclineOptionalTriggeredAbility } from "../../state/modules/stackResolveTriggeredAbilityOptionalUtils.js";
import {
  ResolutionQueueEvent,
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { inferResolutionStepMandatory } from "../../state/resolution/mandatoryInference.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { isLoopShortcutBroadcastSuppressed } from "../loopShortcutSustain.js";
import { tryAutoStartGameFromPreGame } from "../pregame-auto-start.js";
import { validateActivationCostStepsBeforeComplete } from "../resolutionRegisterPreCompleteValidationForActivationCostSteps.js";
import { validateChoicePromptStepsBeforeComplete } from "../resolutionRegisterPreCompleteValidationForChoicePromptSteps.js";
import { validateCostPaymentStepsBeforeComplete } from "../resolutionRegisterPreCompleteValidationForCostPaymentSteps.js";
import { validateExtractedStepTypesBeforeComplete } from "../resolutionRegisterPreCompleteValidationForExtractedSteps.js";
import { validateFaceDownAndKeywordStepsBeforeComplete } from "../resolutionRegisterPreCompleteValidationForFaceDownAndKeywordSteps.js";
import { validateManaPaymentChoiceStepBeforeComplete, validateTapCostExtortAndExploitStepsBeforeComplete } from "../resolutionRegisterPreCompleteValidationForManaAndSacrificeSteps.js";
import { validateModeTriggerAndOpeningHandStepsBeforeComplete } from "../resolutionRegisterPreCompleteValidationForModeAndTriggerSteps.js";
import { validateOptionChoicePayCostPromptsBeforeComplete, validateOptionChoiceSelectionShapeBeforeComplete } from "../resolutionRegisterPreCompleteValidationForOptionChoiceSteps.js";
import { validateManaColorSelectionBeforeComplete, validateStepResponseClusterStepsBeforeComplete } from "../resolutionRegisterPreCompleteValidationForStepResponseClusters.js";
import { validateTargetSelectionStepsBeforeComplete } from "../resolutionRegisterPreCompleteValidationForTargetSelectionSteps.js";
import { validateGraveyardSelectionBeforeComplete, validateHandSelectionStepsBeforeComplete, validateLibrarySearchBeforeComplete } from "../resolutionRegisterPreCompleteValidationForZoneSelectionSteps.js";
import {
  processPendingBottomOrder,
  processPendingCascades,
  processPendingDanceWithCalamity,
  processPendingLimDulsVault,
  processPendingOracleIrCompoundResume,
  processPendingPonder,
  processPendingScry,
  processPendingSurveil,
} from "../resolutionProcessPendingHandlers.js";
import {
  broadcastGame,
  clearHumanAutoPassPauseOnAction,
  emitToPlayer,
  ensureGame,
  persistAndResolveTopOfStack,
} from "../util.js";
import { processAttackCostPaymentBeforeStepComplete } from "./attackCostPaymentBeforeCompleteHandlers.js";
import { processBlockCostPaymentBeforeStepComplete } from "./blockCostPaymentBeforeCompleteHandlers.js";
import { emitResolutionStepPrompt } from "./emitResolutionStepPrompt.js";
import { handlePanglacialWurmSearchCast } from "./panglacialSearchCastHandlers.js";
import { getPanglacialCastCardId } from "./panglacialSearchCastUtils.js";
import { priorityResolutionHandlerState } from "./resolutionPriorityHandlerState.js";
import { applyCancelledResolutionStepSideEffects, emitNextPendingResolutionStep, scheduleResolutionStepTimeoutForGame } from "./resolutionStepTimeoutAndCancelHandlers.js";
import { sanitizeStepForClient } from "./sanitizeStepForClient.js";
import { handleStepResponse } from "./stepResponseHandlers.js";

/**
 * Register Resolution System socket handlers
 */
export function registerResolutionHandlers(io: Server, socket: Socket) {
  
  // =========================================================================
  // Query handlers - Get information about pending steps
  // =========================================================================
  
  /**
   * Get the next resolution step for the current player
   */
  socket.on("getMyNextResolutionStep", async (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);

    if (!gameId || typeof gameId !== 'string') {
      socket.emit("noResolutionStep", { gameId });
      return;
    }
    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      // Do not emit noResolutionStep here — clients treat that as "dismiss choice UI",
      // which races reconnect and closes pending payment/choice modals.
      return;
    }

    if (!pid || socketIsSpectator) {
      socket.emit("noResolutionStep", { gameId });
      return;
    }

    try {
      const game = ensureGame(gameId);
      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
      if (!seated || seated.isSpectator || seated.spectator) {
        socket.emit("noResolutionStep", { gameId });
        return;
      }
    } catch {
      socket.emit("noResolutionStep", { gameId });
      return;
    }
    
    try {
      const game = ensureGame(gameId);
      if (game) {
        restoreAllPendingEffectProgramRuntimes(game, gameId);
        await processPendingCascades(io, game, gameId);
        processPendingScry(io, game, gameId);
        processPendingSurveil(io, game, gameId);
        processPendingPonder(io, game, gameId);
        processPendingBottomOrder(io, game, gameId);
        processPendingLimDulsVault(io, game, gameId);
        processPendingDanceWithCalamity(io, game, gameId);
        processPendingOracleIrCompoundResume(io, game, gameId);
      }
    } catch {
      // best-effort only
    }

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, pid);
    const nextStep = steps.length > 0 ? steps[0] : undefined;
    
    if (nextStep) {
      emitResolutionStepPrompt(socket, gameId, nextStep);
    } else {
      socket.emit("noResolutionStep", { gameId });
    }
  });
  
  // =========================================================================
  // Action handlers - Respond to resolution steps
  // =========================================================================
  
  /**
   * Submit a response to a resolution step
   */
  socket.on("submitResolutionResponse", async (payload?: {
    gameId?: unknown;
    stepId?: unknown;
    selections?: unknown;
    cancelled?: unknown;
    splitAssignments?: unknown;
    moveTo?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const stepId = payload?.stepId;
    const selections = payload?.selections;
    const cancelled = payload?.cancelled === true;
    const splitAssignments = payload?.splitAssignments;
    const moveTo = payload?.moveTo;

    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (!pid || socketIsSpectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized to respond" });
      return;
    }

    if (!gameId || typeof gameId !== 'string') return;
    if (!stepId || typeof stepId !== 'string') {
      socket.emit("error", { code: "STEP_NOT_FOUND", message: "Resolution step not found" });
      return;
    }
    if (!(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }
    if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }
    
    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }

    const players = (game.state as any)?.players;
    const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
    if (!seated || seated.isSpectator || seated.spectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized to respond" });
      return;
    }
    
    // Verify the step exists and belongs to this player
    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find(s => s.id === stepId);
    
    if (!step) {
      socket.emit("error", { code: "STEP_NOT_FOUND", message: "Resolution step not found" });
      return;
    }
    
    if (step.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_STEP", message: "This is not your resolution step" });
      return;
    }

    // Prevent out-of-order/stale completion within a player's own pending steps.
    // Only allow responding to the next pending step for this player.
    const myPendingSteps = ResolutionQueueManager.getStepsForPlayer(gameId, pid as any);
    const myNextStep = myPendingSteps.length > 0 ? myPendingSteps[0] : undefined;
    if (!myNextStep || myNextStep.id !== stepId) {
      socket.emit("error", { code: "STEP_OUT_OF_ORDER", message: "This is not your next pending resolution step" });
      return;
    }

    // Disallow cancelling mandatory steps via submitResolutionResponse.
    // Allow the queue-native spell/ability payment variants through because the live client
    // submits cancelled=true for those flows instead of using cancelResolutionStep.
    const isCancellableMandatoryStep =
      (step.type === ResolutionStepType.TARGET_SELECTION &&
        Boolean((step as any)?.spellCastContext?.effectId)) ||
      (step.type === ResolutionStepType.TARGET_SELECTION &&
        Boolean((step as any)?.battlefieldAbilityTargetSelection)) ||
      (step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (
        (step as any)?.spellPaymentRequired === true ||
        (step as any)?.activationPaymentChoice === true ||
        (step as any)?.wardPayment === true ||
        (step as any)?.phyrexianManaChoice === true ||
        (step as any)?.sacrificeUnlessPayChoice === true
      )) ||
      step.type === ResolutionStepType.EXTORT_PAYMENT;

    if (cancelled && step.mandatory && !isCancellableMandatoryStep) {
      socket.emit("error", { code: "STEP_MANDATORY", message: "This step is mandatory and cannot be cancelled" });
      return;
    }
    
    // Create the response
    const response: ResolutionStepResponse = {
      stepId,
      playerId: pid,
      selections: selections as readonly string[] | number | boolean | Record<string, any>,
      cancelled,
      timestamp: Date.now(),
    };

    clearHumanAutoPassPauseOnAction(game as any, pid, 'submitResolutionResponse');

    // Library search supports split destination (Cultivate/Kodama's Reach). These extra fields are passed
    // alongside selections from the client and must be preserved for the step handler.
    (response as any).splitAssignments = splitAssignments;
    (response as any).moveTo = moveTo;

    const panglacialCardId =
      step.type === ResolutionStepType.LIBRARY_SEARCH && !cancelled
        ? getPanglacialCastCardId(response.selections)
        : undefined;
    if (panglacialCardId) {
      await handlePanglacialWurmSearchCast(io, socket, game, gameId, step, pid, panglacialCardId);
      return;
    }

    // Validate TARGET_SELECTION and MUTATE_TARGET_SELECTION before completing the step
    // (prevents permanently completing on invalid input).
    if (!validateTargetSelectionStepsBeforeComplete({ socket, step, response, cancelled, game, pid, gameId, stepId })) {
      return;
    }

    // Validate DISCARD_SELECTION and HAND_TO_BOTTOM (London mulligan) before completing the step.
    // If we complete the step first, invalid input would permanently consume the step and desync
    // hand state / the mulligan flow.
    if (!validateHandSelectionStepsBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }

    if (!validateManaColorSelectionBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }

    // Validate GRAVEYARD_SELECTION before completing the step.
    // If we complete first, invalid input would permanently consume the step and desync graveyard/zone changes.
    if (step.type === ResolutionStepType.GRAVEYARD_SELECTION && !cancelled) {
      if (!(await validateGraveyardSelectionBeforeComplete({ socket, step, response, cancelled, game, pid }))) {
        return;
      }
    }

    // Validate LIBRARY_SEARCH before completing the step.
    // If we complete first, invalid selections (or invalid split assignments) would permanently consume the step.
    if (step.type === ResolutionStepType.LIBRARY_SEARCH) {
      if (!validateLibrarySearchBeforeComplete({ socket, step, response, cancelled, game, pid })) {
        return;
      }
    }

    // Validate LIFE_PAYMENT / ADDITIONAL_COST_PAYMENT / SQUAD_COST_PAYMENT before completing the
    // step; invalid input would otherwise consume it and allow partial or incorrect cost payment.
    if (!validateCostPaymentStepsBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }

    // Validate phyrexian / activation / spell-cast MANA_PAYMENT_CHOICE before completing the step.
    // If we complete first, malformed input would permanently consume the step.
    if (step.type === ResolutionStepType.MANA_PAYMENT_CHOICE) {
      if (!(await validateManaPaymentChoiceStepBeforeComplete({ socket, step, response, cancelled, game, pid }))) {
        return;
      }
    }

    // Tap-creatures-as-cost (Summon the School style), EXTORT_PAYMENT and EXPLOIT_CHOICE:
    // validate before consuming the step.
    if (!validateTapCostExtortAndExploitStepsBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }

    // Validate OPTION_CHOICE selections before completing the step.
    // If we complete first, invalid input would permanently consume the step and desync choice-driven flows.
    if (!validateOptionChoiceSelectionShapeBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }

    // Validate OPTION_CHOICE pay-cost prompts before completing the step.
    // If we complete first, handlers may treat insufficient resources as decline/counter/sacrifice,
    // permanently consuming the step and forcing unintended outcomes.
    if (step.type === ResolutionStepType.OPTION_CHOICE && !cancelled) {
      if (!(await validateOptionChoicePayCostPromptsBeforeComplete({ socket, step, response, cancelled, game, pid }))) {
        return;
      }
    }

        if (!validateExtractedStepTypesBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }

    // Validate MODE_SELECTION / TRIGGER_ORDER / OPENING_HAND_ACTIONS selections before completing
    // the step; invalid input would otherwise permanently consume it.
    if (!validateModeTriggerAndOpeningHandStepsBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }

    if (!validateStepResponseClusterStepsBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }

    // Validate the single-answer choice prompts (X value, Kynaios, hideaway, devour, ...)
    // before completing the step; the handlers can early-return and would consume the step.
    if (!validateChoicePromptStepsBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }


    // Validate activation-cost mana/life before completing the step.
    // If we complete first, we could consume a cost-step and then fail due to insufficient mana,
    // leaving the game in a partial-cost state.
    if (!(await validateActivationCostStepsBeforeComplete({ socket, step, response, cancelled, game, pid }))) {
      return;
    }

    // SUSPEND_CAST / MORPH_TURN_FACE_UP / keyword choice steps / ACTIVATED_ABILITY: reject stale or
    // malformed input before the step is consumed.
    if (!validateFaceDownAndKeywordStepsBeforeComplete({ socket, step, response, cancelled, game, pid })) {
      return;
    }
    
    // Complete the step
    if ((step as any)?.effectProgramPrompt === true) {
      restoreEffectProgramRuntimeForPendingStep(game, gameId, step);
    }

    if (
      step.type === ResolutionStepType.OPTION_CHOICE &&
      (step as any)?.attackCostPayment === true
    ) {
      const attackCostResult = await processAttackCostPaymentBeforeStepComplete(
        io,
        game,
        gameId,
        step,
        response,
        socket,
      );
      if (attackCostResult === 'abort') {
        broadcastGame(io, game, gameId);
        return;
      }
    }

    if (
      step.type === ResolutionStepType.OPTION_CHOICE &&
      (step as any)?.blockCostPayment === true
    ) {
      const blockCostResult = await processBlockCostPaymentBeforeStepComplete(
        io,
        game,
        gameId,
        step,
        response,
        socket,
      );
      if (blockCostResult === 'abort') {
        broadcastGame(io, game, gameId);
        return;
      }
    }

    const completedStep = ResolutionQueueManager.completeStep(gameId, stepId, response);
    
    if (completedStep) {
      // Emit confirmation to the player
      socket.emit("resolutionStepCompleted", {
        gameId,
        stepId,
        success: true,
      });
      
      // Log the action
      debug(2, `[Resolution] Step ${stepId} completed by ${pid}: ${completedStep.type}`);
      
      // Handle the response based on step type
      await handleStepResponse(io, game, gameId, completedStep, response);

      // Finish any IR spell whose finalize (stack pop + graveyard move) was deferred
      // while its resolution choices were pending. No-op unless the queue is empty
      // and the top of the stack carries oracleIrDeferredFinalize.
      maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);

      // Broadcast updated game state
      broadcastGame(io, game, gameId);

      if (
        completedStep.type === ResolutionStepType.OPENING_HAND_ACTIONS ||
        completedStep.type === ResolutionStepType.HAND_TO_BOTTOM
      ) {
        await tryAutoStartGameFromPreGame(
          io,
          game,
          gameId,
          `resolution:${completedStep.type}`
        );
      }
      
      // Re-prompt every player who still owns a pending step. A completed choice can
      // reveal a step for a different player, and relying only on the original STEP_ADDED
      // emit can leave that owner with no visible UI if the prompt raced a state update.
      const pendingByPlayer = ResolutionQueueManager.getPendingSummary(gameId).pendingByPlayer;
      for (const pendingPlayerId of Object.keys(pendingByPlayer)) {
        emitNextPendingResolutionStep(io, gameId, String(pendingPlayerId));
      }

      const remainingQueueSteps = ResolutionQueueManager.getQueue(gameId).steps;
      if (remainingQueueSteps.length > 0) {
        debug(2, '[Resolution] Pending steps after completion:', remainingQueueSteps.map((queuedStep: any) => ({
          id: queuedStep?.id,
          type: queuedStep?.type,
          playerId: queuedStep?.playerId,
          sourceName: queuedStep?.sourceName,
          description: queuedStep?.description,
        })));
      }
    } else {
      socket.emit("error", { code: "STEP_COMPLETION_FAILED", message: "Failed to complete resolution step" });
    }
  });
  
  /**
   * Cancel/decline a resolution step (for non-mandatory steps)
   */
  socket.on(
    "cancelResolutionStep",
    (payload?: { gameId?: unknown; stepId?: unknown }) => {
      const gameId = payload?.gameId;
      const stepId = payload?.stepId;
    const pid = socket.data.playerId as string | undefined;
    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (!pid || socketIsSpectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized" });
      return;
    }

    if (!gameId || typeof gameId !== 'string') return;
    if (!stepId || typeof stepId !== 'string') {
      socket.emit("error", { code: "STEP_NOT_FOUND", message: "Resolution step not found" });
      return;
    }
    if (!(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }
    if ((socket.data as any)?.gameId && (socket.data as any).gameId !== gameId) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }

    try {
      const game = ensureGame(gameId);
      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
      if (!seated || seated.isSpectator || seated.spectator) {
        socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized" });
        return;
      }
    } catch {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find(s => s.id === stepId);
    
    if (!step) {
      socket.emit("error", { code: "STEP_NOT_FOUND", message: "Resolution step not found" });
      return;
    }
    
    if (step.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_STEP", message: "This is not your resolution step" });
      return;
    }

    // Prevent out-of-order/stale cancellation within a player's own pending steps.
    const myPendingSteps = ResolutionQueueManager.getStepsForPlayer(gameId, pid as any);
    const myNextStep = myPendingSteps.length > 0 ? myPendingSteps[0] : undefined;
    if (!myNextStep || myNextStep.id !== stepId) {
      socket.emit("error", { code: "STEP_OUT_OF_ORDER", message: "This is not your next pending resolution step" });
      return;
    }

    // Some mandatory steps represent an in-progress player-initiated action (e.g. spell cast target selection)
    // and must be cancellable to avoid leaving the game in resolution mode.
    const isCancellableMandatoryStep =
      (step.type === ResolutionStepType.TARGET_SELECTION &&
        Boolean((step as any)?.spellCastContext?.effectId)) ||
      // Activated-ability target selection — player initiated the activation and should be able
      // to back out before committing to a target.  Any activation costs already paid are
      // refunded (tap cost untapped; mana is forfeit per MTG rules but the ability itself is
      // available for re-activation immediately after cancel).
      (step.type === ResolutionStepType.TARGET_SELECTION &&
        Boolean((step as any)?.battlefieldAbilityTargetSelection)) ||
      step.type === ResolutionStepType.STATION_CREATURE_SELECTION;

    if (inferResolutionStepMandatory(step as any) && !isCancellableMandatoryStep) {
      socket.emit("error", { code: "STEP_MANDATORY", message: "This step is mandatory and cannot be cancelled" });
      return;
    }
    
    // Cancel the step
    const cancelledStep = ResolutionQueueManager.cancelStep(gameId, stepId);
    
    if (cancelledStep) {
      socket.emit("resolutionStepCancelled", {
        gameId,
        stepId,
        success: true,
      });
      
      debug(2, `[Resolution] Step ${stepId} cancelled by ${pid}: ${cancelledStep.type}`);
      
      const game = ensureGame(gameId);
      if (game) {
        applyCancelledResolutionStepSideEffects(io, game, gameId, cancelledStep, pid);
      }
    }
    }
  );
  
  // =========================================================================
  // Set up event forwarding from ResolutionQueueManager to Socket.IO
  // =========================================================================
  
  // This is done once per connection, forwarding queue events to the client
  const queueEventHandler = (
    event: ResolutionQueueEvent,
    eventGameId: string,
    step?: ResolutionStep,
    response?: ResolutionStepResponse
  ) => {
    // Only forward events for games this socket is in
    if (!socket.rooms.has(eventGameId)) return;
    
    switch (event) {
      case ResolutionQueueEvent.STEP_ADDED:
        if (step && step.playerId === socket.data.playerId) {
          // Only prompt if this is the player's next pending step.
          // (Avoid prompting multiple steps when a flow enqueues MODE_SELECTION + TARGET_SELECTION, etc.)
          try {
            const game = ensureGame(eventGameId);
            if (isLoopShortcutBroadcastSuppressed(game)) {
              break;
            }
          } catch {
            // continue to emit if lookup fails
          }
          const pid = socket.data.playerId as any;
          const steps = ResolutionQueueManager.getStepsForPlayer(eventGameId, pid);
          const nextStep = steps.length > 0 ? steps[0] : undefined;

          if (nextStep && nextStep.id === step.id) {
            socket.emit("resolutionStepPrompt", {
              gameId: eventGameId,
              step: sanitizeStepForClient(eventGameId, step),
            });
          }
        }
        break;

      case ResolutionQueueEvent.STEP_CANCELLED:
        if (step && step.playerId === socket.data.playerId) {
          socket.emit("resolutionStepCancelled", {
            gameId: eventGameId,
            stepId: step.id,
          });
        }
        break;
        
      case ResolutionQueueEvent.QUEUE_CHANGED:
        // Notify client queue has changed (for UI updates)
        const summary = ResolutionQueueManager.getPendingSummary(eventGameId);
        const queuePid = socket.data.playerId as any;
        const myPendingSteps = queuePid
          ? ResolutionQueueManager.getStepsForPlayer(eventGameId, queuePid)
          : [];
        socket.emit("resolutionQueueChanged", {
          gameId: eventGameId,
          hasPending: summary.hasPending,
          pendingCount: summary.pendingCount,
          pendingTypes: summary.pendingTypes,
          myPendingCount: myPendingSteps.length,
          myNextStepId: myPendingSteps[0]?.id,
        });
        break;
    }
  };
  
  // Register the event handler
  ResolutionQueueManager.on(queueEventHandler);

  // =========================================================================
  // "You may" auto-preference management
  // =========================================================================

  /**
   * Store or clear a player's automatic yes/no preference for a specific
   * "you may" effect.  The effectKey is "{sourceName_lower}:{effectText_lower}".
   * Passing value=null removes an existing preference.
   * value='no_until_targets_change' snapshots current legal artifact/enchantment
   * targets and auto-skips until that set changes.
   */
  socket.on("setMayAutoPreference", (payload?: {
    gameId?: unknown;
    effectKey?: unknown;
    value?: unknown;
  }) => {
    const gameId = payload?.gameId;
    const pid = socket.data.playerId as string | undefined;
    if (!gameId || typeof gameId !== 'string' || !pid) return;
    if (!(socket as any)?.rooms?.has?.(gameId)) return;

    const effectKey = payload?.effectKey;
    const value = payload?.value;
    if (!effectKey || typeof effectKey !== 'string') return;
    const isValidCount = typeof value === 'number' && Number.isInteger(value) && value > 0;
    const isNoUntilRequest = value === NO_UNTIL_TARGETS_CHANGE_REQUEST;
    const isNoUntilStored = typeof value === 'string'
      && parseNoUntilTargetsChangeFingerprint(value) !== undefined;
    if (
      value !== 'yes'
      && value !== 'no'
      && value !== null
      && !isValidCount
      && !isNoUntilRequest
      && !isNoUntilStored
    ) {
      return;
    }

    let game: any;
    try { game = ensureGame(gameId); } catch { return; }
    if (!game) return;

    const state = game.state as any;
    if (!state.mayAutoPreferences) state.mayAutoPreferences = {};
    if (!state.mayAutoPreferences[pid]) state.mayAutoPreferences[pid] = {};

    if (value === null) {
      delete state.mayAutoPreferences[pid][effectKey];
      debug(2, `[May] ${pid} cleared auto-pref for "${effectKey}"`);
    } else if (isNoUntilRequest) {
      const fingerprint = fingerprintArtifactEnchantmentTargets(state.battlefield);
      const stored = buildNoUntilTargetsChangeValue(fingerprint);
      state.mayAutoPreferences[pid][effectKey] = stored;
      debug(2, `[May] ${pid} set auto-pref "${effectKey}" = ${stored}`);
    } else {
      state.mayAutoPreferences[pid][effectKey] = value as 'yes' | 'no' | number | string;
      debug(2, `[May] ${pid} set auto-pref "${effectKey}" = ${value}`);
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'mayAutoPreferenceSet', {
        playerId: pid,
        effectKey,
        value: value === null
          ? null
          : (state.mayAutoPreferences[pid][effectKey] ?? value),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(mayAutoPreferenceSet) failed:', err);
    }

    if (typeof (game as any).bumpSeq === 'function') {
      (game as any).bumpSeq();
    }

    // Drain already-queued optional may prompts (Always No clicked with 200+ Aura Shards
    // pending) AND matching stack tops. Pref alone only affects future resolveTopOfStack.
    if (value !== null) {
      const drainedPending = drainPendingOptionalAutoChoices(game, gameId, pid);
      if (drainedPending > 0) {
        debug(2, `[May] Drained ${drainedPending} pending optional prompt(s) after setting "${effectKey}"`);
      }

      if (Array.isArray(state.stack) && state.stack.length > 0) {
        const top = state.stack[state.stack.length - 1];
        if (wouldAutoDeclineOptionalTriggeredAbility(state, top)) {
          persistAndResolveTopOfStack(game, gameId, {
            playerId: pid,
            effectKey,
            reason: 'mayAutoPreferenceDrain',
          });
        }
      }
    }

    const io = priorityResolutionHandlerState.io;
    if (io) {
      broadcastGame(io, game, gameId);
      // Tell the client the resolution queue is clear so MayAbilityModal closes.
      const remaining = ResolutionQueueManager.getStepsForPlayer(gameId, pid as any);
      if (remaining.length === 0) {
        emitToPlayer(io, pid, 'noResolutionStep', { gameId });
      } else {
        emitToPlayer(io, pid, 'resolutionStepPrompt', {
          gameId,
          step: sanitizeStepForClient(gameId, remaining[0]),
        });
      }
      emitToPlayer(io, pid, 'resolutionQueueChanged', {
        gameId,
        hasPending: remaining.length > 0,
        pendingCount: remaining.length,
        myPendingCount: remaining.length,
        myNextStepId: remaining[0]?.id,
      });
    }
  });

  // Clean up when socket disconnects
  socket.on("disconnect", () => {
    ResolutionQueueManager.off(queueEventHandler);
  });
}
