import type { GameContext } from '../context.js';
import type { TriggerEffectLegacyBodyResult, TriggerLegacyTailResult } from './stackResolveSharedTypes.js';
import { recordOracleIrGapTelemetry, isOracleIrGapTelemetryLegacySoakEnabled } from './oracleIrGapTelemetry.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrTriggerExecution.js';

export function legacyBodyHandled(legacyHandler: string): TriggerEffectLegacyBodyResult {
  return { handled: true, legacyHandler };
}

export function legacyTailHandled(legacyHandler: string): TriggerLegacyTailResult {
  return { handled: true, legacyHandler };
}

export function legacyTailHandledWithoutHandler(): TriggerLegacyTailResult {
  return { handled: true };
}

export function legacyTailNotHandled(): TriggerLegacyTailResult {
  return { handled: false };
}

export type TriggerPrefaceResult =
  | { handled: true; legacyHandler: string }
  | { handled: false };

export function legacyPrefaceHandled(legacyHandler: string): TriggerPrefaceResult {
  return { handled: true, legacyHandler };
}

export function legacyPrefaceNotHandled(): TriggerPrefaceResult {
  return { handled: false };
}

/** Batch dispatch sites return the winning handler export name, or false. */
export type RetiredTriggerLegacyHandlerHit = string | false;

export function retiredLegacyHandlerHit(handlerName: string): string {
  return handlerName;
}

export function recordLegacyTriggerHandlerTelemetry(
  ctx: GameContext,
  sourceName: string,
  effectText: string,
  handlerFamily: string,
  legacyHandler?: string,
): void {
  if (!isOracleIrTriggerPrimaryEnabled() && !isOracleIrGapTelemetryLegacySoakEnabled()) return;
  const reasons = [`legacy_family:${handlerFamily}`];
  if (legacyHandler) {
    reasons.push(`legacy_handler:${legacyHandler}`);
  }
  recordOracleIrGapTelemetry({
    kind: 'legacy_handled',
    scope: 'trigger',
    label: sourceName,
    reasons,
    effectText,
    gameId: String((ctx as any)?.gameId || '') || undefined,
  });
}
