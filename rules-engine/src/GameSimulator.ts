/**
 * GameSimulator.ts
 * 
 * Full-game simulation framework that runs complete MTG games from mulligan
 * to win condition. Supports:
 * - AI vs AI, AI vs Human, Human vs Human gameplay
 * - Reproducible simulations with RNG seeding
 * - Batch simulation for statistical analysis
 * - Headless mode for bulk testing
 * - Full turn structure (untap, upkeep, draw, main, combat, end step, cleanup)
 */

import type { GameState, PlayerID, SeatIndex, BattlefieldPermanent } from '../../shared/src';
import { RulesEngineAdapter, RulesEngineEvent, type RulesEvent } from './RulesEngineAdapter';
import { AIEngine, AIStrategy, AIPlayerConfig, AIDecisionType, type AIDecisionContext } from './AIEngine';
import { 
  checkPlayerLife, 
  checkPoisonCounters, 
  checkCommanderDamage,
  StateBasedActionType 
} from './stateBasedActions';
import { 
  detectWinEffect, 
  playerHasCantLoseEffect,
  checkEmptyLibraryDrawWin,
} from './winEffectCards';
import { parseTriggeredAbilitiesFromText, TriggerEvent } from './triggeredAbilities';

/**
 * Player type in simulation
 */
export enum PlayerType {
  AI = 'ai',
  HUMAN = 'human',
}

/**
 * Card data interface for simulation
 * All fields optional to be flexible with different card data sources
 */
export interface CardData {
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  id?: string;
  loyalty?: string;
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
  readonly commander?: string; // Commander card name
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
  readonly cardDatabase?: Map<string, CardData>; // Card data for simulation
}

/**
 * Internal player state for simulation
 */
interface SimPlayerState {
  id: PlayerID;
  name: string;
  life: number;
  commander?: string;
  commanderInCommandZone: boolean;
  commanderTax: number;
  library: string[];
  hand: string[];
  battlefield: SimPermanent[];
  graveyard: string[];
  exile: string[];
  manaPool: { white: number; blue: number; black: number; red: number; green: number; colorless: number };
  landsPlayedThisTurn: number;
  poisonCounters: number;
  cardsDrawnThisTurn: number;
  commanderDamage: Record<string, number>;
  hasLost: boolean;
}

/**
 * Permanent state in simulation
 */
