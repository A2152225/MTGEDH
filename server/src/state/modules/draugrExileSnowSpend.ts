// server/src/state/modules/draugrExileSnowSpend.ts
// Draugr Necromancer: you may cast spells from among cards in exile your
// opponents own with ice counters on them, and you may spend mana from snow
// sources as though it were mana of any color to cast those spells.
// Public: mayCastDraugrIceExileCard, draugrSnowSpendApplies,
//   canPayManaCostWithSnowAsAny.

import type { ParsedSpendCost } from './manaSpendAsThough.js';

const MANA_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;
const LETTER_TO_KEY: Record<string, typeof MANA_KEYS[number]> = {
  W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless',
};

const DRAUGR_CAST_RE =
  /you may cast spells from among cards in exile your opponents own with ice counters on them/i;
const DRAUGR_SNOW_RE =
  /spend mana from snow sources as though it were mana of any color to cast those spells/i;

function iceCounterCount(card: any): number {
  const counters = card?.counters || card?.card?.counters || {};
  return Math.max(0, Number(counters.ice || counters.Ice || 0));
}

function cardOwnerId(card: any, fallback?: string): string {
  return String(card?.owner || card?.card?.owner || fallback || '').trim();
}

function isCastableSpell(card: any): boolean {
  const typeLine = String(card?.type_line || card?.typeLine || card?.card?.type_line || '').toLowerCase();
  if (!typeLine) return true;
  if (typeLine.includes('land') && !/\b(creature|artifact|enchantment|planeswalker|instant|sorcery|battle|kindred)\b/.test(typeLine)) {
    return false;
  }
  return true;
}

export function playerControlsDraugrSnowCast(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true || permanent.faceDown === true) continue;
    if (String(permanent.controller || '') !== pid) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '').replace(/\u2019/g, "'");
    if (DRAUGR_CAST_RE.test(oracle) && DRAUGR_SNOW_RE.test(oracle)) return true;
  }
  return false;
}

export function mayCastDraugrIceExileCard(state: any, playerId: string, card: any): boolean {
  if (!card || !playerControlsDraugrSnowCast(state, playerId)) return false;
  if (!isCastableSpell(card)) return false;
  if (iceCounterCount(card) <= 0) return false;
  const owner = cardOwnerId(card);
  if (!owner) return false;
  return owner !== String(playerId || '');
}

export function draugrSnowSpendApplies(state: any, playerId: string, card: any): boolean {
  return mayCastDraugrIceExileCard(state, playerId, card);
}

function takeFrom(pool: Record<string, number>, amount: number, prefer?: string): number {
  let left = amount;
  if (prefer && (pool[prefer] || 0) > 0) {
    const take = Math.min(left, pool[prefer] || 0);
    pool[prefer] = (pool[prefer] || 0) - take;
    left -= take;
  }
  if (left > 0) {
    for (const key of MANA_KEYS) {
      if (prefer && key === prefer) continue;
      const take = Math.min(left, pool[key] || 0);
      if (take <= 0) continue;
      pool[key] = (pool[key] || 0) - take;
      left -= take;
      if (left <= 0) break;
    }
  }
  return left;
}

