/**
 * creatureTypes.ts
 * 
 * Complete list of official Magic: The Gathering creature types.
 * Based on the Comprehensive Rules 205.3m.
 * 
 * Used for cards like Kindred Discovery, Coat of Arms, and other 
 * effects that require choosing a creature type.
 */

// Full list of creature types from the official MTG rules
export const CREATURE_TYPES = [
  // A
  'Advisor', 'Aetherborn', 'Alien', 'Ally', 'Angel', 'Antelope', 'Ape', 'Archer', 'Archon', 'Armadillo', 'Army', 'Artificer', 'Assassin', 'Assembly-Worker', 'Astartes', 'Atog', 'Aurochs', 'Avatar',
  // B
  'Badger', 'Balloon', 'Barbarian', 'Bard', 'Basilisk', 'Bat', 'Bear', 'Beast', 'Beeble', 'Beholder', 'Berserker', 'Bird', 'Blinkmoth', 'Boar', 'Bringer', 'Brushwagg',
  // C
  'Camarid', 'Camel', 'Capybara', 'Caribou', 'Carrier', 'Cat', 'Centaur', 'Cephalid', 'Child', 'Chimera', 'Citizen', 'Cleric', 'Clown', 'Cockatrice', 'Construct', 'Coward', 'Crab', 'Crocodile', 'Ctan', 'Custodes', 'Cyberman', 'Cyclops',
  // D
  'Dalek', 'Dauthi', 'Demigod', 'Demon', 'Deserter', 'Detective', 'Devil', 'Dinosaur', 'Djinn', 'Doctor', 'Dog', 'Dragon', 'Drake', 'Dreadnought', 'Drone', 'Druid', 'Dryad', 'Dwarf',
  // E
  'Efreet', 'Egg', 'Elder', 'Eldrazi', 'Elemental', 'Elephant', 'Elf', 'Elk', 'Employee', 'Eye',
  // F
  'Faerie', 'Ferret', 'Fish', 'Flagbearer', 'Fox', 'Fractal', 'Frog', 'Fungus',
  // G
  'Gamer', 'Gargoyle', 'Germ', 'Giant', 'Gith', 'Gnoll', 'Gnome', 'Goat', 'Goblin', 'God', 'Golem', 'Gorgon', 'Graveborn', 'Gremlin', 'Griffin', 'Guest',
  // H
  'Hag', 'Halfling', 'Hamster', 'Harpy', 'Hellion', 'Hippo', 'Hippogriff', 'Homarid', 'Homunculus', 'Horror', 'Horse', 'Human', 'Hydra', 'Hyena',
  // I
  'Illusion', 'Imp', 'Incarnation', 'Inkling', 'Inquisitor', 'Insect',
  // J
  'Jackal', 'Jellyfish',
  // K
  'Kavu', 'Kirin', 'Kithkin', 'Knight', 'Kobold', 'Kor', 'Kraken',
  // L
  'Lamia', 'Lammasu', 'Leech', 'Leviathan', 'Lhurgoyf', 'Licid', 'Lizard', 'Llama',
  // M
  'Manticore', 'Masticore', 'Mercenary', 'Merfolk', 'Metathran', 'Minion', 'Minotaur', 'Mite', 'Mole', 'Monger', 'Mongoose', 'Monk', 'Monkey', 'Moonfolk', 'Mount', 'Mouse', 'Mutant', 'Myr', 'Mystic',
  // N
  'Naga', 'Nautilus', 'Necron', 'Nephilim', 'Nightmare', 'Nightstalker', 'Ninja', 'Noble', 'Noggle', 'Nomad', 'Nymph',
  // O
  'Octopus', 'Ogre', 'Ooze', 'Orb', 'Orc', 'Orgg', 'Otter', 'Ouphe', 'Ox', 'Oyster',
  // P-R
  'Pangolin', 'Peasant', 'Pegasus', 'Pentavite', 'Performer', 'Pest', 'Phelddagrif',
  'Phoenix', 'Phyrexian', 'Pilot', 'Pincher', 'Pirate', 'Plant', 'Praetor', 'Primarch',
  'Prism', 'Processor', 'Rabbit', 'Raccoon', 'Ranger', 'Rat', 'Rebel', 'Reflection',
  'Rhino', 'Rigger', 'Robot', 'Rogue',
  // S
  'Sable', 'Salamander', 'Samurai', 'Sand', 'Saproling', 'Satyr', 'Scarecrow',
  'Scientist', 'Scion', 'Scorpion', 'Scout', 'Sculpture', 'Serf', 'Serpent', 'Servo',
  'Shade', 'Shaman', 'Shapeshifter', 'Shark', 'Sheep', 'Siren', 'Skeleton', 'Slith',
  'Sliver', 'Sloth', 'Slug', 'Snail', 'Snake', 'Soldier', 'Soltari', 'Spawn', 'Specter',
  'Spellshaper', 'Sphinx', 'Spider', 'Spike', 'Spirit', 'Splinter', 'Sponge', 'Squid',
  'Squirrel', 'Starfish', 'Surrakar', 'Survivor',
  // T
  'Tentacle', 'Tetravite', 'Thalakos', 'Thopter', 'Thrull', 'Tiefling', 'Time Lord',
  'Treefolk', 'Trilobite', 'Triskelavite', 'Troll', 'Turtle', 'Tyranid',
  // U
  'Unicorn',
  // V
  'Vampire', 'Vedalken', 'Viashino', 'Volver',
  // W
  'Wall', 'Walrus', 'Warlock', 'Warrior', 'Weasel', 'Weird', 'Werewolf', 'Whale', 'Wizard', 'Wolf', 'Wolverine', 'Wombat', 'Worm', 'Wraith', 'Wurm',
  // Y-Z
  'Yeti', 'Zombie', 'Zubera',
] as const;

