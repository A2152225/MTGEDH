/**
 * socket/resolutionGraveyardSelectionTriggerExecute.ts
 *
 * Extracted from resolutionGraveyardSelectionApplyHandlers.ts.
 * Trigger graveyard selections whose effect is a grant / uncategorized
 * fallback (no concrete zone destination) apply via executeTriggerEffect.
 * Zone-move destinations and delayed returns stay on the apply+persist path.
 *
 * Entry: tryApplyTriggeredAbilityGraveyardSelectionViaExecute
 */

import type { Server } from "socket.io";
import type { ResolutionStep } from "../state/resolution/index.js";
import type { PlayerID } from "../../../shared/src/types.js";
import { executeTriggerEffect } from "../state/modules/stackExecuteTriggerEffectUtils.js";
import { uid } from "../state/utils.js";
import { broadcastGame, emitToPlayer } from "./util.js";

export function isConcreteTriggeredGraveyardZoneMove(stepData: any): boolean {
  const destination = String(stepData?.destination || '').toLowerCase();
  const delayedReturnAt = String(stepData?.delayedReturnAt || '').toLowerCase();
  // Triggered GY→exile clauses (Steward / Hazel) must run executeTriggerEffect
  // so compound tails (create a Food) and IR provenance stamps apply.
  if (destination === 'exile' && String(stepData?.triggeredAbilityEffectText || '').trim()) {
    return false;
  }
  return (
    destination === 'hand'
    || destination === 'battlefield'
    || destination === 'library_top'
    || destination === 'library_bottom'
    || destination === 'exile'
    || delayedReturnAt === 'next_end_step'
    || delayedReturnAt === 'next_upkeep_selected_card_owner'
  );
}

export function tryApplyTriggeredAbilityGraveyardSelectionViaExecute(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  pid: any,
  selectedCardIds: string[],
  effectId: string,
): boolean {
  const stepData = step as any;
  if (
    stepData?.triggeredAbilityGraveyardSelection !== true
    || stepData?.triggeredAbilityCastFromGraveyard
    || !String(stepData?.triggeredAbilityEffectText || '').trim()
    || isConcreteTriggeredGraveyardZoneMove(stepData)
  ) {
    return false;
  }

  const effectText = String(stepData?.triggeredAbilityEffectText || '').trim();
  const sourcePermanentId = String(stepData?.triggeredAbilitySourcePermanentId || '').trim();
  const sourceName = String(step.sourceName || stepData.cardName || 'Ability');
  if (!effectText) {
    emitToPlayer(io, pid, 'error', {
      code: 'INVALID_TRIGGER_TARGET',
      message: 'Triggered ability effect text missing for graveyard selection.',
    });
    return true;
  }

  const syntheticTriggerItem = {
    id: effectId || uid('triggered_graveyard_selection'),
    type: 'triggered_ability',
    controller: pid,
    source: sourcePermanentId || undefined,
    permanentId: sourcePermanentId || undefined,
    sourceName,
    description: effectText,
    effect: effectText,
    card: stepData?.triggeredAbilityCardSnapshot && typeof stepData.triggeredAbilityCardSnapshot === 'object'
      ? { ...(stepData.triggeredAbilityCardSnapshot as any) }
      : undefined,
    targets: selectedCardIds.slice(),
  } as any;

  const ctx = {
    state: game.state,
    gameId,
    libraries: (game as any).libraries,
    commandZone: (game as any).commandZone,
    bumpSeq: () => {
      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
    },
  } as any;

  executeTriggerEffect(ctx as any, String(pid) as PlayerID, sourceName, effectText, syntheticTriggerItem);
  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}
