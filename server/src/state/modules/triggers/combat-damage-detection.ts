/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectCombatDamageTriggers (merged into triggers/; leftover re-exports)
 * Public: detectCombatDamageTriggers
 */

import { KNOWN_COMBAT_DAMAGE_TRIGGERS } from "./card-data-tables.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { appendCombatDamageDetectionEarly } from "./combat-damage-detection-early.js";
import { appendCombatDamageDetectionLate } from "./combat-damage-detection-late.js";
import { appendCombatDamageDetectionMid } from "./combat-damage-detection-mid.js";
import type { CombatDamageDetectionState } from "./combat-damage-detection-state.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";

/**
 * Detect combat damage triggers from a permanent's abilities
 */
export function detectCombatDamageTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_COMBAT_DAMAGE_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'deals_combat_damage',
        description: info.effect,
        effect: info.effect,
        mandatory: true,
      });
    }
  }
  
  // Generic "when/whenever ~ deals combat damage to a player" detection
  const combatNameVariants = buildCardNameRegexAlternatives(cardName);
  const combatDamageSubject = `(?:~|this creature|this vehicle|this artifact|this land|this permanent|(?:${combatNameVariants.join('|')})|equipped creature|enchanted creature)`;
  const selfCombatDamageAnyMatch = oracleText.match(
    new RegExp(`when(?:ever)?\\s+${combatDamageSubject}\\s+deals\\s+combat\\s+damage(?!\\s+to),?\\s*([^.]+)`, 'i'),
  );
  if (
    selfCombatDamageAnyMatch &&
    !triggers.some((t) => t.triggerType === 'self_deals_combat_damage_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfCombatDamageAnyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_deals_combat_damage_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const combatDamagePlayerMatch = oracleText.match(
    new RegExp(`when(?:ever)?\\s+${combatDamageSubject}\\s+(?:enters(?: the battlefield)?\\s+or\\s+)?deals\\s+combat\\s+damage\\s+to\\s+(?:a\\s+)?(?:player|an?\\s+opponent),?\\s*([^.]+)`, 'i'),
  );
  if (combatDamagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_combat_damage',
      description: timingTriggerEffect(oracleText, combatDamagePlayerMatch),
      effect: timingTriggerEffect(oracleText, combatDamagePlayerMatch),
      mandatory: true,
    });
  }

  const state: CombatDamageDetectionState = {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    combatNameVariants,
    combatDamageSubject,
    card,
    permanent,
  };
  appendCombatDamageDetectionEarly(state);
  appendCombatDamageDetectionMid(state);
  appendCombatDamageDetectionLate(state);

  return triggers;
}
