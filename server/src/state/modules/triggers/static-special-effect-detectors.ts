/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover damage-redirection, empires, mana-granter, mass-boost, must-block,
 *   targeting-protection, dynamic P/T, mass-mill, and quest-counter detectors
 * Public: detectDamageRedirection, checkEmpiresSet, getEmpiresEffect, detectManaAbilityGranter,
 *   detectMassBoostEffect, calculateMassBoost, detectMustBlockEffect, detectTargetingProtection,
 *   detectDynamicPT, calculateDynamicPT, detectMassMillEffect, detectQuestCounter
 */
// ============================================================================
// Pariah and Damage Redirection Support
// ============================================================================

/**
 * Pariah effects redirect damage from a player to another permanent/creature
 * 
 * Cards:
 * - Pariah - "All damage that would be dealt to you is dealt to enchanted creature instead"
 * - Pariah's Shield - Equipment version
 * - Palisade Giant - "All damage that would be dealt to you is dealt to Palisade Giant instead"
 * - Stuffy Doll - Choose a player, all damage dealt to it is dealt to that player
 */
export interface DamageRedirection {
  permanentId: string;
  cardName: string;
  from: 'controller' | 'chosen_player';
  to: 'this_creature' | 'enchanted_creature' | 'equipped_creature' | 'chosen_player';
  chosenPlayerId?: string;
}

export function detectDamageRedirection(card: any, permanent: any): DamageRedirection | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Pariah pattern
  if (cardName.includes('pariah') && !cardName.includes("pariah's shield")) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Pariah',
      from: 'controller',
      to: 'enchanted_creature',
    };
  }
  
  // Pariah's Shield pattern
  if (cardName.includes("pariah's shield")) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Pariah's Shield",
      from: 'controller',
      to: 'equipped_creature',
    };
  }
  
  // Palisade Giant pattern
  if (cardName.includes('palisade giant')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Palisade Giant',
      from: 'controller',
      to: 'this_creature',
    };
  }
  
  // Stuffy Doll pattern - damage to Stuffy Doll is dealt to chosen player
  if (cardName.includes('stuffy doll')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Stuffy Doll',
      from: 'controller',  // Actually "to this creature"
      to: 'chosen_player',
      chosenPlayerId: permanent?.chosenPlayer,  // Set when entering
    };
  }
  
  // Generic pattern detection
  if (oracleText.includes('all damage that would be dealt to you') && 
      oracleText.includes('is dealt to')) {
    if (oracleText.includes('enchanted creature')) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || 'Unknown',
        from: 'controller',
        to: 'enchanted_creature',
      };
    }
    if (oracleText.includes('equipped creature')) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || 'Unknown',
        from: 'controller',
        to: 'equipped_creature',
      };
    }
  }
  
  return null;
}

// ============================================================================
// Empire Artifacts Support (Crown, Scepter, Throne of Empires)
// ============================================================================

/**
 * The Empires artifact cycle from Magic 2012:
 * - Crown of Empires: {3}, {T}: Tap target creature. Gain control if you control Scepter and Throne.
 * - Scepter of Empires: {T}: Deal 1 damage to target player. Deal 3 if you control Crown and Throne.
 * - Throne of Empires: {1}, {T}: Create a 1/1 Soldier. Create 5 if you control Crown and Scepter.
 */
export interface EmpiresBonus {
  hasFullSet: boolean;
  controlsCrown: boolean;
  controlsScepter: boolean;
  controlsThrone: boolean;
}

export function checkEmpiresSet(gameState: any, playerId: string): EmpiresBonus {
  const battlefield = gameState?.battlefield || [];
  const controlledPermanents = battlefield.filter((p: any) => p?.controller === playerId);
  
  let controlsCrown = false;
  let controlsScepter = false;
  let controlsThrone = false;
  
  for (const perm of controlledPermanents) {
    const cardName = (perm?.card?.name || "").toLowerCase();
    if (cardName.includes('crown of empires')) controlsCrown = true;
    if (cardName.includes('scepter of empires')) controlsScepter = true;
    if (cardName.includes('throne of empires')) controlsThrone = true;
  }
  
  return {
    hasFullSet: controlsCrown && controlsScepter && controlsThrone,
    controlsCrown,
    controlsScepter,
    controlsThrone,
  };
}

