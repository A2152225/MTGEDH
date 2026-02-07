/**
 * oracleTextParser.ts
 * 
 * Comprehensive oracle text parsing for Magic: The Gathering cards.
 * 
 * This module implements parsing based on the structural templates defined
 * in the MTG Comprehensive Rules for:
 * 1. Activated Abilities (Rule 602) - Cost: Effect format
 * 2. Triggered Abilities (Rule 603) - When/Whenever/At triggers
 * 3. Replacement Effects (Rule 614) - Instead/As/Enters with patterns
 * 4. Static Abilities - Continuous effects
 * 5. Keyword Actions - Common game actions
 * 
 * Design Philosophy:
 * - Uses regex capture groups for consistent parsing
 * - Follows the natural hierarchy of MTG ability types
 * - Handles the recursive nature of MTG templating language
 */

/**
 * Parsed ability structure
 */
export interface ParsedAbility {
  readonly type: AbilityType;
  readonly text: string;
  readonly cost?: string;
  readonly effect?: string;
  readonly triggerCondition?: string;
  readonly triggerKeyword?: 'when' | 'whenever' | 'at';
  readonly interveningIf?: string;
  readonly isOptional?: boolean;
  readonly isManaAbility?: boolean;
  readonly isLoyaltyAbility?: boolean;
  readonly targets?: readonly string[];
  readonly modes?: readonly string[];
  readonly requiresChoice?: ChoiceRequirement;
}

/**
 * Choice requirement for cards that need a choice on ETB or cast
 */
export interface ChoiceRequirement {
  readonly choiceType: 'color' | 'creature_type' | 'card_type' | 'player' | 'mode' | 'other';
  readonly timing: 'etb' | 'cast' | 'activation' | 'trigger';
  readonly description: string;
}

/**
 * Types of abilities that can be parsed
 */
export enum AbilityType {
  ACTIVATED = 'activated',
  TRIGGERED = 'triggered',
  STATIC = 'static',
  REPLACEMENT = 'replacement',
  SPELL = 'spell',
  KEYWORD = 'keyword',
}

/**
 * Parsed keyword action
 */
export interface ParsedKeywordAction {
  readonly action: string;
  readonly value?: number | string;
  readonly target?: string;
  readonly modifier?: string;
}

/**
 * Main parsing result for oracle text
 */
export interface OracleTextParseResult {
  readonly abilities: readonly ParsedAbility[];
  readonly keywords: readonly string[];
  readonly keywordActions: readonly ParsedKeywordAction[];
  readonly isTriggered: boolean;
  readonly isActivated: boolean;
  readonly isReplacement: boolean;
  readonly hasTargets: boolean;
  readonly hasModes: boolean;
}

// =============================================================================
// ACTIVATED ABILITIES (Rule 602)
// Golden Rule: [Cost] : [Effect]
// =============================================================================

/**
 * Regex pattern for activated abilities
 * Captures: cost (group 1), effect (group 2)
 * 
 * The colon is a hard delimiter:
 * - Everything to the left is the Cost (happens immediately, cannot be responded to)
 * - Everything to the right is the Effect (goes on the stack)
 */
const ACTIVATED_ABILITY_PATTERN = /^([^:]+?):\s*(.+)$/;

/**
 * Planeswalker loyalty ability pattern
 * Captures: loyalty change (group 1), effect (group 2)
 */
const LOYALTY_ABILITY_PATTERN = /^([+−-]?\d+|0)\s*:\s*(.+)$/;

/**
 * Keyword ability with cost pattern (Equip, Cycling, etc.)
 * Captures: keyword (group 1), cost (group 2)
 */
