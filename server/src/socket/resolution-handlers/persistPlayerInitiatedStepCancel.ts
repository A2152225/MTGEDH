/**
 * socket/resolution-handlers/persistPlayerInitiatedStepCancel.ts
 *
 * Persists a cancelled player-started step (cast-time Choose X, Replicate count, planeswalker
 * +X/-X, cast-time spell target selection) as a playerInitiatedStepCancel event so that reload /
 * replay does not re-queue the step from the earlier castSpellContinuation event.
 * The event is applied by applyEventPlayerInitiatedCancelEvents.ts.
 *
 * Public entry symbols: isSpellCastTargetSelectionStep, isPersistablePlayerInitiatedCancelStep,
 * persistPlayerInitiatedStepCancel. Must not import resolution.ts.
 */

import { ResolutionStepType, type ResolutionStep } from "../../state/resolution/index.js";
import { appendGameEvent } from "../util.js";
import { debugWarn } from "../../utils/debug.js";
import { isCancellablePlayerInitiatedXStep } from "./cancellablePlayerInitiatedXSteps.js";

export const PLAYER_INITIATED_STEP_CANCEL_EVENT = 'playerInitiatedStepCancel';

export function isSpellCastTargetSelectionStep(step: ResolutionStep | null | undefined): boolean {
  const s = step as any;
  if (!s || s.type !== ResolutionStepType.TARGET_SELECTION) return false;
  if (!String(s?.spellCastContext?.effectId || '').trim()) return false;
  return s.battlefieldAbilityTargetSelection !== true && s.wardPayment !== true && s.keywordBlight !== true;
}

export function isPersistablePlayerInitiatedCancelStep(step: ResolutionStep | null | undefined): boolean {
  return isCancellablePlayerInitiatedXStep(step) || isSpellCastTargetSelectionStep(step);
}

export function persistPlayerInitiatedStepCancel(
  game: any,
  gameId: string,
  step: ResolutionStep,
  playerId: string,
  additionalCancelledStepIds: string[] = [],
): void {
  if (!game || !gameId || !isPersistablePlayerInitiatedCancelStep(step)) return;
  const s = step as any;
  const stepId = String(s.id || '').trim();
  const cancelledStepIds = [stepId, ...additionalCancelledStepIds.map((id) => String(id || '').trim())].filter(Boolean);
  const effectId = String(s?.spellCastContext?.effectId || s?.effectId || '').trim();
  const spellCardId = String(s?.spellCardId || s?.spellCastContext?.cardId || '').trim();
  try {
    appendGameEvent(game, gameId, PLAYER_INITIATED_STEP_CANCEL_EVENT, {
      playerId,
      stepId,
      cancelledStepIds,
      stepType: s.type,
      ...(effectId ? { effectId } : {}),
      ...(spellCardId ? { spellCardId } : {}),
      ...(s.planeswalkerLoyaltyX === true ? { planeswalkerLoyaltyX: true } : {}),
      sourceId: s.sourceId,
      sourceName: s.sourceName,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] persist playerInitiatedStepCancel failed:', err);
  }
}
