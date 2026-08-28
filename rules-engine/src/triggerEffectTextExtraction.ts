/**
 * Extract full triggered-ability effect text after a timing prefix.
 * Avoids truncating at the first period when the ability continues on the same trigger.
 */

import { normalizeGameplayEffectText } from './oracleReminderText.js';
import { resolveGlobalTimingMatchIndex } from './oracleLineRegexMatch.js';

const ABILITY_LINE_BOUNDARY =
  /\n\s*(?=(?:whenever|at the beginning of)\b|(?:when(?!\s+you\s+do(?:\s+so)?\b))|\{[0-9WUBRGC/P]+\}|[A-Za-z][A-Za-z0-9' ,-]*\{[0-9WUBRGC/P]+\}\s*:|(?:[A-Za-z]+(?: [A-Za-z]+)*—))/i;

const NEW_TRIGGER_TIMING_SENTENCE = /^(?:when|whenever|at the beginning of)\b/i;
const REFLEXIVE_WHEN_YOU_DO_SENTENCE = /^when you do(?: so)?\b/i;
const DELAYED_TRIGGER_CONTINUATION_SENTENCE =
  /^(?:at the beginning of (?:the |your )?next (?:end step|upkeep)|at the beginning of your next (?:end step|upkeep))\b/i;

const CONTINUATION_SENTENCE =
  /^(?:then|each|if you (?:do|win)|when you do(?: so)?|otherwise|you may|that player|those|they|it|choose|target|create|otherwise|search|reveal (?:those|them|it))\b/i;

function isNewTriggerTimingSentence(sentence: string): boolean {
  const trimmed = String(sentence || '').trim();
  if (!trimmed) return false;
  // Reflexive "When you do" continues the same ability (CR 603.12), not a new trigger line.
  if (REFLEXIVE_WHEN_YOU_DO_SENTENCE.test(trimmed)) return false;
  // "At the beginning of the next end step, …" is a delayed trigger created by
  // this resolving ability (CR 603.7), not a separate card trigger.
  if (DELAYED_TRIGGER_CONTINUATION_SENTENCE.test(trimmed)) return false;
  return NEW_TRIGGER_TIMING_SENTENCE.test(trimmed);
}

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

function unmatchedOpenParenCount(text: string): number {
  let depth = 0;
  for (const char of String(text || '')) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
  }
  return depth;
}

function sliceClosedReminderTail(tail: string, openParenCount: number): string | null {
  if (openParenCount <= 0) return null;
  let depth = openParenCount;
  for (let i = 0; i < tail.length; i += 1) {
    const char = tail[i];
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return tail.slice(0, i).trim();
      }
    }
  }
  return tail.trim();
}

export function truncateAtAbilityBoundary(text: string): string {
  const source = String(text || '');
  const boundary = source.match(ABILITY_LINE_BOUNDARY);
  if (boundary?.index != null && boundary.index > 0) {
    return source.slice(0, boundary.index).trim();
  }

  const newlineIdx = source.indexOf('\n');
  if (newlineIdx > 0) {
    const firstLine = source.slice(0, newlineIdx).trim();
    const rest = source.slice(newlineIdx + 1).trim();
    if (firstLine.endsWith('.') && rest) {
      const restIsContinuation =
        CONTINUATION_SENTENCE.test(rest)
        || isNewTriggerTimingSentence(rest)
        // Modal / random-choice modes continue on bullet lines after the lead sentence.
        || /^[\u2022•]/.test(rest);
      if (!restIsContinuation) {
        return firstLine;
      }
    }
  }

  return source.trim();
}

function shouldIncludeContinuationSentence(sentence: string, fullTail: string): boolean {
  const trimmed = String(sentence || '').trim();
  if (!trimmed) return false;
  if (isNewTriggerTimingSentence(trimmed)) return false;
  if (CONTINUATION_SENTENCE.test(trimmed)) return true;
  // Modal / random-choice modes continue on bullet lines.
  if (/^[\u2022•]/.test(trimmed)) return true;

  const sentenceStart = fullTail.indexOf(trimmed);
  if (sentenceStart > 0) {
    const between = fullTail.slice(0, sentenceStart);
    if (!between.includes('\n')) return true;
  }
  return false;
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

  const reminderClosed = sliceClosedReminderTail(
    source.slice(effectStartIndex),
    unmatchedOpenParenCount(source.slice(0, effectStartIndex)),
  );
  const tail = truncateAtAbilityBoundary(reminderClosed ?? source.slice(effectStartIndex));
  const sentences = splitSentences(tail);
  if (sentences.length === 0) return normalizeGameplayEffectText(tail);
  if (sentences.length === 1) return normalizeGameplayEffectText(sentences[0].trim());

  let effect = sentences[0].trim();
  for (let i = 1; i < sentences.length; i += 1) {
    const sentence = sentences[i].trim();
    if (!shouldIncludeContinuationSentence(sentence, tail)) break;
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
  const matchIndex = resolveGlobalTimingMatchIndex(oracleText, match);
  if (matchIndex < 0) return normalizeGameplayEffectText(captured.trim());

  const prefixLength = Math.max(0, fullMatch.length - captured.length);
  const effectStartIndex = matchIndex + prefixLength;
  const extracted = extractTriggerEffectAfterPrefix(oracleText, effectStartIndex);
  return normalizeGameplayEffectText(extracted || captured.trim());
}

function normalizeEffectClauseForCompare(text: string): string {
  return normalizeGameplayEffectText(String(text || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
    .trim();
}

function triggerEffectClauseMatchesFragment(fullEffect: string, fragment: string): boolean {
  const full = normalizeEffectClauseForCompare(fullEffect);
  const frag = normalizeEffectClauseForCompare(fragment);
  if (!full || !frag) return false;
  if (full === frag) return true;
  if (full.startsWith(`${frag}.`)) return true;
  if (full.startsWith(frag)) return true;
  const firstSentence = full.split(/\.\s+/)[0]?.trim() || '';
  return firstSentence === frag;
}

function resolveEffectStartIndexAfterTiming(oracleText: string, timingStart: number): number {
  const afterTiming = String(oracleText || '').slice(timingStart);
  const commaIdx = afterTiming.indexOf(',');
  if (commaIdx >= 0) {
    let effectStart = timingStart + commaIdx + 1;
    while (oracleText[effectStart] === ' ') effectStart += 1;
    return effectStart;
  }
  return timingStart;
}

/**
 * Given card oracle text and a truncated trigger effect fragment (e.g. from a stack
 * item description), return the full multi-sentence effect clause when the fragment
 * matches the start of a triggered ability on that card.
 */
export function findTriggerEffectClauseMatchingFragment(
  oracleText: string,
  fragment: string,
): string | null {
  const source = String(oracleText || '').trim();
  const fragNorm = normalizeEffectClauseForCompare(fragment);
  if (!source || !fragNorm) return null;

  const timingPattern = /\b(?:when|whenever|at the beginning of)\b/gi;
  let bestMatch: string | null = null;
  let bestLength = 0;
  let match: RegExpExecArray | null;

  while ((match = timingPattern.exec(source)) !== null) {
    const timingStart = match.index ?? -1;
    if (timingStart < 0) continue;

    const effectStart = resolveEffectStartIndexAfterTiming(source, timingStart);
    const extracted = extractTriggerEffectAfterPrefix(source, effectStart);
    if (!extracted || !triggerEffectClauseMatchesFragment(extracted, fragment)) continue;

    if (extracted.length > bestLength) {
      bestMatch = extracted;
      bestLength = extracted.length;
    }
  }

  return bestMatch;
}
