/**
 * Origin parent: rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts
 * Cluster: applyGrantTemporaryEtbTriggerStep — delayed this-turn ETB windows
 *   (Rite of Harmony family).
 * Public: applyGrantTemporaryEtbTriggerStep
 * Leaf must not import oracleIRExecutor.ts or oracleIRExecutorBattlefieldStepHandlers.ts.
 */

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

export function applyGrantTemporaryEtbTriggerStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_etb_trigger' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  if (!controllerId) {
    return {
      applied: false,
      message: `Skipped temporary ETB window (no controller): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const watchTypes = (Array.isArray(step.watchTypes) ? step.watchTypes : [])
    .map((typeWord) => String(typeWord || '').trim().toLowerCase())
    .filter(Boolean);
  if (watchTypes.length === 0) {
    return {
      applied: false,
      message: `Skipped temporary ETB window (no watch types): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const effect = String(step.effect || '').replace(/[.]+$/g, '').trim() || 'draw a card';
  const sourceName = String(ctx.sourceName || 'spell').trim() || 'spell';
  const sourceId = String(ctx.sourceId || sourceName || 'temporary_etb').trim();
  const existing = Array.isArray((state as any).temporaryEtbTriggers)
    ? ([...(state as any).temporaryEtbTriggers] as any[])
    : [];

  const alreadyPresent = existing.some((entry) => {
    const entryTypes = Array.isArray(entry?.watchTypes)
      ? entry.watchTypes.map((typeWord: unknown) => String(typeWord || '').trim().toLowerCase()).filter(Boolean)
      : [];
    return String(entry?.controller || '') === String(controllerId)
      && String(entry?.sourceName || '') === sourceName
      && entryTypes.join('|') === watchTypes.join('|')
      && String(entry?.effect || entry?.description || '').replace(/[.]+$/g, '').trim() === effect;
  });
  if (alreadyPresent) {
    return {
      applied: true,
      state,
      log: [`Temporary ETB window already present for ${sourceName}`],
    };
  }

  const entry = {
    id: `${sourceId}:temporary_etb:${watchTypes.join('_')}`,
    controller: String(controllerId),
    sourceId,
    sourceName,
    description: effect,
    effect,
    watchTypes,
    triggerType: 'temporary_etb',
    mandatory: true,
    expiresAt: 'end_of_turn',
    ...(step.nontokenOnly === true ? { nontokenOnly: true } : {}),
  };

  return {
    applied: true,
    state: {
      ...(state as any),
      temporaryEtbTriggers: [...existing, entry],
    } as GameState,
    log: [`Granted temporary ${watchTypes.join('/')} ETB window (${effect}) until end of turn`],
  };
}
