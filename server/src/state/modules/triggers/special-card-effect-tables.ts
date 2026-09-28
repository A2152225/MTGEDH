/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover utility-land / equipment / umbra / control / infect / group-draw /
 *   land-search / conditional-ETB / library / charge / special-card tables and detectors
 * Public: detectUtilityLandAbility, detectEquipmentEffect, detectUmbraEffect, detectControlChangeEffect,
 *   detectInfectGrantEffect, detectGroupDrawEffect, detectMultiTargetLandSearch, validateSharedLandType,
 *   detectConditionalETBTapped, checkConditionalETBMet, detectLibraryRevealPlayEffect,
 *   detectTopCardViewEffect, detectPowerBasedLandSearch, calculateLandSearchCount,
 *   detectChargeCounterAbility, detectSpecialCardEffect, checkGraveyardTrigger
 */

import { getCurrentPowerToughnessForRules } from "../currentPowerToughness.js";
// ============================================================================
// Utility Land Activated Abilities
// ============================================================================

/**
 * Lands with non-mana activated abilities:
 * - Ghost Quarter: Destroy target land. Its controller may search for a basic
 * - Homeward Path: Each player gains control of all creatures they own
 * - Rogue's Passage: Target creature can't be blocked this turn
 * - Nesting Grounds: Move a counter from one permanent to another
 * - Field of Ruin: Destroy target nonbasic land, each player searches for basic
 * - Detection Tower: Remove hexproof from opponent creatures
 * - Prahv, Spires of Order: Prevent all damage by target attacking/blocking creature
 */
export interface UtilityLandAbility {
  permanentId: string;
  cardName: string;
  cost: string;
  requiresTap: boolean;
  effect: string;
  targetType?: 'land' | 'nonbasic_land' | 'creature' | 'permanent' | 'counter';
  targetController?: 'any' | 'opponent' | 'you';
  additionalEffects?: string[];
  activationCondition?: 'attacked_with_two_or_more';  // For cards like Minas Tirith
}

const KNOWN_UTILITY_LANDS: Record<string, Omit<UtilityLandAbility, 'permanentId' | 'cardName'>> = {
  "ghost quarter": {
    cost: "{T}, Sacrifice ~",
    requiresTap: true,
    effect: "Destroy target land. Its controller may search for a basic land and put it onto the battlefield",
    targetType: 'land',
    targetController: 'any',
  },
  "homeward path": {
    cost: "{T}",
    requiresTap: true,
    effect: "Each player gains control of all creatures they own",
  },
  "rogue's passage": {
    cost: "{4}, {T}",
    requiresTap: true,
    effect: "Target creature can't be blocked this turn",
    targetType: 'creature',
    targetController: 'you',
  },
  "nesting grounds": {
    cost: "{1}, {T}",
    requiresTap: true,
    effect: "Move a counter from target permanent you control onto another target permanent",
    targetType: 'counter',
    targetController: 'you',
    additionalEffects: ["Requires two targets", "Counter types must match"],
  },
  "field of ruin": {
    cost: "{2}, {T}, Sacrifice ~",
    requiresTap: true,
    effect: "Destroy target nonbasic land. Each player searches for a basic land and puts it onto the battlefield",
    targetType: 'nonbasic_land',
    targetController: 'any',
  },
  "detection tower": {
    cost: "{1}, {T}",
    requiresTap: true,
    effect: "Until end of turn, creatures your opponents control lose hexproof and shroud",
  },
  "prahv, spires of order": {
    cost: "{4}{W}{U}, {T}",
    requiresTap: true,
    effect: "Prevent all damage that would be dealt by target attacking or blocking creature this turn",
    targetType: 'creature',
    targetController: 'any',
  },
  "maze of ith": {
    cost: "{T}",
    requiresTap: true,
    effect: "Untap target attacking creature. Prevent all combat damage dealt to and dealt by that creature this turn",
    targetType: 'creature',
    targetController: 'any',
  },
  "mystifying maze": {
    cost: "{4}, {T}",
    requiresTap: true,
    effect: "Exile target attacking creature. At end of combat, return it tapped",
    targetType: 'creature',
    targetController: 'any',
  },
  "thespian's stage": {
    cost: "{2}, {T}",
    requiresTap: true,
    effect: "This land becomes a copy of target land, except it has this ability",
    targetType: 'land',
    targetController: 'any',
  },
  "kessig wolf run": {
    cost: "{X}{R}{G}, {T}",
    requiresTap: true,
    effect: "Target creature gets +X/+0 and gains trample until end of turn",
    targetType: 'creature',
    targetController: 'you',
  },
  "alchemist's refuge": {
    cost: "{G}{U}, {T}",
    requiresTap: true,
    effect: "You may cast spells this turn as though they had flash",
  },
  "gavony township": {
    cost: "{2}{G}{W}, {T}",
    requiresTap: true,
    effect: "Put a +1/+1 counter on each creature you control",
  },
  "vault of the archangel": {
    cost: "{2}{W}{B}, {T}",
    requiresTap: true,
    effect: "Creatures you control gain deathtouch and lifelink until end of turn",
  },
  "slayers' stronghold": {
    cost: "{R}{W}, {T}",
    requiresTap: true,
    effect: "Target creature gets +2/+0 and gains vigilance and haste until end of turn",
    targetType: 'creature',
    targetController: 'you',
  },
  "minas tirith": {
    cost: "{1}{W}, {T}",
    requiresTap: true,
    effect: "Draw a card",
    activationCondition: 'attacked_with_two_or_more',
  },
};

