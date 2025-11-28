/**
 * Trading and collection database module for MTG Online-like functionality.
 * Provides card collection tracking, wishlist, and trade management.
 */
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'mtgedh.sqlite');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');

// Collection schema - tracks cards owned by users
db.exec(`
CREATE TABLE IF NOT EXISTS collection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  scryfall_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  set_code TEXT,
  collector_number TEXT,
  quantity INTEGER DEFAULT 1,
  foil INTEGER DEFAULT 0,
  condition TEXT DEFAULT 'NM',
  notes TEXT,
  acquired_at INTEGER NOT NULL,
  UNIQUE(user_id, scryfall_id, foil, condition)
);
CREATE INDEX IF NOT EXISTS collection_user_idx ON collection(user_id);
CREATE INDEX IF NOT EXISTS collection_card_idx ON collection(scryfall_id);
CREATE INDEX IF NOT EXISTS collection_name_idx ON collection(card_name);
`);

// Wishlist schema
db.exec(`
CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  scryfall_id TEXT,
  card_name TEXT NOT NULL,
  quantity_wanted INTEGER DEFAULT 1,
  max_price REAL,
  priority INTEGER DEFAULT 5,
  notes TEXT,
  added_at INTEGER NOT NULL,
  UNIQUE(user_id, card_name)
);
CREATE INDEX IF NOT EXISTS wishlist_user_idx ON wishlist(user_id);
CREATE INDEX IF NOT EXISTS wishlist_name_idx ON wishlist(card_name);
`);

// Trade offers schema
db.exec(`
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  proposer_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  message TEXT,
  proposer_confirmed INTEGER DEFAULT 0,
  receiver_confirmed INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS trades_proposer_idx ON trades(proposer_id);
CREATE INDEX IF NOT EXISTS trades_receiver_idx ON trades(receiver_id);
CREATE INDEX IF NOT EXISTS trades_status_idx ON trades(status);
`);

// Trade items - cards included in a trade
db.exec(`
CREATE TABLE IF NOT EXISTS trade_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  scryfall_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  foil INTEGER DEFAULT 0,
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS trade_items_trade_idx ON trade_items(trade_id);
`);

// Trade binders - public trading lists
db.exec(`
CREATE TABLE IF NOT EXISTS trade_binders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  scryfall_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  quantity_for_trade INTEGER DEFAULT 1,
  foil INTEGER DEFAULT 0,
  asking_price REAL,
  notes TEXT,
  listed_at INTEGER NOT NULL,
  UNIQUE(user_id, scryfall_id, foil)
);
CREATE INDEX IF NOT EXISTS trade_binders_user_idx ON trade_binders(user_id);
CREATE INDEX IF NOT EXISTS trade_binders_card_idx ON trade_binders(card_name);
`);

// Prepared statements for collection
const addToCollectionStmt = db.prepare(`
  INSERT INTO collection (user_id, scryfall_id, card_name, set_code, collector_number, quantity, foil, condition, notes, acquired_at)
  VALUES (@user_id, @scryfall_id, @card_name, @set_code, @collector_number, @quantity, @foil, @condition, @notes, @acquired_at)
  ON CONFLICT(user_id, scryfall_id, foil, condition) DO UPDATE SET quantity = quantity + excluded.quantity
`);

const getCollectionStmt = db.prepare(`
  SELECT * FROM collection WHERE user_id = ? ORDER BY card_name
`);

const getCollectionCardStmt = db.prepare(`
  SELECT * FROM collection WHERE user_id = ? AND card_name LIKE ?
`);

const updateCollectionQuantityStmt = db.prepare(`
  UPDATE collection SET quantity = ? WHERE id = ?
`);

const removeFromCollectionStmt = db.prepare(`
  DELETE FROM collection WHERE id = ?
`);

const getCollectionCountStmt = db.prepare(`
  SELECT SUM(quantity) as total FROM collection WHERE user_id = ?
`);

