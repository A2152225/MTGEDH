/**
 * MTG Glossary - UI-Optimized Gameplay Reference
 * 
 * Provides quick-reference descriptions for keyword abilities, tokens, and game terms
 * for use in UI tooltips and help systems. Prioritized for gameplay needs.
 * 
 * Design: Focused on ~200 essential terms players need during actual play,
 * with priority levels for progressive loading and mobile optimization.
 */

/**
 * Glossary entry with priority for UI optimization
 */
export interface GlossaryEntry {
  readonly term: string;
  readonly category: 'ability' | 'token' | 'game-term' | 'zone' | 'timing';
  readonly priority: 1 | 2 | 3 | 4 | 5; // 1=essential, 5=rare
  readonly shortText: string;
  readonly fullText?: string;
  readonly icon?: string;
  readonly rulesReference?: string;
  readonly relatedTerms?: readonly string[];
}

/**
 * Essential keyword abilities (Priority 1) - Top 20 most common
 */
const ESSENTIAL_ABILITIES: readonly GlossaryEntry[] = [
  {
    term: 'Flying',
    category: 'ability',
    priority: 1,
    shortText: "Can only be blocked by creatures with flying or reach",
    fullText: "A creature with flying can't be blocked except by other creatures with flying or reach. Flying is one of the most common evasion abilities.",
    icon: 'flying-wings',
    rulesReference: 'Rule 702.9',
    relatedTerms: ['Reach']
  },
  {
    term: 'Deathtouch',
    category: 'ability',
    priority: 1,
    shortText: "Any damage this deals to a creature is enough to destroy it",
    fullText: "A creature with deathtouch needs to assign only 1 damage to another creature to destroy it, regardless of that creature's toughness.",
    icon: 'skull',
    rulesReference: 'Rule 702.2',
  },
  {
    term: 'Lifelink',
    category: 'ability',
    priority: 1,
    shortText: "Damage dealt by this also causes you to gain that much life",
    fullText: "Whenever a source with lifelink deals damage, you gain that much life. Multiple instances of lifelink don't stack.",
    icon: 'heart',
    rulesReference: 'Rule 702.15',
  },
  {
    term: 'Trample',
    category: 'ability',
    priority: 1,
    shortText: "Excess combat damage can be dealt to the defending player",
    fullText: "If a creature with trample is blocked, you can assign excess damage beyond lethal to the defending player or planeswalker.",
    icon: 'trample',
    rulesReference: 'Rule 702.19',
  },
  {
    term: 'First Strike',
    category: 'ability',
    priority: 1,
    shortText: "Deals combat damage before creatures without first strike",
    fullText: "Creatures with first strike deal combat damage during the first strike damage step, before creatures without first strike.",
    icon: 'sword-first',
    rulesReference: 'Rule 702.7',
    relatedTerms: ['Double Strike']
  },
  {
    term: 'Haste',
    category: 'ability',
    priority: 1,
    shortText: "Can attack and tap the turn it enters the battlefield",
    fullText: "Creatures with haste aren't affected by summoning sickness. They can attack and use tap abilities immediately.",
    icon: 'lightning',
    rulesReference: 'Rule 702.10',
  },
  {
    term: 'Vigilance',
    category: 'ability',
    priority: 1,
    shortText: "Doesn't tap when attacking",
    fullText: "Attacking doesn't cause this creature to tap. It can attack and still be available to block.",
    icon: 'shield-up',
    rulesReference: 'Rule 702.20',
  },
  {
    term: 'Hexproof',
    category: 'ability',
    priority: 1,
    shortText: "Can't be the target of opponents' spells or abilities",
    fullText: "Permanents with hexproof can't be targeted by spells or abilities your opponents control, but you can still target them.",
    icon: 'shield-magic',
    rulesReference: 'Rule 702.11',
    relatedTerms: ['Shroud', 'Ward']
  },
  {
    term: 'Menace',
    category: 'ability',
    priority: 1,
    shortText: "Can't be blocked except by two or more creatures",
    fullText: "A creature with menace must be blocked by at least two creatures if able. One blocker isn't enough.",
    icon: 'menace',
    rulesReference: 'Rule 702.111',
  },
  {
    term: 'Reach',
    category: 'ability',
    priority: 1,
    shortText: "Can block creatures with flying",
    fullText: "Creatures with reach can block creatures with flying as well as creatures without flying.",
    icon: 'reach',
    rulesReference: 'Rule 702.17',
    relatedTerms: ['Flying']
  },
  {
    term: 'Flash',
    category: 'ability',
    priority: 1,
    shortText: "You may cast this spell any time you could cast an instant",
    fullText: "Flash allows you to cast spells at instant speed, including during opponents' turns and in response to other spells.",
    icon: 'flash',
    rulesReference: 'Rule 702.8',
  },
  {
    term: 'Indestructible',
    category: 'ability',
    priority: 1,
    shortText: "Can't be destroyed by damage or effects that say 'destroy'",
    fullText: "Permanents with indestructible can't be destroyed by lethal damage or by effects that say 'destroy'. They can still be sacrificed or exiled.",
    icon: 'diamond',
    rulesReference: 'Rule 702.12',
  },
  {
    term: 'Double Strike',
    category: 'ability',
    priority: 1,
    shortText: "Deals both first-strike and regular combat damage",
    fullText: "Creatures with double strike deal combat damage twice: once during the first strike damage step and again during regular combat damage.",
    icon: 'double-sword',
    rulesReference: 'Rule 702.4',
    relatedTerms: ['First Strike']
  },
  {
    term: 'Defender',
    category: 'ability',
    priority: 1,
    shortText: "Can't attack",
    fullText: "Creatures with defender can't attack, but they can still block. Often found on high-toughness creatures.",
    icon: 'wall',
    rulesReference: 'Rule 702.3',
  },
  {
    term: 'Ward',
    category: 'ability',
    priority: 1,
    shortText: "Spells and abilities targeting this are countered unless cost is paid",
    fullText: "Whenever this becomes the target of a spell or ability an opponent controls, counter it unless that player pays the ward cost.",
    icon: 'ward',
    rulesReference: 'Rule 702.21',
    relatedTerms: ['Hexproof']
  },
  {
    term: 'Prowess',
    category: 'ability',
    priority: 2,
    shortText: "Gets +1/+1 until end of turn whenever you cast a noncreature spell",
    fullText: "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.",
    icon: 'prowess',
    rulesReference: 'Rule 702.108',
  },
  {
    term: 'Equip',
    category: 'ability',
    priority: 1,
    shortText: "Attach this Equipment to target creature you control",
    fullText: "Equip is an activated ability that lets you attach an Equipment to a creature you control. You can only equip at sorcery speed.",
    icon: 'equipment',
    rulesReference: 'Rule 702.6',
  },
  {
    term: 'Protection',
    category: 'ability',
    priority: 2,
    shortText: "Can't be damaged, enchanted, blocked, or targeted by [quality]",
    fullText: "Protection from [quality] means this can't be damaged, enchanted, equipped, fortified, or blocked by anything with that quality, and can't be targeted by spells or abilities with that quality.",
    icon: 'protection',
    rulesReference: 'Rule 702.16',
  },
  {
    term: 'Scry',
    category: 'ability',
    priority: 1,
    shortText: "Look at the top N cards, put any number on top and the rest on bottom",
    fullText: "To scry N, look at the top N cards of your library, then put any number of them on the bottom of your library in any order and the rest on top in any order.",
    icon: 'scry',
    rulesReference: 'Rule 701.18',
  },
  {
    term: 'Flashback',
    category: 'ability',
    priority: 2,
    shortText: "You may cast this from your graveyard for its flashback cost, then exile it",
    fullText: "You can cast a spell with flashback from your graveyard by paying its flashback cost instead of its mana cost. When it resolves or is countered, exile it.",
    icon: 'flashback',
    rulesReference: 'Rule 702.33',
  },
];

