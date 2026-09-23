/**
 * Helpers for the seated-player mobile play chrome (dock, pregame banner, sheets).
 * Keep Hand lives in the desktop status-bar extraActions row, which compact
 * mobile chrome hides — these helpers decide when to surface it elsewhere.
 */

export type MobilePrimaryActionMode = 'mulligan' | 'unkeep' | 'play';

export function getMobilePrimaryActionMode(input: {
  isSeatedPlayer: boolean;
  needsToKeepHand: boolean;
  canUnkeepHand: boolean;
}): MobilePrimaryActionMode {
  if (!input.isSeatedPlayer) return 'play';
  if (input.needsToKeepHand) return 'mulligan';
  if (input.canUnkeepHand) return 'unkeep';
  return 'play';
}

/** Stable key so we auto-open the hand sheet once per dealt opening / mulligan hand. */
export function mobileMulliganHandOpenKey(
  gameId: string | null | undefined,
  mulligansTaken: number,
  handCount: number,
): string | null {
  if (!gameId || handCount <= 0) return null;
  return `${gameId}:${mulligansTaken}:${handCount}`;
}

export function shouldAutoOpenMobileMulliganHand(input: {
  showMobileChrome: boolean;
  needsToKeepHand: boolean;
  handCount: number;
  gameId?: string | null;
  mulligansTaken: number;
  lastOpenedKey: string | null;
}): { open: boolean; key: string | null } {
  if (!input.showMobileChrome || !input.needsToKeepHand) {
    return { open: false, key: input.lastOpenedKey };
  }
  const key = mobileMulliganHandOpenKey(input.gameId, input.mulligansTaken, input.handCount);
  if (!key || input.lastOpenedKey === key) {
    return { open: false, key: input.lastOpenedKey };
  }
  return { open: true, key };
}

/**
 * Stable key for auto-opening the stack sheet when priority gains to you
 * with a non-empty stack. Uses top stack id so a new item can re-open once.
 */
export function mobileStackPriorityOpenKey(
  gameId: string | null | undefined,
  priority: string | null | undefined,
  stackLength: number,
  topStackId?: string | null,
): string | null {
  if (!gameId || !priority || stackLength <= 0) return null;
  return `${gameId}:${priority}:${stackLength}:${topStackId ?? ''}`;
}

export function shouldAutoOpenMobileStackSheet(input: {
  showMobileChrome: boolean;
  isSeatedPlayer: boolean;
  hasPriority: boolean;
  stackLength: number;
  gameId?: string | null;
  priority?: string | null;
  topStackId?: string | null;
  lastOpenedKey: string | null;
}): { open: boolean; key: string | null } {
  if (
    !input.showMobileChrome ||
    !input.isSeatedPlayer ||
    !input.hasPriority ||
    input.stackLength <= 0
  ) {
    return { open: false, key: input.lastOpenedKey };
  }
  const key = mobileStackPriorityOpenKey(
    input.gameId,
    input.priority,
    input.stackLength,
    input.topStackId,
  );
  if (!key || input.lastOpenedKey === key) {
    return { open: false, key: input.lastOpenedKey };
  }
  return { open: true, key };
}