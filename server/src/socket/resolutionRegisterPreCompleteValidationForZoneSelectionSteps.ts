/**
 * socket/resolutionRegisterPreCompleteValidationForZoneSelectionSteps.ts
 *
 * Pre-complete selection validation for the hand/zone card-picking prompts:
 * DISCARD_SELECTION, HAND_TO_BOTTOM (London mulligan), GRAVEYARD_SELECTION and LIBRARY_SEARCH.
 *
 * Third sibling of resolutionRegisterPreCompleteValidationForExtractedSteps.ts (~37KB) and
 * resolutionRegisterPreCompleteValidationForStepResponseClusters.ts (~34KB); both are close to the
 * 40KB ceiling, so these step types land here instead of growing either file.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbols: validateHandSelectionStepsBeforeComplete (sync, DISCARD_SELECTION +
 * HAND_TO_BOTTOM), validateGraveyardSelectionBeforeComplete (async - collect evidence needs a
 * dynamic import) and validateLibrarySearchBeforeComplete (sync).
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { parsePT } from "../state/utils.js";
import { cardHasCreatureType } from "../state/creatureTypeNow.js";
import {
  normalizeResolutionCardId,
  buildResolutionHandIdSet,
} from "./resolutionDiscardResponseCoreHandlers.js";
import { getSelectedGraveyardCardsForStep } from "./resolutionActivatedAbilityTargetingUtils.js";

export type ZoneSelectionPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for hand / graveyard zone lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
};

/**
 * Validate DISCARD_SELECTION and HAND_TO_BOTTOM selections.
 * If we complete the step first, invalid input would permanently consume the step and desync
 * hand state / the mulligan flow.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateHandSelectionStepsBeforeComplete(
  args: ZoneSelectionPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid } = args;

  if (step.type === ResolutionStepType.DISCARD_SELECTION) {
    const stepAny = step as any;
    const discardCount = Number(stepAny.discardCount || 0);
    const reason = String(stepAny.reason || 'effect');

    if (cancelled) {
      // Cleanup discards and explicitly mandatory discards cannot be cancelled.
      if (reason === 'cleanup' || (stepAny.mandatory === true && discardCount > 0)) {
        socket.emit("error", { code: "STEP_MANDATORY", message: "This step is mandatory and cannot be cancelled" });
        return false;
      }
    } else {
      const rawSelections = response.selections;
      if (!Array.isArray(rawSelections) || !rawSelections.every((s) => typeof s === 'string')) {
        socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid discard selection format" });
        return false;
      }

      const selectedIds = rawSelections as string[];
      const uniqueSelections = Array.from(new Set(selectedIds));
      if (uniqueSelections.length !== selectedIds.length) {
        socket.emit("error", { code: "INVALID_SELECTION", message: "Duplicate card selected" });
        return false;
      }

      if (!Number.isFinite(discardCount) || discardCount < 0) {
        socket.emit("error", { code: "INVALID_STEP", message: "Invalid discard count" });
        return false;
      }

      if (selectedIds.length !== discardCount) {
        socket.emit("error", {
          code: "INVALID_SELECTION",
          message: `Must select exactly ${discardCount} card${discardCount === 1 ? '' : 's'} to discard`,
        });
        return false;
      }

      if (discardCount > 0) {
        const hand = Array.isArray(stepAny.hand) ? stepAny.hand : [];
        const handIds = buildResolutionHandIdSet(hand);
        if (!selectedIds.every((id) => handIds.has(normalizeResolutionCardId(id)))) {
          socket.emit("error", { code: "CARD_NOT_IN_HAND", message: "Selected card not found in hand" });
          return false;
        }
      }
    }
  }

  if (step.type === ResolutionStepType.HAND_TO_BOTTOM) {
    if (cancelled) {
      socket.emit("error", { code: "STEP_MANDATORY", message: "This step is mandatory and cannot be cancelled" });
      return false;
    }

    const rawSelections = response.selections;
    if (!Array.isArray(rawSelections) || !rawSelections.every((s) => typeof s === 'string')) {
      socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid selection format for HAND_TO_BOTTOM" });
      return false;
    }

    const selectedIds = rawSelections as string[];
    const uniqueSelections = Array.from(new Set(selectedIds));
    if (uniqueSelections.length !== selectedIds.length) {
      socket.emit("error", { code: "INVALID_SELECTION", message: "Duplicate card selected" });
      return false;
    }

    const stepData = step as any;
    const mulliganState = (game?.state as any)?.mulliganState?.[pid as any];
    const pendingBottomCount = Number(mulliganState?.pendingBottomCount || 0);
    const expected = pendingBottomCount > 0
      ? pendingBottomCount
      : Number(stepData?.cardsToBottom || 0);

    if (!Number.isFinite(expected) || expected < 0 || selectedIds.length !== expected) {
      socket.emit("error", {
        code: "INVALID_SELECTION",
        message: `Must select exactly ${expected} card${expected === 1 ? '' : 's'} to put to bottom`,
      });
      return false;
    }

    if (expected > 0) {
      const zones = (game?.state as any)?.zones?.[pid as any];
      const hand = zones?.hand;
      if (!Array.isArray(hand)) {
        socket.emit("error", { code: "NO_HAND", message: "Hand not found" });
        return false;
      }

      const handIds = new Set(hand.map((c: any) => c?.id).filter(Boolean));
      if (!selectedIds.every((id) => handIds.has(id))) {
        socket.emit("error", { code: "CARD_NOT_IN_HAND", message: "Selected card not found in hand" });
        return false;
      }
    }
  }

  return true;
}

/**
 * Validate GRAVEYARD_SELECTION selections (call only for a non-cancelled GRAVEYARD_SELECTION step).
 * If we complete first, invalid input would permanently consume the step and desync graveyard/zone
 * changes.
 * @returns false if the socket handler should abort; true to continue.
 */