const KEYWORD_COST_PATTERN = /^(Equip|Cycling|Kicker|Entwine|Flashback|Unearth|Evoke|Emerge|Escalate|Escape|Foretell|Ward|Craft|Overload|Bestow|Dash|Embalm|Eternalize|Morph|Megamorph|Mutate|Ninjutsu|Prototype|Prowl|Spectacle|Suspend|Transfigure|Transmute|Warp|Blitz|Channel|Disturb|Encore|Madness|Miracle|Outlast|Reconfigure|Reinforce|Scavenge|Squad|Sunburst|Umbra armor|Backup|Bargain|Boast|Buyback|Casualty|Cleave|Conspire|Convoke|Crew|Delve|Demonstrate|Devour|Dredge|Echo|Enlist|Epic|Exploit|Extort|Fabricate|Fading|Fortify|Fuse|Graft|Haunt|Hideaway|Improvise|Incubate|Jump-start|Landfall|Level up|Living weapon|Meld|Modular|Monstrosity|Offering|Overrun|Persist|Phasing|Populate|Proliferate|Radiance|Raid|Ravenous|Replicate|Retrace|Riot|Saga|Soulbond|Splice|Split second|Storm|Strive|Sunburst|Surge|Undying|Unleash|Vanishing)\s+(.+)$/i;

/**
 * Parse an activated ability from oracle text line
 */
export function parseActivatedAbility(text: string): ParsedAbility | null {
  // Check for planeswalker loyalty ability first
  const loyaltyMatch = text.match(LOYALTY_ABILITY_PATTERN);
  if (loyaltyMatch) {
    return {
      type: AbilityType.ACTIVATED,
      text,
      cost: loyaltyMatch[1],
      effect: loyaltyMatch[2].trim(),
      isLoyaltyAbility: true,
      isOptional: false,
    };
  }
  
  // Check for keyword with cost
  const keywordMatch = text.match(KEYWORD_COST_PATTERN);
  if (keywordMatch) {
    return {
      type: AbilityType.KEYWORD,
      text,
      cost: keywordMatch[2].trim(),
      effect: keywordMatch[1], // The keyword itself is the effect
    };
  }
  
  // Standard activated ability
  const activatedMatch = text.match(ACTIVATED_ABILITY_PATTERN);
  if (activatedMatch) {
    const cost = activatedMatch[1].trim();
    const effect = activatedMatch[2].trim();
    
    // Skip if this looks like a triggered ability (cost starts with when/whenever/at)
    if (/^(when|whenever|at\s+the\s+beginning)/i.test(cost)) {
      return null;
    }
    
    // Skip reminder text (parentheses)
    if (cost.startsWith('(')) {
      return null;
    }
    
    // Determine if it's a mana ability
    const isManaAbility = isManaProducingAbility(effect) && !hasTargeting(effect);
    
    return {
      type: AbilityType.ACTIVATED,
      text,
      cost,
      effect,
      isManaAbility,
      isOptional: effect.toLowerCase().includes('you may'),
      targets: parseTargets(effect),
    };
  }
  
  return null;
}

// =============================================================================
// TRIGGERED ABILITIES (Rule 603)
// Golden Rule: (When|Whenever|At) [Trigger Condition], [Effect]
// =============================================================================

/**
 * Regex patterns for triggered abilities
 */

// When/Whenever clause pattern
// Captures: keyword (group 1), trigger condition (group 2), effect (group 3)
const WHEN_WHENEVER_PATTERN = /^(When|Whenever)\s+(.+?),\s+(.+)$/i;

// "At" clause pattern for specific points in time
// Captures: timing (group 2), effect (group 3)
const AT_PATTERN = /^At\s+(the|each)\s+(.+?),\s+(.+)$/i;

// Intervening-if clause pattern (checks twice: on trigger and on resolution)
// Captures: trigger keyword (group 1), condition (group 2), if clause (group 3), effect (group 4)
const INTERVENING_IF_PATTERN = /^(When|Whenever|At)\s+(.+?),\s+if\s+(.+?),\s+(.+)$/i;

/**
 * Parse a triggered ability from oracle text line
 */
