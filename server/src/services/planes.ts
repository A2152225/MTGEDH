/**
 * server/src/services/planes.ts
 * 
 * Plane data service for Planechase format.
 * Planes are oversized cards that affect all players and can be
 * "planeswalked" away from by rolling the planar die.
 */

/**
 * Plane card definition for Planechase format
 */
export interface PlaneCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  plane_type?: string; // e.g., "Dominaria", "Ravnica", etc.
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
}

/**
 * Phenomenon card definition (special plane-like cards)
 * Phenomena are triggered immediately when encountered and then removed
 */
export interface PhenomenonCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
}

/**
 * Common planes for Planechase
 * Note: Planes have static abilities and chaos abilities (triggered by rolling chaos on planar die)
 * {CHAOS} symbol indicates the chaos ability
 */
const KNOWN_PLANES: Record<string, { name: string; oracle_text: string; plane_type?: string }> = {
  "academy at tolaria west": {
    name: "Academy at Tolaria West",
    oracle_text: "At the beginning of your end step, if you have no cards in hand, draw seven cards.\nWhenever you roll {CHAOS}, discard your hand.",
    plane_type: "Dominaria"
  },
  "agyrem": {
    name: "Agyrem",
    oracle_text: "Whenever a white creature dies, return it to the battlefield under its owner's control at the beginning of the next end step.\nWhenever a nonwhite creature dies, return it to its owner's hand at the beginning of the next end step.\nWhenever you roll {CHAOS}, creatures you control get +1/+1 until end of turn.",
    plane_type: "Ravnica"
  },
  "akoum": {
    name: "Akoum",
    oracle_text: "Players may cast enchantment spells as though they had flash.\nWhenever you roll {CHAOS}, destroy target creature that isn't enchanted.",
    plane_type: "Zendikar"
  },
  "astral arena": {
    name: "Astral Arena",
    oracle_text: "No more than one creature can attack each turn.\nNo more than one creature can block each turn.\nWhenever you roll {CHAOS}, Astral Arena deals 2 damage to each creature.",
    plane_type: "Kolbahan"
  },
  "bant": {
    name: "Bant",
    oracle_text: "All creatures have exalted.\nWhenever you roll {CHAOS}, put a divinity counter on target green, white, or blue creature. That creature has indestructible for as long as it has a divinity counter on it.",
    plane_type: "Alara"
  },
  "bloodhill bastion": {
    name: "Bloodhill Bastion",
    oracle_text: "Whenever a creature enters the battlefield, it gains double strike and haste until end of turn.\nWhenever you roll {CHAOS}, exile target nontoken creature you control, then return it to the battlefield under your control.",
    plane_type: "Equilor"
  },
  "cliffside market": {
    name: "Cliffside Market",
    oracle_text: "When you planeswalk to Cliffside Market or at the beginning of your upkeep, you may exchange life totals with target player.\nWhenever you roll {CHAOS}, exchange control of two target permanents that share a card type.",
    plane_type: "Mercadia"
  },
  "edge of malacol": {
    name: "Edge of Malacol",
    oracle_text: "If a creature you control would untap during your untap step, put two +1/+1 counters on it instead.\nWhenever you roll {CHAOS}, untap each creature you control.",
    plane_type: "Belenon"
  },
  "eloren wilds": {
    name: "Eloren Wilds",
    oracle_text: "Whenever a player taps a permanent for mana, that player adds one mana of any type that permanent produced.\nWhenever you roll {CHAOS}, target player can't cast spells until a player planeswalks.",
    plane_type: "Shandalar"
  },
  "feeding grounds": {
    name: "Feeding Grounds",
    oracle_text: "Red spells cost {R} less to cast. Green spells cost {G} less to cast.\nWhenever you roll {CHAOS}, put X +1/+1 counters on target creature, where X is that creature's mana value.",
    plane_type: "Muraganda"
  },
  "fields of summer": {
    name: "Fields of Summer",
    oracle_text: "Whenever a player casts a spell, that player may gain 2 life.\nWhenever you roll {CHAOS}, you may gain 10 life.",
    plane_type: "Moag"
  },
  "furnace layer": {
    name: "Furnace Layer",
    oracle_text: "When you planeswalk to Furnace Layer or at the beginning of your upkeep, select target player at random. That player discards a card. If that player discards a land card this way, they lose 3 life.\nWhenever you roll {CHAOS}, you may destroy target nonland permanent.",
    plane_type: "New Phyrexia"
  },
  "gavony": {
    name: "Gavony",
    oracle_text: "All creatures have vigilance.\nWhenever you roll {CHAOS}, creatures you control gain indestructible until end of turn.",
    plane_type: "Innistrad"
  },
  "glen elendra": {
    name: "Glen Elendra",
    oracle_text: "At the beginning of your upkeep, you gain 1 life for each creature with flying you control.\nWhenever you roll {CHAOS}, create a 1/1 green Elf creature token with flying.",
    plane_type: "Lorwyn"
  },
  "grand ossuary": {
    name: "Grand Ossuary",
    oracle_text: "Whenever a creature dies, its controller distributes a number of +1/+1 counters equal to its power among any number of target creatures they control.\nWhenever you roll {CHAOS}, each player exiles all creatures they control and creates X 1/1 green Saproling creature tokens, where X is the total power of the creatures they exiled this way. Then planeswalk.",
    plane_type: "Ravnica"
  },
  "grixis": {
    name: "Grixis",
    oracle_text: "Blue, black, and/or red creature cards in your graveyard have unearth. The unearth cost is equal to the card's mana cost.\nWhenever you roll {CHAOS}, put target creature card from a graveyard onto the battlefield under your control.",
    plane_type: "Alara"
  },
  "grove of the dreampods": {
    name: "Grove of the Dreampods",
    oracle_text: "When you planeswalk to Grove of the Dreampods or at the beginning of your upkeep, reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.\nWhenever you roll {CHAOS}, return target creature card from your graveyard to the battlefield.",
    plane_type: "Fabacin"
  },
  "hedron fields of agadeem": {
    name: "Hedron Fields of Agadeem",
    oracle_text: "Creatures with power 7 or greater can't attack or block.\nWhenever you roll {CHAOS}, create a 7/7 colorless Eldrazi creature token with annihilator 1.",
    plane_type: "Zendikar"
  },
  "immersturm": {
    name: "Immersturm",
    oracle_text: "Whenever a creature enters the battlefield, that creature's controller may have it deal damage equal to its power to any target.\nWhenever you roll {CHAOS}, exile target creature, then return it to the battlefield under its owner's control.",
    plane_type: "Valla"
  },
  "isle of vesuva": {
    name: "Isle of Vesuva",
    oracle_text: "Whenever a nontoken creature enters the battlefield, its controller creates a token that's a copy of that creature.\nWhenever you roll {CHAOS}, create a token that's a copy of target permanent.",
    plane_type: "Dominaria"
  },
  "izzet steam maze": {
    name: "Izzet Steam Maze",
    oracle_text: "Whenever a player casts an instant or sorcery spell, that player copies it. The player may choose new targets for the copy.\nWhenever you roll {CHAOS}, instant and sorcery spells you cast this turn cost {3} less to cast.",
    plane_type: "Ravnica"
  },
  "jund": {
    name: "Jund",
    oracle_text: "Whenever a player casts a creature spell, it gains devour 5.\nWhenever you roll {CHAOS}, create two 1/1 red and green Saproling creature tokens.",
    plane_type: "Alara"
  },
  "kessig": {
    name: "Kessig",
    oracle_text: "Whenever a creature attacks, any player may pay {G}. If no one does, that creature gets +2/+0 and gains trample until end of turn.\nWhenever you roll {CHAOS}, each creature you control gets +2/+0 and gains trample until end of turn.",
    plane_type: "Innistrad"
  },
  "kharasha foothills": {
    name: "Kharasha Foothills",
    oracle_text: "Whenever a creature you control attacks a player, for each other opponent, you may create a token that's a copy of that creature, tapped and attacking that opponent. Exile those tokens at the beginning of the next end step.\nWhenever you roll {CHAOS}, you may sacrifice any number of creatures. If you do, Kharasha Foothills deals that much damage to target creature.",
    plane_type: "Mongseng"
  },
  "kilnspire district": {
    name: "Kilnspire District",
    oracle_text: "When you planeswalk to Kilnspire District or at the beginning of your upkeep, put a charge counter on Kilnspire District, then add {R} for each charge counter on it.\nWhenever you roll {CHAOS}, you may pay {X}. If you do, Kilnspire District deals X damage to any target.",
    plane_type: "Ravnica"
  },
  "krosa": {
    name: "Krosa",
    oracle_text: "All creatures get +2/+2.\nWhenever you roll {CHAOS}, you may add {W}{U}{B}{R}{G}.",
    plane_type: "Dominaria"
  },
  "lair of the ashen idol": {
    name: "Lair of the Ashen Idol",
    oracle_text: "At the beginning of your upkeep, sacrifice a creature. If you can't, planeswalk.\nWhenever you roll {CHAOS}, any number of target players each create a 2/2 black Zombie creature token.",
    plane_type: "Azgol"
  },
  "lethe lake": {
    name: "Lethe Lake",
    oracle_text: "At the beginning of your upkeep, mill ten cards.\nWhenever you roll {CHAOS}, target player mills ten cards.",
    plane_type: "Arkhos"
  },
  "llanowar": {
    name: "Llanowar",
    oracle_text: "All creatures have \"{T}: Add {G}{G}.\"\nWhenever you roll {CHAOS}, untap all creatures you control.",
    plane_type: "Dominaria"
  },
  "minamo": {
    name: "Minamo",
    oracle_text: "Whenever a player casts a spell, that player may draw a card.\nWhenever you roll {CHAOS}, each player may return a blue card from their graveyard to their hand.",
    plane_type: "Kamigawa"
  },
  "mirrored depths": {
    name: "Mirrored Depths",
    oracle_text: "Whenever a player casts a spell, that player flips a coin. If the player loses the flip, counter that spell.\nWhenever you roll {CHAOS}, target player reveals the top card of their library. If it's a nonland card, you may cast it without paying its mana cost.",
    plane_type: "Karsus"
  },
  "mount keralia": {
    name: "Mount Keralia",
    oracle_text: "At the beginning of your end step, put a pressure counter on Mount Keralia.\nWhen you planeswalk away from Mount Keralia, it deals damage equal to the number of pressure counters on it to each creature and each planeswalker.\nWhenever you roll {CHAOS}, prevent all damage that planes would deal this game to permanents you control.",
    plane_type: "Regatha"
  },
  "murasa": {
    name: "Murasa",
    oracle_text: "Whenever a nontoken creature enters the battlefield, its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle.\nWhenever you roll {CHAOS}, target land becomes a 4/4 creature that's still a land.",
    plane_type: "Zendikar"
  },
  "naar isle": {
    name: "Naar Isle",
    oracle_text: "At the beginning of your upkeep, put a flame counter on Naar Isle, then Naar Isle deals damage to you equal to the number of flame counters on it.\nWhenever you roll {CHAOS}, Naar Isle deals 3 damage to target player or planeswalker.",
    plane_type: "Wildfire"
  },
  "naya": {
    name: "Naya",
    oracle_text: "You may play any number of lands on each of your turns.\nWhenever you roll {CHAOS}, target red, green, or white creature you control gets +1/+1 until end of turn for each land you control.",
    plane_type: "Alara"
  },
  "nephalia": {
    name: "Nephalia",
    oracle_text: "All creatures have flying.\nWhenever you roll {CHAOS}, return target card from your graveyard to your hand.",
    plane_type: "Innistrad"
  },
  "norn's dominion": {
    name: "Norn's Dominion",
    oracle_text: "When you planeswalk away from Norn's Dominion, destroy each nonland permanent without a fate counter on it, then remove all fate counters from all permanents.\nWhenever you roll {CHAOS}, you may put a fate counter on target permanent.",
    plane_type: "New Phyrexia"
  },
  "onakke catacomb": {
    name: "Onakke Catacomb",
    oracle_text: "All creatures are black and have deathtouch.\nWhenever you roll {CHAOS}, creatures you control get +1/+0 and gain first strike until end of turn.",
    plane_type: "Shandalar"
  },
  "orochi colony": {
    name: "Orochi Colony",
    oracle_text: "Whenever a creature you control deals combat damage to a player, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nWhenever you roll {CHAOS}, target creature can't be blocked this turn.",
    plane_type: "Kamigawa"
  },
  "orzhova": {
    name: "Orzhova",
    oracle_text: "When you planeswalk away from Orzhova or at the beginning of your upkeep, each player who has more life than each other player loses 2 life.\nWhenever you roll {CHAOS}, target player gains 10 life.",
    plane_type: "Ravnica"
  },
  "otaria": {
    name: "Otaria",
    oracle_text: "Instant and sorcery cards in graveyards have flashback. The flashback cost is equal to the card's mana cost.\nWhenever you roll {CHAOS}, take an extra turn after this one.",
    plane_type: "Dominaria"
  },
  "panopticon": {
    name: "Panopticon",
    oracle_text: "When you planeswalk to Panopticon, draw a card.\nAt the beginning of your draw step, draw an additional card.\nWhenever you roll {CHAOS}, draw a card.",
    plane_type: "Mirrodin"
  },
  "pools of becoming": {
    name: "Pools of Becoming",
    oracle_text: "At the beginning of your end step, put the cards in your hand on the bottom of your library in any order, then draw that many cards.\nWhenever you roll {CHAOS}, reveal the top three cards of your planar deck. Each of the revealed cards' chaos abilities triggers. Then put the revealed cards on the bottom of your planar deck in any order.",
    plane_type: "Bolas's Meditation Realm"
  },
  "prahv": {
    name: "Prahv",
    oracle_text: "If you cast a spell this turn, you can't attack with creatures.\nIf you attacked with creatures this turn, you can't cast spells.\nWhenever you roll {CHAOS}, you may gain 10 life.",
    plane_type: "Ravnica"
  },
  "quicksilver sea": {
    name: "Quicksilver Sea",
    oracle_text: "When you planeswalk to Quicksilver Sea or at the beginning of your upkeep, scry 4.\nWhenever you roll {CHAOS}, reveal the top card of your library. You may play it without paying its mana cost.",
    plane_type: "Mirrodin"
  },
  "raven's run": {
    name: "Raven's Run",
    oracle_text: "All creatures have wither.\nWhenever you roll {CHAOS}, put a -1/-1 counter on each creature.",
    plane_type: "Shadowmoor"
  },
  "sanctum of serra": {
    name: "Sanctum of Serra",
    oracle_text: "When you planeswalk away from Sanctum of Serra, destroy all nonland permanents.\nWhenever you roll {CHAOS}, you may have your life total become 20.",
    plane_type: "Serra's Realm"
  },
  "sea of sand": {
    name: "Sea of Sand",
    oracle_text: "Players reveal each card they draw.\nWhenever a player draws a land card, that player gains 3 life.\nWhenever a player draws a nonland card, that player loses 3 life.\nWhenever you roll {CHAOS}, put target permanent on top of its owner's library.",
    plane_type: "Rabiah"
  },
  "selesnya loft gardens": {
    name: "Selesnya Loft Gardens",
    oracle_text: "If an effect would create one or more tokens, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent, it puts twice that many of those counters on that permanent instead.\nWhenever you roll {CHAOS}, until end of turn, whenever you tap a land for mana, add one mana of any type that land produced.",
    plane_type: "Ravnica"
  },
  "shiv": {
    name: "Shiv",
    oracle_text: "All creatures have \"{R}: This creature gets +1/+0 until end of turn.\"\nWhenever you roll {CHAOS}, Shiv deals 1 damage to each creature and each player.",
    plane_type: "Dominaria"
  },
  "skybreen": {
    name: "Skybreen",
    oracle_text: "Players play with the top card of their libraries revealed.\nSpells that share a card type with the top card of a library can't be cast.\nWhenever you roll {CHAOS}, target player loses life equal to the number of cards in their hand.",
    plane_type: "Kaldheim"
  },
  "sokenzan": {
    name: "Sokenzan",
    oracle_text: "All creatures get +1/+0 and have haste.\nWhenever you roll {CHAOS}, untap all creatures that attacked this turn. If it's a main phase, there is an additional combat phase followed by an additional main phase.",
    plane_type: "Kamigawa"
  },
  "stairs to infinity": {
    name: "Stairs to Infinity",
    oracle_text: "Players have no maximum hand size.\nWhenever you roll the planar die, draw a card.\nWhenever you roll {CHAOS}, reveal the top card of your planar deck. You may put it on the bottom of your planar deck.",
    plane_type: "Xerex"
  },
  "stensia": {
    name: "Stensia",
    oracle_text: "Whenever a creature deals damage to one or more players for the first time each turn, put a +1/+1 counter on it.\nWhenever you roll {CHAOS}, each creature you control gains \"{T}: This creature deals 2 damage to target player or planeswalker\" until end of turn.",
    plane_type: "Innistrad"
  },
  "stronghold furnace": {
    name: "Stronghold Furnace",
    oracle_text: "If a source would deal damage to a permanent or player, it deals double that damage instead.\nWhenever you roll {CHAOS}, Stronghold Furnace deals 1 damage to any target.",
    plane_type: "Rath"
  },
  "takenuma": {
    name: "Takenuma",
    oracle_text: "Whenever a creature leaves the battlefield, its controller draws a card.\nWhenever you roll {CHAOS}, return target creature card from your graveyard to your hand.",
    plane_type: "Kamigawa"
  },
  "tazeem": {
    name: "Tazeem",
    oracle_text: "Creatures can't block.\nWhenever you roll {CHAOS}, draw a card for each land you control.",
    plane_type: "Zendikar"
  },
  "the dark barony": {
    name: "The Dark Barony",
    oracle_text: "Whenever a nonblack card is put into a player's graveyard from anywhere, that player loses 1 life.\nWhenever you roll {CHAOS}, each opponent discards a card.",
    plane_type: "Ulgrotha"
  },
  "the eon fog": {
    name: "The Eon Fog",
    oracle_text: "Players skip their untap steps.\nAt the beginning of each player's upkeep, that player untaps a single permanent of their choice.\nWhenever you roll {CHAOS}, untap all permanents you control.",
    plane_type: "Equilor"
  },
  "the fourth sphere": {
    name: "The Fourth Sphere",
    oracle_text: "At the beginning of your upkeep, sacrifice a nonblack creature.\nWhenever you roll {CHAOS}, create a 2/2 black Zombie creature token.",
    plane_type: "Phyrexia"
  },
  "the great forest": {
    name: "The Great Forest",
    oracle_text: "Each creature assigns combat damage equal to its toughness rather than its power.\nWhenever you roll {CHAOS}, creatures you control get +0/+2 and gain trample until end of turn.",
    plane_type: "Lorwyn"
  },
  "the hippodrome": {
    name: "The Hippodrome",
    oracle_text: "At end of combat, if you attacked with three or more creatures this turn, after this main phase, there is an additional combat phase followed by an additional main phase.\nWhenever you roll {CHAOS}, create a 2/2 white and blue Pegasus creature token with flying.",
    plane_type: "Segovia"
  },
  "the maelstrom": {
    name: "The Maelstrom",
    oracle_text: "When you planeswalk to The Maelstrom or at the beginning of your upkeep, you may reveal the top card of your library. If it's a permanent card, you may put it onto the battlefield. If you revealed a card but didn't put it onto the battlefield, put it on the bottom of your library.\nWhenever you roll {CHAOS}, return target permanent card from your graveyard to the battlefield.",
    plane_type: "Alara"
  },
  "the zephyr maze": {
    name: "The Zephyr Maze",
    oracle_text: "Creatures with flying get +2/+0.\nCreatures without flying get -2/-0.\nWhenever you roll {CHAOS}, target creature gains flying until end of turn.",
    plane_type: "Iquatana"
  },
  "time distortion": {
    name: "Time Distortion",
    oracle_text: "Whenever a creature enters the battlefield, its controller puts a time counter on it and exiles it.\nAt the beginning of your upkeep, for each permanent you own exiled with a time counter on it, remove a time counter from that permanent. If the card has no time counters on it, put it onto the battlefield.\nWhenever you roll {CHAOS}, you may put a time counter on each permanent you own exiled with a time counter on it, or you may remove a time counter from each permanent you own exiled with a time counter on it.",
    plane_type: "Equilor"
  },
  "trail of the mage-rings": {
    name: "Trail of the Mage-Rings",
    oracle_text: "Instant and sorcery spells have rebound.\nWhenever you roll {CHAOS}, you may search your library for an instant or sorcery card, reveal it, put it into your hand, then shuffle.",
    plane_type: "Vryn"
  },
  "truga jungle": {
    name: "Truga Jungle",
    oracle_text: "All lands have \"{T}: Add one mana of any color.\"\nWhenever you roll {CHAOS}, reveal the top three cards of your library. Put all land cards revealed this way into your hand and the rest on the bottom of your library in any order.",
    plane_type: "Ergamon"
  },
  "turri island": {
    name: "Turri Island",
    oracle_text: "Creature spells cost {2} less to cast.\nWhenever you roll {CHAOS}, reveal the top three cards of your library. Put all creature cards revealed this way into your hand and the rest on the bottom of your library in any order.",
    plane_type: "Ir"
  },
  "undercity reaches": {
    name: "Undercity Reaches",
    oracle_text: "Whenever a creature deals combat damage to a player, its controller may draw a card.\nWhenever you roll {CHAOS}, you have no maximum hand size for the rest of the game.",
    plane_type: "Ravnica"
  },
  "velis vel": {
    name: "Velis Vel",
    oracle_text: "Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.\nWhenever you roll {CHAOS}, target creature gains all creature types until end of turn.",
    plane_type: "Lorwyn"
  },
  "windriddle palaces": {
    name: "Windriddle Palaces",
    oracle_text: "Players play with the top card of their libraries revealed.\nYou may play lands and cast spells from the top of any player's library.\nWhenever you roll {CHAOS}, each player mills a card.",
    plane_type: "Belenon"
  },
};

