// Pure, deterministic rules engine entry points
// All functions here must be side-effect free and operate on immutable inputs
import type { GameState, PlayerID } from '../../shared/src';

export interface EngineResult<T> {
  readonly next: T;
  readonly log?: readonly string[];
}

// Re-export types
export type {
  AbilityType,
  Ability,
  ActivatedAbility,
  TriggeredAbility,
  StaticAbility,
  SpellAbility,
  ActivationRestriction,
  TriggerCondition,
  ObjectFilter,
  AbilityFilter,
  DamageFilter,
  Condition,
  Effect,
  Cost,
  TargetRequirement
} from './types/abilities';

export type {
  ReplacementEffect,
  ReplacementEffectType,
  EntersReplacementEffect,
  PreventionEffect,
  GameEvent,
  EnterBattlefieldEvent
} from './types/replacementEffects';

export type {
  StackObject,
  StackedSpell
} from './types/stack';

// Re-export modules
export * from './stack';
export * from './priority';
export * from './costs';
export * from './abilities';
export * from './replacementEffects';
export * from './landSearch';

// Legacy function - kept for compatibility
export function passPriority(state: Readonly<GameState>, by: PlayerID): EngineResult<GameState> {
  if (state.priority !== by) return { next: state };
  const order = state.players.map(p => p.id);
  if (order.length === 0) return { next: state };
  const idx = order.indexOf(by);
  const nextPriority = order[(idx + 1) % order.length];
  return {
    next: {
      ...state,
      priority: nextPriority
    }
  };
}