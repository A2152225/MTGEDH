/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectDeathTriggers (merged into triggers/; leftover re-exports)
 * Public: detectDeathTriggers, collectDeathTriggerEffectText
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { mergeDetectorOracleWithContinuousGrants } from "./detectorGrantedOracle.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import type { DeathDetectionState } from "./death-detection-state.js";
import { appendDeathDetectionEarly } from "./death-detection-early.js";
import { appendDeathDetectionMid } from "./death-detection-mid.js";
import { appendDeathDetectionLate } from "./death-detection-late.js";
import { printedKeywordDeathAbilities } from "../../../../../rules-engine/src/triggerCondition/index.js";
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';

export function collectDeathTriggerEffectText(oracleText: string, match: RegExpMatchArray, effectCaptureIndex: number): string {
  const effect = String(match?.[effectCaptureIndex] || '').trim();
  if (!effect) {
    return effect;
  }

  const matchText = String(match?.[0] || '');
  const matchStart = typeof match?.index === 'number'
    ? match.index
    : String(oracleText || '').indexOf(matchText);
  if (matchStart < 0 || !matchText) {
    return effect;
  }

  const sameLineTail = String(oracleText || '')
    .slice(matchStart + matchText.length)
    .split(/\r?\n/)[0] || '';

  const collectsDirectReflexiveContinuation =
    /^you may pay\s+(?:any amount of\s+)?\{[^}]+\}(?:\{[^}]+\})*$/i.test(effect) ||
    /^you may exile (?:it|this card)$/i.test(effect);
  const collectsThenSelfExileContinuation = /^\s*\.\s*then\s+you\s+may\s+exile\s+this\s+card\.\s*(?:when|if)\s+you\s+do,?/i.test(sameLineTail);
  if (!collectsDirectReflexiveContinuation && !collectsThenSelfExileContinuation) {
    return effect;
  }

  const continuationMatch = collectsThenSelfExileContinuation
    ? sameLineTail.match(/^\s*\.\s*((?:then\s+you\s+may\s+exile\s+this\s+card\.\s*(?:when|if)\s+you\s+do,?\s+[^.]+\.)(?:\s+(?:if\s+it['’]?s|it['’]?s|then)\b[^.]+\.)*)/i)
    : sameLineTail.match(/^\s*\.\s*((?:(?:if|when)\s+you\s+do,?\s+[^.]+\.)(?:\s+(?:if\s+it['’]?s|it['’]?s|then)\b[^.]+\.)*)/i);
  const continuation = String(continuationMatch?.[1] || '').trim();
  return continuation ? `${effect}. ${continuation}` : effect;
}

/**
 * Detect death triggers from a permanent's abilities.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_DEATH_TRIGGERS table serves as an optimization
 * fallback for special handling.
 * 
 * Patterns detected:
 * - "When ~ dies, [effect]" - self death trigger
 * - "Whenever a creature you control dies, [effect]" - controlled creature death
 * - "Whenever a creature dies, [effect]" - any creature death
 * - "Whenever a creature an opponent controls dies, [effect]" - opponent creature death
 * - "Undying" keyword
 * - "Persist" keyword
 */
const DEATH_DETECTION_CACHE = new Map<string, TriggeredAbility[]>();

export function detectDeathTriggers(card: any, permanent: any, gameState?: any): TriggeredAbility[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'dies' })) return []; // Humility / Torpor Orb gate
  const triggers: TriggeredAbility[] = [];
  const { oracleText } = mergeDetectorOracleWithContinuousGrants(card?.oracle_text || "", permanent, gameState);
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const counters = permanent?.counters || {};
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  const printedDeathKeywords = printedKeywordDeathAbilities(oracleText);
  if (printedDeathKeywords.includes("undying")) {
    const hasPlusCounter = (counters["+1/+1"] || counters["plus1plus1"] || 0) > 0;
    if (!hasPlusCounter) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'undying',
        description: "Return to battlefield with +1/+1 counter",
        mandatory: true,
      });
    }
  }

  if (printedDeathKeywords.includes("persist")) {
    const hasMinusCounter = (counters["-1/-1"] || counters["minus1minus1"] || 0) > 0;
    if (!hasMinusCounter) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'persist',
        description: "Return to battlefield with -1/-1 counter",
        mandatory: true,
      });
    }
  }
  
  const dieNameVariants = buildCardNameRegexAlternatives(cardName);

  const namedOrNontokenDiesOrCombatDamageMatch = oracleText.match(
    new RegExp(
      `whenever (?:${dieNameVariants.join('|')}) or another nontoken ([\\w]+) you control dies or deals combat damage to a player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrNontokenDiesOrCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_nontoken_dies_or_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrNontokenDiesOrCombatDamageMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_nontoken_dies_or_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieSelfAlternatives = [
    '~',
    'this creature',
    'this permanent',
    'this artifact',
    'this enchantment',
    'this aura',
    'this token',
    'this equipment',
    'this vehicle',
    'this planeswalker',
    'this battle',
    'this land',
    ...dieNameVariants,
  ];

  const state: DeathDetectionState = {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    counters,
    dieNameVariants,
    dieSelfAlternatives,
  };
  // The early/mid/late detectors are pure in (oracle, name, id, prior triggers); replay scans call this
  // once per permanent per death, so reuse the parsed result.
  const cacheKey = triggers.map((t) => t.triggerType).join(',') + '\u0000' + permanentId + '\u0000' + cardName + '\u0000' + oracleText;
  const cachedTail = DEATH_DETECTION_CACHE.get(cacheKey);
  if (cachedTail) {
    for (const t of cachedTail) triggers.push(structuredClone(t));
    return triggers;
  }
  const before = triggers.length;
  appendDeathDetectionEarly(state);
  appendDeathDetectionMid(state);
  appendDeathDetectionLate(state);
  if (DEATH_DETECTION_CACHE.size >= 20000) DEATH_DETECTION_CACHE.clear();
  DEATH_DETECTION_CACHE.set(cacheKey, structuredClone(triggers.slice(before)));
  return triggers;
}
