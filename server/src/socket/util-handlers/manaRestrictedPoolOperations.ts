// server/src/socket/util-handlers/manaRestrictedPoolOperations.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: restricted mana pool entries, doesn't-empty flags, pool totals
//   including restricted, RestrictedManaSpendPurpose eligibility, and floating
//   pool-payment helpers that key off restricted entries.
// Public entry symbols: getManaEntryColor, addRestrictedManaToPool,
//   removeRestrictedManaFromPool, setManaPoolDoesNotEmpty,
//   removeManaPoolDoesNotEmpty, getTotalManaInPool, getTotalManaOfColorInPool,
//   RestrictedManaSpendPurpose, canUseRestrictedMana,
//   parseFloatingPaymentPermanentId, getFloatingPaymentPoolColorKey,
//   validateSelectedFloatingPoolMana, buildManaTotalsIncludingEligibleRestricted.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { ManaPool, RestrictedManaEntry, ManaRestrictionType } from "../../../../shared/src/index.js";
import { cardHasCreatureType } from "../../state/creatureTypeNow.js";
import { MANA_COLOR_NAMES } from "./manaColorConstants.js";
import { calculateTotalAvailableMana, getOrInitManaPool } from "./manaPoolStateOperations.js";

// ============================================================================
// ENHANCED MANA POOL FUNCTIONS - Support for restricted mana
// ============================================================================

/**
 * Helper function to get the color from a restricted mana entry
 * Uses the 'type' field as the primary source
 */
export function getManaEntryColor(entry: RestrictedManaEntry): 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless' {
  return entry.type;
}

/**
 * Add restricted mana to a player's mana pool
 */
export function addRestrictedManaToPool(
  gameState: any,
  playerId: string,
  color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless',
  amount: number,
  restriction: ManaRestrictionType,
  restrictedTo?: string,
  sourceId?: string,
  sourceName?: string
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  // NOTE: ManaPool interface marks properties as readonly for immutability guarantees.
  // However, server-side code needs to mutate the pool. We use `as any` here because:
  // 1. We own the game state and control all mutations
  // 2. The readonly is for client-side type safety, not server-side enforcement
  // 3. Alternative solutions (separate mutable type) would duplicate the interface
  const mutablePool = pool as any;
  const restricted = (mutablePool.restricted as RestrictedManaEntry[] | undefined) || [];
  mutablePool.restricted = restricted;
  
  // Check if there's already an entry with the same attributes (check both type and color for compatibility)
  const existingIndex = restricted.findIndex(
    entry => getManaEntryColor(entry) === color && 
             entry.restriction === restriction && 
             entry.sourceId === sourceId &&
             entry.restrictedTo === restrictedTo
  );
  
  if (existingIndex >= 0) {
    // Add to existing entry
    restricted[existingIndex].amount += amount;
  } else {
    // Create new entry
    restricted.push({
      type: color,
      amount,
      restriction,
      restrictedTo,
      sourceId,
      sourceName,
    });
  }
}

/**
 * Remove restricted mana from pool
 */
export function removeRestrictedManaFromPool(
  gameState: any,
  playerId: string,
  restrictedIndex: number,
  amount: number = 1
): boolean {
  const pool = getOrInitManaPool(gameState, playerId);
  const restricted = pool.restricted as RestrictedManaEntry[] | undefined;
  if (!restricted || restrictedIndex >= restricted.length) {
    return false;
  }
  
  const entry = restricted[restrictedIndex];
  if (entry.amount < amount) {
    return false;
  }
  
  if (entry.amount === amount) {
    // Remove the entry entirely
    restricted.splice(restrictedIndex, 1);
    if (restricted.length === 0) {
      delete (pool as any).restricted;
    }
  } else {
    entry.amount -= amount;
  }
  
  return true;
}

/**
 * Set the "doesn't empty" flag on a player's mana pool
 * Used by effects like Horizon Stone, Omnath, Kruphix, Ozai
 * 
 * @param convertsTo - Target color to convert mana to (e.g., 'colorless', 'black', 'red')
 * @param convertsToColorless - @deprecated Use convertsTo: 'colorless' instead
 */
export function setManaPoolDoesNotEmpty(
  gameState: any,
  playerId: string,
  sourceId: string,
  convertsTo?: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless',
  convertsToColorless: boolean = false
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  // Cast to allow modification of readonly properties
  const mutablePool = pool as any;
  mutablePool.doesNotEmpty = true;
  
  // Support both new convertsTo and deprecated convertsToColorless
  if (convertsTo) {
    mutablePool.convertsTo = convertsTo;
  } else if (convertsToColorless) {
    mutablePool.convertsTo = 'colorless';
    mutablePool.convertsToColorless = true;
  }
  
  mutablePool.noEmptySourceIds = mutablePool.noEmptySourceIds || [];
  
  if (!mutablePool.noEmptySourceIds.includes(sourceId)) {
    mutablePool.noEmptySourceIds.push(sourceId);
  }
}

