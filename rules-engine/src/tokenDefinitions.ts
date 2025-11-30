/**
 * MTG Token Definitions - Comprehensive Token Type Reference
 * 
 * Provides detailed information about all common token types in Magic: The Gathering
 * for use in UI tooltips, token creation, and gameplay assistance.
 * 
 * Organized by:
 * - Artifact tokens (Treasure, Food, Clue, etc.)
 * - Creature tokens (by color and type)
 * - Special tokens (Emblems, Counters, etc.)
 */

/**
 * Token definition with all relevant characteristics
 */
export interface TokenDefinition {
  readonly name: string;
  readonly types: readonly string[]; // ["Artifact"], ["Creature", "Zombie"], etc.
  readonly subtypes: readonly string[]; // ["Zombie"], ["Goblin"], etc.
  readonly colors: readonly string[]; // ["Black"], ["Red", "Green"], etc.
  readonly power?: number | string; // 2, "*", etc.
  readonly toughness?: number | string;
  readonly abilities: readonly string[]; // Keyword abilities and other text
  readonly description: string; // Player-friendly description
  readonly commonSets: readonly string[]; // Sets where this token commonly appears
  readonly priority: 1 | 2 | 3 | 4 | 5; // 1=very common, 5=rare
  readonly icon?: string; // Icon identifier for UI
}

/**
 * ARTIFACT TOKENS - Commonly created artifact tokens
 */
export const ARTIFACT_TOKENS: readonly TokenDefinition[] = [
  {
    name: "Treasure",
    types: ["Artifact"],
    subtypes: ["Treasure"],
    colors: [],
    abilities: ["{T}, Sacrifice this artifact: Add one mana of any color."],
    description: "Sacrifice for one mana of any color. The most common mana-generating token.",
    commonSets: ["Ixalan", "Streets of New Capenna", "Bloomburrow"],
    priority: 1,
    icon: "treasure-chest"
  },
  {
    name: "Food",
    types: ["Artifact"],
    subtypes: ["Food"],
    colors: [],
    abilities: ["{2}, {T}, Sacrifice this artifact: You gain 3 life."],
    description: "Pay 2 mana and sacrifice to gain 3 life. Common life-gain token.",
    commonSets: ["Throne of Eldraine", "Wilds of Eldraine"],
    priority: 1,
    icon: "food"
  },
  {
    name: "Clue",
    types: ["Artifact"],
    subtypes: ["Clue"],
    colors: [],
    abilities: ["{2}, Sacrifice this artifact: Draw a card."],
    description: "Pay 2 mana and sacrifice to draw a card. Card advantage token.",
    commonSets: ["Shadows over Innistrad", "Murders at Karlov Manor"],
    priority: 1,
    icon: "magnifying-glass"
  },
  {
    name: "Blood",
    types: ["Artifact"],
    subtypes: ["Blood"],
    colors: [],
    abilities: ["{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card."],
    description: "Pay 1, discard, and sacrifice to draw. Card filtering token.",
    commonSets: ["Crimson Vow", "Crimson Vow"],
    priority: 2,
    icon: "blood-drop"
  },
  {
    name: "Gold",
    types: ["Artifact"],
    subtypes: ["Gold"],
    colors: [],
    abilities: ["Sacrifice this artifact: Add one mana of any color."],
    description: "Sacrifice for one mana of any color (doesn't require tapping like Treasure).",
    commonSets: ["Theros Beyond Death", "Streets of New Capenna"],
    priority: 2,
    icon: "gold-coin"
  },
  {
    name: "Map",
    types: ["Artifact"],
    subtypes: ["Map"],
    colors: [],
    abilities: ["{1}, {T}, Sacrifice this artifact: Target player searches their library for a land card, puts it onto the battlefield, then shuffles."],
    description: "Search for a land and put it onto the battlefield. Ramp token.",
    commonSets: ["The Lost Caverns of Ixalan"],
    priority: 2,
    icon: "map"
  },
  {
    name: "Powerstone",
    types: ["Artifact"],
    subtypes: ["Powerstone"],
    colors: [],
    abilities: ["{T}: Add {C}. This mana can't be spent to cast a nonartifact spell."],
    description: "Adds colorless mana but only for artifacts. Common in artifact sets.",
    commonSets: ["The Brothers' War"],
    priority: 2,
    icon: "powerstone"
  },
  {
    name: "Junk",
    types: ["Artifact"],
    subtypes: ["Junk"],
    colors: [],
    abilities: ["{T}, Sacrifice this artifact: Exile the top card of your library. You may play that card this turn."],
    description: "Exile top card and play it. From Unfinity Attractions.",
    commonSets: ["Unfinity"],
    priority: 3,
    icon: "junk"
  },
  {
    name: "Incubator",
    types: ["Artifact"],
    subtypes: ["Incubator"],
    colors: [],
    abilities: ["This enters the battlefield with X +1/+1 counters on it.", "{2}: Transform this."],
    description: "Transforms into a 0/0 Phyrexian artifact creature with the counters. Phyrexia token type.",
    commonSets: ["Phyrexia: All Will Be One"],
    priority: 2,
    icon: "incubator"
  },
  {
    name: "Walker",
    types: ["Artifact", "Creature"],
    subtypes: ["Walker"],
    colors: [],
    power: 3,
    toughness: 3,
    abilities: [],
    description: "3/3 colorless artifact creature token. Basic construct type.",
    commonSets: ["Aether Revolt"],
    priority: 3,
    icon: "walker"
  },
  {
    name: "Servo",
    types: ["Artifact", "Creature"],
    subtypes: ["Servo"],
    colors: [],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "1/1 colorless artifact creature token. Common in Kaladesh.",
    commonSets: ["Kaladesh", "Aether Revolt"],
    priority: 2,
    icon: "servo"
  },
  {
    name: "Thopter",
    types: ["Artifact", "Creature"],
    subtypes: ["Thopter"],
    colors: [],
    power: 1,
    toughness: 1,
    abilities: ["Flying"],
    description: "1/1 colorless flying artifact creature. Very common flying token.",
    commonSets: ["Kaladesh", "The Brothers' War"],
    priority: 2,
    icon: "thopter"
  },
];

