import type { ClientGameView, GameID, PlayerID, StateDiff } from "./types";

// Socket.IO event contracts
export interface ClientToServerEvents {
  joinGame: (payload: { gameId: GameID; playerName: string; spectator?: boolean; seatToken?: string }) => void;
  leaveGame: (payload: { gameId: GameID }) => void;
  passPriority: (payload: { gameId: GameID }) => void;
  requestState: (payload: { gameId: GameID }) => void;

  // Minimal actions scaffolding
  castSpell: (payload: { gameId: GameID; cardId: string; targets?: string[] }) => void;
  playLand: (payload: { gameId: GameID; cardId: string }) => void;
  concede: (payload: { gameId: GameID }) => void;

  // Visibility control: owner grants a spectator elevated access to their hidden info
  grantSpectatorAccess: (payload: { gameId: GameID; spectatorId: PlayerID }) => void;
}

export interface ServerToClientEvents {
  joined: (payload: { gameId: GameID; you: PlayerID; seatToken?: string }) => void;
  state: (payload: { gameId: GameID; view: ClientGameView; seq: number }) => void;
  stateDiff: (payload: { gameId: GameID; diff: StateDiff<ClientGameView> }) => void;
  priority: (payload: { gameId: GameID; player: PlayerID }) => void;
  error: (payload: { code: string; message: string }) => void;

  // Chat/messages (includes system notices like spectator access grants)
  chat: (payload: { id: string; gameId: GameID; from: PlayerID | "system"; message: string; ts: number }) => void;

  // Optional events referenced in server code
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