/**
 * delayedTriggeredAbilities.ts
 * 
 * Handles delayed triggered abilities that don't fire immediately but are set up
 * to trigger at a later point in the game.
 * 
 * Common delayed trigger patterns:
 * - "At the beginning of the next end step, [effect]"
 * - "At the beginning of the next upkeep, [effect]"  
 * - "At the beginning of your next upkeep, [effect]"
 * - "At end of combat, [effect]"
 * - "When [condition], [effect]"
 * - "Until end of turn" (one-shot replacement effects)
 * 
 * Rules Reference:
 * - Rule 603.7: Delayed triggered abilities
 * - Rule 603.7a: A delayed triggered ability is created by a spell/ability
 * - Rule 603.7b: Delayed triggered abilities have a trigger condition
 * - Rule 603.7c: Duration of delayed triggers
 */

import type { PlayerID } from '../../shared/src';
import { TriggerEvent, type TriggerInstance, createTriggerInstance, type TriggeredAbility } from './triggeredAbilities';

/**
 * When the delayed trigger should fire
 */
export enum DelayedTriggerTiming {
  /** Beginning of the next end step */
  NEXT_END_STEP = 'next_end_step',
  /** Beginning of the controller's next end step */
  YOUR_NEXT_END_STEP = 'your_next_end_step',
  /** Beginning of each end step (repeating) */
  EACH_END_STEP = 'each_end_step',
  /** Beginning of the next upkeep */
  NEXT_UPKEEP = 'next_upkeep',
  /** Beginning of your next upkeep */
  YOUR_NEXT_UPKEEP = 'your_next_upkeep',
  /** End of combat */
  END_OF_COMBAT = 'end_of_combat',
  /** Beginning of next combat */
  NEXT_COMBAT = 'next_combat',
  /** Next time a specific event occurs */
  NEXT_EVENT = 'next_event',
  /** At the beginning of the next turn */
  NEXT_TURN = 'next_turn',
  /** At the beginning of your next turn */
  YOUR_NEXT_TURN = 'your_next_turn',
  /** When a specific permanent leaves the battlefield */
  WHEN_LEAVES = 'when_leaves',
  /** Until end of turn (expires at cleanup) */
  UNTIL_END_OF_TURN = 'until_end_of_turn',
  /** Until next turn */
  UNTIL_NEXT_TURN = 'until_next_turn',
}

/**
 * Delayed triggered ability definition
 */
export interface DelayedTriggeredAbility {
  readonly id: string;
  /** The source that created this delayed trigger */
  readonly sourceId: string;
  readonly sourceName: string;
  /** Controller of the delayed trigger */
  readonly controllerId: PlayerID;
  /** When this trigger should fire */
  readonly timing: DelayedTriggerTiming;
  /** For event-based triggers, the specific event to wait for */
  readonly waitingForEvent?: TriggerEvent;
  /** For "when leaves" triggers, the permanent to watch */
  readonly watchingPermanentId?: string;
  /** The effect to execute when triggered */
  readonly effect: string;
  /** Targets selected when the delayed trigger was created */
  readonly targets?: readonly string[];
  /** The turn it was created */
  readonly createdOnTurn: number;
  /** Has this trigger fired? */
  readonly fired: boolean;
  /** Is this a one-shot trigger? (most are) */
  readonly oneShot: boolean;
  /** Timestamp for ordering */
  readonly timestamp: number;
  /** Additional data for the effect */
  readonly effectData?: Record<string, unknown>;
}

/**
 * Delayed trigger registry state
 */
export interface DelayedTriggerRegistry {
  readonly triggers: readonly DelayedTriggeredAbility[];
  readonly firedTriggerIds: readonly string[];
}

/**
 * Create an empty delayed trigger registry
 */
export function createDelayedTriggerRegistry(): DelayedTriggerRegistry {
  return {
    triggers: [],
    firedTriggerIds: [],
  };
}

/**
 * Create a delayed triggered ability
 */
