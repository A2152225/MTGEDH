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
  requiresColorChoice?: boolean; // For Caged Sun - needs color selection at ETB
  landTypeRequired?: string; // Only applies to lands with this type (e.g., 'swamp' for Crypt Ghast)
  requiresImprintedLandType?: boolean; // For Extraplanar Lens
  affectsAllPlayers?: boolean; // For symmetric effects like Mana Flare
  untilEndOfTurn?: boolean; // For effects that only last until end of turn
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
  
  // Caged Sun - Whenever you tap a land for mana of the chosen color, add one additional mana of that color
  // Note: Caged Sun requires a color choice when it enters; we'll handle it with dynamic detection
  "caged sun": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['chosen'], amount: 1 }, // Chosen color
    requiresColorChoice: true,
  },
  
  // Gauntlet of Power - Same as Caged Sun but also affects basics that tap for the chosen color
  "gauntlet of power": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['chosen'], amount: 1 },
    requiresColorChoice: true,
  },
  
  // Gauntlet of Might - Red creatures get +1/+1, Mountains produce extra {R}
  "gauntlet of might": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['R'], amount: 1 },
    landTypeRequired: 'mountain',
  },
  
  // Extraplanar Lens - When tapping an imprinted land type, add one mana of any type that land could produce
  "extraplanar lens": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['same'], amount: 1 },
    requiresImprintedLandType: true,
  },
  
  // Nirkana Revenant - Swamps produce extra {B}
  "nirkana revenant": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['B'], amount: 1 },
    landTypeRequired: 'swamp',
  },
  
  // Crypt Ghast - Swamps produce extra {B}
  "crypt ghast": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['B'], amount: 1 },
    landTypeRequired: 'swamp',
  },
  
  // Vorinclex, Voice of Hunger - Lands produce double mana
  "vorinclex, voice of hunger": {
    type: 'mana_multiplier',
    affects: 'lands',
    multiplier: 2,
  },
  
  // High Tide - Islands produce extra {U} (until end of turn, but we treat it as continuous for simplicity)
  "high tide": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['U'], amount: 1 },
    landTypeRequired: 'island',
    untilEndOfTurn: true,
  },
  
  // Bubbling Muck - Swamps produce extra {B} (until end of turn)
  "bubbling muck": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['B'], amount: 1 },
    landTypeRequired: 'swamp',
    untilEndOfTurn: true,
  },
  
  // Heartbeat of Spring - All lands produce extra mana (affects all players)
  "heartbeat of spring": {
    type: 'extra_mana',
    affects: 'all_lands',
    extraMana: { colors: ['same'], amount: 1 },
    affectsAllPlayers: true,
  },
  
  // Mana Flare - All lands produce extra mana (affects all players)
  "mana flare": {
    type: 'extra_mana',
    affects: 'all_lands',
    extraMana: { colors: ['same'], amount: 1 },
    affectsAllPlayers: true,
  },
  
  // Dictate of Karametra - All lands produce extra mana (affects all players)
  "dictate of karametra": {
    type: 'extra_mana',
    affects: 'all_lands',
    extraMana: { colors: ['same'], amount: 1 },
    affectsAllPlayers: true,
  },
  
  // Keeper of Progenitus - Lands that could produce {R}, {G}, or {W} produce extra
  "keeper of progenitus": {
    type: 'extra_mana',
    affects: 'all_lands',
    extraMana: { colors: ['R', 'G', 'W'], amount: 1 },
    affectsAllPlayers: true,
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
  // Only match if this is a tap ability for lands or it's explicitly a mana ability
  if (isLand && oracleText.includes("{t}:") && oracleText.includes("add one mana of any color")) {
    abilities.push({ id: 'native_any', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] });
  }
  
  // Colorless mana producers (lands with explicit colorless production)
  if (isLand && oracleText.match(/\{t\}:\s*add\s*\{c\}/i)) {
    abilities.push({ id: 'native_c', cost: '{T}', produces: ['C'] });
  }
  
  // Check for creatures/artifacts with explicit tap-for-mana abilities in oracle text
  // Pattern: "{T}: Add {X}" where X is a mana symbol
  // This handles creatures like Llanowar Elves, Birds of Paradise, mana rocks, etc.
  // IMPORTANT: Only detect mana abilities if the ability is a simple "{T}: Add" pattern
  // Avoid false positives for cards with complex abilities that happen to include "add" text
  
  // List of card patterns that should NOT be considered mana producers
  const nonManaProducerPatterns = [
    'draw', 'search', 'look at', 'reveal', 'exile', 'put a', 'create', 'target', 
    'counter', 'destroy', 'return', 'mill', 'scry', 'surveil',
    'sacrifice', 'discard', 'copy', 'choose', 'gain', 'lose', 'prevent',
    'deals', 'damage', 'life', 'graveyard', 'library', 'hand'
  ];
  
  // Check if this is a mana-producing tap ability (not a utility ability)
  const hasManaProducingTapAbility = (text: string): boolean => {
    // Look for pattern: "{t}: add" at the start of a sentence/ability
    // Should match: "{t}: add {g}", "{t}: add one mana of any color"
    // Should NOT match: "{t}: look at the top card...add it to your hand"
    // Should NOT match: "{2}, {t}: search your library..."
    // Should NOT match: "add a +1/+1 counter"
    
    // First check: does the text contain "{t}:" followed shortly by "add {" or "add one mana"?
    // This is a simple heuristic that works for most mana-producing abilities
    
    // Pattern for simple mana abilities: {T}: Add {X} or {T}: Add one mana
    const simpleManaPattern = /\{t\}:\s*add\s*(?:\{[wubrgc]\}|one\s+mana)/i;
    if (!simpleManaPattern.test(text)) {
      return false;
    }
    
    // Find all "{t}:" abilities and verify they're mana-producing
    const tapAbilityMatches = text.match(/\{t\}:\s*[^.\n]+/gi);
    if (!tapAbilityMatches) return false;
    
    for (const ability of tapAbilityMatches) {
      const abilityLower = ability.toLowerCase();
      
      // Check if this specific ability is a mana ability
      if (abilityLower.match(/\{t\}:\s*add\s*\{[wubrgc]\}/i) ||
          abilityLower.match(/\{t\}:\s*add\s+one\s+mana/i)) {
        
        // Verify it's not a complex ability by checking the text after "add"
        const afterAdd = abilityLower.split(/add\s*/i)[1] || '';
        const first50Chars = afterAdd.substring(0, 50);
        
        // If the text after "add" contains non-mana patterns, skip this ability
        const hasNonManaPattern = nonManaProducerPatterns.some(pattern => 
          first50Chars.includes(pattern)
        );
        
        // Also check for "add a" or "add X" patterns that aren't mana
        // e.g., "add a +1/+1 counter" or "add it to your hand"
        const isNonManaAdd = /^(?:a\s+(?:\+|counter|card)|it\s+to|them?\s+to)/i.test(afterAdd.trim());
        
        if (!hasNonManaPattern && !isNonManaAdd) {
          return true;
        }
      }
    }
    return false;
  };
  
  if (!isLand && oracleText.includes("{t}:") && hasManaProducingTapAbility(oracleText)) {
    // Check for each colored mana - more strict matching
    if (oracleText.match(/\{t\}:\s*add\s*\{w\}/i)) {
      abilities.push({ id: 'native_w', cost: '{T}', produces: ['W'] });
    }
    if (oracleText.match(/\{t\}:\s*add\s*\{u\}/i)) {
      abilities.push({ id: 'native_u', cost: '{T}', produces: ['U'] });
    }
    if (oracleText.match(/\{t\}:\s*add\s*\{b\}/i)) {
      abilities.push({ id: 'native_b', cost: '{T}', produces: ['B'] });
    }
    if (oracleText.match(/\{t\}:\s*add\s*\{r\}/i)) {
      abilities.push({ id: 'native_r', cost: '{T}', produces: ['R'] });
    }
    if (oracleText.match(/\{t\}:\s*add\s*\{g\}/i)) {
      abilities.push({ id: 'native_g', cost: '{T}', produces: ['G'] });
    }
    // Check for colorless mana
    if (oracleText.match(/\{t\}:\s*add\s*\{c\}/i)) {
      abilities.push({ id: 'native_c', cost: '{T}', produces: ['C'] });
    }
    // Check for "any color" mana (Birds of Paradise, etc.)
    if (oracleText.match(/\{t\}:\s*add\s+one\s+mana\s+of\s+any\s+color/i)) {
      abilities.push({ id: 'native_any', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] });
    }
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

