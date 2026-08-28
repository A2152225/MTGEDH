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

import { aOrAnSpellType } from '../indefiniteArticle.js';

export interface CastTriggerInfo {
  readonly hasCastTrigger: boolean;
  readonly triggerType: 'self_cast' | 'other_cast' | 'none';
  readonly effect?: string;
  /** All self-cast on-cast clauses when a card has more than one (e.g. kicker pairs). */
  readonly effects?: readonly string[];
  readonly creatureTypeFilter?: string;
  readonly hasStorm?: boolean;
  readonly hasCascade?: boolean;
  readonly cascadeCount?: number;
  readonly copyTriggers?: boolean;
}

/** Strip a single trailing reminder-text parenthetical from oracle clause text. */
function stripTrailingReminderText(clause: string): string {
  return String(clause || '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim()
    .replace(/\.\s*$/g, '');
}

function stripReminderParentheticals(oracleText: string): string {
  return String(oracleText || '').replace(/\([^)]*\)/g, ' ');
}

/** True when this `cascade` token is a grant ("has cascade") rather than the spell's own keyword. */
function isGrantedCascadeOccurrence(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 64), matchIndex);
  return /\b(?:have|has|gains?|gained)\s+$/i.test(before);
}

/**
 * Count printed Cascade keywords on this card (Apex Devastator = 4).
 * Does not count grants such as Wild-Magic Sorcerer's "has cascade".
 */
export function getNativeCascadeCount(oracleText: string): number {
  const stripped = stripReminderParentheticals(oracleText);
  const re = /\bcascade\b/gi;
  let count = 0;
  let match: RegExpExecArray | null = re.exec(stripped);
  while (match) {
    if (!isGrantedCascadeOccurrence(stripped, match.index)) {
      count += 1;
    }
    match = re.exec(stripped);
  }
  return count;
}

/**
 * Extract each "When you cast this spell," clause from oracle text.
 * Uses the full paragraph line (not first-period truncation) and absorbs following
 * bullet/mode lines so modal on-cast abilities keep their modes.
 */
export function extractSelfCastEffectClauses(oracleText: string): string[] {
  const lines = String(oracleText || '').split(/\r?\n/);
  const clauses: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = line.match(
      /^\s*When you cast (?:this spell|this creature|~|this card)\s*,?\s*(.*)$/i,
    );
    if (!match) continue;
    let effect = String(match[1] || '').trim();
    while (i + 1 < lines.length) {
      const nextRaw = lines[i + 1] ?? '';
      const next = nextRaw.trim();
      if (!next) break;
      // Mode bullets or indented continuations belonging to this ability.
      if (/^[\u2022\u25E6\u2023\u00B7]/.test(next) || /^[-\u2013\u2014]\s+/.test(next)) {
        effect += '\n' + next;
        i += 1;
        continue;
      }
      break;
    }
    const cleaned = stripTrailingReminderText(effect);
    if (cleaned) clauses.push(cleaned);
  }
  return clauses;
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
  
  // Check for Cascade keyword (count multiple native cascades; skip "has cascade" grants)
  const nativeCascadeCount = getNativeCascadeCount(oracleText);
  if (nativeCascadeCount > 0) {
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      hasCascade: true,
      cascadeCount: nativeCascadeCount,
      effect: `Cascade${nativeCascadeCount > 1 ? ` (×${nativeCascadeCount})` : ''} - Exile cards until you exile a nonland card that costs less. Cast it free.`,
    };
  }
  
  // Check for "when you cast this" patterns (Eldrazi-style).
  // Prefer full-line extraction (preserves "If you do," clauses and original casing).
  const selfCastClauses = extractSelfCastEffectClauses(oracleText);
  if (selfCastClauses.length > 0) {
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      effect: selfCastClauses[0],
      effects: selfCastClauses,
    };
  }
  const selfCastPattern = /when you cast (this spell|this creature|~|this card)/i;
  if (selfCastPattern.test(text)) {
    // Fallback for odd layouts: take rest of matched line from original text.
    const match = oracleText.match(
      /when you cast (?:this spell|this creature|~|this card)\s*,?\s*([^\n]+)/i,
    );
    const effect = stripTrailingReminderText(match ? match[1] : 'Cast trigger effect');
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      effect,
      effects: effect ? [effect] : [],
    };
  }

  // Emrakul-style on-cast extra turn when oracle omits explicit "When you cast this spell,".
  if (/take an extra turn after this one/i.test(text) && !/whenever you cast/i.test(text)) {
    return {
      hasCastTrigger: true,
      triggerType: 'self_cast',
      effect: 'Take an extra turn after this one.',
    };
  }
  
  // Check for "when you cast" other spells (like Ulalek)
  // Pattern: "whenever you cast" + creature type (handles multi-word types)
  const otherCastPattern = /whenever you cast (?:a|an|another) ([\w\s]+?) (?:spell|creature)/i;
  const otherMatch = text.match(otherCastPattern);
  if (otherMatch) {
    // Extract the creature type filter
    const creatureType = otherMatch[1].trim();
    // Check if it copies triggers (Ulalek pattern)
    const copyTriggers = text.includes('copy') && text.includes('trigger');
    
    return {
      hasCastTrigger: true,
      triggerType: 'other_cast',
      creatureTypeFilter: creatureType,
      copyTriggers,
      effect: `Triggers when you cast ${aOrAnSpellType(creatureType)}`,
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
  return getNativeCascadeCount(oracleText) > 0;
}

/**
 * Get cascade count (some cards like Apex Devastator have multiple cascades)
 */
export function getCascadeCount(oracleText: string): number {
  return getNativeCascadeCount(oracleText);
}
