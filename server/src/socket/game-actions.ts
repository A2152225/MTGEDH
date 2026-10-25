import type { Server, Socket } from "socket.io";
import { emitPendingDamageTriggers as emitPendingDamageTriggersImpl } from "./damage-triggers.js";
import { debugError } from "../utils/debug.js";
import {
  handlePlayLandRequest,
  type PlayLandRequestPayload,
} from "./game-actions-handlers/gameActionsPlayLandRequest.js";
import { tryQueueRequestCastSpellNoTargetPayment } from "./game-actions-handlers/gameActionsRequestCastSpellNoTargetPayment.js";
import { tryResolveRequestCastSpellCandidateZone } from "./game-actions-handlers/gameActionsRequestCastSpellCandidateZone.js";
import { tryPromptRequestCastSpellModes } from "./game-actions-handlers/gameActionsRequestCastSpellModes.js";
import { tryComputeRequestCastSpellTargets } from "./game-actions-handlers/gameActionsRequestCastSpellTargets.js";
import { handleCastSpellFromHandRequest } from "./game-actions-handlers/gameActionsCastSpellFromHand.js";
import {
  handleClaimMyTurnRequest,
  handleNextStepRequest,
  handleNextTurnRequest,
  handleRandomizeStartingPlayerRequest,
  handleSkipToPhaseRequest,
} from "./game-actions-handlers/gameActionsTurnFlowSocketHandlers.js";
import {
  handleKeepHandRequest,
  handleMulliganRequest,
  handleRestartGameClearRequest,
  handleRestartGameRequest,
  handleUnkeepHandRequest,
} from "./game-actions-handlers/gameActionsPregameSocketHandlers.js";
import {
  handleAdjustLifeRequest,
  handleMillRequest,
  handleSetHouseRulesRequest,
  handleSetLifeRequest,
} from "./game-actions-handlers/gameActionsLifeMillHouseRulesSocketHandlers.js";
import { handleEquipAbilityRequest } from "./game-actions-handlers/gameActionsEquipAbilitySocketHandlers.js";
import {
  handleChangePermanentControlRequest,
  handleGraveyardTargetsRequest,
  handleOpponentSelectionRequest,
  handleSacrificeSelectionRequest,
} from "./game-actions-handlers/gameActionsBoardSelectionSocketHandlers.js";
import {
  handleReorderHandRequest,
  handleSetTurnDirectionRequest,
  handleShuffleHandRequest,
  handleUpdatePermanentPosRequest,
} from "./game-actions-handlers/gameActionsHandLayoutSocketHandlers.js";
import {
  handlePassPriorityRequest,
  handleResolveAllTriggersRequest,
} from "./game-actions-handlers/gameActionsPrioritySocketHandlers.js";
import { handleResolveIdenticalTriggersRequest } from "./game-actions-handlers/gameActionsResolveIdenticalTriggers.js";
import {
  handleCastForetoldRequest,
  handleForetellCardRequest,
  handlePhaseOutPermanentsRequest,
} from "./game-actions-handlers/gameActionsForetellPhaseOutSocketHandlers.js";
import { handleTurnFaceUpRequest } from "./game-actions-handlers/gameActionsTurnFaceUpSocketHandler.js";
import {
  handleConcedeRequest,
  handleSetTriggerShortcutRequest,
} from "./game-actions-handlers/gameActionsConcedeShortcutSocketHandlers.js";
import { registerAssistSocketHandlers } from "./assistPaymentFlow.js";
import { handleCompleteCastSpellRequest } from "./game-actions-handlers/gameActionsCompleteCastSpellSocketHandlers.js";
import { handleRequestCastSpellRequest } from "./game-actions-handlers/gameActionsRequestCastSpellSocketHandlers.js";

