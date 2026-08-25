// server/src/state/modules/turn-handlers/turnCombatDamageLifeGain.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: applyLifeGainViaProcessLifeChange (lifelink combat path).
// Public entry symbols: applyLifeGainViaProcessLifeChange.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { processLifeChange } from "../game-state-effects.js";
import { triggerLifeGainEffects } from "../../utils.js";
import { debugWarn } from "../../../utils/debug.js";

export function applyLifeGainViaProcessLifeChange(
  ctx: GameContext,
  playerId: PlayerID,
  amount: number,
  source?: string
): { actualChange: number; message: string } {
  if (amount <= 0) {
    return { actualChange: 0, message: 'No life to gain' };
  }

  const state = (ctx as any).state;
  const startingLife = state?.startingLife || 40;
  const currentLife = state?.life?.[playerId] ?? startingLife;

  const result = processLifeChange(ctx, playerId, amount, true);
  if (result.prevented || result.finalAmount === 0) {
    return {
      actualChange: 0,
      message: result.reason ? `Life gain prevented: ${result.reason}` : 'Life gain prevented',
    };
  }

  if (!state.life) state.life = {};
  state.life[playerId] = currentLife + result.finalAmount;

  // Track life gained/lost this turn (used by intervening-if clauses like "if you gained 3 or more life this turn").
  try {
    if (result.finalAmount > 0) {
      (state as any).lifeGainedThisTurn = (state as any).lifeGainedThisTurn || {};
      (state as any).lifeGainedThisTurn[playerId] = ((state as any).lifeGainedThisTurn[playerId] || 0) + result.finalAmount;
    } else if (result.finalAmount < 0) {
      (state as any).lifeLostThisTurn = (state as any).lifeLostThisTurn || {};
      (state as any).lifeLostThisTurn[playerId] = ((state as any).lifeLostThisTurn[playerId] || 0) + Math.abs(result.finalAmount);
    }
  } catch {}

  const player = (state.players || []).find((p: any) => p.id === playerId);
  if (player) {
    player.life = state.life[playerId];
  }

  // Preserve the existing heuristic life-gain triggers behavior.
  // Do NOT trigger if the gain became loss (e.g., Tainted Remedy).
  if (result.finalAmount > 0) {
    try {
      triggerLifeGainEffects(state, playerId, result.finalAmount);
    } catch (err) {
      debugWarn(1, '[dealCombatDamage] Error triggering life gain effects:', err);
    }
  }

  if (result.finalAmount < 0) {
    const lost = Math.abs(result.finalAmount);
    return {
      actualChange: result.finalAmount,
      message: source
        ? `Lost ${lost} life from ${source}${result.reason ? ` (${result.reason})` : ''}`
        : `Lost ${lost} life${result.reason ? ` (${result.reason})` : ''}`,
    };
  }

  return {
    actualChange: result.finalAmount,
    message: source ? `Gained ${result.finalAmount} life from ${source}` : `Gained ${result.finalAmount} life`,
  };
}
