/**
 * Cleave keyword ability (Rule 702.148)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.148. Cleave
 * 702.148a Cleave is a keyword that represents two static abilities that function while a spell 
 * with cleave is on the stack. "Cleave [cost]" means "You may cast this spell by paying [cost] 
 * rather than paying its mana cost" and "If this spell's cleave cost was paid, change its text 
 * by removing all text found within square brackets in the spell's rules text." Casting a spell 
 * for its cleave cost follows the rules for paying alternative costs.
 * 702.148b Cleave's second ability is a text-changing effect.
 */

export interface CleaveAbility {
  readonly type: 'cleave';
  readonly source: string;
  readonly cleaveCost: string;
  readonly wasCleaved: boolean;
  readonly originalText: string;
  readonly cleavedText?: string;
}

/**
 * Create a cleave ability
 * Rule 702.148a
 * @param source - The spell with cleave
 * @param cleaveCost - Alternative cost
 * @param originalText - Full text with [bracketed] portions
 * @returns Cleave ability object
 */
export function cleave(source: string, cleaveCost: string, originalText: string): CleaveAbility {
  return {
    type: 'cleave',
    source,
    cleaveCost,
    wasCleaved: false,
    originalText,
  };
}

/**
 * Cast spell with cleave cost
 * Rule 702.148a - Remove text in square brackets
 * @param ability - Cleave ability
 * @param cleavedText - Text after removing bracketed portions
 * @returns Updated ability
 */
export function castWithCleave(ability: CleaveAbility, cleavedText: string): CleaveAbility {
  return {
    ...ability,
    wasCleaved: true,
    cleavedText,
  };
}

/**
 * Check if spell was cleaved
 * @param ability - Cleave ability
 * @returns True if cleaved
 */
export function wasCleaved(ability: CleaveAbility): boolean {
  return ability.wasCleaved;
}

/**
 * Get effective text
 * Rule 702.148a - Original or cleaved based on whether cleaved
 * @param ability - Cleave ability
 * @returns Effective spell text
 */
export function getEffectiveText(ability: CleaveAbility): string {
  return ability.wasCleaved && ability.cleavedText ? ability.cleavedText : ability.originalText;
}

/**
 * Get cleave cost
 * @param ability - Cleave ability
 * @returns Cleave cost string
 */
export function getCleaveCost(ability: CleaveAbility): string {
  return ability.cleaveCost;
}

/**
 * Cleave abilities with same cost are redundant
 * @param abilities - Array of cleave abilities
 * @returns True if costs match
 */
export function hasRedundantCleave(abilities: readonly CleaveAbility[]): boolean {
  if (abilities.length <= 1) {
    return false;
  }
  
  const costs = new Set(abilities.map(a => a.cleaveCost));
  return costs.size < abilities.length;
}
