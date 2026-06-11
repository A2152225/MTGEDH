/**
 * Keyword-aware reminder text normalization for oracle parsing and extraction.
 *
 * Strips parenthetical keyword reminders, em-dash keyword ability blocks
 * (Escape—, Eternalize—, …), standard mechanic/type boilerplate (Room DFC footers,
 * Siege intro lines, craft transform footers), and activation tails (Equip, {cost}:)
 * while preserving gameplay parentheticals such as saga chapter rules or modal headers.
 */

import { ORACLE_KEYWORDS } from './oracleTextParserSupport.js';

const ESCAPED_KEYWORDS = [...ORACLE_KEYWORDS]
  .sort((a, b) => b.length - a.length)
  .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const KEYWORD_WORD_PATTERN = `(?:${ESCAPED_KEYWORDS.join('|')})`;

const REMINDER_PAREN_CONTENT =
  /^(?:this (?:creature|card|spell|permanent|aura|enchantment|artifact|token|vehicle|siege|room|saga|land|equipment|creature token)|it'?s an (?:artifact|enchantment|creature)|you may cast|if you would|as long as|activate only|cast this spell only|exile (?:it|this card)|a deck can have|can be your commander|to (?:mill|scry|surveil|adapt|transform|manifest|connive|discover|investigate|learn|proliferate|revolve|open an attraction|convene|solved)|choose one at random|that (?:creature|player|permanent|token)|target creatures? with|creatures? (?:with|you control)|spells? you cast|damage (?:causes|dealt)|(?:an |a )?player(?:s)? with|spend (?:this )?mana only|put (?:a|one|two|three|\d+) \+|return this card from your graveyard|when(?:ever)? (?:this|a|you)|until (?:end of turn|your next)|for each |if (?:this|that|you|a)|as this (?:creature|permanent|artifact|enchantment|saga|siege|room|class|enchantment creature) (?:enters|transforms)|yes, we know|a permanent with|equip(?:ped|ment)? only|reconfigure only|tap any number of creatures|sacrifice after [ivxlcdm]+|read ahead|partner(?: with)?|doctor'?s companion|friends forever|choose a background|deckbuilding|note the mana value)/i;

const GAMEPLAY_PAREN_CONTENT =
  /^(?:as this saga enters|choose one(?:\s*[-—]| at the beginning)|when you unlock this door|to solve|as this (?:siege|room|class|enchantment creature|enchantment|artifact|creature|permanent) enters|if you cast it|for each player,? choose|modal)/i;

/** Mechanic/type boilerplate — not CR keyword reminders or em-dash ability blocks. */
export const STANDARD_ORACLE_FRAGMENT_PATTERNS = {
  dfc_modal: [
    /^you may cast either half\.?\s*$/i,
    /^that door unlocks on the battlefield\.?\s*$/i,
    /\.\s*you may cast either half\.?\s*that door unlocks on the battlefield\.?\s*$/i,
    /\.\s*you may cast either half\.?\s*$/i,
    /\.\s*that door unlocks on the battlefield\.?\s*$/i,
  ],
  room_mechanic: [
    /^unlock a locked door of up to one target room you control\.?\s*$/i,
    /^lock or unlock a door of target room you control\.?\s*$/i,
  ],
  siege_mechanic: [
    /^\(as a siege enters,.+\)\.?\s*$/i,
    /^as a siege enters,.+$/i,
    /\s*\(as a siege enters,.+\)\.?\s*$/i,
  ],
  transform_footer: [
    /^return this card transformed under its owner(?:'|')s control(?:\.\s*craft only as a sorcery\.?)?\.?\s*$/i,
    /\.\s*return this card transformed under its owner(?:'|')s control(?:\.\s*craft only as a sorcery\.?)?\.?\s*$/i,
  ],
} as const;

const STANDARD_ORACLE_WHOLE_LINE_PATTERNS = Object.values(STANDARD_ORACLE_FRAGMENT_PATTERNS).flat();

const STANDARD_ORACLE_TRAILING_PATTERNS = [
  ...STANDARD_ORACLE_FRAGMENT_PATTERNS.dfc_modal.filter((pattern) => !pattern.source.startsWith('^')),
  ...STANDARD_ORACLE_FRAGMENT_PATTERNS.siege_mechanic.filter((pattern) => !pattern.source.startsWith('^')),
  ...STANDARD_ORACLE_FRAGMENT_PATTERNS.transform_footer.filter((pattern) => !pattern.source.startsWith('^')),
];

