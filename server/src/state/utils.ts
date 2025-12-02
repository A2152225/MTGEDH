export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Parse power/toughness values from card data.
 * Handles numeric values, "*", and expressions like "*+1" or "1+*".
 * For pure "*" values, returns undefined (caller should use calculateVariablePT).
 */
export function parsePT(raw?: string | number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  
  // If already a number, return it
  if (typeof raw === 'number') return raw;
  
  const str = String(raw).trim();
  
  // Pure numeric
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  
  // Handle X (typically 0 unless otherwise specified)
  if (str.toLowerCase() === 'x') return 0;
  
  // Pure * - caller needs to use calculateVariablePT
  if (str === '*') return undefined;
  
  // Handle expressions like *+1, 1+*, etc. - return undefined for now
  if (str.includes('*')) return undefined;
  
  return undefined;
}

/**
 * Calculate the effective P/T for creatures with variable (star slash star) power/toughness.
 * This implements the characteristic-defining abilities from card text.
 * 
 * Note: This is only for true variable P/T creatures like Tarmogoyf or Nighthowler.
 * Cards with fixed P/T (like Morophon 6/6) should have their values parsed normally.
 * 
 * Examples:
 * - Tarmogoyf: Count card types in all graveyards
 * - Nighthowler: Count creatures in graveyards
 * - Consuming Aberration: Count cards in opponents' graveyards
 * 
 * @param card - The card data with oracle_text and type information
 * @param gameState - Optional game state for dynamic calculations
 * @returns { power, toughness } or undefined if not calculable
 */
export function calculateVariablePT(
  card: any,
  gameState?: any
): { power: number; toughness: number } | undefined {
  if (!card) return undefined;
  
  const name = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  
  // Marit Lage token - Defined as 20/20
  if (name.includes('marit lage')) {
    return { power: 20, toughness: 20 };
  }
  
  // Check oracle text for common patterns
  
  // "where X is" patterns - e.g., "power and toughness are each equal to"
  if (oracleText.includes('power and toughness are each equal to')) {
    // Common patterns:
    
    // "number of creatures you control"
    if (oracleText.includes('number of creatures you control')) {
      // Dynamic - would need battlefield state
      if (gameState?.battlefield) {
        const controllerId = card.controller;
        const creatures = gameState.battlefield.filter((p: any) => 
          p.controller === controllerId && 
          (p.card?.type_line || '').toLowerCase().includes('creature')
        );
        return { power: creatures.length, toughness: creatures.length };
      }
      return { power: 0, toughness: 0 }; // Default for unknown state
    }
    
    // "cards in your hand"
    if (oracleText.includes('cards in your hand')) {
      // Dynamic - need zone state to calculate
      if (gameState?.zones) {
        const controllerId = card.controller;
        if (controllerId && gameState.zones[controllerId]) {
          const playerZones = gameState.zones[controllerId];
          // Try handCount first (most reliable), then fall back to hand array length
          const handSize = typeof playerZones.handCount === 'number' 
            ? playerZones.handCount 
            : (Array.isArray(playerZones.hand) ? playerZones.hand.length : 0);
          return { power: handSize, toughness: handSize };
        }
      }
      return { power: 0, toughness: 0 }; // Default for unknown state
    }
    
    // "lands you control"
    if (oracleText.includes('lands you control')) {
      if (gameState?.battlefield) {
        const controllerId = card.controller;
        const lands = gameState.battlefield.filter((p: any) => 
          p.controller === controllerId && 
          (p.card?.type_line || '').toLowerCase().includes('land')
        );
        return { power: lands.length, toughness: lands.length };
      }
      return { power: 0, toughness: 0 };
    }
  }
  
  // For cards we can't calculate, check if there's a defined base in reminder text
  // Some cards define their size like "(This creature has base power 6/6)"
  const sizeMatch = oracleText.match(/base power and toughness (\d+)\/(\d+)/i);
  if (sizeMatch) {
    return { power: parseInt(sizeMatch[1], 10), toughness: parseInt(sizeMatch[2], 10) };
  }
  
  // Default fallback - return undefined so caller knows we couldn't calculate
  return undefined;
}

