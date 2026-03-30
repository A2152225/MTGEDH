/**
 * Disturb keyword ability (Rule 702.146)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.146. Disturb
 * 702.146a Disturb is an ability found on the front face of some double-faced cards. "Disturb 
 * [cost]" means "You may cast this card transformed from your graveyard by paying [cost] rather 
 * than its mana cost."
 * 702.146b A resolving double-faced spell that was cast using its disturb ability enters the 
 * battlefield with its back face up.
 */

export interface DisturbAbility {
  readonly type: 'disturb';
  readonly source: string;
  readonly disturbCost: string;
  readonly wasDisturbed: boolean;
}

export interface DisturbSummary {
  readonly source: string;
  readonly disturbCost: string;
  readonly canCastFromGraveyard: boolean;
  readonly wasDisturbed: boolean;
  readonly entersBackFaceUp: boolean;
}

function extractKeywordCost(oracleText: string, keyword: string): string | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const pattern = new RegExp(`\\b${keyword}\\s+([^.;,()]+)`, 'i');
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const cost = String(match[1] || '').trim();
  return cost || null;
}

/**
 * Create a disturb ability
 * Rule 702.146a
 * @param source - The double-faced card with disturb
 * @param disturbCost - Alternative cost to cast from graveyard
 * @returns Disturb ability object
 */
export function disturb(source: string, disturbCost: string): DisturbAbility {
  return {
    type: 'disturb',
    source,
    disturbCost,
    wasDisturbed: false,
  };
}

/**
 * Cast card from graveyard with disturb
 * Rule 702.146a - Cast transformed
 * @param ability - Disturb ability
 * @returns Updated ability
 */
export function castWithDisturb(ability: DisturbAbility): DisturbAbility {
  return {
    ...ability,
    wasDisturbed: true,
  };
}

/**
 * Check if spell was disturbed
 * Rule 702.146b - Enters with back face up
 * @param ability - Disturb ability
 * @returns True if disturbed
 */
export function wasDisturbed(ability: DisturbAbility): boolean {
  return ability.wasDisturbed;
}

/**
 * Get disturb cost
 * @param ability - Disturb ability
 * @returns Disturb cost string
 */
export function getDisturbCost(ability: DisturbAbility): string {
  return ability.disturbCost;
}

/**
 * Disturb can only be used from the graveyard.
 */
export function canCastWithDisturb(zone: string): boolean {
  return String(zone || '').trim().toLowerCase() === 'graveyard';
}

/**
 * Disturbed spells resolve transformed and enter with their back face up.
 */
export function entersBackFaceUp(ability: DisturbAbility): boolean {
  return ability.wasDisturbed;
}

/**
 * Parse a disturb cost from oracle text.
 */
export function parseDisturbCost(oracleText: string): string | null {
  return extractKeywordCost(oracleText, 'disturb');
}

/**
 * Multiple instances of disturb are not redundant
 * @param abilities - Array of disturb abilities
 * @returns False
 */
export function hasRedundantDisturb(abilities: readonly DisturbAbility[]): boolean {
  return false;
}

export function createDisturbSummary(ability: DisturbAbility, zone: string): DisturbSummary {
  return {
    source: ability.source,
    disturbCost: ability.disturbCost,
    canCastFromGraveyard: canCastWithDisturb(zone),
    wasDisturbed: ability.wasDisturbed,
    entersBackFaceUp: entersBackFaceUp(ability),
  };
}