// Prepared statements for wishlist
const addToWishlistStmt = db.prepare(`
  INSERT INTO wishlist (user_id, scryfall_id, card_name, quantity_wanted, max_price, priority, notes, added_at)
  VALUES (@user_id, @scryfall_id, @card_name, @quantity_wanted, @max_price, @priority, @notes, @added_at)
  ON CONFLICT(user_id, card_name) DO UPDATE SET 
    quantity_wanted = excluded.quantity_wanted,
    max_price = excluded.max_price,
    priority = excluded.priority,
    notes = excluded.notes
`);

const getWishlistStmt = db.prepare(`
  SELECT * FROM wishlist WHERE user_id = ? ORDER BY priority DESC, card_name
`);

const removeFromWishlistStmt = db.prepare(`
  DELETE FROM wishlist WHERE id = ?
`);

// Prepared statements for trades
const createTradeStmt = db.prepare(`
  INSERT INTO trades (id, proposer_id, receiver_id, status, created_at, updated_at, message)
  VALUES (@id, @proposer_id, @receiver_id, @status, @created_at, @updated_at, @message)
`);

const updateTradeStatusStmt = db.prepare(`
  UPDATE trades SET status = ?, updated_at = ? WHERE id = ?
`);

const confirmTradeStmt = db.prepare(`
  UPDATE trades SET proposer_confirmed = ?, receiver_confirmed = ?, updated_at = ? WHERE id = ?
`);

const getTradeStmt = db.prepare(`
  SELECT * FROM trades WHERE id = ?
`);

const getUserTradesStmt = db.prepare(`
  SELECT * FROM trades WHERE (proposer_id = ? OR receiver_id = ?) AND status = ? ORDER BY updated_at DESC
`);

const addTradeItemStmt = db.prepare(`
  INSERT INTO trade_items (trade_id, owner_id, scryfall_id, card_name, quantity, foil)
  VALUES (@trade_id, @owner_id, @scryfall_id, @card_name, @quantity, @foil)
`);

const getTradeItemsStmt = db.prepare(`
  SELECT * FROM trade_items WHERE trade_id = ?
`);

// Prepared statements for trade binders
const addToBinderStmt = db.prepare(`
  INSERT INTO trade_binders (user_id, scryfall_id, card_name, quantity_for_trade, foil, asking_price, notes, listed_at)
  VALUES (@user_id, @scryfall_id, @card_name, @quantity_for_trade, @foil, @asking_price, @notes, @listed_at)
  ON CONFLICT(user_id, scryfall_id, foil) DO UPDATE SET 
    quantity_for_trade = excluded.quantity_for_trade,
    asking_price = excluded.asking_price,
    notes = excluded.notes,
    listed_at = excluded.listed_at
`);

const getBinderStmt = db.prepare(`
  SELECT * FROM trade_binders WHERE user_id = ? ORDER BY card_name
`);

const removeFromBinderStmt = db.prepare(`
  DELETE FROM trade_binders WHERE id = ?
`);

const searchBindersStmt = db.prepare(`
  SELECT tb.*, u.username, u.display_name
  FROM trade_binders tb
  JOIN users u ON tb.user_id = u.id
  WHERE tb.card_name LIKE ?
  ORDER BY tb.listed_at DESC
  LIMIT 50
`);

// Types
export interface CollectionCard {
  id: number;
  user_id: string;
  scryfall_id: string;
  card_name: string;
  set_code?: string;
  collector_number?: string;
  quantity: number;
  foil: boolean;
  condition: string;
  notes?: string;
  acquired_at: number;
}

export interface WishlistItem {
  id: number;
  user_id: string;
  scryfall_id?: string;
  card_name: string;
  quantity_wanted: number;
  max_price?: number;
  priority: number;
  notes?: string;
  added_at: number;
}

export interface Trade {
  id: string;
  proposer_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled';
  created_at: number;
  updated_at: number;
  message?: string;
  proposer_confirmed: boolean;
  receiver_confirmed: boolean;
}

export interface TradeItem {
  id: number;
  trade_id: string;
  owner_id: string;
  scryfall_id: string;
  card_name: string;
  quantity: number;
  foil: boolean;
}

export interface TradeBinderEntry {
  id: number;
  user_id: string;
  scryfall_id: string;
  card_name: string;
  quantity_for_trade: number;
  foil: boolean;
  asking_price?: number;
  notes?: string;
  listed_at: number;
  username?: string;
  display_name?: string;
}

