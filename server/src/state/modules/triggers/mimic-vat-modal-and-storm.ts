/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover Mimic Vat imprint, modal-spell parse, split second / hexproof /
 *   graveyard keyword granters, and storm helpers
 * Public: detectMimicVatTriggers, getMimicVatTriggers, parseModalSpellOptions, hasSplitSecond,
 *   playerHasHexproof, getGraveyardKeywordGranters, detectStormAbility, getStormCount
 */

import type { GameContext } from "../../context.js";
import { detectTargetType } from "./detect-target-type.js";
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';
// ============================================================================
// Mimic Vat and Imprint Triggers
// ============================================================================

export interface MimicVatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effect: string;
  dyingCreatureId: string;
  dyingCreatureName: string;
  dyingCreatureCard: any;
}

/**
 * Known cards with imprint-on-death triggers like Mimic Vat
 */
const KNOWN_IMPRINT_ON_DEATH_CARDS: Record<string, { effect: string; canExile: boolean }> = {
  "mimic vat": { 
    effect: "You may exile the dying creature. If you do, exile any card imprinted on Mimic Vat. Then you may pay {3} and tap to create a token copy with haste.", 
    canExile: true 
  },
  "soul foundry": {
    effect: "Imprint a creature card from your hand",
    canExile: false // Soul Foundry imprints from hand, not from dying creatures
  },
  "prototype portal": {
    effect: "Imprint an artifact card from your hand",
    canExile: false
  },
};

/**
 * Detect Mimic Vat-style imprint triggers from a permanent's oracle text
 * Pattern: "Whenever a nontoken creature dies, you may exile that card"
 */
export function detectMimicVatTriggers(card: any, permanent: any, gameState?: any): boolean {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'dies' })) return false; // Humility / Torpor Orb gate
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_IMPRINT_ON_DEATH_CARDS)) {
    if (cardName.includes(knownName) && info.canExile) {
      return true;
    }
  }
  
  // Generic pattern: "Whenever a nontoken creature dies, you may exile that card"
  // or "Whenever a creature dies, you may exile it"
  if (oracleText.includes('whenever') && 
      oracleText.includes('creature dies') && 
      oracleText.includes('you may exile')) {
    return true;
  }
  
  return false;
}

/**
 * Get all Mimic Vat-style triggers when a creature dies
 * @param ctx Game context
 * @param dyingCreature The creature that died
 * @param isToken Whether the dying creature is a token
 * @returns Array of triggers that can exile the dying creature
 */
export function getMimicVatTriggers(
  ctx: GameContext,
  dyingCreature: any,
  isToken: boolean
): MimicVatTrigger[] {
  const triggers: MimicVatTrigger[] = [];
  
  // Mimic Vat only works on nontoken creatures
  if (isToken) return triggers;
  
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const hasMimicVatTrigger = detectMimicVatTriggers(permanent.card, permanent, (ctx as any)?.state);
    
    if (hasMimicVatTrigger) {
      const cardName = (permanent.card.name || "").toLowerCase();
      const knownInfo = Object.entries(KNOWN_IMPRINT_ON_DEATH_CARDS)
        .find(([name]) => cardName.includes(name));
      
      triggers.push({
        permanentId: permanent.id,
        cardName: permanent.card.name,
        controllerId: permanent.controller,
        effect: knownInfo ? knownInfo[1].effect : "Exile the dying creature and imprint it",
        dyingCreatureId: dyingCreature.id,
        dyingCreatureName: dyingCreature.card?.name || "Unknown",
        dyingCreatureCard: dyingCreature.card,
      });
    }
  }
  
  return triggers;
}


// ============================================================================
// Modal Spell Support
// ============================================================================

export interface ModalSpellMode {
  index: number;
  text: string;
  effect: string;
  requiresTarget?: boolean;
  targetType?: string;
}

export interface ModalSpellInfo {
  isModal: boolean;
  modeCount: number | 'any'; // 1, 2, 3, 'any'
  modes: ModalSpellMode[];
  isSpree: boolean;
  spreeCosts?: { modeIndex: number; cost: string }[];
}

/**
 * Parse modal spell options from oracle text
 * Handles:
 * - "Choose one —" / "Choose two —" / "Choose three —"
 * - "Choose any number —"
 * - Spree cards: "Spree (Choose one or more additional costs.)"
 * - Entwine: "You may choose both if you pay entwine cost"
 */
