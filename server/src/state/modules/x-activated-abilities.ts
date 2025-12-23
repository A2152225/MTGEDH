/**
 * server/src/state/modules/x-activated-abilities.ts
 * 
 * Handles activated abilities with X in their cost.
 * 
 * These abilities require the player to choose a value for X when activating,
 * and the effect uses that value (e.g., Steel Hellkite destroying permanents
 * with mana value X).
 */

import type { GameContext } from '../context';
import { debug, debugWarn } from '../../utils/debug.js';

export interface XActivatedAbilityConfig {
  readonly cardName: string;
  readonly cost: string;
  readonly effect: string;
  readonly requiresTap?: boolean;
  readonly oncePerTurn?: boolean;
  readonly timingRestriction?: 'sorcery' | 'instant';
  readonly requiresCombatDamage?: boolean;  // For Steel Hellkite - must have dealt combat damage
}

/**
 * Registry of cards with X-cost activated abilities
 */
export const X_ACTIVATED_ABILITIES: Record<string, XActivatedAbilityConfig> = {
  'steel hellkite': {
    cardName: 'Steel Hellkite',
    cost: '{X}',
    effect: 'Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn.',
    requiresTap: false,
    oncePerTurn: true,
    requiresCombatDamage: true,
  },
  'heliod, the radiant dawn': {
    cardName: 'Heliod, the Radiant Dawn',
    cost: '{1}{W}, {X}',
    effect: 'Another target creature with mana value X or less gains lifelink until end of turn.',
    requiresTap: false,
    timingRestriction: 'instant',
  },
  'ramos, dragon engine': {
    cardName: 'Ramos, Dragon Engine',
    cost: 'Remove X +1/+1 counters from Ramos',
    effect: 'Add X mana in any combination of colors.',
    requiresTap: false,
  },
};

/**
 * Check if a card has an X-cost activated ability
 */
export function hasXActivatedAbility(cardName: string): boolean {
  return cardName.toLowerCase() in X_ACTIVATED_ABILITIES;
}

/**
 * Get X-cost activated ability config for a card
 */
export function getXActivatedAbility(cardName: string): XActivatedAbilityConfig | null {
  const key = cardName.toLowerCase();
  return X_ACTIVATED_ABILITIES[key] || null;
}

/**
 * Execute Steel Hellkite's X ability
 * Destroys all nonland permanents with mana value X whose controller was dealt combat damage
 */
export function executeSteelHellkiteAbility(
  ctx: GameContext,
  playerId: string,
  permanentId: string,
  xValue: number
): { success: boolean; destroyedCount: number; error?: string } {
  const { state } = ctx;
  
  // Find the Steel Hellkite permanent
  const battlefield = state.battlefield || [];
  const hellkite = battlefield.find((p: any) => p.id === permanentId);
  
  if (!hellkite) {
    return { success: false, destroyedCount: 0, error: 'Steel Hellkite not found on battlefield' };
  }
  
  if ((hellkite as any).controller !== playerId) {
    return { success: false, destroyedCount: 0, error: 'You do not control Steel Hellkite' };
  }
  
  // Check if Steel Hellkite dealt combat damage this turn
  // For now, we'll track this with a temporary property on the permanent
  const dealtDamageTo = (hellkite as any).dealtCombatDamageTo as Set<string> | undefined;
  
  if (!dealtDamageTo || dealtDamageTo.size === 0) {
    return { 
      success: false, 
      destroyedCount: 0, 
      error: 'Steel Hellkite has not dealt combat damage to any players this turn' 
    };
  }
  
  // Find all nonland permanents with mana value X controlled by players who were dealt damage
  const toDestroy: any[] = [];
  
  for (const perm of battlefield) {
    const controller = (perm as any).controller;
    const card = (perm as any).card;
    
    // Skip if controller wasn't dealt damage by Steel Hellkite
    if (!dealtDamageTo.has(controller)) {
      continue;
    }
    
    // Skip lands
    const typeLine = (card?.type_line || '').toLowerCase();
    if (typeLine.includes('land')) {
      continue;
    }
    
    // Check mana value
    const manaValue = calculateManaValue(card);
    if (manaValue === xValue) {
      toDestroy.push(perm);
    }
  }
  
  // Destroy the permanents
  for (const perm of toDestroy) {
    const idx = battlefield.indexOf(perm);
    if (idx >= 0) {
      battlefield.splice(idx, 1);
      
      // Move to graveyard
      const controller = (perm as any).controller;
      const zones = state.zones?.[controller];
      if (zones) {
        const graveyard = (zones as any).graveyard || [];
        graveyard.push({ ...(perm as any).card, zone: 'graveyard' });
        (zones as any).graveyard = graveyard;
        (zones as any).graveyardCount = graveyard.length;
      }
    }
  }
  
  debug(2, `[Steel Hellkite] Destroyed ${toDestroy.length} permanent(s) with mana value ${xValue}`);
  
  return { success: true, destroyedCount: toDestroy.length };
}

/**
 * Calculate mana value of a card
 */
function calculateManaValue(card: any): number {
  if (!card) return 0;
  
  // Check if CMC is already calculated
  if (typeof card.cmc === 'number') {
    return card.cmc;
  }
  
  // Parse mana cost
  const manaCost = card.mana_cost || '';
  if (!manaCost) return 0;
  
  let total = 0;
  
  // Match all mana symbols
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  
  for (const symbol of symbols) {
    const inner = symbol.slice(1, -1);
    
    // Numeric (generic) mana
    if (/^\d+$/.test(inner)) {
      total += parseInt(inner, 10);
    }
    // Colored mana (W, U, B, R, G)
    else if (/^[WUBRG]$/.test(inner)) {
      total += 1;
    }
    // Colorless mana {C}
    else if (inner === 'C') {
      total += 1;
    }
    // Hybrid mana {W/U}, etc.
    else if (inner.includes('/')) {
      total += 1;
    }
    // Phyrexian mana {W/P}, etc.
    else if (inner.includes('P')) {
      total += 1;
    }
    // X costs are 0 when not on stack
    else if (inner === 'X') {
      total += 0;
    }
  }
  
  return total;
}

/**
 * Track combat damage dealt by Steel Hellkite
 * This should be called when combat damage is dealt
 */
export function trackSteelHellkiteCombatDamage(
  ctx: GameContext,
  permanentId: string,
  damagedPlayerId: string
): void {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  const perm = battlefield.find((p: any) => p.id === permanentId);
  
  if (!perm) return;
  
  // Initialize or update the set of players dealt damage this turn
  let dealtDamageTo = (perm as any).dealtCombatDamageTo as Set<string> | undefined;
  if (!dealtDamageTo) {
    dealtDamageTo = new Set<string>();
    (perm as any).dealtCombatDamageTo = dealtDamageTo;
  }
  
  dealtDamageTo.add(damagedPlayerId);
  
  debug(3, `[Steel Hellkite] Tracked combat damage to player ${damagedPlayerId}`);
}

/**
 * Clear combat damage tracking at end of turn
 * This should be called during cleanup step
 */
export function clearSteelHellkiteCombatDamage(ctx: GameContext): void {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  
  for (const perm of battlefield) {
    if ((perm as any).dealtCombatDamageTo) {
      delete (perm as any).dealtCombatDamageTo;
    }
  }
}