/**
 * Get the bonus effect for an Empires artifact
 */
export function getEmpiresEffect(card: any, gameState: any, controllerId: string): {
  normalEffect: string;
  bonusEffect: string;
  bonusActive: boolean;
} | null {
  const cardName = (card?.name || "").toLowerCase();
  const empires = checkEmpiresSet(gameState, controllerId);
  
  if (cardName.includes('crown of empires')) {
    return {
      normalEffect: "Tap target creature",
      bonusEffect: "Gain control of target creature",
      bonusActive: empires.controlsScepter && empires.controlsThrone,
    };
  }
  
  if (cardName.includes('scepter of empires')) {
    return {
      normalEffect: "Deal 1 damage to target player or planeswalker",
      bonusEffect: "Deal 3 damage to target player or planeswalker",
      bonusActive: empires.controlsCrown && empires.controlsThrone,
    };
  }
  
  if (cardName.includes('throne of empires')) {
    return {
      normalEffect: "Create a 1/1 white Soldier creature token",
      bonusEffect: "Create five 1/1 white Soldier creature tokens",
      bonusActive: empires.controlsCrown && empires.controlsScepter,
    };
  }
  
  return null;
}

// ============================================================================
// Chromatic Lantern and Mana Fixing Support
// ============================================================================

/**
 * Cards that grant mana abilities to other permanents:
 * - Chromatic Lantern: Lands you control have "T: Add one mana of any color"
 * - Cryptolith Rite: Creatures you control have "T: Add one mana of any color"
 * - Elven Chorus: Creatures you control have "T: Add one mana of any color"
 * - Song of Freyalise: Creatures you control have "T: Add one mana of any color"
 */
export interface ManaAbilityGranter {
  permanentId: string;
  cardName: string;
  grantsTo: 'lands' | 'creatures' | 'all_permanents';
  manaType: 'any_color' | 'specific_color';
  specificColor?: string;
}

export function detectManaAbilityGranter(card: any, permanent: any): ManaAbilityGranter | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Chromatic Lantern: Lands have "T: Add any color"
  if (cardName.includes('chromatic lantern')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Chromatic Lantern',
      grantsTo: 'lands',
      manaType: 'any_color',
    };
  }
  
  // Cryptolith Rite: Creatures have "T: Add any color"
  if (cardName.includes('cryptolith rite')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Cryptolith Rite',
      grantsTo: 'creatures',
      manaType: 'any_color',
    };
  }
  
  // Elven Chorus: Creatures have "T: Add one mana of any color"
  if (cardName.includes('elven chorus')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Elven Chorus',
      grantsTo: 'creatures',
      manaType: 'any_color',
    };
  }
  
  // Song of Freyalise: Creatures have "T: Add any color"
  if (cardName.includes('song of freyalise')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Song of Freyalise',
      grantsTo: 'creatures',
      manaType: 'any_color',
    };
  }
  
  // Generic pattern: "Lands you control have" or "Creatures you control have"
  if (oracleText.includes('lands you control have') && 
      oracleText.includes('{t}: add')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      grantsTo: 'lands',
      manaType: oracleText.includes('any color') ? 'any_color' : 'specific_color',
    };
  }
  
  if (oracleText.includes('creatures you control have') && 
      oracleText.includes('{t}: add')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      grantsTo: 'creatures',
      manaType: oracleText.includes('any color') ? 'any_color' : 'specific_color',
    };
  }
  
  return null;
}

// ============================================================================
// Craterhoof Behemoth and Power/Toughness Boost Effects
// ============================================================================

/**
 * Cards that give +X/+X based on creature count:
 * - Craterhoof Behemoth: +X/+X where X is number of creatures you control
 * - Overwhelming Stampede: +X/+X where X is greatest power among creatures you control
 * - Thunderfoot Baloth: +2/+2 and trample while you control your commander
 * - End-Raze Forerunners: +2/+2, vigilance, trample until end of turn
 */
