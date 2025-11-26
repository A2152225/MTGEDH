/**
 * GameSimulator.ts
 * 
 * Full-game simulation framework that runs complete MTG games from mulligan
 * to win condition. Supports:
 * - AI vs AI, AI vs Human, Human vs Human gameplay
 * - Reproducible simulations with RNG seeding
 * - Batch simulation for statistical analysis
 * - Headless mode for bulk testing
 */

import type { GameState, PlayerID, SeatIndex } from '../../shared/src';
import { RulesEngineAdapter, RulesEngineEvent, type RulesEvent } from './RulesEngineAdapter';
import { AIEngine, AIStrategy, AIPlayerConfig, AIDecisionType, type AIDecisionContext } from './AIEngine';

/**
 * Player type in simulation
 */
export enum PlayerType {
  AI = 'ai',
  HUMAN = 'human',
}

/**
 * Simulation player configuration
 */
export interface SimulationPlayer {
  readonly id: PlayerID;
  readonly name: string;
  readonly type: PlayerType;
  readonly aiStrategy?: AIStrategy;
  readonly deckList: string[]; // Card names
}

/**
 * Simulation configuration
 */
export interface SimulationConfig {
  readonly gameId: string;
  readonly players: SimulationPlayer[];
  readonly format: 'commander' | 'standard' | 'modern';
  readonly startingLife: number;
  readonly maxTurns?: number; // Stop after this many turns to prevent infinite loops
  readonly rngSeed?: number; // For reproducible simulations
  readonly verbose?: boolean; // Log detailed actions
  readonly headless?: boolean; // Run without UI
}

/**
 * Simulation result
 */
export interface SimulationResult {
  readonly gameId: string;
  readonly winner: PlayerID | null;
  readonly reason: string;
  readonly totalTurns: number;
  readonly totalActions: number;
  readonly duration: number; // milliseconds
  readonly events: RulesEvent[];
  readonly finalState: GameState;
  readonly playerStats: Map<PlayerID, PlayerStats>;
}

/**
 * Player statistics from a simulation
 */
export interface PlayerStats {
  readonly playerId: PlayerID;
  readonly finalLife: number;
  readonly damageDealt: number;
  readonly spellsCast: number;
  readonly creaturesPlayed: number;
  readonly cardsDrawn: number;
  readonly landsPlayed: number;
}

/**
 * Batch simulation configuration
 */
export interface BatchSimulationConfig {
  readonly config: SimulationConfig;
  readonly iterations: number;
  readonly parallelism?: number; // How many games to run in parallel
}

/**
 * Batch simulation results
 */
export interface BatchSimulationResults {
  readonly iterations: number;
  readonly results: SimulationResult[];
  readonly winRates: Map<PlayerID, number>;
  readonly averageTurns: number;
  readonly averageDuration: number;
}

/**
 * Game Simulator - Runs complete games from start to finish
 */
export class GameSimulator {
  private rulesEngine: RulesEngineAdapter;
  private aiEngine: AIEngine;
  private eventLog: RulesEvent[] = [];
  private running: boolean = false;
  
  constructor() {
    this.rulesEngine = new RulesEngineAdapter();
    this.aiEngine = new AIEngine();
    
    // Listen to all rules engine events for logging
    Object.values(RulesEngineEvent).forEach(eventType => {
      this.rulesEngine.on(eventType as RulesEngineEvent, (event) => {
        this.eventLog.push(event);
      });
    });
  }
  
