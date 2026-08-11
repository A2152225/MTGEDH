import type { PlayerID } from '../../../../shared/src/index.js';
import { canPayManaCostWithAvailableSources, parseManaCost } from './mana-check.js';

/**
 * Generic multikicker cast helpers (CR 702.33c).
 * Used for invest-style rocks like Everflowing Chalice:
 * Multikicker {2} + "enters with a charge counter for each time it was kicked"
 * + tap for mana equal to charge counters.
 */

export function parseMultikickerManaCost(oracleText: string): string | null {
  const match = String(oracleText || '').match(/\bmultikicker\s*((?:\{[^}]+\})+)/i);
  const cost = String(match?.[1] || '').trim();
  return cost || null;
}

export function isMultikickerChargeCounterManaInvest(oracleText: string): boolean {
  const text = String(oracleText || '').toLowerCase().replace(/\s+/g, ' ');
  if (!/\bmultikicker\b/.test(text)) return false;

  const entersWithKickCharges =
    /enters(?: the battlefield)? with (?:a |an |one )?charge counters? .* for each time it was kicked/.test(text)
    || /with (?:a |an |one )?charge counters? on it for each time it was kicked/.test(text);
  const paysOut =
    /\{t\}/.test(text)
    && /for each charge counter/.test(text)
    && /\badd\b/.test(text);

  return entersWithKickCharges && paysOut;
}

export function expandManaCostWithMultikicker(
  baseManaCost: string,
  multikickerCost: string | null | undefined,
  timesKicked: number,
): string {
  const times = Math.max(0, Math.floor(Number(timesKicked) || 0));
  const kickCost = String(multikickerCost || '').trim();
  const base = String(baseManaCost || '').trim();
  if (times <= 0 || !kickCost) {
    return base || '{0}';
  }
  return `${base}${kickCost.repeat(times)}` || '{0}';
}

export function getMultikickerChargeEntryCounters(
  oracleText: string,
  timesKicked: number,
): Record<string, number> | null {
  if (!isMultikickerChargeCounterManaInvest(oracleText)) return null;
  const times = Math.max(0, Math.floor(Number(timesKicked) || 0));
  if (times <= 0) return null;
  return { charge: times };
}

export function getParsedManaCostTotal(manaCost: string): number {
  const parsed = parseManaCost(String(manaCost || ''));
  const colored = Object.values(parsed.colors || {}).reduce((sum, amount) => sum + Number(amount || 0), 0);
  return Number(parsed.generic || 0) + colored;
}

export function getMaxAffordableMultikickerTimes(
  game: any,
  playerId: PlayerID,
  baseManaCost: string,
  multikickerCost: string,
  options?: {
    minValue?: number;
    maxValue?: number;
    excludedHandCardIds?: string[];
  },
): number {
  const minValue = Math.max(0, Math.floor(Number(options?.minValue ?? 0)));
  const maxValue = Math.max(minValue, Math.floor(Number(options?.maxValue ?? 20)));
  const exactManaOptions = options?.excludedHandCardIds?.length
    ? { excludedHandCardIds: options.excludedHandCardIds }
    : undefined;

  if (!String(multikickerCost || '').trim()) {
    return minValue;
  }

  for (let candidate = maxValue; candidate >= minValue; candidate -= 1) {
    const expanded = expandManaCostWithMultikicker(baseManaCost, multikickerCost, candidate);
    const parsedCost = parseManaCost(expanded);
    if (canPayManaCostWithAvailableSources(game.state, playerId, parsedCost, Infinity, exactManaOptions)) {
      return candidate;
    }
  }

  return minValue;
}

/**
 * For charge-counter mana invest multikicker, spend leftover mana in kick chunks.
 * Returns 0 when no kick can be afforded (caller should skip casting pure invest rocks).
 */
export function chooseMultikickerTimesForChargeInvest(
  game: any,
  playerId: PlayerID,
  card: any,
  options?: {
    baseManaCost?: string;
    excludedHandCardIds?: string[];
    maxValue?: number;
  },
): number {
  const oracleText = String(card?.oracle_text || card?.oracleText || '');
  const kickCost = parseMultikickerManaCost(oracleText);
  if (!kickCost || !isMultikickerChargeCounterManaInvest(oracleText)) {
    return 0;
  }

  const baseManaCost = String(
    options?.baseManaCost
    ?? card?.mana_cost
    ?? card?.manaCost
    ?? '{0}',
  ).trim() || '{0}';

  return getMaxAffordableMultikickerTimes(game, playerId, baseManaCost, kickCost, {
    minValue: 0,
    maxValue: options?.maxValue ?? 20,
    excludedHandCardIds: options?.excludedHandCardIds,
  });
}
