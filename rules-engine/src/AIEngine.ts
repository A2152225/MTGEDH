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
import { 
  getLegalAttackers, 
  getLegalBlockers,
  canPermanentAttack,
  canPermanentBlock,
  isCurrentlyCreature 
} from './actions/combat';

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
        // Use getLegalAttackers to get only valid attackers
        // This ensures we only attack with creatures that:
        // - Are currently creatures (not enchantments, etc.)
        // - Are untapped
        // - Don't have defender
        // - Don't have summoning sickness (or have haste)
        const legalAttackerIds = getLegalAttackers(context.gameState, playerId);
        const randomAttackers = legalAttackerIds.filter(() => Math.random() > 0.5);
        return {
          type: decisionType,
          playerId,
          action: { attackers: randomAttackers },
          reasoning: `Random attackers (${randomAttackers.length}/${legalAttackerIds.length} legal)`,
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
   * Uses proper combat validation to ensure only legal attackers are selected
   */
  private makeBasicAttackDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Use getLegalAttackers to get all valid attackers
    // This properly filters out:
    // - Non-creatures (enchantments, artifacts, lands without animation)
    // - Tapped creatures
    // - Creatures with defender
    // - Creatures with summoning sickness (unless they have haste)
    // - Creatures with "can't attack" effects
    const legalAttackerIds = getLegalAttackers(context.gameState, context.playerId);
    
    if (legalAttackerIds.length === 0) {
      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId: context.playerId,
        action: { attackers: [] },
        reasoning: 'No creatures can legally attack',
        confidence: 1,
      };
    }
    
    // Simple heuristic: attack with all legal creatures
    return {
      type: AIDecisionType.DECLARE_ATTACKERS,
      playerId: context.playerId,
      action: { attackers: legalAttackerIds },
      reasoning: `Attacking with ${legalAttackerIds.length} legal creatures`,
      confidence: 0.6,
    };
  }
  
  /**
   * Basic block decision: block to preserve life
   * Uses proper combat validation to ensure only legal blockers are selected
   */
  private makeBasicBlockDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Use getLegalBlockers to get all valid blockers
    // This properly filters out:
    // - Non-creatures (enchantments, artifacts, lands without animation)
    // - Tapped creatures
    // - Creatures with "can't block" effects
    const legalBlockerIds = getLegalBlockers(context.gameState, context.playerId);
    
    if (legalBlockerIds.length === 0) {
      return {
        type: AIDecisionType.DECLARE_BLOCKERS,
        playerId: context.playerId,
        action: { blockers: [] },
        reasoning: 'No creatures can legally block',
        confidence: 1,
      };
    }
    
    // Simple: don't block for now (TODO: implement smarter blocking)
    // Future: block biggest attacker with biggest blocker, considering evasion
    
    return {
      type: AIDecisionType.DECLARE_BLOCKERS,
      playerId: context.playerId,
      action: { blockers: [] },
      reasoning: `Basic blocking (${legalBlockerIds.length} legal blockers available)`,
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
   * Uses proper combat validation to ensure only legal attackers are selected
   */
  private makeAggressiveDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Aggressive AI always attacks with all legal creatures, rarely blocks
    if (context.decisionType === AIDecisionType.DECLARE_ATTACKERS) {
      // Use getLegalAttackers to get only valid attackers
      const legalAttackerIds = getLegalAttackers(context.gameState, context.playerId);
      
      return {
        type: AIDecisionType.DECLARE_ATTACKERS,
        playerId: context.playerId,
        action: { attackers: legalAttackerIds },
        reasoning: `Aggressive: attack with all ${legalAttackerIds.length} legal creatures`,
        confidence: 0.9,
      };
    }
    
    return this.makeBasicDecision(context, config);
  }
  
  /**
   * Defensive strategy decisions
   * Uses proper combat validation to ensure only legal attackers are selected
   */
  private makeDefensiveDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Defensive AI rarely attacks, always blocks
    if (context.decisionType === AIDecisionType.DECLARE_ATTACKERS) {
      const player = context.gameState.players.find(p => p.id === context.playerId);
      const life = player?.life || 0;
      
      // Only attack if life is high or opponent is low
      if (life > 30) {
        // Use getLegalAttackers to get only valid attackers
        const legalAttackerIds = getLegalAttackers(context.gameState, context.playerId);
        // Attack with only half of legal creatures (defensive)
        const attackerCount = Math.floor(legalAttackerIds.length / 2);
        const attackers = legalAttackerIds.slice(0, attackerCount);
        
        return {
          type: AIDecisionType.DECLARE_ATTACKERS,
          playerId: context.playerId,
          action: { attackers },
          reasoning: `Defensive: cautious attack with ${attackers.length}/${legalAttackerIds.length} legal creatures`,
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
