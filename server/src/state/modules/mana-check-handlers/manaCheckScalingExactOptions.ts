// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: buildScalingManaExactOptions (creature-count / devotion / power-instead).
// Public entry symbols: buildScalingManaExactOptions.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import {
  getCreatureCountManaAmount,
  getDevotionManaAmount,
  resolvePowerThresholdInsteadManaAbility,
  parseManaSpendRestrictionFromOracle,
} from "../mana-abilities.js";
import { parseManaCost } from "./manaCheckParseManaCost.js";
import {
  type ExactManaSourceOption,
  type SimpleManaKey,
  manaSymbolToColorKey,
  createSingleColorProduction,
  createSimpleManaPool,
} from "./manaCheckSimplePool.js";

export function buildScalingManaExactOptions(
  state: any,
  playerId: PlayerID,
  permanent: any,
): ExactManaSourceOption[] {
  const powerInstead = resolvePowerThresholdInsteadManaAbility(
    state,
    playerId,
    String(permanent?.card?.oracle_text || ''),
  );
  if (powerInstead) {
    const amount = Number(powerInstead.amount || (powerInstead.producesAllAtOnce ? powerInstead.produces.length : 1));
    if (powerInstead.producesAllAtOnce && powerInstead.produces.length > 1) {
      const produced = createSimpleManaPool();
      for (const symbol of powerInstead.produces) {
        const colorKey = manaSymbolToColorKey(symbol);
        if (colorKey) produced[colorKey] += 1;
      }
      return [{ produced }];
    }
    if (powerInstead.produces.length === 1) {
      const colorKey = manaSymbolToColorKey(powerInstead.produces[0]);
      if (colorKey) return [{ produced: createSingleColorProduction(colorKey, Math.max(1, amount)) }];
    }
  }

  const scaling: {
    color: string;
    amount: number;
    activationCost?: string;
    requiresColorChoice?: boolean;
    dynamicAmountSource?: 'devotion';
  } | null = getCreatureCountManaAmount(state, permanent, playerId)
    || getDevotionManaAmount(state, permanent, playerId);
  if (!scaling || !Number.isFinite(scaling.amount) || scaling.amount <= 0) {
    return [];
  }

  const amount = Math.max(0, Number(scaling.amount || 0));
  const color = String(scaling.color || '').trim();
  const activationCost = scaling.activationCost
    ? parseManaCost(String(scaling.activationCost))
    : undefined;
  const spendRestriction = parseManaSpendRestrictionFromOracle(String(permanent?.card?.oracle_text || ''))
    || undefined;

  const wrap = (produced: Record<SimpleManaKey, number>): ExactManaSourceOption => {
    const option: ExactManaSourceOption = { produced };
    if (activationCost) option.activationCost = activationCost;
    if (spendRestriction) {
      option.spendRestriction = {
        restriction: spendRestriction.restriction,
        restrictedTo: spendRestriction.restrictedTo,
      };
    }
    return option;
  };

  if (color === 'any_one_color' || color === 'any_combination' || color === 'any') {
    return (['white', 'blue', 'black', 'red', 'green'] as SimpleManaKey[]).map((key) =>
      wrap(createSingleColorProduction(key, amount)),
    );
  }

  if (color.startsWith('combination:')) {
    const letters = color
      .slice('combination:'.length)
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
    const options: ExactManaSourceOption[] = [];
    for (const letter of letters) {
      const colorKey = manaSymbolToColorKey(letter);
      if (!colorKey) continue;
      options.push(wrap(createSingleColorProduction(colorKey, amount)));
    }
    return options;
  }

  const colorKey = manaSymbolToColorKey(color);
  if (!colorKey) return [];
  return [wrap(createSingleColorProduction(colorKey, amount))];
}
