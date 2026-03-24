/**
 * replacementEffects.ts
 * 
 * Handles replacement effects for common game scenarios.
 * 
 * Based on MTG Comprehensive Rules:
 * - Rule 614: Replacement Effects
 * - Rule 615: Prevention Effects
 */

import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import {
  applyReplacementEffect,
  evaluateETBCondition,
} from './replacementEffectsEvaluation';
import { parseReplacementEffectsFromText } from './replacementEffectsParsing';
import {
  type ETBConditionCheck,
  type ParsedReplacementEffect,
  type ReplacementResult,
} from './replacementEffectsTypes';

export { applyReplacementEffect, evaluateETBCondition } from './replacementEffectsEvaluation';
export { parseReplacementEffectsFromText } from './replacementEffectsParsing';
export {
  ReplacementEffectType,
  type ETBConditionCheck,
  type ParsedReplacementEffect,
  type ReplacementResult,
} from './replacementEffectsTypes';

/**
 * Parse replacement effects from oracle text
 */
/**
 * Collect all active replacement effects from battlefield
 */
export function collectReplacementEffects(
  battlefield: BattlefieldPermanent[]
): ParsedReplacementEffect[] {
  const effects: ParsedReplacementEffect[] = [];
  
  for (const perm of battlefield) {
    const card = perm.card as KnownCardRef;
    if (!card?.oracle_text) continue;
    
    const parsed = parseReplacementEffectsFromText(
      card.oracle_text,
      perm.id,
      perm.controller,
      card.name || 'Unknown'
    );
    effects.push(...parsed);
  }
  
  return effects;
}

/**
 * Sort replacement effects by priority (self-replacement first)
 */
export function sortReplacementEffects(
  effects: ParsedReplacementEffect[],
  eventSourceId: string
): ParsedReplacementEffect[] {
  return [...effects].sort((a, b) => {
    // Self-replacement effects apply first (Rule 614.12)
    const aIsSelf = a.isSelfReplacement && a.sourceId === eventSourceId;
    const bIsSelf = b.isSelfReplacement && b.sourceId === eventSourceId;
    
    if (aIsSelf && !bIsSelf) return -1;
    if (!aIsSelf && bIsSelf) return 1;
    
    return 0;
  });
}

export default {
  parseReplacementEffectsFromText,
  evaluateETBCondition,
  applyReplacementEffect,
  collectReplacementEffects,
  sortReplacementEffects,
};
