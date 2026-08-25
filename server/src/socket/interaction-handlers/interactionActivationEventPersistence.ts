/**
 * socket/interaction-handlers/interactionActivationEventPersistence.ts
 *
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: replay-event persistence for queued battlefield/graveyard
 *   ability activations, plus the mana-pool snapshot/delta helpers those events
 *   record and the graveyard target-type predicate shim.
 * Public entry symbols: snapshotInteractionManaPool,
 *   calculateInteractionManaPoolDelta,
 *   persistQueuedBattlefieldAbilityStepActivation,
 *   persistQueuedGraveyardAbilityStepActivation,
 *   matchesParsedGraveyardCardTargetType.
 */

import { appendEvent } from "../../db";
import { debugWarn } from "../../utils/debug.js";
import { matchesGraveyardCardTargetType as matchesSharedGraveyardCardTargetType } from "../../rules-engine/targeting.js";

export function snapshotInteractionManaPool(pool: any): Record<string, number> {
  return {
    white: Number(pool?.white || 0),
    blue: Number(pool?.blue || 0),
    black: Number(pool?.black || 0),
    red: Number(pool?.red || 0),
    green: Number(pool?.green || 0),
    colorless: Number(pool?.colorless || 0),
  };
}

export function calculateInteractionManaPoolDelta(before: any, after: any): Record<string, number> | undefined {
  const baseline = snapshotInteractionManaPool(before);
  const current = snapshotInteractionManaPool(after);
  const delta: Record<string, number> = {};

  for (const key of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    const amount = Number(current[key] || 0) - Number(baseline[key] || 0);
    if (amount !== 0) {
      delta[key] = amount;
    }
  }

  return Object.keys(delta).length > 0 ? delta : undefined;
}

export function persistQueuedBattlefieldAbilityStepActivation(params: {
  gameId: string;
  game: any;
  playerId: string;
  permanentId: string;
  abilityId: string;
  cardName: string;
  queuedStep: Record<string, any>;
  tappedPermanents?: string[];
  paymentManaDelta?: Record<string, number>;
  abilityText?: string;
  activatedAbilityText?: string;
}): void {
  try {
    appendEvent(params.gameId, (params.game as any).seq ?? 0, 'activateBattlefieldAbility', {
      playerId: params.playerId,
      permanentId: params.permanentId,
      abilityId: params.abilityId,
      cardName: params.cardName,
      ...(params.abilityText ? { abilityText: params.abilityText } : {}),
      ...(params.activatedAbilityText ? { activatedAbilityText: params.activatedAbilityText } : {}),
      ...(Array.isArray(params.tappedPermanents) && params.tappedPermanents.length > 0 ? { tappedPermanents: params.tappedPermanents } : {}),
      ...(params.paymentManaDelta ? { paymentManaDelta: params.paymentManaDelta } : {}),
      queuedResolutionStep: params.queuedStep,
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(activateBattlefieldAbility:queued-step) failed:', e);
  }
}

export function persistQueuedGraveyardAbilityStepActivation(params: {
  gameId: string;
  game: any;
  playerId: string;
  cardId: string;
  abilityId: string;
  queuedStep: Record<string, any>;
}): void {
  try {
    appendEvent(params.gameId, (params.game as any).seq ?? 0, 'activateGraveyardAbility', {
      playerId: params.playerId,
      cardId: params.cardId,
      abilityId: params.abilityId,
      queuedResolutionStep: params.queuedStep,
    });
  } catch (e) {
    debugWarn(1, 'appendEvent(activateGraveyardAbility:queued-step) failed:', e);
  }
}

export function matchesParsedGraveyardCardTargetType(card: any, rawTargetType: string): boolean {
  return matchesSharedGraveyardCardTargetType(card, rawTargetType);
}
