/**
 * actions/triggersHandler.ts
 * 
 * Handles triggered abilities (Rule 603).
 * Processes events and queues triggers for the stack.
 */

import type { GameState } from '../../../shared/src';
import {
  TriggerEvent,
  processEvent,
  putTriggersOnStack,
  createEmptyTriggerQueue,
  type TriggeredAbility,
} from '../triggeredAbilities';

export interface TriggerResult {
  state: GameState;
  triggersAdded: number;
  logs: string[];
}

/**
 * Process triggered abilities for an event
 */
export function processTriggers(
  state: GameState,
  event: TriggerEvent,
  registeredAbilities: TriggeredAbility[]
): TriggerResult {
  const logs: string[] = [];
  const triggerInstances = processEvent(event, registeredAbilities);
  
  if (triggerInstances.length === 0) {
    return { state, triggersAdded: 0, logs };
  }
  
  // Queue triggers
  let queue = createEmptyTriggerQueue();
  for (const trigger of triggerInstances) {
    queue = { triggers: [...queue.triggers, trigger] };
  }
  
  // Put on stack in APNAP order
  const activePlayerId = state.players[state.activePlayerIndex || 0]?.id || '';
  const { stackObjects, log } = putTriggersOnStack(queue, activePlayerId);
  
  logs.push(...log);
  
  // Add to game stack
  const updatedStack = [...(state.stack || []), ...stackObjects];
  
  return {
    state: { ...state, stack: updatedStack as any },
    triggersAdded: stackObjects.length,
    logs,
  };
}

/**
 * Find all triggered abilities on permanents
 * 
 * Note: This is a simplified detection that looks for trigger keywords.
 * A full implementation would require parsing oracle text properly.
 * This may produce false positives for text containing trigger keywords
 * in non-ability contexts (e.g., reminder text, flavor references).
 */
export function findTriggeredAbilities(state: GameState): TriggeredAbility[] {
  const abilities: TriggeredAbility[] = [];
  
  // Scan all permanents for triggered abilities
  for (const player of state.players) {
    for (const perm of player.battlefield || []) {
      const oracleText = perm.card?.oracle_text || '';
      
      // Look for trigger patterns at the start of sentences or after periods
      // This reduces false positives from casual mentions in text
      const triggerPattern = /(?:^|\.\s*)(when|whenever|at the beginning)/i;
      
      if (triggerPattern.test(oracleText)) {
        // This is a simplified detection - real implementation would parse oracle text
        abilities.push({
          id: `${perm.id}-trigger`,
          sourceId: perm.id,
          sourceName: perm.card?.name || 'Unknown',
          controllerId: player.id,
          keyword: 'when' as any,
          event: TriggerEvent.ENTERS_BATTLEFIELD, // Placeholder - would need proper parsing
          effect: oracleText,
        });
      }
    }
  }
  
  return abilities;
}

/**
 * Check for enter the battlefield triggers
 */
export function checkETBTriggers(
  state: GameState,
  permanentId: string,
  controllerId: string
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const etbAbilities = abilities.filter(a => 
    a.sourceId === permanentId && 
    a.event === TriggerEvent.ENTERS_BATTLEFIELD
  );
  
  if (etbAbilities.length === 0) {
    return { state, triggersAdded: 0, logs: [] };
  }
  
  return processTriggers(state, TriggerEvent.ENTERS_BATTLEFIELD, etbAbilities);
}

/**
 * Check for dies triggers
 */
export function checkDiesTriggers(
  state: GameState,
  permanentId: string
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const diesAbilities = abilities.filter(a => 
    a.event === TriggerEvent.DIES
  );
  
  return processTriggers(state, TriggerEvent.DIES, diesAbilities);
}

/**
 * Check for beginning of step triggers
 */
export function checkStepTriggers(
  state: GameState,
  event: TriggerEvent
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const stepAbilities = abilities.filter(a => a.event === event);
  
  return processTriggers(state, event, stepAbilities);
}
