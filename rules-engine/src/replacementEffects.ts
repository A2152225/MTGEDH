// Replacement effects implementation (rule 614)
import type { GameState } from '../../shared/src';
import type {
  ReplacementEffect,
  GameEvent,
  EnterBattlefieldEvent,
  EntersReplacementEffect
} from './types/replacementEffects';

export interface ReplacementResult<T extends GameEvent> {
  readonly event: T;
  readonly modified: boolean;
  readonly log?: readonly string[];
}

/**
 * Apply replacement effects to an event (rule 614)
 * Replacement effects apply continuously as events happen
 */
export function applyReplacementEffects<T extends GameEvent>(
  state: Readonly<GameState>,
  event: T,
  activeEffects: readonly ReplacementEffect[]
): ReplacementResult<T> {
  // Rule 614.5: A replacement effect doesn't invoke itself repeatedly
  const applicableEffects = activeEffects.filter(effect => 
    isEffectApplicable(effect, event)
  );

  if (applicableEffects.length === 0) {
    return {
      event,
      modified: false
    };
  }

  // Rule 616: If multiple replacement effects would modify the same event,
  // apply them in timestamp order (simplified here)
  const sortedEffects = [...applicableEffects].sort((a, b) => a.layer - b.layer);

  let currentEvent = event;
  const logs: string[] = [];

  for (const effect of sortedEffects) {
    const result = applySingleReplacement(currentEvent, effect);
    currentEvent = result.event as T;
    if (result.modified && result.log) {
      logs.push(...result.log);
    }
  }

  return {
    event: currentEvent,
    modified: logs.length > 0,
    log: logs.length > 0 ? logs : undefined
  };
}

/**
 * Check if a replacement effect applies to an event
 */
function isEffectApplicable(
  effect: ReplacementEffect,
  event: GameEvent
): boolean {
  if (effect.usedUp) {
    return false;
  }

  const effectType = effect.type;

  switch (effectType.type) {
    case 'enters-battlefield':
      return event.type === 'enter-battlefield' && 
             event.permanentId === effectType.targetId;
    
    case 'damage':
      return event.type === 'damage' &&
             matchesDamageFilter(event, effectType.filter);
    
    case 'draw':
      return event.type === 'draw' &&
             event.player === effectType.player;
    
    case 'destroy':
      return event.type === 'destroy' &&
             event.targetId === effectType.targetId;
    
    case 'skip':
      // Skip effects are handled differently - they prevent events from happening
      return false;
    
    default:
      return false;
  }
}

/**
 * Apply a single replacement effect to an event
 */
function applySingleReplacement(
  event: GameEvent,
  effect: ReplacementEffect
): ReplacementResult<GameEvent> {
  const effectType = effect.type;

  switch (effectType.type) {
    case 'enters-battlefield':
      return applyEntersReplacement(event as EnterBattlefieldEvent, effectType);
    
    default:
      return {
        event,
        modified: false
      };
  }
}

/**
 * Apply enters-the-battlefield replacement effect (rule 614.12)
 */
function applyEntersReplacement(
  event: EnterBattlefieldEvent,
  effect: EntersReplacementEffect
): ReplacementResult<EnterBattlefieldEvent> {
  const modification = effect.modification;

  switch (modification.type) {
    case 'enters-tapped':
      // Rule 614.1c: "[This permanent] enters tapped"
      return {
        event: {
          ...event,
          tapped: true
        },
        modified: true,
        log: [`${event.permanentId} enters the battlefield tapped`]
      };
    
    case 'enters-with-counters':
      // Rule 614.1c: "[This permanent] enters with ... counters"
      const newCounters = new Map(event.counters);
      const current = newCounters.get(modification.counterType) || 0;
      newCounters.set(modification.counterType, current + modification.count);
      
      return {
        event: {
          ...event,
          counters: newCounters
        },
        modified: true,
        log: [`${event.permanentId} enters with ${modification.count} ${modification.counterType} counter(s)`]
      };
    
    default:
      return {
        event,
        modified: false
      };
  }
}

/**
 * Helper to match damage events against filters
 */
function matchesDamageFilter(
  event: any,
  filter: any
): boolean {
  // Simplified filter matching
  return true;
}

/**
 * Create an enters-tapped replacement effect (rule 614.12)
 * This is the most common replacement effect
 */
export function createEntersTappedEffect(
  sourceId: string,
  targetId: string,
  layer: number = 0
): ReplacementEffect {
  return {
    id: `etb-tapped-${targetId}-${Date.now()}`,
    sourceId,
    type: {
      type: 'enters-battlefield',
      targetId,
      modification: { type: 'enters-tapped' }
    },
    layer,
    usedUp: false
  };
}

/**
 * Create an enters-with-counters replacement effect
 */
export function createEntersWithCountersEffect(
  sourceId: string,
  targetId: string,
  counterType: string,
  count: number,
  layer: number = 0
): ReplacementEffect {
  return {
    id: `etb-counters-${targetId}-${Date.now()}`,
    sourceId,
    type: {
      type: 'enters-battlefield',
      targetId,
      modification: { type: 'enters-with-counters', counterType, count }
    },
    layer,
    usedUp: false
  };
}

/**
 * Check if a permanent would enter the battlefield tapped
 * This checks for any applicable replacement effects
 */
export function wouldEnterTapped(
  state: Readonly<GameState>,
  permanentId: string,
  replacementEffects: readonly ReplacementEffect[]
): boolean {
  return replacementEffects.some(effect => {
    if (effect.type.type !== 'enters-battlefield') return false;
    const etbEffect = effect.type as EntersReplacementEffect;
    return etbEffect.targetId === permanentId &&
           etbEffect.modification.type === 'enters-tapped';
  });
}
