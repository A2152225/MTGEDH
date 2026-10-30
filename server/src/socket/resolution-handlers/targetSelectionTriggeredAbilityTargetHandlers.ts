/**
 * socket/resolution-handlers/targetSelectionTriggeredAbilityTargetHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the two "a trigger's targets were just chosen, now run the trigger" branches -
 * `targetedTriggeredAbility` (write the targets onto the stack item, persist
 * assignTriggeredAbilityTargets, then either take the inline "+1/+1 counters, then draw" shortcut or
 * hand the effect text to executeTriggerEffect) and `damageReceivedTrigger` (resolve the damage
 * trigger against the chosen target and cascade any damage-received triggers it causes).
 * Public entry symbols: handleTargetedTriggeredAbilityTargetSelection,
 * handleDamageReceivedTriggerTargetSelection.
 *
 * Both branches always returned, so each call site is `handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import { executeTriggerEffect } from "../../state/modules/stackExecuteTriggerEffectUtils.js";
import { resolveTriggerStackItemEffectText } from "../../state/modules/stackResolveTriggeredAbilityOrchestratorUtils.js";
import {
  dispatchDamageReceivedTrigger,
  processDamageReceivedTriggers,
  resolveDamageTrigger,
  type DamageTriggerInfo,
} from "../../state/modules/triggers/damage-received.js";
import { runSBA } from "../../state/modules/counters_tokens-handlers/countersTokensStateBasedActions.js";
import { drawCards as drawCardsFromZones } from "../../state/modules/zones.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { contextHasBlockingNonPaymentResolutionSteps } from "../../state/resolution/resolutionQueueGameIds.js";
import { debugWarn } from "../../utils/debug.js";
import { broadcastGame } from "../util.js";

/** CR 704.3: after the ability finishes and before the next player gets priority. */
function runStateBasedActionsAfterFinishedAbility(ctx: any): void {
  if (!ctx || contextHasBlockingNonPaymentResolutionSteps(ctx)) return;
  if (typeof ctx.bumpSeq !== "function") ctx.bumpSeq = () => {};
  try {
    runSBA(ctx);
  } catch (err) {
    debugWarn(1, "[Resolution] Error running SBA after targeted ability:", err);
  }
}

/** Targets chosen for a triggered ability waiting on the stack. */
export function handleTargetedTriggeredAbilityTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const triggerTargets = selections.map((value: any) => String(value)).filter(Boolean);
  const sourceName = String(stepAny?.targetedTriggeredAbilitySourceName || step.sourceName || stepAny?.triggerItem?.sourceName || 'Triggered ability');
  const description = String(stepAny?.targetedTriggeredAbilityDescription || stepAny?.triggerItem?.description || '');
  const controller = String(stepAny?.targetedTriggeredAbilityController || stepAny?.triggerItem?.controller || pid);
  const triggerStackItemId = String(step.sourceId || stepAny?.triggerItem?.id || '').trim();
  if (triggerStackItemId) {
    if (Array.isArray(game.state?.stack)) {
      const stackItem = game.state.stack.find((item: any) => item && String(item.id || '') === triggerStackItemId);
      if (stackItem) {
        stackItem.targets = triggerTargets;
      }
    }
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'assignTriggeredAbilityTargets', {
        triggerStackItemId,
        targets: triggerTargets,
        ...(String((step as any).id || '').trim()
          ? { resolvedStepId: String((step as any).id).trim() }
          : {}),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(assignTriggeredAbilityTargets) failed:', err);
    }
  }
  const liveStackItem = triggerStackItemId && Array.isArray(game.state?.stack)
    ? game.state.stack.find((item: any) => item && String(item.id || '') === triggerStackItemId)
    : undefined;
  const triggerItem = {
    ...(stepAny.triggerItem || {}),
    // Sacrifice snapshots ("the sacrificed creature's power") live on the stack item, not on the queued step copy.
    ...(Array.isArray((liveStackItem as any)?.lastSacrificedPermanents) && !Array.isArray(stepAny?.triggerItem?.lastSacrificedPermanents)
      ? { lastSacrificedPermanents: (liveStackItem as any).lastSacrificedPermanents }
      : {}),
    sourceName,
    description,
    controller,
    targets: triggerTargets,
    triggerType: stepAny?.triggerItem?.triggerType || stepAny?.targetedTriggeredAbilityTriggerType,
  };
  const effectText = resolveTriggerStackItemEffectText(triggerItem, { state: game.state });
  const ctx = ((game as any).ctx || game) as any;
  const lowerDescription = description.toLowerCase();

  ctx.gameId = ctx.gameId || gameId;
  ctx.io = ctx.io || io;
  ctx.state = game.state;

  const counterThenDrawMatch = lowerDescription.match(
    /put (a|an|one|two|three|four|five|\d+) \+1\/\+1 counters? on (?:up to (?:one|two|three|four|five|\d+) )?target creatures?, then draw (?:a|1) card/
  );
  if (counterThenDrawMatch) {
    const amountRaw = String(counterThenDrawMatch[1] || '1').toLowerCase();
    const wordToNumber: Record<string, number> = {
      a: 1,
      an: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
    };
    const parsedCounterCount = Number.parseInt(amountRaw, 10);
    const counterCount = wordToNumber[amountRaw] ?? (Number.isNaN(parsedCounterCount) ? 1 : parsedCounterCount);
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];

    for (const targetId of triggerItem.targets) {
      const targetPermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === String(targetId));
      if (!targetPermanent) continue;
      targetPermanent.counters = targetPermanent.counters || {};
      targetPermanent.counters['+1/+1'] = (targetPermanent.counters['+1/+1'] || 0) + counterCount;
    }

    if (typeof (game as any).drawCards === 'function') {
      (game as any).drawCards(controller, 1);
    } else {
      drawCardsFromZones(ctx, controller as PlayerID, 1);
    }

    runStateBasedActionsAfterFinishedAbility(ctx);
    broadcastGame(io, game, gameId);
    return;
  }

  executeTriggerEffect(ctx as any, controller as PlayerID, sourceName, effectText, triggerItem);

  // The effect has just been applied with its chosen targets. If the trigger's stack item is still on the
  // stack (reflexive "when you do" triggers are pushed before their target is chosen), drop it now so
  // resolveTopOfStack does not apply the same effect a second time (double Surtland Flinger damage).
  if (triggerStackItemId && Array.isArray(game.state?.stack)) {
    const index = game.state.stack.findIndex((item: any) => item && String(item.id || '') === triggerStackItemId);
    if (index >= 0) game.state.stack.splice(index, 1);
  }

  runStateBasedActionsAfterFinishedAbility(ctx);
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