/**
 * Known equipment and aura power/toughness bonuses
 * Maps card name (lowercase) to { power, toughness } bonus
 */
const EQUIPMENT_BONUSES: Record<string, { power: number; toughness: number }> = {
  // Swords of X and Y - all give +2/+2
  "sword of fire and ice": { power: 2, toughness: 2 },
  "sword of feast and famine": { power: 2, toughness: 2 },
  "sword of light and shadow": { power: 2, toughness: 2 },
  "sword of war and peace": { power: 2, toughness: 2 },
  "sword of body and mind": { power: 2, toughness: 2 },
  "sword of truth and justice": { power: 2, toughness: 2 },
  "sword of sinew and steel": { power: 2, toughness: 2 },
  "sword of hearth and home": { power: 2, toughness: 2 },
  "sword of once and future": { power: 2, toughness: 2 },
  "sword of forge and frontier": { power: 2, toughness: 2 },
  
  // Common equipments
  "loxodon warhammer": { power: 3, toughness: 0 },
  "umezawa's jitte": { power: 0, toughness: 0 }, // Counters-based, handled separately
  "skullclamp": { power: 1, toughness: -1 },
  "lightning greaves": { power: 0, toughness: 0 },
  "swiftfoot boots": { power: 0, toughness: 0 },
  "whispersilk cloak": { power: 0, toughness: 0 },
  "champion's helm": { power: 2, toughness: 2 },
  "batterskull": { power: 4, toughness: 4 },
  "colossus hammer": { power: 10, toughness: 10 },
  "embercleave": { power: 1, toughness: 1 }, // Also gives double strike
  "shadowspear": { power: 1, toughness: 1 },
  "mask of memory": { power: 0, toughness: 0 },
  "bonesplitter": { power: 2, toughness: 0 },
  "basilisk collar": { power: 0, toughness: 0 },
  "grafted exoskeleton": { power: 2, toughness: 2 },
  "nim deathmantle": { power: 2, toughness: 2 },
  "sword of vengeance": { power: 2, toughness: 0 },
  "argentum armor": { power: 6, toughness: 6 },
  "kaldra compleat": { power: 5, toughness: 5 },
  "vorpal sword": { power: 2, toughness: 0 },
  "manriki-gusari": { power: 1, toughness: 2 },
  "plate armor": { power: 3, toughness: 3 },
  "o-naginata": { power: 3, toughness: 0 },
  "gorgon flail": { power: 1, toughness: 1 },
  "behemoth sledge": { power: 2, toughness: 2 },
  "hexplate wallbreaker": { power: 2, toughness: 2 },
  "bloodforged battle-axe": { power: 2, toughness: 0 },
  "dowsing dagger": { power: 2, toughness: 1 },
  "hammer of nazahn": { power: 2, toughness: 0 },
  "dead-iron sledge": { power: 2, toughness: 0 },
  "commander's plate": { power: 3, toughness: 3 },
  "kaldra's shield": { power: 0, toughness: 4 },
  "heartseeker": { power: 2, toughness: 0 },
  "maul of the skyclaves": { power: 2, toughness: 2 },
  "lizard blades": { power: 1, toughness: 1 },
  "simian sling": { power: 1, toughness: 1 },
  "rabbit battery": { power: 1, toughness: 1 },
};

/**
 * Known aura enchantments that give power/toughness bonuses
 * Maps card name (lowercase) to { power, toughness } bonus
 */
