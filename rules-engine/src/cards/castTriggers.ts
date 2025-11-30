/**
 * cards/castTriggers.ts
 * 
 * Pattern-based detection for "when you cast" triggers that fire during casting,
 * regardless of whether the spell resolves.
 * 
 * These are different from "whenever you cast" triggers that go on the stack.
 * Cast triggers fire as the spell is put on the stack (Rule 601.2).
 * 
 * Examples: Eldrazi titans (Ulalek, Kozilek, Ulamog), cascade cards, storm cards
 */

export interface CastTriggerInfo {
  readonly hasCastTrigger: boolean;
  readonly triggerType: 'self_cast' | 'other_cast' | 'none';
  readonly effect?: string;
  readonly creatureTypeFilter?: string;
  readonly hasStorm?: boolean;
  readonly hasCascade?: boolean;
  readonly cascadeCount?: number;
  readonly copyTriggers?: boolean;
}

/**
 * Detect cast triggers from oracle text using pattern recognition
 */
export function detectCastTrigger(oracleText: string, typeLine?: string): CastTriggerInfo {
  const text = oracleText.toLowerCase();
  const types = (typeLine || '').toLowerCase();
  
  // Check for Storm keyword
  if (text.includes('storm')) {
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      hasStorm: true,
      effect: 'Copy this spell for each spell cast before it this turn.',
    };
  }
  
  // Check for Cascade keyword (count multiple cascades)
  const cascadeMatches = text.match(/cascade/gi);
  if (cascadeMatches && cascadeMatches.length > 0) {
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      hasCascade: true,
      cascadeCount: cascadeMatches.length,
      effect: `Cascade${cascadeMatches.length > 1 ? ` (×${cascadeMatches.length})` : ''} - Exile cards until you exile a nonland card that costs less. Cast it free.`,
    };
  }
  
  // Check for "when you cast this" patterns (Eldrazi-style)
  const selfCastPattern = /when you cast (this spell|this creature|~|this card)/i;
  if (selfCastPattern.test(text)) {
    // Extract the effect after the trigger
    const match = text.match(/when you cast (?:this spell|this creature|~|this card)[^,]*,?\s*([^.]+)/i);
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      effect: match ? match[1].trim() : 'Cast trigger effect',
    };
  }
  
  // Check for "when you cast" other spells (like Ulalek)
  // Pattern: "whenever you cast" + creature type
  const otherCastPattern = /whenever you cast (?:a|an|another) ([a-z]+) (?:spell|creature)/i;
  const otherMatch = text.match(otherCastPattern);
  if (otherMatch) {
    // Extract the creature type filter
    const creatureType = otherMatch[1];
    // Check if it copies triggers (Ulalek pattern)
    const copyTriggers = text.includes('copy') && text.includes('trigger');
    
    return {
      hasCastTrigger: true,
      triggerType: 'other_cast',
      creatureTypeFilter: creatureType,
      copyTriggers,
      effect: `Triggers when you cast a ${creatureType} spell.`,
    };
  }
  
  return {
    hasCastTrigger: false,
    triggerType: 'none',
  };
}

/**
 * Check if a card has any cast trigger based on oracle text
 */
export function hasCastTrigger(oracleText: string, typeLine?: string): boolean {
  return detectCastTrigger(oracleText, typeLine).hasCastTrigger;
}

/**
 * Check if a spell being cast would trigger another card's cast ability
 */
export function wouldTriggerCastAbility(
  triggerCardOracleText: string,
  castCardTypeLine: string,
  castCardSubtypes: string[]
): boolean {
  const triggerInfo = detectCastTrigger(triggerCardOracleText);
  
  if (!triggerInfo.hasCastTrigger || triggerInfo.triggerType !== 'other_cast') {
    return false;
  }
  
  // Check if cast card matches the required creature type
  if (triggerInfo.creatureTypeFilter) {
    const filterLower = triggerInfo.creatureTypeFilter.toLowerCase();
    const matchesType = castCardSubtypes.some(
      st => st.toLowerCase() === filterLower
    ) || castCardTypeLine.toLowerCase().includes(filterLower);
    
    return matchesType;
  }
  
  return true;
}

/**
 * Detect Storm count for a spell (based on spells cast this turn)
 */
export function getStormCount(spellsCastThisTurn: number): number {
  // Storm copies for each spell cast before it
  return Math.max(0, spellsCastThisTurn - 1);
}

/**
 * Check if a card has Cascade
 */
export function hasCascade(oracleText: string): boolean {
  return oracleText.toLowerCase().includes('cascade');
}

/**
 * Get cascade count (some cards like Apex Devastator have multiple cascades)
 */
export function getCascadeCount(oracleText: string): number {
  const matches = oracleText.toLowerCase().match(/cascade/gi);
  return matches ? matches.length : 0;
}
