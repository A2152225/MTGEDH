#!/usr/bin/env node
/**
 * CLI tool for running MTG game simulations
 * 
 * Usage:
 *   npm run simulate -- --players 2 --iterations 100
 *   npm run simulate -- --config simulation-config.json
 */

import { gameSimulator, PlayerType } from '../src/GameSimulator';
import { AIStrategy } from '../src/AIEngine';
import type { SimulationConfig, BatchSimulationConfig } from '../src/GameSimulator';

interface CLIOptions {
  players?: number;
  iterations?: number;
  config?: string;
  format?: string;
  strategy?: string;
  seed?: number;
  verbose?: boolean;
  output?: string;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    
    switch (arg) {
      case '--players':
        options.players = parseInt(next, 10);
        i++;
        break;
      case '--iterations':
        options.iterations = parseInt(next, 10);
        i++;
        break;
      case '--config':
        options.config = next;
        i++;
        break;
      case '--format':
        options.format = next;
        i++;
        break;
      case '--strategy':
        options.strategy = next;
        i++;
        break;
      case '--seed':
        options.seed = parseInt(next, 10);
        i++;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--output':
        options.output = next;
        i++;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }
  
  return options;
}

function printHelp(): void {
  console.log(`
MTG Game Simulator CLI

Usage:
  npm run simulate -- [options]

Options:
  --players <n>        Number of AI players (default: 2)
  --iterations <n>     Number of games to simulate (default: 1)
  --format <format>    Game format: commander, standard, modern (default: commander)
  --strategy <strat>   AI strategy: random, basic, aggressive, defensive (default: basic)
  --seed <n>           RNG seed for reproducible simulations
  --verbose            Enable verbose logging
  --output <file>      Save results to JSON file
  --config <file>      Load configuration from JSON file
  --help               Show this help message

Examples:
  # Run single game with 2 AI players
  npm run simulate -- --players 2 --verbose

  # Run 100 games and save results
  npm run simulate -- --players 2 --iterations 100 --output results.json

  # Run with specific AI strategy
  npm run simulate -- --players 2 --strategy aggressive --iterations 50

  # Reproducible simulation
  npm run simulate -- --players 2 --seed 12345 --iterations 10
  `);
}

function createDefaultConfig(options: CLIOptions): SimulationConfig {
  const playerCount = options.players || 2;
  const format = (options.format || 'commander') as any;
  const strategy = (options.strategy || 'basic') as AIStrategy;
  
  const startingLife = format === 'commander' ? 40 : 20;
  
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `player_${i + 1}`,
    name: `AI Player ${i + 1}`,
    type: PlayerType.AI,
    aiStrategy: strategy,
    deckList: [], // Empty for now, would load actual decks
  }));
  
  return {
    gameId: 'simulation_' + Date.now(),
    players,
    format,
    startingLife,
    maxTurns: 100,
    rngSeed: options.seed,
    verbose: options.verbose || false,
    headless: true,
  };
}

async function loadConfigFile(filename: string): Promise<SimulationConfig> {
  const fs = await import('fs/promises');
  const data = await fs.readFile(filename, 'utf-8');
  return JSON.parse(data);
}

async function saveResults(filename: string, results: any): Promise<void> {
  const fs = await import('fs/promises');
  await fs.writeFile(filename, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`Results saved to ${filename}`);
}

async function main() {
  console.log('=== MTG Game Simulator ===\n');
  
  const options = parseArgs();
  
  // Load configuration
  let config: SimulationConfig;
  if (options.config) {
    console.log(`Loading configuration from ${options.config}...`);
    config = await loadConfigFile(options.config);
  } else {
    config = createDefaultConfig(options);
  }
  
  const iterations = options.iterations || 1;
  
  if (iterations === 1) {
    // Run single simulation
    console.log('Running single simulation...\n');
    console.log(`Players: ${config.players.length}`);
    console.log(`Format: ${config.format}`);
    console.log(`Starting Life: ${config.startingLife}\n`);
    
    const result = await gameSimulator.runSimulation(config);
    
    console.log('\n=== Simulation Complete ===');
    console.log(`Winner: ${result.winner || 'Draw'}`);
    console.log(`Reason: ${result.reason}`);
    console.log(`Total Turns: ${result.totalTurns}`);
    console.log(`Total Actions: ${result.totalActions}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Events Logged: ${result.events.length}`);
    
    if (options.output) {
      await saveResults(options.output, result);
    }
  } else {
    // Run batch simulation
    console.log(`Running batch simulation: ${iterations} games\n`);
    console.log(`Players: ${config.players.length}`);
    console.log(`Format: ${config.format}`);
    console.log(`Strategy: ${config.players[0].aiStrategy}\n`);
    
    const batchConfig: BatchSimulationConfig = {
      config,
      iterations,
    };
    
    const results = await gameSimulator.runBatchSimulation(batchConfig);
    
    console.log('\n=== Batch Simulation Complete ===');
    console.log(`Games Played: ${results.iterations}`);
    console.log('\nWin Rates:');
    for (const [playerId, winRate] of results.winRates.entries()) {
      console.log(`  ${playerId}: ${winRate.toFixed(1)}%`);
    }
    console.log(`\nAverage Turns: ${results.averageTurns.toFixed(1)}`);
    console.log(`Average Duration: ${results.averageDuration.toFixed(0)}ms per game`);
    console.log(`Total Time: ${(results.results.reduce((sum, r) => sum + r.duration, 0) / 1000).toFixed(1)}s`);
    
    if (options.output) {
      await saveResults(options.output, results);
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
