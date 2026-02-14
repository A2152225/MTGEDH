/**
 * server/src/cli.ts
 * 
 * Command-line interface for server management.
 * Provides interactive commands for listing games, deleting games, and server control.
 */

import * as readline from 'readline';
import { listGames, deleteGame as dbDeleteGame } from './db/index.js';
import GameManager from './GameManager.js';
import { games as socketGames, priorityTimers } from './socket/socket.js';
import { debug, debugWarn, debugError } from "./utils/debug.js";

// Reference to the HTTP server for graceful shutdown
let httpServer: any = null;

/**
 * Set the HTTP server instance for CLI control
 */
export function setHttpServer(server: any): void {
  httpServer = server;
}

/**
 * Format a timestamp as a human-readable date
 */
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * List all current games with their metadata
 */
function listAllGames(): void {
  try {
    const persisted = listGames();
    
    if (persisted.length === 0) {
      debug(2, '\n📋 No games currently exist.\n');
      return;
    }
    
    debug(2, '\n📋 Current Games:');
    debug(2, '─'.repeat(80));
    
    persisted.forEach((row, index) => {
      const id = row.game_id;
      const inMem = socketGames.get(id) || GameManager.getGame(id);
      
      const playersCount = inMem
        ? inMem.state && Array.isArray(inMem.state.players)
          ? inMem.state.players.length
          : 0
        : 0;
      
      const phase = inMem?.state?.phase || 'unknown';
      const step = (inMem?.state as any)?.step || '';
      const turn = inMem?.state?.turn ?? 'N/A';
      const activeConnections = GameManager.getActiveConnectionsCount(id);
      
      const playerNames = inMem?.state?.players
        ?.filter((p: any) => !p.spectator)
        ?.map((p: any) => p.name)
        ?.join(', ') || 'None';
      
      debug(2, `  ${index + 1}. Game ID: ${id}`);
      debug(2, `     Format: ${row.format} | Starting Life: ${row.starting_life}`);
      debug(2, `     Created: ${formatDate(row.created_at)}`);
      debug(2, `     Players (${playersCount}): ${playerNames}`);
      debug(2, `     Active Connections: ${activeConnections}`);
      debug(2, `     Phase: ${phase}${step ? '/' + step : ''} | Turn: ${turn}`);
      debug(2, '');
    });
    
    debug(2, `Total: ${persisted.length} game(s)`);
    debug(2, '─'.repeat(80));
    debug(2, '');
  } catch (err) {
    debugError(1, '❌ Error listing games:', (err as Error).message);
  }
}

/**
 * Delete a game by its number in the list
 */
function deleteGameByNumber(gameNumber: number): void {
  try {
    const persisted = listGames();
    
    if (gameNumber < 1 || gameNumber > persisted.length) {
      debug(2, `\n❌ Invalid game number: ${gameNumber}. Valid range: 1-${persisted.length}\n`);
      return;
    }
    
    const game = persisted[gameNumber - 1];
    const gameId = game.game_id;
    
    debug(2, `\n🗑️  Deleting game #${gameNumber} (${gameId})...`);
    
    // Remove from GameManager (authoritative in-memory games map)
    try {
      const removed = GameManager.deleteGame(gameId);
      debug(2, `   - GameManager: ${removed ? 'removed' : 'not found'}`);
    } catch (e) {
      debugWarn(1, `   - GameManager removal failed: ${(e as Error).message}`);
    }
    
    // Remove from legacy socketGames Map
    try {
      const hadLegacy = socketGames.delete(gameId as any);
      if (hadLegacy) {
        debug(2, '   - Legacy socketGames: removed');
      }
    } catch (e) {
      debugWarn(1, `   - Legacy socketGames removal failed: ${(e as Error).message}`);
    }
    
    // Clear any priority timers
    try {
      const timer = priorityTimers.get(gameId as any);
      if (timer) {
        clearTimeout(timer);
        priorityTimers.delete(gameId as any);
        debug(2, '   - Priority timer: cleared');
      }
    } catch (e) {
      debugWarn(1, `   - Priority timer cleanup failed: ${(e as Error).message}`);
    }
    
    // Delete from database
    const dbResult = dbDeleteGame(gameId);
    debug(2, `   - Database: ${dbResult ? 'deleted' : 'not found'}`);
    
    debug(2, `\n✅ Game #${gameNumber} (${gameId}) has been deleted.\n`);
  } catch (err) {
    debugError(1, '❌ Error deleting game:', (err as Error).message);
  }
}