interface SimPermanent {
  id: string;
  card: string;
  tapped: boolean;
  summoningSickness: boolean;
  power: number;
  toughness: number;
  counters: Record<string, number>;
  damage: number;
  isToken?: boolean;
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
  readonly eliminations: EliminationRecord[];
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
 * Elimination record
 */
interface EliminationRecord {
  playerId: PlayerID;
  playerName: string;
  turn: number;
  reason: string;
  killerPlayerId?: PlayerID;
  killerCard?: string;
  damageType?: string;
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
  private rng: () => number = Math.random;
  private cardDatabase: Map<string, CardData> = new Map();
  private eliminations: EliminationRecord[] = [];
  private playerStats: Map<PlayerID, { damageDealt: number; spellsCast: number; cardsDrawn: number; landsPlayed: number }> = new Map();
  
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
   * Initialize seeded RNG for reproducible simulations
   */
  private initRng(seed?: number): void {
    if (seed !== undefined) {
      // Simple seeded RNG using mulberry32 algorithm
      let a = seed;
      this.rng = () => {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    } else {
      this.rng = Math.random;
    }
  }
  
  /**
   * Shuffle an array using Fisher-Yates algorithm with seeded RNG
   */
  private shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  
  /**
   * Get card data from database
   */
  private getCard(cardName: string): CardData | undefined {
    return this.cardDatabase.get(cardName);
  }
  
  /**
   * Check if a card is a land
   */
  private isLand(cardName: string): boolean {
    const card = this.getCard(cardName);
    return card?.type_line?.toLowerCase().includes('land') || false;
  }
  
  /**
   * Check if a card is a creature
   */
  private isCreature(cardName: string): boolean {
    const card = this.getCard(cardName);
    return card?.type_line?.toLowerCase().includes('creature') || false;
  }
  
  /**
   * Get CMC of a card
   */
  private getCMC(cardName: string): number {
    const card = this.getCard(cardName);
    return card?.cmc || 0;
  }
  
  /**
   * Run a single simulation
   */
  async runSimulation(config: SimulationConfig): Promise<SimulationResult> {
    const startTime = Date.now();
    this.eventLog = [];
    this.eliminations = [];
    this.playerStats.clear();
    this.running = true;
    
    // Initialize seeded RNG
    this.initRng(config.rngSeed);
    
    // Use provided card database or empty
    this.cardDatabase = config.cardDatabase || new Map();
    
    if (config.verbose) {
      console.log(`[Simulator] Starting game ${config.gameId}`);
    }
    
    // Initialize simulation state
    const simState = this.createSimulationState(config);
    
    // Initialize game state for rules engine
    const initialState = this.createInitialGameState(config, simState);
    this.rulesEngine.initializeGame(config.gameId, initialState);
    
    // Initialize stats tracking
    for (const player of config.players) {
      this.playerStats.set(player.id, { damageDealt: 0, spellsCast: 0, cardsDrawn: 0, landsPlayed: 0 });
    }
    
    // Register AI players
    for (const player of config.players) {
      if (player.type === PlayerType.AI) {
        this.aiEngine.registerAI({
          playerId: player.id,
          strategy: player.aiStrategy || AIStrategy.BASIC,
          difficulty: 0.5,
          thinkTime: config.headless ? 0 : 100,
        });
      }
    }
    
    // Draw initial hands
    for (const playerId of Object.keys(simState.players)) {
      const player = simState.players[playerId];
      this.drawCards(player, 7);
    }
    
    // Run mulligan phase
    await this.runMulliganPhase(config, simState);
    
    // Run main game loop
    let turnCount = 0;
    let actionCount = 0;
    const maxTurns = config.maxTurns || 100;
    
    while (this.running && turnCount < maxTurns) {
      const result = await this.runTurn(config, simState);
      actionCount += result.actions;
      turnCount++;
      
      // Check for game end
      const alivePlayers = Object.values(simState.players).filter(p => !p.hasLost);
      if (alivePlayers.length <= 1) {
        break;
      }
    }
    
    const endTime = Date.now();
    
    // Determine winner
    const alivePlayers = Object.values(simState.players).filter(p => !p.hasLost);
    let winner: PlayerID | null = null;
    let reason = 'Max turns reached';
    
    if (alivePlayers.length === 1) {
      winner = alivePlayers[0].id;
      reason = 'Last player standing';
    } else if (alivePlayers.length === 0) {
      reason = 'All players eliminated';
    } else if (turnCount >= maxTurns) {
      // Find player with highest life
      const sorted = [...alivePlayers].sort((a, b) => b.life - a.life);
      if (sorted[0].life > sorted[1]?.life) {
        winner = sorted[0].id;
        reason = `Highest life total (${sorted[0].life}) at turn limit`;
      }
    }
    
    if (config.verbose) {
      console.log(`[Simulator] Game ${config.gameId} ended: ${reason}`);
      console.log(`[Simulator] Total turns: ${turnCount}, actions: ${actionCount}`);
    }
    
    // Build final state for rules engine compatibility
    const finalState = this.rulesEngine['gameStates'].get(config.gameId) || initialState;
    
    // Calculate final statistics
    const playerStatsMap = this.calculatePlayerStats(simState);
    
    return {
      gameId: config.gameId,
      winner,
      reason,
      totalTurns: turnCount,
      totalActions: actionCount,
      duration: endTime - startTime,
      events: this.eventLog,
      finalState,
      playerStats: playerStatsMap,
      eliminations: this.eliminations,
    };
  }
  
  /**
   * Create internal simulation state
   */
  private createSimulationState(config: SimulationConfig): { players: Record<string, SimPlayerState>; turn: number; activePlayerIndex: number } {
    const players: Record<string, SimPlayerState> = {};
    
    for (let i = 0; i < config.players.length; i++) {
      const p = config.players[i];
      const deckCards = p.commander 
        ? p.deckList.filter(c => c !== p.commander)
        : [...p.deckList];
      
      players[p.id] = {
        id: p.id,
        name: p.name,
        life: config.startingLife,
        commander: p.commander,
        commanderInCommandZone: !!p.commander,
        commanderTax: 0,
        library: this.shuffle(deckCards),
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        landsPlayedThisTurn: 0,
        poisonCounters: 0,
        cardsDrawnThisTurn: 0,
        commanderDamage: {},
        hasLost: false,
      };
    }
    
    return { players, turn: 0, activePlayerIndex: 0 };
  }
  
  /**
   * Create initial game state from configuration
   */
  private createInitialGameState(config: SimulationConfig, simState: { players: Record<string, SimPlayerState> }): GameState {
    const players = config.players.map((p, index) => ({
      id: p.id,
      name: p.name,
      seat: index as SeatIndex,
      life: config.startingLife,
      hand: [],
      library: [],
      graveyard: [],
      battlefield: [],
      exile: [],
      commandZone: [],
      counters: {},
      hasLost: false,
    }));
    
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
      life,
      turnPlayer: players[0]?.id || '',
      priority: players[0]?.id || '',
      battlefield: [],
      commandZone: {},
      active: true,
    };
  }
  
