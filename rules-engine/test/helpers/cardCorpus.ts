/**
 * Card corpus access for rules-engine tests.
 *
 * Reads the prebuilt local lookup database (`server/data/card-lookup.sqlite`) directly instead of
 * going through `localCardLookup.ts`. That module revalidates the index against the raw
 * `oracle-cards.jsonl` / `AtomicCards.json` sources and rebuilds when they are absent, which is not
 * something a test should trigger. Opening the database read-only keeps tests fast and side-effect
 * free.
 *
 * Cards missing from the database fall back to the Scryfall API. Callers get the list of names that
 * could not be resolved from either source so a failing test can name them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOOKUP_DB_PATH = path.join(repoRoot, 'server', 'data', 'card-lookup.sqlite');

export interface CorpusCard {
  readonly name: string;
  readonly oracle_text?: string;
  readonly type_line?: string;
  readonly mana_cost?: string;
  readonly cmc?: number;
  readonly power?: string;
  readonly toughness?: string;
  readonly loyalty?: string;
  readonly colors?: readonly string[];
  readonly color_identity?: readonly string[];
  readonly keywords?: readonly string[];
  readonly layout?: string;
  readonly card_faces?: readonly any[];
  readonly id?: string;
}

export interface CorpusLookupResult {
  /** Resolved cards keyed by normalized name. */
  readonly cards: Map<string, CorpusCard>;
  /** Names that resolved from neither the local database nor Scryfall. */
  readonly missing: readonly string[];
}

/** Matches `normalizeName` in `server/src/services/scryfall.ts`, then lowercases. */
export function normalizeCorpusName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\u2019/g, "'")
    .replace(/\s+\/\/\s+/g, ' // ')
    .toLowerCase();
}

export function hasLocalCardCorpus(): boolean {
  return fs.existsSync(LOOKUP_DB_PATH);
}

let cachedDb: Database.Database | null | undefined;

function openCorpusDb(): Database.Database | null {
  if (cachedDb !== undefined) return cachedDb;
  if (!hasLocalCardCorpus()) {
    cachedDb = null;
    return null;
  }
  try {
    cachedDb = new Database(LOOKUP_DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    cachedDb = null;
  }
  return cachedDb;
}

function lookupLocal(names: readonly string[]): { cards: Map<string, CorpusCard>; missing: string[] } {
  const cards = new Map<string, CorpusCard>();
  const missing: string[] = [];
  const db = openCorpusDb();
  if (!db) return { cards, missing: [...names] };

  const statement = db.prepare('SELECT payload FROM card_lookup WHERE normalized_name = ?');
  for (const name of names) {
    const normalized = normalizeCorpusName(name);
    if (!normalized) continue;
    const row = statement.get(normalized) as { payload?: string } | undefined;
    if (!row?.payload) {
      missing.push(name);
      continue;
    }
    try {
      cards.set(normalized, JSON.parse(row.payload) as CorpusCard);
    } catch {
      missing.push(name);
    }
  }
  return { cards, missing };
}

/** Local-only lookup for callers that cannot await (no Scryfall fallback). */
export function lookupCorpusCardsSync(names: readonly string[]): CorpusLookupResult {
  return lookupLocal(names);
}

async function lookupScryfall(names: readonly string[]): Promise<{ cards: Map<string, CorpusCard>; missing: string[] }> {
  const cards = new Map<string, CorpusCard>();
  const missing: string[] = [];

  for (const name of names) {
    try {
      const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
      if (!response.ok) {
        missing.push(name);
        continue;
      }
      const card = (await response.json()) as CorpusCard;
      cards.set(normalizeCorpusName(card?.name || name), card);
    } catch {
      missing.push(name);
    }
    // Scryfall asks for ~100ms between requests.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { cards, missing };
}

/**
 * Resolve cards from the local lookup database, falling back to Scryfall for anything absent.
 * Set `allowNetwork: false` to keep a test fully offline.
 */
export async function lookupCorpusCards(
  names: readonly string[],
  options: { allowNetwork?: boolean } = {}
): Promise<CorpusLookupResult> {
  const { allowNetwork = true } = options;
  const local = lookupLocal(names);
  if (local.missing.length === 0 || !allowNetwork) {
    return { cards: local.cards, missing: local.missing };
  }

  const remote = await lookupScryfall(local.missing);
  for (const [normalized, card] of remote.cards) local.cards.set(normalized, card);
  return { cards: local.cards, missing: remote.missing };
}

/** Convenience wrapper for a single card. Throws naming the card when it cannot be resolved. */
export async function requireCorpusCard(name: string): Promise<CorpusCard> {
  const { cards, missing } = await lookupCorpusCards([name]);
  const card = cards.get(normalizeCorpusName(name));
  if (!card) {
    throw new Error(`Card not found in local corpus or Scryfall: ${missing.join(', ') || name}`);
  }
  return card;
}