// ============================================================================
// Devotion-Based Mana Abilities
// ============================================================================

/**
 * Known cards with devotion-based mana abilities
 */
const KNOWN_DEVOTION_MANA_CARDS: Record<string, { 
  color: 'W' | 'U' | 'B' | 'R' | 'G';
  producedColor: string;
  minDevotion?: number;
}> = {
  "karametra's acolyte": { color: 'G', producedColor: 'G' },
  "nykthos, shrine to nyx": { color: 'W', producedColor: 'any' }, // Actually needs color choice
  "nyx lotus": { color: 'W', producedColor: 'any', minDevotion: 0 }, // Taps for devotion to chosen color
  "altar of the pantheon": { color: 'W', producedColor: 'any', minDevotion: 0 }, // Add one of any color, +1 devotion
  "crypt ghast": { color: 'B', producedColor: 'B' }, // Actually doubles swamp mana, not devotion
};

/**
 * Calculate devotion to a specific color
 * Devotion = count of mana symbols of that color in mana costs of permanents you control
 */
export function calculateDevotion(
  gameState: any,
  playerId: string,
  color: 'W' | 'U' | 'B' | 'R' | 'G'
): number {
  const battlefield = gameState?.battlefield || [];
  let devotion = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const manaCost = permanent.card?.mana_cost || "";
    
    // Count occurrences of the color symbol
    // Format: {W}, {U}, {B}, {R}, {G}
    // Also count hybrid: {W/U}, {W/B}, etc. and Phyrexian: {W/P}
    const colorSymbol = color;
    
    // Count regular mana symbols: {W}, {U}, etc.
    const singleColorRegex = new RegExp(`\\{${colorSymbol}\\}`, 'gi');
    const singleMatches = manaCost.match(singleColorRegex) || [];
    devotion += singleMatches.length;
    
    // Count hybrid mana symbols: {W/U}, {R/G}, etc. - each counts as 1 devotion to BOTH colors
    const hybridRegex = new RegExp(`\\{${colorSymbol}\\/[WUBRGP]\\}|\\{[WUBRG]\\/${colorSymbol}\\}`, 'gi');
    const hybridMatches = manaCost.match(hybridRegex) || [];
    devotion += hybridMatches.length;
    
    // Count 2-brid symbols: {2/W} etc.
    const twobrideRegex = new RegExp(`\\{2\\/${colorSymbol}\\}`, 'gi');
    const twobrideMatches = manaCost.match(twobrideRegex) || [];
    devotion += twobrideMatches.length;
  }
  
  return devotion;
}

