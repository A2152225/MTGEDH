/**
 * Centralized debug logging utility for client
 * 
 * Debug levels:
 * - 0: No debug output (production mode)
 * - 1: Essential debugging - important state changes, errors, and app flow
 * - 2: Verbose debugging - detailed logs for deep investigation
 * 
 * Usage:
 * import { debug } from './utils/debug';
 * 
 * debug(1, '[module] Essential debug message');
 * debug(2, '[module] Verbose debug message with details:', data);
 */

/**
 * Get the current debug level from environment variable
 * For Vite, use import.meta.env.VITE_DEBUG_STATE
 * Defaults to 0 (no debug output)
 */
function getDebugLevel(): number {
  // Check if we're in a Vite environment
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const level = import.meta.env.VITE_DEBUG_STATE;
    if (level === undefined || level === '') return 0;
    const parsed = parseInt(level, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  
  // Fallback for non-Vite environments
  return 0;
}

/**
 * Log a debug message if the current debug level is >= the required level
 * @param requiredLevel - Minimum debug level required to show this message (1 or 2)
 * @param args - Arguments to pass to console.log
 */
export function debug(requiredLevel: number, ...args: any[]): void {
  const currentLevel = getDebugLevel();
  if (currentLevel >= requiredLevel) {
    console.log(...args);
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
    console.warn(...args);
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
    console.error(...args);
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
