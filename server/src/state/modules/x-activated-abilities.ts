/**
 * server/src/state/modules/x-activated-abilities.ts
 * 
 * Handles activated abilities with X in their cost.
 * 
 * Uses pattern-based detection from oracle text to support any card with X-cost
 * activated abilities, rather than maintaining a hardcoded registry.
 */

import type { GameContext } from '../context';
import { debug, debugWarn } from '../../utils/debug.js';

/**
 * Pattern types for X-cost activated abilities
 */
export enum XAbilityPattern {
  DESTROY_MV_X = 'destroy_mv_x',                    // Destroy permanents with mana value X
  BECOME_X_X = 'become_x_x',                        // Becomes X/X creature
  PLUS_X_ZERO = 'plus_x_zero',                      // Gets +X/+0
  PLUS_X_X = 'plus_x_x',                            // Gets +X/+X
  DEAL_X_DAMAGE = 'deal_x_damage',                  // Deals X damage
  PREVENT_X_DAMAGE = 'prevent_x_damage',            // Prevents X damage
  PUT_X_COUNTERS = 'put_x_counters',                // Puts X counters
  COPY_MV_X = 'copy_mv_x',                          // Becomes copy of card with mana value X
  SCRY_X = 'scry_x',                                // Look at/scry X cards
  SEARCH_MV_X = 'search_mv_x',                      // Search for card with mana value X
  BASE_POWER_X = 'base_power_x',                    // Sets base power/toughness to X/X
  GENERIC = 'generic',                              // Other X effects
}

export interface XAbilityInfo {
  pattern: XAbilityPattern;
  oracleText: string;
  requiresCombatDamage?: boolean;
  oncePerTurn?: boolean;
  timingRestriction?: 'sorcery' | 'instant';
  manaRestriction?: string;  // e.g., "Spend only black mana on X"
}

/**
 * Detect X-cost activated ability from oracle text
 */
export function detectXAbility(oracleText: string, cardName: string): XAbilityInfo | null {
  if (!oracleText) return null;
  
  const lines = oracleText.split('\n');
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    
    // Must have {X}: to be an activated ability with X cost
    if (!/\{x\}\s*:/i.test(line)) continue;
    
    // Extract the ability text after the cost
    const abilityMatch = line.match(/\{X\}\s*:\s*(.+)/i);
    if (!abilityMatch) continue;
    
    const abilityText = abilityMatch[1];
    const lowerAbility = abilityText.toLowerCase();
    
    // Detect pattern
    let pattern: XAbilityPattern = XAbilityPattern.GENERIC;
    let requiresCombatDamage = false;
    let oncePerTurn = false;
    
    // Pattern detection
    if (lowerAbility.includes('destroy') && lowerAbility.includes('mana value x')) {
      pattern = XAbilityPattern.DESTROY_MV_X;
      // Check for combat damage requirement
      requiresCombatDamage = lowerAbility.includes('combat damage');
    } else if (lowerAbility.includes('becomes') && lowerAbility.includes('x/x')) {
      pattern = XAbilityPattern.BECOME_X_X;
    } else if (lowerAbility.includes('base power and toughness x/x')) {
      pattern = XAbilityPattern.BASE_POWER_X;
    } else if (lowerAbility.includes('gets +x/+0')) {
      pattern = XAbilityPattern.PLUS_X_ZERO;
    } else if (lowerAbility.includes('gets +x/+x')) {
      pattern = XAbilityPattern.PLUS_X_X;
    } else if (lowerAbility.includes('deals x damage')) {
      pattern = XAbilityPattern.DEAL_X_DAMAGE;
    } else if (lowerAbility.includes('prevent') && lowerAbility.includes('x damage')) {
      pattern = XAbilityPattern.PREVENT_X_DAMAGE;
    } else if (lowerAbility.includes('put x') && lowerAbility.includes('counter')) {
      pattern = XAbilityPattern.PUT_X_COUNTERS;
    } else if (lowerAbility.includes('copy') && lowerAbility.includes('mana value x')) {
      pattern = XAbilityPattern.COPY_MV_X;
    } else if ((lowerAbility.includes('look at') || lowerAbility.includes('scry')) && lowerAbility.includes('x card')) {
      pattern = XAbilityPattern.SCRY_X;
    } else if (lowerAbility.includes('search') && lowerAbility.includes('mana value x')) {
      pattern = XAbilityPattern.SEARCH_MV_X;
    }
    
    // Check for once per turn
    if (lowerLine.includes('activate only once each turn') || 
        lowerLine.includes('activate this ability only once each turn')) {
      oncePerTurn = true;
    }
    
    // Check for timing restriction
    let timingRestriction: 'sorcery' | 'instant' | undefined;
    if (lowerLine.includes('activate only as a sorcery') || 
        lowerLine.includes('activate this ability only as a sorcery')) {
      timingRestriction = 'sorcery';
    }
    
    // Check for mana restriction
    let manaRestriction: string | undefined;
    const manaRestMatch = line.match(/spend only (\w+) mana on x/i);
    if (manaRestMatch) {
      manaRestriction = manaRestMatch[1];
    }
    
    return {
      pattern,
      oracleText: line,
      requiresCombatDamage,
      oncePerTurn,
      timingRestriction,
      manaRestriction,
    };
  }
  
  return null;
}

/**
 * Execute X-cost activated ability based on detected pattern
 */