  /**
   * Run a single simulation
   */
  async runSimulation(config: SimulationConfig): Promise<SimulationResult> {
    const startTime = Date.now();
    this.eventLog = [];
    this.running = true;
    
    if (config.verbose) {
      console.log(`[Simulator] Starting game ${config.gameId}`);
    }
    
    // Initialize game state
    const initialState = this.createInitialGameState(config);
    this.rulesEngine.initializeGame(config.gameId, initialState);
    
    // Register AI players
    for (const player of config.players) {
      if (player.type === PlayerType.AI) {
        this.aiEngine.registerAI({
          playerId: player.id,
          strategy: player.aiStrategy || AIStrategy.BASIC,
          difficulty: 0.5,
          thinkTime: config.headless ? 0 : 100, // No delay in headless mode
        });
      }
    }
    
    // Run mulligan phase
    await this.runMulliganPhase(config);
    
    // Run main game loop
    let turnCount = 0;
    let actionCount = 0;
    const maxTurns = config.maxTurns || 100; // Default max 100 turns
    
    while (this.running && turnCount < maxTurns) {
      const result = await this.runTurn(config);
      actionCount += result.actions;
      turnCount++;
      
      // Check for game end
      const currentState = this.rulesEngine['gameStates'].get(config.gameId);
      if (currentState && currentState.status === 'finished') {
        break;
      }
    }
    
    const endTime = Date.now();
    const finalState = this.rulesEngine['gameStates'].get(config.gameId)!;
    
    // Calculate statistics
    const playerStats = this.calculatePlayerStats(finalState);
    
    // Determine winner and reason
    const winner = finalState.winner || null;
    const reason = winner 
      ? `${winner} won the game`
      : turnCount >= maxTurns
        ? 'Max turns reached'
        : 'Game ended without winner';
    
    if (config.verbose) {
      console.log(`[Simulator] Game ${config.gameId} ended: ${reason}`);
      console.log(`[Simulator] Total turns: ${turnCount}, actions: ${actionCount}`);
    }
    
    return {
      gameId: config.gameId,
      winner,
      reason,
      totalTurns: turnCount,
      totalActions: actionCount,
      duration: endTime - startTime,
      events: this.eventLog,
      finalState,
      playerStats,
    };
  }
  
  /**
   * Create initial game state from configuration
   */
  private createInitialGameState(config: SimulationConfig): GameState {
    const players = config.players.map((p, index) => ({
      id: p.id,
      name: p.name,
      seat: index as SeatIndex, // Required by PlayerRef
      life: config.startingLife,
      hand: [],
      library: [], // Will be populated with deck
      graveyard: [],
      battlefield: [],
      exile: [],
      commandZone: [],
      counters: {},
      hasLost: false,
    }));
    
    // Create life totals map
    const life: Record<string, number> = {};
    for (const p of players) {
      life[p.id] = config.startingLife;
    }
    
    return {
      id: config.gameId,
      format: config.format as any,
      players,
      turnOrder: players.map(p => p.id),
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      turn: 0,
      phase: 'beginning' as any,
      step: 'untap' as any,
      stack: [],
      startingLife: config.startingLife,
      allowUndos: false,
      turnTimerEnabled: false,
      turnTimerSeconds: 0,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
      spectators: [],
      status: 'inProgress' as any,
      // Required GameState properties
      life,
      turnPlayer: players[0]?.id || '',
      priority: players[0]?.id || '',
      battlefield: [],
      commandZone: {},
      active: true,
    };
  }
  
  /**
   * Run mulligan phase for all players
   */
  private async runMulliganPhase(config: SimulationConfig): Promise<void> {
    if (config.verbose) {
      console.log('[Simulator] Starting mulligan phase');
    }
    
    for (const player of config.players) {
      let mulliganCount = 0;
      let keepHand = false;
      
      while (!keepHand && mulliganCount < 7) {
        // Draw initial hand (7 cards minus mulligans)
        const handSize = 7;
        
        if (player.type === PlayerType.AI) {
          // AI makes mulligan decision
          const state = this.rulesEngine['gameStates'].get(config.gameId)!;
          const context: AIDecisionContext = {
            gameState: state,
            playerId: player.id,
            decisionType: AIDecisionType.MULLIGAN,
            options: [true, false],
          };
          
          const decision = await this.aiEngine.makeDecision(context);
          keepHand = decision.action.keep;
          
          if (config.verbose) {
            console.log(`[Simulator] ${player.name} (AI): ${keepHand ? 'keep' : 'mulligan'} (${decision.reasoning})`);
          }
        } else {
          // Human player - for simulation, assume they keep
          keepHand = true;
          if (config.verbose) {
            console.log(`[Simulator] ${player.name} (Human): kept hand`);
          }
        }
        
        if (!keepHand) {
          mulliganCount++;
        }
      }
      
      this.rulesEngine.processMulligan(config.gameId, player.id, true);
    }
  }
  
  /**
   * Run a single turn
   */
  private async runTurn(config: SimulationConfig): Promise<{ actions: number }> {
    const state = this.rulesEngine['gameStates'].get(config.gameId)!;
    const activePlayer = state.players[state.activePlayerIndex];
    let actions = 0;
    
    if (config.verbose) {
      console.log(`[Simulator] Turn ${state.turn + 1}: ${activePlayer.name}'s turn`);
    }
    
    // Simplified turn structure - just track actions
    // In full implementation, this would go through all phases and steps
    
    // Check if active player is AI
    if (this.aiEngine.isAI(activePlayer.id)) {
      // AI takes its turn
      const turnActions = await this.runAITurn(config, activePlayer.id);
      actions += turnActions;
    } else {
      // Human turn - for simulation, just pass
      if (config.verbose) {
        console.log(`[Simulator] ${activePlayer.name} (Human) - skipping turn in simulation`);
      }
      actions = 1;
    }
    
    // Advance to next turn
    const nextPlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
    this.rulesEngine['gameStates'].set(config.gameId, {
      ...state,
      turn: state.turn + 1,
      activePlayerIndex: nextPlayerIndex,
      priorityPlayerIndex: nextPlayerIndex,
    });
    
    // Check state-based actions
    this.rulesEngine.checkStateBasedActions(config.gameId, state);
    
    return { actions };
  }
  
