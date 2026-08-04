/**
 * Lightweight deck-line parsing for live resolve preview in the deck builder.
 * Mirrors the important bits of server parseDecklist / shouldSkipDeckLine.
 */

export function shouldSkipDeckLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^(SB:|SIDEBOARD|\/\/|#)/i.test(trimmed)) return true;
  if (/^(DECK|COMMANDER|MAINBOARD|MAYBEBOARD|CONSIDERING)$/i.test(trimmed)) return true;
  return false;
}

function normalizeName(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/’/g, "'")
    .replace(/\s+\/\/\s+/g, ' // ');
}

function stripSetCollectorNumber(name: string): string {
  let result = name;
  result = result.replace(/\s+\([A-Za-z0-9][A-Za-z0-9 ]{0,14}\)\s+\d+[A-Za-z]?$/i, '');
  result = result.replace(/\s+\([A-Za-z0-9]{2,10}:\d+[A-Za-z]?\)$/i, '');
  result = result.replace(/\s+\d+[A-Za-z]?\s+\([A-Za-z0-9]{2,10}\)$/i, '');
  result = result.replace(/\s+\([A-Za-z0-9]{2,10}\)$/i, '');
  result = result.replace(/\s+\d{1,4}[A-Za-z]?$/, '');
  return result.trim();
}

export type DeckLineEntry = { name: string; count: number };

/** Parse a single decklist line into name + quantity, or null if not a card line. */
export function parseDeckLineEntry(rawLine: string): DeckLineEntry | null {
  const raw = rawLine.trim();
  if (shouldSkipDeckLine(raw)) return null;

  let name = '';
  let count = 1;
  const mPrefix = raw.match(/^(\d+)x?\s+(.+)$/i);
  if (mPrefix) {
    count = Math.max(1, parseInt(mPrefix[1], 10) || 1);
    name = mPrefix[2];
  } else {
    const mSuffix = raw.match(/^(.*)\s+x(\d+)$/i);
    if (mSuffix) {
      name = mSuffix[1];
      count = Math.max(1, parseInt(mSuffix[2], 10) || 1);
    } else {
      name = raw;
      count = 1;
    }
  }

  name = normalizeName(stripSetCollectorNumber(name));
  if (!name) return null;
  return { name, count };
}

/** Extract a card name from a single decklist line, or null if not a card line. */
export function parseCardNameFromDeckLine(rawLine: string): string | null {
  return parseDeckLineEntry(rawLine)?.name ?? null;
}

export type DeckTextLine = {
  lineNumber: number;
  raw: string;
  name: string | null;
  count: number;
};

/** Every physical line with 1-based line numbers; card lines include name/count. */
export function enumerateDeckTextLines(text: string): DeckTextLine[] {
  const lines = text.length === 0 ? [''] : text.split(/\r?\n/);
  return lines.map((raw, index) => {
    const entry = parseDeckLineEntry(raw);
    return {
      lineNumber: index + 1,
      raw,
      name: entry?.name ?? null,
      count: entry?.count ?? 0,
    };
  });
}

/** Ordered unique card names from a full decklist (first occurrence wins for order). */
export function extractCardNamesFromDeckText(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of enumerateDeckTextLines(text)) {
    if (!line.name) continue;
    const key = line.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(line.name);
  }
  return names;
}

/** Aggregate quantities by normalized card name (preserves first-seen order). */
export function aggregateDeckCardQuantities(text: string): Array<{ name: string; count: number }> {
  const order: string[] = [];
  const counts = new Map<string, { name: string; count: number }>();
  for (const line of enumerateDeckTextLines(text)) {
    if (!line.name) continue;
    const key = line.name.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.count += line.count;
    } else {
      const row = { name: line.name, count: line.count };
      counts.set(key, row);
      order.push(key);
    }
  }
  return order.map((key) => counts.get(key)!);
}

/** Line containing the caret (0-based offset into `text`). */
export function getLineAtCaret(text: string, caret: number): string {
  const safe = Math.max(0, Math.min(caret, text.length));
  const start = text.lastIndexOf('\n', safe - 1) + 1;
  let end = text.indexOf('\n', safe);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

/** 1-based line number containing the caret. */
export function getLineNumberAtCaret(text: string, caret: number): number {
  const safe = Math.max(0, Math.min(caret, text.length));
  let line = 1;
  for (let i = 0; i < safe; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}
