import { getPreconWizardsAnnouncementUrl } from '../data/preconWizardsUrls.js';
import { getOracleCardNames } from './oracleCardsIndex.js';
import { normalizeName, type ParsedLine, SCRYFALL_USER_AGENT } from './scryfall.js';
import { parseWizardsRunOnDecklist } from './bundledPreconDecklists.js';
import { debug, debugWarn } from '../utils/debug.js';

let oracleCardNamesCache: string[] | null = null;
const announcementPageCache = new Map<string, string>();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CROSSOVER_THEME_SUFFIXES = [
  'The Fantastic Four',
  'Avengers',
  'Villains',
  'Wakanda',
  // Lorwyn Eclipsed precon reprints use plane-name suffixes (not parentheticals).
  'Shadowmoor',
  'Lorwyn',
] as const;

/** Strip parenthetical theme labels, e.g. `Sol Ring (Avengers)` → `Sol Ring`. */
export function stripParentheticalFromCardName(name: string): string {
  return String(name || '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize Wizards crossover reprint names to oracle names. */
export function normalizeWizardsPreconCardName(name: string): string {
  let result = stripParentheticalFromCardName(name);
  for (const suffix of CROSSOVER_THEME_SUFFIXES) {
    const trailing = new RegExp(`\\s+${escapeRegex(suffix)}$`, 'i');
    result = result.replace(trailing, '').trim();
  }
  return result;
}

function stripWizardsDecklistThemeParentheticals(text: string): string {
  let result = String(text || '')
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const suffix of CROSSOVER_THEME_SUFFIXES) {
    result = result.replace(new RegExp(`\\s+${escapeRegex(suffix)}(?=\\s|$)`, 'gi'), ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

function mergeParsedLines(lines: ParsedLine[]): ParsedLine[] {
  const merged = new Map<string, ParsedLine>();
  for (const line of lines) {
    const name = normalizeWizardsPreconCardName(String(line.name || '').trim());
    if (!name) continue;
    const count = Math.max(1, Number(line.count) || 1);
    const existing = merged.get(name.toLowerCase());
    if (existing) {
      existing.count += count;
    } else {
      merged.set(name.toLowerCase(), { name, count });
    }
  }
  return [...merged.values()];
}

function getOracleCardNamesForTokenizer(): string[] {
  if (oracleCardNamesCache) return oracleCardNamesCache;
  oracleCardNamesCache = getOracleCardNames();
  return oracleCardNamesCache;
}

export function tokenizeRunOnCardNames(text: string, knownCardNames: readonly string[]): ParsedLine[] {
  let remaining = normalizeName(String(text || '').trim());
  if (!remaining) return [];

  const lines: ParsedLine[] = [];
  while (remaining.length > 0) {
    remaining = remaining.trim();
    if (!remaining) break;

    const countMatch = remaining.match(/^(\d+)\s+(.+)$/);
    const count = countMatch ? Math.max(1, Number.parseInt(countMatch[1], 10) || 1) : 1;
    const body = countMatch ? countMatch[2] : remaining;

    let matchedName: string | null = null;
    const bodyLower = body.toLowerCase();
    for (const name of knownCardNames) {
      const normalized = normalizeName(name);
      const normalizedLower = normalized.toLowerCase();
      if (!bodyLower.startsWith(normalizedLower)) continue;
      const nextChar = body[normalized.length];
      if (nextChar !== undefined && nextChar !== ' ') continue;
      matchedName = normalized;
      remaining = body.slice(normalized.length).trim();
      break;
    }

    if (!matchedName) {
      debugWarn(2, `[wizardsPreconDecklists] could not tokenize remainder: "${body.slice(0, 80)}"`);
      break;
    }

    lines.push({ name: normalizeWizardsPreconCardName(matchedName), count });
  }

  return mergeParsedLines(lines);
}

export function parseWizardsDecklistLine(text: string, knownCardNames?: readonly string[]): ParsedLine[] {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [];

  const hasBrackets = /\[[^\]]+\]/.test(cleaned);
  if (!hasBrackets && /^\d+\s+/.test(cleaned)) {
    const counted = parseWizardsRunOnDecklist(cleaned);
    if (counted.length > 0) {
      return mergeParsedLines(counted);
    }
  }

  const withoutBrackets = stripWizardsDecklistThemeParentheticals(
    cleaned.replace(/\s*\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim(),
  );
  const countedAfterStrip = parseWizardsRunOnDecklist(withoutBrackets);
  if (countedAfterStrip.length >= 50) {
    return mergeParsedLines(countedAfterStrip);
  }

  const names = knownCardNames ?? getOracleCardNamesForTokenizer();
  const tokenized = tokenizeRunOnCardNames(withoutBrackets, names);
  if (tokenized.length > 0) {
    return tokenized;
  }

  return mergeParsedLines(countedAfterStrip);
}

function dedupeRepeatedCardName(name: string): string {
  const trimmed = String(name || '').trim();
  const duplicate = trimmed.match(/^(.+?)\s+\1$/);
  return duplicate ? duplicate[1].trim() : trimmed;
}

function splitBracketGapCards(gap: string): ParsedLine[] {
  const trimmed = String(gap || '').trim();
  if (!trimmed) return [];

  const commaLed = trimmed
    .split(/\s+(?=[A-Z][A-Za-z'/-]+,)/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks = commaLed.length > 1 ? commaLed : [trimmed];

  const lines: ParsedLine[] = [];
  for (const chunk of chunks) {
    lines.push(...parseGapCards(chunk));
  }
  return mergeParsedLines(lines);
}

function truncateDecklistTail(text: string): string {
  const stopAt = text.search(/Cowabunga!|You can view all the cards|\*\*Tokens\*\*|\bTokens\b:/i);
  return stopAt > 0 ? text.slice(0, stopAt).trim() : text.trim();
}

function parseGapCards(gap: string): ParsedLine[] {
  const trimmed = String(gap || '').trim();
  if (!trimmed) return [];
  if (/^\d+\s+/.test(trimmed)) {
    const counted = parseWizardsRunOnDecklist(trimmed);
    if (counted.length > 0) return counted;
  }
  const tokenized = tokenizeRunOnCardNamesWithUnknowns(trimmed, getOracleCardNamesForTokenizer());
  if (tokenized.length > 0) return tokenized;
  return [{ name: trimmed, count: 1 }];
}

function tokenizeRunOnCardNamesWithUnknowns(text: string, knownCardNames: readonly string[]): ParsedLine[] {
  let remaining = normalizeName(String(text || '').trim());
  if (!remaining) return [];

  const lines: ParsedLine[] = [];
  while (remaining.length > 0) {
    remaining = remaining.trim();
    if (!remaining) break;

    const countMatch = remaining.match(/^(\d+)\s+(.+)$/s);
    const count = countMatch ? Math.max(1, Number.parseInt(countMatch[1], 10) || 1) : 1;
    const body = countMatch ? countMatch[2] : remaining;

    let matchedName: string | null = null;
    const bodyLower = body.toLowerCase();
    for (const name of knownCardNames) {
      const normalized = normalizeName(name);
      const normalizedLower = normalized.toLowerCase();
      if (!bodyLower.startsWith(normalizedLower)) continue;
      const nextChar = body[normalized.length];
      if (nextChar !== undefined && nextChar !== ' ') continue;
      matchedName = normalized;
      remaining = body.slice(normalized.length).trim();
      break;
    }

    if (!matchedName) {
      let earliestIndex = -1;
      for (const name of knownCardNames) {
        const normalized = normalizeName(name);
        const idx = body.toLowerCase().indexOf(normalized.toLowerCase());
        if (idx <= 0) continue;
        if (earliestIndex < 0 || idx < earliestIndex) earliestIndex = idx;
      }

      if (earliestIndex > 0) {
        matchedName = body.slice(0, earliestIndex).trim();
        remaining = body.slice(earliestIndex).trim();
      } else {
        matchedName = body.trim();
        remaining = '';
      }
    }

    if (!matchedName) break;
    lines.push({ name: normalizeWizardsPreconCardName(matchedName), count });
  }

  return mergeParsedLines(lines);
}

/** Wizards deck text with Scryfall-style bracket ids between card names (FIN, TMNT, etc.). */
export function parseWizardsBracketIdDecklist(text: string): ParsedLine[] {
  const cleaned = truncateDecklistTail(
    String(text || '')
      .replace(/\d{3,4}_MTG[A-Za-z0-9_]+:\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (!cleaned) return [];

  const lines: ParsedLine[] = [];
  let remaining = cleaned;
  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    const bracketAt = remaining.search(/\s*\[/);
    if (bracketAt < 0) {
      lines.push(...parseGapCards(remaining));
      break;
    }

    const beforeBracket = remaining.slice(0, bracketAt).trim();
    if (beforeBracket) {
      const countMatch = beforeBracket.match(/^(\d+)\s+(.+)$/);
      if (countMatch) {
        lines.push({
          name: normalizeWizardsPreconCardName(dedupeRepeatedCardName(countMatch[2])),
          count: Math.max(1, Number.parseInt(countMatch[1], 10) || 1),
        });
      } else if (beforeBracket.length > 60) {
        lines.push(...splitBracketGapCards(beforeBracket));
      } else {
        lines.push({ name: normalizeWizardsPreconCardName(dedupeRepeatedCardName(beforeBracket)), count: 1 });
      }
    }

    const afterBracketStart = remaining.slice(bracketAt);
    const idMatch = afterBracketStart.match(/^\s*\[([^\]]+)\]\s*/);
    if (!idMatch) break;
    remaining = afterBracketStart.slice(idMatch[0].length);
  }

  return mergeParsedLines(lines);
}

function extractGathererEmbeddedFromHtml(html: string): string {
  const chunks: string[] = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    if (match[1].includes('deck_count') && match[1].includes('title')) {
      chunks.push(match[1]);
    }
  }
  return chunks.join('\n');
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|li|tr|td|th|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function isDeckCardLine(line: string): boolean {
  if (!line || line.length < 2) return false;
  if (line.length > 90) return false;
  if (/^You can view/i.test(line)) return false;
  if (/^\d{3,4}_MTG/.test(line)) return false;
  if (/_MTG.*:/i.test(line)) return false;
  if (/ are traditional foil/i.test(line)) return false;
  if (/^\(Back\)$/i.test(line)) return false;
  if (/^\d+x\s+/i.test(line)) return false;
  if (/ token$/i.test(line)) return false;
  if (/^Tokens$/i.test(line)) return false;
  if (/^#{1,3}\s/.test(line)) return false;
  if (/^Skip to main content$/i.test(line)) return false;
  if (/^Cue the victory/i.test(line)) return false;
  if (/^© /i.test(line)) return false;
  if (/^Announcements$/i.test(line)) return false;
  if (/ releases worldwide/i.test(line)) return false;
  if (/magic.wizards.com/i.test(line)) return false;
  if (/^Preorder products/i.test(line)) return false;
  if (/^Each Magic:/i.test(line)) return false;
  if (/^Double-sided tokens/i.test(line)) return false;
  return true;
}

export function extractWizardsDecklistSection(content: string, deckName: string): string[] {
  const escapedName = escapeRegex(deckName.trim());
  const headingRe = new RegExp(`(?:^|\\n)\\s*(?:#{1,3}\\s*)?${escapedName}(?:\\s|\\(|$)`, 'gi');
  const matches = [...content.matchAll(headingRe)];
  if (matches.length === 0) return [];

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const afterHeading = content.slice(start);
    const tokensRe = new RegExp(`\\n\\s*(?:#{1,3}\\s*)?${escapedName}\\s+Tokens\\b`, 'i');
    const tokensMatch = afterHeading.match(tokensRe);
    if (!tokensMatch?.index || tokensMatch.index <= 0) continue;

    const section = afterHeading.slice(0, tokensMatch.index);
    const lines = section
      .split('\n')
      .map((line) => line.trim())
      .filter(isDeckCardLine);
    if (lines.length >= 50) {
      return lines;
    }
  }

  return [];
}

function findWizardsDeckSection(content: string, deckName: string): string | null {
  const escapedName = escapeRegex(deckName.trim());
  const startPatterns = [
    new RegExp(`(?:\\\\u003Ch1\\\\u003E|<h1>|#\\s+)\\s*${escapedName}\\b`, 'i'),
    new RegExp(`${escapedName}\\s+Decklist\\b`, 'i'),
  ];

  let startMatch: RegExpExecArray | null = null;
  for (const pattern of startPatterns) {
    const match = pattern.exec(content);
    if (match?.index !== undefined) {
      startMatch = match;
      break;
    }
  }
  if (!startMatch?.index && startMatch?.index !== 0) return null;

  const afterStart = content.slice(startMatch.index + startMatch[0].length);
  const nextPattern = new RegExp(
    `(?:\\\\u003Ch1\\\\u003E|<h1>|\\n#\\s+)(?!\\s*${escapedName}\\b)[^\\n<]{2,120}\\b|[A-Z][\\w'’,-]+(?: [A-Z][\\w'’,-]+){0,4}\\s+Decklist\\b`,
    'i',
  );
  const nextMatch = nextPattern.exec(afterStart);
  const sectionEnd = startMatch.index + startMatch[0].length + (nextMatch?.index ?? afterStart.length);
  return content.slice(startMatch.index, sectionEnd);
}

export function parseWizardsGathererEmbeddedDeck(content: string, deckName: string): ParsedLine[] {
  const section = findWizardsDeckSection(content, deckName);
  if (!section) return [];

  const normalizedSection = section.replace(/\\"/g, '"');

  const parsed: ParsedLine[] = [];
  const cardRe =
    /s:5:"title";s:\d+:"((?:\\.|[^"\\])*)";s:22:"field_card_image_front"[\s\S]*?s:10:"deck_count";s:\d+:"(\d+)"/g;
  let cardMatch: RegExpExecArray | null;
  while ((cardMatch = cardRe.exec(normalizedSection)) !== null) {
    const name = cardMatch[1].replace(/\\"/g, '"').trim();
    const count = Math.max(1, Number.parseInt(cardMatch[2], 10) || 1);
    if (name) parsed.push({ name, count });
  }
  return mergeParsedLines(parsed);
}

export function extractWizardsCategoryRunOnDeckBlock(content: string, deckName: string): string | null {
  const escapedName = escapeRegex(deckName.trim());
  const startMatch = new RegExp(`${escapedName}\\s+Decklist`, 'i').exec(content);
  if (!startMatch?.index && startMatch?.index !== 0) return null;

  const afterHeading = content.slice(startMatch.index + startMatch[0].length);
  const cardStart = afterHeading.search(
    /(?:Creature|Sorcery|Instant|Artifact|Enchantment|Land|Planeswalker|Battle)\s*\(\d+\)\s*1\s+/i,
  );
  if (cardStart < 0) return null;

  const cardBody = afterHeading.slice(cardStart);
  const endMatch = cardBody.search(/\s[A-Z][\w'’,-]+(?: [A-Z][\w'’,-]+){0,4}\s+Decklist\b/);
  const section = endMatch > 0 ? cardBody.slice(0, endMatch) : cardBody.slice(0, 12000);

  return section
    .replace(
      /(?:Creature|Sorcery|Instant|Artifact|Enchantment|Land|Planeswalker|Battle)\s*\(\d+\)\s*/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractWizardsRunOnDeckBlock(content: string, deckName: string): string | null {
  const escapedName = escapeRegex(deckName.trim());
  const headingRe = new RegExp(`(?:^|\\n)#\\s+${escapedName}\\b`, 'i');
  const match = headingRe.exec(content);
  if (!match) return null;

  const afterHeading = content.slice(match.index + match[0].length);
  const sectionEndMatch = afterHeading.match(/\n---\n|\n#\s+[A-Za-z]/);
  const section = sectionEndMatch?.index
    ? afterHeading.slice(0, sectionEndMatch.index)
    : afterHeading.slice(0, 6000);

  const candidates = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 120 && /\d+\s+[A-Za-z0-9'’,]/.test(line))
    .filter((line) => !/^You can view/i.test(line))
    .filter((line) => !/^Check out/i.test(line))
    .filter((line) => !/^Editor/i.test(line))
    .filter((line) => !/^Learn more/i.test(line));

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function parseWizardsDecklistFromAnnouncement(content: string, deckName: string): ParsedLine[] | null {
  const singleDeckLines = extractWizardsSingleDeckCommanderLines(content, deckName);
  if (singleDeckLines && singleDeckLines.length >= 50) {
    const parsed = filterDeckNameBleed(parseWizardsDecklistSection(singleDeckLines), deckName);
    if (parsed.length >= 50) return parsed;
  }

  const singleDeckPage = extractWizardsSingleDeckCommanderPage(content, deckName);
  if (singleDeckPage) {
    const parsed = filterDeckNameBleed(singleDeckPage, deckName);
    if (parsed.length >= 50) return parsed;
  }

  const cardLines = extractWizardsDecklistSection(content, deckName);
  if (cardLines.length > 0) {
    const parsed = parseWizardsDecklistSection(cardLines);
    if (parsed.length >= 50) return parsed;
  }

  const embedded = parseWizardsGathererEmbeddedDeck(content, deckName);
  if (embedded.length >= 50) return embedded;

  const categoryRunOn = extractWizardsCategoryRunOnDeckBlock(content, deckName);
  if (categoryRunOn) {
    const parsed = parseWizardsDecklistLine(categoryRunOn);
    if (parsed.length >= 50) return parsed;
  }

  const runOnBlock = extractWizardsRunOnDeckBlock(content, deckName);
  if (runOnBlock) {
    const parsed = parseWizardsDecklistLine(runOnBlock);
    if (parsed.length >= 50) return parsed;
  }

  const deckLine = extractWizardsDecklistLine(content, deckName);
  if (deckLine) {
    const parsed = parseWizardsDecklistLine(deckLine);
    if (parsed.length >= 50) return parsed;
  }

  return null;
}

export function parseWizardsDecklistSection(lines: string[]): ParsedLine[] {
  const parsed: ParsedLine[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
    const countMatch = line.match(/^(\d+)\s+(.+)$/);
    if (countMatch) {
      parsed.push({
        name: normalizeWizardsPreconCardName(countMatch[2].trim()),
        count: Math.max(1, Number.parseInt(countMatch[1], 10) || 1),
      });
      continue;
    }
    if (line) {
      parsed.push({ name: normalizeWizardsPreconCardName(line), count: 1 });
    }
  }
  return mergeParsedLines(parsed);
}

function filterDeckNameBleed(textOrLines: string | ParsedLine[], deckName: string): ParsedLine[] {
  const bleed = deckName.trim();
  if (!bleed) {
    return typeof textOrLines === 'string' ? [] : textOrLines;
  }

  if (typeof textOrLines === 'string') {
    const escaped = escapeRegex(bleed);
    const withoutBleed = textOrLines
      .replace(new RegExp(`\\d+\\s+${escaped}\\b`, 'gi'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const bracketIds = (withoutBleed.match(/\[[^\]]+\]/g) || []).length;
    if (bracketIds >= 8) {
      return parseWizardsBracketIdDecklist(withoutBleed);
    }
    return parseWizardsDecklistLine(withoutBleed);
  }

  const bleedLower = bleed.toLowerCase();
  return textOrLines.filter((line) => String(line.name || '').trim().toLowerCase() !== bleedLower);
}

/** Prefer explicit end-of-deck markers; ignore early blank lines that would truncate too soon. */
function findSingleDeckCommanderSectionEnd(afterHeading: string): number {
  const endPatterns = [
    /Cowabunga!/i,
    /_Secret Lair/i,
    /Secret Lair Commander Deck:/i,
    /This deck's strategy/i,
    /\*\*Tokens\*\*/i,
    /\bTokens\b:/i,
    /You can view all the cards/i,
    /This deck's face commander/i,
    /\*\*Contents\*\*/i,
    /Card Name\s+Set Code/i,
    /\bContents\b:/i,
    /Price:/i,
    /was designed by/i,
  ];
  for (const pattern of endPatterns) {
    const match = pattern.exec(afterHeading);
    if (match?.index !== undefined && match.index > 80) return match.index;
  }
  return Math.min(afterHeading.length, 8000);
}

function getSingleDeckCommanderAfterHeading(content: string, deckName: string): string | null {
  const escapedName = escapeRegex(deckName.trim());
  const headingRe = new RegExp(`${escapedName}\\s+Commander Decklist`, 'i');
  const match = headingRe.exec(content);
  if (!match?.index && match?.index !== 0) return null;
  return content.slice(match.index + match[0].length).trim();
}

/**
 * Line-oriented extraction for single-deck Wizards pages (e.g. TMNT).
 * Keeps cards that lack Scryfall bracket ids from being glued into neighboring names.
 */
export function extractWizardsSingleDeckCommanderLines(
  content: string,
  deckName: string,
): string[] | null {
  const afterHeading = getSingleDeckCommanderAfterHeading(content, deckName);
  if (!afterHeading) return null;

  const section = afterHeading.slice(0, findSingleDeckCommanderSectionEnd(afterHeading));
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Drop showcase image rows (0001_MTGTMT_CmdrFace: …) entirely.
    .filter((line) => !/^\d{3,4}_MTG[A-Za-z0-9_]+:/i.test(line))
    .map((line) => line.replace(/\s*\[[^\]]+\]\s*$/, '').trim())
    .filter(isDeckCardLine);

  if (lines.length < 50 || !lines.some((line) => /\bSol Ring\b/i.test(line))) return null;
  return lines;
}

export function extractWizardsSingleDeckCommanderPage(content: string, deckName: string): string | null {
  const afterHeading = getSingleDeckCommanderAfterHeading(content, deckName);
  if (!afterHeading) return null;

  const section = afterHeading.slice(0, findSingleDeckCommanderSectionEnd(afterHeading));

  const trimmed = section
    .replace(/^\d{3,4}_MTG[A-Za-z0-9_]+:\s*.*$/gim, ' ')
    .replace(/\d{3,4}_MTG[A-Za-z0-9_]+:\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed.length < 120 || !/\bSol Ring\b/i.test(trimmed)) return null;
  return trimmed;
}

export function extractWizardsDecklistLine(content: string, deckName: string): string | null {
  const singleDeckPage = extractWizardsSingleDeckCommanderPage(content, deckName);
  if (singleDeckPage) return singleDeckPage;

  const sectionLines = extractWizardsDecklistSection(content, deckName);
  if (sectionLines.length > 0) {
    return sectionLines.join(' ');
  }

  const normalizedContent = String(content || '');
  const escapedName = escapeRegex(deckName.trim());
  const headingMatch = normalizedContent.match(
    new RegExp(`#{1,3}\\s*${escapedName}(?:\\s|\\(|$)`, 'i'),
  );
  if (!headingMatch || headingMatch.index === undefined) return null;

  const sectionStart = headingMatch.index;
  const afterHeading = normalizedContent.slice(sectionStart);
  const tokensMatch = afterHeading.match(/\n(?:#{1,3}\s*.+Tokens|[^\n]*\bTokens\b)/i);
  const sectionEnd = tokensMatch?.index && tokensMatch.index > 0 ? tokensMatch.index : afterHeading.length;
  const section = afterHeading.slice(0, sectionEnd);

  const candidates = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.length < 120) return false;
      if (line.startsWith('#')) return false;
      if (/^You can view/i.test(line)) return false;
      if (/^\d{4}_MTG/.test(line)) return false;
      if (/^\(Back\)/i.test(line)) return false;
      return true;
    });

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

export async function fetchWizardsPreconDecklist(
  setCode: string | undefined,
  deckName: string,
  announcementUrl?: string,
): Promise<ParsedLine[] | null> {
  const url = announcementUrl || getPreconWizardsAnnouncementUrl(setCode, deckName);
  if (!url) return null;

  let content = announcementPageCache.get(url);
  if (!content) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': SCRYFALL_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
      },
    });
    const html = await response.text();
    if (!response.ok) {
      debugWarn(1, `[wizardsPreconDecklists] page error ${response.status}: ${url}`);
      return null;
    }
    const embedded = extractGathererEmbeddedFromHtml(html);
    content = `${htmlToText(html)}\n${embedded}`;
    announcementPageCache.set(url, content);
  }

  const parsed = parseWizardsDecklistFromAnnouncement(content, deckName);
  if (parsed && parsed.length > 0) {
    debug(1, `[wizardsPreconDecklists] parsed ${parsed.length} unique cards for "${deckName}" (${setCode || 'unknown'})`);
    return parsed;
  }

  debugWarn(1, `[wizardsPreconDecklists] no decklist found for "${deckName}" at ${url}`);
  return null;
}