// Public compatibility surface: these moved to ./game-actions-handlers/ but stay
// importable from "./game-actions.js".
export {
  calculateConvokeOptions,
  calculateCostReduction,
  calculateStaticSourceGenericTax,
  extractCreatureTypes,
  getSharedStaticCostAdjustments,
} from "./game-actions-handlers/gameActionsCastCostReduction.js";
export type {
  CostReductionMetadata,
  PaymentStepCostAdjustment,
  PendingCastCostMetadata,
  SpellCastSourceZone,
  StaticCostTaxMetadata,
} from "./game-actions-handlers/gameActionsCastCostReduction.js";
export {
  applyCostAdjustment,
  applyCostReduction,
  buildAlternateCastSpellManaCost,
  buildPaymentCostAdjustmentPayload,
  buildPaymentStepCostAdjustment,
  buildPendingCastCostMetadata,
  formatManaCostWithCostAdjustment,
  formatManaCostWithReduction,
  formatSpellAlternateCostWithReduction,
  GRAVEYARD_ALTERNATE_CAST_ABILITY_IDS,
  isGraveyardAlternateCastAbilityId,
} from "./game-actions-handlers/gameActionsCastCostFormatting.js";
export {
  creatureHasHaste,
  permanentHasKeyword,
  permanentHasSummoningSickness,
} from "./game-actions-handlers/gameActionsPermanentKeywordGrants.js";
export {
  buildGroupedSpellTargetMetadata,
  buildSpellTargetListFromRequirements,
} from "./game-actions-handlers/gameActionsSpellTargetSelection.js";
export {
  consumeDelayedSpellCopiesForCast,
  processHeroicTriggersForTargets,
  processTargetedTriggersForSpellTargets,
} from "./game-actions-handlers/gameActionsSpellCopyHeroicTriggers.js";
export { recordSpellCastThisTurn } from "./game-actions-handlers/gameActionsSpellCastTriggerDetection.js";
export {
  processOpponentSpellCastTriggersForCast,
  processSpellCastTriggersForCast,
} from "./game-actions-handlers/gameActionsSpellCastTriggerProcessing.js";
export { runPostResolutionPermanentPromptChecks } from "./game-actions-handlers/gameActionsPermanentEntryPrompts.js";
export { isPlayerCompletingSpellCast } from "./game-actions-handlers/gameActionsSpellCastLock.js";
export { resolveEffectiveSpellBaseManaCost } from "./game-actions-handlers/gameActionsCastFaceAndMiracleSelection.js";
export { getSpellModeAdditionalCost } from "./game-actions-handlers/gameActionsModalCastModeCosts.js";
export { finalizePlayedLand, handlePlayLandRequest } from "./game-actions-handlers/gameActionsPlayLandRequest.js";
export {
  calculateHarmonizeOptions,
  getEffectiveAdditionalCost,
} from "./game-actions-handlers/gameActionsAdditionalCastCosts.js";

export const emitPendingDamageTriggers = emitPendingDamageTriggersImpl;

