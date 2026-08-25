/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: mana-cost adjustment arithmetic and the client-facing payloads
 * built from it - applying reductions/taxes to a parsed cost, rendering the
 * adjusted cost string, the payment-step cost adjustment payload, and the
 * pending-cast cost metadata assembled for a spell about to be paid for.
 *
 * Public entry symbols:
 *   - applyCostAdjustment / applyCostReduction
 *   - countXManaSymbols / expandManaCostWithChosenX
 *   - formatManaCostWithCostAdjustment / formatManaCostWithReduction
 *   - formatSpellAlternateCostWithReduction
 *   - buildPaymentCostAdjustmentPayload / buildPaymentStepCostAdjustment
 *   - buildPendingCastCostMetadata
 *   - buildAlternateCastSpellManaCost
 *   - GRAVEYARD_ALTERNATE_CAST_ABILITY_IDS / isGraveyardAlternateCastAbilityId
 */
import { parseManaCost } from "../util";
import { buildNormalizedManaPaymentModel } from "../../state/modules/mana-check.js";
import {
  calculateCostReduction,
  calculateStaticSourceGenericTax,
  createEmptyCostReduction,
  type CostReductionMetadata,
  type PaymentStepCostAdjustment,
  type PendingCastCostMetadata,
  type SpellCastSourceZone,
} from "./gameActionsCastCostReduction.js";

export function buildPaymentCostAdjustmentPayload(
  originalManaCost: string,
  adjustedManaCost: string,
  costReduction?: CostReductionMetadata,
  genericTax = 0,
  taxMessages: string[] = [],
): PaymentStepCostAdjustment | undefined {
  const reduction = costReduction || createEmptyCostReduction();
  const reductionMessages = Array.isArray(reduction.messages) ? [...reduction.messages] : [];
  const safeTaxMessages = Array.isArray(taxMessages) ? [...taxMessages] : [];
  const hasReduction = reduction.generic > 0
    || Object.values(reduction.colors || {}).some((amount) => Number(amount) > 0)
    || reductionMessages.length > 0;
  const hasIncrease = Number(genericTax || 0) > 0 || safeTaxMessages.length > 0;

  if (!hasReduction && !hasIncrease && String(originalManaCost || '') === String(adjustedManaCost || '')) {
    return undefined;
  }

  return {
    originalManaCost: String(originalManaCost || ''),
    adjustedManaCost: String(adjustedManaCost || ''),
    genericReduction: Math.max(0, Number(reduction.generic || 0)),
    coloredReductions: { ...(reduction.colors || {}) },
    genericTax: Math.max(0, Number(genericTax || 0)),
    reductionMessages,
    taxMessages: safeTaxMessages,
    sources: [
      ...reductionMessages.map((message) => ({ kind: 'reduction' as const, message })),
      ...safeTaxMessages.map((message) => ({ kind: 'increase' as const, message })),
    ],
    kind: hasReduction && hasIncrease ? 'mixed' : hasIncrease ? 'increase' : 'reduction',
  };
}

export function buildPaymentStepCostAdjustment(
  originalManaCost: string,
  adjustedManaCost: string,
  costReduction?: CostReductionMetadata,
  genericTax = 0,
  taxMessages: string[] = [],
): PaymentStepCostAdjustment | undefined {
  return buildPaymentCostAdjustmentPayload(originalManaCost, adjustedManaCost, costReduction, genericTax, taxMessages);
}

export function buildPendingCastCostMetadata(
  game: any,
  playerId: string,
  card: any,
  castSourceZone: SpellCastSourceZone,
  paymentCostAdjustment?: PaymentStepCostAdjustment,
): PendingCastCostMetadata {
  const costReduction = calculateCostReduction(game, playerId, card);
  const staticCostTax = calculateStaticSourceGenericTax(game, playerId, card);
  const originalManaCost = String(card?.mana_cost || '').trim();
  const paymentModel = buildNormalizedManaPaymentModel({
    originalManaCost,
    effectiveManaCost: String(paymentCostAdjustment?.adjustedManaCost || originalManaCost || '{0}'),
    castWithoutPayingManaCost: (card as any)?.castWithoutPayingManaCost === true,
    forcedAlternateCostId: String((card as any)?.forcedAlternateCostId || '').trim() || undefined,
    additionalCosts: Array.isArray((card as any)?.additionalCosts) ? (card as any).additionalCosts : [],
  });

  return {
    costReduction,
    staticCostTax,
    genericCostTax: staticCostTax.generic,
    paymentModel,
    ...(paymentCostAdjustment ? { paymentCostAdjustment } : {}),
  };
}

export function applyCostAdjustment<TParsedCost extends { generic: number; colors: Record<string, number> }>(
  parsedCost: TParsedCost,
  reduction: { generic: number; colors: Record<string, number>; messages?: string[] },
  genericTax = 0,
): TParsedCost {
  const colorNameToSymbol: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    colorless: 'C',
    W: 'W',
    U: 'U',
    B: 'B',
    R: 'R',
    G: 'G',
    C: 'C',
  };

  const result = {
    ...parsedCost,
    generic: Math.max(0, parsedCost.generic + Math.max(0, Number(genericTax || 0)) - reduction.generic),
    colors: { ...parsedCost.colors },
  } as TParsedCost;
  
  // Apply color reductions (can reduce to 0 but not below)
  for (const [reductionColor, amount] of Object.entries(reduction.colors || {})) {
    const symbol = colorNameToSymbol[reductionColor];
    if (!symbol || !result.colors[symbol]) continue;
    if (amount) {
      result.colors[symbol] = Math.max(0, result.colors[symbol] - amount);
    }
  }
  
  return result;
}

