// server/src/state/types.ts
// In-memory game wrapper interface and related types (full file content).
// NOTE: corrected import path usages to shared.

import type { PlayerID } from "../../../shared/src/types.js";
import type { GameState } from "../../../shared/src/types.js";
import type { KnownCardRef } from "../../../shared/src/types.js";

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
  
  // View generation
  viewFor: (viewer?: PlayerID, spectator?: boolean) => GameState;

  // Deck/library operations
  importDeckResolved: (playerId: PlayerID, cards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness">>) => void;
  shuffleLibrary: (playerId: PlayerID) => void;
  drawCards: (playerId: PlayerID, count: number) => any[];

  // Commander operations
  setCommander: (playerId: PlayerID, commanderNames: string[], commanderIds?: string[], colorIdentity?: ("W"|"U"|"B"|"R"|"G")[]) => void;
  castCommander: (playerId: PlayerID, commanderId: string) => void;
  moveCommanderToCZ: (playerId: PlayerID, commanderId: string) => void;
  getCommanderInfo?: (playerId: PlayerID) => { commanderIds: string[]; commanderCards?: any[] } | null;

  preGameReset: (playerId: PlayerID) => void;

  // Zone helpers
  applyScry: (playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) => void;
  applySurveil: (playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) => void;

  // Counter/permanent operations
  updateCounters: (permanentId: string, deltas: Record<string, number>) => void;
  applyUpdateCountersBulk: (updates: { permanentId: string; deltas: Record<string, number> }[]) => void;

  // Stack operations
  pushStack: (item: any) => void;
  resolveTopOfStack: () => void;
  exileStack: (playerId?: PlayerID) => void;

  // Play helpers
  playLand: (playerId: PlayerID, card: any) => void;
  
  // Priority and turn control
  passPriority?: (playerId: PlayerID) => { changed: boolean; resolvedNow?: boolean };

  // Debug
  getDebugData?: (playerId?: PlayerID) => any;
}