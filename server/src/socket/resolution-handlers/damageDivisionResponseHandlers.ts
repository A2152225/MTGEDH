/**
 * socket/resolution-handlers/damageDivisionResponseHandlers.ts
 *
 * DAMAGE_DIVISION: validate the CR 601.2d assignment, stamp it on the pending cast
 * (and card) so the stack item / replay event can carry it, then resume the pending
 * spell's mana-payment prompt.
 */

import type { Server } from "socket.io";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { validateDamageDivision, stampDamageDivisionOnHost } from "../../state/modules/dividedDamageDivision.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import { queuePendingCastManaPaymentAfterTargets } from "./queuePendingCastManaPaymentAfterTargets.js";
import { resumeTargetedTriggeredAbilityAfterTargets } from "./resumeTargetedTriggeredAbilityAfterTargets.js";
import { appendEvent } from "../../db/index.js";

export function handleDamageDivisionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const stepData = step as any;
  const totalAmount = Number(stepData.totalAmount ?? 0);
  const minPerTarget = Math.max(1, Number(stepData.minPerTarget ?? 1));
  const validTargetIds = (Array.isArray(stepData.validTargets) ? stepData.validTargets : [])
    .map((entry: any) => String(entry?.id || '').trim())
    .filter(Boolean);

  const checked = validateDamageDivision({
    distribution: response.selections,
    targetIds: validTargetIds,
    total: totalAmount,
    minPerTarget,
  });
  if (checked.ok === false) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_DISTRIBUTION',
      message: checked.message,
    });
    return;
  }

  const effectId = String(stepData.effectId || stepData.spellCastContext?.effectId || '').trim();
  if (stepData.targetedTriggeredAbility === true || String(stepData.triggerStackItemId || '').trim()) {
    const stackItemId = String(stepData.triggerStackItemId || stepData.sourceId || '').trim();
    const stackItem = stackItemId && Array.isArray(game.state?.stack)
      ? game.state.stack.find((item: any) => item && String(item.id || '') === stackItemId)
      : undefined;
    if (stackItem) stampDamageDivisionOnHost(stackItem, checked.division);
    const triggerItem = {
      ...(stepData.triggerItem || {}),
      targets: validTargetIds,
      damageDivisionByTargetId: checked.division,
    };
    stampDamageDivisionOnHost(triggerItem, checked.division);
    if (stackItemId) {
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'assignTriggeredAbilityTargets', {
          triggerStackItemId: stackItemId,
          targets: validTargetIds,
          damageDivisionByTargetId: checked.division,
          ...(String((step as any).id || '').trim() ? { resolvedStepId: String((step as any).id).trim() } : {}),
        });
      } catch (err) {
        // replay persistence is best-effort
      }
    }
    const sourceName = String(step.sourceName || stepData.targetedTriggeredAbilitySourceName || triggerItem.sourceName || 'a triggered ability');
    const parts = validTargetIds.map((id: string) => `${checked.division[id]} to ${id}`).join(', ');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} divided ${totalAmount} damage with ${sourceName} (${parts}).`,
      ts: Date.now(),
    });
    resumeTargetedTriggeredAbilityAfterTargets({
      io,
      game,
      gameId,
      stepId: String((step as any).id || ''),
      triggerItem,
      triggerStackItemId: stackItemId,
      sourceName,
      description: String(stepData.targetedTriggeredAbilityDescription || triggerItem.description || ''),
      controller: String(stepData.targetedTriggeredAbilityController || triggerItem.controller || pid),
    });
    return;
  }

  const pendingCast = effectId ? (game.state as any)?.pendingSpellCasts?.[effectId] : undefined;
  if (pendingCast) {
    stampDamageDivisionOnHost(pendingCast, checked.division);
    const spellCastContext = stepData.spellCastContext || {
      cardId: stepData.sourceId || pendingCast.cardId,
      cardName: stepData.sourceName || pendingCast.cardName,
      effectId,
      oracleText: pendingCast.card?.oracle_text || pendingCast.oracleText,
      imageUrl: stepData.sourceImage || pendingCast.imageUrl,
      manaCost: pendingCast.manaCost,
    };
    const finalTargets = Array.isArray(pendingCast.targets)
      ? pendingCast.targets.map((targetId: any) => String(typeof targetId === 'string' ? targetId : targetId?.id || '')).filter(Boolean)
      : validTargetIds;
    queuePendingCastManaPaymentAfterTargets({
      io,
      game,
      gameId,
      playerId: String(pid),
      pendingCast,
      spellCastContext,
      finalTargets,
    });
  } else if (Array.isArray((game.state as any)?.stack)) {
    const sourceId = String(stepData.sourceId || '').trim();
    const stackItem = (game.state as any).stack.find((item: any) =>
      String(item?.id || '') === sourceId || String(item?.card?.id || '') === sourceId,
    );
    if (stackItem) stampDamageDivisionOnHost(stackItem, checked.division);
  }

  const sourceName = String(step.sourceName || stepData.title || 'a spell');
  const parts = validTargetIds
    .map((id: string) => `${checked.division[id]} to ${id}`)
    .join(', ');
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} divided ${totalAmount} damage with ${sourceName} (${parts}).`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}
