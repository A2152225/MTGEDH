/**
 * socket/resolutionPaymentManaUtils.ts
 *
 * Shared mana-payment helpers for resolution steps: persist tap/pool deltas,
 * activation-cost text checks, payment validation clones, and pool snapshots/deltas.
 *
 * Extracted from resolution.ts. Heavy applyWard / applySelected payment appliers
 * remain in resolution.ts and import these utilities.
 */

import { appendEvent } from "../db/index.js";
import { debugWarn } from "../utils/debug.js";
import {
  calculateManaProduction,
  getOrInitManaPool,
  parseManaCost,
  resolveActivatedAbilityLineById,
  validateManaPayment,
  consumeManaFromPool,
  canUseRestrictedMana,
  getFloatingPaymentPoolColorKey,
  type RestrictedManaSpendPurpose,
} from "./util.js";

export const MANA_POOL_KEY_BY_SYMBOL: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

function getFloatingPaymentPoolKey(permanentId: string, mana: string, pool?: any): string | null {
  return getFloatingPaymentPoolColorKey(permanentId, mana, pool);
}

export type ResolutionPaymentItem = {
  permanentId: string;
  mana: string;
  abilityId?: string;
  count?: number;
  producedColors?: string[]; // Added producedColors property
};

export type ResolutionManaPaymentPersistOptions = {
  /** When true, do not append tap/mana events (validation clones / callers that already parent-cover). */
  skipEventPersistence?: boolean;
};

/**
 * Persist resolution-path payment taps + net mana-pool delta after live mutation.
 * Uses appendEvent (DB only) because the caller already mutated state — do not appendGameEvent.
 * Gated by isReplaying / missing gameId / skipEventPersistence to avoid doubles during replay
 * and when a parent event already carries tappedPermanents + paymentManaDelta.
 */
export function persistResolutionPaymentManaMutations(
  game: any,
  playerId: string,
  tappedPermanentIds: string[] | undefined,
  paymentManaDelta: Record<string, number> | undefined,
  options?: ResolutionManaPaymentPersistOptions,
): void {
  if (options?.skipEventPersistence) return;
  if ((game as any)?.isReplaying) return;

  const gameId = String((game as any)?.gameId || (game as any)?.id || '').trim();
  if (!gameId || gameId === 'unknown') return;

  const pid = String(playerId || '').trim();
  if (!pid) return;

  const seq = Number((game as any)?.seq?.value ?? (game as any)?.seq ?? 0);
  const tappedIds = Array.from(
    new Set(
      (Array.isArray(tappedPermanentIds) ? tappedPermanentIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    ),
  );

  if (tappedIds.length > 0) {
    try {
      appendEvent(gameId, seq, 'permanent_tapped', {
        playerId: pid,
        permanentIds: tappedIds,
        reason: 'resolution_mana_payment',
      });
    } catch (err) {
      debugWarn(1, '[resolution] appendEvent(permanent_tapped payment) failed:', err);
    }
  }

  if (paymentManaDelta && typeof paymentManaDelta === 'object' && !Array.isArray(paymentManaDelta)) {
    for (const [poolKey, rawAmount] of Object.entries(paymentManaDelta)) {
      const amount = Number(rawAmount || 0);
      if (!Number.isFinite(amount) || amount === 0) continue;
      const color = String(poolKey || '').trim();
      if (!color) continue;
      try {
        if (amount > 0) {
          appendEvent(gameId, seq, 'addManaToPool', {
            playerId: pid,
            color,
            amount,
            reason: 'resolution_mana_payment',
          });
        } else {
          appendEvent(gameId, seq, 'removeManaFromPool', {
            playerId: pid,
            color,
            amount: Math.abs(amount),
            reason: 'resolution_mana_payment',
          });
        }
      } catch (err) {
        debugWarn(1, '[resolution] appendEvent(mana pool payment delta) failed:', err);
      }
    }
  }
}

export function getResolutionManaSourceCostText(
  game: any,
  playerId: string,
  permanent: any,
  mana?: string,
  abilityId?: string,
): string {
  const resolvedLine = resolveActivatedAbilityLineById(permanent, abilityId);
  const resolvedCostText = String(resolvedLine?.costText || '').trim();
  if (resolvedCostText) {
    return resolvedCostText.toLowerCase();
  }

  const selectedActivationCost = String(
    calculateManaProduction(game.state, permanent, playerId, mana, abilityId)?.activationCost || ''
  ).trim();
  if (selectedActivationCost) {
    return selectedActivationCost.toLowerCase();
  }

  if (String(abilityId || '').trim()) {
    return '';
  }

  // Keyword lines (Indestructible) sit above "{T}: Add {C}. This mana can't be spent..."
  // on Vibranium/Powerstone tokens. Only the mana ability's cost is an activation cost.
  const oracleText = String((permanent as any)?.card?.oracle_text || '');
  const manaAbilityCost = oracleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\{t\}/i.test(line) && /\badd\b/i.test(line))
    .map((line) => line.split(':')[0]?.trim().toLowerCase())
    .find((cost) => Boolean(cost));
  if (manaAbilityCost) return manaAbilityCost;

  return oracleText.split(':')[0].toLowerCase();
}

