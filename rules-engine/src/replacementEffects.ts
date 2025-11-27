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
  
  // Damage replacements
  PREVENT_DAMAGE = 'prevent_damage',
  REDIRECT_DAMAGE = 'redirect_damage',
  REDUCE_DAMAGE = 'reduce_damage',
  
  // Zone change replacements
  DIES_TO_EXILE = 'dies_to_exile',
  DIES_TO_COMMAND = 'dies_to_command',
  DIES_WITH_EFFECT = 'dies_with_effect',
  WOULD_DRAW_INSTEAD = 'would_draw_instead',
  WOULD_DISCARD_INSTEAD = 'would_discard_instead',
  
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
  
  // Counter doubling effects
  if (text.includes('if') && text.includes('counter') && text.includes('would') && 
      (text.includes('placed') || text.includes('put'))) {
    effects.push({
      type: ReplacementEffectType.EXTRA_COUNTERS,
      sourceId: permanentId,
      controllerId,
      affectedEvent: 'place_counter',
      replacement: 'place twice that many instead',
      isSelfReplacement: false,
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
