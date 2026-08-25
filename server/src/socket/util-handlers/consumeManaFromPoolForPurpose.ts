// server/src/socket/util-handlers/consumeManaFromPoolForPurpose.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: consumeManaFromPoolForPurpose - restricted-entry spend then
//   floating-pool drain for a RestrictedManaSpendPurpose.
// Public entry symbols: consumeManaFromPoolForPurpose.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { ManaPool, RestrictedManaEntry } from "../../../../shared/src/index.js";
import { debug } from "../../utils/debug.js";
import { MANA_COLORS, MANA_COLOR_NAMES } from "./manaColorConstants.js";
import { validateManaPayment } from "./manaPoolStateOperations.js";
import {
  buildManaTotalsIncludingEligibleRestricted,
  canUseRestrictedMana,
  getManaEntryColor,
} from "./manaRestrictedPoolOperations.js";
import type { RestrictedManaSpendPurpose } from "./manaRestrictedPoolOperations.js";
import { consumeManaFromPool } from "./consumeManaFromPool.js";

export function consumeManaFromPoolForPurpose(
  pool: ManaPool,
  coloredCost: Record<string, number>,
  genericCost: number,
  purpose: RestrictedManaSpendPurpose,
  logPrefix?: string,
): { consumed: Record<string, number> } {
  const mutablePool = pool as any;
  const restricted = Array.isArray(mutablePool.restricted) ? mutablePool.restricted as RestrictedManaEntry[] : [];
  const workingTotals = buildManaTotalsIncludingEligibleRestricted(pool, purpose);
  const validationError = validateManaPayment(workingTotals, coloredCost, genericCost);
  if (validationError) {
    return consumeManaFromPool(pool, coloredCost, genericCost, logPrefix);
  }

  const consumed: Record<string, number> = {
    white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
  };

  const takeFromRestricted = (colorKey: string, needed: number): number => {
    let remaining = needed;
    for (let index = restricted.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const entry = restricted[index];
      if (!entry || !canUseRestrictedMana(entry, purpose)) continue;
      if (getManaEntryColor(entry) !== colorKey) continue;
      const use = Math.min(entry.amount, remaining);
      if (use <= 0) continue;
      entry.amount -= use;
      remaining -= use;
      consumed[colorKey] = (consumed[colorKey] || 0) + use;
      if (entry.amount <= 0) {
        restricted.splice(index, 1);
      }
    }
    if (restricted.length === 0) {
      delete mutablePool.restricted;
    } else {
      mutablePool.restricted = restricted;
    }
    return needed - remaining;
  };

  for (const color of MANA_COLORS) {
    const colorKey = MANA_COLOR_NAMES[color];
    const needed = Number((coloredCost as any)[color] || 0);
    if (!colorKey || needed <= 0) continue;
    const fromRestricted = takeFromRestricted(colorKey, needed);
    const stillNeeded = needed - fromRestricted;
    if (stillNeeded > 0 && Number(mutablePool[colorKey] || 0) >= stillNeeded) {
      mutablePool[colorKey] = Number(mutablePool[colorKey] || 0) - stillNeeded;
      consumed[colorKey] = (consumed[colorKey] || 0) + stillNeeded;
    }
  }

  let genericLeft = genericCost;
  if (genericLeft > 0 && Number(mutablePool.colorless || 0) > 0) {
    const useColorless = Math.min(Number(mutablePool.colorless || 0), genericLeft);
    mutablePool.colorless = Number(mutablePool.colorless || 0) - useColorless;
    consumed.colorless = (consumed.colorless || 0) + useColorless;
    genericLeft -= useColorless;
  }

  for (const color of MANA_COLORS) {
    if (genericLeft <= 0) break;
    const colorKey = MANA_COLOR_NAMES[color];
    if (!colorKey) continue;
    const fromRestricted = takeFromRestricted(colorKey, genericLeft);
    genericLeft -= fromRestricted;
    if (genericLeft <= 0) break;
    const available = Number(mutablePool[colorKey] || 0);
    if (available <= 0) continue;
    const useColor = Math.min(available, genericLeft);
    mutablePool[colorKey] = available - useColor;
    consumed[colorKey] = (consumed[colorKey] || 0) + useColor;
    genericLeft -= useColor;
  }

  if (logPrefix) {
    debug(2, `${logPrefix} Consumed mana with restricted-purpose spending: ${JSON.stringify(consumed)}`);
  }

  return { consumed };
}
