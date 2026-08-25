// server/src/socket/util-handlers/autoPassTimerState.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: auto-pass delay, idle-bypass predicates, and pending
//   human-auto-pass / automation-resume timer maps.
// Public entry symbols: AUTO_PASS_DELAY_MS, LAND_PLAY_AUTOMATION_SUPPRESSION_MS,
//   shouldBypassIdleForNonEmptyStack, isLoopStackDrainActive,
//   clearScheduledHumanAutoPass, clearScheduledHumanAutoPassForGame,
//   clearScheduledAutomationResume, pendingHumanAutoPassTimers,
//   pendingAutomationResumeTimers.

import type { PlayerID } from "../../../../shared/src/index.js";

/**
 * Delay in milliseconds before auto-passing priority for human players.
 * This gives them a brief moment to evaluate board state and claim priority.
 * AI players and "Auto-Pass Rest of Turn" skip this delay for faster gameplay.
 */
export const AUTO_PASS_DELAY_MS = 150;

/**
 * Smart Pass may skip the idle/canRespond check only when the top stack object
 * is controlled by the priority player (so floating mana does not stall their
 * own spells). Opponent-controlled objects fail closed and require a real response check.
 */
function topStackObjectControlledByPlayer(state: any, playerId: string): boolean {
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  if (stack.length === 0) return false;
  const top = stack[stack.length - 1];
  const controller = String(top?.controller || '').trim();
  if (!controller) return false;
  return controller === String(playerId || '').trim();
}

/**
 * Whether Smart Pass / loop-drain may bypass idle checks for a nonempty stack.
 * Explicit rest-of-turn and loop-drain bypass idle only while the stack is
 * non-empty; ordinary Smart Pass only bypasses for the player's own top stack
 * object. Loop drain must not force empty-stack passes on the active player's
 * main phase (that ping-pongs with opponents who report canRespond).
 */
export function shouldBypassIdleForNonEmptyStack(options: {
  stackLen: number;
  autoPassEnabled: boolean;
  loopStackDrain: boolean;
  autoPassForTurn: boolean;
  state: any;
  playerId: string;
}): boolean {
  const { stackLen, autoPassEnabled, loopStackDrain, autoPassForTurn, state, playerId } = options;
  if (stackLen <= 0) return false;
  if (loopStackDrain || autoPassForTurn) return true;
  if (!autoPassEnabled) return false;
  return topStackObjectControlledByPlayer(state, playerId);
}

/** Loop drain may skip idle checks only while there is something to resolve. */
export function isLoopStackDrainActive(loopStackDrain: boolean, stackLen: number): boolean {
  return loopStackDrain && stackLen > 0;
}

export const LAND_PLAY_AUTOMATION_SUPPRESSION_MS = 1500;

type PendingHumanAutoPass = {
  playerId: PlayerID;
  timeout: ReturnType<typeof setTimeout>;
};

type PendingAutomationResume = {
  suppressUntil: number;
  timeout: ReturnType<typeof setTimeout>;
};

export const pendingHumanAutoPassTimers = new Map<string, PendingHumanAutoPass>();
export const pendingAutomationResumeTimers = new Map<string, PendingAutomationResume>();

export function clearScheduledHumanAutoPass(gameId: string, playerId?: PlayerID | string | null) {
  const pending = pendingHumanAutoPassTimers.get(gameId);
  if (!pending) return;
  if (playerId && pending.playerId !== playerId) return;
  clearTimeout(pending.timeout);
  pendingHumanAutoPassTimers.delete(gameId);
}

export function clearScheduledHumanAutoPassForGame(gameId: string): void {
  clearScheduledHumanAutoPass(gameId);
}

export function clearScheduledAutomationResume(gameId: string): void {
  const pending = pendingAutomationResumeTimers.get(gameId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingAutomationResumeTimers.delete(gameId);
}
