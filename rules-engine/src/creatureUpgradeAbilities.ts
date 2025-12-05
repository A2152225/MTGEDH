/**
 * Creature Upgrade Abilities
 * 
 * Handles activated abilities that transform or upgrade creatures, such as:
 * - Figure of Destiny: "{R/W}: Figure of Destiny becomes a Kithkin Spirit with base power and toughness 2/2."
 * - Warden of the First Tree: "{1}{W/B}: Warden of the First Tree becomes a Human Warrior with base power and toughness 3/3."
 * - Kellan, Planar Trailblazer: Journey abilities that add counters and creature types
 * - Tenth District Hero
 * - Figure of Fable
 * 
 * IMPORTANT: These are NOT temporary effects!
 * Unlike most "becomes a creature" effects (e.g., land animation that lasts "until end of turn"),
 * these upgrade abilities create PERMANENT characteristic-changing effects that last indefinitely
 * until the creature leaves the battlefield.
 * 
 * This enables the progression system where:
 * 1. Figure of Destiny starts as a 1/1 Kithkin
 * 2. First activation: PERMANENTLY becomes a 2/2 Kithkin Spirit
 * 3. Now it IS a Spirit, so the second ability can be activated
 * 4. Second activation: PERMANENTLY becomes a 4/4 Kithkin Spirit Warrior  
 * 5. Now it IS a Warrior, so the third ability can be activated
 * 6. Third activation: PERMANENTLY becomes an 8/8 Kithkin Spirit Warrior Avatar with flying/first strike
 * 
 * These are NOT the "Level Up" keyword (Rule 702.87), but rather activated abilities
 * that use the "becomes a X/Y [creature type]" pattern without a duration clause.
 * 
 * Reference: MTG Comprehensive Rules - Activated Abilities (Rule 602)
 * Reference: MTG Comprehensive Rules - Continuous Effects (Rule 611)
 */

/**
 * Represents an upgrade stage for a creature
 */
export interface CreatureUpgradeStage {
  /** The oracle text condition required (e.g., "If Figure of Destiny is a Spirit") */
  readonly condition?: string;
  /** Required creature types to activate this upgrade (e.g., ['Spirit'] or ['Warrior']) */
  readonly requiredTypes?: readonly string[];
  /** The mana cost to activate (e.g., "{R/W}" or "{R/W}{R/W}{R/W}") */
  readonly cost: string;
  /** New creature types (e.g., ['Kithkin', 'Spirit', 'Warrior']) */
  readonly newCreatureTypes: readonly string[];
  /** New base power (undefined if unchanged) */
  readonly newBasePower?: number;
  /** New base toughness (undefined if unchanged) */
  readonly newBaseToughness?: number;
  /** Keywords to add (e.g., ['Flying', 'First Strike', 'Trample', 'Lifelink']) */
  readonly addKeywords?: readonly string[];
  /** Number of +1/+1 counters to add */
  readonly addCounters?: number;
  /** Description of the ability for UI display */
  readonly description: string;
}

/**
 * Represents a creature with upgrade abilities
 */
export interface UpgradeableCreature {
  /** The card's name */
  readonly cardName: string;
  /** The upgrade stages, in order */
  readonly stages: readonly CreatureUpgradeStage[];
}

/**
 * Parsed upgrade ability from oracle text
 */
export interface ParsedUpgradeAbility {
  readonly type: 'becomes' | 'counters' | 'combined';
  readonly cost: string;
  readonly condition?: string;
  readonly requiredTypes?: readonly string[];
  readonly newTypes?: readonly string[];
  readonly newPower?: number;
  readonly newToughness?: number;
  readonly keywords?: readonly string[];
  readonly counterCount?: number;
  readonly counterType?: string;
  readonly fullText: string;
}

/**
 * Parse creature upgrade abilities from oracle text.
 * Detects patterns like:
 * - "{cost}: ~ becomes a X/Y [types]"
 * - "{cost}: If ~ is a [type], it becomes a [types] with [keywords]"
 * - "{cost}: If ~ is a [type], put N +1/+1 counters on it"
 * 
 * @param oracleText - The card's oracle text
 * @param cardName - The card's name (used to match "~" in text)
 * @returns Array of parsed upgrade abilities
 */
