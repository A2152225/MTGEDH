import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { exitResolutionMode } from './priority.js';
import { clearOptionalPaymentCallbacks } from '../../socket/optional-payment-prompts.js';

/**
 * Legacy / in-flight prompt state that must not survive event replay.
 * These fields drive processPending* migrations and cast-payment re-prompts on reconnect.
 */
const REPLAY_TRANSIENT_PROMPT_STATE_KEYS = [
  'pendingScry',
  'pendingSurveil',
  'pendingCascade',
  'pendingProliferate',
  'pendingPonder',
  'pendingBottomOrder',
  'pendingLimDulsVault',
  'pendingDanceWithCalamity',
  'pendingSpellCasts',
  'pendingTargets',
  'pendingBlightAbilityActivations',
  'pendingTriggerOrdering',
  'pendingKynaiosChoice',
  'pendingCommanderZoneChoice',
  'pendingDiscardSelection',
  'pendingOpponentSelections',
  'pendingForetellCasts',
  'pendingDamageTriggers',
  'pendingLibrarySearch',
  'pendingModalChoice',
  'pendingMayAbility',
  'oracleIrPendingResumeStepsJson',
  'oracleIrPendingResumeControllerId',
  'oracleIrPendingResumeSourceId',
  'oracleIrPendingResumeSourceName',
] as const;

export function clearReplayTransientPromptState(state: any): void {
  if (!state || typeof state !== 'object') return;

  for (const key of REPLAY_TRANSIENT_PROMPT_STATE_KEYS) {
    try {
      delete state[key];
    } catch {
      // best-effort only
    }
  }

  delete state._priorityAfterResolution;
}

/**
 * After rebuilding game state from the event log, drop any UI prompts that were
 * re-created while replaying. Completed choices live in persisted events only.
 */
export function finalizeGameStateAfterReplay(ctx: GameContext): void {
  const gameId = String(ctx?.gameId || '').trim();
  if (!gameId) return;

  try {
    ResolutionQueueManager.endReplay(gameId);
    clearOptionalPaymentCallbacks(gameId);
  } catch {
    // best-effort only
  }

  try {
    clearReplayTransientPromptState(ctx.state as any);
  } catch {
    // best-effort only
  }

  try {
    if ((ctx.state as any)?.priority === null) {
      exitResolutionMode(ctx);
    }
  } catch {
    // best-effort only
  }
}