/**
 * WHITE CREATURE TOKENS
 */
export const WHITE_TOKENS: readonly TokenDefinition[] = [
  {
    name: "1/1 Soldier",
    types: ["Creature"],
    subtypes: ["Soldier"],
    colors: ["White"],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "White 1/1 creature token. One of the most common white tokens.",
    commonSets: ["Many sets"],
    priority: 1,
    icon: "soldier"
  },
  {
    name: "1/1 Human",
    types: ["Creature"],
    subtypes: ["Human"],
    colors: ["White"],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "White 1/1 Human. Very common creature type.",
    commonSets: ["Innistrad sets", "Many others"],
    priority: 1,
    icon: "human"
  },
  {
    name: "1/1 Spirit (Flying)",
    types: ["Creature"],
    subtypes: ["Spirit"],
    colors: ["White"],
    power: 1,
    toughness: 1,
    abilities: ["Flying"],
    description: "White 1/1 flying Spirit. Common evasive white token.",
    commonSets: ["Innistrad sets", "Kamigawa"],
    priority: 1,
    icon: "spirit"
  },
  {
    name: "2/2 Knight",
    types: ["Creature"],
    subtypes: ["Knight"],
    colors: ["White"],
    power: 2,
    toughness: 2,
    abilities: [],
    description: "White 2/2 Knight. Common in knight-themed sets.",
    commonSets: ["Throne of Eldraine", "Dominaria"],
    priority: 2,
    icon: "knight"
  },
  {
    name: "1/1 Cat",
    types: ["Creature"],
    subtypes: ["Cat"],
    colors: ["White"],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "White 1/1 Cat. Common in cat tribal decks.",
    commonSets: ["Amonkhet", "Commander"],
    priority: 2,
    icon: "cat"
  },
  {
    name: "4/4 Angel (Flying)",
    types: ["Creature"],
    subtypes: ["Angel"],
    colors: ["White"],
    power: 4,
    toughness: 4,
    abilities: ["Flying"],
    description: "White 4/4 flying Angel. Large flying token.",
    commonSets: ["Various sets"],
    priority: 2,
    icon: "angel"
  },
];

