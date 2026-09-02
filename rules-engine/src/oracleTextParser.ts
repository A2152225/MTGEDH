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

import { parseTargets } from './oracleTextParserSupport';
import { parseKeywordTriggeredAbility } from './oracleTextParserKeywordTriggers';
import { looksLikeCompleteTriggerCondition } from './oracleTextParser-handlers/oracleTextParserTriggeredLineSplit.js';
import { setOracleTextParserHandlerDeps } from './oracleTextParser-handlers/oracleTextParserHandlerDeps.js';
import {
  KEYWORD_COST_PATTERN,
  isGrantedQuotedActivatedAbilityLine,
  parseActivatedAbility,
} from './oracleTextParser-handlers/oracleTextParserParseActivatedAbility.js';
import { parseKeywords, parseOracleText } from './oracleTextParser-handlers/oracleTextParserParseOracleText.js';
import {
  AbilityType,
  type ChoiceRequirement,
  type OracleTextParseResult,
  type ParsedAbility,
  type ParsedKeywordAction,
} from './oracleTextParser-handlers/oracleTextParserTypes.js';

export {
  AbilityType,
  type ParsedAbility,
  type ChoiceRequirement,
  type ParsedKeywordAction,
  type OracleTextParseResult,
};
export { parseActivatedAbility, parseKeywords, parseOracleText };




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
const INSTEAD_PATTERN = /^If\s+([^()]+?)\s+would\s+(.+?),\s+(.+?)\s+instead\.?$/i;
/** "If … would …, instead …" (instead before the replacement event). */
const INSTEAD_BEFORE_EFFECT_PATTERN = /^If\s+([^()]+?)\s+would\s+(.+?),\s+instead\s+(.+?)\.?$/i;

/**
 * "Would" replacement without an explicit "instead" clause.
 * Mindskinner: "If a source you control would deal damage to an opponent, prevent that damage..."
 */
const WOULD_EVENT_REPLACE_PATTERN = /^If\s+(.+?)\s+would\s+(.+?),\s+(.+)$/i;

/**
 * "Enters with" or "Enters as" clause pattern
 * For modifiers affecting how permanents enter the battlefield
 */
// Strictly match a standalone "X enters the battlefield <modifier>" sentence.
// We intentionally do NOT match multi-sentence merged lines like
// "Create a token. It enters the battlefield ..."; those should be handled
// by the IR parser as spell instructions with follow-up modifiers.
const ENTERS_WITH_PATTERN = /^([^.;]+?)\s+enters the battlefield\s+([^.;]+?)[.;]?$/i;
const SELF_ENTERS_SHORT_PATTERN = /^(This\s+[^.;]+?)\s+enters\s+([^.;]+?)[.;]?$/i;
const SELF_ENTERS_WITH_COUNTERS_PATTERN =
  /^([^.;]+?)\s+enters(?: the battlefield)?\s+(with\s+(?:a|an|\d+|x|[a-z]+)\s+.+?\s+counters?\s+on\s+(?:it|him|her))[.;]?$/i;
const CONDITIONAL_SELF_ENTERS_PATTERN = /^If\s+(.+?),\s+((?:This\s+[^.;]+?|It)\s+enters(?: the battlefield)?\s+[^.;]+?)[.;]?$/i;
const ENTERS_AS_PATTERN = /^As\s+(.+?)\s+enters(?: the battlefield)?,\s+(.+)$/i;

