/**
 * cards/triggerCopying.ts
 * 
 * Pattern-based detection for trigger copying or doubling effects.
 * Uses oracle text pattern matching instead of hard-coded card lists.
 * 
 * Patterns detected:
 * - "triggers an additional time" (Panharmonicon, Yarok, Teysa Karlov)
 * - "copy target triggered ability" (Strionic Resonator)
 * - "copy that ability" (Echoes of Eternity)
 * - "twice that many tokens" (Anointed Procession, Doubling Season)
 * - "twice that many counters" (Doubling Season)
 */

import { TriggerEvent } from '../triggeredAbilities';

export interface TriggerCopyInfo {
  readonly hasTriggerCopying: boolean;
  readonly effectType: 'copy' | 'double' | 'additional' | 'none';
  readonly activationType: 'static' | 'activated' | 'triggered';
  readonly triggerFilter?: {
    readonly etbOnly?: boolean;
    readonly deathOnly?: boolean;
    readonly attackOnly?: boolean;
    readonly colorlessOnly?: boolean;
    readonly creatureTypeFilter?: string;
  };
  readonly tokenDoubling?: boolean;
  readonly counterDoubling?: boolean;
  readonly activationCost?: string;
}

/**
 * Detect trigger copying/doubling effects from oracle text
 */
export function detectTriggerCopying(oracleText: string): TriggerCopyInfo {
  const text = oracleText.toLowerCase();
  
  // Pattern: "triggers an additional time" (Panharmonicon, Yarok, Teysa, Isshin)
  if (text.includes('triggers an additional time') || text.includes('trigger an additional time')) {
    const etbOnly = text.includes('entering the battlefield') || text.includes('enters the battlefield');
    const deathOnly = text.includes('dying') || text.includes('creature dying');
    const attackOnly = text.includes('attacking') || text.includes('creature attacking');
    
    // Check for creature type filter (Harmonic Prodigy - Shamans/Wizards)
    let creatureTypeFilter: string | undefined;
    const typeMatch = text.match(/(?:of a|ability of a) (\w+) (?:or (\w+) )?you control/);
    if (typeMatch) {
      creatureTypeFilter = typeMatch[2] ? `${typeMatch[1]} or ${typeMatch[2]}` : typeMatch[1];
    }
    
    return {
      hasTriggerCopying: true,
      effectType: 'additional',
      activationType: 'static',
      triggerFilter: {
        etbOnly,
        deathOnly,
        attackOnly,
        creatureTypeFilter,
      },
    };
  }
  
  // Pattern: "copy target triggered ability" (Strionic Resonator, Lithoform Engine)
  if (text.includes('copy target triggered ability') || text.includes('copy that triggered ability')) {
    // Extract activation cost if present - look for patterns like "{2}, {T}:" or "{3}:"
    const costMatch = text.match(/(\{[^}]+\}(?:,\s*\{[^}]+\})*)\s*:/i);
    const activationCost = costMatch ? costMatch[1] : undefined;
    
    return {
      hasTriggerCopying: true,
      effectType: 'copy',
      activationType: activationCost ? 'activated' : 'triggered',
      activationCost,
    };
  }
  
  // Pattern: "copy that ability" with colorless filter (Echoes of Eternity)
  if (text.includes('copy that ability') || text.includes('copy the ability')) {
    const colorlessOnly = text.includes('colorless');
    
    return {
      hasTriggerCopying: true,
      effectType: 'double',
      activationType: 'static',
      triggerFilter: {
        colorlessOnly,
      },
    };
  }
  
  // Pattern: Token doubling
  // "twice that many tokens" or "twice as many tokens" or "double the number of tokens"
  const tokenDoublingPattern = /twice (?:that|as) many (?:of those )?tokens|double the number of tokens|creates? twice (?:that|as) many/i;
  if (tokenDoublingPattern.test(text)) {
    // Check if also doubles counters (Doubling Season, Primal Vigor)
    const counterDoubling = text.includes('twice that many') && text.includes('counter');
    
    return {
      hasTriggerCopying: true,
      effectType: 'double',
      activationType: 'static',
      tokenDoubling: true,
      counterDoubling,
    };
  }
  
  // Pattern: Counter doubling only (Hardened Scales is +1 not doubling, so exclude)
  // "twice that many counters" or "double the number of counters"
  if ((text.includes('twice that many') || text.includes('twice as many')) && text.includes('counter')) {
    return {
      hasTriggerCopying: true,
      effectType: 'double',
      activationType: 'static',
      counterDoubling: true,
    };
  }
  
  return {
    hasTriggerCopying: false,
    effectType: 'none',
    activationType: 'static',
  };
}

