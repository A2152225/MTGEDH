/**
 * Server re-export of the shared hook-failure tripwire.
 * Prefer this path from server tests and socket/state modules under server/src.
 * Rules-engine leaf hooks import the shared module directly so they stay free
 * of a server dependency; both resolve to the same ring buffer.
 */
export {
  STRICT_HOOKS_ENV,
  formatHookFailuresForAssert,
  getHookFailureCounts,
  getHookFailures,
  isStrictHooksEnabled,
  reportHookFailure,
  resetHookFailures,
} from '../../../shared/src/hookFailureReporter.js';
export type { HookFailure, HookFailureContext } from '../../../shared/src/hookFailureReporter.js';