export interface MassBoostEffect {
  permanentId: string;
  cardName: string;
  boostType: 'creature_count' | 'greatest_power' | 'fixed' | 'conditional';
  fixedBoost?: { power: number; toughness: number };
  grantsKeywords?: string[];
  condition?: string;
  duration: 'until_eot' | 'static';
}

export function detectMassBoostEffect(card: any, permanent: any): MassBoostEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Craterhoof Behemoth: Creatures get +X/+X where X = creature count
  if (cardName.includes('craterhoof behemoth')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Craterhoof Behemoth',
      boostType: 'creature_count',
      grantsKeywords: ['trample'],
      duration: 'until_eot',
    };
  }
  
  // Overwhelming Stampede: +X/+X where X = greatest power
  if (cardName.includes('overwhelming stampede')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Overwhelming Stampede',
      boostType: 'greatest_power',
      grantsKeywords: ['trample'],
      duration: 'until_eot',
    };
  }
  
  // End-Raze Forerunners: +2/+2, vigilance, trample
  if (cardName.includes('end-raze forerunners')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'End-Raze Forerunners',
      boostType: 'fixed',
      fixedBoost: { power: 2, toughness: 2 },
      grantsKeywords: ['vigilance', 'trample'],
      duration: 'until_eot',
    };
  }
  
  // Thunderfoot Baloth: +2/+2 and trample while you control commander
  if (cardName.includes('thunderfoot baloth')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Thunderfoot Baloth',
      boostType: 'conditional',
      fixedBoost: { power: 2, toughness: 2 },
      grantsKeywords: ['trample'],
      condition: 'Control your commander',
      duration: 'static',
    };
  }
  
  return null;
}

/**
 * Calculate the boost amount for creature count or power-based effects
 */
export function calculateMassBoost(
  effect: MassBoostEffect,
  gameState: any,
  controllerId: string
): { power: number; toughness: number } {
  const battlefield = gameState?.battlefield || [];
  
  if (effect.boostType === 'fixed' && effect.fixedBoost) {
    return effect.fixedBoost;
  }
  
  if (effect.boostType === 'creature_count') {
    const creatureCount = battlefield.filter((p: any) => 
      p?.controller === controllerId &&
      (p.card?.type_line || '').toLowerCase().includes('creature')
    ).length;
    return { power: creatureCount, toughness: creatureCount };
  }
  
  if (effect.boostType === 'greatest_power') {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== controllerId) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      const power = perm.basePower ?? perm.card?.power ?? 0;
      const numPower = typeof power === 'string' ? parseInt(power, 10) || 0 : power;
      if (numPower > greatestPower) greatestPower = numPower;
    }
    return { power: greatestPower, toughness: greatestPower };
  }
  
  if (effect.boostType === 'conditional' && effect.fixedBoost) {
    // Check condition
    if (effect.condition === 'Control your commander') {
      const hasCommander = battlefield.some((p: any) => 
        p?.controller === controllerId && p.isCommander
      );
      if (hasCommander) return effect.fixedBoost;
    }
  }
  
  return { power: 0, toughness: 0 };
}

// ============================================================================
// Lure and Combat Forcing Effects
// ============================================================================

/**
 * Cards that force creatures to block:
 * - Lure: All creatures able to block enchanted creature must do so
 * - Nemesis Mask: Same as Lure
 * - Shinen of Life's Roar: Same as Lure (on itself)
 * - Engulfing Slagwurm: Must be blocked if able (implicit via oracle text)
 */
export interface MustBlockEffect {
  permanentId: string;
  cardName: string;
  affects: 'enchanted' | 'equipped' | 'self';
  scope: 'all_creatures' | 'able_creatures';
}

export function detectMustBlockEffect(card: any, permanent: any): MustBlockEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  if (!oracleText) return null;

  if (oracleText.includes('all creatures able to block') &&
      oracleText.includes('do so')) {
    const affects = oracleText.includes('enchanted creature') ? 'enchanted' :
                   oracleText.includes('equipped creature') ? 'equipped' : 'self';
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      affects,
      scope: 'all_creatures',
    };
  }

  if (oracleText.includes('must be blocked if able')) {
    const affects = oracleText.includes('enchanted creature') ? 'enchanted' :
                   oracleText.includes('equipped creature') ? 'equipped' : 'self';
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      affects,
      scope: 'able_creatures',
    };
  }

  return null;
}

