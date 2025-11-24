/**
 * Provoke keyword ability implementation (Rule 702.39)
 * 
 * @see MagicCompRules 702.39
 */

/**
 * Provoke ability interface
 * Rule 702.39a: "Provoke" means "Whenever this creature attacks, you may choose to have target creature
 * defending player controls block this creature this combat if able. If you do, untap that creature."
 */
export interface ProvokeAbility {
  readonly type: 'provoke';
  readonly source: string;
  readonly targetCreature?: string;
  readonly wasTriggered: boolean;
}

/**
 * Creates a Provoke ability
 * 
 * @param source - The source creature ID
 * @returns ProvokeAbility object
 */
export function provoke(source: string): ProvokeAbility {
  return {
    type: 'provoke',
    source,
    wasTriggered: false,
  };
}

/**
 * Triggers provoke ability when attacking
 * 
 * @param ability - The provoke ability
 * @param targetCreature - The creature to provoke (optional)
 * @returns Updated ProvokeAbility
 */
export function triggerProvoke(
  ability: ProvokeAbility,
  targetCreature?: string
): ProvokeAbility {
  return {
    ...ability,
    targetCreature,
    wasTriggered: true,
  };
}

/**
 * Checks if a creature must block due to provoke
 * 
 * @param ability - The provoke ability
 * @param creatureId - The creature to check
 * @returns True if this creature must block if able
 */
export function mustBlockIfAble(ability: ProvokeAbility, creatureId: string): boolean {
  return ability.targetCreature === creatureId && ability.wasTriggered;
}

/**
 * Checks if provoke abilities are redundant
 * Rule 702.39b: If a creature has multiple instances of provoke, each triggers separately
 * 
 * @returns False - provoke instances are never redundant
 */
export function isProvokeRedundant(): boolean {
  return false; // Rule 702.39b: Each instance triggers separately
}
