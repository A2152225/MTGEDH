/**
 * Rule 603: Handling Triggered Abilities
 * 
 * Triggered abilities watch for events and trigger when those events occur.
 * They use "when," "whenever," or "at."
 * 
 * Based on MagicCompRules 20251114.txt
 */

import type { StackObject } from './spellCasting';

/**
 * Rule 603.1: Triggered ability keywords
 */
export enum TriggerKeyword {
  WHEN = 'when',       // One-time events
  WHENEVER = 'whenever', // Each time event happens
  AT = 'at',          // Beginning/end of phase/step
}

/**
 * Common trigger events
 */
export enum TriggerEvent {
  // Zone changes
  ENTERS_BATTLEFIELD = 'enters_battlefield',
  LEAVES_BATTLEFIELD = 'leaves_battlefield',
  DIES = 'dies',
  DRAWN = 'drawn',
  DISCARDED = 'discarded',
  EXILED = 'exiled',
  
  // Combat
  ATTACKS = 'attacks',
  BLOCKS = 'blocks',
  DEALS_DAMAGE = 'deals_damage',
  DEALT_DAMAGE = 'dealt_damage',
  
  // Turn structure
  BEGINNING_OF_UPKEEP = 'beginning_of_upkeep',
  BEGINNING_OF_COMBAT = 'beginning_of_combat',
  END_OF_TURN = 'end_of_turn',
  BEGINNING_OF_END_STEP = 'beginning_of_end_step',
  
  // Spells and abilities
  SPELL_CAST = 'spell_cast',
  ABILITY_ACTIVATED = 'ability_activated',
  
  // State changes
  BECOMES_TAPPED = 'becomes_tapped',
  BECOMES_UNTAPPED = 'becomes_untapped',
  COUNTER_PLACED = 'counter_placed',
  COUNTER_REMOVED = 'counter_removed',
}

/**
 * Triggered ability definition
 */
export interface TriggeredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly keyword: TriggerKeyword;
  readonly event: TriggerEvent;
  readonly condition?: string;
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly optional?: boolean; // "may" trigger
}

/**
 * Trigger instance waiting to be put on stack
 */
export interface TriggerInstance {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly timestamp: number;
  readonly hasTriggered: boolean;
  readonly onStack: boolean;
}

/**
 * Trigger queue for managing pending triggers
 */
export interface TriggerQueue {
  readonly triggers: readonly TriggerInstance[];
}

/**
 * Create empty trigger queue
 */
export function createEmptyTriggerQueue(): TriggerQueue {
  return { triggers: [] };
}

/**
 * Rule 603.2: When a triggered ability triggers
 */
export function createTriggerInstance(
  ability: TriggeredAbility,
  timestamp: number
): TriggerInstance {
  return {
    id: `trigger-${timestamp}-${ability.id}`,
    abilityId: ability.id,
    sourceId: ability.sourceId,
    sourceName: ability.sourceName,
    controllerId: ability.controllerId,
    effect: ability.effect,
    targets: ability.targets,
    timestamp,
    hasTriggered: true,
    onStack: false,
  };
}

/**
 * Add trigger to queue
 */
export function queueTrigger(
  queue: Readonly<TriggerQueue>,
  trigger: TriggerInstance
): TriggerQueue {
  return {
    triggers: [...queue.triggers, trigger],
  };
}

/**
 * Rule 603.3: Triggered abilities go on stack next time player gets priority
 * Rule 603.3b: APNAP (Active Player, Non-Active Player) order
 */
export function putTriggersOnStack(
  queue: Readonly<TriggerQueue>,
  activePlayerId: string
): {
  queue: TriggerQueue;
  stackObjects: StackObject[];
  log: string[];
} {
  if (queue.triggers.length === 0) {
    return {
      queue,
      stackObjects: [],
      log: [],
    };
  }
  
  const logs: string[] = [];
  
  // Sort triggers by APNAP order
  const sorted = [...queue.triggers].sort((a, b) => {
    // Active player's triggers first
    if (a.controllerId === activePlayerId && b.controllerId !== activePlayerId) {
      return -1;
    }
    if (a.controllerId !== activePlayerId && b.controllerId === activePlayerId) {
      return 1;
    }
    // Then by timestamp (order they triggered)
    return a.timestamp - b.timestamp;
  });
  
  // Convert to stack objects
  const stackObjects: StackObject[] = sorted.map(trigger => {
    logs.push(`${trigger.sourceName} triggered ability goes on stack`);
    
    return {
      id: trigger.id,
      spellId: trigger.abilityId,
      cardName: `${trigger.sourceName} trigger`,
      controllerId: trigger.controllerId,
      targets: trigger.targets || [],
      timestamp: trigger.timestamp,
      type: 'ability',
    };
  });
  
  // Clear the queue
  return {
    queue: createEmptyTriggerQueue(),
    stackObjects,
    log: logs,
  };
}

/**
 * Check if an event would trigger an ability
 */
export function checkTrigger(
  ability: TriggeredAbility,
  event: TriggerEvent,
  eventData?: any
): boolean {
  if (ability.event !== event) {
    return false;
  }
  
  // TODO: Check conditions if present
  // For now, simple event matching
  
  return true;
}

/**
 * Find all abilities that trigger from an event
 */
export function findTriggeringAbilities(
  abilities: readonly TriggeredAbility[],
  event: TriggerEvent,
  eventData?: any
): TriggeredAbility[] {
  return abilities.filter(ability => checkTrigger(ability, event, eventData));
}

/**
 * Process an event and create trigger instances
 */
export function processEvent(
  event: TriggerEvent,
  abilities: readonly TriggeredAbility[],
  eventData?: any
): TriggerInstance[] {
  const triggeredAbilities = findTriggeringAbilities(abilities, event, eventData);
  const timestamp = Date.now();
  
  return triggeredAbilities.map(ability =>
    createTriggerInstance(ability, timestamp)
  );
}

/**
 * Common triggered ability templates
 */

/**
 * Enter the battlefield trigger
 */
export function createETBTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string,
  targets?: string[]
): TriggeredAbility {
  return {
    id: `${sourceId}-etb`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHEN,
    event: TriggerEvent.ENTERS_BATTLEFIELD,
    effect,
    targets,
  };
}

/**
 * Dies trigger
 */
export function createDiesTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-dies`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHEN,
    event: TriggerEvent.DIES,
    effect,
  };
}

/**
 * Beginning of upkeep trigger
 */
export function createUpkeepTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-upkeep`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.AT,
    event: TriggerEvent.BEGINNING_OF_UPKEEP,
    effect,
  };
}

/**
 * Attacks trigger
 */
export function createAttacksTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  effect: string
): TriggeredAbility {
  return {
    id: `${sourceId}-attacks`,
    sourceId,
    sourceName,
    controllerId,
    keyword: TriggerKeyword.WHENEVER,
    event: TriggerEvent.ATTACKS,
    effect,
  };
}