/**
 * Essential tokens (Priority 1) - Most common
 */
const ESSENTIAL_TOKENS: readonly GlossaryEntry[] = [
  {
    term: 'Treasure',
    category: 'token',
    priority: 1,
    shortText: "Tap, Sacrifice this: Add one mana of any color",
    fullText: "Treasure is a colorless artifact token with '{T}, Sacrifice this artifact: Add one mana of any color.'",
    icon: 'treasure',
    rulesReference: 'Rule 111.10',
  },
  {
    term: 'Food',
    category: 'token',
    priority: 1,
    shortText: "{2}, {T}, Sacrifice this: You gain 3 life",
    fullText: "Food is a colorless artifact token with '{2}, {T}, Sacrifice this artifact: You gain 3 life.'",
    icon: 'food',
    rulesReference: 'Rule 111.10',
  },
  {
    term: 'Clue',
    category: 'token',
    priority: 1,
    shortText: "{2}, Sacrifice this: Draw a card",
    fullText: "Clue is a colorless artifact token with '{2}, Sacrifice this artifact: Draw a card.'",
    icon: 'clue',
    rulesReference: 'Rule 111.10',
  },
  {
    term: 'Blood',
    category: 'token',
    priority: 2,
    shortText: "{1}, {T}, Discard a card, Sacrifice this: Draw a card",
    fullText: "Blood is a colorless artifact token with '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.'",
    icon: 'blood',
    rulesReference: 'Rule 111.10',
  },
  {
    term: '1/1 Soldier',
    category: 'token',
    priority: 1,
    shortText: "White 1/1 creature",
    fullText: "A 1/1 white Soldier creature token. One of the most common token types.",
    icon: 'soldier',
  },
  {
    term: '2/2 Zombie',
    category: 'token',
    priority: 1,
    shortText: "Black 2/2 creature",
    fullText: "A 2/2 black Zombie creature token. Commonly created by black spells and abilities.",
    icon: 'zombie',
  },
  {
    term: '3/3 Beast',
    category: 'token',
    priority: 2,
    shortText: "Green 3/3 creature",
    fullText: "A 3/3 green Beast creature token. Common in green decks.",
    icon: 'beast',
  },
  {
    term: '1/1 Goblin',
    category: 'token',
    priority: 2,
    shortText: "Red 1/1 creature",
    fullText: "A 1/1 red Goblin creature token. A staple of red token strategies.",
    icon: 'goblin',
  },
];

