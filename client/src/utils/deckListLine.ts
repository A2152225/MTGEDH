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

/** Extract a card name from a single decklist line, or null if not a card line. */
export function parseCardNameFromDeckLine(rawLine: string): string | null {
  const raw = rawLine.trim();
  if (shouldSkipDeckLine(raw)) return null;

  let name = '';
  const mPrefix = raw.match(/^(\d+)x?\s+(.+)$/i);
  if (mPrefix) {
    name = mPrefix[2];
  } else {
    const mSuffix = raw.match(/^(.*)\s+x(\d+)$/i);
    if (mSuffix) {
      name = mSuffix[1];
    } else {
      name = raw;
    }
  }

  name = normalizeName(stripSetCollectorNumber(name));
  return name || null;
}

/** Ordered unique card names from a full decklist (first occurrence wins for order). */
export function extractCardNamesFromDeckText(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const name = parseCardNameFromDeckLine(line);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Line containing the caret (0-based offset into `text`). */
export function getLineAtCaret(text: string, caret: number): string {
  const safe = Math.max(0, Math.min(caret, text.length));
  const start = text.lastIndexOf('\n', safe - 1) + 1;
  let end = text.indexOf('\n', safe);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}
