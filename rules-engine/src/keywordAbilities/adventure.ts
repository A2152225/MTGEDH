/**
 * Adventure keyword ability implementation
 * Rule 715
 * 
 * Adventure is an ability found on some creature cards that allows 
 * casting the Adventure portion from hand, then later casting the creature
 * from exile.
 */

/**
 * Adventure card face information
 */
export interface AdventureFace {
  readonly name: string;
  readonly manaCost: string;
  readonly type: string; // Usually Instant or Sorcery
  readonly oracleText: string;
}

/**
 * Adventure ability
 * Rule 715.1
 * 
 * Adventure is a spell ability that separates a card into two halves:
 * the creature and the Adventure spell.
 */
export interface AdventureAbility {
  readonly type: 'adventure';
  readonly source: string;
  readonly creatureName: string;
  readonly creatureManaCost: string;
  readonly adventureFace: AdventureFace;
  readonly isOnAdventure: boolean; // Whether the card is currently in exile "on an adventure"
  readonly adventureCasterId?: string; // Player who sent it on adventure
}

/**
 * Adventure card state - tracks where the adventure card is
 */
export type AdventureState = 
  | 'in_hand' // Can cast either creature or adventure
  | 'on_adventure' // In exile after adventure resolved, can cast creature
  | 'on_battlefield' // Entered as creature
  | 'other'; // In graveyard, library, etc.

/**
 * Creates an adventure ability
 * Rule 715.1
 * 
 * @param source - The creature card with adventure
 * @param creatureName - Name of the creature half
 * @param creatureManaCost - Mana cost of the creature half
 * @param adventureFace - The adventure spell details
 * @returns Adventure ability
 */
export function adventure(
  source: string,
  creatureName: string,
  creatureManaCost: string,
  adventureFace: AdventureFace
): AdventureAbility {
  return {
    type: 'adventure',
    source,
    creatureName,
    creatureManaCost,
    adventureFace,
    isOnAdventure: false,
  };
}

/**
 * Casts the adventure portion of the card
 * Rule 715.3a - When you cast an Adventure, you're casting the Adventure part
 * 
 * @param ability - The adventure ability
 * @param casterId - Player casting the adventure
 * @returns Updated ability (adventure is being cast)
 */
export function castAdventure(
  ability: AdventureAbility,
  casterId: string
): AdventureAbility {
  return {
    ...ability,
    adventureCasterId: casterId,
  };
}

/**
 * Sends the card on an adventure (to exile after adventure resolves)
 * Rule 715.3d - If the spell resolves, exile it instead of putting it in graveyard
 * 
 * @param ability - The adventure ability
 * @returns Updated ability with on-adventure state
 */
export function sendOnAdventure(ability: AdventureAbility): AdventureAbility {
  return {
    ...ability,
    isOnAdventure: true,
  };
}

/**
 * Checks if the creature can be cast from exile (on adventure)
 * Rule 715.3d - The card's owner may cast the creature card from exile
 * 
 * @param ability - The adventure ability
 * @returns Whether the creature half can be cast
 */
export function canCastCreatureFromExile(ability: AdventureAbility): boolean {
  return ability.isOnAdventure;
}

/**
 * Casts the creature from exile after adventure
 * Rule 715.3d
 * 
 * @param ability - The adventure ability
 * @returns Updated ability (creature is being cast from exile)
 */
export function castCreatureFromAdventure(ability: AdventureAbility): AdventureAbility {
  return {
    ...ability,
    isOnAdventure: false,
    adventureCasterId: undefined,
  };
}

/**
 * Gets the current state of an adventure card
 * 
 * @param ability - The adventure ability
 * @param zone - Current zone of the card
 * @returns The adventure state
 */
export function getAdventureState(
  ability: AdventureAbility,
  zone: string
): AdventureState {
  if (zone === 'hand') return 'in_hand';
  if (zone === 'exile' && ability.isOnAdventure) return 'on_adventure';
  if (zone === 'battlefield') return 'on_battlefield';
  return 'other';
}

/**
 * Gets available casting options for an adventure card
 * 
 * @param ability - The adventure ability
 * @param state - Current adventure state
 * @returns Array of available casting options
 */
export function getAdventureCastingOptions(
  ability: AdventureAbility,
  state: AdventureState
): Array<{
  type: 'creature' | 'adventure';
  name: string;
  manaCost: string;
  spellType: string;
}> {
  const options: Array<{
    type: 'creature' | 'adventure';
    name: string;
    manaCost: string;
    spellType: string;
  }> = [];
  
  if (state === 'in_hand') {
    // Can cast either the creature or the adventure
    options.push({
      type: 'creature',
      name: ability.creatureName,
      manaCost: ability.creatureManaCost,
      spellType: 'Creature',
    });
    options.push({
      type: 'adventure',
      name: ability.adventureFace.name,
      manaCost: ability.adventureFace.manaCost,
      spellType: ability.adventureFace.type,
    });
  } else if (state === 'on_adventure') {
    // Can only cast the creature from exile
    options.push({
      type: 'creature',
      name: ability.creatureName,
      manaCost: ability.creatureManaCost,
      spellType: 'Creature',
    });
  }
  
  return options;
}

/**
 * Parses adventure card from oracle text and card faces
 * 
 * @param cardName - Main creature name
 * @param creatureManaCost - Creature mana cost
 * @param adventureName - Adventure spell name
 * @param adventureManaCost - Adventure mana cost
 * @param adventureType - Adventure spell type (Instant/Sorcery)
 * @param adventureText - Adventure oracle text
 * @returns Adventure ability
 */
export function parseAdventureCard(
  cardName: string,
  creatureManaCost: string,
  adventureName: string,
  adventureManaCost: string,
  adventureType: string,
  adventureText: string
): AdventureAbility {
  return adventure(
    cardName,
    cardName,
    creatureManaCost,
    {
      name: adventureName,
      manaCost: adventureManaCost,
      type: adventureType,
      oracleText: adventureText,
    }
  );
}

/**
 * Checks if a card is an adventure card based on layout
 * 
 * @param layout - Card layout from Scryfall
 * @returns Whether the card is an adventure card
 */
export function isAdventureCard(layout: string): boolean {
  return layout === 'adventure';
}

/**
 * Gets the adventure face from card faces array
 * 
 * @param cardFaces - Array of card faces
 * @returns The adventure face or undefined
 */
export function getAdventureFaceFromCardFaces(
  cardFaces: readonly { name?: string; mana_cost?: string; type_line?: string; oracle_text?: string }[]
): AdventureFace | undefined {
  // Adventure is typically the second face
  if (cardFaces.length < 2) return undefined;
  
  const adventureFaceData = cardFaces[1];
  if (!adventureFaceData) return undefined;
  
  // Check if this is actually an adventure (Instant or Sorcery type)
  const typeLine = adventureFaceData.type_line || '';
  if (!typeLine.toLowerCase().includes('instant') && !typeLine.toLowerCase().includes('sorcery')) {
    return undefined;
  }
  
  return {
    name: adventureFaceData.name || 'Adventure',
    manaCost: adventureFaceData.mana_cost || '',
    type: typeLine,
    oracleText: adventureFaceData.oracle_text || '',
  };
}
