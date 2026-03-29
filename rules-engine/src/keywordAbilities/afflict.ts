/**
 * Afflict keyword ability (Rule 702.130)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.130. Afflict
 * 702.130a Afflict is a triggered ability. "Afflict N" means "Whenever this creature becomes 
 * blocked, defending player loses N life."
 * 702.130b If a creature has multiple instances of afflict, each triggers separately.
 */

export interface AfflictAbility {
  readonly type: 'afflict';
  readonly source: string;
  readonly afflictValue: number;
  readonly timesTriggered: number;
}

function extractNumericKeywordValue(oracleText: string, keyword: string): number | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const pattern = new RegExp(`\\b${keyword}\\s+(\\d+)`, 'i');
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(String(match[1] || ''), 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Create an afflict ability
 * Rule 702.130a
 * @param source - The creature with afflict
 * @param afflictValue - Amount of life defending player loses
 * @returns Afflict ability object
 */
export function afflict(source: string, afflictValue: number): AfflictAbility {
  return {
    type: 'afflict',
    source,
    afflictValue,
    timesTriggered: 0,
  };
}

/**
 * Trigger afflict when creature becomes blocked
 * Rule 702.130a - Defending player loses N life
 * @param ability - Afflict ability
 * @returns Updated ability
 */
export function triggerAfflict(ability: AfflictAbility): AfflictAbility {
  return {
    ...ability,
    timesTriggered: ability.timesTriggered + 1,
  };
}

/**
 * Get afflict value (life loss amount)
 * @param ability - Afflict ability
 * @returns Life loss amount
 */
export function getAfflictValue(ability: AfflictAbility): number {
  return ability.afflictValue;
}

/**
 * Check whether afflict should trigger for the current combat state.
 */
export function canTriggerAfflict(isBlocked: boolean): boolean {
  return isBlocked;
}

/**
 * Get the number of times afflict has triggered.
 */
export function getAfflictTriggerCount(ability: AfflictAbility): number {
  return ability.timesTriggered;
}

/**
 * Parse an afflict value from oracle text.
 */
export function parseAfflictValue(oracleText: string): number | null {
  return extractNumericKeywordValue(oracleText, 'afflict');
}

/**
 * Multiple instances of afflict trigger separately
 * Rule 702.130b
 * @param abilities - Array of afflict abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantAfflict(abilities: readonly AfflictAbility[]): boolean {
  return false; // Each instance triggers separately
}
