import type { ClientGameView, GameID, PlayerID, StateDiff, KnownCardRef, TargetRef } from "./types";

// Minimal payment item: one tapped source produces one mana symbol (W/U/B/R/G/C)
export type PaymentItem = { permanentId: string; mana: 'W' | 'U' | 'B' | 'R' | 'G' | 'C' };

export interface ClientToServerEvents {
  // Session
  joinGame: (payload: { gameId: GameID; playerName: string; spectator?: boolean; seatToken?: string }) => void;
  leaveGame: (payload: { gameId: GameID }) => void;
  requestState: (payload: { gameId: GameID }) => void;

  // Turn / priority
  passPriority: (payload: { gameId: GameID }) => void;
  toggleTurnDirection: (payload: { gameId: GameID }) => void;
  nextTurn: (payload: { gameId: GameID }) => void;
  nextStep: (payload: { gameId: GameID }) => void;

  // Admin
  restartGame: (payload: { gameId: GameID; preservePlayers?: boolean }) => void;
  removePlayer: (payload: { gameId: GameID; playerId: PlayerID }) => void;
  skipPlayer: (payload: { gameId: GameID; playerId: PlayerID }) => void;
  unskipPlayer: (payload: { gameId: GameID; playerId: PlayerID }) => void;

  // Visibility
  grantSpectatorAccess: (payload: { gameId: GameID; spectatorId: PlayerID }) => void;
  revokeSpectatorAccess: (payload: { gameId: GameID; spectatorId: PlayerID }) => void;

  // Library and deck
  importDeck: (payload: { gameId: GameID; list: string }) => void;
  shuffleLibrary: (payload: { gameId: GameID }) => void;
  drawCards: (payload: { gameId: GameID; count: number }) => void;
  shuffleHandIntoLibrary: (payload: { gameId: GameID }) => void;

  // Hand management (owner only)
  reorderHand: (payload: { gameId: GameID; order: number[] }) => void;
  shuffleHand: (payload: { gameId: GameID }) => void;

  // Search (owner only)
  searchLibrary: (payload: { gameId: GameID; query: string; limit?: number }) => void;
  selectFromSearch: (payload: {
    gameId: GameID;
    cardIds: string[];
    moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield';
    reveal?: boolean;
  }) => void;

  // Commander
  setCommander: (payload: { gameId: GameID; commanderNames: string[] }) => void;
  castCommander: (payload: { gameId: GameID; commanderNameOrId: string }) => void;
  moveCommanderToCommandZone: (payload: { gameId: GameID; commanderNameOrId: string }) => void;

  // Counters / tokens
  updateCounters: (payload: { gameId: GameID; permanentId: string; deltas: Record<string, number> }) => void;
  updateCountersBulk: (payload: { gameId: GameID; updates: { permanentId: string; deltas: Record<string, number> }[] }) => void;
  createToken: (payload: { gameId: GameID; name: string; count?: number; basePower?: number; baseToughness?: number }) => void;
  removePermanent: (payload: { gameId: GameID; permanentId: string }) => void;

  // Damage
  dealDamage: (payload: { gameId: GameID; targetPermanentId: string; amount: number; wither?: boolean; infect?: boolean }) => void;

  // Targeting & casting
  beginCast: (payload: { gameId: GameID; cardId: string }) => void;
  chooseTargets: (payload: { gameId: GameID; spellId: string; chosen: TargetRef[] }) => void;
  cancelCast: (payload: { gameId: GameID; spellId: string }) => void;
  confirmCast: (payload: { gameId: GameID; spellId: string; payment?: PaymentItem[]; xValue?: number }) => void;

  // Lands
  playLand: (payload: { gameId: GameID; cardId: string }) => void;

  // Library peeks (owner only; manual UI optional client-side)
  beginScry: (payload: { gameId: GameID; count: number }) => void;
  confirmScry: (payload: { gameId: GameID; keepTopOrder: string[]; bottomOrder: string[] }) => void;
  beginSurveil: (payload: { gameId: GameID; count: number }) => void;
  confirmSurveil: (payload: { gameId: GameID; toGraveyard: string[]; keepTopOrder: string[] }) => void;

  // Battlefield positioning (owner-only for their permanents)
  updatePermanentPos: (payload: {
    gameId: GameID;
    permanentId: string;
    x: number; // board-local px
    y: number; // board-local px
    z?: number; // optional layer
  }) => void;

  // Reserved
  castSpell: (payload: { gameId: GameID; cardId: string; targets?: string[] }) => void;
  playLandLegacy?: (payload: { gameId: GameID; cardId: string }) => void;
  concede: (payload: { gameId: GameID }) => void;
}

export interface ServerToClientEvents {
  joined: (payload: { gameId: GameID; you: PlayerID; seatToken?: string }) => void;
  state: (payload: { gameId: GameID; view: ClientGameView; seq: number }) => void;
  stateDiff: (payload: { gameId: GameID; diff: StateDiff<ClientGameView> }) => void;
  priority: (payload: { gameId: GameID; player: PlayerID }) => void;
  error: (payload: { code: string; message: string }) => void;

  // Chat/messages
  chat: (payload: { id: string; gameId: GameID; from: PlayerID | "system"; message: string; ts: number }) => void;

  // Private search results
  searchResults: (payload: { gameId: GameID; cards: Pick<KnownCardRef, 'id' | 'name'>[]; total: number }) => void;

  // Private to caster: valid targets (+ optional payment context)
  validTargets: (payload: {
    gameId: GameID;
    spellId: string;
    minTargets: number;
    maxTargets: number;
    targets: TargetRef[];
    note?: string;
    manaCost?: string; // e.g., "{2}{R}{R}"
    paymentSources?: Array<{ id: string; name: string; options: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> }>;
  }) => void;

  // Private library peeks for Scry/Surveil
  scryPeek: (payload: { gameId: GameID; cards: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>[] }) => void;
  surveilPeek: (payload: { gameId: GameID; cards: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>[] }) => void;

  automationErrorReported?: (payload: { message: string }) => void;
  gameStateUpdated?: (payload: ClientGameView | unknown) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  playerId?: PlayerID;
  gameId?: GameID;
  spectator?: boolean;
}

// Lobby creation scaffolding (server internal)
export interface CreateGameOptions {
  readonly format: "commander" | "standard" | "vintage" | "modern" | "custom";
  readonly startingLife?: number;
  readonly name?: string;
}