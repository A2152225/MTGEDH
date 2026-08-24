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
  /^(?:this (?:creature|card|spell|permanent|aura|enchantment|artifact|token|vehicle|siege|room|saga|land|equipment|creature token)|(?:it'?s|they'?re) (?:an )?(?:artifacts?|enchantments?|creatures?)(?: with)?|you may cast|as you cast|if you would|as long as|activate only|cast this spell only|exile (?:it|this card)|a deck can have|can be your commander|to (?:mill|scry|surveil|adapt|transform|manifest|connive|discover|investigate|learn|proliferate|revolve|open an attraction|convene|solved)|choose one at random|that (?:creature|player|permanent|token)|target creatures? with|creatures? (?:with|you control)|spells? you cast|damage (?:causes|dealt)|(?:an |a )?player(?:s)? with|spend (?:this )?mana only|put (?:a|one|two|three|\d+) \+|return this card from your graveyard|when(?:ever)? (?:this|a|you)|until (?:end of turn|your next)|for each |if (?:this|that|you|a)|as this (?:creature|permanent|artifact|enchantment|saga|siege|room|class|enchantment creature) (?:enters|transforms)|yes, we know|a permanent with|equip(?:ped|ment)? only|reconfigure only|tap any number of creatures|sacrifice after [ivxlcdm]+|read ahead|partner(?: with)?|doctor'?s companion|friends forever|choose a background|deckbuilding|note the mana value)/i;

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
    /^unlock a locked door of target room you control\.?\s*$/i,
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

/** Sole keyword-action effects (e.g. ETB "support 2") — not reminder suffixes to strip. */
const STANDALONE_KEYWORD_ACTION_EFFECT = new RegExp(
  `^(?:${['support', 'fabricate', 'explore', 'mobilize', 'devour', 'amplify', 'reinforce', 'monstrosity']
    .join('|')}|explore-clash)\\s*(?:\\d+|\\{[^}]+\\})?\\.?\\s*$`,
  'i',
);

/** Keyword action followed by a gameplay continuation sentence (Merfolk Surveyor explore-clash). */
const KEYWORD_ACTION_WITH_CONTINUATION = /^(?:explore-clash|support\s+\d+|fabricate\s+\d+)\.\s+\S/i;

const TOKEN_TYPE_REMINDER =
  /\.\s*\((?:it['\u2019]?s|they['\u2019]?re) (?:an )?(?:artifacts?|enchantments?|creatures?)(?: with)?[^)]*\)\s*\.?/gi;

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
    || /\b(?:equip|reconfigure|cycling|kicker|flashback|escape|evoke|eternalize|ward|cleave|overload|splice(?:\s+onto\s+\w+)?)\s*(?:\{[^}]+\})*\s*$/i.test(preceding);
}

