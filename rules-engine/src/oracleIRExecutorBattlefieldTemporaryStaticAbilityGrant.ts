// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: registerTemporaryStaticAbilityGrant.
// Public entry: registerTemporaryStaticAbilityGrant.

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

export function registerTemporaryStaticAbilityGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }>,
  ctx: OracleIRExecutionContext,
  options?: {
    readonly targetPlayerId?: string;
    readonly targetPermanentId?: string;
    readonly duration?: 'end_of_turn' | 'until_next_turn';
  }
): BattlefieldStepHandlerResult {
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
    ? [...(state as any).staticAbilityGrantEffects]
    : [];
  const duration = options?.duration || (step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn');
  const staticGrantEffect = {
    id: `${sourceId || sourceName || 'oracle'}:temp-static-grant:${existingStaticGrantEffects.length + 1}`,
    sourceId: sourceId || undefined,
    sourceName: sourceName || undefined,
    controllerId: String(ctx.controllerId || '').trim() || undefined,
    ...(options?.targetPlayerId ? { targetPlayerId: options.targetPlayerId } : {}),
    ...(options?.targetPermanentId ? { targetPermanentId: options.targetPermanentId } : {}),
    target: step.target,
    abilities: Array.isArray(step.abilities) ? [...step.abilities] : [],
    effectText: Array.isArray(step.effectText) ? [...step.effectText] : [],
    duration,
    raw: step.raw,
  };
  const duplicateStaticGrant = existingStaticGrantEffects.some((entry: any) =>
    String(entry?.sourceId || '').trim() === String(staticGrantEffect.sourceId || '').trim() &&
    String(entry?.raw || '').trim() === String(step.raw || '').trim()
  );
  return {
    applied: true,
    state: {
      ...(state as any),
      staticAbilityGrantEffects: duplicateStaticGrant
        ? existingStaticGrantEffects
        : [...existingStaticGrantEffects, staticGrantEffect],
    } as GameState,
    log: [`Registered temporary static ability grant: ${step.raw}`],
  };
}