export function parseTriggeredAbility(text: string): ParsedAbility | null {
  // Check for intervening-if clause first (more specific pattern)
  const ifMatch = text.match(INTERVENING_IF_PATTERN);
  if (ifMatch) {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: ifMatch[1].toLowerCase() as 'when' | 'whenever' | 'at',
      triggerCondition: ifMatch[2].trim(),
      interveningIf: ifMatch[3].trim(),
      effect: ifMatch[4].trim(),
      isOptional: ifMatch[4].toLowerCase().includes('you may'),
      targets: parseTargets(ifMatch[4]),
    };
  }
  
  // Check for "At" clause (beginning of phases/steps)
  const atMatch = text.match(AT_PATTERN);
  if (atMatch) {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'at',
      triggerCondition: `${atMatch[1]} ${atMatch[2]}`.trim(),
      effect: atMatch[3].trim(),
      isOptional: atMatch[3].toLowerCase().includes('you may'),
      targets: parseTargets(atMatch[3]),
    };
  }
  
  // Check for When/Whenever clause
  const whenMatch = text.match(WHEN_WHENEVER_PATTERN);
  if (whenMatch) {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: whenMatch[1].toLowerCase() as 'when' | 'whenever',
      triggerCondition: whenMatch[2].trim(),
      effect: whenMatch[3].trim(),
      isOptional: whenMatch[3].toLowerCase().includes('you may'),
      targets: parseTargets(whenMatch[3]),
    };
  }
  
  return null;
}

// =============================================================================
// REPLACEMENT EFFECTS (Rule 614)
// These alter an event before it happens and do not use the stack
// =============================================================================

/**
 * "Instead" clause pattern - most common modification structure
 * If [condition] would [event], [replacement] instead.
 */
const INSTEAD_PATTERN = /If\s+(.+?)\s+would\s+(.+?),\s+(.+?)\s+instead\.?/i;

/**
 * "Enters with" or "Enters as" clause pattern
 * For modifiers affecting how permanents enter the battlefield
 */
// Strictly match a standalone "X enters the battlefield <modifier>" sentence.
// We intentionally do NOT match multi-sentence merged lines like
// "Create a token. It enters the battlefield ..."; those should be handled
// by the IR parser as spell instructions with follow-up modifiers.
const ENTERS_WITH_PATTERN = /^([^.;]+?)\s+enters the battlefield\s+([^.;]+?)[.;]?$/i;
const ENTERS_AS_PATTERN = /^As\s+(.+?)\s+enters the battlefield,\s+(.+)$/i;

/**
 * Parse a replacement effect from oracle text
 */
export function parseReplacementEffect(text: string): ParsedAbility | null {
  // Check for "instead" clause
  const insteadMatch = text.match(INSTEAD_PATTERN);
  if (insteadMatch) {
    return {
      type: AbilityType.REPLACEMENT,
      text,
      triggerCondition: insteadMatch[1].trim(),
      effect: insteadMatch[3].trim(),
    };
  }
  
  // Check for "As enters" clause
  const asMatch = text.match(ENTERS_AS_PATTERN);
  if (asMatch) {
    const effect = asMatch[2].trim();
    const choiceReq = detectChoiceRequirement(effect, 'etb');
    
    return {
      type: AbilityType.REPLACEMENT,
      text,
      triggerCondition: `${asMatch[1]} enters the battlefield`,
      effect,
      isOptional: effect.toLowerCase().includes('you may'),
      requiresChoice: choiceReq,
    };
  }
  
  // Check for "enters with" clause
  const entersMatch = text.match(ENTERS_WITH_PATTERN);
  if (entersMatch) {
    return {
      type: AbilityType.REPLACEMENT,
      text,
      triggerCondition: `${entersMatch[1]} enters the battlefield`,
      effect: entersMatch[2].trim(),
    };
  }
  
  return null;
}

/**
 * Detect if text requires a choice and what type
 */
