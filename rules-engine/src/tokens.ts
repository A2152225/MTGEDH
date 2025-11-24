/**
 * MTG Tokens - Comprehensive Token Definitions
 * 
 * Provides complete token definitions for UI tooltips and token creation.
 * Includes common tokens from across Magic's history.
 * 
 * @module tokens
 */

/**
 * Token definition with characteristics and abilities
 */
export interface TokenDefinition {
  readonly name: string;
  readonly colors: readonly string[]; // W, U, B, R, G, or empty for colorless
  readonly types: readonly string[]; // Creature types, artifact types, etc.
  readonly supertypes?: readonly string[]; // Legendary, etc.
  readonly cardTypes: readonly string[]; // Creature, Artifact, Enchantment
  readonly power?: number;
  readonly toughness?: number;
  readonly abilities: readonly string[]; // Keyword abilities and text
  readonly shortDescription: string;
  readonly fullDescription?: string;
  readonly rulesReference?: string;
  readonlysets?: readonly string[]; // Sets where this token appears
}

/**
 * Artifact tokens - Non-creature artifacts
 */
const ARTIFACT_TOKENS: readonly TokenDefinition[] = [
  {
    name: 'Treasure',
    colors: [],
    types: ['Treasure'],
    cardTypes: ['Artifact'],
    abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
    shortDescription: 'Tap and sacrifice for one mana of any color',
    fullDescription: 'Treasure is a colorless artifact token with "Tap, Sacrifice this artifact: Add one mana of any color." Treasures provide temporary mana acceleration.',
    rulesReference: 'Rule 111.10',
    sets: ['IXL', 'M19', 'ELD', 'STX', 'AFR', 'VOW', 'SNC']
  },
  {
    name: 'Food',
    colors: [],
    types: ['Food'],
    cardTypes: ['Artifact'],
    abilities: ['{2}, {T}, Sacrifice this artifact: You gain 3 life.'],
    shortDescription: 'Pay 2, tap, and sacrifice to gain 3 life',
    fullDescription: 'Food is a colorless artifact token with "{2}, {T}, Sacrifice this artifact: You gain 3 life." Common in Eldraine sets.',
    sets: ['ELD', 'MID', 'VOW']
  },
  {
    name: 'Clue',
    colors: [],
    types: ['Clue'],
    cardTypes: ['Artifact'],
    abilities: ['{2}, Sacrifice this artifact: Draw a card.'],
    shortDescription: 'Pay 2 and sacrifice to draw a card',
    fullDescription: 'Clue is a colorless artifact token with "{2}, Sacrifice this artifact: Draw a card." Introduced in Shadows over Innistrad.',
    sets: ['SOI', 'EMN', 'MID', 'VOW', 'CLU']
  },
  {
    name: 'Blood',
    colors: [],
    types: ['Blood'],
    cardTypes: ['Artifact'],
    abilities: ['{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.'],
    shortDescription: 'Pay 1, tap, discard, and sacrifice to draw',
    fullDescription: 'Blood is a colorless artifact token with "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card." Provides card filtering.',
    sets: ['VOW', 'MID']
  },
  {
    name: 'Gold',
    colors: [],
    types: ['Gold'],
    cardTypes: ['Artifact'],
    abilities: ['Sacrifice this artifact: Add one mana of any color.'],
    shortDescription: 'Sacrifice for one mana of any color',
    fullDescription: 'Gold is a colorless artifact token with "Sacrifice this artifact: Add one mana of any color." Similar to Treasure but without tap requirement.',
    sets: ['BRO', 'ONE']
  },
  {
    name: 'Powerstone',
    colors: [],
    types: ['Powerstone'],
    cardTypes: ['Artifact'],
    abilities: ['{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.'],
    shortDescription: 'Tap for colorless mana (artifacts only)',
    fullDescription: 'Powerstone is a colorless artifact token that taps for {C}, but that mana can only be spent on artifact spells.',
    sets: ['BRO', 'DMU']
  },
  {
    name: 'Map',
    colors: [],
    types: ['Map'],
    cardTypes: ['Artifact'],
    abilities: ['{1}, {T}, Sacrifice this artifact: Target player searches their library for a land card, reveals it, puts it into their hand, then shuffles.'],
    shortDescription: 'Pay 1, tap, sacrifice to search for a land',
    sets: ['LCI']
  },
  {
    name: 'Incubator',
    colors: [],
    types: ['Incubator'],
    cardTypes: ['Artifact'],
    abilities: ['Transform this when it has N or more +1/+1 counters on it.'],
    shortDescription: 'Transforms into Phyrexian creature token',
    fullDescription: 'Incubator tokens are created with specified number of +1/+1 counters. When transformed, become 0/0 Phyrexian artifact creatures with those counters.',
    sets: ['ONE', 'MOM']
  },
  {
    name: 'Junk',
    colors: [],
    types: ['Junk'],
    cardTypes: ['Artifact'],
    abilities: ['{T}, Sacrifice this artifact: Exile the top card of your library. You may play that card this turn.'],
    shortDescription: 'Tap and sacrifice to exile and play top card',
    sets: ['UNF']
  },
  {
    name: 'Etherium Cell',
    colors: [],
    types: ['Etherium', 'Cell'],
    cardTypes: ['Artifact'],
    abilities: ['{T}, Sacrifice this artifact: Add {C}{C}.'],
    shortDescription: 'Tap and sacrifice for two colorless mana',
    sets: ['C16']
  },
];

