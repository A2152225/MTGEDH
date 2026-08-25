// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: grantAirbendPermissionToExiledCards.
// Public entry: grantAirbendPermissionToExiledCards.

import type { GameState } from '../../shared/src';
import { AIRBEND_ALTERNATE_COST } from './keywordActions/airbend';

export function grantAirbendPermissionToExiledCards(
  state: GameState,
  exiledCards: readonly any[]
): { readonly state: GameState; readonly granted: number } {
  const exiledIds = new Set(
    exiledCards
      .map((card) => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );
  if (exiledIds.size === 0) return { state, granted: 0 };

  const stateAny: any = state as any;
  stateAny.playableFromExile = stateAny.playableFromExile || {};

  let granted = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    if (exile.length === 0) return player;

    let changed = false;
    const nextExile = exile.map((card: any) => {
      const cardId = String(card?.id ?? card?.cardId ?? '').trim();
      if (!cardId || !exiledIds.has(cardId)) return card;

      const typeLineLower = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
      if (typeLineLower.includes('land')) return card;

      const ownerId = String(card?.ownerId || card?.owner || card?.card?.ownerId || card?.card?.owner || player?.id || '').trim();
      if (!ownerId) return card;

      stateAny.playableFromExile[ownerId] = stateAny.playableFromExile[ownerId] || {};
      stateAny.playableFromExile[ownerId][cardId] = Number.MAX_SAFE_INTEGER;
      granted += 1;
      changed = true;

      return {
        ...card,
        zone: 'exile',
        owner: ownerId,
        ownerId,
        canBePlayedBy: ownerId,
        playableUntilTurn: null,
        exileCastCost: AIRBEND_ALTERNATE_COST,
      };
    });

    return changed ? ({ ...player, exile: nextExile } as any) : player;
  });

  return {
    state: { ...(stateAny as any), players: updatedPlayers as any } as any,
    granted,
  };
}