  /**
   * Draw cards for a player
   */
  private drawCards(player: SimPlayerState, count: number): string[] {
    const drawn: string[] = [];
    for (let i = 0; i < count; i++) {
      if (player.library.length === 0) {
        // Cannot draw from empty library
        break;
      }
      const card = player.library.shift()!;
      player.hand.push(card);
      drawn.push(card);
      player.cardsDrawnThisTurn++;
      
      const stats = this.playerStats.get(player.id);
      if (stats) stats.cardsDrawn++;
    }
    return drawn;
  }
  
  /**
   * Run mulligan phase for all players
   */
  private async runMulliganPhase(config: SimulationConfig, simState: { players: Record<string, SimPlayerState> }): Promise<void> {
    if (config.verbose) {
      console.log('[Simulator] Starting mulligan phase');
    }
    
    for (const player of config.players) {
      const simPlayer = simState.players[player.id];
      let mulliganCount = 0;
      let keepHand = false;
      
      while (!keepHand && mulliganCount < 7) {
        if (player.type === PlayerType.AI) {
          // AI mulligan decision: keep if 2-5 lands
          const landCount = simPlayer.hand.filter(c => this.isLand(c)).length;
          keepHand = landCount >= 2 && landCount <= 5;
          
          if (config.verbose) {
            console.log(`[Simulator] ${player.name} (AI): ${keepHand ? 'keep' : 'mulligan'} (${landCount} lands)`);
          }
        } else {
          keepHand = true;
          if (config.verbose) {
            console.log(`[Simulator] ${player.name} (Human): kept hand`);
          }
        }
        
        if (!keepHand) {
          // Mulligan: shuffle hand back and draw new hand
          simPlayer.library = this.shuffle([...simPlayer.library, ...simPlayer.hand]);
          simPlayer.hand = [];
          mulliganCount++;
          this.drawCards(simPlayer, 7 - mulliganCount);
        }
      }
    }
  }
  