/**
 * Check if a card has trigger copying/doubling effects
 */
export function hasTriggerCopying(oracleText: string): boolean {
  return detectTriggerCopying(oracleText).hasTriggerCopying;
}

/**
 * Calculate token multiplier based on permanents on battlefield
 * Each token doubler doubles the count
 */
export function getTokenMultiplier(
  controllerId: string,
  battlefieldPermanents: { controller: string; oracleText: string }[]
): number {
  let multiplier = 1;
  
  for (const perm of battlefieldPermanents) {
    // Only check permanents you control
    if (perm.controller !== controllerId) continue;
    
    const info = detectTriggerCopying(perm.oracleText);
    if (info.tokenDoubling) {
      multiplier *= 2;
    }
  }
  
  return multiplier;
}

/**
 * Calculate counter multiplier based on permanents on battlefield
 */
export function getCounterMultiplier(
  controllerId: string,
  battlefieldPermanents: { controller: string; oracleText: string }[]
): number {
  let multiplier = 1;
  
  for (const perm of battlefieldPermanents) {
    // Only check permanents you control
    if (perm.controller !== controllerId) continue;
    
    const info = detectTriggerCopying(perm.oracleText);
    if (info.counterDoubling) {
      multiplier *= 2;
    }
  }
  
  return multiplier;
}

/**
 * Calculate trigger multiplier for a specific trigger type
 * Returns how many times the trigger should fire
 */
export function getTriggerMultiplier(
  triggerEvent: TriggerEvent,
  controllerId: string,
  battlefieldPermanents: { controller: string; oracleText: string }[],
  isColorless?: boolean
): number {
  let multiplier = 1;
  
  for (const perm of battlefieldPermanents) {
    // Only check permanents you control
    if (perm.controller !== controllerId) continue;
    
    const info = detectTriggerCopying(perm.oracleText);
    if (!info.hasTriggerCopying || info.effectType === 'none') continue;
    if (info.activationType !== 'static') continue; // Skip activated abilities
    
    // Check filter conditions
    if (info.triggerFilter) {
      if (info.triggerFilter.etbOnly && triggerEvent !== TriggerEvent.ENTERS_BATTLEFIELD) {
        continue;
      }
      if (info.triggerFilter.deathOnly && triggerEvent !== TriggerEvent.DIES) {
        continue;
      }
      if (info.triggerFilter.attackOnly && triggerEvent !== TriggerEvent.ATTACKS) {
        continue;
      }
      if (info.triggerFilter.colorlessOnly && !isColorless) {
        continue;
      }
    }
    
    // Apply doubling
    if (info.effectType === 'additional' || info.effectType === 'double') {
      multiplier *= 2;
    }
  }
  
  return multiplier;
}

/**
 * Find activated trigger copiers (like Strionic Resonator)
 */
export function getActivatedTriggerCopiers(
  battlefieldPermanents: { id: string; name: string; controller: string; oracleText: string; tapped?: boolean }[]
): { id: string; name: string; controller: string; cost?: string }[] {
  const copiers: { id: string; name: string; controller: string; cost?: string }[] = [];
  
  for (const perm of battlefieldPermanents) {
    const info = detectTriggerCopying(perm.oracleText);
    
    if (info.hasTriggerCopying && info.activationType === 'activated') {
      // Check if requires tap and is already tapped
      // The cost is lowercased, so check for {t}
      if (info.activationCost?.toLowerCase().includes('{t}') && perm.tapped) {
        continue;
      }
      
      copiers.push({
        id: perm.id,
        name: perm.name,
        controller: perm.controller,
        cost: info.activationCost,
      });
    }
  }
  
  return copiers;
}
