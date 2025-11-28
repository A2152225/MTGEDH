/**
 * GameAutomationController.ts
 * 
 * High-level controller that orchestrates the automated game loop.
 * This is the main integration point between:
 * - AutomationService (handles automatic game actions)
 * - DecisionManager (tracks pending player decisions)
 * - RulesEngineAdapter (validates and executes game actions)
 * 
 * The controller implements an MTG Online-style game loop where:
 * 1. Automatic actions are processed without player input
 * 2. Game pauses when player decisions are needed
 * 3. Decisions are validated and processed when received
 * 4. Automation resumes after all decisions are resolved
 */

import type { GameState, PlayerID, BattlefieldPermanent, StackItem } from '../../shared/src';
import {
  runAutomation,
  AutomationResult,
  PendingDecision,
  DecisionType,
  calculateCombatDamage,
  applyCombatDamage,
  autoTapForMana,
  hasAvailableActions,
  requiresDecisionToResolve,
  processTriggeredAbilities,
} from './AutomationService';
import {
  DecisionManager,
  DecisionResponse,
  decisionManager,
} from './DecisionManager';
import { RulesEngineAdapter, rulesEngine } from './RulesEngineAdapter';
import { RulesEngineEvent } from './core/events';

/**
 * Game automation status
 */
export enum GameAutomationStatus {
  RUNNING = 'running',           // Automation is processing
  WAITING_FOR_DECISION = 'waiting_for_decision', // Paused for player input
  WAITING_FOR_PRIORITY = 'waiting_for_priority', // Player has priority and can act
  PAUSED = 'paused',             // Manually paused
  COMPLETED = 'completed',       // Game has ended
}

/**
 * Configuration for game automation
 */
export interface AutomationConfig {
  /** Enable auto-pass when no actions available */
  autoPassPriority: boolean;
  
  /** Enable auto-tap for mana payment */
  autoTapMana: boolean;
  
  /** Enable auto-order for triggers (use APNAP) */
  autoOrderTriggers: boolean;
  
  /** Enable auto-yield to known spells */
  autoYield: boolean;
  
  /** Timeout for decisions in ms (0 = no timeout) */
  decisionTimeoutMs: number;
  
  /** Enable stops at specific phases */
  stops: {
    upkeep?: boolean;
    draw?: boolean;
    main1?: boolean;
    combat?: boolean;
    main2?: boolean;
    end?: boolean;
  };
  
  /** Players who have enabled auto-pass for current phase */
  autoPassPlayers: Set<PlayerID>;
}

/**
 * Default automation configuration
 */
export const defaultAutomationConfig: AutomationConfig = {
  autoPassPriority: false,
  autoTapMana: true,
  autoOrderTriggers: true,
  autoYield: false,
  decisionTimeoutMs: 0,
  stops: {},
  autoPassPlayers: new Set(),
};

/**
 * Result of an automation step
 */
export interface AutomationStepResult {
  state: GameState;
  status: GameAutomationStatus;
  pendingDecisions: PendingDecision[];
  log: string[];
  priorityPlayer?: PlayerID;
  winner?: PlayerID;
}

/**
 * Game event for automation
 */
export interface GameEvent {
  type: string;
  data: any;
  timestamp: number;
}

/**
 * Controller for managing automated gameplay
 */
export class GameAutomationController {
  private configs: Map<string, AutomationConfig> = new Map();
  private statuses: Map<string, GameAutomationStatus> = new Map();
  private eventQueues: Map<string, GameEvent[]> = new Map();
  private priorityPassCounts: Map<string, number> = new Map();
  
  constructor(
    private rulesEngine: RulesEngineAdapter = rulesEngine,
    private decisionMgr: DecisionManager = decisionManager
  ) {
    // Listen for rules engine events
    this.setupEventListeners();
  }
  
  /**
   * Initialize automation for a game
   */
  initGame(gameId: string, config: Partial<AutomationConfig> = {}): void {
    this.configs.set(gameId, {
      ...defaultAutomationConfig,
      ...config,
      autoPassPlayers: new Set(config.autoPassPlayers || []),
    });
    this.statuses.set(gameId, GameAutomationStatus.RUNNING);
    this.eventQueues.set(gameId, []);
    this.priorityPassCounts.set(gameId, 0);
    this.decisionMgr.initGame(gameId);
  }
  
  /**
   * Get current automation status
   */
  getStatus(gameId: string): GameAutomationStatus {
    return this.statuses.get(gameId) || GameAutomationStatus.RUNNING;
  }
  
