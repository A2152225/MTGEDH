import type { GameContext } from '../../context.js';
import { appendEvent } from '../../../db/index.js';
import { uid } from '../../utils.js';
import { debugWarn } from '../../../utils/debug.js';
import { timingTriggerEffect } from './timing-effect-extraction.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import {
  hasUnsupportedTargetRequirement,
  inferGenericTriggeredAbilityTargetMetadata,
} from './target-metadata.js';
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource } from './triggerConditionFamilyMatch.js';
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';
import { queueSelfDiscardTriggers } from './eventSpecificLegacyTriggers.js';

export interface DiscardTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'opponent_discards' | 'player_discards' | 'you_discard' | 'forced_discard';
  /** forced_discard only: whose spell or ability must cause the discard. */
  causeScope?: 'opponent' | 'any';
  oracleClause: string;
  effect: string;
  mandatory: boolean;
  frequency: 'per_card' | 'per_event';
  cardFilter: 'any' | 'land' | 'nonland' | 'creature' | 'noncreature_nonland' | 'artifact' | 'permanent';
}

function parseDiscardCondition(
  rawCondition: string,
): Pick<DiscardTrigger, 'frequency' | 'cardFilter'> | null {
  const condition = String(rawCondition || '')
    .trim()
    .toLowerCase()
    .replace(/^an\s+/, 'a ')
    .replace(/\s+/g, ' ');

  if (!condition || condition.includes('for the first time each turn')) {
    return null;
  }
  if (condition.includes(' or ') && !condition.startsWith('one or more ')) {
    return null;
  }

  switch (condition) {
    case 'a card':
      return { frequency: 'per_card', cardFilter: 'any' };
    case 'one or more cards':
      return { frequency: 'per_event', cardFilter: 'any' };
    case 'a land card':
      return { frequency: 'per_card', cardFilter: 'land' };
    case 'one or more land cards':
      return { frequency: 'per_event', cardFilter: 'land' };
    case 'a nonland card':
      return { frequency: 'per_card', cardFilter: 'nonland' };
    case 'one or more nonland cards':
      return { frequency: 'per_event', cardFilter: 'nonland' };
    case 'a creature card':
      return { frequency: 'per_card', cardFilter: 'creature' };
    case 'one or more creature cards':
      return { frequency: 'per_event', cardFilter: 'creature' };
    case 'a noncreature, nonland card':
      return { frequency: 'per_card', cardFilter: 'noncreature_nonland' };
    case 'one or more noncreature, nonland cards':
      return { frequency: 'per_event', cardFilter: 'noncreature_nonland' };
    case 'a artifact card':
    case 'an artifact card':
      return { frequency: 'per_card', cardFilter: 'artifact' };
    case 'one or more artifact cards':
      return { frequency: 'per_event', cardFilter: 'artifact' };
    case 'a permanent card':
      return { frequency: 'per_card', cardFilter: 'permanent' };
    case 'one or more permanent cards':
      return { frequency: 'per_event', cardFilter: 'permanent' };
    default:
      return null;
  }
}

export function detectDiscardTriggers(card: any, permanent: any, gameState?: any): DiscardTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'other' })) return []; // Humility / Torpor Orb gate
  const triggers: DiscardTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = String(permanent?.id || '');
  const controllerId = String(permanent?.controller || '');

  const matches = oracleText.matchAll(/whenever (an opponent|a player|you) discard(?:s)? ([^,]+),\s*([^.]+)/gi);
  for (const match of matches) {
    const subject = String(match[1] || '').trim().toLowerCase();
    const parsedCondition = parseDiscardCondition(String(match[2] || ''));
    const effect = timingTriggerEffect(oracleText, match, 3);
    if (!parsedCondition || !effect) {
      continue;
    }

    const triggerType = subject === 'an opponent'
      ? 'opponent_discards'
      : subject === 'a player'
        ? 'player_discards'
        : 'you_discard';

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType,
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      frequency: parsedCondition.frequency,
      cardFilter: parsedCondition.cardFilter,
    });
  }

  // "Whenever a spell or ability [an opponent controls] causes you to discard a card" (Spiritual Focus).
  for (const match of oracleText.matchAll(/whenever a spell or ability (an opponent controls )?causes you to discard (a card|one or more cards),\s*([^.]+)/gi)) {
    const effect = timingTriggerEffect(oracleText, match, 3);
    if (!effect) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'forced_discard',
      causeScope: match[1] ? 'opponent' : 'any',
      oracleClause: String(match[0] || '').trim(),
      effect,
      mandatory: !/^you may\b/i.test(effect),
      frequency: /one or more/i.test(String(match[2] || '')) ? 'per_event' : 'per_card',
      cardFilter: 'any',
    });
  }

  return triggers;
}

