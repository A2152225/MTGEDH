/**
 * Training keyword ability (Rule 702.149)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.149. Training
 * 702.149a Training is a triggered ability. "Training" means "Whenever this creature and at 
 * least one other creature with power greater than this creature's power attack, put a +1/+1 
 * counter on this creature."
 * 702.149b If a creature has multiple instances of training, each triggers separately.
 * 702.149c Some creatures with training have abilities that trigger when they train. "When this 
 * creature trains" means "When a resolving training ability puts one or more +1/+1 counters on 
 * this creature."
 */

export interface TrainingAbility {
  readonly type: 'training';
  readonly source: string;
  readonly creaturePower: number;
  readonly timesTriggered: number;
}

/**
 * Create a training ability
 * Rule 702.149a
 * @param source - The creature with training
 * @param creaturePower - Power of the creature
 * @returns Training ability object
 */
export function training(source: string, creaturePower: number): TrainingAbility {
  return {
    type: 'training',
    source,
    creaturePower,
    timesTriggered: 0,
  };
}

/**
 * Check if training should trigger
 * Rule 702.149a - Requires attacking with larger creature
 * @param creaturePower - Power of creature with training
 * @param attackingCreaturesPowers - Powers of other attacking creatures
 * @returns True if should trigger
 */
export function shouldTriggerTraining(
  creaturePower: number,
  attackingCreaturesPowers: readonly number[]
): boolean {
  return attackingCreaturesPowers.some(power => power > creaturePower);
}

/**
 * Trigger training
 * Rule 702.149a - Put +1/+1 counter on creature
 * @param ability - Training ability
 * @param newPower - New power after counter (original + 1)
 * @returns Updated ability
 */
export function triggerTraining(ability: TrainingAbility, newPower: number): TrainingAbility {
  return {
    ...ability,
    creaturePower: newPower,
    timesTriggered: ability.timesTriggered + 1,
  };
}

/**
 * Get times trained
 * Rule 702.149c - "When this creature trains"
 * @param ability - Training ability
 * @returns Number of times trained
 */
export function getTimesTrained(ability: TrainingAbility): number {
  return ability.timesTriggered;
}

/**
 * Multiple instances of training trigger separately
 * Rule 702.149b
 * @param abilities - Array of training abilities
 * @returns False - each triggers separately
 */
export function hasRedundantTraining(abilities: readonly TrainingAbility[]): boolean {
  return false; // Each instance triggers separately
}