export function detectUtilityLandAbility(card: any, permanent: any): UtilityLandAbility | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, abilityInfo] of Object.entries(KNOWN_UTILITY_LANDS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...abilityInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Equipment Effects (Grafted Exoskeleton, Assault Suit, Umbral Mantle, Bear Umbra)
// ============================================================================

export interface EquipmentEffect {
  permanentId: string;
  cardName: string;
  equipCost: string;
  grantedKeywords?: string[];
  grantedPTBoost?: { power: number; toughness: number };
  grantedAbilities?: string[];
  specialEffect?: string;
  triggers?: string[];
  restrictions?: string[];
}

const KNOWN_EQUIPMENT_EFFECTS: Record<string, Omit<EquipmentEffect, 'permanentId' | 'cardName'>> = {
  "grafted exoskeleton": {
    equipCost: "{2}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['infect'],
    restrictions: ["When equipment becomes unattached, sacrifice creature"],
  },
  "assault suit": {
    equipCost: "{3}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['haste'],
    specialEffect: "At each opponent's upkeep, you may have them gain control of equipped creature until end of turn. It can't attack you or be sacrificed",
    restrictions: ["Equipped creature can't be sacrificed"],
  },
  "umbral mantle": {
    equipCost: "{0}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedAbilities: ["{3}, Untap: This creature gets +2/+2 until end of turn"],
    specialEffect: "Equipped creature has '{3}, {Q}: This creature gets +2/+2 until end of turn'",
  },
  "sword of the animist": {
    equipCost: "{2}",
    grantedPTBoost: { power: 1, toughness: 1 },
    triggers: ["Whenever equipped creature attacks, search for a basic land and put it onto the battlefield tapped"],
  },
  "sword of feast and famine": {
    equipCost: "{2}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['protection from black', 'protection from green'],
    triggers: ["Whenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control"],
  },
  "skullclamp": {
    equipCost: "{1}",
    grantedPTBoost: { power: 1, toughness: -1 },
    triggers: ["When equipped creature dies, draw two cards"],
  },
  "lightning greaves": {
    equipCost: "{0}",
    grantedKeywords: ['shroud', 'haste'],
  },
  "swiftfoot boots": {
    equipCost: "{1}",
    grantedKeywords: ['hexproof', 'haste'],
  },
  "helm of the host": {
    equipCost: "{5}",
    triggers: ["At the beginning of combat on your turn, create a token copy of equipped creature, except it's not legendary and gains haste"],
  },
};

export function detectEquipmentEffect(card: any, permanent: any): EquipmentEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_EQUIPMENT_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Aura Umbra Effects (Totem Armor)
// ============================================================================

export interface TotemArmorEffect {
  permanentId: string;
  cardName: string;
  grantedKeywords?: string[];
  grantedPTBoost?: { power: number; toughness: number };
  triggers?: string[];
}

const KNOWN_UMBRA_EFFECTS: Record<string, Omit<TotemArmorEffect, 'permanentId' | 'cardName'>> = {
  "bear umbra": {
    grantedPTBoost: { power: 2, toughness: 2 },
    triggers: ["Whenever enchanted creature attacks, untap all lands you control"],
  },
  "snake umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    triggers: ["Whenever enchanted creature deals damage to a player, you may draw a card"],
  },
  "spider umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['reach'],
  },
  "boar umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
  },
  "mammoth umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
    grantedKeywords: ['vigilance'],
  },
  "hyena umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['first strike'],
  },
  "drake umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
    grantedKeywords: ['flying'],
  },
  "eel umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    // Also has flash
  },
  "felidar umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['lifelink'],
  },
};

