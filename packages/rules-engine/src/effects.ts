/**
 * Card effects and abilities handler
 */
import { Card, GameState } from '@mtgedh/shared';

export interface Effect {
  id: string;
  sourceCard: Card;
  type: EffectType;
  apply(gameState: GameState): GameState;
}

export enum EffectType {
  CONTINUOUS = 'continuous',
  TRIGGERED = 'triggered',
  ACTIVATED = 'activated',
  STATIC = 'static'
}

export class EffectManager {
  private effects: Effect[] = [];

  /**
   * Register an effect
   */
  registerEffect(effect: Effect): void {
    this.effects.push(effect);
  }

  /**
   * Apply all continuous effects
   */
  applyContinuousEffects(gameState: GameState): GameState {
    let state = gameState;
    for (const effect of this.effects) {
      if (effect.type === EffectType.CONTINUOUS) {
        state = effect.apply(state);
      }
    }
    return state;
  }

  /**
   * Clear all effects
   */
  clearEffects(): void {
    this.effects = [];
  }
}
