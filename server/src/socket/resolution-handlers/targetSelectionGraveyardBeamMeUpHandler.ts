// server/src/socket/resolution-handlers/targetSelectionGraveyardBeamMeUpHandler.ts
// B42: resolves the beam me up return-to-hand cost picked on the shared graveyard-cast cost picker
// (TARGET_SELECTION with graveyardCastSacrificeAsCost + returnToHandForCost), then resumes the cast (B43: the bounce itself happens at cast commit) with
// beamedUpPermanentIdsForCost so finalizeGraveyardSpellCast records it on activateGraveyardAbility.
// Public entry symbols: handleBeamMeUpReturnCostSelection. Must not import resolution.ts.

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { continueCastFromGraveyardAbility } from "../interaction.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import { getEligibleCreaturesForBeamMeUp } from "../interaction-handlers/interactionGraveyardCastCostAndTimingRules.js";

const idList = (v: any): string[] | undefined => (Array.isArray(v) ? v.map((id: any) => String(id)).filter(Boolean) : undefined);

export function handleBeamMeUpReturnCostSelection(io: Server, game: any, gameId: string, step: ResolutionStep, response: ResolutionStepResponse): boolean {
  const stepAny = step as any;
  const controllerId = String(response.playerId);
  const cardId = String(stepAny?.cardId || step.sourceId || '').trim();
  const cardName = String(stepAny?.cardName || step.sourceName || 'Spell');
  const chosenId = String(((response.selections as string[]) || [])[0] || '').trim();
  const graveyard = (game.state as any)?.zones?.[controllerId]?.graveyard;
  if (!Array.isArray(graveyard) || !graveyard.some((entry: any) => entry && String(entry.id || '') === cardId)) {
    emitToPlayer(io, controllerId, 'error', { code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
    return true;
  }
  const perm = getEligibleCreaturesForBeamMeUp(game.state, controllerId).find((p: any) => String(p.id) === chosenId);
  if (!perm) {
    emitToPlayer(io, controllerId, 'error', { code: 'INVALID_SELECTION', message: 'That creature can no longer be beamed up.' });
    return true;
  }
  const permName = String(perm.card?.name || 'creature');
  // B43: the return itself is deferred to finalizeGraveyardSpellCast (commitBeamMeUpReturnCost).
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`, gameId, from: 'system',
    message: `${getPlayerName(game, controllerId)} chooses to beam up ${permName} (returned to hand when the cast completes) to cast ${cardName}.`, ts: Date.now(),
  });
  const result = continueCastFromGraveyardAbility({
    gameId, game, io, playerId: controllerId, cardId,
    abilityId: String(stepAny?.abilityId || 'beam-me-up'),
    targets: Array.isArray(stepAny?.targetsForCast) ? stepAny.targetsForCast : undefined,
    discardedCardIds: idList(stepAny?.discardedCardIdsForCost),
    exiledCardIdsFromHandForCost: idList(stepAny?.exiledCardIdsFromHandForCost),
    exiledCardIdsFromGraveyardForCost: idList(stepAny?.exiledCardIdsFromGraveyardForCost),
    sacrificedPermanentIdsForCost: idList(stepAny?.sacrificedPermanentIdsForCost),
    beamedUpPermanentIdsForCost: [chosenId],
    xValue: Number.isFinite(Number(stepAny?.xValue)) ? Math.max(0, Math.floor(Number(stepAny.xValue))) : undefined,
    emitError: (payload) => emitToPlayer(io, controllerId as any, 'error', payload),
  });
  if (result !== 'error') broadcastGame(io, game, gameId);
  return true;
}
