// server/src/state/types.ts
// In-memory game wrapper interface and related types (full file content).
// NOTE: corrected import path usages to shared.

import type { PlayerID } from "../../../shared/src/types";
import type { GameState } from "../../../shared/src/types";
import type { KnownCardRef } from "./types";

/* InMemoryGame public surface used by socket modules */
export interface InMemoryGame {
  readonly gameId: string;
  viewFor: (viewer?: PlayerID, spectator?: boolean) => GameState;

  importDeckResolved: (playerId: PlayerID, cards: Array<Pick<KnownCardRef, "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness">>) => void;
  shuffleLibrary: (playerId: PlayerID) => void;
  drawCards: (playerId: PlayerID, count: number) => any[];

  setCommander: (playerId: PlayerID, commanderNames: string[], commanderIds?: string[], colorIdentity?: ("W"|"U"|"B"|"R"|"G")[]) => void;
  castCommander: (playerId: PlayerID, commanderId: string) => void;
  moveCommanderToCZ: (playerId: PlayerID, commanderId: string) => void;
  getCommanderInfo?: (playerId: PlayerID) => { commanderIds: string[]; commanderCards?: any[] } | null;

  preGameReset: (playerId: PlayerID) => void;

  applyScry: (playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) => void;
  applySurveil: (playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) => void;

  updateCounters: (permanentId: string, deltas: Record<string, number>) => void;
  applyUpdateCountersBulk: (updates: { permanentId: string; deltas: Record<string, number> }[]) => void;

  pushStack: (item: any) => void;
  resolveTopOfStack: () => void;
  exileStack: (playerId?: PlayerID) => void;

  playLand: (playerId: PlayerID, card: any) => void;

  getDebugData?: (playerId?: PlayerID) => any;
}