const AURA_BONUSES: Record<string, { power: number; toughness: number }> = {
  // Common auras
  "rancor": { power: 2, toughness: 0 },
  "ethereal armor": { power: 0, toughness: 0 }, // Variable +1/+1 per enchantment
  "ancestral mask": { power: 0, toughness: 0 }, // Variable +2/+2 per enchantment
  "holy strength": { power: 1, toughness: 2 },
  "unholy strength": { power: 2, toughness: 1 },
  "armadillo cloak": { power: 2, toughness: 2 },
  "unflinching courage": { power: 2, toughness: 2 },
  "eldrazi conscription": { power: 10, toughness: 10 },
  "daybreak coronet": { power: 3, toughness: 3 },
  "bear umbra": { power: 2, toughness: 2 },
  "snake umbra": { power: 1, toughness: 1 },
  "spider umbra": { power: 1, toughness: 1 },
  "hyena umbra": { power: 1, toughness: 1 },
  "mammoth umbra": { power: 3, toughness: 3 },
  "eel umbra": { power: 1, toughness: 1 },
  "boar umbra": { power: 3, toughness: 3 },
  "griffin guide": { power: 2, toughness: 2 },
  "spirit link": { power: 0, toughness: 0 },
  "spirit mantle": { power: 1, toughness: 1 },
  "gift of orzhova": { power: 1, toughness: 1 },
  "angelic destiny": { power: 4, toughness: 4 },
  "battle mastery": { power: 0, toughness: 0 }, // Double strike only
  "aqueous form": { power: 0, toughness: 0 },
  "curiosity": { power: 0, toughness: 0 },
  "keen sense": { power: 0, toughness: 0 },
  "shielded by faith": { power: 0, toughness: 0 },
  "spectra ward": { power: 2, toughness: 2 },
  "all that glitters": { power: 0, toughness: 0 }, // Variable
  "on serra's wings": { power: 1, toughness: 1 },
  "cartouche of strength": { power: 1, toughness: 1 },
  "cartouche of solidarity": { power: 1, toughness: 1 },
  "cartouche of knowledge": { power: 1, toughness: 1 },
  "cartouche of zeal": { power: 1, toughness: 1 },
  "cartouche of ambition": { power: 1, toughness: 1 },
  "sage's reverie": { power: 0, toughness: 0 }, // Variable
  "sigarda's aid": { power: 0, toughness: 0 },
  "flickering ward": { power: 0, toughness: 0 },
  "conviction": { power: 1, toughness: 3 },
  "sentinel's eyes": { power: 1, toughness: 1 },
  "setessan training": { power: 1, toughness: 0 },
  "solid footing": { power: 1, toughness: 1 },
  "warbriar blessing": { power: 0, toughness: 2 },
  "hydra's growth": { power: 0, toughness: 0 }, // Doubles +1/+1 counters
  "phyresis": { power: 0, toughness: 0 },
  "felidar umbra": { power: 1, toughness: 1 },
  "dueling rapier": { power: 2, toughness: 0 },
  "mirror shield": { power: 0, toughness: 2 },
  "mantle of the wolf": { power: 4, toughness: 4 },
  "kenrith's transformation": { power: 0, toughness: 0 }, // Sets to 3/3
  "frogify": { power: 0, toughness: 0 }, // Sets to 1/1
  "kasmina's transmutation": { power: 0, toughness: 0 }, // Sets to 1/1
  "lignify": { power: 0, toughness: 0 }, // Sets to 0/4
  "darksteel mutation": { power: 0, toughness: 0 }, // Sets to 0/1
  "imprisoned in the moon": { power: 0, toughness: 0 }, // Removes creature type
  "song of the dryads": { power: 0, toughness: 0 }, // Removes creature type
};

/**
 * Known global enchantments that give bonuses to creatures
 * Maps card name (lowercase) to a function that calculates the bonus
 */
const GLOBAL_ENCHANTMENT_BONUSES: Record<string, {
  power: number;
  toughness: number;
  condition?: (creature: any, controller: string) => boolean;
}> = {
  "glorious anthem": { power: 1, toughness: 1 },
  "honor of the pure": { power: 1, toughness: 1, condition: (c) => (c.card?.colors || []).includes('W') || (c.card?.type_line || '').toLowerCase().includes('white') },
  "crusade": { power: 1, toughness: 1, condition: (c) => (c.card?.colors || []).includes('W') },
  "bad moon": { power: 1, toughness: 1, condition: (c) => (c.card?.colors || []).includes('B') },
  "gaea's anthem": { power: 1, toughness: 1 },
  "dictate of heliod": { power: 2, toughness: 2 },
  "intangible virtue": { power: 1, toughness: 1, condition: (c) => (c.card?.type_line || '').toLowerCase().includes('token') || c.isToken },
  "force of virtue": { power: 1, toughness: 1 },
  "always watching": { power: 1, toughness: 1, condition: (c) => !(c.card?.type_line || '').toLowerCase().includes('token') && !c.isToken },
  "spear of heliod": { power: 1, toughness: 1 },
  "marshal's anthem": { power: 1, toughness: 1 },
  "collective blessing": { power: 3, toughness: 3 },
  "cathars' crusade": { power: 0, toughness: 0 }, // Handled via counters
  "shared animosity": { power: 0, toughness: 0 }, // Variable
  "true conviction": { power: 0, toughness: 0 }, // No P/T bonus, just keywords
};

