// Shared helper for "does this card's own oracle give IT keyword X?"
// Distinct from lord grants ("Other Dinosaurs you control have haste"),
// references ("Destroy target creature with flying"), activated/triggered grants
// ("{U}: This creature gains flying until end of turn") and token-create tails
// ("create a ... token with haste").
// Public entry symbols: oracleTextHasOwnKeyword, oracleTextGrantsKeywordOnlyToOthers,
// grantedAbilityIsOwnKeyword, parseKeywordOnlyLineItems.

import { stripCreateTokenGrantedAbilities } from './oracleReminderText.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SENTENCE_WORDS_RE =
  /\b(?:have|has|gains?|gets?|with|without|target|loses?|lose|can't|cannot|can|each|all|other|when|whenever|if|deals?|destroy|exile|return|draw|put|create|sacrifice|until|is|are|your|this|that|it|its|you)\b/;
const PARAMETRIC_KEYWORD_RE =
  /^(?:enchant|protection from|hexproof from|ward|equip|cycling|kicker|flashback|landwalk|[a-z]+walk|toxic|afflict|annihilator|bushido|rampage|absorb|modular|fading|vanishing|crew|bloodthirst|dash|escape|unearth|embalm|eternalize|disturb|madness|morph|megamorph|ninjutsu|suspend|evoke|buyback|echo|cumulative upkeep|affinity for|reconfigure|bestow|mutate|offspring|station|saddle|backup|squad|casualty|blitz|prowess)\b/;

/** Items of an oracle line made only of keyword abilities ("Flying, vigilance"), else []. */
export function parseKeywordOnlyLineItems(line: string): string[] {
  const cleaned = String(line || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]$/, '')
    .trim()
    .toLowerCase();
  if (!cleaned || cleaned.includes(':') || cleaned.includes('"')) return [];
  const items = cleaned.split(/\s*[,;]\s*/).map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) return [];
  for (const item of items) {
    if (PARAMETRIC_KEYWORD_RE.test(item)) continue;
    const bare = item.replace(/\{[^}]*\}/g, ' ').replace(/[\u2014-]\s*.*$/, '').replace(/\s+\d+$|\s+x$/, '').trim();
    const words = bare.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 3) return [];
    if (SENTENCE_WORDS_RE.test(bare)) return [];
  }
  return items;
}

function itemIsKeyword(item: string, kw: string): boolean {
  return item === kw || item.startsWith(`${kw} `) || item.startsWith(`${kw}\u2014`);
}

/** Lines of a static ability (not activated "cost: effect", not a trigger). */
function isStaticLine(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  if (!trimmed) return false;
  if (/^(?:when|whenever|at the beginning|at end)\b/.test(trimmed)) return false;
  // Activated ability: "<cost>: <effect>" (a colon outside quotes).
  const unquoted = trimmed.replace(/"[^"]*"/g, ' ');
  if (unquoted.includes(':')) return false;
  return true;
}

/** Static line whose effect only applies while a condition holds. */
export function isConditionalStaticLine(line: string): boolean {
  return /\b(?:as long as|during your turn|during each of your turns|if you control|if it's your turn|threshold|metalcraft|hellbent|delirium|coven|ferocious|fateful hour)\b/i
    .test(String(line || '').replace(/"[^"]*"/g, ' '));
}

/**
 * True when `oracleText` prints the keyword on this permanent itself
 * (keyword-only line/list, or a static "this creature has X").
 * False for grants to others, references to the keyword and activated/triggered grants.
 */
export function oracleTextHasOwnKeyword(oracleText: string, keyword: string): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const escaped = escapeRegExp(kw);

  const stripped = stripCreateTokenGrantedAbilities(String(oracleText || ''))
    .replace(/\([^)]*\)/g, ' ');
  const lines = stripped.split(/\n+/);

  for (const line of lines) {
    if (parseKeywordOnlyLineItems(line).some((item) => itemIsKeyword(item, kw))) return true;
  }

  const selfHas = new RegExp(
    String.raw`\b(?:this (?:creature|permanent)|~)\s+(?:gets\s+[+-]\d+\/[+-]\d+\s+and\s+)?(?:has|gains?)\s+(?:[a-z ,]*?\b(?:and\s+)?)?${escaped}\b`,
    'i',
  );
  for (const line of lines) {
    if (!isStaticLine(line)) continue;
    // Conditional self-grants ("As long as ..., this creature has X", "... has X as long as ...",
    // "During your turn, ...") are not printed always-on keywords; the server evaluates them and
    // stamps the live result on the permanent (continuousAbilities).
    if (isConditionalStaticLine(line)) continue;
    const noQuotes = line.replace(/"[^"]*"/g, ' ');
    const withoutOtherGrants = noQuotes.replace(
      new RegExp(String.raw`\bother\b[^.?\n]*\b(?:have|has|gains?)\b[^.?\n]*\b${escaped}\b[^.?\n]*`, 'gi'),
      ' ',
    );
    if (selfHas.test(withoutOtherGrants)) return true;
  }
  return false;
}

/**
 * True when the only mention of `keyword` is a grant to others
 * ("Other Dinosaurs you control have haste"), not a printed self keyword.
 */
export function oracleTextGrantsKeywordOnlyToOthers(oracleText: string, keyword: string): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  if (oracleTextHasOwnKeyword(oracleText, kw)) return false;
  const escaped = escapeRegExp(kw);
  return new RegExp(
    String.raw`\bother\b[^.?\n]*\b(?:have|has|gains?)\b[^.?\n]*\b${escaped}\b`,
    'i',
  ).test(String(oracleText || ''));
}

/**
 * True when a grantedAbilities entry is the keyword itself ("Flying",
 * "flying and haste", "flying until end of turn"), not lord wording that
 * happens to contain the word.
 */
export function grantedAbilityIsOwnKeyword(entry: unknown, keyword: string): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const text = String(entry || '').trim().toLowerCase();
  if (!text) return false;
  if (text === kw) return true;
  const list = text
    .replace(/\s+until (?:end of turn|your next turn)\.?$/, '')
    .replace(/[.]$/, '')
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length > 0 && list.some((item) => itemIsKeyword(item, kw)) &&
      list.every((item) => parseKeywordOnlyLineItems(item).length > 0)) {
    return true;
  }
  return oracleTextHasOwnKeyword(text, kw);
}
