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

/**
 * Calculate effective power for a permanent (including counters, modifiers, etc.)
 * This is a simplified version for use in mana ability calculations
 */
function getEffectivePowerForMana(permanent: any): number {
  // Use pre-calculated effectivePower if available
  if (typeof permanent.effectivePower === 'number') {
    return permanent.effectivePower;
  }
  
  const card = permanent.card;
  let basePower = permanent.basePower ?? (parseInt(String(card?.power ?? '0'), 10) || 0);
  
  // Handle star (*) power - use basePower if set (should be calculated by game state)
  if (typeof card?.power === 'string' && card.power.includes('*')) {
    if (typeof permanent.basePower === 'number') {
      basePower = permanent.basePower;
    }
  }
  
  // Add +1/+1 counters
  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  const counterDelta = plusCounters - minusCounters;
  
  // Check for other counter types that affect power (+1/+0, +2/+2, etc.)
  let otherCounterPower = 0;
  if (permanent.counters) {
    for (const [counterType, count] of Object.entries(permanent.counters)) {
      if (counterType === '+1/+1' || counterType === '-1/-1') continue;
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        const pMod = parseInt(counterMatch[1], 10);
        otherCounterPower += pMod * (count as number);
      }
    }
  }
  
  // Add modifiers from equipment, auras, anthems, lords, etc.
  let modifierPower = 0;
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
        modifierPower += mod.power || 0;
      }
    }
  }
  
  return Math.max(0, basePower + counterDelta + otherCounterPower + modifierPower);
}


export interface ManaAbility {
  id: string;
  cost: string; // Usually "{T}" for tap
  produces: string[]; // Colors that can be produced: ['W','U','B','R','G'] or ['any']
  producesAllAtOnce?: boolean; // True for lands like Rakdos Carnarium that produce {B}{R} (both, not choice)
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
  
