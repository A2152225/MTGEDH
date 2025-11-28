/**
 * replacementEffects.ts
 * 
 * Handles replacement effects for common game scenarios.
 * 
 * Based on MTG Comprehensive Rules:
 * - Rule 614: Replacement Effects
 * - Rule 615: Prevention Effects
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';

/**
 * Types of replacement effects
 */
export enum ReplacementEffectType {
  // ETB replacements
  ENTERS_TAPPED = 'enters_tapped',
  ENTERS_WITH_COUNTERS = 'enters_with_counters',
  ENTERS_AS_COPY = 'enters_as_copy',
  /** 
   * Conditional ETB replacement (Mox Diamond style)
   * "If ~ would enter the battlefield, you may [action] instead. If you do/don't..."
   */
  ENTERS_CONDITIONAL = 'enters_conditional',
  
  // Damage replacements
  PREVENT_DAMAGE = 'prevent_damage',
  REDIRECT_DAMAGE = 'redirect_damage',
  REDUCE_DAMAGE = 'reduce_damage',
  /**
   * Combat damage to mill replacement (Undead Alchemist style)
   * "If ~ would deal combat damage to a player, instead that player mills..."
   */
  COMBAT_DAMAGE_TO_MILL = 'combat_damage_to_mill',
  
  // Zone change replacements
  DIES_TO_EXILE = 'dies_to_exile',
  DIES_TO_COMMAND = 'dies_to_command',
  DIES_WITH_EFFECT = 'dies_with_effect',
  WOULD_DRAW_INSTEAD = 'would_draw_instead',
  WOULD_DISCARD_INSTEAD = 'would_discard_instead',
  /**
   * Mill to exile replacement (e.g., Rest in Peace, Leyline of the Void, Undead Alchemist trigger condition)
   * "If a card would be put into a graveyard from anywhere, exile it instead"
   */
  MILL_TO_EXILE = 'mill_to_exile',
  /**
   * Graveyard to exile replacement (Rest in Peace, Leyline of the Void)
   * "If a card would be put into a graveyard from anywhere, exile it instead"
   */
  GRAVEYARD_TO_EXILE = 'graveyard_to_exile',
  
  // Life replacements
  LIFE_GAIN_TO_COUNTERS = 'life_gain_to_counters',
  LIFE_LOSS_PREVENTION = 'life_loss_prevention',
  
  // Combat replacements
  COMBAT_DAMAGE_TO_COUNTERS = 'combat_damage_to_counters',
  COMBAT_DAMAGE_TO_PLAYER = 'combat_damage_to_player',
  
  // Token/counter replacements
  EXTRA_TOKENS = 'extra_tokens',
  EXTRA_COUNTERS = 'extra_counters',
  MODIFIED_COUNTERS = 'modified_counters',
}

/**
 * Parsed replacement effect from oracle text
 */
export interface ParsedReplacementEffect {
  readonly type: ReplacementEffectType;
  readonly sourceId: string;
  readonly controllerId: PlayerID;
  readonly condition?: string;
  readonly affectedEvent: string;
  readonly replacement: string;
  readonly isSelfReplacement: boolean;
  readonly value?: number | string;
  /** Whether this requires player choice (e.g., "you may discard a land card") */
  readonly requiresChoice?: boolean;
  /** The action required for the replacement (e.g., "discard a land card") */
  readonly requiredAction?: string;
  /** Effect when player doesn't choose (e.g., "put it into its owner's graveyard") */
  readonly elseEffect?: string;
  /** Creature types this applies to (e.g., "Zombie" for Undead Alchemist) */
  readonly appliesToTypes?: readonly string[];
}

/**
 * Result of applying a replacement effect
 */
export interface ReplacementResult {
  readonly applied: boolean;
  readonly modifiedEvent?: any;
  readonly preventedEvent?: boolean;
  readonly log: string[];
}

/**
 * Parse replacement effects from oracle text
 */