function detectChoiceRequirement(
  text: string,
  timing: 'etb' | 'cast' | 'activation' | 'trigger'
): ChoiceRequirement | undefined {
  // "choose a color" pattern
  if (/choose\s+a\s+color/i.test(text)) {
    return {
      choiceType: 'color',
      timing,
      description: 'Choose a color',
    };
  }
  
  // "choose a creature type" pattern
  if (/choose\s+a\s+creature\s+type/i.test(text)) {
    return {
      choiceType: 'creature_type',
      timing,
      description: 'Choose a creature type',
    };
  }
  
  // "choose a card type" pattern
  if (/choose\s+a\s+(?:card|nonland\s+card)\s+type/i.test(text)) {
    return {
      choiceType: 'card_type',
      timing,
      description: 'Choose a card type',
    };
  }
  
  // "choose a player" or "choose an opponent" pattern
  if (/choose\s+(?:a\s+player|an\s+opponent)/i.test(text)) {
    return {
      choiceType: 'player',
      timing,
      description: text.match(/choose\s+(?:a\s+player|an\s+opponent)/i)?.[0] || 'Choose a player',
    };
  }
  
  // Modal choice pattern - "choose one" etc.
  if (/choose\s+(one|two|three|X|up\s+to\s+\w+)/i.test(text)) {
    return {
      choiceType: 'mode',
      timing,
      description: text.match(/choose\s+(?:one|two|three|X|up\s+to\s+\w+)/i)?.[0] || 'Choose',
    };
  }
  
  return undefined;
}

// =============================================================================
// KEYWORD ACTIONS
// Common action verbs that appear in effect text
// =============================================================================

/**
 * Keyword action patterns
 */
const KEYWORD_ACTION_PATTERNS: Record<string, RegExp> = {
  // Targeting
  target: /target\s+(.+?)(?:\.|,|$)/i,
  
  // Numeric actions
  scry: /scry\s+(\d+|X)/i,
  surveil: /surveil\s+(\d+|X)/i,
  mill: /mills?\s+(\d+|X)\s+cards?/i,
  draw: /draws?\s+(\d+|X)?\s*cards?/i,
  discard: /discards?\s+(\d+|X)?\s*cards?/i,
  
  // Token creation
  create: /create\s+(an?|(\d+)|X)\s+(.+?)\s+(?:creature\s+)?tokens?/i,
  
  // Power/Toughness modification
  ptMod: /([+−-]\d+\/[+−-]\d+)/,
  
  // Zone changes
  exile: /exiles?\s+(.+?)(?:\.|,|$)/i,
  destroy: /destroys?\s+(.+?)(?:\.|,|$)/i,
  sacrifice: /sacrifices?\s+(.+?)(?:\.|,|$)/i,
  return: /returns?\s+(.+?)\s+to\s+(.+?)(?:\.|,|$)/i,
  
  // Other common actions
  gainLife: /gains?\s+(\d+|X)\s+life/i,
  loseLife: /loses?\s+(\d+|X)\s+life/i,
  dealDamage: /deals?\s+(\d+|X)\s+damage/i,
  counter: /counter\s+target\s+(.+?)(?:\.|,|$)/i,
  search: /search(?:es)?\s+(?:your|their|his or her)\s+library/i,
  shuffle: /shuffles?\s+(?:your|their|his or her)\s+library/i,
  tap: /taps?\s+(.+?)(?:\.|,|$)/i,
  untap: /untaps?\s+(.+?)(?:\.|,|$)/i,
};

/**
 * Parse keyword actions from effect text
 */
export function parseKeywordActions(text: string): ParsedKeywordAction[] {
  const actions: ParsedKeywordAction[] = [];
  
  for (const [action, pattern] of Object.entries(KEYWORD_ACTION_PATTERNS)) {
    const match = text.match(pattern);
    if (match) {
      actions.push({
        action,
        value: match[1] && /^\d+$/.test(match[1]) ? parseInt(match[1], 10) : match[1],
        target: match[2],
        modifier: match[3],
      });
    }
  }
  
  return actions;
}

// =============================================================================
// DELAYED TRIGGERS
// Effects created by a spell that happen later
// =============================================================================

/**
 * Delayed trigger pattern
 * [effect] at the beginning of the next [phase/step]
 */
const DELAYED_TRIGGER_PATTERN = /(.+?)\s+at the beginning of the next\s+(.+?)\.?$/i;

/**
 * Parse delayed trigger from oracle text
 */
