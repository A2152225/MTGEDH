/**
 * RulesEngineAdapter.ts
 * 
 * Unified adapter for the MTG Rules Engine that exposes a consistent API
 * for all game actions, validation, and state changes. This adapter integrates
 * all rules modules and provides a single entry point for:
 * - Action validation and legality checks
 * - Atomic state transitions
 * - Event emission for UI and simulation layers
 * - Win/loss condition detection
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { EngineResult } from './index';
import {
  Phase,
  Step,
  TurnStructure,
  advanceTurn,
  createTurnStructure,
  getNextStep,
  getNextPhase,
  doesStepReceivePriority,
} from './types/turnStructure';
import {
  checkPlayerLoss,
  PlayerLossCheck,
  LoseCondition,
  WinCondition,
  GameResult,
  GameEndReason,
  MulliganState,
  takeMulligan,
  keepHand,
} from './types/gameFlow';
import { ManaType, type ManaPool, type ManaCost } from './types/mana';
import { emptyManaPool } from './manaAbilities';
import {
  castSpell,
  validateSpellTiming,
  type SpellCastingContext,
} from './spellCasting';
import {
  createEmptyStack,
  pushToStack,
  popFromStack,
  isStackEmpty as checkStackEmpty,
  resolveStackObject,
  type Stack,
} from './stackOperations';
import {
  activateManaAbility,
  canActivateManaAbility,
  tapPermanentForMana,
  createBasicLandManaAbility,
  type ManaAbility,
  type TapForManaContext,
} from './manaAbilities';
import {
  activateAbility,
  type ActivatedAbility,
  type ActivationContext,
} from './activatedAbilities';
import {
  createEmptyTriggerQueue,
  putTriggersOnStack,
  processEvent,
  type TriggerQueue,
  type TriggeredAbility,
  TriggerEvent,
} from './triggeredAbilities';

/**
 * Engine events that can be observed by UI and simulation layers
 */
export enum RulesEngineEvent {
  // Game flow
  GAME_STARTED = 'gameStarted',
  TURN_STARTED = 'turnStarted',
  PHASE_STARTED = 'phaseStarted',
  STEP_STARTED = 'stepStarted',
  PRIORITY_PASSED = 'priorityPassed',
  
  // Mulligan
  MULLIGAN_DECISION = 'mulliganDecision',
  MULLIGAN_COMPLETED = 'mulliganCompleted',
  
  // Spell casting
  SPELL_CAST = 'spellCast',
  SPELL_COUNTERED = 'spellCountered',
  SPELL_RESOLVED = 'spellResolved',
  
  // Abilities
  ABILITY_ACTIVATED = 'abilityActivated',
  ABILITY_RESOLVED = 'abilityResolved',
  TRIGGERED_ABILITY = 'triggeredAbility',
  
  // Mana
  MANA_ABILITY_ACTIVATED = 'manaAbilityActivated',
  MANA_ADDED = 'manaAdded',
  MANA_SPENT = 'manaSpent',
  MANA_POOL_EMPTIED = 'manaPoolEmptied',
  
  // Combat
  COMBAT_DECLARED = 'combatDeclared',
  ATTACKERS_DECLARED = 'attackersDeclared',
  BLOCKERS_DECLARED = 'blockersDeclared',
  DAMAGE_ASSIGNED = 'damageAssigned',
  DAMAGE_DEALT = 'damageDealt',
  
  // State changes
  STATE_BASED_ACTIONS = 'stateBasedActions',
  PLAYER_LOST = 'playerLost',
  PLAYER_WON = 'playerWon',
  GAME_ENDED = 'gameEnded',
  
  // Card actions
  CARD_DRAWN = 'cardDrawn',
  CARD_DISCARDED = 'cardDiscarded',
  PERMANENT_DESTROYED = 'permanentDestroyed',
  CARD_EXILED = 'cardExiled',
  PERMANENT_TAPPED = 'permanentTapped',
  PERMANENT_UNTAPPED = 'permanentUntapped',
}