export function createDelayedTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  timing: DelayedTriggerTiming,
  effect: string,
  currentTurn: number,
  options: {
    waitingForEvent?: TriggerEvent;
    watchingPermanentId?: string;
    targets?: string[];
    oneShot?: boolean;
    effectData?: Record<string, unknown>;
  } = {}
): DelayedTriggeredAbility {
  return {
    id: `delayed-${sourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourceId,
    sourceName,
    controllerId,
    timing,
    waitingForEvent: options.waitingForEvent,
    watchingPermanentId: options.watchingPermanentId,
    effect,
    targets: options.targets,
    createdOnTurn: currentTurn,
    fired: false,
    oneShot: options.oneShot ?? true,
    timestamp: Date.now(),
    effectData: options.effectData,
  };
}

/**
 * Register a delayed trigger
 */
export function registerDelayedTrigger(
  registry: Readonly<DelayedTriggerRegistry>,
  trigger: DelayedTriggeredAbility
): DelayedTriggerRegistry {
  return {
    ...registry,
    triggers: [...registry.triggers, trigger],
  };
}

/**
 * Check which delayed triggers should fire given the current game state
 */
export function checkDelayedTriggers(
  registry: Readonly<DelayedTriggerRegistry>,
  currentEvent: {
    type: 'end_step' | 'upkeep' | 'combat_end' | 'combat_begin' | 'cleanup' | 'permanent_left' | 'turn_start';
    playerId?: PlayerID;
    activePlayerId?: PlayerID;
    permanentId?: string;
    currentTurn?: number;
  }
): {
  triggersToFire: readonly DelayedTriggeredAbility[];
  remainingTriggers: readonly DelayedTriggeredAbility[];
} {
  const triggersToFire: DelayedTriggeredAbility[] = [];
  const remainingTriggers: DelayedTriggeredAbility[] = [];
  
  for (const trigger of registry.triggers) {
    // Skip already fired one-shot triggers
    if (trigger.fired && trigger.oneShot) {
      continue;
    }
    
    let shouldFire = false;
    
    switch (trigger.timing) {
      case DelayedTriggerTiming.NEXT_END_STEP:
        if (currentEvent.type === 'end_step') {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.YOUR_NEXT_END_STEP:
        if (currentEvent.type === 'end_step' && 
            currentEvent.activePlayerId === trigger.controllerId) {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.EACH_END_STEP:
        if (currentEvent.type === 'end_step') {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.NEXT_UPKEEP:
        if (currentEvent.type === 'upkeep') {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.YOUR_NEXT_UPKEEP:
        if (currentEvent.type === 'upkeep' && 
            currentEvent.activePlayerId === trigger.controllerId) {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.END_OF_COMBAT:
        if (currentEvent.type === 'combat_end') {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.NEXT_COMBAT:
        if (currentEvent.type === 'combat_begin') {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.WHEN_LEAVES:
        if (currentEvent.type === 'permanent_left' && 
            currentEvent.permanentId === trigger.watchingPermanentId) {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.UNTIL_END_OF_TURN:
        if (currentEvent.type === 'cleanup') {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.NEXT_TURN:
        if (currentEvent.type === 'turn_start' && 
            currentEvent.currentTurn !== undefined && 
            currentEvent.currentTurn > trigger.createdOnTurn) {
          shouldFire = true;
        }
        break;
        
      case DelayedTriggerTiming.YOUR_NEXT_TURN:
        if (currentEvent.type === 'turn_start' && 
            currentEvent.activePlayerId === trigger.controllerId &&
            currentEvent.currentTurn !== undefined &&
            currentEvent.currentTurn > trigger.createdOnTurn) {
          shouldFire = true;
        }
        break;
    }
    
    if (shouldFire) {
      triggersToFire.push(trigger);
      if (!trigger.oneShot) {
        // Non-one-shot triggers stay in the registry
        remainingTriggers.push({ ...trigger, fired: true });
      }
    } else {
      remainingTriggers.push(trigger);
    }
  }
  
  return { triggersToFire, remainingTriggers };
}

/**
 * Process delayed triggers and create trigger instances for the stack
 */
export function processDelayedTriggers(
  triggersToFire: readonly DelayedTriggeredAbility[],
  timestamp: number
): TriggerInstance[] {
  const instances: TriggerInstance[] = [];
  
  for (const delayed of triggersToFire) {
    const ability: TriggeredAbility = {
      id: delayed.id,
      sourceId: delayed.sourceId,
      sourceName: delayed.sourceName,
      controllerId: delayed.controllerId,
      keyword: 'at' as any,
      event: TriggerEvent.BEGINNING_OF_END_STEP, // Placeholder - actual event is in timing
      effect: delayed.effect,
      targets: delayed.targets,
    };
    
    instances.push(createTriggerInstance(ability, timestamp));
  }
  
  return instances;
}

/**
 * Remove expired delayed triggers
 * Called at end of turn to clean up UNTIL_END_OF_TURN triggers
 */
export function expireDelayedTriggers(
  registry: Readonly<DelayedTriggerRegistry>,
  expireTiming: DelayedTriggerTiming
): DelayedTriggerRegistry {
  const remaining = registry.triggers.filter(t => t.timing !== expireTiming);
  return {
    ...registry,
    triggers: remaining,
  };
}

/**
 * Parse delayed trigger creation from oracle text
 */
export function parseDelayedTriggerFromText(
  oracleText: string,
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  currentTurn: number
): DelayedTriggeredAbility | null {
  const text = oracleText.toLowerCase();
  
  // "At the beginning of the next end step"
  if (text.includes('at the beginning of the next end step') || 
      text.includes('at the beginning of your next end step')) {
    const isYours = text.includes('your next end step');
    const effectMatch = text.match(/(?:end step)[,.\s]+([^.]+)/i);
    const effect = effectMatch ? effectMatch[1].trim() : 'delayed effect';
    
    return createDelayedTrigger(
      sourceId,
      sourceName,
      controllerId,
      isYours ? DelayedTriggerTiming.YOUR_NEXT_END_STEP : DelayedTriggerTiming.NEXT_END_STEP,
      effect,
      currentTurn
    );
  }
  
  // "At end of combat"
  if (text.includes('at end of combat') || text.includes('at the end of combat')) {
    const effectMatch = text.match(/(?:of combat)[,.\s]+([^.]+)/i);
    const effect = effectMatch ? effectMatch[1].trim() : 'delayed effect';
    
    return createDelayedTrigger(
      sourceId,
      sourceName,
      controllerId,
      DelayedTriggerTiming.END_OF_COMBAT,
      effect,
      currentTurn
    );
  }
  
  // "At the beginning of the next upkeep"
  if (text.includes('at the beginning of the next upkeep') ||
      text.includes('at the beginning of your next upkeep')) {
    const isYours = text.includes('your next upkeep');
    const effectMatch = text.match(/(?:upkeep)[,.\s]+([^.]+)/i);
    const effect = effectMatch ? effectMatch[1].trim() : 'delayed effect';
    
    return createDelayedTrigger(
      sourceId,
      sourceName,
      controllerId,
      isYours ? DelayedTriggerTiming.YOUR_NEXT_UPKEEP : DelayedTriggerTiming.NEXT_UPKEEP,
      effect,
      currentTurn
    );
  }
  
  // "Until end of turn" (often sets up one-time effects)
  if (text.includes('until end of turn')) {
    return createDelayedTrigger(
      sourceId,
      sourceName,
      controllerId,
      DelayedTriggerTiming.UNTIL_END_OF_TURN,
      'end until-end-of-turn effect',
      currentTurn
    );
  }
  
  return null;
}

/**
 * Common delayed trigger templates
 */

/**
 * Create a "return at end step" delayed trigger (flicker)
 */
export function createFlickerReturnTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  exiledPermanentName: string,
  currentTurn: number,
  targets: string[]
): DelayedTriggeredAbility {
  return createDelayedTrigger(
    sourceId,
    sourceName,
    controllerId,
    DelayedTriggerTiming.NEXT_END_STEP,
    `Return ${exiledPermanentName} to the battlefield`,
    currentTurn,
    { targets }
  );
}

/**
 * Create a "sacrifice at end of turn" delayed trigger
 */
export function createSacrificeAtEndTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  targetPermanentId: string,
  currentTurn: number
): DelayedTriggeredAbility {
  return createDelayedTrigger(
    sourceId,
    sourceName,
    controllerId,
    DelayedTriggerTiming.NEXT_END_STEP,
    `Sacrifice this permanent`,
    currentTurn,
    { targets: [targetPermanentId] }
  );
}

/**
 * Create a "when leaves" delayed trigger (Fiend Hunter style)
 */
export function createWhenLeavesTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  watchingPermanentId: string,
  effect: string,
  currentTurn: number,
  targets?: string[]
): DelayedTriggeredAbility {
  return createDelayedTrigger(
    sourceId,
    sourceName,
    controllerId,
    DelayedTriggerTiming.WHEN_LEAVES,
    effect,
    currentTurn,
    { watchingPermanentId, targets }
  );
}

/**
 * Create an "at the beginning of your next upkeep" delayed trigger
 */
export function createNextUpkeepTrigger(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  effect: string,
  currentTurn: number
): DelayedTriggeredAbility {
  return createDelayedTrigger(
    sourceId,
    sourceName,
    controllerId,
    DelayedTriggerTiming.YOUR_NEXT_UPKEEP,
    effect,
    currentTurn
  );
}

export default {
  createDelayedTriggerRegistry,
  createDelayedTrigger,
  registerDelayedTrigger,
  checkDelayedTriggers,
  processDelayedTriggers,
  expireDelayedTriggers,
  parseDelayedTriggerFromText,
  createFlickerReturnTrigger,
  createSacrificeAtEndTrigger,
  createWhenLeavesTrigger,
  createNextUpkeepTrigger,
};
