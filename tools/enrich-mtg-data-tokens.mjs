#!/usr/bin/env node
// Enriches the standalone query database (mtg_data.db, built from AtomicCards by
// MigrateAtomicToSql.py) with the two things AtomicCards does not carry: token entries, and the
// card <-> token creation relationship.
//
// AtomicCards has no tokens at all, so token rows are sourced from oracle-cards.jsonl (Scryfall).
// 87 token names collide with real card names (Spirit, Hydra, Dragon Egg, ...) because those
// tokens are token copies of real cards, so `cards` is rebuilt with a composite (name, is_token)
// primary key. Queries for real cards should filter `is_token = 0`.
//
// The relationship is stored as a card_tokens edge table rather than JSON columns: Treasure alone
// has ~372 creators, which would be an unindexable multi-kilobyte blob on the token row.
//
// Re-runnable: token rows and card_tokens are rebuilt from scratch on every run.
//
// Usage: node tools/enrich-mtg-data-tokens.mjs [--db path] [--jsonl path] [--no-backup]

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import Database from 'better-sqlite3';

const argv = process.argv.slice(2);
function argValue(flag, fallback) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const dbPath = path.resolve(argValue('--db', 'mtg_data.db'));
const jsonlPath = path.resolve(argValue('--jsonl', 'oracle-cards.jsonl'));
const skipBackup = argv.includes('--no-backup');

for (const [label, target] of [
  ['database', dbPath],
  ['oracle corpus', jsonlPath],
]) {
  if (!fs.existsSync(target)) {
    console.error(`Missing ${label}: ${target}`);
    process.exit(1);
  }
}

// Matches the Python json.dumps default separator already used by every array column in the table.
function toJsonArray(values) {
  return `[${(values || []).map((value) => JSON.stringify(String(value))).join(', ')}]`;
}

const SUPERTYPES = new Set(['Basic', 'Legendary', 'Ongoing', 'Snow', 'World', 'Elite', 'Host']);

function splitTypeLine(typeLine) {
  const cleaned = String(typeLine || '').replace(/^Token\s+/i, '').trim();
  const [left, right] = cleaned.split(/\s+[—–-]\s+/);
  const leftWords = String(left || '')
    .split(/\s+/)
    .filter(Boolean);
  const supertypes = leftWords.filter((word) => SUPERTYPES.has(word));
  const types = leftWords.filter((word) => !SUPERTYPES.has(word));
  const subtypes = String(right || '')
    .split(/\s+/)
    .filter(Boolean);
  return { supertypes, types, subtypes };
}

function faceValue(entry, field) {
  if (entry[field] !== undefined && entry[field] !== null) return entry[field];
  const face = (entry.card_faces || [])[0];
  return face ? face[field] : undefined;
}

function isTokenTypeLine(typeLine) {
  return /^\s*Token\b/i.test(String(typeLine || ''));
}

// Layout alone is not enough: Role tokens ship as layout "flip", so they look like ordinary cards
// until you read the type line.
function entryIsToken(entry) {
  const layout = String(entry.layout || '');
  if (layout === 'token' || layout === 'double_faced_token') return true;
  if (isTokenTypeLine(entry.type_line)) return true;
  return (entry.card_faces || []).some((face) => isTokenTypeLine(face.type_line));
}

// Multi-face tokens get a row for the combined name (so all_parts edges, which reference
// "Wicked // Cursed", resolve) plus a row per face (so the individual token is findable).
function tokenRowsFor(entry) {
  const faces = entry.card_faces || [];
  if (!faces.length) return [{ name: String(entry.name || '').trim(), view: entry }];

  const rows = [{ name: String(entry.name || '').trim(), view: entry }];
  for (const face of faces) {
    if (!isTokenTypeLine(face.type_line)) continue;
    const faceName = String(face.name || '').trim();
    if (!faceName) continue;
    rows.push({ name: faceName, view: face });
    // Cards say "create a Wicked Role token", but Scryfall names that face just "Wicked".
    const { subtypes } = splitTypeLine(face.type_line);
    if (subtypes.includes('Role') && !/\bRole$/i.test(faceName)) {
      rows.push({ name: `${faceName} Role`, view: face });
    }
  }
  return rows;
}

