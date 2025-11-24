# AI Strategy Development Guide

## Overview

The MTGEDH AI Engine supports pluggable strategies for automated decision-making. This guide explains how to create, customize, and test AI strategies.

## Built-in Strategies

### RANDOM
- **Description**: Makes completely random decisions
- **Use Case**: Testing, baseline comparison
- **Skill Level**: N/A
- **Characteristics**: Unpredictable, no logic

### BASIC
- **Description**: Simple heuristic-based decisions
- **Use Case**: Default AI opponent, learning
- **Skill Level**: Beginner
- **Characteristics**:
  - Keeps hands with 2-5 lands
  - Attacks with all untapped creatures
  - Basic blocking to preserve life
  - No complex interactions

### AGGRESSIVE
- **Description**: Prioritizes attacking and damage
- **Use Case**: Testing defensive strategies, fast games
- **Skill Level**: Intermediate
- **Characteristics**:
  - Always attacks with all creatures
  - Rarely blocks
  - Casts creatures on curve
  - Targets opponent's life total

### DEFENSIVE
- **Description**: Focuses on life preservation
- **Use Case**: Testing aggressive strategies, control games
- **Skill Level**: Intermediate
- **Characteristics**:
  - Cautious attacking (only when ahead)
  - Always blocks optimally
  - Prioritizes life gain
  - Holds back creatures for defense

### CONTROL
- **Description**: Emphasizes board control
- **Use Case**: Testing complex interactions
- **Skill Level**: Advanced
- **Characteristics**:
  - Holds up mana for instant-speed spells
  - Prioritizes removal and counters
  - Card advantage over tempo
  - Long-game focused

### COMBO
- **Description**: Attempts to assemble win conditions
- **Use Case**: Testing combo disruption
- **Skill Level**: Advanced
- **Characteristics**:
  - Searches for combo pieces
  - Protects key cards
  - Prioritizes card selection
  - Goes for win when ready

## Creating Custom Strategies

### Strategy Interface

```typescript
export interface AIStrategy {
  // Mulligan decision
  decideMulligan(context: AIDecisionContext): AIDecision;
  
  // Combat decisions
  declareAttackers(context: AIDecisionContext): AIDecision;
  declareBlockers(context: AIDecisionContext): AIDecision;
  
  // Spell decisions
  selectSpellToCast(context: AIDecisionContext): AIDecision;
  selectTargets(context: AIDecisionContext): AIDecision;
  
  // Priority management
  shouldPassPriority(context: AIDecisionContext): AIDecision;
  
  // Card selection
  selectCardsToDiscard(context: AIDecisionContext): AIDecision;
  selectPermanentsToSacrifice(context: AIDecisionContext): AIDecision;
}
```

### Example: Creating a Midrange Strategy