/**
 * BLUE CREATURE TOKENS
 */
export const BLUE_TOKENS: readonly TokenDefinition[] = [
  {
    name: "2/2 Drake (Flying)",
    types: ["Creature"],
    subtypes: ["Drake"],
    colors: ["Blue"],
    power: 2,
    toughness: 2,
    abilities: ["Flying"],
    description: "Blue 2/2 flying Drake. Common blue evasive token.",
    commonSets: ["Ixalan", "Various"],
    priority: 2,
    icon: "drake"
  },
  {
    name: "1/1 Bird (Flying)",
    types: ["Creature"],
    subtypes: ["Bird"],
    colors: ["Blue"],
    power: 1,
    toughness: 1,
    abilities: ["Flying"],
    description: "Blue 1/1 flying Bird. Small evasive token.",
    commonSets: ["Various sets"],
    priority: 2,
    icon: "bird"
  },
  {
    name: "3/3 Frog Lizard",
    types: ["Creature"],
    subtypes: ["Frog", "Lizard"],
    colors: ["Blue"],
    power: 3,
    toughness: 3,
    abilities: [],
    description: "Blue 3/3 Frog Lizard. From Bloomburrow.",
    commonSets: ["Bloomburrow"],
    priority: 3,
    icon: "frog"
  },
  {
    name: "1/1 Merfolk (Hexproof)",
    types: ["Creature"],
    subtypes: ["Merfolk"],
    colors: ["Blue"],
    power: 1,
    toughness: 1,
    abilities: ["Hexproof"],
    description: "Blue 1/1 Merfolk with hexproof. Created by Deeproot Waters when you cast a Merfolk spell.",
    commonSets: ["Ixalan", "Rivals of Ixalan"],
    priority: 1,
    icon: "merfolk"
  },
];

/**
 * BLACK CREATURE TOKENS
 */
export const BLACK_TOKENS: readonly TokenDefinition[] = [
  {
    name: "2/2 Zombie",
    types: ["Creature"],
    subtypes: ["Zombie"],
    colors: ["Black"],
    power: 2,
    toughness: 2,
    abilities: [],
    description: "Black 2/2 Zombie. One of the most common black tokens.",
    commonSets: ["Innistrad sets", "Amonkhet", "Many others"],
    priority: 1,
    icon: "zombie"
  },
  {
    name: "1/1 Bat (Flying)",
    types: ["Creature"],
    subtypes: ["Bat"],
    colors: ["Black"],
    power: 1,
    toughness: 1,
    abilities: ["Flying"],
    description: "Black 1/1 flying Bat. Small evasive black token.",
    commonSets: ["Innistrad sets"],
    priority: 2,
    icon: "bat"
  },
  {
    name: "1/1 Rat",
    types: ["Creature"],
    subtypes: ["Rat"],
    colors: ["Black"],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "Black 1/1 Rat. Common in rat tribal strategies.",
    commonSets: ["Kamigawa", "Throne of Eldraine"],
    priority: 2,
    icon: "rat"
  },
  {
    name: "5/5 Demon (Flying)",
    types: ["Creature"],
    subtypes: ["Demon"],
    colors: ["Black"],
    power: 5,
    toughness: 5,
    abilities: ["Flying"],
    description: "Black 5/5 flying Demon. Large flying black token.",
    commonSets: ["Various sets"],
    priority: 2,
    icon: "demon"
  },
];

/**
 * RED CREATURE TOKENS
 */
