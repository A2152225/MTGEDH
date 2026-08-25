// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: exileAllOpponentGraveyards, buildExileBattlefieldAppliedMetadata.
// Public entries: those two helpers.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { buildPermanentCardWithStats } from './oracleIRExecutorBattlefieldRemovalHelpers';

export function exileAllOpponentGraveyards(
  state: GameState,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  let exiledCount = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (!playerId || playerId === controllerId) return player;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    if (graveyard.length === 0) return player;
    exiledCount += graveyard.length;
    const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
    return {
      ...player,
      graveyard: [],
      exile: [
        ...exile,
        ...graveyard.map((card: any) => ({
          ...card,
          zone: 'exile',
          owner: playerId,
          ownerId: playerId,
        })),
      ],
    };
  });

  if (exiledCount === 0) {
    return { applied: true, state, log: ['No opponent graveyard cards to exile'] };
  }

  return {
    applied: true,
    state: { ...(state as any), players: updatedPlayers as any } as GameState,
    log: [`Exiled ${exiledCount} card(s) from opponent graveyards`],
  };
}

export function buildExileBattlefieldAppliedMetadata(
  toRemove: readonly BattlefieldPermanent[],
): Record<string, unknown> {
  const permanentIds = toRemove
    .map((perm) => String((perm as any)?.id || '').trim())
    .filter(Boolean);
  if (permanentIds.length === 0) return {};

  const movedCards = toRemove
    .filter((perm) => !(perm as any).isToken)
    .map((perm) => buildPermanentCardWithStats(perm, 'exile'));

  return {
    lastExiledBattlefieldPermanentIds: permanentIds,
    ...(movedCards.length > 0
      ? {
          lastMovedCards: movedCards,
          lastExiledCards: movedCards,
          lastExiledCardCount: movedCards.length,
        }
      : {}),
  };
}

