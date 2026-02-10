import type { PlayerID } from "../../../../shared/src/types.js";

export function stripPlayableFromExileTags(card: any): void {
  try {
    if (!card || typeof card !== "object") return;
    delete (card as any).canBePlayedBy;
    delete (card as any).playableUntilTurn;
  } catch {
    // ignore
  }
}

function removeCardIdFromLegacyArray(entry: any, cardId: string): void {
  if (!Array.isArray(entry)) return;
  const idx = entry.indexOf(cardId);
  if (idx >= 0) entry.splice(idx, 1);
}

function removeCardIdFromMap(entry: any, cardId: string): void {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
  if (cardId in entry) delete entry[cardId];
}

/**
 * Removes any playable-from-exile permission for this card, across *all* players.
 *
 * This is intentionally global: once the card leaves exile, any cached permission
 * becomes stale regardless of who it was granted to.
 */
export function removePlayableFromExileForCard(state: any, cardId: string): void {
  try {
    if (!state || typeof state !== "object") return;
    const pfe = (state as any).playableFromExile;
    if (!pfe || typeof pfe !== "object") return;

    for (const playerId of Object.keys(pfe) as PlayerID[]) {
      const entry = (pfe as any)[playerId];
      removeCardIdFromLegacyArray(entry, cardId);
      removeCardIdFromMap(entry, cardId);
    }
  } catch {
    // ignore
  }
}

export function cleanupCardLeavingExile(state: any, card: any): void {
  const cardId = card?.id;
  if (typeof cardId === "string" && cardId.length > 0) {
    removePlayableFromExileForCard(state, cardId);
  }

  stripPlayableFromExileTags(card);
}
