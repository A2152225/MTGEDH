// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: isPhasedOut / getActivePermanents / getActiveControlledPermanents /
// countCreatures / calculateDevotion (phased-out-aware battlefield queries).
// Public entry symbols: isPhasedOut, getActivePermanents, getActiveControlledPermanents,
// countCreatures, calculateDevotion.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { countDevotionAmongPermanents } from "../../../../../shared/src/devotionCount.js";

/**
 * Check if a permanent is phased out (and should be ignored)
 */
export function isPhasedOut(permanent: any): boolean {
  return !!permanent?.phasedOut;
}

/**
 * Get all non-phased-out permanents on the battlefield
 */
export function getActivePermanents(ctx: GameContext): any[] {
  const battlefield = ctx.state?.battlefield || [];
  return battlefield.filter((p: any) => p && !isPhasedOut(p));
}

/**
 * Get all non-phased-out permanents controlled by a player
 */
export function getActiveControlledPermanents(ctx: GameContext, playerId: string): any[] {
  return getActivePermanents(ctx).filter((p: any) => p.controller === playerId);
}

/**
 * Count creatures on battlefield (excluding phased out)
 */
export function countCreatures(ctx: GameContext, playerId?: string): number {
  const permanents = playerId 
    ? getActiveControlledPermanents(ctx, playerId)
    : getActivePermanents(ctx);
  
  return permanents.filter((p: any) => 
    (p.card?.type_line || "").toLowerCase().includes("creature")
  ).length;
}

/**
 * Calculate devotion to a color (excluding phased out permanents)
 */
export function calculateDevotion(ctx: GameContext, playerId: string, color: string): number {
  return countDevotionAmongPermanents(getActiveControlledPermanents(ctx, playerId), playerId, [color]);
}
