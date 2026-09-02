/**
 * Origin parent: rules-engine/src/oracleTextParser.ts
 * Cluster moved: activated-ability patterns, isGrantedQuotedActivatedAbilityLine,
 * firstColonIsInsideQuotes, parseActivatedAbility
 * Public entry symbols: parseActivatedAbility, KEYWORD_COST_PATTERN, isGrantedQuotedActivatedAbilityLine
 * Leaf must not import oracleTextParser.ts or oracleTextParser-handlers/index.ts.
 */

import {
  hasTargeting,
  isManaProducingAbility,
  parseTargets,
} from '../oracleTextParserSupport';
import {
  expandKeywordCostAbility,
  parseKeywordPrefixedActivatedAbility,
  parseStationKeywordActivatedAbility,
  parseStationThresholdActivatedAbility,
} from '../oracleTextParserKeywordCosts';
import { AbilityType, type ParsedAbility } from './oracleTextParserTypes.js';

// =============================================================================
// ACTIVATED ABILITIES (Rule 602)
// Golden Rule: [Cost] : [Effect]
// =============================================================================

/**
 * Regex pattern for activated abilities
 * Captures: cost (group 1), effect (group 2)
 * 
 * The colon is a hard delimiter:
 * - Everything to the left is the Cost (happens immediately, cannot be responded to)
 * - Everything to the right is the Effect (goes on the stack)
 */
// Note: Use [\s\S] so multiline modal/bullet effects are supported.
const ACTIVATED_ABILITY_PATTERN = /^([^:]+?):\s*([\s\S]+)$/;

/**
 * Planeswalker loyalty ability pattern
 * Captures: loyalty change (group 1), effect (group 2)
 */
// Note: Use [\s\S] so multiline modal/bullet effects are supported.
const LOYALTY_ABILITY_PATTERN = /^([+−-]?\d+|0)\s*:\s*([\s\S]+)$/;

/**
 * Keyword lines that behave like activated abilities or special actions once
 * a cost is supplied. Pure spell modifiers / ability words such as Kicker,
 * Flashback, Landfall, or Ward are intentionally excluded here so they don't
 * get misclassified as inert activated keyword stubs.
 *
 * Captures: keyword (group 1), cost (group 2)
 */
export const KEYWORD_COST_PATTERN = /^(Adapt|Basic landcycling|[A-Za-z]+cycling|Buyback|Cycling|Disguise|Disturb|Embalm|Encore|Equip|Escape|Eternalize|Flashback|Foretell|Fortify|Jump-start|Level up|Megamorph|Morph|Outlast|Reconfigure|Reinforce|Replicate|Retrace|Scavenge|Suspend|Transfigure|Transmute|Unearth)\s+(.+)$/i;

export function isGrantedQuotedActivatedAbilityLine(text: string): boolean {
  const normalized = String(text || '').replace(/\u2019/g, "'").trim();
  if (!normalized.includes(':')) return false;
  return /\b(?:has|have|gains?)\s+"[^"]+:\s*[^"]+"\s*\.?$/i.test(normalized);
}

function firstColonIsInsideQuotes(text: string): boolean {
  const normalized = String(text || '').replace(/\u2019/g, "'");
  const colonIndex = normalized.indexOf(':');
  if (colonIndex < 0) return false;

  const lastQuoteBeforeColon = normalized.lastIndexOf('"', colonIndex);
  if (lastQuoteBeforeColon < 0) return false;
  const nextQuoteAfterColon = normalized.indexOf('"', colonIndex);
  return nextQuoteAfterColon > colonIndex;
}

/**
 * Parse an activated ability from oracle text line
 */