export const RED_TOKENS: readonly TokenDefinition[] = [
  {
    name: "1/1 Goblin",
    types: ["Creature"],
    subtypes: ["Goblin"],
    colors: ["Red"],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "Red 1/1 Goblin. One of the most common red tokens.",
    commonSets: ["Many sets"],
    priority: 1,
    icon: "goblin"
  },
  {
    name: "1/1 Devil",
    types: ["Creature"],
    subtypes: ["Devil"],
    colors: ["Red"],
    power: 1,
    toughness: 1,
    abilities: ["When this dies, it deals 1 damage to any target."],
    description: "Red 1/1 Devil that deals 1 damage when it dies.",
    commonSets: ["Innistrad sets"],
    priority: 2,
    icon: "devil"
  },
  {
    name: "3/1 Elemental",
    types: ["Creature"],
    subtypes: ["Elemental"],
    colors: ["Red"],
    power: 3,
    toughness: 1,
    abilities: ["Haste"],
    description: "Red 3/1 Elemental with haste. Aggressive temporary token.",
    commonSets: ["Various sets"],
    priority: 2,
    icon: "elemental"
  },
  {
    name: "5/5 Dragon (Flying)",
    types: ["Creature"],
    subtypes: ["Dragon"],
    colors: ["Red"],
    power: 5,
    toughness: 5,
    abilities: ["Flying"],
    description: "Red 5/5 flying Dragon. Large flying red token.",
    commonSets: ["Various sets"],
    priority: 2,
    icon: "dragon"
  },
];

/**
 * GREEN CREATURE TOKENS
 */
export const GREEN_TOKENS: readonly TokenDefinition[] = [
  {
    name: "3/3 Beast",
    types: ["Creature"],
    subtypes: ["Beast"],
    colors: ["Green"],
    power: 3,
    toughness: 3,
    abilities: [],
    description: "Green 3/3 Beast. One of the most common green tokens.",
    commonSets: ["Many sets"],
    priority: 1,
    icon: "beast"
  },
  {
    name: "1/1 Elf Warrior",
    types: ["Creature"],
    subtypes: ["Elf", "Warrior"],
    colors: ["Green"],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "Green 1/1 Elf Warrior. Common in elf tribal strategies.",
    commonSets: ["Various sets"],
    priority: 2,
    icon: "elf"
  },
  {
    name: "1/1 Saproling",
    types: ["Creature"],
    subtypes: ["Saproling"],
    colors: ["Green"],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "Green 1/1 Saproling. Classic token type.",
    commonSets: ["Dominaria", "Time Spiral"],
    priority: 2,
    icon: "saproling"
  },
  {
    name: "2/2 Bear",
    types: ["Creature"],
    subtypes: ["Bear"],
    colors: ["Green"],
    power: 2,
    toughness: 2,
    abilities: [],
    description: "Green 2/2 Bear. Simple efficient green token.",
    commonSets: ["Various sets"],
    priority: 2,
    icon: "bear"
  },
  {
    name: "4/4 Elemental",
    types: ["Creature"],
    subtypes: ["Elemental"],
    colors: ["Green"],
    power: 4,
    toughness: 4,
    abilities: [],
    description: "Green 4/4 Elemental. Large green token.",
    commonSets: ["Various sets"],
    priority: 2,
    icon: "elemental-green"
  },
  {
    name: "1/1 Squirrel",
    types: ["Creature"],
    subtypes: ["Squirrel"],
    colors: ["Green"],
    power: 1,
    toughness: 1,
    abilities: [],
    description: "Green 1/1 Squirrel. Created by Deranged Hermit, Squirrel Nest, Drey Keeper and many others.",
    commonSets: ["Odyssey", "Modern Horizons 2", "Unfinity"],
    priority: 1,
    icon: "squirrel"
  },
];

/**
 * MULTICOLOR CREATURE TOKENS
 */
