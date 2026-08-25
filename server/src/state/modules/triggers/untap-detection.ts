/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectUntapTriggers + UntapTrigger (merged into triggers/; leftover re-exports)
 * Public: detectUntapTriggers, UntapTrigger
 */

import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { KNOWN_UNTAP_TRIGGERS } from "./card-data-tables.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
/**
 * Detect untap triggers from permanents on the battlefield
 * Used for Bear Umbra, Nature's Will, Sword of Feast and Famine, etc.
 */
export interface UntapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerOn: string;
  untapType: string;
  effect: string;
}

export function detectUntapTriggers(card: any, permanent: any): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Check known untap trigger cards
  for (const [knownName, info] of Object.entries(KNOWN_UNTAP_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerOn: info.triggerOn,
        untapType: info.untapType,
        effect: info.effect,
      });
    }
  }
  
  // Generic detection: "Whenever enchanted creature attacks, untap all lands you control"
    const attackUntapLandsMatch = oracleText.match(/whenever (?:this creature|enchanted creature|equipped creature|~) attacks,?\s*(?:[^.]*)?untap all lands you control/i);
  if (attackUntapLandsMatch && !triggers.some(t => t.triggerOn === 'attack' && t.untapType === 'lands')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'attack',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }
  
  // Generic detection: "Whenever ~ deals combat damage to a player, untap all lands you control"
    const combatDamageUntapMatch = oracleText.match(/whenever (?:this creature|~|enchanted creature|equipped creature) deals combat damage to (?:a player|an opponent),?\s*(?:[^.]*)?untap all lands you control/i);
  if (combatDamageUntapMatch && !triggers.some(t => t.triggerOn === 'combat_damage' && t.untapType === 'lands')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'combat_damage',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }

  const untapStepMatch = oracleText.match(
    /whenever you untap one or more permanents during your untap step,?\s*([^.]+)/i,
  );
  if (untapStepMatch && !triggers.some((t) => t.triggerOn === 'untap_step')) {
    const effectText = timingTriggerEffect(oracleText, untapStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap_step',
      untapType: 'controlled_permanent',
      effect: effectText,
    });
  }

  const controlledPermanentUntapMatch = oracleText.match(
    /whenever a permanent you control becomes untapped,?\s*([^.]+)/i,
  );
  if (
    controlledPermanentUntapMatch &&
    !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'controlled_permanent')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledPermanentUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'controlled_permanent',
      effect: effectText,
    });
  }

  const permanentUntapMatch = oracleText.match(/whenever a permanent becomes untapped,?\s*([^.]+)/i);
  if (permanentUntapMatch && !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'permanent')) {
    const effectText = timingTriggerEffect(oracleText, permanentUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'permanent',
      effect: effectText,
    });
  }

  const selfBecomesUntappedMatch = oracleText.match(
    /when this creature becomes untapped(?: or you lose control of this creature)?,?\s*([^.]+)/i,
  );
  if (selfBecomesUntappedMatch && !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'self')) {
    const effectText = timingTriggerEffect(oracleText, selfBecomesUntappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'self',
      effect: effectText,
    });
  }

  const equippedUntapMatch = oracleText.match(/whenever equipped creature becomes untapped,?\s*([^.]+)/i);
  if (equippedUntapMatch && !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'equipped_creature')) {
    const effectText = timingTriggerEffect(oracleText, equippedUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'equipped_creature',
      effect: effectText,
    });
  }

  const selfUntapNameRefs = [
    '~',
    'this creature',
    'this permanent',
    'this artifact',
    'this land',
    ...buildCardNameRegexAlternatives(cardName).map((name) => name.toLowerCase()),
  ];
  const selfUntapPattern = new RegExp(
    `whenever (?:${selfUntapNameRefs.join('|')}) become(?:s)? untapped,?\\s*([^.]+)`,
    'i',
  );
  const selfUntapMatch = oracleText.match(selfUntapPattern);
  if (selfUntapMatch && !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'self')) {
    const effectText = timingTriggerEffect(oracleText, selfUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'self',
      effect: effectText,
    });
  }

  const namedOrMvCreatureUntapMatch = oracleText.match(
    new RegExp(
      `whenever (?:${selfUntapNameRefs.join('|')}) or another creature you control with mana value (?:\\d+|[\\w]+) or greater becomes untapped,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrMvCreatureUntapMatch &&
    !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'named_or_mv_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrMvCreatureUntapMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'named_or_mv_creature',
      effect: effectText,
    });
  }

  return triggers;
}
