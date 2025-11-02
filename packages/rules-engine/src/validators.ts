/**
 * Validators for game actions and state
 */
import { GameState, GameAction, Card } from '@mtgedh/shared';

export class GameValidator {
  /**
   * Check if a player can play a card
   */
  static canPlayCard(_gameState: GameState, _playerId: string, _card: Card): boolean {
    // TODO: Implement card playability checks
    // - Check priority
    // - Check mana availability
    // - Check timing restrictions
    return true;
  }

  /**
   * Check if a player has priority
   */
  static hasPriority(gameState: GameState, playerId: string): boolean {
    return gameState.priorityPlayer === playerId;
  }

  /**
   * Validate game action
   */
  static validateAction(_gameState: GameState, _action: GameAction): boolean {
    // TODO: Implement comprehensive action validation
    return true;
  }
}