/** Keywords commonly printed as ". Keyword—cost, …" or newline ability tails after gameplay text. */
const KEYWORD_ABILITY_SUFFIX_NAMES = [
  'escape', 'evoke', 'eternalize', 'embalm', 'flashback', 'unearth', 'aftermath',
  'jump-start', 'disturb', 'plot', 'mutate', 'blitz', 'foretell', 'station',
  'craft', 'level up', 'cycling', 'kicker', 'reconfigure', 'equip', 'ninjutsu',
  'sneak', 'splice', 'buyback', 'spectacle', 'casualty', 'freerunning', 'offspring',
  'gift', 'impending', 'warp', 'monstrosity', 'undying', 'persist', 'recover',
  'scavenge', 'bestow', 'miracle', 'madness', 'overload', 'entwine', 'fuse',
  'retrace', 'replicate', 'dash', 'emerge', 'convoke', 'delve', 'surge',
  'prowess', 'magecraft', 'dredge', 'transmute', 'forecast', 'reinforce',
  'living weapon', 'crew', 'saddle', 'spree', 'backup', 'ravenous', 'squad',
  'prototype', 'disguise', 'cloak', 'manifest', 'manifest dread', 'bargain',
  'casualty', 'harmonize', 'mobilize', 'exhaust', 'read ahead', 'enlist',
  'encore', 'boast', 'demonstrate', 'cleave', 'sunburst', 'devour', 'amplify',
  'fabricate', 'explore', 'support', 'gift a', 'gift a card', 'plot',
] as const;

const KEYWORD_SUFFIX_PATTERN = new RegExp(
  `(?:^|[.?!]\\s+|\\n+\\s*)(${KEYWORD_ABILITY_SUFFIX_NAMES.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\s+with(?:\\s+[\\w-]+)?)?\\s*(?:—|-|\\{|\\d)[\\s\\S]*$`,
  'i',
);

const TOKEN_TYPE_REMINDER =
  /\.\s*\((?:it'?s|they'?re) an (?:artifact|enchantment|creature)[^)]*\)\s*\.?/gi;

const ACTIVATION_TAIL =
  /(?:\.\s*(?:\([^)]*\)\s*)?|\n+\s*)\{[^}]+\}(?:\{[^}]+\})*(?:,\s*|\s*:)\s*[\s\S]*$/i;

const EQUIP_RECONFIGURE_TAIL =
  /\s+(?:equip(?:\{[^}]*\}|\d+\})?|reconfigure(?:\{[^}]*\})?)(?:\s*\([^)]*\))?\s*\.?\s*$/i;

function findClosingParen(source: string, openIndex: number): number {
  let depth = 0;
  let inQuotes = false;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function precedingToken(text: string, openIndex: number): string {
  return String(text.slice(Math.max(0, openIndex - 80), openIndex) || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isKeywordAnchoredReminder(preceding: string): boolean {
  return new RegExp(`(?:^|[\\s,.])${KEYWORD_WORD_PATTERN}(?:\\s*\\{[^}]+\\})*\\s*$`, 'i').test(preceding)
    || /\b(?:equip|reconfigure|cycling|kicker|flashback|escape|evoke|eternalize|ward)\s*(?:\{[^}]+\})*\s*$/i.test(preceding);
}

function shouldStripParenthetical(source: string, openIndex: number): boolean {
  const closeIndex = findClosingParen(source, openIndex);
  if (closeIndex < 0) return false;

  const inner = source.slice(openIndex + 1, closeIndex).trim();
  if (!inner) return false;

  if (GAMEPLAY_PAREN_CONTENT.test(inner)) return false;
  if (/^as a siege enters\b/i.test(inner)) return true;

  const preceding = precedingToken(source, openIndex);
  if (isKeywordAnchoredReminder(preceding)) return true;
  if (REMINDER_PAREN_CONTENT.test(inner)) return true;

  if (/^\([^)]*\)$/.test(`(${inner})`) && parseKeywordsOnlyParen(inner)) return true;

  return false;
}

function parseKeywordsOnlyParen(inner: string): boolean {
  const withoutReminder = inner.replace(/\s*\([^()]*\)\s*/g, ' ').trim();
  const parts = withoutReminder.split(/\s*,\s*|\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) =>
    ORACLE_KEYWORDS.some((keyword) => part.toLowerCase() === keyword || part.toLowerCase().startsWith(`${keyword} `)),
  );
}

/**
 * Remove parenthetical regions that match known keyword reminder patterns.
 */