/**
 * Essential game terms (Priority 1)
 */
const ESSENTIAL_GAME_TERMS: readonly GlossaryEntry[] = [
  {
    term: 'Tap',
    category: 'game-term',
    priority: 1,
    shortText: "Turn a permanent sideways to show it has been used",
    fullText: "To tap a permanent, turn it sideways. Tapped permanents can't be tapped again until they untap.",
    icon: 'tap',
    rulesReference: 'Rule 701.21',
    relatedTerms: ['Untap']
  },
  {
    term: 'Untap',
    category: 'game-term',
    priority: 1,
    shortText: "Straighten a tapped permanent",
    fullText: "To untap a permanent, rotate it back to the upright position. Most permanents untap during their controller's untap step.",
    icon: 'untap',
    rulesReference: 'Rule 502.1',
    relatedTerms: ['Tap']
  },
  {
    term: 'Battlefield',
    category: 'zone',
    priority: 1,
    shortText: "The play area where permanents exist",
    fullText: "The battlefield is the zone where permanents are. Cards enter the battlefield and leave when they change zones.",
    icon: 'battlefield',
    rulesReference: 'Rule 403',
  },
  {
    term: 'Graveyard',
    category: 'zone',
    priority: 1,
    shortText: "Your discard pile for destroyed, discarded, or countered cards",
    fullText: "Your graveyard is a face-up discard pile. Cards go there when destroyed, discarded, countered, or when spells resolve.",
    icon: 'graveyard',
    rulesReference: 'Rule 404',
  },
  {
    term: 'Exile',
    category: 'zone',
    priority: 1,
    shortText: "A zone for cards removed from the game",
    fullText: "Exile is a zone for cards removed from the game. Some effects can return cards from exile, but most can't interact with exiled cards.",
    icon: 'exile',
    rulesReference: 'Rule 406',
  },
  {
    term: 'Stack',
    category: 'zone',
    priority: 1,
    shortText: "Where spells and abilities wait to resolve",
    fullText: "When you cast a spell or activate an ability, it goes on the stack. Objects on the stack resolve one at a time, starting from the top.",
    icon: 'stack',
    rulesReference: 'Rule 405',
  },
  {
    term: 'Commander Damage',
    category: 'game-term',
    priority: 1,
    shortText: "21+ combat damage from one commander causes a player to lose",
    fullText: "In Commander, if a player takes 21 or more combat damage from a single commander over the course of the game, they lose. Damage is tracked per commander.",
    icon: 'commander-damage',
    rulesReference: 'Rule 903.10',
  },
  {
    term: 'Command Zone',
    category: 'zone',
    priority: 1,
    shortText: "Where commanders and special cards start the game",
    fullText: "The command zone is a special zone for commanders, emblems, and other objects that need to exist outside normal zones.",
    icon: 'command-zone',
    rulesReference: 'Rule 408',
  },
  {
    term: '+1/+1 Counter',
    category: 'game-term',
    priority: 1,
    shortText: "A permanent bonus to a creature's power and toughness",
    fullText: "A +1/+1 counter on a creature gives it +1/+1. Multiple counters stack. They stay on the creature as long as it remains on the battlefield.",
    icon: 'plus-counter',
    rulesReference: 'Rule 122.1',
  },
  {
    term: 'Mana Value',
    category: 'game-term',
    priority: 1,
    shortText: "The total cost to cast a spell (formerly Converted Mana Cost)",
    fullText: "The mana value of a spell is the total amount of mana in its cost, regardless of color. X is 0 unless on the stack.",
    icon: 'mana-value',
    rulesReference: 'Rule 202.3',
  },
];