// A token name can appear once per printing; keep the entry carrying the most rules text so the
// row is the most informative version available.
function tokenRichness(row) {
  return String(row.view?.oracle_text || '').length;
}

async function readCorpus() {
  const rl = readline.createInterface({
    input: fs.createReadStream(jsonlPath, 'utf8'),
    crlfDelay: Infinity,
  });

  const tokens = new Map();
  const edges = new Map();
  const faceAliases = new Map();
  const cardTexts = new Map();
  let scanned = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    scanned += 1;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const name = String(entry.name || '').trim();
    const layout = String(entry.layout || '');
    if (!name || layout === 'art_series') continue;

    const typeLine = String(entry.type_line || faceValue(entry, 'type_line') || '');
    const isToken = entryIsToken(entry);
    if (isToken && /checklist/i.test(typeLine)) continue;

    if (isToken) {
      const rows = tokenRowsFor(entry);
      for (const row of rows) {
        if (!row.name) continue;
        const existing = tokens.get(row.name);
        if (!existing || tokenRichness(row) > tokenRichness(existing)) tokens.set(row.name, { ...row, entry });
      }
      const aliases = faceAliases.get(name) || new Set();
      for (const row of rows) if (row.name && row.name !== name) aliases.add(row.name);
      if (aliases.size) faceAliases.set(name, aliases);
      continue;
    }

    for (const part of entry.all_parts || []) {
      if (String(part.component || '') !== 'token') continue;
      const tokenName = String(part.name || '').trim();
      if (!tokenName) continue;
      if (!edges.has(name)) edges.set(name, new Set());
      edges.get(name).add(tokenName);
      cardTexts.set(name, String(faceValue(entry, 'oracle_text') || ''));
    }
  }

  // all_parts references a two-faced token by its combined name ("Wicked // Cursed"), but a card
  // creates one specific face. Pin the face by looking for its name in the card's own rules text,
  // so "what creates a Wicked Role" is answerable without fanning out to both faces.
  let pinned = 0;
  for (const [cardName, tokenNames] of edges) {
    const text = cardTexts.get(cardName) || '';
    for (const tokenName of [...tokenNames]) {
      for (const alias of faceAliases.get(tokenName) || []) {
        if (!text.includes(alias)) continue;
        if (tokenNames.has(alias)) continue;
        tokenNames.add(alias);
        pinned += 1;
      }
    }
  }

  return { tokens, edges, scanned, pinned };
}

function rebuildCardsWithTokenFlag(db) {
  const columns = db.prepare('PRAGMA table_info(cards)').all();
  if (columns.some((column) => column.name === 'is_token')) return false;

  const names = columns.map((column) => column.name);
  const quoted = names.map((name) => `[${name}]`).join(', ');
  const definitions = names.map((name) => `[${name}] TEXT`).join(', ');

  db.exec(`
    CREATE TABLE cards_rebuild (
      ${definitions},
      [is_token] INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY ([name], [is_token])
    );
    INSERT INTO cards_rebuild (${quoted}, [is_token]) SELECT ${quoted}, 0 FROM cards;
    DROP TABLE cards;
    ALTER TABLE cards_rebuild RENAME TO cards;
  `);
  return true;
}

