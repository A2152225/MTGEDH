/**
 * Shared mana utilities for the client
 * Provides mana parsing, payment calculation, and related functions
 */
import type { PaymentItem, ManaColor } from '../../../shared/src';

export type Color = ManaColor;

// Standard mana color symbols in WUBRG order plus colorless
export const MANA_COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

export interface ParsedManaCost {
  colors: Record<Color, number>;
  generic: number;
  hybrids: Color[][];
  hasX: boolean;
}

export interface OtherCardInfo {
  id: string;
  name: string;
  mana_cost?: string;
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
  };
  if (!manaCost) return res;
  
  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const t of tokens) {
    const sym = t.replace(/[{}]/g, '').toUpperCase();
    if (sym === 'X') {
      res.hasX = true;
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
 * Mana pool structure (floating mana)
 */
export interface ManaPool {
  white?: number;
  blue?: number;
  black?: number;
  red?: number;
  green?: number;
  colorless?: number;
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
  floatingMana?: ManaPool
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
 * Get total mana produced by a source (sum of all colors in options)
 */
export function getTotalManaProduction(options: Color[]): number {
  return options.length;
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
  sources: Array<{ id: string; name: string; options: Color[] }>,
  colorsToPreserve: Set<Color>,
  floatingMana?: ManaPool
): Map<string, Color> {
  const suggestions = new Map<string, Color>();
  
  // First, calculate what's left after using floating mana
  const { colors: costRemaining, generic: genericRemaining, hybrids: hybridsRemaining } = 
    calculateRemainingCostAfterFloatingMana(cost, floatingMana);
  
  let genericLeft = genericRemaining;
  
  // Track which sources we've used
  const usedSources = new Set<string>();
  
  // Helper: get unique colors (for choice sources like Command Tower)
  const getUniqueColors = (options: Color[]) => [...new Set(options)];
  
  // Helper: check if source produces only colorless
  const isColorlessOnly = (source: { options: Color[] }) => {
    const unique = getUniqueColors(source.options);
    return unique.length === 1 && unique[0] === 'C';
  };
  
  // Helper: check if source produces colorless among other options
  const hasColorlessOption = (source: { options: Color[] }) => 
    source.options.includes('C');
  
  // Helper: count unique non-colorless options (for sorting multi-color lands last)
  const colorOptionCount = (source: { options: Color[] }) => 
    getUniqueColors(source.options).filter(c => c !== 'C').length;
  
  // Helper: get total mana this source produces (counts duplicates)
  const getManaAmount = (source: { options: Color[] }) => source.options.length;
  
  // First pass: assign sources for specific color requirements (after floating mana)
  // For colored mana, prefer single-color sources first, then multi-color
  for (const c of MANA_COLORS) {
    if (c === 'C') continue; // Handle colorless separately
    if (costRemaining[c] <= 0) continue;
    
    // Sort sources: prefer sources with fewer unique options (more specific)
    const colorSources = sources
      .filter(s => !usedSources.has(s.id) && s.options.includes(c))
      .sort((a, b) => getUniqueColors(a.options).length - getUniqueColors(b.options).length);
    
    for (const source of colorSources) {
      if (costRemaining[c] <= 0) break;
      
      suggestions.set(source.id, c);
      usedSources.add(source.id);
      costRemaining[c]--;
    }
  }
  
  // Handle colorless mana requirement (specific {C} cost, not generic)
  if (costRemaining['C'] > 0) {
    const colorlessSources = sources
      .filter(s => !usedSources.has(s.id) && s.options.includes('C'))
      .sort((a, b) => {
        // Prefer colorless-only sources
        if (isColorlessOnly(a) && !isColorlessOnly(b)) return -1;
        if (!isColorlessOnly(a) && isColorlessOnly(b)) return 1;
        return a.options.length - b.options.length;
      });
    
    for (const source of colorlessSources) {
      if (costRemaining['C'] <= 0) break;
      
      suggestions.set(source.id, 'C');
      usedSources.add(source.id);
      costRemaining['C']--;
    }
  }
  
  // Second pass: handle remaining hybrid costs (after floating mana was used)
  for (const hybrid of hybridsRemaining) {
    let bestColor: Color | null = null;
    let bestSource: { id: string; name: string; options: Color[] } | null = null;
    let bestScore = Infinity;
    
    for (const source of sources) {
      if (usedSources.has(source.id)) continue;
      
      for (const c of hybrid) {
        if (!source.options.includes(c)) continue;
        
        // Score: prefer colors NOT needed by other cards, and fewer options
        const preservePenalty = colorsToPreserve.has(c) ? 100 : 0;
        const optionPenalty = source.options.length;
        const score = preservePenalty + optionPenalty;
        
        if (score < bestScore) {
          bestScore = score;
          bestColor = c;
          bestSource = source;
        }
      }
    }
    
    if (bestSource && bestColor) {
      suggestions.set(bestSource.id, bestColor);
      usedSources.add(bestSource.id);
    }
  }
  
  // Third pass: assign sources for generic cost
  // Priority: 1) colorless-only, 2) single-color, 3) multi-color
  // Also prefer sources that don't produce colors needed by other cards
  // IMPORTANT: Account for multi-mana sources (Sol Ring produces 2 colorless)
  if (genericLeft > 0) {
    const remainingSources = sources.filter(s => !usedSources.has(s.id));
    
    remainingSources.sort((a, b) => {
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
      
      suggestions.set(source.id, bestColor);
      usedSources.add(source.id);
      // Decrement by the actual mana produced (e.g., 2 for Sol Ring)
      genericLeft -= manaAmount;
    }
  }
  
  return suggestions;
}
