/**
 * MTG Rules Engine - Type Exports
 * Complete type system for Magic: The Gathering rules
 */

// Section 1: Game Concepts (Rules 100-123)

// Rules 101-104 - Game Flow (Golden Rules, Players, Starting, Ending)
export * from './gameFlow';

// Rule 105 - Colors
export * from './colors';

// Rule 106 - Mana
export * from './mana';

// Rule 107 - Numbers and Symbols
export * from './numbers';

// Rules 108-110 - Cards, Objects, Permanents
export * from './objects';

// Rule 111-112, 114 - Tokens, Spells, Emblems
export * from './gameObjects';

// Rule 113 - Abilities
export * from './abilities';

// Rule 115 - Targets
export * from './targets';

// Rule 116 - Special Actions
export * from './specialActions';

// Rule 117 - Timing and Priority
export * from './priority';

// Rule 118 - Costs
export * from './costs';

// Rules 119-122 - Player Actions (Life, Damage, Drawing, Counters)
export * from './playerActions';

// Section 2: Parts of a Card (Rules 200-209)

// Rules 200-209 - Card Parts (Name, Mana Cost, Type Line, Text, P/T, Loyalty)
export * from './cardParts';

// Section 3: Card Types (Rules 300-315)

// Rules 300-315 - Card Types (Artifacts, Creatures, Enchantments, Instants, Lands, Planeswalkers, Sorceries, etc.)
export * from './cardTypes';

// Section 4: Zones (Rules 400-408)

// Rules 400-408 - Zones (Library, Hand, Battlefield, Graveyard, Stack, Exile, Command)
export * from './zones';
