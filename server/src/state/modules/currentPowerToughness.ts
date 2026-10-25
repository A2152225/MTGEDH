// server/src/state/modules/currentPowerToughness.ts
// Origin parent: server/src/state/modules/view.ts (battlefield effective P/T block).
// Canonical "current power/toughness" for a creature permanent: base (variable P/T, set-base
// Auras / static specs) + P/T counters + all continuous bonuses (equipment, auras, anthems,
// lords, emblems, pump fields) + active until-end-of-turn temporaryPTMods.
// Public entry symbols: computeCurrentPowerToughnessWithSources, getCurrentPowerToughness,
//   getCurrentPowerToughnessForRules, sumUnmirroredOracleIrPtModifiers, withCurrentPowerToughnessHook.
//
// The client battlefield shows exactly these numbers (view.ts), so rules effects that read
// "its power" (fight, bite, damage equal to power) must use this too.

import { sumActiveTemporaryPTMods } from "./temporaryPtMods.js";
import {
  parsePT,
  calculateVariablePT,
  calculateAllPTBonusesWithSources,
  getActualPowerToughness,
  type PTBonusSource,
} from "../utils.js";
import { syncDerivedContinuousEffects } from "./staticEffectSpec.js";
import { registerStaticConditionCurrentPowerResolver } from "./staticEffectSpecConditionEval.js";
import { applyLayer7bSetBasePowerToughness } from "./setBasePtTimestampResolution.js";
import { sumLongDurationPtModifiers } from "./longDurationPtModifiers.js";
import { countActivePowerToughnessSwitches, evaluateLayer7PowerToughness } from "./layer7PowerToughness.js";
import { registerCurrentPowerToughnessResolver } from "../../../../rules-engine/src/currentPowerToughnessHook.js";

export interface CurrentPowerToughness {
  power: number;
  toughness: number;
  /** Tooltip breakdown (counters, until-end-of-turn, equipment, anthems, ...). */
  sources: PTBonusSource[];
}

/**
 * Exactly the battlefield-view computation. Returns undefined when the permanent has no
 * numeric base P/T (non-creature, unresolved star P/T). Callers must have synced derived
 * continuous effects on `state` (view.ts does this once per build).
 */
export function computeCurrentPowerToughnessWithSources(perm: any, state: any): CurrentPowerToughness | undefined {
  // Layer 7a-7d live in one evaluator so the view tooltip and combat read the same numbers.
  return evaluateLayer7PowerToughness(perm, state);
}

/**
 * Oracle IR "gets +X/+Y until end of turn" writes `modifiers` entries of type
 * `powerToughness`; the server mirrors them into temporaryPTMods only after the IR run
 * finishes. While a program is still running (pump, then fight/bite), count the
 * not-yet-mirrored ones so "Then it fights" sees the pump.
 */
export function sumUnmirroredOracleIrPtModifiers(perm: any): { power: number; toughness: number } {
  const modifiers = Array.isArray(perm?.modifiers) ? perm.modifiers : [];
  if (modifiers.length === 0) return { power: 0, toughness: 0 };
  const mirrored = (Array.isArray(perm?.temporaryPTMods) ? perm.temporaryPTMods : []).map((entry: any) => ({
    power: Number(entry?.power ?? 0) || 0,
    toughness: Number(entry?.toughness ?? 0) || 0,
    source: String(entry?.source || ''),
  }));
  // Same identity + de-duplication as syncIrPowerToughnessModifiersToTemporaryPTMods: one
  // temporaryPTMods entry per (power, toughness, source), so post-run numbers equal the view.
  const seen = new Set<string>();
  let power = 0;
  let toughness = 0;
  for (const modifier of modifiers) {
    const modifierType = String(modifier?.type || '').trim();
    // Legacy uppercase POWER_TOUGHNESS entries are never mirrored, so they always count.
    if (modifierType !== 'powerToughness' && modifierType !== 'POWER_TOUGHNESS') continue;
    const duration = String(modifier?.duration || 'end_of_turn').trim();
    if (duration !== 'end_of_turn') continue;
    const mp = Number(modifier?.power ?? 0) || 0;
    const mt = Number(modifier?.toughness ?? 0) || 0;
    const modifierSource = String(modifier?.sourceId || modifier?.sourceName || '').trim();
    const key = `${modifierType}|${mp}|${mt}|${modifierSource}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isMirrored = modifierType === 'powerToughness' && mirrored.some((entry: any) =>
      entry.power === mp
      && entry.toughness === mt
      && (!modifierSource || entry.source === modifierSource)
    );
    if (isMirrored) continue;
    power += mp;
    toughness += mt;
  }
  return { power, toughness };
}

/**
 * Current (effective) power/toughness for rules calculations. Same numbers as the client
 * battlefield P/T badge, plus Oracle IR pumps applied earlier in a still-running program.
 * Returns undefined when the permanent has no numeric P/T.
 */
export function getCurrentPowerToughness(perm: any, state: any): { power: number; toughness: number } | undefined {
  if (!perm) return undefined;
  if (state && !(state as any)._derivedContinuousEffects) {
    try {
      syncDerivedContinuousEffects(state);
    } catch {
      // best-effort; bonuses fall back to regex anthems
    }
  }
  const current = computeCurrentPowerToughnessWithSources(perm, state);
  if (!current) return undefined;
  const pending = sumUnmirroredOracleIrPtModifiers(perm);
  // Pending pumps are layer 7c, so under an active 7d switch they land on the other side.
  const switched = countActivePowerToughnessSwitches(perm) % 2 === 1;
  return {
    power: current.power + (switched ? pending.toughness : pending.power),
    toughness: current.toughness + (switched ? pending.power : pending.toughness),
  };
}
// Rules-engine readers with a game state but no server access (AI evaluation, combat scoring) read the
// same calculation through this hook instead of the recorded/printed values.
registerCurrentPowerToughnessResolver((state, permanent) => getCurrentPowerToughness(permanent, state));
// Static-effect conditions ("creatures with power N or less", "power greater than hand size") read the same current power.
// This runs while syncDerivedContinuousEffects is itself evaluating conditions, so it must not call sync again
// (getCurrentPowerToughness would); it reads the last synced derived effects (or the regex fallback) directly.
registerStaticConditionCurrentPowerResolver((permanent, state) => {
  const current = computeCurrentPowerToughnessWithSources(permanent, state);
  if (!current) return undefined;
  const pending = sumUnmirroredOracleIrPtModifiers(permanent);
  return current.power + (countActivePowerToughnessSwitches(permanent) % 2 === 1 ? pending.toughness : pending.power);
});

/**
 * Rules-facing variant that always returns numbers: current P/T when computable, otherwise the
 * legacy base + counters reader (getActualPowerToughness).
 */
export function getCurrentPowerToughnessForRules(perm: any, state: any): { power: number; toughness: number } {
  try {
    const current = getCurrentPowerToughness(perm, state);
    if (current) return { power: Math.max(0, current.power), toughness: current.toughness };
  } catch {
    // partial/minimal state: fall back to base + counters below
  }
  return getActualPowerToughness(perm, state);
}

/**
 * Adds the rules-engine `resolveCurrentPowerToughness` hook to an Oracle IR execution
 * context, so "fights", "deals damage equal to its power" etc. read current P/T.
 */
export function withCurrentPowerToughnessHook<T extends object>(ctx: T): T & {
  resolveCurrentPowerToughness: (gameState: any, permanent: any) => { power: number; toughness: number } | undefined;
} {
  return {
    ...ctx,
    resolveCurrentPowerToughness: (gameState: any, permanent: any) => getCurrentPowerToughness(permanent, gameState),
  };
}
