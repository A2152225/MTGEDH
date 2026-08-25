/**
 * CardAnalyzer.ts
 * 
 * Comprehensive card analysis system for AI decision-making.
 * Analyzes cards for:
 * - Effects and abilities
 * - Threat levels
 * - Synergies with other cards
 * - Combo potential
 * - Strategic value
 * 
 * This module enables AI players to make more intelligent decisions by
 * understanding what their cards do and how they work together.
 */

import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { TriggerEvent } from './triggeredAbilitiesTypes';
import { parseTriggeredAbilitiesFromText } from './triggeredAbilitiesParsing';
import { PATTERNS } from './CardAnalyzer-handlers/cardAnalyzerPatterns';
import { BENEFICIAL_DEATH_CARDS } from './CardAnalyzer-handlers/cardAnalyzerBeneficialDeathCards';
import { KNOWN_COMBOS } from './CardAnalyzer-handlers/cardAnalyzerKnownCombos';
import {
  CardCategory,
  ThreatLevel,
  SynergyArchetype,
} from './CardAnalyzer-handlers/cardAnalyzerTypes';
import type {
  CardAnalysis,
  CardEffectDetails,
  BattlefieldAnalysis,
  DeckArchetypeProfile,
} from './CardAnalyzer-handlers/cardAnalyzerTypes';
import { analyzeDeck } from './CardAnalyzer-handlers/cardAnalyzerAnalyzeDeck';

export {
  CardCategory,
  ThreatLevel,
  SynergyArchetype,
} from './CardAnalyzer-handlers/cardAnalyzerTypes';
export type {
  CardAnalysis,
  CardEffectDetails,
  BattlefieldAnalysis,
  DeckArchetypeProfile,
} from './CardAnalyzer-handlers/cardAnalyzerTypes';


function getAnalyzerParsedTriggers(oracleText: string, cardName: string) {
  return parseTriggeredAbilitiesFromText(oracleText, 'analysis-source', 'analysis-controller', cardName);
}

function isAnalyzerDeathTrigger(event: TriggerEvent): boolean {
  return event === TriggerEvent.DIES || event === TriggerEvent.CONTROLLED_CREATURE_DIED;
}

function isAnalyzerEtbTrigger(event: TriggerEvent): boolean {
  return event === TriggerEvent.ENTERS_BATTLEFIELD;
}

/**
 * Score how much a card wants other creatures on the board (aristocrat/token payoffs).
 * Higher = keep off the combat step; sacrifice fodder elsewhere instead.
 */