export function parseReplacementEffectsFromText(
  oracleText: string,
  permanentId: string,
  controllerId: PlayerID,
  cardName: string
): ParsedReplacementEffect[] {
  const effects: ParsedReplacementEffect[] = [];
  const text = oracleText.toLowerCase();
  
  // ETB tapped
  if (text.includes('enters the battlefield tapped')) {
    effects.push({
      type: ReplacementEffectType.ENTERS_TAPPED,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'enters_battlefield',
      replacement: 'enters tapped',
      isSelfReplacement: true,
    });
  }
  
  // ETB with counters
  const counterMatch = text.match(/enters the battlefield with (\d+|a|an) ([+\-\d\/]+|\w+) counters?/i);
  if (counterMatch) {
    const count = counterMatch[1] === 'a' || counterMatch[1] === 'an' ? '1' : counterMatch[1];
    effects.push({
      type: ReplacementEffectType.ENTERS_WITH_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'enters_battlefield',
      replacement: `enters with ${count} ${counterMatch[2]} counters`,
      isSelfReplacement: true,
      value: `${count}:${counterMatch[2]}`,
    });
  }
  
  // "If would die, instead" patterns
  if (text.includes('if') && text.includes('would') && text.includes('die') && text.includes('instead')) {
    effects.push({
      type: ReplacementEffectType.DIES_WITH_EFFECT,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'dies',
      replacement: extractInsteadClause(text, 'die'),
      isSelfReplacement: text.includes('this creature') || text.includes(`${cardName.toLowerCase()}`),
    });
  }
  
  // "If would deal damage, instead" patterns
  if (text.includes('if') && text.includes('would') && text.includes('damage') && text.includes('instead')) {
    const redirectMatch = text.includes('to you') || text.includes('to its controller');
    effects.push({
      type: redirectMatch ? ReplacementEffectType.REDIRECT_DAMAGE : ReplacementEffectType.PREVENT_DAMAGE,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'damage',
      replacement: extractInsteadClause(text, 'damage'),
      isSelfReplacement: false,
    });
  }
  
  // "Prevent all damage that would be dealt"
  if (text.includes('prevent') && text.includes('damage')) {
    const damageTypeMatch = text.match(/prevent (?:all |the next )?(\d+)?\s*(?:combat )?damage/i);
    effects.push({
      type: ReplacementEffectType.PREVENT_DAMAGE,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'damage',
      replacement: 'prevent damage',
      isSelfReplacement: text.includes('to this') || text.includes('to it'),
      value: damageTypeMatch?.[1] ? parseInt(damageTypeMatch[1]) : undefined,
    });
  }
  
  // "If you would gain life, instead"
  if (text.includes('if') && text.includes('would') && text.includes('gain life') && text.includes('instead')) {
    effects.push({
      type: ReplacementEffectType.LIFE_GAIN_TO_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'gain_life',
      replacement: extractInsteadClause(text, 'gain life'),
      isSelfReplacement: false,
    });
  }
  
  // "If you would draw a card, instead"
  if (text.includes('if') && text.includes('would') && text.includes('draw') && text.includes('instead')) {
    effects.push({
      type: ReplacementEffectType.WOULD_DRAW_INSTEAD,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'draw',
      replacement: extractInsteadClause(text, 'draw'),
      isSelfReplacement: false,
    });
  }
  
  // Token doubling effects
  if (text.includes('if') && text.includes('token') && text.includes('would') && text.includes('create')) {
    effects.push({
      type: ReplacementEffectType.EXTRA_TOKENS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'create_token',
      replacement: 'create twice that many instead',
      isSelfReplacement: false,
    });
  }
  
  // Hardened Scales-style: "that many plus one" counter modification
  // Pattern: "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead"
  const hardenedScalesMatch = text.match(/if (?:one or more )?([+\-\d\/]+) counters? would be (?:put|placed) on .+?,?\s*(?:that many )?plus (?:one|1)/i);
  if (hardenedScalesMatch) {
    effects.push({
      type: ReplacementEffectType.MODIFIED_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'place_counter',
      replacement: 'place that many plus one instead',
      isSelfReplacement: false,
      value: '+1', // Add one extra counter
    });
  }
  // Counter doubling effects (Doubling Season style) - only if not already matched by Hardened Scales
  else if (text.includes('if') && text.includes('counter') && text.includes('would') && 
      (text.includes('placed') || text.includes('put')) && text.includes('twice')) {
    effects.push({
      type: ReplacementEffectType.EXTRA_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'place_counter',
      replacement: 'place twice that many instead',
      isSelfReplacement: false,
    });
  }
  
  // Mox Diamond-style: "If ~ would enter the battlefield, you may [action] instead. 
  // If you do, put ~ onto the battlefield. If you don't, put it into its owner's graveyard."
  // Pattern broken into logical parts for maintainability:
  // - "if [card] would enter the battlefield"
  // - "you may [action] instead"
  // - "if you do, [effect]"
  // - "if you don't, [else effect]"
  const conditionalETBMatch = text.match(
    /if .+? would enter the battlefield,?\s*you may\s+(.+?)\s+instead\.?\s*if you do,?\s*(.+?)\.?\s*if you don'?t,?\s*(.+?)[.]/i
  );
  if (conditionalETBMatch) {
    effects.push({
      type: ReplacementEffectType.ENTERS_CONDITIONAL,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'enters_battlefield',
      replacement: conditionalETBMatch[2]?.trim() || 'put onto battlefield',
      isSelfReplacement: true,
      requiresChoice: true,
      requiredAction: conditionalETBMatch[1]?.trim(),
      elseEffect: conditionalETBMatch[3]?.trim(),
    });
  }
  
  // Undead Alchemist-style: "If a [creature type] you control would deal combat damage to a player, 
  // instead that player mills that many cards"
  const combatDamageToMillMatch = text.match(
    /if (?:a |an )?(\w+)(?: you control)? would deal combat damage to a player,?\s*instead\s+that player mills?\s+(?:that many|(\d+))\s*cards?/i
  );
  if (combatDamageToMillMatch) {
    // Capitalize the creature type for consistent matching
    const creatureType = combatDamageToMillMatch[1].charAt(0).toUpperCase() + combatDamageToMillMatch[1].slice(1);
    effects.push({
      type: ReplacementEffectType.COMBAT_DAMAGE_TO_MILL,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'combat_damage_to_player',
      replacement: 'player mills cards instead',
      isSelfReplacement: false,
      appliesToTypes: [creatureType],
      value: combatDamageToMillMatch[2] || 'damage_amount',
    });
  }
  
  // Rest in Peace / Leyline of the Void style graveyard replacement
  // Handles multiple patterns:
  // - "If a card would be put into a graveyard from anywhere, exile it instead" (Rest in Peace)
  // - "If a card would be put into an opponent's graveyard from anywhere, exile it instead" (Leyline)
  // - "If a card or token would be put into a graveyard..." (Rest in Peace full text)
  const graveyardToExilePatterns = [
    /if a card would be put into a graveyard from anywhere,?\s*exile it instead/i,
    /if a card would be put into an opponent'?s graveyard from anywhere,?\s*exile it instead/i,
    /if (?:a |one or more )?(?:cards? or tokens?) would be put into (?:a )?graveyard(?: from anywhere)?,?\s*exile (?:it|that card|them) instead/i,
  ];
  
  for (const pattern of graveyardToExilePatterns) {
    if (pattern.test(text)) {
      effects.push({
        type: ReplacementEffectType.GRAVEYARD_TO_EXILE,
        sourceId: permanentId,
        controllerId,
        affectedEvent: 'put_into_graveyard',
        replacement: 'exile instead',
        isSelfReplacement: false,
        condition: text.includes("opponent's") ? 'opponent_only' : undefined,
      });
      break; // Only add once even if multiple patterns match
    }
  }
  
  // Oona, Queen of the Fae style ability detection: "exiles the top X cards of their library"
  // NOTE: This is technically an activated ability effect, not a replacement effect.
  // We parse it here to enable the game engine to recognize cards that exile from library
  // (instead of milling to graveyard) so the UI and automation can handle them correctly.
  // The MILL_TO_EXILE type is used to indicate "this effect exiles cards from library".
  const exileFromLibraryMatch = text.match(/(?:target (?:opponent|player) )?exiles? the top (\d+|x) cards? of (?:their|his or her|your) library/i);
  if (exileFromLibraryMatch) {
    effects.push({
      type: ReplacementEffectType.MILL_TO_EXILE,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'mill',
      replacement: 'exile instead of mill',
      isSelfReplacement: false,
      value: exileFromLibraryMatch[1]?.toLowerCase() === 'x' ? 'X' : exileFromLibraryMatch[1],
    });
  }
  
  return effects;
}