// ============================================================================
// Kira, Great Glass-Spinner and Spell/Ability Ward Effects
// ============================================================================

/**
 * Cards that counter the first spell/ability targeting creatures:
 * - Kira, Great Glass-Spinner: Counter the first spell or ability each turn
 * - Shalai, Voice of Plenty: Gives hexproof to you and your creatures
 * - Saryth, the Viper's Fang: Tapped creatures have deathtouch, untapped have hexproof
 */
export interface TargetingProtection {
  permanentId: string;
  cardName: string;
  protectionType: 'counter_first' | 'hexproof' | 'conditional_hexproof';
  affects: 'creatures_you_control' | 'you_and_creatures' | 'untapped_creatures' | 'tapped_creatures';
  counterPerTurn?: boolean;
}

export function detectTargetingProtection(card: any, permanent: any): TargetingProtection | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Kira, Great Glass-Spinner
  if (cardName.includes('kira') && cardName.includes('glass-spinner')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Kira, Great Glass-Spinner',
      protectionType: 'counter_first',
      affects: 'creatures_you_control',
      counterPerTurn: true,
    };
  }
  
  // Shalai, Voice of Plenty
  if (cardName.includes('shalai') && cardName.includes('voice of plenty')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Shalai, Voice of Plenty',
      protectionType: 'hexproof',
      affects: 'you_and_creatures',
    };
  }
  
  // Saryth, the Viper's Fang
  if (cardName.includes('saryth') && cardName.includes("viper's fang")) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Saryth, the Viper's Fang",
      protectionType: 'conditional_hexproof',
      affects: 'untapped_creatures',  // Also grants deathtouch to tapped
    };
  }
  
  return null;
}

// ============================================================================
// Serra Avatar and Power/Toughness Equal to Life Effects
// ============================================================================

/**
 * Cards with P/T equal to life total or other dynamic values:
 * - Serra Avatar: P/T equal to your life total
 * - Malignus: Power and toughness equal to half opponent's life (rounded up)
 * - Lord of Extinction: P/T equal to cards in all graveyards
 * - Multani, Yavimaya's Avatar: P/T equal to lands you control + lands in graveyard
 */
export interface DynamicPowerToughness {
  permanentId: string;
  cardName: string;
  baseOn: 'life_total' | 'half_opponent_life' | 'graveyard_cards' | 'lands_controlled_and_graveyard';
}

export function detectDynamicPT(card: any, permanent: any): DynamicPowerToughness | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Serra Avatar
  if (cardName.includes('serra avatar')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Serra Avatar',
      baseOn: 'life_total',
    };
  }
  
  // Malignus
  if (cardName.includes('malignus')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Malignus',
      baseOn: 'half_opponent_life',
    };
  }
  
  // Lord of Extinction
  if (cardName.includes('lord of extinction')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Lord of Extinction',
      baseOn: 'graveyard_cards',
    };
  }
  
  // Multani, Yavimaya's Avatar
  if (cardName.includes('multani') && cardName.includes('yavimaya')) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Multani, Yavimaya's Avatar",
      baseOn: 'lands_controlled_and_graveyard',
    };
  }
  
  // Generic pattern
  if (oracleText.includes("power and toughness are each equal to your life total")) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      baseOn: 'life_total',
    };
  }
  
  return null;
}

/**
 * Calculate dynamic P/T for cards like Serra Avatar
 */