/**
 * Known lord creatures that give bonuses to other creatures
 * Maps card name (lowercase) to bonus info
 */
const LORD_BONUSES: Record<string, {
  power: number;
  toughness: number;
  creatureType?: string;
  condition?: (creature: any, lord: any) => boolean;
}> = {
  "lord of atlantis": { power: 1, toughness: 1, creatureType: "merfolk" },
  "goblin king": { power: 1, toughness: 1, creatureType: "goblin" },
  "zombie master": { power: 0, toughness: 0, creatureType: "zombie" }, // Grants abilities, no P/T
  "elvish archdruid": { power: 1, toughness: 1, creatureType: "elf" },
  "elvish champion": { power: 1, toughness: 1, creatureType: "elf" },
  "lord of the unreal": { power: 1, toughness: 1, creatureType: "illusion" },
  "death baron": { power: 1, toughness: 1, condition: (c) => {
    const typeLine = (c.card?.type_line || '').toLowerCase();
    return typeLine.includes('skeleton') || typeLine.includes('zombie');
  }},
  "captivating vampire": { power: 1, toughness: 1, creatureType: "vampire" },
  "lord of the accursed": { power: 1, toughness: 1, creatureType: "zombie" },
  "merrow reejerey": { power: 1, toughness: 1, creatureType: "merfolk" },
  "goblin chieftain": { power: 1, toughness: 1, creatureType: "goblin" },
  "imperious perfect": { power: 1, toughness: 1, creatureType: "elf" },
  "drogskol captain": { power: 1, toughness: 1, creatureType: "spirit" },
  "stromkirk captain": { power: 1, toughness: 1, creatureType: "vampire" },
  "diregraf captain": { power: 1, toughness: 1, creatureType: "zombie" },
  "immerwolf": { power: 1, toughness: 1, creatureType: "wolf" },
  "mayor of avabruck": { power: 1, toughness: 1, creatureType: "human" },
  "angel of jubilation": { power: 1, toughness: 1, condition: (c) => !(c.card?.colors || []).includes('B') },
  "mikaeus, the unhallowed": { power: 1, toughness: 1, condition: (c) => !(c.card?.type_line || '').toLowerCase().includes('human') },
  "oona's blackguard": { power: 1, toughness: 1, creatureType: "rogue" },
  "sliver legion": { power: 0, toughness: 0, creatureType: "sliver" }, // Variable per sliver
  "coat of arms": { power: 0, toughness: 0 }, // Variable
};

/**
 * Calculate all P/T bonuses for a creature from ALL sources
 * 
 * @param creaturePerm - The creature permanent
 * @param gameState - Full game state including battlefield, zones, etc.
 * @returns { power, toughness } total bonus from all sources
 */