// Collection API functions

/**
 * Add a card to user's collection.
 */
export function addToCollection(
  userId: string,
  card: {
    scryfall_id: string;
    card_name: string;
    set_code?: string;
    collector_number?: string;
    quantity?: number;
    foil?: boolean;
    condition?: string;
    notes?: string;
  }
): boolean {
  try {
    addToCollectionStmt.run({
      user_id: userId,
      scryfall_id: card.scryfall_id,
      card_name: card.card_name,
      set_code: card.set_code || null,
      collector_number: card.collector_number || null,
      quantity: card.quantity || 1,
      foil: card.foil ? 1 : 0,
      condition: card.condition || 'NM',
      notes: card.notes || null,
      acquired_at: Date.now(),
    });
    return true;
  } catch (err) {
    console.error('[DB] addToCollection failed:', err);
    return false;
  }
}

/**
 * Get user's entire collection.
 */
export function getCollection(userId: string): CollectionCard[] {
  const rows = getCollectionStmt.all(userId) as any[];
  return rows.map(row => ({
    ...row,
    foil: !!row.foil,
  }));
}

/**
 * Search user's collection by card name.
 */
export function searchCollection(userId: string, cardName: string): CollectionCard[] {
  const rows = getCollectionCardStmt.all(userId, `%${cardName}%`) as any[];
  return rows.map(row => ({
    ...row,
    foil: !!row.foil,
  }));
}

/**
 * Update quantity of a collection entry.
 */
export function updateCollectionQuantity(entryId: number, quantity: number): boolean {
  if (quantity <= 0) {
    return removeFromCollectionStmt.run(entryId).changes > 0;
  }
  return updateCollectionQuantityStmt.run(quantity, entryId).changes > 0;
}

/**
 * Remove a card from collection.
 */
export function removeFromCollection(entryId: number): boolean {
  return removeFromCollectionStmt.run(entryId).changes > 0;
}

/**
 * Get total card count in collection.
 */
export function getCollectionCount(userId: string): number {
  const row = getCollectionCountStmt.get(userId) as { total: number } | undefined;
  return row?.total || 0;
}

// Wishlist API functions

/**
 * Add a card to user's wishlist.
 */
export function addToWishlist(
  userId: string,
  item: {
    scryfall_id?: string;
    card_name: string;
    quantity_wanted?: number;
    max_price?: number;
    priority?: number;
    notes?: string;
  }
): boolean {
  try {
    addToWishlistStmt.run({
      user_id: userId,
      scryfall_id: item.scryfall_id || null,
      card_name: item.card_name,
      quantity_wanted: item.quantity_wanted || 1,
      max_price: item.max_price || null,
      priority: item.priority || 5,
      notes: item.notes || null,
      added_at: Date.now(),
    });
    return true;
  } catch (err) {
    console.error('[DB] addToWishlist failed:', err);
    return false;
  }
}

/**
 * Get user's wishlist.
 */
export function getWishlist(userId: string): WishlistItem[] {
  return getWishlistStmt.all(userId) as WishlistItem[];
}

/**
 * Remove item from wishlist.
 */
export function removeFromWishlist(itemId: number): boolean {
  return removeFromWishlistStmt.run(itemId).changes > 0;
}

// Trading API functions

/**
 * Create a new trade offer.
 */
export function createTrade(
  proposerId: string,
  receiverId: string,
  message?: string
): Trade {
  const id = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  
  createTradeStmt.run({
    id,
    proposer_id: proposerId,
    receiver_id: receiverId,
    status: 'pending',
    created_at: now,
    updated_at: now,
    message: message || null,
  });
  
  return {
    id,
    proposer_id: proposerId,
    receiver_id: receiverId,
    status: 'pending',
    created_at: now,
    updated_at: now,
    message,
    proposer_confirmed: false,
    receiver_confirmed: false,
  };
}

/**
 * Add items to a trade.
 */
