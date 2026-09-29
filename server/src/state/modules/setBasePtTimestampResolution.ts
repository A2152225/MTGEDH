// server/src/state/modules/setBasePtTimestampResolution.ts
// Layer 7b (CR 613.4b / 613.7) ordering of "set base power and toughness" effects:
//   - Aura set-base ("Enchanted creature ... has base power and toughness 1/1")
//   - static set-base specs (lords such as Kudo)
//   - Oracle IR "becomes an X/Y" / "has base power and toughness X/Y" setters
//     (`setPowerToughness` modifiers, stamped with `timestamp` + `battlefieldPosition`)
// The latest timestamp wins, per component (a setter that only sets power leaves toughness alone).
//
// Timestamp scales: Auras and static sources use their battlefield index (existing proxy, see
// getStaticEffectSourceTimestamp). An Oracle IR setter records the battlefield length when it was
// created, so it sits just after every permanent that was already there: an Aura that entered
// earlier loses to it, an Aura that enters later beats it. Several Oracle IR setters are ordered
// by their own strictly increasing `timestamp` regardless of array order.
//
// States without any setPowerToughness modifier keep the previous behaviour (aura, then static).
// Public entry symbols: applyLayer7bSetBasePowerToughness.

import { resolveSetBasePTFromAttachedAuras } from "../utils-handlers/ptAttachedBonusParseHelpers.js";
import { collectSetBasePTEntriesFromStaticSpecs, resolveSetBasePTFromStaticSpecs } from "./staticEffectSpec.js";
import { listOracleIrSetPowerToughnessSetters } from "./oracleIrSetPowerToughness.js";

export interface BasePowerToughness {
  power: number | undefined;
  toughness: number | undefined;
}

interface OrderedSetBase {
  power?: number;
  toughness?: number;
  key: number;
  tie: number;
}

/** Position on the battlefield-index scale just after the permanents present when the setter was created. */
function setterKey(setter: any, battlefield: readonly any[]): number {
  const anchorId = String(setter?.battlefieldAnchorId || '').trim();
  if (anchorId) {
    const anchorIndex = battlefield.findIndex((entry: any) => String(entry?.id || '') === anchorId);
    if (anchorIndex >= 0) return anchorIndex + 0.5;
  }
  const position = Number(setter?.battlefieldPosition);
  if (Number.isFinite(position)) return Math.min(position, battlefield.length) - 0.5;
  return Number.POSITIVE_INFINITY;
}

export function applyLayer7bSetBasePowerToughness(
  perm: any,
  state: any,
  base: BasePowerToughness,
): BasePowerToughness {
  const battlefield: readonly any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const setters = listOracleIrSetPowerToughnessSetters(perm);

  if (setters.length === 0) {
    // Legacy ordering: Aura set-base, then static set-base.
    let result = { ...base };
    const auraBase = resolveSetBasePTFromAttachedAuras(perm, battlefield as any[]);
    if (auraBase) result = { power: auraBase.power, toughness: auraBase.toughness };
    const staticBase = resolveSetBasePTFromStaticSpecs(perm, state);
    if (staticBase) result = { power: staticBase.power, toughness: staticBase.toughness };
    return result;
  }

  const entries: OrderedSetBase[] = [];
  battlefield.forEach((candidate: any, index: number) => {
    const auraBase = resolveSetBasePTFromAttachedAuras(perm, [candidate]);
    if (auraBase) entries.push({ power: auraBase.power, toughness: auraBase.toughness, key: index, tie: 0 });
  });
  for (const entry of collectSetBasePTEntriesFromStaticSpecs(perm, state)) {
    entries.push({ power: entry.power, toughness: entry.toughness, key: entry.timestamp, tie: 1 });
  }

  // Oracle IR setters: keys must never decrease along the setter timestamp order.
  const timestamped = setters
    .filter((setter) => Number.isFinite(setter.timestamp))
    .sort((left, right) => (left.timestamp as number) - (right.timestamp as number));
  const legacy = setters.filter((setter) => !Number.isFinite(setter.timestamp));
  let previousKey = Number.NEGATIVE_INFINITY;
  const timestampedKeys = timestamped.map((setter) => {
    previousKey = Math.max(previousKey, setterKey(setter, battlefield));
    return previousKey;
  });
  const legacyKey = timestampedKeys.length > 0 ? Math.min(...timestampedKeys) : Number.POSITIVE_INFINITY;
  legacy.forEach((setter, order) => {
    entries.push({ power: setter.power, toughness: setter.toughness, key: legacyKey, tie: 2 + order });
  });
  timestamped.forEach((setter, order) => {
    entries.push({ power: setter.power, toughness: setter.toughness, key: timestampedKeys[order], tie: 1000 + order });
  });

  entries.sort((left, right) => (left.key - right.key) || (left.tie - right.tie));
  const result = { ...base };
  for (const entry of entries) {
    if (typeof entry.power === 'number') result.power = entry.power;
    if (typeof entry.toughness === 'number') result.toughness = entry.toughness;
  }
  return result;
}