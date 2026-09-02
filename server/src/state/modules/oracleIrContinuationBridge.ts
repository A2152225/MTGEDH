/**
 * Shared definition of "IR leftover steps are actually owned."
 * Origin: persistUnqueuedPendingContinuationFromOracleIRResult and
 *   isOracleIrExecutionHandled treated any resolution-queue growth as a bridge.
 * As-enters replacements (shock pay-2-life, check-land reveal, Vesuva copy,
 *   Gate color, sacrifice-unless-pay) grow the queue but do not carry
 *   oracleIrResumeStepsJson / choice JSON, so leftover put/draw/remainder was
 *   dropped and all-or-nothing still reported handled.
 * Public: queuedStepOwnsOracleIrContinuation, isOracleIrContinuationBridged,
 *   isOracleIrBattlefieldEntryReplacementPrompt.
 */
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { hasPendingWarpWorldOracleIrPrompt } from './oracleIrServerZoneSync-handlers/oracleIrServerWarpWorldChoicePrompts.js';

export function hasPersistedOracleIrContinuation(state: unknown): boolean {
  return Boolean(String((state as any)?.oracleIrPendingResumeStepsJson || '').trim());
}

export function queuedStepOwnsOracleIrContinuation(step: unknown): boolean {
  const record = step as any;
  if (!record || typeof record !== 'object') return false;
  if (String(record.oracleIrWarpWorldChoice || '').trim()) return true;
  if (record.oracleIrUnlessPayChoice === true) return true;
  if (String(record.oracleIrChoiceStepJson || '').trim()) return true;
  if (String(record.oracleIrResumeStepsJson || '').trim()) return true;
  const continuation = record.metadata?.continuationSteps ?? record.continuationSteps;
  return Array.isArray(continuation) && continuation.length > 0;
}

export function isOracleIrBattlefieldEntryReplacementPrompt(step: unknown): boolean {
  const record = step as any;
  if (!record || typeof record !== 'object') return false;
  if (queuedStepOwnsOracleIrContinuation(record)) return false;
  if (record.shockLandChoice === true) return true;
  if (record.revealLandChoice === true) return true;
  if (record.sacrificeUnlessPayChoice === true) return true;
  if (record.asEntersCopyChoice === true) return true;
  if (!String(record.permanentId || '').trim()) return false;
  const type = String(record.type || '');
  return type === String(ResolutionStepType.COLOR_CHOICE)
    || type === String(ResolutionStepType.CREATURE_TYPE_CHOICE)
    || type === String(ResolutionStepType.BASIC_LAND_TYPE_CHOICE)
    || type === String(ResolutionStepType.PLAYER_CHOICE);
}

function pendingQueueSteps(gameId: string): any[] {
  const queue = ResolutionQueueManager.getQueue(gameId);
  return (queue?.steps || []).filter((step: any) => {
    const status = String(step?.status || '');
    return status !== 'completed' && status !== 'cancelled';
  });
}

export function hasQueuedOracleIrContinuationOwner(gameId: string): boolean {
  const id = String(gameId || '').trim();
  if (!id || id === 'unknown') return false;
  if (hasPendingWarpWorldOracleIrPrompt(id)) return true;
  return pendingQueueSteps(id).some((step: any) => queuedStepOwnsOracleIrContinuation(step));
}

function pendingStepsAreOnlyBattlefieldEntryReplacements(gameId: string): boolean {
  const id = String(gameId || '').trim();
  if (!id || id === 'unknown') return false;
  const pending = pendingQueueSteps(id);
  if (pending.length === 0) return false;
  return pending.every((step) => isOracleIrBattlefieldEntryReplacementPrompt(step));
}

/**
 * True when leftover IR steps are persisted, attached to a queued resume/choice
 * prompt, or the queue grew with a real IR halt (commander 903.9a, discard,
 * scry). Raw growth from as-enters replacements alone is not a bridge.
 */
export function isOracleIrContinuationBridged(options?: {
  readonly state?: unknown;
  readonly gameId?: string;
  readonly resolutionQueueStepsBefore?: number;
  readonly resolutionQueueStepsAfter?: number;
}): boolean {
  if (hasPersistedOracleIrContinuation(options?.state)) return true;
  const gameId = String(options?.gameId || '').trim();
  if (hasQueuedOracleIrContinuationOwner(gameId)) return true;
  const before = Number(options?.resolutionQueueStepsBefore ?? 0);
  const after = Number(options?.resolutionQueueStepsAfter ?? 0);
  if (!(after > before)) return false;
  if (pendingStepsAreOnlyBattlefieldEntryReplacements(gameId)) return false;
  return true;
}
