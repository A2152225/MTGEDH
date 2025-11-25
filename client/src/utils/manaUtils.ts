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
 */
export function paymentToPool(payment: PaymentItem[]): Record<Color, number> {
  return payment.reduce<Record<Color, number>>((acc, p) => {
    acc[p.mana] = (acc[p.mana] || 0) + 1;
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
 * Calculate suggested payment: sources and colors to use
 * Returns a map of permanentId -> suggested color
 * 
 * Priority for generic mana payment:
 * 1. Colorless-producing sources (e.g., Wastes, Sol Ring for {C})
 * 2. Single-color lands (e.g., basic lands)
 * 3. Multi-color lands (e.g., dual lands, Command Tower)
 * 
 * Also preserves colors needed by other cards in hand when possible.
 */
export function calculateSuggestedPayment(
  cost: { colors: Record<Color, number>; generic: number; hybrids: Color[][] },
  sources: Array<{ id: string; name: string; options: Color[] }>,
  colorsToPreserve: Set<Color>
): Map<string, Color> {
  const suggestions = new Map<string, Color>();
  const costRemaining = { ...cost.colors };
  let genericRemaining = cost.generic;
  
  // Track which sources we've used
  const usedSources = new Set<string>();
  
  // Helper: check if source produces only colorless
  const isColorlessOnly = (source: { options: Color[] }) => 
    source.options.length === 1 && source.options[0] === 'C';
  
  // Helper: check if source produces colorless among other options
  const hasColorlessOption = (source: { options: Color[] }) => 
    source.options.includes('C');
  
  // Helper: count non-colorless options (for sorting multi-color lands last)
  const colorOptionCount = (source: { options: Color[] }) => 
    source.options.filter(c => c !== 'C').length;
  
  // First pass: assign sources for specific color requirements
  // For colored mana, prefer single-color sources first, then multi-color
  for (const c of MANA_COLORS) {
    if (c === 'C') continue; // Handle colorless separately
    if (costRemaining[c] <= 0) continue;
    
    // Sort sources: prefer sources with fewer options (more specific)
    const colorSources = sources
      .filter(s => !usedSources.has(s.id) && s.options.includes(c))
      .sort((a, b) => a.options.length - b.options.length);
    
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
  
  // Second pass: handle hybrid costs (pick the color that's less needed by other cards)
  for (const hybrid of cost.hybrids) {
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
  if (genericRemaining > 0) {
    const remainingSources = sources.filter(s => !usedSources.has(s.id));
    
    remainingSources.sort((a, b) => {
      // 1. Colorless-only sources first (best for generic)
      const aColorlessOnly = isColorlessOnly(a);
      const bColorlessOnly = isColorlessOnly(b);
      if (aColorlessOnly && !bColorlessOnly) return -1;
      if (!aColorlessOnly && bColorlessOnly) return 1;
      
      // 2. Sources with colorless option (can pay generic without "wasting" colored mana)
      const aHasColorless = hasColorlessOption(a);
      const bHasColorless = hasColorlessOption(b);
      if (aHasColorless && !bHasColorless) return -1;
      if (!aHasColorless && bHasColorless) return 1;
      
      // 3. Single-color sources before multi-color
      const aColorCount = colorOptionCount(a);
      const bColorCount = colorOptionCount(b);
      if (aColorCount !== bColorCount) {
        return aColorCount - bColorCount;
      }
      
      // 4. Prefer sources that don't produce colors needed by other cards
      const aHasPreservedColor = a.options.some(c => c !== 'C' && colorsToPreserve.has(c));
      const bHasPreservedColor = b.options.some(c => c !== 'C' && colorsToPreserve.has(c));
      if (!aHasPreservedColor && bHasPreservedColor) return -1;
      if (aHasPreservedColor && !bHasPreservedColor) return 1;
      
      return 0;
    });
    
    for (const source of remainingSources) {
      if (genericRemaining <= 0) break;
      
      // Pick the best color from this source:
      // 1. Colorless if available
      // 2. Color not needed by other cards
      // 3. Any available color
      let bestColor: Color;
      if (source.options.includes('C')) {
        bestColor = 'C';
      } else {
        bestColor = source.options[0];
        for (const c of source.options) {
          if (!colorsToPreserve.has(c)) {
            bestColor = c;
            break;
          }
        }
      }
      
      suggestions.set(source.id, bestColor);
      usedSources.add(source.id);
      genericRemaining--;
    }
  }
  
  return suggestions;
}
