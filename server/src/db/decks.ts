import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { SavedDeckSummary, SavedDeckDetail, DeckFolder } from '../../../shared/src/decks';
import { debug, debugWarn, debugError } from "../utils/debug.js";

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'mtgedh.sqlite');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  card_count INTEGER NOT NULL,
  resolved_cards TEXT,
  folder TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS decks_created_at_idx ON decks(created_at DESC);
`);

// Migration: add resolved_cards column if it doesn't exist (for existing databases)
try {
  const tableInfo = db.prepare("PRAGMA table_info(decks)").all() as Array<{ name: string }>;
  const hasResolvedCards = tableInfo.some(col => col.name === 'resolved_cards');
  if (!hasResolvedCards) {
    db.exec(`ALTER TABLE decks ADD COLUMN resolved_cards TEXT`);
    debug(2, '[DB] Added resolved_cards column to decks table');
  }
  const hasFolder = tableInfo.some(col => col.name === 'folder');
  if (!hasFolder) {
    db.exec(`ALTER TABLE decks ADD COLUMN folder TEXT DEFAULT ''`);
    debug(2, '[DB] Added folder column to decks table');
  }
  // Always ensure folder index exists (safe for new and migrated databases)
  db.exec(`CREATE INDEX IF NOT EXISTS decks_folder_idx ON decks(folder)`);
} catch (e) {
  debugWarn(1, '[DB] Migration check failed:', e);
}

const insertStmt = db.prepare(`
  INSERT INTO decks (id, name, text, created_at, created_by_id, created_by_name, card_count, resolved_cards, folder)
  VALUES (@id, @name, @text, @created_at, @created_by_id, @created_by_name, @card_count, @resolved_cards, @folder)