export async function validateGraveyardSelectionBeforeComplete(
  args: ZoneSelectionPreCompleteValidationArgs,
): Promise<boolean> {
  const { socket, step, response, game, pid } = args;
  const stepAny = step as any;

  let selectedCardIds: string[] = [];
  const raw = response.selections as any;
  if (Array.isArray(raw)) {
    selectedCardIds = raw.map((s: any) => String(s)).filter(Boolean);
  } else if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.selectedCardIds)) {
      selectedCardIds = raw.selectedCardIds.map((s: any) => String(s)).filter(Boolean);
    }
  } else {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid graveyard selection format' });
    return false;
  }

  const uniqueSelections = Array.from(new Set(selectedCardIds));
  if (uniqueSelections.length !== selectedCardIds.length) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card selected' });
    return false;
  }

  const minTargets = Math.max(0, Number(stepAny.minTargets ?? 0));
  const maxTargets = Math.max(minTargets, Number(stepAny.maxTargets ?? minTargets));
  if (selectedCardIds.length < minTargets || selectedCardIds.length > maxTargets) {
    socket.emit('error', {
      code: 'INVALID_SELECTION_COUNT',
      message: `Select ${minTargets === maxTargets ? minTargets : `${minTargets}-${maxTargets}`} card(s).`,
    });
    return false;
  }

  const validTargets: any[] = Array.isArray(stepAny.validTargets) ? stepAny.validTargets : [];
  const validIds = new Set(validTargets.map((t: any) => String(t?.id || '')).filter(Boolean));
  for (const id of selectedCardIds) {
    if (!validIds.has(String(id))) {
      socket.emit('error', { code: 'INVALID_TARGET', message: 'Invalid graveyard card selection' });
      return false;
    }
  }

  // Collect evidence validation: ensure chosen cards meet required total mana value.
  const purpose = String(stepAny.purpose || '').trim();
  const destination = String(stepAny.destination || '').trim().toLowerCase();
  const collectEvidenceMinManaValue = Number(stepAny.collectEvidenceMinManaValue ?? 0);
  const totalPowerLimit = Number(stepAny.totalPowerLimit ?? 0);
  const targetPlayerId = String(stepAny.targetPlayerId || pid || '').trim();
  if (Number.isFinite(totalPowerLimit) && totalPowerLimit > 0 && selectedCardIds.length > 0) {
    const chosen = getSelectedGraveyardCardsForStep(game, stepAny, selectedCardIds);
    if (chosen.length !== selectedCardIds.length) {
      socket.emit('error', { code: 'INVALID_TARGET', message: 'Selected card not found in graveyard' });
      return false;
    }

    const selectedTotalPower = chosen.reduce((sum: number, entry: any) => {
      const card = entry?.card;
      const typeLine = String(card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) {
        return sum;
      }
      return sum + parsePT(card?.power);
    }, 0);

    if (selectedTotalPower > totalPowerLimit) {
      socket.emit('error', {
        code: 'INVALID_TOTAL_POWER',
        message: `Selected cards have total power ${selectedTotalPower} (need ${totalPowerLimit} or less).`,
      });
      return false;
    }
  }

  if (
    purpose.toLowerCase() === 'collectevidence' &&
    destination === 'exile' &&
    Number.isFinite(collectEvidenceMinManaValue) &&
    collectEvidenceMinManaValue > 0 &&
    selectedCardIds.length > 0
  ) {
    try {
      const zones = (game.state as any)?.zones;
      const gy = zones?.[targetPlayerId]?.graveyard;
      if (!Array.isArray(gy)) {
        socket.emit('error', { code: 'NO_GRAVEYARD', message: 'Graveyard not found' });
        return false;
      }

      const { cardManaValue } = await import('../state/utils.js');
      const chosen = selectedCardIds
        .map((id) => (gy as any[]).find((c: any) => c && String(c.id) === String(id)))
        .filter(Boolean);

      if (chosen.length !== selectedCardIds.length) {
        socket.emit('error', { code: 'INVALID_TARGET', message: 'Selected card not found in graveyard' });
        return false;
      }

      const total = chosen.reduce((sum: number, c: any) => sum + (cardManaValue(c) || 0), 0);
      if (!(total >= collectEvidenceMinManaValue)) {
        socket.emit('error', {
          code: 'CANNOT_COLLECT_EVIDENCE',
          message: `Collect evidence ${collectEvidenceMinManaValue}: selected cards total mana value ${total} (need ${collectEvidenceMinManaValue} or more).`,
        });
        return false;
      }
    } catch {
      socket.emit('error', {
        code: 'CANNOT_COLLECT_EVIDENCE',
        message: 'Collect evidence validation failed; please try again.',
      });
      return false;
    }
  }

  return true;
}

