// server/src/socket/util-handlers/manaPoolCostPayment.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: floating-pool snapshots, hybrid-aware validate/consume,
//   ability spend-restriction helpers, and resolveManaCostForPoolPayment.
// Public entry symbols: getPoolNumericSnapshot, validateAndConsumeManaCostFromPool,
//   resolvePaymentManaAbilitySpendRestriction, restrictedManaSpendRestrictionAllowsPurpose,
//   buildActivatedAbilityRestrictedManaPurpose, validateAbilityManaCostFromPool,
//   payAbilityManaCostFromPool, addCastSpellPaymentProducedMana,
//   resolveManaCostForPoolPayment, ResolveManaCostForPoolPaymentResult.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { ManaPool, ManaRestrictionType } from "../../../../shared/src/index.js";
import { parseManaSpendRestrictionFromOracle } from "../../state/modules/mana-abilities.js";
import { getCreatureTypesNow } from "../../state/creatureTypeNow.js";
import { MANA_COLORS, MANA_COLOR_KEYS, MANA_COLOR_NAMES } from "./manaColorConstants.js";
import {
  calculateTotalAvailableMana,
  getOrInitManaPool,
  validateManaPayment,
} from "./manaPoolStateOperations.js";
import {
  addRestrictedManaToPool,
  buildManaTotalsIncludingEligibleRestricted,
  canUseRestrictedMana,
} from "./manaRestrictedPoolOperations.js";
import type { RestrictedManaSpendPurpose } from "./manaRestrictedPoolOperations.js";
import { resolveLegacyManaAbilityById } from "./manaAbilityLineResolvers.js";
import { consumeManaFromPool } from "./consumeManaFromPool.js";
import { consumeManaFromPoolForPurpose } from "./consumeManaFromPoolForPurpose.js";
import { parseManaCost } from "./parseManaCost.js";

type ValidateConsumeManaCostResult =
  | { ok: true; consumed: Record<string, number>; remaining: Record<string, number> }
  | { ok: false; error: string };

export type ResolveManaCostForPoolPaymentResult =
  | { ok: true; coloredCost: Record<string, number>; genericCost: number }
  | { ok: false; error: string };

export function getPoolNumericSnapshot(pool: ManaPool | Record<string, number>): Record<string, number> {
  return {
    white: Number((pool as any).white || 0),
    blue: Number((pool as any).blue || 0),
    black: Number((pool as any).black || 0),
    red: Number((pool as any).red || 0),
    green: Number((pool as any).green || 0),
    colorless: Number((pool as any).colorless || 0),
  };
}

function sumReservedColored(poolSnapshot: Record<string, number>, coloredCost: Record<string, number>): number {
  let used = 0;
  for (const color of MANA_COLORS) {
    const key = MANA_COLOR_NAMES[color];
    const needed = Number((coloredCost as any)[color] || 0);
    if (!key || needed <= 0) continue;
    used += needed;
    // validate shape: if pool doesn't have enough of a reserved color, payment is impossible
    if (Number(poolSnapshot[key] || 0) < needed) return Number.POSITIVE_INFINITY;
  }
  return used;
}

function orderHybridOptions(options: string[]): string[] {
  const colors = options.filter((o) => /^[WUBRGC]$/i.test(o));
  const generics = options.filter((o) => /^GENERIC:\d+$/i.test(o));
  const others = options.filter((o) => !/^[WUBRGC]$/i.test(o) && !/^GENERIC:\d+$/i.test(o));
  if (colors.length > 0 && generics.length > 0) {
    // Prefer paying with colored mana when possible rather than spending extra generic.
    return [...colors, ...generics, ...others];
  }
  return [...options];
}

/**
 * Hybrid-aware validation and consumption of mana costs from the *floating mana pool*.
 *
 * This is intentionally conservative and intended for deterministic server-side payments.
 * - Supports: colored, generic, and hybrid ({W/U}, {2/W}, etc.)
 * - Rejects: X costs and Phyrexian hybrid options (LIFE:)
 */
