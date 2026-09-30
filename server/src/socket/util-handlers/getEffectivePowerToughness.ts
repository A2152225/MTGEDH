// server/src/socket/util-handlers/getEffectivePowerToughness.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: getEffectivePower and getEffectiveToughness including counters
//   and continuous lord/anthem modifiers.
// Public entry symbols: getEffectivePower, getEffectiveToughness.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import { calculateAllPTBonuses } from "../../state/utils.js";
import { sumActiveTemporaryPTMods } from "../../state/modules/temporaryPtMods.js";
import { syncDerivedContinuousEffects } from "../../state/modules/staticEffectSpec.js";
import {
  getCurrentPowerToughness,
  sumUnmirroredOracleIrPtModifiers,
} from "../../state/modules/currentPowerToughness.js";
import { resolveOracleIrSetPowerToughness } from "../../state/modules/oracleIrSetPowerToughness.js";
import { sumLongDurationPtModifiers } from "../../state/modules/longDurationPtModifiers.js";

// Oracle IR "gets +X/+Y until end of turn" pumps are stored as `modifiers` entries of type
// powerToughness AND mirrored into temporaryPTMods. Adding both double-counted the pump
// (e.g. AI fight scoring saw a +2/+2 pump as +4/+4). Only the not-yet-mirrored ones are
// added on top of temporaryPTMods (sumUnmirroredOracleIrPtModifiers).
function sumPtModifiersWithoutMirrorDoubleCount(permanent: any, gameState?: any): { power: number; toughness: number } {
  const pending = sumUnmirroredOracleIrPtModifiers(permanent);
  // end-of-turn entries are handled above (mirror-aware); longer-lasting ones (until your next
  // turn, until end of combat, permanent) are counted while still active.
  const longLasting = sumLongDurationPtModifiers(permanent, gameState);
  return { power: pending.power + longLasting.power, toughness: pending.toughness + longLasting.toughness };
}

/**
 * Calculate a creature's effective power including:
 * - Base power (from card data or basePower property)
 * - +1/+1 and -1/-1 counters
 * - Other P/T modifying counters (+1/+0, +2/+2, etc.)
 * - Equipment, auras, anthem effects, and other modifiers
 * - When gameState is provided: continuous lord/anthem effects (Morophon, etc.)
 * 
 * @param permanent - The creature permanent to calculate power for
 * @param gameState - Optional game state for continuous effects (lords via calculateAllPTBonuses)
 * @returns The effective power value
 */
export function getEffectivePower(permanent: any, gameState?: any): number {
  // Prefer pre-calculated view values only when we are not recomputing with state
  // (raw BF may have a stale effectivePower that omits lords).
  if (!gameState && typeof permanent.effectivePower === 'number') {
    return permanent.effectivePower;
  }
  
  const card = permanent.card;
  let basePower = permanent.basePower ?? (parseInt(String(card?.power ?? '0'), 10) || 0);
  
  // Handle star (*) power - variable power creatures like Tarmogoyf, Morophon
  if (typeof card?.power === 'string' && card.power.includes('*')) {
    // If basePower is set, use that as it should have been calculated already
    if (typeof permanent.basePower === 'number') {
      basePower = permanent.basePower;
    }
  }
  
  // Add +1/+1 counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  // Subtract -1/-1 counters
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  const counterDelta = plusCounters - minusCounters;
  
  // Check for other counter types that affect power
  // Examples: +1/+0, +2/+2, +1/+2, etc.
  let otherCounterPower = 0;
  if (permanent.counters) {
    for (const [counterType, count] of Object.entries(permanent.counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      // Parse counter types like "+1/+0", "+2/+2", etc.
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        const pMod = parseInt(counterMatch[1], 10);
        otherCounterPower += pMod * (count as number);
      }
    }
  }

  const irSetPT = resolveOracleIrSetPowerToughness(permanent);
  if (typeof irSetPT?.power === 'number') basePower = irSetPT.power;

  // State-aware path: the shared current P/T calculation (same numbers as the battlefield badge).
  if (gameState) {
    const current = getCurrentPowerToughness(permanent, gameState);
    if (current) return Math.max(0, current.power);
  }

  // State-aware fallback: include continuous lords/anthems/equipment (same as SBA/combat).
  // Prefer an already-synced derived cache; otherwise sync once so subsequent
  // getEffectiveToughness/Power calls on the same state stay cheap.
  // calculateAllPTBonuses already folds temporaryPowerBoost / powerBoost / pump modifiers.
  if (gameState) {
    if (!(gameState as any)._derivedContinuousEffects) {
      try {
        syncDerivedContinuousEffects(gameState);
      } catch {
        // best-effort; fall through to calculateAllPTBonuses
      }
    }
    const modifierPower = sumPtModifiersWithoutMirrorDoubleCount(permanent, gameState).power;
    const allBonuses = calculateAllPTBonuses(permanent, gameState);
    return Math.max(
      0,
      basePower + counterDelta + otherCounterPower + allBonuses.power + modifierPower + sumActiveTemporaryPTMods(permanent).power,
    );
  }
  
  // Oracle IR pump modifiers not already mirrored into temporaryPTMods.
  const modifierPower = sumPtModifiersWithoutMirrorDoubleCount(permanent).power;

  const temporaryPower =
    (typeof permanent.temporaryPowerBoost === 'number' ? permanent.temporaryPowerBoost : 0) +
    (typeof permanent.powerBoost === 'number' ? permanent.powerBoost : 0) +
    sumActiveTemporaryPTMods(permanent).power;
  
  return Math.max(0, basePower + counterDelta + otherCounterPower + modifierPower + temporaryPower);
}