/**
 * Validate LIBRARY_SEARCH selections (call only for a LIBRARY_SEARCH step).
 * If we complete first, invalid selections (or invalid split assignments) would permanently
 * consume the step.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateLibrarySearchBeforeComplete(
  args: ZoneSelectionPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled } = args;
  const stepAny = step as any;
  const isMandatory = Boolean(stepAny.mandatory);

  if (cancelled) {
    if (isMandatory) {
      socket.emit('error', { code: 'STEP_MANDATORY', message: 'This step is mandatory and cannot be cancelled' });
      return false;
    }
    return true;
  }

  const rawSelections = response.selections as any;
  if (!Array.isArray(rawSelections) || !rawSelections.every((s) => typeof s === 'string')) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid library search selection format' });
    return false;
  }

  const selectedIds = rawSelections as string[];
  const uniqueSelections = Array.from(new Set(selectedIds));
  if (uniqueSelections.length !== selectedIds.length) {
    socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate card selected' });
    return false;
  }

  const minSelections = Math.max(0, Number(stepAny.minSelections ?? 0));
  let maxSelections = Number(stepAny.maxSelections);
  if (!Number.isFinite(maxSelections)) maxSelections = Infinity;
  if (maxSelections < minSelections) maxSelections = minSelections;

  if (selectedIds.length < minSelections || selectedIds.length > maxSelections) {
    socket.emit('error', {
      code: 'INVALID_SELECTION_COUNT',
      message: `Select ${Number.isFinite(maxSelections) && maxSelections !== Infinity
        ? (minSelections === maxSelections ? `${minSelections}` : `${minSelections}-${maxSelections}`)
        : `at least ${minSelections}`
      } card(s).`,
    });
    return false;
  }

  const availableCards: any[] = Array.isArray(stepAny.availableCards) ? stepAny.availableCards : [];
  const availableIdSet = new Set(availableCards.map((c: any) => String(c?.id || '')).filter(Boolean));
  for (const id of selectedIds) {
    if (!availableIdSet.has(String(id))) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected card is not available for this search' });
      return false;
    }
  }

  const selectedCards = selectedIds
    .map((id) => availableCards.find((c: any) => String(c?.id) === String(id)))
    .filter(Boolean);

  const chosenTypeSelectionFilter = String(stepAny.chosenTypeSelectionFilter || '').trim();
  if (chosenTypeSelectionFilter && selectedCards.length > 0) {
    const invalidSelection = (selectedCards as any[]).some((card) => !cardHasCreatureType(card, chosenTypeSelectionFilter));
    if (invalidSelection) {
      socket.emit('error', {
        code: 'INVALID_SELECTION',
        message: `Selected cards must be of type ${chosenTypeSelectionFilter}`,
      });
      return false;
    }
  }

  // Enforce optional constraints that the handler also enforces.
  // Doing this here prevents consuming the step if the selection violates constraints.
  if (selectedIds.length > 0) {
    const maxTypes = stepAny.maxTypes as Record<string, number> | undefined;
    if (maxTypes && typeof maxTypes === 'object') {
      const counts: Record<string, number> = {};
      for (const card of selectedCards as any[]) {
        const tl = String(card?.type_line || '').toLowerCase();
        for (const [typeKey, maxAllowed] of Object.entries(maxTypes)) {
          if (typeof maxAllowed !== 'number') continue;
          if (tl.includes(String(typeKey).toLowerCase())) {
            counts[typeKey] = (counts[typeKey] || 0) + 1;
            if (counts[typeKey] > maxAllowed) {
              socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selection violates type constraint' });
              return false;
            }
          }
        }
      }
    }

    const requireDifferentNames = stepAny.requireDifferentNames === true;
    if (requireDifferentNames) {
      const seen = new Set<string>();
      for (const card of selectedCards as any[]) {
        const name = String(card?.name || '').toLowerCase();
        if (!name) continue;
        if (seen.has(name)) {
          socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selection must have different names' });
          return false;
        }
        seen.add(name);
      }
    }
  }

  const maxTotalManaValue = Number(stepAny.maxTotalManaValue);
  if (Number.isFinite(maxTotalManaValue) && maxTotalManaValue >= 0) {
    const totalManaValue = (selectedCards as any[]).reduce((sum: number, card: any) => {
      return sum + Math.max(0, Number(card?.cmc || 0) || 0);
    }, 0);
    if (totalManaValue > maxTotalManaValue) {
      socket.emit('error', {
        code: 'INVALID_SELECTION_TOTAL_MANA_VALUE',
        message: `Selected cards total mana value ${totalManaValue} exceeds ${maxTotalManaValue}.`,
      });
      return false;
    }
  }

  // Split-destination validation (Cultivate/Kodama's Reach)
  const destination = String(stepAny.destination || '').toLowerCase();
  const isSplitDestination = stepAny.splitDestination === true || destination === 'split';
  if (isSplitDestination) {
    const sa = (response as any).splitAssignments;
    if (!sa || typeof sa !== 'object') {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Missing split assignments' });
      return false;
    }

    const toBattlefieldRaw = Array.isArray(sa.toBattlefield) ? sa.toBattlefield : [];
    const toHandRaw = Array.isArray(sa.toHand) ? sa.toHand : [];
    const toBattlefield = toBattlefieldRaw.map((s: any) => String(s)).filter(Boolean);
    const toHand = toHandRaw.map((s: any) => String(s)).filter(Boolean);

    const allAssigned = [...toBattlefield, ...toHand];
    const uniqueAssigned = new Set(allAssigned);
    if (uniqueAssigned.size !== allAssigned.length) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Duplicate assignment in split destination' });
      return false;
    }

    // Assigned cards must exactly match selected cards.
    const selectedSet = new Set(selectedIds);
    if (allAssigned.length !== selectedIds.length || !allAssigned.every((id) => selectedSet.has(id))) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Split assignments must match selected cards' });
      return false;
    }

    const expectedBattlefield = Number(stepAny.toBattlefield);
    const expectedHand = Number(stepAny.toHand);
    if (Number.isFinite(expectedBattlefield) && expectedBattlefield >= 0 && toBattlefield.length !== expectedBattlefield) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: `Must assign exactly ${expectedBattlefield} card(s) to battlefield` });
      return false;
    }
    if (Number.isFinite(expectedHand) && expectedHand >= 0 && toHand.length !== expectedHand) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: `Must assign exactly ${expectedHand} card(s) to hand` });
      return false;
    }
  }

  return true;
}