/**
 * Delete a game by its id
 */
function deleteGameById(gameId: string): void {
  try {
    const id = String(gameId || '').trim();
    if (!id) {
      debug(2, '\n❌ Missing game id. Usage: delete id <gameId>\n');
      return;
    }

    debug(2, `\n🗑️  Deleting game (${id})...`);

    try {
      const removed = GameManager.deleteGame(id);
      debug(2, `   - GameManager: ${removed ? 'removed' : 'not found'}`);
    } catch (e) {
      debugWarn(1, `   - GameManager removal failed: ${(e as Error).message}`);
    }

    try {
      const hadLegacy = socketGames.delete(id as any);
      if (hadLegacy) debug(2, '   - Legacy socketGames: removed');
    } catch (e) {
      debugWarn(1, `   - Legacy socketGames removal failed: ${(e as Error).message}`);
    }

    try {
      const timer = priorityTimers.get(id as any);
      if (timer) {
        clearTimeout(timer);
        priorityTimers.delete(id as any);
        debug(2, '   - Priority timer: cleared');
      }
    } catch (e) {
      debugWarn(1, `   - Priority timer cleanup failed: ${(e as Error).message}`);
    }

    const dbResult = dbDeleteGame(id);
    debug(2, `   - Database: ${dbResult ? 'deleted' : 'not found'}`);

    debug(2, `\n✅ Game (${id}) has been deleted.\n`);
  } catch (err) {
    debugError(1, '❌ Error deleting game by id:', (err as Error).message);
  }
}

/**
 * Delete ALL games
 */
function deleteAllGames(): void {
  try {
    const persisted = listGames();
    if (persisted.length === 0) {
      debug(2, '\n📋 No games to delete.\n');
      return;
    }

    debug(2, `\n🧨 Deleting ALL games (${persisted.length})...`);
    for (const row of persisted) {
      const id = row.game_id;
      deleteGameById(id);
    }
    debug(2, '✅ Finished deleting all games.\n');
  } catch (err) {
    debugError(1, '❌ Error deleting all games:', (err as Error).message);
  }
}

/**
 * Stop the server gracefully
 */
function stopServer(): void {
  debug(2, '\n🛑 Stopping server...');
  
  if (httpServer) {
    httpServer.close(() => {
      debug(2, '✅ Server stopped gracefully.');
      process.exit(0);
    });
    
    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
      debug(2, '⚠️  Forcing shutdown after timeout...');
      process.exit(0);
    }, 5000);
  } else {
    debug(2, '⚠️  No HTTP server reference available. Exiting process...');
    process.exit(0);
  }
}

/**
 * Restart the server by exiting with a special code
 * The process manager (pm2, systemd, etc.) should restart the process
 */
function restartServer(): void {
  debug(2, '\n🔄 Restarting server...');
  debug(2, '   Note: This relies on a process manager (like pm2) to restart the process.');
  
  if (httpServer) {
    httpServer.close(() => {
      debug(2, '✅ Server closed. Exiting with code 0 for restart...');
      // Exit with code 0 - process managers typically restart on non-error exits when configured
      process.exit(0);
    });
    
    setTimeout(() => {
      debug(2, '⚠️  Forcing restart after timeout...');
      process.exit(0);
    }, 5000);
  } else {
    debug(2, '⚠️  No HTTP server reference available. Exiting for restart...');
    process.exit(0);
  }
}

/**
 * Display help information
 */
