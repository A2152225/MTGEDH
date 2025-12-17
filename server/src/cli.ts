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
      console.log('\n📋 No games currently exist.\n');
      return;
    }
    
    console.log('\n📋 Current Games:');
    console.log('─'.repeat(80));
    
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
      
      console.log(`  ${index + 1}. Game ID: ${id}`);
      console.log(`     Format: ${row.format} | Starting Life: ${row.starting_life}`);
      console.log(`     Created: ${formatDate(row.created_at)}`);
      console.log(`     Players (${playersCount}): ${playerNames}`);
      console.log(`     Active Connections: ${activeConnections}`);
      console.log(`     Phase: ${phase}${step ? '/' + step : ''} | Turn: ${turn}`);
      console.log('');
    });
    
    console.log(`Total: ${persisted.length} game(s)`);
    console.log('─'.repeat(80));
    console.log('');
  } catch (err) {
    console.error('❌ Error listing games:', (err as Error).message);
  }
}

/**
 * Delete a game by its number in the list
 */
function deleteGameByNumber(gameNumber: number): void {
  try {
    const persisted = listGames();
    
    if (gameNumber < 1 || gameNumber > persisted.length) {
      console.log(`\n❌ Invalid game number: ${gameNumber}. Valid range: 1-${persisted.length}\n`);
      return;
    }
    
    const game = persisted[gameNumber - 1];
    const gameId = game.game_id;
    
    console.log(`\n🗑️  Deleting game #${gameNumber} (${gameId})...`);
    
    // Remove from GameManager (authoritative in-memory games map)
    try {
      const removed = GameManager.deleteGame(gameId);
      console.log(`   - GameManager: ${removed ? 'removed' : 'not found'}`);
    } catch (e) {
      console.warn(`   - GameManager removal failed: ${(e as Error).message}`);
    }
    
    // Remove from legacy socketGames Map
    try {
      const hadLegacy = socketGames.delete(gameId as any);
      if (hadLegacy) {
        console.log('   - Legacy socketGames: removed');
      }
    } catch (e) {
      console.warn(`   - Legacy socketGames removal failed: ${(e as Error).message}`);
    }
    
    // Clear any priority timers
    try {
      const timer = priorityTimers.get(gameId as any);
      if (timer) {
        clearTimeout(timer);
        priorityTimers.delete(gameId as any);
        console.log('   - Priority timer: cleared');
      }
    } catch (e) {
      console.warn(`   - Priority timer cleanup failed: ${(e as Error).message}`);
    }
    
    // Delete from database
    const dbResult = dbDeleteGame(gameId);
    console.log(`   - Database: ${dbResult ? 'deleted' : 'not found'}`);
    
    console.log(`\n✅ Game #${gameNumber} (${gameId}) has been deleted.\n`);
  } catch (err) {
    console.error('❌ Error deleting game:', (err as Error).message);
  }
}

/**
 * Stop the server gracefully
 */
function stopServer(): void {
  console.log('\n🛑 Stopping server...');
  
  if (httpServer) {
    httpServer.close(() => {
      console.log('✅ Server stopped gracefully.');
      process.exit(0);
    });
    
    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
      console.log('⚠️  Forcing shutdown after timeout...');
      process.exit(0);
    }, 5000);
  } else {
    console.log('⚠️  No HTTP server reference available. Exiting process...');
    process.exit(0);
  }
}

/**
 * Restart the server by exiting with a special code
 * The process manager (pm2, systemd, etc.) should restart the process
 */
function restartServer(): void {
  console.log('\n🔄 Restarting server...');
  console.log('   Note: This relies on a process manager (like pm2) to restart the process.');
  
  if (httpServer) {
    httpServer.close(() => {
      console.log('✅ Server closed. Exiting with code 0 for restart...');
      // Exit with code 0 - process managers typically restart on non-error exits when configured
      process.exit(0);
    });
    
    setTimeout(() => {
      console.log('⚠️  Forcing restart after timeout...');
      process.exit(0);
    }, 5000);
  } else {
    console.log('⚠️  No HTTP server reference available. Exiting for restart...');
    process.exit(0);
  }
}

/**
 * Display help information
 */
function showHelp(): void {
  console.log(`
📖 MTGEDH Server CLI Commands:
─────────────────────────────────────────────────────────────────
  list              Show all current games with their details
  delete game #     Delete a specific game by its number (from list)
  stop              Stop the server gracefully
  restart           Restart the server (requires process manager)
  help              Show this help message
  exit / quit       Stop the server and exit
─────────────────────────────────────────────────────────────────

Examples:
  list                 - Shows all games numbered 1, 2, 3, etc.
  delete game 1        - Deletes the first game in the list
  delete game 3        - Deletes the third game in the list
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
          console.log('\n❌ Invalid game number. Usage: delete game <number>\n');
        } else {
          deleteGameByNumber(gameNum);
        }
      } else {
        console.log('\n❌ Usage: delete game <number>\n   Example: delete game 1\n');
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
      console.log(`\n❌ Unknown command: "${command}". Type "help" for available commands.\n`);
  }
}

/**
 * Initialize the CLI interface
 * This sets up readline to listen for stdin commands
 * 
 * Note on PowerShell compatibility:
 * PowerShell can have issues with readline where each keystroke appears to
 * trigger the 'line' event prematurely. This is due to how PowerShell handles
 * TTY input buffering. We set terminal: false to use raw mode which provides
 * better compatibility across different shells.
 * 
 * If you experience issues with the CLI in PowerShell, try using:
 * - cmd.exe instead of PowerShell
 * - Windows Terminal with PowerShell
 * - Git Bash
 */
export function initCLI(): void {
  // Skip CLI initialization if stdin is not a TTY (e.g., running in background)
  if (!process.stdin.isTTY) {
    console.log('[CLI] Not running in interactive mode (no TTY). CLI commands disabled.');
    return;
  }
  
  // Detect Windows and PowerShell
  const isWindows = process.platform === 'win32';
  const isPowerShell = !!(process.env.PSModulePath || process.env.POWERSHELL_DISTRIBUTION_CHANNEL);
  
  if (isWindows && isPowerShell) {
    console.log('[CLI] Detected Windows PowerShell. If CLI commands are not working correctly,');
    console.log('[CLI] try using cmd.exe, Windows Terminal, or Git Bash instead.');
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'mtgedh> ',
    // Use terminal: true for proper line buffering
    // This should help with PowerShell issues where each keystroke
    // was being interpreted as a separate input
    terminal: true,
  });
  
  // Set raw mode on stdin if available - this helps with proper input handling
  // on some terminals (including PowerShell)
  if (typeof process.stdin.setRawMode === 'function') {
    try {
      // Note: We DON'T set raw mode here because readline handles it
      // Just log that it's available for debugging
      console.log('[CLI] Raw mode available on stdin');
    } catch (err) {
      console.log('[CLI] Could not check raw mode:', (err as Error).message);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  MTGEDH Server CLI - Type "help" for available commands');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  rl.prompt();
  
  rl.on('line', (line) => {
    processCommand(line);
    rl.prompt();
  });
  
  rl.on('close', () => {
    console.log('\n[CLI] Input stream closed. Use Ctrl+C to stop the server.');
  });
  
  // Handle SIGINT (Ctrl+C) gracefully
  // Use 'once' to prevent multiple handlers if initCLI is called multiple times
  process.once('SIGINT', () => {
    console.log('\n\n⚡ Received SIGINT (Ctrl+C)');
    rl.close(); // Close readline interface for proper cleanup
    stopServer();
  });
}
