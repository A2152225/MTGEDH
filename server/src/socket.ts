import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  GameID,
  ClientGameView,
  PlayerID
} from '../../shared/src';
import { createInitialGameState, type InMemoryGame, type GameEvent } from './state/gameState';
import { computeDiff } from './utils/diff';
import { createGameIfNotExists, getEvents, appendEvent } from './db';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const games: Map<GameID, InMemoryGame> = new Map();

function ensureGame(gameId: GameID): InMemoryGame {
  let game = games.get(gameId);
  if (!game) {
    game = createInitialGameState(gameId);
    createGameIfNotExists(gameId, String(game.state.format), game.state.startingLife);

    const persisted = getEvents(gameId);
    const replayEvents: GameEvent[] = persisted.map(e => {
      switch (e.type) {
        case 'join':
        case 'leave':
        case 'passPriority':
          return { type: e.type, ...(e.payload || {}) } as GameEvent;
        default:
          return e.payload as GameEvent;
      }
    });
    game.replay(replayEvents);

    games.set(gameId, game);
  }
  return game;
}

function broadcastGame(io: TypedServer, game: InMemoryGame, gameId: GameID) {
  const participants = game.participants();
  for (const p of participants) {
    const view = game.viewFor(p.playerId, p.spectator);
    io.to(p.socketId).emit('stateDiff', {
      gameId,
      diff: computeDiff<ClientGameView>(undefined, view, game.seq)
    });
  }
}

export function registerSocketHandlers(io: TypedServer) {
  io.on('connection', (socket: Socket) => {
    socket.on('joinGame', ({ gameId, playerName, spectator, seatToken }) => {
      const game = ensureGame(gameId);
      const { playerId, added, seatToken: resolvedToken } = game.join(
        socket.id,
        playerName,
        Boolean(spectator),
        undefined,
        seatToken
      );

      socket.data.gameId = gameId;
      socket.data.playerId = playerId;
      socket.data.spectator = spectator;

      socket.join(gameId);
      socket.emit('joined', { gameId, you: playerId, seatToken: resolvedToken });

      const view = game.viewFor(playerId, Boolean(spectator));
      socket.emit('state', { gameId, view, seq: game.seq });

      if (!spectator && added) {
        const seq = game.seq;
        appendEvent(gameId, seq, 'join', {
          playerId,
          name: playerName,
          seat: view.players.find(p => p.id === playerId)?.seat,
          seatToken: resolvedToken
        });
      }

      socket.to(gameId).emit('stateDiff', {
        gameId,
        diff: computeDiff<ClientGameView>(undefined, view, game.seq)
      });
    });

    socket.on('leaveGame', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game) return;
      const left = game.leave(socket.data.playerId);
      socket.leave(gameId);

      if (left && socket.data.playerId) {
        appendEvent(gameId, game.seq, 'leave', { playerId: socket.data.playerId });
        broadcastGame(io, game, gameId);
      }
    });

    socket.on('requestState', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game || !socket.data.playerId) return;
      const view = game.viewFor(socket.data.playerId, Boolean(socket.data.spectator));
      socket.emit('state', { gameId, view, seq: game.seq });
    });

    socket.on('passPriority', ({ gameId }) => {
      const game = games.get(gameId);
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!game || !pid) return;
      const changed = game.passPriority(pid);
      if (!changed) return;

      appendEvent(gameId, game.seq, 'passPriority', { by: pid });
      broadcastGame(io, game, gameId);
      io.to(gameId).emit('priority', { gameId, player: game.state.priority });
    });

    socket.on('grantSpectatorAccess', ({ gameId, spectatorId }) => {
      const game = games.get(gameId);
      const owner = socket.data.playerId as PlayerID | undefined;
      if (!game || !owner || !spectatorId) return;

      game.grantSpectatorAccess(owner, spectatorId);

      // System chat notice
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `Player ${owner} granted hidden-info access to spectator ${spectatorId}`,
        ts: Date.now()
      });

      broadcastGame(io, game, gameId);
    });

    socket.on('disconnect', () => {
      const { gameId } = socket.data;
      if (!gameId) return;
      const game = games.get(gameId);
      if (!game) return;
      game.disconnect(socket.id);
    });
  });
}