export function executeXAbility(
  ctx: GameContext,
  playerId: string,
  permanent: any,
  xValue: number,
  abilityInfo: XAbilityInfo
): { success: boolean; message?: string; error?: string; destroyedCount?: number } {
  const { state } = ctx;
  
  // Handle pattern-specific logic
  switch (abilityInfo.pattern) {
    case XAbilityPattern.DESTROY_MV_X:
      return executeDestroyManaValueX(ctx, playerId, permanent, xValue, abilityInfo);
    
    case XAbilityPattern.DEAL_X_DAMAGE:
      return executeDealXDamage(ctx, playerId, permanent, xValue, abilityInfo);
    
    case XAbilityPattern.PUT_X_COUNTERS:
      return executePutXCounters(ctx, playerId, permanent, xValue, abilityInfo);
    
    // Add more pattern implementations as needed
    default:
      return {
        success: false,
        error: `X ability pattern ${abilityInfo.pattern} not yet implemented`,
      };
  }
}

/**
 * Execute "Destroy permanents with mana value X" pattern
 * Examples: Steel Hellkite
 */
function executeDestroyManaValueX(
  ctx: GameContext,
  playerId: string,
  permanent: any,
  xValue: number,
  abilityInfo: XAbilityInfo
): { success: boolean; destroyedCount: number; error?: string } {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  
  if (permanent.controller !== playerId) {
    return { success: false, destroyedCount: 0, error: 'You do not control this permanent' };
  }
  
  // Check combat damage requirement
  if (abilityInfo.requiresCombatDamage) {
    const dealtDamageTo = (permanent as any).dealtCombatDamageTo as Set<string> | undefined;
    if (!dealtDamageTo || dealtDamageTo.size === 0) {
      return { 
        success: false, 
        destroyedCount: 0, 
        error: 'This creature has not dealt combat damage to any players this turn' 
      };
    }
    
    // Find permanents controlled by damaged players
    const toDestroy: any[] = [];
    
    for (const perm of battlefield) {
      const controller = (perm as any).controller;
      const card = (perm as any).card;
      
      // Skip if controller wasn't dealt damage
      if (!dealtDamageTo.has(controller)) continue;
      
      // Skip lands (usually specified in the ability)
      const typeLine = (card?.type_line || '').toLowerCase();
      if (typeLine.includes('land')) continue;
      
      // Check mana value
      const manaValue = calculateManaValue(card);
      if (manaValue === xValue) {
        toDestroy.push(perm);
      }
    }
    
    // Destroy the permanents
    destroyPermanents(state, toDestroy);
    
    debug(2, `[X Ability] Destroyed ${toDestroy.length} permanent(s) with mana value ${xValue}`);
    
    return { success: true, destroyedCount: toDestroy.length };
  }
  
  // Generic destroy pattern (no combat damage requirement)
  return { success: false, destroyedCount: 0, error: 'Generic destroy pattern not fully implemented' };
}

/**
 * Execute "Deal X damage" pattern
 * Examples: Crypt Rats
 */
function executeDealXDamage(
  ctx: GameContext,
  playerId: string,
  permanent: any,
  xValue: number,
  abilityInfo: XAbilityInfo
): { success: boolean; message?: string; error?: string } {
  // Check oracle text for specific targeting
  const lowerOracle = abilityInfo.oracleText.toLowerCase();
  
  if (lowerOracle.includes('each creature and each player')) {
    // Deals X damage to each creature and each player
    const battlefield = ctx.state.battlefield || [];
    let creaturesHit = 0;
    
    // Damage all creatures
    for (const perm of battlefield) {
      const typeLine = ((perm as any).card?.type_line || '').toLowerCase();
      if (typeLine.includes('creature')) {
        // Mark damage (simplified - would need full damage tracking)
        (perm as any).damageMarked = ((perm as any).damageMarked || 0) + xValue;
        creaturesHit++;
      }
    }
    
    // Damage all players (simplified)
    const players = ctx.state.players || [];
    const life = (ctx.state as any).life || {};
    const startingLife = (ctx.state as any).startingLife || 40;
    
    for (const player of players) {
      const currentLife = life[player.id] ?? startingLife;
      life[player.id] = currentLife - xValue;
    }
    
    return {
      success: true,
      message: `Dealt ${xValue} damage to each creature and each player`,
    };
  }
  
  return { success: false, error: 'Deal X damage pattern not fully implemented for this variant' };
}

/**
 * Execute "Put X counters" pattern
 * Examples: Helix Pinnacle, Energy Vortex
 */
function executePutXCounters(
  ctx: GameContext,
  playerId: string,
  permanent: any,
  xValue: number,
  abilityInfo: XAbilityInfo
): { success: boolean; message?: string; error?: string } {
  // Detect counter type from oracle text
  const lowerOracle = abilityInfo.oracleText.toLowerCase();
  let counterType = '+1/+1';  // default
  
  if (lowerOracle.includes('tower counter')) {
    counterType = 'tower';
  } else if (lowerOracle.includes('vortex counter')) {
    counterType = 'vortex';
  } else if (lowerOracle.includes('sleight counter')) {
    counterType = 'sleight';
  }
  
  // Add counters to the permanent
  if (!permanent.counters) {
    permanent.counters = {};
  }
  permanent.counters[counterType] = (permanent.counters[counterType] || 0) + xValue;
  
  return {
    success: true,
    message: `Put ${xValue} ${counterType} counter(s) on this permanent`,
  };
}

/**
 * Helper: Calculate mana value of a card
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
 * Helper: Destroy permanents and move to graveyard
 */
function destroyPermanents(state: any, permanents: any[]): void {
  const battlefield = state.battlefield || [];
  
  for (const perm of permanents) {
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
}
