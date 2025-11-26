/**
 * cleanupStep.ts
 * 
 * Implements Rule 514: Cleanup Step turn-based actions
 * 
 * Rule 514.1: Hand size check and discard
 * Rule 514.2: Remove damage and end effects (Rule 703.4p)
 * Rule 514.3: Priority during cleanup (normally no, but can happen)
 * Rule 514.3a: Additional cleanup steps if needed
 */

/**
 * Result of cleanup step actions
 */
export interface CleanupResult {
  readonly permanentsWithDamageCleared: readonly string[];
  readonly effectsEnded: readonly string[];
  readonly discardRequired: number;
  readonly needsPriority: boolean;
  readonly logs: readonly string[];
}

/**
 * Permanent with damage tracking
 */
export interface DamageTrackedPermanent {
  readonly id: string;
  readonly name?: string;
  readonly controller: string;
  readonly markedDamage: number;
  readonly damageSourceIds?: readonly string[];
}

/**
 * Temporary effect that ends at end of turn
 */
export interface TemporaryEffect {
  readonly id: string;
  readonly type: 'until_end_of_turn' | 'this_turn' | 'until_cleanup';
  readonly description: string;
  readonly affectedPermanentIds?: readonly string[];
  readonly affectedPlayerIds?: readonly string[];
}

/**
 * Cleanup step state
 */
export interface CleanupStepState {
  readonly handSizeChecked: boolean;
  readonly damageCleared: boolean;
  readonly effectsEnded: boolean;
  readonly pendingStateBasedActions: boolean;
  readonly pendingTriggers: boolean;
  readonly additionalCleanupNeeded: boolean;
}

/**
 * Create initial cleanup step state
 */
export function createCleanupStepState(): CleanupStepState {
  return {
    handSizeChecked: false,
    damageCleared: false,
    effectsEnded: false,
    pendingStateBasedActions: false,
    pendingTriggers: false,
    additionalCleanupNeeded: false,
  };
}

/**
 * Rule 514.1: Check hand size and determine discard requirement
 * The active player's hand must not exceed their maximum hand size (normally 7)
 */
export function checkHandSize(
  handSize: number,
  maxHandSize: number = 7
): { discardRequired: number; logs: string[] } {
  const logs: string[] = [];
  
  // Handle infinite hand size (e.g., from Reliquary Tower)
  if (maxHandSize === Infinity || maxHandSize < 0) {
    return { discardRequired: 0, logs: ['No maximum hand size'] };
  }
  
  const discardRequired = Math.max(0, handSize - maxHandSize);
  
  if (discardRequired > 0) {
    logs.push(`Must discard ${discardRequired} card(s) to reach hand size of ${maxHandSize}`);
  }
  
  return { discardRequired, logs };
}

/**
 * Rule 514.2 / Rule 703.4p: Clear damage from all permanents
 * All damage marked on permanents is removed simultaneously
 */
export function clearDamageFromPermanents(
  permanents: readonly DamageTrackedPermanent[]
): { clearedPermanents: string[]; logs: string[] } {
  const logs: string[] = [];
  const clearedPermanents: string[] = [];
  
  for (const permanent of permanents) {
    if (permanent.markedDamage > 0) {
      clearedPermanents.push(permanent.id);
      const name = permanent.name || permanent.id;
      logs.push(`Cleared ${permanent.markedDamage} damage from ${name}`);
    }
  }
  
  if (clearedPermanents.length > 0) {
    logs.unshift(`Damage cleared from ${clearedPermanents.length} permanent(s) (Rule 514.2)`);
  }
  
  return { clearedPermanents, logs };
}

/**
 * Rule 514.2: End "until end of turn" and "this turn" effects
 * These effects end simultaneously with damage removal
 */
export function endTemporaryEffects(
  effects: readonly TemporaryEffect[]
): { endedEffects: string[]; logs: string[] } {
  const logs: string[] = [];
  const endedEffects: string[] = [];
  
  for (const effect of effects) {
    if (effect.type === 'until_end_of_turn' || effect.type === 'this_turn' || effect.type === 'until_cleanup') {
      endedEffects.push(effect.id);
      logs.push(`Effect ended: ${effect.description}`);
    }
  }
  
  if (endedEffects.length > 0) {
    logs.unshift(`${endedEffects.length} temporary effect(s) ended (Rule 514.2)`);
  }
  
  return { endedEffects, logs };
}

/**
 * Rule 514.3: Determine if cleanup step should grant priority
 * Normally no priority, but if state-based actions occur or triggers would go on stack, priority is granted
 */