  /**
   * Run a single turn with full turn structure
   */
  private async runTurn(config: SimulationConfig, simState: { players: Record<string, SimPlayerState>; turn: number; activePlayerIndex: number }): Promise<{ actions: number }> {
    simState.turn++;
    const playerIds = Object.keys(simState.players);
    simState.activePlayerIndex = (simState.activePlayerIndex) % playerIds.length;
    const activePlayerId = playerIds[simState.activePlayerIndex];
    const player = simState.players[activePlayerId];
    
    if (!player || player.hasLost) {
      simState.activePlayerIndex++;
      return { actions: 0 };
    }
    
    let actions = 0;
    
    if (config.verbose) {
      console.log(`[Simulator] Turn ${simState.turn}: ${player.name}'s turn (Life: ${player.life})`);
    }
    
    // === UNTAP STEP ===
    this.untapAll(player);
    player.landsPlayedThisTurn = 0;
    player.cardsDrawnThisTurn = 0;
    
    // === UPKEEP STEP ===
    this.handleUpkeepTriggers(player, simState);
    
    // === DRAW STEP ===
    // Skip draw on first turn for first player
    if (simState.turn > playerIds.length || simState.activePlayerIndex !== 0) {
      if (player.library.length > 0) {
        this.drawCards(player, 1);
        actions++;
      } else {
        // Cannot draw from empty library - player loses
        this.eliminatePlayer(player, simState.turn, 'Attempted to draw from empty library', config.verbose);
      }
    }
    
    // Check if player was eliminated
    if (player.hasLost) {
      simState.activePlayerIndex++;
      return { actions };
    }
    
    // === PRE-COMBAT MAIN PHASE ===
    const mainActions = await this.runMainPhase(config, player, simState);
    actions += mainActions;
    
    // === COMBAT PHASE ===
    // Skip combat on early turns (each player should have at least 2 turns)
    if (simState.turn > playerIds.length * 2) {
      const combatActions = await this.runCombatPhase(config, player, simState);
      actions += combatActions;
    }
    
    // Check state-based actions after combat
    this.checkStateBasedActions(simState, config.verbose);
    
    // === POST-COMBAT MAIN PHASE ===
    // AI might cast more spells
    const postCombatActions = await this.runMainPhase(config, player, simState);
    actions += postCombatActions;
    
    // === END STEP ===
    this.handleEndStepTriggers(player, simState);
    
    // === CLEANUP STEP ===
    // Discard to hand size
    while (player.hand.length > 7) {
      // Discard worst card
      const discarded = player.hand.pop()!;
      player.graveyard.push(discarded);
    }
    
    // Clear damage from creatures
    for (const perm of player.battlefield) {
      perm.damage = 0;
    }
    
    // Empty mana pool
    player.manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    
    // Remove summoning sickness
    for (const perm of player.battlefield) {
      perm.summoningSickness = false;
    }
    
    // Advance to next player
    simState.activePlayerIndex++;
    
    return { actions };
  }
  
  /**
   * Untap all permanents for a player
   */
  private untapAll(player: SimPlayerState): void {
    for (const perm of player.battlefield) {
      perm.tapped = false;
    }
  }
  
  /**
   * Handle upkeep triggers
   */
  private handleUpkeepTriggers(player: SimPlayerState, simState: { players: Record<string, SimPlayerState>; turn: number }): void {
    // Check for upkeep draw effects (e.g., Phyrexian Arena)
    for (const perm of player.battlefield) {
      const card = this.getCard(perm.card);
      const oracle = card?.oracle_text?.toLowerCase() || '';
      
      // Phyrexian Arena: "At the beginning of your upkeep, draw a card and lose 1 life"
      if (oracle.includes('beginning of your upkeep') && oracle.includes('draw a card')) {
        this.drawCards(player, 1);
        
        // Check for life loss
        const lifeMatch = oracle.match(/lose (\d+) life/);
        if (lifeMatch) {
          player.life -= parseInt(lifeMatch[1], 10);
        }
      }
    }
  }
  
  /**
   * Handle end step triggers
   */
  private handleEndStepTriggers(player: SimPlayerState, simState: { players: Record<string, SimPlayerState>; turn: number }): void {
    for (const perm of player.battlefield) {
      const card = this.getCard(perm.card);
      const oracle = card?.oracle_text?.toLowerCase() || '';
      
      // Check for end step draw effects
      if (oracle.includes('beginning of your end step') && oracle.includes('draw a card')) {
        this.drawCards(player, 1);
      }
    }
  }
  