async function main() {
  console.log(`corpus : ${jsonlPath}`);
  console.log(`database: ${dbPath}`);

  if (!skipBackup) {
    const backup = `${dbPath}.bak`;
    fs.copyFileSync(dbPath, backup);
    console.log(`backup  : ${backup}`);
  }

  const { tokens, edges, scanned, pinned } = await readCorpus();
  console.log(`\nscanned ${scanned} corpus entries -> ${tokens.size} tokens, ${edges.size} token-creating cards`);
  console.log(`two-faced token edges pinned to a specific face: ${pinned}`);

  const db = new Database(dbPath);
  // Keep the file a single self-contained artifact: WAL leaves -wal/-shm sidecars and needs write
  // access to open, which breaks read-only consumers like the sqlite MCP server.
  db.pragma('journal_mode = DELETE');

  const rebuilt = rebuildCardsWithTokenFlag(db);
  console.log(rebuilt ? 'cards   : rebuilt with composite (name, is_token) primary key' : 'cards   : is_token already present, reusing schema');

  db.exec(`
    CREATE TABLE IF NOT EXISTS card_tokens (
      card_name TEXT NOT NULL,
      token_name TEXT NOT NULL,
      PRIMARY KEY (card_name, token_name)
    );
    CREATE INDEX IF NOT EXISTS card_tokens_token_idx ON card_tokens(token_name);
  `);

  const insertToken = db.prepare(`
    INSERT INTO cards (
      [name], [text], [type], [types], [subtypes], [supertypes],
      [colors], [colorIdentity], [power], [toughness], [loyalty], [defense],
      [keywords], [layout], [manaCost], [manaValue], [convertedManaCost],
      [identifiers], [is_token]
    ) VALUES (
      @name, @text, @type, @types, @subtypes, @supertypes,
      @colors, @colorIdentity, @power, @toughness, @loyalty, @defense,
      @keywords, @layout, @manaCost, @manaValue, @convertedManaCost,
      @identifiers, 1
    )
  `);
  const insertEdge = db.prepare('INSERT OR IGNORE INTO card_tokens (card_name, token_name) VALUES (?, ?)');

  const apply = db.transaction(() => {
    db.prepare('DELETE FROM cards WHERE is_token = 1').run();
    db.prepare('DELETE FROM card_tokens').run();

    for (const [name, row] of tokens) {
      const { view, entry } = row;
      const typeLine = String(view.type_line || faceValue(entry, 'type_line') || '');
      const { types, subtypes, supertypes } = splitTypeLine(typeLine);
      const keywords = entry.keywords || [];
      insertToken.run({
        name,
        text: view.oracle_text ?? null,
        type: typeLine || null,
        types: toJsonArray(types),
        subtypes: toJsonArray(subtypes),
        supertypes: toJsonArray(supertypes),
        colors: toJsonArray(view.colors || entry.colors || []),
        colorIdentity: toJsonArray(entry.color_identity || []),
        power: view.power ?? null,
        toughness: view.toughness ?? null,
        loyalty: view.loyalty ?? null,
        defense: view.defense ?? null,
        keywords: keywords.length ? toJsonArray(keywords) : null,
        layout: String(entry.layout || 'token'),
        manaCost: view.mana_cost || null,
        manaValue: entry.cmc === undefined ? null : String(entry.cmc),
        convertedManaCost: entry.cmc === undefined ? null : String(entry.cmc),
        identifiers: JSON.stringify({ scryfallOracleId: String(entry.oracle_id || '') }),
      });
    }

    for (const [cardName, tokenNames] of edges) {
      for (const tokenName of tokenNames) insertEdge.run(cardName, tokenName);
    }
  });

  apply();

  const tokenRows = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE is_token = 1').get().n;
  const cardRows = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE is_token = 0').get().n;
  const edgeRows = db.prepare('SELECT COUNT(*) AS n FROM card_tokens').get().n;
  const orphanEdges = db
    .prepare('SELECT COUNT(*) AS n FROM card_tokens ct WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.name = ct.token_name AND c.is_token = 1)')
    .get().n;
  const collisions = db
    .prepare('SELECT COUNT(*) AS n FROM cards a JOIN cards b ON a.name = b.name AND a.is_token = 0 AND b.is_token = 1')
    .get().n;

  console.log(`\ncards (is_token=0)   : ${cardRows}`);
  console.log(`tokens (is_token=1)  : ${tokenRows}`);
  console.log(`card_tokens edges    : ${edgeRows}`);
  console.log(`  edges to unknown token rows: ${orphanEdges}`);
  console.log(`names shared by a card and a token: ${collisions}`);

  // The table rebuild orphans the old pages; without this the file roughly doubles.
  db.exec('VACUUM');
  db.close();
  console.log(`\ndatabase size: ${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