export function calculateDynamicPT(
  effect: DynamicPowerToughness,
  gameState: any,
  controllerId: string
): { power: number; toughness: number } {
  const life = gameState?.life?.[controllerId] || 40;
  const battlefield = gameState?.battlefield || [];
  
  switch (effect.baseOn) {
    case 'life_total':
      return { power: life, toughness: life };
      
    case 'half_opponent_life': {
      const players = gameState?.players || [];
      const opponents = players.filter((p: any) => p.id !== controllerId);
      // Get highest life total among opponents
      let highestOpponentLife = 0;
      for (const opp of opponents) {
        const oppLife = gameState?.life?.[opp.id] || 40;
        if (oppLife > highestOpponentLife) highestOpponentLife = oppLife;
      }
      const halfLife = Math.ceil(highestOpponentLife / 2);
      return { power: halfLife, toughness: halfLife };
    }
    
    case 'graveyard_cards': {
      let totalCards = 0;
      const players = gameState?.players || [];
      for (const player of players) {
        const graveyard = gameState?.zones?.[player.id]?.graveyard || [];
        totalCards += graveyard.length;
      }
      return { power: totalCards, toughness: totalCards };
    }
    
    case 'lands_controlled_and_graveyard': {
      const landsControlled = battlefield.filter((p: any) => 
        p?.controller === controllerId &&
        (p.card?.type_line || '').toLowerCase().includes('land')
      ).length;
      const graveyard = gameState?.zones?.[controllerId]?.graveyard || [];
      const landsInGraveyard = graveyard.filter((c: any) => 
        (c.type_line || '').toLowerCase().includes('land')
      ).length;
      const total = landsControlled + landsInGraveyard;
      return { power: total, toughness: total };
    }
  }
  
  return { power: 0, toughness: 0 };
}

// ============================================================================
// Traumatize and Mill Effects
// ============================================================================

/**
 * Cards that mill half library or large amounts:
 * - Traumatize: Mill half library (rounded down)
 * - Maddening Cacophony (kicked): Mill half library
 * - Fleet Swallower: Mill half library on combat damage
 */
export interface MassMillEffect {
  cardName: string;
  millType: 'half_library' | 'fixed_amount' | 'cards_in_hand';
  amount?: number;
  targetType: 'target_player' | 'all_opponents' | 'combat_damage_to_player';
}

export function detectMassMillEffect(card: any): MassMillEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Traumatize
  if (cardName.includes('traumatize')) {
    return {
      cardName: 'Traumatize',
      millType: 'half_library',
      targetType: 'target_player',
    };
  }
  
  // Maddening Cacophony
  if (cardName.includes('maddening cacophony')) {
    return {
      cardName: 'Maddening Cacophony',
      millType: 'half_library',  // When kicked
      targetType: 'all_opponents',
    };
  }
  
  // Fleet Swallower
  if (cardName.includes('fleet swallower')) {
    return {
      cardName: 'Fleet Swallower',
      millType: 'half_library',
      targetType: 'combat_damage_to_player',
    };
  }
  
  // Generic "mills half their library" pattern
  if (oracleText.includes('mills half') || 
      oracleText.includes('mill half') ||
      oracleText.includes('puts the top half')) {
    return {
      cardName: card?.name || 'Unknown',
      millType: 'half_library',
      targetType: oracleText.includes('target player') ? 'target_player' : 'all_opponents',
    };
  }
  
  return null;
}

// ============================================================================
// Archmage Ascension and Quest Counters
// ============================================================================

/**
 * Cards with quest/charge counter mechanics that trigger special effects:
 * - Archmage Ascension: 6 quest counters -> search library instead of draw
 * - Felidar Sovereign: Win at upkeep if 40+ life
 * - Quest for the Holy Relic: 5 quest counters -> search for Equipment
 */
export interface QuestCounter {
  permanentId: string;
  cardName: string;
  counterType: 'quest' | 'charge' | 'lore';
  threshold: number;
  thresholdEffect: string;
  triggerCondition: string;
}

export function detectQuestCounter(card: any, permanent: any): QuestCounter | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Archmage Ascension
  if (cardName.includes('archmage ascension')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Archmage Ascension',
      counterType: 'quest',
      threshold: 6,
      thresholdEffect: "Search your library for a card instead of drawing",
      triggerCondition: "Draw two or more cards in a turn",
    };
  }
  
  // Generic quest counter pattern
  if (oracleText.includes('quest counter')) {
    const thresholdMatch = oracleText.match(/(\d+) or more quest counters/);
    const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 5;
    
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      counterType: 'quest',
      threshold,
      thresholdEffect: "Special ability unlocked",
      triggerCondition: "Varies by card",
    };
  }
  
  return null;
}
