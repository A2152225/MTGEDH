/**
 * socket/ai-handlers/aiDamageDivisionChoice.ts
 *
 * AI / self-play answer for DAMAGE_DIVISION. Assigns at least 1 damage to each
 * chosen target (CR 601.2d) and splits the remainder as evenly as possible,
 * earlier targets taking the extra when the total does not divide evenly.
 */

import { buildEvenDamageDivision, normalizeDamageDivisionTargetIds } from '../../state/modules/dividedDamageDivision.js';

export function chooseAIDamageDivisionSelection(_game: any, _playerId: string, step: any): Record<string, number> | null {
  const targetIds = normalizeDamageDivisionTargetIds(
    Array.isArray(step?.validTargets) ? step.validTargets : [],
  );
  if (targetIds.length === 0) return null;
  const totalRaw = Number(step?.totalAmount ?? 0);
  const total = Number.isFinite(totalRaw) && totalRaw > 0 ? Math.floor(totalRaw) : targetIds.length;
  return buildEvenDamageDivision(targetIds, total);
}
