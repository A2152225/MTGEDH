/**
 * AIEngine.ts
 * 
 * AI/Automation engine for automated decision-making in MTG games.
 * Provides different AI strategies and decision-making capabilities for:
 * - Mulligan decisions
 * - Spell/ability selection and timing
 * - Target selection
 * - Attack/block decisions with keyword ability awareness
 * - Priority passing
 * - Sacrifice decisions
 * - Token creation and management
 * - Triggered ability responses
 */

import type { GameState, PlayerID, BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { 
  getLegalAttackers, 
  getLegalBlockers,
  canPermanentAttack,
  canPermanentBlock,
  isCurrentlyCreature 
} from './actions/combat';
import {
  extractCombatKeywords,
  getCreaturePower,
  getCreatureToughness,
  createCombatCreature,
  canCreatureAttack,
  canCreatureBlock,
  calculateLethalDamage,
  type CombatCreature,
  type CombatKeywords,
} from './combatAutomation';
import {
  COMMON_TOKENS,
  createTokensByName,
  type TokenCharacteristics,
} from './tokenCreation';

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
  ASSIGN_DAMAGE = 'assignDamage',
  PASS_PRIORITY = 'passPriority',
  DISCARD = 'discard',
  SACRIFICE = 'sacrifice',
  CREATE_TOKEN = 'createToken',
  TRIGGERED_ABILITY = 'triggeredAbility',
  CHOOSE_MODE = 'chooseMode',
  ORDER_BLOCKERS = 'orderBlockers',
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
      
      case AIDecisionType.SACRIFICE:
        return this.makeSacrificeDecision(context, config);
      
      case AIDecisionType.SELECT_TARGET:
        return this.makeTargetDecision(context, config);
      
      case AIDecisionType.TRIGGERED_ABILITY:
        return this.makeTriggeredAbilityDecision(context, config);
      
      case AIDecisionType.ASSIGN_DAMAGE:
        return this.makeDamageAssignmentDecision(context, config);
      
      case AIDecisionType.ORDER_BLOCKERS:
        return this.makeBlockerOrderDecision(context, config);
      
      case AIDecisionType.CREATE_TOKEN:
        return this.makeTokenCreationDecision(context, config);
      
      case AIDecisionType.CHOOSE_MODE:
        return this.makeModeChoiceDecision(context, config);
      
      case AIDecisionType.DISCARD:
        return this.makeDiscardDecision(context, config);
      
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
   * Basic attack decision using comprehensive combat validation.
   * 
   * Uses getLegalAttackers() to properly filter the battlefield to only
   * permanents that can legally attack:
   * - Must be a creature (not enchantments, artifacts without animation, etc.)
   * - Must be untapped
   * - Must not have defender
   * - Must not have summoning sickness (unless has haste)
   * - Must not have "can't attack" effects (e.g., Pacifism)
   */
  private makeBasicAttackDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    // Use getLegalAttackers to get all valid attackers
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
    
    // Get attacking creatures from context
    const attackingCreatures = context.constraints?.attackers || [];
    if (attackingCreatures.length === 0) {
      return {
        type: AIDecisionType.DECLARE_BLOCKERS,
        playerId: context.playerId,
        action: { blockers: [] },
        reasoning: 'No attackers to block',
        confidence: 1,
      };
    }
    
    // Get player's blockers as permanents
    const player = context.gameState.players.find(p => p.id === context.playerId);
    if (!player?.battlefield) {
      return {
        type: AIDecisionType.DECLARE_BLOCKERS,
        playerId: context.playerId,
        action: { blockers: [] },
        reasoning: 'No battlefield found',
        confidence: 0,
      };
    }
    
    const blockerPermanents = player.battlefield.filter((p: BattlefieldPermanent) => 
      legalBlockerIds.includes(p.id)
    );
    
    // Convert to CombatCreatures for analysis
    const blockerCreatures = blockerPermanents.map((p: BattlefieldPermanent) => createCombatCreature(p));
    const attackerCreatures = attackingCreatures.map((a: any) => {
      if (typeof a === 'object' && a.id) {
        return createCombatCreature(a);
      }
      return null;
    }).filter(Boolean) as CombatCreature[];
    
    // Smart blocking: block biggest threats that we can kill without losing valuable creatures
    const blockAssignments: { blockerId: string; attackerId: string }[] = [];
    const usedBlockers = new Set<string>();
    
    // Sort attackers by threat (power * keywords)
    const sortedAttackers = [...attackerCreatures].sort((a, b) => {
      const aThreat = a.power + (a.keywords.trample ? 2 : 0) + (a.keywords.deathtouch ? 3 : 0);
      const bThreat = b.power + (b.keywords.trample ? 2 : 0) + (b.keywords.deathtouch ? 3 : 0);
      return bThreat - aThreat;
    });
    
    for (const attacker of sortedAttackers) {
      // Find a blocker that can kill this attacker or trade favorably
      for (const blocker of blockerCreatures) {
        if (usedBlockers.has(blocker.id)) continue;
        
        // Check if blocker can legally block this attacker
        const validation = canCreatureBlock(blocker, attacker, []);
        if (!validation.legal) continue;
        
        // Check if it's a good trade:
        // 1. Blocker survives and kills attacker
        // 2. Trade (both die)
        // 3. Chump block only if attacker has trample or is very threatening
        
        const blockerSurvives = blocker.toughness > attacker.power;
        const attackerDies = attacker.toughness <= blocker.power || blocker.keywords.deathtouch;
        
        if (blockerSurvives || attackerDies || attacker.keywords.trample) {
          blockAssignments.push({
            blockerId: blocker.id,
            attackerId: attacker.id,
          });
          usedBlockers.add(blocker.id);
          break;
        }
      }
    }
    
    return {
      type: AIDecisionType.DECLARE_BLOCKERS,
      playerId: context.playerId,
      action: { blockers: blockAssignments },
      reasoning: `Smart blocking: ${blockAssignments.length} blocks assigned`,
      confidence: 0.7,
    };
  }
  
  /**
   * Basic spell casting decision
   * Evaluates castable spells based on mana efficiency, board state, and timing
   */
  private makeBasicCastDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { gameState, playerId, options } = context;
    const player = gameState.players.find(p => p.id === playerId);
    
    if (!player || !player.hand || player.hand.length === 0) {
      return {
        type: AIDecisionType.CAST_SPELL,
        playerId,
        action: { spell: null },
        reasoning: 'No cards in hand',
        confidence: 0,
      };
    }
    
    // Get available mana
    const manaPool = player.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    const totalMana = manaPool.white + manaPool.blue + manaPool.black + 
                      manaPool.red + manaPool.green + manaPool.colorless;
    
    // Filter castable spells based on options or all hand cards
    const castableCards = (options || player.hand).filter((card: any) => {
      const cmc = card.cmc || card.mana_value || 0;
      return cmc <= totalMana;
    });
    
    if (castableCards.length === 0) {
      return {
        type: AIDecisionType.CAST_SPELL,
        playerId,
        action: { spell: null },
        reasoning: 'No castable spells with available mana',
        confidence: 0.8,
      };
    }
    
    // Evaluate and rank spells by value
    const evaluatedSpells = castableCards.map((card: any) => ({
      card,
      value: this.evaluateSpellValue(card, gameState, playerId),
    }));
    
    // Sort by value (descending) and pick the best
    evaluatedSpells.sort((a: any, b: any) => b.value - a.value);
    const bestSpell = evaluatedSpells[0];
    
    // Only cast if value is positive (worth casting)
    if (bestSpell.value > 0) {
      return {
        type: AIDecisionType.CAST_SPELL,
        playerId,
        action: { spell: bestSpell.card, targets: [] },
        reasoning: `Casting ${bestSpell.card.name || 'spell'} (value: ${bestSpell.value})`,
        confidence: Math.min(0.9, 0.5 + bestSpell.value / 20),
      };
    }
    
    return {
      type: AIDecisionType.CAST_SPELL,
      playerId,
      action: { spell: null },
      reasoning: 'No valuable spells to cast',
      confidence: 0.6,
    };
  }
  
  /**
   * Evaluate the value of casting a spell in the current game state
   */
  private evaluateSpellValue(card: any, gameState: GameState, playerId: PlayerID): number {
    let value = 0;
    const typeLine = (card.type_line || '').toLowerCase();
    const oracleText = (card.oracle_text || '').toLowerCase();
    const cmc = card.cmc || card.mana_value || 0;
    
    // Base value from card characteristics
    if (typeLine.includes('creature')) {
      const power = parseInt(card.power || '0', 10);
      const toughness = parseInt(card.toughness || '0', 10);
      value += (power + toughness) * 2;
      
      // Keywords increase value
      if (oracleText.includes('flying')) value += 3;
      if (oracleText.includes('haste')) value += 2;
      if (oracleText.includes('trample')) value += 2;
      if (oracleText.includes('deathtouch')) value += 3;
      if (oracleText.includes('lifelink')) value += 2;
      if (oracleText.includes('vigilance')) value += 1;
    }
    
    if (typeLine.includes('instant') || typeLine.includes('sorcery')) {
      // Removal spells are valuable
      if (oracleText.includes('destroy target') || oracleText.includes('exile target')) {
        value += 5;
      }
      // Card draw is valuable
      if (oracleText.includes('draw')) {
        const drawMatch = oracleText.match(/draw (\d+)/);
        value += drawMatch ? parseInt(drawMatch[1], 10) * 3 : 3;
      }
      // Counter spells require timing awareness
      if (oracleText.includes('counter target')) {
        // Only valuable if there's something to counter
        if ((gameState.stack || []).length > 0) {
          value += 6;
        } else {
          value -= 5; // Don't cast counters with empty stack
        }
      }
    }
    
    if (typeLine.includes('artifact')) {
      value += 3;
      // Mana artifacts are more valuable early
      if (oracleText.includes('add') && oracleText.includes('mana')) {
        const turn = gameState.turn || 1;
        value += Math.max(0, 8 - turn); // More valuable early game
      }
    }
    
    if (typeLine.includes('enchantment')) {
      value += 3;
      // Auras need targets
      if (typeLine.includes('aura')) {
        // Check if we have valid targets
        const player = gameState.players.find(p => p.id === playerId);
        const hasCreatures = (player?.battlefield || []).some((p: any) => 
          p.card?.type_line?.toLowerCase().includes('creature')
        );
        if (!hasCreatures) {
          value -= 10; // No targets for aura
        }
      }
    }
    
    // Penalize high-cost spells early game
    const turn = gameState.turn || 1;
    if (cmc > turn + 2) {
      value -= 3; // Probably shouldn't cast this yet
    }
    
    // Board state awareness
    const player = gameState.players.find(p => p.id === playerId);
    const creatureCount = (player?.battlefield || []).filter((p: any) =>
      p.card?.type_line?.toLowerCase().includes('creature')
    ).length;
    
    // Buff spells more valuable with creatures
    if (oracleText.includes('+1/+1') || oracleText.includes('+2/+2')) {
      value += creatureCount > 0 ? 3 : -5;
    }
    
    return value;
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
   * Focuses on counter spells, removal, and card advantage.
   * Attacks only when in a dominant position.
   */
  private makeControlDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { gameState, playerId, decisionType, options } = context;
    
    switch (decisionType) {
      case AIDecisionType.DECLARE_ATTACKERS: {
        // Control AI only attacks when in a dominant position
        const player = gameState.players.find(p => p.id === playerId);
        const opponents = gameState.players.filter(p => p.id !== playerId);
        
        // Check if we have board dominance
        const myCreatureCount = (player?.battlefield || []).filter((p: any) =>
          p.card?.type_line?.toLowerCase().includes('creature')
        ).length;
        
        const opponentCreatureCount = opponents.reduce((sum, opp) => 
          sum + ((opp.battlefield || []).filter((p: any) =>
            p.card?.type_line?.toLowerCase().includes('creature')
          ).length), 0);
        
        // Attack only if we have significant board advantage
        if (myCreatureCount > opponentCreatureCount + 2) {
          const legalAttackerIds = getLegalAttackers(gameState, playerId);
          // Attack with creatures that won't die in combat
          const safeAttackers = legalAttackerIds.filter(id => {
            const perm = player?.battlefield?.find((p: any) => p.id === id);
            const toughness = parseInt(perm?.card?.toughness || '0', 10);
            return toughness >= 3; // Only attack with tough creatures
          });
          
          return {
            type: AIDecisionType.DECLARE_ATTACKERS,
            playerId,
            action: { attackers: safeAttackers },
            reasoning: `Control: safe attacks with ${safeAttackers.length} protected creatures`,
            confidence: 0.7,
          };
        }
        
        return {
          type: AIDecisionType.DECLARE_ATTACKERS,
          playerId,
          action: { attackers: [] },
          reasoning: 'Control: holding back, waiting for board control',
          confidence: 0.8,
        };
      }
      
      case AIDecisionType.CAST_SPELL: {
        const player = gameState.players.find(p => p.id === playerId);
        const hand = player?.hand || [];
        
        // Prioritize holding up mana for counterspells
        const hasCounterInHand = hand.some((card: any) => 
          (card.oracle_text || '').toLowerCase().includes('counter target')
        );
        
        // Check if opponent has untapped mana (might cast something)
        const opponentHasMana = gameState.players.some(p => {
          if (p.id === playerId) return false;
          const pool = p.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
          return pool.white + pool.blue + pool.black + pool.red + pool.green + pool.colorless > 0;
        });
        
        // If we have a counter and opponent might cast, hold mana
        if (hasCounterInHand && opponentHasMana && (gameState.stack || []).length === 0) {
          return {
            type: AIDecisionType.CAST_SPELL,
            playerId,
            action: { spell: null },
            reasoning: 'Control: holding counter spell mana',
            confidence: 0.8,
          };
        }
        
        // Otherwise, prioritize removal and card draw
        const prioritizedSpells = hand
          .filter((card: any) => {
            const text = (card.oracle_text || '').toLowerCase();
            return text.includes('destroy target') || 
                   text.includes('exile target') ||
                   text.includes('draw') ||
                   text.includes('counter target');
          })
          .sort((a: any, b: any) => {
            const aText = (a.oracle_text || '').toLowerCase();
            const bText = (b.oracle_text || '').toLowerCase();
            // Prioritize removal > draw > counter (when stack empty)
            let aScore = 0, bScore = 0;
            if (aText.includes('destroy') || aText.includes('exile')) aScore += 10;
            if (bText.includes('destroy') || bText.includes('exile')) bScore += 10;
            if (aText.includes('draw')) aScore += 5;
            if (bText.includes('draw')) bScore += 5;
            return bScore - aScore;
          });
        
        if (prioritizedSpells.length > 0) {
          return {
            type: AIDecisionType.CAST_SPELL,
            playerId,
            action: { spell: prioritizedSpells[0] },
            reasoning: `Control: casting high-value spell ${prioritizedSpells[0].name}`,
            confidence: 0.7,
          };
        }
        
        return this.makeBasicCastDecision(context, config);
      }
      
      default:
        return this.makeBasicDecision(context, config);
    }
  }
  
  /**
   * Combo strategy decisions
   * Focuses on finding and protecting combo pieces, ramping mana, and drawing cards.
   */
  private makeComboDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { gameState, playerId, decisionType, options } = context;
    
    switch (decisionType) {
      case AIDecisionType.DECLARE_ATTACKERS: {
        // Combo AI rarely attacks - preserve creatures for combos
        const player = gameState.players.find(p => p.id === playerId);
        const life = player?.life || 0;
        
        // Only attack if life is safe and we have extra creatures
        if (life > 20) {
          const legalAttackerIds = getLegalAttackers(gameState, playerId);
          // Only attack with "extra" creatures (not combo pieces)
          // Combo pieces typically have valuable abilities in their text
          const nonComboPieces = legalAttackerIds.filter(id => {
            const perm = player?.battlefield?.find((p: any) => p.id === id);
            const text = (perm?.card?.oracle_text || '').toLowerCase();
            // Keep cards with activated abilities or important triggers
            return !text.includes(':') && !text.includes('whenever') && !text.includes('when');
          });
          
          return {
            type: AIDecisionType.DECLARE_ATTACKERS,
            playerId,
            action: { attackers: nonComboPieces },
            reasoning: `Combo: attacking only with non-essential creatures (${nonComboPieces.length})`,
            confidence: 0.6,
          };
        }
        
        return {
          type: AIDecisionType.DECLARE_ATTACKERS,
          playerId,
          action: { attackers: [] },
          reasoning: 'Combo: preserving all creatures for potential combos',
          confidence: 0.9,
        };
      }
      
      case AIDecisionType.CAST_SPELL: {
        const player = gameState.players.find(p => p.id === playerId);
        const hand = player?.hand || [];
        
        // Prioritize: tutors > card draw > mana ramp > combo pieces
        const prioritizedSpells = hand.sort((a: any, b: any) => {
          const aText = (a.oracle_text || '').toLowerCase();
          const bText = (b.oracle_text || '').toLowerCase();
          
          let aScore = 0, bScore = 0;
          
          // Tutors (search library) are highest priority
          if (aText.includes('search your library')) aScore += 20;
          if (bText.includes('search your library')) bScore += 20;
          
          // Card draw
          if (aText.includes('draw')) {
            const match = aText.match(/draw (\d+)/);
            aScore += match ? parseInt(match[1], 10) * 4 : 4;
          }
          if (bText.includes('draw')) {
            const match = bText.match(/draw (\d+)/);
            bScore += match ? parseInt(match[1], 10) * 4 : 4;
          }
          
          // Mana ramp
          if (aText.includes('add') && aText.includes('mana')) aScore += 8;
          if (bText.includes('add') && bText.includes('mana')) bScore += 8;
          
          // Cards with combo potential (untap effects, infinite loops)
          if (aText.includes('untap') || aText.includes('copy')) aScore += 6;
          if (bText.includes('untap') || bText.includes('copy')) bScore += 6;
          
          return bScore - aScore;
        });
        
        // Cast the highest priority spell we can afford
        const manaPool = player?.manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
        const totalMana = manaPool.white + manaPool.blue + manaPool.black + 
                          manaPool.red + manaPool.green + manaPool.colorless;
        
        const castable = prioritizedSpells.filter((card: any) => 
          (card.cmc || card.mana_value || 0) <= totalMana
        );
        
        if (castable.length > 0) {
          return {
            type: AIDecisionType.CAST_SPELL,
            playerId,
            action: { spell: castable[0] },
            reasoning: `Combo: advancing game plan with ${castable[0].name}`,
            confidence: 0.8,
          };
        }
        
        return {
          type: AIDecisionType.CAST_SPELL,
          playerId,
          action: { spell: null },
          reasoning: 'Combo: saving resources for combo turn',
          confidence: 0.6,
        };
      }
      
      case AIDecisionType.SACRIFICE: {
        // Combo AI tries to avoid sacrificing combo pieces
        const player = gameState.players.find(p => p.id === playerId);
        const battlefield = player?.battlefield || [];
        
        // Sort by combo value (sacrifice least valuable first)
        const sorted = [...battlefield].sort((a: any, b: any) => {
          const aText = (a.card?.oracle_text || '').toLowerCase();
          const bText = (b.card?.oracle_text || '').toLowerCase();
          
          let aValue = 0, bValue = 0;
          
          // Combo pieces have activated abilities or important triggers
          if (aText.includes(':')) aValue += 10;
          if (bText.includes(':')) bValue += 10;
          if (aText.includes('whenever') || aText.includes('when')) aValue += 5;
          if (bText.includes('whenever') || bText.includes('when')) bValue += 5;
          if (aText.includes('untap')) aValue += 8;
          if (bText.includes('untap')) bValue += 8;
          
          return aValue - bValue; // Sacrifice lowest value first
        });
        
        const sacrificeCount = context.constraints?.count || 1;
        const sacrificed = sorted.slice(0, sacrificeCount).map((p: any) => p.id);
        
        return {
          type: AIDecisionType.SACRIFICE,
          playerId,
          action: { sacrificed },
          reasoning: `Combo: sacrificing ${sacrificed.length} non-essential permanent(s)`,
          confidence: 0.7,
        };
      }
      
      default:
        return this.makeBasicDecision(context, config);
    }
  }
  
  // ============================================================================
  // New Decision Methods for Enhanced Automation
  // ============================================================================
  
  /**
   * Make a sacrifice decision - choose which permanent to sacrifice
   * Uses value heuristics to sacrifice least valuable permanents first
   */
  private makeSacrificeDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { playerId, options, constraints } = context;
    const sacrificeCount = constraints?.count || 1;
    const permanentType = constraints?.type || 'permanent';
    
    // Get player's permanents that can be sacrificed
    const player = context.gameState.players.find(p => p.id === playerId);
    if (!player || !player.battlefield) {
      return {
        type: AIDecisionType.SACRIFICE,
        playerId,
        action: { sacrificed: [] },
        reasoning: 'No permanents to sacrifice',
        confidence: 0,
      };
    }
    
    // Filter to only valid sacrifice targets
    let validTargets = player.battlefield.filter((perm: BattlefieldPermanent) => {
      const card = perm.card as KnownCardRef;
      const typeLine = (card?.type_line || '').toLowerCase();
      
      if (permanentType === 'creature') return typeLine.includes('creature');
      if (permanentType === 'artifact') return typeLine.includes('artifact');
      if (permanentType === 'enchantment') return typeLine.includes('enchantment');
      if (permanentType === 'land') return typeLine.includes('land');
      return true; // 'permanent' = any
    });
    
    // Sort by value (sacrifice least valuable first)
    validTargets.sort((a: BattlefieldPermanent, b: BattlefieldPermanent) => {
      const aValue = this.evaluatePermanentValue(a);
      const bValue = this.evaluatePermanentValue(b);
      return aValue - bValue; // Ascending - sacrifice lowest value first
    });
    
    // Select the required number
    const sacrificed = validTargets.slice(0, sacrificeCount).map((p: BattlefieldPermanent) => p.id);
    
    return {
      type: AIDecisionType.SACRIFICE,
      playerId,
      action: { sacrificed },
      reasoning: `Sacrificing ${sacrificed.length} least valuable ${permanentType}(s)`,
      confidence: 0.7,
    };
  }
  
  /**
   * Evaluate the value of a permanent for AI decision-making
   */
  private evaluatePermanentValue(perm: BattlefieldPermanent): number {
    const card = perm.card as KnownCardRef;
    let value = 0;
    
    // Base value from card characteristics
    const typeLine = (card?.type_line || '').toLowerCase();
    
    // Creatures: value based on power + toughness
    if (typeLine.includes('creature')) {
      const power = getCreaturePower(perm);
      const toughness = getCreatureToughness(perm);
      value += (power + toughness) * 2;
      
      // Keyword abilities add value
      const keywords = extractCombatKeywords(perm);
      if (keywords.flying) value += 3;
      if (keywords.deathtouch) value += 4;
      if (keywords.lifelink) value += 3;
      if (keywords.trample) value += 2;
      if (keywords.indestructible) value += 10;
      if (keywords.doubleStrike) value += 5;
    }
    
    // Artifacts: moderate value
    if (typeLine.includes('artifact')) {
      value += 3;
      // Mana artifacts worth more
      const oracleText = (card?.oracle_text || '').toLowerCase();
      if (oracleText.includes('add') && oracleText.includes('mana')) value += 4;
    }
    
    // Enchantments: moderate value
    if (typeLine.includes('enchantment')) value += 4;
    
    // Lands: low value (basics), higher for non-basics
    if (typeLine.includes('land')) {
      const isBasic = typeLine.includes('basic');
      value += isBasic ? 1 : 3;
    }
    
    // Tokens are less valuable than non-tokens
    if (perm.isToken) value -= 2;
    
    // +1/+1 counters add value
    value += (perm.counters?.['+1/+1'] || 0) * 2;
    
    return Math.max(0, value);
  }
  
  /**
   * Make a target selection decision
   */
  private makeTargetDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { playerId, options, constraints } = context;
    const targetCount = constraints?.count || 1;
    const targetType = constraints?.type || 'any';
    
    if (!options || options.length === 0) {
      return {
        type: AIDecisionType.SELECT_TARGET,
        playerId,
        action: { targets: [] },
        reasoning: 'No valid targets',
        confidence: 0,
      };
    }
    
    // For creature targets: prioritize biggest threats
    // For player targets: prioritize opponent with lowest life
    let selectedTargets: string[] = [];
    
    if (targetType === 'creature' || targetType === 'permanent') {
      // Sort by threat level (descending) and select top targets
      const sorted = [...options].sort((a: any, b: any) => {
        const aValue = typeof a === 'object' ? this.evaluatePermanentValue(a) : 0;
        const bValue = typeof b === 'object' ? this.evaluatePermanentValue(b) : 0;
        return bValue - aValue; // Descending - target highest value first
      });
      selectedTargets = sorted.slice(0, targetCount).map((t: any) => 
        typeof t === 'string' ? t : t.id
      );
    } else if (targetType === 'player') {
      // Filter options to only include players, then sort by lowest life
      const playerOptions = options.filter((opt: any) => {
        const optId = typeof opt === 'string' ? opt : opt.id;
        return context.gameState.players.some(p => p.id === optId && p.id !== playerId);
      });
      
      // Sort by life total (ascending - target lowest life first)
      playerOptions.sort((a: any, b: any) => {
        const aId = typeof a === 'string' ? a : a.id;
        const bId = typeof b === 'string' ? b : b.id;
        const aPlayer = context.gameState.players.find(p => p.id === aId);
        const bPlayer = context.gameState.players.find(p => p.id === bId);
        return (aPlayer?.life || 0) - (bPlayer?.life || 0);
      });
      
      selectedTargets = playerOptions.slice(0, targetCount).map((p: any) => 
        typeof p === 'string' ? p : p.id
      );
    } else {
      // Default: random selection from provided options
      const shuffled = [...options].sort(() => Math.random() - 0.5);
      selectedTargets = shuffled.slice(0, targetCount).map((t: any) =>
        typeof t === 'string' ? t : t.id
      );
    }
    
    return {
      type: AIDecisionType.SELECT_TARGET,
      playerId,
      action: { targets: selectedTargets },
      reasoning: `Selected ${selectedTargets.length} target(s)`,
      confidence: 0.7,
    };
  }
  
  /**
   * Make a triggered ability decision (e.g., "may" abilities)
   */
  private makeTriggeredAbilityDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { playerId, constraints } = context;
    const isOptional = constraints?.optional || false;
    const effectText = constraints?.effect || '';
    
    // For "may" abilities, use heuristics to decide
    if (isOptional) {
      // Generally beneficial effects: drawing, life gain, creature buffs
      const beneficial = 
        effectText.includes('draw') ||
        effectText.includes('gain') ||
        effectText.includes('+1/+1') ||
        effectText.includes('create') ||
        effectText.includes('search');
      
      // Generally harmful effects: discard, sacrifice, lose life
      const harmful =
        effectText.includes('discard') ||
        effectText.includes('sacrifice') ||
        effectText.includes('lose') ||
        effectText.includes('damage to you');
      
      const accept = beneficial && !harmful;
      
      return {
        type: AIDecisionType.TRIGGERED_ABILITY,
        playerId,
        action: { accept, triggered: true },
        reasoning: accept ? 'Accepting beneficial trigger' : 'Declining harmful/neutral trigger',
        confidence: 0.7,
      };
    }
    
    // Non-optional: must resolve
    return {
      type: AIDecisionType.TRIGGERED_ABILITY,
      playerId,
      action: { accept: true, triggered: true },
      reasoning: 'Mandatory trigger - must resolve',
      confidence: 1,
    };
  }
  
  /**
   * Make a damage assignment decision (for multiple blockers with trample)
   */
  private makeDamageAssignmentDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { playerId, constraints, options } = context;
    const attacker = constraints?.attacker;
    const blockers = constraints?.blockers || [];
    const hasTrample = constraints?.trample || false;
    
    if (!attacker || blockers.length === 0) {
      return {
        type: AIDecisionType.ASSIGN_DAMAGE,
        playerId,
        action: { assignments: [], trampleDamage: 0 },
        reasoning: 'No blockers to assign damage to',
        confidence: 1,
      };
    }
    
    // Use combat automation to calculate lethal damage
    const attackerCreature = createCombatCreature(attacker);
    const blockerCreatures = blockers.map((b: BattlefieldPermanent) => createCombatCreature(b));
    
    // Sort blockers by toughness (kill smallest first to maximize trample)
    blockerCreatures.sort((a: CombatCreature, b: CombatCreature) => a.toughness - b.toughness);
    
    const assignments: { blockerId: string; damage: number }[] = [];
    let remainingPower = attackerCreature.power;
    
    for (const blocker of blockerCreatures) {
      if (remainingPower <= 0) break;
      
      const lethalDamage = calculateLethalDamage(attackerCreature, blocker);
      const assigned = Math.min(remainingPower, lethalDamage);
      
      assignments.push({
        blockerId: blocker.id,
        damage: assigned,
      });
      
      remainingPower -= assigned;
    }
    
    const trampleDamage = hasTrample ? remainingPower : 0;
    
    return {
      type: AIDecisionType.ASSIGN_DAMAGE,
      playerId,
      action: { assignments, trampleDamage },
      reasoning: `Assigned damage to ${assignments.length} blockers, ${trampleDamage} trample`,
      confidence: 0.9,
    };
  }
  
  /**
   * Make a blocker ordering decision
   */
  private makeBlockerOrderDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { playerId, options } = context;
    const blockers = options || [];
    
    if (blockers.length === 0) {
      return {
        type: AIDecisionType.ORDER_BLOCKERS,
        playerId,
        action: { order: [] },
        reasoning: 'No blockers to order',
        confidence: 1,
      };
    }
    
    // Order blockers by toughness ascending (kill smallest first for maximum trample)
    const ordered = [...blockers].sort((a: any, b: any) => {
      const aToughness = typeof a === 'object' ? getCreatureToughness(a) : 0;
      const bToughness = typeof b === 'object' ? getCreatureToughness(b) : 0;
      return aToughness - bToughness;
    });
    
    const order = ordered.map((b: any) => typeof b === 'string' ? b : b.id);
    
    return {
      type: AIDecisionType.ORDER_BLOCKERS,
      playerId,
      action: { order },
      reasoning: 'Ordered blockers by ascending toughness',
      confidence: 0.8,
    };
  }
  
  /**
   * Make a token creation decision (for effects that let you choose token type)
   * Evaluates token options based on power/toughness and utility
   */
  private makeTokenCreationDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { playerId, options, constraints } = context;
    const tokenType = constraints?.type || 'creature';
    const count = constraints?.count || 1;
    
    let selectedToken = '1/1 Soldier'; // Default creature
    
    if (tokenType === 'artifact') {
      // Prefer Treasure for mana flexibility
      selectedToken = 'Treasure';
    } else if (options && options.length > 0) {
      // Evaluate token options and pick the best one
      let bestToken = options[0];
      let bestValue = 0;
      
      for (const tokenName of options) {
        const value = this.evaluateTokenValue(tokenName);
        if (value > bestValue) {
          bestValue = value;
          bestToken = tokenName;
        }
      }
      
      selectedToken = bestToken;
    }
    
    return {
      type: AIDecisionType.CREATE_TOKEN,
      playerId,
      action: { tokenType: selectedToken, count },
      reasoning: `Creating ${count}x ${selectedToken}`,
      confidence: 0.8,
    };
  }
  
  /**
   * Evaluate token value based on name/characteristics
   */
  private evaluateTokenValue(tokenName: string): number {
    // Parse power/toughness from token name if present
    const ptMatch = tokenName.match(/(\d+)\/(\d+)/);
    if (ptMatch) {
      const power = parseInt(ptMatch[1], 10);
      const toughness = parseInt(ptMatch[2], 10);
      let value = power + toughness;
      
      // Keywords add value
      const lowerName = tokenName.toLowerCase();
      if (lowerName.includes('flying')) value += 2;
      if (lowerName.includes('deathtouch')) value += 3;
      if (lowerName.includes('lifelink')) value += 2;
      if (lowerName.includes('haste')) value += 1;
      if (lowerName.includes('trample')) value += 1;
      
      return value;
    }
    
    // Non-creature tokens (artifacts)
    const lowerName = tokenName.toLowerCase();
    if (lowerName.includes('treasure')) return 4; // Mana flexibility
    if (lowerName.includes('food')) return 3; // Life gain
    if (lowerName.includes('clue')) return 3; // Card draw
    if (lowerName.includes('blood')) return 2; // Card filtering
    
    return 1; // Unknown token
  }
  
  /**
   * Make a mode choice decision (for modal spells/abilities)
   * Analyzes mode text for beneficial vs harmful effects
   */
  private makeModeChoiceDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { playerId, options, constraints } = context;
    const modeCount = constraints?.count || 1;
    
    if (!options || options.length === 0) {
      return {
        type: AIDecisionType.CHOOSE_MODE,
        playerId,
        action: { modes: [] },
        reasoning: 'No modes available',
        confidence: 0,
      };
    }
    
    // Score each mode and pick the best ones
    const scoredModes = options.map((mode: any) => ({
      mode,
      score: this.evaluateModeValue(mode),
    }));
    
    // Sort by score descending
    scoredModes.sort((a: any, b: any) => b.score - a.score);
    
    // Select top N modes
    const selectedModes = scoredModes.slice(0, modeCount).map((m: any) => m.mode);
    
    return {
      type: AIDecisionType.CHOOSE_MODE,
      playerId,
      action: { modes: selectedModes },
      reasoning: `Selected ${selectedModes.length} highest-value mode(s)`,
      confidence: 0.7,
    };
  }
  
  /**
   * Evaluate the value of a modal option
   */
  private evaluateModeValue(mode: any): number {
    const modeText = (typeof mode === 'string' ? mode : mode.text || '').toLowerCase();
    let value = 5; // Base value
    
    // Beneficial effects increase value
    if (modeText.includes('draw')) value += 4;
    if (modeText.includes('destroy') && !modeText.includes('your')) value += 4;
    if (modeText.includes('exile') && !modeText.includes('your')) value += 4;
    if (modeText.includes('counter')) value += 3;
    if (modeText.includes('gain') && modeText.includes('life')) value += 2;
    if (modeText.includes('create')) value += 3;
    if (modeText.includes('+1/+1')) value += 2;
    if (modeText.includes('search')) value += 3;
    if (modeText.includes('return') && modeText.includes('hand')) value += 2;
    if (modeText.includes('damage') && !modeText.includes('to you')) value += 3;
    
    // Harmful effects decrease value
    if (modeText.includes('sacrifice') && modeText.includes('you')) value -= 3;
    if (modeText.includes('discard') && !modeText.includes('opponent')) value -= 2;
    if (modeText.includes('lose') && modeText.includes('life') && !modeText.includes('opponent')) value -= 2;
    if (modeText.includes('damage to you')) value -= 3;
    
    return Math.max(0, value);
  }
  
  /**
   * Make a discard decision
   */
  private makeDiscardDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    const { playerId, constraints } = context;
    const discardCount = constraints?.count || 1;
    
    const player = context.gameState.players.find(p => p.id === playerId);
    if (!player || !player.hand || player.hand.length === 0) {
      return {
        type: AIDecisionType.DISCARD,
        playerId,
        action: { discarded: [] },
        reasoning: 'No cards to discard',
        confidence: 0,
      };
    }
    
    // Sort hand by value and discard least valuable cards
    const handWithValue = player.hand.map((card: any) => ({
      card,
      value: this.evaluateCardValue(card),
    }));
    
    handWithValue.sort((a: any, b: any) => a.value - b.value);
    
    const discarded = handWithValue.slice(0, discardCount).map((c: any) => c.card.id);
    
    return {
      type: AIDecisionType.DISCARD,
      playerId,
      action: { discarded },
      reasoning: `Discarding ${discarded.length} lowest value card(s)`,
      confidence: 0.7,
    };
  }
  
  /**
   * Evaluate the value of a card in hand
   */
  private evaluateCardValue(card: any): number {
    let value = 0;
    const types = card.types || [];
    const cmc = card.cmc || card.mana_value || 0;
    
    // Lands are generally low value in hand (but needed for mana)
    if (types.includes('Land')) {
      value = 2;
    }
    // Creatures: value based on CMC (proxy for power)
    else if (types.includes('Creature')) {
      value = 3 + cmc;
    }
    // Instants/Sorceries: moderate value
    else if (types.includes('Instant') || types.includes('Sorcery')) {
      value = 4 + cmc;
    }
    // Other permanents
    else {
      value = 3 + cmc;
    }
    
    return value;
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