```typescript
// rules-engine/src/strategies/MidrangeStrategy.ts
import { AIStrategy, AIDecisionType, AIDecision, AIDecisionContext } from '../AIEngine';

export class MidrangeStrategy implements AIStrategy {
  decideMulligan(context: AIDecisionContext): AIDecision {
    const player = context.gameState.players.find(p => p.id === context.playerId);
    if (!player || !player.hand) {
      return {
        type: AIDecisionType.MULLIGAN,
        playerId: context.playerId,
        action: { keep: false },
        reasoning: 'No hand found',
        confidence: 0,
      };
    }
    
    const landCount = player.hand.filter(c => c.types?.includes('Land')).length;
    const creatureCount = player.hand.filter(c => c.types?.includes('Creature')).length;
    const handSize = player.hand.length;
    
    // Midrange wants 3-4 lands and at least one threat
    const goodLands = landCount >= 3 && landCount <= 4;
    const hasThreats = creatureCount >= 1;
    const keep = goodLands && hasThreats;
    
    return {
      type: AIDecisionType.MULLIGAN,
      playerId: context.playerId,
      action: { keep },
      reasoning: `Midrange: ${landCount} lands, ${creatureCount} creatures`,
      confidence: keep ? 0.8 : 0.4,
    };
  }
  
  declareAttackers(context: AIDecisionContext): AIDecision {
    const player = context.gameState.players.find(p => p.id === context.playerId);
    const creatures = player?.battlefield?.filter(c =>
      c.types?.includes('Creature') && !c.tapped && !c.summmoningSickness
    ) || [];
    
    // Midrange: attack with creatures bigger than opponent's potential blockers
    const opponents = context.gameState.players.filter(p => p.id !== context.playerId);
    const opponentBlockers = opponents.flatMap(opp =>
      opp.battlefield?.filter(c => c.types?.includes('Creature') && !c.tapped) || []
    );
    
    const maxOpponentPower = Math.max(
      ...opponentBlockers.map(c => parseInt(c.power || '0')),
      0
    );
    
    // Attack with creatures larger than opponent's blockers
    const attackers = creatures.filter(c => {
      const power = parseInt(c.power || '0');
      return power > maxOpponentPower;
    });
    
    return {
      type: AIDecisionType.DECLARE_ATTACKERS,
      playerId: context.playerId,
      action: { attackers: attackers.map(c => c.id) },
      reasoning: `Midrange: attacking with ${attackers.length} creatures (power > ${maxOpponentPower})`,
      confidence: 0.7,
    };
  }
  
  declareBlockers(context: AIDecisionContext): AIDecision {
    // Implement smart blocking for midrange
    // Block to preserve life while setting up favorable trades
    const player = context.gameState.players.find(p => p.id === context.playerId);
    const blockers = player?.battlefield?.filter(c =>
      c.types?.includes('Creature') && !c.tapped
    ) || [];
    
    const attackers = context.gameState.combat?.attackers || [];
    
    // Midrange: block to preserve life and get value trades
    const blocks = [];
    
    for (const attacker of attackers) {
      const attackerPower = parseInt(attacker.power || '0');
      const attackerToughness = parseInt(attacker.toughness || '1');
      
      // Find a blocker that can kill the attacker without dying
      const goodBlocker = blockers.find(b => {
        const blockerPower = parseInt(b.power || '0');
        const blockerToughness = parseInt(b.toughness || '1');
        return blockerPower >= attackerToughness && blockerToughness > attackerPower;
      });
      
      if (goodBlocker) {
        blocks.push({
          attacker: attacker.id,
          blocker: goodBlocker.id,
        });
      }
    }
    
    return {
      type: AIDecisionType.DECLARE_BLOCKERS,
      playerId: context.playerId,
      action: { blockers: blocks },
      reasoning: `Midrange: blocking ${blocks.length} attackers for value`,
      confidence: 0.75,
    };
  }
  
  // Implement other decision methods...
  selectSpellToCast(context: AIDecisionContext): AIDecision {
    // Midrange spell selection logic
    return {
      type: AIDecisionType.CAST_SPELL,
      playerId: context.playerId,
      action: { spell: null },
      reasoning: 'Midrange spell selection',
      confidence: 0.6,
    };
  }
  
  selectTargets(context: AIDecisionContext): AIDecision {
    // Midrange targeting logic
    return {
      type: AIDecisionType.SELECT_TARGET,
      playerId: context.playerId,
      action: { targets: [] },
      reasoning: 'Midrange targeting',
      confidence: 0.6,
    };
  }
  
  shouldPassPriority(context: AIDecisionContext): AIDecision {
    // Midrange priority decisions
    return {
      type: AIDecisionType.PASS_PRIORITY,
      playerId: context.playerId,
      action: { pass: true },
      reasoning: 'Midrange priority pass',
      confidence: 0.7,
    };
  }
  
  selectCardsToDiscard(context: AIDecisionContext): AIDecision {
    // Midrange discard logic: keep threats and lands
    return {
      type: AIDecisionType.DISCARD,
      playerId: context.playerId,
      action: { cards: [] },
      reasoning: 'Midrange discard',
      confidence: 0.6,
    };
  }
  
  selectPermanentsToSacrifice(context: AIDecisionContext): AIDecision {
    // Midrange sacrifice logic: sacrifice least valuable
    return {
      type: AIDecisionType.SACRIFICE,
      playerId: context.playerId,
      action: { permanents: [] },
      reasoning: 'Midrange sacrifice',
      confidence: 0.6,
    };
  }
}
```

### Registering Custom Strategies