export function parseModalSpellOptions(card: any): ModalSpellInfo {
  const oracleText = card?.oracle_text || "";
  const lowerOracle = oracleText.toLowerCase();
  
  const result: ModalSpellInfo = {
    isModal: false,
    modeCount: 1,
    modes: [],
    isSpree: false,
  };
  
  // Check for Spree keyword
  if (lowerOracle.includes('spree')) {
    result.isModal = true;
    result.isSpree = true;
    result.modeCount = 'any';
    
    // Parse spree costs: "+ {cost} — Effect"
    const spreePattern = /\+\s*(\{[^}]+\})\s*[—-]\s*([^+]+?)(?=\+\s*\{|$)/gi;
    let match;
    let index = 0;
    while ((match = spreePattern.exec(oracleText)) !== null) {
      const cost = match[1];
      const effect = match[2].trim();
      
      result.modes.push({
        index,
        text: `Pay ${cost}: ${effect}`,
        effect,
        requiresTarget: effect.toLowerCase().includes('target'),
        targetType: detectTargetType(effect),
      });
      
      result.spreeCosts = result.spreeCosts || [];
      result.spreeCosts.push({ modeIndex: index, cost });
      index++;
    }
    
    return result;
  }
  
  // Check for standard modal patterns
  const chooseMatch = lowerOracle.match(/choose\s+(one|two|three|four|any number)\s*[—-]/i);
  if (chooseMatch) {
    result.isModal = true;
    const countWord = chooseMatch[1].toLowerCase();
    
    switch (countWord) {
      case 'one': result.modeCount = 1; break;
      case 'two': result.modeCount = 2; break;
      case 'three': result.modeCount = 3; break;
      case 'four': result.modeCount = 4; break;
      case 'any number': result.modeCount = 'any'; break;
      default: result.modeCount = 1;
    }
    
    // Parse individual modes (marked by • or numbered)
    // Pattern: "• Effect text" or lines after "Choose X —"
    const modePattern = /[•·]\s*([^•·]+?)(?=[•·]|$)/g;
    let modeMatch;
    let index = 0;
    
    // Find the modes section (after "Choose X —")
    const dashIndex = oracleText.search(/[—-]/);
    const modesSection = dashIndex >= 0 ? oracleText.slice(dashIndex + 1) : oracleText;
    
    while ((modeMatch = modePattern.exec(modesSection)) !== null) {
      const modeText = modeMatch[1].trim();
      if (modeText.length > 0) {
        result.modes.push({
          index,
          text: modeText,
          effect: modeText,
          requiresTarget: modeText.toLowerCase().includes('target'),
          targetType: detectTargetType(modeText),
        });
        index++;
      }
    }
    
    // Fallback: if no bullet points found, try to parse by sentence structure
    if (result.modes.length === 0) {
      // Some cards use newlines or semicolons to separate modes
      const altModes = modesSection.split(/[;\n]/).filter(m => m.trim().length > 0);
      for (const modeText of altModes) {
        const cleanMode = modeText.trim();
        if (cleanMode.length > 5) { // Avoid tiny fragments
          result.modes.push({
            index,
            text: cleanMode,
            effect: cleanMode,
            requiresTarget: cleanMode.toLowerCase().includes('target'),
            targetType: detectTargetType(cleanMode),
          });
          index++;
        }
      }
    }
  }
  
  // Check for Entwine
  if (lowerOracle.includes('entwine')) {
    const entwineMatch = lowerOracle.match(/entwine\s+(\{[^}]+\})/i);
    if (entwineMatch) {
      // Mark that both modes can be chosen with entwine cost
      (result as any).hasEntwine = true;
      (result as any).entwineCost = entwineMatch[1];
    }
  }
  
  return result;
}


// ============================================================================
// Devotion Mana Calculation - MOVED to ./triggers/devotion.ts
// ============================================================================

// ============================================================================
// Win/Loss Condition Detection - MOVED to ./triggers/win-conditions.ts
// ============================================================================

// ============================================================================
// Transform/Flip Triggers - MOVED to ./triggers/transform.ts
// ============================================================================

// ============================================================================
// Landfall Triggers - MOVED to ./triggers/landfall.ts
// ============================================================================

// ============================================================================
// Static Abilities and Keywords
// ============================================================================

/**
 * Check if a permanent has Split Second (can't be responded to)
 */
export function hasSplitSecond(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  return keywords.some((k: string) => k.toLowerCase() === 'split second') ||
         oracleText.includes('split second');
}

/**
 * Check if a player has hexproof (Leyline of Sanctity, Shalai, etc.)
 */
