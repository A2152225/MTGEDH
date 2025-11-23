/**
 * Rule 113: Abilities
 * Comprehensive type definitions for activated, triggered, and static abilities
 */

import { ObjectID, ControllerID } from './objects';
import { Zone } from './objects';

/**
 * Rule 113.1 - An ability can be one of three things:
 * a) A characteristic of an object that affects the game
 * b) Something a player has that changes how the game affects them
 * c) An activated or triggered ability on the stack (an object)
 */

/**
 * Rule 113.3 - Four general categories of abilities
 */
export enum AbilityCategory {
  SPELL = 'spell',         // 113.3a - Text on instant/sorcery while resolving
  ACTIVATED = 'activated', // 113.3b - Has cost and effect "[Cost]: [Effect]"
  TRIGGERED = 'triggered', // 113.3c - Has trigger condition "when/whenever/at"
  STATIC = 'static'        // 113.3d - Written as statements, always true
}

/**
 * Rule 113.3b - Activated abilities have a cost and an effect
 * Written as "[Cost]: [Effect.] [Activation instructions (if any).]"
 */
export interface ActivatedAbility {
  readonly category: AbilityCategory.ACTIVATED;
  readonly id: string;
  readonly sourceId: ObjectID;
  readonly cost: string; // Cost text (parsed separately)
  readonly effect: string; // Effect text
  readonly activationRestrictions?: ActivationRestriction[];
  readonly isManaAbility?: boolean; // Rule 113.4 - Mana abilities are special
  readonly isLoyaltyAbility?: boolean; // Rule 113.5 - Loyalty abilities are special
}

/**
 * Activation restrictions for activated abilities
 */
export interface ActivationRestriction {
  readonly type: 'timing' | 'frequency' | 'condition';
  readonly description: string;
  // Common restrictions:
  // - "Activate only as a sorcery" (timing)
  // - "Activate only once per turn" (frequency)
  // - "Activate only if..." (condition)
}

/**
 * Rule 113.3c - Triggered abilities have a trigger condition and an effect
 * Written as "[Trigger condition], [effect]"
 * Include (and usually begin with) "when," "whenever," or "at"
 */
export interface TriggeredAbility {
  readonly category: AbilityCategory.TRIGGERED;
  readonly id: string;
  readonly sourceId: ObjectID;
  readonly trigger: TriggerCondition;
  readonly effect: string; // Effect text
  readonly isDelayed?: boolean; // Rule 603.7 - Delayed triggered abilities
}

/**
 * Trigger conditions for triggered abilities
 */
export interface TriggerCondition {
  readonly keyword: 'when' | 'whenever' | 'at';
  readonly event: TriggerEvent;
  readonly condition?: string; // Optional condition ("if you control...")
}

/**
 * Types of events that can trigger abilities
 */
export enum TriggerEvent {
  // Zone change triggers
  ENTERS_BATTLEFIELD = 'enters_battlefield',
  LEAVES_BATTLEFIELD = 'leaves_battlefield',
  DIES = 'dies',
  DRAWN = 'drawn',
  DISCARDED = 'discarded',
  EXILED = 'exiled',
  
  // Combat triggers
  ATTACKS = 'attacks',
  BLOCKS = 'blocks',
  DEALS_DAMAGE = 'deals_damage',
  DEALT_DAMAGE = 'dealt_damage',
  
  // Turn structure triggers
  BEGINNING_OF_UPKEEP = 'beginning_of_upkeep',
  END_OF_TURN = 'end_of_turn',
  BEGINNING_OF_COMBAT = 'beginning_of_combat',
  
  // Other events
  CAST = 'cast',
  BECOMES_TAPPED = 'becomes_tapped',
  BECOMES_UNTAPPED = 'becomes_untapped',
  COUNTER_PLACED = 'counter_placed',
  COUNTER_REMOVED = 'counter_removed',
  
  // Custom (for extensibility)
  CUSTOM = 'custom'
}

/**
 * Rule 113.3d - Static abilities create continuous effects
 * Simply true while the object is in the appropriate zone
 */
export interface StaticAbility {
  readonly category: AbilityCategory.STATIC;
  readonly id: string;
  readonly sourceId: ObjectID;
  readonly effect: string; // Effect text
  readonly effectType: StaticEffectType;
  readonly isCharacteristicDefining?: boolean; // Rule 113.6a - Functions everywhere
}

/**
 * Types of static effects
 */
export enum StaticEffectType {
  CONTINUOUS = 'continuous',           // Rule 611 - Continuous effects
  REPLACEMENT = 'replacement',         // Rule 614 - Replacement effects
  PREVENTION = 'prevention',           // Rule 615 - Prevention effects
  CHARACTERISTIC_DEFINING = 'characteristic_defining' // Rule 604.3
}

/**
 * Rule 113.6 - Where abilities function
 */
export interface AbilityZoneRestriction {
  readonly zones?: Zone[]; // If specified, only functions in these zones
  readonly exceptZones?: Zone[]; // If specified, functions everywhere except these
}

/**
 * Rule 113.7 - The source of an ability
 */
export interface AbilitySource {
  readonly objectId: ObjectID;
  readonly controllerId?: ControllerID; // For abilities on the stack
  readonly lastKnownZone?: Zone; // For using last known information
}

/**
 * Rule 109.1 - An ability on the stack is an object
 */
export interface AbilityOnStack {
  readonly id: string;
  readonly ability: ActivatedAbility | TriggeredAbility;
  readonly controller: ControllerID;
  readonly source: AbilitySource;
  readonly targets?: ObjectID[];
  readonly timestamp: number;
}

/**
 * Rule 113.4 - Mana abilities (special rules)
 * Don't use the stack, can activate without priority in certain cases
 */
export interface ManaAbility extends Omit<ActivatedAbility, 'isManaAbility'> {
  readonly isManaAbility: true;
  readonly producedManaTypes: string[]; // Types of mana produced
}

/**
 * Rule 113.5 - Loyalty abilities (special rules)
 * Can only be activated during main phase, stack empty, once per turn
 */
export interface LoyaltyAbility extends Omit<ActivatedAbility, 'isLoyaltyAbility'> {
  readonly isLoyaltyAbility: true;
  readonly loyaltyCost: number; // Can be negative (minus abilities)
}

/**
 * Union type for all ability types
 */
export type Ability = ActivatedAbility | TriggeredAbility | StaticAbility;

/**
 * Helper to check if an ability is on the stack
 */
export function isStackableAbility(ability: Ability): ability is ActivatedAbility | TriggeredAbility {
  return ability.category === AbilityCategory.ACTIVATED || ability.category === AbilityCategory.TRIGGERED;
}

/**
 * Helper to check if an ability is a mana ability
 */
export function isManaAbility(ability: Ability): ability is ManaAbility {
  return ability.category === AbilityCategory.ACTIVATED && 
         (ability as ActivatedAbility).isManaAbility === true;
}

/**
 * Helper to check if an ability is a loyalty ability
 */
export function isLoyaltyAbility(ability: Ability): ability is LoyaltyAbility {
  return ability.category === AbilityCategory.ACTIVATED && 
         (ability as ActivatedAbility).isLoyaltyAbility === true;
}
