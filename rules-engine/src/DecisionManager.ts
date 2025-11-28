/**
 * DecisionManager.ts
 * 
 * Manages pending decisions that require player input.
 * 
 * In MTG Online-style gameplay, the game pauses when player input is needed:
 * - Target selection
 * - Mode selection
 * - X value selection
 * - Trigger ordering
 * - Combat damage assignment
 * - Mulligan decisions
 * 
 * This manager tracks these decisions, validates responses, and
 * resumes automation when decisions are resolved.
 */

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import {
  DecisionType,
  PendingDecision,
  DecisionOption,
  DecisionResult,
} from './AutomationService';

/**
 * Player's response to a pending decision
 */
export interface DecisionResponse {
  decisionId: string;
  playerId: string;
  selection: any;  // Could be string, string[], number, etc.
  timestamp: number;
}

/**
 * Result of validating a decision response
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  processedSelection?: any;
}

/**
 * State stored for pending decisions per game
 */
export interface DecisionState {
  gameId: string;
  pendingDecisions: PendingDecision[];
  decisionHistory: DecisionResponse[];
  timeoutHandles: Map<string, NodeJS.Timeout>;
}

/**
 * Decision Manager - handles all pending decision tracking and processing
 */
export class DecisionManager {
  private gameDecisions: Map<string, DecisionState> = new Map();
  
  /**
   * Initialize decision tracking for a game
   */
  initGame(gameId: string): void {
    this.gameDecisions.set(gameId, {
      gameId,
      pendingDecisions: [],
      decisionHistory: [],
      timeoutHandles: new Map(),
    });
  }
  
  /**
   * Add a pending decision
   */
  addDecision(gameId: string, decision: PendingDecision): void {
    const state = this.getOrCreateState(gameId);
    state.pendingDecisions.push(decision);
    
    // Set timeout if specified
    if (decision.timeoutMs) {
      const handle = setTimeout(() => {
        this.handleDecisionTimeout(gameId, decision.id);
      }, decision.timeoutMs);
      state.timeoutHandles.set(decision.id, handle);
    }
  }
  
  /**
   * Add multiple pending decisions
   */
  addDecisions(gameId: string, decisions: PendingDecision[]): void {
    for (const decision of decisions) {
      this.addDecision(gameId, decision);
    }
  }
  
  /**
   * Get pending decisions for a player
   */
  getPlayerDecisions(gameId: string, playerId: string): PendingDecision[] {
    const state = this.gameDecisions.get(gameId);
    if (!state) return [];
    return state.pendingDecisions.filter(d => d.playerId === playerId);
  }
  
  /**
   * Get all pending decisions for a game
   */
  getAllDecisions(gameId: string): PendingDecision[] {
    const state = this.gameDecisions.get(gameId);
    return state?.pendingDecisions || [];
  }
  
  /**
   * Check if game has any pending decisions
   */
  hasPendingDecisions(gameId: string): boolean {
    const state = this.gameDecisions.get(gameId);
    return (state?.pendingDecisions.length || 0) > 0;
  }
  
  /**
   * Get a specific pending decision
   */
  getDecision(gameId: string, decisionId: string): PendingDecision | undefined {
    const state = this.gameDecisions.get(gameId);
    return state?.pendingDecisions.find(d => d.id === decisionId);
  }
  
  /**
   * Process a player's decision response
   */
  processResponse(
    gameId: string,
    response: DecisionResponse,
    gameState: GameState
  ): { result: ValidationResult; decision: PendingDecision | undefined } {
    const state = this.gameDecisions.get(gameId);
    if (!state) {
      return {
        result: { valid: false, error: 'Game not found' },
        decision: undefined,
      };
    }
    
    const decision = state.pendingDecisions.find(d => d.id === response.decisionId);
    if (!decision) {
      return {
        result: { valid: false, error: 'Decision not found or already resolved' },
        decision: undefined,
      };
    }
    
    // Validate the player is the one who should respond
    if (decision.playerId !== response.playerId) {
      return {
        result: { valid: false, error: 'Not your decision to make' },
        decision,
      };
    }
    
    // Validate the response based on decision type
    const validation = this.validateResponse(decision, response, gameState);
    
    if (validation.valid) {
      // Clear timeout
      const handle = state.timeoutHandles.get(decision.id);
      if (handle) {
        clearTimeout(handle);
        state.timeoutHandles.delete(decision.id);
      }
      
      // Remove from pending
      state.pendingDecisions = state.pendingDecisions.filter(d => d.id !== decision.id);
      
      // Add to history
      state.decisionHistory.push(response);
    }
    
    return { result: validation, decision };
  }
  