export function detectUmbraEffect(card: any, permanent: any): TotemArmorEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Check if it has totem armor
  const hasTotemArmor = oracleText.includes('totem armor') || 
                        card?.keywords?.some((k: string) => k.toLowerCase() === 'totem armor');
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_UMBRA_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  // Generic umbra detection
  if (hasTotemArmor || cardName.includes('umbra')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown Umbra',
    };
  }
  
  return null;
}

// Graveyard Triggers (Eldrazi mass shuffle / Gaea's Blessing mill-shuffle)
export { checkGraveyardTrigger } from "../zone-manipulation.js";

// ============================================================================
// Control Change Effects (Reins of Power, Humble Defector, etc.)
// ============================================================================

export interface ControlChangeEffect {
  cardName: string;
  effectType: 'exchange_creatures' | 'give_control' | 'steal_control' | 'donate';
  duration: 'until_eot' | 'permanent' | 'until_condition';
  targets?: string;
  restrictions?: string[];
}

const KNOWN_CONTROL_CHANGE_EFFECTS: Record<string, ControlChangeEffect> = {
  "reins of power": {
    cardName: "Reins of Power",
    effectType: 'exchange_creatures',
    duration: 'until_eot',
    targets: "You and target opponent exchange control of all creatures",
    restrictions: ["Untap all creatures", "Creatures gain haste until end of turn"],
  },
  "humble defector": {
    cardName: "Humble Defector",
    effectType: 'give_control',
    duration: 'permanent',
    targets: "Target opponent gains control of Humble Defector",
    restrictions: ["Activate only as a sorcery", "Draw two cards first"],
  },
  "act of treason": {
    cardName: "Act of Treason",
    effectType: 'steal_control',
    duration: 'until_eot',
    targets: "Target creature",
    restrictions: ["Untap that creature", "It gains haste"],
  },
  "threaten": {
    cardName: "Threaten",
    effectType: 'steal_control',
    duration: 'until_eot',
    targets: "Target creature",
    restrictions: ["Untap that creature", "It gains haste"],
  },
  "dominate": {
    cardName: "Dominate",
    effectType: 'steal_control',
    duration: 'permanent',
    targets: "Target creature with mana value X or less",
  },
};

export function detectControlChangeEffect(card: any): ControlChangeEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_CONTROL_CHANGE_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}

// ============================================================================
// Infect and Poison Effects (Triumph of the Hordes, etc.)
// ============================================================================

export interface InfectGrantEffect {
  cardName: string;
  grantsTo: 'all_creatures' | 'target_creature' | 'equipped_creature';
  duration: 'until_eot' | 'permanent';
  additionalBoost?: { power: number; toughness: number };
  additionalKeywords?: string[];
}

/**
 * Oracle-only: "has/gains/have infect" grants (Phyresis, Grafted Exoskeleton,
 * Triumph of the Hordes, Tainted Strike). Printed Infect keyword and
 * "creatures you control with infect" filters are not grants. Live combat
 * uses StaticEffectSpec host/lord grants, not this detector.
 */
export function detectInfectGrantEffect(card: any): InfectGrantEffect | null {
  const oracle = String(card?.oracle_text || card?.text || '');
  if (!oracle) return null;
  const lower = oracle.toLowerCase();
  if (!/(?:has|have|gains?|gain)\s+(?:[\w\s,/]+\s+and\s+)?infect\b/.test(lower)) {
    return null;
  }

  const untilEot = /\buntil end of turn\b/.test(lower);
  const hostGrant = /(?:equipped|enchanted)\s+creature/.test(lower);
  const allCreatures = /\bcreatures you control\b/.test(lower);
  const boostMatch = lower.match(/gets?\s+([+-]?\d+)\s*\/\s*([+-]?\d+)/);
  const additionalBoost = boostMatch
    ? { power: parseInt(boostMatch[1], 10), toughness: parseInt(boostMatch[2], 10) }
    : undefined;
  const additionalKeywords: string[] = ['infect'];
  if (/(?:trample and infect|infect and trample)/.test(lower)) {
    additionalKeywords.unshift('trample');
  }

  return {
    cardName: String(card?.name || ''),
    grantsTo: hostGrant ? 'equipped_creature' : allCreatures ? 'all_creatures' : 'target_creature',
    duration: untilEot ? 'until_eot' : 'permanent',
    additionalBoost,
    additionalKeywords,
  };
}

