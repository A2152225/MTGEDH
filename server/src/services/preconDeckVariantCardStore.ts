/**
 * SQLite storage for Planechase / Archenemy cards that ship with a precon
 * (e.g. the Doctor Who Commander decks: 9 planes + 1 phenomenon each).
 *
 * Lives beside precon_deck_cards in server/data/precon-decklists.sqlite but in separate
 * tables, so existing decklist rows and `upsertPreconDecklist` are untouched.
 * `precon_deck_variant_meta` records that a deck was CHECKED, so decks with no planar
 * cards are not re-fetched on every bake.
 *
 * Public: upsertPreconVariantCards, getPreconVariantCards, hasCheckedPreconVariantCards.
 */
import type Database from 'better-sqlite3';

import { getPreconDecklistDatabase } from './preconDecklistStore.js';
import type { VariantCard, VariantCardKind } from './mtgJsonDeckVariantCards.js';
import { debugWarn } from '../utils/debug.js';

const ensuredDatabases = new WeakSet<Database.Database>();

function getDatabase(): Database.Database {
  const database = getPreconDecklistDatabase();
  if (!ensuredDatabases.has(database)) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS precon_deck_variant_cards (
        set_code TEXT NOT NULL,
        deck_name TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        deck_kind TEXT NOT NULL,
        card_name TEXT NOT NULL,
        card_kind TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        scryfall_oracle_id TEXT,
        PRIMARY KEY (set_code, deck_name, deck_kind, sort_order)
      );

      CREATE TABLE IF NOT EXISTS precon_deck_variant_meta (
        set_code TEXT NOT NULL,
        deck_name TEXT NOT NULL,
        checked_at INTEGER NOT NULL,
        PRIMARY KEY (set_code, deck_name)
      );
    `);
    ensuredDatabases.add(database);
  }
  return database;
}

function normalize(setCode: string, deckName: string): { set: string; deck: string } {
  return { set: String(setCode || '').trim().toUpperCase(), deck: String(deckName || '').trim() };
}

/** Replace the deck's planar + scheme rows; an empty result still records "checked". */
export function upsertPreconVariantCards(
  setCode: string,
  deckName: string,
  cards: { planar: VariantCard[]; schemes: VariantCard[] },
): void {
  const { set, deck } = normalize(setCode, deckName);
  if (!set || !deck) return;
  const database = getDatabase();

  const write = database.transaction(() => {
    database
      .prepare('DELETE FROM precon_deck_variant_cards WHERE set_code = ? AND deck_name = ?')
      .run(set, deck);
    const insert = database.prepare(
      `INSERT INTO precon_deck_variant_cards
       (set_code, deck_name, sort_order, deck_kind, card_name, card_kind, count, scryfall_oracle_id)
       VALUES (@setCode, @deckName, @sortOrder, @deckKind, @cardName, @cardKind, @count, @oracleId)`,
    );
    const insertAll = (deckKind: 'planar' | 'scheme', list: VariantCard[]) => {
      list.forEach((card, index) => {
        insert.run({
          setCode: set,
          deckName: deck,
          sortOrder: index,
          deckKind,
          cardName: card.name,
          cardKind: card.kind,
          count: Math.max(1, card.count || 1),
          oracleId: card.scryfallOracleId,
        });
      });
    };
    insertAll('planar', cards.planar);
    insertAll('scheme', cards.schemes);
    database
      .prepare('INSERT OR REPLACE INTO precon_deck_variant_meta (set_code, deck_name, checked_at) VALUES (?, ?, ?)')
      .run(set, deck, Date.now());
  });
  write();
}

export function hasCheckedPreconVariantCards(setCode: string, deckName: string): boolean {
  const { set, deck } = normalize(setCode, deckName);
  if (!set || !deck) return false;
  try {
    const row = getDatabase()
      .prepare('SELECT 1 AS present FROM precon_deck_variant_meta WHERE set_code = ? AND deck_name = ?')
      .get(set, deck);
    return Boolean(row);
  } catch (error) {
    debugWarn(1, '[preconDeckVariantCardStore] failed to read variant meta', { setCode, deckName, error });
    return false;
  }
}

/** Planar deck + scheme deck for a precon, each in stored (file) order. Empty when none. */
export function getPreconVariantCards(
  setCode: string,
  deckName: string,
): { planar: VariantCard[]; schemes: VariantCard[] } {
  const result = { planar: [] as VariantCard[], schemes: [] as VariantCard[] };
  const { set, deck } = normalize(setCode, deckName);
  if (!set || !deck) return result;
  try {
    const rows = getDatabase()
      .prepare(
        `SELECT deck_kind, card_name, card_kind, count, scryfall_oracle_id
         FROM precon_deck_variant_cards
         WHERE set_code = ? AND deck_name = ?
         ORDER BY deck_kind ASC, sort_order ASC`,
      )
      .all(set, deck) as Array<{
        deck_kind: string;
        card_name: string;
        card_kind: string;
        count: number;
        scryfall_oracle_id: string | null;
      }>;
    for (const row of rows) {
      const card: VariantCard = {
        name: row.card_name,
        kind: row.card_kind as VariantCardKind,
        count: Math.max(1, row.count || 1),
        scryfallOracleId: row.scryfall_oracle_id || null,
      };
      if (row.deck_kind === 'scheme') result.schemes.push(card);
      else result.planar.push(card);
    }
  } catch (error) {
    debugWarn(1, '[preconDeckVariantCardStore] failed to read variant cards', { setCode, deckName, error });
  }
  return result;
}
