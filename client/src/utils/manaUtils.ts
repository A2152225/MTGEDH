/**
 * Shared mana utilities for the client
 * Provides mana parsing, payment calculation, and related functions
 */
import type { PaymentItem, ManaColor } from '../../../shared/src';
import type { SacrificeType } from '../../../shared/src/textUtils';
import type { RestrictedManaPoolEntry, RestrictedManaSpendPurpose } from './manaRestrictedSpendPurpose';
import { canUseRestrictedManaClient, sourcePrefersUncounterableChosenTypeCast } from './manaRestrictedSpendPurpose';
import {
  chargeSourceActivationCost,
  getSourceActivationManaPips,
  tryAssignFixedMixedManaBundle,
} from './manaSuggestedPaymentActivation';

export type { RestrictedManaPoolEntry, RestrictedManaSpendPurpose } from './manaRestrictedSpendPurpose';
export {
  typeLineIndicatesArtifactSpell,
  canUseRestrictedManaClient,
  buildRestrictedManaPurposeForSpell,
  sourcePrefersUncounterableChosenTypeCast,
} from './manaRestrictedSpendPurpose';

export type Color = ManaColor;

// Standard mana color symbols in WUBRG order plus colorless
export const MANA_COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

export interface ParsedManaCost {
  colors: Record<Color, number>;
  generic: number;
  hybrids: Color[][];
  hasX: boolean;
  xCount?: number; // Number of X's in the cost (1 for X, 2 for XX, 3 for XXX)
}

export interface OtherCardInfo {
  id: string;
  name: string;
  mana_cost?: string;
}

export interface ManaSourceSacrificeCost {
  count: number;
  permanentType: Exclude<SacrificeType, 'self'>;
  creatureSubtype?: string;
  mustBeOther?: boolean;
}

export interface ManaPaymentSource {
  id: string;
  sourcePermanentId?: string;
  abilityId?: string;
  name: string;
  label?: string;
  options: Color[];
  producedColors?: Color[];
  /** Mana produced by a single activation (e.g. Sol Ring = 2). Distinct from availableQuantity. */
  amount?: number;
  /**
   * Extra mana added when this source is tapped (Fertile Ground, Wild Growth, Utopia Sprawl).
   * Native `options`/`amount` stay the land's own ability; these chunks are independent.
   */
  manaBonuses?: Array<{ options: Color[]; amount: number; sameColor?: boolean }>;
  /**
   * Number of identical usable copies represented by this row (grouped tokens / collapsed twins).
   * Default 1. Suggest/capacity treats total mana as (mana per activation) * availableQuantity.
   */
  availableQuantity?: number;
  /**
   * When collapsing N distinct permanents into one row, the permanent ids for each quantity unit.
   * Grouped `group_*` sources omit this and repeat sourcePermanentId (server usedIds resolves members).
   */
  stackPermanentIds?: string[];
  /** When true, never collapse this row with otherwise-identical sources (e.g. Fertile Ground land). */
  keepSeparate?: boolean;
  consumable?: boolean;
  sacrificeCost?: ManaSourceSacrificeCost;
  /**
   * Spend restriction stamped by the mana ability (Vibranium/Powerstone, Helga, etc.).
   * Auto-pay and manual selection must not assign this source when purpose fails the check.
   */
  spendRestriction?: { restriction: string; restrictedTo?: string };
  /**
   * True when this ability's mana also makes the matching chosen-type creature
   * spell uncounterable (Cavern of Souls any-color). Never set on `{C}`.
   */
  grantsUncounterableOnSpend?: boolean;
  /**
   * Extra mana to activate this ability, excluding {T} (Signet `{1}`, Three Tree `{2}`).
   * Auto-pay must float this from other sources/pool in the same payment, and tap those first.
   */
  activationManaCost?: string;
}

function normalizeProducedColors(producedColors?: readonly string[]): Color[] {
  if (!Array.isArray(producedColors)) return [];

  return producedColors.filter((color): color is Color =>
    MANA_COLORS.includes(String(color || '').toUpperCase() as Color)
  );
}

/**
 * Parse a mana cost string into its individual components
 * Handles colored mana, generic mana, hybrid mana, and X costs
 */
export function parseManaCost(manaCost?: string): ParsedManaCost {
  const res: ParsedManaCost = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: 0,
    hybrids: [],
    hasX: false,
    xCount: 0, // Track number of X's (1 for X, 2 for XX, 3 for XXX)
  };
  if (!manaCost) return res;
  
  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const t of tokens) {
    const sym = t.replace(/[{}]/g, '').toUpperCase();
    if (sym === 'X') {
      res.hasX = true;
      res.xCount = (res.xCount || 0) + 1; // Count each X
      continue;
    }
    if (/^\d+$/.test(sym)) {
      res.generic += parseInt(sym, 10);
      continue;
    }
    if (sym.includes('/')) {
      const parts = sym.split('/');
      // Phyrexian mana (e.g., {W/P})
      if (parts.length === 2 && parts[1] === 'P') {
        const c = parts[0] as Color;
        if (MANA_COLORS.includes(c)) res.colors[c] += 1;
        continue;
      }
      // Hybrid mana (e.g., {W/U})
      if (parts.length === 2 && MANA_COLORS.includes(parts[0] as Color) && MANA_COLORS.includes(parts[1] as Color)) {
        res.hybrids.push([parts[0] as Color, parts[1] as Color]);
        continue;
      }
      // Two-brid fallback: treat numeric as generic
      const num = parseInt(parts[0], 10);
      if (!Number.isNaN(num)) {
        res.generic += num;
        continue;
      }
    }
    if (MANA_COLORS.includes(sym as Color)) {
      res.colors[sym as Color] += 1;
      continue;
    }
  }
  return res;
}