/**
 * Remove the "doesn't empty" effect from a specific source
 * Called when the source permanent leaves the battlefield
 */
export function removeManaPoolDoesNotEmpty(
  gameState: any,
  playerId: string,
  sourceId: string
): void {
  const pool = getOrInitManaPool(gameState, playerId);
  const mutablePool = pool as any;
  
  if (!mutablePool.noEmptySourceIds) return;
  
  mutablePool.noEmptySourceIds = mutablePool.noEmptySourceIds.filter((id: string) => id !== sourceId);
  
  if (mutablePool.noEmptySourceIds.length === 0) {
    delete mutablePool.doesNotEmpty;
    delete mutablePool.convertsTo;
    delete mutablePool.convertsToColorless;
    delete mutablePool.noEmptySourceIds;
  }
}

/**
 * Calculate total mana in pool (including restricted)
 */
export function getTotalManaInPool(
  gameState: any,
  playerId: string
): number {
  const pool = getOrInitManaPool(gameState, playerId);
  const regularMana = (pool.white || 0) + (pool.blue || 0) + (pool.black || 0) +
                      (pool.red || 0) + (pool.green || 0) + (pool.colorless || 0);
  const restrictedMana = pool.restricted?.reduce((sum, entry) => sum + entry.amount, 0) || 0;
  return regularMana + restrictedMana;
}

/**
 * Calculate total mana of a specific color in pool (including restricted)
 * Useful for cards like Omnath, Locus of Mana which get +1/+1 for each green mana
 */
export function getTotalManaOfColorInPool(
  gameState: any,
  playerId: string,
  color: 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless'
): number {
  const pool = getOrInitManaPool(gameState, playerId);
  const regularMana = pool[color] || 0;
  const restrictedMana = pool.restricted
    ?.filter(entry => getManaEntryColor(entry) === color)
    .reduce((sum, entry) => sum + entry.amount, 0) || 0;
  return regularMana + restrictedMana;
}

/**
 * Check if restricted mana can be used for a specific purpose
 */
export type RestrictedManaSpendPurpose = {
  isCreature?: boolean;
  isAbility?: boolean;
  isColorless?: boolean;
  isArtifact?: boolean;
  isLegendary?: boolean;
  isMulticolored?: boolean;
  isCommander?: boolean;
  isActivatedAbility?: boolean;
  isInstantOrSorcery?: boolean;
  cardId?: string;
  creatureType?: string;
  spellType?: string;
  spellCard?: any;
  abilitySourceIsCreature?: boolean;
  abilitySourceCreatureType?: string;
};

export function canUseRestrictedMana(
  entry: RestrictedManaEntry,
  purpose: RestrictedManaSpendPurpose,
): boolean {
  switch (entry.restriction) {
    case 'creatures':
      return purpose.isCreature === true;
    case 'abilities':
      return purpose.isAbility === true;
    case 'colorless_spells':
      return purpose.isColorless === true;
    case 'artifacts':
      return purpose.isArtifact === true;
    case 'no_nonartifact_spells': {
      // Ban only casting a nonartifact spell. Activated abilities and other costs are fine.
      // Artifact includes Vehicle, Equipment, Fortification — not only Artifact Creature.
      if (purpose.isActivatedAbility === true || purpose.isAbility === true) return true;
      if (purpose.isArtifact === true) return true;
      const spellTypeLine = String(purpose.spellCard?.type_line || '').trim();
      if (spellTypeLine) {
        return /\bartifact\b/i.test(spellTypeLine);
      }
      // Casting without type_line: treat non-artifact purpose flags as bans.
      if (
        purpose.isCreature === true
        || purpose.isInstantOrSorcery === true
        || purpose.isLegendary === true
        || purpose.isMulticolored === true
        || purpose.isColorless === true
        || purpose.isCommander === true
      ) {
        return false;
      }
      // Unknown / non-cast payment context — allow (matches Powerstone CR reading).
      return true;
    }
    case 'legendary':
      return purpose.isLegendary === true;
    case 'multicolored':
      return purpose.isMulticolored === true;
    case 'commander':
      return purpose.isCommander === true;
    case 'activated_abilities':
      return purpose.isActivatedAbility === true;
    case 'instant_sorcery':
      return purpose.isInstantOrSorcery === true;
    case 'chosen_type_creature_spell':
    case 'chosen_type_creature_source':
      if (purpose.isCreature !== true) {
        if (entry.restriction === 'chosen_type_creature_source' && purpose.isActivatedAbility === true) {
          if (purpose.abilitySourceIsCreature !== true) return false;
          return !entry.restrictedTo
            || purpose.creatureType === entry.restrictedTo
            || purpose.abilitySourceCreatureType === entry.restrictedTo;
        }
        return false;
      }
      if (!entry.restrictedTo) return true;
      if (purpose.creatureType === entry.restrictedTo) return true;
      if (purpose.spellCard && cardHasCreatureType(purpose.spellCard, entry.restrictedTo)) {
        return true;
      }
      return false;
    case 'chosen_type_spell':
      if (!entry.restrictedTo) return true;
      if (purpose.creatureType === entry.restrictedTo || purpose.spellType === entry.restrictedTo) return true;
      if (purpose.spellCard && cardHasCreatureType(purpose.spellCard, entry.restrictedTo)) return true;
      return false;
    case 'creature_spells_mv_or_x': {
      if (purpose.isCreature !== true) return false;
      const spellCard = purpose.spellCard;
      if (!spellCard) return false;
      const manaCost = String(spellCard.mana_cost || '');
      if (/\{x\}/i.test(manaCost)) return true;
      const minMv = Number.parseInt(String(entry.restrictedTo || '4'), 10);
      const threshold = Number.isFinite(minMv) && minMv > 0 ? minMv : 4;
      let manaValue = Number(spellCard.cmc);
      if (!Number.isFinite(manaValue)) {
        manaValue = 0;
        const tokens = manaCost.match(/\{([^}]+)\}/g) || [];
        for (const token of tokens) {
          const inner = token.replace(/[{}]/g, '');
          if (/^\d+$/.test(inner)) manaValue += Number.parseInt(inner, 10);
          else if (/^[wubrgcs]$/i.test(inner)) manaValue += 1;
          else if (inner.includes('/')) manaValue += 1;
        }
      }
      return manaValue >= threshold;
    }
    case 'specific_card':
      return entry.restrictedTo === purpose.cardId;
    default:
      return false;
  }
}

