/**
 * server/src/services/schemes.ts
 * 
 * Scheme data service for Archenemy format.
 * Schemes are oversized cards that the Archenemy player sets in motion
 * to gain powerful effects against the other players.
 */

/**
 * Scheme card definition for Archenemy format
 */
export interface SchemeCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  is_ongoing: boolean;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
}

/**
 * Common schemes for Archenemy
 * Schemes have "When you set this scheme in motion" abilities
 * Ongoing schemes stay in play until their condition is met
 */
const KNOWN_SCHEMES: Record<string, { name: string; oracle_text: string; is_ongoing: boolean }> = {
  // ============================================================================
  // NON-ONGOING SCHEMES
  // ============================================================================
  
  "all in good time": {
    name: "All in Good Time",
    oracle_text: "When you set this scheme in motion, take an extra turn after this one.",
    is_ongoing: false
  },
  "approach my molten realm": {
    name: "Approach My Molten Realm",
    oracle_text: "When you set this scheme in motion, until your next turn, if a source would deal damage, it deals double that damage instead.",
    is_ongoing: false
  },
  "behold the power of destruction": {
    name: "Behold the Power of Destruction",
    oracle_text: "When you set this scheme in motion, destroy all nonland permanents target opponent controls.",
    is_ongoing: false
  },
  "choose your champion": {
    name: "Choose Your Champion",
    oracle_text: "When you set this scheme in motion, target opponent chooses a player. Until your next turn, only you and the chosen player may cast spells and attack.",
    is_ongoing: false
  },
  "dance, pathetic marionette": {
    name: "Dance, Pathetic Marionette",
    oracle_text: "When you set this scheme in motion, each opponent reveals the top card of their library. You may have each of them put that card into their graveyard. Then you may put any number of creature cards put into graveyards this way onto the battlefield under your control.",
    is_ongoing: false
  },
  "drench the soil in their blood": {
    name: "Drench the Soil in Their Blood",
    oracle_text: "When you set this scheme in motion, after this main phase, there is an additional combat phase followed by an additional main phase. Creatures you control gain haste until end of turn.",
    is_ongoing: false
  },
  "embrace my diabolical vision": {
    name: "Embrace My Diabolical Vision",
    oracle_text: "When you set this scheme in motion, each player shuffles their hand and graveyard into their library. You draw seven cards, then each other player draws four cards.",
    is_ongoing: false
  },
  "evil comes to fruition": {
    name: "Evil Comes to Fruition",
    oracle_text: "When you set this scheme in motion, create seven 0/1 black Thrull creature tokens.",
    is_ongoing: false
  },
  "every hope shall vanish": {
    name: "Every Hope Shall Vanish",
    oracle_text: "When you set this scheme in motion, each opponent reveals their hand. Choose a nonland card from each of those hands. Those players discard those cards.",
    is_ongoing: false
  },
  "feed the machine": {
    name: "Feed the Machine",
    oracle_text: "When you set this scheme in motion, target opponent chooses self or others. If that player chooses self, that player sacrifices two creatures. If the player chooses others, each other player sacrifices a creature.",
    is_ongoing: false
  },
  "i bask in your silent awe": {
    name: "I Bask in Your Silent Awe",
    oracle_text: "When you set this scheme in motion, each opponent can't cast spells until your next turn.",
    is_ongoing: false
  },
  "i know all, i see all": {
    name: "I Know All, I See All",
    oracle_text: "When you set this scheme in motion, draw four cards.",
    is_ongoing: false
  },
  "ignite the cloneforge!": {
    name: "Ignite the Cloneforge!",
    oracle_text: "When you set this scheme in motion, create a token that's a copy of target permanent an opponent controls.",
    is_ongoing: false
  },
  "introductions are in order": {
    name: "Introductions Are in Order",
    oracle_text: "When you set this scheme in motion, choose one —\n• Search your library for a creature card, reveal it, put it into your hand, then shuffle.\n• You may put a creature card from your hand onto the battlefield.",
    is_ongoing: false
  },
  "know naught but fire": {
    name: "Know Naught but Fire",
    oracle_text: "When you set this scheme in motion, this scheme deals 3 damage to each opponent and each creature your opponents control.",
    is_ongoing: false
  },
  "look skyward and despair": {
    name: "Look Skyward and Despair",
    oracle_text: "When you set this scheme in motion, create a 5/5 black Dragon creature token with flying.",
    is_ongoing: false
  },
  "may civilization collapse": {
    name: "May Civilization Collapse",
    oracle_text: "When you set this scheme in motion, each opponent chooses a land they control. Destroy all lands your opponents control except those lands.",
    is_ongoing: false
  },
  "mortal flesh is weak": {
    name: "Mortal Flesh Is Weak",
    oracle_text: "When you set this scheme in motion, put a +1/+1 counter on each creature you control.",
    is_ongoing: false
  },
  "my crushing masterstroke": {
    name: "My Crushing Masterstroke",
    oracle_text: "When you set this scheme in motion, gain control of all nonland permanents your opponents control until end of turn. Untap those permanents. They gain haste until end of turn.",
    is_ongoing: false
  },
  "my genius knows no bounds": {
    name: "My Genius Knows No Bounds",
    oracle_text: "When you set this scheme in motion, draw cards equal to the number of cards in your hand, then discard three cards.",
    is_ongoing: false
  },
  "my undead horde awakens": {
    name: "My Undead Horde Awakens",
    oracle_text: "When you set this scheme in motion, you may put target creature card from an opponent's graveyard onto the battlefield under your control.",
    is_ongoing: false
  },
  "my wish is your command": {
    name: "My Wish Is Your Command",
    oracle_text: "When you set this scheme in motion, each opponent reveals their hand. Choose an instant or sorcery card revealed this way. Copy that card. You may cast the copy without paying its mana cost.",
    is_ongoing: false
  },
  "nature demands an offering": {
    name: "Nature Demands an Offering",
    oracle_text: "When you set this scheme in motion, target opponent chooses a creature they control. You gain control of it.",
    is_ongoing: false
  },
  "nothing can stop me now": {
    name: "Nothing Can Stop Me Now",
    oracle_text: "When you set this scheme in motion, you gain 20 life.",
    is_ongoing: false
  },
  "only blood ends your nightmares": {
    name: "Only Blood Ends Your Nightmares",
    oracle_text: "When you set this scheme in motion, each opponent loses 2 life for each card in their hand.",
    is_ongoing: false
  },
  "perhaps you've met my cohort": {
    name: "Perhaps You've Met My Cohort",
    oracle_text: "When you set this scheme in motion, search your library for a planeswalker card, put it onto the battlefield, then shuffle.",
    is_ongoing: false
  },
  "realms befitting my majesty": {
    name: "Realms Befitting My Majesty",
    oracle_text: "When you set this scheme in motion, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle. You gain 4 life.",
    is_ongoing: false
  },
  "roots of all evil": {
    name: "Roots of All Evil",
    oracle_text: "When you set this scheme in motion, create a 0/1 black Plant creature token. It has \"This creature gets +1/+1 for each creature card in all graveyards.\"",
    is_ongoing: false
  },
  "surrender your thoughts": {
    name: "Surrender Your Thoughts",
    oracle_text: "When you set this scheme in motion, each opponent discards two cards.",
    is_ongoing: false
  },
  "the fate of the flammable": {
    name: "The Fate of the Flammable",
    oracle_text: "When you set this scheme in motion, this scheme deals 3 damage to each of up to three targets.",
    is_ongoing: false
  },
  "the pieces are coming together": {
    name: "The Pieces Are Coming Together",
    oracle_text: "When you set this scheme in motion, draw two cards.",
    is_ongoing: false
  },
  "the very soil shall shake": {
    name: "The Very Soil Shall Shake",
    oracle_text: "When you set this scheme in motion, create a 7/7 colorless Golem artifact creature token.",
    is_ongoing: false
  },
  "tooth, claw, and tail": {
    name: "Tooth, Claw, and Tail",
    oracle_text: "When you set this scheme in motion, create three 2/2 black Zombie creature tokens.",
    is_ongoing: false
  },
  "your fate is thrice sealed": {
    name: "Your Fate Is Thrice Sealed",
    oracle_text: "When you set this scheme in motion, this scheme deals 5 damage to target creature an opponent controls, 3 damage to another target creature an opponent controls, and 1 damage to a third target creature an opponent controls.",
    is_ongoing: false
  },
  "your puny minds cannot fathom": {
    name: "Your Puny Minds Cannot Fathom",
    oracle_text: "When you set this scheme in motion, draw four cards, then discard two cards.",
    is_ongoing: false
  },
  "your will is not your own": {
    name: "Your Will Is Not Your Own",
    oracle_text: "When you set this scheme in motion, gain control of target creature an opponent controls until end of turn. Untap it. It gains haste until end of turn.",
    is_ongoing: false
  },
  
  // Additional non-ongoing schemes
  "a display of my dark power": {
    name: "A Display of My Dark Power",
    oracle_text: "When you set this scheme in motion, until your next turn, whenever a player taps a land for mana, that player adds one mana of any type that land produced.",
    is_ongoing: false
  },
  "into the void, without a trace": {
    name: "Into the Void, Without a Trace",
    oracle_text: "When you set this scheme in motion, exile target nonland permanent, then exile a card from its controller's hand at random.",
    is_ongoing: false
  },
  "plots that span centuries": {
    name: "Plots That Span Centuries",
    oracle_text: "When you set this scheme in motion, the next time you set a scheme in motion, set three schemes in motion instead.",
    is_ongoing: false
  },
  "power without equal": {
    name: "Power Without Equal",
    oracle_text: "When you set this scheme in motion, if there are three or more opponents, choose opponent. The next time a source controlled by one of your opponents other than the chosen player would deal damage to you, that opponent becomes your teammate. (You share a life total, take turns together, and can attack each other.)",
    is_ongoing: false
  },
  "rotted ones, lay siege": {
    name: "Rotted Ones, Lay Siege",
    oracle_text: "When you set this scheme in motion, for each opponent, create a 2/2 black Zombie creature token that attacks that player each combat if able.",
    is_ongoing: false
  },
  "secrets of the grave": {
    name: "Secrets of the Grave",
    oracle_text: "When you set this scheme in motion, you may have each player mill three cards. Then put any number of creature cards from graveyards onto the battlefield under your control.",
    is_ongoing: false
  },
  "the dead shall serve": {
    name: "The Dead Shall Serve",
    oracle_text: "When you set this scheme in motion, for each opponent, put up to one target creature card from that player's graveyard onto the battlefield under your control.",
    is_ongoing: false
  },
  "which of you will be first": {
    name: "Which of You Will Be First",
    oracle_text: "When you set this scheme in motion, destroy target creature an opponent controls.",
    is_ongoing: false
  },
  
  // ============================================================================
  // ONGOING SCHEMES
  // ============================================================================
  
  "all shall smolder in my wake": {
    name: "All Shall Smolder in My Wake",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nAt the beginning of your end step, this scheme deals 3 damage to each opponent.\nWhenever a source an opponent controls deals damage to you, abandon this scheme.",
    is_ongoing: true
  },
  "choose your demise": {
    name: "Choose Your Demise",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nWhen you set this scheme in motion, look at the top card of each opponent's library.\nYou may have any player draw a card. If you don't, abandon this scheme.",
    is_ongoing: true
  },
  "every last vestige shall rot": {
    name: "Every Last Vestige Shall Rot",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nAt the beginning of your upkeep, put a rot counter on each nonland permanent your opponents control.\nIf a permanent has a rot counter on it, it has \"At the beginning of your upkeep, sacrifice this permanent unless you pay 2 life.\"\nWhenever a player sacrifices a permanent, abandon this scheme.",
    is_ongoing: true
  },
  "i delight in your convulsions": {
    name: "I Delight in Your Convulsions",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nWhenever you set a scheme in motion, this scheme deals 1 damage to each opponent.\nIf ten or more damage has been dealt to opponents by schemes named I Delight in Your Convulsions, abandon this scheme.",
    is_ongoing: true
  },
  "into the earthen maw": {
    name: "Into the Earthen Maw",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nWhen you set this scheme in motion, exile up to three target nonland permanents.\nWhen this scheme is abandoned, return all cards exiled with it to the battlefield under their owners' control.\nAt the beginning of your upkeep, abandon this scheme.",
    is_ongoing: true
  },
  "make yourself useful": {
    name: "Make Yourself Useful",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nWhenever a creature an opponent controls dies, you may draw a card. If you do, abandon this scheme.",
    is_ongoing: true
  },
  "my forces are innumerable": {
    name: "My Forces Are Innumerable",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nCreatures you control have trample.\nWhenever a creature you control deals combat damage to a player, abandon this scheme.",
    is_ongoing: true
  },
  "the iron guardian stirs": {
    name: "The Iron Guardian Stirs",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nWhen you set this scheme in motion, create a 4/6 colorless Golem artifact creature token.\nWhen that token leaves the battlefield, abandon this scheme.",
    is_ongoing: true
  },
  "which of you burns brightest?": {
    name: "Which of You Burns Brightest?",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nAt the beginning of your end step, this scheme deals 1 damage to the opponent with the highest life total among your opponents.\nWhen a player dealt damage by this scheme this way has 10 or less life, abandon this scheme.",
    is_ongoing: true
  },
  
  // Additional ongoing schemes
  "bow to my command": {
    name: "Bow to My Command",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nCreatures can't attack you or planeswalkers you control.\nAt the beginning of your upkeep, if no opponent has more life than you, abandon this scheme.",
    is_ongoing: true
  },
  "my forces know no end": {
    name: "My Forces Know No End",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nAt the beginning of combat on your turn, create a 3/3 black Horror creature token.\nWhenever a Horror you control dies, abandon this scheme.",
    is_ongoing: true
  },
  "the world sways to my rhythm": {
    name: "The World Sways to My Rhythm",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nSpells cost {1} more to cast.\nAt the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.",
    is_ongoing: true
  },
  "your insolence will be your undoing": {
    name: "Your Insolence Will Be Your Undoing",
    oracle_text: "(An ongoing scheme remains face up until it's abandoned.)\nWhenever you're dealt damage, this scheme deals that much damage to target creature or planeswalker an opponent controls.\nWhenever three or more sources deal damage to you simultaneously, abandon this scheme.",
    is_ongoing: true
  },
};