export function escapeResolutionCostRegExp(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolutionManaSourceSelfSacrifices(
  game: any,
  playerId: string,
  permanent: any,
  mana?: string,
  abilityId?: string,
): boolean {
  const costText = getResolutionManaSourceCostText(game, playerId, permanent, mana, abilityId);
  if (!/\bsacrifice\b/.test(costText)) return false;
  if (/\bsacrifice\s+(?:this|~)\b/.test(costText)) return true;

  const cardName = String((permanent as any)?.card?.name || '').trim().toLowerCase();
  if (!cardName) return false;

  return new RegExp(`\\bsacrifice\\s+${escapeResolutionCostRegExp(cardName)}\\b`, 'i').test(costText);
}

export function resolutionPaymentActivationCostHasUnsupportedAdditionalCosts(
  game: any,
  playerId: string,
  permanent: any,
  mana?: string,
  abilityId?: string,
): boolean {
  const costText = getResolutionManaSourceCostText(game, playerId, permanent, mana, abilityId);
  if (!costText) return false;

  let residue = costText;
  residue = residue.replace(/\{(?:[tq]|\d+|[wubrgc])\}/gi, ' ');
  if (resolutionManaSourceSelfSacrifices(game, playerId, permanent, mana, abilityId)) {
    residue = residue.replace(/sacrifice\s+[^,;:]*/gi, ' ');
  }
  residue = residue.replace(/[().]/g, ' ');
  residue = residue.replace(/,/g, ' ');
  residue = residue.replace(/\s+/g, ' ').trim();

  return residue.length > 0;
}

export function getSupportedResolutionActivationManaCost(
  game: any,
  playerId: string,
  permanent: any,
  mana?: string,
  abilityId?: string,
): ReturnType<typeof parseManaCost> | undefined {
  const costText = getResolutionManaSourceCostText(game, playerId, permanent, mana, abilityId);
  if (!costText) return undefined;

  const parsedCost = parseManaCost(costText);
  const hasValue = Number(parsedCost.generic || 0) > 0
    || Object.values(parsedCost.colors || {}).some((value) => Number(value || 0) > 0);

  if (!hasValue) return undefined;
  if (parsedCost.hasX || parsedCost.hybrids.length > 0) return undefined;

  return parsedCost;
}

export function cloneGameForResolutionPaymentValidation(game: any, playerId: string): any {
  const state = (game?.state || {}) as any;
  const playerZones = ((state.zones || {})[playerId] || {}) as any;

  return {
    ...game,
    state: {
      ...state,
      battlefield: Array.isArray(state.battlefield)
        ? state.battlefield.map((permanent: any) => ({
            ...permanent,
            card: permanent?.card && typeof permanent.card === 'object' ? { ...permanent.card } : permanent?.card,
            counters: permanent?.counters && typeof permanent.counters === 'object' ? { ...permanent.counters } : permanent?.counters,
          }))
        : [],
      manaPool: {
        ...(state.manaPool || {}),
        [playerId]: { ...(((state.manaPool || {})[playerId] || {}) as any) },
      },
      zones: {
        ...(state.zones || {}),
        [playerId]: {
          ...playerZones,
          hand: Array.isArray(playerZones.hand) ? [...playerZones.hand] : playerZones.hand,
          graveyard: Array.isArray(playerZones.graveyard) ? [...playerZones.graveyard] : [],
          exile: Array.isArray(playerZones.exile) ? [...playerZones.exile] : playerZones.exile,
        },
      },
    },
  };
}

export function getTappedResolutionPaymentPermanentIds(payment?: ResolutionPaymentItem[]): string[] {
  if (!Array.isArray(payment) || payment.length === 0) return [];

  return Array.from(
    new Set(
      payment
        .map((item) => ({
          permanentId: String(item?.permanentId || '').trim(),
          mana: String(item?.mana || '').trim(),
        }))
        .filter((item) => item.permanentId.length > 0 && !getFloatingPaymentPoolKey(item.permanentId, item.mana))
        .map((item) => item.permanentId)
    )
  );
}

export function snapshotResolutionManaPool(pool: any): Record<string, number> {
  return {
    white: Number(pool?.white || 0),
    blue: Number(pool?.blue || 0),
    black: Number(pool?.black || 0),
    red: Number(pool?.red || 0),
    green: Number(pool?.green || 0),
    colorless: Number(pool?.colorless || 0),
  };
}

export const RESOLUTION_PAYMENT_MANA_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;

export function createEmptyResolutionManaTotals(): Record<string, number> {
  return snapshotResolutionManaPool(undefined);
}

export function getResolutionPaymentProducedManaTotals(
  mana?: string | null,
  count?: number | null,
  producedColors?: readonly string[] | null,
): Record<string, number> {
  const totals = createEmptyResolutionManaTotals();
  const normalizedProducedColors = Array.isArray(producedColors)
    ? producedColors
        .map((color) => String(color || '').trim().toUpperCase())
        .filter((color): color is string => Object.prototype.hasOwnProperty.call(MANA_POOL_KEY_BY_SYMBOL, color))
    : [];

  if (normalizedProducedColors.length > 0) {
    for (const color of normalizedProducedColors) {
      const poolKey = MANA_POOL_KEY_BY_SYMBOL[color];
      if (poolKey) {
        totals[poolKey] = (totals[poolKey] || 0) + 1;
      }
    }
    return totals;
  }

  const poolKey = MANA_POOL_KEY_BY_SYMBOL[String(mana || '').trim().toUpperCase()];
  const amount = Math.max(1, Number(count || 1));
  if (poolKey && amount > 0) {
    totals[poolKey] = (totals[poolKey] || 0) + amount;
  }

  return totals;
}

export function addResolutionManaTotals(target: any, delta: any): void {
  for (const key of RESOLUTION_PAYMENT_MANA_KEYS) {
    const amount = Number(delta?.[key] || 0);
    if (amount > 0) {
      target[key] = Number(target?.[key] || 0) + amount;
    }
  }
}

export function consumeExplicitSelectedResolutionMana(
  pool: any,
  selectedAvailable: Record<string, number>,
  coloredCost: Record<string, number>,
  genericCost: number,
  logPrefix: string,
  purpose?: RestrictedManaSpendPurpose,
): { consumed: Record<string, number> } | { error: string } {
  const selectedPool = snapshotResolutionManaPool(selectedAvailable);
  const validationError = validateManaPayment(selectedPool, coloredCost, genericCost);
  if (validationError) {
    return { error: validationError };
  }

  const manaConsumption = consumeManaFromPool(selectedPool, coloredCost, genericCost, logPrefix);

  for (const key of RESOLUTION_PAYMENT_MANA_KEYS) {
    let remaining = Number((manaConsumption.consumed as any)?.[key] || 0);
    if (remaining <= 0) continue;

    // Prefer eligible restricted mana before unrestricted (keep flexible mana).
    if (remaining > 0 && purpose && Array.isArray(pool?.restricted)) {
      for (let index = pool.restricted.length - 1; index >= 0 && remaining > 0; index -= 1) {
        const entry = pool.restricted[index];
        if (!entry || !canUseRestrictedMana(entry, purpose)) continue;
        if (String(entry.type || '') !== key) continue;
        const use = Math.min(Number(entry.amount || 0), remaining);
        if (use <= 0) continue;
        entry.amount -= use;
        remaining -= use;
        if (entry.amount <= 0) {
          pool.restricted.splice(index, 1);
        }
      }
      if (Array.isArray(pool.restricted) && pool.restricted.length === 0) {
        delete pool.restricted;
      }
    }

    const regularAvailable = Number(pool?.[key] || 0);
    const regularUse = Math.min(regularAvailable, remaining);
    if (regularUse > 0) {
      pool[key] = regularAvailable - regularUse;
      remaining -= regularUse;
    }

    if (remaining > 0) {
      return { error: `Selected payment used more ${key} mana than is available.` };
    }
  }

  return { consumed: manaConsumption.consumed };
}

export function calculateResolutionManaPoolDelta(before: any, after: any): Record<string, number> | undefined {
  const baseline = snapshotResolutionManaPool(before);
  const current = snapshotResolutionManaPool(after);
  const delta: Record<string, number> = {};

  for (const key of ['white', 'blue', 'black', 'red', 'green', 'colorless']) {
    const amount = Number(current[key] || 0) - Number(baseline[key] || 0);
    if (amount !== 0) {
      delta[key] = amount;
    }
  }

  return Object.keys(delta).length > 0 ? delta : undefined;
}