/**
 * Check if a permanent has a devotion-based mana ability
 * Returns the amount of mana it would produce if activated
 */
export function getDevotionManaAmount(
  gameState: any,
  permanent: any,
  playerId: string
): { color: string; amount: number } | null {
  const cardName = (permanent?.card?.name || "").toLowerCase();
  const oracleText = (permanent?.card?.oracle_text || "").toLowerCase();
  
  // Check known devotion mana cards
  for (const [knownName, info] of Object.entries(KNOWN_DEVOTION_MANA_CARDS)) {
    if (cardName.includes(knownName)) {
      const devotion = calculateDevotion(gameState, playerId, info.color);
      return {
        color: info.producedColor,
        amount: Math.max(info.minDevotion ?? 1, devotion),
      };
    }
  }
  
  // Dynamic detection: "Add an amount of {G} equal to your devotion to green"
  const devotionManaMatch = oracleText.match(
    /add (?:an amount of )?(\{[wubrgc]\})(?:[^.]*?)equal to your devotion to (\w+)/i
  );
  
  if (devotionManaMatch) {
    const manaSymbol = devotionManaMatch[1].toUpperCase();
    const colorName = devotionManaMatch[2].toLowerCase();
    
    let colorCode: 'W' | 'U' | 'B' | 'R' | 'G' = 'G';
    switch (colorName) {
      case 'white': colorCode = 'W'; break;
      case 'blue': colorCode = 'U'; break;
      case 'black': colorCode = 'B'; break;
      case 'red': colorCode = 'R'; break;
      case 'green': colorCode = 'G'; break;
    }
    
    const devotion = calculateDevotion(gameState, playerId, colorCode);
    const producedColor = manaSymbol.replace(/[{}]/g, '');
    
    return {
      color: producedColor,
      amount: Math.max(1, devotion), // Always at least 1
    };
  }
  
  return null;
}

