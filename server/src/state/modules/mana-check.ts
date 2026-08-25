/**
 * mana-check.ts
 * 
 * Modular helper for checking if a player can pay mana costs.
 * Separated from can-respond.ts for better modularity and reusability.
 */

import {
  PHYREXIAN_LIFE_COST,
  type ParsedManaCost,
  type NormalizedManaPaymentModel,
} from "./mana-check-handlers/manaCheckPaymentTypes.js";
export { PHYREXIAN_LIFE_COST, type ParsedManaCost, type NormalizedManaPaymentModel };
import { stripReminderTextFromOracle } from "./mana-check-handlers/manaCheckOracleText.js";
export { stripReminderTextFromOracle };
import { getEmptyManaPool, getManaPoolFromState } from "./mana-check-handlers/manaCheckSimplePool.js";
export { getEmptyManaPool, getManaPoolFromState };
import { getAvailableMana } from "./mana-check-handlers/manaCheckAvailableMana.js";
export { getAvailableMana };
import {
  parseManaCost,
  normalizeParsedManaCost,
  stringifyParsedManaCost,
} from "./mana-check-handlers/manaCheckParseManaCost.js";
export { parseManaCost, normalizeParsedManaCost, stringifyParsedManaCost };
import {
  parseHandCostFromManaAbilityCost,
  parseReturnToHandCostFromManaAbilityCost,
} from "./mana-check-handlers/manaCheckAbilityCostParsers.js";
export { parseHandCostFromManaAbilityCost, parseReturnToHandCostFromManaAbilityCost };
import { getTotalManaFromPool, canPayManaCost, getMaxXValue } from "./mana-check-handlers/manaCheckCanPayManaCost.js";
export { getTotalManaFromPool, canPayManaCost, getMaxXValue };
import { canPayManaCostWithAvailableSources } from "./mana-check-handlers/manaCheckCanPayWithSources.js";
export { canPayManaCostWithAvailableSources };




export function buildNormalizedManaPaymentModel(options: {
  originalManaCost?: string;
  effectiveManaCost?: string;
  castWithoutPayingManaCost?: boolean;
  forcedAlternateCostId?: string;
  xValue?: number;
  additionalCosts?: unknown[];
}): NormalizedManaPaymentModel {
  const originalManaCost = String(options.originalManaCost || '').trim();
  const isFreeCast = options.castWithoutPayingManaCost === true || options.forcedAlternateCostId === 'free';
  const effectiveManaCost = isFreeCast
    ? '{0}'
    : String(options.effectiveManaCost || originalManaCost || '{0}').trim() || '{0}';
  const parsedOriginalCost = normalizeParsedManaCost(parseManaCost(originalManaCost));
  const parsedEffectiveCost = normalizeParsedManaCost(parseManaCost(effectiveManaCost));
  const phyrexianCosts = parsedEffectiveCost.hybrid
    .map((optionsForSymbol, index) => {
      const lifeOption = optionsForSymbol.find((option) => String(option || '').startsWith('LIFE:'));
      if (!lifeOption) return null;
      const colorOption = optionsForSymbol.find((option) => /^[WUBRGC]$/.test(String(option || '')));
      const lifeCost = Number(String(lifeOption).split(':')[1] || PHYREXIAN_LIFE_COST);
      return {
        index,
        color: String(colorOption || '').toUpperCase(),
        lifeCost: Number.isFinite(lifeCost) && lifeCost > 0 ? lifeCost : PHYREXIAN_LIFE_COST,
      };
    })
    .filter((entry): entry is { index: number; color: string; lifeCost: number } => Boolean(entry));

  return {
    originalManaCost,
    effectiveManaCost,
    parsedOriginalCost,
    parsedEffectiveCost,
    castWithoutPayingManaCost: isFreeCast,
    ...(options.forcedAlternateCostId ? { forcedAlternateCostId: options.forcedAlternateCostId } : {}),
    ...(options.xValue !== undefined ? { xValue: Number(options.xValue) || 0 } : {}),
    additionalCosts: Array.isArray(options.additionalCosts) ? [...options.additionalCosts] : [],
    phyrexianCosts,
    hybridCosts: parsedEffectiveCost.hybrid.map((entry) => [...entry]),
  };
}