export function parseUpgradeAbilities(oracleText: string, cardName: string): ParsedUpgradeAbility[] {
  if (!oracleText) return [];
  
  const abilities: ParsedUpgradeAbility[] = [];
  const text = oracleText.toLowerCase();
  const cardNameLower = cardName.toLowerCase();
  
  // Replace card name with placeholder for consistent matching
  const normalizedText = text.replace(new RegExp(cardNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');
  
  // Split by newlines and periods to get individual abilities
  const lines = normalizedText.split(/\n|(?<=\.)\s+/).filter(l => l.trim());
  
  for (const line of lines) {
    // Pattern 1: "{cost}: ~ becomes a P/T [types]"
    // Example: "{R/W}: Figure of Destiny becomes a Kithkin Spirit with base power and toughness 2/2."
    const becomesSimpleMatch = line.match(
      /^([^:]+):\s*~\s+becomes\s+(?:a|an)\s+(.+?)\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\/(\d+)/i
    );
    if (becomesSimpleMatch) {
      const [, cost, typesStr, power, toughness] = becomesSimpleMatch;
      abilities.push({
        type: 'becomes',
        cost: cost.trim(),
        newTypes: parseCreatureTypes(typesStr),
        newPower: parseInt(power, 10),
        newToughness: parseInt(toughness, 10),
        fullText: line,
      });
      continue;
    }
    
    // Pattern 2 (MUST come before Pattern 3): Combined becomes with keywords and stats
    // Example: "{R/W}{R/W}{R/W}{R/W}{R/W}{R/W}: If Figure of Destiny is a Warrior, it becomes a Kithkin Spirit Warrior Avatar with base power and toughness 8/8, flying, and first strike."
    // This pattern matches stats followed by a comma and keywords
    const becomesFullMatch = line.match(
      /^([^:]+):\s*if\s+~\s+is\s+(?:a|an)\s+(\w+),?\s+(?:it\s+)?becomes\s+(?:a|an)\s+(.+?)\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\/(\d+),\s*(.+?)\.?$/i
    );
    if (becomesFullMatch) {
      const [, cost, reqType, typesStr, power, toughness, keywordsStr] = becomesFullMatch;
      abilities.push({
        type: 'combined',
        cost: cost.trim(),
        condition: `is a ${reqType}`,
        requiredTypes: [reqType.charAt(0).toUpperCase() + reqType.slice(1)],
        newTypes: parseCreatureTypes(typesStr),
        newPower: parseInt(power, 10),
        newToughness: parseInt(toughness, 10),
        keywords: parseKeywords(keywordsStr),
        fullText: line,
      });
      continue;
    }
    
    // Pattern 3: "{cost}: If ~ is a [type], it becomes a [types] with base power and toughness P/T" (without additional keywords)
    // Example: "{R/W}{R/W}{R/W}: If Figure of Destiny is a Spirit, it becomes a Kithkin Spirit Warrior with base power and toughness 4/4."
    const becomesConditionalMatch = line.match(
      /^([^:]+):\s*if\s+~\s+is\s+(?:a|an)\s+(\w+),?\s+(?:it\s+)?becomes\s+(?:a|an)\s+(.+?)\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\/(\d+)\.?$/i
    );
    if (becomesConditionalMatch) {
      const [, cost, reqType, typesStr, power, toughness] = becomesConditionalMatch;
      abilities.push({
        type: 'becomes',
        cost: cost.trim(),
        condition: `is a ${reqType}`,
        requiredTypes: [reqType.charAt(0).toUpperCase() + reqType.slice(1)],
        newTypes: parseCreatureTypes(typesStr),
        newPower: parseInt(power, 10),
        newToughness: parseInt(toughness, 10),
        fullText: line,
      });
      continue;
    }
    
    // Pattern 4: "{cost}: If ~ is a [type], it becomes a [types] with [keywords]"
    // Example: "{2}{W/B}{W/B}: If Warden of the First Tree is a Warrior, it becomes a Human Spirit Warrior with trample and lifelink."
    const becomesWithKeywordsMatch = line.match(
      /^([^:]+):\s*if\s+~\s+is\s+(?:a|an)\s+(\w+),?\s+(?:it\s+)?becomes\s+(?:a|an)\s+(.+?)\s+with\s+(.+?)\.?$/i
    );
    if (becomesWithKeywordsMatch) {
      const [, cost, reqType, typesStr, keywordsStr] = becomesWithKeywordsMatch;
      // Check if this is "with base power" pattern (already handled above)
      if (!keywordsStr.includes('base power')) {
        abilities.push({
          type: 'becomes',
          cost: cost.trim(),
          condition: `is a ${reqType}`,
          requiredTypes: [reqType.charAt(0).toUpperCase() + reqType.slice(1)],
          newTypes: parseCreatureTypes(typesStr),
          keywords: parseKeywords(keywordsStr),
          fullText: line,
        });
        continue;
      }
    }
    
    // Pattern 4: "{cost}: If ~ is a [type], put N +1/+1 counters on it"
    // Example: "{3}{W/B}{W/B}{W/B}: If Warden of the First Tree is a Spirit, put five +1/+1 counters on it."
    const counterConditionalMatch = line.match(
      /^([^:]+):\s*if\s+~\s+is\s+(?:a|an)\s+(\w+),?\s+put\s+(\w+)\s+\+1\/\+1\s+counters?\s+on\s+it/i
    );
    if (counterConditionalMatch) {
      const [, cost, reqType, countWord] = counterConditionalMatch;
      const counterCount = wordToNumber(countWord);
      abilities.push({
        type: 'counters',
        cost: cost.trim(),
        condition: `is a ${reqType}`,
        requiredTypes: [reqType.charAt(0).toUpperCase() + reqType.slice(1)],
        counterCount,
        counterType: '+1/+1',
        fullText: line,
      });
      continue;
    }
    
    // Pattern 6: Simple becomes without stats (just type change)
    // Example: "{2}: Creature becomes a Dragon."
    const becomesTypeOnlyMatch = line.match(
      /^([^:]+):\s*~\s+becomes\s+(?:a|an)\s+([^.]+?)\.?$/i
    );
    if (becomesTypeOnlyMatch) {
      const [, cost, typesStr] = becomesTypeOnlyMatch;
      // Exclude if it has "with base power" or other modifiers
      if (!typesStr.includes('with')) {
        abilities.push({
          type: 'becomes',
          cost: cost.trim(),
          newTypes: parseCreatureTypes(typesStr),
          fullText: line,
        });
        continue;
      }
    }
  }
  
  return abilities;
}

/**
 * Parse creature types from a type string.
 * @param typesStr - String like "Kithkin Spirit Warrior Avatar"
 * @returns Array of creature types
 */
function parseCreatureTypes(typesStr: string): string[] {
  // Remove articles and extra words
  const cleaned = typesStr
    .replace(/\b(a|an|the|and|with|is)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Split by spaces and capitalize each type
  return cleaned
    .split(' ')
    .filter(t => t.length > 0)
    .map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

/**
 * Parse keywords from a keyword string.
 * @param keywordsStr - String like "flying, first strike, and trample"
 * @returns Array of keywords
 */
function parseKeywords(keywordsStr: string): string[] {
  // Remove "and" and split by comma
  const cleaned = keywordsStr
    .replace(/\band\b/gi, ',')
    .replace(/\s+/g, ' ')
    .trim();
  
  return cleaned
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0 && !k.includes('base power'))
    .map(k => k.charAt(0).toUpperCase() + k.slice(1).toLowerCase());
}

/**
 * Convert word numbers to integers.
 */
function wordToNumber(word: string): number {
  const wordMap: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'a': 1, 'an': 1,
  };
  const lowerWord = word.toLowerCase();
  if (wordMap[lowerWord] !== undefined) {
    return wordMap[lowerWord];
  }
  const parsed = parseInt(word, 10);
  return isNaN(parsed) ? 1 : parsed;
}

/**
 * Check if a creature meets the required type condition for an upgrade.
 * @param currentTypes - Current creature types on the permanent
 * @param requiredTypes - Types required for the upgrade ability
 * @returns true if the creature has all required types
 */
export function meetsUpgradeCondition(
  currentTypes: readonly string[] | undefined,
  requiredTypes: readonly string[] | undefined
): boolean {
  if (!requiredTypes || requiredTypes.length === 0) {
    return true; // No condition required
  }
  if (!currentTypes || currentTypes.length === 0) {
    return false; // Has required types but creature has none
  }
  
  const currentTypesLower = new Set(currentTypes.map(t => t.toLowerCase()));
  return requiredTypes.every(reqType => currentTypesLower.has(reqType.toLowerCase()));
}

/**
 * Apply an upgrade ability to a creature permanent.
 * This modifies the permanent's characteristics based on the upgrade.
 * 
 * @param permanent - The permanent to upgrade
 * @param ability - The parsed upgrade ability to apply
 * @returns Object describing the changes made
 */
export function applyUpgradeAbility(
  permanent: any,
  ability: ParsedUpgradeAbility
): {
  success: boolean;
  changes: string[];
  error?: string;
} {
  // Check condition if present
  if (ability.requiredTypes) {
    const currentTypes = getCreatureTypes(permanent);
    if (!meetsUpgradeCondition(currentTypes, ability.requiredTypes)) {
      return {
        success: false,
        changes: [],
        error: `${permanent.card?.name || 'Creature'} is not a ${ability.requiredTypes.join(' ')}`,
      };
    }
  }
  
  const changes: string[] = [];
  
  // Apply new creature types
  if (ability.newTypes && ability.newTypes.length > 0) {
    setCreatureTypes(permanent, ability.newTypes);
    changes.push(`became a ${ability.newTypes.join(' ')}`);
  }
  
  // Apply new base power/toughness
  if (ability.newPower !== undefined) {
    permanent.basePower = ability.newPower;
    changes.push(`base power changed to ${ability.newPower}`);
  }
  if (ability.newToughness !== undefined) {
    permanent.baseToughness = ability.newToughness;
    changes.push(`base toughness changed to ${ability.newToughness}`);
  }
  
  // Add keywords
  if (ability.keywords && ability.keywords.length > 0) {
    permanent.grantedKeywords = permanent.grantedKeywords || [];
    for (const keyword of ability.keywords) {
      if (!permanent.grantedKeywords.includes(keyword)) {
        permanent.grantedKeywords.push(keyword);
        changes.push(`gained ${keyword}`);
      }
    }
  }
  
  // Add counters
  if (ability.counterCount && ability.counterType) {
    permanent.counters = permanent.counters || {};
    permanent.counters[ability.counterType] = 
      (permanent.counters[ability.counterType] || 0) + ability.counterCount;
    changes.push(`got ${ability.counterCount} ${ability.counterType} counter(s)`);
  }
  
  return { success: true, changes };
}

/**
 * Get current creature types from a permanent.
 */
function getCreatureTypes(permanent: any): string[] {
  // First check for upgraded types stored on the permanent
  if (permanent.upgradedCreatureTypes && Array.isArray(permanent.upgradedCreatureTypes)) {
    return permanent.upgradedCreatureTypes;
  }
  
  // Fall back to parsing from type line
  const typeLine = (permanent.card?.type_line || '').toLowerCase();
  const dashIndex = typeLine.indexOf('—');
  if (dashIndex === -1) return [];
  
  const subtypes = typeLine.slice(dashIndex + 1).trim();
  return subtypes
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.charAt(0).toUpperCase() + t.slice(1));
}

/**
 * Set creature types on a permanent.
 * This replaces all existing creature types.
 */
function setCreatureTypes(permanent: any, types: readonly string[]): void {
  // Store upgraded types
  permanent.upgradedCreatureTypes = [...types];
  
  // Also update the type line for display
  // Keep the main type (e.g., "Creature") and replace subtypes
  const typeLine = permanent.card?.type_line || 'Creature';
  const dashIndex = typeLine.indexOf('—');
  const mainTypes = dashIndex !== -1 ? typeLine.slice(0, dashIndex).trim() : typeLine.trim();
  permanent.card = permanent.card || {};
  permanent.card.type_line = `${mainTypes} — ${types.join(' ')}`;
}

/**
 * Check if a card has upgrade abilities.
 * @param oracleText - The card's oracle text
 * @param cardName - The card's name
 * @returns true if the card has any parseable upgrade abilities
 */
export function hasUpgradeAbilities(oracleText: string, cardName: string): boolean {
  const abilities = parseUpgradeAbilities(oracleText, cardName);
  return abilities.length > 0;
}

/**
 * Known creature upgrade cards for reference.
 * These are cards that have the "becomes a X/Y" or "put counters" upgrade pattern.
 */
export const KNOWN_UPGRADE_CARDS: readonly string[] = [
  // Classic upgrade cards
  'Figure of Destiny',
  'Warden of the First Tree',
  'Figure of Fable',
  'Tenth District Hero',
  
  // Journey mechanic (Kellan cards)
  'Kellan, Planar Trailblazer',
  'Kellan, Daring Traveler',
  
  // Other upgrade-style cards
  'Student of Warfare',  // Level up (different mechanic but similar)
  'Transcendent Master',
  'Kazandu Mammoth',  // MDFC, not upgrade but similar
  
  // Monstrosity-style upgrades (becomes monstrous)
  // Note: Monstrosity is a different keyword ability
];
