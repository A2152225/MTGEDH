import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from './timing-effect-extraction.js';
import type { SpellCastTrigger, SpellCastUntapEffect } from "./types.js";

export type { SpellCastTrigger, SpellCastUntapEffect } from "./types.js";

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
      effectType: 'untap_all_nonland',
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
      effectType: 'untap_all_creatures',
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
      effectType: 'untap_all_nonland',
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
    
    switch (effect.effectType) {
      case 'untap_all_nonland':
        shouldUntap = !typeLine.includes('land');
        break;
      case 'untap_all_creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'untap_equipped':
        shouldUntap = false;
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
    /whenever you cast (?:a |an )?(\w+) spell(?!\s+that\b),?\s*([^.]+)/gi,
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery) spell(?!\s+that\b),?\s*([^.]+)/gi,
  ];
  
  for (const pattern of spellCastPatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const effectText = timingTriggerEffect(oracleText, match, 2);
      
      let spellCondition: SpellCastTrigger['spellCondition'] = 'any';
      let tribalType: string | undefined;
      
      if (spellType === 'creature') {
        spellCondition = 'creature';
      } else if (spellType === 'noncreature') {
        spellCondition = 'noncreature';
      } else if (spellType === 'historic') {
        spellCondition = 'historic';
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
          // Extract color and creature type: "1/1 white Warrior creature token"
          const typeMatch = effectText.match(/(\d+\/\d+)\s+(?:(white|blue|black|red|green|colorless)\s+)?([A-Z][a-z]+(?: [A-Z][a-z]+)*)?\s*(?:artifact\s+)?creature\s+token/i);
          const tokenColor = typeMatch?.[2] || '';
          const tokenType = typeMatch?.[3] || tribalType || 'Token';
          const tokenTypeDisplay = tokenType.charAt(0).toUpperCase() + tokenType.slice(1);
          
          // Extract abilities: "token with vigilance" or "token with flying and haste"
          const abilityMatch = effectText.match(/token\s+with\s+([^.]+)/i);
          let abilities: string[] | undefined;
          if (abilityMatch) {
            // Split on "and" or "," to get individual abilities
            abilities = abilityMatch[1].split(/\s+and\s+|,\s*/i).map(a => a.trim().toLowerCase());
          }
          
          // Check for artifact token
          const isArtifact = effectText.toLowerCase().includes('artifact creature token');
          
          tokenDetails = {
            // Color belongs on `colors`, not the display name ("Blue Merfolk" → "Merfolk").
            name: tokenTypeDisplay,
            power: parseInt(tokenPowerMatch[1]),
            toughness: parseInt(tokenPowerMatch[2]),
            types: `${isArtifact ? 'Artifact ' : ''}Creature — ${tokenTypeDisplay}`,
            ...(tokenColor ? { colors: [tokenColor.toLowerCase()] } : {}),
            abilities,
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
        effect: timingTriggerEffect(oracleText, effectMatch),
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
  
  // Reflections of Littjara / "chosen type" spell copy pattern
  // "Whenever you cast a spell of the chosen type, copy that spell"
  // The chosen type is stored on the permanent as chosenCreatureType
  const chosenType = (permanent as any)?.chosenCreatureType;
  if (chosenType && lowerOracle.includes('whenever you cast a spell of the chosen type')) {
    const effectMatch = oracleText.match(/whenever you cast a spell of the chosen type,?\s*([^.]+)/i);
    if (effectMatch) {
      const effect = String(effectMatch[1] || '').trim();
      const copiesSpell = effect.toLowerCase().includes('copy that spell') || effect.toLowerCase().includes('copy it');
      
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever you cast a ${chosenType} spell, ${effect}`,
        effect,
        spellCondition: 'tribal_type',
        tribalType: chosenType,
        mandatory: !effect.toLowerCase().includes('you may'),
        // Mark that this trigger copies spells for special handling
        ...((copiesSpell && { copiesSpell: true }) as any),
      });
    }
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
  const isHistoricSpell = spellTypeLine.includes('artifact') || spellTypeLine.includes('legendary') || spellTypeLine.includes('saga');
  
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
        case 'historic':
          shouldTrigger = isHistoricSpell;
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
// Opponent Spell Cast Triggers (Esper Sentinel, Rhystic Study, Mystic Remora)
// ============================================================================

/**
 * Opponent spell cast trigger type - cards that trigger when opponents cast spells
 */
export interface OpponentSpellCastTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;  // Who controls the permanent (gets the benefit)
  casterId: string;      // Who cast the spell (the opponent)
  description: string;
  effect: string;
  triggerType: OpponentCastTriggerType;
  paymentCost?: string;  // What the caster can pay to prevent the effect
  paymentAmount?: number; // X value for variable payments (Esper Sentinel)
  benefitIfNotPaid: string; // Effect if opponent doesn't pay
  mandatory: boolean;
}

/**
 * Detect opponent spell cast triggers from a permanent's abilities
 * These are permanents that trigger when an OPPONENT casts a spell
 * 
 * Examples:
 * - Esper Sentinel: "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}."
 * - Rhystic Study: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}."
 * - Mystic Remora: "Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}."
 */
export type OpponentCastTriggerType =
  | 'esper_sentinel'
  | 'rhystic_study'
  | 'mystic_remora'
  | 'opponent_casts_any'
  | 'opponent_casts_first_noncreature'
  | 'opponent_casts_noncreature'
  | 'opponent_casts_creature'
  | 'any_player_casts_any'
  | 'any_player_casts_creature'
  | 'any_player_casts_noncreature';

export type OpponentCastSpellCondition =
  | 'any'
  | 'noncreature'
  | 'creature'
  | 'first_noncreature'
  | 'first_any';

export type OpponentCastCasterScope = 'opponent' | 'any_player';

export type DetectedOpponentSpellCastTrigger = {
  triggerType: OpponentCastTriggerType;
  spellCondition: OpponentCastSpellCondition;
  casterScope: OpponentCastCasterScope;
  paymentCost?: string;
  paymentIsVariable?: boolean;
  benefitIfNotPaid: string;
  description: string;
};

function parseOpponentCastSpellType(rawType: string): Pick<DetectedOpponentSpellCastTrigger, 'spellCondition' | 'triggerType'> {
  const typeToken = String(rawType || '').trim().toLowerCase();
  if (!typeToken || typeToken === 'spell') {
    return { spellCondition: 'any', triggerType: 'opponent_casts_any' };
  }
  if (typeToken.includes('first') && typeToken.includes('noncreature')) {
    return { spellCondition: 'first_noncreature', triggerType: 'opponent_casts_first_noncreature' };
  }
  if (typeToken === 'noncreature' || typeToken.includes('noncreature')) {
    return { spellCondition: 'noncreature', triggerType: 'opponent_casts_noncreature' };
  }
  if (typeToken === 'creature' || (typeToken.includes('creature') && !typeToken.includes('noncreature'))) {
    return { spellCondition: 'creature', triggerType: 'opponent_casts_creature' };
  }
  if (
    typeToken.includes('instant') ||
    typeToken.includes('sorcery') ||
    typeToken.includes('artifact')
  ) {
    return { spellCondition: 'noncreature', triggerType: 'opponent_casts_noncreature' };
  }
  return { spellCondition: 'any', triggerType: 'opponent_casts_any' };
}

function normalizeOpponentCastTriggerDescription(description: string): string {
  return String(description || '')
    .trim()
    .replace(/\.+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function opponentCastTriggerSpecificityScore(trigger: DetectedOpponentSpellCastTrigger): number {
  let score = 0;
  // Prefer known pay-or types over generic cast detection.
  if (trigger.triggerType === 'esper_sentinel' || trigger.triggerType === 'rhystic_study' || trigger.triggerType === 'mystic_remora') {
    score += 100;
  }
  if (String(trigger.paymentCost || '').trim()) score += 20;
  if (String(trigger.benefitIfNotPaid || '').trim() && trigger.benefitIfNotPaid !== 'trigger effect') score += 10;
  if (trigger.paymentIsVariable) score += 5;
  return score;
}

function pushUniqueOpponentCastTrigger(
  triggers: DetectedOpponentSpellCastTrigger[],
  candidate: DetectedOpponentSpellCastTrigger,
): void {
  const candidateDescription = normalizeOpponentCastTriggerDescription(candidate.description);
  const candidatePayment = String(candidate.paymentCost || '').trim().toLowerCase();
  const existingIndex = triggers.findIndex((existing) => {
    if (existing.spellCondition !== candidate.spellCondition) return false;
    if (existing.casterScope !== candidate.casterScope) return false;

    const existingDescription = normalizeOpponentCastTriggerDescription(existing.description);
    if (existingDescription && candidateDescription && existingDescription === candidateDescription) {
      return true;
    }

    // Same cast scope/condition with the same unless-pay tax is one trigger even when
    // description punctuation differs (Rhystic Study known row vs unlessPayPatterns).
    const existingPayment = String(existing.paymentCost || '').trim().toLowerCase();
    if (existingPayment && candidatePayment && existingPayment === candidatePayment) {
      return true;
    }

    return false;
  });

  if (existingIndex < 0) {
    triggers.push(candidate);
    return;
  }

  // Keep the richer / more specific detection (known type + real benefit text).
  if (opponentCastTriggerSpecificityScore(candidate) > opponentCastTriggerSpecificityScore(triggers[existingIndex]!)) {
    triggers[existingIndex] = candidate;
  }
}

export function detectOpponentSpellCastTriggers(card: any, permanent: any): DetectedOpponentSpellCastTrigger[] {
  const triggers: DetectedOpponentSpellCastTrigger[] = [];
  const oracleText = String(card?.oracle_text || '');
  const lowerOracle = oracleText.toLowerCase();
  const cardName = String(card?.name || '').toLowerCase();

  const playerCyclesACardMatch = oracleText.match(/whenever a player cycles a card,?\s*([^.]+)/i);
  if (playerCyclesACardMatch) {
    const effectText = timingTriggerEffect(oracleText, playerCyclesACardMatch);
    if (effectText) {
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'any_player_casts_any',
        spellCondition: 'any',
        casterScope: 'any_player',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, playerCyclesACardMatch, 0),
      });
    }
  }

  const mentionsCastTrigger =
    /\b(?:when|whenever)\b/i.test(oracleText) &&
    /\bcast(?:s)?\b/i.test(lowerOracle) &&
    (
      /\b(?:an opponent|opponent|a player|each opponent|enchanted player|the chosen player|another player|another opponent)\b/i.test(lowerOracle) ||
      /\bplayer casts\b/i.test(lowerOracle) ||
      /\benchanted (?:player|creature) casts\b/i.test(lowerOracle) ||
      /\b(?:the )?first\b.*\bspell\b.*\bis cast\b/i.test(lowerOracle)
    );

  if (!mentionsCastTrigger) {
    return triggers;
  }

  const enchantedPlayerCastPatterns = [
    /whenever enchanted player casts(?: (?:a |an )?([\w\s]*?)spell)?(?: with the chosen name)?(?:,?\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /whenever enchanted player casts (?:a |an )?other spell(?:s)? they cast each turn,?\s*([^.]+)/gi,
    /whenever enchanted (?:player |creature )?casts (?:a |an )?([\w\s]*?)spell,?\s*([^.]+)/gi,
  ];
  for (const pattern of enchantedPlayerCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText) continue;
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'opponent_casts_any',
        spellCondition: 'any',
        casterScope: 'opponent',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const chosenPlayerCastPatterns = [
    /whenever the chosen (?:player )?casts (?:a |an )?([\w\s]*?)spell,?\s*([^.]+)/gi,
    /whenever (?:a player|opponent) casts (?:a |an )?spell with the chosen name,?\s*([^.]+)/gi,
  ];
  for (const pattern of chosenPlayerCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText) continue;
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'any_player_casts_any',
        spellCondition: 'any',
        casterScope: 'any_player',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const castFromNonHandPatterns = [
    /whenever another (?:player|opponent) casts (?:a |an )?spell from anywhere other than (?:their|that player's) hand,?\s*([^.]+)/gi,
    /whenever an opponent casts (?:a |an )?spell from anywhere other than (?:their|that player's) hand,?\s*([^.]+)/gi,
  ];
  for (const pattern of castFromNonHandPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText) continue;
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'opponent_casts_any',
        spellCondition: 'any',
        casterScope: 'opponent',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const firstSpellOfTurnPatterns = [
    /whenever the first noncreature spell of a turn is cast,?\s*([^.]+)/gi,
    /whenever the first spell of a turn is cast,?\s*([^.]+)/gi,
  ];
  for (const pattern of firstSpellOfTurnPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText) continue;
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'any_player_casts_any',
        spellCondition: 'first_any',
        casterScope: 'any_player',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const opponentCastDuringYourTurnPattern =
    /whenever an opponent casts (?:a |an )?([\w\s]*?)spell during your turn,?\s*([^.]+)/gi;
  let opponentDuringTurnMatch: RegExpExecArray | null;
  opponentCastDuringYourTurnPattern.lastIndex = 0;
  while ((opponentDuringTurnMatch = opponentCastDuringYourTurnPattern.exec(oracleText)) !== null) {
    const effectText = timingTriggerEffect(oracleText, opponentDuringTurnMatch, 2);
    if (!effectText) continue;
    pushUniqueOpponentCastTrigger(triggers, {
      triggerType: 'opponent_casts_any',
      spellCondition: 'any',
      casterScope: 'opponent',
      benefitIfNotPaid: effectText,
      description: timingTriggerEffect(oracleText, opponentDuringTurnMatch, 0),
    });
  }

  if (cardName.includes('esper sentinel') ||
      (lowerOracle.includes('first noncreature spell each turn') &&
       lowerOracle.includes('unless') &&
       lowerOracle.includes('pays'))) {
    pushUniqueOpponentCastTrigger(triggers, {
      triggerType: 'esper_sentinel',
      spellCondition: 'first_noncreature',
      casterScope: 'opponent',
      paymentCost: '{X}',
      paymentIsVariable: true,
      benefitIfNotPaid: 'draw a card',
      description: 'Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}',
    });
  }

  if (cardName.includes('rhystic study') ||
      (lowerOracle.includes('opponent casts a spell') &&
       lowerOracle.includes('draw') &&
       lowerOracle.includes('unless') &&
       lowerOracle.match(/pays\s*\{1\}/))) {
    pushUniqueOpponentCastTrigger(triggers, {
      triggerType: 'rhystic_study',
      spellCondition: 'any',
      casterScope: 'opponent',
      paymentCost: '{1}',
      benefitIfNotPaid: 'draw a card',
      description: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}',
    });
  }

  if (cardName.includes('mystic remora') ||
      (lowerOracle.includes('opponent casts a noncreature spell') &&
       lowerOracle.includes('draw') &&
       lowerOracle.includes('unless') &&
       lowerOracle.includes('pays'))) {
    const paymentMatch = lowerOracle.match(/pays\s*(\{[^}]+\})/);
    const paymentCost = paymentMatch ? paymentMatch[1] : '{4}';
    pushUniqueOpponentCastTrigger(triggers, {
      triggerType: 'mystic_remora',
      spellCondition: 'noncreature',
      casterScope: 'opponent',
      paymentCost,
      benefitIfNotPaid: 'draw a card',
      description: `Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays ${paymentCost}`,
    });
  }

  const unlessPayPatterns = [
    /whenever an opponent casts (?:a |an )?(noncreature\s+)?spell[^.]*unless[^.]*pays\s*(\{[^}]+\})/gi,
    /whenever a player casts (?:a |an )?(noncreature\s+)?spell[^.]*unless[^.]*pays\s*(\{[^}]+\})/gi,
  ];
  for (const pattern of unlessPayPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const isNoncreature = Boolean(match[1]);
      const paymentCost = match[2] || '';
      const casterScope: OpponentCastCasterScope = /player casts/i.test(match[0]) ? 'any_player' : 'opponent';
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: isNoncreature
          ? (casterScope === 'any_player' ? 'any_player_casts_noncreature' : 'opponent_casts_noncreature')
          : (casterScope === 'any_player' ? 'any_player_casts_any' : 'opponent_casts_any'),
        spellCondition: isNoncreature ? 'noncreature' : 'any',
        casterScope,
        paymentCost,
        benefitIfNotPaid: 'trigger effect',
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const typedNoncreatureCastPatterns = [
    /when(?:ever)? an opponent casts an? artifact, instant, or sorcery spell(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /when(?:ever)? a player casts an? artifact, instant, or sorcery spell(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /when(?:ever)? an opponent casts an? instant or sorcery card(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /when(?:ever)? a player casts an? instant or sorcery card(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
  ];
  for (const pattern of typedNoncreatureCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText) continue;
      const casterScope: OpponentCastCasterScope = /a player casts/i.test(match[0]) ? 'any_player' : 'opponent';
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: casterScope === 'any_player' ? 'any_player_casts_noncreature' : 'opponent_casts_noncreature',
        spellCondition: 'noncreature',
        casterScope,
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  const genericCastPatterns: Array<{
    pattern: RegExp;
    casterScope: OpponentCastCasterScope;
  }> = [
    {
      pattern: /when(?:ever)? an opponent casts (?:a |an )?((?:[\w]+(?:\s+[\w]+)*?))?\s*spell(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
      casterScope: 'opponent',
    },
    {
      pattern: /when(?:ever)? a player casts (?:a |an )?((?:[\w]+(?:\s+[\w]+)*?))?\s*spell(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
      casterScope: 'any_player',
    },
    {
      pattern: /when(?:ever)? each opponent casts (?:a |an )?((?:[\w]+(?:\s+[\w]+)*?))?\s*spell(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
      casterScope: 'opponent',
    },
  ];

  const playerCastsCardMatch = oracleText.match(/whenever a player casts a card(?:,\s*if\s+[^,]+)?,?\s*([^.]+)/i);
  if (playerCastsCardMatch) {
    const effectText = timingTriggerEffect(oracleText, playerCastsCardMatch);
    if (effectText) {
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType: 'any_player_casts_any',
        spellCondition: 'any',
        casterScope: 'any_player',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, playerCastsCardMatch, 0),
      });
    }
  }

  for (const { pattern, casterScope } of genericCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const rawType = String(match[1] || '').trim();
      const effectText = timingTriggerEffect(oracleText, match, 2);
      if (!effectText) continue;
      const parsed = parseOpponentCastSpellType(rawType);
      const triggerType: OpponentCastTriggerType = casterScope === 'any_player'
        ? parsed.spellCondition === 'creature'
          ? 'any_player_casts_creature'
          : parsed.spellCondition === 'noncreature'
            ? 'any_player_casts_noncreature'
            : 'any_player_casts_any'
        : parsed.triggerType;
      const unlessPayment = effectText.match(/unless.*?pays\s*(\{[^}]+\})/i);
      pushUniqueOpponentCastTrigger(triggers, {
        triggerType,
        spellCondition: parsed.spellCondition,
        casterScope,
        paymentCost: unlessPayment?.[1] || '',
        benefitIfNotPaid: effectText,
        description: timingTriggerEffect(oracleText, match, 0),
      });
    }
  }

  return triggers;
}

/**
 * Get opponent spell cast triggers that should fire when a spell is cast
 * 
 * @param battlefield - All permanents on the battlefield
 * @param casterId - The player who cast the spell
 * @param spellCard - The spell being cast
 * @param allPlayerIds - All player IDs in the game
 * @param isFirstNoncreatureThisTurnByCaster - Whether this is the first noncreature spell the caster has cast this turn
 * @returns Array of triggers that should fire
 */
export function getOpponentSpellCastTriggers(
  battlefield: any[],
  casterId: string,
  spellCard: any,
  allPlayerIds: string[],
  isFirstNoncreatureThisTurnByCaster: boolean = false
): OpponentSpellCastTrigger[] {
  const triggers: OpponentSpellCastTrigger[] = [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isNoncreatureSpell = !isCreatureSpell;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const controller = permanent.controller;
    const permTriggers = detectOpponentSpellCastTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      if (trigger.casterScope === 'opponent' && casterId === controller) continue;
      let shouldTrigger = false;
      
      switch (trigger.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'noncreature':
          shouldTrigger = isNoncreatureSpell;
          break;
        case 'creature':
          shouldTrigger = isCreatureSpell;
          break;
        case 'first_noncreature':
          shouldTrigger = isNoncreatureSpell && isFirstNoncreatureThisTurnByCaster;
          break;
        case 'first_any':
          shouldTrigger = isFirstNoncreatureThisTurnByCaster;
          break;
      }
      
      if (shouldTrigger) {
        // Calculate payment for variable costs (Esper Sentinel)
        let paymentAmount = 1;
        if (trigger.paymentIsVariable) {
          // X = creature's power for Esper Sentinel
          const power = parseInt(permanent.card?.power || '1', 10);
          paymentAmount = isNaN(power) ? 1 : Math.max(0, power);
        } else {
          // Extract numeric value from cost string like "{1}" or "{4}"
          const costMatch = String(trigger.paymentCost || '').match(/\{(\d+)\}/);
          paymentAmount = costMatch ? parseInt(costMatch[1], 10) : 1;
        }
        
        triggers.push({
          permanentId: permanent.id,
          cardName: permanent.card?.name || 'Unknown',
          controllerId: controller,
          casterId,
          description: trigger.description,
          effect: trigger.benefitIfNotPaid,
          triggerType: trigger.triggerType,
          paymentCost: trigger.paymentIsVariable ? `{${paymentAmount}}` : trigger.paymentCost,
          paymentAmount,
          benefitIfNotPaid: trigger.benefitIfNotPaid,
          mandatory: false, // These are "may" abilities
        });
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
