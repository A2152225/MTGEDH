/**
 * triggerTakeExtraTurnUtils.ts
 *
 * Generic trigger-effect execute for isolated "take an extra turn after this one"
 * (Regenerations Restored reflexive exile, Time Warp-style trigger clauses).
 * Entry: tryApplyTakeExtraTurnFromTriggerText
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { addExtraTurn } from './turn.js';

export function tryApplyTakeExtraTurnFromTriggerText(
  ctx: GameContext,
  controller: PlayerID,
  description: string,
  sourceName: string,
): boolean {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  if (!/^(?:you\s+)?take an extra turn after this one\.?$/i.test(text)) {
    return false;
  }
  addExtraTurn(ctx, String(controller || ''), sourceName);
  return true;
}
