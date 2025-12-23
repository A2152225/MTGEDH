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
 * 
 * Note: Action handlers are now modularized in the actions/ directory.
 * This file serves as the main orchestrator and maintains backward compatibility.
 */

import type { GameState, PlayerID } from '../../shared/src';
import { GameStep as SharedGameStep } from '../../shared/src';
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
import { ManaType, type ManaPool as RulesEngineManaPool, type ManaCost } from './types/mana';
import { emptyManaPool } from './manaAbilities';

/** Simple mana pool interface for checking mana availability (doesn't need restricted mana info) */
interface SimpleManaPool {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
}

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

// Import modular action handlers
import {
  executeSacrifice,
  validateSacrifice,
  executeSearchLibrary,
  validateSearchLibrary,
  executeDeclareAttackers,
  validateDeclareAttackers,
  executeDeclareBlockers,
  validateDeclareBlockers,
  executeCombatDamage,
  executeFetchland,
  validateFetchland,
  // Game automation
  initializeGame,
  drawInitialHand,
  processMulligan,
  completeMulliganPhase,
  advanceGame,
  passPriority as advancePassPriority,
  performStateBasedActions,
  checkWinConditions,
  executeTurnBasedAction,
  GamePhase,
  GameStep,
} from './actions';

// Re-export events from core module, import for local use
export { RulesEngineEvent, type RulesEvent } from './core/events';
import { RulesEngineEvent } from './core/events';
import type { RulesEvent } from './core/events';

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
    // Handle undefined priorityPlayerIndex gracefully
    if (state.priorityPlayerIndex === undefined || state.priorityPlayerIndex === null) {
      // If no priority player set, allow the action (legacy fallback)
      return { legal: true };
    }
    
    const activePlayer = state.players?.[state.priorityPlayerIndex];
    if (!activePlayer) {
      // If player not found at index, allow the action (legacy fallback)
      return { legal: true };
    }
    
    if (activePlayer.id !== action.playerId) {
      return {
        legal: false,
        reason: 'Player does not have priority',
      };
    }
    
    // Check mana availability if mana cost is provided
    if (action.manaCost) {
      const player = state.players.find(p => p.id === action.playerId);
      if (!player) {
        return {
          legal: false,
          reason: 'Player not found',
        };
      }
      
      // Parse mana cost string (e.g., "{2}{U}{U}")
      const cost = this.parseManaCostString(action.manaCost);
      const pool = player.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      
      // Check if player can pay the cost
      const canPay = this.canPayManaCostFromPool(cost, pool);
      if (!canPay.canPay) {
        return {
          legal: false,
          reason: canPay.reason || 'Insufficient mana',
        };
      }
    }
    
    // Check timing restrictions (main phase, stack empty for sorceries, etc.)
    const cardTypes = this.getCardTypes(action.card || action.spell);
    const timingContext = this.buildTimingContext(state, action.playerId);
    const timingResult = validateSpellTiming(cardTypes, timingContext);
    
    if (!timingResult.valid) {
      return {
        legal: false,
        reason: timingResult.reason || 'Invalid timing',
      };
    }
    
    return { legal: true };
  }
  
  /**
   * Extract card types from a card object
   */
  private getCardTypes(card: any): string[] {
    if (!card) return [];
    
    const typeLine = card.type_line || card.typeLine || '';
    const types: string[] = [];
    
    // Parse type line (e.g., "Creature — Human Wizard" or "Instant")
    const mainTypes = typeLine.split('—')[0].toLowerCase();
    
    if (mainTypes.includes('creature')) types.push('creature');
    if (mainTypes.includes('instant')) types.push('instant');
    if (mainTypes.includes('sorcery')) types.push('sorcery');
    if (mainTypes.includes('artifact')) types.push('artifact');
    if (mainTypes.includes('enchantment')) types.push('enchantment');
    if (mainTypes.includes('planeswalker')) types.push('planeswalker');
    if (mainTypes.includes('land')) types.push('land');
    if (mainTypes.includes('battle')) types.push('battle');
    
    // Check for flash keyword
    const oracleText = (card.oracle_text || '').toLowerCase();
    if (oracleText.includes('flash')) {
      types.push('flash');
    }
    
    return types;
  }
  
  /**
   * Build timing context for spell validation
   */
  private buildTimingContext(state: GameState, playerId: string): {
    isMainPhase: boolean;
    isOwnTurn: boolean;
    stackEmpty: boolean;
    hasPriority: boolean;
  } {
    // Get phase info
    const phase = state.phase;
    // Support both enum values and string variants for phase comparison
    const phaseStr = String(phase || '').toLowerCase();
    const isMainPhase = phaseStr === 'precombatmain' || phaseStr === 'postcombatmain' ||
                        phaseStr === 'precombat_main' || phaseStr === 'postcombat_main' ||
                        phaseStr === 'first_main' || phaseStr === 'main1' || phaseStr === 'main2';
    
    // Check if it's the player's turn
    const activePlayerIndex = state.activePlayerIndex || 0;
    const activePlayer = state.players[activePlayerIndex];
    const isOwnTurn = activePlayer?.id === playerId;
    
    // Check stack
    const stackEmpty = !state.stack || state.stack.length === 0;
    
    // Check priority
    const priorityIndex = state.priorityPlayerIndex ?? activePlayerIndex;
    const priorityPlayer = state.players[priorityIndex];
    const hasPriority = priorityPlayer?.id === playerId;
    
    return {
      isMainPhase,
      isOwnTurn,
      stackEmpty,
      hasPriority,
    };
  }
  
  /**
   * Parse mana cost string like "{2}{U}{U}" into a ManaCost object
   */
  private parseManaCostString(manaCost: string | any): ManaCost {
    // Handle non-string input (could be already parsed object or null/undefined)
    if (!manaCost) {
      return { generic: 0 };
    }
    
    // If already an object with mana properties, return it directly
    if (typeof manaCost === 'object') {
      return {
        generic: manaCost.generic || 0,
        white: manaCost.white || 0,
        blue: manaCost.blue || 0,
        black: manaCost.black || 0,
        red: manaCost.red || 0,
        green: manaCost.green || 0,
        colorless: manaCost.colorless || 0,
      };
    }
    
    // Parse string format like "{R}{R}{2}"
    if (typeof manaCost !== 'string') {
      return { generic: 0 };
    }
    
    const tokens = manaCost.match(/\{[^}]+\}/g) || [];
    
    // Build up the cost object without mutations
    let generic = 0;
    let white = 0;
    let blue = 0;
    let black = 0;
    let red = 0;
    let green = 0;
    let colorless = 0;
    
    for (const token of tokens) {
      const symbol = token.replace(/[{}]/g, '').toUpperCase();
      
      if (/^\d+$/.test(symbol)) {
        // Generic mana like {2}
        generic += parseInt(symbol, 10);
      } else if (symbol === 'W') {
        white += 1;
      } else if (symbol === 'U') {
        blue += 1;
      } else if (symbol === 'B') {
        black += 1;
      } else if (symbol === 'R') {
        red += 1;
      } else if (symbol === 'G') {
        green += 1;
      } else if (symbol === 'C') {
        colorless += 1;
      }
      // Note: hybrid mana, phyrexian mana, etc. not implemented yet
    }
    
    return { generic, white, blue, black, red, green, colorless };
  }
  
  /**
   * Check if a mana cost can be paid from the given mana pool
   */
  private canPayManaCostFromPool(cost: ManaCost, pool: SimpleManaPool): { canPay: boolean; reason?: string } {
    // Check specific color requirements
    if ((cost.white || 0) > pool.white) {
      return { canPay: false, reason: `Need ${cost.white} white mana, have ${pool.white}` };
    }
    if ((cost.blue || 0) > pool.blue) {
      return { canPay: false, reason: `Need ${cost.blue} blue mana, have ${pool.blue}` };
    }
    if ((cost.black || 0) > pool.black) {
      return { canPay: false, reason: `Need ${cost.black} black mana, have ${pool.black}` };
    }
    if ((cost.red || 0) > pool.red) {
      return { canPay: false, reason: `Need ${cost.red} red mana, have ${pool.red}` };
    }
    if ((cost.green || 0) > pool.green) {
      return { canPay: false, reason: `Need ${cost.green} green mana, have ${pool.green}` };
    }
    if ((cost.colorless || 0) > pool.colorless) {
      return { canPay: false, reason: `Need ${cost.colorless} colorless mana, have ${pool.colorless}` };
    }
    
    // Calculate remaining mana after paying colored costs
    const remaining = {
      white: pool.white - (cost.white || 0),
      blue: pool.blue - (cost.blue || 0),
      black: pool.black - (cost.black || 0),
      red: pool.red - (cost.red || 0),
      green: pool.green - (cost.green || 0),
      colorless: pool.colorless - (cost.colorless || 0),
    };
    
    const totalRemaining = remaining.white + remaining.blue + remaining.black + 
                          remaining.red + remaining.green + remaining.colorless;
    
    if ((cost.generic || 0) > totalRemaining) {
      return { canPay: false, reason: `Need ${cost.generic} more mana for generic cost, have ${totalRemaining} remaining` };
    }
    
    return { canPay: true };
  }
  
  /**
   * Validate attacker declaration
   */
  private validateAttackerDeclaration(state: GameState, action: any): ActionValidation {
    // Check if it's the declare attackers step
    if (state.step !== SharedGameStep.DECLARE_ATTACKERS) {
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
    if (state.step !== SharedGameStep.DECLARE_BLOCKERS) {
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
    
    // Create action context for modular handlers
    const actionContext = {
      getState: (gid: string) => this.gameStates.get(gid),
      setState: (gid: string, state: GameState) => this.gameStates.set(gid, state),
      emit: (event: RulesEvent) => this.emit(event),
      gameId,
    };
    
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
        result = executeDeclareAttackers(gameId, action, actionContext);
        break;
      case 'declareBlockers':
        result = executeDeclareBlockers(gameId, action, actionContext);
        break;
      case 'resolveStack':
        result = this.resolveStackTop(gameId);
        break;
      case 'advanceTurn':
      case 'advanceGame':
        result = advanceGame(gameId, actionContext);
        break;
      case 'sacrifice':
        result = executeSacrifice(gameId, action, actionContext);
        break;
      case 'searchLibrary':
        result = executeSearchLibrary(gameId, action, actionContext);
        break;
      case 'payLife':
        result = this.payLifeAction(gameId, action);
        break;
      case 'activateFetchland':
        result = executeFetchland(gameId, action, actionContext);
        break;
      case 'dealCombatDamage':
        result = executeCombatDamage(gameId, action, actionContext);
        break;
      case 'initializeGame':
        result = initializeGame(gameId, action.players, actionContext);
        break;
      case 'drawInitialHand':
        result = drawInitialHand(gameId, action.playerId, action.handSize || 7, actionContext);
        break;
      case 'mulligan':
        result = processMulligan(gameId, action.playerId, action.keep, actionContext);
        break;
      case 'completeMulligan':
        result = completeMulliganPhase(gameId, actionContext);
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
    const manaCost = action.manaCost ? this.parseManaCostString(action.manaCost) : {};
    const context: SpellCastingContext = {
      spellId: action.cardId,
      cardName: action.cardName || 'Unknown Card',
      controllerId: action.playerId,
      manaCost,
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
      // Convert Record to Map for commanderDamage if it exists
      const commanderDamageMap = player.commanderDamage 
        ? new Map(Object.entries(player.commanderDamage))
        : undefined;
        
      const lossCheck: PlayerLossCheck = {
        playerId: player.id,
        lifeTotal: player.life,
        poisonCounters: player.counters?.poison || 0,
        librarySize: player.library?.length || 0,
        commanderDamage: commanderDamageMap,
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
    
    // Apply creature death from lethal damage or zero toughness (Rule 704.5f, 704.5g)
    const creatureDeathResult = this.checkCreatureDeaths(currentState, gameId);
    if (creatureDeathResult.deaths.length > 0) {
      currentState = creatureDeathResult.state;
      logs.push(...creatureDeathResult.logs);
    }
    
    // Apply planeswalker death from zero loyalty (Rule 704.5i)
    const planeswalkerDeathResult = this.checkPlaneswalkerDeaths(currentState, gameId);
    if (planeswalkerDeathResult.deaths.length > 0) {
      currentState = planeswalkerDeathResult.state;
      logs.push(...planeswalkerDeathResult.logs);
    }
    
    // Check legend rule (Rule 704.5j)
    const legendResult = this.checkLegendRule(currentState, gameId);
    if (legendResult.sacrificed.length > 0) {
      currentState = legendResult.state;
      logs.push(...legendResult.logs);
    }
    
    // Check for auras attached to illegal permanents (Rule 704.5m)
    const auraResult = this.checkAuraAttachment(currentState, gameId);
    if (auraResult.detached.length > 0) {
      currentState = auraResult.state;
      logs.push(...auraResult.logs);
    }
    
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
  
  /**
   * Pay life as a cost
   */
  private payLifeAction(gameId: string, action: any): EngineResult<GameState> {
    const state = this.gameStates.get(gameId)!;
    const player = state.players.find(p => p.id === action.playerId);
    
    if (!player) {
      return { next: state, log: ['Player not found'] };
    }
    
    const amount = action.amount || 1;
    const newLife = (player.life || 0) - amount;
    
    const updatedPlayers = state.players.map(p =>
      p.id === action.playerId
        ? { ...p, life: newLife }
        : p
    );
    
    const nextState: GameState = {
      ...state,
      players: updatedPlayers,
    };
    
    this.emit({
      type: RulesEngineEvent.LIFE_PAID,
      timestamp: Date.now(),
      gameId,
      data: { playerId: action.playerId, amount, newLife },
    });
    
    return {
      next: nextState,
      log: [`${action.playerId} paid ${amount} life`],
    };
  }
  
  /**
   * Check for creatures with lethal damage or zero toughness (Rule 704.5f, 704.5g)
   */
  private checkCreatureDeaths(
    state: GameState,
    gameId: string
  ): { state: GameState; deaths: string[]; logs: string[] } {
    const deaths: string[] = [];
    const logs: string[] = [];
    let updatedState = state;
    
    // Check all battlefields
    const allPermanents: any[] = [];
    
    // Collect from global battlefield (centralized in state.battlefield)
    if (state.battlefield) {
      allPermanents.push(...(state.battlefield as any[]));
    }
    
    for (const perm of allPermanents) {
      const typeLine = (perm.card?.type_line || perm.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      // Calculate effective toughness
      let toughness = parseInt(perm.card?.toughness || perm.toughness || '0', 10);
      const plusCounters = perm.counters?.['+1/+1'] || 0;
      const minusCounters = perm.counters?.['-1/-1'] || 0;
      const damageMarked = perm.counters?.damage || perm.damage || 0;
      
      toughness += plusCounters - minusCounters;
      
      // Check for zero or less toughness (Rule 704.5f)
      if (toughness <= 0) {
        deaths.push(perm.id);
        logs.push(`${perm.card?.name || 'Creature'} dies (0 or less toughness)`);
        updatedState = this.moveToGraveyard(updatedState, perm);
        
        this.emit({
          type: RulesEngineEvent.CREATURE_DIED,
          timestamp: Date.now(),
          gameId,
          data: { 
            permanentId: perm.id, 
            name: perm.card?.name,
            reason: 'zero_toughness',
          },
        });
        continue;
      }
      
      // Check for lethal damage (Rule 704.5g)
      if (damageMarked >= toughness) {
        deaths.push(perm.id);
        logs.push(`${perm.card?.name || 'Creature'} dies (lethal damage)`);
        updatedState = this.moveToGraveyard(updatedState, perm);
        
        this.emit({
          type: RulesEngineEvent.CREATURE_DIED,
          timestamp: Date.now(),
          gameId,
          data: { 
            permanentId: perm.id, 
            name: perm.card?.name,
            reason: 'lethal_damage',
          },
        });
      }
    }
    
    return { state: updatedState, deaths, logs };
  }
  
  /**
   * Check for planeswalkers with zero loyalty (Rule 704.5i)
   */
  private checkPlaneswalkerDeaths(
    state: GameState,
    gameId: string
  ): { state: GameState; deaths: string[]; logs: string[] } {
    const deaths: string[] = [];
    const logs: string[] = [];
    let updatedState = state;
    
    const allPermanents: any[] = [];
    
    // Collect from global battlefield (centralized in state.battlefield)
    if (state.battlefield) {
      allPermanents.push(...(state.battlefield as any[]));
    }
    
    for (const perm of allPermanents) {
      const typeLine = (perm.card?.type_line || perm.type_line || '').toLowerCase();
      if (!typeLine.includes('planeswalker')) continue;
      
      const loyalty = perm.counters?.loyalty || perm.loyalty || 0;
      
      if (loyalty <= 0) {
        deaths.push(perm.id);
        logs.push(`${perm.card?.name || 'Planeswalker'} dies (0 loyalty)`);
        updatedState = this.moveToGraveyard(updatedState, perm);
        
        this.emit({
          type: RulesEngineEvent.PERMANENT_LEFT_BATTLEFIELD,
          timestamp: Date.now(),
          gameId,
          data: { 
            permanentId: perm.id, 
            name: perm.card?.name,
            reason: 'zero_loyalty',
          },
        });
      }
    }
    
    return { state: updatedState, deaths, logs };
  }
  
  /**
   * Check legend rule (Rule 704.5j)
   */
  private checkLegendRule(
    state: GameState,
    gameId: string
  ): { state: GameState; sacrificed: string[]; logs: string[] } {
    const sacrificed: string[] = [];
    const logs: string[] = [];
    let updatedState = state;
    
    // Group legends by controller and name
    const legendsByControllerAndName = new Map<string, any[]>();
    
    // Check for legendary permanents controlled by each player
    const battlefield = state.battlefield || [];
    for (const player of state.players) {
      // Filter battlefield by controller
      const playerPerms = battlefield.filter((p: any) => p.controller === player.id);
      for (const perm of playerPerms) {
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        const superTypes = typeLine.split('—')[0];
        
        if (superTypes.includes('legendary')) {
          const name = perm.card?.name || 'Unknown';
          const key = `${player.id}:${name}`;
          
          const existing = legendsByControllerAndName.get(key) || [];
          existing.push(perm);
          legendsByControllerAndName.set(key, existing);
        }
      }
    }
    
    // Check for duplicates
    const entries = Array.from(legendsByControllerAndName.entries());
    for (const [key, legends] of entries) {
      if (legends.length > 1) {
        // Player must choose one to keep (for now, keep the newest/last one)
        const toSacrifice = legends.slice(0, -1);
        
        for (const perm of toSacrifice) {
          sacrificed.push(perm.id);
          logs.push(`${perm.card?.name || 'Legendary'} put into graveyard (legend rule)`);
          updatedState = this.moveToGraveyard(updatedState, perm);
          
          this.emit({
            type: RulesEngineEvent.PERMANENT_LEFT_BATTLEFIELD,
            timestamp: Date.now(),
            gameId,
            data: { 
              permanentId: perm.id, 
              name: perm.card?.name,
              reason: 'legend_rule',
            },
          });
        }
      }
    }
    
    return { state: updatedState, sacrificed, logs };
  }
  
  /**
   * Check for auras attached to illegal permanents (Rule 704.5m)
   */
  private checkAuraAttachment(
    state: GameState,
    gameId: string
  ): { state: GameState; detached: string[]; logs: string[] } {
    const detached: string[] = [];
    const logs: string[] = [];
    let updatedState = state;
    
    const allPermanents: any[] = [];
    
    // Collect from global battlefield (centralized in state.battlefield)
    if (state.battlefield) {
      allPermanents.push(...(state.battlefield as any[]));
    }
    
    for (const perm of allPermanents) {
      const typeLine = (perm.card?.type_line || perm.type_line || '').toLowerCase();
      if (!typeLine.includes('aura')) continue;
      
      const attachedToId = perm.attachedTo || perm.enchanting;
      if (!attachedToId) {
        // Aura not attached to anything - put in graveyard
        detached.push(perm.id);
        logs.push(`${perm.card?.name || 'Aura'} put into graveyard (not attached)`);
        updatedState = this.moveToGraveyard(updatedState, perm);
        continue;
      }
      
      // Check if the attached permanent still exists
      const attachedTo = allPermanents.find(p => p.id === attachedToId) ||
                        state.players.find(p => p.id === attachedToId);
      
      if (!attachedTo) {
        detached.push(perm.id);
        logs.push(`${perm.card?.name || 'Aura'} put into graveyard (attached permanent no longer exists)`);
        updatedState = this.moveToGraveyard(updatedState, perm);
      }
    }
    
    return { state: updatedState, detached, logs };
  }
  
  /**
   * Move a permanent to its owner's graveyard
   */
  private moveToGraveyard(state: GameState, permanent: any): GameState {
    const ownerId = permanent.controller || permanent.controllerId || permanent.owner;
    
    // Remove from battlefield
    const updatedBattlefield = (state.battlefield || []).filter(
      (p: any) => p.id !== permanent.id
    );
    
    // Update player graveyards
    const updatedPlayers = state.players.map(player => {
      if (player.id === ownerId) {
        return {
          ...player,
          graveyard: [...(player.graveyard || []), permanent.card || permanent],
        };
      }
      
      return player;
    });
    
    return {
      ...state,
      battlefield: updatedBattlefield,
      players: updatedPlayers,
    };
  }
}

/**
 * Singleton instance
 */
export const rulesEngine = new RulesEngineAdapter();