/**
 * Calculate a creature's effective toughness including counters and modifiers
 * 
 * @param permanent - The creature permanent to calculate toughness for
 * @param gameState - Optional game state for continuous effects (lords, equipment via calculateAllPTBonuses)
 * @returns The effective toughness value
 */
export function getEffectiveToughness(permanent: any, gameState?: any): number {
  // Prefer pre-calculated view values only when we are not recomputing with state
  // (raw BF may have a stale effectiveToughness that omits lords).
  if (!gameState && typeof permanent.effectiveToughness === 'number') {
    return permanent.effectiveToughness;
  }
  
  const card = permanent.card;
  let baseToughness = permanent.baseToughness ?? (parseInt(String(card?.toughness ?? '0'), 10) || 0);
  
  // Handle star (*) toughness
  if (typeof card?.toughness === 'string' && card.toughness.includes('*')) {
    if (typeof permanent.baseToughness === 'number') {
      baseToughness = permanent.baseToughness;
    }
  }
  
  const irSetPT = resolveOracleIrSetPowerToughness(permanent);
  if (typeof irSetPT?.toughness === 'number') baseToughness = irSetPT.toughness;

  if (gameState) {
    const current = getCurrentPowerToughness(permanent, gameState);
    if (current) return Math.max(0, current.toughness);
  }

  // Add counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  const counterDelta = plusCounters - minusCounters;
  
  // Check for other counter types
  let otherCounterToughness = 0;
  if (permanent.counters) {
    for (const [counterType, count] of Object.entries(permanent.counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        const tMod = parseInt(counterMatch[2], 10);
        otherCounterToughness += tMod * (count as number);
      }
    }
  }

  if (gameState) {
    if (!(gameState as any)._derivedContinuousEffects) {
      try {
        syncDerivedContinuousEffects(gameState);
      } catch {
        // best-effort
      }
    }
    const modifierToughness = sumPtModifiersWithoutMirrorDoubleCount(permanent, gameState).toughness;
    const allBonuses = calculateAllPTBonuses(permanent, gameState);
    return Math.max(
      0,
      baseToughness + counterDelta + otherCounterToughness + allBonuses.toughness + modifierToughness + sumActiveTemporaryPTMods(permanent).toughness,
    );
  }
  
  // Oracle IR pump modifiers not already mirrored into temporaryPTMods.
  const modifierToughness = sumPtModifiersWithoutMirrorDoubleCount(permanent).toughness;

  const temporaryToughness =
    (typeof permanent.temporaryToughnessBoost === 'number' ? permanent.temporaryToughnessBoost : 0) +
    (typeof permanent.toughnessBoost === 'number' ? permanent.toughnessBoost : 0) +
    sumActiveTemporaryPTMods(permanent).toughness;
  
  return Math.max(0, baseToughness + counterDelta + otherCounterToughness + modifierToughness + temporaryToughness);
}