function shouldStripParenthetical(source: string, openIndex: number): boolean {
  const closeIndex = findClosingParen(source, openIndex);
  if (closeIndex < 0) return false;

  const inner = source.slice(openIndex + 1, closeIndex).trim();
  if (!inner) return false;

  // Token-type reminders (Treasure/Lander/Vibranium/Powerstone style) must strip even though
  // they begin with "It's an artifact with ...".
  if (/^(?:it['\u2019]?s|they['\u2019]?re)\s+(?:an\s+)?(?:artifacts?|enchantments?|creatures?)(?:\s+with)\b/i.test(inner)) {
    return true;
  }

  if (GAMEPLAY_PAREN_CONTENT.test(inner)) return false;
  if (/^as a siege enters\b/i.test(inner)) return true;

  const preceding = precedingToken(source, openIndex);
  // Station (Tap …: Put charge counters…) is the ability definition, not a reminder paren.
  if (/\bstation\s*$/i.test(preceding)) return false;

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
        const inner = source.slice(i + 1, closeIndex).trim();
        // Lift create-token type reminder abilities onto the create stem before dropping the paren
        // so IR/token construction still sees grants (indestructible, quoted mana abilities, …).
        if (
          /^(?:it['\u2019]?s|they['\u2019]?re)\s+(?:an\s+)?(?:artifacts?|enchantments?|creatures?)(?:\s+with)\b/i.test(inner)
          && /\bcreates?\b[\s\S]*\btokens?\b/i.test(result)
        ) {
          const lifted = extractCreateTokenGrantedAbilities(`Create a token. (${inner})`);
          const injection = formatCreateTokenAbilityInjection(lifted);
          const recent = result.slice(Math.max(0, result.length - 160));
          if (injection && !/\swith\s+indestructible\b/i.test(recent) && !recent.toLowerCase().includes(injection.trim().toLowerCase())) {
            result += injection;
          }
        }
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
  const trimmed = String(text || '').trim();
  if (STANDALONE_KEYWORD_ACTION_EFFECT.test(trimmed)) {
    return trimmed.replace(/\.\s*$/, '').trim();
  }
  if (KEYWORD_ACTION_WITH_CONTINUATION.test(trimmed)) {
    return trimmed;
  }
  let normalized = trimmed;
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

const CREATE_TOKEN_TYPE_PAREN_INNER =
  /^(?:it['\u2019]?s|they['\u2019]?re)\s+(?:an\s+)?(?:artifacts?|enchantments?|creatures?)(?:\s+with)?\b/i;

/**
 * Quote-safe removal of create-token type parentheticals such as
 * `(It's an artifact with indestructible and "{T}: Add {C}.")`.
 */
function stripCreateTokenTypeParentheticals(text: string): string {
  const source = String(text || '');
  let result = '';
  let i = 0;

  while (i < source.length) {
    if (source[i] === '(') {
      const closeIndex = findClosingParen(source, i);
      if (closeIndex >= 0) {
        const inner = source.slice(i + 1, closeIndex).trim();
        if (CREATE_TOKEN_TYPE_PAREN_INNER.test(inner)) {
          i = closeIndex + 1;
          continue;
        }
      }
    }
    result += source[i];
    i += 1;
  }

  return result;
}

/** Static keywords commonly granted on created tokens via "with …" / follow-ups / reminders. */
const CREATE_TOKEN_GRANTED_KEYWORD_NAMES = [
  'flying',
  'vigilance',
  'haste',
  'trample',
  'lifelink',
  'deathtouch',
  'menace',
  'reach',
  'hexproof',
  'shroud',
  'defender',
  'indestructible',
  'first strike',
  'double strike',
  'prowess',
  'decayed',
  'flash',
  'training',
] as const;

const CREATE_TOKEN_KEYWORD_LOOKUP = [...CREATE_TOKEN_GRANTED_KEYWORD_NAMES]
  .sort((a, b) => b.length - a.length);

function titleCaseCreateTokenKeyword(keyword: string): string {
  const lower = String(keyword || '').toLowerCase();
  if (lower === 'first strike') return 'First strike';
  if (lower === 'double strike') return 'Double strike';
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : '';
}

function collectCreateTokenKeywordsFromSegment(segment: string, into: string[]): void {
  const text = String(segment || '');
  if (!text.trim()) return;
  const lower = text.toLowerCase();
  for (const keyword of CREATE_TOKEN_KEYWORD_LOOKUP) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${escaped}\\b`, 'i').test(lower)) {
      continue;
    }
    const normalized = titleCaseCreateTokenKeyword(keyword);
    if (normalized && !into.some((entry) => entry.toLowerCase() === normalized.toLowerCase())) {
      into.push(normalized);
    }
  }
}

function collectQuotedAbilitiesFromSegment(segment: string, into: string[]): void {
  for (const match of String(segment || '').matchAll(/"([^"]+)"/g)) {
    const ability = String(match[1] || '').trim();
    if (!ability) continue;
    if (!into.some((entry) => entry.toLowerCase() === ability.toLowerCase())) {
      into.push(ability);
    }
  }
}

function isCopyTokenCreateFragment(text: string): boolean {
  return /\bcreate\b[\s\S]*?\btokens?\b[\s\S]*?\bcopy\b/i.test(String(text || ''))
    || /\btokens?\s+that(?:['\u2019]?s|\s+is|\s+are)\s+(?:a\s+)?copy\b/i.test(String(text || ''));
}

/**
 * Extract keyword/ability grants that belong on a *created token*, not the creator.
 *
 * Supports generic oracle patterns:
 * - same-sentence: `Create a 1/1 Soldier token with flying and lifelink.`
 * - parenthetical: `create a Vibranium token. (It's an artifact with indestructible and "{T}: …")`
 * - follow-up: `It has flying.` / `They are indestructible.` / `That token has lifelink.` / `It's indestructible.`
 *
 * Returns [] for non-create fragments such as `creatures you control with flying`.
 * Copy-token creates return [] so keywords are not invented from unrelated "with" text.
 */

/**
 * Derive a create-clause fragment from full source-card oracle for token ability extraction.
 * Splits sentences and keeps follow-up `It has` / `They are` / `That token` lines attached.
 *
 * Matching priority when sourceText/description is absent:
 * 1) unique create fragment mentioning the token name (case-insensitive; ignores trailing "Token")
 * 2) exactly one create…token fragment on the card
 * 3) unique create fragment containing the token P/T
 * If multiple creates and none uniquely match, returns '' (do not merge - avoids Soldier getting Zombie keywords).
 */
export function deriveCreateTokenSourceFragment(
  tokenName: string,
  sourceOracleText: string,
  tokenPower?: number,
  tokenToughness?: number,
): string {
  const oracle = String(sourceOracleText || '').replace(/\r/g, '').trim();
  if (!oracle) return '';

  const followUpRe =
    /^(?:It(?:['\u2019]?s|\s+has|\s+is|\s+have)|They(?:['\u2019]?re|\s+have|\s+are|\s+has)|That\s+tokens?\s+(?:has|have|is|are)|Those\s+tokens\s+(?:have|are))\b/i;
  const createTokenRe = /\bcreates?\b[\s\S]*?\btokens?\b/i;

  const sentences = oracle
    .split(/(?<=[.?!])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const fragments: string[] = [];
  let current: string | null = null;
  for (const sentence of sentences) {
    if (createTokenRe.test(sentence)) {
      if (current) fragments.push(current);
      current = sentence;
      continue;
    }
    if (current && followUpRe.test(sentence)) {
      current = `${current} ${sentence}`;
      continue;
    }
    if (current) {
      fragments.push(current);
      current = null;
    }
  }
  if (current) fragments.push(current);
  if (fragments.length === 0) return '';

  const nameLower = String(tokenName || '').trim().toLowerCase();
  const nameCandidates = new Set<string>();
  if (nameLower) {
    nameCandidates.add(nameLower);
    const withoutTokenSuffix = nameLower.replace(/\s+tokens?$/i, '').trim();
    if (withoutTokenSuffix) nameCandidates.add(withoutTokenSuffix);
  }

  if (nameCandidates.size > 0) {
    const nameMatches = fragments.filter((fragment) => {
      const lower = fragment.toLowerCase();
      return [...nameCandidates].some((candidate) => candidate && lower.includes(candidate));
    });
    if (nameMatches.length === 1) return nameMatches[0];
    if (nameMatches.length > 1) return '';
  }

  if (fragments.length === 1) return fragments[0];

  if (
    tokenPower != null
    && tokenToughness != null
    && Number.isFinite(Number(tokenPower))
    && Number.isFinite(Number(tokenToughness))
  ) {
    const ptRe = new RegExp(String.raw`\b${Number(tokenPower)}/${Number(tokenToughness)}\b`);
    const ptMatches = fragments.filter((fragment) => ptRe.test(fragment));
    if (ptMatches.length === 1) return ptMatches[0];
  }

  return '';
}

export function extractCreateTokenGrantedAbilities(createClauseOrOracleFragment: string): string[] {
  const source = String(createClauseOrOracleFragment || '');
  if (!source.trim()) return [];

  const hasCreateToken = /\bcreates?\b[\s\S]*?\btokens?\b/i.test(source);
  const followUpOnly = /^(?:It(?:['\u2019]?s|\s+has|\s+is|\s+have)|They(?:['\u2019]?re|\s+have|\s+are|\s+has)|That\s+tokens?\s+(?:has|have|is|are)|Those\s+tokens\s+(?:have|are))\b/i.test(
    source.trim(),
  );

  if (!hasCreateToken && !followUpOnly) return [];
  if (hasCreateToken && isCopyTokenCreateFragment(source)) return [];

  const out: string[] = [];

  if (hasCreateToken) {
    // Same-sentence ability tails attached to create … token (skip pure counter clauses).
    const withTail = new RegExp(
      // A quoted ability may itself contain sentence punctuation, so consume quoted spans whole
      // instead of letting the first `.` end the tail.
      String.raw`\bcreates?\b[^.?\n]*?\btokens?(?:\s+named\s+(?:"[^"]+"|'[^']+'|[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*))?(?:\s+with\s+(?!\d+(?:\s+\+|\s+-)|a\s+(?:\+|-)|an\s+(?:\+|-)|one\s+(?:\+|-)|two\s+(?:\+|-)|three\s+(?:\+|-)|x\b)((?:"[^"]*"|(?!\band\s+create\b)[^.?\n(])*))`,
      'gi',
    );
    for (const match of source.matchAll(withTail)) {
      const segment = String(match[1] || '');
      const hasKeyword = CREATE_TOKEN_KEYWORD_LOOKUP.some((keyword) =>
        new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(segment),
      );
      const hasQuote = /"[^"]+"/.test(segment);
      if (/\bcounters?\b/i.test(segment) && !hasKeyword && !hasQuote) continue;
      collectCreateTokenKeywordsFromSegment(segment, out);
      collectQuotedAbilitiesFromSegment(segment, out);
    }

    // Token-type parentheticals: (It's an artifact with indestructible and "{T}: …")
    let i = 0;
    while (i < source.length) {
      if (source[i] === '(') {
        const closeIndex = findClosingParen(source, i);
        if (closeIndex >= 0) {
          const inner = source.slice(i + 1, closeIndex).trim();
          if (CREATE_TOKEN_TYPE_PAREN_INNER.test(inner)) {
            collectCreateTokenKeywordsFromSegment(inner, out);
            collectQuotedAbilitiesFromSegment(inner, out);
          }
          i = closeIndex + 1;
          continue;
        }
      }
      i += 1;
    }

    // Follow-up sentences after a create instruction.
    const followUp = new RegExp(
      String.raw`(\bcreate\b[^.?\n]*?\btokens?[^.?\n]*[.?]\s*)((?:(?:It(?:['\u2019]?s|\s+has|\s+is|\s+have)|They(?:['\u2019]?re|\s+have|\s+are|\s+has)|That\s+tokens?\s+(?:has|have|is|are)|Those\s+tokens\s+(?:have|are))\b[^.?\n]*[.?]?\s*)+)`,
      'gi',
    );
    for (const match of source.matchAll(followUp)) {
      collectCreateTokenKeywordsFromSegment(String(match[2] || ''), out);
      collectQuotedAbilitiesFromSegment(String(match[2] || ''), out);
    }
  }

  if (followUpOnly) {
    collectCreateTokenKeywordsFromSegment(source, out);
    collectQuotedAbilitiesFromSegment(source, out);
  }

  return out;
}

/** Build a synthetic ` with …` injection from extracted token abilities (for parse-time paren lift). */
function formatCreateTokenAbilityInjection(abilities: readonly string[]): string {
  const keywords: string[] = [];
  const quoted: string[] = [];
  for (const ability of abilities) {
    const normalized = String(ability || '').trim();
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    const plainKeyword = CREATE_TOKEN_KEYWORD_LOOKUP.find((keyword) => keyword === lower);
    if (plainKeyword) {
      if (!keywords.includes(plainKeyword)) keywords.push(plainKeyword);
      continue;
    }
    if (!quoted.some((entry) => entry.toLowerCase() === lower)) quoted.push(normalized);
  }
  const parts: string[] = [...keywords];
  for (const q of quoted) parts.push(`"${q}"`);
  if (parts.length === 0) return '';
  if (parts.length === 1) return ` with ${parts[0]}`;
  if (parts.length === 2) return ` with ${parts[0]} and ${parts[1]}`;
  return ` with ${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * Remove create-token granted ability text so token keywords/abilities are not
 * attributed to the creator permanent.
 *
 * Keeps the `create ... token(s) [named ...]` stem. Strips:
 * - token-type parentheticals (`(It's an artifact with ...)`)
 * - standard token-type reminder sentences (`stripTokenTypeReminders`)
 * - same-sentence ability tails after the stem:
 *   - `with <...>` through end of sentence (or until `and create`)
 *   - `that is/are/has/have <...>` through end of sentence (skips `that is/are a copy`)
 *
 * Only touches `with` / `that ...` when attached to a create-token clause in the
 * same sentence - unrelated lines like "creatures you control with flying" are kept.
 */
export function stripCreateTokenGrantedAbilities(text: string): string {
  let result = String(text || '');
  if (!result.trim()) return result;

  result = stripCreateTokenTypeParentheticals(result);
  result = stripTokenTypeReminders(result);

  // Stem: create ... token(s), optionally named "...", named Name, or multi-word Name.
  // Tail: with... / that has|have... / that is|are... (not "a copy") in the same sentence.
  const createTokenStem =
    String.raw`\b(create\b[^.?\n]*?\btokens?(?:\s+named\s+(?:"[^"]+"|'[^']+'|[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)*))?)`;
  const sameSentenceTail = String.raw`(?:(?!\band\s+create\b)[^.?\n])*`;

  const withTail = new RegExp(
    `${createTokenStem}(\\s+with\\b${sameSentenceTail})`,
    'gi',
  );
  const thatHasTail = new RegExp(
    `${createTokenStem}(\\s+that\\s+(?:has|have)\\b${sameSentenceTail})`,
    'gi',
  );
  const thatIsTail = new RegExp(
    `${createTokenStem}(\\s+that(?:\\s+is|\\s+are|'s)\\b(?!\\s+a\\s+copy\\b)${sameSentenceTail})`,
    'gi',
  );

  result = result.replace(withTail, '$1');
  result = result.replace(thatHasTail, '$1');
  result = result.replace(thatIsTail, '$1');

  // Follow-up sentence(s) right after a create-token instruction that define the
  // token(s): "Create a Soldier token. It has flying." / "They are indestructible."
  // / "That token has lifelink." Keep the create stem; drop only those referents.
  const followUpTokenAbility = new RegExp(
    String.raw`(\bcreate\b[^.?\n]*?\btokens?[^.?\n]*[.?]\s*)((?:(?:It(?:['\u2019]?s|\s+has|\s+is|\s+have)|They(?:['\u2019]?re|\s+have|\s+are|\s+has)|That\s+tokens?\s+(?:has|have|is|are)|Those\s+tokens\s+(?:have|are))\b[^.?\n]*[.?]?\s*)+)`,
    'gi',
  );
  result = result.replace(followUpTokenAbility, '$1');

  return result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