/**
 * Creature tokens - White
 */
const WHITE_CREATURE_TOKENS: readonly TokenDefinition[] = [
  {
    name: '1/1 Soldier',
    colors: ['W'],
    types: ['Soldier'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'White 1/1 Soldier creature',
    fullDescription: 'One of the most common white tokens. Often created by anthem effects and go-wide strategies.'
  },
  {
    name: '1/1 Human',
    colors: ['W'],
    types: ['Human'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'White 1/1 Human creature',
    sets: ['ISD', 'SOI', 'MID', 'VOW']
  },
  {
    name: '1/1 Spirit (Flying)',
    colors: ['W'],
    types: ['Spirit'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: ['Flying'],
    shortDescription: 'White 1/1 Spirit with flying',
    fullDescription: 'Common spirit token with evasion. Frequently created in Innistrad sets.',
    sets: ['ISD', 'SOI', 'MID', 'VOW']
  },
  {
    name: '2/2 Knight',
    colors: ['W'],
    types: ['Knight'],
    cardTypes: ['Creature'],
    power: 2,
    toughness: 2,
    abilities: [],
    shortDescription: 'White 2/2 Knight creature',
    sets: ['ELD', 'M21']
  },
  {
    name: '4/4 Angel (Flying)',
    colors: ['W'],
    types: ['Angel'],
    cardTypes: ['Creature'],
    power: 4,
    toughness: 4,
    abilities: ['Flying'],
    shortDescription: 'White 4/4 Angel with flying',
    fullDescription: 'Powerful angel token often created by high-cost spells or planeswalkers.'
  },
  {
    name: '1/1 Cat',
    colors: ['W'],
    types: ['Cat'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'White 1/1 Cat creature',
    sets: ['AKH', 'BNG']
  },
  {
    name: '2/2 Cat',
    colors: ['W'],
    types: ['Cat'],
    cardTypes: ['Creature'],
    power: 2,
    toughness: 2,
    abilities: [],
    shortDescription: 'White 2/2 Cat creature',
    sets: ['AKH', 'M21']
  },
];

/**
 * Creature tokens - Blue
 */
const BLUE_CREATURE_TOKENS: readonly TokenDefinition[] = [
  {
    name: '1/1 Bird (Flying)',
    colors: ['U'],
    types: ['Bird'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: ['Flying'],
    shortDescription: 'Blue 1/1 Bird with flying'
  },
  {
    name: '2/2 Drake (Flying)',
    colors: ['U'],
    types: ['Drake'],
    cardTypes: ['Creature'],
    power: 2,
    toughness: 2,
    abilities: ['Flying'],
    shortDescription: 'Blue 2/2 Drake with flying'
  },
  {
    name: '1/1 Illusion',
    colors: ['U'],
    types: ['Illusion'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'Blue 1/1 Illusion creature'
  },
];

/**
 * Creature tokens - Black
 */
const BLACK_CREATURE_TOKENS: readonly TokenDefinition[] = [
  {
    name: '2/2 Zombie',
    colors: ['B'],
    types: ['Zombie'],
    cardTypes: ['Creature'],
    power: 2,
    toughness: 2,
    abilities: [],
    shortDescription: 'Black 2/2 Zombie creature',
    fullDescription: 'The quintessential black token. Created by countless necromancy effects.',
    sets: ['ISD', 'SOI', 'AKH', 'MID', 'VOW']
  },
  {
    name: '1/1 Bat (Flying)',
    colors: ['B'],
    types: ['Bat'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: ['Flying'],
    shortDescription: 'Black 1/1 Bat with flying',
    sets: ['ISD', 'VOW']
  },
  {
    name: '1/1 Rat',
    colors: ['B'],
    types: ['Rat'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'Black 1/1 Rat creature',
    sets: ['MID', 'VOW']
  },
  {
    name: '5/5 Demon (Flying)',
    colors: ['B'],
    types: ['Demon'],
    cardTypes: ['Creature'],
    power: 5,
    toughness: 5,
    abilities: ['Flying'],
    shortDescription: 'Black 5/5 Demon with flying',
    fullDescription: 'Powerful demon token often created by high-cost black spells.'
  },
];

/**
 * Creature tokens - Red
 */
const RED_CREATURE_TOKENS: readonly TokenDefinition[] = [
  {
    name: '1/1 Goblin',
    colors: ['R'],
    types: ['Goblin'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'Red 1/1 Goblin creature',
    fullDescription: 'One of the most iconic red tokens. Goblins love to swarm.',
    sets: ['M19', 'M20', 'M21', 'DOM']
  },
  {
    name: '1/1 Devil',
    colors: ['R'],
    types: ['Devil'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: ['When this creature dies, it deals 1 damage to any target.'],
    shortDescription: 'Red 1/1 Devil (deals 1 damage when it dies)',
    sets: ['ISD', 'SOI', 'MID', 'VOW']
  },
  {
    name: '3/1 Elemental',
    colors: ['R'],
    types: ['Elemental'],
    cardTypes: ['Creature'],
    power: 3,
    toughness: 1,
    abilities: [],
    shortDescription: 'Red 3/1 Elemental creature'
  },
  {
    name: '4/4 Dragon (Flying)',
    colors: ['R'],
    types: ['Dragon'],
    cardTypes: ['Creature'],
    power: 4,
    toughness: 4,
    abilities: ['Flying'],
    shortDescription: 'Red 4/4 Dragon with flying',
    fullDescription: 'Powerful dragon token often created by dragon-themed spells.'
  },
];

/**
 * Creature tokens - Green
 */
const GREEN_CREATURE_TOKENS: readonly TokenDefinition[] = [
  {
    name: '3/3 Beast',
    colors: ['G'],
    types: ['Beast'],
    cardTypes: ['Creature'],
    power: 3,
    toughness: 3,
    abilities: [],
    shortDescription: 'Green 3/3 Beast creature',
    fullDescription: 'Classic green token. Beasts are common in green token strategies.'
  },
  {
    name: '1/1 Saproling',
    colors: ['G'],
    types: ['Saproling'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'Green 1/1 Saproling creature',
    fullDescription: 'Small fungus creatures that often appear in large numbers.',
    sets: ['DOM', 'TSP']
  },
  {
    name: '2/2 Wolf',
    colors: ['G'],
    types: ['Wolf'],
    cardTypes: ['Creature'],
    power: 2,
    toughness: 2,
    abilities: [],
    shortDescription: 'Green 2/2 Wolf creature',
    sets: ['ISD', 'SOI', 'MID', 'VOW']
  },
  {
    name: '3/3 Elephant',
    colors: ['G'],
    types: ['Elephant'],
    cardTypes: ['Creature'],
    power: 3,
    toughness: 3,
    abilities: [],
    shortDescription: 'Green 3/3 Elephant creature'
  },
  {
    name: '1/1 Insect',
    colors: ['G'],
    types: ['Insect'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'Green 1/1 Insect creature',
    sets: ['AKH', 'HOU']
  },
  {
    name: '8/8 Wurm',
    colors: ['G'],
    types: ['Wurm'],
    cardTypes: ['Creature'],
    power: 8,
    toughness: 8,
    abilities: [],
    shortDescription: 'Green 8/8 Wurm creature',
    fullDescription: 'Massive wurm token created by powerful green spells.'
  },
];

/**
 * Multicolor creature tokens
 */
const MULTICOLOR_CREATURE_TOKENS: readonly TokenDefinition[] = [
  {
    name: '4/4 Angel Warrior (Flying)',
    colors: ['R', 'W'],
    types: ['Angel', 'Warrior'],
    cardTypes: ['Creature'],
    power: 4,
    toughness: 4,
    abilities: ['Flying'],
    shortDescription: 'Red and white 4/4 Angel Warrior with flying',
    sets: ['BFZ']
  },
  {
    name: '1/1 Elf Warrior',
    colors: ['G', 'W'],
    types: ['Elf', 'Warrior'],
    cardTypes: ['Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'Green and white 1/1 Elf Warrior',
    sets: ['KHM', 'SHM']
  },
];

/**
 * Colorless creature tokens
 */
const COLORLESS_CREATURE_TOKENS: readonly TokenDefinition[] = [
  {
    name: '0/0 Phyrexian',
    colors: [],
    types: ['Phyrexian'],
    cardTypes: ['Artifact', 'Creature'],
    power: 0,
    toughness: 0,
    abilities: [],
    shortDescription: 'Colorless 0/0 Phyrexian artifact creature',
    fullDescription: 'Created when Incubator tokens transform. Usually has +1/+1 counters.',
    sets: ['ONE', 'MOM']
  },
  {
    name: '1/1 Myr',
    colors: [],
    types: ['Myr'],
    cardTypes: ['Artifact', 'Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'Colorless 1/1 Myr artifact creature',
    sets: ['MBS', 'SOM']
  },
  {
    name: '1/1 Servo',
    colors: [],
    types: ['Servo'],
    cardTypes: ['Artifact', 'Creature'],
    power: 1,
    toughness: 1,
    abilities: [],
    shortDescription: 'Colorless 1/1 Servo artifact creature',
    sets: ['KLD', 'AER']
  },
  {
    name: '1/1 Thopter (Flying)',
    colors: [],
    types: ['Thopter'],
    cardTypes: ['Artifact', 'Creature'],
    power: 1,
    toughness: 1,
    abilities: ['Flying'],
    shortDescription: 'Colorless 1/1 Thopter artifact creature with flying',
    fullDescription: 'Small flying artifact creatures. Very common in artifact-themed sets.',
    sets: ['KLD', 'AER', 'DOM', 'BRO']
  },
  {
    name: '0/0 Construct',
    colors: [],
    types: ['Construct'],
    cardTypes: ['Artifact', 'Creature'],
    power: 0,
    toughness: 0,
    abilities: [],
    shortDescription: 'Colorless 0/0 Construct artifact creature',
    fullDescription: 'Typically enters with +1/+1 counters or has abilities that boost its power.',
    sets: ['KLD', 'AER']
  },
];

/**
 * All token definitions combined
 */
const ALL_TOKENS: readonly TokenDefinition[] = [
  ...ARTIFACT_TOKENS,
  ...WHITE_CREATURE_TOKENS,
  ...BLUE_CREATURE_TOKENS,
  ...BLACK_CREATURE_TOKENS,
  ...RED_CREATURE_TOKENS,
  ...GREEN_CREATURE_TOKENS,
  ...MULTICOLOR_CREATURE_TOKENS,
  ...COLORLESS_CREATURE_TOKENS,
];

/**
 * Get token definition by name
 */
export function getTokenDefinition(name: string): TokenDefinition | undefined {
  return ALL_TOKENS.find(token => 
    token.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Get all artifact tokens
 */
export function getArtifactTokens(): readonly TokenDefinition[] {
  return ARTIFACT_TOKENS;
}

/**
 * Get all creature tokens by color
 */
export function getCreatureTokensByColor(color: string): readonly TokenDefinition[] {
  return ALL_TOKENS.filter(token => 
    token.cardTypes.includes('Creature') && token.colors.includes(color)
  );
}

/**
 * Get all colorless tokens
 */
export function getColorlessTokens(): readonly TokenDefinition[] {
  return COLORLESS_CREATURE_TOKENS;
}

/**
 * Get token tooltip text for UI display
 */
export function getTokenTooltip(name: string): string {
  const token = getTokenDefinition(name);
  if (!token) {
    return `${name} token`;
  }
  
  const parts: string[] = [];
  
  // Add colors
  if (token.colors.length > 0) {
    parts.push(token.colors.join(''));
  } else {
    parts.push('Colorless');
  }
  
  // Add P/T for creatures
  if (token.power !== undefined && token.toughness !== undefined) {
    parts.push(`${token.power}/${token.toughness}`);
  }
  
  // Add types
  parts.push(token.types.join(' '));
  
  // Add abilities
  if (token.abilities.length > 0) {
    parts.push(`- ${token.abilities.join(', ')}`);
  }
  
  return parts.join(' ');
}

/**
 * Search tokens by keyword
 */
export function searchTokens(query: string): readonly TokenDefinition[] {
  const lowerQuery = query.toLowerCase();
  return ALL_TOKENS.filter(token =>
    token.name.toLowerCase().includes(lowerQuery) ||
    token.types.some(type => type.toLowerCase().includes(lowerQuery)) ||
    token.abilities.some(ability => ability.toLowerCase().includes(lowerQuery)) ||
    token.shortDescription.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get all token definitions
 */
export function getAllTokens(): readonly TokenDefinition[] {
  return ALL_TOKENS;
}

/**
 * Get tokens by card type
 */
export function getTokensByCardType(cardType: string): readonly TokenDefinition[] {
  return ALL_TOKENS.filter(token => token.cardTypes.includes(cardType));
}
