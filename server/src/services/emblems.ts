/**
 * server/src/services/emblems.ts
 * 
 * Emblem data service for planeswalker emblems.
 * Emblems are special game objects created by planeswalker ultimate abilities
 * that can't be interacted with once created.
 */

/**
 * Emblem definition for planeswalker emblems
 */
export interface EmblemCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  colors: string[];
  source_planeswalker?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
}

/**
 * Common planeswalker emblems with their effects
 * These can be looked up by planeswalker name
 */
const KNOWN_EMBLEMS: Record<string, { name: string; oracle_text: string; colors: string[] }> = {
  // White emblems
  "elspeth, knight-errant": {
    name: "Elspeth, Knight-Errant Emblem",
    oracle_text: "Artifacts, creatures, enchantments, and lands you control have indestructible.",
    colors: ["W"]
  },
  "elspeth, sun's champion": {
    name: "Elspeth, Sun's Champion Emblem",
    oracle_text: "Creatures you control get +2/+2 and have flying.",
    colors: ["W"]
  },
  "ajani steadfast": {
    name: "Ajani Steadfast Emblem",
    oracle_text: "If a source would deal damage to you or a planeswalker you control, prevent all but 1 of that damage.",
    colors: ["W"]
  },
  "gideon, ally of zendikar": {
    name: "Gideon, Ally of Zendikar Emblem",
    oracle_text: "Creatures you control get +1/+1.",
    colors: ["W"]
  },
  "basri ket": {
    name: "Basri Ket Emblem",
    oracle_text: "At the beginning of combat on your turn, create a 1/1 white Soldier creature token. Put a +1/+1 counter on each creature you control.",
    colors: ["W"]
  },
  
  // Blue emblems
  "jace, unraveler of secrets": {
    name: "Jace, Unraveler of Secrets Emblem",
    oracle_text: "Whenever an opponent casts their first spell each turn, counter that spell.",
    colors: ["U"]
  },
  "tamiyo, the moon sage": {
    name: "Tamiyo, the Moon Sage Emblem",
    oracle_text: "You have no maximum hand size. Whenever a card is put into your graveyard from anywhere, you may return it to your hand.",
    colors: ["U"]
  },
  "jace, cunning castaway": {
    name: "Jace, Cunning Castaway Emblem",
    oracle_text: "Whenever you cast a spell, create two 2/2 blue Illusion creature tokens with \"When this creature becomes the target of a spell, sacrifice it.\"",
    colors: ["U"]
  },
  "teferi, temporal archmage": {
    name: "Teferi, Temporal Archmage Emblem",
    oracle_text: "You may activate loyalty abilities of planeswalkers you control on any player's turn any time you could cast an instant.",
    colors: ["U"]
  },
  
  // Black emblems
  "liliana, defiant necromancer": {
    name: "Liliana, Defiant Necromancer Emblem",
    oracle_text: "Whenever a creature dies, return it to the battlefield under your control at the beginning of the next end step.",
    colors: ["B"]
  },
  "liliana, the last hope": {
    name: "Liliana, the Last Hope Emblem",
    oracle_text: "At the beginning of your end step, create X 2/2 black Zombie creature tokens, where X is two plus the number of Zombies you control.",
    colors: ["B"]
  },
  "ob nixilis reignited": {
    name: "Ob Nixilis Reignited Emblem",
    oracle_text: "Whenever a player draws a card, you may have that player lose 2 life.",
    colors: ["B"]
  },
  "ob nixilis of the black oath": {
    name: "Ob Nixilis of the Black Oath Emblem",
    oracle_text: "{1}{B}, Sacrifice a creature: You gain X life and draw X cards, where X is the sacrificed creature's power.",
    colors: ["B"]
  },
  
  // Red emblems  
  "chandra, torch of defiance": {
    name: "Chandra, Torch of Defiance Emblem",
    oracle_text: "Whenever you cast a spell, this emblem deals 5 damage to any target.",
    colors: ["R"]
  },
  "koth of the hammer": {
    name: "Koth of the Hammer Emblem",
    oracle_text: "Mountains you control have \"{T}: This land deals 1 damage to any target.\"",
    colors: ["R"]
  },
  "chandra, awakened inferno": {
    name: "Chandra, Awakened Inferno Emblem",
    oracle_text: "At the beginning of your upkeep, this emblem deals 1 damage to you.",
    colors: ["R"]
  },
  "daretti, scrap savant": {
    name: "Daretti, Scrap Savant Emblem",
    oracle_text: "Whenever an artifact is put into your graveyard from the battlefield, return that card to the battlefield at the beginning of the next end step.",
    colors: ["R"]
  },
  
  // Green emblems
  "garruk, caller of beasts": {
    name: "Garruk, Caller of Beasts Emblem",
    oracle_text: "Whenever you cast a creature spell, you may search your library for a creature card, put it onto the battlefield, then shuffle.",
    colors: ["G"]
  },
  "nissa, who shakes the world": {
    name: "Nissa, Who Shakes the World Emblem",
    oracle_text: "Lands you control have indestructible.",
    colors: ["G"]
  },
  "vivien reid": {
    name: "Vivien Reid Emblem",
    oracle_text: "Creatures you control get +2/+2 and have vigilance, trample, and indestructible.",
    colors: ["G"]
  },
  "garruk, apex predator": {
    name: "Garruk, Apex Predator Emblem",
    oracle_text: "Whenever a creature attacks you, it gets +5/+5 and gains trample until end of turn.",
    colors: ["B", "G"]
  },
  "nissa, vital force": {
    name: "Nissa, Vital Force Emblem",
    oracle_text: "Whenever a land enters the battlefield under your control, you may draw a card.",
    colors: ["G"]
  },
  
  // Multicolor emblems
  "teferi, hero of dominaria": {
    name: "Teferi, Hero of Dominaria Emblem",
    oracle_text: "Whenever you draw a card, exile target permanent an opponent controls.",
    colors: ["W", "U"]
  },
  "nicol bolas, dragon-god": {
    name: "Nicol Bolas, Dragon-God Emblem",
    oracle_text: "Each opponent who doesn't control a legendary creature or planeswalker loses the game.",
    colors: ["U", "B", "R"]
  },
  "vraska, golgari queen": {
    name: "Vraska, Golgari Queen Emblem",
    oracle_text: "Whenever a creature you control deals combat damage to a player, that player loses the game.",
    colors: ["B", "G"]
  },
  "domri, chaos bringer": {
    name: "Domri, Chaos Bringer Emblem",
    oracle_text: "At the beginning of each end step, create a 4/4 red and green Beast creature token with trample.",
    colors: ["R", "G"]
  },
  "sorin, lord of innistrad": {
    name: "Sorin, Lord of Innistrad Emblem",
    oracle_text: "Creatures you control get +1/+0.",
    colors: ["W", "B"]
  },
  "kiora, the crashing wave": {
    name: "Kiora, the Crashing Wave Emblem",
    oracle_text: "At the beginning of your end step, create a 9/9 blue Kraken creature token.",
    colors: ["G", "U"]
  },
  "venser, the sojourner": {
    name: "Venser, the Sojourner Emblem",
    oracle_text: "Whenever you cast a spell, exile target permanent.",
    colors: ["W", "U"]
  },
  "ajani, mentor of heroes": {
    name: "Ajani, Mentor of Heroes Emblem",
    oracle_text: "You gain 100 life.",
    colors: ["G", "W"]
  },
  "narset transcendent": {
    name: "Narset Transcendent Emblem",
    oracle_text: "Your opponents can't cast noncreature spells.",
    colors: ["W", "U"]
  },
  "sarkhan vol": {
    name: "Sarkhan Vol Emblem",
    oracle_text: "At the beginning of your upkeep, create a 5/5 red Dragon creature token with flying.",
    colors: ["R", "G"]
  },
  "huatli, radiant champion": {
    name: "Huatli, Radiant Champion Emblem",
    oracle_text: "Whenever a creature enters the battlefield under your control, you may draw a card.",
    colors: ["G", "W"]
  },
  "arlinn kord": {
    name: "Arlinn Kord Emblem",
    oracle_text: "Creatures you control have haste and \"{T}: This creature deals damage equal to its power to any target.\"",
    colors: ["R", "G"]
  },
  "dovin baan": {
    name: "Dovin Baan Emblem",
    oracle_text: "Your opponents can't untap more than two permanents during their untap steps.",
    colors: ["W", "U"]
  },
  "tamiyo, field researcher": {
    name: "Tamiyo, Field Researcher Emblem",
    oracle_text: "You may cast nonland cards from your hand without paying their mana costs.",
    colors: ["G", "W", "U"]
  },
  
  // Colorless emblems
  "karn liberated": {
    name: "Karn Liberated Emblem",
    oracle_text: "This emblem represents restarting the game. (Not a real emblem - Karn's ultimate restarts the game)",
    colors: []
  },
  "ugin, the spirit dragon": {
    name: "Ugin, the Spirit Dragon Emblem",
    oracle_text: "You gain 7 life, draw seven cards, then put up to seven permanent cards from your hand onto the battlefield. (Not a real emblem)",
    colors: []
  },
};