export function scoreAnotherCreatureTriggerStrength(oracleText: string): number {
  const text = String(oracleText || '').toLowerCase();
  if (!/\bwhenever\b/.test(text)) return 0;

  const referencesOtherCreatures =
    /\banother creature\b/.test(text) ||
    /\bone or more other\b[\s\S]{0,40}\bcreatures?\b/.test(text) ||
    /\bother [\w\s'-]+ you control\b/.test(text);
  if (!referencesOtherCreatures) return 0;

  let strength = 5;

  if (/\b(?:dies?|died|leaves the battlefield)\b/.test(text)) strength += 4;
  if (/\benters the battlefield\b/.test(text)) strength += 3;
  if (/\battacks?\b/.test(text) || /\bdeals combat damage\b/.test(text)) strength += 2;
  if (/\b(?:becomes blocked|blocks?)\b/.test(text)) strength += 1;

  if (/\beach opponent\b.*\b(?:loses?|lose)\b.*\blife\b/.test(text)) strength += 2;
  if (/\byou gain\b.*\blife\b/.test(text)) strength += 1;
  if (/\bdamage\b.*\b(?:opponent|player)\b/.test(text)) strength += 2;
  if (/\bcreate\b[\s\S]{0,30}\btoken\b/.test(text)) strength += 2;
  if (/\bdraw\b/.test(text)) strength += 2;
  if (/\bput\b[\s\S]{0,20}\b\+1\/\+1\b/.test(text)) strength += 1;

  return Math.min(10, strength);
}

export function hasAnotherCreatureTrigger(oracleText: string): boolean {
  return scoreAnotherCreatureTriggerStrength(oracleText) > 0;
}



// ============================================================================
// CardAnalyzer Class
// ============================================================================

/**
 * CardAnalyzer - Analyzes cards for AI decision making
 */
export class CardAnalyzer {
  
  /**
   * Analyze a single card
   */
  analyzeCard(card: KnownCardRef | BattlefieldPermanent): CardAnalysis {
    // Handle both card references and permanents
    const cardData = this.extractCardData(card);
    const { name, typeLine, oracleText, power, toughness } = cardData;
    
    const categories = this.categorizeCard(cardData);
    const details = this.extractEffectDetails(cardData);
    const threatLevel = this.assessThreatLevel(cardData, details);
    const synergyTags = this.identifySynergyTags(cardData, details);
    const comboPotential = this.assessComboPotential(cardData);
    const removalPriority = this.assessRemovalPriority(cardData, details, threatLevel);
    
    return {
      cardId: cardData.id,
      cardName: name,
      categories,
      threatLevel,
      synergyTags,
      comboPotential,
      removalTargetPriority: removalPriority,
      details,
    };
  }
  
  /**
   * Analyze the entire battlefield for a player
   */
  analyzeBattlefield(
    battlefield: readonly BattlefieldPermanent[],
    targetPlayerId: string,
    analyzerPlayerId: string
  ): BattlefieldAnalysis {
    const playerPerms = battlefield.filter(p => p.controller === targetPlayerId);
    const isOpponent = targetPlayerId !== analyzerPlayerId;
    
    const threatsByPermanent = new Map<string, ThreatLevel>();
    let totalThreat = 0;
    const removalPriorities: { permanentId: string; priority: number }[] = [];
    let hasCommander = false;
    let commanderThreat = ThreatLevel.MINIMAL;
    const comboPieces: string[] = [];
    
    // Analyze each permanent
    for (const perm of playerPerms) {
      const analysis = this.analyzeCard(perm);
      threatsByPermanent.set(perm.id, analysis.threatLevel);
      totalThreat += analysis.threatLevel;
      
      if (isOpponent && analysis.removalTargetPriority > 3) {
        removalPriorities.push({
          permanentId: perm.id,
          priority: analysis.removalTargetPriority,
        });
      }
      
      if ((perm as any).isCommander || analysis.categories.includes(CardCategory.COMMANDER)) {
        hasCommander = true;
        commanderThreat = analysis.threatLevel;
      }
      
      if (analysis.comboPotential >= 7) {
        comboPieces.push(analysis.cardName);
      }
    }
    
    // Sort removal priorities
    removalPriorities.sort((a, b) => b.priority - a.priority);
    
    // Detect synergies on the battlefield
    const synergies = this.detectBattlefieldSynergies(playerPerms);
    
    return {
      playerId: targetPlayerId,
      totalThreatLevel: totalThreat,
      threatsByPermanent,
      synergiesDetected: synergies,
      comboPiecesOnBoard: comboPieces,
      removalPriorities,
      hasCommanderOnBoard: hasCommander,
      commanderThreatLevel: commanderThreat,
    };
  }

  /**
   * Analyze a deck or visible card pool and summarize its main themes.
   */
  analyzeDeck(cards: readonly KnownCardRef[]): DeckArchetypeProfile {
    return analyzeDeck.call(this, cards);
  }

  
  /**
   * Check if two cards have synergy
   */
  checkSynergy(card1: KnownCardRef, card2: KnownCardRef): { hasSynergy: boolean; strength: number; reason?: string } {
    const name1 = (card1.name || '').toLowerCase();
    const name2 = (card2.name || '').toLowerCase();
    
    // Check known combos
    const combos1 = KNOWN_COMBOS[name1];
    if (combos1 && combos1.some(c => name2.includes(c) || c.includes(name2))) {
      return { hasSynergy: true, strength: 10, reason: 'Known combo pair' };
    }
    
    const combos2 = KNOWN_COMBOS[name2];
    if (combos2 && combos2.some(c => name1.includes(c) || c.includes(name1))) {
      return { hasSynergy: true, strength: 10, reason: 'Known combo pair' };
    }
    
    // Check archetype synergies
    const analysis1 = this.analyzeCard(card1);
    const analysis2 = this.analyzeCard(card2);
    
    // Sacrifice outlet + death trigger synergy
    if (analysis1.categories.includes(CardCategory.SACRIFICE_OUTLET) && 
        analysis2.details.hasDeathTrigger) {
      return { hasSynergy: true, strength: 8, reason: 'Sacrifice outlet + death trigger' };
    }
    if (analysis2.categories.includes(CardCategory.SACRIFICE_OUTLET) && 
        analysis1.details.hasDeathTrigger) {
      return { hasSynergy: true, strength: 8, reason: 'Sacrifice outlet + death trigger' };
    }
    
    // Token generator + sacrifice outlet
    if (analysis1.details.createsTokens && 
        analysis2.categories.includes(CardCategory.SACRIFICE_OUTLET)) {
      return { hasSynergy: true, strength: 7, reason: 'Token generator + sacrifice outlet' };
    }
    if (analysis2.details.createsTokens && 
        analysis1.categories.includes(CardCategory.SACRIFICE_OUTLET)) {
      return { hasSynergy: true, strength: 7, reason: 'Token generator + sacrifice outlet' };
    }
    
    // Aristocrats synergy
    if (analysis1.categories.includes(CardCategory.ARISTOCRAT) && 
        (analysis2.details.hasDeathTrigger || analysis2.details.createsTokens)) {
      return { hasSynergy: true, strength: 8, reason: 'Aristocrat synergy' };
    }
    if (analysis2.categories.includes(CardCategory.ARISTOCRAT) && 
        (analysis1.details.hasDeathTrigger || analysis1.details.createsTokens)) {
      return { hasSynergy: true, strength: 8, reason: 'Aristocrat synergy' };
    }
    
    // Landfall synergy
    if (analysis1.details.hasLandfall && analysis2.categories.includes(CardCategory.RAMP)) {
      return { hasSynergy: true, strength: 6, reason: 'Landfall + ramp' };
    }
    if (analysis2.details.hasLandfall && analysis1.categories.includes(CardCategory.RAMP)) {
      return { hasSynergy: true, strength: 6, reason: 'Landfall + ramp' };
    }
    
    // Check for shared synergy tags
    const sharedTags = analysis1.synergyTags.filter(tag => 
      analysis2.synergyTags.includes(tag)
    );
    if (sharedTags.length > 0) {
      return { hasSynergy: true, strength: 5, reason: `Shared synergy: ${sharedTags.join(', ')}` };
    }
    
    return { hasSynergy: false, strength: 0 };
  }
  
  /**
   * Find the best sacrifice target among a list of creatures
   * Prioritizes creatures with beneficial death triggers
   */
  findBestSacrificeTarget(
    creatures: readonly BattlefieldPermanent[],
    preferBeneficial: boolean = true
  ): { creature: BattlefieldPermanent | null; reason: string; priority: number } {
    if (creatures.length === 0) {
      return { creature: null, reason: 'No creatures available', priority: 0 };
    }
    
    let best: BattlefieldPermanent | null = null;
    let bestPriority = -Infinity;
    let bestReason = '';
    
    for (const creature of creatures) {
      const cardData = this.extractCardData(creature);
      const name = cardData.name.toLowerCase();
      
      // Check known beneficial death cards
      const knownDeath = BENEFICIAL_DEATH_CARDS[name];
      if (knownDeath) {
        // Prefer beneficial death triggers
        let priority = knownDeath.priority;
        if (preferBeneficial) {
          priority += 10; // Bonus for beneficial deaths
        }
        if (priority > bestPriority) {
          bestPriority = priority;
          best = creature;
          bestReason = `${cardData.name}: ${knownDeath.effect}`;
        }
        continue;
      }
      
      // Analyze the card for death triggers
      const details = this.extractEffectDetails(cardData);
      if (details.hasDeathTrigger && details.deathTriggerBenefitsMe) {
        let priority = 7; // Base priority for beneficial death trigger
        if (preferBeneficial) {
          priority += 5;
        }
        if (priority > bestPriority) {
          bestPriority = priority;
          best = creature;
          bestReason = `${cardData.name}: ${details.deathTriggerEffect || 'Has death trigger'}`;
        }
        continue;
      }
      
      // Tokens are lowest priority (easy to sacrifice)
      if ((creature as any).isToken) {
        const priority = 1;
        if (priority > bestPriority) {
          bestPriority = priority;
          best = creature;
          bestReason = 'Token creature';
        }
        continue;
      }
      
      // Small creatures without abilities
      const power = cardData.power;
      const toughness = cardData.toughness;
      const hasAbilities = details.hasActivatedAbility || 
                          details.hasDeathTrigger || 
                          details.hasETBTrigger;
      
      if (!hasAbilities && power + toughness <= 2) {
        const priority = 2;
        if (priority > bestPriority) {
          bestPriority = priority;
          best = creature;
          bestReason = 'Small creature with no abilities';
        }
      }
    }
    
    // Fallback: use the smallest creature
    if (!best && creatures.length > 0) {
      creatures.forEach(c => {
        const data = this.extractCardData(c);
        const stats = data.power + data.toughness;
        const priority = -stats; // Smaller is better
        if (priority > bestPriority) {
          bestPriority = priority;
          best = c;
          bestReason = 'Smallest available creature';
        }
      });
    }
    
    return {
      creature: best,
      reason: bestReason,
      priority: bestPriority,
    };
  }
  
  /**
   * Identify which cards in hand/library synergize with the battlefield
   */
  findSynergyCards(
    cards: readonly KnownCardRef[],
    battlefield: readonly BattlefieldPermanent[],
    playerId: string
  ): { card: KnownCardRef; synergyScore: number; synergizesWith: string[] }[] {
    const playerBattlefield = battlefield.filter(p => p.controller === playerId);
    const results: { card: KnownCardRef; synergyScore: number; synergizesWith: string[] }[] = [];
    
    for (const card of cards) {
      let totalSynergy = 0;
      const synergizesWith: string[] = [];
      
      for (const perm of playerBattlefield) {
        const permCard = this.extractCardData(perm) as any;
        const synergy = this.checkSynergy(card, permCard);
        if (synergy.hasSynergy) {
          totalSynergy += synergy.strength;
          synergizesWith.push(`${permCard.name} (${synergy.reason})`);
        }
      }
      
      if (totalSynergy > 0) {
        results.push({
          card,
          synergyScore: totalSynergy,
          synergizesWith,
        });
      }
    }
    
    // Sort by synergy score descending
    results.sort((a, b) => b.synergyScore - a.synergyScore);
    
    return results;
  }
  
  /**
   * Assess if using Veteran Explorer-like cards is beneficial
   * Consider opponent board state and our mana needs
   */
  shouldUseSymmetricDeathEffect(
    card: KnownCardRef,
    ownLandCount: number,
    opponentLandCounts: readonly number[],
    opponentThreatLevels: readonly number[]
  ): { shouldUse: boolean; reason: string } {
    const name = (card.name || '').toLowerCase();
    const known = BENEFICIAL_DEATH_CARDS[name];
    
    if (!known || !known.symmetric) {
      return { shouldUse: true, reason: 'Not a symmetric effect' };
    }
    
    // Calculate relative mana disadvantage
    const avgOpponentLands = opponentLandCounts.reduce((a, b) => a + b, 0) / opponentLandCounts.length;
    const landDisadvantage = avgOpponentLands - ownLandCount;
    
    // If we're behind on lands, symmetric ramp helps us more
    if (landDisadvantage >= 2) {
      return { 
        shouldUse: true, 
        reason: `Behind on lands by ${landDisadvantage.toFixed(1)} - symmetric ramp is beneficial` 
      };
    }
    
    // If opponents have high threat levels and more lands, be cautious
    const avgThreat = opponentThreatLevels.reduce((a, b) => a + b, 0) / opponentThreatLevels.length;
    if (avgThreat > 10 && landDisadvantage < 1) {
      return { 
        shouldUse: false, 
        reason: 'Opponents have high threats and similar mana - don\'t help them ramp' 
      };
    }
    
    // In early game, symmetric ramp is generally fine
    if (ownLandCount <= 4) {
      return { shouldUse: true, reason: 'Early game - mana development is priority' };
    }
    
    // Default to using it
    return { shouldUse: true, reason: 'Symmetric effect is acceptable' };
  }
  
  // ============================================================================
  // Private Helper Methods
  // ============================================================================
  
  private extractCardData(card: KnownCardRef | BattlefieldPermanent): {
    id: string;
    name: string;
    typeLine: string;
    oracleText: string;
    power: number;
    toughness: number;
    cmc: number;
    colors: readonly string[];
  } {
    // Handle BattlefieldPermanent
    if ('card' in card && card.card) {
      const innerCard = card.card as KnownCardRef;
      const name = innerCard.name || '';
      return {
        id: card.id || innerCard.id || '',
        name,
        typeLine: innerCard.type_line || '',
        oracleText: String(innerCard.oracle_text || '').trim(),
        power: parseInt(String(innerCard.power || '0'), 10) || 0,
        toughness: parseInt(String(innerCard.toughness || '0'), 10) || 0,
        cmc: (innerCard as any).cmc || (innerCard as any).mana_value || 0,
        colors: (innerCard as any).colors || [],
      };
    }
    
    // Handle KnownCardRef directly
    const cardRef = card as KnownCardRef;
    const name = cardRef.name || '';
    return {
      id: cardRef.id || '',
      name,
      typeLine: cardRef.type_line || '',
      oracleText: String(cardRef.oracle_text || '').trim(),
      power: parseInt(String(cardRef.power || '0'), 10) || 0,
      toughness: parseInt(String(cardRef.toughness || '0'), 10) || 0,
      cmc: (cardRef as any).cmc || (cardRef as any).mana_value || 0,
      colors: (cardRef as any).colors || [],
    };
  }
  
  private categorizeCard(cardData: { typeLine: string; oracleText: string; name: string }): CardCategory[] {
    const { typeLine, oracleText, name } = cardData;
    const type = typeLine.toLowerCase();
    const text = oracleText.toLowerCase();
    const parsedTriggers = getAnalyzerParsedTriggers(oracleText, name);
    const hasDeathTrigger = parsedTriggers.some(trigger => isAnalyzerDeathTrigger(trigger.event));
    const hasEtbTrigger = parsedTriggers.some(trigger => isAnalyzerEtbTrigger(trigger.event));
    const categories: CardCategory[] = [];
    
    // Type-based categorization
    if (type.includes('land')) {
      categories.push(CardCategory.LAND);
    }
    if (type.includes('creature')) {
      categories.push(CardCategory.CREATURE);
    }
    if (type.includes('planeswalker')) {
      categories.push(CardCategory.PLANESWALKER);
    }
    
    // Effect-based categorization
    if (PATTERNS.COUNTER_SPELL.test(text)) {
      categories.push(CardCategory.COUNTERSPELL);
    }
    if (PATTERNS.DESTROY_ALL.test(text) || PATTERNS.EXILE_ALL.test(text)) {
      categories.push(CardCategory.BOARD_WIPE);
    } else if (PATTERNS.DESTROY_TARGET.test(text) || PATTERNS.EXILE_TARGET.test(text) || PATTERNS.BOUNCE.test(text)) {
      categories.push(CardCategory.REMOVAL);
    }
    if (PATTERNS.RAMP.test(text) || (PATTERNS.MANA_ABILITY.test(text) && !type.includes('land'))) {
      categories.push(CardCategory.RAMP);
    }
    if (PATTERNS.DRAW_CARDS.test(text)) {
      categories.push(CardCategory.DRAW);
    }
    if (PATTERNS.TUTOR.test(text)) {
      categories.push(CardCategory.TUTOR);
    }
    if (PATTERNS.SACRIFICE_OUTLET.test(text)) {
      categories.push(CardCategory.SACRIFICE_OUTLET);
    }
    if (hasDeathTrigger) {
      categories.push(CardCategory.DEATH_TRIGGER);
    }
    if (hasEtbTrigger) {
      categories.push(CardCategory.ETB_TRIGGER);
    }
    if (PATTERNS.CREATE_TOKEN.test(text)) {
      categories.push(CardCategory.TOKEN_GENERATOR);
    }
    if (PATTERNS.REANIMATION.test(text)) {
      categories.push(CardCategory.REANIMATOR);
    }
    if (PATTERNS.LANDFALL.test(text)) {
      categories.push(CardCategory.LANDFALL);
    }
    
    // Aristocrats detection (drains life on death)
    if ((text.includes('whenever') && text.includes('dies') && 
        (text.includes('loses') || text.includes('gain') || text.includes('damage')))) {
      categories.push(CardCategory.ARISTOCRAT);
    }
    
    // Win condition / finisher detection
    if (PATTERNS.WIN_GAME.test(text) || PATTERNS.EXTRA_TURN.test(text)) {
      categories.push(CardCategory.FINISHER);
    }
    
    // Protection effects
    if (PATTERNS.HEXPROOF.test(text) || PATTERNS.INDESTRUCTIBLE.test(text) ||
        text.includes('protection from')) {
      categories.push(CardCategory.PROTECTION);
    }
    
    if (categories.length === 0) {
      categories.push(CardCategory.OTHER);
    }
    
    return categories;
  }
  
  private extractEffectDetails(cardData: { oracleText: string; typeLine: string; power: number; toughness: number; name: string }): CardEffectDetails {
    const { oracleText, typeLine, power, toughness, name } = cardData;
    const text = oracleText.toLowerCase();
    const type = typeLine.toLowerCase();
    const parsedTriggers = getAnalyzerParsedTriggers(oracleText, name);
    const deathTriggers = parsedTriggers.filter(trigger => isAnalyzerDeathTrigger(trigger.event));
    const etbTriggers = parsedTriggers.filter(trigger => isAnalyzerEtbTrigger(trigger.event));
    
    // Combat keywords
    const combatKeywords: string[] = [];
    if (PATTERNS.FLYING.test(text)) combatKeywords.push('flying');
    if (PATTERNS.TRAMPLE.test(text)) combatKeywords.push('trample');
    if (PATTERNS.HASTE.test(text)) combatKeywords.push('haste');
    if (PATTERNS.DEATHTOUCH.test(text)) combatKeywords.push('deathtouch');
    if (PATTERNS.LIFELINK.test(text)) combatKeywords.push('lifelink');
    if (PATTERNS.FIRST_STRIKE.test(text)) combatKeywords.push('first strike');
    if (PATTERNS.DOUBLE_STRIKE.test(text)) combatKeywords.push('double strike');
    if (PATTERNS.VIGILANCE.test(text)) combatKeywords.push('vigilance');
    if (PATTERNS.INDESTRUCTIBLE.test(text)) combatKeywords.push('indestructible');
    if (PATTERNS.HEXPROOF.test(text)) combatKeywords.push('hexproof');
    
    // Death trigger analysis
    const hasDeathTrigger = deathTriggers.length > 0;
    let deathTriggerEffect: string | undefined;
    let deathTriggerBenefitsMe = false;
    let deathTriggerSymmetric = false;
    
    if (hasDeathTrigger) {
      deathTriggerEffect = deathTriggers[0]?.effect;
      const deathTriggerText = deathTriggers.map(trigger => trigger.effect).join(' ').toLowerCase();
      
      // Check if it benefits the controller
      const beneficialPatterns = [
        /search.*library/, /draw/, /create.*token/, /return.*to.*hand/,
        /gain.*life/, /opponent.*loses/, /damage.*opponent/
      ];
      deathTriggerBenefitsMe = beneficialPatterns.some(p => p.test(deathTriggerText));
      
      // Check if symmetric (helps all players)
      const symmetricPatterns = [/each player/];
      deathTriggerSymmetric = symmetricPatterns.some(p => p.test(deathTriggerText));
      
      // Check known beneficial death cards
      const knownDeath = BENEFICIAL_DEATH_CARDS[name.toLowerCase()];
      if (knownDeath) {
        deathTriggerBenefitsMe = true;
        deathTriggerSymmetric = knownDeath.symmetric;
        deathTriggerEffect = knownDeath.effect;
      }
    }
    
    // Sacrifice detection - check for activated ability patterns like "Sacrifice CardName:"
    const canSacrifice = PATTERNS.SACRIFICE_ABILITY.test(text) || 
                         /sacrifice [^:]+:/i.test(text);  // "Sacrifice CardName:" format
    let sacrificeTarget: 'self' | 'creature' | 'permanent' | 'artifact' | null = null;
    let sacrificeEffect: string | undefined;
    
    if (canSacrifice) {
      // Check for self-sacrifice patterns
      // Use simple string check instead of regex for "Sacrifice CardName:" pattern
      const escapedName = name.toLowerCase();
      const sacrificeNamePattern = `sacrifice ${escapedName}:`;
      
      if (text.includes('sacrifice ~') || 
          text.includes('sacrifice this') ||
          // Check for "Sacrifice CardName:" pattern (self-sacrifice activated ability)
          text.includes(sacrificeNamePattern)) {
        sacrificeTarget = 'self';
      } else if (text.includes('sacrifice a creature') || text.includes('sacrifice another creature')) {
        sacrificeTarget = 'creature';
      } else if (text.includes('sacrifice an artifact')) {
        sacrificeTarget = 'artifact';
      } else if (text.includes('sacrifice a permanent')) {
        sacrificeTarget = 'permanent';
      }
      
      const sacrificeMatch = text.match(/sacrifice[^:,]*[,:]\s*([^.]+)/i);
      if (sacrificeMatch) {
        sacrificeEffect = sacrificeMatch[1];
      }
    }
    
    // ETB trigger
    const hasETBTrigger = etbTriggers.length > 0;
    let etbTriggerEffect: string | undefined;
    if (hasETBTrigger) {
      etbTriggerEffect = etbTriggers[0]?.effect;
    }

    const anotherCreatureTriggerStrength = scoreAnotherCreatureTriggerStrength(oracleText);
    const hasAnotherCreatureTriggerFlag = anotherCreatureTriggerStrength > 0;
    
    return {
      hasDeathTrigger,
      deathTriggerEffect,
      deathTriggerBenefitsMe,
      deathTriggerSymmetric,
      hasETBTrigger,
      etbTriggerEffect,
      canSacrifice,
      sacrificeTarget,
      sacrificeEffect,
      combatKeywords,
      power,
      toughness,
      producesMana: PATTERNS.MANA_ABILITY.test(text),
      drawsCards: PATTERNS.DRAW_CARDS.test(text),
      searchesLibrary: PATTERNS.SEARCH_LIBRARY.test(text),
      destroysTargets: PATTERNS.DESTROY_TARGET.test(text),
      exilesTargets: PATTERNS.EXILE_TARGET.test(text),
      countersSpells: PATTERNS.COUNTER_SPELL.test(text),
      createsTokens: PATTERNS.CREATE_TOKEN.test(text),
      hasLandfall: PATTERNS.LANDFALL.test(text),
      careAboutGraveyard: PATTERNS.GRAVEYARD_CARE.test(text),
      hasActivatedAbility: text.includes('{t}:') || /\{[0-9wubrgc]+\}[,:]/.test(text),
      isComboEnablerPiece: PATTERNS.UNTAP_EFFECT.test(text) || PATTERNS.COPY_EFFECT.test(text),
      hasAnotherCreatureTrigger: hasAnotherCreatureTriggerFlag,
      anotherCreatureTriggerStrength,
    };
  }
  
  private assessThreatLevel(
    cardData: { typeLine: string; oracleText: string; power: number; toughness: number; name: string },
    details: CardEffectDetails
  ): ThreatLevel {
    const { typeLine, oracleText, power, toughness, name } = cardData;
    const type = typeLine.toLowerCase();
    const text = oracleText.toLowerCase();
    
    // Instant win conditions
    if (PATTERNS.WIN_GAME.test(text) || PATTERNS.EXTRA_TURN.test(text)) {
      return ThreatLevel.GAME_WINNING;
    }
    
    // Known dangerous cards
    const dangerousCards = [
      'consecrated sphinx', 'rhystic study', 'smothering tithe',
      'seedborn muse', 'prophet of kruphix', 'notion thief',
      'craterhoof behemoth', 'tooth and nail', 'expropriate',
      'cyclonic rift', 'teferi\'s protection', 'dockside extortionist',
    ];
    if (dangerousCards.some(c => name.toLowerCase().includes(c))) {
      return ThreatLevel.CRITICAL;
    }
    
    // High threat indicators
    if (details.isComboEnablerPiece && type.includes('creature')) {
      return ThreatLevel.HIGH;
    }
    
    if (type.includes('planeswalker')) {
      return ThreatLevel.HIGH;
    }
    
    if (type.includes('creature')) {
      // Big creatures with evasion
      if (power >= 5 && details.combatKeywords.length >= 2) {
        return ThreatLevel.HIGH;
      }
      if (power >= 7) {
        return ThreatLevel.HIGH;
      }
      // Creatures with draw engines
      if (details.drawsCards && !text.includes('when this creature dies')) {
        return ThreatLevel.HIGH;
      }
      // Medium threats
      if (power >= 4 || details.combatKeywords.includes('flying')) {
        return ThreatLevel.MODERATE;
      }
      if (power >= 2) {
        return ThreatLevel.LOW;
      }
      return ThreatLevel.MINIMAL;
    }
    
    // Enchantments that generate value
    if (type.includes('enchantment') && (details.drawsCards || details.createsTokens)) {
      return ThreatLevel.MODERATE;
    }
    
    // Artifacts that generate mana or value
    if (type.includes('artifact')) {
      if (details.producesMana) {
        return ThreatLevel.LOW;
      }
      if (details.drawsCards) {
        return ThreatLevel.MODERATE;
      }
    }
    
    // Lands
    if (type.includes('land')) {
      if (details.producesMana && text.includes('add') && text.includes('any color')) {
        return ThreatLevel.LOW;
      }
      return ThreatLevel.MINIMAL;
    }
    
    return ThreatLevel.MINIMAL;
  }
  
  private identifySynergyTags(
    cardData: { typeLine: string; oracleText: string; name: string },
    details: CardEffectDetails
  ): string[] {
    const tags: string[] = [];
    const { typeLine, oracleText, name } = cardData;
    const type = typeLine.toLowerCase();
    const text = oracleText.toLowerCase();
    
    // Aristocrats archetype
    if (details.hasDeathTrigger || details.canSacrifice || 
        text.includes('blood artist') || text.includes('whenever') && text.includes('dies')) {
      tags.push('aristocrats');
    }
    
    // Token strategy
    if (details.createsTokens || text.includes('token') && text.includes('you control')) {
      tags.push('tokens');
    }
    
    // Graveyard strategy
    if (details.careAboutGraveyard || PATTERNS.REANIMATION.test(text)) {
      tags.push('graveyard');
    }
    
    // Landfall
    if (details.hasLandfall) {
      tags.push('landfall');
    }
    
    // Counters matter
    if (text.includes('+1/+1 counter') || text.includes('proliferate')) {
      tags.push('counters');
    }
    
    // Artifacts matter
    if (type.includes('artifact') || text.includes('artifact you control')) {
      tags.push('artifacts');
    }
    
    // Enchantments matter
    if (type.includes('enchantment') || text.includes('enchantment you control')) {
      tags.push('enchantments');
    }
    
    // Spellslinger
    if (text.includes('instant or sorcery') || text.includes('noncreature spell')) {
      tags.push('spellslinger');
    }
    
    // Voltron (equipment/auras)
    if (type.includes('equipment') || text.includes('equipped creature') ||
        (type.includes('aura') && text.includes('enchanted creature'))) {
      tags.push('voltron');
    }
    
    // Stax
    if (text.includes('opponents can\'t') || text.includes('opponents don\'t') ||
        text.includes('each opponent') && text.includes('sacrifice')) {
      tags.push('stax');
    }
    
    return tags;
  }
  
  private assessComboPotential(cardData: { name: string; oracleText: string }): number {
    const { name, oracleText } = cardData;
    const lowerName = name.toLowerCase();
    const text = oracleText.toLowerCase();
    let potential = 0;
    
    // Check known combo pieces
    if (KNOWN_COMBOS[lowerName]) {
      potential = 10;
    }
    
    // Check if part of another combo
    for (const pieces of Object.values(KNOWN_COMBOS)) {
      if (pieces.some(p => lowerName.includes(p) || p.includes(lowerName))) {
        potential = Math.max(potential, 9);
        break;
      }
    }
    
    // Combo indicators
    if (PATTERNS.UNTAP_EFFECT.test(text)) potential = Math.max(potential, 7);
    if (PATTERNS.COPY_EFFECT.test(text)) potential = Math.max(potential, 6);
    if (PATTERNS.INFINITE_INDICATOR.test(text)) potential = Math.max(potential, 8);
    if (text.includes('mana') && text.includes('untap')) potential = Math.max(potential, 8);
    
    return potential;
  }
  
  private assessRemovalPriority(
    cardData: { name: string; typeLine: string; oracleText: string },
    details: CardEffectDetails,
    threatLevel: ThreatLevel
  ): number {
    let priority = threatLevel * 2; // Base priority from threat level
    
    const text = cardData.oracleText.toLowerCase();
    
    // Higher priority for value engines
    if (details.drawsCards && !text.includes('when this creature dies')) {
      priority += 3;
    }
    
    // Higher priority for untap effects (combo enablers)
    if (PATTERNS.UNTAP_EFFECT.test(text)) {
      priority += 2;
    }
    
    // Higher priority for life drain (aristocrats payoffs)
    if (PATTERNS.LIFE_DRAIN.test(text)) {
      priority += 2;
    }
    
    // Lower priority for cards with beneficial death triggers (we don't want to help them)
    if (details.hasDeathTrigger && details.deathTriggerBenefitsMe) {
      priority -= 2;
    }
    
    return Math.max(0, Math.min(10, priority));
  }
  
  private detectBattlefieldSynergies(permanents: readonly BattlefieldPermanent[]): SynergyArchetype[] {
    const synergies: Set<SynergyArchetype> = new Set();
    
    let hasSacrificeOutlet = false;
    let hasAristocrat = false;
    let hasDeathTrigger = false;
    let hasTokenGenerator = false;
    let hasLandfall = false;
    let hasCountersSynergy = false;
    let hasGraveyardCare = false;
    let hasArtifactTheme = false;
    let hasEnchantmentTheme = false;
    
    for (const perm of permanents) {
      const analysis = this.analyzeCard(perm);
      
      if (analysis.categories.includes(CardCategory.SACRIFICE_OUTLET)) hasSacrificeOutlet = true;
      if (analysis.categories.includes(CardCategory.ARISTOCRAT)) hasAristocrat = true;
      if (analysis.categories.includes(CardCategory.DEATH_TRIGGER)) hasDeathTrigger = true;
      if (analysis.categories.includes(CardCategory.TOKEN_GENERATOR)) hasTokenGenerator = true;
      if (analysis.categories.includes(CardCategory.LANDFALL)) hasLandfall = true;
      if (analysis.categories.includes(CardCategory.REANIMATOR)) hasGraveyardCare = true;
      
      if (analysis.synergyTags.includes('counters')) hasCountersSynergy = true;
      if (analysis.synergyTags.includes('artifacts')) hasArtifactTheme = true;
      if (analysis.synergyTags.includes('enchantments')) hasEnchantmentTheme = true;
      if (analysis.synergyTags.includes('graveyard')) hasGraveyardCare = true;
    }
    
    // Detect aristocrats
    if ((hasSacrificeOutlet && hasAristocrat) || (hasAristocrat && hasDeathTrigger)) {
      synergies.add(SynergyArchetype.ARISTOCRATS);
    }
    
    // Detect tokens
    if (hasTokenGenerator && (hasSacrificeOutlet || hasAristocrat)) {
      synergies.add(SynergyArchetype.TOKENS);
    }
    
    // Detect landfall
    if (hasLandfall) {
      synergies.add(SynergyArchetype.LANDFALL);
    }
    
    // Detect graveyard
    if (hasGraveyardCare) {
      synergies.add(SynergyArchetype.GRAVEYARD);
    }
    
    // Detect counters
    if (hasCountersSynergy) {
      synergies.add(SynergyArchetype.COUNTERS);
    }
    
    // Detect artifacts theme
    if (hasArtifactTheme) {
      synergies.add(SynergyArchetype.ARTIFACTS);
    }
    
    // Detect enchantments theme  
    if (hasEnchantmentTheme) {
      synergies.add(SynergyArchetype.ENCHANTMENTS);
    }
    
    return Array.from(synergies);
  }
}

/**
 * Singleton instance
 */
export const cardAnalyzer = new CardAnalyzer();

export default CardAnalyzer;
