/**
 * socket/resolution-handlers/optionChoiceResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse core).
 * Cluster moved: the remaining OPTION_CHOICE dispatcher (early specials and prompt
 * flags already behind deps).
 * Public entry symbols: handleOptionChoiceResponse.
 *
 * Direct leaf import from resolution.ts (calls getResolutionHandlerDeps). Must not
 * import resolution.ts.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { getNextEndStepFireTurnNumberForResolution, getNextUpkeepNotBeforeTurnNumberForResolution } from "../resolutionGraveyardSelectionHelperUtils.js";
import { getResolutionHandlerDeps } from "../resolutionHandlerDeps.js";
import {
  handleMayAbilityResponse,
  handleOptionalTriggeredAbilityChoiceResponse,
  isOptionalTriggeredEffectProgramStep,
} from "./mayAbilityAndOptionalTriggerHandlers.js";
import { handleMayRevealHandWinIfOwnNamedChoice } from "./optionChoiceMayRevealHandWinHandlers.js";
import { sanitizeStepForClient } from "./sanitizeStepForClient.js";
import { tryHandleSkipDrawReplacementChoice } from "../resolutionOptionChoiceSkipDrawReplacementHandlers.js";

/** OPTION_CHOICE: dispatch the chosen prompt flag to the specialized handler. */
/**
 * Handle option choice response (for generic "choose one" effects)
 * Used by Agitator Ant, modal spells, Rebound, etc.
 */
