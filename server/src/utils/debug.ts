/**
 * Centralized debug logging utility
 * 
 * Debug levels:
 * - 0: No debug output (production mode)
 * - 1: Essential debugging - important state changes, errors, and game flow
 * - 2: Verbose debugging - detailed logs for deep investigation
 * 
 * Usage:
 * import { debug } from './utils/debug';
 * 
 * debug(1, '[module] Essential debug message');
 * debug(2, '[module] Verbose debug message with details:', data);
 */

/**
 * Get the current debug level from environment variable DEBUG_STATE
 * Cached after first read for performance
 * Defaults to 0 (no debug output)
 */
let cachedDebugLevel: number | null = null;

import { inspect } from 'node:util';

function getDebugLevel(): number {
  // Cache the debug level to avoid repeated parsing
  if (cachedDebugLevel !== null) {
    return cachedDebugLevel;
  }
  
  const level = process.env.DEBUG_STATE;
  if (level === undefined || level === '') {
    cachedDebugLevel = 0;
    return 0;
  }
  
  const parsed = parseInt(level, 10);
  
  // Validate the level is within expected range (0-2)
  if (isNaN(parsed) || parsed < 0) {
    cachedDebugLevel = 0;
    return 0;
  }
  
  // Cap at level 2 (verbose)
  cachedDebugLevel = Math.min(parsed, 2);
  return cachedDebugLevel;
}

/**
 * Log a debug message if the current debug level is >= the required level
 * @param requiredLevel - Minimum debug level required to show this message (1 or 2)
 * @param args - Arguments to pass to console.log
 */
export function debug(requiredLevel: number, ...args: any[]): void {
  const currentLevel = getDebugLevel();
  if (currentLevel >= requiredLevel) {
    try {
      console.log(...args.map(formatDebugArg));
    } catch {
      // Never let logging crash game logic.
      try {
        console.log('[debug] (log failed)');
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Log a debug warning if the current debug level is >= the required level
 * @param requiredLevel - Minimum debug level required to show this warning (1 or 2)
 * @param args - Arguments to pass to console.warn
 */
export function debugWarn(requiredLevel: number, ...args: any[]): void {
  const currentLevel = getDebugLevel();
  if (currentLevel >= requiredLevel) {
    try {
      console.warn(...args.map(formatDebugArg));
    } catch {
      try {
        console.warn('[debugWarn] (log failed)');
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Log a debug error if the current debug level is >= the required level
 * @param requiredLevel - Minimum debug level required to show this error (1 or 2)
 * @param args - Arguments to pass to console.error
 */
export function debugError(requiredLevel: number, ...args: any[]): void {
  const currentLevel = getDebugLevel();
  if (currentLevel >= requiredLevel) {
    try {
      console.error(...args.map(formatDebugArg));
    } catch {
      try {
        console.error('[debugError] (log failed)');
      } catch {
        /* ignore */
      }
    }
  }
}

function formatDebugArg(arg: any): any {
  if (arg === null || arg === undefined) return arg;
  const t = typeof arg;
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return arg;

  // Avoid console trying to inspect Errors (which can trigger expensive stack/source-map work).
  if (arg instanceof Error) {
    let stack = '';
    try {
      stack = typeof arg.stack === 'string' ? arg.stack : '';
    } catch {
      stack = '';
    }
    return stack ? stack : `${arg.name}: ${arg.message}`;
  }

  // For all other objects, pre-format with bounded inspect so console doesn't recurse deeply.
  try {
    return inspect(arg, {
      depth: 4,
      maxArrayLength: 50,
      maxStringLength: 2000,
      breakLength: 140,
      compact: true,
      getters: false,
    });
  } catch (e: any) {
    const msg = (e && typeof e.message === 'string') ? e.message : String(e);
    return `[Uninspectable: ${msg}]`;
  }
}

/**
 * Check if debug is enabled at a specific level
 * @param requiredLevel - The debug level to check
 * @returns true if current debug level is >= requiredLevel
 */
export function isDebugEnabled(requiredLevel: number): boolean {
  return getDebugLevel() >= requiredLevel;
}
