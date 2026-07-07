import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORACLE_CARDS_JSONL = 'oracle-cards.jsonl';
export const ORACLE_CARDS_JSON = 'oracle-cards.json';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(moduleDir, '../../..');

export function getDefaultRepoRoot(): string {
  return defaultRepoRoot;
}

/** Resolve oracle corpus path: env override → jsonl → legacy json. */
export function resolveOracleCardsPath(repoRoot: string = defaultRepoRoot): string {
  const configured = String(process.env.CARD_LOOKUP_ORACLE_FILE || '').trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  const jsonlPath = path.join(repoRoot, ORACLE_CARDS_JSONL);
  if (fs.existsSync(jsonlPath)) return jsonlPath;
  return path.join(repoRoot, ORACLE_CARDS_JSON);
}

export function isOracleCardsJsonlPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.jsonl');
}

function looksLikeJsonl(raw: string): boolean {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('{') || trimmed.startsWith('[{')) return false;
  const newline = raw.indexOf('\n');
  if (newline === -1) return false;
  return raw.slice(newline + 1).trimStart().startsWith('{');
}

function parseOracleCardsJsonl(raw: string): unknown[] {
  const cards: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    cards.push(JSON.parse(trimmed));
  }
  return cards;
}

/** Parse oracle corpus bytes from either JSONL (Scryfall default) or legacy JSON array. */
export function parseOracleCardsContent(raw: string, filePath: string): unknown[] {
  if (isOracleCardsJsonlPath(filePath) || looksLikeJsonl(raw)) {
    return parseOracleCardsJsonl(raw);
  }
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.data)) return parsed.data;
  return [];
}

export function readOracleCardsSync(repoRoot: string = defaultRepoRoot): unknown[] {
  const filePath = resolveOracleCardsPath(repoRoot);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Oracle cards file not found at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseOracleCardsContent(raw, filePath);
}

export function tryReadOracleCardsSync(repoRoot: string = defaultRepoRoot): unknown[] {
  const filePath = resolveOracleCardsPath(repoRoot);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseOracleCardsContent(raw, filePath);
}

export async function readOracleCards(repoRoot: string = defaultRepoRoot): Promise<unknown[]> {
  const filePath = resolveOracleCardsPath(repoRoot);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Oracle cards file not found at ${filePath}`);
  }
  const raw = await readFile(filePath, 'utf8');
  return parseOracleCardsContent(raw, filePath);
}

/** Stream oracle cards without loading the full corpus into memory. */
export async function* iterateOracleCards(
  filePath: string,
): AsyncGenerator<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) return;

  if (isOracleCardsJsonlPath(filePath)) {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed) as Record<string, unknown>;
    }
    return;
  }

  const cards = parseOracleCardsContent(fs.readFileSync(filePath, 'utf8'), filePath);
  for (const card of cards) {
    yield card as Record<string, unknown>;
  }
}

export function getOracleCardNamesFromCards(cards: Iterable<{ name?: string }>): string[] {
  const names = new Set<string>();
  for (const card of cards) {
    const name = String(card?.name || '').trim();
    if (name) names.add(name);
  }
  return [...names].sort((left, right) => right.length - left.length);
}

export function getOracleCardNames(repoRoot: string = defaultRepoRoot): string[] {
  return getOracleCardNamesFromCards(tryReadOracleCardsSync(repoRoot) as Array<{ name?: string }>);
}
