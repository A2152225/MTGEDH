/**
 * Origin parent: server/src/socket/ai-handlers/aiPriorityHandlers.ts
 *
 * Cluster moved: shouldQuietPassEmptyStackOffTurn — decides when off-turn empty
 * stack should skip tryAIResponseActions (stall hygiene). Opponent-MAIN flash
 * casting was disabled after strength smokes showed no edge (footgun). Smoke14
 * re-opens empty-stack END for v2 at bf≤24 (EOT removal/draw), not MAIN flash.
 * Smoke16 bf→32 unfiltered and smoke18 bf→48 role-gated both failed confirm —
 * keep unconditional bf≤24 only. Smoke27 life-gated (life≤15, bf≤40) cleared
 * 0–23 (40%) but confirm 24–47 was 25% (combined ~32%) — reverted.
 *
 * Public entry symbols: shouldQuietPassEmptyStackOffTurn, V2_OFFTURN_FLASH_MAX_BF.
 */

import type { Brain } from "./aiBrain.js";

/** Above this battlefield size, v2 also quiet-passes opponent main / end (stall risk). */
export const V2_OFFTURN_FLASH_MAX_BF = 24;

/**
 * True → skip response enumeration and pass.
 * False → caller may run tryAIResponseActions (stack non-empty, combat, or v2 end window).
 */
export function shouldQuietPassEmptyStackOffTurn(args: {
  stackEmpty: boolean;
  phase: string;
  step: string;
  brain: Brain;
  battlefieldSize: number;
}): boolean {
  if (!args.stackEmpty) return false;

  const phase = String(args.phase || '');
  const step = String(args.step || '');

  if (phase === 'beginning' || phase.includes('begin')) {
    return true;
  }

  if (phase === 'ending' || phase === 'end') {
    // v2 may take one empty-stack end-step answer on small boards (EOT interaction).
    // MAIN flash stays quiet (smoke7). Beginning stays quiet.
    if (args.brain === 'v2' && args.battlefieldSize <= V2_OFFTURN_FLASH_MAX_BF) {
      return false;
    }
    return true;
  }

  const isMain = phase.includes('main') || step.includes('main');
  if (isMain) {
    // Off-turn empty-stack flash casts were a footgun (smoke4–6 never edged v1).
    // Quiet-pass opponent MAIN for all brains; stack responses still enumerate.
    return true;
  }

  return false;
}
