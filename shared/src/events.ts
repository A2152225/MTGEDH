import type { ClientGameView, GameID, PlayerID, StateDiff, KnownCardRef } from "./types";

// Socket.IO event contracts
export interface ClientToServerEvents {
  joinGame: (payload: { gameId: GameID; playerName: string; spectator?: boolean; seatToken?: string }) => void;
  leaveGame: (payload: { gameId: GameID }) => void;
  passPriority: (payload: { gameId: GameID }) => void;
  requestState: (payload: { gameId: GameID }) => void;

  // Game admin
  restartGame: (payload: { gameId: GameID; preservePlayers?: boolean }) => void;
  removePlayer: (payload: { gameId: GameID; playerId: PlayerID }) => void;
  skipPlayer: (payload: { gameId: GameID; playerId: PlayerID }) => void;
  unskipPlayer: (payload: { gameId: GameID; playerId: PlayerID }) => void;

  // Visibility control
  grantSpectatorAccess: (payload: { gameId: GameID; spectatorId: PlayerID }) => void;
  revokeSpectatorAccess: (payload: { gameId: GameID; spectatorId: PlayerID }) => void;

  // Deck import and library ops
  importDeck: (payload: { gameId: GameID; list: string }) => void;
  shuffleLibrary: (payload: { gameId: GameID }) => void;
  drawCards: (payload: { gameId: GameID; count: number }) => void;

  // NEW: move the entire hand back into library and shuffle
  shuffleHandIntoLibrary: (payload: { gameId: GameID }) => void;

  // Search library (private to requester)
  searchLibrary: (payload: { gameId: GameID; query: string; limit?: number }) => void;
  selectFromSearch: (payload: { gameId: GameID; cardIds: string[]; moveTo: 'hand' | 'graveyard' | 'exile' | 'battlefield'; reveal?: boolean }) => void;

  // Minimal actions scaffolding (reserved)
  castSpell: (payload: { gameId: GameID; cardId: string; targets?: string[] }) => void;
  playLand: (payload: { gameId: GameID; cardId: string }) => void;
  concede: (payload: { gameId: GameID }) => void;
}

export interface ServerToClientEvents {
  joined: (payload: { gameId: GameID; you: PlayerID; seatToken?: string }) => void;
  state: (payload: { gameId: GameID; view: ClientGameView; seq: number }) => void;
  stateDiff: (payload: { gameId: GameID; diff: StateDiff<ClientGameView> }) => void;
  priority: (payload: { gameId: GameID; player: PlayerID }) => void;
  error: (payload: { code: string; message: string }) => void;

  // Chat/messages (system notices, admin actions)
  chat: (payload: { id: string; gameId: GameID; from: PlayerID | "system"; message: string; ts: number }) => void;

  // Private search results (only to requester)
  searchResults: (payload: { gameId: GameID; cards: Pick<KnownCardRef, 'id' | 'name'>[]; total: number }) => void;

  // Optional
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