// ============================================================================
// Temple Bell and Group Draw Effects
// ============================================================================

export interface GroupDrawEffect {
  permanentId: string;
  cardName: string;
  cost: string;
  drawAmount: number;
  affectedPlayers: 'all' | 'each_opponent' | 'you' | 'target_player';
  additionalEffects?: string[];
}

const KNOWN_GROUP_DRAW_EFFECTS: Record<string, Omit<GroupDrawEffect, 'permanentId' | 'cardName'>> = {
  "temple bell": {
    cost: "{T}",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
  "howling mine": {
    cost: "Static (at draw step)",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
  "font of mythos": {
    cost: "Static (at draw step)",
    drawAmount: 2,
    affectedPlayers: 'all',
  },
  "seizan, perverter of truth": {
    cost: "Static (at upkeep)",
    drawAmount: 2,
    affectedPlayers: 'all',
    additionalEffects: ["Each player loses 2 life"],
  },
  "master of the feast": {
    cost: "Static (at your upkeep)",
    drawAmount: 1,
    affectedPlayers: 'each_opponent',
  },
  "kami of the crescent moon": {
    cost: "Static (at draw step)",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
};

export function detectGroupDrawEffect(card: any, permanent: any): GroupDrawEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_GROUP_DRAW_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Myriad Landscape and Multi-Target Land Search
// ============================================================================

/**
 * Lands that search for multiple lands with a shared type:
 * - Myriad Landscape: Search for 2 basic lands that share a land type
 * - Blighted Woodland: Search for 2 basic lands
 * - Krosan Verge: Search for a Forest and a Plains
 */
export interface MultiTargetLandSearch {
  permanentId: string;
  cardName: string;
  cost: string;
  searchCount: number;
  landTypeRestriction: 'share_type' | 'basic' | 'specific_types';
  specificTypes?: string[];
  putOntoTapped: boolean;
  requiresSacrifice: boolean;
}

const KNOWN_MULTI_TARGET_LAND_SEARCH: Record<string, Omit<MultiTargetLandSearch, 'permanentId' | 'cardName'>> = {
  "myriad landscape": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'share_type',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "blighted woodland": {
    cost: "{3}{G}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'basic',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "krosan verge": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'specific_types',
    specificTypes: ['forest', 'plains'],
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "terminal moraine": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 1,
    landTypeRestriction: 'basic',
    putOntoTapped: false,
    requiresSacrifice: true,
  },
  "warped landscape": {
    cost: "{1}, {T}, Sacrifice ~",
    searchCount: 1,
    landTypeRestriction: 'basic',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
};

export function detectMultiTargetLandSearch(card: any, permanent: any): MultiTargetLandSearch | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, searchInfo] of Object.entries(KNOWN_MULTI_TARGET_LAND_SEARCH)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...searchInfo,
      };
    }
  }
  
  return null;
}

/**
 * Validate that lands share a basic land type for Myriad Landscape
 */