/**
 * Convert a payment array into a mana pool record
 * Uses the count field if provided for multi-mana sources like Sol Ring
 */
export function paymentToPool(payment: PaymentItem[]): Record<Color, number> {
  return payment.reduce<Record<Color, number>>((acc, p) => {
    const producedColors = normalizeProducedColors((p as any).producedColors);
    if (producedColors.length > 0) {
      for (const color of producedColors) {
        acc[color] = (acc[color] || 0) + 1;
      }
      return acc;
    }

    const amount = p.count ?? 1;
    acc[p.mana] = (acc[p.mana] || 0) + amount;
    return acc;
  }, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
}

/**
 * Check if a payment can satisfy a cost (including hybrid costs)
 */
export function canPayCost(
  cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] },
  pool: Record<Color, number>
): boolean {
  const left: Record<Color, number> = { W: pool.W, U: pool.U, B: pool.B, R: pool.R, G: pool.G, C: pool.C };
  
  // Check colored requirements
  for (const c of MANA_COLORS) {
    if (left[c] < cost.colors[c]) return false;
    left[c] -= cost.colors[c];
  }
  
  // Check hybrid requirements
  for (const group of cost.hybrids) {
    let satisfied = false;
    for (const c of group) {
      if (left[c] > 0) {
        left[c] -= 1;
        satisfied = true;
        break;
      }
    }
    if (!satisfied) return false;
  }
  
  // Check generic requirement
  const total = MANA_COLORS.reduce((a, c) => a + left[c], 0);
  return total >= cost.generic;
}

/**
 * Compute colors needed by other cards in hand (excluding the current spell)
 * This helps determine which colors to preserve when paying generic mana
 */
export function computeColorsNeededByOtherCards(otherCards: OtherCardInfo[]): Set<Color> {
  const neededColors = new Set<Color>();
  for (const card of otherCards) {
    if (!card.mana_cost) continue;
    const parsed = parseManaCost(card.mana_cost);
    for (const c of MANA_COLORS) {
      if (parsed.colors[c] > 0) neededColors.add(c);
    }
    for (const hybrid of parsed.hybrids) {
      for (const c of hybrid) {
        neededColors.add(c);
      }
    }
  }
  return neededColors;
}

/**
 * Client mirror of server parseManaSpendRestrictionFromOracle.
 * Covers Vibranium/Powerstone "can't be spent to cast a nonartifact spell" and common spend-only clauses.
 */
export function parseManaSpendRestrictionFromOracleText(
  oracleText: string,
): { restriction: string; restrictedTo?: string } | null {
  const text = String(oracleText || '').toLowerCase().replace(/[’‘]/g, "'");
  if (/this mana can'?t be spent to cast a nonartifact spell/.test(text)) {
    return { restriction: 'no_nonartifact_spells' };
  }
  if (!text.includes('spend this mana only')) return null;

  const helgaMatch = text.match(
    /spend this mana only to cast creature spells with mana value\s+(\d+)\s+or greater(?:\s+or creature spells with \{x\} in their mana costs)?/i,
  );
  if (helgaMatch) {
    return {
      restriction: 'creature_spells_mv_or_x',
      restrictedTo: String(helgaMatch[1] || '4'),
    };
  }
  if (/spend this mana only to activate abilities/.test(text)) {
    return { restriction: 'activated_abilities' };
  }
  if (/spend this mana only to cast creature spells|spend this mana only to cast creatures\b/.test(text)) {
    return { restriction: 'creatures' };
  }
  if (/spend this mana only to cast artifact spells|spend this mana only to cast artifacts\b/.test(text)) {
    return { restriction: 'artifacts' };
  }
  if (/spend this mana only to cast instant or sorcery|spend this mana only to cast instants and sorceries/.test(text)) {
    return { restriction: 'instant_sorcery' };
  }
  if (/spend this mana only to cast colorless/.test(text)) {
    return { restriction: 'colorless_spells' };
  }
  if (/spend this mana only to cast legendary/.test(text)) {
    return { restriction: 'legendary' };
  }
  if (/spend this mana only to cast multicolored/.test(text)) {
    return { restriction: 'multicolored' };
  }
  return null;
}

/** Whether a payment source's stamped spend restriction allows the current payment purpose. */
/** Prefer any restricted producer (already filtered as legal for purpose) before unrestricted ones. */
function sourcePrefersRestrictedManaFirst(source: Pick<ManaPaymentSource, 'spendRestriction'>): boolean {
  return Boolean(String(source?.spendRestriction?.restriction || '').trim());
}

