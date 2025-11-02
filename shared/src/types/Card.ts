export interface Card {
  // Unique instance ID for this card in the game
  instanceId: string;
  
  // Scryfall data
  scryfallId: string;
  name: string;
  manaCost: string;
  cmc: number;
  colors: string[];
  colorIdentity: string[];
  type: string;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  
  // Game state
  ownerId: string;
  controllerId: string;
  zone: Zone;
  
  // Status
  tapped: boolean;
  faceDown: boolean;
  flipped: boolean;
  transformed: boolean;
  phased: boolean;
  
  // Counters and modifiers
  counters: Record<string, number>; // e.g., { "+1/+1": 2, "charge": 3 }
  modifiers: Modifier[];
  
  // Visibility tracking
  knownTo: string[]; // Player IDs who can see this card
  revealedTo: string[]; // Currently revealed to these players
  
  // Attachments
  attachedTo?: string; // Card instance ID (for Auras, Equipment)
  attachments: string[]; // Cards attached to this card
  
  // Token specific
  isToken: boolean;
  
  // Timestamp for ordering
  enteredZoneAt: number;
}

export enum Zone {
  LIBRARY = 'library',
  HAND = 'hand',
  BATTLEFIELD = 'battlefield',
  GRAVEYARD = 'graveyard',
  EXILE = 'exile',
  STACK = 'stack',
  COMMAND = 'command'
}

export interface Modifier {
  id: string;
  sourceId: string; // Card instance that created this modifier
  type: ModifierType;
  layer: number; // Layer system for applying effects
  value?: any;
  until?: 'endOfTurn' | 'endOfCombat' | 'permanent';
  condition?: string; // Conditional effects
}

export enum ModifierType {
  POWER_TOUGHNESS = 'powerToughness',
  ABILITY_GRANT = 'abilityGrant',
  ABILITY_REMOVE = 'abilityRemove',
  TYPE_CHANGE = 'typeChange',
  COLOR_CHANGE = 'colorChange',
  CONTROL_CHANGE = 'controlChange',
  CANT_ATTACK = 'cantAttack',
  CANT_BLOCK = 'cantBlock',
  MUST_ATTACK = 'mustAttack'
}