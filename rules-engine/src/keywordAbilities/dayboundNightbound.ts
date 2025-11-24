/**
 * Daybound and Nightbound keyword abilities (Rule 702.145)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.145. Daybound and Nightbound
 * 702.145a Daybound and nightbound are found on opposite faces of some double-faced cards.
 * 702.145b Daybound is found on the front faces of some double-faced cards and represents three 
 * static abilities. "Daybound" means "If it is night and this permanent is represented by a 
 * double-faced card, it enters transformed," "As it becomes night, if this permanent is front 
 * face up, transform it," and "This permanent can't transform except due to its daybound ability."
 * 702.145c Any time a player controls a permanent that is front face up with daybound and it's 
 * night, that player transforms that permanent. This happens immediately and isn't a state-based 
 * action.
 * 702.145d Any time a player controls a permanent with daybound, if it's neither day nor night, 
 * it becomes day.
 * 702.145e Nightbound is found on the back faces of some double-faced cards and represents two 
 * static abilities. "Nightbound" means "As it becomes day, if this permanent is back face up, 
 * transform it" and "This permanent can't transform except due to its nightbound ability."
 */

export interface DayboundAbility {
  readonly type: 'daybound';
  readonly source: string;
  readonly isFrontFace: boolean;
}

export interface NightboundAbility {
  readonly type: 'nightbound';
  readonly source: string;
  readonly isBackFace: boolean;
}

/**
 * Create a daybound ability
 * Rule 702.145b - Front face of double-faced card
 * @param source - The permanent with daybound
 * @returns Daybound ability object
 */
export function daybound(source: string): DayboundAbility {
  return {
    type: 'daybound',
    source,
    isFrontFace: true,
  };
}

/**
 * Create a nightbound ability
 * Rule 702.145e - Back face of double-faced card
 * @param source - The permanent with nightbound
 * @returns Nightbound ability object
 */
export function nightbound(source: string): NightboundAbility {
  return {
    type: 'nightbound',
    source,
    isBackFace: true,
  };
}

/**
 * Check if daybound permanent should transform to night
 * Rule 702.145c - Transforms when it becomes night
 * @param isNight - Whether it's currently night
 * @param isFrontFace - Whether permanent is front face up
 * @returns True if should transform
 */
export function shouldTransformToNight(isNight: boolean, isFrontFace: boolean): boolean {
  return isNight && isFrontFace;
}

/**
 * Check if nightbound permanent should transform to day
 * Rule 702.145e - Transforms when it becomes day
 * @param isDay - Whether it's currently day
 * @param isBackFace - Whether permanent is back face up
 * @returns True if should transform
 */
export function shouldTransformToDay(isDay: boolean, isBackFace: boolean): boolean {
  return isDay && isBackFace;
}

/**
 * Check if should enter transformed
 * Rule 702.145b - Enters transformed if it's night
 * @param isNight - Whether it's night when entering
 * @returns True if enters transformed
 */
export function entersTransformed(isNight: boolean): boolean {
  return isNight;
}

/**
 * Check if it becomes day when daybound enters
 * Rule 702.145d - If neither day nor night, it becomes day
 * @param isDayOrNight - Whether it's currently day or night
 * @returns True if becomes day
 */
export function becomesDay(isDayOrNight: boolean): boolean {
  return !isDayOrNight;
}

/**
 * Multiple instances of daybound are redundant
 * @param abilities - Array of daybound abilities
 * @returns True if more than one
 */
export function hasRedundantDaybound(abilities: readonly DayboundAbility[]): boolean {
  return abilities.length > 1;
}

/**
 * Multiple instances of nightbound are redundant
 * @param abilities - Array of nightbound abilities
 * @returns True if more than one
 */
export function hasRedundantNightbound(abilities: readonly NightboundAbility[]): boolean {
  return abilities.length > 1;
}