export function addTradeItems(
  tradeId: string,
  ownerId: string,
  items: Array<{
    scryfall_id: string;
    card_name: string;
    quantity?: number;
    foil?: boolean;
  }>
): boolean {
  try {
    for (const item of items) {
      addTradeItemStmt.run({
        trade_id: tradeId,
        owner_id: ownerId,
        scryfall_id: item.scryfall_id,
        card_name: item.card_name,
        quantity: item.quantity || 1,
        foil: item.foil ? 1 : 0,
      });
    }
    return true;
  } catch (err) {
    console.error('[DB] addTradeItems failed:', err);
    return false;
  }
}

/**
 * Get a trade by ID.
 */
export function getTrade(tradeId: string): Trade | null {
  const row = getTradeStmt.get(tradeId) as any;
  if (!row) return null;
  
  return {
    ...row,
    proposer_confirmed: !!row.proposer_confirmed,
    receiver_confirmed: !!row.receiver_confirmed,
  };
}

/**
 * Get trade items.
 */
export function getTradeItems(tradeId: string): TradeItem[] {
  const rows = getTradeItemsStmt.all(tradeId) as any[];
  return rows.map(row => ({
    ...row,
    foil: !!row.foil,
  }));
}

/**
 * Get user's trades by status.
 */
export function getUserTrades(userId: string, status: string = 'pending'): Trade[] {
  const rows = getUserTradesStmt.all(userId, userId, status) as any[];
  return rows.map(row => ({
    ...row,
    proposer_confirmed: !!row.proposer_confirmed,
    receiver_confirmed: !!row.receiver_confirmed,
  }));
}

/**
 * Accept or reject a trade.
 */
export function updateTradeStatus(tradeId: string, status: 'accepted' | 'rejected' | 'cancelled'): boolean {
  return updateTradeStatusStmt.run(status, Date.now(), tradeId).changes > 0;
}

/**
 * Confirm a trade (both parties must confirm for completion).
 */
export function confirmTrade(tradeId: string, userId: string): boolean {
  const trade = getTrade(tradeId);
  if (!trade) return false;
  
  let proposerConfirmed = trade.proposer_confirmed;
  let receiverConfirmed = trade.receiver_confirmed;
  
  if (userId === trade.proposer_id) {
    proposerConfirmed = true;
  } else if (userId === trade.receiver_id) {
    receiverConfirmed = true;
  } else {
    return false;
  }
  
  confirmTradeStmt.run(
    proposerConfirmed ? 1 : 0,
    receiverConfirmed ? 1 : 0,
    Date.now(),
    tradeId
  );
  
  // If both confirmed, complete the trade
  if (proposerConfirmed && receiverConfirmed) {
    updateTradeStatusStmt.run('completed', Date.now(), tradeId);
  }
  
  return true;
}

// Trade binder API functions

/**
 * Add a card to user's trade binder (public trading list).
 */
export function addToBinder(
  userId: string,
  entry: {
    scryfall_id: string;
    card_name: string;
    quantity_for_trade?: number;
    foil?: boolean;
    asking_price?: number;
    notes?: string;
  }
): boolean {
  try {
    addToBinderStmt.run({
      user_id: userId,
      scryfall_id: entry.scryfall_id,
      card_name: entry.card_name,
      quantity_for_trade: entry.quantity_for_trade || 1,
      foil: entry.foil ? 1 : 0,
      asking_price: entry.asking_price || null,
      notes: entry.notes || null,
      listed_at: Date.now(),
    });
    return true;
  } catch (err) {
    console.error('[DB] addToBinder failed:', err);
    return false;
  }
}

/**
 * Get user's trade binder.
 */
export function getTradeBinder(userId: string): TradeBinderEntry[] {
  const rows = getBinderStmt.all(userId) as any[];
  return rows.map(row => ({
    ...row,
    foil: !!row.foil,
  }));
}

/**
 * Remove an entry from trade binder.
 */
export function removeFromBinder(entryId: number): boolean {
  return removeFromBinderStmt.run(entryId).changes > 0;
}

/**
 * Search trade binders across all users.
 */
export function searchTradeBinders(cardName: string): TradeBinderEntry[] {
  const rows = searchBindersStmt.all(`%${cardName}%`) as any[];
  return rows.map(row => ({
    ...row,
    foil: !!row.foil,
  }));
}