  /**
   * Get automation configuration
   */
  getConfig(gameId: string): AutomationConfig {
    return this.configs.get(gameId) || defaultAutomationConfig;
  }
  
  /**
   * Update automation configuration
   */
  updateConfig(gameId: string, updates: Partial<AutomationConfig>): void {
    const current = this.getConfig(gameId);
    this.configs.set(gameId, { ...current, ...updates });
  }
  
  /**
   * Main automation step - processes game state and returns next state
   */
  step(gameId: string, state: GameState): AutomationStepResult {
    const config = this.getConfig(gameId);
    const status = this.getStatus(gameId);
    const log: string[] = [];
    
    // Check if game has ended
    if (state.winner || this.isGameOver(state)) {
      return {
        state,
        status: GameAutomationStatus.COMPLETED,
        pendingDecisions: [],
        log: ['Game has ended'],
        winner: state.winner as PlayerID,
      };
    }
    
    // Check for pending decisions
    const pendingDecisions = this.decisionMgr.getAllDecisions(gameId);
    if (pendingDecisions.length > 0) {
      return {
        state,
        status: GameAutomationStatus.WAITING_FOR_DECISION,
        pendingDecisions,
        log: ['Waiting for player decisions'],
      };
    }
    
    // Process event queue (triggers, etc.)
    const eventResult = this.processEventQueue(gameId, state);
    state = eventResult.state;
    log.push(...eventResult.log);
    
    if (eventResult.pendingDecisions.length > 0) {
      this.decisionMgr.addDecisions(gameId, eventResult.pendingDecisions);
      return {
        state,
        status: GameAutomationStatus.WAITING_FOR_DECISION,
        pendingDecisions: eventResult.pendingDecisions,
        log,
      };
    }
    
    // Run automation (state-based actions, auto-untap, auto-draw, etc.)
    const automationResult = runAutomation({
      gameId,
      state,
      emit: (event) => this.queueEvent(gameId, event),
    });
    
    state = automationResult.state;
    log.push(...automationResult.log);
    
    if (automationResult.pendingDecisions.length > 0) {
      this.decisionMgr.addDecisions(gameId, automationResult.pendingDecisions);
      return {
        state,
        status: GameAutomationStatus.WAITING_FOR_DECISION,
        pendingDecisions: automationResult.pendingDecisions,
        log,
      };
    }
    
    // Check stack for resolvable items
    if (state.stack && state.stack.length > 0) {
      const stackResult = this.processStack(gameId, state);
      state = stackResult.state;
      log.push(...stackResult.log);
      
      if (stackResult.pendingDecisions.length > 0) {
        this.decisionMgr.addDecisions(gameId, stackResult.pendingDecisions);
        return {
          state,
          status: GameAutomationStatus.WAITING_FOR_DECISION,
          pendingDecisions: stackResult.pendingDecisions,
          log,
        };
      }
    }
    
    // Determine priority player
    const priorityPlayer = this.getPriorityPlayer(state);
    
    // Check if priority player should auto-pass
    if (config.autoPassPriority || config.autoPassPlayers.has(priorityPlayer)) {
      if (!hasAvailableActions(state, priorityPlayer)) {
        // Auto-pass priority
        const passResult = this.passPriority(gameId, state, priorityPlayer);
        state = passResult.state;
        log.push(...passResult.log);
        
        if (passResult.advancedPhase) {
          return this.step(gameId, state); // Continue automation
        }
      }
    }
    
    // Return waiting for priority
    return {
      state,
      status: GameAutomationStatus.WAITING_FOR_PRIORITY,
      pendingDecisions: [],
      log,
      priorityPlayer,
    };
  }
  
  /**
   * Process a player action (cast spell, activate ability, etc.)
   */
  processAction(
    gameId: string,
    state: GameState,
    action: any
  ): AutomationStepResult {
    const log: string[] = [];
    
    // Validate action
    const validation = this.rulesEngine.validateAction(gameId, action);
    if (!validation.legal) {
      return {
        state,
        status: this.getStatus(gameId),
        pendingDecisions: this.decisionMgr.getAllDecisions(gameId),
        log: [`Action rejected: ${validation.reason}`],
      };
    }
    
    // Execute action
    const result = this.rulesEngine.executeAction(gameId, action);
    state = result.next;
    log.push(...(result.log || []));
    
    // Reset priority pass count (action taken)
    this.priorityPassCounts.set(gameId, 0);
    
    // Continue automation after action
    return this.step(gameId, state);
  }
  
