import { Socket, Server } from 'socket.io';
import GameManager from './GameManager';
import { GameActionType, GameAction, AutomationErrorReport } from '../../shared/src';
import { v4 as uuidv4 } from 'uuid';
import { debug, debugWarn, debugError } from "./utils/debug.js";

// Note: This file uses GameManager methods that may not exist on all implementations.
// The actual socket handlers are registered in src/socket/*.ts
export function setupSocketHandlers(socket: Socket, gameManager: any, io: Server) {
  
  // Join game
  socket.on('joinGame', (data: { gameId: string; playerName: string }, callback: any) => {
    if (typeof gameManager?.joinGame !== 'function') {
      callback({ success: false, error: 'joinGame not supported by this GameManager' });
      return;
    }
    const player = gameManager.joinGame(data.gameId, {
      name: data.playerName,
      socketId: socket.id
    });
    
    if (player) {
      socket.join(data.gameId);
      const game = gameManager.getGame(data.gameId);
      
      io.to(data.gameId).emit('playerJoined', { player, game });
      callback({ success: true, player, game });
    } else {
      callback({ success: false, error: 'Could not join game' });
    }
  });
  
  // Start game
  socket.on('startGame', (data: { gameId: string }) => {
    if (typeof gameManager?.startGame !== 'function') return;
    const success = gameManager.startGame(data.gameId);
    if (success) {
      const game = gameManager.getGame?.(data.gameId);
      io.to(data.gameId).emit('gameStarted', game);
    }
  });
  
  // Pass priority
  socket.on('passPriority', (data: { gameId: string; playerId: string }) => {
    // Handle priority passing logic
    const game = gameManager?.getGame?.(data.gameId);
    if (game) {
      io.to(data.gameId).emit('priorityPassed', { playerId: data.playerId, game });
    }
  });
  
  // Report automation error - THIS IS THE KEY FEATURE
  socket.on('reportAutomationError', (report: Omit<AutomationErrorReport, 'id' | 'reportedAt' | 'status'>) => {
    const fullReport: AutomationErrorReport = {
      ...report,
      id: uuidv4(),
      reportedAt: Date.now(),
      status: 'pending'
    };
    
    // Save to database for review
    debug(1, '🚨 Automation Error Reported:', fullReport);
    
    // Notify all players in the game
    io.to(report.gameId).emit('automationErrorReported', {
      message: `${report.playerId} reported a rules issue. Game log saved for review.`,
      reportId: fullReport.id
    });
    
    // In future: store in database, create GitHub issue automatically, etc.
  });
  
  // Generic game action handler
  socket.on('gameAction', (action: GameAction) => {
    const game = gameManager.getGame(action.gameId);
    if (game) {
      // Process action
      // Broadcast to all players
      io.to(action.gameId).emit('gameStateUpdated', game);
    }
  });
}

