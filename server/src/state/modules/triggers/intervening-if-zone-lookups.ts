/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: zone / counter / name lookups (getPlayerLife through findBattlefieldPermanent)
 * Public: getPlayerLife, getHandCount, getZones, getGraveyard, getGraveyardCount, getLibraryCount,
 * parseMaybeNumber, sumManaSpentTotal, hasAnyCounters, getCounterCount, sumAllCounters,
 * getCommandZoneInfo, nameMatchesClauseName, findBattlefieldPermanentsByName,
 * getCounterCountCaseInsensitiveFromPerm, hasAnyCountersOnPermanent, typeLineHasWord,
 * countControlledCreatureSubtype, isPrimeNumber, findBattlefieldPermanent
 */

import type { GameContext } from "../context.js";

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/[’]/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toLower(text: string): string {
  return normalizeText(text).toLowerCase();
}

function getPlayerLife(ctx: GameContext, playerId: string): number {
  const life = (ctx as any).state?.life || (ctx as any).life || {};
  const v = life[playerId];
  return typeof v === "number" ? v : 40;
}

function getHandCount(ctx: GameContext, playerId: string): number {
  const zones = (ctx as any).state?.zones || {};
  const z = zones[playerId];
  const hc = z?.handCount;
  if (typeof hc === "number") return hc;
  const hand = z?.hand;
  if (Array.isArray(hand)) return hand.length;
  return 0;
}

function getZones(ctx: GameContext): any {
  return (ctx as any).state?.zones || {};
}

function getGraveyard(ctx: GameContext, playerId: string): any[] {
  const zones = getZones(ctx);
  const z = zones?.[playerId];
  const gy = z?.graveyard;
  return Array.isArray(gy) ? gy : [];
}

function getGraveyardCount(ctx: GameContext, playerId: string): number {
  const zones = getZones(ctx);
  const z = zones?.[playerId];
  const gc = z?.graveyardCount;
  if (typeof gc === 'number') return gc;
  return getGraveyard(ctx, playerId).length;
}

function getLibraryCount(ctx: GameContext, playerId: string): number {
  const zones = getZones(ctx);
  const z = zones?.[playerId];
  if (typeof z?.libraryCount === "number") return z.libraryCount;
  const lib = (ctx as any).libraries?.get?.(playerId);
  if (Array.isArray(lib)) return lib.length;
  return 0;
}

function parseMaybeNumber(v: any): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function sumManaSpentTotal(source: any): number | null {
  if (!source) return null;
  const direct = parseMaybeNumber(source?.manaSpentTotal ?? source?.card?.manaSpentTotal);
  if (direct !== null) return direct;

  const breakdown = source?.manaSpentBreakdown ?? source?.card?.manaSpentBreakdown;
  if (!breakdown || typeof breakdown !== "object") return null;

  let total = 0;
  for (const v of Object.values(breakdown)) {
    const n = parseMaybeNumber(v);
    if (n === null) return null;
    total += n;
  }
  return total;
}

function hasAnyCounters(permOrCard: any): boolean | null {
  if (!permOrCard) return null;
  const counters = (permOrCard as any).counters ?? (permOrCard as any).card?.counters;
  if (!counters || typeof counters !== "object") return false;
  return Object.values(counters).some((v: any) => typeof v === "number" && v > 0);
}

function getCounterCount(permOrCard: any, counterKey: string): number | null {
  if (!permOrCard) return null;
  const counters = (permOrCard as any).counters ?? (permOrCard as any).card?.counters;
  if (!counters || typeof counters !== "object") return 0;
  const v = (counters as any)[counterKey];
  const n = parseMaybeNumber(v);
  return n ?? 0;
}

function sumAllCounters(permOrCard: any): number | null {
  if (!permOrCard) return null;
  const counters = (permOrCard as any).counters ?? (permOrCard as any).card?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  let total = 0;
  for (const v of Object.values(counters)) {
    const n = parseMaybeNumber(v);
    if (n === null) continue;
    if (n > 0) total += n;
  }
  return total;
}