export function manaSourceAllowsSpendPurpose(
  source: Pick<ManaPaymentSource, 'spendRestriction'>,
  purpose?: RestrictedManaSpendPurpose | null,
): boolean {
  const restriction = source?.spendRestriction;
  if (!restriction?.restriction) return true;
  return canUseRestrictedManaClient(
    {
      restriction: restriction.restriction,
      restrictedTo: restriction.restrictedTo,
      amount: 1,
      type: 'colorless',
    },
    purpose,
  );
}

/**
 * Mana pool structure (floating mana)
 */
export interface ManaPool {
  white?: number;
  blue?: number;
  black?: number;
  red?: number;
  green?: number;
  colorless?: number;
  restricted?: readonly RestrictedManaPoolEntry[];
}

/**
 * Map from mana pool color names to mana symbols
 */
const POOL_TO_SYMBOL: Record<string, Color> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

/**
 * Map from mana symbols to pool color names
 */
const SYMBOL_TO_POOL: Record<Color, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
};

/**
 * Calculate how much of the cost can be paid from floating mana
 * Returns the remaining cost after using floating mana
 */
export function calculateRemainingCostAfterFloatingMana(
  cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] },
  floatingMana?: ManaPool,
  purpose?: RestrictedManaSpendPurpose | null,
): { colors: Record<Color, number>; generic: number; hybrids: Color[][]; usedFromPool: Record<string, number> } {
  const costRemaining = { ...cost.colors };
  let genericRemaining = cost.generic;
  const hybridsRemaining = [...cost.hybrids];
  const usedFromPool: Record<string, number> = {};
  
  if (!floatingMana) {
    return { colors: costRemaining, generic: genericRemaining, hybrids: hybridsRemaining, usedFromPool };
  }
  
  // Create a copy of the floating mana to track what we use
  const poolRemaining: Record<string, number> = {
    white: floatingMana.white || 0,
    blue: floatingMana.blue || 0,
    black: floatingMana.black || 0,
    red: floatingMana.red || 0,
    green: floatingMana.green || 0,
    colorless: floatingMana.colorless || 0,
  };

  for (const entry of floatingMana.restricted || []) {
    // Never auto-consume restricted mana that is illegal for this purpose
    // (e.g. Vibranium/Powerstone C for a nonartifact creature spell).
    if (!canUseRestrictedManaClient(entry, purpose)) continue;
    const poolKey = String(entry.type || 'colorless');
    poolRemaining[poolKey] = (poolRemaining[poolKey] || 0) + Number(entry.amount || 0);
  }
  
  // First, use floating mana for colored requirements
  for (const c of MANA_COLORS) {
    if (c === 'C') continue;
    const poolKey = SYMBOL_TO_POOL[c];
    while (costRemaining[c] > 0 && poolRemaining[poolKey] > 0) {
      costRemaining[c]--;
      poolRemaining[poolKey]--;
      usedFromPool[poolKey] = (usedFromPool[poolKey] || 0) + 1;
    }
  }
  
  // Use colorless floating mana for colorless requirements
  while (costRemaining['C'] > 0 && poolRemaining.colorless > 0) {
    costRemaining['C']--;
    poolRemaining.colorless--;
    usedFromPool.colorless = (usedFromPool.colorless || 0) + 1;
  }
  
  // Handle hybrid costs with floating mana
  const satisfiedHybrids: number[] = [];
  for (let i = 0; i < hybridsRemaining.length; i++) {
    const hybrid = hybridsRemaining[i];
    for (const c of hybrid) {
      const poolKey = SYMBOL_TO_POOL[c];
      if (poolRemaining[poolKey] > 0) {
        poolRemaining[poolKey]--;
        usedFromPool[poolKey] = (usedFromPool[poolKey] || 0) + 1;
        satisfiedHybrids.push(i);
        break;
      }
    }
  }
  // Remove satisfied hybrids (in reverse order to maintain indices)
  for (let i = satisfiedHybrids.length - 1; i >= 0; i--) {
    hybridsRemaining.splice(satisfiedHybrids[i], 1);
  }
  
  // Use remaining floating mana for generic cost (prefer colorless first)
  if (genericRemaining > 0 && poolRemaining.colorless > 0) {
    const use = Math.min(poolRemaining.colorless, genericRemaining);
    poolRemaining.colorless -= use;
    genericRemaining -= use;
    usedFromPool.colorless = (usedFromPool.colorless || 0) + use;
  }
  
  // Use other colors for generic
  for (const c of MANA_COLORS) {
    if (genericRemaining <= 0) break;
    const poolKey = SYMBOL_TO_POOL[c];
    if (poolRemaining[poolKey] > 0) {
      const use = Math.min(poolRemaining[poolKey], genericRemaining);
      poolRemaining[poolKey] -= use;
      genericRemaining -= use;
      usedFromPool[poolKey] = (usedFromPool[poolKey] || 0) + use;
    }
  }
  
  return { colors: costRemaining, generic: genericRemaining, hybrids: hybridsRemaining, usedFromPool };
}

