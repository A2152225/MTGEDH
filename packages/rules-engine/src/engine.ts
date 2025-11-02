/**
 * Core rules engine for MTG game logic
 */
import { GameState, GameAction, GamePhase } from '@mtgedh/shared';

export class RulesEngine {
  private gameState: GameState;

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  /**
   * Process a game action and update game state
   */
  processAction(action: GameAction): GameState {
    // TODO: Implement action processing logic
    console.log('Processing action:', action);
    return this.gameState;
  }

  /**
   * Advance to the next phase
   */
  advancePhase(): GameState {
    const phaseOrder = Object.values(GamePhase);
    const currentIndex = phaseOrder.indexOf(this.gameState.phase);
    const nextIndex = (currentIndex + 1) % phaseOrder.length;
    
    this.gameState.phase = phaseOrder[nextIndex];
    
    if (nextIndex === 0) {
      // New turn
      this.advanceTurn();
    }
    
    return this.gameState;
  }

  /**
   * Advance to the next turn
   */
  private advanceTurn(): void {
    this.gameState.currentTurn++;
    const playerIndex = this.gameState.players.findIndex(
      p => p.id === this.gameState.activePlayer
    );
    const nextPlayerIndex = (playerIndex + 1) % this.gameState.players.length;
    this.gameState.activePlayer = this.gameState.players[nextPlayerIndex].id;
  }

  /**
   * Get current game state
   */
  getGameState(): GameState {
    return this.gameState;
  }
}
