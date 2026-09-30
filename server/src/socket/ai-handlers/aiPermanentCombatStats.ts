/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: getPermanentKeywordSet and getPermanentCombatStats used by
 * keyword-counter scoring and some option prompts.
 *
 * Public entry symbols: getPermanentKeywordSet, getPermanentCombatStats.
 */

import { getCurrentPowerToughness } from '../../state/modules/currentPowerToughness.js';

export function getPermanentKeywordSet(permanent: any): Set<string> {
  const keywords = new Set<string>();

  for (const keyword of Array.isArray(permanent?.card?.keywords) ? permanent.card.keywords : []) {
    const normalized = String(keyword || '').trim().toLowerCase();
    if (normalized) keywords.add(normalized);
  }

  for (const ability of Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : []) {
    const normalized = String(ability || '').trim().toLowerCase();
    if (normalized) keywords.add(normalized);
  }

  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  for (const [counterName, amount] of Object.entries(counters)) {
    if (Number(amount || 0) <= 0) continue;
    const normalized = String(counterName || '').trim().toLowerCase();
    if (normalized && !normalized.includes('+') && !normalized.includes('-')) {
      keywords.add(normalized);
    }
  }

  return keywords;
}

/**
 * Combat stats for AI scoring. With a game state, a battlefield permanent reads its CURRENT power/toughness
 * (anthems, pumps, set-base effects, counters - the same numbers the P/T badge shows); otherwise (no state,
 * or an object that is not on the battlefield) it keeps reading the printed/base values.
 */
export function getPermanentCombatStats(permanent: any, state?: any): { power: number; toughness: number } {
  if (state && Array.isArray(state.battlefield)) {
    const id = String(permanent?.id || '').trim();
    if (id && state.battlefield.some((entry: any) => String(entry?.id || '').trim() === id)) {
      try {
        const current = getCurrentPowerToughness(permanent, state);
        if (current && Number.isFinite(current.power) && Number.isFinite(current.toughness)) {
          return { power: current.power, toughness: current.toughness };
        }
      } catch {
        // fall back to the printed values below
      }
    }
  }
  return {
    power: Number(permanent?.card?.power || permanent?.basePower || 0) || 0,
    toughness: Number(permanent?.card?.toughness || permanent?.baseToughness || 0) || 0,
  };
}
