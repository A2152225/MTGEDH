/**
 * AIEngine.ts
 * 
 * AI/Automation engine for automated decision-making in MTG games.
 * Provides different AI strategies and decision-making capabilities for:
 * - Mulligan decisions
 * - Spell/ability selection and timing
 * - Target selection
 * - Attack/block decisions
 * - Priority passing
 */

import type { GameState, PlayerID } from '../../shared/src';

/**
 * AI Strategy level determines decision-making sophistication
 */
export enum AIStrategy {
  RANDOM = 'random',           // Completely random decisions
  BASIC = 'basic',             // Simple heuristics
  AGGRESSIVE = 'aggressive',   // Prioritizes attacking
  DEFENSIVE = 'defensive',     // Prioritizes blocking and life preservation
  CONTROL = 'control',         // Focuses on controlling the game
  COMBO = 'combo',             // Tries to assemble combos
}

/**
 * AI decision types
 */
export enum AIDecisionType {
  MULLIGAN = 'mulligan',
  CAST_SPELL = 'castSpell',
  ACTIVATE_ABILITY = 'activateAbility',
  SELECT_TARGET = 'selectTarget',
  DECLARE_ATTACKERS = 'declareAttackers',
  DECLARE_BLOCKERS = 'declareBlockers',
  PASS_PRIORITY = 'passPriority',
  DISCARD = 'discard',
  SACRIFICE = 'sacrifice',
}

/**
 * AI Decision result
 */
export interface AIDecision {
  readonly type: AIDecisionType;
  readonly playerId: PlayerID;
  readonly action: any;
  readonly reasoning?: string;
  readonly confidence?: number; // 0-1
}

/**
 * AI Player configuration
 */
export interface AIPlayerConfig {
  readonly playerId: PlayerID;
  readonly strategy: AIStrategy;
  readonly difficulty?: number; // 0-1, affects decision quality
  readonly thinkTime?: number;  // Simulated think time in ms
}

/**
 * Context for AI decision making
 */
export interface AIDecisionContext {
  readonly gameState: GameState;
  readonly playerId: PlayerID;
  readonly decisionType: AIDecisionType;
  readonly options: any[];
  readonly constraints?: any;
}

/**
 * AI Engine - Makes automated decisions for AI-controlled players
 */
export class AIEngine {
  private aiPlayers: Map<PlayerID, AIPlayerConfig> = new Map();
  private decisionHistory: Map<PlayerID, AIDecision[]> = new Map();
  
  /**
   * Register an AI player
   */
  registerAI(config: AIPlayerConfig): void {
    this.aiPlayers.set(config.playerId, config);
    this.decisionHistory.set(config.playerId, []);
  }
  
  /**
   * Unregister an AI player (convert to human)
   */
  unregisterAI(playerId: PlayerID): void {
    this.aiPlayers.delete(playerId);
  }
  
  /**
   * Check if a player is AI-controlled
   */
  isAI(playerId: PlayerID): boolean {
    return this.aiPlayers.has(playerId);
  }
  
  /**
   * Get AI configuration for a player
   */
  getAIConfig(playerId: PlayerID): AIPlayerConfig | undefined {
    return this.aiPlayers.get(playerId);
  }
  
  /**
   * Make a decision for an AI player
   */
  async makeDecision(context: AIDecisionContext): Promise<AIDecision> {
    const config = this.aiPlayers.get(context.playerId);
    if (!config) {
      throw new Error(`Player ${context.playerId} is not AI-controlled`);
    }
    
    // Simulate thinking time
    if (config.thinkTime && config.thinkTime > 0) {
      await new Promise(resolve => setTimeout(resolve, config.thinkTime));
    }
    
    // Make decision based on strategy
    let decision: AIDecision;
    switch (config.strategy) {
      case AIStrategy.RANDOM:
        decision = this.makeRandomDecision(context);
        break;
      case AIStrategy.BASIC:
        decision = this.makeBasicDecision(context, config);
        break;
      case AIStrategy.AGGRESSIVE:
        decision = this.makeAggressiveDecision(context, config);
        break;
      case AIStrategy.DEFENSIVE:
        decision = this.makeDefensiveDecision(context, config);
        break;
      case AIStrategy.CONTROL:
        decision = this.makeControlDecision(context, config);
        break;
      case AIStrategy.COMBO:
        decision = this.makeComboDecision(context, config);
        break;
      default:
        decision = this.makeRandomDecision(context);
    }
    
    // Record decision in history
    const history = this.decisionHistory.get(context.playerId) || [];
    history.push(decision);
    this.decisionHistory.set(context.playerId, history);
    
    return decision;
  }
  