  /**
   * Run main phase - play lands and cast spells
   */
  private async runMainPhase(config: SimulationConfig, player: SimPlayerState, simState: { players: Record<string, SimPlayerState>; turn: number }): Promise<number> {
    let actions = 0;
    
    // Play a land if possible
    if (player.landsPlayedThisTurn < 1) {
      const lands = player.hand.filter(c => this.isLand(c));
      if (lands.length > 0) {
        const land = lands[0];
        const idx = player.hand.indexOf(land);
        player.hand.splice(idx, 1);
        
        player.battlefield.push({
          id: `perm-${Date.now()}-${this.rng()}`,
          card: land,
          tapped: false,
          summoningSickness: false,
          power: 0,
          toughness: 0,
          counters: {},
          damage: 0,
        });
        
        player.landsPlayedThisTurn++;
        actions++;
        
        const stats = this.playerStats.get(player.id);
        if (stats) stats.landsPlayed++;
        
        if (config.verbose) {
          console.log(`[Simulator] ${player.name} played ${land}`);
        }
      }
    }
    
    // Calculate available mana
    const availableMana = this.calculateAvailableMana(player);
    
    // Try to cast spells
    const castableSpells = player.hand.filter(c => {
      if (this.isLand(c)) return false;
      const cmc = this.getCMC(c);
      return cmc <= availableMana;
    });
    
    // Sort by CMC (highest first to use mana efficiently)
    castableSpells.sort((a, b) => this.getCMC(b) - this.getCMC(a));
    
    for (const spell of castableSpells) {
      const cmc = this.getCMC(spell);
      if (cmc <= this.calculateAvailableMana(player)) {
        // Cast the spell
        const idx = player.hand.indexOf(spell);
        if (idx >= 0) {
          player.hand.splice(idx, 1);
          
          // Tap lands for mana
          this.tapLandsForMana(player, cmc);
          
          const card = this.getCard(spell);
          const typeLine = card?.type_line?.toLowerCase() || '';
          
          if (typeLine.includes('creature') || typeLine.includes('artifact') || 
              typeLine.includes('enchantment') || typeLine.includes('planeswalker')) {
            // Put permanent on battlefield
            player.battlefield.push({
              id: `perm-${Date.now()}-${this.rng()}`,
              card: spell,
              tapped: false,
              summoningSickness: typeLine.includes('creature'),
              power: parseInt(card?.power || '0', 10),
              toughness: parseInt(card?.toughness || '0', 10),
              counters: {},
              damage: 0,
            });
            
            const stats = this.playerStats.get(player.id);
            if (stats) stats.spellsCast++;
            
            if (config.verbose) {
              console.log(`[Simulator] ${player.name} cast ${spell}`);
            }
          } else {
            // Instant/Sorcery - goes to graveyard
            player.graveyard.push(spell);
            
            const stats = this.playerStats.get(player.id);
            if (stats) stats.spellsCast++;
            
            if (config.verbose) {
              console.log(`[Simulator] ${player.name} cast ${spell}`);
            }
          }
          
          actions++;
        }
      }
    }
    
    return actions;
  }
  
  /**
   * Calculate available mana from untapped lands
   */
  private calculateAvailableMana(player: SimPlayerState): number {
    let mana = 0;
    for (const perm of player.battlefield) {
      if (!perm.tapped && this.isLand(perm.card)) {
        mana++;
      }
    }
    return mana;
  }
  
  /**
   * Tap lands to pay mana cost
   */
  private tapLandsForMana(player: SimPlayerState, amount: number): void {
    let remaining = amount;
    for (const perm of player.battlefield) {
      if (remaining <= 0) break;
      if (!perm.tapped && this.isLand(perm.card)) {
        perm.tapped = true;
        remaining--;
      }
    }
  }
  