export function validateSharedLandType(land1: any, land2: any): boolean {
  const typeLine1 = (land1?.card?.type_line || "").toLowerCase();
  const typeLine2 = (land2?.card?.type_line || "").toLowerCase();
  
  const basicTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  
  for (const basicType of basicTypes) {
    if (typeLine1.includes(basicType) && typeLine2.includes(basicType)) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Castle Garenbrig and Conditional ETB Tapped
// ============================================================================

/**
 * Lands that enter tapped unless a condition is met:
 * - Castle Garenbrig: Unless you control a Forest
 * - Castle Vantress: Unless you control an Island
 * - Castle Locthwain: Unless you control a Swamp
 * - Castle Embereth: Unless you control a Mountain
 * - Castle Ardenvale: Unless you control a Plains
 * - Checklands (Dragonskull Summit, etc.): Unless you control a [type]
 */
export interface ConditionalETBTapped {
  cardName: string;
  condition: string;
  requiredLandType?: string;
  requiredLandTypes?: string[];
  alternateCondition?: string;
}

const KNOWN_CONDITIONAL_ETB_TAPPED: Record<string, ConditionalETBTapped> = {
  // Castle lands (Eldraine)
  "castle garenbrig": {
    cardName: "Castle Garenbrig",
    condition: "Unless you control a Forest",
    requiredLandType: 'forest',
  },
  "castle vantress": {
    cardName: "Castle Vantress",
    condition: "Unless you control an Island",
    requiredLandType: 'island',
  },
  "castle locthwain": {
    cardName: "Castle Locthwain",
    condition: "Unless you control a Swamp",
    requiredLandType: 'swamp',
  },
  "castle embereth": {
    cardName: "Castle Embereth",
    condition: "Unless you control a Mountain",
    requiredLandType: 'mountain',
  },
  "castle ardenvale": {
    cardName: "Castle Ardenvale",
    condition: "Unless you control a Plains",
    requiredLandType: 'plains',
  },
  // Checklands (M10/Innistrad)
  "dragonskull summit": {
    cardName: "Dragonskull Summit",
    condition: "Unless you control a Swamp or a Mountain",
    requiredLandTypes: ['swamp', 'mountain'],
  },
  "drowned catacomb": {
    cardName: "Drowned Catacomb",
    condition: "Unless you control an Island or a Swamp",
    requiredLandTypes: ['island', 'swamp'],
  },
  "glacial fortress": {
    cardName: "Glacial Fortress",
    condition: "Unless you control a Plains or an Island",
    requiredLandTypes: ['plains', 'island'],
  },
  "rootbound crag": {
    cardName: "Rootbound Crag",
    condition: "Unless you control a Mountain or a Forest",
    requiredLandTypes: ['mountain', 'forest'],
  },
  "sunpetal grove": {
    cardName: "Sunpetal Grove",
    condition: "Unless you control a Forest or a Plains",
    requiredLandTypes: ['forest', 'plains'],
  },
  "clifftop retreat": {
    cardName: "Clifftop Retreat",
    condition: "Unless you control a Mountain or a Plains",
    requiredLandTypes: ['mountain', 'plains'],
  },
  "hinterland harbor": {
    cardName: "Hinterland Harbor",
    condition: "Unless you control a Forest or an Island",
    requiredLandTypes: ['forest', 'island'],
  },
  "isolated chapel": {
    cardName: "Isolated Chapel",
    condition: "Unless you control a Plains or a Swamp",
    requiredLandTypes: ['plains', 'swamp'],
  },
  "sulfur falls": {
    cardName: "Sulfur Falls",
    condition: "Unless you control an Island or a Mountain",
    requiredLandTypes: ['island', 'mountain'],
  },
  "woodland cemetery": {
    cardName: "Woodland Cemetery",
    condition: "Unless you control a Swamp or a Forest",
    requiredLandTypes: ['swamp', 'forest'],
  },
};

export function detectConditionalETBTapped(card: any): ConditionalETBTapped | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, condition] of Object.entries(KNOWN_CONDITIONAL_ETB_TAPPED)) {
    if (cardName.includes(knownName)) {
      return condition;
    }
  }
  
  // Dynamic detection from oracle text
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Pattern: "enters the battlefield tapped unless you control a [land type]" or "enters tapped unless..."
  // Supports both old "enters the battlefield tapped" and new Bloomburrow "enters tapped" templates
  const unlessControlMatch = oracleText.match(
    /(?:this land )?enters(?: the battlefield)? tapped unless you control (?:a|an) (\w+)(?: or (?:a|an) (\w+))?/i
  );
  
  if (unlessControlMatch) {
    const type1 = unlessControlMatch[1];
    const type2 = unlessControlMatch[2];
    
    if (type2) {
      return {
        cardName: card?.name || 'Unknown',
        condition: `Unless you control a ${type1} or a ${type2}`,
        requiredLandTypes: [type1, type2],
      };
    } else {
      return {
        cardName: card?.name || 'Unknown',
        condition: `Unless you control a ${type1}`,
        requiredLandType: type1,
      };
    }
  }
  
  return null;
}