export async function requestCastSpellForSocket(
  io: Server,
  socket: Socket,
  payload?: {
    gameId?: unknown;
    cardId?: unknown;
    faceIndex?: unknown;
    fromZone?: unknown;
    castPermissionId?: unknown;
    permissionId?: unknown;
    graveyardPermissionId?: unknown;
  },
  options?: {
    skipPriorityCheck?: boolean;
    forcedAlternateCostId?: string;
    skipMutateModePrompt?: boolean;
    castWithoutPayingManaCost?: boolean;
    exileAfterResolution?: boolean;
    bypassExilePermissionCheck?: boolean;
    ignoreTimingRestrictions?: boolean;
    xValue?: number;
    timesKicked?: number;
    librarySearchStepToResume?: any;
  }
): Promise<void> {
  try {
    const candidateZone = tryResolveRequestCastSpellCandidateZone({
      io,
      socket,
      payload,
      options,
    });
    if (!candidateZone) return;
    const gameId = candidateZone.gameId;
    const cardId = candidateZone.cardId;
    const game = candidateZone.game;
    const playerId = candidateZone.playerId;
    const phaseStr = candidateZone.phaseStr;
    const hand = candidateZone.hand;
    let isFreeCast = candidateZone.isFreeCast;
    const bypassExilePermissionCheck = candidateZone.bypassExilePermissionCheck;
    let ignoreTimingRestrictions = candidateZone.ignoreTimingRestrictions;
    const castSourceZone = candidateZone.castSourceZone;
    const commanderCandidate = candidateZone.commanderCandidate;
    const cardInHand = candidateZone.cardInHand;
    const typeLine = candidateZone.typeLine;
    const cardForCast = candidateZone.cardForCast;
    const selectedFaceIndex = candidateZone.selectedFaceIndex;
    const effectiveTypeLine = candidateZone.effectiveTypeLine;
    const topLibraryPermission = candidateZone.topLibraryPermission;
    const oracleTextRaw = candidateZone.oracleTextRaw;
    let manaCost = candidateZone.manaCost;
    const cardName = candidateZone.cardName;
    const faceTypeLine = candidateZone.faceTypeLine;
    options = candidateZone.options;


    const modes = tryPromptRequestCastSpellModes({
      socket,
      game,
      gameId,
      playerId,
      cardId,
      cardInHand,
      cardForCast,
      cardName,
      selectedFaceIndex,
      castSourceZone,
      commanderCandidate,
      ignoreTimingRestrictions,
      isFreeCast,
      options,
      oracleTextRaw,
      manaCost,
      faceTypeLine,
      effectiveTypeLine,
      typeLine,
      topLibraryPermission,
      bypassExilePermissionCheck,
      phaseStr,
    });
    if (!modes) return;
    const giftInfo = modes.giftInfo;
    const giftPromised = modes.giftPromised;
    const giftRecipient = modes.giftRecipient;
    const giftType = modes.giftType;
    const oracleText = modes.oracleText;
    const spellModeAdditionalCost = modes.spellModeAdditionalCost;
    const entwineCost = modes.entwineCost;
    const chosenXValue = modes.chosenXValue;
    const chosenTimesKicked = modes.chosenTimesKicked;
    manaCost = modes.manaCost;
    const isForcedMutate = modes.isForcedMutate;
    const spellTypeLine = modes.spellTypeLine;
    const isInstantOrSorcery = modes.isInstantOrSorcery;
    const resolvedManaCost = modes.resolvedManaCost;


    const targets = tryComputeRequestCastSpellTargets({
      io,
      socket,
      game,
      gameId,
      playerId,
      cardId,
      cardName,
      cardInHand,
      cardForCast,
      oracleText,
      oracleTextRaw,
      resolvedManaCost,
      manaCost,
      entwineCost,
      spellModeAdditionalCost,
      chosenXValue,
      chosenTimesKicked,
      selectedFaceIndex,
      castSourceZone,
      commanderCandidate,
      isFreeCast,
      bypassExilePermissionCheck,
      ignoreTimingRestrictions,
      options,
      hand,
      giftInfo,
      giftPromised,
      giftRecipient,
      giftType,
      spellTypeLine,
      isInstantOrSorcery,
      isForcedMutate,
    });
    if (!targets) return;
    const effectId = targets.effectId;


    tryQueueRequestCastSpellNoTargetPayment({
      io,
      socket,
      game,
      gameId,
      playerId,
      cardId,
      cardName,
      cardInHand,
      cardForCast,
      oracleText,
      oracleTextRaw,
      effectId,
      resolvedManaCost,
      manaCost,
      entwineCost,
      spellModeAdditionalCost,
      chosenXValue,
      chosenTimesKicked,
      selectedFaceIndex,
      castSourceZone,
      commanderCandidate,
      isFreeCast,
      bypassExilePermissionCheck,
      ignoreTimingRestrictions,
      options,
      hand,
      giftInfo,
      giftPromised,
      giftRecipient,
      giftType,
    });

  } catch (err: any) {
    debugError(1, `[requestCastSpell] Error:`, err);
    socket.emit("error", {
      code: "REQUEST_CAST_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

export function registerGameActions(io: Server, socket: Socket) {
  const ensureInGameRoom = (
    gameId: string,
    {
      code = "NOT_IN_GAME",
      message = "You are not in this game.",
    }: { code?: string; message?: string } = {}
  ): boolean => {
    const socketGameId = (socket.data as any)?.gameId as string | undefined;
    if (socketGameId && socketGameId !== gameId) {
      socket.emit("error", { code, message });
      return false;
    }

    if (!(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit("error", { code, message });
      return false;
    }

    return true;
  };

  // Play land from hand
  socket.on("playLand", (payload?: PlayLandRequestPayload) => {
    // bypassGraveyardPermissionCheck is server-internal (resolution prompts); never trust it from a client.
    const { bypassGraveyardPermissionCheck: _clientBypass, ...clientPayload } = (payload || {}) as PlayLandRequestPayload;
    handlePlayLandRequest(io, socket, clientPayload);
  });

  // =====================================================================
  // REQUEST CAST SPELL - First step of MTG-compliant spell casting
  // MTG Rule 601.2: Choose targets (601.2c) before paying costs (601.2h)
  // This handler checks if targets are needed and requests them first,
  // then triggers payment after targets are selected.
  // =====================================================================
  socket.on("requestCastSpell", async (payload?: { gameId?: unknown; cardId?: unknown; faceIndex?: unknown; fromZone?: unknown }) =>
    handleRequestCastSpellRequest(io, socket, ensureInGameRoom, requestCastSpellForSocket, payload));

  // =====================================================================
  // CAST SPELL FROM HAND - Core spell casting handler
  // Defined as a named function so it can be called directly from completeCastSpell
  // =====================================================================
  const handleCastSpellFromHand = async (payload?: {
    gameId?: unknown;
    cardId?: unknown;
    faceIndex?: unknown;
    targets?: unknown;
    payment?: unknown;
    skipInteractivePrompts?: unknown;
      skipPriorityCheck?: unknown;
    xValue?: unknown;
    timesKicked?: unknown;
    alternateCostId?: unknown;
    selectedCastMode?: unknown;
    convokeTappedCreatures?: unknown;
    harmonizeTappedCreatureId?: unknown;
    sneakReturnedCreatureId?: unknown;
    webSlingingReturnedCreatureId?: unknown;
    fromZone?: unknown;
    bypassExilePermissionCheck?: unknown;
    ignoreTimingRestrictions?: unknown;
    allowLibrarySearchCast?: unknown;
    castPermissionId?: unknown;
    permissionId?: unknown;
    graveyardPermissionId?: unknown;
  }) => {
    await handleCastSpellFromHandRequest(io, socket, ensureInGameRoom, payload);

  };
  
  // =====================================================================
  // COMPLETE CAST SPELL - Final step after targets selected and payment made
  // Called after both target selection and payment are complete
  // =====================================================================
  socket.on("completeCastSpell", async (payload?: {
    gameId?: unknown;
    cardId?: unknown;
    faceIndex?: unknown;
    targets?: unknown;
    payment?: unknown;
    effectId?: unknown;
    xValue?: unknown;
    alternateCostId?: unknown;
    convokeTappedCreatures?: unknown;
    harmonizeTappedCreatureId?: unknown;
    sneakReturnedCreatureId?: unknown;
    webSlingingReturnedCreatureId?: unknown;
  }) => handleCompleteCastSpellRequest(io, socket, ensureInGameRoom, handleCastSpellFromHand, payload));

  // Assist (CR 702.132): caster asks another player to help pay generic mana
  registerAssistSocketHandlers(io, socket);

  // Cast spell from hand - registers the socket event handler
  socket.on("castSpellFromHand", handleCastSpellFromHand);

  // Pass priority
  socket.on("passPriority", async (payload?: { gameId?: unknown; isAutoPass?: unknown }) =>
    handlePassPriorityRequest(io, socket, ensureInGameRoom, payload));

  socket.on("resolveAllTriggers", (payload?: { gameId?: unknown }) =>
    handleResolveAllTriggersRequest(io, socket, ensureInGameRoom, payload));

  // "Resolve all identical (xN)": batch a run of identical no-choice triggers.
  socket.on("resolveIdenticalTriggers", (payload?: { gameId?: unknown; count?: unknown }) =>
    handleResolveIdenticalTriggersRequest(io, socket, ensureInGameRoom, payload));

  // Claim turn (pre-game only) - set yourself as active player when pre-game and turnPlayer is unset.
  socket.on("claimMyTurn", (payload?: { gameId?: unknown }) =>
    handleClaimMyTurnRequest(io, socket, ensureInGameRoom, payload));

  // Randomize starting player
  socket.on("randomizeStartingPlayer", (payload?: { gameId?: unknown }) =>
    handleRandomizeStartingPlayerRequest(io, socket, ensureInGameRoom, payload));

  // Next turn
  socket.on("nextTurn", (payload?: { gameId?: unknown }) =>
    handleNextTurnRequest(io, socket, ensureInGameRoom, payload));

  // Next step handler
  // Per MTG rules, "next step" should pass priority. The step only advances
  // when ALL players pass priority in succession with an empty stack.
  socket.on("nextStep", (payload?: { gameId?: unknown }) =>
    handleNextStepRequest(io, socket, ensureInGameRoom, payload));

  // Skip to a specific phase (used when player wants to skip combat entirely)
  // This allows jumping from pre-combat to post-combat without going through combat steps
  // IMPORTANT: This also handles turn-based actions when skipping phases:
  // - Untapping when skipping from UNTAP
  // - Drawing a card when skipping from before DRAW to MAIN1 or later
  socket.on("skipToPhase", (payload?: {
    gameId?: unknown;
    targetPhase?: unknown;
    targetStep?: unknown;
  }) => handleSkipToPhaseRequest(io, socket, ensureInGameRoom, payload));
  // Shuffle player's hand (server-authoritative) — randomize order of cards in hand.
  socket.on("shuffleHand", (payload?: { gameId?: unknown }) =>
    handleShuffleHandRequest(io, socket, ensureInGameRoom, payload));

  // Reorder player's hand based on drag-and-drop
  socket.on("reorderHand", (payload?: { gameId?: unknown; order?: unknown }) =>
    handleReorderHandRequest(io, socket, ensureInGameRoom, payload));

  socket.on("updatePermanentPos", (payload?: {
    gameId?: unknown;
    permanentId?: unknown;
    x?: unknown;
    y?: unknown;
    z?: unknown;
  }) => handleUpdatePermanentPosRequest(io, socket, ensureInGameRoom, payload));

  // Set turn direction (+1 or -1)
  socket.on("setTurnDirection", (payload?: { gameId?: unknown; direction?: unknown }) =>
    handleSetTurnDirectionRequest(io, socket, ensureInGameRoom, payload));

  // Restart (keep roster/players)
  socket.on("restartGame", (payload?: { gameId?: unknown }) =>
    handleRestartGameRequest(io, socket, ensureInGameRoom, payload));

  // Restart (clear roster/players)
  socket.on("restartGameClear", (payload?: { gameId?: unknown }) =>
    handleRestartGameClearRequest(io, socket, ensureInGameRoom, payload));

  // ============================================================================
  // Mulligan Actions (Pre-Game Phase)
  // ============================================================================

  // Keep hand - player accepts their current hand
  // If mulligans were taken, this triggers the London Mulligan bottom selection
  socket.on("keepHand", (payload?: { gameId?: unknown }) =>
    handleKeepHandRequest(io, socket, ensureInGameRoom, payload));

  socket.on("unkeepHand", (payload?: { gameId?: unknown }) =>
    handleUnkeepHandRequest(io, socket, ensureInGameRoom, payload));

  // Mulligan - player shuffles hand back and draws a new hand (minus one card)
  socket.on("mulligan", (payload?: { gameId?: unknown }) =>
    handleMulliganRequest(io, socket, ensureInGameRoom, payload));

  // ============================================================================
  // Life Total Adjustment
  // ============================================================================

  /**
   * Adjust a player's life total by a delta (positive for gain, negative for loss)
   */
  socket.on("adjustLife", (payload?: {
    gameId?: unknown;
    delta?: unknown;
    targetPlayerId?: unknown;
  }) => handleAdjustLifeRequest(io, socket, ensureInGameRoom, payload));

  /**
   * Set a player's life total to a specific value
   */
  socket.on("setLife", (payload?: {
    gameId?: unknown;
    life?: unknown;
    targetPlayerId?: unknown;
  }) => handleSetLifeRequest(io, socket, ensureInGameRoom, payload));

  // ============================================================================
  // Mill (put cards from library to graveyard)
  // ============================================================================

  /**
   * Mill a number of cards from a player's library to their graveyard
   * Rule 701.17: For a player to mill a number of cards, that player puts that
   * many cards from the top of their library into their graveyard.
   */
  socket.on("mill", (payload?: {
    gameId?: unknown;
    count?: unknown;
    targetPlayerId?: unknown;
  }) => handleMillRequest(io, socket, ensureInGameRoom, payload));

  // ============================================================================
  // House Rules Configuration (Pre-Game)
  // ============================================================================

  /**
   * Set house rules for a game during pre-game phase.
   * House rules can only be set before the game starts.
   */
  socket.on("setHouseRules", (payload?: {
    gameId?: unknown;
    houseRules?: unknown;
  }) => handleSetHouseRulesRequest(io, socket, ensureInGameRoom, payload));

  // Legacy Miracle socket handlers removed � Miracle is handled via the Resolution Queue.

  // Legacy modeSelectionConfirm handler removed - now handled via Resolution Queue (mode_selection).

  // Legacy modalSpellConfirm/abundantChoiceConfirm/additionalCostConfirm/squadCostConfirm handlers removed.
  // These prompts are now handled via Resolution Queue steps:
  // - mode_selection (purpose: modalSpell/spree/overload/abundantChoice)
  // - additional_cost_payment
  // - squad_cost_payment

  // Legacy MDFC face selection confirm handler removed - now handled via Resolution Queue (resolutionStepPrompt).

  // Handle equip ability - prompts player to select creature to attach equipment to
  // Flow: selectTarget -> promptManaPayment -> confirmPayment -> attach
  socket.on("equipAbility", (payload?: {
    gameId?: unknown;
    equipmentId?: unknown;
    targetCreatureId?: unknown;
    paymentConfirmed?: unknown;
  }) => handleEquipAbilityRequest(io, socket, ensureInGameRoom, payload));
  
  // Handle equip payment confirmation - player has paid the mana cost
  // Legacy confirmEquipPayment flow removed (equip now resolves via Resolution Queue target selection).

  // ==========================================================================
  // FORETELL SUPPORT
  // ==========================================================================
  
  /**
   * Handle foretelling a card from hand (exile face-down for {2})
   * Foretell: Exile this card from your hand face-down for {2}. 
   * You may cast it later for its foretell cost.
   */
  socket.on("foretellCard", (payload?: { gameId?: unknown; cardId?: unknown }) =>
    handleForetellCardRequest(io, socket, ensureInGameRoom, payload));
  // Client TableLayout historically emitted "foretell"; keep the alias so the click is not dropped.
  socket.on("foretell", (payload?: { gameId?: unknown; cardId?: unknown }) =>
    handleForetellCardRequest(io, socket, ensureInGameRoom, payload));

  // Morph / megamorph / disguise / manifest: turn face up (special action, no stack).
  socket.on("turnFaceUp", (payload?: { gameId?: unknown; permanentId?: unknown; revealCardId?: unknown }) =>
    handleTurnFaceUpRequest(io, socket, ensureInGameRoom, payload));

  socket.on("castForetold", async (payload?: { gameId?: unknown; cardId?: unknown }) =>
    handleCastForetoldRequest(io, socket, ensureInGameRoom, handleCastSpellFromHand, payload));

  // ==========================================================================
  // PHASE OUT SUPPORT
  // ==========================================================================
  
  /**
   * Handle phase out effect (Clever Concealment, Teferi's Protection, etc.)
   */
  socket.on("phaseOutPermanents", (payload?: { gameId?: unknown; permanentIds?: unknown }) =>
    handlePhaseOutPermanentsRequest(io, socket, ensureInGameRoom, payload));
  // ==========================================================================
  // GRAVEYARD TARGET SELECTION (Resolution Queue)
  // ==========================================================================

  /**
   * Legacy entrypoint: Request graveyard card selection.
   * This previously emitted a bespoke `graveyardTargetsResponse` and expected a
   * bespoke `confirmGraveyardTargets` follow-up. It now enqueues a Resolution Queue
   * step so the unified interaction UI can handle it.
   */
  socket.on("requestGraveyardTargets", (payload?: {
    gameId?: unknown;
    effectId?: unknown;
    cardName?: unknown;
    filter?: unknown;
    minTargets?: unknown;
    maxTargets?: unknown;
    targetPlayerId?: unknown;
    destination?: unknown;
    title?: unknown;
    description?: unknown;
  }) => handleGraveyardTargetsRequest(io, socket, ensureInGameRoom, payload));

  // ==========================================================================
  // OPPONENT SELECTION (Secret Rendezvous, etc.)
  // ==========================================================================
  
  /**
   * Request opponent selection for effects like Secret Rendezvous
   */
  socket.on("requestOpponentSelection", (payload?: {
    gameId?: unknown;
    effectId?: unknown;
    cardName?: unknown;
    description?: unknown;
    minOpponents?: unknown;
    maxOpponents?: unknown;
  }) => handleOpponentSelectionRequest(io, socket, ensureInGameRoom, payload));

  // ==========================================================================
  // SACRIFICE SELECTION FOR EDICT EFFECTS (Grave Pact, Dictate of Erebos, etc.)
  // ==========================================================================
  
  /**
   * Request sacrifice selection from a player due to an edict effect
   */
  socket.on("requestSacrificeSelection", async (payload?: {
    gameId?: unknown;
    effectId?: unknown;
    sourceName?: unknown;
    targetPlayerId?: unknown;
    permanentType?: unknown;
    count?: unknown;
  }) => handleSacrificeSelectionRequest(io, socket, ensureInGameRoom, payload));

  // ==========================================================================
  // CONTROL CHANGE (Humble Defector, Act of Treason, etc.)
  // ==========================================================================
  
  /**
   * Change control of a permanent from one player to another.
   * Used by effects like Humble Defector, Act of Treason, Dominate, etc.
   */
  socket.on("changePermanentControl", (payload?: {
    gameId?: unknown;
    permanentId?: unknown;
    newController?: unknown;
    duration?: unknown;
  }) => handleChangePermanentControlRequest(io, socket, ensureInGameRoom, payload));
  /**
   * Handle player conceding the game.
   * 
   * When a player concedes:
   * 1. They are marked as eliminated/conceded immediately
   * 2. Their permanents remain on the battlefield until their next turn would begin
   * 3. On their next turn, all their permanents are exiled and their turn is skipped
   * 4. If only one player remains, that player wins
   */
  socket.on("concede", (payload?: { gameId?: unknown }) =>
    handleConcedeRequest(io, socket, ensureInGameRoom, payload));

  /**
   * Set a trigger shortcut preference for a player.
   * This allows players to set automatic responses for "may" triggers
   * and "opponent may pay" triggers like Smothering Tithe.
   */
  socket.on("setTriggerShortcut", async (payload?: {
    gameId?: unknown;
    cardName?: unknown;
    preference?: unknown;
    triggerDescription?: unknown;
  }) => handleSetTriggerShortcutRequest(io, socket, ensureInGameRoom, payload));

  // Legacy bespoke mutate socket handlers removed.
  // Mutate cast mode + target selection are handled via the Resolution Queue.
}