`);
const listStmt = db.prepare(`SELECT id, name, created_at, created_by_id, created_by_name, card_count, folder, CASE WHEN resolved_cards IS NOT NULL AND resolved_cards != '' THEN 1 ELSE 0 END as has_cached_cards FROM decks ORDER BY folder, created_at DESC`);
const listByFolderStmt = db.prepare(`SELECT id, name, created_at, created_by_id, created_by_name, card_count, folder, CASE WHEN resolved_cards IS NOT NULL AND resolved_cards != '' THEN 1 ELSE 0 END as has_cached_cards FROM decks WHERE folder = ? ORDER BY created_at DESC`);
const getStmt = db.prepare(`SELECT * FROM decks WHERE id = ?`);
const renameStmt = db.prepare(`UPDATE decks SET name = ? WHERE id = ?`);
const deleteStmt = db.prepare(`DELETE FROM decks WHERE id = ?`);
const updateResolvedCardsStmt = db.prepare(`UPDATE decks SET resolved_cards = ? WHERE id = ?`);
const updateFolderStmt = db.prepare(`UPDATE decks SET folder = ? WHERE id = ?`);
const listFoldersStmt = db.prepare(`SELECT DISTINCT folder FROM decks WHERE folder != '' ORDER BY folder`);

export function saveDeck(deck: {
  id: string;
  name: string;
  text: string;
  created_by_id: string;
  created_by_name: string;
  card_count: number;
  resolved_cards?: string | null;
  folder?: string;
}) {
  insertStmt.run({
    ...deck,
    created_at: Date.now(),
    resolved_cards: deck.resolved_cards ?? null,
    folder: deck.folder ?? ''
  });
}

/**
 * Update the cached resolved cards for an existing deck.
 * This allows caching card data after import.
 */
export function updateDeckResolvedCards(id: string, resolvedCards: string | null): boolean {
  const info = updateResolvedCardsStmt.run(resolvedCards, id);
  return info.changes > 0;
}

/**
 * Move a deck to a different folder.
 */
export function moveDeckToFolder(id: string, folder: string): boolean {
  const info = updateFolderStmt.run(folder, id);
  return info.changes > 0;
}

export function listDecks(folder?: string): SavedDeckSummary[] {
  const rows = (folder !== undefined 
    ? listByFolderStmt.all(folder) 
    : listStmt.all()
  ) as Array<{
    id: string;
    name: string;
    created_at: number;
    created_by_id: string;
    created_by_name: string;
    card_count: number;
    has_cached_cards: number;
    folder: string | null;
  }>;
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    created_by_id: row.created_by_id,
    created_by_name: row.created_by_name,
    card_count: row.card_count,
    has_cached_cards: row.has_cached_cards === 1,
    folder: row.folder || ''
  }));
}

/**
 * Get list of all unique folder paths.
 */
export function listFolders(): string[] {
  const rows = listFoldersStmt.all() as Array<{ folder: string }>;
  return rows.map(r => r.folder);
}

/**
 * Build a folder tree structure from deck data.
 */
export function buildFolderTree(decks: SavedDeckSummary[]): DeckFolder[] {
  const folderMap = new Map<string, { decks: number; children: Set<string> }>();
  
  // Initialize root
  folderMap.set('', { decks: 0, children: new Set() });
  
  for (const deck of decks) {
    const folder = deck.folder || '';
    
    // Count decks in this folder
    if (!folderMap.has(folder)) {
      folderMap.set(folder, { decks: 0, children: new Set() });
    }
    folderMap.get(folder)!.decks++;
    
    // Build parent chain
    if (folder) {
      const parts = folder.split('/');
      let currentPath = '';
      for (let i = 0; i < parts.length; i++) {
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        
        if (!folderMap.has(currentPath)) {
          folderMap.set(currentPath, { decks: 0, children: new Set() });
        }
        
        // Add this folder as child of parent
        if (!folderMap.has(parentPath)) {
          folderMap.set(parentPath, { decks: 0, children: new Set() });
        }
        folderMap.get(parentPath)!.children.add(currentPath);
      }
    }
  }
  
  // Build tree recursively
  function buildNode(path: string): DeckFolder {
    const data = folderMap.get(path) || { decks: 0, children: new Set() };
    const name = path ? path.split('/').pop()! : 'Root';
    
    const subfolders: DeckFolder[] = [];
    for (const childPath of data.children) {
      subfolders.push(buildNode(childPath));
    }
    subfolders.sort((a, b) => a.name.localeCompare(b.name));
    
    return {
      name,
      path,
      subfolders,
      deckCount: data.decks
    };
  }
  
  // Get root level folders
  const rootData = folderMap.get('') || { decks: 0, children: new Set() };
  const rootFolders: DeckFolder[] = [];
  for (const childPath of rootData.children) {
    rootFolders.push(buildNode(childPath));
  }
  rootFolders.sort((a, b) => a.name.localeCompare(b.name));
  
  return rootFolders;
}

export function getDeck(id: string): SavedDeckDetail | null {
  const row = getStmt.get(id) as {
    id: string;
    name: string;
    text: string;
    created_at: number;
    created_by_id: string;
    created_by_name: string;
    card_count: number;
    resolved_cards: string | null;
    folder: string | null;
  } | undefined;
  if (!row) return null;
  
  // Parse cached resolved cards if present
  let cachedCards: SavedDeckDetail['cached_cards'] = undefined;
  if (row.resolved_cards) {
    try {
      cachedCards = JSON.parse(row.resolved_cards);
    } catch (e) {
      debugWarn(1, '[DB] Failed to parse resolved_cards for deck', id, e);
    }
  }
  
  const entries = parseDecklistEntries(row.text);
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    created_by_id: row.created_by_id,
    created_by_name: row.created_by_name,
    card_count: row.card_count,
    text: row.text,
    entries,
    has_cached_cards: !!cachedCards && cachedCards.length > 0,
    cached_cards: cachedCards,
    folder: row.folder || ''
  };
}

export function renameDeck(id: string, name: string): SavedDeckSummary | null {
  renameStmt.run(name, id);
  const d = getDeck(id);
  if (!d) return null;
  const { text, entries, cached_cards, ...summary } = d;
  return summary;
}

export function deleteDeck(id: string): boolean {
  const info = deleteStmt.run(id);
  return info.changes > 0;
}

/**
 * Strip Moxfield/Scryfall-style set and collector number suffixes from a card name.
 * Handles patterns like:
 *   - "Sol Ring (C14) 276" -> "Sol Ring"
 *   - "Sol Ring (C14:276)" -> "Sol Ring"
 *   - "Sol Ring 276 (C14)" -> "Sol Ring"
 * 
 * Note: A similar implementation exists in server/src/services/scryfall.ts.
 * The duplication is intentional to avoid circular dependencies between db and services.
 */
function stripSetCollectorNumber(name: string): string {
  let result = name;
  
  // Pattern 1: (SET) NUMBER at end
  // Set names can be up to 15 chars to handle longer names like "commander 2014"
  result = result.replace(/\s+\([A-Za-z0-9][A-Za-z0-9 ]{0,14}\)\s+\d+[A-Za-z]?$/i, '');
  
  // Pattern 2: (SET:NUMBER) at end
  result = result.replace(/\s+\([A-Za-z0-9]{2,10}:\d+[A-Za-z]?\)$/i, '');
  
  // Pattern 3: NUMBER (SET) at end
  result = result.replace(/\s+\d+[A-Za-z]?\s+\([A-Za-z0-9]{2,10}\)$/i, '');
  
  // Pattern 4: Just (SET) at end
  result = result.replace(/\s+\([A-Za-z0-9]{2,10}\)$/i, '');
  
  // Pattern 5: Trailing collector number only (1-4 digits, optionally followed by letter)
  result = result.replace(/\s+\d{1,4}[A-Za-z]?$/, '');
  
  return result.trim();
}

/* Reuse parse logic (names + counts) without server import validation */
export function parseDecklistEntries(list: string): Array<{ name: string; count: number }> {
  const lines = (list || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const entries: Array<{ name: string; count: number }> = [];
  for (const line of lines) {
    // Skip sideboard markers, comments, and section headers
    if (/^(SB:|SIDEBOARD|\/\/|#)/i.test(line)) continue;
    if (/^(DECK|COMMANDER|MAINBOARD|MAYBEBOARD|CONSIDERING)$/i.test(line.trim())) continue;
    
    // Accept formats like: "4 Lightning Bolt", "Lightning Bolt x4", "1x Sol Ring"
    let count = 1;
    let name = line;
    const m1 = line.match(/^(\d+)[xX]?\s+(.+)$/);
    const m2 = line.match(/^(.+?)\s+[xX](\d+)$/);
    if (m1) {
      count = parseInt(m1[1], 10) || 1;
      name = m1[2].trim();
    } else if (m2) {
      count = parseInt(m2[2], 10) || 1;
      name = m2[1].trim();
    }
    
    // Strip Moxfield/Scryfall-style set and collector number suffixes
    name = stripSetCollectorNumber(name);
    
    if (name) {
      entries.push({ name, count });
    }
  }
  return entries;
}

export function totalCountFromEntries(entries: Array<{ name: string; count: number }>): number {
  return entries.reduce((a, e) => a + e.count, 0);
}