  /**
   * Validate a decision response
   */
  private validateResponse(
    decision: PendingDecision,
    response: DecisionResponse,
    gameState: GameState
  ): ValidationResult {
    const selection = response.selection;
    
    switch (decision.type) {
      case DecisionType.SELECT_TARGETS:
        return this.validateTargetSelection(decision, selection, gameState);
        
      case DecisionType.SELECT_MODE:
      case DecisionType.SELECT_MODES:
        return this.validateModeSelection(decision, selection);
        
      case DecisionType.SELECT_X_VALUE:
        return this.validateXValue(decision, selection, gameState);
        
      case DecisionType.ORDER_TRIGGERS:
        return this.validateTriggerOrdering(decision, selection);
        
      case DecisionType.ORDER_BLOCKERS:
        return this.validateBlockerOrdering(decision, selection);
        
      case DecisionType.SELECT_ATTACKERS:
        return this.validateAttackerSelection(decision, selection, gameState);
        
      case DecisionType.SELECT_BLOCKERS:
        return this.validateBlockerSelection(decision, selection, gameState);
        
      case DecisionType.SELECT_CARDS:
        return this.validateCardSelection(decision, selection, gameState);
        
      case DecisionType.MAY_ABILITY:
        return this.validateMayAbility(decision, selection);
        
      case DecisionType.SELECT_OPTION:
        return this.validateOptionSelection(decision, selection);
        
      case DecisionType.MULLIGAN_DECISION:
        return this.validateMulliganDecision(selection);
        
      case DecisionType.MULLIGAN_BOTTOM:
        return this.validateMulliganBottom(decision, selection, gameState);
        
      default:
        return { valid: true, processedSelection: selection };
    }
  }
  
  /**
   * Validate target selection
   */
  private validateTargetSelection(
    decision: PendingDecision,
    selection: string | string[],
    gameState: GameState
  ): ValidationResult {
    const targets = Array.isArray(selection) ? selection : [selection];
    
    // Check count requirements
    if (decision.minSelections && targets.length < decision.minSelections) {
      return {
        valid: false,
        error: `Must select at least ${decision.minSelections} target(s)`,
      };
    }
    
    if (decision.maxSelections && targets.length > decision.maxSelections) {
      return {
        valid: false,
        error: `Cannot select more than ${decision.maxSelections} target(s)`,
      };
    }
    
    // Validate each target exists and is valid type
    const targetTypes = decision.targetTypes || [];
    for (const targetId of targets) {
      const isValidTarget = this.isValidTarget(targetId, targetTypes, gameState);
      if (!isValidTarget.valid) {
        return {
          valid: false,
          error: `Invalid target: ${isValidTarget.reason}`,
        };
      }
    }
    
    return { valid: true, processedSelection: targets };
  }
  