/**
 * Check if the conditional ETB tapped condition is met (enters untapped)
 */
export function checkConditionalETBMet(
  condition: ConditionalETBTapped,
  gameState: any,
  playerId: string
): boolean {
  const battlefield = gameState?.battlefield || [];
  
  // Check if player controls the required land type(s)
  const controlledLands = battlefield.filter((p: any) => 
    p?.controller === playerId &&
    (p.card?.type_line || '').toLowerCase().includes('land')
  );
  
  if (condition.requiredLandType) {
    return controlledLands.some((land: any) => 
      (land.card?.type_line || '').toLowerCase().includes(condition.requiredLandType!)
    );
  }
  
  if (condition.requiredLandTypes) {
    return controlledLands.some((land: any) => {
      const typeLine = (land.card?.type_line || '').toLowerCase();
      return condition.requiredLandTypes!.some(type => typeLine.includes(type));
    });
  }
  
  return false;
}

// ============================================================================
// Genesis Wave and Library Reveal/Play Effects
// ============================================================================

/**
 * Cards that reveal cards from library and put them onto battlefield:
 * - Genesis Wave: Reveal X cards, put permanents with MV X or less onto battlefield
 * - Collected Company: Look at top 6, put 2 creatures (MV 3 or less) onto battlefield
 * - Finale of Devastation: Search for creature, put onto battlefield
 * - Chord of Calling: Search for creature with MV X or less
 * - Green Sun's Zenith: Search for green creature with MV X or less
 */
export interface LibraryRevealPlayEffect {
  cardName: string;
  revealCount: number | 'X';
  xMultiplier?: number;
  filterType: 'permanent_mv' | 'creature_mv' | 'land' | 'any';
  maxMV?: number | 'X';
  destination: 'battlefield' | 'hand' | 'graveyard' | 'bottom';
  additionalEffect?: string;
}

const KNOWN_LIBRARY_REVEAL_PLAY: Record<string, LibraryRevealPlayEffect> = {
  "genesis wave": {
    cardName: "Genesis Wave",
    revealCount: 'X',
    filterType: 'permanent_mv',
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "Put the rest on the bottom of your library in any order",
  },
  "collected company": {
    cardName: "Collected Company",
    revealCount: 6,
    filterType: 'creature_mv',
    maxMV: 3,
    destination: 'battlefield',
    additionalEffect: "Put up to 2 creatures onto the battlefield",
  },
  "finale of devastation": {
    cardName: "Finale of Devastation",
    revealCount: 'X',
    filterType: 'creature_mv',
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "If X is 10 or more, creatures get +X/+X and haste",
  },
  "chord of calling": {
    cardName: "Chord of Calling",
    revealCount: 0, // Searches directly, doesn't reveal
    filterType: 'creature_mv',
    maxMV: 'X',
    destination: 'battlefield',
  },
  "green sun's zenith": {
    cardName: "Green Sun's Zenith",
    revealCount: 0, // Searches directly
    filterType: 'creature_mv', // Green creature specifically
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "Shuffle this card into your library",
  },
  "natural order": {
    cardName: "Natural Order",
    revealCount: 0, // Searches directly
    filterType: 'creature_mv', // Green creature specifically
    destination: 'battlefield',
    additionalEffect: "Sacrifice a green creature as additional cost",
  },
  "see the unwritten": {
    cardName: "See the Unwritten",
    revealCount: 8,
    filterType: 'creature_mv',
    destination: 'battlefield',
    additionalEffect: "Ferocious: Put 2 creatures if you control creature with power 4+",
  },
};

export function detectLibraryRevealPlayEffect(card: any): LibraryRevealPlayEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_LIBRARY_REVEAL_PLAY)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}

// NOTE: Reanimate Effects have been moved to ./triggers/reanimate.ts
// Re-exports are at the top of this file

// ============================================================================
// Eladamri and Top Card Viewing Effects
// ============================================================================

/**
 * Cards that let you look at the top card(s) of your library:
 * - Eladamri, Lord of Leaves: Look at top card, may play forests
 * - Courser of Kruphix: Play lands from top
 * - Oracle of Mul Daya: Play lands from top, additional land drop
 * - Vizier of the Menagerie: Cast creatures from top
 * - Future Sight: Play cards from top
 */