/**
 * Get a scheme by name
 * @param schemeName - Name of the scheme (case insensitive)
 * @returns Scheme data or undefined
 */
export function getSchemeByName(schemeName: string): { name: string; oracle_text: string; is_ongoing: boolean } | undefined {
  const nameLower = schemeName.toLowerCase();
  return KNOWN_SCHEMES[nameLower];
}

/**
 * Get all available schemes
 * @returns Array of scheme definitions
 */
export function getAllSchemes(): { key: string; name: string; oracle_text: string; is_ongoing: boolean }[] {
  return Object.entries(KNOWN_SCHEMES).map(([key, scheme]) => ({
    key,
    ...scheme
  }));
}

/**
 * Get all ongoing schemes
 * @returns Array of ongoing scheme definitions
 */
export function getOngoingSchemes(): { key: string; name: string; oracle_text: string; is_ongoing: boolean }[] {
  return Object.entries(KNOWN_SCHEMES)
    .filter(([_, scheme]) => scheme.is_ongoing)
    .map(([key, scheme]) => ({ key, ...scheme }));
}

/**
 * Get all non-ongoing schemes
 * @returns Array of non-ongoing scheme definitions
 */
export function getNonOngoingSchemes(): { key: string; name: string; oracle_text: string; is_ongoing: boolean }[] {
  return Object.entries(KNOWN_SCHEMES)
    .filter(([_, scheme]) => !scheme.is_ongoing)
    .map(([key, scheme]) => ({ key, ...scheme }));
}

