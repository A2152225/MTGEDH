/**
 * mana-abilities.ts
 * 
 * Handles mana ability modifications from static effects:
 * 
 * GRANTED ABILITIES:
 * - Chromatic Lantern: Lands have "{T}: Add any color"
 * - Cryptolith Rite: Creatures have "{T}: Add any color"
 * - Citanul Hierophants: Creatures have "{T}: Add {G}"
 * - Song of Freyalise: Creatures have "{T}: Add any color" (saga)
 * - Earthcraft: Untapped creatures can tap to untap lands
 * 
 * LAND TYPE MODIFIERS:
 * - Urborg, Tomb of Yawgmoth: All lands are Swamps (add {B})
 * - Yavimaya, Cradle of Growth: All lands are Forests (add {G})
 * - Prismatic Omen: Lands are all basic types (add any color)
 * - Blood Moon: Nonbasic lands are Mountains (only add {R})
 * - Magus of the Moon: Same as Blood Moon
 * 
 * MANA DOUBLING:
 * - Mana Reflection: Tapping for mana adds double
 * - Nyxbloom Ancient: Tapping for mana adds triple
 * - Zendikar Resurgent: Tapping lands adds extra mana
 * - Mirari's Wake: Lands add extra mana
 */

export interface ManaAbility {
  id: string;
  cost: string; // Usually "{T}" for tap
  produces: string[]; // Colors that can be produced: ['W','U','B','R','G'] or ['any']
  isGranted?: boolean; // True if granted by another permanent
  grantedBy?: string; // ID of permanent granting this ability
}

export interface ManaModifier {
  permanentId: string;
  cardName: string;
  type: 'grant_ability' | 'land_type' | 'mana_multiplier' | 'extra_mana';
  affects: 'lands' | 'creatures' | 'all_lands' | 'nonbasic_lands' | 'basic_lands' | 'specific';
  grantedAbility?: ManaAbility;
  landTypes?: string[]; // For land type modifiers
  multiplier?: number; // For mana doubling (2 = double, 3 = triple)
  extraMana?: { colors: string[]; amount: number }; // For "add one additional mana"
  overridesExisting?: boolean; // Blood Moon style - replaces other abilities
}

/**
 * Known mana modifier cards
 */
const KNOWN_MANA_MODIFIERS: Record<string, Omit<ManaModifier, 'permanentId' | 'cardName'>> = {
  // Grant "{T}: Add any color" to lands
  "chromatic lantern": {
    type: 'grant_ability',
    affects: 'lands',
    grantedAbility: { id: 'chromatic', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
  },
  
  // Grant "{T}: Add any color" to creatures
  "cryptolith rite": {
    type: 'grant_ability',
    affects: 'creatures',
    grantedAbility: { id: 'cryptolith', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
  },
  
  // Grant "{T}: Add {G}" to creatures
  "citanul hierophants": {
    type: 'grant_ability',
    affects: 'creatures',
    grantedAbility: { id: 'citanul', cost: '{T}', produces: ['G'] },
  },
  
  // All lands are Swamps (can tap for {B})
  "urborg, tomb of yawgmoth": {
    type: 'land_type',
    affects: 'all_lands',
    landTypes: ['swamp'],
    grantedAbility: { id: 'urborg', cost: '{T}', produces: ['B'] },
  },
  
  // All lands are Forests (can tap for {G})
  "yavimaya, cradle of growth": {
    type: 'land_type',
    affects: 'all_lands',
    landTypes: ['forest'],
    grantedAbility: { id: 'yavimaya', cost: '{T}', produces: ['G'] },
  },
  
  // Lands are all basic types
  "prismatic omen": {
    type: 'land_type',
    affects: 'lands',
    landTypes: ['plains', 'island', 'swamp', 'mountain', 'forest'],
    grantedAbility: { id: 'prismatic', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
  },
  
  // Nonbasic lands are Mountains (only {R})
  "blood moon": {
    type: 'land_type',
    affects: 'nonbasic_lands',
    landTypes: ['mountain'],
    grantedAbility: { id: 'bloodmoon', cost: '{T}', produces: ['R'] },
    overridesExisting: true,
  },
  
  // Same as Blood Moon
  "magus of the moon": {
    type: 'land_type',
    affects: 'nonbasic_lands',
    landTypes: ['mountain'],
    grantedAbility: { id: 'magus', cost: '{T}', produces: ['R'] },
    overridesExisting: true,
  },
  
  // Nonbasic lands are basic Plains (only {W})
  "celestial dawn": {
    type: 'land_type',
    affects: 'lands', // All your lands
    landTypes: ['plains'],
    grantedAbility: { id: 'celestial', cost: '{T}', produces: ['W'] },
    overridesExisting: true,
  },
  
  // Double mana from permanents
  "mana reflection": {
    type: 'mana_multiplier',
    affects: 'lands', // Actually all permanents
    multiplier: 2,
  },
  
  // Triple mana from permanents
  "nyxbloom ancient": {
    type: 'mana_multiplier',
    affects: 'lands', // Actually all permanents
    multiplier: 3,
  },
  
  // Lands produce extra mana
  "zendikar resurgent": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['same'], amount: 1 }, // Same color as produced
  },
  
  // Lands produce extra {W} or {G}
  "mirari's wake": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['same'], amount: 1 },
  },
  
  // Creatures tap for mana equal to power
  "selvala, heart of the wilds": {
    type: 'grant_ability',
    affects: 'specific', // Just Selvala herself
    grantedAbility: { id: 'selvala', cost: '{G}, {T}', produces: ['G'] }, // Actually adds G equal to power
  },
  
  // Elves tap for {G}
  "priest of titania": {
    type: 'grant_ability',
    affects: 'specific',
    grantedAbility: { id: 'priest', cost: '{T}', produces: ['G'] }, // Adds {G} for each Elf
  },
  
  // Tap any creature for mana of any color in its cost
  "bloom tender": {
    type: 'grant_ability',
    affects: 'specific',
    grantedAbility: { id: 'bloom', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] }, // Based on permanents
  },
};

