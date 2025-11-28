/**
 * Hexproof - Rule 702.11
 * 
 * This permanent/player can't be the target of spells or abilities your opponents control.
 */

/**
 * Represents the hexproof keyword ability
 * Rule 702.11
 */
export interface HexproofAbility {
  readonly type: 'hexproof';
  readonly source: string; // ID of the object with hexproof
  readonly quality?: string; // Optional quality for "hexproof from [quality]"
}

/**
 * Create a hexproof ability
 * Rule 702.11a - Hexproof is a static ability
 * 
 * @param source - ID of the object with hexproof
 * @param quality - Optional quality restriction (e.g., "blue", "instants")
 * @returns Hexproof ability
 */
export function hexproof(source: string, quality?: string): HexproofAbility {
  return {
    type: 'hexproof',
    source,
    quality,
  };
}

/**
 * Check if a permanent with hexproof can be targeted
 * Rule 702.11b - "Hexproof" on a permanent means "This permanent can't be the target
 * of spells or abilities your opponents control"
 * 
 * @param hasHexproof - Whether the permanent has hexproof
 * @param targetingPlayerIsOpponent - Whether the targeting player is an opponent
 * @returns true if the permanent can be targeted
 */
export function canTargetPermanentWithHexproof(
  hasHexproof: boolean,
  targetingPlayerIsOpponent: boolean
): boolean {
  if (!hasHexproof) {
    return true;
  }
  return !targetingPlayerIsOpponent;
}

/**
 * Check if a player with hexproof can be targeted
 * Rule 702.11c - "Hexproof" on a player means "You can't be the target of spells or
 * abilities your opponents control"
 * 
 * @param hasHexproof - Whether the player has hexproof
 * @param targetingPlayerIsOpponent - Whether the targeting player is an opponent
 * @returns true if the player can be targeted
 */
export function canTargetPlayerWithHexproof(
  hasHexproof: boolean,
  targetingPlayerIsOpponent: boolean
): boolean {
  if (!hasHexproof) {
    return true;
  }
  return !targetingPlayerIsOpponent;
}

/**
 * Check if hexproof from a quality prevents targeting
 * Rule 702.11d - "Hexproof from [quality]" prevents targeting by quality spells/abilities
 * 
 * @param hexproofQuality - The quality protected from (e.g., "blue")
 * @param spellQuality - The quality of the spell/ability
 * @param sourceQuality - The quality of the source
 * @param targetingPlayerIsOpponent - Whether the targeting player is an opponent
 * @returns true if can be targeted
 */
export function canTargetWithHexproofFrom(
  hexproofQuality: string | undefined,
  spellQuality: string,
  sourceQuality: string,
  targetingPlayerIsOpponent: boolean
): boolean {
  if (!hexproofQuality || !targetingPlayerIsOpponent) {
    return true;
  }
  // Can't be targeted if spell or source matches the quality
  return spellQuality !== hexproofQuality && sourceQuality !== hexproofQuality;
}

/**
 * Check if multiple hexproof abilities are redundant
 * Rule 702.11h - Multiple instances of the same hexproof ability are redundant
 * 
 * @param abilities - Array of hexproof abilities
 * @returns true if there are redundant instances
 */
export function hasRedundantHexproof(abilities: readonly HexproofAbility[]): boolean {
  if (abilities.length <= 1) {
    return false;
  }
  // Check for exact duplicates
  const qualityMap = new Map<string | undefined, number>();
  for (const ability of abilities) {
    const count = qualityMap.get(ability.quality) || 0;
    qualityMap.set(ability.quality, count + 1);
  }
  // If any quality appears more than once, it's redundant
  const values = Array.from(qualityMap.values());
  for (const count of values) {
    if (count > 1) {
      return true;
    }
  }
  return false;
}
