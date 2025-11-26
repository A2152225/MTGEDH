/**
 * staticAbilities.ts
 * 
 * Handles static abilities that create continuous effects on the battlefield.
 * These effects modify characteristics of permanents without using the stack.
 * 
 * Examples:
 * - Crusade: White creatures get +1/+1
 * - Glorious Anthem: Creatures you control get +1/+1
 * - Honor of the Pure: White creatures you control get +1/+1
 * - Lord of Atlantis: Other Merfolk get +1/+1 and islandwalk
 * 
 * Based on MTG Comprehensive Rules:
 * - Rule 604: Handling Static Abilities
 * - Rule 611: Continuous Effects
 * - Rule 613: Layer System
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';

/**
 * Static ability effect types
 */
export enum StaticEffectType {
  // Power/Toughness modifications
  PUMP = 'pump',                    // +X/+Y
  SET_PT = 'set_pt',                // Base P/T becomes X/Y
  
  // Ability grants
  GRANT_ABILITY = 'grant_ability',  // Give flying, trample, etc.
  REMOVE_ABILITY = 'remove_ability', // Remove abilities
  
  // Type modifications
  ADD_TYPE = 'add_type',            // Add creature type
  REMOVE_TYPE = 'remove_type',      // Remove creature type
  
  // Color modifications
  ADD_COLOR = 'add_color',          // Add color
  REMOVE_COLOR = 'remove_color',    // Remove color
  
  // Cost modifications
  COST_REDUCTION = 'cost_reduction', // Reduce cost
  COST_INCREASE = 'cost_increase',   // Increase cost
  
  // Other
  CANT_ATTACK = 'cant_attack',
  CANT_BLOCK = 'cant_block',
  HEXPROOF = 'hexproof',
  SHROUD = 'shroud',
  PROTECTION = 'protection',
}

/**
 * Target filter for static abilities
 */
export interface StaticEffectFilter {
  controller?: 'you' | 'opponents' | 'any';
  types?: string[];          // Creature types like 'Merfolk', 'Elf'
  cardTypes?: string[];      // Card types like 'creature', 'artifact'
  colors?: string[];         // Colors like 'white', 'blue'
  other?: boolean;           // "Other" creatures (excludes source)
  name?: string;             // Specific card name
}

/**
 * Static ability definition
 */
export interface StaticAbility {
  id: string;
  sourceId: string;
  sourceName: string;
  controllerId: PlayerID;
  effectType: StaticEffectType;
  filter: StaticEffectFilter;
  value?: number | string | string[];  // +X for pump, ability name for grant, etc.
  powerMod?: number;
  toughnessMod?: number;
  layer: number;  // Rule 613 layer system (1-7)
}

/**
 * Parse static abilities from a card's oracle text
 */