export function parseDelayedTrigger(text: string): { effect: string; timing: string } | null {
  const match = text.match(DELAYED_TRIGGER_PATTERN);
  if (match) {
    return {
      effect: match[1].trim(),
      timing: match[2].trim(),
    };
  }
  return null;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Patterns that indicate a sentence is a continuation/modifier of the previous sentence
 * rather than a new independent effect.
 * 
 * These patterns appear at the start of sentences (after ". " - period and space) and indicate:
 * - Modifiers or restrictions on the previous sentence
 * - Sequential actions that follow from the previous effect
 * - Filters or conditions related to the previous action
 * 
 * IMPORTANT: These patterns only apply to sentences separated by ". " (period space) within
 * the same line/ability. Sentences separated by newlines are NOT merged, as newlines indicate
 * separate abilities in MTG oracle text.
 * 
 * NOTE: "When" and "Whenever" are generally NOT included because they typically 
 * start new triggered abilities, not continuations. EXCEPTION: "When you do" and 
 * "Whenever you do" are reflexive triggers that refer back to the previous action
 * and should be merged.
 * 
 * NOTE: In MTG oracle text, separate abilities on permanents are separated by newlines,
 * not just periods. When multiple sentences appear on the same line (separated only by
 * periods), they are typically part of the same effect. This is why we include common
 * action verbs like "Draw", "Exile", etc. as continuation patterns.
 */
const CONTINUATION_SENTENCE_PATTERNS = [
  /^then\b/i,          // Sequential action: "Then draw a card"
  /^you\b/i,           // Continuation of effect on player: "You may...", "You gain..."
  /^if\b/i,            // Conditional modifier: "If you do..."
  /^when\s+you\s+do\b/i,  // Reflexive trigger: "When you do, X happens"
  /^whenever\s+you\s+do\b/i,  // Reflexive trigger: "Whenever you do, X happens"
  /^at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step\b/i, // Delayed trigger created by a spell/ability
  /^at\s+end\s+of\s+combat\b/i, // Delayed trigger created by a spell/ability
  /^at\s+(?:the\s+)?end\s+of\s+turn\b/i, // Oracle shorthand for next end step delayed trigger
  /^create\b/i,        // Token creation as continuation (often follows an effect)
  /^those\b/i,         // Reference to previous objects
  /^that\b/i,          // Reference to previous object/effect: "That creature gains..."
  /^return\b/i,        // Return action as continuation (often after exile)
  /^it\b/i,            // Reference to previous object: "It gains...", "It becomes..."
  /^until\b/i,         // Duration modifier: "Until end of turn"
  /^through\b/i,       // Duration modifier: "Through end of turn"
  /^as\s+long\s+as\b/i, // Condition/duration modifier: "As long as ..."
  /^during\b/i,        // Timing window modifier: "During your next turn ..."
  /^put\b/i,           // Put action as continuation (counters, cards in zones)
  /^activate\b/i,      // Activation restriction: "Activate only as a sorcery"
  /^this\b/i,          // Reference to the card itself as continuation
  /^for\b/i,           // Purpose/restriction clause
  /^spend\b/i,         // Mana spending restriction: "Spend this mana only to..."
  /^they\b/i,          // Reference to previous subjects
  /^each\b/i,          // Continuation affecting each player/permanent
  /^otherwise\b/i,     // Alternative clause
  /^instead\b/i,       // Replacement continuation
  /^draw\b/i,          // Draw as continuation: "Destroy X. Draw a card."
  /^shuffle\b/i,       // Shuffle as continuation: "Search library. Shuffle."
  /^(?:sacrifice|exile)\s+(?:it|them|that token|those tokens|the token|the tokens)\b/i, // Follow-up cleanup for created/affected objects
];

/**
 * Check if a sentence is a continuation of the previous sentence
 * rather than an independent effect.
 * 
 * @param sentence The sentence to check (trimmed)
 * @returns true if this sentence should be merged with the previous one
 */
function isContinuationSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  
  // Check against all continuation patterns
  return CONTINUATION_SENTENCE_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Merge sentences that are continuations with their preceding sentences.
 * This handles cases where a period separates what is logically one ability
 * into multiple sentences for readability.
 * 
 * Note: Continuation sentences in MTG oracle text maintain proper capitalization
 * after periods even though they're part of the same ability. We preserve this
 * by simply concatenating with a space.
 * 
 * @param sentences Array of sentences split by periods
 * @returns Array of merged sentences where continuations are combined
 */
function mergeContinuationSentences(sentences: string[]): string[] {
  const merged: string[] = [];
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    
    // Check if this is a continuation sentence
    if (merged.length > 0 && isContinuationSentence(trimmed)) {
      // Merge with the previous sentence
      // Preserve original capitalization by concatenating with a space
      merged[merged.length - 1] = merged[merged.length - 1] + ' ' + trimmed;
    } else {
      // This is a new independent sentence
      merged.push(trimmed);
    }
  }
  
  return merged;
}

