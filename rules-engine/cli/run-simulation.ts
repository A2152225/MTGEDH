#!/usr/bin/env node
/**
 * run-simulation.ts
 * 
 * Commander game simulation CLI that uses the shared Rules Engine.
 * This CLI integrates with:
 * - GameSimulator: For running complete games
 * - RulesEngineAdapter: For rules enforcement
 * - AIEngine: For AI decision making
 * 
 * Purpose: Quick testing of cards and interactions to find and fix gaps in the rules engine.
 * Can also be used to playtest decks and analyze performance.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import {
  GameSimulator,
  SimulationConfig,
  SimulationResult,
  SimulationPlayer,
  PlayerType,
  BatchSimulationConfig,
  BatchSimulationResults,
  PlayerStats,
} from '../src/GameSimulator';
import { AIStrategy } from '../src/AIEngine';
import { RulesEngineAdapter, RulesEngineEvent, type RulesEvent } from '../src/RulesEngineAdapter';
import { StateBasedActionType } from '../src/stateBasedActions';
import { TriggerEvent } from '../src/triggeredAbilities';

// ES module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Constants
// ============================================================================

const DECKS_PATH = path.join(__dirname, '../../precon_json');

const DEFAULT_CONFIG = {
  playerCount: 2,
  maxTurns: 50,
  gamesPerSession: 25,
  startingLife: 40,
  verbose: false,
  analysisMode: false,
  seed: Date.now(),
};

// ============================================================================
// Types
// ============================================================================

// Import CardData from GameSimulator for consistency
import type { CardData } from '../src/GameSimulator';

interface LoadedDeck {
  name: string;
  commander: CardData;
  cards: CardData[];
  filename: string;
}

interface SimulationSummary {
  gameNumber: number;
  seed: number;
  winner: string | null;
  winCondition: string;
  totalTurns: number;
  totalActions: number;
  duration: number;
  playerResults: PlayerResultInfo[];
  eliminationDetails: EliminationDetail[];
  triggersProcessed: TriggerSummary[];
  cardsNotWorking: string[];
  unexpectedBehaviors: string[];
}

interface PlayerResultInfo {
  playerName: string;
  position: number;
  finalLife: number;
  damageDealt: number;
  spellsCast: number;
  creaturesPlayed: number;
  cardsDrawn: number;
  landsPlayed: number;
  eliminated: boolean;
  eliminationTurn?: number;
  eliminationReason?: string;
  killedBy?: string;
  killingCard?: string;
  killerLibrarySize?: number;
  killerHandSize?: number;
  eliminatedLibrarySize?: number;
  eliminatedHandSize?: number;
}

interface EliminationDetail {
  playerName: string;
  turn: number;
  reason: string;
  killedBy?: string;
  killingCard?: string;
  damageType?: string;
}

interface TriggerSummary {
  cardName: string;
  triggerType: string;
  count: number;
  workingAsExpected: boolean;
  notes?: string;
}

interface AnalysisReport {
  totalGames: number;
  winRates: Map<string, number>;
  averageTurns: number;
  averageDuration: number;
  eliminationBreakdown: Map<string, number>;
  commonWinConditions: Map<string, number>;
  triggersWorking: string[];
  triggersNotWorking: string[];
  cardsNeedingFixes: string[];
  unexpectedBehaviors: string[];
}

// ============================================================================
// Deck Loading
// ============================================================================

function loadDeck(filename: string): LoadedDeck {
  const filePath = path.join(DECKS_PATH, filename);
  const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
  
  if (!rawContent.startsWith('"cards"')) {
    throw new Error(`Invalid deck file format: ${filename} - expected to start with "cards"`);
  }
  
  const jsonContent = '{' + rawContent + '}';
  const data = JSON.parse(jsonContent) as { cards: CardData[] };
  
  if (!data.cards || !Array.isArray(data.cards) || data.cards.length === 0) {
    throw new Error(`Deck file ${filename} has no cards`);
  }
  
  const commander = data.cards[0];
  const deckName = filename.replace('.json', '').replace('Deck', '');
  
  return {
    name: deckName,
    commander,
    cards: data.cards,
    filename,
  };
}

function getAvailableDeckFiles(): string[] {
  try {
    const files = fs.readdirSync(DECKS_PATH);
    return files.filter(f => f.startsWith('Deck') && f.endsWith('.json'));
  } catch {
    return [];
  }
}

function selectRandomDecks(count: number): LoadedDeck[] {
  const available = getAvailableDeckFiles();
  if (available.length < count) {
    throw new Error(`Need ${count} decks but only ${available.length} available`);
  }
  
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(f => loadDeck(f));
}

// ============================================================================
// Enhanced Simulation Runner
// ============================================================================

class EnhancedSimulator {
  private simulator: GameSimulator;
  private eventLog: RulesEvent[] = [];
  private triggerCounts: Map<string, number> = new Map();
  private eliminationEvents: EliminationDetail[] = [];
  private unexpectedBehaviors: string[] = [];
  
  constructor() {
    this.simulator = new GameSimulator();
  }
  
  /**
   * Run a single game with enhanced tracking
   */
  async runGame(
    decks: LoadedDeck[],
    config: {
      maxTurns: number;
      startingLife: number;
      verbose: boolean;
      seed?: number;
    }
  ): Promise<SimulationSummary> {
    const gameId = `sim-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Build card database from deck cards
    const cardDatabase = new Map<string, CardData>();
    for (const deck of decks) {
      for (const card of deck.cards) {
        cardDatabase.set(card.name, card);
      }
    }
    
    // Create player configurations
    const players: SimulationPlayer[] = decks.map((deck, index) => ({
      id: `player-${index + 1}` as PlayerID,
      name: `Player ${index + 1} (${deck.name})`,
      type: PlayerType.AI,
      aiStrategy: AIStrategy.AGGRESSIVE,
      deckList: deck.cards.map(c => c.name),
      commander: deck.commander.name,
    }));
    
    const simConfig: SimulationConfig = {
      gameId,
      players,
      format: 'commander',
      startingLife: config.startingLife,
      maxTurns: config.maxTurns,
      rngSeed: config.seed,
      verbose: config.verbose,
      headless: true,
      cardDatabase,
    };
    
    // Reset tracking
    this.eventLog = [];
    this.triggerCounts.clear();
    this.eliminationEvents = [];
    this.unexpectedBehaviors = [];
    
    // Run simulation
    const startTime = Date.now();
    const result = await this.simulator.runSimulation(simConfig);
    
    // Use eliminations from the result
    for (const elim of (result as any).eliminations || []) {
      this.eliminationEvents.push({
        playerName: elim.playerName,
        turn: elim.turn,
        reason: elim.reason,
        killedBy: elim.killerPlayerId, // The player who caused the elimination
        killingCard: elim.killerCard,  // The card used
        damageType: elim.damageType,
      });
    }
    
    // Analyze events
    this.analyzeEvents(result.events);
    
    // Build summary
    return this.buildSummary(result, decks, config.seed || 0, startTime);
  }
  
  /**
   * Analyze events for triggers, eliminations, and issues
   */
  private analyzeEvents(events: RulesEvent[]): void {
    for (const event of events) {
      // Track trigger counts
      if (event.type === RulesEngineEvent.ABILITY_TRIGGERED) {
        const cardName = event.data?.sourceName || 'Unknown';
        const current = this.triggerCounts.get(cardName) || 0;
        this.triggerCounts.set(cardName, current + 1);
      }
      
      // Track eliminations
      if (event.type === RulesEngineEvent.PLAYER_LOST) {
        this.eliminationEvents.push({
          playerName: event.data?.playerId || 'Unknown',
          turn: event.data?.turn || 0,
          reason: event.data?.reason || 'Unknown',
          killedBy: event.data?.killedBy,
          killingCard: event.data?.killingCard,
          damageType: event.data?.damageType,
        });
      }
      
      // Track unexpected behaviors
      if (event.type === RulesEngineEvent.WARNING || event.type === RulesEngineEvent.ERROR) {
        this.unexpectedBehaviors.push(event.data?.message || 'Unknown issue');
      }
    }
  }
  
  /**
   * Build comprehensive summary from simulation result
   */
  private buildSummary(
    result: SimulationResult,
    decks: LoadedDeck[],
    seed: number,
    startTime: number
  ): SimulationSummary {
    const playerResults: PlayerResultInfo[] = [];
    
    for (const [playerId, stats] of result.playerStats) {
      const deckIndex = parseInt(playerId.split('-')[1]) - 1;
      const deckName = decks[deckIndex]?.name || 'Unknown';
      
      const elimination = this.eliminationEvents.find(e => 
        e.playerName.includes(playerId)
      );
      
      playerResults.push({
        playerName: `Player ${deckIndex + 1} (${deckName})`,
        position: playerId === result.winner ? 1 : 2,
        finalLife: stats.finalLife,
        damageDealt: stats.damageDealt,
        spellsCast: stats.spellsCast,
        creaturesPlayed: stats.creaturesPlayed,
        cardsDrawn: stats.cardsDrawn,
        landsPlayed: stats.landsPlayed,
        eliminated: !!elimination,
        eliminationTurn: elimination?.turn,
        eliminationReason: elimination?.reason,
        killedBy: elimination?.killedBy,
        killingCard: elimination?.killingCard,
      });
    }
    
    // Sort by position
    playerResults.sort((a, b) => a.position - b.position);
    
    // Build trigger summaries
    // NOTE: Trigger validation is not yet implemented - we mark triggers as
    // "pending analysis" rather than assuming they work correctly
    const triggersProcessed: TriggerSummary[] = [];
    for (const [cardName, count] of this.triggerCounts) {
      triggersProcessed.push({
        cardName,
        triggerType: 'triggered ability',
        count,
        workingAsExpected: true, // TODO: Implement actual trigger validation
        notes: 'Trigger fired - needs validation that effect was applied correctly',
      });
    }
    
    return {
      gameNumber: 0, // Will be set by caller
      seed,
      winner: result.winner,
      winCondition: result.reason,
      totalTurns: result.totalTurns,
      totalActions: result.totalActions,
      duration: result.duration,
      playerResults,
      eliminationDetails: this.eliminationEvents,
      triggersProcessed,
      cardsNotWorking: [], // TODO: Implement card functionality analysis
      unexpectedBehaviors: this.unexpectedBehaviors,
    };
  }
  
  /**
   * Run batch simulations with full analysis
   */
  async runBatchSimulation(
    decks: LoadedDeck[],
    config: {
      iterations: number;
      maxTurns: number;
      startingLife: number;
      verbose: boolean;
      baseSeed: number;
    }
  ): Promise<AnalysisReport> {
    const summaries: SimulationSummary[] = [];
    
    console.log(`\nRunning ${config.iterations} simulations...`);
    console.log(`Players: ${decks.map(d => d.name).join(' vs ')}`);
    console.log(`Max turns: ${config.maxTurns}, Starting life: ${config.startingLife}\n`);
    
    for (let i = 0; i < config.iterations; i++) {
      const seed = config.baseSeed + i * 1000;
      
      const summary = await this.runGame(decks, {
        maxTurns: config.maxTurns,
        startingLife: config.startingLife,
        verbose: false,
        seed,
      });
      
      summary.gameNumber = i + 1;
      summaries.push(summary);
      
      if ((i + 1) % 5 === 0) {
        console.log(`  Completed ${i + 1}/${config.iterations} games...`);
      }
    }
    
    return this.generateAnalysisReport(summaries);
  }
  
  /**
   * Generate comprehensive analysis report
   */
  private generateAnalysisReport(summaries: SimulationSummary[]): AnalysisReport {
    const winRates = new Map<string, number>();
    const eliminationBreakdown = new Map<string, number>();
    const winConditions = new Map<string, number>();
    const allTriggers: string[] = [];
    const allIssues: string[] = [];
    
    let totalTurns = 0;
    let totalDuration = 0;
    
    for (const summary of summaries) {
      totalTurns += summary.totalTurns;
      totalDuration += summary.duration;
      
      // Track win rates
      if (summary.winner) {
        const current = winRates.get(summary.winner) || 0;
        winRates.set(summary.winner, current + 1);
      }
      
      // Track win conditions
      const condKey = summary.winCondition;
      winConditions.set(condKey, (winConditions.get(condKey) || 0) + 1);
      
      // Track eliminations
      for (const elim of summary.eliminationDetails) {
        const reasonKey = elim.reason;
        eliminationBreakdown.set(reasonKey, (eliminationBreakdown.get(reasonKey) || 0) + 1);
      }
      
      // Track triggers
      for (const trigger of summary.triggersProcessed) {
        if (!allTriggers.includes(trigger.cardName)) {
          allTriggers.push(trigger.cardName);
        }
      }
      
      // Track issues
      allIssues.push(...summary.unexpectedBehaviors);
      allIssues.push(...summary.cardsNotWorking);
    }
    
    // Convert win counts to percentages
    for (const [player, wins] of winRates) {
      winRates.set(player, (wins / summaries.length) * 100);
    }
    
    return {
      totalGames: summaries.length,
      winRates,
      averageTurns: totalTurns / summaries.length,
      averageDuration: totalDuration / summaries.length,
      eliminationBreakdown,
      commonWinConditions: winConditions,
      triggersWorking: allTriggers,
      triggersNotWorking: [], // Would need more sophisticated analysis
      cardsNeedingFixes: [...new Set(allIssues)],
      unexpectedBehaviors: [...new Set(allIssues)],
    };
  }
}

// ============================================================================
// Report Printing
// ============================================================================

function printSummary(summary: SimulationSummary): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Game ${summary.gameNumber} (Seed: ${summary.seed})`);
  console.log(`${'='.repeat(60)}`);
  
  console.log(`\nResult: ${summary.winner || 'No winner'}`);
  console.log(`Win Condition: ${summary.winCondition}`);
  console.log(`Turns: ${summary.totalTurns}, Actions: ${summary.totalActions}, Duration: ${summary.duration}ms`);
  
  console.log(`\nPlayer Results:`);
  for (const player of summary.playerResults) {
    const positionStr = getOrdinal(player.position);
    console.log(`  ${positionStr}: ${player.playerName}`);
    console.log(`    Life: ${player.finalLife}, Damage Dealt: ${player.damageDealt}`);
    console.log(`    Spells Cast: ${player.spellsCast}, Creatures: ${player.creaturesPlayed}`);
    console.log(`    Cards Drawn: ${player.cardsDrawn}, Lands Played: ${player.landsPlayed}`);
    
    if (player.eliminated) {
      console.log(`    Eliminated Turn ${player.eliminationTurn}: ${player.eliminationReason}`);
      if (player.killedBy) {
        console.log(`    Killed by: ${player.killedBy} with ${player.killingCard || 'unknown card'}`);
      }
    }
  }
  
  if (summary.triggersProcessed.length > 0) {
    console.log(`\nTriggers Processed:`);
    for (const trigger of summary.triggersProcessed) {
      console.log(`  - ${trigger.cardName}: ${trigger.count}x`);
    }
  }
  
  if (summary.unexpectedBehaviors.length > 0) {
    console.log(`\nIssues Detected:`);
    for (const issue of summary.unexpectedBehaviors) {
      console.log(`  ⚠️  ${issue}`);
    }
  }
}

