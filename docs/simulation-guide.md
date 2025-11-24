# Game Simulation Harness Usage Guide

## Overview

The MTGEDH Game Simulator provides a complete framework for running automated MTG games from mulligan to win condition. This guide covers how to use the simulation harness for testing, development, and analysis.

## Quick Start

### Running Your First Simulation

```bash
# Navigate to rules-engine directory
cd rules-engine

# Run a simple 2-player simulation
npm run simulate -- --players 2 --verbose

# Run 100 games for statistical analysis
npm run simulate -- --players 2 --iterations 100

# Run with specific AI strategy
npm run simulate -- --players 2 --strategy aggressive --iterations 50
```

## CLI Reference

### Command-Line Options

```
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
  --help               Show help message
```

### Examples

#### Single Game with Logging

```bash
npm run simulate -- --players 2 --verbose
```

Output:
```
=== MTG Game Simulator ===

Running single simulation...

Players: 2
Format: commander
Starting Life: 40

[Simulator] Starting game simulation_1732429800000
[Simulator] Starting mulligan phase
[Simulator] AI Player 1 (AI): keep (Hand has 2 lands (want 2-5))
[Simulator] AI Player 2 (AI): keep (Hand has 3 lands (want 2-5))
[Simulator] Turn 1: AI Player 1's turn
[Simulator] AI Player 1 attacks with 0 creatures
[Simulator] Turn 2: AI Player 2's turn
...

=== Simulation Complete ===
Winner: player_2
Reason: player_2 won the game
Total Turns: 15
Total Actions: 30
Duration: 450ms
Events Logged: 142
```

#### Batch Simulation

```bash
npm run simulate -- --players 2 --iterations 100 --output results.json
```

Output:
```
=== MTG Game Simulator ===

Running batch simulation: 100 games

Players: 2
Format: commander
Strategy: basic

[Simulator] Completed 10/100 simulations
[Simulator] Completed 20/100 simulations
...
[Simulator] Completed 100/100 simulations

=== Batch Simulation Complete ===
Games Played: 100

Win Rates:
  player_1: 47.0%
  player_2: 53.0%

Average Turns: 18.5
Average Duration: 520ms per game
Total Time: 52.0s

Results saved to results.json
```

#### Reproducible Simulation

```bash
# Run with seed for reproducibility
npm run simulate -- --players 2 --seed 12345 --iterations 10

# Run again with same seed - identical results
npm run simulate -- --players 2 --seed 12345 --iterations 10
```

#### Strategy Comparison

```bash
# Test aggressive strategy
npm run simulate -- --players 2 --strategy aggressive --iterations 100 --output aggressive.json

# Test defensive strategy
npm run simulate -- --players 2 --strategy defensive --iterations 100 --output defensive.json

# Compare results
node compare-strategies.js aggressive.json defensive.json
```

## Configuration Files

For complex simulations, use JSON configuration files:

### Example Configuration

Create `simulation-config.json`:

```json
{
  "gameId": "test_simulation",
  "format": "commander",
  "startingLife": 40,
  "maxTurns": 100,
  "rngSeed": 42,
  "verbose": true,
  "headless": true,
  "players": [
    {
      "id": "aggressive_ai",
      "name": "Aggressive Bot",
      "type": "ai",
      "aiStrategy": "aggressive",
      "deckList": [
        "Mountain",
        "Mountain",
        "Mountain",
        "Lightning Bolt",
        "Shock",
        "Lava Spike"
      ]
    },
    {
      "id": "defensive_ai",
      "name": "Defensive Bot",
      "type": "ai",
      "aiStrategy": "defensive",
      "deckList": [
        "Plains",
        "Plains",
        "Plains",
        "Healing Salve",
        "Safe Passage",
        "Wall of Omens"
      ]
    }
  ]
}
```

Run with config file:

```bash
npm run simulate -- --config simulation-config.json --iterations 50
```

## Programmatic API

Use the simulator programmatically in your own code:

### Single Simulation

