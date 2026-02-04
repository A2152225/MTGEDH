/**
 * tokenCreation.ts
 * 
 * Comprehensive token creation system with automatic trigger detection
 * and UI prompts for player decisions.
 * 
 * Rules Reference:
 * - Rule 701.7: Create (keyword action)
 * - Rule 111: Tokens
 * - Rule 603: Triggered Abilities (for token-related triggers)
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';

/**
 * Simple UUID generator for token IDs
 */
function generateTokenId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Token characteristics
 */
export interface TokenCharacteristics {
  readonly name: string;
  readonly colors: readonly string[];  // 'W', 'U', 'B', 'R', 'G'
  readonly types: readonly string[];   // 'Creature', 'Artifact', etc.
  readonly subtypes: readonly string[]; // 'Zombie', 'Treasure', etc.
  readonly power?: number;
  readonly toughness?: number;
  readonly abilities: readonly string[]; // Keywords and text abilities
  readonly isLegendary?: boolean;
  readonly isArtifact?: boolean;
  readonly entersTapped?: boolean;
}

/**
 * Token creation request
 */
export interface TokenCreationRequest {
  readonly characteristics: TokenCharacteristics;
  readonly count: number;
  readonly controllerId: PlayerID;
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly withCounters?: Record<string, number>;
  readonly copyOf?: string; // For copy tokens
}

/**
 * Created token result
 */
export interface CreatedToken {
  readonly id: string;
  readonly token: BattlefieldPermanent;
  readonly triggersETB: boolean;
}

/**
 * Token creation result with trigger info
 */
export interface TokenCreationResult {
  readonly tokens: readonly CreatedToken[];
  readonly etbTriggers: readonly ETBTriggerInfo[];
  readonly otherTriggers: readonly TokenTriggerInfo[];
  readonly log: readonly string[];
}

/**
 * ETB trigger info for tokens
 */
export interface ETBTriggerInfo {
  readonly tokenId: string;
  readonly tokenName: string;
  readonly controllerId: PlayerID;
  readonly effect: string;
  readonly requiresChoice: boolean;
  readonly choiceType?: 'target' | 'may' | 'choice';
  readonly options?: readonly string[];
}

/**
 * Other token-related triggers (like "whenever a token is created")
 */
export interface TokenTriggerInfo {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly effect: string;
  readonly triggeredByTokenId: string;
  readonly requiresChoice: boolean;
}

/**
 * Common token definitions for quick creation
 */