export interface RulesEvent {
  readonly type: RulesEngineEvent;
  readonly timestamp: number;
  readonly gameId: string;
  readonly data: any;
}

/**
 * Action validation result
 */
export interface ActionValidation {
  readonly legal: boolean;
  readonly reason?: string;
  readonly requirements?: string[];
}

/**
 * Rules Engine Adapter - Main interface for all rules operations
 */
export class RulesEngineAdapter {
  private eventListeners: Map<RulesEngineEvent, Set<(event: RulesEvent) => void>> = new Map();
  private gameStates: Map<string, GameState> = new Map();
  
  // Enhanced state tracking
  private stacks: Map<string, Stack> = new Map();
  private triggerQueues: Map<string, TriggerQueue> = new Map();
  private manaAbilities: Map<string, ManaAbility[]> = new Map();
  private activatedAbilities: Map<string, ActivatedAbility[]> = new Map();
  private triggeredAbilities: Map<string, TriggeredAbility[]> = new Map();
  
  constructor() {
    // Initialize event listener map for all event types
    Object.values(RulesEngineEvent).forEach(eventType => {
      this.eventListeners.set(eventType as RulesEngineEvent, new Set());
    });
  }
  
  /**
   * Register an event listener
   */
  on(eventType: RulesEngineEvent, callback: (event: RulesEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.add(callback);
    }
  }
  
