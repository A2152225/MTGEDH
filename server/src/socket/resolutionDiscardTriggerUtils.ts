/**
 * socket/resolutionDiscardTriggerUtils.ts
 *
 * Discard-triggered ability queue helpers (+ serializeTriggeredTargetMetadata).
 * Extracted from resolution.ts to unlock discard-response handler splits under ~40KB.
 */

import { appendEvent } from "../db/index.js";
import { inferTriggeredAbilityTargetMetadata } from "../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { getDiscardTriggers } from "../state/modules/triggers/discard.js";
import { orderTriggersByAPNAP } from "../state/modules/triggers/ordering.js";
import {
  hasUnsupportedTargetRequirement,
  inferGenericTriggeredAbilityTargetMetadata,
} from "../state/modules/triggers/target-metadata.js";
import { uid } from "../state/utils.js";
import { debugWarn } from "../utils/debug.js";
import { cloneResolutionPermanentSnapshot } from "./resolutionKeywordChoiceHandlers.js";
export function serializeTriggeredTargetMetadata(metadata: any): Record<string, any> {
  return {
    ...(metadata?.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
    ...(metadata?.targetType ? { targetType: metadata.targetType } : null),
    ...(metadata?.targetConstraint ? { targetConstraint: metadata.targetConstraint } : null),
    ...(metadata?.targetZone ? { targetZone: metadata.targetZone } : null),
    ...(metadata?.targetDestination ? { targetDestination: metadata.targetDestination } : null),
    ...(metadata?.targetGraveyardScope ? { targetGraveyardScope: metadata.targetGraveyardScope } : null),
    ...(metadata?.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
    ...(metadata?.battlefieldControllerMode ? { battlefieldControllerMode: metadata.battlefieldControllerMode } : null),
    ...(metadata?.battlefieldCounters ? { battlefieldCounters: metadata.battlefieldCounters } : null),
    ...(metadata?.targetAction ? { targetAction: metadata.targetAction } : null),
    ...(Array.isArray(metadata?.targetFilterTypes) ? { targetFilterTypes: metadata.targetFilterTypes } : null),
    ...(Array.isArray(metadata?.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: metadata.targetFilterRequiredTypeWords } : null),
    ...(Array.isArray(metadata?.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: metadata.targetFilterExcludeTypes } : null),
    ...(metadata?.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
    ...(typeof metadata?.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: metadata.targetFilterExactManaValue } : null),
    ...(typeof metadata?.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: metadata.targetFilterMinManaValue } : null),
    ...(typeof metadata?.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: metadata.targetFilterMaxManaValue } : null),
    ...(typeof metadata?.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: metadata.targetTotalPowerLimit } : null),
    ...(metadata?.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
    ...(metadata?.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
    ...(typeof metadata?.minTargets === 'number' ? { minTargets: metadata.minTargets } : null),
    ...(typeof metadata?.maxTargets === 'number' ? { maxTargets: metadata.maxTargets } : null),
  };
}

const DISCARD_TRIGGERED_GRAVEYARD_CAST_ORACLE = 'whenever you discard a nonland card, you may cast it from your graveyard.';

export function normalizeOracleTextForMatch(text: unknown): string {
  return String(text || '').replace(/[’]/g, "'").trim().toLowerCase();
}

export function cardHasDiscardTriggeredGraveyardCast(card: any): boolean {
  return normalizeOracleTextForMatch(card?.oracle_text).includes(DISCARD_TRIGGERED_GRAVEYARD_CAST_ORACLE);
}

export function appendTriggeredAbilityPushEvent(
  gameId: string,
  game: any,
  stackItem: any,
): void {
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', {
      triggerId: stackItem.id,
      sourceId: stackItem.source,
      permanentId: stackItem.permanentId || stackItem.source,
      sourceName: stackItem.sourceName,
      controllerId: stackItem.controller,
      description: stackItem.description,
      triggerType: stackItem.triggerType,
      ...(stackItem.effect ? { effect: stackItem.effect } : null),
      mandatory: typeof stackItem.mandatory === 'boolean' ? stackItem.mandatory : true,
      ...serializeTriggeredTargetMetadata(stackItem),
      ...(Array.isArray(stackItem.targets)
        ? { targets: stackItem.targets.map((entry: any) => String(entry || '')).filter(Boolean) }
        : null),
      ...(stackItem.targetPlayer ? { targetPlayer: stackItem.targetPlayer } : null),
      ...(stackItem.defendingPlayer ? { defendingPlayer: stackItem.defendingPlayer } : null),
      ...(stackItem.triggeringPlayer != null ? { triggeringPlayer: stackItem.triggeringPlayer } : null),
      ...(stackItem.effectData && typeof stackItem.effectData === 'object' ? { effectData: stackItem.effectData } : null),
      ...(stackItem.card && typeof stackItem.card === 'object' ? { card: stackItem.card } : null),
      ...(stackItem.sourcePermanentSnapshot && typeof stackItem.sourcePermanentSnapshot === 'object'
        ? { sourcePermanentSnapshot: stackItem.sourcePermanentSnapshot }
        : null),
      ...(stackItem.discardedCard && typeof stackItem.discardedCard === 'object'
        ? { discardedCard: stackItem.discardedCard }
        : null),
      ...(stackItem.milledCard && typeof stackItem.milledCard === 'object'
        ? { milledCard: stackItem.milledCard }
        : null),
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility) failed:', err);
  }
}