export function getDiscardTriggers(
  ctx: GameContext,
  discardingPlayerId: string,
  options?: { fromCycling?: boolean; causeControllerId?: string },
): DiscardTrigger[] {
  const cause = String(options?.causeControllerId || '').trim();
  const triggers: DiscardTrigger[] = [];
  const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;

    const permController = String(permanent.controller || '');
    const permTriggers = detectDiscardTriggers(permanent.card, permanent, (ctx as any)?.state);
    for (const trigger of permTriggers) {
      const interveningText = String(trigger.oracleClause || trigger.effect || '').trim();

      const needsThatPlayerRef = /\bthat player\b/i.test(interveningText) || /\btheir\b/i.test(interveningText);
      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permController,
        interveningText,
        permanent,
        needsThatPlayerRef
          ? {
              thatPlayerId: discardingPlayerId,
              referencedPlayerId: discardingPlayerId,
              theirPlayerId: discardingPlayerId,
            }
          : undefined,
      );
      if (ok === false) continue;

      switch (trigger.triggerType) {
        case 'opponent_discards':
          if (discardingPlayerId !== permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
        case 'player_discards':
          triggers.push({ ...trigger, controllerId: permController });
          break;
        case 'you_discard':
          if (discardingPlayerId === permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
        case 'forced_discard':
          // Only discards caused by a spell or ability (cause known); opponent scope excludes your own.
          if (discardingPlayerId === permController && cause && !options?.fromCycling
            && (trigger.causeScope !== 'opponent' || cause !== permController)) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
      }
    }

    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card.oracle_text || ''),
      event: 'discards',
      subjectPermanent: { id: '', typeLine: 'Card', controllerId: discardingPlayerId },
      subjectControllerId: discardingPlayerId,
      sourcePermanent: permanent,
    })) {
      if (options?.fromCycling && line.condition?.event === 'cycles') continue;
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates(existing.effect || '', line)
      ))) continue;
      const controller = line.condition?.alternatives[0]?.controller;
      const triggerType = controller === 'you' ? 'you_discard' : controller === 'not_you' ? 'opponent_discards' : 'player_discards';
      if (triggerType === 'you_discard' && discardingPlayerId !== permController) continue;
      if (triggerType === 'opponent_discards' && discardingPlayerId === permController) continue;
      const types = (line.condition?.alternatives[0]?.subject.typeGroups || []).flat();
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        controllerId: permController,
        triggerType,
        oracleClause: line.effect,
        effect: line.effect,
        mandatory: !/\byou may\b/i.test(line.effect),
        frequency: line.condition?.quantity === 'one_or_more' ? 'per_event' : 'per_card',
        cardFilter: types.includes('creature') ? 'creature' : types.includes('land') ? 'land' : types.includes('artifact') ? 'artifact'
          : (line.condition?.alternatives[0]?.subject.excludedWords || []).includes('land') ? 'nonland' : 'any',
      });
    }
  }

  return triggers;
}

function matchesDiscardTriggerFilter(card: any, filter: string): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  const isLand = typeLine.includes('land');
  const isCreature = typeLine.includes('creature');
  const isArtifact = typeLine.includes('artifact');
  const isPermanent = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']
    .some((type) => typeLine.includes(type));
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
      return isPermanent;
    case 'any':
    default:
      return true;
  }
}

/**
 * Queue discard-triggered abilities onto the stack (Waste Not, Bone Miser, etc.).
 * Shared by socket resolution and Oracle IR post-apply emission.
 */
export function queueDiscardTriggeredAbilities(
  ctx: GameContext,
  discardingPlayerId: string,
  discardedCards: any[],
  options?: { fromCycling?: boolean; causeControllerId?: string },
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!discardingPlayerId) return [];

  const cardsToTrigger = Array.isArray(discardedCards) ? discardedCards.filter((card: any) => card) : [];
  if (cardsToTrigger.length === 0) return [];

  const selfDiscardQueued = queueSelfDiscardTriggers(ctx, String(discardingPlayerId), cardsToTrigger, { causeControllerId: options?.causeControllerId, fromCycling: options?.fromCycling });
  const triggers = orderTriggersByAPNAP(ctx, getDiscardTriggers(ctx, String(discardingPlayerId), options));
  if (triggers.length === 0) return selfDiscardQueued;

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [...selfDiscardQueued];

  const pushDiscardTrigger = (trigger: any, matchingCards: any[]) => {
    if (matchingCards.length === 0) return;
    if (/\bcast it from your graveyard\b/i.test(String(trigger.effect || ''))) return;

    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) return;

    const primaryCard = matchingCards[0];
    const primaryCardId = String(primaryCard?.id || '').trim();
    const primaryCardName = String(primaryCard?.name || 'that card').trim() || 'that card';
    const triggerId = uid('trigger');
    const sourcePermanent = Array.isArray(stateAny.battlefield)
      ? stateAny.battlefield.find((permanent: any) => String(permanent?.id || '') === String(trigger.permanentId || ''))
      : undefined;
    const sourcePermanentSnapshot = sourcePermanent
      ? {
          ...sourcePermanent,
          ...(sourcePermanent.card ? { card: { ...sourcePermanent.card } } : null),
        }
      : undefined;
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
      ...(primaryCard && typeof primaryCard === 'object' ? { discardedCard: { ...primaryCard } } : null),
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number(stateAny.seq ?? (ctx as any).seq?.value ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: stackItem.source,
          permanentId: stackItem.permanentId,
          sourceName: stackItem.sourceName,
          controllerId: stackItem.controller,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          triggeringPlayer: String(discardingPlayerId),
          targetPlayer: String(discardingPlayerId),
          effectData: stackItem.effectData,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
        });
      } catch (err) {
        debugWarn(1, '[discard] appendEvent(pushTriggeredAbility) failed:', err);
      }
    }
  };

  for (const trigger of triggers) {
    const matchingCards = cardsToTrigger.filter((card: any) =>
      matchesDiscardTriggerFilter(card, String(trigger.cardFilter || 'any')),
    );
    if (matchingCards.length === 0) continue;

    if (trigger.frequency === 'per_event') {
      pushDiscardTrigger(trigger, matchingCards);
      continue;
    }
    for (const matchingCard of matchingCards) {
      pushDiscardTrigger(trigger, [matchingCard]);
    }
  }

  return queued;
}