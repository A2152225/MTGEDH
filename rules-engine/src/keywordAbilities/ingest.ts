/**
 * Ingest keyword ability (Rule 702.115)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.115. Ingest
 * 702.115a Ingest is a triggered ability. "Ingest" means "Whenever this creature deals combat 
 * damage to a player, that player exiles the top card of their library."
 * 702.115b If a creature has multiple instances of ingest, each triggers separately.
 */

export interface IngestAbility {
  readonly type: 'ingest';
  readonly source: string;
  readonly timesTriggered: number;
}

/**
 * Create an ingest ability
 * Rule 702.115a
 * @param source - The creature with ingest
 * @returns Ingest ability object
 */
export function ingest(source: string): IngestAbility {
  return {
    type: 'ingest',
    source,
    timesTriggered: 0,
  };
}

/**
 * Trigger ingest when creature deals combat damage to player
 * Rule 702.115a - Player exiles top card of library
 * @param ability - Ingest ability
 * @returns Updated ability with incremented trigger count
 */
export function triggerIngest(ability: IngestAbility): IngestAbility {
  return {
    ...ability,
    timesTriggered: ability.timesTriggered + 1,
  };
}

/**
 * Get total times ingest has triggered
 * @param ability - Ingest ability
 * @returns Number of times triggered
 */
export function getIngestTriggers(ability: IngestAbility): number {
  return ability.timesTriggered;
}

/**
 * Multiple instances of ingest trigger separately
 * Rule 702.115b
 * @param abilities - Array of ingest abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantIngest(abilities: readonly IngestAbility[]): boolean {
  return false; // Each instance triggers separately
}