  /**
   * Make a completely random decision
   */
  private makeRandomDecision(context: AIDecisionContext): AIDecision {
    const { decisionType, playerId, options } = context;
    
    switch (decisionType) {
      case AIDecisionType.MULLIGAN:
        return {
          type: decisionType,
          playerId,
          action: { keep: Math.random() > 0.5 },
          reasoning: 'Random decision',
          confidence: 0.5,
        };
      
      case AIDecisionType.DECLARE_ATTACKERS:
        // Randomly decide which creatures attack
        const player = context.gameState.players.find(p => p.id === playerId);
        const creatures = player?.battlefield?.filter(c => 
          c.types?.includes('Creature') && !c.tapped
        ) || [];
        const attackers = creatures.filter(() => Math.random() > 0.5);
        return {
          type: decisionType,
          playerId,
          action: { attackers: attackers.map(c => c.id) },
          reasoning: 'Random attackers',
          confidence: 0.3,
        };
      
      case AIDecisionType.PASS_PRIORITY:
        return {
          type: decisionType,
          playerId,
          action: { pass: true },
          reasoning: 'Random pass',
          confidence: 0.5,
        };
      
      default:
        return {
          type: decisionType,
          playerId,
          action: {},
          reasoning: 'No action available',
          confidence: 0,
        };
    }
  }
  
  /**
   * Make a basic heuristic-based decision
   */
  private makeBasicDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { decisionType, playerId, gameState } = context;
    