export function validateAndConsumeManaCostFromPool(
  pool: ManaPool | Record<string, number>,
  manaCost: string,
  opts?: { logPrefix?: string; purpose?: RestrictedManaSpendPurpose }
): ValidateConsumeManaCostResult {
  const poolForResolution = opts?.purpose
    ? buildManaTotalsIncludingEligibleRestricted(pool as ManaPool, opts.purpose)
    : getPoolNumericSnapshot(pool);
  const resolved = resolveManaCostForPoolPayment(poolForResolution, manaCost);
  if (!resolved.ok) return { ok: false, error: (resolved as any).error || 'Insufficient mana.' };

  const totalAvailable = opts?.purpose
    ? poolForResolution
    : calculateTotalAvailableMana(getPoolNumericSnapshot(pool) as any, undefined);
  const validationError = validateManaPayment(totalAvailable as any, resolved.coloredCost, resolved.genericCost);
  if (validationError) return { ok: false, error: validationError };

  const { consumed, remaining } = opts?.purpose
    ? (() => {
        const result = consumeManaFromPoolForPurpose(
          pool as ManaPool,
          resolved.coloredCost,
          resolved.genericCost,
          opts.purpose,
          opts?.logPrefix,
        );
        return { ...result, remaining: getPoolNumericSnapshot(pool) };
      })()
    : consumeManaFromPool(pool, resolved.coloredCost, resolved.genericCost, opts?.logPrefix);
  return { ok: true, consumed, remaining };
}

export function resolvePaymentManaAbilitySpendRestriction(
  gameState: any,
  permanent: any,
  playerId: string,
  abilityId?: string | null,
): { restriction: ManaRestrictionType; restrictedTo?: string } | null {
  const ability = resolveLegacyManaAbilityById(gameState, permanent, playerId, abilityId);
  const spendRestriction = ability?.spendRestriction;
  if (spendRestriction?.restriction) {
    return {
      restriction: spendRestriction.restriction,
      restrictedTo: spendRestriction.restrictedTo,
    };
  }
  // A resolved ability line without its own clause is unrestricted. Do not stamp the
  // card's other "Spend this mana only..." line onto Secluded Courtyard / Cavern {C}.
  if (ability && String(abilityId || '').trim()) {
    return null;
  }
  return parseManaSpendRestrictionFromOracle(String(permanent?.card?.oracle_text || ''));
}

export function restrictedManaSpendRestrictionAllowsPurpose(
  spendRestriction: { restriction: ManaRestrictionType; restrictedTo?: string } | null | undefined,
  purpose: RestrictedManaSpendPurpose,
): boolean {
  if (!spendRestriction?.restriction) return true;
  return canUseRestrictedMana(
    {
      type: 'colorless',
      amount: 1,
      restriction: spendRestriction.restriction,
      restrictedTo: spendRestriction.restrictedTo,
    },
    purpose,
  );
}

export function buildActivatedAbilityRestrictedManaPurpose(sourcePermanent: any): RestrictedManaSpendPurpose {
  const typeLine = String(sourcePermanent?.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) {
    return { isActivatedAbility: true, abilitySourceIsCreature: false };
  }
  for (const creatureType of getCreatureTypesNow(sourcePermanent)) {
    if (!creatureType || creatureType === '*') continue;
    return {
      isActivatedAbility: true,
      abilitySourceIsCreature: true,
      abilitySourceCreatureType: creatureType,
      creatureType,
    };
  }
  return { isActivatedAbility: true, abilitySourceIsCreature: true };
}

export function validateAbilityManaCostFromPool(
  gameState: any,
  controllerId: string,
  manaCost: string,
  sourcePermanent: any,
): { ok: true } | { ok: false; error: string } {
  const pool = getOrInitManaPool(gameState, controllerId);
  const purpose = buildActivatedAbilityRestrictedManaPurpose(sourcePermanent);
  const poolForResolution = buildManaTotalsIncludingEligibleRestricted(pool as ManaPool, purpose);
  const resolved = resolveManaCostForPoolPayment(poolForResolution, manaCost);
  if (!resolved.ok) {
    return { ok: false, error: (resolved as any).error || 'Insufficient mana.' };
  }
  const validationError = validateManaPayment(poolForResolution as any, resolved.coloredCost, resolved.genericCost);
  if (validationError) return { ok: false, error: validationError };
  return { ok: true };
}

export function payAbilityManaCostFromPool(
  gameState: any,
  controllerId: string,
  manaCost: string,
  sourcePermanent: any,
  logPrefix?: string,
): ValidateConsumeManaCostResult {
  const pool = getOrInitManaPool(gameState, controllerId);
  const purpose = buildActivatedAbilityRestrictedManaPurpose(sourcePermanent);
  return validateAndConsumeManaCostFromPool(pool, manaCost, { logPrefix, purpose });
}

