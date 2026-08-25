// server/src/socket/util-handlers/repairMissingPriorityIfStuck.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: ts() debug timestamps plus repairMissingPriorityIfStuck
//   (stuck-priority restore used by auto-pass and broadcast).
// Public entry symbols: ts, repairMissingPriorityIfStuck.

import type { InMemoryGame } from "../../state/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { BOOT_ID } from "../../utils/bootId.js";

/**
 * Timeout for clearing the priority restoration flag.
 * This prevents recursive broadcasts when restoring stuck priority.
 */
const PRIORITY_RESTORE_FLAG_TIMEOUT_MS = 100;

// DEVOTION_COLOR_PATTERNS moved to ./util-handlers/manaProductionDevotionPatterns.js


// Mana color keys/symbols now live in ./util-handlers/manaColorConstants.js
// (imported above, re-exported below for the public "./util.js" path).

// ============================================================================
// Helper function for timestamps in debug logging
// ============================================================================
export function ts() {
  return new Date().toISOString();
}

// parseSpelledOutAmount moved to ./util-handlers/manaProductionAmountParse.js


export function repairMissingPriorityIfStuck(
  game: InMemoryGame,
  gameId: string,
  logScope: string,
  debugCallId?: string,
): boolean {
  const stateAny = (game.state as any) || {};
  if (stateAny.priority) return false;

  const phase = String(stateAny?.phase || '').toLowerCase();
  const step = String(stateAny?.step || '').toUpperCase();
  if (phase === 'pre_game' || phase === 'pre-game') return false;
  if (['UNTAP', 'CLEANUP'].includes(step)) return false;

  const pendingSummary = ResolutionQueueManager.getPendingSummary(gameId);
  if (pendingSummary.hasPending) return false;

  const turnPlayer = String(stateAny.turnPlayer || '').trim();
  if (!turnPlayer) return false;

  debugWarn(1, `${ts()} ${logScope} STUCK STATE DETECTED: Priority is null in ${phase}/${step} with no pending resolution steps!`, {
    bootId: BOOT_ID,
    gameId,
    debugCallId,
    phase,
    step,
  });
  debugWarn(1, `${ts()} ${logScope} Restoring priority to turn player to fix stuck game${debugCallId ? ` (ID: ${debugCallId})` : ''}`, {
    bootId: BOOT_ID,
    gameId,
    debugCallId,
  });

  stateAny.priority = turnPlayer;
  stateAny._priorityJustRestored = true;
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  setTimeout(() => {
    delete stateAny._priorityJustRestored;
  }, PRIORITY_RESTORE_FLAG_TIMEOUT_MS);

  debug(1, `${ts()} ${logScope} Priority restored to ${turnPlayer}`);
  return true;
}