/**
 * Detect mana modifiers from battlefield permanents
 */
export function detectManaModifiers(
  gameState: any,
  playerId: string
): ManaModifier[] {
  const modifiers: ManaModifier[] = [];
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    const controller = permanent.controller;
    
    // Check known cards
    for (const [knownName, modifierInfo] of Object.entries(KNOWN_MANA_MODIFIERS)) {
      if (cardName.includes(knownName)) {
        // Only apply if controller matches or it's a global effect
        const isGlobalEffect = modifierInfo.affects === 'all_lands' || 
                              modifierInfo.affects === 'nonbasic_lands';
        
        if (controller === playerId || isGlobalEffect) {
          modifiers.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || knownName,
            ...modifierInfo,
          });
        }
      }
    }
    
    // Generic detection for "lands you control have" patterns
    if (controller === playerId) {
      if (oracleText.includes("lands you control have") && oracleText.includes("add one mana of any color")) {
        if (!modifiers.some(m => m.permanentId === permanent.id)) {
          modifiers.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Unknown",
            type: 'grant_ability',
            affects: 'lands',
            grantedAbility: { id: `grant_${permanent.id}`, cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
          });
        }
      }
      
      if (oracleText.includes("creatures you control have") && oracleText.includes("add one mana")) {
        if (!modifiers.some(m => m.permanentId === permanent.id)) {
          modifiers.push({
            permanentId: permanent.id,
            cardName: permanent.card?.name || "Unknown",
            type: 'grant_ability',
            affects: 'creatures',
            grantedAbility: { id: `grant_${permanent.id}`, cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] },
          });
        }
      }
    }
  }
  
  return modifiers;
}

/**
 * Get all mana abilities for a permanent, including granted abilities
 */
