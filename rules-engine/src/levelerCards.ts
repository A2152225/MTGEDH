/**
 * Rule 711: Leveler Cards
 * 
 * Implements the rules for leveler cards, which have level symbols that
 * grant different abilities and power/toughness based on level counters.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 711
 */

/**
 * Represents a level range (N1-N2 or N3+).
 */
export type LevelRange = 
  | { type: 'range'; min: number; max: number }
  | { type: 'plus'; min: number };

/**
 * Represents a level symbol's static ability.
 * 
 * Rule 711.2: A level symbol is a keyword ability representing a static ability.
 */
export interface LevelAbility {
  readonly levelRange: LevelRange;
  readonly abilities: readonly string[];
  readonly power: number;
  readonly toughness: number;
}

/**
 * Represents a leveler card.
 * 
 * Rule 711.1: Leveler cards have striated text boxes and three P/T boxes.
 */
export interface LevelerCard {
  readonly type: 'leveler-card';
  readonly name: string;
  readonly manaCost: string;
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly supertypes: readonly string[];
  readonly color: readonly string[];
  readonly basePower: number; // Power when level counters < N1
  readonly baseToughness: number; // Toughness when level counters < N1
  readonly baseAbilities: readonly string[]; // Abilities not in level symbols
  readonly levelAbilities: readonly LevelAbility[]; // Usually 2: N1-N2 and N3+
}

/**
 * Represents a leveler permanent on the battlefield.
 */
export interface LevelerPermanent {
  readonly id: string;
  readonly card: LevelerCard;
  readonly levelCounters: number;
  readonly controller: string;
}

/**
 * Creates a level range from min-max values (Rule 711.2a).
 */
export function createLevelRange(min: number, max: number): LevelRange {
  return { type: 'range', min, max };
}

/**
 * Creates a level range for N+ (Rule 711.2b).
 */
export function createLevelPlus(min: number): LevelRange {
  return { type: 'plus', min };
}

/**
 * Checks if a number of level counters is in a level range.
 */
export function isInLevelRange(counters: number, range: LevelRange): boolean {
  if (range.type === 'range') {
    return counters >= range.min && counters <= range.max;
  } else {
    return counters >= range.min;
  }
}

/**
 * Gets the active level ability for a leveler permanent (Rule 711.2).
 * 
 * Returns the level ability that applies based on current level counters,
 * or null if none apply.
 */
export function getActiveLevelAbility(
  permanent: LevelerPermanent
): LevelAbility | null {
  // Check level abilities in order (typically higher levels checked first)
  for (const levelAbility of permanent.card.levelAbilities) {
    if (isInLevelRange(permanent.levelCounters, levelAbility.levelRange)) {
      return levelAbility;
    }
  }
  return null;
}

/**
 * Gets the current power and toughness of a leveler permanent.
 * 
 * Rule 711.2a/b: Level symbols grant base P/T
 * Rule 711.5: If counters < N1, uses uppermost P/T box
 */
export function getLevelerPowerToughness(
  permanent: LevelerPermanent
): { power: number; toughness: number } {
  const activeLevelAbility = getActiveLevelAbility(permanent);
  
  if (activeLevelAbility) {
    return {
      power: activeLevelAbility.power,
      toughness: activeLevelAbility.toughness,
    };
  }
  
  // No level ability active - use base P/T
  return {
    power: permanent.card.basePower,
    toughness: permanent.card.baseToughness,
  };
}

/**
 * Gets all active abilities of a leveler permanent.
 * 
 * Rule 711.4: Abilities not preceded by level symbol are always active.
 * Level abilities are only active when their level range is met.
 */
export function getLevelerAbilities(
  permanent: LevelerPermanent
): readonly string[] {
  const abilities = [...permanent.card.baseAbilities];
  
  const activeLevelAbility = getActiveLevelAbility(permanent);
  if (activeLevelAbility) {
    abilities.push(...activeLevelAbility.abilities);
  }
  
  return abilities;
}

/**
 * Gets leveler characteristics in non-battlefield zones (Rule 711.6).
 * 
 * In zones other than battlefield, uses uppermost (base) P/T box.
 */
export function getLevelerCharacteristicsInZone(
  card: LevelerCard
): { power: number; toughness: number } {
  return {
    power: card.basePower,
    toughness: card.baseToughness,
  };
}

/**
 * Adds level counters to a leveler permanent.
 * 
 * Typically done via level up ability (Rule 702.87).
 */
export function addLevelCounters(
  permanent: LevelerPermanent,
  amount: number
): LevelerPermanent {
  return {
    ...permanent,
    levelCounters: permanent.levelCounters + amount,
  };
}

/**
 * Creates a leveler permanent entering the battlefield.
 */
export function createLevelerPermanent(
  id: string,
  card: LevelerCard,
  controller: string
): LevelerPermanent {
  return {
    id,
    card,
    levelCounters: 0,
    controller,
  };
}

/**
 * Checks if leveler has level up ability available (Rule 711.4).
 * 
 * Level up ability is always available regardless of level counters.
 */
export function canActivateLevelUp(permanent: LevelerPermanent): boolean {
  // Level up is always available (if the card has it)
  // Actual restrictions (sorcery speed, etc.) checked elsewhere
  return true;
}

/**
 * Note about Class cards (Rule 711.7).
 * 
 * Some enchantments have Class subtype with class levels.
 * These are NOT level up abilities and don't use level counters.
 * See Rule 716 for Class cards.
 */
export function isClassCard(types: readonly string[], subtypes: readonly string[]): boolean {
  return types.includes('Enchantment') && subtypes.includes('Class');
}