export function parseFloatingPaymentPermanentId(permanentId: string):
  | { kind: 'regular'; colorKey: string }
  | { kind: 'restricted'; index: number }
  | null {
  const rawId = String(permanentId || '').trim();
  if (!rawId.startsWith('__pool__:')) return null;

  const parts = rawId.slice('__pool__:'.length).split(':');
  const encodedKey = String(parts[0] || '').trim().toLowerCase();
  if (encodedKey === 'restricted') {
    const index = Number.parseInt(parts[1] ?? '', 10);
    return Number.isFinite(index) && index >= 0 ? { kind: 'restricted', index } : null;
  }
  if (['white', 'blue', 'black', 'red', 'green', 'colorless'].includes(encodedKey)) {
    return { kind: 'regular', colorKey: encodedKey };
  }
  return null;
}

export function getFloatingPaymentPoolColorKey(
  permanentId: string,
  mana: string,
  pool?: ManaPool,
): string | null {
  const parsed = parseFloatingPaymentPermanentId(permanentId);
  if (!parsed) return null;
  if (parsed.kind === 'regular') return parsed.colorKey;
  const entry = pool?.restricted?.[parsed.index];
  if (entry) return getManaEntryColor(entry);
  return MANA_COLOR_NAMES[String(mana || '').toUpperCase()] || null;
}

export function validateSelectedFloatingPoolMana(
  pool: ManaPool,
  selectedFloatingMana: Record<string, number>,
  selectedFloatingRestricted: Record<number, number>,
  purpose?: RestrictedManaSpendPurpose,
): string | null {
  for (const [indexStr, amount] of Object.entries(selectedFloatingRestricted)) {
    const index = Number(indexStr);
    const needed = Number(amount || 0);
    if (needed <= 0) continue;
    const entry = pool.restricted?.[index];
    if (!entry || entry.amount < needed) {
      return 'Not enough restricted mana selected from your pool.';
    }
    if (purpose && !canUseRestrictedMana(entry, purpose)) {
      return 'Selected restricted mana cannot be spent on this payment.';
    }
  }

  for (const [poolKey, amount] of Object.entries(selectedFloatingMana)) {
    const needed = Number(amount || 0);
    if (needed <= 0) continue;
    const regularAvailable = Number((pool as any)[poolKey] || 0);
    let restrictedAvailable = 0;
    for (const entry of pool.restricted || []) {
      if (getManaEntryColor(entry) !== poolKey) continue;
      if (purpose && !canUseRestrictedMana(entry, purpose)) continue;
      restrictedAvailable += entry.amount;
    }
    if (regularAvailable + restrictedAvailable < needed) {
      return `Not enough ${poolKey} mana selected from your pool.`;
    }
  }

  return null;
}

export function buildManaTotalsIncludingEligibleRestricted(
  pool: ManaPool,
  purpose: RestrictedManaSpendPurpose,
): Record<string, number> {
  const totals = calculateTotalAvailableMana(pool, undefined);
  for (const entry of pool.restricted || []) {
    if (!canUseRestrictedMana(entry, purpose)) continue;
    const color = getManaEntryColor(entry);
    totals[color] = (totals[color] || 0) + entry.amount;
  }
  return totals;
}
