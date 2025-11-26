// server/src/state/types.ts
// In-memory game wrapper interface and related types (full file content).
// NOTE: corrected import path usages to shared.

import type { PlayerID } from "../../../shared/src/types.js";
import type { GameState } from "../../../shared/src/types.js";
import type { KnownCardRef } from "../../../shared/src/types.js";

// Re-export PlayerID for convenience
export type { PlayerID, GameState, KnownCardRef };

/* Game event type for replay/apply */
export interface GameEvent {
  type: string;
  [key: string]: any;
}

/* InMemoryGame public surface used by socket modules */
export interface InMemoryGame {
  readonly gameId: string;
  
  // Core state reference
  state: GameState;
  seq: number;
  
  // Sequence management
  bumpSeq?: () => void;
  
  // View generation
  viewFor: (viewer?: PlayerID, spectator?: boolean) => GameState;

  // Deck/library operations
  importDeckResolved: (playerId: PlayerID, cards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness">>) => void;
  shuffleLibrary: (playerId: PlayerID) => void;
  drawCards: (playerId: PlayerID, count: number) => any[];
  
  // Library access and search
  libraries?: Map<PlayerID, any[]>;
  searchLibrary?: (playerId: PlayerID, query: string, limit: number) => any[];
  selectFromLibrary?: (playerId: PlayerID, cardIds: string[], moveTo: any) => any[];
  moveHandToLibrary?: (playerId: PlayerID) => void;
  peekTopN?: (playerId: PlayerID, n: number) => any[];
  reorderHand?: (playerId: PlayerID, order: number[]) => boolean;
  shuffleHand?: (playerId: PlayerID) => void;

  // Commander operations
  setCommander: (playerId: PlayerID, commanderNames: string[], commanderIds?: string[], colorIdentity?: ("W"|"U"|"B"|"R"|"G")[]) => void;
  castCommander: (playerId: PlayerID, commanderId: string) => void;
  moveCommanderToCZ: (playerId: PlayerID, commanderId: string) => void;
  getCommanderInfo?: (playerId: PlayerID) => { commanderIds: string[]; commanderCards?: any[] } | null;

  preGameReset?: (playerId: PlayerID) => void;

  // Zone helpers
  applyScry: (playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) => void;
  applySurveil: (playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) => void;
  reconcileZonesConsistency?: (playerId?: PlayerID) => void;

  // Counter/permanent operations
  updateCounters: (permanentId: string, deltas: Record<string, number>) => void;
  applyUpdateCountersBulk: (updates: { permanentId: string; deltas: Record<string, number> }[]) => void;
  createToken?: (controller: PlayerID, name: string, count?: number, basePower?: number, baseToughness?: number) => void;
  removePermanent?: (permanentId: string) => void;
  movePermanentToExile?: (permanentId: string) => void;
  applyEngineEffects?: (effects: readonly any[]) => void;
  runSBA?: () => void;

  // Stack operations
  pushStack: (item: any) => void;
  resolveTopOfStack: () => void;
  exileStack: (playerId?: PlayerID) => void;

  // Play helpers
  playLand: (playerId: PlayerID, card: any) => void;
  
  // Priority and turn control
  passPriority?: (playerId: PlayerID) => { changed: boolean; resolvedNow?: boolean };
  setTurnDirection?: (dir: 1 | -1) => void;
  nextTurn?: () => void;
  nextStep?: () => void;
  
  // Scheduled steps (runtime only)
  scheduleStepsAfterCurrent?: (steps: any[]) => void;
  scheduleStepsAtEndOfTurn?: (steps: any[]) => void;
  clearScheduledSteps?: () => void;
  getScheduledSteps?: () => { afterCurrent: any[]; endOfTurn: any[] };
  removeScheduledSteps?: (steps: any[]) => void;

  // Event lifecycle
  applyEvent?: (e: GameEvent) => void;
  replay?: (events: GameEvent[]) => void;
  reset?: (preservePlayers?: boolean) => void;
  skip?: (playerId: PlayerID) => void;
  unskip?: (playerId: PlayerID) => void;
  remove?: (playerId: PlayerID) => void;

  // Participant management
  join?: (socketId: string, playerName: string, spectator?: boolean, fixedPlayerId?: string, seatToken?: string) => any;
  leave?: (playerId?: PlayerID) => void;
  disconnect?: (socketId: string) => void;
  participants?: () => Array<{ socketId: string; playerId: PlayerID; spectator: boolean }>;
  
  // RNG
  seedRng?: (seed: number) => void;
  hasRngSeed?: () => boolean;
  
  // Spectator access
  grantSpectatorAccess?: (owner: PlayerID, spectator: PlayerID) => void;
  revokeSpectatorAccess?: (owner: PlayerID, spectator: PlayerID) => void;
  
  // Pending initial draw
  flagPendingOpeningDraw?: (playerId: PlayerID) => void;
  pendingInitialDraw?: Set<PlayerID>;

  // Debug
  getDebugData?: (playerId?: PlayerID) => any;
}