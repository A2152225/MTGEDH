import { GameFormat, GamePhase } from '../../../shared/src';
import type {
  GameID,
  PlayerID,
  PlayerRef,
  GameState,
  ClientGameView,
  CommanderInfo
} from '../../../shared/src';

function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export type GameEvent =
  | { type: 'join'; playerId: PlayerID; name: string; seat?: number; seatToken?: string }
  | { type: 'leave'; playerId: PlayerID }
  | { type: 'passPriority'; by: PlayerID };

export interface Participant {
  readonly socketId: string;
  readonly playerId: PlayerID;
  readonly spectator: boolean;
}

export interface InMemoryGame {
  readonly state: GameState;
  seq: number;
  join: (
    socketId: string,
    playerName: string,
    spectator: boolean,
    fixedPlayerId?: PlayerID,
    seatTokenFromClient?: string
  ) => { playerId: PlayerID; added: boolean; seatToken?: string; seat?: number };
  leave: (playerId?: PlayerID) => boolean;
  disconnect: (socketId: string) => void;
  participants: () => Participant[];
  passPriority: (playerId: PlayerID) => boolean;
  applyEvent: (e: GameEvent) => void;
  replay: (events: GameEvent[]) => void;
}

export function createInitialGameState(gameId: GameID): InMemoryGame {
  const players: PlayerRef[] = [];
  const commandZone: Record<PlayerID, CommanderInfo> = {} as Record<PlayerID, CommanderInfo>;
  let turnPlayer = '' as PlayerID;
  let priority = '' as PlayerID;
  const life: Record<PlayerID, number> = {};

  const state: GameState = {
    id: gameId,
    format: GameFormat.COMMANDER,
    players: players as any,
    startingLife: 40,
    life,
    turnPlayer,
    priority,
    stack: [],
    battlefield: [],
    commandZone: commandZone,
    phase: GamePhase.BEGINNING,
    active: true,
    status: undefined,
    turnOrder: [],
    startedAt: undefined,
    turn: undefined,
    activePlayerIndex: undefined
  };

  const joinedBySocket = new Map<string, Participant>();
  const participantsList: Participant[] = [];
  // Seat token maps for secure reconnect
  const tokenToPlayer = new Map<string, PlayerID>();
  const playerToToken = new Map<PlayerID, string>();

  let seq = 0;

  function participants(): Participant[] {
    return participantsList.slice();
  }

  // Helper: add a player to roster if missing, returns their seat
  function addPlayerIfMissing(id: PlayerID, name: string, desiredSeat?: number): number {
    const existing = players.find(p => p.id === id);
    if (existing) return existing.seat;
    const seat = (typeof desiredSeat === 'number' ? desiredSeat : players.length) as PlayerRef['seat'];
    const ref: PlayerRef = { id, name, seat };
    (players as PlayerRef[]).push(ref);
    life[id] = state.startingLife;
    if (!state.turnPlayer) state.turnPlayer = id;
    if (!state.priority) state.priority = id;
    (commandZone as Record<PlayerID, CommanderInfo>)[id] = { commanderIds: [], tax: 0 };
    seq++; // roster changed
    return seat;
  }

  function join(
    socketId: string,
    playerName: string,
    spectator: boolean,
    fixedPlayerId?: PlayerID,
    seatTokenFromClient?: string
  ) {
    const existing = joinedBySocket.get(socketId);
    if (existing) {
      return { playerId: existing.playerId, added: false, seatToken: playerToToken.get(existing.playerId) };
    }

    const normalizedName = playerName.trim();
    let playerId = fixedPlayerId ?? ('' as PlayerID);
    let added = false;
    let seat: number | undefined;
    let seatToken = seatTokenFromClient;

    if (!spectator) {
      // 1) Token-based claim
      if (seatToken && tokenToPlayer.has(seatToken)) {
        playerId = tokenToPlayer.get(seatToken)!;
        // Ensure roster contains this player (important on process restart)
        seat = addPlayerIfMissing(playerId, normalizedName);
        // Ensure mappings exist
        if (!playerToToken.get(playerId)) {
          playerToToken.set(playerId, seatToken);
        }
      } else {
        // 2) Reuse by fixed id or by name
        if (!playerId) {
          const byName = players.find(p => p.name.trim().toLowerCase() === normalizedName.toLowerCase());
          if (byName) playerId = byName.id as PlayerID;
        }
        if (playerId) {
          // Make sure mappings exist for existing seats
          const existingToken = playerToToken.get(playerId);
          if (existingToken) seatToken = existingToken;
          else {
            seatToken = seatToken || uid('t');
            tokenToPlayer.set(seatToken, playerId);
            playerToToken.set(playerId, seatToken);
          }
        }
        // 3) Create new seat if still no id
        if (!playerId) {
          playerId = uid('p') as PlayerID;
          seat = addPlayerIfMissing(playerId, normalizedName);
          added = true;
          // Assign fresh token
          seatToken = uid('t');
          tokenToPlayer.set(seatToken, playerId);
          playerToToken.set(playerId, seatToken);
        }
      }
    } else {
      // Spectators never claim a player slot
      if (!playerId) playerId = uid('s') as PlayerID;
    }

    const participant: Participant = { socketId, playerId, spectator };
    joinedBySocket.set(socketId, participant);
    participantsList.push(participant);

    return { playerId, added, seatToken, seat };
  }

  function leave(playerId?: PlayerID): boolean {
    if (!playerId) return false;
    const idx = players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      (players as PlayerRef[]).splice(idx, 1);
      delete life[playerId];
      delete (commandZone as Record<string, unknown>)[playerId];
      if (state.turnPlayer === playerId) state.turnPlayer = (players[0]?.id ?? '') as PlayerID;
      if (state.priority === playerId) state.priority = (players[0]?.id ?? '') as PlayerID;
      const token = playerToToken.get(playerId);
      if (token) {
        playerToToken.delete(playerId);
        tokenToPlayer.delete(token);
      }
      seq++;
      return true;
    }
    for (let i = participantsList.length - 1; i >= 0; i--) {
      if (participantsList[i].playerId === playerId) participantsList.splice(i, 1);
    }
    return false;
  }

  function disconnect(socketId: string) {
    const p = joinedBySocket.get(socketId);
    if (!p) return;
    joinedBySocket.delete(socketId);
    for (let i = participantsList.length - 1; i >= 0; i--) {
      if (participantsList[i].socketId === socketId) participantsList.splice(i, 1);
    }
  }

  function passPriority(playerId: PlayerID): boolean {
    if (state.priority !== playerId) return false;
    const nonSpectating = players;
    if (nonSpectating.length === 0) return false;
    const idx = nonSpectating.findIndex(p => p.id === playerId);
    const next = nonSpectating[(idx + 1) % nonSpectating.length];
    state.priority = next.id;
    seq++;
    return true;
  }

  function applyEvent(e: GameEvent) {
    switch (e.type) {
      case 'join': {
        // Seed mappings and roster deterministically on replay
        if (e.seatToken) {
          tokenToPlayer.set(e.seatToken, e.playerId);
          playerToToken.set(e.playerId, e.seatToken);
        }
        addPlayerIfMissing(e.playerId, e.name, e.seat);
        break;
      }
      case 'leave':
        leave(e.playerId);
        break;
      case 'passPriority':
        passPriority(e.by);
        break;
    }
  }

  function replay(events: GameEvent[]) {
    for (const e of events) applyEvent(e);
  }

  return {
    state,
    seq,
    join,
    leave,
    disconnect,
    participants,
    passPriority,
    applyEvent,
    replay
  };
}

export function filterViewForParticipant(state: GameState, _playerId: PlayerID, _spectator: boolean): ClientGameView {
  return {
    ...state,
    battlefield: [...state.battlefield],
    stack: [...state.stack],
    players: state.players.map(p => ({ id: p.id, name: p.name, seat: p.seat }))
  };
}