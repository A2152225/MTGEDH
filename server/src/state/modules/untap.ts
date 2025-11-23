// server/src/state/modules/untap.ts
// Untap step logic with support for untap prevention

import type { GameContext } from "../context";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Check if a permanent is a nonbasic land
 */
function isNonBasicLand(perm: any): boolean {
  const typeLine = String(perm.card?.type_line || '').toLowerCase();
  
  // Check if it's a land
  if (!typeLine.includes('land')) {
    return false;
  }
  
  // Check if it's basic
  const isBasic = 
    typeLine.includes('basic') ||
    (typeLine.includes('plains') && !typeLine.includes('—')) ||
    (typeLine.includes('island') && !typeLine.includes('—')) ||
    (typeLine.includes('swamp') && !typeLine.includes('—')) ||
    (typeLine.includes('mountain') && !typeLine.includes('—')) ||
    (typeLine.includes('forest') && !typeLine.includes('—'));
  
  return !isBasic;
}

/**
 * Apply the untap step for the active player
 * 
 * Handles:
 * - stunCounters: decrements one counter instead of untapping
 * - doesNotUntapNext: clears flag and doesn't untap
 * - doesNotUntapDuringUntapStep: doesn't untap (continuous effect)
 * - nonbasicLandsDoNotUntap: global effect preventing nonbasic land untap
 */
export function applyUntapStep(ctx: GameContext): void {
  const activePlayer = ctx.state.turnPlayer;
  
  if (!activePlayer) {
    console.warn(`${ts()} [applyUntapStep] No active player`);
    return;
  }
  
  // Check for global "nonbasic lands don't untap" effect
  // (stored as state flag for now; can be extended to static effects system later)
  const nonbasicLandsDoNotUntap = !!(ctx.state as any).nonbasicLandsDoNotUntap;
  
  let untappedCount = 0;
  let skippedCount = 0;
  
  for (const perm of ctx.state.battlefield) {
    // Only untap permanents controlled by the active player
    if (perm.controller !== activePlayer) {
      continue;
    }
    
    // Skip if not tapped
    if (!perm.tapped) {
      continue;
    }
    
    // Handle stun counters
    if (typeof perm.stunCounters === 'number' && perm.stunCounters > 0) {
      perm.stunCounters--;
      skippedCount++;
      console.log(`${ts()} [applyUntapStep] ${perm.id} has stun counter, decremented to ${perm.stunCounters}`);
      continue;
    }
    
    // Handle "doesn't untap during your next untap step"
    if (perm.doesNotUntapNext) {
      perm.doesNotUntapNext = false;
      skippedCount++;
      console.log(`${ts()} [applyUntapStep] ${perm.id} has doesNotUntapNext, cleared flag`);
      continue;
    }
    
    // Handle "doesn't untap during its controller's untap step" (continuous)
    if (perm.doesNotUntapDuringUntapStep) {
      skippedCount++;
      console.log(`${ts()} [applyUntapStep] ${perm.id} has doesNotUntapDuringUntapStep`);
      continue;
    }
    
    // Handle global nonbasic lands effect
    if (nonbasicLandsDoNotUntap && isNonBasicLand(perm)) {
      skippedCount++;
      console.log(`${ts()} [applyUntapStep] ${perm.id} is nonbasic land, affected by global effect`);
      continue;
    }
    
    // Untap the permanent
    perm.tapped = false;
    untappedCount++;
  }
  
  if (untappedCount > 0 || skippedCount > 0) {
    ctx.bumpSeq();
  }
  
  console.log(`${ts()} [applyUntapStep] Untapped ${untappedCount} permanents for ${activePlayer}, skipped ${skippedCount}`);
}

export default {
  applyUntapStep,
};