export interface TopCardViewEffect {
  permanentId: string;
  cardName: string;
  viewCount: number;
  revealToAll: boolean;
  canPlayTypes?: string[];
  additionalLandDrop?: boolean;
}

const KNOWN_TOP_CARD_VIEW: Record<string, Omit<TopCardViewEffect, 'permanentId' | 'cardName'>> = {
  "courser of kruphix": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land'],
  },
  "oracle of mul daya": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land'],
    additionalLandDrop: true,
  },
  "vizier of the menagerie": {
    viewCount: 1,
    revealToAll: false, // Can look, but only revealed when you cast
    canPlayTypes: ['creature'],
  },
  "future sight": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
  },
  "precognition field": {
    viewCount: 1,
    revealToAll: false,
    canPlayTypes: ['instant', 'sorcery'],
  },
  "bolas's citadel": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
    // Note: Pays life equal to MV instead of mana cost
  },
  "experimental frenzy": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
    // Note: Can't play cards from hand
  },
  "radha, heart of keld": {
    viewCount: 1,
    revealToAll: false,
    canPlayTypes: ['land'],
  },
  "garruk's horde": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['creature'],
  },
};

export function detectTopCardViewEffect(card: any, permanent: any): TopCardViewEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_TOP_CARD_VIEW)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Traverse the Outlands and Power-Based Land Search
// ============================================================================

/**
 * Cards that search for lands based on creature power or other variable:
 * - Traverse the Outlands: Search for X basic lands where X = greatest power
 * - Boundless Realms: Search for basic lands up to number you control
 * - Reshape the Earth: Search for any 10 lands
 */
export interface PowerBasedLandSearch {
  cardName: string;
  searchBasis: 'greatest_power' | 'lands_controlled' | 'fixed';
  landType: 'basic' | 'any';
  fixedCount?: number;
  entersTapped: boolean;
}

const KNOWN_POWER_BASED_LAND_SEARCH: Record<string, PowerBasedLandSearch> = {
  "traverse the outlands": {
    cardName: "Traverse the Outlands",
    searchBasis: 'greatest_power',
    landType: 'basic',
    entersTapped: true,
  },
  "boundless realms": {
    cardName: "Boundless Realms",
    searchBasis: 'lands_controlled',
    landType: 'basic',
    entersTapped: true,
  },
  "reshape the earth": {
    cardName: "Reshape the Earth",
    searchBasis: 'fixed',
    landType: 'any',
    fixedCount: 10,
    entersTapped: true,
  },
  "scapeshift": {
    cardName: "Scapeshift",
    searchBasis: 'lands_controlled', // Sacrifice any number, search that many
    landType: 'any',
    entersTapped: false,
  },
};

export function detectPowerBasedLandSearch(card: any): PowerBasedLandSearch | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, searchInfo] of Object.entries(KNOWN_POWER_BASED_LAND_SEARCH)) {
    if (cardName.includes(knownName)) {
      return searchInfo;
    }
  }
  
  return null;
}

/**
 * Calculate the number of lands to search for based on game state
 */
export function calculateLandSearchCount(
  effect: PowerBasedLandSearch,
  gameState: any,
  playerId: string
): number {
  const battlefield = gameState?.battlefield || [];
  
  if (effect.searchBasis === 'fixed' && effect.fixedCount) {
    return effect.fixedCount;
  }
  
  if (effect.searchBasis === 'greatest_power') {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      // Current power (anthems, equipment, pumps, counters)
      const { power } = getCurrentPowerToughnessForRules(perm, gameState);
      if (power > greatestPower) greatestPower = power;
    }
    return greatestPower;
  }
  
  if (effect.searchBasis === 'lands_controlled') {
    return battlefield.filter((p: any) =>
      p?.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('land')
    ).length;
  }
  
  return 0;
}

// ============================================================================
// Charge Counter Support (Everflowing Chalice, Evendo, etc.)
// ============================================================================

/**
 * Permanents that use charge counters for effects:
 * - Everflowing Chalice: Add {C} for each charge counter
 * - Astral Cornucopia: Add mana equal to charge counters
 * - Lux Cannon: Remove 3 counters to destroy permanent
 * - Titan Forge: Remove 3 counters to create 9/9 Golem
 */
