/**
 * Modular keyword ability implementation (Rule 702.43)
 * 
 * @see MagicCompRules 702.43
 */

/**
 * Modular ability interface
 * Rule 702.43a: "Modular N" means "This permanent enters with N +1/+1 counters on it" and
 * "When this permanent is put into a graveyard from the battlefield, you may put a +1/+1 counter
 * on target artifact creature for each +1/+1 counter on this permanent."
 */
export interface ModularAbility {
  readonly type: 'modular';
  readonly value: number;
  readonly source: string;
  readonly countersOnEntry: number;
  readonly triggeredOnDeath: boolean;
  readonly targetCreature?: string;
}

/**
 * Creates a Modular ability
 * 
 * @param source - The source permanent ID
 * @param value - The modular value (N in "Modular N")
 * @returns ModularAbility object
 */
export function modular(source: string, value: number): ModularAbility {
  return {
    type: 'modular',
    value,
    source,
    countersOnEntry: value,
    triggeredOnDeath: false,
  };
}

/**
 * Triggers modular ability when permanent dies
 * 
 * @param ability - The modular ability
 * @param countersOnPermanent - Number of +1/+1 counters on the permanent when it died
 * @param targetCreature - The target artifact creature (optional)
 * @returns Updated ModularAbility
 */
export function triggerModular(
  ability: ModularAbility,
  countersOnPermanent: number,
  targetCreature?: string
): ModularAbility {
  return {
    ...ability,
    countersOnEntry: countersOnPermanent,
    triggeredOnDeath: true,
    targetCreature,
  };
}

/**
 * Gets the number of counters to transfer
 * 
 * @param ability - The modular ability
 * @returns Number of counters to transfer
 */
export function getModularCounters(ability: ModularAbility): number {
  return ability.triggeredOnDeath ? ability.countersOnEntry : ability.value;
}

/**
 * Checks if modular abilities are redundant
 * Rule 702.43b: If a creature has multiple instances of modular, each one works separately
 * 
 * @returns False - modular instances are never redundant
 */
export function isModularRedundant(): boolean {
  return false; // Rule 702.43b: Each instance works separately
}
