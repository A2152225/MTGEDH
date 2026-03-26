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

import {
  normalizeOracleTextSelfReferences,
  splitOracleTextIntoParseLines,
} from './oracleTextParserPreprocess';
import {
  hasTargeting,
  isManaProducingAbility,
  parseKeywordsFromOracleText,
  parseTargets,
} from './oracleTextParserSupport';
import {
  expandKeywordCostAbility,
  parseKeywordPrefixedActivatedAbility,
} from './oracleTextParserKeywordCosts';
import { parseKeywordActionAbility } from './oracleTextParserKeywordActionAbilities';
import { parseKeywordTriggeredAbility } from './oracleTextParserKeywordTriggers';

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
// Note: Use [\s\S] so multiline modal/bullet effects are supported.
const ACTIVATED_ABILITY_PATTERN = /^([^:]+?):\s*([\s\S]+)$/;

/**
 * Planeswalker loyalty ability pattern
 * Captures: loyalty change (group 1), effect (group 2)
 */
// Note: Use [\s\S] so multiline modal/bullet effects are supported.
const LOYALTY_ABILITY_PATTERN = /^([+−-]?\d+|0)\s*:\s*([\s\S]+)$/;

/**
 * Keyword lines that behave like activated abilities or special actions once
 * a cost is supplied. Pure spell modifiers / ability words such as Kicker,
 * Flashback, Landfall, or Ward are intentionally excluded here so they don't
 * get misclassified as inert activated keyword stubs.
 *
 * Captures: keyword (group 1), cost (group 2)
 */
const KEYWORD_COST_PATTERN = /^(Adapt|Basic landcycling|[A-Za-z]+cycling|Buyback|Cycling|Disturb|Embalm|Encore|Equip|Escape|Eternalize|Flashback|Fortify|Jump-start|Level up|Megamorph|Morph|Outlast|Reinforce|Replicate|Retrace|Scavenge|Transfigure|Transmute|Unearth)\s+(.+)$/i;

function isGrantedQuotedActivatedAbilityLine(text: string): boolean {
  const normalized = String(text || '').replace(/\u2019/g, "'").trim();
  if (!normalized.includes(':')) return false;
  return /\b(?:has|have|gains?)\s+"[^"]+:\s*[^"]+"\s*\.?$/i.test(normalized);
}

function firstColonIsInsideQuotes(text: string): boolean {
  const normalized = String(text || '').replace(/\u2019/g, "'");
  const colonIndex = normalized.indexOf(':');
  if (colonIndex < 0) return false;

  const lastQuoteBeforeColon = normalized.lastIndexOf('"', colonIndex);
  if (lastQuoteBeforeColon < 0) return false;
  const nextQuoteAfterColon = normalized.indexOf('"', colonIndex);
  return nextQuoteAfterColon > colonIndex;
}

/**
 * Parse an activated ability from oracle text line
 */