export function parseStaticAbilities(
  card: KnownCardRef,
  permanentId: string,
  controllerId: PlayerID
): StaticAbility[] {
  const abilities: StaticAbility[] = [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  const name = card.name || '';
  const typeLine = (card.type_line || '').toLowerCase();
  
  // Check for lord effects: "Other [type] creatures get +1/+1"
  const lordMatch = oracleText.match(/other\s+(\w+)\s+creatures?\s+(?:you control\s+)?get\s+\+(\d+)\/\+(\d+)/i);
  if (lordMatch) {
    abilities.push({
      id: `${permanentId}-lord`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        types: [lordMatch[1]],
        cardTypes: ['creature'],
        controller: 'you',
        other: true,
      },
      powerMod: parseInt(lordMatch[2]),
      toughnessMod: parseInt(lordMatch[3]),
      layer: 7, // Layer 7c: power/toughness changes
    });
  }
  
  // Check for "Creatures you control get +X/+Y"
  const creaturePumpMatch = oracleText.match(/creatures?\s+you\s+control\s+get\s+\+(\d+)\/\+(\d+)/i);
  if (creaturePumpMatch) {
    abilities.push({
      id: `${permanentId}-pump-your-creatures`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
      },
      powerMod: parseInt(creaturePumpMatch[1]),
      toughnessMod: parseInt(creaturePumpMatch[2]),
      layer: 7,
    });
  }
  
  // Check for "[Color] creatures get +1/+1" (like Crusade)
  const colorPumpMatch = oracleText.match(/(white|blue|black|red|green)\s+creatures?\s+get\s+\+(\d+)\/\+(\d+)/i);
  if (colorPumpMatch) {
    abilities.push({
      id: `${permanentId}-color-pump`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        cardTypes: ['creature'],
        colors: [colorPumpMatch[1].toLowerCase()],
        controller: 'any',
      },
      powerMod: parseInt(colorPumpMatch[2]),
      toughnessMod: parseInt(colorPumpMatch[3]),
      layer: 7,
    });
  }
  
  // Check for "[Color] creatures you control get +X/+Y" (like Honor of the Pure)
  const colorYouPumpMatch = oracleText.match(/(white|blue|black|red|green)\s+creatures?\s+you\s+control\s+get\s+\+(\d+)\/\+(\d+)/i);
  if (colorYouPumpMatch) {
    abilities.push({
      id: `${permanentId}-color-you-pump`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        cardTypes: ['creature'],
        colors: [colorYouPumpMatch[1].toLowerCase()],
        controller: 'you',
      },
      powerMod: parseInt(colorYouPumpMatch[2]),
      toughnessMod: parseInt(colorYouPumpMatch[3]),
      layer: 7,
    });
  }
  
  // Check for ability grants: "Creatures you control have [ability]"
  const abilityGrantMatch = oracleText.match(/creatures?\s+you\s+control\s+have\s+(flying|trample|lifelink|deathtouch|vigilance|haste|first strike|double strike|hexproof|indestructible|menace|reach)/i);
  if (abilityGrantMatch) {
    abilities.push({
      id: `${permanentId}-grant-${abilityGrantMatch[1]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.GRANT_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
      },
      value: abilityGrantMatch[1].toLowerCase(),
      layer: 6, // Layer 6: ability-adding effects
    });
  }
  
  // Check for type-specific ability grants: "[Type] creatures have [ability]"
  const typeAbilityMatch = oracleText.match(/(\w+)\s+creatures?\s+(?:you\s+control\s+)?have\s+(flying|trample|lifelink|deathtouch|vigilance|haste|first strike|double strike|hexproof|indestructible|menace|reach|islandwalk|forestwalk|mountainwalk|swampwalk|plainswalk)/i);
  if (typeAbilityMatch && !typeAbilityMatch[1].match(/^(all|each|every|other)$/i)) {
    abilities.push({
      id: `${permanentId}-type-grant-${typeAbilityMatch[2]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.GRANT_ABILITY,
      filter: {
        types: [typeAbilityMatch[1]],
        cardTypes: ['creature'],
        controller: oracleText.includes('you control') ? 'you' : 'any',
      },
      value: typeAbilityMatch[2].toLowerCase(),
      layer: 6,
    });
  }
  
  return abilities;
}

/**
 * Check if a permanent matches a filter
 */
export function matchesFilter(
  permanent: BattlefieldPermanent,
  filter: StaticEffectFilter,
  sourceId: string,
  controllerId: PlayerID
): boolean {
  const card = permanent.card as KnownCardRef;
  if (!card) return false;
  
  const typeLine = (card.type_line || '').toLowerCase();
  const colors = card.colors || [];
  
  // Check controller
  if (filter.controller === 'you' && permanent.controller !== controllerId) {
    return false;
  }
  if (filter.controller === 'opponents' && permanent.controller === controllerId) {
    return false;
  }
  
  // Check "other" (exclude source)
  if (filter.other && permanent.id === sourceId) {
    return false;
  }
  
  // Check card types
  if (filter.cardTypes && filter.cardTypes.length > 0) {
    const hasType = filter.cardTypes.some(ct => typeLine.includes(ct.toLowerCase()));
    if (!hasType) return false;
  }
  
  // Check creature types
  if (filter.types && filter.types.length > 0) {
    const hasCreatureType = filter.types.some(t => typeLine.includes(t.toLowerCase()));
    if (!hasCreatureType) return false;
  }
  
  // Check colors
  if (filter.colors && filter.colors.length > 0) {
    const colorMap: Record<string, string> = {
      'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G'
    };
    const requiredColors = filter.colors.map(c => colorMap[c.toLowerCase()] || c.toUpperCase());
    const hasColor = requiredColors.some(c => colors.includes(c));
    if (!hasColor) return false;
  }
  
  // Check name
  if (filter.name && card.name?.toLowerCase() !== filter.name.toLowerCase()) {
    return false;
  }
  
  return true;
}