export type CreatureType = typeof CREATURE_TYPES[number];

/**
 * Check if a string is a valid creature type
 */
export function isValidCreatureType(type: string): type is CreatureType {
  return CREATURE_TYPES.includes(type as CreatureType);
}

/**
 * Search creature types by partial match
 */
export function searchCreatureTypes(query: string): CreatureType[] {
  if (!query || query.length === 0) {
    return [...CREATURE_TYPES];
  }
  
  const lowerQuery = query.toLowerCase();
  return CREATURE_TYPES.filter(type => 
    type.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get creature types that start with a letter
 */
export function getCreatureTypesByLetter(letter: string): CreatureType[] {
  const upperLetter = letter.toUpperCase();
  return CREATURE_TYPES.filter(type => type.startsWith(upperLetter));
}

/**
 * Check if a card/permanent has a specific creature type.
 * This correctly handles:
 * - Creatures with the type in their type line (e.g., "Creature — Merfolk Wizard")
 * - Tribal/Kindred cards with the type (e.g., "Tribal Enchantment — Merfolk", "Kindred Instant — Goblin")
 * - Changelings (have all creature types via oracle text or type line)
 * - Cards with "all creature types" or "is every creature type" effects
 * 
 * @param typeLine - The card's type line (e.g., "Creature — Merfolk Wizard")
 * @param oracleText - The card's oracle text (used to detect changeling)
 * @param creatureType - The creature type to check for (case-insensitive)
 * @returns true if the card has the specified creature type
 */
export function cardHasCreatureType(
  typeLine: string | undefined | null,
  oracleText: string | undefined | null,
  creatureType: string
): boolean {
  if (!typeLine) return false;
  
  const typeLineLower = typeLine.toLowerCase();
  const oracleTextLower = (oracleText || "").toLowerCase();
  const creatureTypeLower = creatureType.toLowerCase();
  
  // Check for changeling (has all creature types)
  // Rule 702.73: "Changeling" means "This object is every creature type."
  if (oracleTextLower.includes("changeling") || typeLineLower.includes("changeling")) {
    return true;
  }
  
  // Check for "all creature types" or "is every creature type" effects
  if (oracleTextLower.includes("all creature types") || 
      oracleTextLower.includes("is every creature type") ||
      oracleTextLower.includes("has all creature types")) {
    return true;
  }
  
  // Check if the type line contains the creature type after the em-dash
  // This works for:
  // - "Creature — Merfolk Wizard"
  // - "Tribal Enchantment — Merfolk"
  // - "Kindred Instant — Goblin"
  // - "Legendary Creature — Merfolk Wizard"
  
  // Find the dash separator (could be em-dash, en-dash, or hyphen)
  const dashIndex = findDashIndex(typeLineLower);
  
  if (dashIndex !== -1) {
    // Get the subtypes portion (after the dash)
    const subtypesPortion = typeLineLower.slice(dashIndex + 1).trim();
    // Split by spaces and check if any word matches the creature type
    const subtypes = subtypesPortion.split(/\s+/);
    if (subtypes.some(subtype => subtype === creatureTypeLower)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Helper function to find the dash separator in a type line.
 * Checks for em-dash, en-dash, or hyphen.
 */
function findDashIndex(typeLine: string): number {
  const emDash = typeLine.indexOf("—");
  if (emDash !== -1) return emDash;
  
  const enDash = typeLine.indexOf("–");
  if (enDash !== -1) return enDash;
  
  return typeLine.indexOf("-");
}

/**
 * Extract all creature types from a card's type line.
 * Handles Tribal/Kindred cards and returns an empty array for non-creature cards
 * that don't have a tribal component.
 * 
 * @param typeLine - The card's type line
 * @param oracleText - The card's oracle text (for changeling detection)
 * @returns Array of creature types found on the card
 */
export function extractCreatureTypes(
  typeLine: string | undefined | null,
  oracleText?: string | undefined | null
): string[] {
  if (!typeLine) return [];
  
  const typeLineLower = typeLine.toLowerCase();
  const oracleTextLower = (oracleText || "").toLowerCase();
  
  // Check if this card could have creature types
  const hasCreatureTypes = typeLineLower.includes("creature") || 
                           typeLineLower.includes("tribal") ||
                           typeLineLower.includes("kindred");
  
  if (!hasCreatureTypes) return [];
  
  // For changelings, return all creature types
  if (oracleTextLower.includes("changeling") || 
      typeLineLower.includes("changeling") ||
      oracleTextLower.includes("all creature types") ||
      oracleTextLower.includes("is every creature type")) {
    return [...CREATURE_TYPES];
  }
  
  // Find the dash separator using the shared helper
  const dashIndex = findDashIndex(typeLine);
  
  if (dashIndex === -1) return [];
  
  // Get the subtypes portion and split by spaces
  const subtypesPortion = typeLine.slice(dashIndex + 1).trim();
  const words = subtypesPortion.split(/\s+/);
  
  // Filter to only valid creature types
  return words.filter(word => 
    CREATURE_TYPES.some(ct => ct.toLowerCase() === word.toLowerCase())
  );
}

/**
 * Check if a permanent (battlefield object) has a specific creature type.
 * Convenience wrapper for cardHasCreatureType that works with permanent objects.
 * 
 * Also checks for `chosenCreatureType` property on the permanent, which is set
 * by cards like Roaming Throne that let you choose a creature type on ETB
 * and become that type in addition to their other types.
 * 
 * @param permanent - A battlefield permanent with a card property
 * @param creatureType - The creature type to check for
 * @returns true if the permanent has the specified creature type
 */
export function permanentHasCreatureType(
  permanent: { card?: { type_line?: string; oracle_text?: string }; chosenCreatureType?: string } | null | undefined,
  creatureType: string
): boolean {
  if (!permanent?.card) return false;
  
  // Check if permanent has a chosen creature type that matches
  // This handles cards like Roaming Throne that become the chosen type
  const permAny = permanent as any;
  if (permAny.chosenCreatureType && 
      permAny.chosenCreatureType.toLowerCase() === creatureType.toLowerCase()) {
    return true;
  }
  
  // Also check for grantedCreatureTypes array (for other type-granting effects)
  if (Array.isArray(permAny.grantedCreatureTypes)) {
    if (permAny.grantedCreatureTypes.some((t: string) => 
      t.toLowerCase() === creatureType.toLowerCase()
    )) {
      return true;
    }
  }
  
  return cardHasCreatureType(
    permanent.card.type_line,
    permanent.card.oracle_text,
    creatureType
  );
}

/**
 * Find all permanents controlled by a player that have a specific creature type.
 * Includes Tribal cards, Kindred cards, and Changelings.
 * 
 * @param battlefield - Array of battlefield permanents
 * @param playerId - The controller to filter by
 * @param creatureType - The creature type to filter by
 * @param untappedOnly - If true, only return untapped permanents (for cost payment)
 * @returns Array of permanents matching the criteria
 */
export function findPermanentsWithCreatureType(
  battlefield: any[],
  playerId: string,
  creatureType: string,
  untappedOnly: boolean = false
): any[] {
  return battlefield.filter((perm: any) => {
    if (!perm || perm.controller !== playerId) return false;
    if (untappedOnly && perm.tapped) return false;
    return permanentHasCreatureType(perm, creatureType);
  });
}

export default CREATURE_TYPES;