export function playerHasHexproof(
  gameState: any,
  playerId: string
): boolean {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const oracleText = (permanent.card.oracle_text || "").toLowerCase();
    const cardName = (permanent.card.name || "").toLowerCase();
    
    // Leyline of Sanctity: "You have hexproof"
    if (cardName.includes('leyline of sanctity') && permanent.controller === playerId) {
      return true;
    }
    
    // Shalai, Voice of Plenty: "You and permanents you control have hexproof"
    if (cardName.includes('shalai') && oracleText.includes('you') && 
        oracleText.includes('hexproof') && permanent.controller === playerId) {
      return true;
    }
    
    // Aegis of the Gods: "You have hexproof"
    if (cardName.includes('aegis of the gods') && permanent.controller === playerId) {
      return true;
    }
    
    // Teyo, the Shieldmage: "You have hexproof"
    if (cardName.includes('teyo') && oracleText.includes('you have hexproof') && 
        permanent.controller === playerId) {
      return true;
    }
    
    // Orbs of Warding: "You have hexproof"
    if (cardName.includes('orbs of warding') && permanent.controller === playerId) {
      return true;
    }
    
    // Imperial Mask: "You have hexproof"
    if (cardName.includes('imperial mask') && permanent.controller === playerId) {
      return true;
    }
    
    // Generic pattern: "You have hexproof"
    if (oracleText.includes('you have hexproof') && permanent.controller === playerId) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get creatures with specific keywords in graveyard (Brawn, Anger, Wonder, Filth, Genesis)
 */
export function getGraveyardKeywordGranters(
  gameState: any,
  playerId: string
): { keyword: string; cardName: string; condition?: string }[] {
  const granters: { keyword: string; cardName: string; condition?: string }[] = [];
  const zones = gameState?.zones?.[playerId];
  const graveyard = zones?.graveyard || [];
  const battlefield = gameState?.battlefield || [];
  
  // Check if player controls a land of the required type
  const controlsForest = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('forest')
  );
  const controlsIsland = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('island')
  );
  const controlsMountain = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('mountain')
  );
  const controlsSwamp = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('swamp')
  );
  
  for (const card of graveyard) {
    const cardName = (card.name || "").toLowerCase();
    
    // Brawn: Creatures you control have trample (if you control a Forest)
    if (cardName.includes('brawn') && controlsForest) {
      granters.push({ keyword: 'trample', cardName: 'Brawn', condition: 'Control a Forest' });
    }
    
    // Anger: Creatures you control have haste (if you control a Mountain)
    if (cardName.includes('anger') && controlsMountain) {
      granters.push({ keyword: 'haste', cardName: 'Anger', condition: 'Control a Mountain' });
    }
    
    // Wonder: Creatures you control have flying (if you control an Island)
    if (cardName.includes('wonder') && controlsIsland) {
      granters.push({ keyword: 'flying', cardName: 'Wonder', condition: 'Control an Island' });
    }
    
    // Filth: Creatures you control have swampwalk (if you control a Swamp)
    if (cardName.includes('filth') && controlsSwamp) {
      granters.push({ keyword: 'swampwalk', cardName: 'Filth', condition: 'Control a Swamp' });
    }
    
    // Genesis: Return creature from graveyard at upkeep (if you control a Forest)
    if (cardName.includes('genesis') && controlsForest) {
      granters.push({ keyword: 'return_creature', cardName: 'Genesis', condition: 'Control a Forest' });
    }
  }
  
  return granters;
}

// ============================================================================
// Storm Mechanic Support
// ============================================================================

/**
 * Storm - When you cast this spell, copy it for each spell cast before it this turn.
 * Each copy goes on the stack with the same modes/targets (or new targets chosen)
 * 
 * Cards with Storm:
 * - Grapeshot
 * - Empty the Warrens
 * - Brain Freeze
 * - Tendrils of Agony
 * - Mind's Desire
 * - Temporal Fissure
 * - Hunting Pack
 * - Wing Shards
 * - Flusterstorm
 * - Crow Storm
 * - Dragonstorm
 * - Ignite Memories
 * - Sprouting Vines
 */
export interface StormTrigger {
  sourceCardId: string;
  sourceCardName: string;
  controllerId: string;
  stormCount: number;  // Number of copies to create
  originalSpellDetails: any;
}

export function detectStormAbility(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  // Check keywords array
  if (keywords.some((k: string) => k.toLowerCase() === 'storm')) {
    return true;
  }
  
  // Check oracle text for storm reminder text
  // "Storm (When you cast this spell, copy it for each spell cast before it this turn.)"
  if (oracleText.includes('storm') && 
      oracleText.includes('copy it for each spell cast before it')) {
    return true;
  }
  
  return false;
}

export function getStormCount(gameState: any): number {
  // Storm count is the number of spells cast this turn before this spell
  const spellsCastThisTurn = gameState?.spellsCastThisTurn || [];
  // Subtract 1 because we don't count the storm spell itself
  return Math.max(0, spellsCastThisTurn.length - 1);
}
