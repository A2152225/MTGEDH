/**
 * socket/resolutionRegisterPreCompleteValidationForTargetSelectionSteps.ts
 *
 * Pre-complete selection validation for TARGET_SELECTION (shape, bounds, duplicate targets, shared
 * card type, action-specific zone existence checks, equipment attach, distinct-target constraint)
 * and MUTATE_TARGET_SELECTION.
 *
 * Ninth validation sibling. ...ForExtractedSteps.ts (~37KB) and ...ForStepResponseClusters.ts
 * (~34KB) are near the 40KB ceiling, so this cluster gets its own module.
 *
 * Called from registerResolutionHandlers before ResolutionQueueManager.completeStep.
 * Returns false when validation failed (error already emitted on socket).
 *
 * Public entry symbol: validateTargetSelectionStepsBeforeComplete.
 */

import type { Socket } from "socket.io";
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
  type TargetSelectionStep,
} from "../state/resolution/index.js";
import { permanentsShareCardType, selectionRequiresSharedCardType } from "../rules-engine/targeting";
import { debugWarn } from "../utils/debug.js";
import {
  getPreviouslyChosenTargetsForSource,
  stepIndicatesDifferentTarget,
} from "./resolution-handlers/resolutionTargetSelectionDistinctTargetUtils.js";

export type TargetSelectionPreCompleteValidationArgs = {
  socket: Socket;
  step: ResolutionStep;
  response: ResolutionStepResponse;
  cancelled: boolean;
  /** Required for battlefield / graveyard / pending-cast lookups. */
  game?: any;
  /** Responding player id (socket auth). */
  pid?: string;
  gameId: string;
  stepId: string;
};

/**
 * Validate TARGET_SELECTION and MUTATE_TARGET_SELECTION before completing the step.
 * Their handlers early-return on illegal input (INVALID_TARGET / NO_PENDING_CAST / missing object),
 * so completing first would permanently consume the step.
 * @returns false if the socket handler should abort; true to continue.
 */