```typescript
// Add to AIEngine.ts
export enum AIStrategy {
  RANDOM = 'random',
  BASIC = 'basic',
  AGGRESSIVE = 'aggressive',
  DEFENSIVE = 'defensive',
  CONTROL = 'control',
  COMBO = 'combo',
  MIDRANGE = 'midrange', // New strategy
}

// In AIEngine.makeDecision()
case AIStrategy.MIDRANGE:
  decision = new MidrangeStrategy().decideMulligan(context);
  break;
```

## Advanced Techniques

### 1. Evaluation Functions

Create numeric evaluations for game states:

```typescript
function evaluateBoardState(state: GameState, playerId: string): number {
  let score = 0;
  const player = state.players.find(p => p.id === playerId);
  
  // Life total value
  score += player.life * 0.5;
  
  // Board presence
  const creatures = player.battlefield.filter(c => c.types?.includes('Creature'));
  score += creatures.length * 10;
  
  // Total power on board
  const totalPower = creatures.reduce((sum, c) => 
    sum + parseInt(c.power || '0'), 0
  );
  score += totalPower * 5;
  
  // Card advantage
  score += player.hand.length * 8;
  
  // Mana available
  const lands = player.battlefield.filter(c => 
    c.types?.includes('Land') && !c.tapped
  );
  score += lands.length * 3;
  
  return score;
}
```

### 2. Minimax for Combat

```typescript
function evaluateCombatOutcome(
  attackers: Creature[],
  blockers: Map<string, string>, // attacker -> blocker
  state: GameState
): number {
  let value = 0;
  
  for (const attacker of attackers) {
    const blockerId = blockers.get(attacker.id);
    
    if (!blockerId) {
      // Unblocked damage
      value += parseInt(attacker.power || '0');
    } else {
      // Combat math
      const blocker = findCreature(state, blockerId);
      const attackerDies = parseInt(attacker.toughness || '1') <= parseInt(blocker.power || '0');
      const blockerDies = parseInt(blocker.toughness || '1') <= parseInt(attacker.power || '0');
      
      if (attackerDies && !blockerDies) {
        value -= 10; // Bad trade
      } else if (!attackerDies && blockerDies) {
        value += 10; // Good trade
      }
    }
  }
  
  return value;
}
```

### 3. Monte Carlo Tree Search (MCTS)

For advanced decision-making:

```typescript
class MCTSNode {
  state: GameState;
  parent?: MCTSNode;
  children: MCTSNode[] = [];
  visits: number = 0;
  wins: number = 0;
  
  expand(action: Action): MCTSNode {
    const newState = applyAction(this.state, action);
    const child = new MCTSNode(newState, this);
    this.children.push(child);
    return child;
  }
  
  selectChild(): MCTSNode {
    // UCB1 formula
    return this.children.reduce((best, child) => {
      const ucb1 = child.wins / child.visits + 
        Math.sqrt(2 * Math.log(this.visits) / child.visits);
      const bestUcb1 = best.wins / best.visits +
        Math.sqrt(2 * Math.log(this.visits) / best.visits);
      return ucb1 > bestUcb1 ? child : best;
    });
  }
  
  backpropagate(won: boolean): void {
    this.visits++;
    if (won) this.wins++;
    if (this.parent) this.parent.backpropagate(won);
  }
}

function mctsBestAction(state: GameState, iterations: number): Action {
  const root = new MCTSNode(state);
  
  for (let i = 0; i < iterations; i++) {
    // Selection
    let node = root;
    while (node.children.length > 0) {
      node = node.selectChild();
    }
    
    // Expansion
    const actions = getLegalActions(node.state);
    if (actions.length > 0) {
      const action = actions[Math.floor(Math.random() * actions.length)];
      node = node.expand(action);
    }
    
    // Simulation
    const won = simulateRandomGame(node.state);
    
    // Backpropagation
    node.backpropagate(won);
  }
  
  // Return action leading to most visited child
  const bestChild = root.children.reduce((best, child) =>
    child.visits > best.visits ? child : best
  );
  return bestChild.action;
}
```

## Testing Strategies

### Unit Tests

