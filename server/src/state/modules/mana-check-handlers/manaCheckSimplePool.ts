// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: empty/state mana pool getters, SimpleManaKey, exact-source types,
// and simple-pool arithmetic (create/add/symbol/scaling).
// Public entry symbols: getEmptyManaPool, getManaPoolFromState, SIMPLE_MANA_KEYS,
// SimpleManaKey, ExactManaSourceOption, ExactManaSource, ExactSacrificeCandidate,
// ExactHandCandidate, ExactCandidateRemovalResult, createSimpleManaPool,
// manaSymbolToColorKey, addProducedMana, createSingleColorProduction,
// applyScalingManaToOptimisticPool.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import type { SacrificeType } from "../../../../../shared/src/textUtils.js";
import type { ParsedManaCost } from "./manaCheckPaymentTypes.js";

/**
 * Get a default mana pool (empty)
 */
export function getEmptyManaPool(): Record<string, number> {
  return {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };
}

/**
 * Get mana pool from game state for a player
 */
export function getManaPoolFromState(state: any, playerId: PlayerID): Record<string, number> {
  return (state as any).manaPool?.[playerId] || getEmptyManaPool();
}

export const SIMPLE_MANA_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;
export type SimpleManaKey = typeof SIMPLE_MANA_KEYS[number];

export type ExactManaSourceOption = {
  activationCost?: ParsedManaCost;
  lifeCost?: number;
  handCost?: {
    count: number;
    destination: 'graveyard' | 'exile';
    typeRestriction?: string;
  };
  sacrificeCost?: {
    type: SacrificeType;
    count: number;
    creatureSubtype?: string;
    mustBeOther?: boolean;
  };
  returnToHandCost?: {
    type: string;
    mustBeOther?: boolean;
  };
  /** Self remove-counter activation cost (Gemstone Array, Pentad Prism, etc.). */
  removeCounterCost?: {
    counterType: string;
    count: number;
  };
  /** True when this option models charge-then-remove color fixing on a mana battery. */
  batteryColorFix?: boolean;
  repeatable?: boolean;
  produced: Record<SimpleManaKey, number>;
  spendRestriction?: { restriction: string; restrictedTo?: string };
};

export type ExactManaSource = {
  id: string;
  permanentId: string;
  options: ExactManaSourceOption[];
  /** Remaining self counters available for remove-counter mana options. */
  counterBudgets?: Record<string, number>;
};

export type ExactSacrificeCandidate = {
  id: string;
  typeLine: string;
  subtypeWords: string[];
};

export type ExactHandCandidate = {
  id: string;
  typeLine: string;
};

export type ExactCandidateRemovalResult<TCandidate> = {
  remainingCandidates: TCandidate[];
  removedIds: string[];
};

export function createSimpleManaPool(seed?: Record<string, number>): Record<SimpleManaKey, number> {
  return {
    white: Number(seed?.white || 0),
    blue: Number(seed?.blue || 0),
    black: Number(seed?.black || 0),
    red: Number(seed?.red || 0),
    green: Number(seed?.green || 0),
    colorless: Number(seed?.colorless || 0),
  };
}

export function manaSymbolToColorKey(symbol: string): SimpleManaKey | undefined {
  const symbolMap: Record<string, SimpleManaKey> = {
    W: 'white',
    U: 'blue',
    B: 'black',
    R: 'red',
    G: 'green',
    C: 'colorless',
  };

  return symbolMap[String(symbol || '').toUpperCase()];
}

export function addProducedMana(
  pool: Record<SimpleManaKey, number>,
  produced: Record<SimpleManaKey, number>,
): Record<SimpleManaKey, number> {
  const nextPool = createSimpleManaPool(pool);
  for (const key of SIMPLE_MANA_KEYS) {
    nextPool[key] += Number(produced[key] || 0);
  }
  return nextPool;
}

export function createSingleColorProduction(colorKey: SimpleManaKey, amount: number = 1): Record<SimpleManaKey, number> {
  const pool = createSimpleManaPool();
  pool[colorKey] = amount;
  return pool;
}

export function applyScalingManaToOptimisticPool(
  pool: Record<string, number>,
  colorField: string,
  amount: number,
): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const color = String(colorField || '').trim();
  if (!color) return;

  if (color === 'any_one_color' || color === 'any_combination' || color === 'any') {
    pool.white = (pool.white || 0) + amount;
    pool.blue = (pool.blue || 0) + amount;
    pool.black = (pool.black || 0) + amount;
    pool.red = (pool.red || 0) + amount;
    pool.green = (pool.green || 0) + amount;
    pool.anyColor = (pool.anyColor || 0) + amount;
    return;
  }

  if (color.startsWith('combination:')) {
    const letters = color
      .slice('combination:'.length)
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
    const optionLetters = new Set(letters);
    for (const letter of optionLetters) {
      const colorKey = manaSymbolToColorKey(letter);
      if (colorKey) pool[colorKey] = (pool[colorKey] || 0) + amount;
    }
    if (optionLetters.size >= 2) {
      const lettersSorted = Array.from(optionLetters).sort().join('');
      const markerKey = `choiceColors_${lettersSorted}`;
      (pool as any)[markerKey] = Number((pool as any)[markerKey] || 0) + amount;
    }
    return;
  }

  const colorKey = manaSymbolToColorKey(color);
  if (colorKey) {
    pool[colorKey] = (pool[colorKey] || 0) + amount;
  }
}
