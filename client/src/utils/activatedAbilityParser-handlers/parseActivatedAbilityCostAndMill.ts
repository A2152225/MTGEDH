/**
 * Origin parent: client/src/utils/activatedAbilityParser.ts
 *
 * Cluster moved: parseMillEffect, isSelfTapCost, parseCostComponents.
 *
 * Public entry symbols: parseMillEffect, isSelfTapCost, parseCostComponents.
 */

import { parseNumberFromText, parseSacrificeCost, type SacrificeType } from '../../../../shared/src/textUtils';
import type { TapOtherPermanentsCost } from './activatedAbilityParserTypes';

/**
 * Parse mill effects from oracle text
 * Returns mill count and target type if this is a mill ability
 * 
 * Patterns matched:
 * - "Target player mills X cards" / "target player puts the top X cards of their library into their graveyard"
 * - "Each player mills X cards"
 * - "Target opponent mills X cards"
 * - "Mill X cards" (self-mill)
 * - "You mill X cards"
 */
export function parseMillEffect(effectText: string): { 
  isMillAbility: boolean; 
  millCount?: number; 
  millTargetType?: 'player' | 'self' | 'opponent' | 'any';
} | null {
  const lower = effectText.toLowerCase();
  
  // Pattern: "target player mills X cards" or "target player puts the top X cards...into...graveyard"
  const targetPlayerMillMatch = lower.match(/target\s+player\s+(?:mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)|puts?\s+the\s+top\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\s+.*(?:into|in)\s+(?:their|his or her)\s+graveyard)/i);
  if (targetPlayerMillMatch) {
    const numStr = targetPlayerMillMatch[1] || targetPlayerMillMatch[2];
    const count = parseNumberFromText(numStr);
    return { isMillAbility: true, millCount: count, millTargetType: 'player' };
  }
  
  // Pattern: "target opponent mills X cards"
  const targetOpponentMillMatch = lower.match(/target\s+opponent\s+mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
  if (targetOpponentMillMatch) {
    const numStr = targetOpponentMillMatch[1];
    const count = parseNumberFromText(numStr);
    return { isMillAbility: true, millCount: count, millTargetType: 'opponent' };
  }
  
  // Pattern: "each opponent mills cards equal to the number of cards in their hand"
  if (/each\s+opponent\s+mills?\s+cards?\s+equal\s+to\s+the\s+number\s+of\s+cards\s+in\s+their\s+hand/i.test(lower)) {
    return { isMillAbility: true, millTargetType: 'opponent' };
  }

  // Pattern: "each player mills X cards" or "each opponent mills X cards"
  const eachPlayerMillMatch = lower.match(/each\s+(?:player|opponent)\s+mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
  if (eachPlayerMillMatch) {
    const numStr = eachPlayerMillMatch[1];
    const count = parseNumberFromText(numStr);
    const targetType = lower.includes('each opponent') ? 'opponent' : 'any';
    return { isMillAbility: true, millCount: count, millTargetType: targetType };
  }
  
  // Pattern: self mill - "mill X cards" without target, or "you mill X cards"
  const selfMillMatch = lower.match(/(?:^|\.\s*|,\s*)(?:you\s+)?mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
  if (selfMillMatch && !lower.includes('target')) {
    const numStr = selfMillMatch[1];
    const count = parseNumberFromText(numStr);
    return { isMillAbility: true, millCount: count, millTargetType: 'self' };
  }
  
  return null;
}

/**
 * Check if a cost string indicates tapping the source permanent (vs. tapping other permanents)
 * 
 * Returns true for:
 * - {T} symbol
 * - "T" alone
 * 
 * Returns false for:
 * - "Tap an untapped [Type]" - this is tapping other permanents
 * - "Tap another" - this is tapping other permanents
 */
export function isSelfTapCost(costStr: string): boolean {
  const lower = costStr.toLowerCase();
  
  // These patterns indicate tapping OTHER permanents, not self
  if (lower.includes('tap an untapped') || lower.includes('tap another')) {
    return false;
  }
  
  // Check for tap symbol
  return lower.includes('{t}') || lower === 't';
}

/**
 * Parse cost components from cost string
 */
export function parseCostComponents(costStr: string): {
  requiresTap: boolean;
  requiresUntap: boolean;
  requiresSacrifice: boolean;
  sacrificeType?: SacrificeType;
  sacrificeCount?: number;
  manaCost?: string;
  lifeCost?: number;
  loyaltyCost?: number;
  otherCosts: string[];
  tapOtherPermanentsCost?: TapOtherPermanentsCost;
  hasXCost?: boolean;
  xCount?: number;
  mustBeOther?: boolean;
} {
  const result: {
    requiresTap: boolean;
    requiresUntap: boolean;
    requiresSacrifice: boolean;
    sacrificeType?: SacrificeType;
    sacrificeCount?: number;
    manaCost?: string;
    lifeCost?: number;
    loyaltyCost?: number;
    otherCosts: string[];
    tapOtherPermanentsCost?: TapOtherPermanentsCost;
    hasXCost?: boolean;
    xCount?: number;
    mustBeOther?: boolean;
  } = {
    requiresTap: false,
    requiresUntap: false,
    requiresSacrifice: false,
    sacrificeType: undefined,
    sacrificeCount: undefined,
    manaCost: undefined,
    lifeCost: undefined,
    loyaltyCost: undefined,
    otherCosts: [],
    tapOtherPermanentsCost: undefined,
    hasXCost: false,
    xCount: 0,
    mustBeOther: false,
  };

  const lowerCost = costStr.toLowerCase();
  
  // Check for self-tap cost using the helper function
  if (isSelfTapCost(costStr)) {
    result.requiresTap = true;
  }
  
  // Check for untap symbol (e.g., {Q})
  if (lowerCost.includes('{q}')) {
    result.requiresUntap = true;
  }
  
  // Check for sacrifice and parse what type using shared utility
  const sacrificeInfo = parseSacrificeCost(costStr);
  if (sacrificeInfo.requiresSacrifice) {
    result.requiresSacrifice = true;
    result.sacrificeType = sacrificeInfo.sacrificeType;
    result.sacrificeCount = sacrificeInfo.sacrificeCount;
    result.mustBeOther = sacrificeInfo.mustBeOther;
  }
  
  // Extract mana cost (including Phyrexian mana symbols like {W/P}, {U/P}, etc.)
  const manaSymbols = costStr.match(/\{[WUBRGC0-9X\/P]+\}/gi);
  if (manaSymbols) {
    // Filter out {T} and {Q}
    const manaPart = manaSymbols.filter(s => 
      s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}'
    ).join('');
    if (manaPart) {
      result.manaCost = manaPart;
      
      // Check for X in mana cost
      const xMatches = manaPart.match(/\{X\}/gi);
      if (xMatches) {
        result.hasXCost = true;
        result.xCount = xMatches.length;
      }
    }
  }
  
  // Extract life cost
  const lifeMatch = costStr.match(/pay\s+(\d+)\s+life/i);
  if (lifeMatch) {
    result.lifeCost = parseInt(lifeMatch[1], 10);
  }
  
  // Extract loyalty cost (planeswalker abilities)
  const loyaltyMatch = costStr.match(/\[([+−\-]?\d+)\]/);
  if (loyaltyMatch) {
    result.loyaltyCost = parseInt(loyaltyMatch[1].replace('−', '-'), 10);
  }
  
  // Parse tap-other-permanents cost (e.g., "Tap an untapped Merfolk you control")
  // Patterns:
  // - "Tap an untapped [Type] you control"
  // - "Tap another untapped [Type] you control"
  // - "Tap two untapped [Types] you control"
  const tapOtherMatch = costStr.match(/tap\s+(an(?:other)?|two|three|\d+)\s+untapped\s+([^:,]+?)(?:\s+you\s+control)?(?::|,|$)/i);
  if (tapOtherMatch) {
    const countWord = tapOtherMatch[1].toLowerCase();
    let count = 1;
    if (countWord === 'two') count = 2;
    else if (countWord === 'three') count = 3;
    else if (/^\d+$/.test(countWord)) count = parseInt(countWord, 10);
    
    const typeStr = tapOtherMatch[2].trim();
    const types = typeStr.split(/\s+/).filter(t => t.length > 0);
    const notSelf = countWord === 'another' || lowerCost.includes('another');
    
    result.tapOtherPermanentsCost = {
      count,
      filter: {
        types,
        controller: 'you',
        mustBeUntapped: true,
        notSelf,
      },
      description: tapOtherMatch[0].trim(),
    };
  }
  
  // Other costs
  const otherCostPatterns = [
    /discard\s+(?:a|an|one)\s+card/i,
    /exile\s+(?:a|an|one)\s+card/i,
    /remove\s+\d+\s+counters?/i,
  ];
  
  for (const pattern of otherCostPatterns) {
    const match = costStr.match(pattern);
    if (match) {
      result.otherCosts.push(match[0]);
    }
  }
  
  return result;
}