function isLikelySelfEntryCounterSubject(subject: string): boolean {
  const normalized = String(subject || '').trim().toLowerCase();
  if (!normalized) return false;
  if (/^this\b/.test(normalized) || normalized === 'it') return true;
  if (/\b(each|all|any|other|your|you control|opponent|creatures?|permanents?|tokens?|they|them|those)\b/.test(normalized)) {
    return false;
  }
  return true;
}

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

  const insteadBeforeMatch = text.match(INSTEAD_BEFORE_EFFECT_PATTERN);
  if (insteadBeforeMatch) {
    return {
      type: AbilityType.REPLACEMENT,
      text,
      triggerCondition: insteadBeforeMatch[1].trim(),
      effect: insteadBeforeMatch[3].trim(),
    };
  }

  const wouldReplaceMatch = text.match(WOULD_EVENT_REPLACE_PATTERN);
  if (wouldReplaceMatch) {
    const effect = wouldReplaceMatch[3].trim();
    if (/prevent that damage|prevent all damage|put .* counter|mills? cards equal/i.test(effect)) {
      return {
        type: AbilityType.REPLACEMENT,
        text,
        triggerCondition: `${wouldReplaceMatch[1].trim()} would ${wouldReplaceMatch[2].trim()}`,
        effect,
      };
    }
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

  const conditionalSelfEntersMatch = text.match(CONDITIONAL_SELF_ENTERS_PATTERN);
  if (conditionalSelfEntersMatch) {
    return {
      type: AbilityType.REPLACEMENT,
      text,
      triggerCondition: conditionalSelfEntersMatch[1].trim(),
      effect: conditionalSelfEntersMatch[2].trim(),
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

  const selfEntersShortMatch = text.match(SELF_ENTERS_SHORT_PATTERN);
  if (selfEntersShortMatch) {
    return {
      type: AbilityType.REPLACEMENT,
      text,
      triggerCondition: `${selfEntersShortMatch[1]} enters the battlefield`,
      effect: selfEntersShortMatch[2].trim(),
    };
  }

  const selfEntersWithCountersMatch = text.match(SELF_ENTERS_WITH_COUNTERS_PATTERN);
  if (selfEntersWithCountersMatch && isLikelySelfEntryCounterSubject(selfEntersWithCountersMatch[1])) {
    return {
      type: AbilityType.REPLACEMENT,
      text,
      triggerCondition: `${selfEntersWithCountersMatch[1]} enters the battlefield`,
      effect: selfEntersWithCountersMatch[2].trim(),
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

const SPELL_INSTRUCTION_LEAD_PATTERN =
  /^(?:look|draw|mill|deal|destroy|exile|return|search|scry|surveil|create|put|target|counter|gain|lose|shuffle|reveal|choose|sacrifice|discard|tap|untap|fight|copy|cast|animate|goad|proliferate|distribute|pay|add|remove|prevent|attach|detach|unattach|switch|take|roll|amass|bolster|clash|learn|support|investigate|manifest|cloak|forage|connive|populate|incubate|venture|time\s+travel|seek|discover|change|exchange|move|flip|transform|monstrosity|detain|suspect|regenerate|double|turn|airbend|earthbend|waterbend|firebend|conjure|repeat|also|then|simultaneously|after|assign|separate|damage|its|it|leave|another|assemble|restart|randomly|name|using|call|place|count|give|secretly|only|redistribute|unless|reorder|draft|ignore|skip|end\s+the\s+combat|during|while\s+doing|two\s+target|for\s+any\s+number|excess\s+damage|as\s+many\s+times|attacking\s+creatures?\b|this\s+permanent\s+target|the\s+owner\s+of\s+target|the\s+owners?\b|the\s+next\b|the\s+ring\s+tempts\s+you|the\s+(?:damage|player|creature|exiled|duplicate|duplicates|high\s+bidder|winner|first|new\s+target|rest|chosen|other|owner)\b|their\s+controller\b|the\s+controller\b|for\s+each\b|up\s+to\b|an\s+opponent\b|any\s+(?:number|opponent|player)|all\s+(?:creatures?\b|damage\b|combat\s+damage\b|lands?\b|permanents?\b)|each\s+(?:other\s+)?(?:player|opponent|creature|permanent|land|artifact|enchantment|planeswalker|battle|nonland|head|opponents?\s+and\s+you)|each\s+of\b|starting\s+with\s+(?:you|the\s+next)\b|spells?\s+you\s+control\b|cards\s+(?:in|exiled)\b|(?:white|blue|black|red|green|monocolored|multicolored|nonwhite|nonblue|nonblack|nonred|nongreen)\s+creatures?\b|this\s+(?:spell|permanent|creature|card)\s+deals?)\b/i;

const SPELL_ABILITY_WORD_LEAD_PATTERN =
  /^(?:threshold|spell\s+mastery|addendum|raid|revolt|morbid|metalcraft|battalion|ferocious|heroic|constellation|landfall|magecraft|alliance|kinship|domain|hellbent|grandeur|chroma|imprint|delirium|eminence|council'?s\s+dilemma|will\s+of\s+the\s+(?:council|planeswalkers)|celebrate|enrage|spectacle|undergrowth|ascend|city'?s\s+blessing|pack\s+tactics|coven|bloodrush|kinfall|converge|corrupted|fateful\s+hour|join\s+forces|strive|teamwork|paradigm|bargain|vivid|tempting\s+offer|radiance|sweep|fathomless\s+descent|void|infusion|excess|parley|paradox|secret\s+council)\s*[—–-]/i;

/** Strip quoted oracle grants so cast-time cost checks ignore "This spell costs…" riders. */
function stripOracleQuotedSegments(text: string): string {
  return String(text || '')
    .replace(/"[^"]*"/g, ' ')
    .replace(/“[^”]*”/g, ' ')
    .replace(/'[^']*'/g, ' ');
}

/**
 * Spree / Tiered / modal bullets lead with markers that hide the real instruction verb.
 * Strip one layer so "• Create…" / "+ {1} — Search…" classify like bare effect text.
 */
function stripSpellModeLead(text: string): string | null {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  // Named tiered modes: "• Cross-Slash — {0} — Destroy…" (before bare bullet strip).
  const namedTier = trimmed.match(
    /^[•\u2022]\s+.+?\s*[—–-]\s*\{[^}]+\}\s*[—–-]\s*([\s\S]+)$/
  );
  if (namedTier?.[1]) return namedTier[1].trim();

  const bullet = trimmed.match(/^[•\u2022]\s+([\s\S]+)$/);
  if (bullet?.[1]) return bullet[1].trim();

  // Spree modes may use multi-symbol costs: "+ {3}{W}{W} — Destroy…"
  const spreeMode = trimmed.match(/^\+\s*(?:\{[^}]+\})+\s*[—–-]\s*([\s\S]+)$/);
  if (spreeMode?.[1]) return spreeMode[1].trim();

  // Season / {P}-worth modes: "{P}{P} — Draw cards…"
  const pMode = trimmed.match(/^(?:\{[^}]+\})+\s*[—–-]\s*([\s\S]+)$/);
  if (pMode?.[1]) return pMode[1].trim();

  // Bracketed mode markers: "[1] Put a +1/+1 counter…" (Pick Your Poison).
  const bracketMode = trimmed.match(/^\[\d+\]\s+([\s\S]+)$/);
  if (bracketMode?.[1]) return bracketMode[1].trim();

  const tieredBlock = trimmed.match(/^tiered\s*\([^)]*\)\s*([\s\S]*)$/i);
  if (tieredBlock) {
    const rest = String(tieredBlock[1] || '').trim();
    return rest || trimmed;
  }

  return null;
}

/**
 * Temporary until-EOT / until-next-turn grants are spell-resolution instructions even when
 * the sentence leads with a mass subject ("White creatures you control…", "Creatures you
 * control…"). Without this, Brave the Elements' protection follow-up is typed STATIC and
 * dropped by collectSpellResolutionEffectSteps.
 */
function isTemporaryDurationSpellEffectLine(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/^(?:when|whenever|at\s+the\b|as\s+long\s+as\b|as\s+.+\s+enters\b)/i.test(trimmed)) {
    return false;
  }
  if (!/\buntil\s+(?:end\s+of\s+turn|your\s+next\s+turn)\b/i.test(trimmed)) {
    return false;
  }
  return /\b(?:gain|gains|get|gets|have|has|lose|loses|become|becomes|can'?t|can\s+not|don'?t|do\s+not|switch|is|are)\b/i.test(trimmed);
}