/**
 * Create a scheme card object
 * @param options - Scheme creation options
 * @returns Complete scheme card object
 */
export function createSchemeCard(options: {
  id: string;
  name: string;
  oracle_text: string;
  is_ongoing?: boolean;
}): SchemeCard {
  return {
    id: options.id,
    name: options.name,
    type_line: options.is_ongoing ? 'Ongoing Scheme' : 'Scheme',
    oracle_text: options.oracle_text,
    is_ongoing: options.is_ongoing || false,
  };
}

/**
 * Get a random non-ongoing scheme
 * @returns Random scheme definition
 */
export function getRandomScheme(): { key: string; name: string; oracle_text: string; is_ongoing: boolean } {
  const schemes = getNonOngoingSchemes();
  const randomIndex = Math.floor(Math.random() * schemes.length);
  return schemes[randomIndex];
}

/**
 * Create a scheme deck (20 non-ongoing schemes, mixed with some ongoing)
 * @param ongoingCount - Number of ongoing schemes to include (default: 5)
 * @returns Array of scheme definitions for a deck
 */
export function createSchemeDeck(ongoingCount: number = 5): { key: string; name: string; oracle_text: string; is_ongoing: boolean }[] {
  const nonOngoing = getNonOngoingSchemes();
  const ongoing = getOngoingSchemes();
  
  // Shuffle arrays
  const shuffledNonOngoing = [...nonOngoing].sort(() => Math.random() - 0.5);
  const shuffledOngoing = [...ongoing].sort(() => Math.random() - 0.5);
  
  // Take 15 non-ongoing and specified number of ongoing (default 5)
  const deck = [
    ...shuffledNonOngoing.slice(0, 20 - ongoingCount),
    ...shuffledOngoing.slice(0, ongoingCount)
  ];
  
  // Shuffle the deck
  return deck.sort(() => Math.random() - 0.5);
}