/**
 * Calculate the total mana a source produces when tapped.
 * Counts duplicates in the options array to handle multi-mana sources like Sol Ring.
 * 
 * Examples:
 * - Forest: options = ['G'] -> returns { G: 1 }
 * - Sol Ring: options = ['C', 'C'] -> returns { C: 2 }
 * - Command Tower: options = ['W', 'U', 'B', 'R', 'G'] -> returns { W: 1, U: 1, B: 1, R: 1, G: 1 } (choice)
 */
export function getManaProductionPerColor(options: Color[]): Record<Color, number> {
  const production: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const c of options) {
    production[c] = (production[c] || 0) + 1;
  }
  return production;
}

/**
 * Check if a source is a "choice" source (multiple color options, produces 1 mana)
 * vs a "multi-mana" source (duplicates in options, produces multiple mana)
 * 
 * Examples:
 * - Forest: ['G'] -> false (single option, single mana)
 * - Sol Ring: ['C', 'C'] -> false (duplicates = 2 colorless mana)
 * - Command Tower: ['W', 'U', 'B', 'R', 'G'] -> true (5 unique = choice of 1 mana)
 * - Gilded Lotus: ['U', 'U', 'U'] -> false (duplicates = 3 blue mana)
 * 
 * The key insight: if all options are unique AND there are more than 1, it's a choice.
 * Multi-mana sources have duplicate entries (same color appears multiple times).
 */
export function isChoiceSource(options: Color[]): boolean {
  if (options.length <= 1) return false;
  const unique = new Set(options);
  // If all colors are unique and there are multiple, it's a choice (produces 1 mana)
  // If there are duplicates, it's a multi-mana source
  return unique.size === options.length;
}

/**
 * Get total mana produced by a source.
 * 
 * IMPORTANT: Distinguishes between:
 * 1. Multi-mana sources (duplicates in options = multiple mana): Sol Ring ['C','C'] = 2 mana
 * 2. Choice sources (unique options = one mana with color choice): Command Tower ['W','U','B','R','G'] = 1 mana
 * 
 * Examples:
 * - Forest: ['G'] -> 1 mana
 * - Sol Ring: ['C', 'C'] -> 2 mana (duplicate = multi-mana)
 * - Command Tower: ['W', 'U', 'B', 'R', 'G'] -> 1 mana (all unique = choice)
 * - Gilded Lotus: ['U', 'U', 'U'] -> 3 mana (duplicate = multi-mana)
 * - Temple of Abandon: ['R', 'G'] -> 1 mana (choice between colors)
 */
export function getTotalManaProduction(options: Color[]): number {
  if (options.length === 0) return 0;
  if (options.length === 1) return 1;
  
  // Check if this is a "choice" source (all unique colors) or "multi-mana" source (has duplicates)
  // Optimized: check for duplicates without creating a Set for every call
  const seen = new Set<Color>();
  for (const c of options) {
    if (seen.has(c)) {
      // Found a duplicate - this is a multi-mana source
      return options.length;
    }
    seen.add(c);
  }
  
  // All unique - this is a choice source that produces 1 mana
  return 1;
}

function getSourceBonusChunks(source: Pick<ManaPaymentSource, 'manaBonuses'>): Array<{ options: Color[]; amount: number; sameColor?: boolean }> {
  return Array.isArray(source.manaBonuses)
    ? source.manaBonuses.filter((chunk) => Array.isArray(chunk?.options) && Number(chunk.amount || 0) > 0)
    : [];
}

export function getSourceBonusManaAmount(source: Pick<ManaPaymentSource, 'manaBonuses'>): number {
  return getSourceBonusChunks(source).reduce((sum, chunk) => sum + Math.max(0, Number(chunk.amount || 0)), 0);
}

export function getSourceNativeManaAmount(source: ManaPaymentSource): number {
  if (typeof source.amount === 'number' && source.amount > 0) return source.amount;
  return getTotalManaProduction(source.options);
}

/** Mana produced by one activation of this source (ignores availableQuantity). */
export function getManaPerActivation(source: ManaPaymentSource): number {
  return getSourceNativeManaAmount(source) + getSourceBonusManaAmount(source);
}

export function getManaSourceDisplayOptions(source: Pick<ManaPaymentSource, 'options' | 'manaBonuses'>): Color[] {
  const seen = new Set<Color>();
  const display: Color[] = [];
  for (const color of [...(source.options || []), ...getSourceBonusChunks(source).flatMap((chunk) => chunk.options)]) {
    if (!MANA_COLORS.includes(color) || seen.has(color)) continue;
    seen.add(color);
    display.push(color);
  }
  return display;
}

function sourceCanProduceColor(source: Pick<ManaPaymentSource, 'options' | 'manaBonuses'>, color: Color): boolean {
  if ((source.options || []).includes(color)) return true;
  return getSourceBonusChunks(source).some((chunk) => chunk.options.includes(color));
}