/** Mass-subject resolution lines that are not continuous statics (Falter, Exhaustion, etc.). */
function isMassSubjectSpellEffectLine(text: string): boolean {
  if (isTemporaryDurationSpellEffectLine(text)) return true;
  // Temporary window (this turn / until … / next turn) → resolution instruction.
  if (
    /\b(?:this\s+turn|until\s+(?:end\s+of\s+turn|your\s+next\s+turn|\S.+?\s+next\s+turn)|during\s+(?:their|its|your)\s+next|perpetually)\b/i.test(
      text
    )
  ) {
    return true;
  }
  // One-shot riders without a duration phrase (Chance for Glory's indefinite indestructible grant;
  // Hunters' Feast / Reward the Faithful / Turtle Tracks / Camouflage pile riders).
  return /\b(?:don'?t\s+untap|doesn'?t\s+untap|do\s+not\s+untap|destroyed\s+this\s+way|can'?t\s+be\s+regenerated|if\s+able|discard|sacrifice|gains?\s+(?:flying|trample|haste|vigilance|lifelink|deathtouch|menace|reach|hexproof|indestructible|defender|first\s+strike|double\s+strike|protection|ward|all\s+creature\s+types)|(?:gains?|loses?)\s+(?:(?:\d+|x)\s+)?life|draws?\s+(?:a\s+card|(?:\d+|x)\s+cards?)|search(?:es)?|likewise|piles?|lose\s+all\s+abilities|become\s+(?:blocked|unblocked)|becomes?\s+a\s+copy)\b/i.test(
    text
  );
}

