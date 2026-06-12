import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecklist, type ParsedLine } from './scryfall.js';

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
