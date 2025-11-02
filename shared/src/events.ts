import type { ClientGameView, GameID, PlayerID, StateDiff } from "./types";

// Socket.IO event contracts
export interface ClientToServerEvents {
  joinGame: (payload: { gameId: GameID; playerName: string; spectator?: boolean }) => void;
  leaveGame: (payload: { gameId: GameID }) => void;
  passPriority: (payload: { gameId: GameID }) => void;
  requestState: (payload: { gameId: GameID }) => void;

  // Minimal actions scaffolding
  castSpell: (payload: { gameId: GameID; cardId: string; targets?: string[] }) => void;
  playLand: (payload: { gameId: GameID; cardId: string }) => void;
  concede: (payload: { gameId: GameID }) => void;
}

export interface ServerToClientEvents {
  joined: (payload: { gameId: GameID; you: PlayerID }) => void;
  state: (payload: { gameId: GameID; view: ClientGameView; seq: number }) => void;
  stateDiff: (payload: { gameId: GameID; diff: StateDiff<ClientGameView> }) => void;
  priority: (payload: { gameId: GameID; player: PlayerID }) => void;
  error: (payload: { code: string; message: string }) => void;
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