export function getManaAbilitiesForPermanent(
  gameState: any,
  permanent: any,
  playerId: string
): ManaAbility[] {
  const abilities: ManaAbility[] = [];
  const card = permanent?.card;
  if (!card) return abilities;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  const isLand = typeLine.includes("land");
  const isCreature = typeLine.includes("creature");
  const isBasic = typeLine.includes("basic");
  
  // Check for Metalcraft requirement (e.g., Mox Opal)
  // Rule 702.80 - Metalcraft abilities only work if you control 3+ artifacts
  if (oracleText.includes('metalcraft')) {
    const battlefield = gameState?.battlefield || [];
    const artifactCount = battlefield.filter((p: any) => {
      if (p.controller !== playerId) return false;
      const permTypeLine = (p.card?.type_line || '').toLowerCase();
      return permTypeLine.includes('artifact');
    }).length;
    
    if (artifactCount < 3) {
      // Metalcraft is not active - return no mana abilities for this permanent
      // (or only colorless if the card has a non-metalcraft ability)
      console.log(`[getManaAbilitiesForPermanent] Metalcraft not active for ${card.name} (${artifactCount}/3 artifacts)`);
      return abilities; // Return empty - no mana abilities available
    }
  }
  
  // Get modifiers affecting this player
  const modifiers = detectManaModifiers(gameState, playerId);
  
  // Check for Blood Moon / Magus of the Moon first (overrides everything for nonbasics)
  const bloodMoonEffect = modifiers.find(m => 
    m.overridesExisting && 
    m.affects === 'nonbasic_lands' && 
    isLand && !isBasic
  );
  
  if (bloodMoonEffect && bloodMoonEffect.grantedAbility) {
    // Nonbasic lands become Mountains and lose other abilities
    return [{
      ...bloodMoonEffect.grantedAbility,
      isGranted: true,
      grantedBy: bloodMoonEffect.permanentId,
    }];
  }
  
  // Parse native mana abilities from oracle text
  // Basic lands
  if (isBasic || typeLine.includes("plains") || typeLine.includes("island") || 
      typeLine.includes("swamp") || typeLine.includes("mountain") || typeLine.includes("forest")) {
    if (typeLine.includes("plains") || oracleText.includes("add {w}")) {
      abilities.push({ id: 'native_w', cost: '{T}', produces: ['W'] });
    }
    if (typeLine.includes("island") || oracleText.includes("add {u}")) {
      abilities.push({ id: 'native_u', cost: '{T}', produces: ['U'] });
    }
    if (typeLine.includes("swamp") || oracleText.includes("add {b}")) {
      abilities.push({ id: 'native_b', cost: '{T}', produces: ['B'] });
    }
    if (typeLine.includes("mountain") || oracleText.includes("add {r}")) {
      abilities.push({ id: 'native_r', cost: '{T}', produces: ['R'] });
    }
    if (typeLine.includes("forest") || oracleText.includes("add {g}")) {
      abilities.push({ id: 'native_g', cost: '{T}', produces: ['G'] });
    }
  }
  
  // "Add one mana of any color" (like City of Brass, Mana Confluence, Command Tower)
  if (oracleText.includes("add one mana of any color") || oracleText.includes("add {c}")) {
    abilities.push({ id: 'native_any', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] });
  }
  
  // Colorless mana producers
  if (oracleText.includes("add {c}") || oracleText.includes("add one colorless")) {
    abilities.push({ id: 'native_c', cost: '{T}', produces: ['C'] });
  }
  
  // Apply granted abilities from modifiers
  for (const modifier of modifiers) {
    if (modifier.type === 'grant_ability' && modifier.grantedAbility) {
      const shouldApply = 
        (modifier.affects === 'lands' && isLand && permanent.controller === playerId) ||
        (modifier.affects === 'creatures' && isCreature && permanent.controller === playerId) ||
        (modifier.affects === 'all_lands' && isLand);
      
      if (shouldApply) {
        abilities.push({
          ...modifier.grantedAbility,
          isGranted: true,
          grantedBy: modifier.permanentId,
        });
      }
    }
    
    if (modifier.type === 'land_type' && isLand && modifier.grantedAbility) {
      const isNonbasic = !isBasic;
      const shouldApply = 
        modifier.affects === 'all_lands' ||
        (modifier.affects === 'nonbasic_lands' && isNonbasic) ||
        (modifier.affects === 'lands' && permanent.controller === playerId);
      
      if (shouldApply) {
        abilities.push({
          ...modifier.grantedAbility,
          isGranted: true,
          grantedBy: modifier.permanentId,
        });
      }
    }
  }
  
  // Deduplicate abilities by produced colors
  const uniqueAbilities: ManaAbility[] = [];
  const seenProductions = new Set<string>();
  
  for (const ability of abilities) {
    const key = ability.produces.sort().join(',');
    if (!seenProductions.has(key)) {
      seenProductions.add(key);
      uniqueAbilities.push(ability);
    }
  }
  
  return uniqueAbilities;
}

/**
 * Calculate mana multiplier for a permanent
 */
export function getManaMultiplier(
  gameState: any,
  permanent: any,
  playerId: string
): number {
  const modifiers = detectManaModifiers(gameState, playerId);
  let multiplier = 1;
  
  for (const modifier of modifiers) {
    if (modifier.type === 'mana_multiplier' && modifier.multiplier) {
      multiplier *= modifier.multiplier;
    }
  }
  
  return multiplier;
}

/**
 * Get extra mana produced when tapping a permanent
 */
export function getExtraManaProduction(
  gameState: any,
  permanent: any,
  playerId: string,
  producedColor: string
): { color: string; amount: number }[] {
  const modifiers = detectManaModifiers(gameState, playerId);
  const extra: { color: string; amount: number }[] = [];
  
  const typeLine = (permanent?.card?.type_line || "").toLowerCase();
  const isLand = typeLine.includes("land");
  
  for (const modifier of modifiers) {
    if (modifier.type === 'extra_mana' && modifier.extraMana) {
      const shouldApply = 
        (modifier.affects === 'lands' && isLand && permanent.controller === playerId);
      
      if (shouldApply) {
        const colors = modifier.extraMana.colors.includes('same') 
          ? [producedColor] 
          : modifier.extraMana.colors;
        
        for (const color of colors) {
          extra.push({ color, amount: modifier.extraMana.amount });
        }
      }
    }
  }
  
  return extra;
}