export function buildProducedColorsForSelectedMana(source: ManaPaymentSource, selected: Color): Color[] | undefined {
  const chunks = getSourceBonusChunks(source);
  if (chunks.length === 0) {
    return Array.isArray(source.producedColors) && source.producedColors.length > 0
      ? [...source.producedColors]
      : undefined;
  }

  const produced: Color[] = [];
  if (Array.isArray(source.producedColors) && source.producedColors.length > 0) {
    produced.push(...source.producedColors);
  } else {
    const nativeAmount = getSourceNativeManaAmount(source);
    const nativeColor = source.options.includes(selected) ? selected : (source.options[0] || selected);
    for (let index = 0; index < nativeAmount; index += 1) produced.push(nativeColor);
  }

  for (const chunk of chunks) {
    const bonusColor = chunk.options.includes(selected) ? selected : (chunk.options[0] || selected);
    for (let index = 0; index < Math.max(0, Number(chunk.amount || 0)); index += 1) {
      produced.push(bonusColor);
    }
  }
  return produced.length > 0 ? produced : undefined;
}

export function getSourceAvailableQuantity(source: ManaPaymentSource): number {
  const qty = Number(source.availableQuantity);
  return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
}

function getSourceManaCapacity(source: ManaPaymentSource): number {
  return getManaPerActivation(source) * getSourceAvailableQuantity(source);
}

/**
 * Fold a chosen X value into a parsed mana cost for payment UI / autopay.
 * Only multiplies by the number of {X} symbols still present in the cost.
 * Payment steps often pass an already-expanded cost like {10}{W}{W} together with
 * xValue=10; treating missing xCount as 1 would double-count X into generic.
 */
export function applyXValueToParsedCost(
  parsed: Pick<ParsedManaCost, 'colors' | 'generic' | 'hybrids' | 'xCount'>,
  xValue?: number,
): { colors: Record<Color, number>; generic: number; hybrids: Color[][] } {
  const xMultiplier = Math.max(0, Number(parsed.xCount || 0));
  return {
    colors: parsed.colors,
    generic: Number(parsed.generic || 0) + Math.max(0, Number(xValue || 0) * xMultiplier),
    hybrids: parsed.hybrids,
  };
}

export interface SuggestedPaymentSelection {
  color: Color;
  count: number;
  /** Exact symbols produced by one or more activations, including mixed native+aura mana. */
  producedColors?: Color[];
}

/**
 * Calculate suggested payment: sources and colors to use
 * Returns a map of permanentId -> { color, count }, plus info about floating mana used
 * 
 * This function first uses any available floating mana, then taps sources for the remainder.
 * 
 * Priority for generic mana payment:
 * 1. Floating mana (already in pool)
 * 2. Colorless-producing sources (e.g., Wastes, Sol Ring for {C})
 * 3. Single-color lands (e.g., basic lands)
 * 4. Multi-color lands (e.g., dual lands, Command Tower)
 * 
 * Also preserves colors needed by other cards in hand when possible.
 */