  /**
   * Process a decision response
   */
  processDecision(
    gameId: string,
    state: GameState,
    response: DecisionResponse
  ): AutomationStepResult {
    const log: string[] = [];
    
    // Validate and process decision
    const result = this.decisionMgr.processResponse(gameId, response, state);
    
    if (!result.result.valid) {
      return {
        state,
        status: GameAutomationStatus.WAITING_FOR_DECISION,
        pendingDecisions: this.decisionMgr.getAllDecisions(gameId),
        log: [`Invalid decision: ${result.result.error}`],
      };
    }
    
    // Apply decision to game state
    const decision = result.decision!;
    const applyResult = this.applyDecision(gameId, state, decision, result.result.processedSelection);
    state = applyResult.state;
    log.push(...applyResult.log);
    
    // Continue automation
    return this.step(gameId, state);
  }
  
  /**
   * Apply a processed decision to game state
   */
  private applyDecision(
    gameId: string,
    state: GameState,
    decision: PendingDecision,
    selection: any
  ): { state: GameState; log: string[] } {
    const log: string[] = [];
    
    switch (decision.type) {
      case DecisionType.SELECT_TARGETS: {
        // Update the stack item with targets
        if (decision.sourceId && state.stack) {
          const updatedStack = state.stack.map(item => {
            if (item.id === decision.sourceId) {
              return { ...item, targets: selection };
            }
            return item;
          });
          state = { ...state, stack: updatedStack };
          log.push(`Targets selected for ${decision.sourceName}`);
        }
        break;
      }
      
      case DecisionType.SELECT_MODE:
      case DecisionType.SELECT_MODES: {
        // Store selected modes on stack item
        if (decision.sourceId && state.stack) {
          const updatedStack = state.stack.map((item: any) => {
            if (item.id === decision.sourceId) {
              return { ...item, modes: selection };
            }
            return item;
          });
          state = { ...state, stack: updatedStack };
          log.push(`Mode(s) selected for ${decision.sourceName}`);
        }
        break;
      }
      
      case DecisionType.SELECT_X_VALUE: {
        // Store X value on stack item
        if (decision.sourceId && state.stack) {
          const updatedStack = state.stack.map((item: any) => {
            if (item.id === decision.sourceId) {
              return { ...item, xValue: selection };
            }
            return item;
          });
          state = { ...state, stack: updatedStack };
          log.push(`X=${selection} for ${decision.sourceName}`);
        }
        break;
      }
      
      case DecisionType.SELECT_ATTACKERS: {
        // Apply attacker declarations
        const attackers = selection as Array<{ attackerId: string; defendingPlayer: string }>;
        let updatedBattlefield = state.battlefield || [];
        
        for (const { attackerId, defendingPlayer } of attackers) {
          updatedBattlefield = updatedBattlefield.map((perm: BattlefieldPermanent) => {
            if (perm.id === attackerId) {
              return { ...perm, attacking: defendingPlayer, tapped: true };
            }
            return perm;
          });
        }
        
        state = { ...state, battlefield: updatedBattlefield };
        log.push(`${attackers.length} creature(s) declared as attackers`);
        break;
      }
      
      case DecisionType.SELECT_BLOCKERS: {
        // Apply blocker declarations
        const blockers = selection as Array<{ blockerId: string; attackerId: string }>;
        let updatedBattlefield = state.battlefield || [];
        
        for (const { blockerId, attackerId } of blockers) {
          updatedBattlefield = updatedBattlefield.map((perm: BattlefieldPermanent) => {
            if (perm.id === blockerId) {
              return { ...perm, blocking: [attackerId] };
            }
            if (perm.id === attackerId) {
              const existingBlockers = perm.blockedBy || [];
              return { ...perm, blockedBy: [...existingBlockers, blockerId] };
            }
            return perm;
          });
        }
        
        state = { ...state, battlefield: updatedBattlefield };
        log.push(`${blockers.length} creature(s) declared as blockers`);
        break;
      }
      
      case DecisionType.ORDER_BLOCKERS: {
        // Store blocker order for damage assignment
        if (decision.sourceId) {
          const updatedBattlefield = (state.battlefield || []).map((perm: BattlefieldPermanent) => {
            if (perm.id === decision.sourceId) {
              return { ...perm, blockedBy: selection };
            }
            return perm;
          });
          state = { ...state, battlefield: updatedBattlefield };
          log.push(`Blocker order set for ${decision.sourceName}`);
        }
        break;
      }
      
      case DecisionType.ORDER_TRIGGERS: {
        // Reorder triggers on stack
        const orderedIds = selection as string[];
        const currentStack = state.stack || [];
        
        // Get the triggers being ordered
        const triggersToReorder = currentStack.filter(item => orderedIds.includes(item.id));
        const otherItems = currentStack.filter(item => !orderedIds.includes(item.id));
        
        // Sort triggers according to order
        const orderedTriggers = orderedIds.map(id => triggersToReorder.find(t => t.id === id)!).filter(Boolean);
        
        state = { ...state, stack: [...otherItems, ...orderedTriggers] };
        log.push('Triggers ordered on stack');
        break;
      }
      
      case DecisionType.SELECT_CARDS: {
        // Handle card selection (e.g., discard)
        const selectedCards = selection as string[];
        const player = state.players.find(p => p.id === decision.playerId);
        
        if (player) {
          const hand = (player as any).hand || [];
          const graveyard = (player as any).graveyard || [];
          
          const discarded = hand.filter((c: any) => selectedCards.includes(c.id || c));
          const remainingHand = hand.filter((c: any) => !selectedCards.includes(c.id || c));
          
          const updatedPlayers = state.players.map(p => {
            if (p.id === decision.playerId) {
              return {
                ...p,
                hand: remainingHand,
                graveyard: [...graveyard, ...discarded],
              };
            }
            return p;
          });
          
          state = { ...state, players: updatedPlayers };
          log.push(`${selectedCards.length} card(s) discarded`);
        }
        break;
      }
      
      case DecisionType.MAY_ABILITY: {
        if (!selection) {
          log.push(`${decision.sourceName}: chose not to use ability`);
        } else {
          // Ability will resolve normally
          log.push(`${decision.sourceName}: chose to use ability`);
        }
        break;
      }
      
      case DecisionType.MULLIGAN_DECISION: {
        if (selection) {
          log.push(`Player keeps hand`);
        } else {
          // Need to handle mulligan - shuffle and draw new hand
          log.push(`Player takes mulligan`);
        }
        break;
      }
      
      case DecisionType.MULLIGAN_BOTTOM: {
        // Put selected cards on bottom of library
        const cardIds = selection as string[];
        const player = state.players.find(p => p.id === decision.playerId);
        
        if (player) {
          const hand = (player as any).hand || [];
          const library = (player as any).library || [];
          
          const toBottom = hand.filter((c: any) => cardIds.includes(c.id || c));
          const remainingHand = hand.filter((c: any) => !cardIds.includes(c.id || c));
          
          const updatedPlayers = state.players.map(p => {
            if (p.id === decision.playerId) {
              return {
                ...p,
                hand: remainingHand,
                library: [...library, ...toBottom],
              };
            }
            return p;
          });
          
          state = { ...state, players: updatedPlayers };
          log.push(`${cardIds.length} card(s) put on bottom of library`);
        }
        break;
      }
    }
    
    return { state, log };
  }
  
