// server/src/state/modules/batch94CastCost.ts
// B94: "As long as this artifact is untapped, each spell that would cost
// less than N mana to cast costs N mana to cast." (Trinisphere)
// Public: parseBatch94MinManaCostSentence, collectActiveMinManaCostFloors,
// applyMinManaCostFloorToConvertedCost, applyMinManaCostFloorToManaCost.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

const FLOOR_RE = /as long as (?:this artifact|this permanent|~) is untapped, each spell that would cost less than (three|two|four|five|one|\d+) mana to cast costs (three|two|four|five|one|\d+) mana to cast/i;

export function parseBatch94MinManaCostSentence(oracle: string): { floor: number } | null {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const m = text.match(FLOOR_RE);
  if (!m) return null;
  const n = (raw: string) => WORD[String(raw).toLowerCase()] ?? (parseInt(String(raw), 10) || 0);
  const floor = n(m[2] || m[1] || '3');
  return floor > 0 ? { floor } : null;
}

export function collectActiveMinManaCostFloors(state: any): number {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let floor = 0;
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true || perm.tapped === true || !perm.card) continue;
    const parsed = parseBatch94MinManaCostSentence(readCardOracleText(perm.card));
    if (parsed) floor = Math.max(floor, parsed.floor);
  }
  return floor;
}

/** Raise a converted-mana number to the active floor. */
export function applyMinManaCostFloorToConvertedCost(state: any, converted: number): number {
  const floor = collectActiveMinManaCostFloors(state);
  const n = Math.max(0, Math.floor(Number(converted) || 0));
  return floor > 0 ? Math.max(n, floor) : n;
}

/**
 * If the generic+colored mana symbols in `manaCost` sum to less than the
 * floor, prepend enough generic mana to reach it. Example: {1}{B} with
 * floor 3 becomes {2}{B}.
 */
export function applyMinManaCostFloorToManaCost(state: any, manaCost: string): string {
  const floor = collectActiveMinManaCostFloors(state);
  if (floor <= 0) return String(manaCost || '');
  const cost = String(manaCost || '');
  let total = 0;
  const generic: number[] = [];
  const others: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cost))) {
    const inner = m[1];
    if (/^\d+$/.test(inner)) {
      const n = parseInt(inner, 10);
      total += n;
      generic.push(n);
    } else if (/^[WUBRGC]$/i.test(inner)) {
      total += 1;
      others.push(m[0]);
    } else if (/^X$/i.test(inner)) {
      others.unshift(m[0]);
    } else {
      total += 1;
      others.push(m[0]);
    }
  }
  if (total >= floor) return cost || (floor > 0 ? `{${floor}}` : '');
  const extra = floor - total;
  const existingGeneric = generic.reduce((a, b) => a + b, 0);
  const newGeneric = existingGeneric + extra;
  const parts: string[] = [];
  if (newGeneric > 0) parts.push(`{${newGeneric}}`);
  parts.push(...others);
  return parts.join('') || `{${floor}}`;
}

export function applyMinManaCostFloorToParsedCost<T extends { generic: number; colors: Record<string, number> }>(state: any, parsed: T): T {
  const floor = collectActiveMinManaCostFloors(state);
  if (floor <= 0 || !parsed) return parsed;
  const colored = Object.values(parsed.colors || {}).reduce((a, b) => a + Math.max(0, Number(b) || 0), 0);
  const total = Math.max(0, Number(parsed.generic || 0)) + colored;
  if (total >= floor) return parsed;
  return { ...parsed, generic: Number(parsed.generic || 0) + (floor - total) };
}
