/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: reading a player's cards out of a given zone. Shared leaf -
 * several game-actions clusters need these accessors, so they live apart from
 * any one of them.
 *
 * Public entry symbols: getPlayerLibraryCards, getTopLibraryCard,
 * getPlayerCommandZoneCards, getPlayerSpellSourceCards.
 */
import { getPlayableExileCardsForPlayer } from "../../state/modules/playable-from-exile.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";

export function getPlayerLibraryCards(game: any, playerId: string): any[] {
  return Array.isArray((game.libraries as any)?.get?.(playerId))
    ? ((game.libraries as any).get(playerId) as any[])
    : (Array.isArray((game.state as any)?.zones?.[playerId]?.library)
      ? (((game.state as any).zones[playerId].library) as any[])
      : []);
}

export function getTopLibraryCard(game: any, playerId: string): any | null {
  const library = getPlayerLibraryCards(game, playerId);
  return library[0] ?? null;
}

export function getPlayerCommandZoneCards(game: any, playerId: string): any[] {
  const commandZone = game?.state?.commandZone?.[playerId];
  return Array.isArray(commandZone?.commanderCards) ? commandZone.commanderCards : [];
}

export function getPlayerSpellSourceCards(game: any, playerId: string, sourceZone: SpellCastSourceZone): any[] {
  const zones = game?.state?.zones?.[playerId] || {};

  switch (sourceZone) {
    case 'exile':
      return getPlayableExileCardsForPlayer(game?.state, playerId as any);
    case 'graveyard':
      return Array.isArray((zones as any).graveyard) ? (zones as any).graveyard : [];
    case 'library':
      return getPlayerLibraryCards(game, playerId);
    case 'command':
      return getPlayerCommandZoneCards(game, playerId);
    case 'hand':
    default:
      return Array.isArray((zones as any).hand) ? (zones as any).hand : [];
  }
}