export const COMMON_TOKENS: Record<string, TokenCharacteristics> = {
  // Artifact tokens
  'Treasure': {
    name: 'Treasure',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Treasure'],
    abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
    isArtifact: true,
  },
  'Gold': {
    name: 'Gold',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Gold'],
    abilities: ['Sacrifice this token: Add one mana of any color.'],
    isArtifact: true,
  },
  'Food': {
    name: 'Food',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Food'],
    abilities: ['{2}, {T}, Sacrifice this artifact: You gain 3 life.'],
    isArtifact: true,
  },
  'Clue': {
    name: 'Clue',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Clue'],
    abilities: ['{2}, Sacrifice this artifact: Draw a card.'],
    isArtifact: true,
  },
  'Blood': {
    name: 'Blood',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Blood'],
    abilities: ['{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.'],
    isArtifact: true,
  },
  'Junk': {
    name: 'Junk',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Junk'],
    abilities: ['{T}, Sacrifice this artifact: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.'],
    isArtifact: true,
  },
  'Map': {
    name: 'Map',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Map'],
    abilities: ['{1}, {T}, Sacrifice this artifact: Target creature you control explores.'],
    isArtifact: true,
  },
  'Incubator': {
    name: 'Incubator',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Incubator'],
    abilities: ['{2}: Transform this artifact.'],
    isArtifact: true,
  },
  'Lander': {
    name: 'Lander',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Lander'],
    abilities: ['{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.'],
    isArtifact: true,
  },
  'Mutagen': {
    name: 'Mutagen',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Mutagen'],
    abilities: ['{1}, {T}, Sacrifice this token: Put a +1/+1 counter on target creature. Activate only as a sorcery.'],
    isArtifact: true,
  },
  'Powerstone': {
    name: 'Powerstone',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Powerstone'],
    abilities: ['{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.'],
    isArtifact: true,
  },
  'Vehicle': {
    name: 'Vehicle',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Vehicle'],
    power: 3,
    toughness: 2,
    abilities: ['Crew 1 (Tap any number of creatures you control with total power 1 or more: This token becomes an artifact creature until end of turn.)'],
    isArtifact: true,
  },
  'Nalaar Aetherjet': {
    name: 'Nalaar Aetherjet',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Vehicle'],
    abilities: ['Flying', 'Crew 2 (Tap any number of creatures you control with total power 2 or more: This token becomes an artifact creature until end of turn.)'],
    isArtifact: true,
  },
  'Rock': {
    name: 'Rock',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Equipment'],
    abilities: ['Equipped creature has "{1}, {T}, Sacrifice Rock: This creature deals 2 damage to any target."', 'Equip {1}'],
    isArtifact: true,
  },
  'Sword': {
    name: 'Sword',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Equipment'],
    abilities: ['Equipped creature gets +1/+1', 'Equip {2}'],
    isArtifact: true,
  },
  'Stoneforged Blade': {
    name: 'Stoneforged Blade',
    colors: [],
    types: ['Artifact'],
    subtypes: ['Equipment'],
    abilities: ['Indestructible', 'Equipped creature gets +5/+5 and has double strike.', 'Equip {0}'],
    isArtifact: true,
  },
  
  // Common creature tokens
  '1/1 Soldier': {
    name: 'Soldier',
    colors: ['W'],
    types: ['Creature'],
    subtypes: ['Soldier'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  '1/1 Spirit (Flying)': {
    name: 'Spirit',
    colors: ['W'],
    types: ['Creature'],
    subtypes: ['Spirit'],
    power: 1,
    toughness: 1,
    abilities: ['Flying'],
  },
  '2/2 Zombie': {
    name: 'Zombie',
    colors: ['B'],
    types: ['Creature'],
    subtypes: ['Zombie'],
    power: 2,
    toughness: 2,
    abilities: [],
  },
  '1/1 Goblin': {
    name: 'Goblin',
    colors: ['R'],
    types: ['Creature'],
    subtypes: ['Goblin'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  '3/3 Beast': {
    name: 'Beast',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Beast'],
    power: 3,
    toughness: 3,
    abilities: [],
  },
  '1/1 Saproling': {
    name: 'Saproling',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Saproling'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  '1/1 Thopter (Flying)': {
    name: 'Thopter',
    colors: [],
    types: ['Artifact', 'Creature'],
    subtypes: ['Thopter'],
    power: 1,
    toughness: 1,
    abilities: ['Flying'],
    isArtifact: true,
  },
  '1/1 Servo': {
    name: 'Servo',
    colors: [],
    types: ['Artifact', 'Creature'],
    subtypes: ['Servo'],
    power: 1,
    toughness: 1,
    abilities: [],
    isArtifact: true,
  },
  '4/4 Angel (Flying)': {
    name: 'Angel',
    colors: ['W'],
    types: ['Creature'],
    subtypes: ['Angel'],
    power: 4,
    toughness: 4,
    abilities: ['Flying'],
  },
  '5/5 Dragon (Flying)': {
    name: 'Dragon',
    colors: ['R'],
    types: ['Creature'],
    subtypes: ['Dragon'],
    power: 5,
    toughness: 5,
    abilities: ['Flying'],
  },
  '2/2 Wolf': {
    name: 'Wolf',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Wolf'],
    power: 2,
    toughness: 2,
    abilities: [],
  },
  '1/1 Human': {
    name: 'Human',
    colors: ['W'],
    types: ['Creature'],
    subtypes: ['Human'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  // Mobilize - Red Warrior tokens (tapped, attacking, sacrifice at end step)
  '1/1 Warrior': {
    name: 'Warrior',
    colors: ['R'],
    types: ['Creature'],
    subtypes: ['Warrior'],
    power: 1,
    toughness: 1,
    abilities: [],
    entersTapped: true,
  },
  // Faerie Rogue for Bitterblossom
  '1/1 Faerie Rogue (Flying)': {
    name: 'Faerie Rogue',
    colors: ['B'],
    types: ['Creature'],
    subtypes: ['Faerie', 'Rogue'],
    power: 1,
    toughness: 1,
    abilities: ['Flying'],
  },
  // Eldrazi tokens
  '0/1 Eldrazi Spawn': {
    name: 'Eldrazi Spawn',
    colors: [],
    types: ['Creature'],
    subtypes: ['Eldrazi', 'Spawn'],
    power: 0,
    toughness: 1,
    abilities: ['Sacrifice this creature: Add {C}.'],
  },
  '1/1 Eldrazi Scion': {
    name: 'Eldrazi Scion',
    colors: [],
    types: ['Creature'],
    subtypes: ['Eldrazi', 'Scion'],
    power: 1,
    toughness: 1,
    abilities: ['Sacrifice this creature: Add {C}.'],
  },
  // Plant token for Avenger of Zendikar
  '0/1 Plant': {
    name: 'Plant',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Plant'],
    power: 0,
    toughness: 1,
    abilities: [],
  },
  // Elf Warrior
  '1/1 Elf Warrior': {
    name: 'Elf Warrior',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Elf', 'Warrior'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  // Soldier with haste (Assemble the Legion)
  '1/1 Soldier (Haste)': {
    name: 'Soldier',
    colors: ['R', 'W'],
    types: ['Creature'],
    subtypes: ['Soldier'],
    power: 1,
    toughness: 1,
    abilities: ['Haste'],
  },
  // Cat token
  '1/1 Cat': {
    name: 'Cat',
    colors: ['W'],
    types: ['Creature'],
    subtypes: ['Cat'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  // Snake token
  '1/1 Snake': {
    name: 'Snake',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Snake'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  // Bird token
  '1/1 Bird (Flying)': {
    name: 'Bird',
    colors: ['W'],
    types: ['Creature'],
    subtypes: ['Bird'],
    power: 1,
    toughness: 1,
    abilities: ['Flying'],
  },
  // Elemental token (Ball Lightning style)
  '3/1 Elemental (Trample, Haste)': {
    name: 'Elemental',
    colors: ['R'],
    types: ['Creature'],
    subtypes: ['Elemental'],
    power: 3,
    toughness: 1,
    abilities: ['Trample', 'Haste'],
  },
  // Insect token
  '1/1 Insect': {
    name: 'Insect',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Insect'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  // Wurm token
  '6/6 Wurm (Trample)': {
    name: 'Wurm',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Wurm'],
    power: 6,
    toughness: 6,
    abilities: ['Trample'],
  },
  // Squirrel token (Deranged Hermit, Drey Keeper, Squirrel Nest, etc.)
  '1/1 Squirrel': {
    name: 'Squirrel',
    colors: ['G'],
    types: ['Creature'],
    subtypes: ['Squirrel'],
    power: 1,
    toughness: 1,
    abilities: [],
  },
  // Merfolk token with hexproof (Deeproot Waters)
  '1/1 Merfolk (Hexproof)': {
    name: 'Merfolk',
    colors: ['U'],
    types: ['Creature'],
    subtypes: ['Merfolk'],
    power: 1,
    toughness: 1,
    abilities: ['Hexproof'],
  },
};

/**
 * Create a single token permanent
 */
export function createTokenPermanent(
  characteristics: TokenCharacteristics,
  controllerId: PlayerID,
  sourceId?: string,
  withCounters?: Record<string, number>
): BattlefieldPermanent {
  const tokenId = `token-${generateTokenId()}`;
  const timestamp = Date.now();
  
  // Build the type line
  const typeLineParts: string[] = [];
  if (characteristics.isLegendary) typeLineParts.push('Legendary');
  typeLineParts.push(...characteristics.types);
  if (characteristics.subtypes.length > 0) {
    typeLineParts.push('—');
    typeLineParts.push(...characteristics.subtypes);
  }
  
  const token: BattlefieldPermanent = {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: characteristics.entersTapped || false,
    summoningSickness: characteristics.types.includes('Creature'),
    counters: withCounters || {},
    attachedTo: undefined,
    attachments: [],
    modifiers: [],
    card: {
      id: tokenId,
      name: characteristics.name,
      type_line: typeLineParts.join(' '),
      oracle_text: characteristics.abilities.join('\n'),
      power: characteristics.power?.toString(),
      toughness: characteristics.toughness?.toString(),
      colors: [...characteristics.colors], // Convert readonly to mutable array
      mana_cost: '',
      cmc: 0,
      image_uris: {},
    } as KnownCardRef,
    basePower: characteristics.power,
    baseToughness: characteristics.toughness,
    isToken: true,
    // Note: sourceId passed to function can be used for trigger tracking
    // but is not stored on the permanent itself
  };
  
  return token;
}

/**
 * Parse token creation from oracle text
 * Returns token characteristics and count if the text describes token creation
 */
export function parseTokenCreationFromText(
  oracleText: string
): { characteristics: TokenCharacteristics; count: number } | null {
  const lowerText = oracleText.toLowerCase();
  
  // Common patterns for token creation
  // "create a/an X" or "create N X"
  const createMatch = lowerText.match(
    /create\s+(?:a|an|(\d+))\s+(\d+\/\d+)?\s*([a-z,\s]+?)(?:\s+(artifact|creature|enchantment))?(?:\s+tokens?)?/i
  );
  
  if (!createMatch) return null;
  
  const count = createMatch[1] ? parseInt(createMatch[1], 10) : 1;
  const ptMatch = createMatch[2]?.match(/(\d+)\/(\d+)/);
  const power = ptMatch ? parseInt(ptMatch[1], 10) : undefined;
  const toughness = ptMatch ? parseInt(ptMatch[2], 10) : undefined;
  const descriptors = createMatch[3]?.trim() || '';
  const mainType = createMatch[4]?.trim() || '';
  
  // Extract colors from the full text (not just descriptors)
  const colors: string[] = [];
  if (lowerText.includes('white')) colors.push('W');
  if (lowerText.includes('blue')) colors.push('U');
  if (lowerText.includes('black')) colors.push('B');
  if (lowerText.includes('red')) colors.push('R');
  if (lowerText.includes('green')) colors.push('G');
  
  // Extract types
  const types: string[] = [];
  if (mainType.includes('creature') || power !== undefined) types.push('Creature');
  if (mainType.includes('artifact') || descriptors.includes('artifact')) types.push('Artifact');
  if (mainType.includes('enchantment') || descriptors.includes('enchantment')) types.push('Enchantment');
  
  // If no types found, assume creature if we have P/T
  if (types.length === 0 && power !== undefined) {
    types.push('Creature');
  }
  
  // Extract subtypes (creature types)
  const subtypes: string[] = [];
  const knownCreatureTypes = [
    'soldier', 'zombie', 'goblin', 'beast', 'spirit', 'angel', 'demon', 'dragon',
    'elf', 'human', 'vampire', 'wolf', 'bird', 'cat', 'rat', 'bat', 'elemental',
    'saproling', 'servo', 'thopter', 'clue', 'treasure', 'food', 'blood', 'warrior',
    'knight', 'wizard', 'rogue', 'cleric', 'horror', 'insect', 'spider', 'snake',
  ];
  
  for (const type of knownCreatureTypes) {
    if (descriptors.includes(type)) {
      subtypes.push(type.charAt(0).toUpperCase() + type.slice(1));
    }
  }
  
  // Extract abilities from the text
  const abilities: string[] = [];
  if (lowerText.includes('flying')) abilities.push('Flying');
  if (lowerText.includes('haste')) abilities.push('Haste');
  if (lowerText.includes('lifelink')) abilities.push('Lifelink');
  if (lowerText.includes('deathtouch')) abilities.push('Deathtouch');
  if (lowerText.includes('trample')) abilities.push('Trample');
  if (lowerText.includes('vigilance')) abilities.push('Vigilance');
  if (lowerText.includes('menace')) abilities.push('Menace');
  if (lowerText.includes('first strike')) abilities.push('First strike');
  if (lowerText.includes('double strike')) abilities.push('Double strike');
  
  // Determine name from subtypes or descriptors
  let name = subtypes[0] || 'Token';
  if (descriptors.includes('treasure')) name = 'Treasure';
  if (descriptors.includes('food')) name = 'Food';
  if (descriptors.includes('clue')) name = 'Clue';
  if (descriptors.includes('blood')) name = 'Blood';
  
  return {
    characteristics: {
      name,
      colors,
      types,
      subtypes,
      power,
      toughness,
      abilities,
      isArtifact: types.includes('Artifact'),
    },
    count,
  };
}

/**
 * Detect ETB triggers from token abilities
 */
export function detectTokenETBTriggers(
  token: BattlefieldPermanent,
  controllerId: PlayerID
): ETBTriggerInfo[] {
  const triggers: ETBTriggerInfo[] = [];
  const oracleText = (token.card as KnownCardRef)?.oracle_text?.toLowerCase() || '';
  const tokenName = (token.card as KnownCardRef)?.name || 'Token';
  
  // Check for "when ~ enters the battlefield" patterns
  const etbMatch = oracleText.match(/when .* enters the battlefield,?\s*([^.]+)/i);
  if (etbMatch) {
    const effect = etbMatch[1].trim();
    const requiresChoice = effect.includes('may') || 
                          effect.includes('choose') || 
                          effect.includes('target');
    
    let choiceType: 'target' | 'may' | 'choice' | undefined;
    if (effect.includes('may')) choiceType = 'may';
    else if (effect.includes('target')) choiceType = 'target';
    else if (effect.includes('choose')) choiceType = 'choice';
    
    triggers.push({
      tokenId: token.id,
      tokenName,
      controllerId,
      effect,
      requiresChoice,
      choiceType,
    });
  }
  
  return triggers;
}

/**
 * Detect "whenever a token enters" triggers on battlefield permanents
 */
export function detectTokenCreationTriggers(
  battlefield: readonly BattlefieldPermanent[],
  newTokenId: string,
  tokenControllerId: PlayerID
): TokenTriggerInfo[] {
  const triggers: TokenTriggerInfo[] = [];
  
  for (const perm of battlefield) {
    const oracleText = (perm.card as KnownCardRef)?.oracle_text?.toLowerCase() || '';
    const permName = (perm.card as KnownCardRef)?.name || 'Permanent';
    
    // Check for "whenever a token enters"
    if (oracleText.includes('whenever') && 
        (oracleText.includes('token') || oracleText.includes('creature enters'))) {
      
      // Detect if this triggers on token creation
      const tokenEntersMatch = oracleText.match(
        /whenever (?:a|an)?\s*(?:creature|artifact)?\s*tokens?\s*(?:you control\s*)?enters/i
      );
      
      const creatureEntersMatch = oracleText.match(
        /whenever (?:a|an)?\s*(?:creature|nontoken creature)\s*enters/i
      );
      
      // Skip "nontoken" triggers for tokens
      if (creatureEntersMatch && oracleText.includes('nontoken')) {
        continue;
      }
      
      if (tokenEntersMatch || (creatureEntersMatch && !oracleText.includes('nontoken'))) {
        // Check controller requirements
        const youControl = oracleText.includes('you control');
        const opponentControl = oracleText.includes('opponent controls');
        
        // Determine if trigger applies based on controller
        const permController = perm.controller;
        const shouldTrigger = 
          (!youControl && !opponentControl) ||
          (youControl && permController === tokenControllerId) ||
          (opponentControl && permController !== tokenControllerId);
        
        if (shouldTrigger) {
          // Extract effect text
          const effectMatch = oracleText.match(
            /whenever[^,]+,\s*([^.]+)/i
          );
          const effect = effectMatch ? effectMatch[1].trim() : 'trigger effect';
          
          triggers.push({
            sourceId: perm.id,
            sourceName: permName,
            controllerId: perm.controller,
            effect,
            triggeredByTokenId: newTokenId,
            requiresChoice: effect.includes('may') || effect.includes('target'),
          });
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Create tokens with full trigger detection
 */
export function createTokens(
  request: TokenCreationRequest,
  battlefield: readonly BattlefieldPermanent[]
): TokenCreationResult {
  const tokens: CreatedToken[] = [];
  const etbTriggers: ETBTriggerInfo[] = [];
  const otherTriggers: TokenTriggerInfo[] = [];
  const log: string[] = [];
  
  for (let i = 0; i < request.count; i++) {
    // Create the token
    const token = createTokenPermanent(
      request.characteristics,
      request.controllerId,
      request.sourceId,
      request.withCounters
    );
    
    // Detect ETB triggers from the token itself
    const tokenETBs = detectTokenETBTriggers(token, request.controllerId);
    
    tokens.push({
      id: token.id,
      token,
      triggersETB: tokenETBs.length > 0,
    });
    
    etbTriggers.push(...tokenETBs);
    
    // Detect triggers from other permanents
    const creationTriggers = detectTokenCreationTriggers(
      battlefield,
      token.id,
      request.controllerId
    );
    
    otherTriggers.push(...creationTriggers);
    
    log.push(`Created ${request.characteristics.name} token`);
    if (request.sourceName) {
      log.push(`  (from ${request.sourceName})`);
    }
  }
  
  if (etbTriggers.length > 0) {
    log.push(`${etbTriggers.length} ETB trigger(s) detected`);
  }
  
  if (otherTriggers.length > 0) {
    log.push(`${otherTriggers.length} "token enters" trigger(s) detected`);
  }
  
  return {
    tokens,
    etbTriggers,
    otherTriggers,
    log,
  };
}

/**
 * Create tokens by name (using common token definitions)
 */
export function createTokensByName(
  tokenName: string,
  count: number,
  controllerId: PlayerID,
  battlefield: readonly BattlefieldPermanent[],
  sourceId?: string,
  sourceName?: string
): TokenCreationResult | null {
  const characteristics = COMMON_TOKENS[tokenName];
  if (!characteristics) {
    return null;
  }
  
  return createTokens({
    characteristics,
    count,
    controllerId,
    sourceId,
    sourceName,
  }, battlefield);
}

/**
 * Get all common token names for UI dropdown
 */
export function getCommonTokenNames(): readonly string[] {
  return Object.keys(COMMON_TOKENS);
}

/**
 * Get token characteristics by name
 */
export function getTokenCharacteristics(name: string): TokenCharacteristics | undefined {
  return COMMON_TOKENS[name];
}

export default {
  createTokens,
  createTokensByName,
  createTokenPermanent,
  parseTokenCreationFromText,
  detectTokenETBTriggers,
  detectTokenCreationTriggers,
  getCommonTokenNames,
  getTokenCharacteristics,
  COMMON_TOKENS,
};
