// server/src/state/modules/setBasePtTimestampResolution.ts
// Layer 7b (CR 613.4b / 613.7) ordering of "set base power and toughness" effects:
//   - Aura set-base ("Enchanted creature ... has base power and toughness 1/1")
//   - static set-base specs (lords such as Kudo)
//   - Oracle IR "becomes an X/Y" / "has base power and toughness X/Y" setters
//     (`setPowerToughness` modifiers)
// The latest timestamp wins, per component (a setter that only sets power leaves toughness alone).
//
// Timestamps are REAL when available (rules-engine/src/permanentTimestamps.ts): an Aura uses the timestamp of
// when it became attached (`attachedTimestamp`), a static source uses its entry `timestamp`, an Oracle IR setter
// its `timestamp` (drawn from the same game-wide counter, `globalTimestamp`). Real timestamps are all above
// TIMESTAMP_BASE and therefore always newer than the legacy scale below.
//
// Legacy scale (permanents/setters without real timestamps, old saves, unsynced tests): Auras and static sources
// use their battlefield index. An Oracle IR setter records the battlefield length when it was created, so it sits
// just after every permanent that was already there: an Aura that entered earlier loses to it, an Aura that
// enters later beats it. Legacy setters are ordered by their own strictly increasing `timestamp`.
//
// States without any setPowerToughness modifier and without real Aura/static timestamps keep the previous
// behaviour (aura, then static).
// Public entry symbols: applyLayer7bSetBasePowerToughness.

import { resolveSetBasePTFromAttachedAuras } from "../utils-handlers/ptAttachedBonusParseHelpers.js";
import { collectSetBasePTEntriesFromStaticSpecs, resolveSetBasePTFromStaticSpecs } from "./staticEffectSpec.js";
import { listOracleIrSetPowerToughnessSetters } from "./oracleIrSetPowerToughness.js";
import {
  TIMESTAMP_BASE,
  readAttachmentTimestamp,
  readPermanentTimestamp,
  stampMissingPermanentTimestamps,
} from "../../../../rules-engine/src/permanentTimestamps.js";

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

function isRealSetterTimestamp(setter: any): boolean {
  return setter?.globalTimestamp === true && Number.isFinite(setter.timestamp) && setter.timestamp > TIMESTAMP_BASE;
}

function hasRealAuraOrStaticTimestamp(perm: any, battlefield: readonly any[], state: any): boolean {
  const anyRealAura = battlefield.some((candidate: any) =>
    candidate && String(candidate.attachedTo || '') === String(perm?.id || '') && readAttachmentTimestamp(candidate) !== undefined,
  );
  if (anyRealAura) return true;
  return collectSetBasePTEntriesFromStaticSpecs(perm, state).some((entry) => entry.timestamp > TIMESTAMP_BASE);
}

export function applyLayer7bSetBasePowerToughness(
  perm: any,
  state: any,
  base: BasePowerToughness,
): BasePowerToughness {
  const battlefield: readonly any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const setters = listOracleIrSetPowerToughnessSetters(perm);
  if (setters.some(isRealSetterTimestamp)) {
    try {
      // Anything that entered or attached after the last stamping pass gets its (higher) timestamp now.
      stampMissingPermanentTimestamps(state);
    } catch {
      // frozen/partial state: keep whatever stamps exist
    }
  }

  if (setters.length === 0 && !hasRealAuraOrStaticTimestamp(perm, battlefield, state)) {
    // Legacy ordering: Aura set-base, then static set-base.
    let result = { ...base };
    const auraBase = resolveSetBasePTFromAttachedAuras(perm, battlefield as any[]);
    if (auraBase) result = { power: auraBase.power, toughness: auraBase.toughness };
    const staticBase = resolveSetBasePTFromStaticSpecs(perm, state);
    if (staticBase) result = { power: staticBase.power, toughness: staticBase.toughness };
    return result;
  }

  // Mixed scales: while a legacy (non-global) setter is involved, Auras and static sources stay on the
  // battlefield-index proxy so the legacy setter's position keys remain comparable with them.
  const proxyScale = setters.some((setter) => !isRealSetterTimestamp(setter));

  const entries: OrderedSetBase[] = [];
  battlefield.forEach((candidate: any, index: number) => {
    const auraBase = resolveSetBasePTFromAttachedAuras(perm, [candidate]);
    if (auraBase) {
      entries.push({
        power: auraBase.power,
        toughness: auraBase.toughness,
        key: proxyScale ? index : (readAttachmentTimestamp(candidate) ?? readPermanentTimestamp(candidate) ?? index),
        tie: 0,
      });
    }
  });
  for (const entry of collectSetBasePTEntriesFromStaticSpecs(perm, state, { forceIndexProxy: proxyScale })) {
    entries.push({ power: entry.power, toughness: entry.toughness, key: entry.timestamp, tie: 1 });
  }

  // Oracle IR setters: real ones sort by their global timestamp; legacy ones keep the battlefield-position proxy
  // (their keys never decrease along the setter timestamp order).
  const realSetters = setters.filter(isRealSetterTimestamp);
  const legacySetters = setters.filter((setter) => !isRealSetterTimestamp(setter));
  const timestamped = legacySetters
    .filter((setter) => Number.isFinite(setter.timestamp))
    .sort((left, right) => (left.timestamp as number) - (right.timestamp as number));
  const legacy = legacySetters.filter((setter) => !Number.isFinite(setter.timestamp));
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
  realSetters.forEach((setter, order) => {
    entries.push({ power: setter.power, toughness: setter.toughness, key: setter.timestamp as number, tie: 100000 + order });
  });

  entries.sort((left, right) => (left.key - right.key) || (left.tie - right.tie));
  const result = { ...base };
  for (const entry of entries) {
    if (typeof entry.power === 'number') result.power = entry.power;
    if (typeof entry.toughness === 'number') result.toughness = entry.toughness;
  }
  return result;
}