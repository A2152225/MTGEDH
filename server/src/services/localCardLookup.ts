import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import type { ScryfallCardInput } from '../../../shared/src/cardFactory.js';

import { normalizeName } from './scryfall.js';
import { debug, debugWarn } from '../utils/debug.js';

type DB = Database.Database;

export type LocalCardLookupSource = 'oracle-cards' | 'AtomicCards';

export interface LocalCardLookupRecord extends ScryfallCardInput {
  legalities?: Record<string, string>;
  source: LocalCardLookupSource;
}

export interface LocalCardLookupStatus {
  phase: 'checking' | 'building' | 'ready';
  message: string;
}

export interface LocalCardLookupOptions {
  onStatus?: (status: LocalCardLookupStatus) => void;
}

export interface CardNameChoiceCriteria {
  restrictionText: string;
  requiredTerms: string[];
  excludedTerms: string[];
  allowedTypeAlternatives?: string[][];
}

type StoredCandidate = {
  payload: LocalCardLookupRecord;
  quality: number;
  sourcePriority: number;
};

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serviceDir, '../../..');
const schemaVersion = '1';
const defaultDbFile = path.join(repoRoot, 'server', 'data', 'card-lookup.sqlite');

let db: DB | null = null;
let dbFilePath: string | null = null;
let ensurePromise: Promise<void> | null = null;

function emitStatus(options: LocalCardLookupOptions | undefined, status: LocalCardLookupStatus): void {
  options?.onStatus?.(status);
}

function normalizeLookupName(name: string): string {
  return normalizeName(name).toLowerCase();
}

function normalizeChoiceText(text: string): string {
  return String(text || '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );
}

function parseRestrictionTerms(phrase: string): CardNameChoiceCriteria {
  const normalizedPhrase = normalizeChoiceText(phrase);
  const requiredTerms = new Set<string>();
  const excludedTerms = new Set<string>();
  const knownTerms = [
    'artifact',
    'battle',
    'basic',
    'creature',
    'enchantment',
    'instant',
    'kindred',
    'land',
    'legendary',
    'planeswalker',
    'snow',
    'sorcery',
    'tribal',
  ];

  for (const term of knownTerms) {
    if (new RegExp(`\\bnon${term}\\b`).test(normalizedPhrase)) {
      excludedTerms.add(term);
    }
  }

  const allowedTypeAlternatives = normalizedPhrase.includes(' or ')
    ? normalizedPhrase
        .split(/\bor\b/)
        .map((segment) => {
          const segmentTerms = knownTerms.filter((term) => new RegExp(`\\b${term}\\b`).test(segment));
          return uniqueSorted(segmentTerms);
        })
        .filter((segmentTerms) => segmentTerms.length > 0)
    : undefined;

  if (allowedTypeAlternatives && allowedTypeAlternatives.length > 0) {
    for (const term of ['legendary', 'basic', 'snow']) {
      if (new RegExp(`\\b${term}\\b`).test(normalizedPhrase)) {
        requiredTerms.add(term);
      }
    }
  } else {
    for (const term of knownTerms) {
      if (excludedTerms.has(term)) continue;
      if (new RegExp(`\\b${term}\\b`).test(normalizedPhrase)) {
        requiredTerms.add(term);
      }
    }
  }

  const restrictionText = normalizedPhrase ? `${normalizedPhrase} card` : 'card';
  return {
    restrictionText,
    requiredTerms: uniqueSorted(requiredTerms),
    excludedTerms: uniqueSorted(excludedTerms),
    ...(allowedTypeAlternatives && allowedTypeAlternatives.length > 0
      ? { allowedTypeAlternatives }
      : {}),
  };
}

export function parseCardNameChoiceCriteriaFromOracleText(oracleText: string): CardNameChoiceCriteria {
  const normalizedOracle = normalizeChoiceText(oracleText);
  const explicitCardRestriction = normalizedOracle.match(
    /(?:name|choose)\s+(?:a|an)\s+((?:[^.;,\n]+?)\s+)?card(?:\s+name)?/
  );
  const restrictionPhrase = String(explicitCardRestriction?.[1] || '').trim();
  return parseRestrictionTerms(restrictionPhrase);
}

type CardNameCandidate = {
  name: string;
  typeLine: string;
};

function getCardNameCandidatesFromRecord(record: LocalCardLookupRecord): CardNameCandidate[] {
  const candidates: CardNameCandidate[] = [];

  if (record.name) {
    candidates.push({ name: record.name, typeLine: String(record.type_line || '') });
  }

  if (Array.isArray(record.card_faces)) {
    for (const face of record.card_faces) {
      if (!face?.name) continue;
      candidates.push({
        name: face.name,
        typeLine: String(face.type_line || record.type_line || ''),
      });
    }
  }

  return candidates;
}

function matchesCardNameChoiceCriteria(typeLine: string, criteria: CardNameChoiceCriteria): boolean {
  const normalizedTypeLine = normalizeChoiceText(typeLine);

  for (const excludedTerm of criteria.excludedTerms) {
    if (new RegExp(`\\b${excludedTerm}\\b`).test(normalizedTypeLine)) {
      return false;
    }
  }

  for (const requiredTerm of criteria.requiredTerms) {
    if (!new RegExp(`\\b${requiredTerm}\\b`).test(normalizedTypeLine)) {
      return false;
    }
  }

  if (criteria.allowedTypeAlternatives && criteria.allowedTypeAlternatives.length > 0) {
    const matchesAlternative = criteria.allowedTypeAlternatives.some((alternativeTerms) =>
      alternativeTerms.some((term) => new RegExp(`\\b${term}\\b`).test(normalizedTypeLine))
    );
    if (!matchesAlternative) {
      return false;
    }
  }

  return true;
}

function resolveOracleCardsPath(): string {
  const configured = String(process.env.CARD_LOOKUP_ORACLE_FILE || '').trim();
  return configured
    ? (path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured))
    : path.join(repoRoot, 'oracle-cards.json');
}

