// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyScheduleDelayedTriggerStep.
// Public entry: applyScheduleDelayedTriggerStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  createWhenDealtDamageThisTurnTrigger,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';

export function applyScheduleDelayedTriggerStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>,
  ctx: OracleIRExecutionContext,
  runtime?: { readonly lastMovedBattlefieldPermanentIds?: readonly string[] }
): BattlefieldStepHandlerResult {
  const raw = `${String(step.raw || '')} ${String(step.effect || '')}`.trim();
  const isReflexiveWhenYouDo = /^when you do(?: so)?\b/i.test(String(step.raw || '').trim())
    || /^when you do(?: so)?\b/i.test(String(step.effect || '').trim())
    || /\bwhen you do(?: so)?,/i.test(raw);
  // Reflexive "When you do" fires immediately after the antecedent (CR 603.12).
  // The server queues it as a stack trigger; do not wait for the next end step.
  if (isReflexiveWhenYouDo && step.timing === 'on_event') {
    return {
      applied: true,
      state,
      log: ['Queued reflexive when-you-do trigger'],
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const targetPermanentId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim() || undefined;
  const baseChosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds
        .map((id: unknown) => String(id || '').trim())
        .filter(Boolean)
    : undefined;
  const recentBattlefieldIds = Array.isArray(runtime?.lastMovedBattlefieldPermanentIds)
    ? runtime?.lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const chosenObjectIds = (() => {
    const merged = [...(baseChosenObjectIds || []), ...recentBattlefieldIds];
    return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
  })();
  const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || '').trim() || undefined;
  const targetOpponentId = String(ctx.selectorContext?.targetOpponentId || '').trim() || undefined;

  if (step.timing === 'when_dealt_damage') {
    const watchingPermanentId =
      targetPermanentId
      || (Array.isArray(chosenObjectIds) && chosenObjectIds.length > 0 ? chosenObjectIds[0] : '');
    if (!watchingPermanentId) {
      return {
        applied: false,
        message: `Skipped dealt-damage delayed trigger (no watched permanent): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const delayedTrigger = createWhenDealtDamageThisTurnTrigger(
      String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
      String(ctx.sourceName || 'Delayed dealt-damage trigger'),
      controllerId,
      watchingPermanentId,
      step.effect,
      currentTurn,
      {
        targets: [watchingPermanentId],
        eventDataSnapshot: {
          sourceId: String(ctx.sourceId || '').trim() || undefined,
          sourceControllerId: String(controllerId || '').trim() || undefined,
          targetPermanentId: watchingPermanentId,
          chosenObjectIds: [watchingPermanentId],
          targetPlayerId,
          targetOpponentId,
        },
      }
    );

    const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
    const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
    return {
      applied: true,
      state: {
        ...(state as any),
        delayedTriggerRegistry: nextRegistry,
      } as GameState,
      log: [`Scheduled repeating dealt-damage watcher on ${watchingPermanentId}`],
    };
  }

  const timing =
    step.timing === 'your_next_end_step'
      ? DelayedTriggerTiming.YOUR_NEXT_END_STEP
      : step.timing === 'next_upkeep'
        ? DelayedTriggerTiming.NEXT_UPKEEP
        : step.timing === 'your_next_upkeep'
          ? DelayedTriggerTiming.YOUR_NEXT_UPKEEP
          : DelayedTriggerTiming.NEXT_END_STEP;

  const delayedTrigger = createDelayedTrigger(
    String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
    String(ctx.sourceName || 'Delayed trigger'),
    controllerId,
    timing,
    step.effect,
    currentTurn,
    {
      ...(Array.isArray(chosenObjectIds) && chosenObjectIds.length > 0 ? { targets: [...chosenObjectIds] } : {}),
      eventDataSnapshot: {
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceControllerId: String(controllerId || '').trim() || undefined,
        targetPermanentId,
        chosenObjectIds,
        targetPlayerId,
        targetOpponentId,
      },
    }
  );

  const registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const nextRegistry = registerDelayedTrigger(registry, delayedTrigger);
  return {
    applied: true,
    state: {
      ...(state as any),
      delayedTriggerRegistry: nextRegistry,
    } as GameState,
    log: [`Scheduled delayed trigger for ${timing.replace(/_/g, ' ')}`],
  };
}

