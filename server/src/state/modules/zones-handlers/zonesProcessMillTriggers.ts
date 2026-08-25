// server/src/state/modules/zones-handlers/zonesProcessMillTriggers.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: processMillTriggers.
// Public entry symbols: processMillTriggers.

import type { PlayerID } from "../../../../../shared/src/types.js";
import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { debugWarn } from "../../../utils/debug.js";
import { appendEvent } from "../../../db/index.js";
import { getMillTriggers } from "../triggers/mill.js";
import { orderTriggersByAPNAP } from "../triggers/ordering.js";
import {
  hasUnsupportedTargetRequirement,
  inferGenericTriggeredAbilityTargetMetadata,
} from "../triggers/target-metadata.js";

export function processMillTriggers(
  ctx: GameContext,
  millingPlayerId: PlayerID | string,
  milledCards: any[],
  sourcePlayerId?: PlayerID | string,
): void {
  if ((ctx as any)?.isReplaying) return;

  const cards = Array.isArray(milledCards) ? milledCards.filter((card: any) => card) : [];
  if (cards.length === 0) {
    return;
  }

  const triggers = orderTriggersByAPNAP(ctx, getMillTriggers(ctx, String(millingPlayerId)));
  if (triggers.length === 0) {
    return;
  }

  const gameId = String((ctx as any).gameId || '').trim();
  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const battlefield = Array.isArray(stateAny.battlefield) ? stateAny.battlefield : [];

  const snapshotPermanentForTriggerContext = (permanent: any): any | undefined => {
    if (!permanent || typeof permanent !== 'object') return undefined;
    return {
      id: String(permanent?.id || ''),
      controller: String(permanent?.controller || ''),
      owner: String(permanent?.owner || permanent?.controller || ''),
      tapped: permanent?.tapped === true,
      counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : undefined,
      card: permanent?.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
    };
  };

  const sourcePermanentSnapshotFor = (permanentId: string): any | undefined => {
    const normalizedPermanentId = String(permanentId || '').trim();
    if (!normalizedPermanentId) return undefined;
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === normalizedPermanentId);
    return snapshotPermanentForTriggerContext(permanent);
  };

  const isPermanentCard = (typeLine: string): boolean => {
    const normalized = String(typeLine || '').toLowerCase();
    return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some((type) => normalized.includes(type));
  };

  const matchesMillTriggerFilter = (card: any, filter: string): boolean => {
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

  const pushMillTrigger = (trigger: any, matchingCards: any[]) => {
    if (matchingCards.length === 0) {
      return;
    }
    const effect = String(trigger?.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      return;
    }

    const primaryCard = matchingCards[0];
    const primaryCardId = String(primaryCard?.id || '').trim();
    const primaryCardName = String(primaryCard?.name || 'that card').trim() || 'that card';
    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = sourcePermanentSnapshotFor(String(trigger.permanentId || ''));
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: String(trigger.controllerId),
      source: String(trigger.permanentId || triggerId),
      permanentId: String(trigger.permanentId || triggerId),
      sourceName: String(trigger.cardName || 'Mill trigger'),
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPlayer: String(millingPlayerId),
      targetPlayer: String(millingPlayerId),
      effectData: {
        millingPlayerId: String(millingPlayerId),
        ...(sourcePlayerId ? { sourcePlayerId: String(sourcePlayerId) } : null),
        milledCardsCount: matchingCards.length,
        milledCardIds: matchingCards.map((card: any) => String(card?.id || '')).filter(Boolean),
        ...(primaryCardId ? { milledCardId: primaryCardId } : null),
        ...(primaryCardName ? { milledCardName: primaryCardName } : null),
      },
      ...(primaryCard && typeof primaryCard === 'object'
        ? { milledCard: { ...(primaryCard as any) } }
        : null),
    } as any;

    stateAny.stack.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: String(trigger.permanentId || triggerId),
          permanentId: String(trigger.permanentId || triggerId),
          sourceName: String(trigger.cardName || 'Mill trigger'),
          controllerId: String(trigger.controllerId),
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          targetPlayer: String(millingPlayerId),
          triggeringPlayer: String(millingPlayerId),
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          ...(stackItem.milledCard && typeof stackItem.milledCard === 'object' ? { milledCard: stackItem.milledCard } : null),
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[millTrigger] Failed to persist generic mill trigger:', err);
      }
    }
  };

  for (const trigger of triggers) {
    const matchingCards = cards.filter((card: any) => matchesMillTriggerFilter(card, String(trigger.cardFilter || 'any')));
    if (matchingCards.length === 0) {
      continue;
    }

    if (trigger.frequency === 'per_event') {
      pushMillTrigger(trigger, matchingCards);
      continue;
    }

    for (const matchingCard of matchingCards) {
      pushMillTrigger(trigger, [matchingCard]);
    }
  }
}