/**
 * Get emblem data for a planeswalker
 * @param planeswalkerName - Name of the planeswalker (case insensitive)
 * @returns Emblem data or undefined if not found
 */
export function getEmblemForPlaneswalker(planeswalkerName: string): { name: string; oracle_text: string; colors: string[] } | undefined {
  const nameLower = planeswalkerName.toLowerCase();
  
  // Direct lookup
  if (KNOWN_EMBLEMS[nameLower]) {
    return KNOWN_EMBLEMS[nameLower];
  }
  
  // Partial match (e.g., "Elspeth" matches "elspeth, knight-errant")
  for (const [key, emblem] of Object.entries(KNOWN_EMBLEMS)) {
    if (key.includes(nameLower) || nameLower.includes(key.split(',')[0])) {
      return emblem;
    }
  }
  
  return undefined;
}

/**
 * Get all available emblems
 * @returns Array of emblem definitions
 */
export function getAllEmblems(): { key: string; name: string; oracle_text: string; colors: string[] }[] {
  return Object.entries(KNOWN_EMBLEMS).map(([key, emblem]) => ({
    key,
    ...emblem
  }));
}

/**
 * Create an emblem card object
 * @param options - Emblem creation options
 * @returns Complete emblem card object
 */
export function createEmblemCard(options: {
  id: string;
  name: string;
  oracle_text: string;
  colors?: string[];
  source_planeswalker?: string;
}): EmblemCard {
  return {
    id: options.id,
    name: options.name,
    type_line: 'Emblem',
    oracle_text: options.oracle_text,
    colors: options.colors || [],
    source_planeswalker: options.source_planeswalker,
  };
}

/**
 * Create an emblem from a planeswalker name
 * @param id - Unique ID for the emblem
 * @param planeswalkerName - Name of the source planeswalker
 * @returns Emblem card or undefined if planeswalker has no known emblem
 */
export function createEmblemFromPlaneswalker(id: string, planeswalkerName: string): EmblemCard | undefined {
  const emblemData = getEmblemForPlaneswalker(planeswalkerName);
  if (!emblemData) return undefined;
  
  return createEmblemCard({
    id,
    name: emblemData.name,
    oracle_text: emblemData.oracle_text,
    colors: emblemData.colors,
    source_planeswalker: planeswalkerName,
  });
}
