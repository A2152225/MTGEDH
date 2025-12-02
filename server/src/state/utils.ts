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
  const controllerId = card.controller;
  const battlefield = gameState?.battlefield || [];
  const zones = gameState?.zones || {};
  
  // Marit Lage token - Defined as 20/20
  if (name.includes('marit lage')) {
    return { power: 20, toughness: 20 };
  }
  
  // ===== SPECIFIC CARD HANDLERS =====
  
  // Omnath, Locus of Mana - gets +1/+1 for each green mana in your mana pool
  if (name.includes('omnath, locus of mana') || name.includes('omnath locus of mana')) {
    const manaPool = gameState?.manaPool?.[controllerId] || {};
    const greenMana = manaPool.G || manaPool.green || 0;
    // Base is 1/1, plus green mana
    return { power: 1 + greenMana, toughness: 1 + greenMana };
  }
  
  // Tarmogoyf - */* where * is the number of card types among cards in all graveyards
  if (name.includes('tarmogoyf')) {
    const cardTypes = new Set<string>();
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        const cardTypeLine = (card.type_line || '').toLowerCase();
        if (cardTypeLine.includes('creature')) cardTypes.add('creature');
        if (cardTypeLine.includes('instant')) cardTypes.add('instant');
        if (cardTypeLine.includes('sorcery')) cardTypes.add('sorcery');
        if (cardTypeLine.includes('artifact')) cardTypes.add('artifact');
        if (cardTypeLine.includes('enchantment')) cardTypes.add('enchantment');
        if (cardTypeLine.includes('planeswalker')) cardTypes.add('planeswalker');
        if (cardTypeLine.includes('land')) cardTypes.add('land');
        if (cardTypeLine.includes('tribal')) cardTypes.add('tribal');
        if (cardTypeLine.includes('kindred')) cardTypes.add('kindred');
        if (cardTypeLine.includes('battle')) cardTypes.add('battle');
      }
    }
    // Tarmogoyf is */1+* 
    return { power: cardTypes.size, toughness: cardTypes.size + 1 };
  }
  
  // Lhurgoyf - */* where power is creatures in all graveyards, toughness is 1+that
  if (name.includes('lhurgoyf') && !name.includes('mortivore')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount + 1 };
  }
  
  // Mortivore - */* where * is creatures in all graveyards
  if (name.includes('mortivore')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount };
  }
  
  // Nighthowler - */* where * is creatures in all graveyards
  if (name.includes('nighthowler')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount };
  }
  
  // Consuming Aberration - */* where * is cards in opponents' graveyards
  if (name.includes('consuming aberration')) {
    let cardCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      if (player.id === controllerId) continue; // Skip controller
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      cardCount += graveyard.length;
    }
    return { power: cardCount, toughness: cardCount };
  }
  
  // Sewer Nemesis - */* where * is cards in chosen player's graveyard
  if (name.includes('sewer nemesis')) {
    // Assumes chosen player is stored on the card
    const chosenPlayer = card.chosenPlayer || controllerId;
    const playerZones = zones[chosenPlayer];
    const cardCount = playerZones?.graveyard?.length || 0;
    return { power: cardCount, toughness: cardCount };
  }
  
  // Bonehoard - equipped creature gets +X/+X where X is creatures in all graveyards
  // (handled in equipment bonus calculation)
  
  // Cranial Plating - equipped creature gets +X/+0 where X is artifacts you control
  // (handled in equipment calculation)
  
  // Nettlecyst - equipped creature gets +1/+1 for each artifact and enchantment you control
  // (handled in equipment calculation)
  
  // Blackblade Reforged - equipped creature gets +1/+1 for each land you control
  // (handled in equipment calculation)
  
  // Multani, Yavimaya's Avatar - */* where * is lands you control + lands in graveyard
  if (name.includes('multani, yavimaya')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    const playerZones = zones[controllerId];
    const graveyardLands = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('land')
    );
    const total = lands.length + graveyardLands.length;
    return { power: total, toughness: total };
  }
  
  // Splinterfright - */* where * is creatures in your graveyard
  if (name.includes('splinterfright')) {
    const playerZones = zones[controllerId];
    const graveyardCreatures = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('creature')
    );
    return { power: graveyardCreatures.length, toughness: graveyardCreatures.length };
  }
  
  // Boneyard Wurm - */* where * is creatures in your graveyard
  if (name.includes('boneyard wurm')) {
    const playerZones = zones[controllerId];
    const graveyardCreatures = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('creature')
    );
    return { power: graveyardCreatures.length, toughness: graveyardCreatures.length };
  }
  
  // Cognivore - */* where * is instants in all graveyards
  if (name.includes('cognivore')) {
    let instantCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('instant')) {
          instantCount++;
        }
      }
    }
    return { power: instantCount, toughness: instantCount };
  }
  
  // Magnivore - */* where * is sorceries in all graveyards
  if (name.includes('magnivore')) {
    let sorceryCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('sorcery')) {
          sorceryCount++;
        }
      }
    }
    return { power: sorceryCount, toughness: sorceryCount };
  }
  
  // Terravore - */* where * is lands in all graveyards
  if (name.includes('terravore')) {
    let landCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('land')) {
          landCount++;
        }
      }
    }
    return { power: landCount, toughness: landCount };
  }
  
  // Masticore variants with hand-based P/T
  // Maro - */* where * is cards in your hand
  if (name === 'maro' || name.includes('maro,')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // Molimo, Maro-Sorcerer - */* where * is lands you control
  if (name.includes('molimo')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    return { power: lands.length, toughness: lands.length };
  }
  
  // Korlash, Heir to Blackblade - */* where * is Swamps you control
  if (name.includes('korlash')) {
    const swamps = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    );
    return { power: swamps.length, toughness: swamps.length };
  }
  
  // Dungrove Elder - */* where * is Forests you control
  if (name.includes('dungrove elder')) {
    const forests = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('forest')
    );
    return { power: forests.length, toughness: forests.length };
  }
  
  // Dakkon Blackblade - */* where * is lands you control
  if (name.includes('dakkon blackblade')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    return { power: lands.length, toughness: lands.length };
  }
  
  // Kavu Titan - 5/5 if kicked
  if (name.includes('kavu titan') && card.wasKicked) {
    return { power: 5, toughness: 5 };
  }
  
  // Serra Avatar - */* where * is your life total
  if (name.includes('serra avatar')) {
    const life = gameState?.life?.[controllerId] ?? 40;
    return { power: life, toughness: life };
  }
  
  // Soramaro, First to Dream - */* where * is cards in hand
  if (name.includes('soramaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // Masumaro, First to Live - */* where * is cards in hand
  if (name.includes('masumaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize * 2, toughness: handSize * 2 };
  }
  
  // Adamaro, First to Desire - */* where * is cards in opponent's hand with most cards
  if (name.includes('adamaro')) {
    let maxHandSize = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      if (player.id === controllerId) continue;
      const playerZones = zones[player.id];
      const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
      maxHandSize = Math.max(maxHandSize, handSize);
    }
    return { power: maxHandSize, toughness: maxHandSize };
  }
  
  // Kagemaro, First to Suffer - */* where * is cards in your hand
  if (name.includes('kagemaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // ===== GENERIC PATTERN MATCHING =====
  
  // "power and toughness are each equal to" patterns
  if (oracleText.includes('power and toughness are each equal to')) {
    
    // "number of creatures you control"
    if (oracleText.includes('number of creatures you control')) {
      const creatures = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      return { power: creatures.length, toughness: creatures.length };
    }
    
    // "number of creatures on the battlefield" (all creatures)
    if (oracleText.includes('number of creatures on the battlefield') || 
        oracleText.includes('total number of creatures')) {
      const creatures = battlefield.filter((p: any) => 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      return { power: creatures.length, toughness: creatures.length };
    }
    
    // "cards in your hand"
    if (oracleText.includes('cards in your hand')) {
      const playerZones = zones[controllerId];
      const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
      return { power: handSize, toughness: handSize };
    }
    
    // "lands you control"
    if (oracleText.includes('lands you control') || oracleText.includes('number of lands you control')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      return { power: lands.length, toughness: lands.length };
    }
    
    // "your life total"
    if (oracleText.includes('your life total')) {
      const life = gameState?.life?.[controllerId] ?? 40;
      return { power: life, toughness: life };
    }
    
    // "creature cards in all graveyards"
    if (oracleText.includes('creature cards in all graveyards') || 
        oracleText.includes('creatures in all graveyards')) {
      let creatureCount = 0;
      const allPlayers = gameState?.players || [];
      for (const player of allPlayers) {
        const playerZones = zones[player.id];
        const graveyard = playerZones?.graveyard || [];
        for (const card of graveyard) {
          if ((card.type_line || '').toLowerCase().includes('creature')) {
            creatureCount++;
          }
        }
      }
      return { power: creatureCount, toughness: creatureCount };
    }
    
    // "cards in your graveyard"
    if (oracleText.includes('cards in your graveyard')) {
      const playerZones = zones[controllerId];
      const cardCount = playerZones?.graveyard?.length ?? 0;
      return { power: cardCount, toughness: cardCount };
    }
    
    // "creature cards in your graveyard"
    if (oracleText.includes('creature cards in your graveyard') ||
        oracleText.includes('creatures in your graveyard')) {
      const playerZones = zones[controllerId];
      const creatureCount = (playerZones?.graveyard || []).filter((c: any) =>
        (c.type_line || '').toLowerCase().includes('creature')
      ).length;
      return { power: creatureCount, toughness: creatureCount };
    }
    
    // "artifacts you control"
    if (oracleText.includes('artifacts you control')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      return { power: artifacts.length, toughness: artifacts.length };
    }
    
    // "enchantments you control"
    if (oracleText.includes('enchantments you control')) {
      const enchantments = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('enchantment')
      );
      return { power: enchantments.length, toughness: enchantments.length };
    }
  }
  
  // "gets +1/+1 for each" patterns (for base stats of 0/0 creatures)
  const getsPlusPattern = oracleText.match(/gets? \+1\/\+1 for each ([^.]+)/i);
  if (getsPlusPattern && (card.power === '*' || card.power === '0')) {
    const condition = getsPlusPattern[1].toLowerCase();
    
    if (condition.includes('creature you control') || condition.includes('other creature you control')) {
      const creatures = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      // Subtract 1 if "other" (don't count itself)
      const count = condition.includes('other') ? Math.max(0, creatures.length - 1) : creatures.length;
      return { power: count, toughness: count };
    }
    
    if (condition.includes('land you control')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      return { power: lands.length, toughness: lands.length };
    }
    
    if (condition.includes('artifact you control')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      return { power: artifacts.length, toughness: artifacts.length };
    }
  }
  
  // For cards we can't calculate, check if there's a defined base in reminder text
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
  // Pass gameState for variable equipment calculations
  const equipBonus = calculateEquipmentBonus(creaturePerm, battlefield, gameState);
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
  
  // 10. Plane card effects (Planechase format)
  // Active plane affects all players or specific conditions
  const activePlane = gameState.activePlane || gameState.currentPlane;
  if (activePlane) {
    const planeText = (activePlane.text || activePlane.oracle_text || activePlane.effect || '').toLowerCase();
    const planeName = (activePlane.name || '').toLowerCase();
    
    // Check for global creature pump effects on planes
    // "All creatures get +X/+Y"
    const allCreaturesMatch = planeText.match(/all creatures get \+(\d+)\/\+(\d+)/i);
    if (allCreaturesMatch) {
      powerBonus += parseInt(allCreaturesMatch[1], 10);
      toughnessBonus += parseInt(allCreaturesMatch[2], 10);
    }
    
    // "Creatures you control get +X/+Y"
    const yourCreaturesMatch = planeText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (yourCreaturesMatch && activePlane.controller === controllerId) {
      powerBonus += parseInt(yourCreaturesMatch[1], 10);
      toughnessBonus += parseInt(yourCreaturesMatch[2], 10);
    }
    
    // Specific plane effects
    // Llanowar - "All creatures have +X/+X for each basic land type among lands you control"
    if (planeName.includes('llanowar')) {
      // Count basic land types controlled by the creature's controller
      const controllerLands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      const landTypes = new Set<string>();
      for (const land of controllerLands) {
        const landTypeLine = (land.card?.type_line || '').toLowerCase();
        if (landTypeLine.includes('plains')) landTypes.add('plains');
        if (landTypeLine.includes('island')) landTypes.add('island');
        if (landTypeLine.includes('swamp')) landTypes.add('swamp');
        if (landTypeLine.includes('mountain')) landTypes.add('mountain');
        if (landTypeLine.includes('forest')) landTypes.add('forest');
      }
      const boost = landTypes.size;
      powerBonus += boost;
      toughnessBonus += boost;
    }
    
    // The Great Forest - Creatures with trample get +2/+2
    if (planeName.includes('great forest')) {
      const oracleText = (creaturePerm.card?.oracle_text || '').toLowerCase();
      const keywords = creaturePerm.card?.keywords || [];
      if (oracleText.includes('trample') || keywords.some((k: string) => k.toLowerCase() === 'trample')) {
        powerBonus += 2;
        toughnessBonus += 2;
      }
    }
  }
  
  // 11. Scheme card effects (Archenemy format)
  // Ongoing schemes that affect creatures
  const activeSchemes = gameState.activeSchemes || gameState.ongoingSchemes || [];
  for (const scheme of activeSchemes) {
    if (!scheme) continue;
    
    const schemeText = (scheme.text || scheme.oracle_text || scheme.effect || '').toLowerCase();
    
    // "Creatures you control get +X/+Y"
    const schemeCreaturesMatch = schemeText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (schemeCreaturesMatch && scheme.controller === controllerId) {
      powerBonus += parseInt(schemeCreaturesMatch[1], 10);
      toughnessBonus += parseInt(schemeCreaturesMatch[2], 10);
    }
    
    // "All creatures get +X/+Y" (affects everyone)
    const schemeAllMatch = schemeText.match(/all creatures get \+(\d+)\/\+(\d+)/i);
    if (schemeAllMatch) {
      powerBonus += parseInt(schemeAllMatch[1], 10);
      toughnessBonus += parseInt(schemeAllMatch[2], 10);
    }
  }
  
  // 12. Conspiracy cards (Conspiracy draft format) - affects creatures you control
  const conspiracies = gameState.conspiracies || [];
  for (const conspiracy of conspiracies) {
    if (!conspiracy || conspiracy.controller !== controllerId) continue;
    
    const conspText = (conspiracy.text || conspiracy.oracle_text || conspiracy.effect || '').toLowerCase();
    
    // Check for creature buff effects
    const conspBuffMatch = conspText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (conspBuffMatch) {
      powerBonus += parseInt(conspBuffMatch[1], 10);
      toughnessBonus += parseInt(conspBuffMatch[2], 10);
    }
  }
  
  // 13. Dungeon room effects (AFR/CLB dungeons)
  const activeDungeon = gameState.activeDungeon || gameState.currentDungeon;
  if (activeDungeon && activeDungeon.controller === controllerId) {
    const roomText = (activeDungeon.currentRoomEffect || activeDungeon.roomEffect || '').toLowerCase();
    
    // Some rooms give creature buffs
    const roomBuffMatch = roomText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (roomBuffMatch) {
      powerBonus += parseInt(roomBuffMatch[1], 10);
      toughnessBonus += parseInt(roomBuffMatch[2], 10);
    }
  }
  
  return { power: powerBonus, toughness: toughnessBonus };
}

/**
 * Calculate total equipment/aura bonus for a creature
 * Looks at all attached equipment and auras and sums their P/T bonuses
 * Includes variable equipment like Cranial Plating, Blackblade Reforged, Trepanation Blade
 * 
 * @param creaturePerm - The creature permanent
 * @param battlefield - All permanents on the battlefield
 * @param gameState - Optional game state for variable equipment calculations
 * @returns { power, toughness } total bonus
 */
export function calculateEquipmentBonus(
  creaturePerm: any,
  battlefield: any[],
  gameState?: any
): { power: number; toughness: number } {
  let powerBonus = 0;
  let toughnessBonus = 0;
  
  if (!creaturePerm || !Array.isArray(battlefield)) {
    return { power: 0, toughness: 0 };
  }
  
  const controllerId = creaturePerm.controller;
  const zones = gameState?.zones || {};
  
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
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // ===== VARIABLE EQUIPMENT BONUSES =====
    
    // Cranial Plating - +1/+0 for each artifact you control
    if (cardName.includes('cranial plating')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      powerBonus += artifacts.length;
      continue;
    }
    
    // Nettlecyst - +1/+1 for each artifact and enchantment you control
    if (cardName.includes('nettlecyst')) {
      const artifactsAndEnchantments = battlefield.filter((p: any) => {
        if (p.controller !== controllerId) return false;
        const tl = (p.card?.type_line || '').toLowerCase();
        return tl.includes('artifact') || tl.includes('enchantment');
      });
      const bonus = artifactsAndEnchantments.length;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // Blackblade Reforged - +1/+1 for each land you control
    if (cardName.includes('blackblade reforged')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      const bonus = lands.length;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // Bonehoard - +X/+X where X is creatures in all graveyards
    if (cardName.includes('bonehoard')) {
      let creatureCount = 0;
      const allPlayers = gameState?.players || [];
      for (const player of allPlayers) {
        const playerZones = zones[player.id];
        const graveyard = playerZones?.graveyard || [];
        for (const card of graveyard) {
          if ((card.type_line || '').toLowerCase().includes('creature')) {
            creatureCount++;
          }
        }
      }
      powerBonus += creatureCount;
      toughnessBonus += creatureCount;
      continue;
    }
    
    // Runechanter's Pike - +X/+0 where X is instants and sorceries in your graveyard
    if (cardName.includes("runechanter's pike")) {
      const playerZones = zones[controllerId];
      const graveyard = playerZones?.graveyard || [];
      let count = 0;
      for (const card of graveyard) {
        const tl = (card.type_line || '').toLowerCase();
        if (tl.includes('instant') || tl.includes('sorcery')) {
          count++;
        }
      }
      powerBonus += count;
      continue;
    }
    
    // Trepanation Blade - variable based on last attack (stored on equipment)
    if (cardName.includes('trepanation blade')) {
      // The bonus is determined when attacking and stored on the equipment
      const storedBonus = perm.trepanationBonus || perm.lastTrepanationBonus || 0;
      powerBonus += storedBonus;
      continue;
    }
    
    // Stoneforge Masterwork - +1/+1 for each creature sharing a type with equipped creature
    if (cardName.includes('stoneforge masterwork')) {
      const creatureTypes = extractCreatureTypes(creaturePerm.card?.type_line || '');
      let matchCount = 0;
      for (const p of battlefield) {
        if (!p || !p.card || p.id === creaturePerm.id) continue;
        if (p.controller !== controllerId) continue;
        const pTypeLine = (p.card.type_line || '').toLowerCase();
        if (!pTypeLine.includes('creature')) continue;
        
        for (const cType of creatureTypes) {
          if (pTypeLine.includes(cType.toLowerCase())) {
            matchCount++;
            break;
          }
        }
      }
      powerBonus += matchCount;
      toughnessBonus += matchCount;
      continue;
    }
    
    // Conqueror's Flail - +1/+1 for each color among permanents you control
    if (cardName.includes("conqueror's flail")) {
      const colors = new Set<string>();
      for (const p of battlefield) {
        if (p.controller !== controllerId) continue;
        const cardColors = p.card?.colors || [];
        for (const c of cardColors) {
          colors.add(c);
        }
      }
      const bonus = colors.size;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // All That Glitters - +1/+1 for each artifact and enchantment you control
    if (cardName.includes('all that glitters')) {
      const count = battlefield.filter((p: any) => {
        if (p.controller !== controllerId) return false;
        const tl = (p.card?.type_line || '').toLowerCase();
        return tl.includes('artifact') || tl.includes('enchantment');
      }).length;
      powerBonus += count;
      toughnessBonus += count;
      continue;
    }
    
    // Ethereal Armor - +1/+1 for each enchantment you control
    if (cardName.includes('ethereal armor')) {
      const enchantments = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('enchantment')
      );
      const bonus = enchantments.length;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // Ancestral Mask - +2/+2 for each other enchantment on the battlefield
    if (cardName.includes('ancestral mask')) {
      const enchantments = battlefield.filter((p: any) => {
        if (p.id === perm.id) return false; // Don't count itself
        return (p.card?.type_line || '').toLowerCase().includes('enchantment');
      });
      const bonus = enchantments.length * 2;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // ===== CHECK KNOWN STATIC EQUIPMENT BONUSES =====
    if (EQUIPMENT_BONUSES[cardName]) {
      powerBonus += EQUIPMENT_BONUSES[cardName].power;
      toughnessBonus += EQUIPMENT_BONUSES[cardName].toughness;
      continue;
    }
    
    // Check known aura bonuses
    if (AURA_BONUSES[cardName]) {
      powerBonus += AURA_BONUSES[cardName].power;
      toughnessBonus += AURA_BONUSES[cardName].toughness;
      continue;
    }
    
    // Try to parse bonus from oracle text for unknown equipment
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

/**
 * Extract creature types from a type line
 * e.g., "Legendary Creature — Human Soldier" -> ["Human", "Soldier"]
 */
function extractCreatureTypes(typeLine: string): string[] {
  if (!typeLine) return [];
  const dashIndex = typeLine.indexOf('—');
  if (dashIndex === -1) return [];
  const subtypes = typeLine.substring(dashIndex + 1).trim();
  return subtypes.split(/\s+/).filter(t => t.length > 0);
}