/**
 * socket/resolution-handlers/queuePendingCastManaPaymentAfterTargets.ts
 *
 * Shared tail that queues MANA_PAYMENT_CHOICE once a pending spell's targets (and any
 * CR 601.2d damage division) are locked in. Extracted from handleSpellCastPaymentTargetSelection
 * so the damage-division response can resume the same payment path.
 */

import type { Server } from "socket.io";
import {
  ResolutionQueueManager,
  ResolutionStepType,
} from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { appendCastSpellContinuationEvent } from "../resolutionSyntheticCastSocketUtils.js";
import {
  buildPendingCastPaymentManaCost,
  buildPendingCastPaymentStepCostFields,
  buildSpellPaymentPresentationFields,
} from "./resolutionPendingCastPaymentPrompt.js";

export function queuePendingCastManaPaymentAfterTargets(args: {
  readonly io: Server;
  readonly game: any;
  readonly gameId: string;
  readonly playerId: string;
  readonly pendingCast: any;
  readonly spellCastContext: any;
  readonly finalTargets: readonly string[];
}): void {
  const { game, gameId, playerId: pid, pendingCast, spellCastContext, finalTargets } = args;
  const { cardId, cardName, manaCost, effectId, oracleText, imageUrl } = spellCastContext || {};

  let finalManaCost = buildPendingCastPaymentManaCost(pendingCast);
  let striveCostMessage = '';

  const cardOracleText = pendingCast?.card?.oracle_text || oracleText || '';
  const striveMatch = String(cardOracleText).match(/\bStrive\s*[—\-]\s*This spell costs\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)\s+more to cast for each target beyond the first/i);
  const lockedTargets = Array.isArray(finalTargets) ? finalTargets.map((targetId) => String(targetId)) : [];

  if (striveMatch && lockedTargets.length > 1) {
    const striveCostPer = striveMatch[1].trim();
    const additionalTargets = lockedTargets.length - 1;
    let additionalCost = '';
    for (let i = 0; i < additionalTargets; i++) {
      additionalCost += striveCostPer;
    }
    finalManaCost = finalManaCost + additionalCost;
    striveCostMessage = ` (Strive: +${striveCostPer} × ${additionalTargets} for ${lockedTargets.length} targets)`;
    debug(1, `[Resolution] Strive cost added: base ${manaCost} + ${additionalCost} = ${finalManaCost}`);
  }

  pendingCast.finalManaCost = finalManaCost;

  const existingPaymentStep = ResolutionQueueManager
    .getStepsForPlayer(gameId, pid as any)
    .find((s: any) =>
      s?.type === ResolutionStepType.MANA_PAYMENT_CHOICE &&
      (s as any)?.spellPaymentRequired === true &&
      String((s as any)?.effectId || '') === String(effectId)
    );

  if (!existingPaymentStep) {
    const paymentCostFields = buildPendingCastPaymentStepCostFields(
      pendingCast,
      String(pendingCast.manaCost || manaCost || ''),
      finalManaCost,
    );
    const paymentStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: pid as any,
      sourceId: cardId,
      sourceName: cardName,
      sourceImage: imageUrl,
      description: `Pay costs to cast ${cardName}.`,
      mandatory: true,

      spellPaymentRequired: true,
      cardId,
      cardName: cardName + striveCostMessage,
      manaCost: paymentCostFields.manaCost,
      xValue: pendingCast.xValue,
      effectId,
      targets: lockedTargets,
      imageUrl,
      costAdjustment: paymentCostFields.costAdjustment,
      costReduction: paymentCostFields.costReduction,
      convokeOptions: pendingCast.convokeOptions,
      forcedAlternateCostId: pendingCast.forcedAlternateCostId,
      ...buildSpellPaymentPresentationFields(pendingCast, { game, playerId: pid }),
    } as any);

    appendCastSpellContinuationEvent(gameId, game, {
      playerId: pid,
      cardId,
      effectId,
      pendingSpellCast: {
        ...(pendingCast || {}),
      },
      queuedResolutionStep: {
        ...(paymentStep as any),
      },
    });
  }

  debug(2, `[Resolution] Spell target selection complete for ${cardName}, requesting payment`);
}