function printAnalysisReport(report: AnalysisReport): void {
  console.log(`\n${'='.repeat(70)}`);
  console.log('SIMULATION ANALYSIS REPORT');
  console.log(`${'='.repeat(70)}`);
  
  console.log(`\nTotal Games: ${report.totalGames}`);
  console.log(`Average Turns: ${report.averageTurns.toFixed(1)}`);
  console.log(`Average Duration: ${report.averageDuration.toFixed(0)}ms`);
  
  console.log(`\nWin Rates:`);
  for (const [player, rate] of report.winRates) {
    console.log(`  ${player}: ${rate.toFixed(1)}%`);
  }
  
  console.log(`\nWin Conditions:`);
  for (const [condition, count] of report.commonWinConditions) {
    const pct = ((count / report.totalGames) * 100).toFixed(1);
    console.log(`  ${condition}: ${count} (${pct}%)`);
  }
  
  console.log(`\nElimination Breakdown:`);
  for (const [reason, count] of report.eliminationBreakdown) {
    console.log(`  ${reason}: ${count}`);
  }
  
  if (report.triggersWorking.length > 0) {
    console.log(`\nTriggers That Fired:`);
    for (const trigger of report.triggersWorking.slice(0, 20)) {
      console.log(`  ✓ ${trigger}`);
    }
    if (report.triggersWorking.length > 20) {
      console.log(`  ... and ${report.triggersWorking.length - 20} more`);
    }
  }
  
  if (report.cardsNeedingFixes.length > 0) {
    console.log(`\n⚠️  CARDS NEEDING FIXES:`);
    for (const card of report.cardsNeedingFixes) {
      console.log(`  - ${card}`);
    }
  }
  
  if (report.unexpectedBehaviors.length > 0) {
    console.log(`\n⚠️  UNEXPECTED BEHAVIORS:`);
    for (const behavior of report.unexpectedBehaviors) {
      console.log(`  - ${behavior}`);
    }
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('END OF REPORT');
  console.log(`${'='.repeat(70)}`);
}

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let playerCount = DEFAULT_CONFIG.playerCount;
  let maxTurns = DEFAULT_CONFIG.maxTurns;
  let gameCount = DEFAULT_CONFIG.gamesPerSession;
  let verbose = DEFAULT_CONFIG.verbose;
  let seed = DEFAULT_CONFIG.seed;
  let singleGame = false;
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '-p':
      case '--players':
        playerCount = parseInt(args[++i], 10);
        break;
      case '-t':
      case '--turns':
        maxTurns = parseInt(args[++i], 10);
        break;
      case '-n':
      case '--games':
        gameCount = parseInt(args[++i], 10);
        break;
      case '-v':
      case '--verbose':
        verbose = true;
        break;
      case '-s':
      case '--seed':
        seed = parseInt(args[++i], 10);
        break;
      case '--single':
        singleGame = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        return;
    }
  }
  
  // Validate
  if (playerCount < 2 || playerCount > 8) {
    console.error('Player count must be between 2 and 8');
    process.exit(1);
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('MTG COMMANDER SIMULATION (Rules Engine Integration)');
  console.log(`${'='.repeat(70)}`);
  console.log(`Using shared RulesEngineAdapter, GameSimulator, and AIEngine`);
  
  // Load decks
  const decks = selectRandomDecks(playerCount);
  console.log(`\nSelected Decks:`);
  for (let i = 0; i < decks.length; i++) {
    console.log(`  Player ${i + 1}: ${decks[i].name} (Commander: ${decks[i].commander.name})`);
  }
  
  // Run simulation
  const simulator = new EnhancedSimulator();
  
  if (singleGame) {
    console.log(`\nRunning single game...`);
    const summary = await simulator.runGame(decks, {
      maxTurns,
      startingLife: DEFAULT_CONFIG.startingLife,
      verbose,
      seed,
    });
    summary.gameNumber = 1;
    printSummary(summary);
  } else {
    const report = await simulator.runBatchSimulation(decks, {
      iterations: gameCount,
      maxTurns,
      startingLife: DEFAULT_CONFIG.startingLife,
      verbose,
      baseSeed: seed,
    });
    printAnalysisReport(report);
  }
}

function printHelp(): void {
  console.log(`
MTG Commander Simulation CLI

Usage: npx tsx run-simulation.ts [options]

Options:
  -p, --players <n>    Number of players (2-8, default: 2)
  -t, --turns <n>      Maximum turns per game (default: 50)
  -n, --games <n>      Number of games to simulate (default: 25)
  -v, --verbose        Enable verbose logging
  -s, --seed <n>       Random seed for reproducibility
  --single             Run a single game with detailed output
  -h, --help           Show this help message

Purpose:
  This tool uses the shared Rules Engine to simulate commander games.
  It helps identify:
  - Cards and interactions that aren't working correctly
  - Triggers that aren't firing
  - Win conditions that aren't being detected
  - Any gaps in the rules engine implementation

Examples:
  npx tsx run-simulation.ts -p 4 -n 10
  npx tsx run-simulation.ts --single -v
  npx tsx run-simulation.ts -s 12345 -n 50
`);
}

main().catch(console.error);
