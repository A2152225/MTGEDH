import type { GameContext } from "../context.js";

/**
 * Phase out a permanent
 */
export function phaseOut(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent && !permanent.phasedOut) {
    permanent.phasedOut = true;
    permanent.phaseOutController = permanent.controller;
    ctx.bumpSeq();
    return true;
  }
  return false;
}

/**
 * Phase in a permanent
 */
export function phaseIn(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent && permanent.phasedOut) {
    permanent.phasedOut = false;
    delete permanent.phaseOutController;
    ctx.bumpSeq();
    return true;
  }
  return false;
}

/**
 * Phase in all permanents for a player (at beginning of untap step)
 */
export function phaseInAllForPlayer(ctx: GameContext, playerId: string): string[] {
  const battlefield = ctx.state?.battlefield || [];
  const phasedIn: string[] = [];
  
  for (const permanent of battlefield) {
    if (permanent?.phasedOut && permanent?.phaseOutController === playerId) {
      permanent.phasedOut = false;
      delete permanent.phaseOutController;
      phasedIn.push(permanent.card?.name || permanent.id);
    }
  }
  
  if (phasedIn.length > 0) {
    ctx.bumpSeq();
  }
  
  return phasedIn;
}

/**
 * Apply Teferi's Protection effect
 * - Your life total can't change
 * - You have protection from everything
 * - All permanents you control phase out
 */
export function applyTeferisProtection(ctx: GameContext, playerId: string): {
  phasedOut: string[];
  protectionApplied: boolean;
} {
  const battlefield = ctx.state?.battlefield || [];
  const phasedOut: string[] = [];
  
  // Phase out all permanents controlled by player
  for (const permanent of battlefield) {
    if (permanent?.controller === playerId && !permanent.phasedOut) {
      permanent.phasedOut = true;
      permanent.phaseOutController = playerId;
      permanent.teferisProtection = true; // Mark for special handling
      phasedOut.push(permanent.card?.name || permanent.id);
    }
  }
  
  // Set player protection flag (life can't change, protection from everything)
  ctx.state.playerProtection = ctx.state.playerProtection || {};
  ctx.state.playerProtection[playerId] = {
    teferisProtection: true,
    lifeCannotChange: true,
    protectionFromEverything: true,
    expiresAtCleanup: true, // Expires at next cleanup step
  };
  
  if (phasedOut.length > 0) {
    ctx.bumpSeq();
  }
  
  return { phasedOut, protectionApplied: true };
}

/**
 * Check if player has protection from life changes
 */
export function playerLifeCanChange(ctx: GameContext, playerId: string): boolean {
  const protection = ctx.state?.playerProtection?.[playerId];
  return !protection?.lifeCannotChange;
}

/**
 * Check if player has protection from everything
 */
export function playerHasProtectionFromEverything(ctx: GameContext, playerId: string): boolean {
  const protection = ctx.state?.playerProtection?.[playerId];
  return !!protection?.protectionFromEverything;
}

/**
 * Clear expired protections (at cleanup step)
 */
export function clearExpiredProtections(ctx: GameContext): void {
  if (!ctx.state.playerProtection) return;
  
  for (const playerId of Object.keys(ctx.state.playerProtection)) {
    const protection = ctx.state.playerProtection[playerId];
    if (protection?.expiresAtCleanup) {
      delete ctx.state.playerProtection[playerId];
      
      // Phase in permanents that were phased out by Teferi's Protection
      const battlefield = ctx.state?.battlefield || [];
      for (const permanent of battlefield) {
        if (permanent?.phaseOutController === playerId && permanent?.teferisProtection) {
          permanent.phasedOut = false;
          delete permanent.phaseOutController;
          delete permanent.teferisProtection;
        }
      }
    }
  }
  
  ctx.bumpSeq();
}