function showHelp(): void {
  debug(2, `
📖 MTGEDH Server CLI Commands:
─────────────────────────────────────────────────────────────────
  list              Show all current games with their details
  delete game #     Delete a specific game by its number (from list)
  delete id <id>    Delete a specific game by its gameId
  delete all        Delete ALL games (in-memory + persisted)
  stop              Stop the server gracefully
  restart           Restart the server (requires process manager)
  help              Show this help message
  exit / quit       Stop the server and exit
─────────────────────────────────────────────────────────────────

Examples:
  list                 - Shows all games numbered 1, 2, 3, etc.
  delete game 1        - Deletes the first game in the list
  delete game 3        - Deletes the third game in the list
  delete id my_game     - Deletes by id
  delete all            - Deletes everything
`);
}

/**
 * Process a CLI command
 */
function processCommand(input: string): void {
  const trimmed = input.trim().toLowerCase();
  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  
  switch (command) {
    case 'list':
      listAllGames();
      break;
      
    case 'delete':
      // Handle "delete game #" format
      if (parts[1] === 'game' && parts[2]) {
        const gameNum = parseInt(parts[2], 10);
        if (isNaN(gameNum)) {
          debug(2, '\n❌ Invalid game number. Usage: delete game <number>\n');
        } else {
          deleteGameByNumber(gameNum);
        }
      } else if (parts[1] === 'id' && parts[2]) {
        deleteGameById(parts.slice(2).join(' '));
      } else if (parts[1] === 'all') {
        deleteAllGames();
      } else {
        debug(2, '\n❌ Usage: delete game <number> | delete id <gameId> | delete all\n');
      }
      break;
      
    case 'stop':
    case 'exit':
    case 'quit':
      stopServer();
      break;
      
    case 'restart':
      restartServer();
      break;
      
    case 'help':
    case '?':
      showHelp();
      break;
      
    case '':
      // Ignore empty input
      break;
      
    default:
      debug(2, `\n❌ Unknown command: "${command}". Type "help" for available commands.\n`);
  }
}

/**
 * Initialize the CLI interface
 * This sets up readline to listen for stdin commands
 * 
 * Note on PowerShell compatibility:
 * PowerShell can have issues with readline where each keystroke appears to
 * trigger the 'line' event prematurely. This is due to how PowerShell handles
 * TTY input buffering. We set terminal: true to enable proper line editing
 * and buffering through the readline module.
 * 
 * If you experience issues with the CLI in PowerShell, try using:
 * - cmd.exe instead of PowerShell
 * - Windows Terminal with PowerShell
 * - Git Bash
 */
export function initCLI(): void {
  // Skip CLI initialization if stdin is not a TTY (e.g., running in background)
  if (!process.stdin.isTTY) {
    debug(2, '[CLI] Not running in interactive mode (no TTY). CLI commands disabled.');
    return;
  }
  
  // Detect Windows and PowerShell
  const isWindows = process.platform === 'win32';
  const isPowerShell = !!(process.env.PSModulePath || process.env.POWERSHELL_DISTRIBUTION_CHANNEL);
  
  if (isWindows && isPowerShell) {
    debug(2, '[CLI] Detected Windows PowerShell. If CLI commands are not working correctly,');
    debug(2, '[CLI] try using cmd.exe, Windows Terminal, or Git Bash instead.');
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'mtgedh> ',
    // Use terminal: true for proper line buffering and editing
    // This enables readline's built-in line editing capabilities
    terminal: true,
  });
  
  debug(2, '\n═══════════════════════════════════════════════════════════════════');
  debug(2, '  MTGEDH Server CLI - Type "help" for available commands');
  debug(2, '═══════════════════════════════════════════════════════════════════\n');
  
  rl.prompt();
  
  rl.on('line', (line) => {
    processCommand(line);
    rl.prompt();
  });
  
  rl.on('close', () => {
    debug(2, '\n[CLI] Input stream closed. Use Ctrl+C to stop the server.');
  });
  
  // Handle SIGINT (Ctrl+C) gracefully
  // Use 'once' to prevent multiple handlers if initCLI is called multiple times
  process.once('SIGINT', () => {
    debug(2, '\n\n⚡ Received SIGINT (Ctrl+C)');
    rl.close(); // Close readline interface for proper cleanup
    stopServer();
  });
}