/**
 * Check if effect text produces mana
 */
function isManaProducingAbility(effectText: string): boolean {
  const text = effectText.toLowerCase();
  
  // Check for explicit mana symbols
  if (/\{[wubrgc]\}/i.test(text)) return true;
  
  // Check for "add mana" patterns
  if (/add\s+\{/.test(text)) return true;
  if (/add\s+(one|two|three)?\s*mana/.test(text)) return true;
  if (/mana of any (type|color)/.test(text)) return true;
  
  return false;
}

/**
 * Check if effect text has targeting
 */
function hasTargeting(effectText: string): boolean {
  return /\btarget\b/i.test(effectText);
}

/**
 * Parse target types from effect text
 */
function parseTargets(effectText: string): string[] {
  const targets: string[] = [];
  const text = effectText.toLowerCase();
  
  // Common target patterns
  const patterns = [
    { pattern: /target\s+creature/, type: 'creature' },
    { pattern: /target\s+player/, type: 'player' },
    { pattern: /target\s+opponent/, type: 'opponent' },
    { pattern: /target\s+permanent/, type: 'permanent' },
    { pattern: /target\s+artifact/, type: 'artifact' },
    { pattern: /target\s+enchantment/, type: 'enchantment' },
    { pattern: /target\s+planeswalker/, type: 'planeswalker' },
    { pattern: /target\s+land/, type: 'land' },
    { pattern: /target\s+spell/, type: 'spell' },
    { pattern: /any\s+target/, type: 'any' },
  ];
  
  for (const { pattern, type } of patterns) {
    if (pattern.test(text)) {
      targets.push(type);
    }
  }
  
  return targets;
}

/**
 * Parse keywords from card oracle text
 */
export function parseKeywords(oracleText: string): string[] {
  const keywords: string[] = [];
  const text = oracleText.toLowerCase();
  
  // Common keywords (alphabetical)
  const keywordList = [
    'absorb', 'affinity', 'afflict', 'afterlife', 'aftermath', 'amplify', 'annihilator',
    'backup', 'banding', 'bargain', 'battalion', 'battle cry', 'bestow', 'blitz', 'bloodthirst',
    'bushido', 'buyback', 'cascade', 'casualty', 'celebration', 'champion', 'changeling',
    'cipher', 'cleave', 'companion', 'compleated', 'conjure', 'connive', 'conspire', 'convoke',
    'corrupted', 'crew', 'cumulative upkeep', 'cycling', 'dash', 'daybound', 'deathtouch',
    'decayed', 'defender', 'delve', 'demonstrate', 'descend', 'detain', 'devotion', 'devour',
    'discover', 'disguise', 'disturb', 'domain', 'double strike', 'dredge', 'echo', 'embalm',
    'emerge', 'enchant', 'encore', 'enlist', 'enrage', 'entwine', 'equip', 'escalate', 'escape',
    'eternalize', 'evoke', 'evolve', 'exalted', 'exploit', 'explore', 'extort', 'fabricate',
    'fading', 'fear', 'ferocious', 'fight', 'first strike', 'flanking', 'flash', 'flashback',
    'flying', 'for mirrodin!', 'forecast', 'foretell', 'formidable', 'friends forever', 'fuse',
    'goad', 'graft', 'gravestorm', 'haste', 'haunt', 'hellbent', 'heroic', 'hexproof',
    'hideaway', 'horsemanship', 'imprint', 'improvise', 'incubate', 'indestructible', 'infect',
    'inspired', 'intimidate', 'investigate', 'islandwalk', 'jump-start', 'kicker', 'kinship',
    'landfall', 'landwalk', 'learn', 'level up', 'lifelink', 'living weapon', 'madness',
    'magecraft', 'manifest', 'megamorph', 'meld', 'menace', 'mentor', 'metalcraft', 'mill',
    'miracle', 'modular', 'monstrosity', 'morbid', 'morph', 'mountainwalk', 'mutate', 'ninjutsu',
    'nightbound', 'offering', 'offspring', 'outlast', 'overload', 'partner', 'partner with',
    'persist', 'phasing', 'plainswalk', 'plot', 'populate', 'proliferate', 'protection',
    'provoke', 'prowess', 'prowl', 'radiance', 'raid', 'rally', 'rampage', 'reach', 'rebound',
    'reconfigure', 'recover', 'reinforce', 'renown', 'replicate', 'retrace', 'revolt', 'riot',
    'ripple', 'saddle', 'scavenge', 'scry', 'shadow', 'shroud', 'skulk', 'soulbond', 'soulshift',
    'spectacle', 'splice', 'split second', 'spree', 'squad', 'storm', 'strive', 'sunburst',
    'support', 'surge', 'surveil', 'suspend', 'swampcycling', 'swampwalk', 'threshold', 'totem armor',
    'trample', 'training', 'transfigure', 'transform', 'transmute', 'treasure', 'tribute', 'undaunted',
    'undergrowth', 'undying', 'unearth', 'unleash', 'vanishing', 'vigilance', 'ward', 'wither',
  ];
  
  for (const keyword of keywordList) {
    // Match keyword at word boundary
    const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(text)) {
      keywords.push(keyword);
    }
  }
  
  return keywords;
}

