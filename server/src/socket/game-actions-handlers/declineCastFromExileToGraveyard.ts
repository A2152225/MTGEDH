/**
 * Move an exiled card into its owner's graveyard when a madness
 * (or other cast-from-exile) offer is declined.
 */
import { pushCardToPlayerGraveyardWithReplacements } from "../../state/modules/graveyardEntryUtils.js";

export function declineCastFromExileToGraveyard(
  game: any,
  playerId: string,
  cardId: string,
): boolean {
  const pid = String(playerId || '').trim();
  const id = String(cardId || '').trim();
  const zones = game?.state?.zones?.[pid];
  if (!zones || !Array.isArray(zones.exile) || !id) return false;
  const index = zones.exile.findIndex((card: any) => String(card?.id || '') === id);
  if (index === -1) return false;
  const card = zones.exile.splice(index, 1)[0];
  zones.exileCount = zones.exile.length;
  zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  const ctx = {
    state: game.state,
    gameId: String(game.id || game.gameId || ''),
    isReplaying: Boolean((game as any).isReplaying),
  } as any;
  pushCardToPlayerGraveyardWithReplacements(ctx, pid, card, zones.graveyard);
  zones.graveyardCount = zones.graveyard.length;
  try {
    const pending = (game.state as any).pendingSpellCasts;
    if (pending && typeof pending === 'object') {
      for (const key of Object.keys(pending)) {
        if (String(pending[key]?.cardId || '') === id) delete pending[key];
      }
    }
  } catch { /* pending-cast cleanup is best-effort */ }
  return true;
}
