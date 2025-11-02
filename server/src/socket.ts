import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  GameID,
  ClientGameView
} from '../../shared/src';
import { createInitialGameState, filterViewForParticipant, type InMemoryGame } from './state/gameState';
import { computeDiff } from './utils/diff';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const games: Map<GameID, InMemoryGame> = new Map();

function ensureGame(gameId: GameID): InMemoryGame {
  let game = games.get(gameId);
  if (!game) {
    game = createInitialGameState(gameId);
    games.set(gameId, game);
  }
  return game;
}

export function registerSocketHandlers(io: TypedServer) {
  io.on('connection', (socket: Socket) => {
    socket.on('joinGame', ({ gameId, playerName, spectator }) => {
      const game = ensureGame(gameId);
      const { playerId } = game.join(socket.id, playerName, Boolean(spectator));
      socket.data.gameId = gameId;
      socket.data.playerId = playerId;
      socket.data.spectator = spectator;

      socket.join(gameId);
      socket.emit('joined', { gameId, you: playerId });

      const view = filterViewForParticipant(game.state, playerId, Boolean(spectator));
      socket.emit('state', { gameId, view, seq: game.seq });

      socket.to(gameId).emit('stateDiff', {
        gameId,
        diff: computeDiff<ClientGameView>(undefined, view, game.seq) // send full to others for now
      });
    });

    socket.on('leaveGame', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game) return;
      game.leave(socket.data.playerId);
      socket.leave(gameId);
    });

    socket.on('requestState', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game || !socket.data.playerId) return;
      const view = filterViewForParticipant(game.state, socket.data.playerId, Boolean(socket.data.spectator));
      socket.emit('state', { gameId, view, seq: game.seq });
    });

    socket.on('passPriority', ({ gameId }) => {
      const game = games.get(gameId);
      if (!game || !socket.data.playerId) return;
      game.passPriority(socket.data.playerId);
      const participants = game.participants();
      for (const p of participants) {
        const view = filterViewForParticipant(game.state, p.playerId, p.spectator);
        io.to(p.socketId).emit('stateDiff', { gameId, diff: computeDiff(undefined, view, game.seq) });
        io.to(p.socketId).emit('priority', { gameId, player: game.state.priority });
      }
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