/** @deprecated Use applyCostAdjustment; this also supports generic taxes. */
export function applyCostReduction(
  parsedCost: { generic: number; colors: Record<string, number> },
  reduction: { generic: number; colors: Record<string, number>; messages?: string[] },
  genericTax = 0,
): { generic: number; colors: Record<string, number> } {
  return applyCostAdjustment(parsedCost, reduction, genericTax);
}

export function countXManaSymbols(manaCost?: string): number {
  if (!manaCost) return 0;
  const matches = String(manaCost).match(/\{X\}/gi);
  return matches ? matches.length : 0;
}

export function expandManaCostWithChosenX(manaCost: string, xValue?: number): string {
  if (!manaCost) return '';

  const normalizedX = Number.isFinite(xValue) ? Math.max(0, Math.floor(Number(xValue))) : undefined;
  if (normalizedX === undefined) return manaCost;

  const xCount = countXManaSymbols(manaCost);
  const genericFromX = xCount * normalizedX;
  const withoutX = manaCost.replace(/\{X\}/gi, '');

  if (genericFromX <= 0) {
    return withoutX || '{0}';
  }

  return `{${genericFromX}}${withoutX}`;
}

export function formatManaCostWithCostAdjustment(
  manaCost: string,
  reduction?: { generic?: number; colors?: Record<string, number> },
  xValue?: number,
  genericTax = 0,
): string {
  if (!manaCost) return '';

  const concreteManaCost = expandManaCostWithChosenX(manaCost, xValue);
  const parsedCost = parseManaCost(concreteManaCost);
  const reducedCost = applyCostAdjustment(parsedCost, {
    generic: Math.max(0, Number(reduction?.generic || 0)),
    colors: { ...(reduction?.colors || {}) },
  }, genericTax);

  let reducedCostStr = '';

  if (parsedCost.hasX) {
    reducedCostStr += '{X}';
  }
  if (reducedCost.generic > 0) {
    reducedCostStr += `{${reducedCost.generic}}`;
  }
  for (const [color, count] of Object.entries(reducedCost.colors)) {
    for (let i = 0; i < count; i++) {
      reducedCostStr += `{${color}}`;
    }
  }
  for (const hybrid of parsedCost.hybrids) {
    reducedCostStr += `{${hybrid.join('/')}}`;
  }

  return reducedCostStr || '{0}';
}

export const GRAVEYARD_ALTERNATE_CAST_ABILITY_IDS = [
  'flashback',
  'jump-start',
  'retrace',
  'escape',
  'disturb',
  'graveyard-cast',
] as const;

export function isGraveyardAlternateCastAbilityId(abilityId: string): boolean {
  const normalized = String(abilityId || '').trim().toLowerCase();
  return (GRAVEYARD_ALTERNATE_CAST_ABILITY_IDS as readonly string[]).includes(normalized);
}

export function buildAlternateCastSpellManaCost(
  game: any,
  playerId: string,
  card: any,
  alternateManaCost: string,
  xValue?: number,
): {
  originalManaCost: string;
  adjustedManaCost: string;
  costReduction: ReturnType<typeof calculateCostReduction>;
  genericCostTax: number;
  costAdjustment?: PaymentStepCostAdjustment;
} {
  const originalManaCost = String(alternateManaCost || '').trim();
  const costReduction = calculateCostReduction(game, playerId, card);
  const staticCostTax = calculateStaticSourceGenericTax(game, playerId, card);
  const adjustedManaCost = formatManaCostWithCostAdjustment(
    originalManaCost,
    costReduction,
    xValue,
    staticCostTax.generic,
  );
  const costAdjustment = buildPaymentCostAdjustmentPayload(
    originalManaCost,
    adjustedManaCost,
    costReduction,
    staticCostTax.generic,
    staticCostTax.messages,
  );

  return {
    originalManaCost,
    adjustedManaCost,
    costReduction,
    genericCostTax: staticCostTax.generic,
    ...(costAdjustment ? { costAdjustment } : {}),
  };
}

export function formatSpellAlternateCostWithReduction(
  game: any,
  playerId: string,
  card: any,
  alternateManaCost: string,
  castSourceZone: SpellCastSourceZone = 'hand',
  xValue?: number,
): string {
  const paymentMetadata = buildPendingCastCostMetadata(game, playerId, card, castSourceZone);
  return formatManaCostWithCostAdjustment(
    alternateManaCost,
    paymentMetadata.costReduction,
    xValue,
    paymentMetadata.genericCostTax,
  );
}

/** @deprecated Use formatManaCostWithCostAdjustment; this also supports generic taxes. */
export function formatManaCostWithReduction(
  manaCost: string,
  reduction?: { generic?: number; colors?: Record<string, number> },
  xValue?: number,
  genericTax = 0,
): string {
  return formatManaCostWithCostAdjustment(manaCost, reduction, xValue, genericTax);
}