```typescript
import { describe, it, expect } from 'vitest';
import { MidrangeStrategy } from './MidrangeStrategy';

describe('MidrangeStrategy', () => {
  const strategy = new MidrangeStrategy();
  
  it('should keep good midrange hands', () => {
    const context = {
      gameState: createTestState({
        hand: [
          { types: ['Land'] },
          { types: ['Land'] },
          { types: ['Land'] },
          { types: ['Creature'] },
          { types: ['Instant'] },
        ],
      }),
      playerId: 'test',
      decisionType: AIDecisionType.MULLIGAN,
      options: [],
    };
    
    const decision = strategy.decideMulligan(context);
    expect(decision.action.keep).toBe(true);
  });
  
  it('should attack with superior creatures', () => {
    const context = {
      gameState: createTestState({
        battlefield: [
          { types: ['Creature'], power: '3', toughness: '3' },
          { types: ['Creature'], power: '2', toughness: '2' },
        ],
        opponentCreatures: [
          { types: ['Creature'], power: '2', toughness: '2' },
        ],
      }),
      playerId: 'test',
      decisionType: AIDecisionType.DECLARE_ATTACKERS,
      options: [],
    };
    
    const decision = strategy.declareAttackers(context);
    expect(decision.action.attackers).toHaveLength(1);
  });
});
```

### Integration Tests

```typescript
async function testStrategyVsBaseline() {
  const newStrategy = new MidrangeStrategy();
  
  const results = await gameSimulator.runBatchSimulation({
    config: {
      gameId: 'strategy_test',
      players: [
        {
          id: 'new',
          type: PlayerType.AI,
          aiStrategy: newStrategy,
          deckList: testDeck,
        },
        {
          id: 'baseline',
          type: PlayerType.AI,
          aiStrategy: AIStrategy.BASIC,
          deckList: testDeck,
        },
      ],
      format: 'commander',
      startingLife: 40,
      headless: true,
    },
    iterations: 500,
  });
  
  const winRate = results.winRates.get('new') || 0;
  console.log(`New strategy win rate: ${winRate.toFixed(1)}%`);
  
  // Should be better than random (50%)
  expect(winRate).toBeGreaterThan(50);
}
```

## Performance Optimization

### 1. Caching

```typescript
class CachedMidrangeStrategy extends MidrangeStrategy {
  private cache = new Map<string, AIDecision>();
  
  private getCacheKey(context: AIDecisionContext): string {
    return JSON.stringify({
      type: context.decisionType,
      boardState: serializeBoardState(context.gameState),
    });
  }
  
  decideMulligan(context: AIDecisionContext): AIDecision {
    const key = this.getCacheKey(context);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    
    const decision = super.decideMulligan(context);
    this.cache.set(key, decision);
    return decision;
  }
}
```

### 2. Early Termination

```typescript
declareAttackers(context: AIDecisionContext): AIDecision {
  const player = context.gameState.players.find(p => p.id === context.playerId);
  
  // Early exit if no creatures
  if (!player?.battlefield?.some(c => c.types?.includes('Creature'))) {
    return {
      type: AIDecisionType.DECLARE_ATTACKERS,
      playerId: context.playerId,
      action: { attackers: [] },
      reasoning: 'No creatures',
      confidence: 1,
    };
  }
  
  // Continue with full logic...
}
```

### 3. Lazy Evaluation

```typescript
class LazyMidrangeStrategy extends MidrangeStrategy {
  private boardEvaluation?: number;
  
  private evaluateBoard(state: GameState): number {
    if (this.boardEvaluation !== undefined) {
      return this.boardEvaluation;
    }
    
    this.boardEvaluation = evaluateBoardState(state, this.playerId);
    return this.boardEvaluation;
  }
  
  invalidateCache(): void {
    this.boardEvaluation = undefined;
  }
}
```

## Best Practices

1. **Start Simple**: Begin with basic heuristics before adding complexity
2. **Test Incrementally**: Test each decision method independently
3. **Benchmark**: Compare against existing strategies
4. **Profile**: Use profiling tools to find bottlenecks
5. **Document**: Explain strategy reasoning and parameters
6. **Version**: Track strategy versions and performance

## Next Steps

- [Rules Engine Integration](./rules-engine-integration.md)
- [Simulation Guide](./simulation-guide.md)
- [Performance Optimization](./performance.md)
