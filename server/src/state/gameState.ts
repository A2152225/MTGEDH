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

export interface Participant {
  readonly socketId: string;
  readonly playerId: PlayerID;
  readonly spectator: boolean;
}

export interface InMemoryGame {
  readonly state: GameState;
  seq: number;
  join: (socketId: string, playerName: string, spectator: boolean) => { playerId: PlayerID };
  leave: (playerId?: PlayerID) => void;
  disconnect: (socketId: string) => void;
  participants: () => Participant[];
  passPriority: (playerId: PlayerID) => void;
}

export function createInitialGameState(gameId: GameID): InMemoryGame {
  const players: PlayerRef[] = [];
  const commandZone: Record<PlayerID, CommanderInfo> = {} as Record<PlayerID, CommanderInfo>;
  let turnPlayer = '' as PlayerID;
  let priority = '' as PlayerID;
  const life: Record<PlayerID, number> = {};

  const state: GameState = {
    id: gameId,
    format: 'commander',
    players,
    startingLife: 40,
    life,
    turnPlayer,
    priority,
    stack: [],
    battlefield: [],
    commandZone: commandZone,
    phase: 'begin',
    active: true
  };

  const joinedBySocket = new Map<string, Participant>();
  const participantsList: Participant[] = [];
  let seq = 0;

  function participants(): Participant[] {
    return participantsList.slice();
  }

  function join(socketId: string, playerName: string, spectator: boolean) {
    const existing = joinedBySocket.get(socketId);
    if (existing) return { playerId: existing.playerId };

    const playerId = uid('p');
    if (!spectator) {
      const seat = players.length as PlayerRef['seat'];
      const ref: PlayerRef = { id: playerId, name: playerName, seat };
      players.push(ref);
      life[playerId] = state.startingLife;
      if (!state.turnPlayer) state.turnPlayer = playerId;
      if (!state.priority) state.priority = playerId;
      (commandZone as Record<PlayerID, CommanderInfo>)[playerId] = { commanderIds: [], tax: 0 };
    }

    const participant: Participant = { socketId, playerId, spectator };
    joinedBySocket.set(socketId, participant);
    participantsList.push(participant);
    seq++;
    return { playerId };
  }

  function leave(playerId?: PlayerID) {
    if (!playerId) return;
    const idx = players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      players.splice(idx, 1);
      delete life[playerId];
      delete (commandZone as Record<string, unknown>)[playerId];
      if (state.turnPlayer === playerId) state.turnPlayer = players[0]?.id ?? ('' as PlayerID);
      if (state.priority === playerId) state.priority = players[0]?.id ?? ('' as PlayerID);
      seq++;
    }
    for (let i = participantsList.length - 1; i >= 0; i--) {
      if (participantsList[i].playerId === playerId) participantsList.splice(i, 1);
    }
  }

  function disconnect(socketId: string) {
    const p = joinedBySocket.get(socketId);
    if (!p) return;
    joinedBySocket.delete(socketId);
    for (let i = participantsList.length - 1; i >= 0; i--) {
      if (participantsList[i].socketId === socketId) participantsList.splice(i, 1);
    }
  }

  function passPriority(playerId: PlayerID) {
    if (state.priority !== playerId) return;
    const nonSpectating = players;
    if (nonSpectating.length === 0) return;
    const idx = nonSpectating.findIndex(p => p.id === playerId);
    const next = nonSpectating[(idx + 1) % nonSpectating.length];
    state.priority = next.id;
    seq++;
  }

  return {
    state,
    seq,
    join,
    leave,
    disconnect,
    participants,
    passPriority
  };
}

export function filterViewForParticipant(state: GameState, _playerId: PlayerID, _spectator: boolean): ClientGameView {
  // For now, battlefield/stack are already privacy-aware in this stub state
  // Extend later to properly hide face-down info for non-owners/controllers
  return {
    ...state,
    battlefield: state.battlefield,
    stack: state.stack
  };
}