/** Target chosen for a damage-received trigger (Brash Taunter, Boros Reckoner, etc.). */
export function handleDamageReceivedTriggerTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const selections = response.selections as string[];
  const stepAny = step as any;

  const damageTrigger = (stepAny?.damageTrigger || {}) as any;

  const triggerInfo: DamageTriggerInfo = {
    triggerId: String(damageTrigger.triggerId || step.id),
    sourceId: String(damageTrigger.sourceId || step.sourceId || ''),
    sourceName: String(damageTrigger.sourceName || step.sourceName || 'Damage Trigger'),
    controller: String(damageTrigger.controller || step.playerId || response.playerId || ''),
    damageAmount: Number(damageTrigger.damageAmount ?? (stepAny?.damageAmount ?? 0)),
    triggerType: 'dealt_damage',
    targetType: (String(damageTrigger.targetType || 'any') as any),
    targetRestriction: String(damageTrigger.targetRestriction || ''),
    effect: String(damageTrigger.effect || step.description || 'Deals damage'),
  };

  const targetId = String(selections[0] || '').trim();
  if (!targetId) {
    debugWarn(1, `[Resolution] damageReceivedTrigger missing selected target`);
    return;
  }

  const ctx: GameContext = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: () => {
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    },
    rng: (game as any).rng,
    gameId,
  } as any;

  const message = resolveDamageTrigger(ctx, triggerInfo, targetId);
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message,
    ts: Date.now(),
  });

  // If this dealt damage to a permanent, it may create additional damage-received triggers.
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const targetPerm = battlefield.find((p: any) => p && String(p.id) === targetId);
  if (targetPerm && triggerInfo.damageAmount > 0) {
    processDamageReceivedTriggers(ctx, targetPerm, triggerInfo.damageAmount, (nextTrigger) => {
      if (dispatchDamageReceivedTrigger(ctx as any, nextTrigger)) {
        return;
      }

      (game.state as any).pendingDamageTriggers = (game.state as any).pendingDamageTriggers || {};
      (game.state as any).pendingDamageTriggers[nextTrigger.triggerId] = {
        sourceId: nextTrigger.sourceId,
        sourceName: nextTrigger.sourceName,
        controller: nextTrigger.controller,
        damageAmount: nextTrigger.damageAmount,
        triggerType: 'dealt_damage',
        targetType: nextTrigger.targetType,
        effect: nextTrigger.effect,
        ...(nextTrigger.effectMode ? { effectMode: nextTrigger.effectMode } : {}),
        ...(nextTrigger.attackingPlayerId ? { attackingPlayerId: nextTrigger.attackingPlayerId } : {}),
        targetRestriction: nextTrigger.targetRestriction,
      };
    });

  }

  runStateBasedActionsAfterFinishedAbility(ctx);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
