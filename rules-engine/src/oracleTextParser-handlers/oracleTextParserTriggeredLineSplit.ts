/**
 * Origin parent: rules-engine/src/oracleTextParser.ts
 * Cluster moved: TRIGGER_CONDITION_EVENT_HINTS, stripLeadingTriggeredAbilityLabel,
 * looksLikeTriggerEffectFragment, looksLikeCompleteTriggerCondition,
 * splitMixedStandaloneAndTriggeredLine, splitRepeatedTriggeredLead
 * Public entry symbols: stripLeadingTriggeredAbilityLabel, looksLikeCompleteTriggerCondition,
 * splitMixedStandaloneAndTriggeredLine, splitRepeatedTriggeredLead
 * Leaf must not import oracleTextParser.ts or oracleTextParser-handlers/index.ts.
 */

import { parseKeywordsFromOracleText } from '../oracleTextParserSupport';

const TRIGGER_CONDITION_EVENT_HINTS = [
  /\bdies$/i,
  /\bis put into (?:(?:a|an|your|its owner's|their owner's)\s+)?graveyard from the battlefield$/i,
  /\benters(?: the battlefield)?(?: under your control)?$/i,
  /\battacks?(?:\s+(?:a|an|the|target|each|one|that)\s+[^,]+|\s+alone|\s+with\s+[^,]+)?$/i,
  /\bblocks$/i,
  /\bbecomes blocked$/i,
  /\bdeals combat damage(?: to (?:a|an|target) [a-z0-9' -]+)?$/i,
  /\bdeals damage(?: to (?:a|an|target) [a-z0-9' -]+)?$/i,
  /\bis dealt (?:combat )?damage(?: to [^,]+)?$/i,
  /\b(?:you|an opponent|each opponent|a player|opponent) casts? (?:a|an|your|their|target) [a-z0-9' -]+$/i,
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
  /\b(?:is|are) milled$/i,
  /\b(?:is|are) put (?:on|onto|into) [\s\S]+$/i,
  /\bleaves the battlefield$/i,
  /\bbecomes the target$/i,
  /\bis targeted$/i,
];

export function stripLeadingTriggeredAbilityLabel(text: string): string {
  const trimmed = String(text || '').trim().replace(/^[\u2022•]\s+/, '');
  if (!trimmed) return trimmed;

  return trimmed.replace(
    /^[a-z][a-z0-9' ,/+-]*\s+[\u2014\-?]\s+(?=(?:when|whenever|at(?:\s+the\s+beginning)?)\b)/i,
    ''
  );
}

function looksLikeTriggerEffectFragment(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/^(?:they|you|that player|that opponent|each (?:player|opponent)|target (?:player|opponent))\b/i.test(trimmed)) {
    return true;
  }
  if (/^(?:you may|if you do|choose|create|draw|exile|return|put|sacrifice|destroy|tap|untap|gain|lose|mill|discover|search|reveal|shuffle|scry|surveil|proliferate|blight)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function looksLikeCompleteTriggerCondition(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  if (/\bif you cast (?:a |an )?(?:creature )?spell this way\b/i.test(normalized)) return false;
  if (/\bthe last time counter is removed\b/i.test(normalized)) return false;
  if (/\bsplice onto\b/i.test(normalized) || /\bconspire\s*\(/i.test(normalized)) return false;
  if (/^the beginning of the next end step\b/i.test(normalized)) return false;
  if (/,/.test(normalized) && /\b(?:exile|draw|you may play|for as long as they remain)\b/i.test(normalized)) {
    return false;
  }
  const commaIndex = normalized.indexOf(',');
  if (commaIndex >= 0) {
    const afterComma = normalized.slice(commaIndex + 1).trim();
    if (looksLikeTriggerEffectFragment(afterComma)) return false;
  }
  return TRIGGER_CONDITION_EVENT_HINTS.some(pattern => pattern.test(normalized));
}

export function splitMixedStandaloneAndTriggeredLine(text: string): string[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];

  const keywordLeadTrigger = trimmed.match(/^([A-Za-z][A-Za-z\s,'-]{0,80}?)\s+((?:when|whenever|at\s+the\s+beginning)\b[\s\S]+)$/i);
  if (keywordLeadTrigger) {
    const firstBody = String(keywordLeadTrigger[1] || '').trim();
    const remainder = String(keywordLeadTrigger[2] || '').trim();
    const standaloneKeywords = parseKeywordsFromOracleText(firstBody);
    const normalizedFirstBody = firstBody
      .toLowerCase()
      .replace(/\band\b/g, ',')
      .replace(/\s*,\s*/g, ',')
      .replace(/\s+/g, ' ')
      .trim();
    const normalizedKeywordText = standaloneKeywords
      .map(keyword => keyword.toLowerCase())
      .join(',')
      .trim();
    if (standaloneKeywords.length > 0 && normalizedFirstBody === normalizedKeywordText && remainder) {
      return [firstBody, remainder];
    }
  }

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

export function splitRepeatedTriggeredLead(text: string): string[] {
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