/**
 * Extract the "instead" clause from oracle text
 */
function extractInsteadClause(text: string, event: string): string {
  const insteadIndex = text.indexOf('instead');
  if (insteadIndex === -1) return '';
  
  // Look for text between "instead" and the next period
  const afterInstead = text.slice(insteadIndex + 7);
  const periodIndex = afterInstead.indexOf('.');
  if (periodIndex === -1) return afterInstead.trim();
  
  return afterInstead.slice(0, periodIndex).trim();
}

/**
 * Check if an ETB replacement applies (conditional land ETBs)
 */
export interface ETBConditionCheck {
  readonly entersTapped: boolean;
  readonly reason?: string;
  readonly playerChoice?: boolean;
}

/**
 * Evaluate conditional ETB replacement effects
 * Examples:
 * - "unless you control two or fewer other lands" (fast lands)
 * - "unless you control a [type]" (check lands)
 * - "you may pay 2 life" (shock lands)
 */
export function evaluateETBCondition(
  card: KnownCardRef,
  controlledLandCount: number,
  controlledLandTypes: string[],
  paidLife?: boolean
): ETBConditionCheck {
  const text = (card.oracle_text || '').toLowerCase();
  
  // Always tapped (no condition)
  if (text.includes('enters the battlefield tapped') && !text.includes('unless')) {
    return { entersTapped: true, reason: 'Always enters tapped' };
  }
  
  // Shock lands - "You may pay 2 life. If you don't, this enters tapped."
  if (text.includes('pay 2 life') && text.includes('enters') && text.includes('tapped')) {
    if (paidLife === true) {
      return { entersTapped: false, reason: 'Paid 2 life', playerChoice: true };
    }
    return { entersTapped: true, reason: 'Did not pay life', playerChoice: true };
  }
  
  // Fast lands - "unless you control two or fewer other lands"
  const fastLandMatch = text.match(/enters the battlefield tapped unless you control two or fewer other lands/i);
  if (fastLandMatch) {
    const entersTapped = controlledLandCount > 2;
    return { 
      entersTapped, 
      reason: entersTapped ? 'Control more than 2 other lands' : 'Control 2 or fewer other lands'
    };
  }
  
  // Slow lands - "unless you control two or more other lands"
  const slowLandMatch = text.match(/enters the battlefield tapped unless you control two or more other lands/i);
  if (slowLandMatch) {
    const entersTapped = controlledLandCount < 2;
    return { 
      entersTapped, 
      reason: entersTapped ? 'Control fewer than 2 other lands' : 'Control 2 or more other lands'
    };
  }
  
  // Check lands - "unless you control a [type]"
  const checkLandMatch = text.match(/enters the battlefield tapped unless you control (?:a|an) ([\w\s]+)/i);
  if (checkLandMatch) {
    const requiredType = checkLandMatch[1].trim().toLowerCase();
    // Split "Swamp or Mountain" into individual types
    const requiredTypes = requiredType.split(/\s+or\s+/).map(t => t.trim());
    
    const hasRequiredType = requiredTypes.some(reqType =>
      controlledLandTypes.some(controlled => controlled.toLowerCase().includes(reqType))
    );
    
    return { 
      entersTapped: !hasRequiredType, 
      reason: hasRequiredType ? `Control a ${requiredType}` : `Don't control a ${requiredType}`
    };
  }
  
  // Pathway lands, triomes with conditions, etc.
  // Default to not tapped if no condition found
  return { entersTapped: false };
}

