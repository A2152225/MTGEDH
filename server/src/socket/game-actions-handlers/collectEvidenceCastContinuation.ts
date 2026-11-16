// server/src/socket/game-actions-handlers/collectEvidenceCastContinuation.ts
// Helpers for Detective's Phoenix (graveyard bestow + collect evidence N):
// map the extra cost onto the existing collect-evidence picker fields, and
// decide whether a cancelled picker should abort the cast or decline-and-continue.
// Public: toCollectEvidenceAdditionalCost, shouldAbortCastOnCollectEvidenceCancel,
//   handleCollectEvidenceCastCancel.

import { resumePlayerCastSpellFromHand } from "../resolutionSyntheticCastSocketUtils.js";
import { broadcastGame, getPlayerName } from "../util.js";

export function toCollectEvidenceAdditionalCost(required: number, mandatory: boolean = true): {
  type: 'collect_evidence';
  collectEvidenceValue: number;
  collectEvidenceIsOptional: boolean;
  mandatory: boolean;
  amount: number;
} {
  const value = Math.max(1, Math.floor(Number(required || 0)));
  return {
    type: 'collect_evidence',
    collectEvidenceValue: value,
    collectEvidenceIsOptional: !mandatory,
    mandatory,
    amount: value,
  };
}

/**
 * Optional collect-evidence (submit 0 / cancel) declines and continues the cast.
 * Mandatory evidence (Phoenix graveyard bestow) cancels the whole cast.
 */
export function shouldAbortCastOnCollectEvidenceCancel(step: any): boolean {
  if (!step) return false;
  const purpose = String(step.purpose || '').trim();
  if (purpose !== 'collectEvidence') return false;
  if (step.collectEvidenceIsOptional === true) return false;
  if (step.mandatory === false) return false;
  const minTargets = Number(step.minTargets);
  if (Number.isFinite(minTargets) && minTargets <= 0) return false;
  return step.mandatory === true || step.collectEvidenceIsOptional === false;
}

/** Returns true when the cancel was fully handled (abort or decline-and-continue). */
export async function handleCollectEvidenceCastCancel(
  io: any,
  game: any,
  gameId: string,
  pid: string,
  step: any,
  stepData: any,
): Promise<boolean> {
  if (shouldAbortCastOnCollectEvidenceCancel(stepData)) {
    try {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${String(stepData?.cardName || step?.sourceName || 'Spell')}: ${getPlayerName(game, pid)} cancelled collecting evidence and backed out of the cast.`,
        ts: Date.now(),
      });
    } catch { /* chat is best-effort */ }
    if (typeof game?.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  const castArgs = stepData?.castSpellFromHandArgs;
  if (castArgs && typeof castArgs === 'object' && castArgs.cardId) {
    const basePayment = Array.isArray(castArgs.payment) ? castArgs.payment : [];
    const alreadyMarked = basePayment.some((item: any) => item && item.collectEvidenceResolved === true);
    const paymentWithMarker = alreadyMarked
      ? basePayment
      : [...basePayment, { collectEvidenceResolved: true, collectEvidenceDeclined: true, evidenceCollected: false }];
    await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
      cardId: String(castArgs.cardId),
      targets: castArgs.targets,
      payment: paymentWithMarker,
      xValue: castArgs.xValue,
      alternateCostId: castArgs.alternateCostId,
      convokeTappedCreatures: castArgs.convokeTappedCreatures,
    });
    return true;
  }
  return false;
}
