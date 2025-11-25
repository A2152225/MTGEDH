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
  // P
  'Pangolin', 'Peasant', 'Pegasus', 'Pentavite', 'Performer', 'Pest', 'Phelddagrif', 'Phoenix', 'Phyrexian', 'Pilot', 'Pincher', 'Pirate', 'Plant', 'Praetor', 'Primarch', 'Prism', 'Processor', 'Rabbit', 'Raccoon', 'Ranger', 'Rat', 'Rebel', 'Reflection', 'Rhino', 'Rigger', 'Robot', 'Rogue', 'Sable', 'Salamander', 'Samurai', 'Sand', 'Saproling', 'Satyr', 'Scarecrow', 'Scientist', 'Scion', 'Scorpion', 'Scout', 'Sculpture', 'Serf', 'Serpent', 'Servo', 'Shade', 'Shaman', 'Shapeshifter', 'Shark', 'Sheep', 'Siren', 'Skeleton', 'Slith', 'Sliver', 'Sloth', 'Slug', 'Snail', 'Snake', 'Soldier', 'Soltari', 'Spawn', 'Specter', 'Spellshaper', 'Sphinx', 'Spider', 'Spike', 'Spirit', 'Splinter', 'Sponge', 'Squid', 'Squirrel', 'Starfish', 'Surrakar', 'Survivor', 'Tentacle', 'Tetravite', 'Thalakos', 'Thopter', 'Thrull', 'Tiefling', 'Time Lord', 'Treefolk', 'Trilobite', 'Triskelavite', 'Troll', 'Turtle', 'Tyranid',
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

export default CREATURE_TYPES;
