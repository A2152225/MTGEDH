import type { AuthUser } from './authApi';

/** Admin may mutate any server deck; otherwise only the owner. */
export function canMutateDeck(
  deck: { created_by_id?: string | null },
  accountUser?: AuthUser | null,
): boolean {
  if (!accountUser) return false;
  if (accountUser.isAdmin) return true;
  return !!accountUser.id && deck.created_by_id === accountUser.id;
}
