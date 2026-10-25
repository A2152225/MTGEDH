/**
 * socket/resolution-handlers/targetSelectionResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse core).
 * Cluster moved: the remaining TARGET_SELECTION dispatcher (validation, blight/crew/enlist
 * and other specialized branches already behind deps, then generic complete).
 * Public entry symbols: handleTargetSelectionResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { canPermanentBeTargetedByPlayer } from "../../rules-engine/targeting";
import { maybeApplyOracleIrChoiceStepFromResolution, maybeResumeOracleIRStepsAfterResolution } from "../../state/modules/oracleIrServerZoneSync.js";
import {
  persistTargetedTriggeredStackItems,
  triggerPermanentTargetedTriggersFromAbility,
} from "../../state/modules/triggers/targeted.js";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
  type TargetSelectionStep,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { validateGroupedTargetSelections, validatePerOpponentTargetSelections } from "../perOpponentTargetValidation.js";
import { getResolutionHandlerDeps } from "../resolutionHandlerDeps.js";
import { broadcastGame } from "../util.js";
import { emitPendingCastPaymentIfNeeded } from "./resolutionPendingCastPaymentPrompt.js";
import { BLIGHT_TARGET_SELECTION_STAGES } from "./targetSelectionBlightKeywordHandlers.js";
import { handleUpkeepPaidUntapSelection } from "./upkeepPaidUntapSelectionHandler.js";
import { violatesFlagbearerRequirement } from "../../state/modules/flagbearerTargeting.js"; // B29
import { handleUntapCapChoiceSelection } from "./untapCapChoiceSelectionHandler.js";

/** TARGET_SELECTION: validate selections then dispatch to the specialized branch. */
export async function handleTargetSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];

  if ((step as any)?.oracleIrAnyPlayerMayPaymentSelection === true) {
    getResolutionHandlerDeps().handleOracleIrAnyPlayerMayPaymentSelection(io, game, gameId, step, response);
    return;
  }
  
  if (!Array.isArray(selections)) {
    debugWarn(1, `[Resolution] Invalid target selections: not an array`);
    return;
  }
  
  // Get target step data for validation
  const targetStepData = step as TargetSelectionStep;
  const validTargets = targetStepData.validTargets || [];
  const minTargets = targetStepData.minTargets || 0;
  const maxTargets = targetStepData.maxTargets || Infinity;

  if ((step as any).oracleIrLibraryChaosTargetSelection === true) {
    getResolutionHandlerDeps().handleOracleIrLibraryChaosTargetSelection(io, game, gameId, step, response);
    return;
  }

  // emitPendingCastPaymentIfNeeded -> resolution-handlers/resolutionPendingCastPaymentPrompt

  // Cancellation-aware handling for special TARGET_SELECTION steps.
  if (response.cancelled) {
    getResolutionHandlerDeps().handleCancelledTargetSelectionResponse(io, game, gameId, step, response);
    return;
  }

  // Disallow selecting the same target multiple times.
  // The client already prevents duplicates via Set-based selection, but enforce server-side as well.
  const uniqueSelections = Array.from(new Set(selections));
  if (uniqueSelections.length !== selections.length) {
    debugWarn(1, `[Resolution] Invalid target selection: duplicate target id(s) selected`);
    return;
  }
  
  // Validate selection count is within bounds
  if (selections.length < minTargets || selections.length > maxTargets) {
    debugWarn(1, `[Resolution] Invalid target count: got ${selections.length}, expected ${minTargets}-${maxTargets}`);
    return;
  }
  
  // Validate all selected targets are in valid targets list
  const validTargetIds = new Set(validTargets.map((t: any) => String(t.id)));
  const normalizedSelections = selections.map((id: any) => String(id));
  if (!normalizedSelections.every(id => validTargetIds.has(id))) {
    debugWarn(1, `[Resolution] Invalid target selection: one or more targets not in valid targets list (got=${JSON.stringify(selections)})`);
    return;
  }
  if (violatesFlagbearerRequirement(game.state, String(pid), step, normalizedSelections)) {
    debugWarn(1, `[Resolution] Invalid target selection: must choose at least one Flagbearer (got=${JSON.stringify(selections)})`);
    io.to(gameId).emit("chat", { id: `m_${Date.now()}`, gameId, from: "system", message: "You must choose at least one Flagbearer as a target if able.", ts: Date.now() });
    return;
  }
  if ((step as any)?.upkeepPaidUntapSelection === true) {
    handleUpkeepPaidUntapSelection(io, game, gameId, step, String(pid), normalizedSelections);
    return;
  }
  if ((step as any)?.untapCapChoice === true) {
    handleUntapCapChoiceSelection(io, game, gameId, step, String(pid), normalizedSelections);
    return;
  }
  const targetGrouping = (step as any)?.targetGrouping;
  if (targetGrouping?.groupBy === 'controller' && Array.isArray(targetGrouping.groups)) {
    const groupedError = validateGroupedTargetSelections({
      selections: uniqueSelections,
      validTargets: validTargets.map((target: any) => ({
        id: String(target.id || ''),
        controller: String(target.controller || ''),
      })),
      groups: targetGrouping.groups.map((group: any) => ({
        playerId: String(group.playerId || ''),
        targets: Array.isArray(group.targets)
          ? group.targets.map((target: any) => ({
              id: String(target.id || ''),
              controller: String(target.controller || group.playerId || ''),
            }))
          : [],
        minTargets: Number(group.minTargets ?? targetGrouping.minTargetsPerGroup ?? 0),
        maxTargets: Number(group.maxTargets ?? targetGrouping.maxTargetsPerGroup ?? 1),
        required: group.required === true,
      })),
      minTargetsPerGroup: Number(targetGrouping.minTargetsPerGroup ?? 0),
      maxTargetsPerGroup: Number(targetGrouping.maxTargetsPerGroup ?? 1),
    });
    if (groupedError) {
      debugWarn(1, `[Resolution] Invalid grouped target selection: ${groupedError}`);
      return;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    for (const selectedId of uniqueSelections) {
      const option = validTargets.find((target: any) => String(target.id) === String(selectedId)) as any;
      if (option?.type !== 'permanent' && option?.description !== 'permanent') continue;
      const permanent = battlefield.find((entry: any) => String(entry?.id || '') === String(selectedId));
      if (
        !permanent ||
        String(permanent.controller || '') !== String(option.controller || '') ||
        !canPermanentBeTargetedByPlayer(permanent, game.state as any, pid as any)
      ) {
        debugWarn(1, `[Resolution] Grouped target is no longer legal: ${selectedId}`);
        return;
      }
    }
  } else if ((step as any)?.perOpponent === true) {
    const perOpponentError = validatePerOpponentTargetSelections({
      selections: uniqueSelections,
      validTargets: validTargets.map((target: any) => ({
        id: String(target.id || ''),
        controller: String(target.controller || ''),
      })),
      targetsPerOpponent: ((step as any).targetsPerOpponent || {}) as Record<string, readonly { id: string }[]>,
      minTargetsPerOpponent: Number((step as any).minTargetsPerOpponent ?? 0),
      maxTargetsPerOpponent: Number((step as any).maxTargetsPerOpponent ?? 1),
    });
    if (perOpponentError) {
      debugWarn(1, `[Resolution] Invalid per-opponent target selection: ${perOpponentError}`);
      return;
    }
  }

  // ========================================================================
  // CREW (Vehicle activated ability)
  // These are enqueued as TARGET_SELECTION steps with crewAbility metadata.
  // ========================================================================
  const stepAny = step as any;
  if (stepAny?.divineReckoningChoice === true) {
    await getResolutionHandlerDeps().handleDivineReckoningChoiceTargetSelection(io, game, gameId, step, response);
    return;
  }

  if (stepAny?.dungeonRoomPayment?.paymentType === 'sacrifice') {
    await getResolutionHandlerDeps().handleDungeonRoomSacrificePayment(io, game, gameId, step, response);
    return;
  }

  if (stepAny?.dungeonTargetCreatureEffect) {
    await getResolutionHandlerDeps().handleDungeonTargetCreatureEffect(io, game, gameId, step, response);
    return;
  }

  if (stepAny?.targetedTriggeredAbility === true) {
    getResolutionHandlerDeps().handleTargetedTriggeredAbilityTargetSelection(io, game, gameId, step, response);
    return;
  }

  if (stepAny?.exertTargetChoice === true) {
    getResolutionHandlerDeps().handleExertTargetChoiceTargetSelection(io, game, gameId, step, response);
    return;
  }

  if (stepAny?.retargetAbilityCopyTargetSelection === true) {
    await getResolutionHandlerDeps().handleRetargetAbilityCopyTargetSelection(io, game, gameId, step, response);
    return;
  }

  if (stepAny?.retargetSpellCopyTargetSelection === true) {
    await getResolutionHandlerDeps().handleRetargetSpellCopyTargetSelection(io, game, gameId, step, response);
    return;
  }

  const crewHandled = await getResolutionHandlerDeps()
    .tryHandleCrewAbilityTargetSelection(io, game, gameId, step, response);
  if (crewHandled) return;

  // ========================================================================
  // ENLIST (attacks trigger)
  // These are enqueued as TARGET_SELECTION steps with enlistChoice metadata.
  // ========================================================================
  if (stepAny?.enlistChoice === true) {
    await getResolutionHandlerDeps().handleEnlistChoiceTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ========================================================================
  // SACRIFICE SELECTION (Grave Pact / Dictate of Erebos variants, etc.)
  // These are enqueued as TARGET_SELECTION steps with sacrificeSelection metadata.
  // ========================================================================
  if (stepAny?.sacrificeSelection === true && stepAny?.graveyardCastSacrificeAsCost !== true) {
    await getResolutionHandlerDeps().handleSacrificeSelectionTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ========================================================================
  // SACRIFICE AS AN ACTIVATION COST (battlefield abilities)
  // These are enqueued as TARGET_SELECTION steps with sacrificeAbilityAsCost metadata.
  // ========================================================================
  if (stepAny?.sacrificeAbilityAsCost === true) {
    await getResolutionHandlerDeps().handleSacrificeAbilityAsCostTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ========================================================================
  // REMOVE COUNTERS AS AN ACTIVATION COST (battlefield abilities)
  // Enqueued as TARGET_SELECTION steps with removeCountersAbilityAsCost metadata.
  // ========================================================================
  if (stepAny?.removeCountersAbilityAsCost === true) {
    await getResolutionHandlerDeps().handleRemoveCountersAbilityAsCostTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ========================================================================
  // RETURN TO HAND AS AN ACTIVATION COST (battlefield abilities)
  // Enqueued as TARGET_SELECTION steps with returnToHandAbilityAsCost metadata.
  // ========================================================================
  if (stepAny?.returnToHandAbilityAsCost === true) {
    await getResolutionHandlerDeps().handleReturnToHandAbilityAsCostTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ========================================================================
  // TARGETED BATTLEFIELD ABILITY CONTINUATION AFTER INTERACTIVE COST PAYMENT
  // ========================================================================
  if (stepAny?.battlefieldAbilityTargetSelection === true) {
    await getResolutionHandlerDeps().handleBattlefieldAbilityTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ========================================================================
  // DAMAGE-RECEIVED TRIGGER TARGETING (Brash Taunter, Boros Reckoner, etc.)
  // These triggers normally arrive here as direct TARGET_SELECTION queue steps.
  // Legacy pendingDamageTriggers are still supported as a fallback path.
  // ========================================================================
  if (stepAny?.damageReceivedTrigger === true) {
    getResolutionHandlerDeps().handleDamageReceivedTriggerTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ========================================================================
  // TAP CREATURES AS COST (Summon the School style: "Tap N untapped X you control:")
  // Not stack targeting: apply taps and move the source card from graveyard to hand.
  // ========================================================================
  if (stepAny?.tapCreaturesCost === true) {
    getResolutionHandlerDeps().handleTapCreaturesCostTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ========================================================================
  // OPPONENT SELECTION (Secret Rendezvous, etc.)
  // This is not stack targeting; it's a player-selection input for later effect resolution.
  // ========================================================================
  if (stepAny?.opponentSelection === true) {
    getResolutionHandlerDeps().handleOpponentSelectionTargetSelection(io, game, gameId, step, response);
    return;
  }
  
  // Store the validated targets on the stack item that needs them
  // The spell/ability on the stack will use these targets when it resolves
  const sourceId = step.sourceId;
  const spellCastContext = targetStepData.spellCastContext;
  const isOracleIrEffectChoice = Boolean(String((step as any)?.oracleIrChoiceStepJson || '').trim());
  if (!spellCastContext && !isOracleIrEffectChoice && sourceId && game.state?.stack) {
    const stackItem = game.state.stack.find((item: any) => item.id === sourceId);
    if (stackItem) {
      stackItem.targets = selections;
      debug(2, `[Resolution] Stored targets for ${sourceId}: ${selections.join(', ')}`);
    } else {
      debugWarn(2, `[Resolution] Stack item ${sourceId} not found to store targets`);
    }
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'assignTriggeredAbilityTargets', {
        triggerStackItemId: String(sourceId),
        targets: selections.map((value: any) => String(value || '')).filter(Boolean),
        ...(String((step as any).id || '').trim()
          ? { resolvedStepId: String((step as any).id).trim() }
          : {}),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(assignTriggeredAbilityTargets) failed:', err);
    }
    if (stackItem && String(stackItem.type || '') === 'ability') {
        const targetedTriggers = triggerPermanentTargetedTriggersFromAbility(game as any, {
          activatedBy: String(stackItem.controller || pid) as any,
          sourcePermanentId: String(stackItem.source || ''),
          stackItemId: String(stackItem.id || sourceId),
          targetIds: selections.map((value: any) => String(value)),
        });
        persistTargetedTriggeredStackItems(gameId, game, targetedTriggers);
      }
  }

  // ===== LORWYN ECLIPSED: Blight N (generic hook) =====
  if (
    (step as any)?.keywordBlight === true &&
    BLIGHT_TARGET_SELECTION_STAGES.includes(String((step as any)?.keywordBlightStage || ''))
  ) {
    await getResolutionHandlerDeps().handleBlightKeywordTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ===== WARD: Payment prompts =====
  if (!(step as any)?.keywordBlight && step.type === ResolutionStepType.TARGET_SELECTION) {
    const wardPromptHandled = getResolutionHandlerDeps().maybeQueueWardPaymentPromptsForTargetSelection(
      io,
      game,
      gameId,
      step,
      { pid, selections, spellCastContext },
    );
    if (wardPromptHandled) return;
  }

  // ===== GENERIC: Sacrifice "When you do" follow-up =====
  if ((step as any)?.sacrificeWhenYouDo === true && String((step as any).sacrificeWhenYouDoStage || '') === 'select_sacrifice') {
    getResolutionHandlerDeps().handleSacrificeWhenYouDoTargetSelection(io, game, gameId, step, response);
    return;
  }

  if ((step as any)?.sacrificeAnotherPermanentForBenefitChoice === true && String((step as any).sacrificeAnotherPermanentForBenefitStage || '') === 'select_sacrifice') {
    await getResolutionHandlerDeps().handleSacrificeAnotherPermanentForBenefitTargetSelection(io, game, gameId, step, response);
    return;
  }

  // ===== GENERIC: Attach Equipment to target permanent (after selecting equipment) =====
  if ((step as any)?.attachEquipmentToPermanentSelectEquipment === true) {
    await getResolutionHandlerDeps().handleAttachEquipmentSelectEquipmentTargetSelection(io, game, gameId, step, response);
    return;
  }

  // Execute immediate actions for certain target-selection steps
  const immediateBattlefieldActionHandled = await getResolutionHandlerDeps()
    .tryHandleTargetSelectionImmediateBattlefieldAction(io, game, gameId, step, response);
  if (immediateBattlefieldActionHandled) return;

  const graveyardCardActionHandled = getResolutionHandlerDeps()
    .tryHandleTargetSelectionGraveyardCardAction(io, game, gameId, step, response);
  if (graveyardCardActionHandled) return;
  
  // Handle SOLDIER Military Program counter placement selection
  if ((step as any).soldierProgramCounters) {
    await getResolutionHandlerDeps().handleSoldierProgramCounterTargetSelection(io, game, gameId, step, response);
    return;
  }

  // Handle planeswalker ability target selection
  // Planeswalker abilities store their data in step.planeswalkerAbility
  if ((step as any).planeswalkerAbility) {
    getResolutionHandlerDeps().handlePlaneswalkerAbilityTargetSelection(io, game, gameId, step, response);
    return;
  }
  
  getResolutionHandlerDeps().applyAutoUnignoreForTargetedPermanents(io, game, gameId, response);

  // ========================================================================
  // SPELL CASTING TARGET SELECTION
  // When a spell requires targets and is being cast via Resolution Queue,
  // we need to request payment after targets are selected (MTG Rule 601.2h)
  // ========================================================================
  if (spellCastContext) {
    getResolutionHandlerDeps().handleSpellCastPaymentTargetSelection(io, game, gameId, step, response);
    return;
  }

  if ((step as any)?.graveyardCastSacrificeAsCost === true) {
    const graveyardSacrificeHandled = await getResolutionHandlerDeps()
      .handleGraveyardCastSacrificeAsCostTargetSelection(io, game, gameId, step, response);
    if (graveyardSacrificeHandled) return;
  }

  if ((step as any)?.graveyardSpellCastTargetSelection === true) {
    getResolutionHandlerDeps().handleGraveyardSpellCastTargetSelection(io, game, gameId, step, response);
    return;
  }

  if ((step as any)?.scavengeTargetSelection === true) {
    await getResolutionHandlerDeps().handleScavengeTargetSelection(io, game, gameId, step, response);
    return;
  }

  if (
    stepAny?.action === 'self_become_copy_of_creature' ||
    stepAny?.action === 'other_become_copy_of_creature'
  ) {
    await getResolutionHandlerDeps().handleBecomeCopyOfCreatureTargetSelection(io, game, gameId, step, response);
    return;
  }

  if (String(stepAny?.oracleIrChoiceStepJson || '').trim()) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
    if (resumed) {
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }
  }
  
  debug(1, `[Resolution] Target selection: ${selections?.join(', ')}`);
  
  // Clear legacy pending state if present
  if (game.state.pendingTargets?.[pid]) {
    delete game.state.pendingTargets[pid];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}