export interface ChargeCounterAbility {
  permanentId: string;
  cardName: string;
  addCounterCost?: string;
  useCountersCost?: string;
  useCountersAmount?: number;
  effect: string;
  effectType: 'mana_per_counter' | 'threshold_effect' | 'per_counter_effect';
}

const KNOWN_CHARGE_COUNTER_ABILITIES: Record<string, Omit<ChargeCounterAbility, 'permanentId' | 'cardName'>> = {
  "everflowing chalice": {
    effect: "Add {C} for each charge counter",
    effectType: 'mana_per_counter',
  },
  "astral cornucopia": {
    effect: "Add X mana of any one color where X is charge counters",
    effectType: 'mana_per_counter',
  },
  "lux cannon": {
    addCounterCost: "{T}",
    useCountersCost: "{T}, Remove 3 charge counters",
    useCountersAmount: 3,
    effect: "Destroy target permanent",
    effectType: 'threshold_effect',
  },
  "titan forge": {
    addCounterCost: "{3}, {T}",
    useCountersCost: "{T}, Remove 3 charge counters",
    useCountersAmount: 3,
    effect: "Create a 9/9 colorless Golem artifact creature token",
    effectType: 'threshold_effect',
  },
  "gemstone array": {
    addCounterCost: "{2}",
    useCountersCost: "Remove a charge counter",
    useCountersAmount: 1,
    effect: "Add one mana of any color",
    effectType: 'per_counter_effect',
  },
  "surge node": {
    addCounterCost: "{1}, {T}",
    useCountersCost: "{1}, {T}, Remove a charge counter",
    useCountersAmount: 1,
    effect: "Put a charge counter on target artifact",
    effectType: 'per_counter_effect',
  },
};

export function detectChargeCounterAbility(card: any, permanent: any): ChargeCounterAbility | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, abilityInfo] of Object.entries(KNOWN_CHARGE_COUNTER_ABILITIES)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...abilityInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Special Cards: Chameleon Colossus, March of the World Ooze, etc.
// ============================================================================

/**
 * Cards with unique activated or triggered abilities that need special handling:
 * - Chameleon Colossus: Double power/toughness activated ability
 * - March of the Ooze: Token creation based on counters
 * - Tale of Katara and Toph: Saga with unique effects
 * - The Seriema: Transform conditions
 */
export interface SpecialCardEffect {
  permanentId: string;
  cardName: string;
  effectType: 'double_pt' | 'counter_based_tokens' | 'saga' | 'transform' | 'protection_from_all' | 'changeling';
  activatedAbilityCost?: string;
  effect: string;
  additionalInfo?: Record<string, any>;
}

const KNOWN_SPECIAL_CARDS: Record<string, Omit<SpecialCardEffect, 'permanentId' | 'cardName'>> = {
  "chameleon colossus": {
    effectType: 'double_pt',
    activatedAbilityCost: "{2}{G}{G}",
    effect: "Chameleon Colossus gets +X/+X until end of turn, where X is its power",
    additionalInfo: {
      hasChangeling: true,
      hasProtectionFromBlack: true,
    },
  },
  "progenitus": {
    effectType: 'protection_from_all',
    effect: "Protection from everything",
    additionalInfo: {
      shuffleWhenToGraveyard: true,
    },
  },
  "mistform ultimus": {
    effectType: 'changeling',
    effect: "Is every creature type",
  },
  "morophon, the boundless": {
    effectType: 'changeling',
    effect: "Is every creature type, chosen type spells cost WUBRG less",
  },
};

export function detectSpecialCardEffect(card: any, permanent: any): SpecialCardEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_SPECIAL_CARDS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  // Dynamic detection for changeling
  if (oracleText.includes('changeling') || 
      (card?.keywords || []).some((k: string) => k.toLowerCase() === 'changeling')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'changeling',
      effect: "Is every creature type",
    };
  }
  
  // Dynamic detection for protection from everything
  if (oracleText.includes('protection from everything')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'protection_from_all',
      effect: "Protection from everything",
    };
  }
  
  // Dynamic detection for double power/toughness
  if (oracleText.match(/gets?\s+\+x\/\+x.*where\s+x\s+is\s+its\s+power/i)) {
    const costMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:/);
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'double_pt',
      activatedAbilityCost: costMatch ? costMatch[1] : undefined,
      effect: "Gets +X/+X where X is its power",
    };
  }
  
  return null;
}
