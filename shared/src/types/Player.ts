import { Card, Zone } from './Card';

export interface Player {
  id: string;
  name: string;
  socketId?: string;
  
  // Life and counters
  life: number;
  startingLife: number;
  poisonCounters: number;
  energyCounters: number;
  experienceCounters: number;
  
  // Commander damage tracking
  commanderDamage: Record<string, number>; // opponentId -> damage
  
  // Zones
  library: Card[];
  hand: Card[];
  battlefield: Card[];
  graveyard: Card[];
  exile: Card[];
  commandZone: Card[];
  
  // Mana pool
  manaPool: ManaPool;
  
  // Game state
  hasPriority: boolean;
  hasPassedPriority: boolean;
  landsPlayedThisTurn: number;
  maxLandsPerTurn: number;
  
  // Settings
  autoPassPriority: AutoPassSettings;
  stopSettings: StopSettings;
  
  // Connection
  connected: boolean;
  lastActionAt: number;
}

export interface ManaPool {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
  generic: number; // For any color mana
}

export interface AutoPassSettings {
  upkeep: boolean;
  draw: boolean;
  mainPhase: boolean;
  beginCombat: boolean;
  declareAttackers: boolean;
  declareBlockers: boolean;
  combatDamage: boolean;
  endStep: boolean;
}

export interface StopSettings {
  opponentUpkeep: boolean;
  opponentDraw: boolean;
  opponentMain: boolean;
  opponentCombat: boolean;
  opponentEndStep: boolean;
  myUpkeep: boolean;
  myDraw: boolean;
  myEndStep: boolean;
}