  // Triple mana from BASIC lands only
  "virtue of strength": {
    type: 'mana_multiplier',
    affects: 'basic_lands', // Only basic lands
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
  
  // Nissa, Who Shakes the World - Forests produce extra {G}
  // "Whenever you tap a Forest for mana, add an additional {G}."
  "nissa, who shakes the world": {
    type: 'extra_mana',
    affects: 'lands',
    extraMana: { colors: ['G'], amount: 1 },
    landTypeRequired: 'forest',
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
  const isPlaneswalker = typeLine.includes("planeswalker");
  
  // IMPORTANT: Planeswalkers should NEVER have tap abilities for mana
  // Even if their text mentions "{T}: Add {G}" (e.g., when creating tokens with that ability)
  if (isPlaneswalker) {
    return abilities; // Return empty - planeswalkers don't tap for mana
  }
  
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
  
  // ========================================================================
  // Check for multi-mana producers (bounce lands like Rakdos Carnarium)
  // Pattern: "{T}: Add {X}{Y}" where X and Y are different colored mana symbols
  // These lands produce BOTH colors at once (not a choice)
  // ========================================================================
  if (isLand) {
    // Pattern to match "{t}: add {X}{Y}" with two different colored mana symbols
    const multiManaMatch = oracleText.match(/\{t\}:\s*add\s+(\{[wubrgc]\}\{[wubrgc]\})/i);
    if (multiManaMatch) {
      const manaSymbols = multiManaMatch[1].match(/\{([wubrgc])\}/gi) || [];
      const colors: string[] = [];
      for (const sym of manaSymbols) {
        const color = sym.replace(/[{}]/g, '').toUpperCase();
        if (!colors.includes(color)) {
          colors.push(color);
        }
      }
      // Check if this produces multiple different colors (like {B}{R})
      // vs. the same color twice (like {C}{C})
      if (colors.length > 1) {
        // Multi-color producer like Rakdos Carnarium - produces both at once
        abilities.push({ 
          id: 'native_multi', 
          cost: '{T}', 
          produces: colors,
          producesAllAtOnce: true // Both colors are added, not a choice
        });
      } else if (colors.length === 1 && manaSymbols.length === 2) {
        // Same color twice (like Sol Ring {C}{C}) - handled elsewhere
        // This case is handled by the fixed multi-mana pattern
      }
    }
    
    // ========================================================================
    // Check for tri-lands and dual lands with "or" format (choice of colors)
    // Pattern: "{T}: Add {X}, {Y}, or {Z}" - tri-lands like Jungle Shrine
    // Pattern: "{T}: Add {X} or {Y}" - filter/pain lands
    // These lands produce ONE color of your choice (not all at once)
    // ========================================================================
    
    // Tri-land pattern: "{t}: add {X}, {Y}, or {Z}" (e.g., Jungle Shrine)
    const triLandMatch = oracleText.match(/\{t\}:\s*add\s+\{([wubrgc])\},\s*\{([wubrgc])\},\s*or\s+\{([wubrgc])\}/i);
    if (triLandMatch) {
      const colors = [
        triLandMatch[1].toUpperCase(),
        triLandMatch[2].toUpperCase(),
        triLandMatch[3].toUpperCase()
      ];
      // Tri-land - offers a choice of 3 colors
      abilities.push({
        id: 'native_choice_3',
        cost: '{T}',
        produces: colors,
        producesAllAtOnce: false // Choice, not all at once
      });
    }
    
    // Dual land "or" pattern: "{t}: add {X} or {Y}" (filter/pain lands)
    const dualOrMatch = oracleText.match(/\{t\}:\s*add\s+\{([wubrgc])\}\s+or\s+\{([wubrgc])\}/i);
    if (dualOrMatch) {
      const colors = [
        dualOrMatch[1].toUpperCase(),
        dualOrMatch[2].toUpperCase()
      ];
      // Only add if not already covered by another pattern
      if (!abilities.some(a => a.produces.length >= 2 && !a.producesAllAtOnce)) {
        abilities.push({
          id: 'native_choice_2',
          cost: '{T}',
          produces: colors,
          producesAllAtOnce: false // Choice, not all at once
        });
      }
    }
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
    // Look for pattern: "{t}: add {X}" or "{t}: add one mana" or "{t}: add X mana"
    // Should match: "{t}: add {g}", "{t}: add one mana of any color", "{t}: add {c}{c}"
    // Should match: "{t}: add an amount of {g}" (Bighorner Rancher pattern)
    // Should NOT match: "{t}: look at the top card...add it to your hand"
    // Should NOT match: "{2}, {t}: search your library..."
    // Should NOT match: "add a +1/+1 counter", "in addition to"
    // Should NOT match: "create a token with...{t}: add {g}" (token creation)
    
    // Pattern for mana abilities - must have "{t}:" followed by "add" and then a mana indicator
    const manaPatterns = [
      /\{t\}:\s*add\s+\{[wubrgc]\}/i,              // {t}: add {G}
      /\{t\}:\s*add\s+\{[wubrgc]\}\{[wubrgc]\}/i,  // {t}: add {C}{C}
      /\{t\}:\s*add\s+one\s+mana/i,                // {t}: add one mana of any color
      /\{t\}:\s*add\s+\w+\s+mana/i,                // {t}: add X mana, add two mana, etc.
      /\{t\}:\s*add\s+an\s+amount\s+of\s+\{[wubrgc]\}/i, // {t}: add an amount of {G} (Bighorner Rancher)
      /\{t\},\s*sacrifice[^:]*:\s*add\s+/i,        // {t}, sacrifice: add (treasure-like)
    ];
    
    for (const pattern of manaPatterns) {
      if (pattern.test(text)) {
        // Additional check: make sure this isn't part of a "create" clause
        // Find the match position
        const match = text.match(pattern);
        if (match && match.index !== undefined) {
          // Look backwards from the match to see if "create" appears nearby
          const beforeMatch = text.substring(Math.max(0, match.index - 100), match.index);
          if (beforeMatch.includes('create')) {
            // This is likely a token creation ability, not the permanent's own ability
            continue;
          }
        }
        return true;
      }
    }
    
    return false;
  };
  
  if (!isLand && oracleText.includes("{t}:") && hasManaProducingTapAbility(oracleText)) {
    // IMPORTANT: Skip cards with "add an amount of", "add X mana in any combination"
    // or other variable/scaling patterns - those are handled by getDevotionManaAmount 
    // or getCreatureCountManaAmount functions
    const hasScalingManaAbility = 
      oracleText.includes("add an amount of") ||
      oracleText.includes("add x mana") ||
      oracleText.includes("mana in any combination") ||
      oracleText.includes("equal to your devotion") ||
      oracleText.includes("equal to the greatest power") ||
      oracleText.includes("for each");
    
    if (!hasScalingManaAbility) {
      // Check for each colored mana - simple fixed-amount abilities only
      if (oracleText.match(/\{t\}:\s*add\s+\{w\}/i)) {
        abilities.push({ id: 'native_w', cost: '{T}', produces: ['W'] });
      }
      if (oracleText.match(/\{t\}:\s*add\s+\{u\}/i)) {
        abilities.push({ id: 'native_u', cost: '{T}', produces: ['U'] });
      }
      if (oracleText.match(/\{t\}:\s*add\s+\{b\}/i)) {
        abilities.push({ id: 'native_b', cost: '{T}', produces: ['B'] });
      }
      if (oracleText.match(/\{t\}:\s*add\s+\{r\}/i)) {
        abilities.push({ id: 'native_r', cost: '{T}', produces: ['R'] });
      }
      if (oracleText.match(/\{t\}:\s*add\s+\{g\}/i)) {
        abilities.push({ id: 'native_g', cost: '{T}', produces: ['G'] });
      }
      // Check for colorless mana
      if (oracleText.match(/\{t\}:\s*add\s*\{c\}/i)) {
        abilities.push({ id: 'native_c', cost: '{T}', produces: ['C'] });
      }
      // Check for "any color" mana (Birds of Paradise, etc.) - but not variable amounts
      if (oracleText.match(/\{t\}:\s*add\s+one\s+mana\s+of\s+any\s+color/i)) {
        abilities.push({ id: 'native_any', cost: '{T}', produces: ['W', 'U', 'B', 'R', 'G'] });
      }
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
 * Handles effects like:
 * - Nissa, Who Shakes the World (Forests produce extra {G})
 * - Crypt Ghast (Swamps produce extra {B})
 * - Zendikar Resurgent (Lands produce extra mana of same color)
 * - Caged Sun (Lands produce extra mana of chosen color)
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
  
  // Check if land has specific land types (for Nissa, Crypt Ghast, etc.)
  const hasForest = typeLine.includes("forest");
  const hasSwamp = typeLine.includes("swamp");
  const hasIsland = typeLine.includes("island");
  const hasMountain = typeLine.includes("mountain");
  const hasPlains = typeLine.includes("plains");
  
  // Build a map of land types for the permanent
  const landTypes = new Set<string>();
  if (hasForest) landTypes.add('forest');
  if (hasSwamp) landTypes.add('swamp');
  if (hasIsland) landTypes.add('island');
  if (hasMountain) landTypes.add('mountain');
  if (hasPlains) landTypes.add('plains');
  
  for (const modifier of modifiers) {
    if (modifier.type === 'extra_mana' && modifier.extraMana) {
      // Check basic applicability
      let shouldApply = false;
      
      if (modifier.affects === 'lands' && isLand && permanent.controller === playerId) {
        // Check if there's a land type requirement
        if (modifier.landTypeRequired) {
          // Only apply if the land has the required type
          shouldApply = landTypes.has(modifier.landTypeRequired);
        } else {
          // No type requirement - applies to all lands
          shouldApply = true;
        }
      } else if (modifier.affects === 'all_lands' && isLand) {
        // Global effect (like Mana Flare) - applies to all lands
        if (modifier.landTypeRequired) {
          shouldApply = landTypes.has(modifier.landTypeRequired);
        } else {
          shouldApply = true;
        }
      }
      
      if (shouldApply) {
        // Determine what color mana to add
        let colorsToAdd: string[] = [];
        
        if (modifier.extraMana.colors.includes('same')) {
          // Add same color as produced
          colorsToAdd = [producedColor];
        } else if (modifier.extraMana.colors.includes('chosen')) {
          // Caged Sun / Gauntlet of Power - requires a chosen color
          // Find the modifier's permanent to get its chosen color
          const modifierPerm = gameState?.battlefield?.find((p: any) => p.id === modifier.permanentId);
          const chosenColor = modifierPerm?.chosenColor;
          
          if (chosenColor && producedColor === chosenColor) {
            colorsToAdd = [chosenColor];
          }
        } else {
          // Specific colors (like 'B' for Crypt Ghast)
          colorsToAdd = modifier.extraMana.colors;
        }
        
        for (const color of colorsToAdd) {
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
  // Note: Nykthos and Nyx Lotus require color choice - the 'color' field here is a placeholder
  // In practice, these cards need UI interaction to choose which color devotion to count
  "nykthos, shrine to nyx": { color: 'G', producedColor: 'any' }, // Placeholder - needs color choice
  "nyx lotus": { color: 'G', producedColor: 'any', minDevotion: 0 }, // Placeholder - needs color choice
  "altar of the pantheon": { color: 'G', producedColor: 'any', minDevotion: 0 }, // Add one of any color, +1 devotion
  // Note: Crypt Ghast is NOT a devotion card - it doubles swamp mana via extort-style effect
  // It's already handled in the extra mana section, not here
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
  
  const devotedPermanents: string[] = [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const manaCost = permanent.card?.mana_cost || "";
    
    // Count occurrences of the color symbol
    // Format: {W}, {U}, {B}, {R}, {G}
    // Also count hybrid: {W/U}, {W/B}, etc. and Phyrexian: {W/P}
    const colorSymbol = color;
    
    let permDevotion = 0;
    
    // Count regular mana symbols: {W}, {U}, etc.
    const singleColorRegex = new RegExp(`\\{${colorSymbol}\\}`, 'gi');
    const singleMatches = manaCost.match(singleColorRegex) || [];
    permDevotion += singleMatches.length;
    
    // Count hybrid mana symbols: {W/U}, {R/G}, etc. - each counts as 1 devotion to BOTH colors
    const hybridRegex = new RegExp(`\\{${colorSymbol}\\/[WUBRGP]\\}|\\{[WUBRG]\\/${colorSymbol}\\}`, 'gi');
    const hybridMatches = manaCost.match(hybridRegex) || [];
    permDevotion += hybridMatches.length;
    
    // Count 2-brid symbols: {2/W} etc.
    const twobrideRegex = new RegExp(`\\{2\\/${colorSymbol}\\}`, 'gi');
    const twobrideMatches = manaCost.match(twobrideRegex) || [];
    permDevotion += twobrideMatches.length;
    
    if (permDevotion > 0) {
      devotedPermanents.push(`${permanent.card?.name || 'Unknown'} (${permDevotion})`);
    }
    devotion += permDevotion;
  }
  
  if (color === 'G') {
    console.log(`[calculateDevotion] Green devotion for ${playerId}:`, {
      totalDevotion: devotion,
      permanents: devotedPermanents,
      battlefieldCount: battlefield.filter((p: any) => p?.controller === playerId).length,
    });
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
  
  console.log(`[getDevotionManaAmount] Checking ${cardName}:`, {
    hasKarametra: cardName.includes("karametra"),
    hasAcolyte: cardName.includes("acolyte"),
    fullCardName: cardName,
  });
  
  // Check known devotion mana cards
  for (const [knownName, info] of Object.entries(KNOWN_DEVOTION_MANA_CARDS)) {
    if (cardName.includes(knownName)) {
      const devotion = calculateDevotion(gameState, playerId, info.color);
      console.log(`[getDevotionManaAmount] Matched ${knownName}, devotion=${devotion}`);
      // Devotion-based mana abilities produce 0 if devotion is 0
      // minDevotion is only used for special cases, default is 0
      return {
        color: info.producedColor,
        amount: Math.max(info.minDevotion ?? 0, devotion),
      };
    }
  }
  
  console.log(`[getDevotionManaAmount] No match in KNOWN_DEVOTION_MANA_CARDS, trying dynamic detection`);
  
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
    
    // Devotion-based mana abilities produce 0 if devotion is 0
    return {
      color: producedColor,
      amount: devotion,
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
    
    // Can produce 0 mana if no Elves on battlefield
    return { color: 'G', amount: elfCount };
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
    
    // Can produce 0 mana if no Elves you control
    return { color: 'G', amount: elfCount };
  }
  
  // Gaea's Cradle: Add {G} for each creature you control
  if (cardName.includes("gaea's cradle") || cardName.includes("cradle of growth")) {
    const battlefield = gameState?.battlefield || [];
    const creatureCount = battlefield.filter((p: any) => {
      if (!p || p.controller !== playerId) return false;
      const typeLine = (p.card?.type_line || "").toLowerCase();
      return typeLine.includes("creature");
    }).length;
    
    return { color: 'G', amount: creatureCount };
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
  
  // ==========================================================================
  // Generic "Add an amount of {X} equal to..." pattern
  // Full list from Scryfall search (oracle:"add an amount"):
  // - Alena, Kessig Trapper: greatest power among creatures that entered this turn
  // - Bighorner Rancher: greatest power among creatures you control
  // - Cradle Clearcutter: this creature's power
  // - Energy Tap: target creature's mana value
  // - Fire Lord Ozai: sacrificed creature's power
  // - Furgul, Quag Nurturer: sacrificed creature's power
  // - Illuminor Szeras: sacrificed creature's mana value
  // - Karametra's Acolyte: devotion to green
  // - Kyren Toy: X plus one (charge counters)
  // - Mana Drain: spell's mana value
  // - Mana Echoes: creatures that share a type
  // - Marwyn, the Nurturer: Marwyn's power
  // - Nykthos, Shrine to Nyx: devotion to chosen color
  // - Nyx Lotus: devotion to chosen color
  // - Priest of Yawgmoth: sacrificed artifact's mana value
  // - Pygmy Hippo: mana from opponent's lands
  // - Rainveil Rejuvenator: this creature's power
  // - Rotating Fireplace: time counters
  // - Sacrifice: sacrificed creature's mana value
  // - Scattering Stroke: spell's mana value
  // - Slobad, Iron Goblin: sacrificed artifact's mana value
  // - Soldevi Adnate: sacrificed creature's mana value
  // - Tanuki Transplanter: equipped creature's power
  // - Three Tree City: creatures of chosen type
  // - Vhal, Candlekeep Researcher: Vhal's toughness
  // - Viridian Joiner: this creature's power
  // ==========================================================================
  
  const amountOfMatch = oracleText.match(
    /add\s+an\s+amount\s+of\s+\{([wubrgc])\}\s+equal\s+to\s+(.+?)(?:\.|,|$)/i
  );
  
  if (amountOfMatch) {
    const manaColor = amountOfMatch[1].toUpperCase();
    const condition = amountOfMatch[2].toLowerCase().trim();
    const battlefield = gameState?.battlefield || [];
    
    let amount = 0;
    
    // ========== POWER-BASED ==========
    
    // "the greatest power among creatures you control" (Bighorner Rancher)
    // "the greatest power among creatures you control that entered this turn" (Alena)
    if (condition.includes('greatest power') && condition.includes('creature')) {
      for (const p of battlefield) {
        if (!p || p.controller !== playerId) continue;
        const typeLine = (p.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;
        
        // If "entered this turn" check for that flag
        if (condition.includes('entered this turn') && !p.enteredThisTurn) continue;
        
        const power = getEffectivePowerForMana(p);
        if (power > amount) {
          amount = power;
        }
      }
    }
    // "this creature's power" or "its power" (Viridian Joiner, Cradle Clearcutter, Rainveil)
    else if (condition.includes("this creature's power") || 
             condition.includes('its power')) {
      amount = getEffectivePowerForMana(permanent);
    }
    // "Marwyn's power" or "[CardName]'s power" pattern
    else if (condition.match(/\w+'s\s+power/)) {
      amount = getEffectivePowerForMana(permanent);
    }
    // "the sacrificed creature's power" (Fire Lord Ozai, Furgul)
    else if (condition.includes('sacrificed creature') && condition.includes('power')) {
      // This needs context from the sacrifice action - default to 0
      // The actual amount should be calculated when the sacrifice happens
      amount = 0;
    }
    
    // ========== TOUGHNESS-BASED ==========
    
    // "Vhal's toughness" or "[CardName]'s toughness"
    else if (condition.match(/\w+'s\s+toughness/) || condition.includes('its toughness')) {
      const toughness = permanent?.baseToughness ?? permanent?.card?.toughness ?? 0;
      amount = typeof toughness === 'string' ? parseInt(toughness, 10) || 0 : toughness;
    }
    
    // ========== MANA VALUE / CMC BASED ==========
    
    // "that creature's mana value" or "sacrificed creature's mana value" (Energy Tap, Soldevi Adnate)
    else if (condition.includes('mana value') || condition.includes('converted mana cost')) {
      // This needs context from what was targeted/sacrificed
      // For self-referencing, use the permanent's own mana value
      if (condition.includes('this') || condition.includes('its')) {
        amount = permanent?.card?.cmc ?? 0;
      } else {
        // For targeted/sacrificed, this needs special handling
        amount = 0;
      }
    }
    
    // ========== DEVOTION-BASED ==========
    
    // "your devotion to green" (Karametra's Acolyte)
    // Note: Nykthos and Nyx Lotus use "that color" which needs UI choice
    else if (condition.includes('devotion to')) {
      let devotionColor: 'W' | 'U' | 'B' | 'R' | 'G' = 'G';
      if (condition.includes('white')) devotionColor = 'W';
      else if (condition.includes('blue')) devotionColor = 'U';
      else if (condition.includes('black')) devotionColor = 'B';
      else if (condition.includes('red')) devotionColor = 'R';
      else if (condition.includes('green')) devotionColor = 'G';
      
      amount = calculateDevotion(gameState, playerId, devotionColor);
    }
    
    // ========== COUNTER-BASED ==========
    
    // "X plus one" where X is charge counters (Kyren Toy)
    else if (condition.includes('plus one') || condition.includes('+ 1')) {
      const counters = permanent?.counters || {};
      const chargeCounters = counters['charge'] || 0;
      amount = chargeCounters + 1;
    }
    // "time counters on this artifact" (Rotating Fireplace)
    else if (condition.includes('time counter')) {
      const counters = permanent?.counters || {};
      amount = counters['time'] || 0;
    }
    // Generic "+1/+1 counters on it"
    else if (condition.includes('+1/+1 counter')) {
      const counters = permanent?.counters || {};
      amount = counters['+1/+1'] || counters['p1p1'] || counters['plus1plus1'] || 0;
    }
    
    // ========== CREATURE TYPE COUNT ==========
    
    // "number of creatures you control that share a creature type with it" (Mana Echoes)
    else if (condition.includes('share a creature type') || condition.includes('share creature type')) {
      // This needs context from the entering creature - complex to calculate
      amount = 1; // Default to 1 for the entering creature itself
    }
    // "creatures you control of the chosen type" (Three Tree City)
    else if (condition.includes('of the chosen type') || condition.includes('chosen type')) {
      // This needs to track the chosen type - for now estimate
      amount = battlefield.filter((p: any) => {
        if (!p || p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || "").toLowerCase();
        return typeLine.includes("creature");
      }).length;
    }
    
    // ========== COUNT-BASED (PERMANENTS) ==========
    
    // "the number of creatures you control"
    else if (condition.includes('creatures you control') || condition.includes('number of creatures')) {
      amount = battlefield.filter((p: any) => {
        if (!p || p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || "").toLowerCase();
        return typeLine.includes("creature");
      }).length;
    }
    // "the number of Elves you control"
    else if (condition.includes('elf') || condition.includes('elves')) {
      amount = battlefield.filter((p: any) => {
        if (!p || p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || "").toLowerCase();
        const subTypes = (p.card?.type_line || "").split("—")[1] || "";
        return typeLine.includes("elf") || subTypes.toLowerCase().includes("elf");
      }).length;
    }
    // "the number of lands you control"
    else if (condition.includes('lands')) {
      amount = battlefield.filter((p: any) => {
        if (!p || p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || "").toLowerCase();
        return typeLine.includes("land");
      }).length;
    }
    // "the number of artifacts you control"
    else if (condition.includes('artifacts')) {
      amount = battlefield.filter((p: any) => {
        if (!p || p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || "").toLowerCase();
        return typeLine.includes("artifact");
      }).length;
    }
    // "the number of enchantments you control"
    else if (condition.includes('enchantments')) {
      amount = battlefield.filter((p: any) => {
        if (!p || p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || "").toLowerCase();
        return typeLine.includes("enchantment");
      }).length;
    }
    
    // ========== CARDS IN ZONES ==========
    
    // "the number of cards in your hand"
    else if (condition.includes('cards in your hand') || condition.includes('cards in hand')) {
      const zones = gameState?.zones?.[playerId];
      amount = zones?.hand?.length || 0;
    }
    // "the number of cards in your graveyard"
    else if (condition.includes('graveyard')) {
      const zones = gameState?.zones?.[playerId];
      amount = zones?.graveyard?.length || 0;
    }
    
    // ========== LIFE TOTALS ==========
    
    // "your life total"
    else if (condition.includes('life total')) {
      amount = gameState?.life?.[playerId] || 0;
    }
    
    // ========== GENERIC FALLBACK ==========
    else {
      // Log for debugging unknown patterns
      console.log(`[getCreatureCountManaAmount] Unknown "add an amount of" condition: "${condition}"`);
      amount = 1; // Default to 1 if we can't determine the amount
    }
    
    return { color: manaColor, amount: Math.max(0, amount) };
  }
  
  // ==========================================================================
  // Selvala pattern: "Add X mana in any combination of colors"
  // Pattern: "{G}, {T}: Add X mana in any combination of colors, where X is the greatest power among creatures you control."
  // Also handles: "mana in any combination of colors" patterns
  // Cards: Selvala Heart of the Wilds, Nykthos, Nyx Lotus, etc.
  // ==========================================================================
  
  // Pattern 1: "Add X mana in any combination of colors, where X is..."
  const anyCombinationMatch = oracleText.match(
    /add\s+(?:x|an amount of)?\s*mana\s+in\s+any\s+combination\s+of\s+colors[^.]*(?:where\s+x\s+is\s+)?(.+?)(?:\.|$)/i
  );
  
  if (anyCombinationMatch) {
    const condition = anyCombinationMatch[1].toLowerCase().trim();
    const battlefield = gameState?.battlefield || [];
    let amount = 0;
    
    // "the greatest power among creatures you control" (Selvala, Heart of the Wilds)
    if (condition.includes('greatest power') && condition.includes('creature')) {
      for (const p of battlefield) {
        if (!p || p.controller !== playerId) continue;
        const typeLine = (p.card?.type_line || "").toLowerCase();
        if (!typeLine.includes("creature")) continue;
        
        const power = getEffectivePowerForMana(p);
        if (power > amount) {
          amount = power;
        }
      }
    }
    // "your devotion to that color" (Nykthos, Nyx Lotus)
    else if (condition.includes('devotion')) {
      // This requires color choice - return a marker for the UI
      // The actual devotion will be calculated when the player chooses a color
      amount = 0; // Will be calculated dynamically
    }
    // "the number of creatures you control" 
    else if (condition.includes('creature') && condition.includes('control')) {
      amount = battlefield.filter((p: any) => 
        p?.controller === playerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      ).length;
    }
    
    // Return 'any_combination' to indicate player can choose any combination of colors
    return { color: 'any_combination', amount: Math.max(0, amount) };
  }
  
  // Pattern 2: "Add X mana in any combination of colors" (Gwenna, Eyes of Gaea)
  // OR "mana in any combination of {W}, {U}, {B}, {R}, and/or {G}"
  // For cards that produce specific colors in any combination
  
  // First check for generic "any combination of colors" pattern
  const genericCombinationMatch = oracleText.match(
    /add\s+(one|two|three|four|\d+)\s+mana\s+in\s+any\s+combination\s+of\s+colors/i
  );
  
  if (genericCombinationMatch) {
    const amountWord = genericCombinationMatch[1].toLowerCase();
    const wordToNumber: Record<string, number> = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
    };
    const amount = wordToNumber[amountWord] || parseInt(amountWord, 10) || 1;
    
    // Return 'any_combination' for all five colors
    return { 
      color: 'any_combination', 
      amount: Math.max(0, amount) 
    };
  }
  
  // Check for specific color combination pattern
  const specificCombinationMatch = oracleText.match(
    /mana\s+in\s+any\s+combination\s+of\s+(\{[wubrg]\}(?:\s*,?\s*(?:and\/or)?\s*\{[wubrg]\})*)/i
  );
  
  if (specificCombinationMatch) {
    // Extract which colors are available
    const colorMatches = specificCombinationMatch[1].match(/\{([wubrg])\}/gi) || [];
    const availableColors = colorMatches.map(c => c.replace(/[{}]/g, '').toUpperCase());
    
    // Look for the amount
    const amountMatch = oracleText.match(/add\s+(\d+|one|two|three)\s+mana/i);
    let amount = 1;
    if (amountMatch) {
      const amountWord = amountMatch[1].toLowerCase();
      const wordToNumber: Record<string, number> = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
      };
      amount = wordToNumber[amountWord] || parseInt(amountMatch[1], 10) || 1;
    }
    
    return { 
      color: `combination:${availableColors.join(',')}`, 
      amount: Math.max(0, amount) 
    };
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