export function shouldCleanupGrantPriority(
  hasPendingStateBasedActions: boolean,
  hasPendingTriggers: boolean
): { grantsPriority: boolean; reason?: string } {
  if (hasPendingStateBasedActions) {
    return {
      grantsPriority: true,
      reason: 'State-based actions occurred during cleanup',
    };
  }
  
  if (hasPendingTriggers) {
    return {
      grantsPriority: true,
      reason: 'Triggered abilities waiting to go on stack',
    };
  }
  
  return { grantsPriority: false };
}

/**
 * Rule 514.3a: Determine if additional cleanup step is needed
 * After priority in cleanup, if either player acted, another cleanup step happens
 */
export function needsAdditionalCleanupStep(
  priorityWasGranted: boolean,
  actionsTaken: boolean
): boolean {
  return priorityWasGranted && actionsTaken;
}

/**
 * Execute the full cleanup step
 * Returns the state changes needed
 */
export function executeCleanupStep(
  activePlayerId: string,
  handSize: number,
  maxHandSize: number,
  permanentsWithDamage: readonly DamageTrackedPermanent[],
  temporaryEffects: readonly TemporaryEffect[],
  hasPendingStateBasedActions: boolean = false,
  hasPendingTriggers: boolean = false
): CleanupResult {
  const logs: string[] = [];
  logs.push('Cleanup step begins (Rule 514)');
  
  // Rule 514.1: Check hand size
  const handCheck = checkHandSize(handSize, maxHandSize);
  logs.push(...handCheck.logs);
  
  // Rule 514.2: Clear damage and end effects (simultaneously)
  const damageResult = clearDamageFromPermanents(permanentsWithDamage);
  const effectsResult = endTemporaryEffects(temporaryEffects);
  
  // These happen simultaneously
  if (damageResult.clearedPermanents.length > 0 || effectsResult.endedEffects.length > 0) {
    logs.push('Damage removal and effect ending occur simultaneously (Rule 514.2)');
  }
  logs.push(...damageResult.logs);
  logs.push(...effectsResult.logs);
  
  // Rule 514.3: Check if priority should be granted
  const priorityCheck = shouldCleanupGrantPriority(hasPendingStateBasedActions, hasPendingTriggers);
  if (priorityCheck.grantsPriority) {
    logs.push(`Priority granted during cleanup: ${priorityCheck.reason} (Rule 514.3)`);
  }
  
  return {
    permanentsWithDamageCleared: damageResult.clearedPermanents,
    effectsEnded: effectsResult.endedEffects,
    discardRequired: handCheck.discardRequired,
    needsPriority: priorityCheck.grantsPriority,
    logs,
  };
}

/**
 * Apply damage clearing to a battlefield state
 * Returns the updated battlefield with damage cleared
 */
export function applyDamageClearing<T extends { 
  id: string; 
  markedDamage?: number;
  damage?: number;
  counters?: Record<string, number>;
}>(
  battlefield: readonly T[]
): T[] {
  return battlefield.map(permanent => {
    // Clear both markedDamage and damage counter formats
    const hasMarkedDamage = (permanent.markedDamage || 0) > 0;
    const hasDamageCounter = permanent.counters && (permanent.counters.damage || 0) > 0;
    
    if (hasMarkedDamage || hasDamageCounter) {
      return {
        ...permanent,
        markedDamage: 0,
        damage: 0,
        counters: permanent.counters 
          ? { ...permanent.counters, damage: 0 }
          : undefined,
      };
    }
    
    return permanent;
  });
}

/**
 * Check if a permanent has lethal damage (for SBA during cleanup if priority is granted)
 */
export function hasLethalDamage(
  toughness: number,
  markedDamage: number,
  hasDeathtouch: boolean = false
): boolean {
  if (hasDeathtouch && markedDamage > 0) {
    return true;
  }
  return markedDamage >= toughness;
}

/**
 * Get all permanents with damage marked on them
 */
export function getPermanentsWithDamage<T extends {
  id: string;
  name?: string;
  controller: string;
  markedDamage?: number;
  damage?: number;
  counters?: Record<string, number>;
}>(
  battlefield: readonly T[]
): DamageTrackedPermanent[] {
  return battlefield
    .filter(p => {
      const damage = p.markedDamage || p.damage || (p.counters?.damage) || 0;
      return damage > 0;
    })
    .map(p => ({
      id: p.id,
      name: p.name,
      controller: p.controller,
      markedDamage: p.markedDamage || p.damage || (p.counters?.damage) || 0,
    }));
}

export default {
  createCleanupStepState,
  checkHandSize,
  clearDamageFromPermanents,
  endTemporaryEffects,
  shouldCleanupGrantPriority,
  needsAdditionalCleanupStep,
  executeCleanupStep,
  applyDamageClearing,
  hasLethalDamage,
  getPermanentsWithDamage,
};