export function stripReminderParentheticals(text: string): string {
  const source = String(text || '');
  let result = '';
  let i = 0;

  while (i < source.length) {
    if (source[i] === '(' && shouldStripParenthetical(source, i)) {
      const closeIndex = findClosingParen(source, i);
      if (closeIndex >= 0) {
        i = closeIndex + 1;
        continue;
      }
    }
    result += source[i];
    i += 1;
  }

  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * True when a line is only standard mechanic/type boilerplate (Room DFC footer, Siege intro, …).
 */
export function isStandardOracleFragmentOnly(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized) return false;
  return STANDARD_ORACLE_WHOLE_LINE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Remove standard non-keyword mechanic/type boilerplate from effect text.
 */
export function stripStandardOracleFragments(text: string): string {
  let result = String(text || '').trim();
  if (!result) return '';

  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;

    for (const pattern of STANDARD_ORACLE_TRAILING_PATTERNS) {
      const next = result.replace(pattern, (match) => (match.startsWith('.') ? '.' : '')).trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }

    for (const pattern of STANDARD_ORACLE_WHOLE_LINE_PATTERNS) {
      if (!pattern.test(result)) continue;
      const next = result.replace(pattern, '').trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }

    if (!changed) break;
  }

  return result.replace(/\.\s*\./g, '.').trim();
}

/**
 * Remove trailing em-dash / cost keyword ability blocks (Escape—, Craft with …, etc.).
 */
export function stripKeywordAbilitySuffixes(text: string): string {
  let normalized = String(text || '').trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const match = normalized.match(KEYWORD_SUFFIX_PATTERN);
    if (!match || match.index == null) break;
    if (match.index === 0) {
      normalized = '';
      break;
    }
    normalized = normalized.slice(0, match.index).replace(/[.?!]\s*$/, '').trim();
  }
  return normalized.trim();
}

/**
 * Remove standard token-type reminder sentences, e.g. Food/Clue/Treasure boilerplate.
 */
export function stripTokenTypeReminders(text: string): string {
  return String(text || '').replace(TOKEN_TYPE_REMINDER, '.').replace(/\.\s*\./g, '.').trim();
}

/**
 * Remove Equip / Reconfigure / {cost}: activation tails from effect text.
 */
export function stripActivationAbilitySuffixes(text: string): string {
  let result = String(text || '').trim();
  result = result.replace(ACTIVATION_TAIL, (match) => (match.startsWith('.') ? '.' : '')).trim();
  result = result.replace(EQUIP_RECONFIGURE_TAIL, '').trim();
  return result;
}

/**
 * Normalize triggered-ability effect text to gameplay-only content.
 */
export function normalizeGameplayEffectText(effectText: string): string {
  let text = String(effectText || '').trim();
  if (!text) return '';

  text = stripKeywordAbilitySuffixes(text);
  text = stripStandardOracleFragments(text);
  text = stripTokenTypeReminders(text);
  text = stripReminderParentheticals(text);
  text = stripActivationAbilitySuffixes(text);

  return text
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .replace(/([^.?!])\s*$/g, (_, ending: string) => `${ending}.`)
    .trim();
}

/**
 * Strip reminder/boilerplate noise from a single oracle line without effect-tail
 * normalization (preserves keyword costs, activation headers, etc.).
 */
export function normalizeOracleLineForParsing(line: string): string {
  let text = String(line || '').trim();
  if (!text) return '';

  text = stripStandardOracleFragments(text);
  text = stripTokenTypeReminders(text);
  text = stripReminderParentheticals(text);

  return text.replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim();
}

/**
 * Normalize full oracle text for IR/clause parsing: drop boilerplate-only lines and
 * strip reminders, but preserve keyword ability structure on remaining lines.
 */
export function normalizeOracleForParsing(oracleText: string): string {
  const source = String(oracleText || '').replace(/\r/g, '');
  if (!source.trim()) return '';

  const lines = source.split('\n');
  const normalizedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || isStandardOracleFragmentOnly(trimmed)) return '';
    const normalized = normalizeOracleLineForParsing(trimmed);
    if (!normalized || isStandardOracleFragmentOnly(normalized)) return '';
    return normalized;
  });

  return normalizedLines.filter(Boolean).join('\n');
}

/**
 * Normalize a full oracle text block for gameplay parsing (line-preserving).
 */
export function normalizeOracleForGameplay(oracleText: string): string {
  const source = String(oracleText || '').replace(/\r/g, '');
  if (!source.trim()) return '';

  const lines = source.split('\n');
  const normalizedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || isStandardOracleFragmentOnly(trimmed)) return '';
    const normalized = normalizeGameplayEffectText(trimmed);
    if (!normalized || isStandardOracleFragmentOnly(normalized)) return '';
    return normalized;
  });

  return normalizedLines.filter(Boolean).join('\n');
}

export { ORACLE_KEYWORDS };
