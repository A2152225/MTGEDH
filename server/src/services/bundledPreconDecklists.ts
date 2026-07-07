import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecklist, type ParsedLine } from './scryfall.js';
import { getPreconDecklistLines as getPreconDecklistLinesFromDb } from './preconDecklistStore.js';
import { normalizeWizardsPreconCardName } from './wizardsPreconDecklists.js';

const DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/precon-decklists',
);

const cache = new Map<string, Record<string, string>>();

function loadSetDecklists(setCode: string): Record<string, string> | null {
  const key = String(setCode || '').trim().toUpperCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const filePath = path.join(DATA_DIR, `${key}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, string>;
    cache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Wizards run-on deck text uses "1 Card Name" tokens separated by spaces. */
export function parseWizardsRunOnDecklist(text: string): ParsedLine[] {
  const normalized = String(text || '').trim();
  if (!normalized) return [];

  const parts = normalized.split(/\s+(?=\d+\s+)/).map((part) => part.trim()).filter(Boolean);
  const lines: ParsedLine[] = [];

  for (const part of parts) {
    const match = part.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    lines.push({
      count: Math.max(1, Number.parseInt(match[1], 10) || 1),
      name: match[2].trim(),
    });
  }

  return lines;
}

function normalizePreconDeckLines(lines: ParsedLine[]): ParsedLine[] {
  const merged = new Map<string, ParsedLine>();
  for (const line of lines) {
    const name = normalizeWizardsPreconCardName(String(line.name || '').trim());
    if (!name) continue;
    const count = Math.max(1, Number(line.count) || 1);
    const key = name.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.count += count;
    } else {
      merged.set(key, { name, count });
    }
  }
  return [...merged.values()];
}

/** Primary lookup: SQLite precon database, then legacy JSON bundles. */
export function getPreconDecklistLines(setCode: string, deckName: string): ParsedLine[] | null {
  const fromDb = getPreconDecklistLinesFromDb(setCode, deckName);
  if (fromDb && fromDb.length > 0) return normalizePreconDeckLines(fromDb);
  const fromJson = getBundledPreconDecklistLines(setCode, deckName);
  return fromJson ? normalizePreconDeckLines(fromJson) : null;
}

export function getBundledPreconDecklistLines(setCode: string, deckName: string): ParsedLine[] | null {
  const setDecks = loadSetDecklists(setCode);
  if (!setDecks) return null;

  const raw = setDecks[String(deckName || '').trim()];
  if (!raw) return null;

  const parsed = parseWizardsRunOnDecklist(raw);
  if (parsed.length === 0) {
    return parseDecklist(raw);
  }
  return parsed;
}
