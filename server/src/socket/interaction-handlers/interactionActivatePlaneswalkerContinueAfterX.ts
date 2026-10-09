/**
 * Origin parent: interactionActivatePlaneswalker.ts
 * Cluster: resume a +X / −X loyalty activation after X_VALUE_SELECTION.
 * Public: continuePlaneswalkerAbilityAfterChosenX
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { parseTargetRequirements } from "../../rules-engine/targeting.js";
import { buildActivatedAbilityValidTargets } from "../resolutionActivatedAbilityTargetingUtils.js";
import { getLoyaltyActivationLimit } from "../../state/modules/triggered-abilities";
import { triggerAbilityActivatedTriggers } from "../../state/modules/triggers/ability-activated.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { broadcastGame, getPlayerName } from "../util";

export function continuePlaneswalkerAbilityAfterChosenX(args: {
  io: Server;
  game: any;
  gameId: string;
  playerId: PlayerID;
  permanentId: string;
  cardName: string;
  abilityIndex: number;
  abilityText: string;
  isMinusX: boolean;
  xValue: number;
}): boolean {
  const { io, game, gameId, playerId, permanentId, cardName, abilityIndex, abilityText, isMinusX, xValue } = args;
  const battlefield = game.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
  if (!permanent) return false;

  const currentLoyalty = Number(permanent.counters?.loyalty || permanent.loyalty || 0);
  const loyaltyCost = isMinusX ? -Math.abs(xValue) : Math.abs(xValue);
  if (currentLoyalty + loyaltyCost < 0) return false;

  const activationsThisTurn = Number(permanent.loyaltyActivationsThisTurn || 0);
  const maxActivations = getLoyaltyActivationLimit(game.state, playerId);
  if (activationsThisTurn >= maxActivations) return false;
  permanent.loyaltyActivationsThisTurn = activationsThisTurn + 1;

  const loyaltyActivatedAbilityText = `${loyaltyCost >= 0 ? '+' : ''}${loyaltyCost}: ${abilityText}`;
  const targetReqs = parseTargetRequirements(abilityText, {
    gameState: game.state,
    controllerId: String(playerId),
    sourceName: cardName,
    sourcePermanent: permanent,
  });

  if (targetReqs.needsTargets) {
    const uniqueTargets = buildActivatedAbilityValidTargets(game, String(playerId), targetReqs, {
      sourcePermanentId: String(permanentId),
      abilityText,
    }).map((target) => ({ ...target, kind: target.type }));

    if (uniqueTargets.length < targetReqs.minTargets) return false;
    if (!(uniqueTargets.length === 0 && targetReqs.minTargets === 0)) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        description: `Choose ${targetReqs.targetDescription} for ${cardName}`,
        mandatory: targetReqs.minTargets > 0,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
        validTargets: uniqueTargets.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.kind === 'player' ? 'player' : (t.kind === 'graveyard_card' ? 'graveyard_card' : 'permanent'),
          controller: t.controller,
          imageUrl: t.imageUrl,
          life: (t as any).life,
          isOpponent: t.isOpponent,
        })),
        targetTypes: targetReqs.targetTypes,
        minTargets: targetReqs.minTargets,
        maxTargets: targetReqs.maxTargets,
        targetDescription: targetReqs.targetDescription,
        planeswalkerAbility: {
          abilityIndex,
          abilityText,
          loyaltyCost,
          currentLoyalty,
        },
      } as any);
      debug(2, `[planeswalker] After X=${xValue}, queued TARGET_SELECTION for ${cardName}`);
      broadcastGame(io, game, gameId);
      return true;
    }
  }

  const newLoyalty = currentLoyalty + loyaltyCost;
  permanent.counters = permanent.counters || {};
  permanent.counters.loyalty = newLoyalty;
  permanent.loyalty = newLoyalty;

  const stackItem = {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ability' as const,
    controller: playerId,
    source: permanentId,
    sourceName: cardName,
    description: abilityText,
    activatedAbilityText: loyaltyActivatedAbilityText,
    xValue,
    planeswalker: {
      oracleId: permanent?.card?.oracle_id,
      abilityIndex,
      loyaltyCost,
    },
  } as any;

  game.state.stack = game.state.stack || [];
  game.state.stack.push(stackItem);
  try {
    triggerAbilityActivatedTriggers(game as any, {
      activatedBy: playerId as any,
      sourcePermanentId: permanentId as any,
      isManaAbility: false,
      abilityText,
      stackItemId: stackItem.id,
    });
  } catch {}

  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  appendEvent(gameId, game.seq ?? 0, 'activatePlaneswalkerAbility', {
    playerId,
    permanentId,
    abilityIndex,
    loyaltyCost,
    newLoyalty,
    abilityText,
    activatedAbilityText: loyaltyActivatedAbilityText,
    xValue,
  });
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `⚡ ${getPlayerName(game, playerId)} activated ${cardName}'s [${loyaltyCost >= 0 ? '+' : ''}${loyaltyCost}] ability. (Loyalty: ${currentLoyalty} → ${newLoyalty})`,
    ts: Date.now(),
  });
  broadcastGame(io, game, gameId);
  return true;
}