  /**
   * Check if a target ID is valid
   */
  private isValidTarget(
    targetId: string,
    targetTypes: string[],
    gameState: GameState
  ): { valid: boolean; reason?: string } {
    // Check if it's a player
    const player = gameState.players.find(p => p.id === targetId);
    if (player) {
      if (targetTypes.includes('player') || targetTypes.includes('opponent')) {
        return { valid: true };
      }
      return { valid: false, reason: 'Players cannot be targeted by this effect' };
    }
    
    // Check if it's a permanent on the battlefield
    const permanent = (gameState.battlefield || []).find(
      (p: BattlefieldPermanent) => p.id === targetId
    );
    
    if (permanent) {
      const card = permanent.card as any;
      const typeLine = (card?.type_line || '').toLowerCase();
      
      // Check type matching
      if (targetTypes.length === 0 || targetTypes.includes('permanent')) {
        return { valid: true };
      }
      
      for (const type of targetTypes) {
        if (typeLine.includes(type.toLowerCase())) {
          return { valid: true };
        }
      }
      
      return {
        valid: false,
        reason: `Target must be: ${targetTypes.join(' or ')}`,
      };
    }
    
    // Check if it's a spell on the stack
    const stackItem = (gameState.stack || []).find(s => s.id === targetId);
    if (stackItem) {
      if (targetTypes.includes('spell')) {
        return { valid: true };
      }
      return { valid: false, reason: 'Spells cannot be targeted by this effect' };
    }
    
    return { valid: false, reason: 'Target not found' };
  }
  
  /**
   * Validate mode selection
   */
  private validateModeSelection(
    decision: PendingDecision,
    selection: string | string[]
  ): ValidationResult {
    const modes = Array.isArray(selection) ? selection : [selection];
    const options = decision.options || [];
    const optionIds = options.map(o => o.id);
    
    // Check all selected modes are valid
    for (const mode of modes) {
      if (!optionIds.includes(mode)) {
        return { valid: false, error: `Invalid mode: ${mode}` };
      }
    }
    
    // Check count requirements
    if (decision.minSelections && modes.length < decision.minSelections) {
      return {
        valid: false,
        error: `Must select at least ${decision.minSelections} mode(s)`,
      };
    }
    
    if (decision.maxSelections && modes.length > decision.maxSelections) {
      return {
        valid: false,
        error: `Cannot select more than ${decision.maxSelections} mode(s)`,
      };
    }
    
    // Check for duplicates
    const uniqueModes = new Set(modes);
    if (uniqueModes.size !== modes.length) {
      return { valid: false, error: 'Cannot select the same mode twice' };
    }
    
    return { valid: true, processedSelection: modes };
  }
  
  /**
   * Validate X value selection
   */
  private validateXValue(
    decision: PendingDecision,
    selection: number,
    gameState: GameState
  ): ValidationResult {
    const x = Number(selection);
    
    if (isNaN(x) || !Number.isInteger(x)) {
      return { valid: false, error: 'X must be a whole number' };
    }
    
    if (decision.minX !== undefined && x < decision.minX) {
      return { valid: false, error: `X must be at least ${decision.minX}` };
    }
    
    if (decision.maxX !== undefined && x > decision.maxX) {
      return { valid: false, error: `X cannot exceed ${decision.maxX}` };
    }
    
    // Check if player can afford X mana
    // (This would need mana pool information)
    
    return { valid: true, processedSelection: x };
  }
  
