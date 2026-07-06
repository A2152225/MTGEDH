/**
 * server/src/cli.ts
 * 
 * Command-line interface for server management.
 * Provides interactive commands for listing games, deleting games, and server control.
 */

import * as readline from 'readline';
import { execFileSync } from 'node:child_process';
import { listGames, deleteGame as dbDeleteGame } from './db/index.js';
import GameManager from './GameManager.js';
import { games as socketGames, priorityTimers } from './socket/socket.js';
import { debug, debugWarn, debugError } from "./utils/debug.js";
import {
  hasInteractiveConsoleTty,
  registerCliPromptRedraw,
  setInteractiveCliActive,
} from './utils/cliConsoleState.js';

/** Windows PowerShell/conhost often uses CP1252; avoid UTF-8 emoji/box-drawing in CLI output. */
const CLI_ASCII = process.platform === 'win32' || process.env.MTGEDH_CLI_ASCII === '1';

const CLI = {
  hr: CLI_ASCII ? '-'.repeat(65) : '─'.repeat(80),
  banner: CLI_ASCII ? '='.repeat(67) : '═'.repeat(67),
  list: CLI_ASCII ? '[list]' : '📋',
  help: CLI_ASCII ? 'MTGEDH Server CLI Commands:' : '📖 MTGEDH Server CLI Commands:',
  ok: CLI_ASCII ? '[OK]' : '✅',
  err: CLI_ASCII ? '[ERR]' : '❌',
  warn: CLI_ASCII ? '[WARN]' : '⚠️',
  delete: CLI_ASCII ? '[del]' : '🗑️',
  stop: CLI_ASCII ? '[stop]' : '🛑',
  restart: CLI_ASCII ? '[restart]' : '🔄',
  zap: CLI_ASCII ? '[!]' : '⚡',
  boom: CLI_ASCII ? '[all]' : '🧨',
} as const;

// Reference to the HTTP server for graceful shutdown
let httpServer: any = null;
/** Active readline interface — used to redraw prompt after clear. */
let cliReadline: readline.Interface | null = null;
/** Readline writes here so stdout debug logs do not break echo while typing. */
let cliOutput: NodeJS.WriteStream = process.stdout;

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
      debug(2, `\n${CLI.list} No games currently exist.\n`);
      return;
    }
    
    debug(2, `\n${CLI.list} Current Games:`);
    debug(2, CLI.hr);
    
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
        ?.filter((p: any) => !(p.spectator || p.isSpectator))
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
    debug(2, CLI.hr);
    debug(2, '');
  } catch (err) {
    debugError(1, `${CLI.err} Error listing games:`, (err as Error).message);
  }
}

/**
 * Delete a game by its number in the list
 */
function deleteGameByNumber(gameNumber: number): void {
  try {
    const persisted = listGames();
    
    if (gameNumber < 1 || gameNumber > persisted.length) {
      debug(2, `\n${CLI.err} Invalid game number: ${gameNumber}. Valid range: 1-${persisted.length}\n`);
      return;
    }
    
    const game = persisted[gameNumber - 1];
    const gameId = game.game_id;
    
    debug(2, `\n${CLI.delete}  Deleting game #${gameNumber} (${gameId})...`);
    
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
    
    debug(2, `\n${CLI.ok} Game #${gameNumber} (${gameId}) has been deleted.\n`);
  } catch (err) {
    debugError(1, `${CLI.err} Error deleting game:`, (err as Error).message);
  }
}

/**
 * Delete a game by its id
 */
function deleteGameById(gameId: string): void {
  try {
    const id = String(gameId || '').trim();
    if (!id) {
      debug(2, `\n${CLI.err} Missing game id. Usage: delete id <gameId>\n`);
      return;
    }

    debug(2, `\n${CLI.delete}  Deleting game (${id})...`);

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

    debug(2, `\n${CLI.ok} Game (${id}) has been deleted.\n`);
  } catch (err) {
    debugError(1, `${CLI.err} Error deleting game by id:`, (err as Error).message);
  }
}

/**
 * Delete ALL games
 */
function deleteAllGames(): void {
  try {
    const persisted = listGames();
    if (persisted.length === 0) {
      debug(2, `\n${CLI.list} No games to delete.\n`);
      return;
    }

    debug(2, `\n${CLI.boom} Deleting ALL games (${persisted.length})...`);
    for (const row of persisted) {
      const id = row.game_id;
      deleteGameById(id);
    }
    debug(2, `${CLI.ok} Finished deleting all games.\n`);
  } catch (err) {
    debugError(1, `${CLI.err} Error deleting all games:`, (err as Error).message);
  }
}

/**
 * Stop the server gracefully
 */
function stopServer(): void {
  debug(2, `\n${CLI.stop} Stopping server...`);
  
  if (httpServer) {
    httpServer.close(() => {
      debug(2, `${CLI.ok} Server stopped gracefully.`);
      process.exit(0);
    });
    
    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
      debug(2, `${CLI.warn}  Forcing shutdown after timeout...`);
      process.exit(0);
    }, 5000);
  } else {
    debug(2, `${CLI.warn}  No HTTP server reference available. Exiting process...`);
    process.exit(0);
  }
}

/**
 * Restart the server by exiting with a special code
 * The process manager (pm2, systemd, etc.) should restart the process
 */
function restartServer(): void {
  debug(2, `\n${CLI.restart} Restarting server...`);
  debug(2, '   Note: This relies on a process manager (like pm2) to restart the process.');
  
  if (httpServer) {
    httpServer.close(() => {
      debug(2, `${CLI.ok} Server closed. Exiting with code 0 for restart...`);
      // Exit with code 0 - process managers typically restart on non-error exits when configured
      process.exit(0);
    });
    
    setTimeout(() => {
      debug(2, `${CLI.warn}  Forcing restart after timeout...`);
      process.exit(0);
    }, 5000);
  } else {
    debug(2, `${CLI.warn}  No HTTP server reference available. Exiting for restart...`);
    process.exit(0);
  }
}

