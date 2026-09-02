import type { SavedDeckSummary } from '../../../shared/src/decks';
import { listDecks, listDecksByOwner, listPublicDecks } from '../db/decks.js';

export type DeckVisibility = 'public' | 'private';

export function normalizeDeckVisibility(value: unknown, fallback: DeckVisibility = 'private'): DeckVisibility {
  return value === 'public' ? 'public' : value === 'private' ? 'private' : fallback;
}

export function isPublicDeck(deck: { visibility?: string | null }): boolean {
  return (deck.visibility || 'public') !== 'private';
}

export function canReadDeck(
  deck: { visibility?: string | null; created_by_id: string },
  accountUserId?: string | null,
  isAdmin?: boolean,
): boolean {
  if (isAdmin) return true;
  if (isPublicDeck(deck)) return true;
  return !!accountUserId && accountUserId === deck.created_by_id;
}

export function canMutateDeck(
  deck: { created_by_id: string },
  actor: { accountUserId?: string | null; playerId?: string | null; isAdmin?: boolean },
): boolean {
  if (actor.isAdmin) return true;
  if (actor.accountUserId && actor.accountUserId === deck.created_by_id) return true;
  if (!actor.accountUserId && actor.playerId && actor.playerId === deck.created_by_id) return true;
  return false;
}

export function listDecksVisibleTo(accountUserId?: string | null, isAdmin?: boolean): SavedDeckSummary[] {
  if (isAdmin) return listDecks();
  const byId = new Map<string, SavedDeckSummary>();
  for (const deck of listPublicDecks()) {
    byId.set(deck.id, deck);
  }
  if (accountUserId) {
    for (const deck of listDecksByOwner(accountUserId)) {
      byId.set(deck.id, deck);
    }
  }
  return [...byId.values()];
}

/** All decks (admin/tests). Prefer listDecksVisibleTo for user-facing lists. */
export function listAllDecksUnfiltered(): SavedDeckSummary[] {
  return listDecks();
}