    switch (decisionType) {
      case AIDecisionType.MULLIGAN:
        return this.makeBasicMulliganDecision(context, config);
      
      case AIDecisionType.DECLARE_ATTACKERS:
        return this.makeBasicAttackDecision(context, config);
      
      case AIDecisionType.DECLARE_BLOCKERS:
        return this.makeBasicBlockDecision(context, config);
      
      case AIDecisionType.CAST_SPELL:
        return this.makeBasicCastDecision(context, config);
      
      default:
        return this.makeRandomDecision(context);
    }
  }
  
  /**
   * Basic mulligan decision: keep if hand has 2-5 lands
   */
  private makeBasicMulliganDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
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
    
    const landCount = player.hand.filter(card => 
      card.types?.includes('Land')
    ).length;
    
    const handSize = player.hand.length;
    // Keep if we have 2-5 lands (good mana curve)
    const keep = landCount >= 2 && landCount <= 5;
    
    return {
      type: AIDecisionType.MULLIGAN,
      playerId: context.playerId,
      action: { keep },
      reasoning: `Hand has ${landCount} lands (want 2-5)`,
      confidence: keep ? 0.7 : 0.3,
    };
  }
  
  /**
   * Basic attack decision: attack with creatures if opponent's life is low or no blockers
   */
  private makeBasicAttackDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const player = context.gameState.players.find(p => p.id === context.playerId);
    if (!player || !player.battlefield) {
      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId: context.playerId,
        action: { attackers: [] },
        reasoning: 'No creatures to attack with',
        confidence: 0,
      };
    }
    
    const creatures = player.battlefield.filter(c => 
      c.types?.includes('Creature') && !c.tapped && !c.summmoningSickness
    );
    
    if (creatures.length === 0) {
      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId: context.playerId,
        action: { attackers: [] },
        reasoning: 'No creatures can attack',
        confidence: 1,
      };
    }
    
    // Simple heuristic: attack with all creatures
    const attackers = creatures.map(c => c.id);
    
    return {
      type: AIDecisionType.DECLARE_ATTACKERS,
      playerId: context.playerId,
      action: { attackers },
      reasoning: `Attacking with ${attackers.length} creatures`,
      confidence: 0.6,
    };
  }
  
  /**
   * Basic block decision: block to preserve life
   */
  private makeBasicBlockDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const player = context.gameState.players.find(p => p.id === context.playerId);
    if (!player || !player.battlefield) {
      return {
        type: AIDecisionType.DECLARE_BLOCKERS,
        playerId: context.playerId,
        action: { blockers: [] },
        reasoning: 'No creatures to block with',
        confidence: 0,
      };
    }
    
    const blockers = player.battlefield.filter(c => 
      c.types?.includes('Creature') && !c.tapped
    );
    
    // Simple: block biggest attacker with biggest blocker
    // TODO: Implement more sophisticated blocking logic
    
    return {
      type: AIDecisionType.DECLARE_BLOCKERS,
      playerId: context.playerId,
      action: { blockers: [] },
      reasoning: 'Basic blocking',
      confidence: 0.5,
    };
  }
  
  /**
   * Basic spell casting decision
   */
  private makeBasicCastDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // TODO: Implement spell casting decision logic
    return {
      type: AIDecisionType.CAST_SPELL,
      playerId: context.playerId,
      action: { spell: null },
      reasoning: 'No spell to cast',
      confidence: 0,
    };
  }
  
  /**
   * Aggressive strategy decisions
   */
  private makeAggressiveDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Aggressive AI always attacks, rarely blocks
    if (context.decisionType === AIDecisionType.DECLARE_ATTACKERS) {
      const player = context.gameState.players.find(p => p.id === context.playerId);
      const creatures = player?.battlefield?.filter(c => 
        c.types?.includes('Creature') && !c.tapped && !c.summmoningSickness
      ) || [];
      
      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId: context.playerId,
        action: { attackers: creatures.map(c => c.id) },
        reasoning: 'Aggressive: attack with everything',
        confidence: 0.9,
      };
    }
    
    return this.makeBasicDecision(context, config);
  }
  
  /**
   * Defensive strategy decisions
   */
  private makeDefensiveDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Defensive AI rarely attacks, always blocks
    if (context.decisionType === AIDecisionType.DECLARE_ATTACKERS) {
      const player = context.gameState.players.find(p => p.id === context.playerId);
      const life = player?.life || 0;
      
      // Only attack if life is high or opponent is low
      if (life > 30) {
        const creatures = player?.battlefield?.filter(c => 
          c.types?.includes('Creature') && !c.tapped && !c.summmoningSickness
        ) || [];
        const attackers = creatures.slice(0, Math.floor(creatures.length / 2));
        
        return {
          type: AIDecisionType.DECLARE_ATTACKERS,
          playerId: context.playerId,
          action: { attackers: attackers.map(c => c.id) },
          reasoning: 'Defensive: cautious attack',
          confidence: 0.6,
        };
      }
      
      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId: context.playerId,
        action: { attackers: [] },
        reasoning: 'Defensive: preserve life, no attack',
        confidence: 0.8,
      };
    }
    
    return this.makeBasicDecision(context, config);
  }
  
  /**
   * Control strategy decisions
   */
  private makeControlDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Control AI focuses on counter spells and removal
    // TODO: Implement control-specific logic
    return this.makeBasicDecision(context, config);
  }
  
  /**
   * Combo strategy decisions
   */
  private makeComboDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Combo AI looks for combo pieces and tries to assemble them
    // TODO: Implement combo-specific logic
    return this.makeBasicDecision(context, config);
  }
  
  /**
   * Get decision history for a player
   */
  getDecisionHistory(playerId: PlayerID): AIDecision[] {
    return this.decisionHistory.get(playerId) || [];
  }
  
  /**
   * Clear decision history
   */
  clearHistory(playerId?: PlayerID): void {
    if (playerId) {
      this.decisionHistory.set(playerId, []);
    } else {
      this.decisionHistory.clear();
    }
  }
}

/**
 * Singleton AI engine instance
 */
export const aiEngine = new AIEngine();