/**
 * Apply replacement effect to an event
 */
export function applyReplacementEffect(
  effect: ParsedReplacementEffect,
  event: any
): ReplacementResult {
  const logs: string[] = [];
  
  switch (effect.type) {
    case ReplacementEffectType.ENTERS_TAPPED:
      logs.push(`${effect.sourceId} enters tapped (replacement effect)`);
      return {
        applied: true,
        modifiedEvent: { ...event, entersTapped: true },
        log: logs,
      };
      
    case ReplacementEffectType.ENTERS_WITH_COUNTERS:
      if (effect.value) {
        const [count, counterType] = (effect.value as string).split(':');
        logs.push(`${effect.sourceId} enters with ${count} ${counterType} counter(s)`);
        return {
          applied: true,
          modifiedEvent: { ...event, counters: { [counterType]: parseInt(count) } },
          log: logs,
        };
      }
      return { applied: false, log: logs };
      
    case ReplacementEffectType.PREVENT_DAMAGE:
      const preventAmount = effect.value as number | undefined;
      if (preventAmount !== undefined) {
        const actualPrevented = Math.min(preventAmount, event.damage || 0);
        logs.push(`Prevented ${actualPrevented} damage`);
        return {
          applied: true,
          modifiedEvent: { ...event, damage: (event.damage || 0) - actualPrevented },
          log: logs,
        };
      } else {
        logs.push(`Prevented all damage`);
        return {
          applied: true,
          modifiedEvent: { ...event, damage: 0 },
          preventedEvent: true,
          log: logs,
        };
      }
      
    case ReplacementEffectType.EXTRA_TOKENS:
      const tokenCount = event.tokenCount || 1;
      logs.push(`Token doubling: creating ${tokenCount * 2} tokens instead of ${tokenCount}`);
      return {
        applied: true,
        modifiedEvent: { ...event, tokenCount: tokenCount * 2 },
        log: logs,
      };
      
    case ReplacementEffectType.EXTRA_COUNTERS:
      const counterCount = event.counterCount || 1;
      logs.push(`Counter doubling: placing ${counterCount * 2} counters instead of ${counterCount}`);
      return {
        applied: true,
        modifiedEvent: { ...event, counterCount: counterCount * 2 },
        log: logs,
      };
      
    case ReplacementEffectType.MODIFIED_COUNTERS:
      // Hardened Scales-style: add extra counters based on value
      const baseCounterCount = event.counterCount || 1;
      let modifiedCount = baseCounterCount;
      if (effect.value === '+1') {
        modifiedCount = baseCounterCount + 1;
        logs.push(`Counter modification: placing ${modifiedCount} counters instead of ${baseCounterCount} (Hardened Scales effect)`);
      } else if (typeof effect.value === 'number') {
        modifiedCount = baseCounterCount + effect.value;
        logs.push(`Counter modification: placing ${modifiedCount} counters instead of ${baseCounterCount}`);
      }
      return {
        applied: true,
        modifiedEvent: { ...event, counterCount: modifiedCount },
        log: logs,
      };
      
    case ReplacementEffectType.ENTERS_CONDITIONAL:
      // Mox Diamond-style: requires a choice (e.g., discard a land)
      // The caller must determine if the player made the choice
      if (event.playerMadeChoice === true) {
        logs.push(`${effect.sourceId} enters the battlefield (player performed ${effect.requiredAction})`);
        return {
          applied: true,
          modifiedEvent: { ...event, enters: true, performedAction: effect.requiredAction },
          log: logs,
        };
      } else if (event.playerMadeChoice === false) {
        logs.push(`${effect.sourceId} is put into graveyard (player did not ${effect.requiredAction})`);
        return {
          applied: true,
          modifiedEvent: { ...event, enters: false, goesToGraveyard: true },
          preventedEvent: true,
          log: logs,
        };
      }
      // Choice not yet made - return pending state
      logs.push(`${effect.sourceId} awaiting player choice: ${effect.requiredAction}`);
      return {
        applied: false,
        modifiedEvent: { ...event, awaitingChoice: true, requiredAction: effect.requiredAction, elseEffect: effect.elseEffect },
        log: logs,
      };
      
    case ReplacementEffectType.COMBAT_DAMAGE_TO_MILL:
      // Undead Alchemist-style: combat damage becomes mill
      const damageAmount = event.damage || 0;
      if (damageAmount > 0) {
        // Check if the creature type matches (if applicable)
        if (effect.appliesToTypes && effect.appliesToTypes.length > 0) {
          const creatureTypes = event.attackerTypes || [];
          const typeMatches = effect.appliesToTypes.some(t => 
            creatureTypes.some((ct: string) => ct.toLowerCase() === t.toLowerCase())
          );
          if (!typeMatches) {
            return { applied: false, log: logs };
          }
        }
        logs.push(`Combat damage replaced with mill: player mills ${damageAmount} cards instead`);
        return {
          applied: true,
          modifiedEvent: { 
            ...event, 
            damage: 0, 
            millAmount: damageAmount,
            replacedByMill: true
          },
          preventedEvent: true,
          log: logs,
        };
      }
      return { applied: false, log: logs };
      
    case ReplacementEffectType.GRAVEYARD_TO_EXILE:
      // Rest in Peace / Leyline of the Void style
      logs.push(`Card would go to graveyard - exiled instead by ${effect.sourceId}`);
      return {
        applied: true,
        modifiedEvent: { 
          ...event, 
          destination: 'exile',
          originalDestination: 'graveyard',
          replacedByExile: true
        },
        log: logs,
      };
      
    case ReplacementEffectType.MILL_TO_EXILE:
      // Oona-style: cards are exiled from library instead of going to graveyard
      const millCount = typeof effect.value === 'string' && effect.value === 'X' 
        ? (event.xValue || 0) 
        : (typeof effect.value === 'number' ? effect.value : parseInt(effect.value as string) || 0);
      logs.push(`Milling ${millCount} cards to exile instead of graveyard`);
      return {
        applied: true,
        modifiedEvent: { 
          ...event, 
          millCount,
          destination: 'exile',
          exiledFromLibrary: true
        },
        log: logs,
      };
      
    default:
      return { applied: false, log: logs };
  }
}