/**
 * Known phenomena cards
 */
const KNOWN_PHENOMENA: Record<string, { name: string; oracle_text: string }> = {
  "chaotic aether": {
    name: "Chaotic Æther",
    oracle_text: "When you encounter Chaotic Æther, each blank roll of the planar die is a {CHAOS} roll until a player planeswalks away from a plane. (Then planeswalk away from this phenomenon.)"
  },
  "interplanar tunnel": {
    name: "Interplanar Tunnel",
    oracle_text: "When you encounter Interplanar Tunnel, reveal cards from the top of your planar deck until you reveal five plane cards. Put a plane card from among them on top of your planar deck, then put the rest of the revealed cards on the bottom in a random order. (Then planeswalk away from this phenomenon.)"
  },
  "morphic tide": {
    name: "Morphic Tide",
    oracle_text: "When you encounter Morphic Tide, each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, land, and enchantment cards revealed this way onto the battlefield, then does the same for planeswalker cards, then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library in any order. (Then planeswalk away from this phenomenon.)"
  },
  "mutual epiphany": {
    name: "Mutual Epiphany",
    oracle_text: "When you encounter Mutual Epiphany, each player draws four cards. (Then planeswalk away from this phenomenon.)"
  },
  "planewide disaster": {
    name: "Planewide Disaster",
    oracle_text: "When you encounter Planewide Disaster, destroy all creatures. (Then planeswalk away from this phenomenon.)"
  },
  "reality shaping": {
    name: "Reality Shaping",
    oracle_text: "When you encounter Reality Shaping, starting with you, each player may put a permanent card from their hand onto the battlefield. (Then planeswalk away from this phenomenon.)"
  },
  "spatial merging": {
    name: "Spatial Merging",
    oracle_text: "When you encounter Spatial Merging, reveal cards from the top of your planar deck until you reveal two plane cards. Simultaneously planeswalk to both of them. Put all other cards revealed this way on the bottom of your planar deck in any order."
  },
  "time distortion phenomenon": {
    name: "Time Distortion",
    oracle_text: "When you encounter Time Distortion, reverse the game's turn order. (For example, if play had proceeded clockwise around the table, it now goes counterclockwise.) (Then planeswalk away from this phenomenon.)"
  },
};

