/**
 * triggers/spell-cast.ts
 * 
 * Spell-cast trigger detection and processing.
 * Includes "whenever you cast a spell" triggers, magecraft abilities, and storm.
 * 
 * Categories:
 * - Spell-cast triggers: detectSpellCastTriggers, getSpellCastTriggers
 * - Spell-cast untap effects: detectSpellCastUntapEffects, getSpellCastUntapEffects, applySpellCastUntapEffect
 * - Storm mechanic: detectStormAbility, getStormCount
 */

import type { GameContext } from "../../context.js";

// ============================================================================
// Type Definitions
// ============================================================================

export interface SpellCastUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  untapType: 'nonland_permanents' | 'creatures' | 'all';
  spellCondition: 'noncreature' | 'any' | 'instant_sorcery';
}

export interface SpellCastTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  spellCondition: 'any' | 'creature' | 'noncreature' | 'instant_sorcery' | 'tribal_type';
  tribalType?: string;
  requiresTarget?: boolean;
  targetType?: string;
  createsToken?: boolean;
  tokenDetails?: {
    name: string;
    power: number;
    toughness: number;
    types: string;
    abilities?: string[];
  };
  addsLoyaltyCounters?: number; // Number of loyalty counters to add (for planeswalkers like Ral, Crackling Wit)
  mandatory: boolean;
}

// ============================================================================
// Spell-Cast Untap Triggers (Jeskai Ascendancy, Paradox Engine)
// ============================================================================

/**
 * Detect spell-cast untap triggers
 */