/**
 * Calculate effective power and toughness for a permanent
 * considering all static abilities on the battlefield
 */
export function calculateEffectivePT(
  permanent: BattlefieldPermanent,
  battlefield: BattlefieldPermanent[],
  staticAbilities: StaticAbility[]
): { power: number; toughness: number; grantedAbilities: string[] } {
  const card = permanent.card as KnownCardRef;
  if (!card) {
    return { power: 0, toughness: 0, grantedAbilities: [] };
  }
  
  // Start with base P/T
  let power = parseInt(String(card.power || '0')) || 0;
  let toughness = parseInt(String(card.toughness || '0')) || 0;
  
  // Apply counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  power += plusCounters - minusCounters;
  toughness += plusCounters - minusCounters;
  
  // Collect granted abilities
  const grantedAbilities: string[] = [];
  
  // Sort abilities by layer (Rule 613)
  const sortedAbilities = [...staticAbilities].sort((a, b) => a.layer - b.layer);
  
  // Apply static ability effects
  for (const ability of sortedAbilities) {
    if (!matchesFilter(permanent, ability.filter, ability.sourceId, ability.controllerId)) {
      continue;
    }
    
    switch (ability.effectType) {
      case StaticEffectType.PUMP:
        power += ability.powerMod || 0;
        toughness += ability.toughnessMod || 0;
        break;
        
      case StaticEffectType.SET_PT:
        if (typeof ability.value === 'string' && ability.value.includes('/')) {
          const [p, t] = ability.value.split('/').map(v => parseInt(v));
          power = p;
          toughness = t;
        }
        break;
        
      case StaticEffectType.GRANT_ABILITY:
        if (typeof ability.value === 'string' && !grantedAbilities.includes(ability.value)) {
          grantedAbilities.push(ability.value);
        }
        break;
    }
  }
  
  return { power, toughness, grantedAbilities };
}

/**
 * Collect all static abilities from permanents on the battlefield
 */
export function collectStaticAbilities(
  battlefield: BattlefieldPermanent[]
): StaticAbility[] {
  const abilities: StaticAbility[] = [];
  
  for (const perm of battlefield) {
    const card = perm.card as KnownCardRef;
    if (!card) continue;
    
    const parsed = parseStaticAbilities(card, perm.id, perm.controller);
    abilities.push(...parsed);
  }
  
  return abilities;
}

/**
 * Apply static abilities to all permanents and return updated state
 */
export function applyStaticAbilitiesToBattlefield(
  battlefield: BattlefieldPermanent[]
): BattlefieldPermanent[] {
  const staticAbilities = collectStaticAbilities(battlefield);
  
  return battlefield.map(perm => {
    const card = perm.card as KnownCardRef;
    if (!card) return perm;
    
    const typeLine = (card.type_line || '').toLowerCase();
    
    // Only calculate P/T for creatures
    if (!typeLine.includes('creature')) {
      return perm;
    }
    
    const { power, toughness, grantedAbilities } = calculateEffectivePT(
      perm,
      battlefield,
      staticAbilities
    );
    
    return {
      ...perm,
      effectivePower: power,
      effectiveToughness: toughness,
      grantedAbilities: grantedAbilities.length > 0 ? grantedAbilities : undefined,
    } as BattlefieldPermanent;
  });
}

export default {
  parseStaticAbilities,
  matchesFilter,
  calculateEffectivePT,
  collectStaticAbilities,
  applyStaticAbilitiesToBattlefield,
};