// =============================================================================
// MAIN PARSING FUNCTION
// =============================================================================

/**
 * Parse complete oracle text into structured abilities
 * 
 * This function follows the recommended parsing hierarchy:
 * 1. Check for Colon (:) → Parse as Activated Ability (Cost : Effect)
 * 2. Check Start Anchor:
 *    - If starts with "If ... instead" → Parse as Replacement
 *    - If starts with "As / ~ enters" → Parse as Static Replacement
 *    - If starts with "When / Whenever / At" → Parse as Trigger
 * 3. Fallback → Static Ability or Spell Ability
 */
export function parseOracleText(oracleText: string, cardName?: string): OracleTextParseResult {
  const abilities: ParsedAbility[] = [];
  const keywordActions: ParsedKeywordAction[] = [];
  let hasTargets = false;
  let hasModes = false;
  
  // Normalize card name references in text
  const normalizedText = cardName 
    ? oracleText.replace(new RegExp(cardName, 'gi'), 'this permanent')
    : oracleText;
  
  // Split into lines/sentences for parsing
  // Split by newlines first to preserve ability boundaries, then split sentences within each line
  const abilityLines = normalizedText.split(/\n+/).filter(l => l.trim());
  
  // For each ability line, split into sentences and merge continuations
  const lines: string[] = [];
  for (const abilityLine of abilityLines) {
    // Split sentences within this ability line
    const sentences = abilityLine.split(/(?<=[.!])\s+/).filter(s => s.trim());
    
    // Merge continuation sentences within this line only
    const merged = mergeContinuationSentences(sentences);
    
    // Add the merged sentences to our final list
    lines.push(...merged);
  }
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Step 1: Check for colon (activated ability)
    if (trimmed.includes(':') && !trimmed.startsWith('(')) {
      const activated = parseActivatedAbility(trimmed);
      if (activated) {
        abilities.push(activated);
        if (activated.targets && activated.targets.length > 0) hasTargets = true;
        continue;
      }
    }
    
    // Step 2a: Check for "If ... instead" (replacement effect)
    if (/^if\s+.+instead/i.test(trimmed)) {
      const replacement = parseReplacementEffect(trimmed);
      if (replacement) {
        abilities.push(replacement);
        continue;
      }
    }
    
    // Step 2b: Check for "As ... enters" (static replacement)
    if (/^as\s+.+enters/i.test(trimmed)) {
      const replacement = parseReplacementEffect(trimmed);
      if (replacement) {
        abilities.push(replacement);
        continue;
      }
    }
    
    // Step 2c: Check for triggers (When/Whenever/At)
    if (/^(when|whenever|at\s+the\s+beginning)/i.test(trimmed)) {
      const triggered = parseTriggeredAbility(trimmed);
      if (triggered) {
        abilities.push(triggered);
        if (triggered.targets && triggered.targets.length > 0) hasTargets = true;
        continue;
      }
    }
    
    // Step 3: Check for "enters with/tapped" patterns
    if (/enters the battlefield/i.test(trimmed)) {
      const replacement = parseReplacementEffect(trimmed);
      if (replacement) {
        abilities.push(replacement);
        continue;
      }
    }
    
    // Parse keyword actions from all text
    const actions = parseKeywordActions(trimmed);
    keywordActions.push(...actions);
    
    // Check for modal text
    if (/choose (one|two|three|four)/i.test(trimmed) || /\n•/.test(trimmed)) {
      hasModes = true;
    }
    
    // Check for targeting in non-ability text (spell effects)
    if (hasTargeting(trimmed)) {
      hasTargets = true;
    }
    
    // Step 4: Check for keyword abilities with cost (Equip, Cycling, etc.)
    // These don't have a colon, so they weren't caught in Step 1
    const keywordAbility = parseActivatedAbility(trimmed);
    if (keywordAbility && keywordAbility.type === AbilityType.KEYWORD) {
      abilities.push(keywordAbility);
      continue;
    }
    
    // Fallback: Static or spell ability (no specific pattern matched)
    // Only add if not empty and not already captured
    if (!abilities.some(a => a.text === trimmed)) {
      abilities.push({
        type: AbilityType.STATIC,
        text: trimmed,
        effect: trimmed,
      });
    }
  }
  
  // Parse keywords
  const keywords = parseKeywords(oracleText);
  
  return {
    abilities,
    keywords,
    keywordActions,
    isTriggered: abilities.some(a => a.type === AbilityType.TRIGGERED),
    isActivated: abilities.some(a => a.type === AbilityType.ACTIVATED || a.type === AbilityType.KEYWORD),
    isReplacement: abilities.some(a => a.type === AbilityType.REPLACEMENT),
    hasTargets,
    hasModes,
  };
}

