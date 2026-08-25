// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: PHYREXIAN_LIFE_COST, ParsedManaCost, NormalizedManaPaymentModel.
// Public entry symbols: PHYREXIAN_LIFE_COST, ParsedManaCost, NormalizedManaPaymentModel.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

/**
 * Phyrexian mana can be paid with 2 life instead of the colored mana
 * Rule 107.4f: "The Phyrexian mana symbol is {X/P}, where X is one of the five colored 
 * mana symbols. A Phyrexian mana symbol represents a cost that can be paid by spending 
 * one mana of the color associated with that Phyrexian mana symbol or by paying 2 life."
 */
export const PHYREXIAN_LIFE_COST = 2;

export interface ParsedManaCost {
  colors: Record<string, number>;
  generic: number;
  hasX: boolean;
  hybrid: Array<string[]>;
  hybrids: Array<string[]>;
}

export interface NormalizedManaPaymentModel {
  originalManaCost: string;
  effectiveManaCost: string;
  parsedOriginalCost: ParsedManaCost;
  parsedEffectiveCost: ParsedManaCost;
  castWithoutPayingManaCost: boolean;
  forcedAlternateCostId?: string;
  xValue?: number;
  additionalCosts: unknown[];
  phyrexianCosts: Array<{ index: number; color: string; lifeCost: number }>;
  hybridCosts: Array<string[]>;
}
