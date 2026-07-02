/**
 * Oracle vocabulary word frequencies from oracle-cards.json (or card-lookup.sqlite).
 *
 * Counts words in oracle_text (+ card face oracle text), deduped by oracle_id,
 * with card name phrases stripped before tokenization.
 *
 * Usage (from server/):
 *   npx tsx scripts/oracle-word-frequency.ts
 *   npx tsx scripts/oracle-word-frequency.ts --source=sqlite
 *   npx tsx scripts/oracle-word-frequency.ts --top=100
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const oracleCardsPath = path.join(repoRoot, 'oracle-cards.json');
const sqlitePath = path.join(repoRoot, 'server', 'data', 'card-lookup.sqlite');
const outDir = path.join(scriptDir, 'out');
const outJsonPath = path.join(outDir, 'oracle-word-frequencies.json');
const outCsvPath = path.join(outDir, 'oracle-word-frequencies.csv');

type CardFace = {
  name?: string;
  oracle_text?: string;
};

type OracleCard = {
  oracle_id?: string;
  name?: string;
  layout?: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: CardFace[];
};

type OracleEntry = {
  oracleId: string;
  names: string[];
  oracleTexts: string[];
};

function parseArgs() {
  const args = process.argv.slice(2);
  let source: 'json' | 'sqlite' = 'json';
  let top = 50;
  for (const arg of args) {
    if (arg.startsWith('--source=')) {
      const value = arg.slice('--source='.length).trim().toLowerCase();
      if (value === 'sqlite' || value === 'json') source = value;
    } else if (arg.startsWith('--top=')) {
      top = Math.max(1, Number(arg.slice('--top='.length)) || 50);
    }
  }
  return { source, top };
}

function normalizeNameKey(name: string): string {
  return String(name || '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldIncludeCard(card: OracleCard): boolean {
  if (card.layout === 'art_series') return false;
  if (card.layout === 'token' && String(card.type_line || '').toLowerCase().includes('checklist')) {
    return false;
  }
  return true;
}

function collectNamesFromCard(card: OracleCard): string[] {
  const names = new Set<string>();
  const push = (raw: string | undefined) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;
    names.add(trimmed);
    for (const part of trimmed.split(/\s*\/\/\s*/)) {
      const faceName = part.trim();
      if (faceName) names.add(faceName);
    }
  };

  push(card.name);
  for (const face of card.card_faces || []) {
    push(face?.name);
  }

  return Array.from(names);
}

function collectOracleTextsFromCard(card: OracleCard): string[] {
  const texts = new Set<string>();
  const push = (raw: string | undefined) => {
    const trimmed = String(raw || '').trim();
    if (trimmed) texts.add(trimmed);
  };

  push(card.oracle_text);
  for (const face of card.card_faces || []) {
    push(face?.oracle_text);
  }

  return Array.from(texts);
}

function loadEntriesFromJson(): OracleEntry[] {
  if (!fs.existsSync(oracleCardsPath)) {
    throw new Error(`oracle-cards.json not found at ${oracleCardsPath}`);
  }

  console.log(`Reading ${oracleCardsPath} ...`);
  const raw = fs.readFileSync(oracleCardsPath, 'utf8');
  const cards = JSON.parse(raw) as OracleCard[];
  if (!Array.isArray(cards)) {
    throw new Error('oracle-cards.json must be a JSON array');
  }

  const byOracleId = new Map<string, OracleEntry>();

  for (const card of cards) {
    if (!shouldIncludeCard(card)) continue;
    const oracleId = String(card.oracle_id || card.name || '').trim();
    if (!oracleId) continue;

    let entry = byOracleId.get(oracleId);
    if (!entry) {
      entry = { oracleId, names: [], oracleTexts: [] };
      byOracleId.set(oracleId, entry);
    }

    for (const name of collectNamesFromCard(card)) {
      if (!entry.names.includes(name)) entry.names.push(name);
    }
    for (const text of collectOracleTextsFromCard(card)) {
      if (!entry.oracleTexts.includes(text)) entry.oracleTexts.push(text);
    }
  }

  return Array.from(byOracleId.values());
}

