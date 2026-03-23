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
 * 
 * DIFFICULTY SYSTEM:
 * The difficulty parameter (0-1) affects AI decision quality:
 * - 0.0-0.33 (Easy): Makes more mistakes, misses obvious plays, poor evaluation
 * - 0.34-0.66 (Medium): Decent play, occasional mistakes
 * - 0.67-1.0 (Hard): Optimal play, rarely makes mistakes
 * 
 * IMPORTANT: Mistakes are HIGH-LEVEL tactical/strategic errors, NOT low-level game-rule mistakes
 * ✓ GOOD mistakes: Attacking with too few/many creatures, poor threat assessment, suboptimal targeting
 * ✗ BAD mistakes: Buffing opponent's creatures, destroying own permanents, clearly nonsensical plays
 * 
 * Difficulty affects:
 * 1. Aggression Level: Lower difficulty = poor timing on when to attack/hold back
 * 2. Resource Management: Lower difficulty = wastes creatures/spells unnecessarily
 * 3. Threat Assessment: Lower difficulty = poor at identifying the biggest threat
 * 4. Risk Evaluation: Lower difficulty = takes bad risks or plays too safe
 * 
 * CONCRETE MISTAKE EXAMPLES:
 * 
 * SCENARIO 1 - Attack Decision Mistakes (CURRENTLY IMPLEMENTED):
 * Board State: AI has 5 creatures (3/3, 3/3, 2/2, 1/1, 0/4 defender)
 * Opponent: 15 life, 2 untapped blockers (2/2, 2/2)
 * 
 * HARD AI (optimal, difficulty 1.0):
 *   - Attacks with 3/3, 3/3, 2/2 (ignores 1/1 and defender)
 *   - Reasoning: Max pressure while minimizing loss to blocks
 *   - Expected damage: ~5-7 (opponent blocks two creatures)
 * 
 * MEDIUM AI (occasional mistakes, difficulty 0.5):
 *   - Usually attacks optimally (90% of the time)
 *   - 10% chance of mistake (too cautious or overcommitting)
 * 
 * EASY AI (frequent mistakes, difficulty 0.2):
 *   Mistake Type A - Too Cautious (50% when shouldMakeMistake=true, ~20% overall):
 *     - Only attacks with one 3/3 creature
 *     - Misses opportunity to apply pressure
 *     - Expected damage: 0-3
 *     - Why this is a GOOD mistake: Tactically poor but not nonsensical
 *   
 *   Mistake Type B - Overcommitting (50% when shouldMakeMistake=true, ~20% overall):
 *     - Attacks with ALL creatures including weak 1/1 and defender
 *     - Trades weak creatures unnecessarily  
 *     - Expected damage: 3-5 but loses more creatures
 *     - Why this is a GOOD mistake: Strategically poor but follows game rules
 * 
 * SCENARIO 2 - Blocking Decision Mistakes (TODO - not yet implemented):
 * Incoming Attackers: 4/4, 3/3, 2/2
 * AI Blockers: 5/5, 3/3, 1/1
 * AI Life: 8
 * 
 * HARD AI (optimal):
 *   - Block 4/4 with 5/5 (kills it, survives)
 *   - Block 3/3 with 3/3 (mutual destruction)
 *   - Take 2 damage from 2/2
 *   - Result: 6 life, traded efficiently
 * 
 * EASY AI (makes mistakes):
 *   GOOD mistake: Block only the 2/2 with 5/5 (inefficient, but valid strategy)
 *   BAD mistake (AVOID): Block own creatures, block with tapped creatures
 * 
 * SCENARIO 3 - Targeting Mistakes (TODO - not yet implemented):
 * Spell: "Destroy target creature"
 * Opponent has: 10/10 indestructible threat, 6/6 flying threat, 2/2 utility creature
 * 
 * HARD AI: Targets 6/6 (best valid target)
 * EASY AI: 30% chance to target the 2/2 instead (poor threat assessment)
 * AVOID: Targeting the indestructible creature (game-rule mistake)
 * AVOID: Targeting own creature (nonsensical)
 * 
 * SCENARIO 4 - Spell Timing Mistakes (TODO - not yet implemented):
 * AI has: Removal spell, opponent has 2/2 and will play 5/5 next turn
 * 
 * HARD AI: Waits to use removal on the 5/5
 * EASY AI: Uses removal on 2/2 immediately (poor resource management)
 * AVOID: Never casting the spell (game-breaking)
 * 
 * Implementation: Use shouldMakeMistake(difficulty) to probabilistically choose
 * between optimal and suboptimal (but valid) decisions based on difficulty level.
 */