  /**
   * Run AI turn with decision making
   */
  private async runAITurn(config: SimulationConfig, playerId: PlayerID): Promise<number> {
    let actions = 0;
    const state = this.rulesEngine['gameStates'].get(config.gameId)!;
    
    // Simplified: AI just decides whether to attack
    const context: AIDecisionContext = {
      gameState: state,
      playerId,
      decisionType: AIDecisionType.DECLARE_ATTACKERS,
      options: [],
    };
    
    const decision = await this.aiEngine.makeDecision(context);
    
    if (decision.action.attackers && decision.action.attackers.length > 0) {
      this.rulesEngine.executeAction(config.gameId, {
        type: 'declareAttackers',
        playerId,
        attackers: decision.action.attackers,
      });
      actions++;
      
      if (config.verbose) {
        console.log(`[Simulator] ${playerId} attacks with ${decision.action.attackers.length} creatures`);
      }
    }
    
    return actions;
  }
  
  /**
   * Calculate player statistics from final state
   */
  private calculatePlayerStats(state: GameState): Map<PlayerID, PlayerStats> {
    const stats = new Map<PlayerID, PlayerStats>();
    
    for (const player of state.players) {
      stats.set(player.id, {
        playerId: player.id,
        finalLife: player.life,
        damageDealt: 0, // TODO: Track during simulation
        spellsCast: 0,
        creaturesPlayed: player.battlefield?.filter(c => c.types?.includes('Creature')).length || 0,
        cardsDrawn: 0,
        landsPlayed: player.battlefield?.filter(c => c.types?.includes('Land')).length || 0,
      });
    }
    
    return stats;
  }
  
  /**
   * Run batch simulations
   */
  async runBatchSimulation(config: BatchSimulationConfig): Promise<BatchSimulationResults> {
    console.log(`[Simulator] Running ${config.iterations} simulations...`);
    const results: SimulationResult[] = [];
    
    for (let i = 0; i < config.iterations; i++) {
      // Create unique game ID for each simulation
      const simConfig: SimulationConfig = {
        ...config.config,
        gameId: `${config.config.gameId}_${i}`,
        rngSeed: config.config.rngSeed ? config.config.rngSeed + i : undefined,
        verbose: false, // Disable verbose for batch runs
      };
      
      const result = await this.runSimulation(simConfig);
      results.push(result);
      
      if ((i + 1) % 10 === 0) {
        console.log(`[Simulator] Completed ${i + 1}/${config.iterations} simulations`);
      }
    }
    
    // Calculate aggregate statistics
    const winRates = new Map<PlayerID, number>();
    let totalTurns = 0;
    let totalDuration = 0;
    
    for (const result of results) {
      if (result.winner) {
        winRates.set(result.winner, (winRates.get(result.winner) || 0) + 1);
      }
      totalTurns += result.totalTurns;
      totalDuration += result.duration;
    }
    
    // Convert win counts to percentages
    for (const [playerId, wins] of winRates.entries()) {
      winRates.set(playerId, (wins / config.iterations) * 100);
    }
    
    console.log('[Simulator] Batch simulation complete!');
    console.log(`[Simulator] Win rates:`, Object.fromEntries(winRates));
    console.log(`[Simulator] Average turns: ${(totalTurns / config.iterations).toFixed(1)}`);
    console.log(`[Simulator] Average duration: ${(totalDuration / config.iterations).toFixed(0)}ms`);
    
    return {
      iterations: config.iterations,
      results,
      winRates,
      averageTurns: totalTurns / config.iterations,
      averageDuration: totalDuration / config.iterations,
    };
  }
  
  /**
   * Stop current simulation
   */
  stop(): void {
    this.running = false;
  }
  
  /**
   * Get event log
   */
  getEventLog(): RulesEvent[] {
    return this.eventLog;
  }
}

/**
 * Singleton simulator instance
 */
export const gameSimulator = new GameSimulator();