function tryNativeWindowsClear(): boolean {
  if (process.platform !== 'win32' || !hasInteractiveConsoleTty()) {
    return false;
  }

  const isPowerShell = !!(process.env.PSModulePath || process.env.POWERSHELL_DISTRIBUTION_CHANNEL);
  const attempts: Array<() => void> = [];

  if (isPowerShell) {
    attempts.push(() => {
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', '[Console]::Clear()'],
        { stdio: ['ignore', 'inherit', 'inherit'] },
      );
    });
  }

  attempts.push(() => {
    execFileSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', 'cls'],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
  });

  for (const attempt of attempts) {
    try {
      attempt();
      return true;
    } catch {
      // try next
    }
  }

  return false;
}

/**
 * Clear the terminal screen (useful before exporting logs from a fresh test game).
 * Uses readline-aware clearing so the mtgedh> prompt redraws correctly.
 * Note: verbose DEBUG_STATE logs will immediately print again after clear.
 */
function clearConsole(): void {
  if (!hasInteractiveConsoleTty()) {
    return;
  }

  if (!tryNativeWindowsClear()) {
    const streams = new Set<NodeJS.WriteStream>();
    if (process.stdout.isTTY) streams.add(process.stdout);
    if (process.stderr.isTTY) streams.add(process.stderr);

    for (const stream of streams) {
      try {
        stream.write('\x1b[2J\x1b[3J\x1b[H');
      } catch {
        // ignore
      }
    }

    try {
      readline.cursorTo(cliOutput, 0, 0);
      readline.clearScreenDown(cliOutput);
    } catch {
      // ignore
    }

    const rows = (cliOutput as NodeJS.WriteStream & { rows?: number }).rows || 40;
    try {
      cliOutput.write('\n'.repeat(Math.max(rows - 1, 1)));
    } catch {
      // ignore
    }
  }

  try {
    cliReadline?.prompt();
  } catch {
    // ignore
  }
}

/**
 * Display help information
 */
function showHelp(): void {
  debug(2, `
${CLI.help}
${CLI.hr}
  list              Show all current games with their details
  delete game #     Delete a specific game by its number (from list)
  delete id <id>    Delete a specific game by its gameId
  delete all        Delete ALL games (in-memory + persisted)
  clear / cls       Clear the console window (scrollback may remain; use DEBUG_STATE=0 to reduce log noise)
  stop              Stop the server gracefully
  restart           Restart the server (requires process manager)
  help              Show this help message
  exit / quit       Stop the server and exit
${CLI.hr}

Examples:
  list                 - Shows all games numbered 1, 2, 3, etc.
  delete game 1        - Deletes the first game in the list
  delete game 3        - Deletes the third game in the list
  delete id my_game     - Deletes by id
  delete all            - Deletes everything
  clear                - Clears the terminal (alias: cls)
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
          debug(2, `\n${CLI.err} Invalid game number. Usage: delete game <number>\n`);
        } else {
          deleteGameByNumber(gameNum);
        }
      } else if (parts[1] === 'id' && parts[2]) {
        deleteGameById(parts.slice(2).join(' '));
      } else if (parts[1] === 'all') {
        deleteAllGames();
      } else {
        debug(2, `\n${CLI.err} Usage: delete game <number> | delete id <gameId> | delete all\n`);
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

    case 'clear':
    case 'cls':
      clearConsole();
      break;
      
    case 'help':
    case '?':
      showHelp();
      break;
      
    case '':
      // Ignore empty input
      break;
      
    default:
      debug(2, `\n${CLI.err} Unknown command: "${command}". Type "help" for available commands.\n`);
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
 * Note on PowerShell / Windows:
 * The prompt uses stderr so DEBUG_STATE logs on stdout do not erase characters as you type.
 * If input still misbehaves, try cmd.exe or Windows Terminal instead of classic conhost.
 */
export function initCLI(): void {
  // Skip CLI initialization if stdin is not a TTY (e.g., running in background)
  if (!process.stdin.isTTY) {
    debug(2, '[CLI] Not running in interactive mode (no TTY). CLI commands disabled.');
    return;
  }
  
  // Prompt on stderr — game debug logs use stdout (console.log) and would break readline echo.
  cliOutput = process.stderr.isTTY ? process.stderr : process.stdout;

  const rl = readline.createInterface({
    input: process.stdin,
    output: cliOutput,
    prompt: 'mtgedh> ',
    terminal: true,
  });
  cliReadline = rl;
  setInteractiveCliActive(true);
  registerCliPromptRedraw(() => {
    cliReadline?.prompt();
  });
  
  debug(2, `\n${CLI.banner}`);
  debug(2, '  MTGEDH Server CLI - Type "help" for available commands');
  debug(2, `${CLI.banner}\n`);
  
  rl.prompt();
  
  rl.on('line', (line) => {
    processCommand(line);
    rl.prompt();
  });
  
  rl.on('close', () => {
    setInteractiveCliActive(false);
    cliReadline = null;
    cliOutput = process.stdout;
    debug(2, '\n[CLI] Input stream closed. Use Ctrl+C to stop the server.');
  });
  
  // Handle SIGINT (Ctrl+C) gracefully
  // Use 'once' to prevent multiple handlers if initCLI is called multiple times
  process.once('SIGINT', () => {
    debug(2, `\n\n${CLI.zap} Received SIGINT (Ctrl+C)`);
    rl.close(); // Close readline interface for proper cleanup
    stopServer();
  });
}