export function parseActivatedAbility(text: string): ParsedAbility | null {
  if (isGrantedQuotedActivatedAbilityLine(text) || firstColonIsInsideQuotes(text)) {
    return null;
  }

  // Check for planeswalker loyalty ability first
  const loyaltyMatch = text.match(LOYALTY_ABILITY_PATTERN);
  if (loyaltyMatch) {
    return {
      type: AbilityType.ACTIVATED,
      text,
      cost: loyaltyMatch[1],
      effect: loyaltyMatch[2].trim(),
      isLoyaltyAbility: true,
      isOptional: false,
    };
  }

  const prefixedKeywordActivated = parseKeywordPrefixedActivatedAbility(text);
  if (prefixedKeywordActivated) {
    const isManaAbility =
      isManaProducingAbility(prefixedKeywordActivated.effect) &&
      !hasTargeting(prefixedKeywordActivated.effect);
    return {
      type: AbilityType.KEYWORD,
      text: prefixedKeywordActivated.text,
      cost: prefixedKeywordActivated.cost,
      effect: prefixedKeywordActivated.effect,
      isManaAbility,
      isOptional: prefixedKeywordActivated.effect.toLowerCase().includes('you may'),
      targets: parseTargets(prefixedKeywordActivated.effect),
    };
  }

  const stationKeywordActivated = parseStationKeywordActivatedAbility(text);
  if (stationKeywordActivated) {
    const isManaAbility =
      isManaProducingAbility(stationKeywordActivated.effect) &&
      !hasTargeting(stationKeywordActivated.effect);
    return {
      type: AbilityType.KEYWORD,
      text: stationKeywordActivated.text,
      cost: stationKeywordActivated.cost,
      effect: stationKeywordActivated.effect,
      isManaAbility,
      isOptional: stationKeywordActivated.effect.toLowerCase().includes('you may'),
      targets: parseTargets(stationKeywordActivated.effect),
    };
  }

  const stationThresholdActivated = parseStationThresholdActivatedAbility(text);
  if (stationThresholdActivated) {
    const isManaAbility =
      isManaProducingAbility(stationThresholdActivated.effect) &&
      !hasTargeting(stationThresholdActivated.effect);
    return {
      type: AbilityType.ACTIVATED,
      text: stationThresholdActivated.text,
      cost: stationThresholdActivated.cost,
      effect: stationThresholdActivated.effect,
      stationChargeThreshold: stationThresholdActivated.stationChargeThreshold,
      isManaAbility,
      isOptional: stationThresholdActivated.effect.toLowerCase().includes('you may'),
      targets: parseTargets(stationThresholdActivated.effect),
    };
  }
  
  // Check for keyword with cost
  const keywordMatch = text.match(KEYWORD_COST_PATTERN);
  if (keywordMatch) {
    const rawCost = keywordMatch[2].trim();
    const cost = rawCost.replace(/\s+\([^()]*\)\s*$/, '').trim();
    if (
      String(keywordMatch[1] || '').trim().toLowerCase() === 'unearth' &&
      !/\{[^}]+\}/.test(cost || rawCost)
    ) {
      return null;
    }
    // Suspend N—{cost} is a keyword line. Do not swallow the spell's resolution
    // text when reminder parentheses were stripped ("Suspend 3-{R}{R} Shuffle…").
    if (String(keywordMatch[1] || '').trim().toLowerCase() === 'suspend') {
      const suspendCostOnly = /^(?:\d+\s*[-—–]\s*(?:\{[^}]+\})+)$/.test(cost || rawCost);
      if (!suspendCostOnly) return null;
    }
    const expandedKeywordAbility = expandKeywordCostAbility(text, keywordMatch[1], cost || rawCost);
    if (expandedKeywordAbility) {
      const isManaAbility =
        isManaProducingAbility(expandedKeywordAbility.effect) &&
        !hasTargeting(expandedKeywordAbility.effect);
      return {
        type: AbilityType.KEYWORD,
        text: expandedKeywordAbility.text,
        cost: expandedKeywordAbility.cost,
        effect: expandedKeywordAbility.effect,
        isManaAbility,
        isOptional: expandedKeywordAbility.effect.toLowerCase().includes('you may'),
        targets: parseTargets(expandedKeywordAbility.effect),
      };
    }
    return {
      type: AbilityType.KEYWORD,
      text,
      cost: cost || rawCost,
      effect: keywordMatch[1], // The keyword itself is the effect
    };
  }
  
  // Standard activated ability
  const activatedMatch = text.match(ACTIVATED_ABILITY_PATTERN);
  if (activatedMatch) {
    const cost = activatedMatch[1].trim();
    const effect = activatedMatch[2].trim();
    
    // Skip if this looks like a triggered ability (cost starts with when/whenever/at)
    if (/^(when|whenever|at\s+the\s+beginning)/i.test(cost)) {
      return null;
    }
    
    // Skip reminder text (parentheses)
    if (cost.startsWith('(')) {
      return null;
    }
    
    // Determine if it's a mana ability
    const isManaAbility = isManaProducingAbility(effect) && !hasTargeting(effect);
    
    return {
      type: AbilityType.ACTIVATED,
      text,
      cost,
      effect,
      isManaAbility,
      isOptional: effect.toLowerCase().includes('you may'),
      targets: parseTargets(effect),
    };
  }
  
  return null;
}
