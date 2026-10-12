/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectETBTriggers (merged into triggers/; leftover re-exports)
 * Public: detectETBTriggers
 */

import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { KNOWN_ETB_TRIGGERS } from "./card-data-tables.js";
import { detectTargetType } from "./detect-target-type.js";
import { stripReminderParentheticals } from "../../../../../rules-engine/src/oracleReminderText.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import type { EtbDetectionState } from "./etb-detection-state.js";
import { mergeDetectorOracleWithContinuousGrants } from "./detectorGrantedOracle.js";
import { ETB_STATIC_ALTERNATIVES } from "./etb-detection-helpers.js";
import { appendEtbDetectionEarly } from "./etb-detection-early.js";
import { appendEtbDetectionMid } from "./etb-detection-mid.js";
import { appendEtbDetectionLate } from "./etb-detection-late.js";

/**
 * Detect ETB triggers from a card
 */
export function detectETBTriggers(card: any, permanent?: any, gameState?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const isTransformCard = (card?.layout === 'transform' || card?.layout === 'double_faced_token') && cardFaces.length >= 2;
  const activeFaceIndex = (permanent as any)?.transformed ? 1 : 0;
  const activeFace = isTransformCard ? cardFaces[activeFaceIndex] || cardFaces[0] : undefined;
  const printedOracle = stripReminderParentheticals(String(
    isTransformCard
      ? activeFace?.oracle_text || card?.oracle_text || ""
      : card?.oracle_text || ""
  ));
  const { oracleText } = mergeDetectorOracleWithContinuousGrants(printedOracle, permanent, gameState);
  const lowerOracle = oracleText.toLowerCase();
  const cardName = String(
    isTransformCard
      ? activeFace?.name || card?.name || "Unknown"
      : card?.name || "Unknown"
  );
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Check known ETB trigger cards first
  for (const [knownName, info] of Object.entries(KNOWN_ETB_TRIGGERS)) {
    if (!lowerName.includes(knownName)) continue;
    // Skip table rows that describe activated abilities (e.g. sacrifice costs), not ETB triggers.
    const hasSelfEtbInOracle = /\bwhen\b[^.]*\benters(?:\s+the\s+battlefield)?\b/i.test(oracleText);
    if (!hasSelfEtbInOracle && /^sacrifice\s+/i.test(String(info.effect || ''))) {
      continue;
    }

    // Rows about OTHER permanents entering carry no subject/controller filter. When the oracle
    // has a "Whenever ... enters" clause, the generic detectors own it (with filters).
    if (info.triggerOn && info.triggerOn !== 'self' && /\bwhenever\b[^.]*\benters?\b/i.test(oracleText)) {
      continue;
    }

    let triggerType: TriggeredAbility['triggerType'];
    switch (info.triggerOn) {
      case 'another_permanent':
        triggerType = 'another_permanent_etb';
        break;
      case 'any_permanent':
        triggerType = 'permanent_etb';
        break;
      case 'creature':
        triggerType = 'creature_etb';
        break;
      default:
        triggerType = 'etb';
    }

    const knownEffectText = String(info.effect || '');
    const knownTargetType = detectTargetType(knownEffectText);
    const knownRequiresTarget = /\btarget\b/i.test(knownEffectText) || !!knownTargetType;
    
    const trigger: TriggeredAbility = {
      permanentId,
      cardName,
      triggerType,
      description: info.effect,
      effect: info.effect,
      millAmount: info.millAmount,
      mandatory: !String(info.effect || '').toLowerCase().includes('you may'),
      requiresChoice: String(info.effect || '').toLowerCase().includes('you may'),
      requiresTarget: knownRequiresTarget,
      targetType: knownTargetType,
    };
    
    // Add search filter info if present
    if (info.searchFilter) {
      (trigger as any).searchFilter = info.searchFilter;
      (trigger as any).searchDestination = info.searchDestination || 'hand';
      (trigger as any).searchEntersTapped = info.searchEntersTapped || false;
    }
    
    triggers.push(trigger);
  }
  
  // "When ~ enters the battlefield" or "When [CARDNAME] enters the battlefield"
  // The ~ is used in some oracle text, but the actual card name is also used
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Use shared utility function for regex escaping
  const etbNameVariants = buildCardNameRegexAlternatives(cardName);
  // Combine static alternatives with dynamic card name variants
  const etbAlternatives = [...ETB_STATIC_ALTERNATIVES, ...etbNameVariants];

  const state: EtbDetectionState = {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    etbNameVariants,
    etbAlternatives,
    card,
    permanent,
  };
  appendEtbDetectionEarly(state);
  appendEtbDetectionMid(state);
  appendEtbDetectionLate(state);
  // "This ability triggers only once each turn." rides along at the end of the captured effect
  // (Caretaker's Talent). Turn it into the oncePerTurn flag the queue paths enforce, and keep the
  // clause out of the effect that resolves.
  for (const trigger of triggers as any[]) {
    const effect = String(trigger?.effect || trigger?.description || '');
    if (!/this ability triggers only once each turn/i.test(effect)) continue;
    trigger.oncePerTurn = true;
    const strip = (text: unknown) => String(text || '').replace(/\s*This ability triggers only once each turn\.?/gi, '').trim();
    if (trigger.effect) trigger.effect = strip(trigger.effect);
    if (trigger.description) trigger.description = strip(trigger.description);
  }
  return triggers;
}

export function getETBTriggersForPermanent(card: any, permanent: any, gameState?: any): TriggeredAbility[] {
  return detectETBTriggers(card, permanent, gameState);
}