  /**
   * Run combat phase
   */
  private async runCombatPhase(config: SimulationConfig, player: SimPlayerState, simState: { players: Record<string, SimPlayerState>; turn: number }): Promise<number> {
    let actions = 0;
    
    // Get creatures that can attack
    const attackers = player.battlefield.filter(perm => {
      if (perm.tapped) return false;
      if (perm.summoningSickness) return false;
      
      const card = this.getCard(perm.card);
      const typeLine = card?.type_line?.toLowerCase() || '';
      const oracle = card?.oracle_text?.toLowerCase() || '';
      
      if (!typeLine.includes('creature')) return false;
      if (oracle.includes('defender')) return false;
      
      return true;
    });
    
    if (attackers.length === 0) return actions;
    
    // Find opponent with highest life
    const opponents = Object.values(simState.players).filter(p => 
      p.id !== player.id && !p.hasLost
    );
    
    if (opponents.length === 0) return actions;
    
    // Sort by highest life
    opponents.sort((a, b) => b.life - a.life);
    const defender = opponents[0];
    
    // Attack with all creatures
    let totalDamage = 0;
    const attackerNames: string[] = [];
    
    for (const attacker of attackers) {
      attacker.tapped = true;
      totalDamage += attacker.power;
      attackerNames.push(attacker.card);
      
      // Track commander damage
      if (attacker.card === player.commander) {
        const commanderKey = `${player.id}-${player.commander}`;
        defender.commanderDamage[commanderKey] = (defender.commanderDamage[commanderKey] || 0) + attacker.power;
      }
    }
    
    // Deal damage to defender
    defender.life -= totalDamage;
    
    const stats = this.playerStats.get(player.id);
    if (stats) stats.damageDealt += totalDamage;
    
    if (config.verbose && totalDamage > 0) {
      console.log(`[Simulator] ${player.name} attacked ${defender.name} for ${totalDamage} damage (${defender.life} life remaining)`);
    }
    
    actions++;
    
    return actions;
  }
  
  /**
   * Check state-based actions for all players
   */
  private checkStateBasedActions(simState: { players: Record<string, SimPlayerState>; turn: number }, verbose?: boolean): void {
    for (const player of Object.values(simState.players)) {
      if (player.hasLost) continue;
      
      // Check life total (Rule 704.5a)
      if (player.life <= 0) {
        this.eliminatePlayer(player, simState.turn, `Life total reduced to ${player.life}`, verbose);
        continue;
      }
      
      // Check poison counters (Rule 704.5c)
      if (player.poisonCounters >= 10) {
        this.eliminatePlayer(player, simState.turn, `Received ${player.poisonCounters} poison counters`, verbose);
        continue;
      }
      
      // Check commander damage (Rule 704.6c)
      for (const [cmdKey, damage] of Object.entries(player.commanderDamage)) {
        if (damage >= 21) {
          const commanderName = cmdKey.substring(cmdKey.indexOf('-') + 1);
          this.eliminatePlayer(player, simState.turn, `Received ${damage} commander damage from ${commanderName}`, verbose);
          break;
        }
      }
    }
  }
  
  /**
   * Eliminate a player from the game
   */
  private eliminatePlayer(player: SimPlayerState, turn: number, reason: string, verbose?: boolean): void {
    player.hasLost = true;
    player.life = 0;
    
    this.eliminations.push({
      playerId: player.id,
      playerName: player.name,
      turn,
      reason,
    });
    
    if (verbose) {
      console.log(`[Simulator] ${player.name} eliminated: ${reason}`);
    }
  }
  
  /**
   * Calculate player statistics from simulation state
   */
  private calculatePlayerStats(simState: { players: Record<string, SimPlayerState> }): Map<PlayerID, PlayerStats> {
    const stats = new Map<PlayerID, PlayerStats>();
    
    for (const player of Object.values(simState.players)) {
      const tracked = this.playerStats.get(player.id) || { damageDealt: 0, spellsCast: 0, cardsDrawn: 0, landsPlayed: 0 };
      
      stats.set(player.id, {
        playerId: player.id,
        finalLife: player.life,
        damageDealt: tracked.damageDealt,
        spellsCast: tracked.spellsCast,
        creaturesPlayed: player.battlefield.filter(p => this.isCreature(p.card)).length,
        cardsDrawn: tracked.cardsDrawn,
        landsPlayed: tracked.landsPlayed,
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
      const simConfig: SimulationConfig = {
        ...config.config,
        gameId: `${config.config.gameId}_${i}`,
        rngSeed: config.config.rngSeed ? config.config.rngSeed + i : undefined,
        verbose: false,
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
    for (const entry of Array.from(winRates.entries())) {
      const [playerId, wins] = entry;
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
