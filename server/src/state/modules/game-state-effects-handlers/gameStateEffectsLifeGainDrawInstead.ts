// Origin parent: server/src/state/modules/game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.ts
// Lich family: "If you would gain life, draw that many cards instead." Called from processLifeChange
// after amount replacements; draws the final amount and reports the gain as replaced.
// Public entry symbols: applyLifeGainDrawInstead.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { collectLifeGainDrawInsteadSpecsFromState } from "../replacementEffectSpec-handlers/replacementEffectSpecLifeGainDrawInsteadTemplates.js";
import { drawCards } from "../zones-handlers/zonesDrawCards.js";

export function applyLifeGainDrawInstead(
  ctx: GameContext,
  playerId: string,
  amount: number,
): { finalAmount: number; prevented: boolean; reason?: string } | null {
  if (!(Number(amount) > 0)) return null;
  const state = (ctx as any)?.state || ctx;
  const spec = collectLifeGainDrawInsteadSpecsFromState(state)
    .find((entry) => String(entry.sourceController || '') === String(playerId));
  if (!spec) return null;
  const count = Math.floor(Number(amount));
  try {
    drawCards(ctx, playerId as any, count);
  } catch {
    // Contexts without zones (resolver-only) still replace the gain; the draw is best-effort.
  }
  return { finalAmount: 0, prevented: true, reason: `${spec.sourceName}: drew ${count} card(s) instead of gaining life` };
}