  /**
   * Pass priority for a player
   */
  passPriority(
    gameId: string,
    state: GameState,
    playerId: PlayerID
  ): { state: GameState; log: string[]; advancedPhase: boolean } {
    const log: string[] = [];
    let advancedPhase = false;
    
    // Increment pass count
    const passCount = (this.priorityPassCounts.get(gameId) || 0) + 1;
    this.priorityPassCounts.set(gameId, passCount);
    
    // Check if all players have passed
    const playerCount = state.players.filter(p => !p.hasLost && !p.eliminated).length;
    
    if (passCount >= playerCount) {
      // All players passed - resolve stack or advance phase
      this.priorityPassCounts.set(gameId, 0);
      
      if (state.stack && state.stack.length > 0) {
        // Resolve top of stack
        const resolveResult = this.rulesEngine.executeAction(gameId, {
          type: 'resolveStack',
        });
        state = resolveResult.next;
        log.push(...(resolveResult.log || []));
        // Priority goes back to active player after resolution
      } else {
        // Advance to next phase/step
        const advanceResult = this.rulesEngine.executeAction(gameId, {
          type: 'advanceGame',
        });
        state = advanceResult.next;
        log.push(...(advanceResult.log || []));
        advancedPhase = true;
      }
    } else {
      // Pass to next player
      const nextPriorityIndex = ((state.priorityPlayerIndex || 0) + 1) % state.players.length;
      state = { ...state, priorityPlayerIndex: nextPriorityIndex };
      log.push(`Priority passed to ${state.players[nextPriorityIndex]?.name}`);
    }
    
    return { state, log, advancedPhase };
  }
  
