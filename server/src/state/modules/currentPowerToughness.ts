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
import { applyLayer7bSetBasePowerToughness } from "./setBasePtTimestampResolution.js";
import { sumLongDurationPtModifiers } from "./longDurationPtModifiers.js";

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
  const card = perm?.card as any;
  let baseP = typeof perm?.basePower === "number" ? perm.basePower : parsePT(card?.power);
  let baseT = typeof perm?.baseToughness === "number" ? perm.baseToughness : parsePT(card?.toughness);

  // Variable P/T (*/*) creatures like Morophon
  if (baseP === undefined || baseT === undefined) {
    const variablePT = calculateVariablePT({ ...card, controller: perm?.controller }, state);
    if (variablePT) {
      baseP = baseP ?? variablePT.power;
      baseT = baseT ?? variablePT.toughness;
    }
  }

  // Layer 7b set-base effects: Auras, static specs (lords) and rules-engine "becomes an X/Y" /
  // "has base P/T X/Y" modifiers (type setPowerToughness) ordered by timestamp, last one wins.
  // Applied before counters and modifications (anthems, equipment, pumps), added below.
  const layer7b = applyLayer7bSetBasePowerToughness(perm, state, { power: baseP, toughness: baseT });
  baseP = layer7b.power;
  baseT = layer7b.toughness;

  if (typeof baseP !== "number" || typeof baseT !== "number") return undefined;

  // Same counter keys as getActualPowerToughness (legacy aliases: plusOne, p1p1, ...).
  const counters = perm?.counters || {};
  const plus = Number(counters["+1/+1"] || counters.plus_one || counters.plusOne || counters.p1p1 || 0) || 0;
  const minus = Number(counters["-1/-1"] || counters.minus_one || counters.minusOne || counters.m1m1 || 0) || 0;
  const counterDelta = plus - minus;

  // +1/+0, +0/+1, +2/+2, -2/-2 ... counters
  let otherCounterPower = 0;
  let otherCounterToughness = 0;
  if (perm?.counters) {
    for (const [counterType, count] of Object.entries(perm.counters)) {
      if (counterType === "+1/+1" || counterType === "-1/-1") continue;
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        otherCounterPower += parseInt(counterMatch[1], 10) * (count as number);
        otherCounterToughness += parseInt(counterMatch[2], 10) * (count as number);
      }
    }
  }

  // Equipment, auras, anthems, lords, emblems, pump fields (with source tracking)
  const allBonusesResult = calculateAllPTBonusesWithSources(perm, state);
  const temporaryPtBonus = sumActiveTemporaryPTMods(perm);
  // Pumps lasting longer than end of turn (until your next turn, until end of combat, permanent).
  const longPtBonus = sumLongDurationPtModifiers(perm, state);

  const sources: PTBonusSource[] = [];
  if (counterDelta !== 0) {
    sources.push({ name: '+1/+1 counters', power: counterDelta, toughness: counterDelta, type: 'counter' });
  }
  if (otherCounterPower !== 0 || otherCounterToughness !== 0) {
    sources.push({ name: 'Other counters', power: otherCounterPower, toughness: otherCounterToughness, type: 'counter' });
  }
  if (temporaryPtBonus.power !== 0 || temporaryPtBonus.toughness !== 0) {
    sources.push({ name: 'Until end of turn', power: temporaryPtBonus.power, toughness: temporaryPtBonus.toughness, type: 'modifier' });
  }
  if (longPtBonus.power !== 0 || longPtBonus.toughness !== 0) {
    sources.push({ name: 'Lasting effects', power: longPtBonus.power, toughness: longPtBonus.toughness, type: 'modifier' });
  }
  sources.push(...allBonusesResult.sources);

  return {
    power: baseP + counterDelta + otherCounterPower + allBonusesResult.power + temporaryPtBonus.power + longPtBonus.power,
    toughness: baseT + counterDelta + otherCounterToughness + allBonusesResult.toughness + temporaryPtBonus.toughness + longPtBonus.toughness,
    sources,
  };
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
  return {
    power: current.power + pending.power,
    toughness: current.toughness + pending.toughness,
  };
}
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