/**
 * Get glossary entry by exact term name
 */
export function getGlossaryEntry(term: string): GlossaryEntry | undefined {
  const allEntries = [...ESSENTIAL_ABILITIES, ...ESSENTIAL_TOKENS, ...ESSENTIAL_GAME_TERMS];
  return allEntries.find(entry => entry.term.toLowerCase() === term.toLowerCase());
}

/**
 * Get tooltip text for a keyword ability
 */
export function getAbilityTooltip(abilityName: string): string | undefined {
  const entry = ESSENTIAL_ABILITIES.find(e => e.term.toLowerCase() === abilityName.toLowerCase());
  return entry?.shortText;
}

/**
 * Get tooltip text for a token type
 */
export function getTokenTooltip(tokenType: string): string | undefined {
  const entry = ESSENTIAL_TOKENS.find(e => e.term.toLowerCase() === tokenType.toLowerCase());
  return entry?.shortText;
}

/**
 * Get tooltip text for a game term
 */
export function getGameTermTooltip(term: string): string | undefined {
  const entry = ESSENTIAL_GAME_TERMS.find(e => e.term.toLowerCase() === term.toLowerCase());
  return entry?.shortText;
}

/**
 * Get all essential abilities (Priority 1-2)
 */
export function getEssentialAbilities(): readonly GlossaryEntry[] {
  return ESSENTIAL_ABILITIES.filter(e => e.priority <= 2);
}

/**
 * Get all essential tokens (Priority 1-2)
 */
export function getEssentialTokens(): readonly GlossaryEntry[] {
  return ESSENTIAL_TOKENS.filter(e => e.priority <= 2);
}

/**
 * Get all essential game terms (Priority 1)
 */
export function getEssentialGameTerms(): readonly GlossaryEntry[] {
  return ESSENTIAL_GAME_TERMS.filter(e => e.priority === 1);
}

/**
 * Search glossary entries by term or description
 */
export function searchGlossary(query: string, maxPriority: 1 | 2 | 3 | 4 | 5 = 2): readonly GlossaryEntry[] {
  const allEntries = [...ESSENTIAL_ABILITIES, ...ESSENTIAL_TOKENS, ...ESSENTIAL_GAME_TERMS];
  const lowerQuery = query.toLowerCase();
  
  return allEntries.filter(entry => 
    entry.priority <= maxPriority && (
      entry.term.toLowerCase().includes(lowerQuery) ||
      entry.shortText.toLowerCase().includes(lowerQuery) ||
      entry.fullText?.toLowerCase().includes(lowerQuery)
    )
  );
}

/**
 * Get entries by category
 */
export function getEntriesByCategory(category: GlossaryEntry['category']): readonly GlossaryEntry[] {
  const allEntries = [...ESSENTIAL_ABILITIES, ...ESSENTIAL_TOKENS, ...ESSENTIAL_GAME_TERMS];
  return allEntries.filter(entry => entry.category === category);
}

/**
 * Get combat-related abilities
 */
export function getCombatAbilities(): readonly GlossaryEntry[] {
  return ESSENTIAL_ABILITIES.filter(e => 
    ['Flying', 'First Strike', 'Double Strike', 'Trample', 'Vigilance', 'Deathtouch', 'Lifelink'].includes(e.term)
  );
}

/**
 * Get protection/defensive abilities
 */
export function getProtectionAbilities(): readonly GlossaryEntry[] {
  return ESSENTIAL_ABILITIES.filter(e => 
    ['Hexproof', 'Indestructible', 'Ward', 'Protection', 'Defender'].includes(e.term)
  );
}

/**
 * Get evasion abilities
 */
export function getEvasionAbilities(): readonly GlossaryEntry[] {
  return ESSENTIAL_ABILITIES.filter(e => 
    ['Flying', 'Menace', 'Reach'].includes(e.term)
  );
}
