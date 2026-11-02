// Helpers for getAvailableMana: count-based ("for each") mana lines and mana-costed
// activations (signets, "{1}, {T}, Sacrifice ~: Add ...", Cabal Coffers) whose cost must be
// netted out and must be payable from other mana before the source counts.

import { battlefieldPermanentInstanceCount } from "../chosen-creature-type.js";
import { getTotalManaFromPool } from "./manaCheckCanPayManaCost.js";

/** Mana pips in an activation cost ({T}, {Q}, {X} and non-mana parts ignored). Hybrid counts 1. */
export function manaPipsInCost(costText: string): number {
  let pips = 0;
  for (const token of String(costText || '').match(/\{[^}]+\}/g) || []) {
    const clean = token.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(clean)) pips += Number.parseInt(clean, 10) || 0;
    else if (/^[WUBRGC]$/.test(clean) || /^[WUBRGC2]\/[WUBRGCP]$/.test(clean)) pips += 1;
  }
  return pips;
}

/** Cost text (before ':') of the oracle line that contains `index`. */
export function costTextOfLineAt(oracleText: string, index: number): string {
  const lineStart = oracleText.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const colon = oracleText.indexOf(':', index);
  return colon < 0 ? '' : oracleText.slice(lineStart, colon);
}

export interface ScalingManaLine {
  line: string;
  costText: string;
  color: string;
  filterText: string;
  scope: 'you control' | 'on the battlefield';
}

/** First "<cost>: Add {X} for each ..." / "... equal to ..." mana line, if any. */
export function findScalingManaLine(oracleText: string): { line: string; costText: string } | null {
  for (const line of String(oracleText || '').split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const effect = line.slice(colon + 1);
    if (/\badd\b/.test(effect) && /\bfor each\b|\bequal to\b/.test(effect)) {
      return { line, costText: line.slice(0, colon) };
    }
  }
  return null;
}

/** Parse "Add {G} for each <type words> you control / on the battlefield". Null = not understood. */
export function parseForEachManaLine(line: string): ScalingManaLine | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const match = line.slice(colon + 1).match(/^\s*add\s+\{([wubrgc])\}\s+for each\s+([a-z' -]+?)\s+(you control|on the battlefield)\s*\.?\s*$/);
  if (!match) return null;
  return { line, costText: line.slice(0, colon), color: match[1].toUpperCase(), filterText: match[2], scope: match[3] as any };
}

const UNSUPPORTED_FILTER_WORDS = /\b(untapped|tapped|with|without|that|named|card|cards|counter|power|toughness|attacking|blocking|nontoken|token|tokens|non\w*|or|and)\b/;

/** Matching permanents for a parsed "for each" line, or null when the filter isn't understood. */
export function countForEachManaAmount(state: any, playerId: string, parsed: ScalingManaLine, self: any): number | null {
  let filter = parsed.filterText.trim();
  const excludeSelf = /^other\s+/.test(filter);
  filter = filter.replace(/^other\s+/, '');
  if (!filter || UNSUPPORTED_FILTER_WORDS.test(filter)) return null;
  const words = filter.split(/\s+/).map((word) => word.replace(/s$/, '')).filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  let count = 0;
  for (const permanent of state?.battlefield || []) {
    if (!permanent) continue;
    if (parsed.scope === 'you control' && permanent.controller !== playerId) continue;
    if (excludeSelf && permanent === self) continue;
    const typeLine = String(permanent.card?.type_line || permanent.type_line || '').toLowerCase().replace(/[^a-z' ]+/g, ' ');
    const typeWords = new Set(typeLine.split(/\s+/).filter(Boolean));
    if (!words.every((word) => typeWords.has(word) || typeWords.has(`${word}s`))) continue;
    count += battlefieldPermanentInstanceCount(permanent);
  }
  return count;
}

export interface DeferredCostedMana {
  pips: number;
  gain: Record<string, number>;
}

/** Add mana-costed sources whose activation cost the rest of the pool (and earlier gains) can pay. */
export function applyPayableCostedMana(pool: Record<string, number>, deferred: DeferredCostedMana[]): void {
  const pending = deferred.filter((entry) => Object.values(entry.gain).some((value) => Number(value) > 0));
  pending.sort((a, b) => a.pips - b.pips);
  let progress = true;
  while (progress && pending.length > 0) {
    progress = false;
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      if (getTotalManaFromPool(pool) < entry.pips) continue;
      for (const [key, value] of Object.entries(entry.gain)) {
        pool[key] = Number(pool[key] || 0) + Number(value || 0);
      }
      pending.splice(index, 1);
      index -= 1;
      progress = true;
    }
  }
}