export async function handleOptionChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const selectedOption = response.selections;
  const stepData = step as any;
  const playerId = response.playerId;
  
  debug(2, `[Resolution] Option choice response from ${playerId}: ${selectedOption}`);

  if (await tryHandleSkipDrawReplacementChoice(io, game, gameId, step, response)) {
    return;
  }

  const extractId = (sel: any): string | null => {
    if (typeof sel === 'string') return sel;
    if (Array.isArray(sel) && sel.length > 0) return typeof sel[0] === 'string' ? sel[0] : (sel[0] as any)?.id || null;
    if (sel && typeof sel === 'object') return (sel as any).id || (sel as any).value || null;
    return null;
  };

    if (await getResolutionHandlerDeps().tryHandleOptionChoiceEarlySpecialsPrefix(io, game, gameId, step, response)) {
    return;
  }

  if (await getResolutionHandlerDeps().tryHandleOptionChoiceEarlySpecialsConfirmCastPayment(io, game, gameId, step, response)) {
    return;
  }

  if (stepData?.mayRevealHandWinIfOwnNamedChoice === true) {
    await handleMayRevealHandWinIfOwnNamedChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.optionalTriggeredAbilityPrompt === true || isOptionalTriggeredEffectProgramStep(step)) {
    await handleOptionalTriggeredAbilityChoiceResponse(io, game, gameId, step, response);
    return;
  }

  if (stepData?.mayAbilityPrompt === true) {
    await handleMayAbilityResponse(io, game, gameId, step, response);
    return;
  }

  // ===== SACRIFICE UNLESS YOU PAY (legacy raw step compatibility) =====
  if (stepData?.sacrificeUnlessPayChoice === true) {
    await getResolutionHandlerDeps().handleSacrificeUnlessPayChoice(io, game, gameId, step, response);
    return;
  }

  // ===== FORCE OF WILL / FORCE OF NEGATION STYLE ALTERNATE COST =====
  // Exile a blue card from hand (and optionally pay 1 life), then resume the cast.
  if (stepData?.forceOfWillExileChoice === true) {
    await getResolutionHandlerDeps().handleForceOfWillExileChoice(io, game, gameId, step, response);
    return;
  }

  // ===== OPPONENT MAY PAY: prompt-deciding player to pay or decline =====
  if (stepData?.opponentMayPayChoice === true) {
    getResolutionHandlerDeps().handleOpponentMayPayChoice(io, game, gameId, step, response);
    return;
  }

  // ===== SHOCK LANDS: pay 2 life or enter tapped =====
  if (stepData?.shockLandChoice === true) {
    await getResolutionHandlerDeps().handleShockLandChoice(io, game, gameId, step, response);
    return;
  }

  // ===== REVEAL LANDS (Snarl lands): reveal a matching land from hand or enter tapped =====
  if (stepData?.revealLandChoice === true) {
    await getResolutionHandlerDeps().handleRevealLandChoice(io, game, gameId, step, response);
    return;
  }

  // ===== LAND WOULD-ENTER (replacement effect): sacrifice lands or it goes to graveyard =====
  if (stepData?.landWouldEnterSacrificeChoice === true) {
    await getResolutionHandlerDeps().handleLandWouldEnterSacrificeChoice(io, game, gameId, step, response);
    return;
  }

  // ===== WOULD-ENTER DISCARD LAND (replacement effect): discard a land or it goes to graveyard =====
  if (stepData?.moxDiamondChoice === true) {
    await getResolutionHandlerDeps().handleMoxDiamondChoice(io, game, gameId, step, response);
    return;
  }

  // ===== WARD: Pay ward cost (mana + common non-mana) =====
  if (stepData?.wardPayment === true) {
    await getResolutionHandlerDeps().handleWardPaymentOptionChoice(io, game, gameId, step, response);
    return;
  }

  // ===== SPELL CASTING: Additional cost — "Blight N or pay {X}" =====
  if (stepData?.spellAdditionalCostBlightOrPay === true) {
    await getResolutionHandlerDeps().handleSpellAdditionalCostBlightOrPayChoice(io, game, gameId, step, response);
    return;
  }

  // ===== COMBAT: ATTACK TAX (Ghostly Prison / Propaganda style) =====
  // Applied in processAttackCostPaymentBeforeStepComplete before the step is consumed.
  if (stepData?.attackCostPayment === true) {
    return;
  }

  // ===== COMBAT: BLOCK TAX (Archangel of Tithes while attacking) =====
  // Applied in processBlockCostPaymentBeforeStepComplete before the step is consumed.
  if (stepData?.blockCostPayment === true) {
    return;
  }

  if (stepData?.chooseDiscardPlanChoice === true) {
    await getResolutionHandlerDeps().handleChooseDiscardPlanChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.choosePlayerForTwoPileSplitChoice === true) {
    await getResolutionHandlerDeps().handleChoosePlayerForTwoPileSplitChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData.grantPlayableFromExileChoice === true) {
    await getResolutionHandlerDeps().handleGrantPlayableFromExileChoice(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: "You may play <that card> from your graveyard." =====
  if (stepData.playFromGraveyardCardId && stepData.playFromGraveyardCard) {
    await getResolutionHandlerDeps().handlePlayFromGraveyardPromptChoice(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: "You may cast <that card> from your graveyard." =====
  if (stepData.castFromGraveyardCardId && stepData.castFromGraveyardCard) {
    await getResolutionHandlerDeps().handleCastFromGraveyardPromptChoice(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: "You may cast <that card> from exile without paying its mana cost." =====
  // Used by planeswalker templates and other effects that exile a card then offer a free cast.
  if (stepData.danceWithCalamityCastPrompt === true && stepData.castFromExileCardId && stepData.castFromExileCard) {
    await getResolutionHandlerDeps().handleDanceWithCalamityCastPrompt(io, game, gameId, step, response);
    return;
  }

  if (stepData.castFromExileCardId && stepData.castFromExileCard) {
    await getResolutionHandlerDeps().handleCastFromExilePromptChoice(io, game, gameId, step, response, {
      sanitizeStepForClient,
    });
    return;
  }

  if (stepData?.moveChosenHandCardToLibraryChoice === true) {
    await getResolutionHandlerDeps().handleMoveChosenHandCardToLibraryChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.sacrificeAnotherPermanentForBenefitChoice === true) {
    await getResolutionHandlerDeps().handleSacrificeAnotherPermanentForBenefitAskChoice(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: "You may exile it. When/If you do, ..." for death-triggered graveyard bindings =====
  if (stepData?.reflexiveBoundGraveyardSelfExileWhenYouDo === true) {
    getResolutionHandlerDeps().handleReflexiveBoundGraveyardSelfExileWhenYouDo(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: "You may put N cards ... from exile into ... graveyard. If/When you do, ..." (processors) =====
  if (stepData?.reflexiveExileToOwnersGraveyardWhenYouDo === true) {
    await getResolutionHandlerDeps().handleReflexiveExileToOwnersGraveyardWhenYouDo(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: "You may exile a card from your graveyard. When you do, ..." =====
  if (stepData?.reflexiveGraveyardExileWhenYouDo === true) {
    getResolutionHandlerDeps().handleReflexiveGraveyardExileWhenYouDo(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: "You may discard a card. When you do, ..." =====
  if (stepData?.reflexiveDiscardWhenYouDo === true) {
    getResolutionHandlerDeps().handleReflexiveDiscardWhenYouDo(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: "You may sacrifice a <Subtype>. When you do, ..." =====
  if (stepData?.sacrificeWhenYouDo === true) {
    getResolutionHandlerDeps().handleSacrificeWhenYouDoAskChoice(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: Attach an Equipment you control to a target permanent =====
  if (stepData?.attachEquipmentToPermanentChoice === true) {
    await getResolutionHandlerDeps().handleAttachEquipmentToPermanentChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.dungeonRoomPenaltyChoice) {
    await getResolutionHandlerDeps().handleDungeonRoomPenaltyChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.dungeonRoomFreeCastFromHandChoice) {
    await getResolutionHandlerDeps().handleDungeonRoomFreeCastFromHandChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.dungeonRoomThroneChoice) {
    await getResolutionHandlerDeps().handleDungeonRoomThroneChoice(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: Venture into the dungeon =====
  if (stepData?.ventureIntoDungeon === true) {
    getResolutionHandlerDeps().handleVentureIntoDungeonChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.ventureChooseDungeon === true) {
    getResolutionHandlerDeps().handleVentureChooseDungeonChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.ventureChooseRoom === true) {
    getResolutionHandlerDeps().handleVentureChooseRoomChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.resolvedSpellCopyChoice === true) {
    await getResolutionHandlerDeps().handleResolvedSpellCopyChoice(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: Retarget a copied spell =====
  if (stepData?.retargetSpellCopy === true) {
    await getResolutionHandlerDeps().handleRetargetSpellCopyChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.retargetAbilityCopy === true) {
    await getResolutionHandlerDeps().handleRetargetAbilityCopyChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.chooseLookedAtCardsDestinationChoice === true) {
    await getResolutionHandlerDeps().handleChooseLookedAtCardsDestinationChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.payManaToLookAndChooseCardChoice === true) {
    await getResolutionHandlerDeps().handlePayManaToLookAndChooseCardChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.choosePileFromSplitChoice === true && (stepData?.choosePileFromSplitPileA || stepData?.choosePileFromSplitPileB)) {
    await getResolutionHandlerDeps().handleChoosePileFromSplitChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.optionalDiscardThenDrawChoice === true) {
    await getResolutionHandlerDeps().handleOptionalDiscardThenDrawChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.chooseManaColorsChoice === true) {
    await getResolutionHandlerDeps().handleChooseManaColorsChoice(io, game, gameId, step, response);
    return;
  }

  if (stepData?.choosePlayerForLookedAtCardsChoice === true) {
    await getResolutionHandlerDeps().handleChoosePlayerForLookedAtCardsChoice(io, game, gameId, step, response);
    return;
  }
  
  // ===== REBOUND HANDLING =====
  // Handle rebound trigger resolution - player may cast the spell from exile
  if (stepData.reboundCardId && stepData.reboundCard) {
    await getResolutionHandlerDeps().handleReboundCastChoice(io, game, gameId, step, response);
    return;
  }
  
  // Check if this is an ETB permanent option choice (e.g., "choose flying or first strike")
  if (stepData.permanentId) {
    await getResolutionHandlerDeps().handleEtbPermanentOptionChoice(io, game, gameId, step, response);
    return;
  }

  // Handle counter placement triggers (Agitator Ant, Orzhov Advokist, etc.)
  // SCALABLE: Supports "each player may X. If a player does, Y" pattern
  // Works for any card with conditional effects based on player choices
  if (stepData.counterPlacementTrigger || stepData.agitatorAntTrigger) {
    getResolutionHandlerDeps().handleCounterPlacementTriggerChoice(io, game, gameId, step, response);
  }

  // Handle tap/untap decision
  if ((step as any).action === 'tap_or_untap_decision') {
    await getResolutionHandlerDeps().handleTapOrUntapDecision(io, game, gameId, step, response);
    return;
  }

  if ((step as any).action === 'mox_diamond_choice') {
    await getResolutionHandlerDeps().handleMoxDiamondStackChoice(io, game, gameId, step, response);
    return;
  }
}