export function addCastSpellPaymentProducedMana(
  gameState: any,
  playerId: string,
  pool: any,
  selectedTotals: Record<string, number>,
  additions: Record<string, number>,
  spendRestriction: { restriction: ManaRestrictionType; restrictedTo?: string } | null,
  source?: { id?: string; name?: string },
): void {
  for (const [colorKey, amount] of Object.entries(additions)) {
    const normalizedAmount = Number(amount || 0);
    if (normalizedAmount <= 0) continue;
    if (spendRestriction?.restriction) {
      addRestrictedManaToPool(
        gameState,
        playerId,
        colorKey as any,
        normalizedAmount,
        spendRestriction.restriction,
        spendRestriction.restrictedTo,
        source?.id,
        source?.name,
      );
    } else {
      pool[colorKey] = Number(pool[colorKey] || 0) + normalizedAmount;
    }
    selectedTotals[colorKey] = (selectedTotals[colorKey] || 0) + normalizedAmount;
  }
}

/**
 * Resolve a mana cost into a concrete (coloredCost, genericCost) payment *from the floating pool*,
 * deterministically choosing hybrid options.
 *
 * This does not consume mana; it only computes the payment and verifies it is payable.
 */
export function resolveManaCostForPoolPayment(
  pool: ManaPool | Record<string, number>,
  manaCost: string
): ResolveManaCostForPoolPaymentResult {
  const cost = String(manaCost || '').trim();
  if (!cost) return { ok: true, coloredCost: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, genericCost: 0 };

  const parsed = parseManaCost(cost);
  if (parsed.hasX) return { ok: false, error: 'Unsupported mana cost (X).' };

  const hasPhyrexianHybrid = (parsed.hybrids || []).some((opts) => (opts || []).some((o) => /^LIFE:/i.test(String(o))));
  if (hasPhyrexianHybrid) return { ok: false, error: 'Unsupported mana cost (Phyrexian).' };

  const poolSnapshot = getPoolNumericSnapshot(pool);
  const totalPool = MANA_COLOR_KEYS.reduce((sum, k) => sum + Number(poolSnapshot[k] || 0), 0);

  const baseColored: Record<string, number> = { ...parsed.colors };
  const baseGeneric = Number(parsed.generic || 0);
  const hybrids = Array.isArray(parsed.hybrids) ? parsed.hybrids : [];

  const tryChooseHybrids = (
    idx: number,
    reservedColored: Record<string, number>,
    extraGeneric: number
  ): { ok: true; reservedColored: Record<string, number>; extraGeneric: number } | { ok: false } => {
    if (idx >= hybrids.length) {
      const reservedSum = sumReservedColored(poolSnapshot, reservedColored);
      if (!Number.isFinite(reservedSum)) return { ok: false };
      const remainingTotal = totalPool - reservedSum;
      const requiredGeneric = baseGeneric + extraGeneric;
      if (remainingTotal < requiredGeneric) return { ok: false };
      return { ok: true, reservedColored, extraGeneric };
    }

    const optionsRaw = hybrids[idx] || [];
    const options = orderHybridOptions(optionsRaw.map((o) => String(o).toUpperCase()));

    for (const option of options) {
      if (/^GENERIC:\d+$/i.test(option)) {
        const n = Number.parseInt(option.split(':')[1], 10);
        if (!Number.isFinite(n) || n <= 0) continue;
        const res = tryChooseHybrids(idx + 1, reservedColored, extraGeneric + n);
        if (res.ok) return res;
        continue;
      }

      if (/^[WUBRGC]$/i.test(option)) {
        const sym = option.toUpperCase();
        const key = MANA_COLOR_NAMES[sym];
        if (!key) continue;

        const nextReserved = { ...reservedColored };
        nextReserved[sym] = Number(nextReserved[sym] || 0) + 1;
        if (Number(poolSnapshot[key] || 0) < Number(nextReserved[sym] || 0)) continue;

        const res = tryChooseHybrids(idx + 1, nextReserved, extraGeneric);
        if (res.ok) return res;
        continue;
      }
    }

    return { ok: false };
  };

  const baseReserved = { ...baseColored };
  const choice = tryChooseHybrids(0, baseReserved, 0);
  if (!choice.ok) {
    const totalAvailable = calculateTotalAvailableMana(poolSnapshot as any, undefined);
    const baseValidation = validateManaPayment(totalAvailable as any, baseColored, baseGeneric);
    return { ok: false, error: baseValidation || 'Insufficient mana.' };
  }

  return {
    ok: true,
    coloredCost: choice.reservedColored,
    genericCost: baseGeneric + Number(choice.extraGeneric || 0),
  };
}
