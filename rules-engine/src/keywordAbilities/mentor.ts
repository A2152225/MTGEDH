/**
 * Mentor keyword ability (Rule 702.134)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.134. Mentor
 * 702.134a Mentor is a triggered ability. "Mentor" means "Whenever this creature attacks, put 
 * a +1/+1 counter on target attacking creature with power less than this creature's power."
 * 702.134b If a creature has multiple instances of mentor, each triggers separately.
 * 702.134c An ability that triggers whenever a creature mentors another creature triggers 
 * whenever a mentor ability whose source is the first creature and whose target is the second 
 * creature resolves.
 */

export interface MentorAbility {
  readonly type: 'mentor';
  readonly source: string;
  readonly mentorPower: number;
  readonly mentoredCreatures: readonly string[];
}

/**
 * Create a mentor ability
 * Rule 702.134a
 * @param source - The creature with mentor
 * @param mentorPower - Power of the mentor creature
 * @returns Mentor ability object
 */
export function mentor(source: string, mentorPower: number): MentorAbility {
  return {
    type: 'mentor',
    source,
    mentorPower,
    mentoredCreatures: [],
  };
}

/**
 * Check if a creature can be mentored
 * Rule 702.134a - Target must have power less than mentor's power
 * @param mentorPower - Power of mentor creature
 * @param targetPower - Power of potential target
 * @returns True if can be mentored
 */
export function canMentor(mentorPower: number, targetPower: number): boolean {
  return targetPower < mentorPower;
}

/**
 * Trigger mentor ability
 * Rule 702.134a - Put counter on attacking creature with less power
 * @param ability - Mentor ability
 * @param mentoredCreature - ID of mentored creature
 * @returns Updated ability
 */
export function triggerMentor(ability: MentorAbility, mentoredCreature: string): MentorAbility {
  return {
    ...ability,
    mentoredCreatures: [...ability.mentoredCreatures, mentoredCreature],
  };
}

/**
 * Get creatures that were mentored
 * @param ability - Mentor ability
 * @returns IDs of mentored creatures
 */
export function getMentoredCreatures(ability: MentorAbility): readonly string[] {
  return ability.mentoredCreatures;
}

/**
 * Multiple instances of mentor trigger separately
 * Rule 702.134b
 * @param abilities - Array of mentor abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantMentor(abilities: readonly MentorAbility[]): boolean {
  return false; // Each instance triggers separately
}