/**
 * Get a plane by name
 * @param planeName - Name of the plane (case insensitive)
 * @returns Plane data or undefined
 */
export function getPlaneByName(planeName: string): { name: string; oracle_text: string; plane_type?: string } | undefined {
  const nameLower = planeName.toLowerCase();
  return KNOWN_PLANES[nameLower];
}

/**
 * Get all available planes
 * @returns Array of plane definitions
 */
export function getAllPlanes(): { key: string; name: string; oracle_text: string; plane_type?: string }[] {
  return Object.entries(KNOWN_PLANES).map(([key, plane]) => ({
    key,
    ...plane
  }));
}

/**
 * Get planes by plane type (world)
 * @param planeType - The plane type/world to filter by (e.g., "Ravnica", "Dominaria")
 * @returns Array of planes from that world
 */
export function getPlanesByWorld(planeType: string): { key: string; name: string; oracle_text: string; plane_type?: string }[] {
  const typeLower = planeType.toLowerCase();
  return Object.entries(KNOWN_PLANES)
    .filter(([_, plane]) => plane.plane_type?.toLowerCase() === typeLower)
    .map(([key, plane]) => ({ key, ...plane }));
}

/**
 * Get a phenomenon by name
 * @param phenomenonName - Name of the phenomenon (case insensitive)
 * @returns Phenomenon data or undefined
 */