  /**
   * Process the stack (check for resolvable items)
   */
  private processStack(
    gameId: string,
    state: GameState
  ): { state: GameState; log: string[]; pendingDecisions: PendingDecision[] } {
    const log: string[] = [];
    const pendingDecisions: PendingDecision[] = [];
    
    if (!state.stack || state.stack.length === 0) {
      return { state, log, pendingDecisions };
    }
    
    // Check top of stack for pending decisions
    const topItem = state.stack[state.stack.length - 1];
    const decisionCheck = requiresDecisionToResolve(topItem, state);
    
    if (decisionCheck.requires) {
      pendingDecisions.push(...decisionCheck.decisions);
    }
    
    return { state, log, pendingDecisions };
  }
  
  /**
   * Process event queue (triggers, etc.)
   */
  private processEventQueue(
    gameId: string,
    state: GameState
  ): { state: GameState; log: string[]; pendingDecisions: PendingDecision[] } {
    const log: string[] = [];
    const pendingDecisions: PendingDecision[] = [];
    const events = this.eventQueues.get(gameId) || [];
    
    if (events.length === 0) {
      return { state, log, pendingDecisions };
    }
    
    // Process each event
    for (const event of events) {
      const triggerResult = processTriggeredAbilities(state, event);
      state = triggerResult.state;
      pendingDecisions.push(...triggerResult.pendingDecisions);
      
      if (triggerResult.triggersProcessed > 0) {
        log.push(`${triggerResult.triggersProcessed} trigger(s) added to stack`);
      }
    }
    
    // Clear processed events
    this.eventQueues.set(gameId, []);
    
    return { state, log, pendingDecisions };
  }
  
  /**
   * Queue an event for processing
   */
  private queueEvent(gameId: string, event: any): void {
    const queue = this.eventQueues.get(gameId) || [];
    queue.push({
      type: event.type,
      data: event.data,
      timestamp: Date.now(),
    });
    this.eventQueues.set(gameId, queue);
  }
  
  /**
   * Get the current priority player
   */
  private getPriorityPlayer(state: GameState): PlayerID {
    const priorityIndex = state.priorityPlayerIndex ?? state.activePlayerIndex ?? 0;
    return state.players[priorityIndex]?.id || state.players[0]?.id;
  }
  
  /**
   * Check if game is over
   */
  private isGameOver(state: GameState): boolean {
    const activePlayers = state.players.filter(p => !p.hasLost && !p.eliminated);
    return activePlayers.length <= 1;
  }
  
  /**
   * Setup event listeners for rules engine events
   */
  private setupEventListeners(): void {
    // Listen for events that might trigger abilities
    const triggerEvents = [
      RulesEngineEvent.SPELL_RESOLVED,
      RulesEngineEvent.CREATURE_DIED,
      RulesEngineEvent.PERMANENT_TAPPED,
      RulesEngineEvent.LIFE_GAINED,
      RulesEngineEvent.LIFE_LOST,
    ];
    
    for (const eventType of triggerEvents) {
      this.rulesEngine.on(eventType, (event) => {
        if (event.gameId) {
          this.queueEvent(event.gameId, event);
        }
      });
    }
  }
  
  /**
   * Cleanup when game ends
   */
  cleanup(gameId: string): void {
    this.configs.delete(gameId);
    this.statuses.delete(gameId);
    this.eventQueues.delete(gameId);
    this.priorityPassCounts.delete(gameId);
    this.decisionMgr.clearGame(gameId);
  }
  
  /**
   * Set a stop at a specific phase for a player
   */
  setStop(gameId: string, phase: string, enabled: boolean): void {
    const config = this.getConfig(gameId);
    const stops = { ...config.stops, [phase]: enabled };
    this.updateConfig(gameId, { stops });
  }
  
  /**
   * Enable auto-pass for a player
   */
  setAutoPass(gameId: string, playerId: PlayerID, enabled: boolean): void {
    const config = this.getConfig(gameId);
    const autoPassPlayers = new Set(config.autoPassPlayers);
    if (enabled) {
      autoPassPlayers.add(playerId);
    } else {
      autoPassPlayers.delete(playerId);
    }
    this.updateConfig(gameId, { autoPassPlayers });
  }
}

/**
 * Singleton instance
 */
export const gameAutomationController = new GameAutomationController();

export default GameAutomationController;
