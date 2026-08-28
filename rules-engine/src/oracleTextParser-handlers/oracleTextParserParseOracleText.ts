/**
 * Origin parent: rules-engine/src/oracleTextParser.ts
 * Cluster moved: parseKeywords, parseOracleText
 * Public entry symbols: parseKeywords, parseOracleText
 * Leaf must not import oracleTextParser.ts or oracleTextParser-handlers/index.ts.
 */

import {
  normalizeOracleTextSelfReferences,
  splitOracleTextIntoParseLines,
} from '../oracleTextParserPreprocess';
import { hasTargeting, parseKeywordsFromOracleText } from '../oracleTextParserSupport';
import { parseKeywordActionAbility } from '../oracleTextParserKeywordActionAbilities';
import { parseKeywordTriggeredAbility } from '../oracleTextParserKeywordTriggers';
import {
  AbilityType,
  type OracleTextParseResult,
  type ParsedAbility,
  type ParsedKeywordAction,
} from './oracleTextParserTypes.js';
import {
  splitMixedStandaloneAndTriggeredLine,
  splitRepeatedTriggeredLead,
  stripLeadingTriggeredAbilityLabel,
} from './oracleTextParserTriggeredLineSplit.js';
import { getOracleTextParserHandlerDeps } from './oracleTextParserHandlerDeps.js';
import { parseActivatedAbility } from './oracleTextParserParseActivatedAbility.js';

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
  const {
    parseTriggeredAbility,
    parseReplacementEffect,
    parseKeywordActions,
    isTemporarySpellReplacementLine,
    isSpellInstructionLine,
  } = getOracleTextParserHandlerDeps();
  const abilities: ParsedAbility[] = [];
  const keywordActions: ParsedKeywordAction[] = [];
  let hasTargets = false;
  let hasModes = false;

  // Normalize self-references in text. This includes the full printed card name
  // plus common legendary shorthand like "Endrek Sahr" from
  // "Endrek Sahr, Master Breeder" and 3-letter first names like "Ral".
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
    
    // Step 2a: Check for replacement effects ("If ... would ...", "If ... instead", ETB modifiers).
    // Temporary this-turn spell replacements (Gather Specimens, Blind Fury) resolve with the
    // spell and must stay SPELL so collectSpellResolutionEffectSteps keeps them.
    if (
      !isTemporarySpellReplacementLine(trimmed) &&
      (
        /^if\s+.+instead/i.test(trimmed) ||
        /^if\s+.+,\s+(?:it|this\s+[^.;]+?)\s+enters\b/i.test(trimmed) ||
        /^if\s+.+\s+would\s+.+,\s+/i.test(trimmed)
      )
    ) {
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
    
    // Delayed this-turn ETB windows resolve with the spell (Rite of Harmony family).
    // Delayed "dealt damage this way dies this turn" windows (Reckless Blaze / Skeletonize).
    if (
      /^whenever\s+a(?:n)?\s+.+?\s+you\s+control\s+enters(?:\s+the\s+battlefield)?\s+this\s+turn,/i.test(triggerCandidate)
      || /^whenever\s+a(?:n)?\s+.+?\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control\s+this\s+turn,/i.test(triggerCandidate)
      || /^when(?:ever)?\s+a\s+creature(?:\s+you\s+control)?\s+dealt\s+damage\s+this\s+way\s+dies\s+this\s+turn,/i.test(triggerCandidate)
    ) {
      abilities.push({
        type: AbilityType.SPELL,
        text: trimmed,
        effect: trimmed,
      });
      if (hasTargeting(trimmed)) hasTargets = true;
      continue;
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
    
    // Step 3: Check for self-replacement "enters with/tapped" patterns
    if (
      /\benters the battlefield\b/i.test(trimmed)
      || /^this\s+[^.;]+?\s+enters\b/i.test(trimmed)
      || (/\benters(?: the battlefield)? with\b/i.test(trimmed) && /\bcounters?\s+on\s+(?:it|him|her)\b/i.test(trimmed))
    ) {
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
    
    // Fallback: spell instruction vs continuous static ability
    if (!abilities.some(a => a.text === trimmed)) {
      abilities.push({
        type: isSpellInstructionLine(trimmed) ? AbilityType.SPELL : AbilityType.STATIC,
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