function escapeRegexLiteral(text: string): string {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCommandZoneInfo(ctx: GameContext, playerId: string): any | null {
  const cz = (ctx as any).state?.commandZone ?? (ctx as any).commandZone;
  if (!cz || typeof cz !== 'object') return null;
  return (cz as any)[String(playerId)] ?? null;
}

function nameMatchesClauseName(actualNameLower: string, clauseNameLower: string): boolean {
  const actual = String(actualNameLower || '').toLowerCase();
  const clause = String(clauseNameLower || '').toLowerCase();
  if (!actual || !clause) return false;
  if (actual === clause) return true;

  // Many cards reference themselves by a shortened name in Oracle text (e.g., "Kalamax"),
  // while the card name is the full printed name (e.g., "Kalamax, the Stormsire").
  // Treat a leading full-word match as sufficient.
  if (!actual.startsWith(clause)) return false;
  const next = actual.slice(clause.length, clause.length + 1);
  return next === ',' || next === ' ';
}

function findBattlefieldPermanentsByName(ctx: GameContext, nameLower: string): any[] {
  const battlefield = (ctx as any).state?.battlefield;
  if (!Array.isArray(battlefield)) return [];
  const target = String(nameLower || '').toLowerCase();
  if (!target) return [];
  return battlefield.filter((p: any) => p && nameMatchesClauseName(toLower(p?.card?.name || p?.name || ''), target));
}

function getCounterCountCaseInsensitiveFromPerm(perm: any, counterNameLower: string): number | null {
  if (!perm) return null;
  const counters = (perm as any).counters;
  if (!counters || typeof counters !== 'object') return null;
  const keyLower = String(counterNameLower || '').toLowerCase();
  if (!keyLower) return null;

  for (const [k, v] of Object.entries(counters)) {
    if (String(k || '').toLowerCase() !== keyLower) continue;
    const n = parseMaybeNumber(v);
    return n ?? 0;
  }

  return 0;
}

function hasAnyCountersOnPermanent(perm: any): boolean | null {
  if (!perm) return null;
  const counters = (perm as any).counters;
  if (!counters || typeof counters !== 'object') return null;
  return Object.values(counters).some((v: any) => typeof v === 'number' && v > 0);
}

function typeLineHasWord(typeLine: string, word: string): boolean {
  const tl = String(typeLine || '').toLowerCase();
  const w = String(word || '').toLowerCase();
  if (!tl || !w) return false;
  return new RegExp(`\\b${escapeRegexLiteral(w)}\\b`, 'i').test(tl);
}

function countControlledCreatureSubtype(ctx: GameContext, controllerId: string, subtypeLower: string): number {
  const battlefield = (ctx as any).state?.battlefield || [];
  if (!Array.isArray(battlefield)) return 0;
  return battlefield.filter((p: any) => {
    if (!p) return false;
    if (String(p.controller || '') !== String(controllerId)) return false;
    const tl = String(p.card?.type_line || '').toLowerCase();
    if (!tl.includes('creature')) return false;
    return typeLineHasWord(tl, subtypeLower);
  }).length;
}

function isPrimeNumber(n: number): boolean {
  if (!Number.isFinite(n)) return false;
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

function findBattlefieldPermanent(ctx: GameContext, id: string): any | null {
  const battlefield = (ctx as any).state?.battlefield || [];
  if (!Array.isArray(battlefield)) return null;
  return battlefield.find((p: any) => p && String(p.id || '') === String(id || '')) || null;
}



export {
  getPlayerLife,
  getHandCount,
  getZones,
  getGraveyard,
  getGraveyardCount,
  getLibraryCount,
  parseMaybeNumber,
  sumManaSpentTotal,
  hasAnyCounters,
  getCounterCount,
  sumAllCounters,
  getCommandZoneInfo,
  nameMatchesClauseName,
  findBattlefieldPermanentsByName,
  getCounterCountCaseInsensitiveFromPerm,
  hasAnyCountersOnPermanent,
  typeLineHasWord,
  countControlledCreatureSubtype,
  isPrimeNumber,
  findBattlefieldPermanent,
};