export function validateTargetSelectionStepsBeforeComplete(
  args: TargetSelectionPreCompleteValidationArgs,
): boolean {
  const { socket, step, response, cancelled, game, pid, gameId, stepId } = args;

  // Validate before completing the step (prevents permanently completing on invalid input)
  if (step.type === ResolutionStepType.TARGET_SELECTION && !cancelled) {
    const targetStepData = step as TargetSelectionStep;
    const rawSelections = response.selections;

    if (!Array.isArray(rawSelections) || !rawSelections.every(s => typeof s === 'string')) {
      socket.emit("error", { code: "INVALID_SELECTION", message: "Invalid target selection format" });
      return false;
    }

    const selectedIds = rawSelections as string[];
    const validTargets = targetStepData.validTargets || [];
    const minTargets = targetStepData.minTargets || 0;
    const maxTargets = targetStepData.maxTargets || Infinity;

    // Disallow selecting the same target multiple times.
    const uniqueSelections = Array.from(new Set(selectedIds));
    if (uniqueSelections.length !== selectedIds.length) {
      socket.emit("error", { code: "INVALID_SELECTION", message: "Duplicate target selected" });
      return false;
    }

    // Validate selection count is within bounds
    if (selectedIds.length < minTargets || selectedIds.length > maxTargets) {
      socket.emit("error", {
        code: "INVALID_SELECTION",
        message: `Invalid target count: got ${selectedIds.length}, expected ${minTargets}-${maxTargets}`,
      });
      return false;
    }

    // Validate all selected targets are in valid targets list
    const validTargetIds = new Set(validTargets.map((t: any) => t.id));
    if (!selectedIds.every(id => validTargetIds.has(id))) {
      socket.emit("error", { code: "INVALID_SELECTION", message: "One or more selected targets are not valid" });
      return false;
    }

    if (selectionRequiresSharedCardType(targetStepData.targetDescription, targetStepData.description)) {
      const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const selectedPermanents = selectedIds
        .map((id) => battlefield.find((permanent: any) => String(permanent?.id || '') === String(id)))
        .filter(Boolean);

      if (selectedPermanents.length !== selectedIds.length || !permanentsShareCardType(selectedPermanents)) {
        socket.emit("error", { code: "INVALID_SELECTION", message: "Selected permanents must share a card type" });
        return false;
      }
    }

    // Some TARGET_SELECTION steps are used as generic "pick an object" prompts for
    // action-based workflows. These handlers can early-return if the selected object no longer
    // exists (e.g. destroyed before the response arrives). Validate existence before consuming.
    const targetAction = String((step as any)?.action || '');
    const requiresBattlefield = new Set<string>([
      'pw_lukka_exile_upgrade',
      'destroy_target_creature_or_planeswalker',
      'destroy_target_permanent',
      'exile_target_permanent',
    ]);
    const requiresGraveyard = targetAction === 'exile_graveyard_card'
      || targetAction.startsWith('move_graveyard_card_to_');

    if (requiresBattlefield.has(targetAction)) {
      const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const battlefieldIds = new Set(battlefield.map((p: any) => String(p?.id)).filter(Boolean));
      const missing = selectedIds.find((id) => !battlefieldIds.has(String(id)));
      if (missing) {
        socket.emit('error', { code: 'PERMANENT_NOT_FOUND', message: 'Selected target is no longer on the battlefield' });
        return false;
      }
    }

    if (requiresGraveyard) {
      const zones = (game.state as any)?.zones || {};
      const fromPlayerId = String((step as any)?.fromPlayerId || pid);

      const isCardInGraveyard = (cardId: string) => {
        if (targetAction === 'exile_graveyard_card') {
          for (const ownerId of Object.keys(zones)) {
            const gy: any[] = Array.isArray(zones?.[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
            if (gy.some((c: any) => c && String(c.id) === String(cardId))) return true;
          }
          return false;
        }

        const gy: any[] = Array.isArray(zones?.[fromPlayerId]?.graveyard) ? zones[fromPlayerId].graveyard : [];
        return gy.some((c: any) => c && String(c.id) === String(cardId));
      };

      const missing = selectedIds.find((id) => !isCardInGraveyard(id));
      if (missing) {
        socket.emit('error', { code: 'CARD_NOT_IN_GRAVEYARD', message: 'Selected card is no longer in the graveyard' });
        return false;
      }
    }

    if ((step as any)?.attachEquipmentToPermanentSelectEquipment === true) {
      const targetPermanentId = String((step as any).attachEquipmentToPermanentTargetPermanentId || '');
      const equipPermanentId = selectedIds[0];
      const battlefield: any[] = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
      const equipment = battlefield.find((p: any) => p && String(p.id) === String(equipPermanentId));
      const targetPermanent = targetPermanentId ? battlefield.find((p: any) => p && String(p.id) === String(targetPermanentId)) : null;
      if (!equipment || !targetPermanent) {
        socket.emit('error', { code: 'INVALID_SELECTION', message: 'Selected equipment or target permanent is no longer on the battlefield' });
        return false;
      }
    }

    // Enforce sequential distinct-target constraint for the same sourceId when indicated.
    if (targetStepData.sourceId && stepIndicatesDifferentTarget(targetStepData)) {
      const previouslyChosen = getPreviouslyChosenTargetsForSource(gameId, targetStepData.sourceId);
      if (previouslyChosen.size > 0) {
        const distinctValidTargets = validTargets.filter((t: any) => !previouslyChosen.has(t.id));
        const enforceDistinct = distinctValidTargets.length >= minTargets;

        if (enforceDistinct) {
          const overlaps = selectedIds.filter(id => previouslyChosen.has(id));
          if (overlaps.length > 0) {
            socket.emit("error", { code: "INVALID_SELECTION", message: "Must choose a different target" });
            return false;
          }
        } else {
          debugWarn(1, `[Resolution] Different-target constraint not enforceable for step ${stepId} (insufficient remaining targets)`);
        }
      }
    }
  }

  // Validate MUTATE_TARGET_SELECTION before completing the step.
  // The handler emits INVALID_TARGET / NO_PENDING_CAST and returns early; do not consume the step on those failures.
  if (step.type === ResolutionStepType.MUTATE_TARGET_SELECTION && !cancelled) {
    const stepAny = step as any;
    const effectId = String(stepAny.effectId || step.sourceId || '').trim();
    if (!effectId) {
      socket.emit('error', { code: 'INVALID_STEP', message: 'MUTATE_TARGET_SELECTION missing effectId' });
      return false;
    }

    const raw = response.selections as any;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      socket.emit('error', { code: 'INVALID_SELECTION', message: 'Invalid mutate selection format' });
      return false;
    }

    const targetPermanentId = String(raw.targetPermanentId || raw.targetId || '').trim();
    const validTargets: any[] = Array.isArray(stepAny.validTargets) ? stepAny.validTargets : [];
    if (!targetPermanentId || !validTargets.some((t: any) => String(t?.id) === targetPermanentId)) {
      socket.emit('error', { code: 'INVALID_TARGET', message: 'Invalid mutate target selection' });
      return false;
    }

    const pendingCast = (game.state as any)?.pendingSpellCasts?.[effectId];
    if (!pendingCast) {
      socket.emit('error', { code: 'NO_PENDING_CAST', message: 'No pending spell cast found' });
      return false;
    }
  }

  return true;
}