export function queueDiscardTriggeredGraveyardCastAbilities(
  game: any,
  gameId: string,
  playerId: string,
  discardedCards: any[],
): void {
  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const sources = battlefield.filter((permanent: any) => {
    if (!permanent || String(permanent.controller || '') !== String(playerId)) return false;
    return cardHasDiscardTriggeredGraveyardCast((permanent as any).card);
  });
  if (sources.length === 0) {
    return;
  }

  const cardsToTrigger = Array.isArray(discardedCards)
    ? discardedCards.filter((card: any) => {
        if (!card) return false;
        const cardId = String(card.id || '').trim();
        const typeLine = String(card.type_line || '').toLowerCase();
        return Boolean(cardId) && !typeLine.includes('land');
      })
    : [];
  if (cardsToTrigger.length === 0) {
    return;
  }

  const stateAny = game.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];

  for (const discardedCard of cardsToTrigger) {
    const discardedCardId = String(discardedCard?.id || '').trim();
    const discardedCardName = String(discardedCard?.name || 'that card').trim() || 'that card';
    if (!discardedCardId) continue;

    for (const sourcePermanent of sources) {
      const triggerId = uid('trigger');
      const sourceId = String(sourcePermanent?.id || triggerId).trim();
      const sourceName = String(sourcePermanent?.card?.name || 'Discard trigger').trim() || 'Discard trigger';
      const stackItem = {
        id: triggerId,
        type: 'triggered_ability',
        controller: String(playerId),
        source: sourceId,
        permanentId: sourceId,
        sourceName,
        description: `You may cast ${discardedCardName} from your graveyard.`,
        effect: 'Whenever you discard a nonland card, you may cast it from your graveyard.',
        triggerType: 'triggered_ability',
        mandatory: true,
        effectData: {
          discardTriggeredCastFromGraveyard: true,
          discardedCardId,
          discardedCardName,
        },
        ...(sourcePermanent?.card && typeof sourcePermanent.card === 'object'
          ? { card: { ...(sourcePermanent.card as any) } }
          : null),
      } as any;

      stateAny.stack.push(stackItem);
      appendTriggeredAbilityPushEvent(gameId, game, stackItem);
    }
  }
}

