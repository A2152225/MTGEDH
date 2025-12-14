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
  PUMP_PER_CREATURE = 'pump_per_creature', // +X/+Y per creature of type (Squirrel Mob)
  
  // Ability grants
  GRANT_ABILITY = 'grant_ability',  // Give flying, trample, etc.
  REMOVE_ABILITY = 'remove_ability', // Remove abilities
  
  // Type modifications
  ADD_TYPE = 'add_type',            // Add creature type
  REMOVE_TYPE = 'remove_type',      // Remove creature type
  ADD_LAND_TYPE = 'add_land_type',  // Add land type (Yavimaya, Urborg)
  
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
  
  // Targeting modifications (Glaring Spotlight, Arcane Lighthouse, etc.)
  IGNORE_HEXPROOF = 'ignore_hexproof',   // Can target as though they didn't have hexproof
  IGNORE_SHROUD = 'ignore_shroud',       // Can target as though they didn't have shroud
  UNBLOCKABLE = 'unblockable',           // Can't be blocked
}

/**
 * Target filter for static abilities
 */
export interface StaticEffectFilter {
  controller?: 'you' | 'opponents' | 'any';
  types?: string[];          // Creature types like 'Merfolk', 'Elf'
  cardTypes?: string[];      // Card types like 'creature', 'artifact'
  landTypes?: string[];      // Land types like 'forest', 'island'
  colors?: string[];         // Colors like 'white', 'blue'
  other?: boolean;           // "Other" creatures (excludes source)
  selfOnly?: boolean;        // Only applies to the source permanent itself
  name?: string;             // Specific card name
  hasAbility?: string;       // Filter for creatures that have a specific ability (for Kwende-style effects)
  preventGaining?: boolean;  // Flag to indicate this effect prevents gaining the ability
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
  value?: number | string | string[];  // +X for pump, ability name for grant, land type for ADD_LAND_TYPE
  powerMod?: number;
  toughnessMod?: number;
  layer: number;  // Rule 613 layer system (1-7)
  // For PUMP_PER_CREATURE effects
  countFilter?: {
    types?: string[];        // Creature types to count
    other?: boolean;         // Count other creatures only (not self)
    controller?: 'you' | 'opponents' | 'any';
  };
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
  
