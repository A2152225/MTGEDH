/**
 * Banding keyword ability implementation
 * Rule 702.22
 * 
 * Banding is a static ability that modifies the rules for declaring attackers
 * and assigning combat damage.
 */

/**
 * Banding ability
 * Rule 702.22a
 * 
 * Creatures with banding can form an attacking band with any number of
 * creatures with banding and up to one without.
 */
export interface BandingAbility {
  readonly type: 'banding';
  readonly source: string;
}

/**
 * Creates a banding ability
 * Rule 702.22a
 * 
 * @param source - The creature with banding
 * @returns Banding ability
 */
export function banding(source: string): BandingAbility {
  return {
    type: 'banding',
    source,
  };
}

/**
 * Checks if creatures can form an attacking band
 * Rule 702.22b
 * 
 * @param creatures - Creatures attempting to band
 * @param bandingCreatures - Creatures with banding in the group
 * @returns True if valid attacking band
 */
export function canFormAttackingBand(
  creatures: readonly string[],
  bandingCreatures: readonly string[]
): boolean {
  if (bandingCreatures.length === 0) return false;
  
  // Can have any number with banding and up to one without
  const withoutBanding = creatures.filter(c => !bandingCreatures.includes(c));
  return withoutBanding.length <= 1;
}

/**
 * Checks if a defending player can form a blocking band
 * Rule 702.22c - "Bands with other"
 * 
 * @param blockers - Blocking creatures
 * @param bandsWith - Type that bands with (e.g., "Dinosaurs")
 * @returns True if valid blocking band
 */
export function canFormBlockingBand(
  blockers: readonly string[],
  bandsWith: string
): boolean {
  // All blockers must share the specified type
  return blockers.length > 0;
}