export function queueDiscardTriggeredAbilities(
  game: any,
  gameId: string,
  discardingPlayerId: string,
  discardedCards: any[],
): void {
  if ((game as any)?.isReplaying) return;

  const triggers = orderTriggersByAPNAP(game as any, getDiscardTriggers(game as any, String(discardingPlayerId)));
  if (triggers.length === 0) {
    return;
  }

  const cardsToTrigger = Array.isArray(discardedCards)
    ? discardedCards.filter((card: any) => card)
    : [];
  if (cardsToTrigger.length === 0) {
    return;
  }

  const stateAny = game.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];

  const isPermanentCard = (typeLine: string): boolean => {
    const normalized = String(typeLine || '').toLowerCase();
    return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some((type) => normalized.includes(type));
  };

  const matchesDiscardTriggerFilter = (card: any, filter: string): boolean => {
    const typeLine = String(card?.type_line || '').toLowerCase();
    const isLand = typeLine.includes('land');
    const isCreature = typeLine.includes('creature');
    const isArtifact = typeLine.includes('artifact');
    switch (filter) {
      case 'land':
        return isLand;
      case 'nonland':
        return !isLand;
      case 'creature':
        return isCreature;
      case 'noncreature_nonland':
        return !isCreature && !isLand;
      case 'artifact':
        return isArtifact;
      case 'permanent':
        return isPermanentCard(typeLine);
      case 'any':
      default:
        return true;
    }
  };

  const pushDiscardTrigger = (trigger: any, matchingCards: any[]) => {
    if (matchingCards.length === 0) {
      return;
    }
    if (/\bcast it from your graveyard\b/i.test(String(trigger.effect || ''))) {
      return;
    }
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      return;
    }

    const primaryCard = matchingCards[0];
    const primaryCardId = String(primaryCard?.id || '').trim();
    const primaryCardName = String(primaryCard?.name || 'that card').trim() || 'that card';
    const triggerId = uid('trigger');
    const sourcePermanent = Array.isArray(stateAny.battlefield)
      ? stateAny.battlefield.find((permanent: any) => String(permanent?.id || '') === String(trigger.permanentId || ''))
      : undefined;
    const sourcePermanentSnapshot = cloneResolutionPermanentSnapshot(sourcePermanent);
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: String(trigger.controllerId),
      source: String(trigger.permanentId || triggerId),
      permanentId: String(trigger.permanentId || triggerId),
      sourceName: trigger.cardName,
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      triggeringPlayer: String(discardingPlayerId),
      targetPlayer: String(discardingPlayerId),
      mandatory: trigger.mandatory !== false,
      effectData: {
        discardingPlayerId: String(discardingPlayerId),
        discardedCardsCount: matchingCards.length,
        discardedCardIds: matchingCards.map((card: any) => String(card?.id || '')).filter(Boolean),
        ...(primaryCardId ? { discardedCardId: primaryCardId } : null),
        ...(primaryCardName ? { discardedCardName: primaryCardName } : null),
      },
      ...(primaryCard && typeof primaryCard === 'object'
        ? { discardedCard: { ...(primaryCard as any) } }
        : null),
    } as any;

    stateAny.stack.push(stackItem);
    appendTriggeredAbilityPushEvent(gameId, game, stackItem);
  };

  for (const trigger of triggers) {
    const matchingCards = cardsToTrigger.filter((card: any) => matchesDiscardTriggerFilter(card, String(trigger.cardFilter || 'any')));
    if (matchingCards.length === 0) {
      continue;
    }

    if (trigger.frequency === 'per_event') {
      pushDiscardTrigger(trigger, matchingCards);
      continue;
    }

    for (const matchingCard of matchingCards) {
      pushDiscardTrigger(trigger, [matchingCard]);
    }
  }
}

export function inferFollowupTargetMetadata(game: any, controllerId: string, sourceName: string, sourcePermanentId: string | undefined, effectText: string, sourcePermanentSnapshot?: any): Record<string, any> {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const sourcePermanent = sourcePermanentId
    ? battlefield.find((permanent: any) => String(permanent?.id || '') === String(sourcePermanentId))
    : undefined;
  const metadata = inferTriggeredAbilityTargetMetadata(effectText, {
    gameState: game?.state,
    controllerId,
    sourceName,
    sourcePermanent: sourcePermanent || sourcePermanentSnapshot,
  } as any);

  return serializeTriggeredTargetMetadata(metadata);
}