function loadEntriesFromSqlite(): OracleEntry[] {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`card-lookup.sqlite not found at ${sqlitePath}`);
  }

  console.log(`Reading ${sqlitePath} ...`);
  const db = new Database(sqlitePath, { readonly: true });
  const rows = db.prepare('SELECT payload FROM card_lookup').all() as Array<{ payload: string }>;
  db.close();

  const byOracleId = new Map<string, OracleEntry>();

  for (const row of rows) {
    if (!row?.payload) continue;
    let card: OracleCard;
    try {
      card = JSON.parse(row.payload) as OracleCard;
    } catch {
      continue;
    }
    if (!shouldIncludeCard(card)) continue;

    const oracleId = String((card as any).oracle_id || card.name || '').trim();
    if (!oracleId) continue;

    let entry = byOracleId.get(oracleId);
    if (!entry) {
      entry = { oracleId, names: [], oracleTexts: [] };
      byOracleId.set(oracleId, entry);
    }

    for (const name of collectNamesFromCard(card)) {
      if (!entry.names.includes(name)) entry.names.push(name);
    }
    for (const text of collectOracleTextsFromCard(card)) {
      if (!entry.oracleTexts.includes(text)) entry.oracleTexts.push(text);
    }
  }

  return Array.from(byOracleId.values());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildNameStripIndex(allNames: Iterable<string>) {
  const normalized = new Set<string>();
  for (const name of allNames) {
    const key = normalizeNameKey(name);
    if (key.length >= 2) normalized.add(key);
  }

  const sortedNames = Array.from(normalized).sort((left, right) => right.length - left.length);
  const namesByWord = new Map<string, Set<string>>();

  for (const name of sortedNames) {
    for (const word of name.split(/\s+/)) {
      if (word.length < 2) continue;
      let bucket = namesByWord.get(word);
      if (!bucket) {
        bucket = new Set<string>();
        namesByWord.set(word, bucket);
      }
      bucket.add(name);
    }
  }

  return { sortedNames, namesByWord };
}

function stripCardNames(text: string, index: ReturnType<typeof buildNameStripIndex>): string {
  const lower = String(text || '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase();

  const candidateNames = new Set<string>();
  for (const match of lower.matchAll(/\b[a-z][a-z0-9']*\b/g)) {
    const bucket = index.namesByWord.get(match[0]);
    if (!bucket) continue;
    for (const name of bucket) candidateNames.add(name);
  }

  if (candidateNames.size === 0) return text;

  const orderedCandidates = Array.from(candidateNames).sort((left, right) => right.length - left.length);
  let out = lower;
  for (const name of orderedCandidates) {
    const pattern = new RegExp(`\\b${escapeRegExp(name).replace(/\s+/g, '\\s+')}\\b`, 'g');
    out = out.replace(pattern, ' ');
  }
  return out;
}

function tokenize(text: string): string[] {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/[^a-z0-9'\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens: string[] = [];
  for (const match of normalized.matchAll(/\b[a-z][a-z0-9']*\b/g)) {
    const word = match[0];
    if (word) tokens.push(word);
  }
  return tokens;
}

function main() {
  const { source, top } = parseArgs();
  const entries = source === 'sqlite' ? loadEntriesFromSqlite() : loadEntriesFromJson();

  const allNames = new Set<string>();
  for (const entry of entries) {
    for (const name of entry.names) allNames.add(name);
  }

  const nameStripIndex = buildNameStripIndex(allNames);
  const wordCounts = new Map<string, number>();

  let oracleTextBlocks = 0;
  let totalTokens = 0;

  console.log(`Tokenizing ${entries.length} oracle entries ...`);
  for (const entry of entries) {
    for (const text of entry.oracleTexts) {
      oracleTextBlocks += 1;
      const stripped = stripCardNames(text, nameStripIndex);
      for (const token of tokenize(stripped)) {
        totalTokens += 1;
        wordCounts.set(token, (wordCounts.get(token) || 0) + 1);
      }
    }
  }

  const sorted = Array.from(wordCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([word, count]) => ({ word, count }));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outJsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source,
    uniqueOracleIds: entries.length,
    uniqueCardNames: allNames.size,
    oracleTextBlocks,
    uniqueWords: sorted.length,
    totalTokens,
    words: sorted,
  }, null, 2));

  const csvLines = ['word,count', ...sorted.map(({ word, count }) => `${word},${count}`)];
  fs.writeFileSync(outCsvPath, csvLines.join('\n'), 'utf8');

  console.log(`Wrote ${outJsonPath}`);
  console.log(`Wrote ${outCsvPath}`);
  console.log(`Unique oracle IDs: ${entries.length}`);
  console.log(`Unique card names stripped: ${allNames.size}`);
  console.log(`Oracle text blocks: ${oracleTextBlocks}`);
  console.log(`Unique words: ${sorted.length}`);
  console.log(`Total tokens: ${totalTokens}`);
  console.log(`Top ${top} words:`);
  for (const row of sorted.slice(0, top)) {
    console.log(`  ${row.word}\t${row.count}`);
  }
}

main();