  // Check for "Creatures you control get +X/+Y" (but not "Other [type] creatures")
  // Only match if the lord pattern didn't match (to avoid double-counting)
  if (!lordMatch) {
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
  
  // Check for conditional ability grants: "Creatures you control with [ability] have [ability]"
  // Example: Kwende, Pride of Femeref - "Creatures you control with first strike have double strike"
  const conditionalAbilityMatch = oracleText.match(/creatures?\s+(?:you\s+control\s+)?with\s+(first strike|flying|trample|lifelink|deathtouch|vigilance|haste|hexproof|indestructible|menace|reach)\s+have\s+(double strike|flying|trample|lifelink|deathtouch|vigilance|haste|hexproof|indestructible|menace|reach)/i);
  if (conditionalAbilityMatch) {
    abilities.push({
      id: `${permanentId}-conditional-grant-${conditionalAbilityMatch[2]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.GRANT_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: oracleText.includes('you control') ? 'you' : 'any',
        hasAbility: conditionalAbilityMatch[1].toLowerCase(), // Custom filter for "with [ability]"
      },
      value: conditionalAbilityMatch[2].toLowerCase(),
      layer: 6,
    });
  }
  
  // Check for ability removal from opponents: "Creatures your opponents control lose [ability]"
  // Example: Archetype of Courage - "Creatures your opponents control lose first strike and can't have or gain first strike"
  const abilityRemovalMatch = oracleText.match(/creatures?\s+your\s+opponents?\s+control\s+lose\s+(first strike|flying|trample|lifelink|deathtouch|vigilance|haste|double strike|hexproof|indestructible|menace|reach)/i);
  if (abilityRemovalMatch) {
    abilities.push({
      id: `${permanentId}-remove-${abilityRemovalMatch[1]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.REMOVE_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'opponents',
      },
      value: abilityRemovalMatch[1].toLowerCase(),
      layer: 6, // Layer 6: ability-removing effects
    });
  }
  
  // Check for "can't have or gain" prevention
  // Example: Archetype of Courage - "can't have or gain first strike"
  const cantGainMatch = oracleText.match(/(?:creatures?\s+your\s+opponents?\s+control\s+)?can't\s+have\s+or\s+gain\s+(first strike|flying|trample|lifelink|deathtouch|vigilance|haste|double strike|hexproof|indestructible|menace|reach)/i);
  if (cantGainMatch) {
    abilities.push({
      id: `${permanentId}-prevent-${cantGainMatch[1]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.REMOVE_ABILITY, // Also prevents gaining
      filter: {
        cardTypes: ['creature'],
        controller: 'opponents',
        preventGaining: true, // Custom flag to prevent gaining the ability
      },
      value: cantGainMatch[1].toLowerCase(),
      layer: 6,
    });
  }
  
  // Check for "ignore hexproof" effects (Glaring Spotlight, Arcane Lighthouse, Detection Tower)
  // Pattern: "Creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof"
  const ignoreHexproofMatch = oracleText.match(/creatures?\s+(?:your\s+)?opponents?\s+control\s+with\s+hexproof\s+can\s+be\s+the\s+targets?\s+of\s+spells?\s+and\s+abilities?\s+you\s+control\s+as\s+though\s+they\s+didn't\s+have\s+hexproof/i);
  if (ignoreHexproofMatch) {
    abilities.push({
      id: `${permanentId}-ignore-hexproof`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.IGNORE_HEXPROOF,
      filter: {
        cardTypes: ['creature'],
        controller: 'opponents',
        hasAbility: 'hexproof',
      },
      value: 'hexproof',
      layer: 6,
    });
  }
  
  // Also check for Arcane Lighthouse / Detection Tower style: "Creatures your opponents control lose hexproof"
  // These remove hexproof entirely when activated
  const loseHexproofMatch = oracleText.match(/creatures?\s+your\s+opponents?\s+control\s+lose\s+hexproof/i);
  if (loseHexproofMatch) {
    abilities.push({
      id: `${permanentId}-remove-hexproof`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.REMOVE_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'opponents',
      },
      value: 'hexproof',
      layer: 6,
    });
  }
  
  // Check for "can't be blocked" grants
  // Pattern: "Creatures you control ... can't be blocked"
  const cantBeBlockedMatch = oracleText.match(/creatures?\s+you\s+control\s+(?:gain\s+)?(?:have\s+)?(?:and\s+)?can't\s+be\s+blocked/i);
  if (cantBeBlockedMatch) {
    abilities.push({
      id: `${permanentId}-unblockable`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.UNBLOCKABLE,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
      },
      value: 'unblockable',
      layer: 6,
    });
  }
  
  // Check for land type granting: "Each other land is a [type] in addition to its other types"
  // Pattern: Yavimaya, Cradle of Growth - "Each other land is a Forest in addition to its other types."
  // Pattern: Urborg, Tomb of Yawgmoth - "Each land is a Swamp in addition to its other types."
  const landTypeGrantMatch = oracleText.match(/each\s+(other\s+)?land\s+is\s+(?:a\s+)?(\w+)\s+in\s+addition/i);
  if (landTypeGrantMatch) {
    abilities.push({
      id: `${permanentId}-add-land-type`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.ADD_LAND_TYPE,
      filter: {
        cardTypes: ['land'],
        other: !!landTypeGrantMatch[1], // "other" means exclude self
        controller: 'any', // Affects all lands on the battlefield
      },
      value: landTypeGrantMatch[2].toLowerCase(), // Normalize to lowercase for consistency
      layer: 4, // Layer 4: Type-changing effects
    });
  }
  
  // Check for "+1/+1 for each other [type]" patterns
  // Pattern: Squirrel Mob - "Squirrel Mob gets +1/+1 for each other Squirrel on the battlefield."
  const pumpPerTypeMatch = oracleText.match(/gets?\s+\+(\d+)\/\+(\d+)\s+for\s+each\s+(other\s+)?(\w+)/i);
  if (pumpPerTypeMatch) {
    abilities.push({
      id: `${permanentId}-pump-per-creature`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP_PER_CREATURE,
      filter: {
        cardTypes: ['creature'],
        selfOnly: true, // "gets" abilities only apply to self
      },
      powerMod: parseInt(pumpPerTypeMatch[1]),
      toughnessMod: parseInt(pumpPerTypeMatch[2]),
      countFilter: {
        types: [pumpPerTypeMatch[4].toLowerCase()], // Normalize to lowercase for consistency
        other: !!pumpPerTypeMatch[3], // Count "other" creatures
        controller: 'any', // Count all on battlefield
      },
      layer: 7, // Layer 7c: power/toughness changes
    });
  }
  
  // Check for "Commander you control gets +X/+Y" patterns (Bastion Protector)
  // Pattern: "Commander creatures you control get +2/+2 and have indestructible"
  const commanderPumpMatch = oracleText.match(/commander\s+(?:creatures?\s+)?(?:you\s+control\s+)?(?:gets?|has|have)\s+\+(\d+)\/\+(\d+)/i);
  if (commanderPumpMatch) {
    abilities.push({
      id: `${permanentId}-commander-pump`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
        // Mark this as a commander-only filter (needs special handling in matchesFilter)
        isCommander: true,
      } as any,
      powerMod: parseInt(commanderPumpMatch[1]),
      toughnessMod: parseInt(commanderPumpMatch[2]),
      layer: 7,
    });
  }
  
  // Check for "Commander you control has indestructible" (Bastion Protector)
  const commanderIndestructibleMatch = oracleText.match(/commander\s+(?:creatures?\s+)?(?:you\s+control\s+)?(?:has|have)\s+indestructible/i);
  if (commanderIndestructibleMatch) {
    abilities.push({
      id: `${permanentId}-commander-indestructible`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.GRANT_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
        isCommander: true,
      } as any,
      value: 'indestructible',
      layer: 6,
    });
  }
  
  // Check for "power is equal to number of [permanents]" patterns (Bronze Guardian)
  // Pattern: "~'s power is equal to the number of artifacts you control"
  const powerEqualMatch = oracleText.match(/(?:~'?s?|this creature'?s?)\s+power\s+is\s+equal\s+to\s+(?:the\s+)?number\s+of\s+(\w+)s?\s+you\s+control/i);
  if (powerEqualMatch) {
    abilities.push({
      id: `${permanentId}-power-equal-count`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP_PER_CREATURE,
      filter: {
        selfOnly: true, // Only applies to self
      },
      powerMod: 1, // +1 power per artifact
      toughnessMod: 0, // Toughness not affected
      countFilter: {
        types: [powerEqualMatch[1].toLowerCase()],
        other: false, // Count ALL including self
        controller: 'you',
      },
      layer: 7,
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
  
  // Check "selfOnly" (only applies to the source permanent)
  if (filter.selfOnly && permanent.id !== sourceId) {
    return false;
  }
  
  // Check "other" (exclude source)
  if (filter.other && permanent.id === sourceId) {
    return false;
  }
  
  // Check if this must be a commander (for Bastion Protector etc.)
  if ((filter as any).isCommander) {
    // Check if this permanent is marked as a commander
    const isCommander = (permanent as any).isCommander === true || 
                        (permanent as any).commander === true ||
                        (card as any).isCommander === true;
    if (!isCommander) return false;
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
  
  // Check for hasAbility filter (for Kwende-style "creatures with [ability] have [ability]")
  if (filter.hasAbility) {
    const oracleText = (card.oracle_text || '').toLowerCase();
    const keywords = (card as any).keywords || [];
    const grantedAbilities = (permanent as any).grantedAbilities || [];
    
    const abilityToCheck = filter.hasAbility.toLowerCase();
    
    // Check if the creature has the required ability:
    // 1. In keywords array from Scryfall
    // 2. In oracle text
    // 3. In granted abilities from other effects
    const hasAbilityInKeywords = keywords.some((k: string) => k.toLowerCase() === abilityToCheck);
    const hasAbilityInOracle = oracleText.includes(abilityToCheck);
    const hasAbilityGranted = grantedAbilities.some((a: string) => 
      typeof a === 'string' && a.toLowerCase().includes(abilityToCheck)
    );
    
    if (!hasAbilityInKeywords && !hasAbilityInOracle && !hasAbilityGranted) {
      return false;
    }
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
): { power: number; toughness: number; grantedAbilities: string[]; removedAbilities: string[] } {
  const card = permanent.card as KnownCardRef;
  if (!card) {
    return { power: 0, toughness: 0, grantedAbilities: [], removedAbilities: [] };
  }
  
  // Start with base P/T
  let power = parseInt(String(card.power || '0')) || 0;
  let toughness = parseInt(String(card.toughness || '0')) || 0;
  
  // Apply counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  power += plusCounters - minusCounters;
  toughness += plusCounters - minusCounters;
  
  // Collect granted and removed abilities
  const grantedAbilities: string[] = [];
  const removedAbilities: string[] = [];
  
  // Sort abilities by layer (Rule 613)
  const sortedAbilities = [...staticAbilities].sort((a, b) => a.layer - b.layer);
  
  // First pass: collect removed abilities (they take priority in preventing gains)
  for (const ability of sortedAbilities) {
    if (!matchesFilter(permanent, ability.filter, ability.sourceId, ability.controllerId)) {
      continue;
    }
    
    if (ability.effectType === StaticEffectType.REMOVE_ABILITY) {
      if (typeof ability.value === 'string' && !removedAbilities.includes(ability.value)) {
        removedAbilities.push(ability.value);
      }
    }
  }
  
  // Second pass: apply other static ability effects
  for (const ability of sortedAbilities) {
    if (!matchesFilter(permanent, ability.filter, ability.sourceId, ability.controllerId)) {
      continue;
    }
    
    switch (ability.effectType) {
      case StaticEffectType.PUMP:
        power += ability.powerMod || 0;
        toughness += ability.toughnessMod || 0;
        break;
        
      case StaticEffectType.PUMP_PER_CREATURE:
        // Count permanents matching countFilter and apply bonus per count
        if (ability.countFilter) {
          let count = 0;
          for (const perm of battlefield) {
            // Skip self if "other" is specified
            if (ability.countFilter.other && perm.id === permanent.id) {
              continue;
            }
            
            const permCard = perm.card as KnownCardRef;
            if (!permCard) continue;
            
            const permTypeLine = (permCard.type_line || '').toLowerCase();
            
            // Check controller filter
            if (ability.countFilter.controller === 'you' && perm.controller !== ability.controllerId) {
              continue;
            }
            if (ability.countFilter.controller === 'opponents' && perm.controller === ability.controllerId) {
              continue;
            }
            
            // Check type filter (supports both creature types and card types like "artifact")
            if (ability.countFilter.types && ability.countFilter.types.length > 0) {
              const hasType = ability.countFilter.types.some(t => 
                permTypeLine.includes(t.toLowerCase())
              );
              // Also check for changeling (for creature types)
              const isChangeling = (permCard.oracle_text || '').toLowerCase().includes('changeling');
              if (!hasType && !isChangeling) continue;
            }
            
            count++;
          }
          
          power += (ability.powerMod || 0) * count;
          toughness += (ability.toughnessMod || 0) * count;
        }
        break;
        
      case StaticEffectType.SET_PT:
        if (typeof ability.value === 'string' && ability.value.includes('/')) {
          const [p, t] = ability.value.split('/').map(v => parseInt(v));
          power = p;
          toughness = t;
        }
        break;
        
      case StaticEffectType.GRANT_ABILITY:
        if (typeof ability.value === 'string') {
          // Don't grant if the ability is being removed by another effect
          // (e.g., Archetype of Courage removes first strike from opponents)
          if (!removedAbilities.includes(ability.value) && !grantedAbilities.includes(ability.value)) {
            grantedAbilities.push(ability.value);
          }
        }
        break;
    }
  }
  
  return { power, toughness, grantedAbilities, removedAbilities };
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
 * This includes:
 * - Power/Toughness modifications from lords, anthems, etc.
 * - Granted abilities
 * - Static goad effects (Baeloth Barrityl - "Creatures your opponents control with power less than Baeloth's power are goaded")
 */
export function applyStaticAbilitiesToBattlefield(
  battlefield: BattlefieldPermanent[]
): BattlefieldPermanent[] {
  const staticAbilities = collectStaticAbilities(battlefield);
  
  // First pass: Calculate effective P/T for all creatures
  const withEffectivePT = battlefield.map(perm => {
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
  
  // Second pass: Apply static goad effects based on calculated powers
  // This handles cards like Baeloth Barrityl: "Creatures your opponents control with power less than Baeloth's power are goaded"
  const staticGoadSources = collectStaticGoadSources(withEffectivePT);
  
  if (staticGoadSources.length === 0) {
    return withEffectivePT;
  }
  
  return withEffectivePT.map(perm => {
    const card = perm.card as KnownCardRef;
    if (!card) return perm;
    
    const typeLine = (card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) {
      return perm;
    }
    
    // Check if this creature should be statically goaded by any source
    let isStaticallyGoaded = false;
    let goadedByStatic: string[] = [];
    
    for (const source of staticGoadSources) {
      // Static goad only applies to opponents' creatures
      if (perm.controller === source.controller) continue;
      
      // Check power condition (Baeloth: creatures with power less than Baeloth's power)
      if (source.requiresLowerPower) {
        const cardPower = card.power;
        const permPower = perm.effectivePower ?? (perm as any).basePower ?? 
                         (typeof cardPower === 'number' ? cardPower : parseInt(String(cardPower || '0'), 10));
        if (permPower < source.sourcePower) {
          isStaticallyGoaded = true;
          if (!goadedByStatic.includes(source.controller)) {
            goadedByStatic.push(source.controller);
          }
        }
      }
    }
    
    if (!isStaticallyGoaded) {
      return perm;
    }
    
    // Mark creature as statically goaded (this is a continuous effect, not an expiring one)
    // We set a special flag to indicate static goad vs triggered goad
    return {
      ...perm,
      isStaticallyGoaded: true,
      staticGoadedBy: goadedByStatic,
    } as BattlefieldPermanent;
  });
}

/**
 * Collect all permanents that create static goad effects
 * Examples:
 * - Baeloth Barrityl: "Creatures your opponents control with power less than Baeloth's power are goaded"
 */
interface StaticGoadSource {
  permanentId: string;
  controller: string;
  sourcePower: number;
  requiresLowerPower: boolean;
}

function collectStaticGoadSources(battlefield: BattlefieldPermanent[]): StaticGoadSource[] {
  const sources: StaticGoadSource[] = [];
  
  for (const perm of battlefield) {
    const card = perm.card as KnownCardRef;
    if (!card) continue;
    
    const oracleText = (card.oracle_text || '').toLowerCase();
    
    // Baeloth Barrityl pattern: "creatures your opponents control with power less than [cardname]'s power are goaded"
    // More specific pattern to avoid false matches
    if (oracleText.includes('creatures your opponents control') && 
        oracleText.includes('power less than') && 
        oracleText.includes('power are goaded')) {
      const cardPower = card.power;
      const sourcePower = perm.effectivePower ?? (perm as any).basePower ?? 
                         (typeof cardPower === 'number' ? cardPower : parseInt(String(cardPower || '0'), 10));
      sources.push({
        permanentId: perm.id,
        controller: perm.controller,
        sourcePower,
        requiresLowerPower: true,
      });
    }
  }
  
  return sources;
}

export default {
  parseStaticAbilities,
  matchesFilter,
  calculateEffectivePT,
  collectStaticAbilities,
  applyStaticAbilitiesToBattlefield,
};