/** Pay a mana cost treating `snowPool` amounts already in `pool` as mana of any color. */
export function canPayManaCostWithSnowAsAny(
  pool: Record<string, number>,
  parsedCost: ParsedSpendCost,
  snowPool: Record<string, number> | undefined,
): boolean {
  const normal: Record<string, number> = {};
  const snow: Record<string, number> = {};
  for (const key of MANA_KEYS) {
    const total = Math.max(0, Math.floor(Number(pool?.[key] || 0)));
    const snowAmt = Math.min(total, Math.max(0, Math.floor(Number(snowPool?.[key] || 0))));
    snow[key] = snowAmt;
    normal[key] = total - snowAmt;
  }
  const colors = parsedCost?.colors || {};
  for (const [raw, neededRaw] of Object.entries(colors)) {
    let needed = Math.max(0, Math.floor(Number(neededRaw) || 0));
    if (!needed) continue;
    const rawKey = String(raw || '');
    const key = LETTER_TO_KEY[rawKey.toUpperCase()]
      || ((MANA_KEYS as readonly string[]).includes(rawKey.toLowerCase()) ? rawKey.toLowerCase() : rawKey.toLowerCase());
    const fromNormal = Math.min(needed, normal[key] || 0);
    normal[key] = (normal[key] || 0) - fromNormal;
    needed -= fromNormal;
    if (needed > 0 && takeFrom(snow, needed) > 0) return false;
  }
  const leftover = MANA_KEYS.reduce((sum, key) => sum + (normal[key] || 0) + (snow[key] || 0), 0);
  return leftover >= Math.max(0, Math.floor(Number(parsedCost?.generic || 0)));
}

export function emptyManaColorPool(): Record<string, number> {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

function isSnowPermanent(state: any, permanent: any): boolean {
  if (!permanent) return false;
  try {
    const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
    if (/\bsnow\b/.test(typeLine)) return true;
  } catch { /* fall through */ }
  return false;
}

/** Estimate mana still available from snow sources (untapped exact-mana sources). */
export function estimateSnowManaFromExactSources(
  state: any,
  sources: Array<{ permanentId?: string; options?: Array<{ produced?: Record<string, number>; activationCost?: unknown; lifeCost?: number }> }>,
): Record<string, number> {
  const snow = emptyManaColorPool();
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const source of sources || []) {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === String(source?.permanentId || ''));
    if (!isSnowPermanent(state, permanent)) continue;
    const freeOptions = (source.options || []).filter((option) => !option.activationCost && !(Number(option.lifeCost || 0) > 0));
    const option = freeOptions[0] || source.options?.[0];
    const produced = option?.produced || {};
    for (const key of MANA_KEYS) {
      snow[key] = (snow[key] || 0) + Math.max(0, Math.floor(Number(produced[key] || 0)));
    }
  }
  return snow;
}

/** Move snow mana onto missing colored requirements so a normal consume can pay. */
export function recolorSnowPoolToMeetCost(
  pool: Record<string, number>,
  parsedCost: ParsedSpendCost,
  snowPool: Record<string, number> | undefined,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const key of MANA_KEYS) next[key] = Math.max(0, Math.floor(Number(pool?.[key] || 0)));
  const snow: Record<string, number> = {};
  for (const key of MANA_KEYS) {
    snow[key] = Math.min(next[key] || 0, Math.max(0, Math.floor(Number(snowPool?.[key] || 0))));
  }
  const colors = parsedCost?.colors || {};
  for (const [raw, neededRaw] of Object.entries(colors)) {
    let needed = Math.max(0, Math.floor(Number(neededRaw) || 0));
    if (!needed) continue;
    const rawKey = String(raw || '');
    const key = LETTER_TO_KEY[rawKey.toUpperCase()] || rawKey.toLowerCase();
    const availableNormal = Math.max(0, (next[key] || 0) - (snow[key] || 0));
    const fromNormal = Math.min(needed, availableNormal);
    needed -= fromNormal;
    const fromSameSnow = Math.min(needed, snow[key] || 0);
    snow[key] = (snow[key] || 0) - fromSameSnow;
    needed -= fromSameSnow;
    if (needed <= 0) continue;
    for (const fromKey of MANA_KEYS) {
      if (fromKey === key) continue;
      const take = Math.min(needed, snow[fromKey] || 0);
      if (take <= 0) continue;
      snow[fromKey] = (snow[fromKey] || 0) - take;
      next[fromKey] = (next[fromKey] || 0) - take;
      next[key] = (next[key] || 0) + take;
      needed -= take;
      if (needed <= 0) break;
    }
  }
  return next;
}