/**
 * Check if a permanent has a creature-count-based mana ability
 * (Priest of Titania, Elvish Archdruid, etc.)
 */
export function getCreatureCountManaAmount(
  gameState: any,
  permanent: any,
  playerId: string
): { color: string; amount: number } | null {
  const cardName = (permanent?.card?.name || "").toLowerCase();
  const oracleText = (permanent?.card?.oracle_text || "").toLowerCase();
  
  // Priest of Titania: "Add {G} for each Elf on the battlefield"
  if (cardName.includes("priest of titania")) {
    const battlefield = gameState?.battlefield || [];
    const elfCount = battlefield.filter((p: any) => {
      if (!p) return false;
      const typeLine = (p.card?.type_line || "").toLowerCase();
      const creatureTypes = (p.card?.type_line || "").split("—")[1] || "";
      return typeLine.includes("creature") && 
             (creatureTypes.toLowerCase().includes("elf") || typeLine.includes("elf"));
    }).length;
    
    return { color: 'G', amount: Math.max(1, elfCount) };
  }
  
  // Elvish Archdruid: "Add {G} for each Elf you control"
  if (cardName.includes("elvish archdruid")) {
    const battlefield = gameState?.battlefield || [];
    const elfCount = battlefield.filter((p: any) => {
      if (!p || p.controller !== playerId) return false;
      const typeLine = (p.card?.type_line || "").toLowerCase();
      const creatureTypes = (p.card?.type_line || "").split("—")[1] || "";
      return typeLine.includes("creature") && 
             (creatureTypes.toLowerCase().includes("elf") || typeLine.includes("elf"));
    }).length;
    
    return { color: 'G', amount: Math.max(1, elfCount) };
  }
  
  // Gaea's Cradle: Add {G} for each creature you control
  if (cardName.includes("gaea's cradle") || cardName.includes("cradle of growth")) {
    const battlefield = gameState?.battlefield || [];
    const creatureCount = battlefield.filter((p: any) => {
      if (!p || p.controller !== playerId) return false;
      const typeLine = (p.card?.type_line || "").toLowerCase();
      return typeLine.includes("creature");
    }).length;
    
    return { color: 'G', amount: Math.max(0, creatureCount) };
  }
  
  // Serra's Sanctum: Add {W} for each enchantment you control
  if (cardName.includes("serra's sanctum")) {
    const battlefield = gameState?.battlefield || [];
    const enchantmentCount = battlefield.filter((p: any) => {
      if (!p || p.controller !== playerId) return false;
      const typeLine = (p.card?.type_line || "").toLowerCase();
      return typeLine.includes("enchantment");
    }).length;
    
    return { color: 'W', amount: Math.max(0, enchantmentCount) };
  }
  
  // Tolarian Academy: Add {U} for each artifact you control
  if (cardName.includes("tolarian academy")) {
    const battlefield = gameState?.battlefield || [];
    const artifactCount = battlefield.filter((p: any) => {
      if (!p || p.controller !== playerId) return false;
      const typeLine = (p.card?.type_line || "").toLowerCase();
      return typeLine.includes("artifact");
    }).length;
    
    return { color: 'U', amount: Math.max(0, artifactCount) };
  }
  
  // Dynamic detection: "Add {X} for each Y you control"
  const countManaMatch = oracleText.match(
    /add\s+\{([wubrgc])\}\s+for each\s+(\w+)(?:\s+(?:you control|on the battlefield))?/i
  );
  
  if (countManaMatch) {
    const manaColor = countManaMatch[1].toUpperCase();
    const permanentType = countManaMatch[2].toLowerCase();
    
    const battlefield = gameState?.battlefield || [];
    const matchingCount = battlefield.filter((p: any) => {
      if (!p) return false;
      // Check if "you control" is in the text
      const youControl = oracleText.includes("you control");
      if (youControl && p.controller !== playerId) return false;
      
      const typeLine = (p.card?.type_line || "").toLowerCase();
      const creatureTypes = (p.card?.type_line || "").split("—")[1] || "";
      
      // Match by type or creature subtype
      return typeLine.includes(permanentType) || 
             creatureTypes.toLowerCase().includes(permanentType);
    }).length;
    
    return { color: manaColor, amount: Math.max(0, matchingCount) };
  }
  
  return null;
}
