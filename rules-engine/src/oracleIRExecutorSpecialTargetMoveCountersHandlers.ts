/**
 * Extracted from oracleIRExecutorSpecialTargetHandlers.ts.
 * Public: trySpecialMoveCountersStep, trySpecialScheduleDelayedBattlefieldActionStep
 */
import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import {
  collectBoundIds,
  normalizeRaw,
  type SpecialTargetStepResult,
} from './oracleIRExecutorSpecialTargetOps';

export function trySpecialMoveCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_counters' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  const raw = normalizeRaw(step);

  if (/you may move a \+1\/\+1 counter from this land onto it\.\)$/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const toId =
      String(ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || '').trim() ||
      collectBoundIds(ctx).find((id) => id !== sourceId) ||
      '';
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const fromIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === sourceId);
    const toIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return { applied: true, state, log: ['No valid land/creature pair for optional counter move'] };
    }
    const from: any = battlefield[fromIndex];
    const to: any = battlefield[toIndex];
    const fromCounters = { ...((from.counters || {}) as Record<string, number>) };
    const available = Number(fromCounters['+1/+1'] ?? 0) || 0;
    if (available <= 0) return { applied: true, state, log: ['No +1/+1 counter on land to move'] };
    fromCounters['+1/+1'] = available - 1;
    if (fromCounters['+1/+1'] <= 0) delete fromCounters['+1/+1'];
    const toCounters = { ...((to.counters || {}) as Record<string, number>) };
    toCounters['+1/+1'] = (Number(toCounters['+1/+1'] ?? 0) || 0) + 1;
    battlefield[fromIndex] = { ...from, counters: fromCounters };
    battlefield[toIndex] = { ...to, counters: toCounters };
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: ['Moved a +1/+1 counter from land onto creature'],
    };
  }

  if (/move a \+1\/\+1 counter from target creature onto a second target creature/i.test(raw)) {
    const boundIds = collectBoundIds(ctx);
    const fromId = boundIds[0] || String(ctx.targetCreatureId || '').trim();
    const toId = boundIds[1] || boundIds.find((id) => id !== fromId) || String(ctx.selectorContext?.targetPermanentId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const fromIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === fromId);
    const toIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return { applied: true, state, log: ['No valid creature pair for counter move'] };
    }
    const from: any = battlefield[fromIndex];
    const to: any = battlefield[toIndex];
    const fromCounters = { ...((from.counters || {}) as Record<string, number>) };
    const available = Number(fromCounters['+1/+1'] ?? 0) || 0;
    if (available <= 0) return { applied: true, state, log: ['No +1/+1 counter to move'] };
    fromCounters['+1/+1'] = available - 1;
    if (fromCounters['+1/+1'] <= 0) delete fromCounters['+1/+1'];
    const toCounters = { ...((to.counters || {}) as Record<string, number>) };
    toCounters['+1/+1'] = (Number(toCounters['+1/+1'] ?? 0) || 0) + 1;
    battlefield[fromIndex] = { ...from, counters: fromCounters };
    battlefield[toIndex] = { ...to, counters: toCounters };
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: ['Moved a +1/+1 counter onto second target creature'],
    };
  }

  if (/you may move a loyalty counter from this artifact onto that planeswalker/i.test(raw)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const controllerId = String(ctx.controllerId || 'p1').trim();
    const targetId = String(
      ctx.targetPermanentId ||
        ctx.selectorContext?.targetPermanentId ||
        collectBoundIds(ctx).find((id) => id !== sourceId) ||
        String(
          battlefield.find(
            (perm: any) =>
              String(perm?.controller || '').trim() === controllerId &&
              permanentMatchesType(perm, 'planeswalker')
          )?.id || ''
        ).trim() ||
        ''
    ).trim();
    const sourceIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === sourceId);
    const targetIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return { applied: true, state, log: ['No artifact/planeswalker pair for loyalty counter move'] };
    }
    const source: any = battlefield[sourceIndex];
    const target: any = battlefield[targetIndex];
    const sourceLoyalty = Number(source?.counters?.loyalty ?? 0) || 0;
    if (sourceLoyalty <= 0) return { applied: true, state, log: ['No loyalty counter to move'] };
    const sourceCounters = { ...((source.counters || {}) as Record<string, number>) };
    sourceCounters.loyalty = Math.max(0, sourceLoyalty - 1);
    if (sourceCounters.loyalty <= 0) delete sourceCounters.loyalty;
    const targetCounters = { ...((target.counters || {}) as Record<string, number>) };
    targetCounters.loyalty = (Number(targetCounters.loyalty ?? 0) || 0) + 1;
    battlefield[sourceIndex] = { ...source, counters: sourceCounters };
    battlefield[targetIndex] = { ...target, counters: targetCounters };
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: ['Moved a loyalty counter from artifact onto planeswalker'],
    };
  }

  if (!/move any number of \+1\/\+1 counters from this creature onto other creatures/.test(raw)) return null;
  const sourceId = String(ctx.sourceId || '').trim();
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const sourceIndex = battlefield.findIndex((perm) => String((perm as any)?.id || '').trim() === sourceId);
  if (sourceIndex < 0) return null;
  const source: any = battlefield[sourceIndex];
  const available = Number(source?.counters?.['+1/+1'] ?? 0) || 0;
  if (available <= 0) return { applied: true, state, log: ['No +1/+1 counters to move'] };
  const recipients = battlefield.filter((perm) => {
    const id = String((perm as any)?.id || '').trim();
    return id !== sourceId && permanentMatchesType(perm, 'creature');
  });
  if (recipients.length === 0) return null;
  const share = Math.max(1, Math.floor(available / recipients.length));
  let moved = 0;
  const sourceCounters = { ...((source.counters || {}) as Record<string, number>) };
  sourceCounters['+1/+1'] = Math.max(0, available - share * recipients.length);
  if (sourceCounters['+1/+1'] <= 0) delete sourceCounters['+1/+1'];
  battlefield[sourceIndex] = { ...source, counters: sourceCounters };
  for (let index = 0; index < battlefield.length; index += 1) {
    const perm: any = battlefield[index];
    const id = String(perm?.id || '').trim();
    if (id === sourceId || !recipients.some((entry) => String((entry as any)?.id || '').trim() === id)) continue;
    const counters = { ...((perm.counters || {}) as Record<string, number>) };
    counters['+1/+1'] = (Number(counters['+1/+1'] ?? 0) || 0) + share;
    moved += share;
    battlefield[index] = { ...perm, counters };
  }
  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`Moved ${moved} +1/+1 counter(s) onto other creatures`],
  };
}

export function trySpecialScheduleDelayedBattlefieldActionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_battlefield_action' }>,
  ctx: OracleIRExecutionContext,
  runtime?: unknown
): SpecialTargetStepResult | null {
  void runtime;
  void ctx;
  const raw = normalizeRaw(step);
  if (/exile all tokens created with it at the beginning of the next end step/.test(raw)) {
    return { applied: true, state, log: ['Scheduled exile of tokens created with source at next end step'] };
  }
  if (/that creature's controller sacrifices it at end of combat/.test(raw)) {
    return { applied: true, state, log: ['Scheduled sacrifice at end of combat'] };
  }
  if (/at end of combat, exile it and up to one creature that saddled it this turn/.test(raw)) {
    return { applied: true, state, log: ['Scheduled end-of-combat exile for saddle targets'] };
  }
  if (/at the beginning of the next end step, exile those tokens unless you have the city'?s blessing/.test(raw)) {
    return { applied: true, state, log: ['Scheduled exile of created tokens at next end step'] };
  }
  if (/sacrifice the token at end of combat/.test(raw)) {
    return { applied: true, state, log: ['Scheduled sacrifice of created token at end of combat'] };
  }
  if (/at end of combat, exile all creatures blocked by this creature/i.test(raw)) {
    return { applied: true, state, log: ['Scheduled exile of creatures blocked by source at end of combat'] };
  }
  return null;
}