```typescript
import { gameSimulator, PlayerType, AIStrategy } from '@mtgedh/rules-engine';

async function runTestGame() {
  const config = {
    gameId: 'test_game',
    players: [
      {
        id: 'ai1',
        name: 'Test AI 1',
        type: PlayerType.AI,
        aiStrategy: AIStrategy.BASIC,
        deckList: ['Forest', 'Mountain', 'Plains'], // Simplified
      },
      {
        id: 'ai2',
        name: 'Test AI 2',
        type: PlayerType.AI,
        aiStrategy: AIStrategy.BASIC,
        deckList: ['Island', 'Swamp', 'Mountain'],
      },
    ],
    format: 'commander' as const,
    startingLife: 40,
    maxTurns: 100,
    verbose: false,
    headless: true,
  };
  
  const result = await gameSimulator.runSimulation(config);
  
  console.log('Game Result:', {
    winner: result.winner,
    turns: result.totalTurns,
    duration: result.duration,
  });
  
  // Access detailed statistics
  for (const [playerId, stats] of result.playerStats) {
    console.log(`${playerId}:`, {
      finalLife: stats.finalLife,
      creaturesPlayed: stats.creaturesPlayed,
      landsPlayed: stats.landsPlayed,
    });
  }
  
  // Access event log
  console.log(`Total events: ${result.events.length}`);
  const spellsCast = result.events.filter(e => e.type === 'spellCast');
  console.log(`Spells cast: ${spellsCast.length}`);
}

runTestGame();
```

### Batch Simulation

```typescript
import { gameSimulator } from '@mtgedh/rules-engine';

async function runBenchmark() {
  const config = {
    gameId: 'benchmark',
    players: [/* ... */],
    format: 'commander' as const,
    startingLife: 40,
    headless: true,
  };
  
  const batchConfig = {
    config,
    iterations: 1000,
  };
  
  console.log('Running 1000 simulations...');
  const startTime = Date.now();
  
  const results = await gameSimulator.runBatchSimulation(batchConfig);
  
  const endTime = Date.now();
  const totalTime = endTime - startTime;
  
  console.log('Benchmark Results:');
  console.log(`Total Time: ${totalTime}ms`);
  console.log(`Games/Second: ${(1000 / totalTime * 1000).toFixed(2)}`);
  console.log('Win Rates:', Object.fromEntries(results.winRates));
  console.log(`Average Game Length: ${results.averageTurns.toFixed(1)} turns`);
  
  // Analyze distribution
  const turnCounts = results.results.map(r => r.totalTurns);
  const minTurns = Math.min(...turnCounts);
  const maxTurns = Math.max(...turnCounts);
  
  console.log(`Turn Range: ${minTurns}-${maxTurns}`);
}

runBenchmark();
```

## Use Cases

### 1. Regression Testing

Verify that rules changes don't break existing functionality:

```typescript
async function regressionTest() {
  const testConfigs = [
    { name: 'basic_game', config: basicConfig },
    { name: 'combat_heavy', config: combatConfig },
    { name: 'spell_heavy', config: spellConfig },
  ];
  
  for (const test of testConfigs) {
    console.log(`Running ${test.name}...`);
    
    const result = await gameSimulator.runSimulation({
      ...test.config,
      rngSeed: 12345, // Deterministic
    });
    
    // Check for unexpected outcomes
    if (!result.winner) {
      console.error(`❌ ${test.name}: Game ended in draw!`);
    } else if (result.totalTurns > 100) {
      console.error(`❌ ${test.name}: Game took too long!`);
    } else {
      console.log(`✅ ${test.name}: Pass`);
    }
  }
}
```

### 2. Balance Testing

Test deck balance and win rates:

```typescript
async function testDeckBalance() {
  const deckA = ['Mountain', /* red aggressive deck */];
  const deckB = ['Plains', /* white defensive deck */];
  
  const config = {
    gameId: 'balance_test',
    players: [
      { id: 'a', type: PlayerType.AI, aiStrategy: AIStrategy.BASIC, deckList: deckA },
      { id: 'b', type: PlayerType.AI, aiStrategy: AIStrategy.BASIC, deckList: deckB },
    ],
    format: 'standard' as const,
    startingLife: 20,
    headless: true,
  };
  
  const results = await gameSimulator.runBatchSimulation({
    config,
    iterations: 500,
  });
  
  const winRateA = results.winRates.get('a') || 0;
  const winRateB = results.winRates.get('b') || 0;
  
  console.log('Balance Test Results:');
  console.log(`Deck A Win Rate: ${winRateA.toFixed(1)}%`);
  console.log(`Deck B Win Rate: ${winRateB.toFixed(1)}%`);
  
  if (Math.abs(winRateA - winRateB) < 10) {
    console.log('✅ Decks are balanced (within 10%)');
  } else {
    console.log('⚠️ Decks may be imbalanced');
  }
}
```

### 3. AI Strategy Evaluation

Compare different AI strategies:

```typescript
async function evaluateStrategies() {
  const strategies = [
    AIStrategy.RANDOM,
    AIStrategy.BASIC,
    AIStrategy.AGGRESSIVE,
    AIStrategy.DEFENSIVE,
  ];
  
  const results = new Map();
  
  for (const strategy of strategies) {
    console.log(`Testing ${strategy}...`);
    
    const config = {
      gameId: `test_${strategy}`,
      players: [
        { id: 'test', type: PlayerType.AI, aiStrategy: strategy, deckList: testDeck },
        { id: 'baseline', type: PlayerType.AI, aiStrategy: AIStrategy.BASIC, deckList: testDeck },
      ],
      format: 'commander' as const,
      startingLife: 40,
      headless: true,
    };
    
    const batchResult = await gameSimulator.runBatchSimulation({
      config,
      iterations: 100,
    });
    
    results.set(strategy, {
      winRate: batchResult.winRates.get('test') || 0,
      avgTurns: batchResult.averageTurns,
    });
  }
  
  console.log('\nStrategy Evaluation Results:');
  for (const [strategy, stats] of results) {
    console.log(`${strategy}:`);
    console.log(`  Win Rate: ${stats.winRate.toFixed(1)}%`);
    console.log(`  Avg Turns: ${stats.avgTurns.toFixed(1)}`);
  }
}
```

### 4. Stress Testing

Test system stability under load:

```typescript
async function stressTest() {
  console.log('Running stress test...');
  
  const configs = Array.from({ length: 10 }, (_, i) => ({
    gameId: `stress_${i}`,
    players: [
      { id: 'a', type: PlayerType.AI, aiStrategy: AIStrategy.RANDOM, deckList: [] },
      { id: 'b', type: PlayerType.AI, aiStrategy: AIStrategy.RANDOM, deckList: [] },
    ],
    format: 'commander' as const,
    startingLife: 40,
    headless: true,
  }));
  
  // Run multiple batches in parallel
  const promises = configs.map(config =>
    gameSimulator.runBatchSimulation({ config, iterations: 100 })
  );
  
  try {
    const results = await Promise.all(promises);
    console.log('✅ Stress test passed!');
    console.log(`Completed ${results.length * 100} simulations`);
  } catch (error) {
    console.error('❌ Stress test failed:', error);
  }
}
```

## Output Format

### Single Simulation Result

```typescript
{
  gameId: string;
  winner: string | null;
  reason: string;
  totalTurns: number;
  totalActions: number;
  duration: number; // milliseconds
  events: RulesEvent[];
  finalState: GameState;
  playerStats: Map<PlayerID, PlayerStats>;
}
```

### Batch Simulation Results

```typescript
{
  iterations: number;
  results: SimulationResult[];
  winRates: Map<PlayerID, number>; // percentage
  averageTurns: number;
  averageDuration: number; // milliseconds
}
```

## Best Practices

### 1. Use Appropriate Sample Sizes

- **Quick tests**: 10-50 iterations
- **Balance testing**: 100-500 iterations
- **Statistical analysis**: 1000+ iterations

### 2. Set Reasonable Time Limits

```typescript
{
  maxTurns: 100, // Prevent infinite loops
  thinkTime: 0,  // No AI delay for batch runs
}
```

### 3. Enable Logging Selectively

```typescript
{
  verbose: true,  // For debugging single games
  verbose: false, // For batch simulations
}
```

### 4. Use RNG Seeding for Reproducibility

```typescript
{
  rngSeed: 12345, // Same seed = same results
}
```

### 5. Save Results for Analysis

```bash
npm run simulate -- --iterations 1000 --output results.json
```

Then analyze with custom scripts:

```javascript
const results = require('./results.json');
const avgLife = results.results.reduce((sum, r) => 
  sum + r.playerStats.get('player_1').finalLife, 0
) / results.iterations;
console.log(`Average final life: ${avgLife}`);
```

## Troubleshooting

### Simulations Running Slowly

- Reduce `thinkTime` to 0 for headless mode
- Disable `verbose` logging
- Use `headless: true`
- Consider parallelization for batch runs

### Games Not Ending

- Check `maxTurns` is set
- Verify win/loss conditions are implemented
- Review event log for stuck states

### Inconsistent Results

- Use `rngSeed` for deterministic behavior
- Ensure deck lists are identical between runs
- Check for race conditions in async code

## Integration with CI/CD

Add simulation tests to your CI pipeline:

```yaml
# .github/workflows/simulation-tests.yml
name: Simulation Tests

on: [push, pull_request]

jobs:
  simulate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - name: Run Simulations
        run: |
          cd rules-engine
          npm run simulate -- --iterations 100 --output ci-results.json
      - name: Check Results
        run: |
          node scripts/verify-simulation-results.js ci-results.json
```

## Next Steps

- [Rules Engine Integration](./rules-engine-integration.md)
- [AI Strategy Development](./ai-strategies.md)
- [Performance Optimization](./performance.md)