export const MULTICOLOR_TOKENS: readonly TokenDefinition[] = [
  {
    name: "2/2 Cat Warrior (GW)",
    types: ["Creature"],
    subtypes: ["Cat", "Warrior"],
    colors: ["Green", "White"],
    power: 2,
    toughness: 2,
    abilities: [],
    description: "Green and white 2/2 Cat Warrior. Selesnya token.",
    commonSets: ["Various sets"],
    priority: 3,
    icon: "cat-warrior"
  },
  {
    name: "1/1 Faerie Rogue (UB, Flying)",
    types: ["Creature"],
    subtypes: ["Faerie", "Rogue"],
    colors: ["Blue", "Black"],
    power: 1,
    toughness: 1,
    abilities: ["Flying"],
    description: "Blue and black 1/1 flying Faerie Rogue. Dimir token.",
    commonSets: ["Lorwyn", "Throne of Eldraine"],
    priority: 3,
    icon: "faerie"
  },
];

/**
 * SPECIAL TOKENS - Non-creature, non-artifact tokens
 */
export const SPECIAL_TOKENS: readonly TokenDefinition[] = [
  {
    name: "Copy Token",
    types: ["Special"],
    subtypes: [],
    colors: [],
    abilities: ["This is a token copy of another permanent."],
    description: "A token that's a copy of another permanent. Inherits all characteristics of the copied permanent.",
    commonSets: ["Any set with clone effects"],
    priority: 2,
    icon: "copy"
  },
  {
    name: "Emblem",
    types: ["Emblem"],
    subtypes: [],
    colors: [],
    abilities: ["Varies by planeswalker"],
    description: "A marker created by planeswalker abilities that exists in the command zone. Can't be removed or interacted with.",
    commonSets: ["Any set with planeswalkers"],
    priority: 2,
    icon: "emblem"
  },
];

/**
 * ALL TOKENS - Combined list
 */
export const ALL_TOKENS: readonly TokenDefinition[] = [
  ...ARTIFACT_TOKENS,
  ...WHITE_TOKENS,
  ...BLUE_TOKENS,
  ...BLACK_TOKENS,
  ...RED_TOKENS,
  ...GREEN_TOKENS,
  ...MULTICOLOR_TOKENS,
  ...SPECIAL_TOKENS,
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
 * Get all tokens of a specific type (Artifact, Creature, etc.)
 */
export function getTokensByType(type: string): readonly TokenDefinition[] {
  return ALL_TOKENS.filter(token => 
    token.types.includes(type)
  );
}

/**
 * Get all tokens of a specific color
 */
export function getTokensByColor(color: string): readonly TokenDefinition[] {
  return ALL_TOKENS.filter(token => 
    token.colors.includes(color)
  );
}

/**
 * Get essential tokens (priority 1-2) for initial UI load
 */
export function getEssentialTokens(): readonly TokenDefinition[] {
  return ALL_TOKENS.filter(token => token.priority <= 2);
}

/**
 * Search tokens by name or description
 */
export function searchTokens(query: string): readonly TokenDefinition[] {
  const lowerQuery = query.toLowerCase();
  return ALL_TOKENS.filter(token =>
    token.name.toLowerCase().includes(lowerQuery) ||
    token.description.toLowerCase().includes(lowerQuery) ||
    token.subtypes.some(subtype => subtype.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get token tooltip text for UI
 */
export function getTokenTooltip(name: string): string {
  const token = getTokenDefinition(name);
  if (!token) return `${name} token`;
  
  const colorText = token.colors.length > 0 ? token.colors.join("/") + " " : "";
  const typeText = token.types.join(" ");
  const subtypeText = token.subtypes.length > 0 ? ` — ${token.subtypes.join(" ")}` : "";
  const ptText = token.power !== undefined ? ` ${token.power}/${token.toughness}` : "";
  
  let tooltip = `${colorText}${typeText}${subtypeText}${ptText}`;
  
  if (token.abilities.length > 0) {
    tooltip += `\n${token.abilities.join("\n")}`;
  }
  
  return tooltip;
}

/**
 * Get formatted token description for detailed view
 */
export function getTokenDescription(name: string): string {
  const token = getTokenDefinition(name);
  if (!token) return `Unknown token: ${name}`;
  
  return token.description;
}
