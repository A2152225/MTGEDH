// server/src/state/modules/batch97SparkAbilityLoss.ts
// B97: "Each planeswalker with one or more loyalty counters on it loses all
// abilities and is a creature with power and toughness each equal to the
// number of loyalty counters on it." (Spark Rupture.) Layer 4 already adds
// Creature and the loyalty P/T; this module is the layer-6 ability loss.
// Public: sparkRuptureAbilityLossTimestamp.

const SPARK_RE = /each planeswalker with (?:one or more|1 or more|\d+\+) loyalty counters? on it loses all abilities and is a creature with power and toughness each equal to the number of loyalty counters? on it/i;

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function loyaltyOf(perm: any): number {
  const n = Number(perm?.loyalty ?? perm?.counters?.loyalty ?? perm?.card?.loyalty ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

function timestampOf(perm: any): number | undefined {
  const n = Number(perm?.ceTimestamp ?? perm?.timestamp ?? perm?.continuousEffectTimestamp);
  return Number.isFinite(n) ? n : undefined;
}

/** Latest Spark-Rupture-style loss timestamp that applies to `perm`, or undefined. */
export function sparkRuptureAbilityLossTimestamp(perm: any, battlefield?: readonly any[]): number | undefined {
  if (!perm || !Array.isArray(battlefield) || battlefield.length === 0) return undefined;
  if (!/\bplaneswalker\b/.test(typeLineOf(perm))) return undefined;
  if (loyaltyOf(perm) < 1) return undefined;
  let latest: number | undefined;
  for (const source of battlefield) {
    if (!source || source.phasedOut === true || !source.card) continue;
    if (!SPARK_RE.test(oracleOf(source))) continue;
    const ts = timestampOf(source) ?? Infinity;
    latest = latest === undefined ? ts : Math.max(latest, ts);
  }
  return latest;
}
