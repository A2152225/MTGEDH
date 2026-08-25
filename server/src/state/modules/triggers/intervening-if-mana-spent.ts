/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: mana-spent / color / foretell / main-phase helpers (getManaValue through countControlledPermanentsBySubtype)
 * Public: getManaValue, normalizeColorToken, resolveManaSpentBreakdown, getManaSpentAmountForToken,
 * getManaColorsSpentFromSource, getChosenColorFromSource, getDieRollResultsThisTurn,
 * isCastFromForetell, didCastDuringOwnMainPhase, countControlledPermanentsBySubtype,
 * ManaSpentBreakdownResolution
 */

import type { GameContext } from "../context.js";
import { countControlledPermanents } from "./intervening-if-this-turn-counts.js";
import { parseMaybeNumber } from "./intervening-if-zone-lookups.js";

function getManaValue(cardOrPerm: any): number | null {
  const candidates = [cardOrPerm?.manaValue, cardOrPerm?.cmc, cardOrPerm?.card?.cmc, cardOrPerm?.card?.manaValue];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }
  return null;
}

function normalizeColorToken(token: string): string | null {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;

  const symbolMap: Record<string, string> = {
    w: 'white',
    u: 'blue',
    b: 'black',
    r: 'red',
    g: 'green',
  };
  if (symbolMap[t]) return symbolMap[t];

  if (['white', 'blue', 'black', 'red', 'green'].includes(t)) return t;
  return null;
}

type ManaSpentBreakdownResolution = {
  amounts: {
    white: number | null;
    blue: number | null;
    black: number | null;
    red: number | null;
    green: number | null;
    colorless: number | null;
  };
  complete: boolean;
};

function resolveManaSpentBreakdown(source: any): ManaSpentBreakdownResolution | null {
  if (!source) return null;
  const breakdown = source?.manaSpentBreakdown ?? source?.card?.manaSpentBreakdown;
  if (!breakdown || typeof breakdown !== 'object') return null;

  const total = parseMaybeNumber(source?.manaSpentTotal ?? source?.card?.manaSpentTotal);
  const keys: Array<keyof ManaSpentBreakdownResolution['amounts']> = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

  const amounts: ManaSpentBreakdownResolution['amounts'] = {
    white: null,
    blue: null,
    black: null,
    red: null,
    green: null,
    colorless: null,
  };

  let unknown = false;
  let sumKnown = 0;

  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(breakdown, k)) continue;
    const n = parseMaybeNumber((breakdown as any)[k]);
    if (n === null) {
      unknown = true;
      continue;
    }
    amounts[k] = n;
    sumKnown += n;
  }

  let complete = false;
  if (!unknown && total !== null && sumKnown === total) {
    complete = true;
    for (const k of keys) {
      if (amounts[k] === null) amounts[k] = 0;
    }
  }

  return { amounts, complete };
}

function getManaSpentAmountForToken(source: any, token: string): number | null {
  const resolved = resolveManaSpentBreakdown(source);
  if (!resolved) return null;

  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;

  if (t === 'c' || t === 'colorless') return resolved.amounts.colorless;
  const color = normalizeColorToken(t);
  if (!color) return null;
  return (resolved.amounts as any)[color] ?? null;
}

function getManaColorsSpentFromSource(source: any): string[] | null {
  if (!source) return null;
  const v = source?.manaColorsSpent ?? source?.card?.manaColorsSpent ?? source?.manaSpentColors ?? source?.card?.manaSpentColors;
  if (!Array.isArray(v)) return null;
  const out = v
    .map((x: any) => normalizeColorToken(String(x)))
    .filter((x: any) => typeof x === 'string' && x.length > 0);
  return out;
}

function getChosenColorFromSource(source: any): string | null {
  if (!source) return null;
  const v = source?.chosenColor ?? source?.card?.chosenColor;
  const c = normalizeColorToken(String(v || ''));
  return c;
}

function getDieRollResultsThisTurn(ctx: GameContext, playerId: string): Array<{ sides: number; result: number; timestamp?: number }> {
  const map = (ctx as any).state?.dieRollsThisTurn;
  const rolls = map?.[playerId];
  if (!Array.isArray(rolls) || rolls.length === 0) return [];

  const normalized: Array<{ sides: number; result: number; timestamp?: number }> = [];
  for (const r of rolls) {
    const sides = parseMaybeNumber((r as any)?.sides);
    const result = parseMaybeNumber((r as any)?.result);
    if (sides === null || result === null) continue;
    normalized.push({ sides, result, timestamp: (r as any)?.timestamp });
  }
  return normalized;
}

function isCastFromForetell(source: any): boolean | null {
  if (!source) return null;
  const v = source?.castFromForetell ?? source?.card?.castFromForetell ?? source?.foretold ?? source?.card?.foretold;
  if (typeof v === 'boolean') return v;
  return null;
}

function didCastDuringOwnMainPhase(source: any): boolean | null {
  if (!source) return null;
  const v = source?.castDuringOwnMainPhase ?? source?.card?.castDuringOwnMainPhase;
  if (typeof v === 'boolean') return v;
  return null;
}

function countControlledPermanentsBySubtype(ctx: GameContext, controllerId: string, subtypeLower: string): number {
  return countControlledPermanents(ctx, controllerId, (tl) => tl.includes(subtypeLower));
}


export {
  getManaValue,
  normalizeColorToken,
  resolveManaSpentBreakdown,
  getManaSpentAmountForToken,
  getManaColorsSpentFromSource,
  getChosenColorFromSource,
  getDieRollResultsThisTurn,
  isCastFromForetell,
  didCastDuringOwnMainPhase,
  countControlledPermanentsBySubtype,
};
export type { ManaSpentBreakdownResolution };
