/**
 * WebSocket setup for real-time game updates
 */
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config.js';

export function setupWebSocket(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.corsOrigin,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });

    socket.on('join-game', (gameId: string) => {
      socket.join(gameId);
      console.log(`Client ${socket.id} joined game ${gameId}`);
    });

    socket.on('game-action', (data) => {
      // TODO: Process game actions
      console.log('Game action:', data);
    });
  });

  return io;
}
