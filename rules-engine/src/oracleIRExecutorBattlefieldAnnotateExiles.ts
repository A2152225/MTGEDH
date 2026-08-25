// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: annotateBattlefieldExilesWithSource.
// Public entry: annotateBattlefieldExilesWithSource.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

export function annotateBattlefieldExilesWithSource(
  state: GameState,
  removed: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): GameState {
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceRef = sourceId || String(ctx.sourceName || '').trim();
  if (!sourceRef || removed.length === 0) return state;

  const removedCardIds = new Set(
    removed
      .map(perm => String(((perm as any)?.card?.id ?? (perm as any)?.id) || '').trim())
      .filter(Boolean)
  );
  if (removedCardIds.size === 0) return state;

  const updatedPlayers = (state.players || []).map((player: any) => {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    let changed = false;
    const nextExile = exile.map((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !removedCardIds.has(cardId)) return card;
      changed = true;
      return {
        ...card,
        exiledBy: sourceRef,
        ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
      };
    });
    return changed ? ({ ...player, exile: nextExile } as any) : player;
  });

  return { ...(state as any), players: updatedPlayers as any } as any;
}