/** Gather Specimens / Blind Fury-style temporary replacements resolve with the spell. */
function isTemporarySpellReplacementLine(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!/^if\b/i.test(trimmed)) return false;
  if (!/\bwould\b/i.test(trimmed) || !/\binstead\b/i.test(trimmed)) return false;
  return /\b(?:this\s+turn|until\s+(?:end\s+of\s+turn|your\s+next\s+turn))\b/i.test(trimmed);
}

/**
 * "If …" riders that resolve with the spell (cast-from-hand, threshold tails, Banefire),
 * as opposed to continuous "If you control …, ~ gets +1/+1" statics.
 */
function isSpellConditionalResolutionLine(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!/^if\b/i.test(trimmed)) return false;

  if (isTemporarySpellReplacementLine(trimmed)) return true;

  if (
    /\bif\s+(?:this\s+spell|it)\s+was\s+(?:cast|kicked|kicked|foretold|flashbacked|cast\s+from)\b/i.test(trimmed) ||
    /\bif\s+(?:the\s+)?\{[^}]+\}(?:\{[^}]+\})*\s+cost\s+was\s+paid\b/i.test(trimmed) ||
    /\bif\s+x\s+is\b/i.test(trimmed) ||
    /^if\s+you\s+do\b/i.test(trimmed) ||
    /\bcan'?t\s+be\s+(?:countered|prevented)\b/i.test(trimmed) ||
    /\byou\s+win\s+the\s+game\b/i.test(trimmed) ||
    /\bchange\s+(?:that|its|the)\s+(?:spell'?s\s+)?target/i.test(trimmed)
  ) {
    return true;
  }

  // Continuous characteristic / PT boosts without a temporary window stay static.
  if (
    /\b(?:gets?|has|have|is|are)\s+[+-](?:\d+|x)\s*\/\s*[+-](?:\d+|x)\b/i.test(trimmed) &&
    !/\b(?:until\s+(?:end\s+of\s+turn|your\s+next\s+turn)|this\s+turn)\b/i.test(trimmed)
  ) {
    return false;
  }
  if (
    /\b(?:has|have|gains?|gets?)\s+(?:flying|trample|haste|vigilance|lifelink|deathtouch|menace|reach|hexproof|indestructible|defender|first\s+strike|double\s+strike|protection|ward)\b/i.test(
      trimmed
    ) &&
    !/\b(?:until\s+(?:end\s+of\s+turn|your\s+next\s+turn)|this\s+turn)\b/i.test(trimmed)
  ) {
    return false;
  }

  return /\b(?:draw|destroy|exile|create|search|gain|lose|win|deal|deals|mill|return|put|sacrifice|discard|counter|add|scry|surveil|cast|copy|choose|tap|untap|shuffle|reveal|prevent|amass|bolster|clash|learn|seek|discover|proliferate|investigate|populate|take\s+an\s+extra|can'?t\s+block|can'?t\s+attack|don'?t\s+untap|become|becomes|get\s+[+-]|gain\s+\w+|change|exchange|enters?\s+under|redistribute)\b/i.test(
    trimmed
  );
}

