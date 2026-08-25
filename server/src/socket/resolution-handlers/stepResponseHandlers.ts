/**
 * socket/resolution-handlers/stepResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse core).
 * Cluster moved: handleStepResponse (EffectProgram prefix + remaining switch dispatch).
 * Public entry symbols: handleStepResponse.
 *
 * Direct leaf import from resolution.ts. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { persistEffectProgramChoiceResolutionEvent, restoreEffectProgramRuntimeForPendingStep, resumeEffectProgramResolution } from "../../state/effects/index.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../../state/modules/oracleIrDeferredStackFinalize.js";
import { handleKynaiosChoiceResponse as handleKynaiosChoiceResponseBatched } from "../../state/resolution/handlers/kynaiosChoice.js";
import { ResolutionStepType, type ResolutionStep, type ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { handleLibrarySearchResponse } from "../resolutionLibrarySearchHandlers.js";
import {
  handleBottomOrderResponse,
  handleClashResponse,
  handleFatesealResponse,
  handlePonderEffectResponse,
  handleTwoPileSplitResponse,
} from "../resolutionLibraryLookResponseHandlers.js";
import { handleModalChoiceResponse } from "../resolutionModalChoiceResponseHandlers.js";
import {
  handleExploitChoiceResponse,
  handleFabricateChoiceResponse,
  handleHauntTargetResponse,
  handleMentorTargetResponse,
  handleModularChoiceResponse,
  handleRiotChoiceResponse,
  handleSoulshiftTargetResponse,
  handleTributeChoiceResponse,
  handleUnleashChoiceResponse,
} from "../resolutionKeywordChoiceHandlers.js";
import { getResolutionHandlerDeps } from "../resolutionHandlerDeps.js";
import { getPlayerName, persistAndResolveTopOfStack } from "../util.js";
import { finalizeEffectProgramSpellColorChoiceAfterResume } from "./effectProgramSpellColorChoiceFinalize.js";
import {
  extractFirstResolutionSelectionId,
  handleOptionalTriggeredAbilityChoiceResponse,
  isOptionalTriggeredEffectProgramStep,
  maybeDrainAutoDeclinedOptionalStackAfterDecline,
} from "./mayAbilityAndOptionalTriggerHandlers.js";
import { handleOptionChoiceResponse } from "./optionChoiceResponseHandlers.js";
import { restoreLibrarySearchStep } from "./panglacialSearchCastUtils.js";
import { handleRulesChoiceGroupResponse } from "./rulesChoiceGroupResponseHandlers.js";
import { emitNextPendingResolutionStep } from "./resolutionStepTimeoutAndCancelHandlers.js";
import { resumePlayerSpellCastAfterPayment } from "./spellCastPaymentResumeHandlers.js";
import { handleTargetSelectionResponse } from "./targetSelectionResponseHandlers.js";

export async function handleStepResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  if ((step as any)?.effectProgramPrompt === true) {
    restoreEffectProgramRuntimeForPendingStep(game, gameId, step);
    const resumed = resumeEffectProgramResolution({ game, gameId, step, response });
    if (!resumed.resumed) {
      if (isOptionalTriggeredEffectProgramStep(step)) {
        await handleOptionalTriggeredAbilityChoiceResponse(io, game, gameId, step, response);
        return;
      }
      debugWarn(1, '[Resolution] EffectProgram prompt could not resume:', resumed.reason || resumed.status);
      return;
    }

    if (step.type === ResolutionStepType.OPTION_CHOICE) {
      const choiceId = extractFirstResolutionSelectionId(response.selections) || (response.cancelled ? 'no' : 'no');
      const choice: 'yes' | 'no' = !response.cancelled && choiceId === 'yes' ? 'yes' : 'no';
      await persistEffectProgramChoiceResolutionEvent(game, gameId, step, response, choice);
    }

    await finalizeEffectProgramSpellColorChoiceAfterResume(io, game, gameId, step, response, resumed);

    let resolvedDeferredStack = step.type === ResolutionStepType.COLOR_CHOICE && resumed.status === 'completed';
    for (const event of resumed.runResult?.events || []) {
      const eventKind = String((event as any)?.kind || '');
      if (eventKind !== 'resolve_top_of_stack') {
        continue;
      }

      const sourceName = String((event as any)?.sourceName || step.sourceName || 'Ability');
      if (persistAndResolveTopOfStack(game, gameId, {
        playerId: response.playerId,
        sourceName,
        reason: 'effectProgramDeferredStack',
      })) {
        resolvedDeferredStack = true;
        debug(2, `[Resolution] Resolved deferred EffectProgram stack item for ${sourceName}`);
      } else {
        debugWarn(1, `[Resolution] Game missing resolveTopOfStack while handling ${sourceName}`);
      }
    }

    if (!resolvedDeferredStack && resumed.status === 'completed') {
      maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
    }

    // After declining an optional "you may" with Always No / no-until saved,
    // drain remaining matching stack tops without Resolve All.
    if (
      resumed.status === 'completed'
      && isOptionalTriggeredEffectProgramStep(step)
      && step.type === ResolutionStepType.OPTION_CHOICE
    ) {
      const choiceId = extractFirstResolutionSelectionId(response.selections) || (response.cancelled ? 'no' : 'no');
      const declined = response.cancelled || choiceId !== 'yes';
      if (declined) {
        maybeDrainAutoDeclinedOptionalStackAfterDecline(
          game,
          gameId,
          response.playerId,
          String(step.sourceName || 'Ability'),
          step,
        );
      }
    }
    return;
  }

  if (String((step as any)?.rulesChoiceGroupId || '').trim()) {
    await handleRulesChoiceGroupResponse(game, gameId, step, response);
    return;
  }

  if (response.cancelled) {
    // Most cancelled steps are a no-op. Some steps (e.g. Ward payments / optional costs)
    // need custom cancellation semantics handled in their normal handlers.
    if (step.type === ResolutionStepType.MANA_PAYMENT_CHOICE) {
      // Let the normal handler run so it can clean up (e.g. abort spell payment) or
      // abort a player-initiated activation.
    } else if (step.type === ResolutionStepType.TARGET_SELECTION) {
      await handleTargetSelectionResponse(io, game, gameId, step, response);
    } else if (step.type === ResolutionStepType.DISCARD_SELECTION) {
      await getResolutionHandlerDeps().handleDiscardResponse(io, game, gameId, step, response);
    } else if (step.type === ResolutionStepType.TAP_UNTAP_TARGET) {
      // Activation-cost tap flow: cancel should abort the activation.
      if ((step as any)?.tapOtherAbilityAsCost === true) {
        const pid = response.playerId;
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${getPlayerName(game, pid)} cancelled an ability activation.`,
          ts: Date.now(),
        });
      }
    } else if (step.type === ResolutionStepType.OPTION_CHOICE) {
      await handleOptionChoiceResponse(io, game, gameId, step, response);
    }
    if (step.type !== ResolutionStepType.MANA_PAYMENT_CHOICE) return;
  }
  
  const pid = response.playerId;

  if (step.type === ResolutionStepType.OPTION_CHOICE && (step as any)?.prisonersDilemmaChoice === true) {
    await getResolutionHandlerDeps().handlePrisonersDilemmaChoiceResponse(io, game, gameId, step, response);
    return;
  }
  
  switch (step.type) {
    case ResolutionStepType.OPENING_HAND_ACTIONS: {
      getResolutionHandlerDeps().handleOpeningHandActionsResponse(io, game, gameId, step, response);
      break;
    }

    case ResolutionStepType.EXPLORE_DECISION:
      getResolutionHandlerDeps().handleExploreDecisionResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.BATCH_EXPLORE_DECISION:
      getResolutionHandlerDeps().handleBatchExploreDecisionResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.HAND_TO_BOTTOM: {
      const handToBottomExit = getResolutionHandlerDeps().handleHandToBottomResponse(io, game, gameId, step, response);
      if (handToBottomExit === 'return') return;
      break;
    }

    case ResolutionStepType.FIGHT_TARGET:
      getResolutionHandlerDeps().handleFightTargetResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.TAP_UNTAP_TARGET:
      await getResolutionHandlerDeps().handleTapUntapTargetResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.COUNTER_MOVEMENT:
      getResolutionHandlerDeps().handleCounterMovementResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.COUNTER_TARGET:
      getResolutionHandlerDeps().handleCounterTargetResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.COUNTER_DISTRIBUTION:
      getResolutionHandlerDeps().handleCounterDistributionResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.STATION_CREATURE_SELECTION:
      getResolutionHandlerDeps().handleStationCreatureSelectionResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.LIFE_PAYMENT:
      await getResolutionHandlerDeps().handleLifePaymentResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.MANA_COLOR_SELECTION: {
      await getResolutionHandlerDeps().handleManaColorSelectionResponse(io, game, gameId, step, response);
      break;
    }

    case ResolutionStepType.MANA_PAYMENT_CHOICE: {
      const stepData = step as any;
      if (await getResolutionHandlerDeps().tryHandleManaPaymentChoiceWardAndSacrificePrefix(io, game, gameId, step, response)) {
        break;
      }

      if (await getResolutionHandlerDeps().tryHandleManaPaymentChoiceActivation(io, game, gameId, step, response)) {
        break;
      }

      // Spell casting payment (replacement for legacy paymentRequired -> completeCastSpell handshake)
      if (stepData.spellPaymentRequired === true) {
        await getResolutionHandlerDeps().handleSpellPaymentChoiceResponse(io, game, gameId, step, response, {
          restoreLibrarySearchStep,
          resumePlayerSpellCastAfterPayment,
          emitNextPendingResolutionStep,
        });
        break;
      }

      await getResolutionHandlerDeps().handleManaPaymentChoicePhyrexianActivation(io, game, gameId, step, response);
      break;
    }

    case ResolutionStepType.MODE_SELECTION: {
      const stepData = step as any;
      const selectedRaw = response.selections as any;
      const chosenMode = Array.isArray(selectedRaw) ? selectedRaw[0] : selectedRaw;

      if (await getResolutionHandlerDeps().tryHandleModeSelectionCastResume(io, game, gameId, step, response)) {
        break;
      }

      await getResolutionHandlerDeps().handleModeSelectionGenericChoice(io, game, gameId, step, response);
      break;
    }

    case ResolutionStepType.ADDITIONAL_COST_PAYMENT: {
      await getResolutionHandlerDeps().handleAdditionalCostPaymentResponse(io, game, gameId, step, response);
      break;
    }

    case ResolutionStepType.SQUAD_COST_PAYMENT: {
      await getResolutionHandlerDeps().handleSquadCostPaymentResponse(io, game, gameId, step, response);
      break;
    }

    case ResolutionStepType.DISCARD_SELECTION:
      await getResolutionHandlerDeps().handleDiscardResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.X_VALUE_SELECTION:
      await getResolutionHandlerDeps().handleXValueSelectionResponse(io, game, gameId, step, response);
      return;
      
    case ResolutionStepType.TARGET_SELECTION:
      await handleTargetSelectionResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.MUTATE_TARGET_SELECTION:
      await getResolutionHandlerDeps().handleMutateTargetSelectionResponse(io, game, gameId, step, response);
      return;

    case ResolutionStepType.GRAVEYARD_SELECTION:
      await getResolutionHandlerDeps().handleGraveyardSelectionResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.TRIGGER_ORDER:
      getResolutionHandlerDeps().handleTriggerOrderResponse(io, game, gameId, step, response);
      return;
      
    case ResolutionStepType.KYNAIOS_CHOICE:
      handleKynaiosChoiceResponseBatched(io, game, gameId, step, response, { getPlayerName });
      break;
      
    case ResolutionStepType.JOIN_FORCES:
      getResolutionHandlerDeps().handleJoinForcesResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.TEMPTING_OFFER:
      getResolutionHandlerDeps().handleTemptingOfferResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE:
      getResolutionHandlerDeps().handleReturnControlledPermanentChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.HIDEAWAY_CHOICE:
      getResolutionHandlerDeps().handleHideawayChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.REPEATED_ZONE_DRAFT:
      getResolutionHandlerDeps().handleRepeatedZoneDraftResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.ACTIVATED_ABILITY:
      await getResolutionHandlerDeps().handleActivatedAbilityResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.CASCADE:
      await getResolutionHandlerDeps().handleCascadeResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SCRY:
      getResolutionHandlerDeps().handleScryResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SURVEIL:
      getResolutionHandlerDeps().handleSurveilResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.BOTTOM_ORDER:
      getResolutionHandlerDeps().handleBottomOrderResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.LIM_DULS_VAULT:
      getResolutionHandlerDeps().handleLimDulsVaultResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.DANCE_WITH_CALAMITY:
      getResolutionHandlerDeps().handleDanceWithCalamityResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.DANCE_WITH_CALAMITY_CAST:
      getResolutionHandlerDeps().handleDanceWithCalamityCastSelectionResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.PROLIFERATE:
      getResolutionHandlerDeps().handleProliferateResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.LIFE_REDISTRIBUTION:
      getResolutionHandlerDeps().handleLifeRedistributionResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.FATESEAL:
      getResolutionHandlerDeps().handleFatesealResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.CLASH:
      getResolutionHandlerDeps().handleClashResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.VOTE:
      getResolutionHandlerDeps().handleVoteResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.PONDER_EFFECT:
      getResolutionHandlerDeps().handlePonderEffectResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.TWO_PILE_SPLIT:
      await getResolutionHandlerDeps().handleTwoPileSplitResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.LIBRARY_SEARCH:
      await handleLibrarySearchResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.DEVOUR_SELECTION:
      getResolutionHandlerDeps().handleDevourSelectionResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SUSPEND_CAST:
      await getResolutionHandlerDeps().handleSuspendCastResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.MORPH_TURN_FACE_UP:
      getResolutionHandlerDeps().handleMorphTurnFaceUpResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.PLAYER_CHOICE:
      await getResolutionHandlerDeps().handlePlayerChoiceResponse(io, game, gameId, step, response);
      return;
      
    case ResolutionStepType.OPTION_CHOICE:
      await handleOptionChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.MODAL_CHOICE:
      await getResolutionHandlerDeps().handleModalChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.COLOR_CHOICE:
      await getResolutionHandlerDeps().handleColorChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.CREATURE_TYPE_CHOICE:
      await getResolutionHandlerDeps().handleCreatureTypeChoiceResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.CARD_NAME_CHOICE:
      await getResolutionHandlerDeps().handleCardNameChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.BASIC_LAND_TYPE_CHOICE:
      await getResolutionHandlerDeps().handleBasicLandTypeChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.RIOT_CHOICE:
      handleRiotChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.UNLEASH_CHOICE:
      handleUnleashChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.FABRICATE_CHOICE:
      await handleFabricateChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.TRIBUTE_CHOICE:
      await handleTributeChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.MENTOR_TARGET:
      handleMentorTargetResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.EXPLOIT_CHOICE:
      await handleExploitChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.EXTORT_PAYMENT:
      getResolutionHandlerDeps().handleExtortPaymentResponse(io, game, gameId, step, response);
      return;

    case ResolutionStepType.MODULAR_CHOICE:
      handleModularChoiceResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.SOULSHIFT_TARGET:
      handleSoulshiftTargetResponse(io, game, gameId, step, response);
      break;

    case ResolutionStepType.HAUNT_TARGET:
      handleHauntTargetResponse(io, game, gameId, step, response);
      break;
    
    case ResolutionStepType.UPKEEP_SACRIFICE:
      getResolutionHandlerDeps().handleUpkeepSacrificeResponse(io, game, gameId, step, response);
      break;

    // Add more handlers as needed
    default:
      debug(2, `[Resolution] No specific handler for step type: ${step.type}`);
  }
}