export function detectSpellCastUntapEffects(card: any, permanent: any): SpellCastUntapEffect[] {
  const effects: SpellCastUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever you cast a spell, untap all nonland permanents you control" (Paradox Engine)
  if (oracleText.includes('whenever you cast a spell') && 
      oracleText.includes('untap all nonland permanents')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a spell, untap all nonland permanents you control",
      untapType: 'nonland_permanents',
      spellCondition: 'any',
    });
  }
  
  // "Whenever you cast a noncreature spell" + "untap" (Jeskai Ascendancy pattern)
  if (oracleText.includes('whenever you cast a noncreature spell') && 
      oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a noncreature spell, untap creatures you control",
      untapType: 'creatures',
      spellCondition: 'noncreature',
    });
  }
  
  // Generic "whenever you cast" + "untap" pattern
  const castUntapMatch = oracleText.match(/whenever you cast (?:a |an )?(\w+)?\s*spell[^.]*untap/i);
  if (castUntapMatch && !effects.length) {
    const spellType = castUntapMatch[1]?.toLowerCase() || 'any';
    let spellCondition: SpellCastUntapEffect['spellCondition'] = 'any';
    if (spellType === 'noncreature') spellCondition = 'noncreature';
    else if (spellType === 'instant' || spellType === 'sorcery') spellCondition = 'instant_sorcery';
    
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast a ${spellType} spell, untap`,
      untapType: 'nonland_permanents',
      spellCondition,
    });
  }
  
  return effects;
}

/**
 * Get spell-cast untap effects for a player casting a spell
 */
export function getSpellCastUntapEffects(
  ctx: GameContext,
  casterId: string,
  spellCard: any
): SpellCastUntapEffect[] {
  const effects: SpellCastUntapEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue;
    
    const permEffects = detectSpellCastUntapEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      let shouldTrigger = false;
      
      switch (effect.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'noncreature':
          shouldTrigger = !isCreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
      }
      
      if (shouldTrigger) {
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply a spell-cast untap effect
 */
export function applySpellCastUntapEffect(ctx: GameContext, effect: SpellCastUntapEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    if (permanent.controller !== effect.controllerId) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.untapType) {
      case 'nonland_permanents':
        shouldUntap = !typeLine.includes('land');
        break;
      case 'creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'all':
        shouldUntap = true;
        break;
    }
    
    if (shouldUntap) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  if (untappedCount > 0) {
    ctx.bumpSeq();
  }
  
  return untappedCount;
}

// ============================================================================
// General Spell-Cast Triggered Abilities
// ============================================================================

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lowerTypeLine = typeLine.toLowerCase();
  
  const knownTypes = [
    'merfolk', 'goblin', 'elf', 'wizard', 'shaman', 'warrior', 'soldier', 'zombie',
    'vampire', 'dragon', 'angel', 'demon', 'beast', 'elemental', 'spirit', 'human',
    'knight', 'cleric', 'rogue', 'druid', 'pirate', 'dinosaur', 'cat', 'bird',
    'snake', 'spider', 'sliver', 'ally', 'rebel', 'mercenary', 'horror', 'faerie',
  ];
  
  for (const type of knownTypes) {
    if (lowerTypeLine.includes(type)) {
      types.push(type);
    }
  }
  
  return types;
}

/**
 * Detect spell-cast triggered abilities from a card's oracle text
 */
export function detectSpellCastTriggers(card: any, permanent: any): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Pattern: "Whenever you cast a [TYPE] spell, [EFFECT]"
  const spellCastPatterns = [
    /whenever you cast (?:a |an )?(\w+) spell,?\s*([^.]+)/gi,
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery) spell,?\s*([^.]+)/gi,
  ];
  
  for (const pattern of spellCastPatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const effectText = match[2].trim();
      
      let spellCondition: SpellCastTrigger['spellCondition'] = 'any';
      let tribalType: string | undefined;
      
      if (spellType === 'creature') {
        spellCondition = 'creature';
      } else if (spellType === 'noncreature') {
        spellCondition = 'noncreature';
      } else if (spellType === 'instant' || spellType === 'sorcery' || spellType === 'instant or sorcery') {
        spellCondition = 'instant_sorcery';
      } else if (!['a', 'an', 'spell'].includes(spellType)) {
        spellCondition = 'tribal_type';
        tribalType = spellType;
      }
      
      const isTapUntap = lowerOracle.includes('tap or untap') || 
                         lowerOracle.includes('untap target') ||
                         lowerOracle.includes('tap target');
      
      const tokenMatch = effectText.match(/create (?:a |an )?(\d+)\/(\d+)[^.]*token/i);
      let createsToken = false;
      let tokenDetails: SpellCastTrigger['tokenDetails'];
      
      if (tokenMatch || lowerOracle.includes('create a') && lowerOracle.includes('token')) {
        createsToken = true;
        const tokenPowerMatch = effectText.match(/(\d+)\/(\d+)/);
        if (tokenPowerMatch) {
          tokenDetails = {
            name: tribalType ? `${tribalType} Token` : 'Token',
            power: parseInt(tokenPowerMatch[1]),
            toughness: parseInt(tokenPowerMatch[2]),
            types: `Creature — ${tribalType || 'Token'}`,
          };
        }
      }
      
      const isOptional = effectText.toLowerCase().includes('you may');
      
      if (!triggers.some(t => t.effect === effectText && t.spellCondition === spellCondition)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast a ${tribalType || spellType} spell, ${effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          requiresTarget: isTapUntap,
          targetType: isTapUntap ? 'permanent' : undefined,
          createsToken,
          tokenDetails,
          mandatory: !isOptional,
        });
      }
    }
  }
  
  // Beast Whisperer pattern
  if (lowerOracle.includes('whenever you cast a creature spell') && 
      lowerOracle.includes('draw a card') &&
      !triggers.some(t => t.spellCondition === 'creature' && t.effect.includes('draw'))) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a creature spell, draw a card",
      effect: "draw a card",
      spellCondition: 'creature',
      mandatory: true,
    });
  }
  
  // Magecraft pattern
  if (lowerOracle.includes('magecraft') || 
      (lowerOracle.includes('whenever you cast or copy') && lowerOracle.includes('instant or sorcery'))) {
    const effectMatch = oracleText.match(/(?:magecraft\s*[—-]\s*)?whenever you cast or copy an instant or sorcery spell,?\s*([^.]+)/i);
    if (effectMatch && !triggers.some(t => t.effect === effectMatch[1].trim())) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Magecraft — Whenever you cast or copy an instant or sorcery spell, ${effectMatch[1].trim()}`,
        effect: effectMatch[1].trim(),
        spellCondition: 'instant_sorcery',
        mandatory: true,
      });
    }
  }
  
  // Planeswalker loyalty counter trigger pattern
  // "Whenever you cast a noncreature spell, put a loyalty counter on ~"
  // (Ral, Crackling Wit and similar)
  const loyaltyMatch = lowerOracle.match(/whenever you cast (?:a |an )?(noncreature|creature|instant|sorcery|instant or sorcery)?\s*spell,?\s*put (?:a |an )?(\w+)?\s*loyalty counter/i);
  if (loyaltyMatch) {
    const spellType = loyaltyMatch[1]?.toLowerCase() || 'any';
    const countStr = loyaltyMatch[2]?.toLowerCase();
    
    let spellCondition: SpellCastTrigger['spellCondition'] = 'any';
    if (spellType === 'noncreature') spellCondition = 'noncreature';
    else if (spellType === 'creature') spellCondition = 'creature';
    else if (spellType === 'instant' || spellType === 'sorcery' || spellType === 'instant or sorcery') spellCondition = 'instant_sorcery';
    
    // Parse the count (one, two, three, etc.)
    const countMap: Record<string, number> = {
      'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
    };
    const loyaltyCount = countMap[countStr] || 1;
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast a ${spellType} spell, put a loyalty counter on ${cardName}`,
      effect: `put ${loyaltyCount} loyalty counter${loyaltyCount > 1 ? 's' : ''} on ${cardName}`,
      spellCondition,
      addsLoyaltyCounters: loyaltyCount,
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all spell-cast triggers that should fire when a spell is cast
 */
export function getSpellCastTriggers(
  ctx: GameContext,
  casterId: string,
  spellCard: any
): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  
  const spellCreatureTypes = extractCreatureTypes(spellTypeLine);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue;
    
    const permTriggers = detectSpellCastTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      let shouldTrigger = false;
      
      switch (trigger.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'creature':
          shouldTrigger = isCreatureSpell;
          break;
        case 'noncreature':
          shouldTrigger = !isCreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
        case 'tribal_type':
          if (trigger.tribalType) {
            shouldTrigger = spellCreatureTypes.includes(trigger.tribalType.toLowerCase()) ||
                           spellTypeLine.includes(trigger.tribalType.toLowerCase());
          }
          break;
      }
      
      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// Storm Mechanic
// ============================================================================

/**
 * Detect if a card has the storm ability
 */
export function detectStormAbility(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  if (keywords.some((k: string) => k.toLowerCase() === 'storm')) {
    return true;
  }
  
  if (oracleText.includes('storm') && 
      oracleText.includes('copy it for each spell cast before it')) {
    return true;
  }
  
  return false;
}

/**
 * Get the storm count (number of spells cast before this one)
 */
export function getStormCount(gameState: any): number {
  const spellsCastThisTurn = gameState?.spellsCastThisTurn || [];
  return Math.max(0, spellsCastThisTurn.length - 1);
}
