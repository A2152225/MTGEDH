import { Player } from './Player';
import { Card } from './Card';

export interface GameState {
  id: string;
  format: GameFormat;
  
  // Players
  players: Player[];
  turnOrder: string[]; // Player IDs in turn order
  activePlayerIndex: number;
  priorityPlayerIndex: number;
  
  // Turn structure
  turn: number;
  phase: GamePhase;
  step: GameStep;
  
  // Stack
  stack: StackObject[];
  
  // Combat
  combat?: CombatState;
  
  // Game settings
  startingLife: number;
  allowUndos: boolean;
  turnTimerEnabled: boolean;
  turnTimerSeconds: number;
  
  // Timestamps
  createdAt: number;
  startedAt?: number;
  lastActionAt: number;
  
  // Spectators
  spectators: string[]; // Socket IDs
  
  // Game status
  status: GameStatus;
  winner?: string;
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

export enum GamePhase {
  BEGINNING = 'beginning',
  PRECOMBAT_MAIN = 'precombatMain',
  COMBAT = 'combat',
  POSTCOMBAT_MAIN = 'postcombatMain',
  ENDING = 'ending'
}

export enum GameStep {
  UNTAP = 'untap',
  UPKEEP = 'upkeep',
  DRAW = 'draw',
  MAIN = 'main',
  BEGIN_COMBAT = 'beginCombat',
  DECLARE_ATTACKERS = 'declareAttackers',
  DECLARE_BLOCKERS = 'declareBlockers',
  COMBAT_DAMAGE = 'combatDamage',
  END_COMBAT = 'endCombat',
  END_STEP = 'endStep',
  CLEANUP = 'cleanup'
}

export enum GameStatus {
  WAITING = 'waiting',
  IN_PROGRESS = 'inProgress',
  PAUSED = 'paused',
  FINISHED = 'finished'
}

export interface StackObject {
  id: string;
  card: Card;
  controllerId: string;
  targets: Target[];
  modes?: string[];
  xValue?: number;
  timestamp: number;
  resolving: boolean;
}

export interface Target {
  type: TargetType;
  id: string; // Card instance ID or player ID
  valid: boolean;
}

export enum TargetType {
  CARD = 'card',
  PLAYER = 'player',
  SPELL = 'spell'
}

export interface CombatState {
  attackers: AttackingCreature[];
  blockers: BlockingCreature[];
  declared: boolean;
}

export interface AttackingCreature {
  cardId: string;
  defendingPlayerId: string;
  blocked: boolean;
  blockedBy: string[];
}

export interface BlockingCreature {
  cardId: string;
  blocking: string; // Attacking creature ID
  damageAssignment?: number;
}