/**
 * socket/resolutionHandlerDeps.ts
 *
 * Injected helpers for the four tangled resolution cores:
 *   - registerResolutionHandlers
 *   - handleStepResponse
 *   - handleTargetSelectionResponse
 *   - handleOptionChoiceResponse
 *
 * SEAM STATUS (2026-08-23):
 * - Response clusters behind this seam: library-look / modal / commander-zone /
 *   vote / proliferate / lim-dul / color-type-name choices / option-choice early
 *   specials PREFIX + ConfirmCastPayment / join-forces+tempting / hideaway+zone-draft+return-permanent (split) /
 *   cascade+dance+devour+suspend+morph (+ life redistrib / prisoners dilemma).
 * - Injectable cast helpers (appendCastSpellContinuationEvent,
 *   createForwardingGameActionSocket, restartPlayerCastRequest) unlock PREFIX
 *   extraction without blunt-cutting the four cores.
 * - Remaining: large switch/validation bodies still in the four cores; more
 *   option-choice specials after ConfirmCastPayment; target-selection specialized branches;
 *   discard-trigger + activated-targeting utils extracted; discard response extracted (core + activation-resume); graveyard selection extracted (apply + post/resume); activated-ability extracted; commander-cast copies /
 *   Hatut / Storm intentionally out of scope; triggered-abilities.ts skipped.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../state/resolution/index.js";
import { handleCommanderZoneResponse } from "./resolutionCommanderZoneResponseHandlers.js";
import {
  handleBasicLandTypeChoiceResponse,
  handleCardNameChoiceResponse,
  handleColorChoiceResponse,
  handleCreatureTypeChoiceResponse,
} from "./resolutionColorTypeNameChoiceResponseHandlers.js";
import {
  handleBottomOrderResponse,
  handleClashResponse,
  handleFatesealResponse,
  handlePonderEffectResponse,
  handleTwoPileSplitResponse,
} from "./resolutionLibraryLookResponseHandlers.js";
import { handleModalChoiceResponse } from "./resolutionModalChoiceResponseHandlers.js";
import { handleScryResponse, handleSurveilResponse } from "./resolutionScrySurveilResponseHandlers.js";
import { tryHandleOptionChoiceEarlySpecialsPrefix } from "./resolutionOptionChoiceEarlySpecialsPrefixHandlers.js";
import { tryHandleOptionChoiceEarlySpecialsConfirmCastPayment } from "./resolutionOptionChoiceEarlySpecialsConfirmCastPaymentHandlers.js";
import {
  appendCastSpellContinuationEvent,
  createForwardingGameActionSocket,
  restartPlayerCastRequest,
} from "./resolutionSyntheticCastSocketUtils.js";
import {
  handleJoinForcesResponse,
  handleTemptingOfferResponse,
} from "./resolutionJoinForcesTemptingOfferResponseHandlers.js";
import {
  handleHideawayChoiceResponse,
  handleRepeatedZoneDraftResponse,
  handleReturnControlledPermanentChoiceResponse,
} from "./resolutionHideawayZoneDraftPermanentChoiceResponseHandlers.js";
import {
  handleCascadeResponse,
  handleDanceWithCalamityCastSelectionResponse,
  handleDanceWithCalamityResponse,
  handleDevourSelectionResponse,
  handleLifeRedistributionResponse,
  handleMorphTurnFaceUpResponse,
  handlePrisonersDilemmaChoiceResponse,
  handleSuspendCastResponse,
} from "./resolutionCascadeDanceDevourSuspendMorphResponseHandlers.js";
import { handleActivatedAbilityResponse } from "./resolutionActivatedAbilityResponseHandlers.js";
import { handleDiscardResponse } from "./resolutionDiscardResponseCoreHandlers.js";
import { handleGraveyardSelectionResponse } from "./resolutionGraveyardSelectionApplyHandlers.js";
import {
  handleLimDulsVaultResponse,
  handleProliferateResponse,
  handleVoteResponse,
} from "./resolutionVoteProliferateLimDulResponseHandlers.js";
import {
  handleBatchExploreDecisionResponse,
  handleExploreDecisionResponse,
} from "./resolution-handlers/exploreDecisionResponseHandlers.js";
import {
  handleCounterDistributionResponse,
  handleCounterMovementResponse,
  handleCounterTargetResponse,
} from "./resolution-handlers/counterManipulationResponseHandlers.js";
import { handleAdditionalCostPaymentResponse } from "./resolution-handlers/additionalCostPaymentResponseHandlers.js";
import { handleFightTargetResponse } from "./resolution-handlers/fightTargetResponseHandlers.js";
import { handleLifePaymentResponse } from "./resolution-handlers/lifePaymentResponseHandlers.js";
import { handleManaColorSelectionResponse } from "./resolution-handlers/manaColorSelectionResponseHandlers.js";
import { handleTriggerOrderResponse } from "./resolution-handlers/triggerOrderResponseHandlers.js";
import { handleXValueSelectionResponse } from "./resolution-handlers/xValueSelectionResponseHandlers.js";
import { handleExtortPaymentResponse } from "./resolution-handlers/extortPaymentResponseHandlers.js";
import { handleMutateTargetSelectionResponse } from "./resolution-handlers/mutateTargetSelectionResponseHandlers.js";
import {
  handleMayAbilityResponse,
  handleOptionalTriggeredAbilityChoiceResponse,
} from "./resolution-handlers/mayAbilityAndOptionalTriggerHandlers.js";
import { tryHandleManaPaymentChoiceActivation } from "./resolution-handlers/manaPaymentChoiceActivationHandlers.js";
import { handleManaPaymentChoicePhyrexianActivation } from "./resolution-handlers/manaPaymentChoicePhyrexianHandlers.js";
import { tryHandleManaPaymentChoiceWardAndSacrificePrefix } from "./resolution-handlers/manaPaymentChoicePrefixHandlers.js";
import { tryHandleModeSelectionCastResume } from "./resolution-handlers/modeSelectionCastResumeHandlers.js";
import { handleModeSelectionGenericChoice } from "./resolution-handlers/modeSelectionGenericChoiceHandlers.js";
import { handleSquadCostPaymentResponse } from "./resolution-handlers/squadCostPaymentResponseHandlers.js";
import { handleUpkeepSacrificeResponse } from "./resolution-handlers/upkeepSacrificeResponseHandlers.js";
import { handlePlayerChoiceResponse } from "./resolution-handlers/playerChoiceResponseHandlers.js";
import { handleStationCreatureSelectionResponse } from "./resolution-handlers/stationCreatureSelectionResponseHandlers.js";
import {
  handleRemoveCountersAbilityAsCostTargetSelection,
  handleReturnToHandAbilityAsCostTargetSelection,
} from "./resolution-handlers/targetSelectionActivationCostPaymentHandlers.js";
import { handleBattlefieldAbilityTargetSelection } from "./resolution-handlers/targetSelectionBattlefieldAbilityHandlers.js";
import { handleBlightKeywordTargetSelection } from "./resolution-handlers/targetSelectionBlightKeywordHandlers.js";
import { handleSacrificeAbilityAsCostTargetSelection } from "./resolution-handlers/targetSelectionSacrificeAbilityCostHandlers.js";
import { tryHandleTargetSelectionGraveyardCardAction } from "./resolution-handlers/targetSelectionGraveyardCardActions.js";
import { tryHandleTargetSelectionImmediateBattlefieldAction } from "./resolution-handlers/targetSelectionImmediateBattlefieldActions.js";
import {
  handleGraveyardCastSacrificeAsCostTargetSelection,
  handleGraveyardSpellCastTargetSelection,
} from "./resolution-handlers/targetSelectionGraveyardCastHandlers.js";
import {
  handleSacrificeAnotherPermanentForBenefitTargetSelection,
  handleSacrificeWhenYouDoTargetSelection,
} from "./resolution-handlers/targetSelectionSacrificeFollowupHandlers.js";
import {
  handlePlaneswalkerAbilityTargetSelection,
  handleSoldierProgramCounterTargetSelection,
} from "./resolution-handlers/targetSelectionPlaneswalkerAndSoldierHandlers.js";
import {
  handleBecomeCopyOfCreatureTargetSelection,
  handleScavengeTargetSelection,
} from "./resolution-handlers/targetSelectionScavengeAndCopyHandlers.js";
import {
  handleAttachEquipmentSelectEquipmentTargetSelection,
  handleTapCreaturesCostTargetSelection,
} from "./resolution-handlers/targetSelectionTapCostAndAttachHandlers.js";
import {
  applyAutoUnignoreForTargetedPermanents,
  handleSpellCastPaymentTargetSelection,
} from "./resolution-handlers/targetSelectionSpellCastPaymentHandlers.js";
import {
  handleEnlistChoiceTargetSelection,
  tryHandleCrewAbilityTargetSelection,
} from "./resolution-handlers/targetSelectionCrewAndEnlistHandlers.js";
import {
  handleDungeonRoomSacrificePayment,
  handleDungeonTargetCreatureEffect,
} from "./resolution-handlers/targetSelectionDungeonRoomHandlers.js";
import {
  handleExertTargetChoiceTargetSelection,
  handleRetargetAbilityCopyTargetSelection,
  handleRetargetSpellCopyTargetSelection,
} from "./resolution-handlers/targetSelectionExertAndCopyRetargetHandlers.js";
import {
  handleDamageReceivedTriggerTargetSelection,
  handleTargetedTriggeredAbilityTargetSelection,
} from "./resolution-handlers/targetSelectionTriggeredAbilityTargetHandlers.js";
import {
  handleDivineReckoningChoiceTargetSelection,
  handleOpponentSelectionTargetSelection,
  handleSacrificeSelectionTargetSelection,
} from "./resolution-handlers/targetSelectionNonStackChoiceHandlers.js";
import { handleCancelledTargetSelectionResponse } from "./resolution-handlers/targetSelectionCancellationHandlers.js";
import {
  handleOracleIrAnyPlayerMayPaymentSelection,
  handleOracleIrLibraryChaosTargetSelection,
} from "./resolution-handlers/targetSelectionOracleIrPromptHandlers.js";
import {
  handleLandWouldEnterSacrificeChoice,
  handleMoxDiamondChoice,
  handleRevealLandChoice,
  handleShockLandChoice,
} from "./resolution-handlers/optionChoiceLandEntryReplacementHandlers.js";
import { handleWardPaymentOptionChoice } from "./resolution-handlers/optionChoiceWardPaymentHandlers.js";
import {
  handleForceOfWillExileChoice,
  handleOpponentMayPayChoice,
  handleSacrificeUnlessPayChoice,
} from "./resolution-handlers/optionChoicePayOrElseHandlers.js";
import {
  handleCastFromGraveyardPromptChoice,
  handlePlayFromGraveyardPromptChoice,
} from "./resolution-handlers/optionChoiceCastFromGraveyardPrompts.js";
import {
  handleCastFromExilePromptChoice,
  handleDanceWithCalamityCastPrompt,
  type CastFromExilePromptHelpers,
} from "./resolution-handlers/optionChoiceCastFromExilePrompts.js";
import {
  handleReflexiveBoundGraveyardSelfExileWhenYouDo,
  handleReflexiveExileToOwnersGraveyardWhenYouDo,
} from "./resolution-handlers/optionChoiceReflexiveExileWhenYouDoHandlers.js";
import {
  handleReflexiveDiscardWhenYouDo,
  handleReflexiveGraveyardExileWhenYouDo,
  handleSacrificeWhenYouDoAskChoice,
} from "./resolution-handlers/optionChoiceReflexiveWhenYouDoQueueHandlers.js";
import {
  handleDungeonRoomFreeCastFromHandChoice,
  handleDungeonRoomPenaltyChoice,
  handleDungeonRoomThroneChoice,
} from "./resolution-handlers/optionChoiceDungeonRoomPrompts.js";
import {
  handleVentureChooseDungeonChoice,
  handleVentureChooseRoomChoice,
  handleVentureIntoDungeonChoice,
} from "./resolution-handlers/optionChoiceVentureDungeonHandlers.js";
import {
  handleResolvedSpellCopyChoice,
  handleRetargetAbilityCopyChoice,
  handleRetargetSpellCopyChoice,
} from "./resolution-handlers/optionChoiceSpellCopyPrompts.js";
import {
  handleChooseLookedAtCardsDestinationChoice,
  handleChoosePileFromSplitChoice,
  handlePayManaToLookAndChooseCardChoice,
} from "./resolution-handlers/optionChoiceLookedAtCardsAndPileHandlers.js";
import {
  handleAttachEquipmentToPermanentChoice,
  handleMoveChosenHandCardToLibraryChoice,
  handleSacrificeAnotherPermanentForBenefitAskChoice,
} from "./resolution-handlers/optionChoicePermanentAndHandCardPrompts.js";
import {
  handleChooseDiscardPlanChoice,
  handleSpellAdditionalCostBlightOrPayChoice,
} from "./resolution-handlers/optionChoiceCostPlanPrompts.js";
import {
  handleChoosePlayerForLookedAtCardsChoice,
  handleChoosePlayerForTwoPileSplitChoice,
} from "./resolution-handlers/optionChoiceChoosePlayerPrompts.js";
import {
  handleChooseManaColorsChoice,
  handleOptionalDiscardThenDrawChoice,
} from "./resolution-handlers/optionChoiceDiscardAndManaColorPrompts.js";
import {
  handleGrantPlayableFromExileChoice,
  handleReboundCastChoice,
} from "./resolution-handlers/optionChoiceExilePlayPermissionPrompts.js";
import {
  handleCounterPlacementTriggerChoice,
  handleEtbPermanentOptionChoice,
} from "./resolution-handlers/optionChoiceEtbAndCounterPlacementPrompts.js";
import {
  handleMoxDiamondStackChoice,
  handleTapOrUntapDecision,
} from "./resolution-handlers/optionChoiceBoardActionPrompts.js";
import {
  handleSpellPaymentChoiceResponse,
  type SpellPaymentChoiceHelpers,
} from "./resolution-handlers/manaPaymentSpellCastResponseHandlers.js";
import {
  handleHandToBottomResponse,
  handleOpeningHandActionsResponse,
  type StepResponseExit,
} from "./resolution-handlers/preGameHandStepResponseHandlers.js";
import { maybeQueueWardPaymentPromptsForTargetSelection } from "./resolution-handlers/targetSelectionWardPromptHandlers.js";
import { handleTapUntapTargetResponse } from "./resolution-handlers/tapUntapTargetResponseHandlers.js";

export type ResolutionStepHandler = (
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
) => void | Promise<void>;

export type ResolutionHandlerDeps = {
  handleFatesealResponse: ResolutionStepHandler;
  handleClashResponse: ResolutionStepHandler;
  handleBottomOrderResponse: ResolutionStepHandler;
  handlePonderEffectResponse: ResolutionStepHandler;
  handleTwoPileSplitResponse: ResolutionStepHandler;
  handleModalChoiceResponse: ResolutionStepHandler;
  handleScryResponse: ResolutionStepHandler;
  handleSurveilResponse: ResolutionStepHandler;
  handleCommanderZoneResponse: ResolutionStepHandler;
  handleProliferateResponse: ResolutionStepHandler;
  handleVoteResponse: ResolutionStepHandler;
  handleLimDulsVaultResponse: ResolutionStepHandler;
  handleColorChoiceResponse: ResolutionStepHandler;
  handleBasicLandTypeChoiceResponse: ResolutionStepHandler;
  handleCreatureTypeChoiceResponse: ResolutionStepHandler;
  handleCardNameChoiceResponse: ResolutionStepHandler;
  handleJoinForcesResponse: ResolutionStepHandler;
  handleTemptingOfferResponse: ResolutionStepHandler;
  handleReturnControlledPermanentChoiceResponse: ResolutionStepHandler;
  handleHideawayChoiceResponse: ResolutionStepHandler;
  handleRepeatedZoneDraftResponse: ResolutionStepHandler;
  handleCascadeResponse: ResolutionStepHandler;
  handleLifeRedistributionResponse: ResolutionStepHandler;
  handlePrisonersDilemmaChoiceResponse: ResolutionStepHandler;
  handleDanceWithCalamityResponse: ResolutionStepHandler;
  handleDanceWithCalamityCastSelectionResponse: ResolutionStepHandler;
  handleDevourSelectionResponse: ResolutionStepHandler;
  handleSuspendCastResponse: ResolutionStepHandler;
  handleMorphTurnFaceUpResponse: ResolutionStepHandler;
  handleActivatedAbilityResponse: ResolutionStepHandler;
  handleDiscardResponse: ResolutionStepHandler;
  handleGraveyardSelectionResponse: ResolutionStepHandler;
  handleExploreDecisionResponse: ResolutionStepHandler;
  handleBatchExploreDecisionResponse: ResolutionStepHandler;
  handleFightTargetResponse: ResolutionStepHandler;
  handleTapUntapTargetResponse: ResolutionStepHandler;
  handleCounterMovementResponse: ResolutionStepHandler;
  handleCounterTargetResponse: ResolutionStepHandler;
  handleCounterDistributionResponse: ResolutionStepHandler;
  handleStationCreatureSelectionResponse: ResolutionStepHandler;
  handleLifePaymentResponse: ResolutionStepHandler;
  handleManaColorSelectionResponse: ResolutionStepHandler;
  handleXValueSelectionResponse: ResolutionStepHandler;
  handleTriggerOrderResponse: ResolutionStepHandler;
  handleExtortPaymentResponse: ResolutionStepHandler;
  handleMutateTargetSelectionResponse: ResolutionStepHandler;
  handleMayAbilityResponse: ResolutionStepHandler;
  handleOptionalTriggeredAbilityChoiceResponse: ResolutionStepHandler;
  tryHandleManaPaymentChoiceWardAndSacrificePrefix: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  tryHandleManaPaymentChoiceActivation: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  handleManaPaymentChoicePhyrexianActivation: ResolutionStepHandler;
  tryHandleModeSelectionCastResume: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  handleModeSelectionGenericChoice: ResolutionStepHandler;
  handleAdditionalCostPaymentResponse: ResolutionStepHandler;
  handleSquadCostPaymentResponse: ResolutionStepHandler;
  handleUpkeepSacrificeResponse: ResolutionStepHandler;
  handlePlayerChoiceResponse: ResolutionStepHandler;
  handleSacrificeAbilityAsCostTargetSelection: ResolutionStepHandler;
  handleRemoveCountersAbilityAsCostTargetSelection: ResolutionStepHandler;
  handleReturnToHandAbilityAsCostTargetSelection: ResolutionStepHandler;
  handleBattlefieldAbilityTargetSelection: ResolutionStepHandler;
  handleBlightKeywordTargetSelection: ResolutionStepHandler;
  maybeQueueWardPaymentPromptsForTargetSelection: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    args: { pid: string; selections: string[]; spellCastContext: any },
  ) => boolean;
  handleSacrificeWhenYouDoTargetSelection: ResolutionStepHandler;
  handleSacrificeAnotherPermanentForBenefitTargetSelection: ResolutionStepHandler;
  handleGraveyardCastSacrificeAsCostTargetSelection: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  handleGraveyardSpellCastTargetSelection: ResolutionStepHandler;
  handleScavengeTargetSelection: ResolutionStepHandler;
  handleBecomeCopyOfCreatureTargetSelection: ResolutionStepHandler;
  tryHandleTargetSelectionImmediateBattlefieldAction: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  tryHandleTargetSelectionGraveyardCardAction: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => boolean;
  applyAutoUnignoreForTargetedPermanents: (
    io: Server,
    game: any,
    gameId: string,
    response: ResolutionStepResponse,
  ) => void;
  handleSpellCastPaymentTargetSelection: ResolutionStepHandler;
  handleSoldierProgramCounterTargetSelection: ResolutionStepHandler;
  handlePlaneswalkerAbilityTargetSelection: ResolutionStepHandler;
  handleTapCreaturesCostTargetSelection: ResolutionStepHandler;
  handleAttachEquipmentSelectEquipmentTargetSelection: ResolutionStepHandler;
  tryHandleCrewAbilityTargetSelection: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  handleEnlistChoiceTargetSelection: ResolutionStepHandler;
  handleDungeonRoomSacrificePayment: ResolutionStepHandler;
  handleDungeonTargetCreatureEffect: ResolutionStepHandler;
  handleExertTargetChoiceTargetSelection: ResolutionStepHandler;
  handleRetargetAbilityCopyTargetSelection: ResolutionStepHandler;
  handleRetargetSpellCopyTargetSelection: ResolutionStepHandler;
  handleTargetedTriggeredAbilityTargetSelection: ResolutionStepHandler;
  handleDamageReceivedTriggerTargetSelection: ResolutionStepHandler;
  handleDivineReckoningChoiceTargetSelection: ResolutionStepHandler;
  handleSacrificeSelectionTargetSelection: ResolutionStepHandler;
  handleOpponentSelectionTargetSelection: ResolutionStepHandler;
  handleCancelledTargetSelectionResponse: ResolutionStepHandler;
  handleOracleIrAnyPlayerMayPaymentSelection: ResolutionStepHandler;
  handleOracleIrLibraryChaosTargetSelection: ResolutionStepHandler;
  handleShockLandChoice: ResolutionStepHandler;
  handleRevealLandChoice: ResolutionStepHandler;
  handleLandWouldEnterSacrificeChoice: ResolutionStepHandler;
  handleMoxDiamondChoice: ResolutionStepHandler;
  handleWardPaymentOptionChoice: ResolutionStepHandler;
  handleSacrificeUnlessPayChoice: ResolutionStepHandler;
  handleForceOfWillExileChoice: ResolutionStepHandler;
  handleOpponentMayPayChoice: ResolutionStepHandler;
  handlePlayFromGraveyardPromptChoice: ResolutionStepHandler;
  handleCastFromGraveyardPromptChoice: ResolutionStepHandler;
  handleDanceWithCalamityCastPrompt: ResolutionStepHandler;
  handleCastFromExilePromptChoice: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
    helpers: CastFromExilePromptHelpers,
  ) => Promise<void>;
  handleReflexiveBoundGraveyardSelfExileWhenYouDo: ResolutionStepHandler;
  handleReflexiveExileToOwnersGraveyardWhenYouDo: ResolutionStepHandler;
  handleReflexiveGraveyardExileWhenYouDo: ResolutionStepHandler;
  handleReflexiveDiscardWhenYouDo: ResolutionStepHandler;
  handleSacrificeWhenYouDoAskChoice: ResolutionStepHandler;
  handleDungeonRoomPenaltyChoice: ResolutionStepHandler;
  handleDungeonRoomFreeCastFromHandChoice: ResolutionStepHandler;
  handleDungeonRoomThroneChoice: ResolutionStepHandler;
  handleVentureIntoDungeonChoice: ResolutionStepHandler;
  handleVentureChooseDungeonChoice: ResolutionStepHandler;
  handleVentureChooseRoomChoice: ResolutionStepHandler;
  handleResolvedSpellCopyChoice: ResolutionStepHandler;
  handleRetargetSpellCopyChoice: ResolutionStepHandler;
  handleRetargetAbilityCopyChoice: ResolutionStepHandler;
  handleChooseLookedAtCardsDestinationChoice: ResolutionStepHandler;
  handlePayManaToLookAndChooseCardChoice: ResolutionStepHandler;
  handleChoosePileFromSplitChoice: ResolutionStepHandler;
  handleMoveChosenHandCardToLibraryChoice: ResolutionStepHandler;
  handleSacrificeAnotherPermanentForBenefitAskChoice: ResolutionStepHandler;
  handleAttachEquipmentToPermanentChoice: ResolutionStepHandler;
  handleSpellAdditionalCostBlightOrPayChoice: ResolutionStepHandler;
  handleChooseDiscardPlanChoice: ResolutionStepHandler;
  handleChoosePlayerForTwoPileSplitChoice: ResolutionStepHandler;
  handleChoosePlayerForLookedAtCardsChoice: ResolutionStepHandler;
  handleOptionalDiscardThenDrawChoice: ResolutionStepHandler;
  handleChooseManaColorsChoice: ResolutionStepHandler;
  handleGrantPlayableFromExileChoice: ResolutionStepHandler;
  handleReboundCastChoice: ResolutionStepHandler;
  handleEtbPermanentOptionChoice: ResolutionStepHandler;
  handleCounterPlacementTriggerChoice: ResolutionStepHandler;
  handleTapOrUntapDecision: ResolutionStepHandler;
  handleMoxDiamondStackChoice: ResolutionStepHandler;
  handleSpellPaymentChoiceResponse: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
    helpers: SpellPaymentChoiceHelpers,
  ) => Promise<void>;
  handleOpeningHandActionsResponse: ResolutionStepHandler;
  handleHandToBottomResponse: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => StepResponseExit;
  tryHandleOptionChoiceEarlySpecialsPrefix: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  tryHandleOptionChoiceEarlySpecialsConfirmCastPayment: (
    io: Server,
    game: any,
    gameId: string,
    step: ResolutionStep,
    response: ResolutionStepResponse,
  ) => Promise<boolean>;
  appendCastSpellContinuationEvent: (
    gameId: string,
    game: any,
    payload: Record<string, unknown>,
  ) => void;
  createForwardingGameActionSocket: (
    io: Server,
    gameId: string,
    playerId: string,
  ) => { socket: any; handlers: Map<string, (...args: any[]) => any> };
  restartPlayerCastRequest: (
    io: Server,
    gameId: string,
    playerId: string,
    payload: {
      cardId: string;
      faceIndex?: number;
      fromZone?: 'hand' | 'exile' | 'graveyard' | 'library' | 'command';
    },
  ) => Promise<void>;
};

let activeDeps: ResolutionHandlerDeps | null = null;

export function createResolutionHandlerDeps(
  overrides: Partial<ResolutionHandlerDeps> = {},
): ResolutionHandlerDeps {
  return {
    handleFatesealResponse,
    handleClashResponse,
    handleBottomOrderResponse,
    handlePonderEffectResponse,
    handleTwoPileSplitResponse,
    handleModalChoiceResponse,
    handleScryResponse,
    handleSurveilResponse,
    handleCommanderZoneResponse,
    handleProliferateResponse,
    handleVoteResponse,
    handleLimDulsVaultResponse,
    handleColorChoiceResponse,
    handleBasicLandTypeChoiceResponse,
    handleCreatureTypeChoiceResponse,
    handleCardNameChoiceResponse,
    handleJoinForcesResponse,
    handleTemptingOfferResponse,
    handleReturnControlledPermanentChoiceResponse,
    handleHideawayChoiceResponse,
    handleRepeatedZoneDraftResponse,
    handleCascadeResponse,
    handleLifeRedistributionResponse,
    handlePrisonersDilemmaChoiceResponse,
    handleDanceWithCalamityResponse,
    handleDanceWithCalamityCastSelectionResponse,
    handleDevourSelectionResponse,
    handleSuspendCastResponse,
    handleMorphTurnFaceUpResponse,
    handleActivatedAbilityResponse,
    handleDiscardResponse,
    handleGraveyardSelectionResponse,
    handleExploreDecisionResponse,
    handleBatchExploreDecisionResponse,
    handleFightTargetResponse,
    handleTapUntapTargetResponse,
    handleCounterMovementResponse,
    handleCounterTargetResponse,
    handleCounterDistributionResponse,
    handleStationCreatureSelectionResponse,
    handleLifePaymentResponse,
    handleManaColorSelectionResponse,
    handleXValueSelectionResponse,
    handleTriggerOrderResponse,
    handleExtortPaymentResponse,
    handleMutateTargetSelectionResponse,
    handleMayAbilityResponse,
    handleOptionalTriggeredAbilityChoiceResponse,
    tryHandleManaPaymentChoiceWardAndSacrificePrefix,
    tryHandleManaPaymentChoiceActivation,
    handleManaPaymentChoicePhyrexianActivation,
    tryHandleModeSelectionCastResume,
    handleModeSelectionGenericChoice,
    handleAdditionalCostPaymentResponse,
    handleSquadCostPaymentResponse,
    handleUpkeepSacrificeResponse,
    handlePlayerChoiceResponse,
    handleSacrificeAbilityAsCostTargetSelection,
    handleRemoveCountersAbilityAsCostTargetSelection,
    handleReturnToHandAbilityAsCostTargetSelection,
    handleBattlefieldAbilityTargetSelection,
    handleBlightKeywordTargetSelection,
    maybeQueueWardPaymentPromptsForTargetSelection,
    handleSacrificeWhenYouDoTargetSelection,
    handleSacrificeAnotherPermanentForBenefitTargetSelection,
    handleGraveyardCastSacrificeAsCostTargetSelection,
    handleGraveyardSpellCastTargetSelection,
    handleScavengeTargetSelection,
    handleBecomeCopyOfCreatureTargetSelection,
    tryHandleTargetSelectionImmediateBattlefieldAction,
    tryHandleTargetSelectionGraveyardCardAction,
    applyAutoUnignoreForTargetedPermanents,
    handleSpellCastPaymentTargetSelection,
    handleSoldierProgramCounterTargetSelection,
    handlePlaneswalkerAbilityTargetSelection,
    handleTapCreaturesCostTargetSelection,
    handleAttachEquipmentSelectEquipmentTargetSelection,
    tryHandleCrewAbilityTargetSelection,
    handleEnlistChoiceTargetSelection,
    handleDungeonRoomSacrificePayment,
    handleDungeonTargetCreatureEffect,
    handleExertTargetChoiceTargetSelection,
    handleRetargetAbilityCopyTargetSelection,
    handleRetargetSpellCopyTargetSelection,
    handleTargetedTriggeredAbilityTargetSelection,
    handleDamageReceivedTriggerTargetSelection,
    handleDivineReckoningChoiceTargetSelection,
    handleSacrificeSelectionTargetSelection,
    handleOpponentSelectionTargetSelection,
    handleCancelledTargetSelectionResponse,
    handleOracleIrAnyPlayerMayPaymentSelection,
    handleOracleIrLibraryChaosTargetSelection,
    handleShockLandChoice,
    handleRevealLandChoice,
    handleLandWouldEnterSacrificeChoice,
    handleMoxDiamondChoice,
    handleWardPaymentOptionChoice,
    handleSacrificeUnlessPayChoice,
    handleForceOfWillExileChoice,
    handleOpponentMayPayChoice,
    handlePlayFromGraveyardPromptChoice,
    handleCastFromGraveyardPromptChoice,
    handleDanceWithCalamityCastPrompt,
    handleCastFromExilePromptChoice,
    handleReflexiveBoundGraveyardSelfExileWhenYouDo,
    handleReflexiveExileToOwnersGraveyardWhenYouDo,
    handleReflexiveGraveyardExileWhenYouDo,
    handleReflexiveDiscardWhenYouDo,
    handleSacrificeWhenYouDoAskChoice,
    handleDungeonRoomPenaltyChoice,
    handleDungeonRoomFreeCastFromHandChoice,
    handleDungeonRoomThroneChoice,
    handleVentureIntoDungeonChoice,
    handleVentureChooseDungeonChoice,
    handleVentureChooseRoomChoice,
    handleResolvedSpellCopyChoice,
    handleRetargetSpellCopyChoice,
    handleRetargetAbilityCopyChoice,
    handleChooseLookedAtCardsDestinationChoice,
    handlePayManaToLookAndChooseCardChoice,
    handleChoosePileFromSplitChoice,
    handleMoveChosenHandCardToLibraryChoice,
    handleSacrificeAnotherPermanentForBenefitAskChoice,
    handleAttachEquipmentToPermanentChoice,
    handleSpellAdditionalCostBlightOrPayChoice,
    handleChooseDiscardPlanChoice,
    handleChoosePlayerForTwoPileSplitChoice,
    handleChoosePlayerForLookedAtCardsChoice,
    handleOptionalDiscardThenDrawChoice,
    handleChooseManaColorsChoice,
    handleGrantPlayableFromExileChoice,
    handleReboundCastChoice,
    handleEtbPermanentOptionChoice,
    handleCounterPlacementTriggerChoice,
    handleTapOrUntapDecision,
    handleMoxDiamondStackChoice,
    handleSpellPaymentChoiceResponse,
    handleOpeningHandActionsResponse,
    handleHandToBottomResponse,
    tryHandleOptionChoiceEarlySpecialsPrefix,
    tryHandleOptionChoiceEarlySpecialsConfirmCastPayment,
    appendCastSpellContinuationEvent,
    createForwardingGameActionSocket,
    restartPlayerCastRequest,
    ...overrides,
  };
}

/** Active deps for the four cores; lazily creates defaults. */
export function getResolutionHandlerDeps(): ResolutionHandlerDeps {
  if (!activeDeps) activeDeps = createResolutionHandlerDeps();
  return activeDeps;
}

/** Test/override hook. Pass null to reset to lazy defaults. */
export function setResolutionHandlerDeps(deps: ResolutionHandlerDeps | null): void {
  activeDeps = deps;
}