function resolveAtomicCardsPath(): string {
  const configured = String(process.env.CARD_LOOKUP_ATOMIC_FILE || '').trim();
  return configured
    ? (path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured))
    : path.join(repoRoot, 'AtomicCards.json');
}

function resolveLookupDbFile(): string {
  const configured = String(process.env.CARD_LOOKUP_SQLITE_FILE || '').trim();
  if (!configured) return defaultDbFile;
  if (configured === ':memory:') return configured;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function getSourceSignature(filePath: string): string {
  if (!fs.existsSync(filePath)) return 'missing';
  const stat = fs.statSync(filePath);
  return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
}

function getDatabase(): DB {
  const resolvedDbFile = resolveLookupDbFile();

  if (db && dbFilePath === resolvedDbFile) {
    return db;
  }

  if (db && dbFilePath !== resolvedDbFile) {
    try {
      (db as any).close?.();
    } catch {
      // ignore close failures during path swaps
    }
    db = null;
    dbFilePath = null;
  }

  if (resolvedDbFile !== ':memory:') {
    const dir = path.dirname(resolvedDbFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedDbFile);
  dbFilePath = resolvedDbFile;
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_lookup (
      normalized_name TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      source TEXT NOT NULL,
      quality INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_lookup_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS card_lookup_source_idx ON card_lookup(source);
  `);

  return db;
}

function readMetaValue(database: DB, key: string): string | null {
  const row = database.prepare('SELECT value FROM card_lookup_meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function isLookupCurrent(database: DB): boolean {
  return readMetaValue(database, 'ready') === '1'
    && readMetaValue(database, 'schema_version') === schemaVersion
    && readMetaValue(database, 'oracle_signature') === getSourceSignature(resolveOracleCardsPath())
    && readMetaValue(database, 'atomic_signature') === getSourceSignature(resolveAtomicCardsPath());
}

function candidateQuality(card: LocalCardLookupRecord): number {
  return Number(Boolean(card.oracle_text))
    + Number(Boolean(card.image_uris?.normal || card.image_uris?.small))
    + Number(Boolean(card.card_faces?.length));
}

function pickBetterCandidate(existing: StoredCandidate | undefined, candidate: StoredCandidate): StoredCandidate {
  if (!existing) return candidate;
  if (candidate.quality !== existing.quality) {
    return candidate.quality > existing.quality ? candidate : existing;
  }
  return candidate.sourcePriority < existing.sourcePriority ? candidate : existing;
}

function indexAlias(aliasMap: Map<string, StoredCandidate>, alias: string | undefined, payload: LocalCardLookupRecord, sourcePriority: number): void {
  const normalized = normalizeLookupName(String(alias || ''));
  if (!normalized) return;
  const candidate: StoredCandidate = {
    payload,
    quality: candidateQuality(payload),
    sourcePriority,
  };
  aliasMap.set(normalized, pickBetterCandidate(aliasMap.get(normalized), candidate));
}

function toOracleRecord(raw: any): LocalCardLookupRecord | null {
  const name = String(raw?.name || raw?.asciiName || '').trim();
  if (!name) return null;

  return {
    id: String(raw?.id || raw?.oracle_id || raw?.oracleId || raw?.uuid || `oracle:${normalizeLookupName(name)}`),
    name,
    oracle_id: raw?.oracle_id,
    cmc: typeof raw?.cmc === 'number' ? raw.cmc : (typeof raw?.manaValue === 'number' ? raw.manaValue : undefined),
    mana_cost: raw?.mana_cost ?? raw?.manaCost,
    type_line: raw?.type_line ?? raw?.type,
    oracle_text: raw?.oracle_text ?? raw?.text,
    image_uris: raw?.image_uris,
    legalities: raw?.legalities,
    power: raw?.power,
    toughness: raw?.toughness,
    loyalty: raw?.loyalty,
    layout: raw?.layout,
    colors: raw?.colors,
    card_faces: Array.isArray(raw?.card_faces)
      ? raw.card_faces.map((face: any) => ({
          name: face?.name,
          mana_cost: face?.mana_cost,
          type_line: face?.type_line,
          oracle_text: face?.oracle_text,
          image_uris: face?.image_uris,
          power: face?.power,
          toughness: face?.toughness,
          loyalty: face?.loyalty,
        }))
      : undefined,
    source: 'oracle-cards',
  };
}

function pickBestAtomicPrinting(printings: any[]): any {
  if (!Array.isArray(printings) || printings.length === 0) return undefined;
  return printings.find((printing) => typeof printing?.text === 'string' && printing.text.trim().length > 0) || printings[0];
}

function toAtomicRecord(name: string, rawPrinting: any): LocalCardLookupRecord | null {
  const displayName = String(rawPrinting?.name || name || '').trim();
  if (!displayName) return null;

  const scryfallId = String(rawPrinting?.identifiers?.scryfallId || '');
  const imageUris = scryfallId
    ? {
        small: `https://cards.scryfall.io/small/front/${scryfallId.slice(0, 1)}/${scryfallId.slice(1, 2)}/${scryfallId}.jpg`,
      }
    : undefined;

  return {
    id: String(rawPrinting?.identifiers?.scryfallId || rawPrinting?.uuid || `atomic:${normalizeLookupName(displayName)}`),
    name: displayName,
    oracle_id: rawPrinting?.identifiers?.scryfallOracleId,
    cmc: typeof rawPrinting?.convertedManaCost === 'number' ? rawPrinting.convertedManaCost : rawPrinting?.manaValue,
    mana_cost: rawPrinting?.manaCost,
    type_line: rawPrinting?.type,
    oracle_text: rawPrinting?.text,
    image_uris: imageUris,
    legalities: rawPrinting?.legalities,
    power: rawPrinting?.power,
    toughness: rawPrinting?.toughness,
    loyalty: rawPrinting?.loyalty,
    layout: rawPrinting?.layout,
    colors: Array.isArray(rawPrinting?.colors) ? rawPrinting.colors : undefined,
    source: 'AtomicCards',
  };
}

async function buildLookupMap(options?: LocalCardLookupOptions): Promise<Map<string, StoredCandidate>> {
  const aliasMap = new Map<string, StoredCandidate>();
  const oracleCardsPath = resolveOracleCardsPath();
  const atomicCardsPath = resolveAtomicCardsPath();

  if (fs.existsSync(oracleCardsPath)) {
    emitStatus(options, { phase: 'building', message: `Reading oracle-cards index source from ${oracleCardsPath}` });
    const raw = await readFile(oracleCardsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const cards = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
    for (const entry of cards) {
      const card = toOracleRecord(entry);
      if (!card) continue;
      indexAlias(aliasMap, card.name, card, 1);
      indexAlias(aliasMap, entry?.asciiName, card, 1);
      if (Array.isArray(card.card_faces)) {
        for (const face of card.card_faces) {
          indexAlias(aliasMap, face?.name, card, 1);
        }
      }
    }
  } else {
    debugWarn(1, `[card-lookup] oracle-cards.json not found at ${oracleCardsPath}`);
  }

  if (fs.existsSync(atomicCardsPath)) {
    emitStatus(options, { phase: 'building', message: `Reading AtomicCards index source from ${atomicCardsPath}` });
    const raw = await readFile(atomicCardsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const data = parsed?.data;
    if (data && typeof data === 'object') {
      for (const [name, printings] of Object.entries(data)) {
        const bestPrinting = pickBestAtomicPrinting(printings as any[]);
        const card = toAtomicRecord(name, bestPrinting);
        if (!card) continue;
        indexAlias(aliasMap, name, card, 2);
        indexAlias(aliasMap, bestPrinting?.asciiName, card, 2);
      }
    } else {
      debugWarn(1, '[card-lookup] AtomicCards.json did not have the expected data object');
    }
  } else {
    debugWarn(1, `[card-lookup] AtomicCards.json not found at ${atomicCardsPath}`);
  }

  return aliasMap;
}

function buildLookupMapSync(options?: LocalCardLookupOptions): Map<string, StoredCandidate> {
  const aliasMap = new Map<string, StoredCandidate>();
  const oracleCardsPath = resolveOracleCardsPath();
  const atomicCardsPath = resolveAtomicCardsPath();

  if (fs.existsSync(oracleCardsPath)) {
    emitStatus(options, { phase: 'building', message: `Reading oracle-cards index source from ${oracleCardsPath}` });
    const raw = fs.readFileSync(oracleCardsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const cards = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
    for (const entry of cards) {
      const card = toOracleRecord(entry);
      if (!card) continue;
      indexAlias(aliasMap, card.name, card, 1);
      indexAlias(aliasMap, entry?.asciiName, card, 1);
      if (Array.isArray(card.card_faces)) {
        for (const face of card.card_faces) {
          indexAlias(aliasMap, face?.name, card, 1);
        }
      }
    }
  } else {
    debugWarn(1, `[card-lookup] oracle-cards.json not found at ${oracleCardsPath}`);
  }

  if (fs.existsSync(atomicCardsPath)) {
    emitStatus(options, { phase: 'building', message: `Reading AtomicCards index source from ${atomicCardsPath}` });
    const raw = fs.readFileSync(atomicCardsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const data = parsed?.data;
    if (data && typeof data === 'object') {
      for (const [name, printings] of Object.entries(data)) {
        const bestPrinting = pickBestAtomicPrinting(printings as any[]);
        const card = toAtomicRecord(name, bestPrinting);
        if (!card) continue;
        indexAlias(aliasMap, name, card, 2);
        indexAlias(aliasMap, bestPrinting?.asciiName, card, 2);
      }
    } else {
      debugWarn(1, '[card-lookup] AtomicCards.json did not have the expected data object');
    }
  } else {
    debugWarn(1, `[card-lookup] AtomicCards.json not found at ${atomicCardsPath}`);
  }

  return aliasMap;
}

async function rebuildLookupIndex(database: DB, options?: LocalCardLookupOptions): Promise<void> {
  const aliasMap = await buildLookupMap(options);
  const insertRow = database.prepare(
    'INSERT INTO card_lookup (normalized_name, payload, source, quality, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertMeta = database.prepare('INSERT INTO card_lookup_meta (key, value) VALUES (?, ?)');
  const now = Date.now();

  emitStatus(options, { phase: 'building', message: `Writing ${aliasMap.size} local card lookup rows to ${resolveLookupDbFile()}` });

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM card_lookup').run();
    database.prepare('DELETE FROM card_lookup_meta').run();

    for (const [normalizedName, candidate] of aliasMap.entries()) {
      insertRow.run(normalizedName, JSON.stringify(candidate.payload), candidate.payload.source, candidate.quality, now);
    }

    insertMeta.run('ready', '1');
    insertMeta.run('schema_version', schemaVersion);
    insertMeta.run('oracle_signature', getSourceSignature(resolveOracleCardsPath()));
    insertMeta.run('atomic_signature', getSourceSignature(resolveAtomicCardsPath()));
    insertMeta.run('built_at', String(now));
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    throw error;
  }

  debug(1, `[card-lookup] Built lookup table with ${aliasMap.size} aliases`);
}

function rebuildLookupIndexSync(database: DB, options?: LocalCardLookupOptions): void {
  const aliasMap = buildLookupMapSync(options);
  const insertRow = database.prepare(
    'INSERT INTO card_lookup (normalized_name, payload, source, quality, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertMeta = database.prepare('INSERT INTO card_lookup_meta (key, value) VALUES (?, ?)');
  const now = Date.now();

  emitStatus(options, { phase: 'building', message: `Writing ${aliasMap.size} local card lookup rows to ${resolveLookupDbFile()}` });

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM card_lookup').run();
    database.prepare('DELETE FROM card_lookup_meta').run();

    for (const [normalizedName, candidate] of aliasMap.entries()) {
      insertRow.run(normalizedName, JSON.stringify(candidate.payload), candidate.payload.source, candidate.quality, now);
    }

    insertMeta.run('ready', '1');
    insertMeta.run('schema_version', schemaVersion);
    insertMeta.run('oracle_signature', getSourceSignature(resolveOracleCardsPath()));
    insertMeta.run('atomic_signature', getSourceSignature(resolveAtomicCardsPath()));
    insertMeta.run('built_at', String(now));
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    throw error;
  }

  debug(1, `[card-lookup] Built lookup table with ${aliasMap.size} aliases`);
}

export async function ensureLocalCardLookupIndex(options: LocalCardLookupOptions = {}): Promise<void> {
  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = (async () => {
    const database = getDatabase();
    emitStatus(options, { phase: 'checking', message: 'Checking local card lookup table' });

    if (isLookupCurrent(database)) {
      emitStatus(options, { phase: 'ready', message: 'Local card lookup table is ready' });
      return;
    }

    emitStatus(options, { phase: 'building', message: 'Building local card lookup table from oracle-cards.json and AtomicCards.json' });
    await rebuildLookupIndex(database, options);
    emitStatus(options, { phase: 'ready', message: 'Local card lookup table is ready' });
  })().catch((error) => {
    debugWarn(1, '[card-lookup] Failed to ensure local card lookup table', error);
    throw error;
  }).finally(() => {
    ensurePromise = null;
  });

  return ensurePromise;
}

export function ensureLocalCardLookupIndexSync(options: LocalCardLookupOptions = {}): void {
  const database = getDatabase();
  emitStatus(options, { phase: 'checking', message: 'Checking local card lookup table' });

  if (isLookupCurrent(database)) {
    emitStatus(options, { phase: 'ready', message: 'Local card lookup table is ready' });
    return;
  }

  emitStatus(options, { phase: 'building', message: 'Building local card lookup table from oracle-cards.json and AtomicCards.json' });
  rebuildLookupIndexSync(database, options);
  emitStatus(options, { phase: 'ready', message: 'Local card lookup table is ready' });
}

export async function lookupLocalCards(names: string[], options: LocalCardLookupOptions = {}): Promise<Map<string, LocalCardLookupRecord>> {
  await ensureLocalCardLookupIndex(options);

  const database = getDatabase();
  const lookup = database.prepare('SELECT payload FROM card_lookup WHERE normalized_name = ?');
  const result = new Map<string, LocalCardLookupRecord>();

  for (const normalizedName of new Set(names.map((name) => normalizeLookupName(name)))) {
    const row = lookup.get(normalizedName) as { payload: string } | undefined;
    if (!row?.payload) continue;
    try {
      result.set(normalizedName, JSON.parse(row.payload));
    } catch (error) {
      debugWarn(1, `[card-lookup] Failed to parse lookup payload for ${normalizedName}`, error);
    }
  }

  return result;
}

export async function listLocalCardNamesForChoice(
  criteria: CardNameChoiceCriteria,
  options: LocalCardLookupOptions = {}
): Promise<string[]> {
  await ensureLocalCardLookupIndex(options);

  const database = getDatabase();
  const rows = database.prepare('SELECT DISTINCT payload FROM card_lookup').all() as Array<{ payload: string }>;
  const candidateNames = new Set<string>();

  for (const row of rows) {
    if (!row?.payload) continue;
    try {
      const record = JSON.parse(row.payload) as LocalCardLookupRecord;
      for (const candidate of getCardNameCandidatesFromRecord(record)) {
        if (!candidate.name) continue;
        if (!matchesCardNameChoiceCriteria(candidate.typeLine, criteria)) continue;
        candidateNames.add(candidate.name);
      }
    } catch (error) {
      debugWarn(1, '[card-lookup] Failed to parse payload while listing card-name candidates', error);
    }
  }

  return Array.from(candidateNames).sort((left, right) => left.localeCompare(right));
}

export function listLocalCardNamesForChoiceSync(
  criteria: CardNameChoiceCriteria,
  options: LocalCardLookupOptions = {}
): string[] {
  ensureLocalCardLookupIndexSync(options);

  const database = getDatabase();
  const rows = database.prepare('SELECT DISTINCT payload FROM card_lookup').all() as Array<{ payload: string }>;
  const candidateNames = new Set<string>();

  for (const row of rows) {
    if (!row?.payload) continue;
    try {
      const record = JSON.parse(row.payload) as LocalCardLookupRecord;
      for (const candidate of getCardNameCandidatesFromRecord(record)) {
        if (!candidate.name) continue;
        if (!matchesCardNameChoiceCriteria(candidate.typeLine, criteria)) continue;
        candidateNames.add(candidate.name);
      }
    } catch (error) {
      debugWarn(1, '[card-lookup] Failed to parse payload while listing card-name candidates', error);
    }
  }

  return Array.from(candidateNames).sort((left, right) => left.localeCompare(right));
}

export function resetLocalCardLookupForTests(): void {
  ensurePromise = null;
  if (db) {
    try {
      (db as any).close?.();
    } catch {
      // ignore test cleanup failures
    }
  }
  db = null;
  dbFilePath = null;
}