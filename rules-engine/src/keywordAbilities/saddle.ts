/**
 * Saddle keyword ability (Rule 702.171)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.171. Saddle
 * 702.171a Saddle is an activated ability. "Saddle N" means "Tap any number of other untapped 
 * creatures you control with total power N or greater: This permanent becomes saddled until end 
 * of turn. Activate only as a sorcery."
 * 702.171b Saddled is a designation that has no rules meaning other than to act as a marker that 
 * spells and abilities can identify. Only permanents can be or become saddled. Once a permanent 
 * has become saddled, it stays saddled until the end of the turn or it leaves the battlefield.
 * 702.171c A creature "saddles" a permanent as it's tapped to pay the cost to activate a 
 * permanent's saddle ability.
 */

export interface SaddleAbility {
  readonly type: 'saddle';
  readonly source: string;
  readonly saddleValue: number; // Minimum total power required
  readonly isSaddled: boolean;
  readonly saddledCreatures: readonly string[];
}

export interface SaddleSummary {
  readonly source: string;
  readonly saddleValue: number;
  readonly isSaddled: boolean;
  readonly saddledCreatureCount: number;
  readonly canActivate: boolean;
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
 * Create a saddle ability
 * Rule 702.171a
 * @param source - The permanent with saddle
 * @param saddleValue - Minimum total power required
 * @returns Saddle ability object
 */
export function saddle(source: string, saddleValue: number): SaddleAbility {
  return {
    type: 'saddle',
    source,
    saddleValue,
    isSaddled: false,
    saddledCreatures: [],
  };
}

/**
 * Activate saddle ability
 * Rule 702.171a - Tap creatures with total power N or greater
 * Rule 702.171c - Those creatures "saddle" this permanent
 * @param ability - Saddle ability
 * @param saddledCreatures - IDs of tapped creatures
 * @param totalPower - Total power of tapped creatures
 * @returns Updated ability or null if insufficient power
 */
export function activateSaddle(
  ability: SaddleAbility,
  saddledCreatures: readonly string[],
  totalPower: number
): SaddleAbility | null {
  if (totalPower < ability.saddleValue) {
    return null;
  }
  
  return {
    ...ability,
    isSaddled: true,
    saddledCreatures,
  };
}

/**
 * Check whether the saddle activation is currently legal.
 * Rule 702.171a
 */
export function canActivateSaddle(
  ability: SaddleAbility,
  saddledCreatures: readonly string[],
  totalPower: number,
  isSorcerySpeed: boolean,
): boolean {
  return isSorcerySpeed && saddledCreatures.length > 0 && totalPower >= ability.saddleValue;
}

/**
 * Check if permanent is saddled
 * Rule 702.171b
 * @param ability - Saddle ability
 * @returns True if saddled
 */
export function isSaddled(ability: SaddleAbility): boolean {
  return ability.isSaddled;
}

/**
 * Reset saddled status at end of turn
 * Rule 702.171b - Saddled until end of turn
 * @param ability - Saddle ability
 * @returns Ability with saddled reset
 */
export function resetSaddle(ability: SaddleAbility): SaddleAbility {
  return {
    ...ability,
    isSaddled: false,
    saddledCreatures: [],
  };
}

/**
 * Parse a saddle value from oracle text.
 */
export function parseSaddleValue(oracleText: string): number | null {
  return extractNumericKeywordValue(oracleText, 'saddle');
}

/**
 * Multiple instances of saddle are not redundant
 * @param abilities - Array of saddle abilities
 * @returns False
 */
export function hasRedundantSaddle(abilities: readonly SaddleAbility[]): boolean {
  return false;
}

export function createSaddleSummary(
  ability: SaddleAbility,
  totalPower: number,
  isSorcerySpeed: boolean,
): SaddleSummary {
  return {
    source: ability.source,
    saddleValue: ability.saddleValue,
    isSaddled: ability.isSaddled,
    saddledCreatureCount: ability.saddledCreatures.length,
    canActivate: canActivateSaddle(ability, ability.saddledCreatures, totalPower, isSorcerySpeed),
  };
}