/**
 * Quick check if oracle text contains a triggered ability
 */
export function hasTriggeredAbility(oracleText: string): boolean {
  return /\b(when|whenever|at\s+the\s+beginning)\b/i.test(oracleText);
}

/**
 * Quick check if oracle text contains an activated ability
 */
export function hasActivatedAbility(oracleText: string): boolean {
  // Check for keyword abilities with costs (Equip, Cycling, etc.) - these don't have colons
  if (KEYWORD_COST_PATTERN.test(oracleText)) {
    return true;
  }
  
  // Must have colon but not start with trigger keywords
  if (!oracleText.includes(':')) return false;
  
  // Check each line for activated ability pattern
  const lines = oracleText.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes(':') && 
        !trimmed.startsWith('(') &&
        !/^(when|whenever|at\s+the\s+beginning)/i.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Quick check if oracle text contains a replacement effect
 */
export function hasReplacementEffect(oracleText: string): boolean {
  return /\binstead\b/i.test(oracleText) ||
         /^as\s+.+enters/im.test(oracleText) ||
         /enters the battlefield (tapped|with)/i.test(oracleText);
}

export default {
  parseOracleText,
  parseActivatedAbility,
  parseTriggeredAbility,
  parseReplacementEffect,
  parseKeywordActions,
  parseKeywords,
  parseDelayedTrigger,
  hasTriggeredAbility,
  hasActivatedAbility,
  hasReplacementEffect,
};