/**
 * Collect all active replacement effects from battlefield
 */
export function collectReplacementEffects(
  battlefield: BattlefieldPermanent[]
): ParsedReplacementEffect[] {
  const effects: ParsedReplacementEffect[] = [];
  
  for (const perm of battlefield) {
    const card = perm.card as KnownCardRef;
    if (!card?.oracle_text) continue;
    
    const parsed = parseReplacementEffectsFromText(
      card.oracle_text,
      perm.id,
      perm.controller,
      card.name || 'Unknown'
    );
    effects.push(...parsed);
  }
  
  return effects;
}

/**
 * Sort replacement effects by priority (self-replacement first)
 */
export function sortReplacementEffects(
  effects: ParsedReplacementEffect[],
  eventSourceId: string
): ParsedReplacementEffect[] {
  return [...effects].sort((a, b) => {
    // Self-replacement effects apply first (Rule 614.12)
    const aIsSelf = a.isSelfReplacement && a.sourceId === eventSourceId;
    const bIsSelf = b.isSelfReplacement && b.sourceId === eventSourceId;
    
    if (aIsSelf && !bIsSelf) return -1;
    if (!aIsSelf && bIsSelf) return 1;
    
    return 0;
  });
}

export default {
  parseReplacementEffectsFromText,
  evaluateETBCondition,
  applyReplacementEffect,
  collectReplacementEffects,
  sortReplacementEffects,
};
