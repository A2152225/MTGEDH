/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover monstrous / room / transform detectors
 * Public: detectMonstrousTriggers, detectRoomTriggers, detectTransformTriggers
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { ENTERS_OR_OTHER_EVENT_PREFIX } from "./enters-or-other-event-prefix.js";
import { detectRoomUnlockDoorTriggers } from "./room.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';
export function detectMonstrousTriggers(card: any, permanent?: any, gameState?: any): TriggeredAbility[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'counters' })) return []; // Humility / Torpor Orb gate
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const monstrousNameVariants = buildCardNameRegexAlternatives(cardName);
  const monstrousMatch = oracleText.match(
    new RegExp(`when(?:ever)? (?:~|this creature|(?:${monstrousNameVariants.join('|')})) ${ENTERS_OR_OTHER_EVENT_PREFIX}becomes monstrous,?\\s*([^.]+)`, 'i'),
  );
  if (monstrousMatch && !triggers.some((t) => t.triggerType === 'became_monstrous')) {
    const effectText = timingTriggerEffect(oracleText, monstrousMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'became_monstrous',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

export function detectRoomTriggers(card: any, permanent?: any, gameState?: any) {
  return detectRoomUnlockDoorTriggers(card, permanent, gameState);
}

export function detectTransformTriggers(card: any, permanent?: any, gameState?: any): TriggeredAbility[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'other' })) return []; // Humility / Torpor Orb gate
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const transformNameVariants = buildCardNameRegexAlternatives(cardName);
  const transformPatterns = [
    /when (?:~|this creature|this card) specializes(?: from (?:your graveyard|any zone|the battlefield|exile))?[^,]*,?\s*([^.]+)/i,
    /whenever (?:~|this creature|this card) specializes(?: from (?:your graveyard|any zone|the battlefield|exile))?[^,]*,?\s*([^.]+)/i,
    /when(?:ever)? equipped creature transforms,?\s*([^.]+)/i,
    /when(?:ever)? enchanted creature transforms,?\s*([^.]+)/i,
    /when(?:ever)? this creature transforms into this permanent,?\s*([^.]+)/i,
    /when this creature has flying,?\s*flip it/i,
    new RegExp(`when this creature transforms into (?:${transformNameVariants.join('|')}),?\\s*([^.]+)`, 'i'),
    /when this creature transforms into [^,]+,?\s*([^.]+)/i,
    new RegExp(`when you have \\d+ or more life,?\\s*flip (?:${transformNameVariants.join('|')})`, 'i'),
    /when you have (\d+) or less life,?\s*(?:if [^,]+,\s*)?([^.]*\b(?:transform|flip)\b[^.]*)/i,
  ];
  for (const pattern of transformPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = String(match[match.length - 1] || match[0] || '').trim();
    if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'transform',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Life-threshold state trigger (Opal Avenger): reported, but typed so the transform event never queues it.
  const lifeThreshold = oracleText.match(/when you have (\d+) or less life,?\s*(?:if [^,]+,\s*)?([^.]+)/i);
  const lifeEffect = String(lifeThreshold?.[2] || '').trim();
  if (lifeEffect && !triggers.some((trigger) => trigger.effect === lifeEffect)) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'life_threshold' as any,
      description: lifeEffect,
      effect: lifeEffect,
      mandatory: !lifeEffect.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}
