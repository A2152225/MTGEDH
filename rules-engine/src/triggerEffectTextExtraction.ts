/**
 * Extract full triggered-ability effect text after a timing prefix.
 * Avoids truncating at the first period when the ability continues on the same trigger.
 */

import { normalizeGameplayEffectText } from './oracleReminderText.js';

const ABILITY_LINE_BOUNDARY =
  /\n\s*(?=(?:when|whenever|at the beginning of)\b|\{[0-9WUBRGC/P]+\}|[A-Za-z][A-Za-z0-9' ,-]*\{[0-9WUBRGC/P]+\}\s*:|(?:[A-Za-z]+(?: [A-Za-z]+)*—))/i;

const NEW_TRIGGER_TIMING_SENTENCE = /^(?:when|whenever|at the beginning of)\b/i;

const CONTINUATION_SENTENCE =
  /^(?:then|each|if you (?:do|win)|otherwise|you may|that player|those|they|it|choose|target|otherwise)\b/i;

function splitSentences(text: string): string[] {
  const source = String(text || '').trim();
  if (!source) return [];

  const sentences: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth = Math.max(0, parenDepth - 1);

    if (
      char === '.'
      && parenDepth === 0
      && (i === source.length - 1 || /\s/.test(source[i + 1] || ''))
    ) {
      current += char;
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = '';
      while (source[i + 1] === ' ') i += 1;
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function joinSentences(left: string, right: string): string {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (!a) return b;
  if (!b) return a;
  const leftEnds = a.endsWith('.') ? a : `${a}.`;
  return `${leftEnds} ${b}`.replace(/\.\s+\./g, '.').trim();
}

export function truncateAtAbilityBoundary(text: string): string {
  const boundary = text.match(ABILITY_LINE_BOUNDARY);
  if (boundary?.index != null && boundary.index > 0) {
    return text.slice(0, boundary.index).trim();
  }
  return text.trim();
}

function shouldIncludeContinuationSentence(sentence: string): boolean {
  const trimmed = String(sentence || '').trim();
  if (!trimmed) return false;
  if (NEW_TRIGGER_TIMING_SENTENCE.test(trimmed)) return false;
  return CONTINUATION_SENTENCE.test(trimmed) || !NEW_TRIGGER_TIMING_SENTENCE.test(trimmed);
}

/**
 * Returns the full effect text for one triggered ability starting at `effectStartIndex`.
 */
export function extractTriggerEffectAfterPrefix(
  oracleText: string,
  effectStartIndex: number,
): string {
  const source = String(oracleText || '');
  if (effectStartIndex < 0 || effectStartIndex >= source.length) return '';

  const tail = truncateAtAbilityBoundary(source.slice(effectStartIndex));
  const sentences = splitSentences(tail);
  if (sentences.length === 0) return normalizeGameplayEffectText(tail);
  if (sentences.length === 1) return normalizeGameplayEffectText(sentences[0].trim());

  let effect = sentences[0].trim();
  for (let i = 1; i < sentences.length; i += 1) {
    const sentence = sentences[i].trim();
    if (!shouldIncludeContinuationSentence(sentence)) break;
    effect = joinSentences(effect, sentence);
  }

  return normalizeGameplayEffectText(effect);
}

/**
 * Given a regex match on oracle text where group 1 is the first sentence fragment,
 * return the full multi-sentence effect for that trigger.
 */
export function extractTriggeredEffectFromTimingMatch(
  oracleText: string,
  match: RegExpMatchArray,
  effectGroupIndex = 1,
): string {
  const fullMatch = String(match[0] || '');
  const captured = String(match[effectGroupIndex] || '');
  const matchIndex = typeof match.index === 'number'
    ? match.index
    : String(oracleText || '').indexOf(fullMatch);
  if (matchIndex < 0) return normalizeGameplayEffectText(captured.trim());

  const prefixLength = Math.max(0, fullMatch.length - captured.length);
  const effectStartIndex = matchIndex + prefixLength;
  const extracted = extractTriggerEffectAfterPrefix(oracleText, effectStartIndex);
  return normalizeGameplayEffectText(extracted || captured.trim());
}