import type { GameState, PlayerID, BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { 
  canPermanentAttack,
  canPermanentBlock,
  isCurrentlyCreature,
  isGoaded,
  getGoadedBy,
} from './actions/combat';
import {
  canCreatureAttack,
  calculateLethalDamage,
  type CombatKeywords,
} from './combatAutomation';
import {
  COMMON_TOKENS,
  createTokensByName,
  type TokenCharacteristics,
} from './tokenCreation';
import {
  cardAnalyzer,
  CardCategory,
  ThreatLevel,
  SynergyArchetype,
  type CardAnalysis,
  type BattlefieldAnalysis,
  type DeckArchetypeProfile,
} from './CardAnalyzer';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';
import {
  detectActivatedAbility,
  evaluateActivatedAbilityValue,
  canActivateAbilityNow,
  findBestActivatedAbility,
} from './aiEngineActivatedAbilitySupport';
import {
  evaluateDeathTrigger,
  evaluatePermanentValue,
  evaluateCombatValue,
  evaluateTokenValue,
  evaluateModeValue,
  evaluateCardValue,
} from './aiEngineValueSupport';
import {
  countOpponentThreats as countOpponentThreatsFromSupport,
  evaluateSpellValue as evaluateSpellValueFromSupport,
} from './aiEngineSpellSupport';
import {
  assessBattlefieldThreats as assessBattlefieldThreatsFromSupport,
  getRemovalReason as getRemovalReasonFromSupport,
  selectAttackTarget as selectAttackTargetFromSupport,
} from './aiEngineThreatSupport';
import {
  getPrimaryArchetypes as getPrimaryArchetypesFromSupport,
  getCombatDeckModifiers as getCombatDeckModifiersFromSupport,
  hasPotentialManaSink as hasPotentialManaSinkFromSupport,
} from './aiEngineDeckSupport';
import {
  makeRandomDecision as makeRandomDecisionFromSupport,
  makeBasicDecision as makeBasicDecisionFromSupport,
  makeBasicMulliganDecision as makeBasicMulliganDecisionFromSupport,
} from './aiEngineCoreSupport';
import {
  makeTokenCreationDecision as makeTokenCreationDecisionFromSupport,
  makeModeChoiceDecision as makeModeChoiceDecisionFromSupport,
  makeDiscardDecision as makeDiscardDecisionFromSupport,
} from './aiEngineChoiceSupport';
import {
  makeTriggeredAbilityDecision as makeTriggeredAbilityDecisionFromSupport,
  makeDamageAssignmentDecision as makeDamageAssignmentDecisionFromSupport,
  makeBlockerOrderDecision as makeBlockerOrderDecisionFromSupport,
} from './aiEngineResponseSupport';
import { makeTargetDecision as makeTargetDecisionFromSupport } from './aiEngineTargetSupport';
import {
  makeBasicAttackDecision as makeBasicAttackDecisionFromSupport,
  makeBasicBlockDecision as makeBasicBlockDecisionFromSupport,
} from './aiEngineCombatSupport';
import { makeBasicCastDecision as makeBasicCastDecisionFromSupport } from './aiEngineCastSupport';
import {
  makeAggressiveDecision as makeAggressiveDecisionFromSupport,
  makeDefensiveDecision as makeDefensiveDecisionFromSupport,
  makeControlDecision as makeControlDecisionFromSupport,
  makeComboDecision as makeComboDecisionFromSupport,
} from './aiEngineStrategySupport';
import { makeSacrificeDecision as makeSacrificeDecisionFromSupport } from './aiEngineSacrificeSupport';

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
  readonly deckProfile?: DeckArchetypeProfile;
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

  private getProcessedBattlefield(gameState: GameState): BattlefieldPermanent[] {
    return applyStaticAbilitiesToBattlefield((gameState.battlefield || []) as BattlefieldPermanent[]);
  }

  private hasPermanentType(perm: BattlefieldPermanent, type: string): boolean {
    const targetType = type.toLowerCase();

    if (targetType === 'creature' && isCurrentlyCreature(perm)) {
      return true;
    }

    const effectiveTypes = Array.isArray((perm as any).effectiveTypes)
      ? (perm as any).effectiveTypes
      : [];
    if (effectiveTypes.some((entry: unknown) => String(entry).toLowerCase() === targetType)) {
      return true;
    }

    const grantedTypes = Array.isArray((perm as any).grantedTypes)
      ? (perm as any).grantedTypes
      : [];
    if (grantedTypes.some((entry: unknown) => String(entry).toLowerCase() === targetType)) {
      return true;
    }

    const cardType = String((perm as any).cardType || '').toLowerCase();
    if (cardType.includes(targetType)) {
      return true;
    }

    const typeLine = String((perm.card as KnownCardRef | undefined)?.type_line || (perm as any).type_line || '').toLowerCase();
    return typeLine.includes(targetType);
  }
  
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
   * Determine if AI should make a mistake based on difficulty level.
   * 
   * CRITICAL: Mistakes must be HIGH-LEVEL strategic/tactical errors, not game-rule violations.
   * Examples of VALID mistakes: attacking with too few/many creatures, poor threat assessment
   * Examples of INVALID mistakes: buffing opponent's creatures, targeting invalid targets
   * 
   * @param difficulty - AI difficulty (0-1): 0 = easy (many mistakes), 1 = hard (rare mistakes)
   * @returns true if AI should make a suboptimal choice
   * 
   * Mistake probabilities:
   * - difficulty 0.0 (easy): 40% chance of mistake per decision
   * - difficulty 0.5 (medium): 10% chance of mistake per decision
   * - difficulty 1.0 (hard): 0% chance of mistake (always optimal)
   * 
   * Formula: mistakeRate = 0.4 * (1 - difficulty)^2
   * This quadratic decay ensures hard AI rarely makes mistakes while easy AI is inconsistent
   */
  private shouldMakeMistake(difficulty: number = 0.5): boolean {
    // Mistake rate decreases quadratically with difficulty
    // 0.4 * (1-0)^2 = 0.40 (40% at difficulty 0)
    // 0.4 * (1-0.5)^2 = 0.10 (10% at difficulty 0.5)
    // 0.4 * (1-1)^2 = 0.00 (0% at difficulty 1.0)
    const mistakeRate = 0.4 * Math.pow(1 - difficulty, 2);
    return Math.random() < mistakeRate;
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

  private getPrimaryArchetypes(config: AIPlayerConfig): readonly SynergyArchetype[] {
    return getPrimaryArchetypesFromSupport(config);
  }

  private getCombatDeckModifiers(
    perm: BattlefieldPermanent,
    config: AIPlayerConfig
  ): { attackBias: number; preserveBias: number } {
    return getCombatDeckModifiersFromSupport(perm, config);
  }

  private hasPotentialManaSink(gameState: GameState, playerId: PlayerID): boolean {
    return hasPotentialManaSinkFromSupport(gameState, playerId);
  }
  
  // ============================================================================
  // Enhanced Card Analysis and Threat Assessment (NEW)
  // ============================================================================
  
  /**
   * Analyze the entire battlefield to assess threats from all opponents
   * Returns prioritized threat information for strategic decision-making
   */
  assessBattlefieldThreats(
    gameState: GameState,
    playerId: PlayerID
  ): {
    playerAnalyses: Map<PlayerID, BattlefieldAnalysis>;
    highestThreatPlayer: PlayerID | null;
    criticalThreats: { permanentId: string; playerId: PlayerID; analysis: CardAnalysis }[];
    comboDetected: boolean;
    recommendedTargets: { permanentId: string; playerId: PlayerID; priority: number; reason: string }[];
  } {
    return assessBattlefieldThreatsFromSupport({
      gameState,
      playerId,
      getProcessedBattlefield: this.getProcessedBattlefield.bind(this),
    });
  }
  
  /**
   * Get a human-readable reason for removing a permanent
   */
  private getRemovalReason(analysis: CardAnalysis): string {
    return getRemovalReasonFromSupport(analysis);
  }
  
  /**
   * Find synergies between cards in hand and the battlefield
   * Helps AI prioritize which cards to cast
   */
  findHandSynergies(
    hand: readonly KnownCardRef[],
    gameState: GameState,
    playerId: PlayerID
  ): { card: KnownCardRef; synergyScore: number; synergiesWith: string[]; analysis: CardAnalysis }[] {
    const battlefield = this.getProcessedBattlefield(gameState);
    const results = cardAnalyzer.findSynergyCards(hand, battlefield, playerId);
    
    return results.map(r => ({
      card: r.card,
      synergyScore: r.synergyScore,
      synergiesWith: r.synergizesWith,
      analysis: cardAnalyzer.analyzeCard(r.card),
    }));
  }
  
  /**
   * Analyze library to identify remaining win conditions and key pieces
   * Uses only known information (not hidden)
   */
  analyzeLibraryForPlanning(
    library: readonly KnownCardRef[],
    battlefield: readonly BattlefieldPermanent[],
    playerId: PlayerID
  ): {
    winConditions: KnownCardRef[];
    comboPieces: KnownCardRef[];
    answers: KnownCardRef[];
    ramp: KnownCardRef[];
    cardDraw: KnownCardRef[];
    tutorTargetPriority: { card: KnownCardRef; priority: number; reason: string }[];
  } {
    const winConditions: KnownCardRef[] = [];
    const comboPieces: KnownCardRef[] = [];
    const answers: KnownCardRef[] = [];
    const ramp: KnownCardRef[] = [];
    const cardDraw: KnownCardRef[] = [];
    const tutorTargets: { card: KnownCardRef; priority: number; reason: string }[] = [];
    
    for (const card of library) {
      const analysis = cardAnalyzer.analyzeCard(card);
      
      // Categorize cards
      if (analysis.categories.includes(CardCategory.FINISHER) || 
          analysis.threatLevel >= ThreatLevel.GAME_WINNING) {
        winConditions.push(card);
        tutorTargets.push({ card, priority: 10, reason: 'Win condition' });
      }
      
      if (analysis.comboPotential >= 7) {
        comboPieces.push(card);
        // Check if we already have combo partners on battlefield
        const battlefieldSynergy = cardAnalyzer.findSynergyCards([card], battlefield, playerId);
        if (battlefieldSynergy.length > 0 && battlefieldSynergy[0].synergyScore >= 8) {
          tutorTargets.push({ card, priority: 9, reason: 'Completes combo on board' });
        } else {
          tutorTargets.push({ card, priority: 6, reason: 'Combo piece' });
        }
      }
      
      if (analysis.categories.includes(CardCategory.REMOVAL) ||
          analysis.categories.includes(CardCategory.BOARD_WIPE) ||
          analysis.categories.includes(CardCategory.COUNTERSPELL)) {
        answers.push(card);
        tutorTargets.push({ card, priority: 5, reason: 'Answer/interaction' });
      }
      
      if (analysis.categories.includes(CardCategory.RAMP)) {
        ramp.push(card);
        tutorTargets.push({ card, priority: 4, reason: 'Mana acceleration' });
      }
      
      if (analysis.categories.includes(CardCategory.DRAW) ||
          analysis.categories.includes(CardCategory.TUTOR)) {
        cardDraw.push(card);
        tutorTargets.push({ card, priority: 7, reason: 'Card advantage' });
      }
    }
    
    // Sort tutor targets by priority
    tutorTargets.sort((a, b) => b.priority - a.priority);
    
    return {
      winConditions,
      comboPieces,
      answers,
      ramp,
      cardDraw,
      tutorTargetPriority: tutorTargets,
    };
  }
  
  /**
   * Decide the best target for removal spells
   * Uses threat assessment and card analysis
   */
  selectRemovalTarget(
    validTargets: readonly BattlefieldPermanent[],
    gameState: GameState,
    playerId: PlayerID,
    spellType: 'destroy' | 'exile' | 'bounce' | 'any' = 'any'
  ): { target: BattlefieldPermanent | null; reason: string; priority: number } {
    // Filter to opponent's permanents
    const opponentTargets = validTargets.filter(t => t.controller !== playerId);
    
    if (opponentTargets.length === 0) {
      return { target: null, reason: 'No valid opponent targets', priority: 0 };
    }
    
    // Analyze each potential target
    const targetAnalyses = opponentTargets.map(target => {
      const analysis = cardAnalyzer.analyzeCard(target);
      let priority = analysis.removalTargetPriority;
      
      // Adjust for removal type effectiveness
      if (spellType === 'destroy' && analysis.details.combatKeywords.includes('indestructible')) {
        priority = 0; // Can't destroy indestructible
      }
      
      // Prefer exiling cards with death triggers
      if (spellType === 'exile' && analysis.details.hasDeathTrigger && 
          analysis.details.deathTriggerBenefitsMe) {
        priority += 2; // Exile avoids the death trigger
      }
      
      // Reduce priority for bouncing high-value ETB creatures (they'll replay them)
      if (spellType === 'bounce' && analysis.details.hasETBTrigger) {
        priority -= 2;
      }
      
      return { target, analysis, priority };
    });
    
    // Sort by priority
    targetAnalyses.sort((a, b) => b.priority - a.priority);
    
    const best = targetAnalyses[0];
    return {
      target: best.target,
      reason: this.getRemovalReason(best.analysis),
      priority: best.priority,
    };
  }
  
  /**
   * Evaluate if a symmetric effect (like Veteran Explorer) is worth using
   */
  evaluateSymmetricEffect(
    card: KnownCardRef,
    gameState: GameState,
    playerId: PlayerID
  ): { worthUsing: boolean; reason: string } {
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return { worthUsing: false, reason: 'Player not found' };
    
    // Count lands for each player
    const battlefield = this.getProcessedBattlefield(gameState);
    const ownLandCount = battlefield.filter(p => 
      p.controller === playerId && 
      this.hasPermanentType(p, 'land')
    ).length;
    
    const opponentLandCounts: number[] = [];
    const opponentThreatLevels: number[] = [];
    
    for (const opp of gameState.players) {
      if (opp.id === playerId) continue;
      
      const oppLands = battlefield.filter(p => 
        p.controller === opp.id && 
        this.hasPermanentType(p, 'land')
      ).length;
      opponentLandCounts.push(oppLands);
      
      // Calculate threat level
      const oppAnalysis = cardAnalyzer.analyzeBattlefield(battlefield, opp.id, playerId);
      opponentThreatLevels.push(oppAnalysis.totalThreatLevel);
    }
    
    const result = cardAnalyzer.shouldUseSymmetricDeathEffect(
      card, 
      ownLandCount, 
      opponentLandCounts, 
      opponentThreatLevels
    );
    
    return { worthUsing: result.shouldUse, reason: result.reason };
  }
  
  /**
   * Find the best creature to sacrifice
   * Prefers creatures with beneficial death triggers (Veteran Explorer style)
   */
  selectSacrificeTarget(
    availableCreatures: readonly BattlefieldPermanent[],
    gameState: GameState,
    playerId: PlayerID,
    preferBeneficialDeath: boolean = true
  ): { creature: BattlefieldPermanent | null; reason: string; priority: number } {
    // First check symmetric effects
    for (const creature of availableCreatures) {
      const card = creature.card as KnownCardRef;
      const evaluation = this.evaluateSymmetricEffect(card, gameState, playerId);
      
      // If it's a symmetric effect that's not worth using, skip it
      const analysis = cardAnalyzer.analyzeCard(creature);
      if (analysis.details.deathTriggerSymmetric && !evaluation.worthUsing) {
        continue;
      }
    }
    
    // Use the card analyzer's sacrifice selection
    const result = cardAnalyzer.findBestSacrificeTarget(availableCreatures, preferBeneficialDeath);
    
    return {
      creature: result.creature,
      reason: result.reason,
      priority: result.priority,
    };
  }
  
  /**
   * Analyze if opponent is setting up a combo
   * Returns warning level and recommendations
   */
  detectOpponentCombo(
    gameState: GameState,
    playerId: PlayerID
  ): {
    comboThreat: 'none' | 'potential' | 'imminent';
    comboPlayers: PlayerID[];
    comboPieces: { playerId: PlayerID; pieces: string[] }[];
    recommendation: string;
  } {
    const assessment = this.assessBattlefieldThreats(gameState, playerId);
    const comboPieces: { playerId: PlayerID; pieces: string[] }[] = [];
    const comboPlayers: PlayerID[] = [];
    
    for (const [oppId, analysis] of assessment.playerAnalyses) {
      if (analysis.comboPiecesOnBoard.length >= 2) {
        comboPlayers.push(oppId);
        comboPieces.push({
          playerId: oppId,
          pieces: [...analysis.comboPiecesOnBoard], // Convert readonly to mutable
        });
      }
    }
    
    let comboThreat: 'none' | 'potential' | 'imminent' = 'none';
    let recommendation = 'No combo threats detected';
    
    if (comboPlayers.length > 0) {
      // Check if it's an imminent threat (multiple pieces on board)
      const maxPieces = Math.max(...comboPieces.map(c => c.pieces.length));
      
      if (maxPieces >= 3) {
        comboThreat = 'imminent';
        recommendation = 'CRITICAL: Opponent has multiple combo pieces! Prioritize disruption immediately.';
      } else if (maxPieces >= 2) {
        comboThreat = 'potential';
        recommendation = 'Warning: Opponent has combo pieces on board. Consider holding interaction.';
      }
    }
    
    // Also check for critical threats that could combo with cards in hand
    if (assessment.criticalThreats.length > 0) {
      for (const threat of assessment.criticalThreats) {
        if (threat.analysis.comboPotential >= 8) {
          comboThreat = comboThreat === 'none' ? 'potential' : comboThreat;
          recommendation = recommendation.includes('combo') 
            ? recommendation 
            : 'Combo-enabling permanent detected. Monitor for additional pieces.';
        }
      }
    }
    
    return {
      comboThreat,
      comboPlayers,
      comboPieces,
      recommendation,
    };
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
    return makeRandomDecisionFromSupport(context, {
      selectAttackTarget: (gameState, playerId) => this.selectAttackTarget(gameState, playerId),
    });
  }
  
  /**
   * Make a basic heuristic-based decision
   */
  private makeBasicDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeBasicDecisionFromSupport(context, config, {
      makeBasicMulliganDecision: (ctx) => this.makeBasicMulliganDecision(ctx, config),
      makeBasicAttackDecision: (ctx, cfg) => this.makeBasicAttackDecision(ctx, cfg),
      makeBasicBlockDecision: (ctx, cfg) => this.makeBasicBlockDecision(ctx, cfg),
      makeBasicCastDecision: (ctx, cfg) => this.makeBasicCastDecision(ctx, cfg),
      makeSacrificeDecision: (ctx, cfg) => this.makeSacrificeDecision(ctx, cfg),
      makeTargetDecision: (ctx, cfg) => this.makeTargetDecision(ctx, cfg),
      makeTriggeredAbilityDecision: (ctx, cfg) => this.makeTriggeredAbilityDecision(ctx, cfg),
      makeDamageAssignmentDecision: (ctx, cfg) => this.makeDamageAssignmentDecision(ctx, cfg),
      makeBlockerOrderDecision: (ctx, cfg) => this.makeBlockerOrderDecision(ctx, cfg),
      makeTokenCreationDecision: (ctx, cfg) => this.makeTokenCreationDecision(ctx, cfg),
      makeModeChoiceDecision: (ctx, cfg) => this.makeModeChoiceDecision(ctx, cfg),
      makeDiscardDecision: (ctx, cfg) => this.makeDiscardDecision(ctx, cfg),
      makeActivatedAbilityDecision: (ctx, cfg) => this.makeActivatedAbilityDecision(ctx, cfg),
      makeRandomDecision: (ctx) => this.makeRandomDecision(ctx),
    });
  }
  
  /**
   * Basic mulligan decision: keep if hand has 2-5 lands
   */
  private makeBasicMulliganDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeBasicMulliganDecisionFromSupport(context);
  }
  
  /**
   * Select the best opponent to attack based on threat assessment
   * Considers multiple factors:
   * - Overall threat level (board state, combo potential)
   * - Life total (prioritize low life for potential kills)
   * - Board presence (number and quality of threats)
   * 
   * @param gameState Current game state
   * @param playerId The attacking player
   * @returns The player ID to attack
   */
  private selectAttackTarget(gameState: GameState, playerId: PlayerID): PlayerID {
    return selectAttackTargetFromSupport({
      gameState,
      playerId,
      getProcessedBattlefield: this.getProcessedBattlefield.bind(this),
      hasPermanentType: this.hasPermanentType.bind(this),
    });
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
   * 
   * Now enhanced to prioritize creatures with beneficial death triggers!
   * Difficulty affects attack strategy:
   * - Easy: May miss good attacks or make bad attacks
   * - Hard: Consistently makes optimal attack decisions
   */
  private makeBasicAttackDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeBasicAttackDecisionFromSupport(context, config, {
      getProcessedBattlefield: (gameState) => this.getProcessedBattlefield(gameState),
      selectAttackTarget: (gameState, playerId) => this.selectAttackTarget(gameState, playerId),
      getCombatDeckModifiers: (perm, cfg) => this.getCombatDeckModifiers(perm, cfg),
      evaluateCombatValue: (perm, isAttacking) => this.evaluateCombatValue(perm, isAttacking),
      getPrimaryArchetypes: (cfg) => this.getPrimaryArchetypes(cfg),
      shouldMakeMistake: (difficulty) => this.shouldMakeMistake(difficulty),
    });
  }
  
  /**
   * Basic block decision: block to preserve life and trigger beneficial death abilities
   * Uses proper combat validation to ensure only legal blockers are selected
   * Now enhanced to:
   * 1. Actually block more aggressively (was too conservative before)
   * 2. Prioritize using creatures with beneficial death triggers as blockers
   * 3. Block all dangerous attackers, not just ones we can kill
   */
  private makeBasicBlockDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeBasicBlockDecisionFromSupport(context, config, {
      getProcessedBattlefield: (gameState) => this.getProcessedBattlefield(gameState),
      getCombatDeckModifiers: (perm, cfg) => this.getCombatDeckModifiers(perm, cfg),
      evaluateCombatValue: (perm, isAttacking) => this.evaluateCombatValue(perm, isAttacking),
      evaluatePermanentValue: (perm) => this.evaluatePermanentValue(perm),
    });
  }
  
  /**
   * Basic spell casting decision
   * Evaluates castable spells based on mana efficiency, board state, and timing
   * ENHANCED: Better hand management - don't dump entire hand, save removal/interaction
   */
  private makeBasicCastDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeBasicCastDecisionFromSupport(context, config, {
      evaluateSpellValue: (card, gameState, playerId) => this.evaluateSpellValue(card, gameState, playerId),
      countOpponentThreats: (gameState, playerId) => this.countOpponentThreats(gameState, playerId),
    });
  }
  
  /**
   * Count threatening permanents controlled by opponents
   */
  private countOpponentThreats(gameState: GameState, playerId: PlayerID): number {
    return countOpponentThreatsFromSupport(gameState, playerId, {
      getProcessedBattlefield: this.getProcessedBattlefield.bind(this),
      hasPermanentType: this.hasPermanentType.bind(this),
    });
  }
  
  /**
   * Evaluate the value of casting a spell in the current game state
   */
  private evaluateSpellValue(card: any, gameState: GameState, playerId: PlayerID): number {
    return evaluateSpellValueFromSupport(card, gameState, playerId, {
      getProcessedBattlefield: this.getProcessedBattlefield.bind(this),
      hasPermanentType: this.hasPermanentType.bind(this),
    });
  }
  
  /**
   * Aggressive strategy decisions
   * Uses proper combat validation to ensure only legal attackers are selected
   */
  private makeAggressiveDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeAggressiveDecisionFromSupport(context, config, {
      selectAttackTarget: (gameState, playerId) => this.selectAttackTarget(gameState, playerId),
      makeBasicDecision: (ctx, cfg) => this.makeBasicDecision(ctx, cfg),
    });
  }
  
  /**
   * Defensive strategy decisions
   * Uses proper combat validation to ensure only legal attackers are selected
   */
  private makeDefensiveDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeDefensiveDecisionFromSupport(context, config, {
      selectAttackTarget: (gameState, playerId) => this.selectAttackTarget(gameState, playerId),
      makeBasicDecision: (ctx, cfg) => this.makeBasicDecision(ctx, cfg),
    });
  }
  
  /**
   * Control strategy decisions
   * Focuses on counter spells, removal, and card advantage.
   * Attacks only when in a dominant position.
   */
  private makeControlDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeControlDecisionFromSupport(context, config, {
      selectAttackTarget: (gameState, playerId) => this.selectAttackTarget(gameState, playerId),
      getProcessedBattlefield: (gameState) => this.getProcessedBattlefield(gameState),
      hasPermanentType: (perm, type) => this.hasPermanentType(perm, type),
      makeBasicCastDecision: (ctx, cfg) => this.makeBasicCastDecision(ctx, cfg),
      makeBasicDecision: (ctx, cfg) => this.makeBasicDecision(ctx, cfg),
    });
  }
  
  /**
   * Combo strategy decisions
   * Focuses on finding and protecting combo pieces, ramping mana, and drawing cards.
   */
  private makeComboDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeComboDecisionFromSupport(context, config, {
      selectAttackTarget: (gameState, playerId) => this.selectAttackTarget(gameState, playerId),
      getProcessedBattlefield: (gameState) => this.getProcessedBattlefield(gameState),
      hasPermanentType: (perm, type) => this.hasPermanentType(perm, type),
      makeBasicDecision: (ctx, cfg) => this.makeBasicDecision(ctx, cfg),
    });
  }
  
  // ============================================================================
  // New Decision Methods for Enhanced Automation
  // ============================================================================
  
  /**
   * Make a sacrifice decision - choose which permanent to sacrifice
   * NOW IMPROVED: Prefers sacrificing creatures with beneficial death triggers!
   */
  private makeSacrificeDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeSacrificeDecisionFromSupport(context, config, {
      getProcessedBattlefield: (gameState) => this.getProcessedBattlefield(gameState),
      hasPermanentType: (perm, type) => this.hasPermanentType(perm, type),
      selectSacrificeTarget: (candidates, gameState, playerId, preferDeathTriggers) =>
        this.selectSacrificeTarget(candidates, gameState, playerId, preferDeathTriggers),
    });
  }
  
  /**
   * Detect if a card has a beneficial death trigger
   * Returns the benefit value (positive = beneficial, 0 = none)
   */
  private evaluateDeathTrigger(card: KnownCardRef): number {
    return evaluateDeathTrigger(card);
  }

  /**
   * Evaluate the value of a permanent for AI decision-making
   * Now includes triggered ability evaluation
   */
  private evaluatePermanentValue(perm: BattlefieldPermanent): number {
    return evaluatePermanentValue(perm, {
      hasPermanentType: this.hasPermanentType.bind(this),
    });
  }
  
  /**
   * Evaluate combat value of a creature, considering death triggers
   * This is different from permanent value - it considers the benefit of dying
   */
  private evaluateCombatValue(perm: BattlefieldPermanent, isAttacking: boolean): { combatValue: number; wantsToGetKilled: boolean; deathBenefit: number } {
    return evaluateCombatValue(perm);
  }
  
  /**
   * Make a target selection decision
   */
  private makeTargetDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeTargetDecisionFromSupport(
      context,
      this.selectRemovalTarget.bind(this)
    );
  }
  
  /**
   * Make a triggered ability decision (e.g., "may" abilities)
   */
  private makeTriggeredAbilityDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeTriggeredAbilityDecisionFromSupport(context);
  }
  
  /**
   * Make a damage assignment decision (for multiple blockers with trample)
   */
  private makeDamageAssignmentDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeDamageAssignmentDecisionFromSupport(
      context,
      this.getProcessedBattlefield.bind(this)
    );
  }
  
  /**
   * Make a blocker ordering decision
   */
  private makeBlockerOrderDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeBlockerOrderDecisionFromSupport(
      context,
      this.getProcessedBattlefield.bind(this)
    );
  }
  
  /**
   * Make a token creation decision (for effects that let you choose token type)
   * Evaluates token options based on power/toughness and utility
   */
  private makeTokenCreationDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeTokenCreationDecisionFromSupport(context, this.evaluateTokenValue.bind(this));
  }
  
  /**
   * Evaluate token value based on name/characteristics
   */
  private evaluateTokenValue(tokenName: string): number {
    return evaluateTokenValue(tokenName);
  }
  
  /**
   * Make a mode choice decision (for modal spells/abilities)
   * Analyzes mode text for beneficial vs harmful effects
   */
  private makeModeChoiceDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeModeChoiceDecisionFromSupport(context, this.evaluateModeValue.bind(this));
  }
  
  /**
   * Evaluate the value of a modal option
   */
  private evaluateModeValue(mode: any): number {
    return evaluateModeValue(mode);
  }
  
  /**
   * Make a discard decision
   */
  private makeDiscardDecision(context: AIDecisionContext, config: AIPlayerConfig): AIDecision {
    return makeDiscardDecisionFromSupport(context, this.evaluateCardValue.bind(this));
  }
  
  /**
   * Evaluate the value of a card in hand
   * ENHANCED: Better evaluation considering card type and abilities
   */
  private evaluateCardValue(card: any): number {
    return evaluateCardValue(card);
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
  
  /**
   * Detect if a permanent has an activated ability
   * Returns the ability text if found, null otherwise
   */
  private detectActivatedAbility(perm: BattlefieldPermanent): string | null {
    return detectActivatedAbility(perm);
  }
  
  /**
   * Evaluate the value of activating an ability
   * Returns a score indicating how beneficial it would be to activate this ability
   * Higher score = more beneficial
   */
  private evaluateActivatedAbilityValue(
    perm: BattlefieldPermanent,
    abilityText: string,
    gameState: GameState,
    playerId: PlayerID,
    config: AIPlayerConfig
  ): number {
    return evaluateActivatedAbilityValue(perm, abilityText, gameState, playerId, config, {
      getPrimaryArchetypes: this.getPrimaryArchetypes.bind(this),
      hasPotentialManaSink: this.hasPotentialManaSink.bind(this),
    });
  }
  
  /**
   * Check if a permanent can activate its ability right now
   * Returns true if the permanent is untapped and the ability can be activated
   */
  private canActivateAbilityNow(perm: BattlefieldPermanent, gameState: GameState, playerId: PlayerID): boolean {
    return canActivateAbilityNow(perm, gameState, playerId, {
      hasPermanentType: this.hasPermanentType.bind(this),
    });
  }
  
  /**
   * Find the best activated ability to use on the battlefield
   * Returns the permanent and ability value, or null if no good abilities
   */
  private findBestActivatedAbility(
    gameState: GameState,
      playerId: PlayerID,
      config: AIPlayerConfig
  ): { permanent: BattlefieldPermanent; abilityText: string; value: number } | null {
    return findBestActivatedAbility(gameState, playerId, config, {
      getProcessedBattlefield: this.getProcessedBattlefield.bind(this),
      hasPermanentType: this.hasPermanentType.bind(this),
      getPrimaryArchetypes: this.getPrimaryArchetypes.bind(this),
      hasPotentialManaSink: this.hasPotentialManaSink.bind(this),
    });
  }
  
  /**
   * Make a decision about activating an ability
   * This is called when the AI needs to decide whether to activate an ability
   */
  private makeActivatedAbilityDecision(
    context: AIDecisionContext,
    config: AIPlayerConfig
  ): AIDecision {
    const { gameState, playerId } = context;
    
    // Find the best activated ability to use
    const bestAbility = this.findBestActivatedAbility(gameState, playerId, config);
    
    if (!bestAbility) {
      return {
        type: AIDecisionType.ACTIVATE_ABILITY,
        playerId,
        action: { activate: false },
        reasoning: 'No valuable activated abilities available',
        confidence: 0.8,
      };
    }
    
    const card = bestAbility.permanent.card as KnownCardRef;
    
    return {
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {
        activate: true,
        permanentId: bestAbility.permanent.id,
        cardName: card.name || 'Unknown',
        abilityText: bestAbility.abilityText,
      },
      reasoning: `Activating ${card.name || 'ability'} (value: ${bestAbility.value})`,
      confidence: Math.min(0.95, 0.5 + bestAbility.value / 40),
    };
  }
}

/**
 * Singleton AI engine instance
 */
export const aiEngine = new AIEngine();