  /**
   * Validate trigger ordering
   */
  private validateTriggerOrdering(
    decision: PendingDecision,
    selection: string[]
  ): ValidationResult {
    if (!Array.isArray(selection)) {
      return { valid: false, error: 'Must provide ordered list of triggers' };
    }
    
    const options = decision.options || [];
    const optionIds = options.map(o => o.id);
    
    // Check all triggers are included
    if (selection.length !== optionIds.length) {
      return { valid: false, error: 'Must order all triggers' };
    }
    
    // Check all selected are valid
    for (const id of selection) {
      if (!optionIds.includes(id)) {
        return { valid: false, error: `Invalid trigger: ${id}` };
      }
    }
    
    // Check for duplicates
    const unique = new Set(selection);
    if (unique.size !== selection.length) {
      return { valid: false, error: 'Each trigger can only appear once' };
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate blocker ordering for damage assignment
   */
  private validateBlockerOrdering(
    decision: PendingDecision,
    selection: string[]
  ): ValidationResult {
    return this.validateTriggerOrdering(decision, selection);
  }
  
  /**
   * Validate attacker selection
   */
  private validateAttackerSelection(
    decision: PendingDecision,
    selection: Array<{ attackerId: string; defendingPlayer: string }>,
    gameState: GameState
  ): ValidationResult {
    if (!Array.isArray(selection)) {
      return { valid: false, error: 'Invalid attacker selection format' };
    }
    
    const battlefield = gameState.battlefield || [];
    const activePlayerId = gameState.players[gameState.activePlayerIndex || 0]?.id;
    
    for (const { attackerId, defendingPlayer } of selection) {
      // Check attacker exists and is controlled by active player
      const attacker = battlefield.find((p: BattlefieldPermanent) => p.id === attackerId);
      if (!attacker) {
        return { valid: false, error: `Creature ${attackerId} not found` };
      }
      
      if (attacker.controller !== activePlayerId) {
        return { valid: false, error: 'Can only attack with your own creatures' };
      }
      
      // Check it's a creature
      const card = attacker.card as any;
      const typeLine = (card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) {
        return { valid: false, error: `${card?.name} is not a creature` };
      }
      
      // Check not tapped
      if (attacker.tapped) {
        return { valid: false, error: `${card?.name} is tapped` };
      }
      
      // Check no summoning sickness (unless has haste)
      if (attacker.summoningSickness) {
        const oracleText = (card?.oracle_text || '').toLowerCase();
        if (!oracleText.includes('haste')) {
          return { valid: false, error: `${card?.name} has summoning sickness` };
        }
      }
      
      // Check defender keyword
      const oracleText = (card?.oracle_text || '').toLowerCase();
      if (oracleText.includes('defender')) {
        return { valid: false, error: `${card?.name} has defender and cannot attack` };
      }
      
      // Check defending player is valid
      const defender = gameState.players.find(p => p.id === defendingPlayer);
      if (!defender) {
        return { valid: false, error: `Invalid defending player: ${defendingPlayer}` };
      }
      
      if (defendingPlayer === activePlayerId) {
        return { valid: false, error: 'Cannot attack yourself' };
      }
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate blocker selection
   */
  private validateBlockerSelection(
    decision: PendingDecision,
    selection: Array<{ blockerId: string; attackerId: string }>,
    gameState: GameState
  ): ValidationResult {
    if (!Array.isArray(selection)) {
      return { valid: false, error: 'Invalid blocker selection format' };
    }
    
    const battlefield = gameState.battlefield || [];
    const playerId = decision.playerId;
    
    for (const { blockerId, attackerId } of selection) {
      // Check blocker exists and is controlled by this player
      const blocker = battlefield.find((p: BattlefieldPermanent) => p.id === blockerId);
      if (!blocker) {
        return { valid: false, error: `Creature ${blockerId} not found` };
      }
      
      if (blocker.controller !== playerId) {
        return { valid: false, error: 'Can only block with your own creatures' };
      }
      
      // Check it's a creature
      const card = blocker.card as any;
      const typeLine = (card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) {
        return { valid: false, error: `${card?.name} is not a creature` };
      }
      
      // Check not tapped
      if (blocker.tapped) {
        return { valid: false, error: `${card?.name} is tapped and cannot block` };
      }
      
      // Check attacker exists and is attacking
      const attacker = battlefield.find((p: BattlefieldPermanent) => p.id === attackerId);
      if (!attacker || !attacker.attacking) {
        return { valid: false, error: `${attackerId} is not attacking` };
      }
      
      // Check for flying/reach
      const attackerCard = attacker.card as any;
      const attackerText = (attackerCard?.oracle_text || '').toLowerCase();
      const blockerText = (card?.oracle_text || '').toLowerCase();
      
      if (attackerText.includes('flying') && !blockerText.includes('flying') && !blockerText.includes('reach')) {
        return { valid: false, error: `${card?.name} cannot block flying creatures` };
      }
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate card selection (for discard, etc.)
   */
  private validateCardSelection(
    decision: PendingDecision,
    selection: string[],
    gameState: GameState
  ): ValidationResult {
    if (!Array.isArray(selection)) {
      return { valid: false, error: 'Must select card(s)' };
    }
    
    // Check count requirements
    if (decision.minSelections && selection.length < decision.minSelections) {
      return {
        valid: false,
        error: `Must select at least ${decision.minSelections} card(s)`,
      };
    }
    
    if (decision.maxSelections && selection.length > decision.maxSelections) {
      return {
        valid: false,
        error: `Cannot select more than ${decision.maxSelections} card(s)`,
      };
    }
    
    // Validate cards exist in expected zone (usually hand)
    const player = gameState.players.find(p => p.id === decision.playerId);
    if (!player) {
      return { valid: false, error: 'Player not found' };
    }
    
    const hand = (player as any).hand || [];
    const handIds = hand.map((c: any) => c?.id || c);
    
    for (const cardId of selection) {
      if (!handIds.includes(cardId)) {
        return { valid: false, error: `Card ${cardId} not in hand` };
      }
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate may ability response
   */
  private validateMayAbility(
    decision: PendingDecision,
    selection: string | boolean
  ): ValidationResult {
    const value = typeof selection === 'boolean' ? selection : selection === 'yes';
    return { valid: true, processedSelection: value };
  }
  
  /**
   * Validate option selection
   */
  private validateOptionSelection(
    decision: PendingDecision,
    selection: string
  ): ValidationResult {
    const options = decision.options || [];
    const optionIds = options.map(o => o.id);
    
    if (!optionIds.includes(selection)) {
      return { valid: false, error: 'Invalid option selected' };
    }
    
    return { valid: true, processedSelection: selection };
  }
  
  /**
   * Validate mulligan decision
   */
  private validateMulliganDecision(selection: string | boolean): ValidationResult {
    const keep = typeof selection === 'boolean' ? selection : selection === 'keep';
    return { valid: true, processedSelection: keep };
  }
  
  /**
   * Validate mulligan bottom selection
   */
  private validateMulliganBottom(
    decision: PendingDecision,
    selection: string[],
    gameState: GameState
  ): ValidationResult {
    return this.validateCardSelection(decision, selection, gameState);
  }
  
  /**
   * Handle decision timeout
   */
  private handleDecisionTimeout(gameId: string, decisionId: string): void {
    const state = this.gameDecisions.get(gameId);
    if (!state) return;
    
    const decision = state.pendingDecisions.find(d => d.id === decisionId);
    if (!decision) return;
    
    // Use default choice if available
    if (decision.defaultChoice !== undefined) {
      // Remove from pending
      state.pendingDecisions = state.pendingDecisions.filter(d => d.id !== decisionId);
      
      // Add timeout response to history
      state.decisionHistory.push({
        decisionId,
        playerId: decision.playerId,
        selection: decision.defaultChoice,
        timestamp: Date.now(),
      });
    }
    
    // Clear timeout handle
    state.timeoutHandles.delete(decisionId);
  }
  
  /**
   * Clear all decisions for a game (e.g., game ended)
   */
  clearGame(gameId: string): void {
    const state = this.gameDecisions.get(gameId);
    if (state) {
      // Clear all timeouts
      const handles = Array.from(state.timeoutHandles.values());
      for (const handle of handles) {
        clearTimeout(handle);
      }
    }
    this.gameDecisions.delete(gameId);
  }
  
  /**
   * Get or create decision state for a game
   */
  private getOrCreateState(gameId: string): DecisionState {
    let state = this.gameDecisions.get(gameId);
    if (!state) {
      state = {
        gameId,
        pendingDecisions: [],
        decisionHistory: [],
        timeoutHandles: new Map(),
      };
      this.gameDecisions.set(gameId, state);
    }
    return state;
  }
  
  /**
   * Get decision history for a game
   */
  getDecisionHistory(gameId: string): DecisionResponse[] {
    const state = this.gameDecisions.get(gameId);
    return state?.decisionHistory || [];
  }
}

/**
 * Singleton instance
 */
export const decisionManager = new DecisionManager();

export default DecisionManager;