export function calculateAllPTBonuses(
  creaturePerm: any,
  gameState: any
): { power: number; toughness: number } {
  let powerBonus = 0;
  let toughnessBonus = 0;
  
  if (!creaturePerm || !gameState) {
    return { power: 0, toughness: 0 };
  }
  
  const battlefield = gameState.battlefield || [];
  const controllerId = creaturePerm.controller;
  const creatureTypeLine = (creaturePerm.card?.type_line || '').toLowerCase();
  
  // 1. Equipment and Aura bonuses (attached to this creature)
  const equipBonus = calculateEquipmentBonus(creaturePerm, battlefield);
  powerBonus += equipBonus.power;
  toughnessBonus += equipBonus.toughness;
  
  // 2. Global enchantment bonuses
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    const typeLine = (perm.card.type_line || '').toLowerCase();
    
    // Only check enchantments controlled by the same player (most anthem effects)
    if (!typeLine.includes('enchantment')) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const enchantBonus = GLOBAL_ENCHANTMENT_BONUSES[cardName];
    
    if (enchantBonus && perm.controller === controllerId) {
      // Check condition if any
      if (!enchantBonus.condition || enchantBonus.condition(creaturePerm, controllerId)) {
        powerBonus += enchantBonus.power;
        toughnessBonus += enchantBonus.toughness;
      }
    }
    
    // Parse generic "creatures you control get +X/+Y" from oracle text
    if (perm.controller === controllerId) {
      const oracleText = perm.card.oracle_text || '';
      const anthemMatch = oracleText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
      if (anthemMatch && !enchantBonus) { // Don't double count known enchantments
        powerBonus += parseInt(anthemMatch[1], 10);
        toughnessBonus += parseInt(anthemMatch[2], 10);
      }
    }
  }
  
  // 3. Lord/tribal bonuses from other creatures
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.id === creaturePerm.id) continue; // Can't buff itself (usually)
    if (perm.controller !== controllerId) continue; // Lords usually only buff your creatures
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const lordBonus = LORD_BONUSES[cardName];
    
    if (lordBonus) {
      // Check if creature matches the lord's creature type requirement
      if (lordBonus.creatureType) {
        if (creatureTypeLine.includes(lordBonus.creatureType)) {
          powerBonus += lordBonus.power;
          toughnessBonus += lordBonus.toughness;
        }
      } else if (lordBonus.condition) {
        if (lordBonus.condition(creaturePerm, perm)) {
          powerBonus += lordBonus.power;
          toughnessBonus += lordBonus.toughness;
        }
      }
    }
    
    // Parse generic "other [type] creatures you control get +X/+Y" from oracle text
    const oracleText = perm.card.oracle_text || '';
    const lordMatch = oracleText.match(/other (\w+) creatures you control get \+(\d+)\/\+(\d+)/i);
    if (lordMatch && !lordBonus) { // Don't double count known lords
      const targetType = lordMatch[1].toLowerCase();
      if (creatureTypeLine.includes(targetType)) {
        powerBonus += parseInt(lordMatch[2], 10);
        toughnessBonus += parseInt(lordMatch[3], 10);
      }
    }
    
    // "Other creatures you control get +X/+Y" (no type restriction)
    const genericLordMatch = oracleText.match(/other creatures you control get \+(\d+)\/\+(\d+)/i);
    if (genericLordMatch && !lordBonus) {
      powerBonus += parseInt(genericLordMatch[1], 10);
      toughnessBonus += parseInt(genericLordMatch[2], 10);
    }
  }
  
  // 4. Artifact bonuses (non-equipment)
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.controller !== controllerId) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('artifact') || typeLine.includes('equipment')) continue;
    
    const oracleText = perm.card.oracle_text || '';
    
    // Artifacts that give creatures bonuses
    const artifactAnthemMatch = oracleText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (artifactAnthemMatch) {
      powerBonus += parseInt(artifactAnthemMatch[1], 10);
      toughnessBonus += parseInt(artifactAnthemMatch[2], 10);
    }
  }
  
  // 5. Temporary pump effects (from modifiers) - includes Giant Growth, etc.
  // These are spells/abilities that give +X/+Y until end of turn
  if (creaturePerm.modifiers && Array.isArray(creaturePerm.modifiers)) {
    for (const mod of creaturePerm.modifiers) {
      if (mod.type === 'pump' || mod.type === 'PUMP' || 
          mod.type === 'ptBoost' || mod.type === 'PT_BOOST' ||
          mod.type === 'temporary_pump' || mod.type === 'TEMPORARY_PUMP' ||
          mod.type === 'giantGrowth' || mod.type === 'GIANT_GROWTH') {
        powerBonus += mod.power || mod.powerBonus || 0;
        toughnessBonus += mod.toughness || mod.toughnessBonus || 0;
      }
    }
  }
  
  // 6. Pump effects array (alternative storage for temporary buffs)
  if (creaturePerm.pumpEffects && Array.isArray(creaturePerm.pumpEffects)) {
    for (const pump of creaturePerm.pumpEffects) {
      powerBonus += pump.power || pump.powerBonus || 0;
      toughnessBonus += pump.toughness || pump.toughnessBonus || 0;
    }
  }
  
  // 7. Temporary boost fields (used by some effects like Giant Growth)
  if (typeof creaturePerm.temporaryPowerBoost === 'number') {
    powerBonus += creaturePerm.temporaryPowerBoost;
  }
  if (typeof creaturePerm.temporaryToughnessBoost === 'number') {
    toughnessBonus += creaturePerm.temporaryToughnessBoost;
  }
  
  // 8. Power/toughness boosts stored directly
  if (typeof creaturePerm.powerBoost === 'number') {
    powerBonus += creaturePerm.powerBoost;
  }
  if (typeof creaturePerm.toughnessBoost === 'number') {
    toughnessBonus += creaturePerm.toughnessBoost;
  }
  
  // 9. Emblem effects
  const emblems = gameState.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== controllerId) continue;
    
    const text = (emblem.text || emblem.effect || '').toLowerCase();
    
    // Parse "creatures you control get +X/+Y"
    const emblemMatch = text.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (emblemMatch) {
      powerBonus += parseInt(emblemMatch[1], 10);
      toughnessBonus += parseInt(emblemMatch[2], 10);
    }
  }
  
  return { power: powerBonus, toughness: toughnessBonus };
}