export function getPhenomenonByName(phenomenonName: string): { name: string; oracle_text: string } | undefined {
  const nameLower = phenomenonName.toLowerCase();
  return KNOWN_PHENOMENA[nameLower];
}

/**
 * Get all available phenomena
 * @returns Array of phenomenon definitions
 */
export function getAllPhenomena(): { key: string; name: string; oracle_text: string }[] {
  return Object.entries(KNOWN_PHENOMENA).map(([key, phenomenon]) => ({
    key,
    ...phenomenon
  }));
}

/**
 * Create a plane card object
 * @param options - Plane creation options
 * @returns Complete plane card object
 */
export function createPlaneCard(options: {
  id: string;
  name: string;
  oracle_text: string;
  plane_type?: string;
}): PlaneCard {
  return {
    id: options.id,
    name: options.name,
    type_line: `Plane — ${options.plane_type || 'Unknown'}`,
    oracle_text: options.oracle_text,
    plane_type: options.plane_type,
  };
}

/**
 * Create a phenomenon card object
 * @param options - Phenomenon creation options
 * @returns Complete phenomenon card object
 */
export function createPhenomenonCard(options: {
  id: string;
  name: string;
  oracle_text: string;
}): PhenomenonCard {
  return {
    id: options.id,
    name: options.name,
    type_line: 'Phenomenon',
    oracle_text: options.oracle_text,
  };
}

/**
 * Get a random plane for starting a Planechase game
 * @returns Random plane definition
 */
export function getRandomPlane(): { key: string; name: string; oracle_text: string; plane_type?: string } {
  const planes = getAllPlanes();
  const randomIndex = Math.floor(Math.random() * planes.length);
  return planes[randomIndex];
}
