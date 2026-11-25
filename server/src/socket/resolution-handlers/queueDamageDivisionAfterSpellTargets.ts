/**
 * socket/resolution-handlers/queueDamageDivisionAfterSpellTargets.ts
 *
 * After a spell's targets are locked in, queue a DAMAGE_DIVISION prompt when the oracle
 * is "N/X damage divided as you choose" among two or more targets and the total is known
 * (CR 601.2d). Single-target, 1-each, skipInteractive, and already-valid maps are stamped
 * automatically with the even (or recorded) split so the stack item can carry the choice.
 */

import type { Server } from "socket.io";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { appendCastSpellContinuationEvent } from "../resolutionSyntheticCastSocketUtils.js";
import {
  describeDamageDivisionTargets,
  normalizeDamageDivisionTargetIds,
  shouldPromptDamageDivision,
  stampDamageDivisionOnHost,
} from "../../state/modules/dividedDamageDivision.js";

export function maybeQueueDamageDivisionAfterSpellTargets(args: {
  readonly io?: Server;
  readonly game: any;
  readonly gameId: string;
  readonly playerId: string;
  readonly pendingCast: any;
  readonly spellCastContext?: any;
  readonly finalTargets: readonly string[];
}): boolean {
  const { game, gameId, playerId: pid, pendingCast, spellCastContext } = args;
  if (!pendingCast || typeof pendingCast !== 'object') return false;

  const targetIds = normalizeDamageDivisionTargetIds(
    args.finalTargets.length > 0 ? args.finalTargets : pendingCast.targets,
  );
  const oracleText = pendingCast.card?.oracle_text || spellCastContext?.oracleText || pendingCast.oracleText || '';
  const xValue = pendingCast.xValue;
  const decision = shouldPromptDamageDivision({
    oracleText,
    targetIds,
    xValue,
    existingDivision: pendingCast.damageDivisionByTargetId || pendingCast.card?.damageDivisionByTargetId,
    skipInteractivePrompts: pendingCast.skipInteractivePrompts === true,
    gameOrState: game,
    sourceId: pendingCast.cardId || pendingCast.card?.id,
    sourcePermanent: pendingCast.card,
  });

  if (decision.autoDivision) {
    stampDamageDivisionOnHost(pendingCast, decision.autoDivision);
  }

  if (!decision.prompt || decision.total === null) {
    return false;
  }

  const existingStep = ResolutionQueueManager
    .getStepsForPlayer(gameId, pid as any)
    .find((step: any) =>
      step?.type === ResolutionStepType.DAMAGE_DIVISION &&
      String((step as any)?.effectId || (step as any)?.spellCastContext?.effectId || '') === String(spellCastContext?.effectId || pendingCast.effectId || ''),
    );
  if (existingStep) return true;

  const cardName = String(spellCastContext?.cardName || pendingCast.cardName || pendingCast.card?.name || 'spell');
  const cardId = String(spellCastContext?.cardId || pendingCast.cardId || pendingCast.card?.id || '');
  const effectId = spellCastContext?.effectId || pendingCast.effectId;
  const imageUrl = spellCastContext?.imageUrl || pendingCast.imageUrl;
  const validTargets = describeDamageDivisionTargets(game, targetIds);
  const total = decision.total;

  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.DAMAGE_DIVISION,
    playerId: pid as any,
    sourceId: cardId,
    sourceName: cardName,
    sourceImage: imageUrl,
    description: `Divide ${total} damage among the chosen targets for ${cardName}.`,
    mandatory: true,
    totalAmount: total,
    minPerTarget: 1,
    validTargets,
    message: `Divide ${total} damage among the chosen targets. Each target must receive at least 1 damage.`,
    title: `Divide damage — ${cardName}`,
    effectId,
    spellCastContext: spellCastContext || {
      cardId,
      cardName,
      effectId,
      oracleText,
      imageUrl,
    },
  } as any);

  appendCastSpellContinuationEvent(gameId, game, {
    playerId: pid,
    cardId,
    effectId,
    pendingSpellCast: {
      ...(pendingCast || {}),
    },
    queuedResolutionStep: {
      ...(step as any),
    },
  });

  debug(2, `[Resolution] Queued DAMAGE_DIVISION for ${cardName} (${total} among ${targetIds.length} targets)`);
  return true;
}