export function parseActivatedAbility(text: string): ParsedAbility | null {
  if (isGrantedQuotedActivatedAbilityLine(text) || firstColonIsInsideQuotes(text)) {
    return null;
  }

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

  const prefixedKeywordActivated = parseKeywordPrefixedActivatedAbility(text);
  if (prefixedKeywordActivated) {
    const isManaAbility =
      isManaProducingAbility(prefixedKeywordActivated.effect) &&
      !hasTargeting(prefixedKeywordActivated.effect);
    return {
      type: AbilityType.KEYWORD,
      text: prefixedKeywordActivated.text,
      cost: prefixedKeywordActivated.cost,
      effect: prefixedKeywordActivated.effect,
      isManaAbility,
      isOptional: prefixedKeywordActivated.effect.toLowerCase().includes('you may'),
      targets: parseTargets(prefixedKeywordActivated.effect),
    };
  }
  
  // Check for keyword with cost
  const keywordMatch = text.match(KEYWORD_COST_PATTERN);
  if (keywordMatch) {
    const rawCost = keywordMatch[2].trim();
    const cost = rawCost.replace(/\s+\([^()]*\)\s*$/, '').trim();
    if (
      String(keywordMatch[1] || '').trim().toLowerCase() === 'unearth' &&
      !/\{[^}]+\}/.test(cost || rawCost)
    ) {
      return null;
    }
    const expandedKeywordAbility = expandKeywordCostAbility(text, keywordMatch[1], cost || rawCost);
    if (expandedKeywordAbility) {
      const isManaAbility =
        isManaProducingAbility(expandedKeywordAbility.effect) &&
        !hasTargeting(expandedKeywordAbility.effect);
      return {
        type: AbilityType.KEYWORD,
        text: expandedKeywordAbility.text,
        cost: expandedKeywordAbility.cost,
        effect: expandedKeywordAbility.effect,
        isManaAbility,
        isOptional: expandedKeywordAbility.effect.toLowerCase().includes('you may'),
        targets: parseTargets(expandedKeywordAbility.effect),
      };
    }
    return {
      type: AbilityType.KEYWORD,
      text,
      cost: cost || rawCost,
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
// Note: Use [\s\S] so multiline modal/bullet effects are supported.
const WHEN_WHENEVER_PATTERN = /^(When|Whenever)\s+([\s\S]+?),\s+([\s\S]+)$/i;

// "At" clause pattern for specific points in time
// Captures: timing (group 2), effect (group 3)
// Note: Use [\s\S] so multiline modal/bullet effects are supported.
const AT_PATTERN = /^At\s+(the|each)\s+([\s\S]+?),\s+([\s\S]+)$/i;

// Intervening-if clause pattern (checks twice: on trigger and on resolution)
// Captures: trigger keyword (group 1), condition (group 2), if clause (group 3), effect (group 4)
// Note: Use [\s\S] so multiline modal/bullet effects are supported.
const INTERVENING_IF_PATTERN = /^(When|Whenever|At)\s+([\s\S]+?),\s+if\s+([\s\S]+?),\s+([\s\S]+)$/i;

const TRIGGER_CONDITION_EVENT_HINTS = [
  /\bdies$/i,
  /\bis put into (?:(?:a|an|your|its owner's|their owner's)\s+)?graveyard from the battlefield$/i,
  /\benters(?: the battlefield)?(?: under your control)?$/i,
  /\battacks(?: alone)?$/i,
  /\bblocks$/i,
  /\bbecomes blocked$/i,
  /\bdeals combat damage(?: to (?:a|an|target) [a-z0-9' -]+)?$/i,
  /\bdeals damage(?: to (?:a|an|target) [a-z0-9' -]+)?$/i,
  /\bcasts? (?:a|an|target) [a-z0-9' -]+$/i,
  /\bdraws? (?:a|an|\d+|x|[a-z]+)?\s*cards?$/i,
  /\bdiscards? (?:a|an|\d+|x|[a-z]+)?\s*cards?$/i,
  /\bgains? [a-z0-9' -]+ life$/i,
  /\bloses? [a-z0-9' -]+ life$/i,
  /\bloses the game$/i,
  /\bsacrifices? [a-z0-9' -]+$/i,
  /\bbecomes tapped$/i,
  /\btaps$/i,
  /\bbecomes untapped$/i,
  /\buntaps$/i,
  /\bis exiled$/i,
  /\bleaves the battlefield$/i,
  /\bbecomes the target$/i,
  /\bis targeted$/i,
];

function stripLeadingTriggeredAbilityLabel(text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return trimmed;

  return trimmed.replace(
    /^[a-z][a-z0-9' ,/+-]*\s+[\u2014\-?]\s+(?=(?:when|whenever|at(?:\s+the\s+beginning)?)\b)/i,
    ''
  );
}

function looksLikeCompleteTriggerCondition(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  return TRIGGER_CONDITION_EVENT_HINTS.some(pattern => pattern.test(normalized));
}

function splitMixedStandaloneAndTriggeredLine(text: string): string[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];

  const sentenceBoundary = trimmed.match(/^([^.!?]+[.!?])\s+([\s\S]+)$/);
  if (!sentenceBoundary) return [trimmed];

  const firstSentence = String(sentenceBoundary[1] || '').trim();
  const remainder = String(sentenceBoundary[2] || '').trim();
  if (!firstSentence || !remainder) return [trimmed];

  const firstBody = firstSentence.replace(/[.!?]+$/, '').trim();
  if (!firstBody) return [trimmed];

  const standaloneKeywords = parseKeywordsFromOracleText(firstBody);

  // Keep true sentence continuations intact; only split simple standalone
  // clauses like "Flash." before a triggered/replacement ability.
  if (/[,:;]/.test(firstBody)) return [trimmed];
  if (standaloneKeywords.length === 0) return [trimmed];
  if (/^(when\s+you\s+do|whenever\s+you\s+do)\b/i.test(remainder)) return [trimmed];
  if (!/^(when|whenever|at\s+the\s+beginning|if\b.+\binstead\b|as\s+.+enters\b)/i.test(remainder)) {
    return [trimmed];
  }

  return [firstSentence, remainder];
}

function splitRepeatedTriggeredLead(text: string): string[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];

  const match = trimmed.match(/^(When|Whenever)\s+([\s\S]+?),\s+([\s\S]+)$/i);
  if (!match) return [trimmed];

  const firstKeyword = String(match[1] || '').trim();
  const leadBody = String(match[2] || '').trim();
  const effect = String(match[3] || '').trim();
  if (!leadBody || !effect) return [trimmed];

  const segments = leadBody
    .split(/\s+and\s+(?=(?:when|whenever)\b)/i)
    .map(segment => segment.trim())
    .filter(Boolean);
  if (segments.length <= 1) return [trimmed];

  return segments.map((segment, index) => {
    const normalizedLead = index === 0
      ? `${firstKeyword} ${segment}`
      : segment.replace(/^(when|whenever)\b/i, keyword => keyword[0].toUpperCase() + keyword.slice(1).toLowerCase());
    return `${normalizedLead}, ${effect}`;
  });
}

function splitWhenWheneverTriggeredLine(text: string): {
  readonly keyword: 'when' | 'whenever';
  readonly triggerCondition: string;
  readonly effect: string;
} | null {
  const prefixMatch = text.match(/^(When|Whenever)\s+([\s\S]+)$/i);
  if (!prefixMatch) return null;

  const keyword = String(prefixMatch[1] || '').trim().toLowerCase() as 'when' | 'whenever';
  const body = String(prefixMatch[2] || '').trim();
  if (!body) return null;

  const boundary = /,\s+/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(body)) !== null) {
    const triggerCondition = body.slice(0, match.index).trim();
    const effect = body.slice(match.index + match[0].length).trim();
    if (!triggerCondition || !effect) continue;
    if (!looksLikeCompleteTriggerCondition(triggerCondition)) continue;
    return { keyword, triggerCondition, effect };
  }

  const fallback = text.match(WHEN_WHENEVER_PATTERN);
  if (!fallback) return null;
  return {
    keyword: String(fallback[1] || '').trim().toLowerCase() as 'when' | 'whenever',
    triggerCondition: String(fallback[2] || '').trim(),
    effect: String(fallback[3] || '').trim(),
  };
}

/**
 * Parse a triggered ability from oracle text line
 */
export function parseTriggeredAbility(text: string): ParsedAbility | null {
  const parseInterveningIfEffect = (
    triggerKeyword: 'when' | 'whenever' | 'at',
    triggerCondition: string,
    effect: string
  ): ParsedAbility => {
    const rawEffect = effect.trim();
    const ifPrefix = rawEffect.match(/^if\s+([\s\S]+?),\s+([\s\S]+)$/i);
    if (ifPrefix) {
      const interveningIf = String(ifPrefix[1] || '').trim();
      const effectText = String(ifPrefix[2] || '').trim();
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword,
        triggerCondition,
        interveningIf,
        effect: effectText,
        isOptional: effectText.toLowerCase().includes('you may'),
        targets: parseTargets(effectText),
      };
    }

    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword,
      triggerCondition,
      effect: rawEffect,
      isOptional: rawEffect.toLowerCase().includes('you may'),
      targets: parseTargets(rawEffect),
    };
  };

  // Check for "At" clause (beginning of phases/steps)
  const atMatch = text.match(AT_PATTERN);
  if (atMatch) {
    return parseInterveningIfEffect('at', `${atMatch[1]} ${atMatch[2]}`.trim(), atMatch[3]);
  }

  // Check for When/Whenever clause
  const whenMatch = splitWhenWheneverTriggeredLine(text);
  if (whenMatch) {
    return parseInterveningIfEffect(whenMatch.keyword, whenMatch.triggerCondition, whenMatch.effect);
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

/**
 * Parse keywords from card oracle text
 */
export function parseKeywords(oracleText: string): string[] {
  return parseKeywordsFromOracleText(oracleText);
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

  // Normalize self-references in text. This includes the full printed card name
  // plus common legendary shorthand like "Endrek Sahr" from
  // "Endrek Sahr, Master Breeder".
  const normalizedText = normalizeOracleTextSelfReferences(oracleText, cardName);
  
  // Shared preprocessing preserves ability boundaries, keeps modal bullet blocks
  // intact, and merges sentence fragments that continue a prior instruction.
  const lines = splitOracleTextIntoParseLines(normalizedText)
    .flatMap(splitMixedStandaloneAndTriggeredLine)
    .flatMap(splitRepeatedTriggeredLead);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const triggerCandidate = stripLeadingTriggeredAbilityLabel(trimmed);
    
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
    if (/^(when|whenever|at\s+the\s+beginning)/i.test(triggerCandidate)) {
      const triggered = parseTriggeredAbility(triggerCandidate);
      if (triggered) {
        abilities.push({ ...triggered, text: trimmed });
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

    const keywordTriggered = parseKeywordTriggeredAbility(trimmed);
    if (keywordTriggered) {
      abilities.push(keywordTriggered);
      if (keywordTriggered.targets && keywordTriggered.targets.length > 0) hasTargets = true;
      continue;
    }

    const keywordActionAbility = parseKeywordActionAbility(trimmed);
    if (keywordActionAbility) {
      abilities.push(keywordActionAbility);
      if (keywordActionAbility.effect && hasTargeting(keywordActionAbility.effect)) {
        hasTargets = true;
      }
      continue;
    }
    
    // Parse keyword actions from all text
    const actions = parseKeywordActions(trimmed);
    keywordActions.push(...actions);
    
    // Check for modal text
    if (/choose\s+(?:one|two|three|four|up to)\b/i.test(trimmed) || /[\u2022•]/.test(trimmed)) {
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
  if (/\b(when|whenever|at\s+the\s+beginning)\b/i.test(oracleText)) {
    return true;
  }

  const lines = String(oracleText || '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
  return lines.some(line => parseKeywordTriggeredAbility(line) !== null);
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
        !isGrantedQuotedActivatedAbilityLine(trimmed) &&
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