  /**
   * Unregister an event listener
   */
  off(eventType: RulesEngineEvent, callback: (event: RulesEvent) => void): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
    }
  }
  
  /**
   * Emit an event to all registered listeners
   */
  private emit(event: RulesEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(callback => callback(event));
    }
  }
  
  /**
   * Initialize a new game with rules engine
   */
  initializeGame(gameId: string, initialState: GameState): EngineResult<GameState> {
    this.gameStates.set(gameId, initialState);
    this.stacks.set(gameId, createEmptyStack());
    this.triggerQueues.set(gameId, createEmptyTriggerQueue());
    this.manaAbilities.set(gameId, []);
    this.activatedAbilities.set(gameId, []);
    this.triggeredAbilities.set(gameId, []);
    
    this.emit({
      type: RulesEngineEvent.GAME_STARTED,
      timestamp: Date.now(),
      gameId,
      data: { state: initialState },
    });
    
    return {
      next: initialState,
      log: [`Game ${gameId} initialized with rules engine`],
    };
  }
  
  /**
   * Validate if an action is legal
   */
  validateAction(gameId: string, action: any): ActionValidation {
    const state = this.gameStates.get(gameId);
    if (!state) {
      return { legal: false, reason: 'Game not found' };
    }
    
    // TODO: Implement comprehensive validation based on action type
    // For now, basic validation
    switch (action.type) {
      case 'castSpell':
        return this.validateSpellCast(state, action);
      case 'declareAttackers':
        return this.validateAttackerDeclaration(state, action);
      case 'declareBlockers':
        return this.validateBlockerDeclaration(state, action);
      default:
        return { legal: true };
    }
  }
  
  /**
   * Validate spell casting
   */
  private validateSpellCast(state: GameState, action: any): ActionValidation {
    // Check if player has priority
    const activePlayer = state.players[state.priorityPlayerIndex];
    if (activePlayer.id !== action.playerId) {
      return {
        legal: false,
        reason: 'Player does not have priority',
      };
    }
    
    // Check timing restrictions (main phase, stack empty for sorceries, etc.)
    // TODO: Implement full timing validation
    
    return { legal: true };
  }
  
  /**
   * Validate attacker declaration
   */
  private validateAttackerDeclaration(state: GameState, action: any): ActionValidation {
    // Check if it's the declare attackers step
    if (state.step !== 'declareAttackers') {
      return {
        legal: false,
        reason: 'Not in declare attackers step',
      };
    }
    
    // Check if player is active player
    const activePlayer = state.players[state.activePlayerIndex];
    if (activePlayer.id !== action.playerId) {
      return {
        legal: false,
        reason: 'Only active player can declare attackers',
      };
    }
    
    return { legal: true };
  }
  
  /**
   * Validate blocker declaration
   */
  private validateBlockerDeclaration(state: GameState, action: any): ActionValidation {
    // Check if it's the declare blockers step
    if (state.step !== 'declareBlockers') {
      return {
        legal: false,
        reason: 'Not in declare blockers step',
      };
    }
    
    return { legal: true };
  }
  
  /**
   * Execute a validated action and apply state changes atomically
   */
  executeAction(gameId: string, action: any): EngineResult<GameState> {
    const validation = this.validateAction(gameId, action);
    if (!validation.legal) {
      return {
        next: this.gameStates.get(gameId)!,
        log: [`Action rejected: ${validation.reason}`],
      };
    }
    
    const currentState = this.gameStates.get(gameId);
    if (!currentState) {
      return {
        next: currentState!,
        log: ['Game not found'],
      };
    }
    
    // Execute action based on type
    let result: EngineResult<GameState>;
    switch (action.type) {
      case 'passPriority':
        result = this.passPriority(gameId, action.playerId);
        break;
      case 'castSpell':
        result = this.castSpellAction(gameId, action);
        break;
      case 'tapForMana':
        result = this.tapForManaAction(gameId, action);
        break;
      case 'activateAbility':
        result = this.activateAbilityAction(gameId, action);
        break;
      case 'declareAttackers':
        result = this.declareAttackers(gameId, action);
        break;
      case 'declareBlockers':
        result = this.declareBlockers(gameId, action);
        break;
      case 'resolveStack':
        result = this.resolveStackTop(gameId);
        break;
      case 'advanceTurn':
        result = this.advanceTurnPhaseStep(gameId);
        break;
      default:
        result = { next: currentState, log: ['Unknown action type'] };
    }
    
    // Update stored state
    this.gameStates.set(gameId, result.next);
    
    // Check state-based actions after each action
    const sbaResult = this.checkStateBasedActions(gameId, result.next);
    this.gameStates.set(gameId, sbaResult.next);
    
    return {
      next: sbaResult.next,
      log: [...(result.log || []), ...(sbaResult.log || [])],
    };
  }
  
  /**
   * Pass priority to next player
   */
  private passPriority(gameId: string, playerId: PlayerID): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    
    // Rotate priority to next player
    const nextPriorityIndex = (state.priorityPlayerIndex + 1) % state.players.length;
    const nextState: GameState = {
      ...state,
      priorityPlayerIndex: nextPriorityIndex,
    };
    
    this.emit({
      type: RulesEngineEvent.PRIORITY_PASSED,
      timestamp: Date.now(),
      gameId,
      data: { from: playerId, to: state.players[nextPriorityIndex].id },
    });
    
    return {
      next: nextState,
      log: [`Priority passed from ${playerId} to ${state.players[nextPriorityIndex].id}`],
    };
  }
  
  /**
   * Cast a spell (enhanced with full spell casting system)
   */
  private castSpellAction(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === action.playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    // Prepare casting context
    const context: SpellCastingContext = {
      spellId: action.cardId,
      cardName: action.cardName || 'Unknown Card',
      controllerId: action.playerId,
      manaCost: action.manaCost || {},
      targets: action.targets,
      modes: action.modes,
      xValue: action.xValue,
    };
    
    // Prepare timing context
    const activePlayer = state.players[state.activePlayerIndex];
    const timingContext = {
      isMainPhase: state.phase === 'precombatMain' || state.phase === 'postcombatMain',
      isOwnTurn: activePlayer.id === action.playerId,
      stackEmpty: checkStackEmpty(this.stacks.get(gameId)!),
      hasPriority: state.players[state.priorityPlayerIndex].id === action.playerId,
    };
    
    // Execute spell casting
    const castResult = castSpell(
      context,
      player.manaPool,
      action.cardTypes || ['instant'], // Default to instant for timing
      timingContext
    );
    
    if (!castResult.success) {
      return { next: state, log: [castResult.error || 'Failed to cast spell'] };
    }
    
    // Update player's mana pool
    const updatedPlayers = state.players.map(p =>
      p.id === action.playerId
        ? { ...p, manaPool: castResult.manaPoolAfter! }
        : p
    );
    
    const nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };
    
    // Add to stack (stored separately for now)
    const stack = this.stacks.get(gameId)!;
    const stackResult = pushToStack(stack, {
      id: castResult.stackObjectId!,
      spellId: action.cardId,
      cardName: action.cardName || 'Unknown Card',
      controllerId: action.playerId,
      targets: action.targets || [],
      timestamp: Date.now(),
      type: 'spell',
    });
    this.stacks.set(gameId, stackResult.stack);
    
    // Emit event
    this.emit({
      type: RulesEngineEvent.SPELL_CAST,
      timestamp: Date.now(),
      gameId,
      data: { 
        spell: { card: { name: action.cardName }, id: castResult.stackObjectId },
        caster: action.playerId 
      },
    });
    
    // Emit mana spent event
    this.emit({
      type: RulesEngineEvent.MANA_SPENT,
      timestamp: Date.now(),
      gameId,
      data: { 
        playerId: action.playerId,
        cost: action.manaCost,
      },
    });
    
    return {
      next: nextState,
      log: castResult.log || [`${action.playerId} cast ${action.cardName}`],
    };
  }
  
  /**
   * Tap permanent for mana
   */
  private tapForManaAction(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === action.playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    const context: TapForManaContext = {
      permanentId: action.permanentId,
      permanentName: action.permanentName || 'Permanent',
      controllerId: action.playerId,
      manaToAdd: action.manaToAdd || [{ type: ManaType.COLORLESS, amount: 1 }],
      currentlyTapped: action.currentlyTapped || false,
    };
    
    const result = tapPermanentForMana(context, player.manaPool);
    
    if (!result.success) {
      return { next: state, log: [result.error || 'Failed to tap for mana'] };
    }
    
    // Update player's mana pool
    const updatedPlayers = state.players.map(p =>
      p.id === action.playerId
        ? { ...p, manaPool: result.manaPoolAfter! }
        : p
    );
    
    const nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };
    
    this.emit({
      type: RulesEngineEvent.MANA_ADDED,
      timestamp: Date.now(),
      gameId,
      data: { 
        playerId: action.playerId,
        manaAdded: result.manaAdded,
        source: action.permanentName,
      },
    });
    
    this.emit({
      type: RulesEngineEvent.PERMANENT_TAPPED,
      timestamp: Date.now(),
      gameId,
      data: { 
        permanentId: action.permanentId,
        controllerId: action.playerId,
      },
    });
    
    return {
      next: nextState,
      log: result.log || [`Tapped ${action.permanentName} for mana`],
    };
  }
  
  /**
   * Activate an activated ability
   */
  private activateAbilityAction(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === action.playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    const ability: ActivatedAbility = action.ability;
    const activePlayer = state.players[state.activePlayerIndex];
    
    const activationContext: ActivationContext = {
      hasPriority: state.players[state.priorityPlayerIndex].id === action.playerId,
      isMainPhase: state.phase === 'precombatMain' || state.phase === 'postcombatMain',
      isOwnTurn: activePlayer.id === action.playerId,
      stackEmpty: checkStackEmpty(this.stacks.get(gameId)!),
      isCombat: state.phase === 'combat',
      activationsThisTurn: action.activationsThisTurn || 0,
      sourceTapped: action.sourceTapped || false,
    };
    
    const result = activateAbility(ability, player.manaPool, activationContext);
    
    if (!result.success) {
      return { next: state, log: [result.error || 'Failed to activate ability'] };
    }
    
    // Update player's mana pool if cost was paid
    const updatedPlayers = state.players.map(p =>
      p.id === action.playerId
        ? { ...p, manaPool: result.manaPoolAfter! }
        : p
    );
    
    const nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };
    
    // Add to stack
    const stack = this.stacks.get(gameId)!;
    const stackResult = pushToStack(stack, {
      id: result.stackObjectId!,
      spellId: ability.id,
      cardName: `${ability.sourceName} ability`,
      controllerId: action.playerId,
      targets: ability.targets || [],
      timestamp: Date.now(),
      type: 'ability',
    });
    this.stacks.set(gameId, stackResult.stack);
    
    this.emit({
      type: RulesEngineEvent.ABILITY_ACTIVATED,
      timestamp: Date.now(),
      gameId,
      data: { 
        ability,
        controller: action.playerId,
      },
    });
    
    return {
      next: nextState,
      log: result.log || [`Activated ${ability.sourceName} ability`],
    };
  }
  
  /**
   * Resolve top object on stack
   */
  private resolveStackTop(gameId: string): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const stack = this.stacks.get(gameId)!;
    
    const popResult = popFromStack(stack);
    
    if (!popResult.object) {
      return { next: state, log: ['Stack is empty'] };
    }
    
    // Get legal targets from game state
    // For now, we'll assume all targets are still legal (proper implementation would check:
    // - Permanents still on battlefield
    // - Players still in game
    // - Spells still on stack
    // This is a simplified version for the initial implementation
    const legalTargets = popResult.object.targets; // TODO: Implement proper target validation
    
    // Validate and resolve
    const resolveResult = resolveStackObject(popResult.object, legalTargets);
    
    this.stacks.set(gameId, popResult.stack);
    
    if (resolveResult.countered) {
      this.emit({
        type: RulesEngineEvent.SPELL_COUNTERED,
        timestamp: Date.now(),
        gameId,
        data: { object: popResult.object },
      });
    } else {
      this.emit({
        type: popResult.object.type === 'spell' 
          ? RulesEngineEvent.SPELL_RESOLVED 
          : RulesEngineEvent.ABILITY_RESOLVED,
        timestamp: Date.now(),
        gameId,
        data: { object: popResult.object },
      });
    }
    
    return {
      next: state,
      log: resolveResult.log || [`Resolved ${popResult.object.cardName}`],
    };
  }
  
  /**
   * Empty mana pools at end of step/phase
   */
  private emptyManaPoolsAction(gameId: string): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    
    const updatedPlayers = state.players.map(p => ({
      ...p,
      manaPool: emptyManaPool(),
    }));
    
    const nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };
    
    this.emit({
      type: RulesEngineEvent.MANA_POOL_EMPTIED,
      timestamp: Date.now(),
      gameId,
      data: { players: state.players.map(p => p.id) },
    });
    
    return {
      next: nextState,
      log: ['Mana pools emptied'],
    };
  }
  
  /**
   * Declare attackers
   */
  private declareAttackers(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    
    const combat = {
      attackers: action.attackers || [],
      blockers: [],
      defendingPlayer: action.defendingPlayer,
    };
    
    const nextState: GameState = {
      ...state,
      combat,
    };
    
    this.emit({
      type: RulesEngineEvent.ATTACKERS_DECLARED,
      timestamp: Date.now(),
      gameId,
      data: { attackers: action.attackers, defender: action.defendingPlayer },
    });
    
    return {
      next: nextState,
      log: [`Attackers declared: ${action.attackers.length} creatures`],
    };
  }
  
  /**
   * Declare blockers
   */
  private declareBlockers(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    
    const combat = {
      ...state.combat!,
      blockers: action.blockers || [],
    };
    
    const nextState: GameState = {
      ...state,
      combat,
    };
    
    this.emit({
      type: RulesEngineEvent.BLOCKERS_DECLARED,
      timestamp: Date.now(),
      gameId,
      data: { blockers: action.blockers },
    });
    
    return {
      next: nextState,
      log: [`Blockers declared: ${action.blockers.length} blocks`],
    };
  }
  
  /**
   * Advance turn/phase/step
   */
  private advanceTurnPhaseStep(gameId: string): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    
    // TODO: Implement full turn advancement using turnBasedActions.ts
    // For now, simple step advancement
    
    this.emit({
      type: RulesEngineEvent.STEP_STARTED,
      timestamp: Date.now(),
      gameId,
      data: { step: state.step, phase: state.phase },
    });
    
    return {
      next: state,
      log: ['Turn advanced'],
    };
  }
  
  /**
   * Check and apply state-based actions
   */
  checkStateBasedActions(gameId: string, state: GameState): EngineResult<GameState> {
    const logs: string[] = [];
    let currentState = state;
    
    // Check for player losses
    for (const player of state.players) {
      const lossCheck: PlayerLossCheck = {
        playerId: player.id,
        lifeTotal: player.life,
        poisonCounters: player.counters?.poison || 0,
        librarySize: player.library?.length || 0,
        commanderDamage: player.commanderDamage,
      };
      
      const lossCondition = checkPlayerLoss(lossCheck);
      if (lossCondition) {
        logs.push(`${player.id} lost the game: ${lossCondition}`);
        this.emit({
          type: RulesEngineEvent.PLAYER_LOST,
          timestamp: Date.now(),
          gameId,
          data: { playerId: player.id, reason: lossCondition },
        });
      }
    }
    
    // TODO: Apply other state-based actions (creature death, planeswalker loyalty, etc.)
    // For now, just check player losses
    
    if (logs.length > 0) {
      this.emit({
        type: RulesEngineEvent.STATE_BASED_ACTIONS,
        timestamp: Date.now(),
        gameId,
        data: { actions: logs },
      });
    }
    
    // Check for win conditions
    const winResult = this.checkWinConditions(gameId, currentState);
    if (winResult.log && winResult.log.length > 0) {
      logs.push(...winResult.log);
      currentState = winResult.next; // Update state with win condition
    }
    
    return {
      next: currentState,
      log: logs.length > 0 ? logs : undefined,
    };
  }
  
  /**
   * Check win conditions
   */
  private checkWinConditions(gameId: string, state: GameState): EngineResult<GameState> {
    const activePlayers = state.players.filter(p => !p.hasLost);
    
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      
      const nextState = { ...state, status: 'finished' as any, winner: winner.id };
      this.gameStates.set(gameId, nextState);
      
      this.emit({
        type: RulesEngineEvent.PLAYER_WON,
        timestamp: Date.now(),
        gameId,
        data: { playerId: winner.id, reason: WinCondition.OPPONENTS_LEFT },
      });
      
      this.emit({
        type: RulesEngineEvent.GAME_ENDED,
        timestamp: Date.now(),
        gameId,
        data: { winner: winner.id, reason: GameEndReason.PLAYER_WIN },
      });
      
      return {
        next: nextState,
        log: [`${winner.id} wins the game!`],
      };
    }
    
    if (activePlayers.length === 0) {
      const nextState = { ...state, status: 'finished' as any };
      this.gameStates.set(gameId, nextState);
      
      this.emit({
        type: RulesEngineEvent.GAME_ENDED,
        timestamp: Date.now(),
        gameId,
        data: { reason: GameEndReason.DRAW },
      });
      
      return {
        next: nextState,
        log: ['Game is a draw - all players lost'],
      };
    }
    
    return { next: state };
  }
  
  /**
   * Process mulligan decision
   */
  processMulligan(gameId: string, playerId: PlayerID, keep: boolean): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    this.emit({
      type: RulesEngineEvent.MULLIGAN_DECISION,
      timestamp: Date.now(),
      gameId,
      data: { playerId, keep },
    });
    
    if (keep) {
      return {
        next: state,
        log: [`${playerId} kept their hand`],
      };
    } else {
      // Process mulligan - shuffle hand back and draw new hand
      return {
        next: state,
        log: [`${playerId} took a mulligan`],
      };
    }
  }
}

/**
 * Singleton instance
 */
export const rulesEngine = new RulesEngineAdapter();