/**
 * Calculate total equipment/aura bonus for a creature (simpler version)
 * Looks at all attached equipment and auras and sums their P/T bonuses
 * 
 * @param creaturePerm - The creature permanent
 * @param battlefield - All permanents on the battlefield
 * @returns { power, toughness } total bonus
 */
export function calculateEquipmentBonus(
  creaturePerm: any,
  battlefield: any[]
): { power: number; toughness: number } {
  let powerBonus = 0;
  let toughnessBonus = 0;
  
  if (!creaturePerm || !Array.isArray(battlefield)) {
    return { power: 0, toughness: 0 };
  }
  
  // Find all equipment/auras attached to this creature
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura') && typeLine.includes('enchantment');
    
    if (!isEquipment && !isAura) continue;
    
    // Check if this equipment/aura is attached to the creature
    const isAttached = 
      perm.attachedTo === creaturePerm.id || 
      (creaturePerm.attachedEquipment && creaturePerm.attachedEquipment.includes(perm.id));
    
    if (!isAttached) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    
    // Check known equipment bonuses
    if (EQUIPMENT_BONUSES[cardName]) {
      powerBonus += EQUIPMENT_BONUSES[cardName].power;
      toughnessBonus += EQUIPMENT_BONUSES[cardName].toughness;
      continue;
    }
    
    // Try to parse bonus from oracle text for unknown equipment
    const oracleText = perm.card.oracle_text || '';
    const bonusMatch = oracleText.match(/equipped creature gets? \+(\d+)\/\+(\d+)/i);
    if (bonusMatch) {
      powerBonus += parseInt(bonusMatch[1], 10);
      toughnessBonus += parseInt(bonusMatch[2], 10);
      continue;
    }
    
    // Handle negative toughness (like Skullclamp's -1)
    const negativeToughnessMatch = oracleText.match(/equipped creature gets? \+(\d+)\/(-\d+)/i);
    if (negativeToughnessMatch) {
      powerBonus += parseInt(negativeToughnessMatch[1], 10);
      toughnessBonus += parseInt(negativeToughnessMatch[2], 10);
      continue;
    }
    
    // Try aura pattern
    const auraMatch = oracleText.match(/enchanted creature gets? \+(\d+)\/\+(\d+)/i);
    if (auraMatch) {
      powerBonus += parseInt(auraMatch[1], 10);
      toughnessBonus += parseInt(auraMatch[2], 10);
    }
  }
  
  return { power: powerBonus, toughness: toughnessBonus };
}