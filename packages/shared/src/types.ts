/**
 * Core game types shared across client and server
 */

export interface Player {
  id: string;
  name: string;
  life: number;
  commanderDamage: Record<string, number>;
  poisonCounters: number;
  energyCounters: number;
}

export interface Card {
  id: string;
  scryfallId: string;
  name: string;
  manaCost: string;
  type: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors: string[];
  imageUrl: string;
}

export interface Zone {
  id: string;
  type: ZoneType;
  cards: Card[];
  ownerId: string;
}

export enum ZoneType {
  LIBRARY = 'library',
  HAND = 'hand',
  BATTLEFIELD = 'battlefield',
  GRAVEYARD = 'graveyard',
  EXILE = 'exile',
  COMMAND = 'command',
  STACK = 'stack'
}

export interface GameState {
  id: string;
  players: Player[];
  zones: Zone[];
  currentTurn: number;
  activePlayer: string;
  priorityPlayer: string;
  phase: GamePhase;
  format: GameFormat;
  createdAt: Date;
  updatedAt: Date;
}

export enum GamePhase {
  UNTAP = 'untap',
  UPKEEP = 'upkeep',
  DRAW = 'draw',
  MAIN1 = 'main1',
  COMBAT_BEGIN = 'combat_begin',
  COMBAT_ATTACKERS = 'combat_attackers',
  COMBAT_BLOCKERS = 'combat_blockers',
  COMBAT_DAMAGE = 'combat_damage',
  COMBAT_END = 'combat_end',
  MAIN2 = 'main2',
  END = 'end',
  CLEANUP = 'cleanup'
}

export enum GameFormat {
  COMMANDER = 'commander',
  STANDARD = 'standard',
  MODERN = 'modern',
  VINTAGE = 'vintage',
  LEGACY = 'legacy',
  PAUPER = 'pauper',
  CUSTOM = 'custom'
}

export interface GameAction {
  type: string;
  playerId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}
