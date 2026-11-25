/**
 * socket/resolution-handlers/resumeTargetedTriggeredAbilityAfterTargets.ts
 *
 * Shared tail used once a triggered ability's targets (and any CR 601.2d damage
 * division) are locked in: run the inline counter-then-draw shortcut or
 * executeTriggerEffect, drop the stack item so resolveTopOfStack cannot
 * double-apply, then run SBAs.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import type { GameContext } from "../../state/context.js";
import { executeTriggerEffect } from "../../state/modules/stackExecuteTriggerEffectUtils.js";
import { resolveTriggerStackItemEffectText } from "../../state/modules/stackResolveTriggeredAbilityOrchestratorUtils.js";
import { runSBA } from "../../state/modules/counters_tokens-handlers/countersTokensStateBasedActions.js";
import { drawCards as drawCardsFromZones } from "../../state/modules/zones.js";
import { contextHasBlockingNonPaymentResolutionSteps } from "../../state/resolution/resolutionQueueGameIds.js";
import { ResolutionQueueManager } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { broadcastGame } from "../util.js";
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';

function runStateBasedActionsAfterFinishedAbility(ctx: any): void {
  if (!ctx || contextHasBlockingNonPaymentResolutionSteps(ctx)) return;
  if (typeof ctx.bumpSeq !== "function") ctx.bumpSeq = () => {};
  try {
    runSBA(ctx);
  } catch (err) {
    debugWarn(1, "[Resolution] Error running SBA after targeted ability:", err);
  }
}

function unresolvedBlockingStepIds(gameId: string, exceptStepId: string): Set<string> {
  const ids = new Set<string>();
  try {
    const queue: any = ResolutionQueueManager.getQueue(gameId);
    const steps = [queue?.activeStep, ...(Array.isArray(queue?.steps) ? queue.steps : [])];
    for (const s of steps) {
      if (!s || s.completed === true || s.resolved === true || s.status === 'completed' || s.status === 'cancelled' || s.status === 'timed_out') continue;
      if (String(s.type || '') === 'mana_payment_choice') continue;
      const id = String(s.id || '');
      if (id && id !== exceptStepId) ids.add(id);
    }
  } catch (err) { reportHookFailure('resolution.queueScan', err, { source: 'resumeTargetedTriggeredAbilityAfterTargets' }); }
  return ids;
}

function runStateBasedActionsUnlessEffectQueuedChoice(ctx: any, gameId: string, stepId: string, before: Set<string>): void {
  const after = unresolvedBlockingStepIds(gameId, stepId);
  for (const id of after) if (!before.has(id)) return;
  if (typeof ctx.bumpSeq !== "function") ctx.bumpSeq = () => {};
  try {
    runSBA(ctx);
  } catch (err) {
    debugWarn(1, "[Resolution] Error running SBA after targeted trigger:", err);
  }
}

export function resumeTargetedTriggeredAbilityAfterTargets(args: {
  readonly io: Server;
  readonly game: any;
  readonly gameId: string;
  readonly stepId?: string;
  readonly triggerItem: any;
  readonly triggerStackItemId?: string;
  readonly sourceName: string;
  readonly description: string;
  readonly controller: string;
}): void {
  const { io, game, gameId, triggerItem } = args;
  const sourceName = String(args.sourceName || triggerItem?.sourceName || 'Triggered ability');
  const description = String(args.description || triggerItem?.description || '');
  const controller = String(args.controller || triggerItem?.controller || '');
  const triggerStackItemId = String(args.triggerStackItemId || triggerItem?.id || '').trim();
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

    for (const targetId of triggerItem.targets || []) {
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

  const answeredStepId = String(args.stepId || '');
  const blockingBeforeEffect = unresolvedBlockingStepIds(gameId, answeredStepId);
  executeTriggerEffect(ctx as any, controller as PlayerID, sourceName, effectText, triggerItem);

  if (triggerStackItemId && Array.isArray(game.state?.stack)) {
    const index = game.state.stack.findIndex((item: any) => item && String(item.id || '') === triggerStackItemId);
    if (index >= 0) game.state.stack.splice(index, 1);
  }

  runStateBasedActionsUnlessEffectQueuedChoice(ctx, gameId, answeredStepId, blockingBeforeEffect);
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
  broadcastGame(io, game, gameId);
}