function isSpellInstructionLineInner(trimmed: string): boolean {
  if (!trimmed) return false;

  if (isTemporaryDurationSpellEffectLine(trimmed)) return true;

  // Duration-led restrictions / delayed grants: "Until end of turn, …" / "This turn, …"
  if (/^until\s+(?:end\s+of\s+turn|your\s+next\s+turn)\b/i.test(trimmed)) return true;
  if (/^this\s+turn\b/i.test(trimmed)) return true;

  // Tiered / Spree modal frameworks resolve as spell modes (headers + bullets).
  if (/^(?:tiered|spree)\b/i.test(trimmed) && !/\bas an additional cost to cast this spell\b/i.test(trimmed)) {
    // Bare "Spree (Choose one or more additional costs.)" is cast-time framing — keep static.
    if (/^spree\s*\([^)]*\)\s*$/i.test(trimmed)) return false;
    if (/^tiered\b/i.test(trimmed)) return true;
  }

  // Team-name modal modes (Aetherdrift team spells): "Team Cloudspire — Destroy…"
  if (/^team\s+[a-z0-9][a-z0-9'’\s-]*\s*[—–-]/i.test(trimmed)) {
    return true;
  }

  // Ability-word spell riders (Threshold —, Converge —, Corrupted —, …).
  // Cast-time cost riders under an ability word stay static (Strive — costs more, etc.).
  // Continuous permanent riders ("… as long as …") also stay static.
  // Ignore quoted granted text ("This spell costs {1} less…") when detecting cast-time.
  if (SPELL_ABILITY_WORD_LEAD_PATTERN.test(trimmed)) {
    const unquoted = stripOracleQuotedSegments(trimmed);
    if (
      /\bthis\s+spell\s+costs?\b|\bas an additional cost\b|\bmore to cast\b|\bless to cast\b|\brather than pay\b/i.test(
        unquoted
      )
    ) {
      return false;
    }
    // Permanent continuous ability words (Grim Flayer Delirium PT, etc.).
    if (/\bas\s+long\s+as\b/i.test(unquoted)) {
      return false;
    }
    return true;
  }

  // Cast-time / characteristic text — keep static so collectSpellResolutionEffectSteps skips it.
  if (
    /^(?:this\s+spell|this\s+permanent)\s+(?:has\b|costs?\b|is\b|can'?t\s+be\s+copied|can'?t\s+be\s+countered)\b/i.test(
      trimmed
    )
  ) {
    return false;
  }
  if (/^during\s+your\s+turn,\s*this\s+spell\s+costs?\b/i.test(trimmed)) {
    return false;
  }
  // Trap / Force-style "you may pay {X} rather than pay this spell's mana cost" is cast-time.
  // Do not treat the If-condition's "cast" as a resolution verb (Mindbreak Trap).
  if (
    /\brather than pay this spell(?:'|’)s mana cost\b/i.test(trimmed)
    && !/\b(?:exile|counter|destroy|return|draw)\b/i.test(
      trimmed.replace(/\brather than pay this spell(?:'|’)s mana cost\b/gi, ' ')
    )
  ) {
    return false;
  }

  // Delayed this-turn ETB windows are spell-resolution instructions (Rite of Harmony).
  if (
    /^whenever\s+a(?:n)?\s+.+?\s+you\s+control\s+enters(?:\s+the\s+battlefield)?\s+this\s+turn,/i.test(trimmed)
    || /^whenever\s+a(?:n)?\s+.+?\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control\s+this\s+turn,/i.test(trimmed)
  ) {
    return true;
  }

  // Delayed "dealt damage this way dies this turn" windows (Reckless Blaze / Skeletonize).
  if (
    /^when(?:ever)?\s+a\s+creature(?:\s+you\s+control)?\s+dealt\s+damage\s+this\s+way\s+dies\s+this\s+turn,/i.test(trimmed)
  ) {
    return true;
  }

  // Triggered / continuous / replacement leads that are not resolution instructions.
  // Exception: "Only the chosen creatures can attack…" is a spell-created combat restriction.
  if (
    /^(?:when|whenever|as\s+.+\s+enters\b|activated\s+abilities|legendary\s)/i.test(trimmed) ||
    (/^as\s+long\s+as\b/i.test(trimmed) && !/\bthis\s+turn\b|\buntil\s+end\s+of\s+turn\b/i.test(trimmed)) ||
    (/^only\b/i.test(trimmed) && !/\b(?:chosen|target|those|that)\b/i.test(trimmed))
  ) {
    return false;
  }

  // Delayed combat cleanup created by spells (Gaze of the Gorgon, Glyph of Doom).
  if (/^at\s+this\s+turn'?s\s+next\s+end\s+of\s+combat\b/i.test(trimmed)) {
    return true;
  }
  if (/^at\s+the\b/i.test(trimmed)) {
    return false;
  }

  // Cast-timing permissions are not resolution instructions.
  if (/^you\s+may\s+cast\s+this\s+spell\b/i.test(trimmed)) {
    return false;
  }

  // Exile-play tax riders resolve with the spell (Soul Partition).
  if (/^a\s+spell\s+cast\b/i.test(trimmed) && /\bcosts?\b.+\bto\s+cast\b/i.test(trimmed)) {
    return true;
  }

  // "You and …" / temporary control / shared actions (Secret Rendezvous, Secret of Bloodbending).
  if (/^you\s+and\b/i.test(trimmed)) return true;
  if (
    /^you\s+control\b/i.test(trimmed) &&
    /\b(?:target\s+opponent|target\s+player|during|until|this\s+turn|next\s+(?:turn|combat))\b/i.test(trimmed)
  ) {
    return true;
  }

  // "You <action>…" (Night's Whisper, Angel's Mercy) — not continuous "You control/have/can't".
  if (
    /^you\s+(?:may\b|gain|gains|draw|draws|lose|loses|mill|mills|create|creates|search|scry|surveil|put|puts|exile|exiles|sacrifice|sacrifices|discard|discards|tap|untap|choose|reveal|shuffle|look|add|remove|cast|copy|proliferate|goad|fight|attach|pay|take|get|gets|win|become|return|skip|exchange|secretly|own|do\b|each\b)/i.test(
      trimmed
    )
  ) {
    return true;
  }

  // "Your opponents can't… this turn", "Your life total becomes…", team instructions.
  if (
    /^your\s+(?:opponents?\b|life\s+total\b|team\b)/i.test(trimmed) &&
    /\b(?:this\s+turn|until\s+(?:end\s+of\s+turn|your\s+next\s+turn)|becomes?\b|may\b|can'?t\b|add\b|sacrifice|create|draw|gain|lose|search|put|exile|destroy)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }

  if (/^if\b/i.test(trimmed)) {
    return isSpellConditionalResolutionLine(trimmed);
  }

  if (
    /^(?:(?:other|white|blue|black|red|green|monocolored|multicolored|nonwhite|nonblue|nonblack|nonred|nongreen|nonartifact|attacking|blocking|x\s+target|any\s+number\s+of\s+target)\s+)?(?:creatures?|permanents?|lands?|artifacts?|enchantments?|planeswalkers?|players?|cowards?)\b/i.test(
      trimmed
    )
  ) {
    return isMassSubjectSpellEffectLine(trimmed);
  }

  // "Each <unusual subject>…" (Each Head…, Each nonland permanent…)
  if (/^each\b/i.test(trimmed) && isMassSubjectSpellEffectLine(trimmed)) {
    return true;
  }

  // Self-ref normalized keyword actions: "Manifest dread" → "this permanent. (Look…)"
  if (
    /^this\s+permanent\.\s*\(/i.test(trimmed) &&
    /\b(?:look at the top|manifest|dread|regenerate|cloak)\b/i.test(trimmed)
  ) {
    return true;
  }

  // Named source deals damage when self-ref normalization missed (A-Galvanic Discharge).
  if (
    !/^(?:when|whenever|if|as)\b/i.test(trimmed) &&
    /^[A-Za-z].+?\s+deals?\b/i.test(trimmed)
  ) {
    return true;
  }

  return SPELL_INSTRUCTION_LEAD_PATTERN.test(trimmed);
}

/** True when a fallback oracle line is a spell-resolution instruction (not a continuous static). */
export function isSpellInstructionLine(text: string): boolean {
  let current = String(text || '').trim();
  if (!current) return false;

  if (isSpellInstructionLineInner(current)) return true;

  for (let i = 0; i < 3; i += 1) {
    const stripped = stripSpellModeLead(current);
    if (!stripped || stripped === current) break;
    current = stripped;
    if (isSpellInstructionLineInner(current)) return true;
  }

  return false;
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
         /enters the battlefield (tapped|with)/i.test(oracleText) ||
         /^this\s+[^.;]+?\s+enters\s+(tapped|with)/im.test(oracleText);
}

setOracleTextParserHandlerDeps({
  parseTriggeredAbility,
  parseReplacementEffect,
  parseKeywordActions,
  isTemporarySpellReplacementLine,
  isSpellInstructionLine,
});

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