export function calculateSuggestedPayment(
  cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] },
  sources: ManaPaymentSource[],
  colorsToPreserve: Set<Color>,
  floatingMana?: ManaPool,
  purpose?: RestrictedManaSpendPurpose | null,
): Map<string, SuggestedPaymentSelection> {
  const suggestions = new Map<string, SuggestedPaymentSelection>();
  
  // First, calculate what's left after using floating mana
  const { colors: costRemaining, generic: genericRemaining, hybrids: hybridsRemaining } = 
    calculateRemainingCostAfterFloatingMana(cost, floatingMana, purpose);

  // Exclude mana abilities whose spend restriction does not allow this purpose
  // (e.g. Vibranium/Powerstone C cannot pay for Generous Gift).
  const usableSources = sources.filter((source) => manaSourceAllowsSpendPurpose(source, purpose));
  
  let genericLeft = genericRemaining;
  
  // Track which sources we've used
  const usedSources = new Set<string>();
  const usedPermanentIds = new Set<string>();
  const activationCharged = new Map<string, number>();
  const remainingSourceCapacity = new Map<string, number>();
  const remainingNative = new Map<string, number>();
  const remainingBonus = new Map<string, Array<{ remaining: number; options: Color[]; sameColor?: boolean; locked?: Color }>>();
  for (const source of usableSources) {
    const quantity = getSourceAvailableQuantity(source);
    remainingSourceCapacity.set(source.id, getSourceManaCapacity(source));
    remainingNative.set(source.id, getSourceNativeManaAmount(source) * quantity);
    remainingBonus.set(
      source.id,
      getSourceBonusChunks(source).map((chunk) => ({
        remaining: Math.max(0, Number(chunk.amount || 0)) * quantity,
        options: chunk.options,
        sameColor: chunk.sameColor,
      })),
    );
  }
  
  // Helper: get unique colors (for choice sources like Command Tower)
  const getUniqueColors = (options: Color[]) => [...new Set(options)];
  
  // Helper: check if source produces only colorless
  const isColorlessOnly = (source: Pick<ManaPaymentSource, 'options'>) => {
    const unique = getUniqueColors(source.options);
    return unique.length === 1 && unique[0] === 'C';
  };

  const isConsumableSource = (source: Pick<ManaPaymentSource, 'consumable'>) => source.consumable === true;
  
  // Helper: check if source produces colorless among other options
  const hasColorlessOption = (source: Pick<ManaPaymentSource, 'options'>) => 
    source.options.includes('C');
  
  // Helper: count unique non-colorless options (for sorting multi-color lands last)
  const colorOptionCount = (source: Pick<ManaPaymentSource, 'options'>) => 
    getUniqueColors(source.options).filter(c => c !== 'C').length;
  
  // Helper: get total mana this source produces
  // Uses getTotalManaProduction which correctly handles choice sources vs multi-mana sources
  const getManaAmount = (source: ManaPaymentSource) => getSourceManaCapacity(source);

  const getPaymentSourcePermanentId = (source: ManaPaymentSource): string =>
    String(source.sourcePermanentId || source.id || '').trim();

  const appendProducedMana = (sourceId: string, color: Color, amount: number): void => {
    if (amount <= 0) return;
    const existing = suggestions.get(sourceId);
    const source = usableSources.find((candidate) => candidate.id === sourceId);
    if (!existing) {
      const produced = Array.from({ length: amount }, () => color);
      const includeProduced = getSourceBonusChunks(source || {}).length > 0 || new Set(produced).size > 1;
      suggestions.set(sourceId, {
        color,
        count: amount,
        ...(includeProduced ? { producedColors: produced } : {}),
      });
      usedSources.add(sourceId);
      return;
    }
    const produced = (existing.producedColors && existing.producedColors.length > 0)
      ? existing.producedColors.slice()
      : Array.from({ length: existing.count }, () => existing.color);
    for (let index = 0; index < amount; index += 1) produced.push(color);
    const includeProduced = getSourceBonusChunks(source || {}).length > 0 || new Set(produced).size > 1;
    suggestions.set(sourceId, {
      color: produced[0] || color,
      count: produced.length,
      ...(includeProduced ? { producedColors: produced } : {}),
    });
  };

  const takeManaOfColor = (source: ManaPaymentSource, color: Color, requestedAmount: number): number => {
    let remaining = requestedAmount;
    let taken = 0;
    const nativeLeft = remainingNative.get(source.id) || 0;
    if (remaining > 0 && nativeLeft > 0 && source.options.includes(color)) {
      const nativeTake = Math.min(nativeLeft, remaining);
      remainingNative.set(source.id, nativeLeft - nativeTake);
      remaining -= nativeTake;
      taken += nativeTake;
    }
    const buckets = remainingBonus.get(source.id) || [];
    for (const bucket of buckets) {
      if (remaining <= 0) break;
      if (bucket.remaining <= 0) continue;
      if (!bucket.options.includes(color)) continue;
      if (bucket.locked && bucket.locked !== color) continue;
      const bonusTake = Math.min(bucket.remaining, remaining);
      bucket.remaining -= bonusTake;
      if (bucket.sameColor) bucket.locked = color;
      remaining -= bonusTake;
      taken += bonusTake;
    }
    return taken;
  };

  const chargeActivationForSource = (source: ManaPaymentSource): void => {
    const nativePerActivation = Math.max(1, getSourceNativeManaAmount(source));
    const totalNative = nativePerActivation * getSourceAvailableQuantity(source);
    const usedNative = Math.max(0, totalNative - (remainingNative.get(source.id) || 0));
    const unitsUsed = Math.ceil(usedNative / nativePerActivation);
    genericLeft += chargeSourceActivationCost(source, unitsUsed, activationCharged);
  };

  const assignFromSource = (
    source: ManaPaymentSource,
    color: Color,
    requestedAmount: number,
  ): number => {
    const available = remainingSourceCapacity.get(source.id) || 0;
    if (available <= 0 || requestedAmount <= 0) return 0;

    const sourcePermanentId = getPaymentSourcePermanentId(source);
    if (
      sourcePermanentId
      && usedPermanentIds.has(sourcePermanentId)
      && !suggestions.has(source.id)
    ) {
      return 0;
    }

    const mixedState = {
      genericLeft,
      costRemaining,
      remainingSourceCapacity,
      remainingNative,
      usedPermanentIds,
    };
    const mixedAssigned = tryAssignFixedMixedManaBundle(
      source,
      color,
      requestedAmount,
      mixedState,
      appendProducedMana,
    );
    if (mixedAssigned !== null) {
      genericLeft = mixedState.genericLeft;
      if (mixedAssigned > 0) chargeActivationForSource(source);
      return mixedAssigned;
    }

    const assigned = takeManaOfColor(source, color, Math.min(available, requestedAmount));
    if (assigned <= 0) return 0;

    appendProducedMana(source.id, color, assigned);

    if (sourcePermanentId) {
      usedPermanentIds.add(sourcePermanentId);
    }

    remainingSourceCapacity.set(source.id, available - assigned);
    chargeActivationForSource(source);
    return assigned;
  };

  const pickFillColor = (options: Color[]): Color => {
    if (options.includes('C')) return 'C';
    for (const color of options) {
      if (!colorsToPreserve.has(color)) return color;
    }
    return options[0] || 'C';
  };

  const settleUsedSourceLeftovers = (): void => {
    for (const source of usableSources) {
      if (!suggestions.has(source.id)) continue;

      let nativeLeft = remainingNative.get(source.id) || 0;
      while (nativeLeft > 0) {
        const fillColor = pickFillColor(source.options);
        const assigned = assignFromSource(source, fillColor, nativeLeft);
        if (assigned <= 0) break;
        if (genericLeft > 0) genericLeft = Math.max(0, genericLeft - assigned);
        nativeLeft = remainingNative.get(source.id) || 0;
      }

      const buckets = remainingBonus.get(source.id) || [];
      for (const bucket of buckets) {
        while (bucket.remaining > 0) {
          const fillColor = bucket.locked || pickFillColor(bucket.options);
          const assigned = assignFromSource(source, fillColor, bucket.remaining);
          if (assigned <= 0) break;
          if (genericLeft > 0) genericLeft = Math.max(0, genericLeft - assigned);
        }
      }
    }
  };
  
  // First pass: assign sources for specific color requirements (after floating mana)
  // For colored mana, prefer native producers, then aura-bonus producers
  for (const c of MANA_COLORS) {
    if (c === 'C') continue; // Handle colorless separately
    if (costRemaining[c] <= 0) continue;
    
    // Sort sources: prefer sources with fewer unique options (more specific)
    const colorSources = usableSources
      .filter((s) => (remainingSourceCapacity.get(s.id) || 0) > 0 && sourceCanProduceColor(s, c))
      .sort((a, b) => {
        if (isConsumableSource(a) !== isConsumableSource(b)) {
          return isConsumableSource(a) ? 1 : -1;
        }
        const activationCmp = getSourceActivationManaPips(a) - getSourceActivationManaPips(b);
        if (activationCmp !== 0) return activationCmp;
        const uncounterableCmp =
          Number(sourcePrefersUncounterableChosenTypeCast(b, purpose))
          - Number(sourcePrefersUncounterableChosenTypeCast(a, purpose));
        if (uncounterableCmp !== 0) return uncounterableCmp;
        // Prefer eligible restricted producers first (keep flexible mana).
        const aRestricted = sourcePrefersRestrictedManaFirst(a);
        const bRestricted = sourcePrefersRestrictedManaFirst(b);
        if (aRestricted !== bRestricted) return aRestricted ? -1 : 1;
        const aNative = a.options.includes(c);
        const bNative = b.options.includes(c);
        if (aNative !== bNative) return aNative ? -1 : 1;
        return getUniqueColors(a.options).length - getUniqueColors(b.options).length;
      });
    
    for (const source of colorSources) {
      if (costRemaining[c] <= 0) break;

      const assigned = assignFromSource(source, c, costRemaining[c]);
      costRemaining[c] = Math.max(0, costRemaining[c] - assigned);
    }
  }
  
  // Handle colorless mana requirement (specific {C} cost, not generic)
  if (costRemaining['C'] > 0) {
    const colorlessSources = usableSources
      .filter((s) => (remainingSourceCapacity.get(s.id) || 0) > 0 && sourceCanProduceColor(s, 'C'))
      .sort((a, b) => {
        // Prefer colorless-only sources
        if (isColorlessOnly(a) && !isColorlessOnly(b)) return -1;
        if (!isColorlessOnly(a) && isColorlessOnly(b)) return 1;
        if (isConsumableSource(a) !== isConsumableSource(b)) {
          return isConsumableSource(a) ? 1 : -1;
        }
        const activationCmp = getSourceActivationManaPips(a) - getSourceActivationManaPips(b);
        if (activationCmp !== 0) return activationCmp;
        // Prefer eligible restricted producers first (keep flexible mana).
        const aRestricted = sourcePrefersRestrictedManaFirst(a);
        const bRestricted = sourcePrefersRestrictedManaFirst(b);
        if (aRestricted !== bRestricted) return aRestricted ? -1 : 1;
        const aNative = a.options.includes('C');
        const bNative = b.options.includes('C');
        if (aNative !== bNative) return aNative ? -1 : 1;
        return a.options.length - b.options.length;
      });
    
    for (const source of colorlessSources) {
      if (costRemaining['C'] <= 0) break;

      const assigned = assignFromSource(source, 'C', costRemaining['C']);
      costRemaining['C'] = Math.max(0, costRemaining['C'] - assigned);
    }
  }
  
  // Second pass: handle remaining hybrid costs (after floating mana was used)
  for (const hybrid of hybridsRemaining) {
    let bestColor: Color | null = null;
    let bestSource: ManaPaymentSource | null = null;
    let bestScore = Infinity;
    
    for (const source of usableSources) {
      const remainingCapacity = remainingSourceCapacity.get(source.id) || 0;
      if (remainingCapacity <= 0) continue;
      
      for (const c of hybrid) {
        if (!sourceCanProduceColor(source, c)) continue;
        
        // Score: prefer colors NOT needed by other cards, and fewer options
        const preservePenalty = colorsToPreserve.has(c) ? 100 : 0;
        const consumablePenalty = source.consumable === true ? 50 : 0;
        const nativePenalty = source.options.includes(c) ? 0 : 8;
        const optionPenalty = source.options.length;
        const activationPenalty = getSourceActivationManaPips(source) * 20;
        const uncounterableBonus = sourcePrefersUncounterableChosenTypeCast(source, purpose) ? -40 : 0;
        const score = preservePenalty + consumablePenalty + nativePenalty + optionPenalty + activationPenalty + uncounterableBonus;
        
        if (score < bestScore) {
          bestScore = score;
          bestColor = c;
          bestSource = source;
        }
      }
    }
    
    if (bestSource && bestColor) {
      assignFromSource(bestSource, bestColor, 1);
    }
  }

  settleUsedSourceLeftovers();

  if (genericLeft > 0) {
    const existingSuggestedSources = usableSources.filter((source) => {
      const existing = suggestions.get(source.id);
      return Boolean(existing) && (remainingSourceCapacity.get(source.id) || 0) > 0;
    });

    for (const source of existingSuggestedSources) {
      if (genericLeft <= 0) break;
      const existing = suggestions.get(source.id);
      if (!existing) continue;
      const assigned = assignFromSource(source, existing.color, genericLeft);
      genericLeft = Math.max(0, genericLeft - assigned);
    }
  }
  
  // Third pass: assign sources for generic cost
  // Priority: 1) colorless-only, 2) single-color, 3) multi-color
  // Also prefer sources that don't produce colors needed by other cards
  // IMPORTANT: Account for multi-mana sources (Sol Ring produces 2 colorless)
  if (genericLeft > 0) {
    const remainingSources = usableSources.filter(s => !usedSources.has(s.id));
    
    remainingSources.sort((a, b) => {
      // Prefer reusable sources before consumable ones.
      if (isConsumableSource(a) !== isConsumableSource(b)) {
        return isConsumableSource(a) ? 1 : -1;
      }

      const activationCmp = getSourceActivationManaPips(a) - getSourceActivationManaPips(b);
      if (activationCmp !== 0) return activationCmp;

      const uncounterableCmp =
        Number(sourcePrefersUncounterableChosenTypeCast(b, purpose))
        - Number(sourcePrefersUncounterableChosenTypeCast(a, purpose));
      if (uncounterableCmp !== 0) return uncounterableCmp;

      // Prefer eligible restricted producers first (keep flexible mana).
      const aRestricted = sourcePrefersRestrictedManaFirst(a);
      const bRestricted = sourcePrefersRestrictedManaFirst(b);
      if (aRestricted !== bRestricted) return aRestricted ? -1 : 1;

      // 1. Colorless-only sources first (best for generic)
      const aColorlessOnly = isColorlessOnly(a);
      const bColorlessOnly = isColorlessOnly(b);
      if (aColorlessOnly && !bColorlessOnly) return -1;
      if (!aColorlessOnly && bColorlessOnly) return 1;
      
      // 2. Multi-mana sources first (more efficient - Sol Ring > basic land)
      const aManaAmount = getManaAmount(a);
      const bManaAmount = getManaAmount(b);
      if (aManaAmount !== bManaAmount) {
        return bManaAmount - aManaAmount; // Higher amount first
      }
      
      // 3. Sources with colorless option (can pay generic without "wasting" colored mana)
      const aHasColorless = hasColorlessOption(a);
      const bHasColorless = hasColorlessOption(b);
      if (aHasColorless && !bHasColorless) return -1;
      if (!aHasColorless && bHasColorless) return 1;
      
      // 4. Single-color sources before multi-color
      const aColorCount = colorOptionCount(a);
      const bColorCount = colorOptionCount(b);
      if (aColorCount !== bColorCount) {
        return aColorCount - bColorCount;
      }
      
      // 5. Prefer sources that don't produce colors needed by other cards
      const aHasPreservedColor = a.options.some(c => c !== 'C' && colorsToPreserve.has(c));
      const bHasPreservedColor = b.options.some(c => c !== 'C' && colorsToPreserve.has(c));
      if (!aHasPreservedColor && bHasPreservedColor) return -1;
      if (aHasPreservedColor && !bHasPreservedColor) return 1;
      
      return 0;
    });
    
    for (const source of remainingSources) {
      if (genericLeft <= 0) break;
      
      // Calculate how much mana this source produces
      const manaAmount = getManaAmount(source);
      
      // Pick the best color from this source:
      // 1. Colorless if available (for multi-mana colorless like Sol Ring)
      // 2. Color not needed by other cards
      // 3. Any available color
      let bestColor: Color;
      if (source.options.includes('C')) {
        bestColor = 'C';
      } else {
        bestColor = source.options[0];
        for (const c of getUniqueColors(source.options)) {
          if (!colorsToPreserve.has(c)) {
            bestColor = c;
            break;
          }
        }
      }
      
      const assigned = assignFromSource(source, bestColor, genericLeft);
      genericLeft = Math.max(0, genericLeft - assigned);
    }
  }
  
  return suggestions;
}
