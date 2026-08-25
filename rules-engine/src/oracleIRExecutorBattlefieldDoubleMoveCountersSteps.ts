// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyDoubleCountersStep, applyMoveCountersStep.
// Public entries: applyDoubleCountersStep, applyMoveCountersStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { quantityToNumber } from './oracleIRExecutorPlayerUtils';
import {
  trySpecialDoubleCountersStep,
  trySpecialMoveCountersStep,
} from './oracleIRExecutorSpecialTargetHandlers';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

export function applyDoubleCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'double_counters' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialDoubleCountersStep(state, step, ctx);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const effectiveTarget = effectiveStepTarget(step);
  const targetTextLower = String((effectiveTarget as any)?.text || step.raw || '').trim().toLowerCase();
  if (/^each of them$/i.test(targetTextLower) || /^double the number of \+1\/\+1 counters on each of them$/i.test(String(step.raw || ''))) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const wantedIds = new Set([...contextualIds, ...antecedentIds]);
    const targets = battlefield.filter((perm: any) => wantedIds.has(String((perm as any)?.id || '').trim()));
    if (targets.length > 0) {
      const specificCounter = String(step.counter || '').trim();
      const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
      let doubledKinds = 0;
      let changedTargets = 0;
      const nextBattlefield = battlefield.map((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        if (!targetIds.has(permanentId)) return perm;
        const counters = { ...(((perm as any)?.counters || {}) as Record<string, number>) };
        let changedThisTarget = false;
        for (const [counterName, rawCount] of Object.entries(counters)) {
          if (specificCounter && counterName !== specificCounter) continue;
          const count = Number(rawCount);
          if (!Number.isFinite(count) || count <= 0) continue;
          counters[counterName] = count * 2;
          doubledKinds += 1;
          changedThisTarget = true;
        }
        if (!changedThisTarget) return perm;
        changedTargets += 1;
        return { ...perm, counters } as any;
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [
          doubledKinds > 0
            ? `Doubled counters on ${changedTargets} permanent(s)`
            : 'No counters to double on contextual permanents',
        ],
      };
    }
  }

  const targets = resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped double counters (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const specificCounter = String(step.counter || '').trim();
  const targetIds = new Set(targets.map((target: any) => String(target?.id || '').trim()).filter(Boolean));
  let doubledKinds = 0;
  let changedTargets = 0;

  for (let index = 0; index < battlefield.length; index += 1) {
    const target = battlefield[index] as any;
    const targetId = String(target?.id || '').trim();
    if (!targetIds.has(targetId)) continue;

    const counters = { ...((target?.counters || {}) as Record<string, number>) };
    let changedThisTarget = false;
    for (const [counterName, rawCount] of Object.entries(counters)) {
      if (specificCounter && counterName !== specificCounter) continue;
      const count = Number(rawCount);
      if (!Number.isFinite(count) || count <= 0) continue;
      counters[counterName] = count * 2;
      doubledKinds += 1;
      changedThisTarget = true;
    }

    if (changedThisTarget) {
      battlefield[index] = {
        ...target,
        counters,
      } as any;
      changedTargets += 1;
    }
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield,
    } as GameState,
    log: [
      doubledKinds > 0
        ? specificCounter
          ? `Doubled ${specificCounter} counter(s) on ${changedTargets} permanent(s)`
          : `Doubled ${doubledKinds} counter kind(s) across ${changedTargets} permanent(s)`
        : specificCounter
          ? `No ${specificCounter} counters to double on the resolved permanents`
          : `No counters to double on the resolved permanents`,
    ],
  };
}

export function applyMoveCountersStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_counters' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialMoveCountersStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const fromText =
    step.from?.kind === 'raw' ? normalizeBattlefieldTargetReferenceText(String(step.from.text || '')).toLowerCase() : '';
  const toText =
    step.to?.kind === 'raw' ? normalizeBattlefieldTargetReferenceText(String(step.to.text || '')).toLowerCase() : '';

  const transferCountersBetweenSnapshots = (
    fromCounters: Record<string, number>,
    toPermanentIndex: number,
    requestedCounter: string,
    amountIsAll: boolean,
    fixedAmount: number | null
  ): BattlefieldStepHandlerResult | null => {
    const toPermanent: any = battlefield[toPermanentIndex] || {};
    const toCounters: Record<string, number> = { ...((toPermanent.counters || {}) as Record<string, number>) };
    let moved = 0;
    for (const [counterName, rawCount] of Object.entries(fromCounters)) {
      if (requestedCounter && counterName !== requestedCounter) continue;
      const available = Math.max(0, Number(rawCount) || 0);
      if (available <= 0) continue;
      const moveCount = amountIsAll ? available : Math.min(available, Math.max(0, Number(fixedAmount) || 0));
      if (moveCount <= 0) continue;
      fromCounters[counterName] = available - moveCount;
      if (fromCounters[counterName] <= 0) delete fromCounters[counterName];
      toCounters[counterName] = Math.max(0, Number(toCounters[counterName]) || 0) + moveCount;
      moved += moveCount;
    }
    if (moved <= 0) {
      return { applied: true, state, log: ['No counters to move'] };
    }
    battlefield[toPermanentIndex] = { ...toPermanent, counters: toCounters };
    return {
      applied: true,
      state: { ...(state as any), battlefield } as GameState,
      log: [`Moved ${moved} counter(s) onto ${String(toPermanent?.name || toPermanent?.id || 'target')}`],
    };
  };

  if (fromText === 'it' && /^this (?:creature|permanent)$/.test(toText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const toIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === sourceId);
    const requestedCounter = String(step.counter || '').trim();
    const amountIsAll = (step.amount as any)?.kind === 'all';
    const fixedAmount = amountIsAll ? null : quantityToNumber(step.amount as any, ctx);

    if (toIndex >= 0) {
      const referencedId = String(
        ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ''
      ).trim();
      const onBattlefieldFromIndex = referencedId
        ? battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === referencedId)
        : -1;
      if (onBattlefieldFromIndex >= 0 && onBattlefieldFromIndex !== toIndex) {
        const fromCounters = {
          ...(((battlefield[onBattlefieldFromIndex] as any)?.counters || {}) as Record<string, number>),
        };
        const transferred = transferCountersBetweenSnapshots(
          fromCounters,
          toIndex,
          requestedCounter,
          amountIsAll,
          fixedAmount
        );
        if (transferred) {
          if (transferred.applied && transferred.state) {
            const nextBattlefield = [...(((transferred.state as any).battlefield || []) as any[])];
            nextBattlefield[onBattlefieldFromIndex] = {
              ...(nextBattlefield[onBattlefieldFromIndex] as any),
              counters: fromCounters,
            };
            return {
              ...transferred,
              state: { ...(transferred.state as any), battlefield: nextBattlefield } as GameState,
            };
          }
          return transferred;
        }
      } else {
        const sacrificed = [
          ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
          ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
        ];
        const snapshot = sacrificed.length === 1 ? sacrificed[0] : null;
        if (snapshot) {
          const fromCounters = { ...(((snapshot as any)?.counters || {}) as Record<string, number>) };
          const transferred = transferCountersBetweenSnapshots(
            fromCounters,
            toIndex,
            requestedCounter,
            amountIsAll,
            fixedAmount
          );
          if (transferred) return transferred;
        }
      }
    }
  }

  const fromTargets = resolveDirectBattlefieldPermanents(battlefield, step.from as any, ctx);
  const toTargets = resolveDirectBattlefieldPermanents(battlefield, step.to as any, ctx);

  if (fromTargets.length !== 1 || toTargets.length !== 1) {
    return {
      applied: false,
      message: `Skipped move counters (needs deterministic source and destination): ${step.raw}`,
      reason: fromTargets.length > 1 || toTargets.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
      options: fromTargets.length > 1 || toTargets.length > 1 ? { classification: 'player_choice' } : undefined,
    };
  }

  const fromId = String((fromTargets[0] as any)?.id || '').trim();
  const toId = String((toTargets[0] as any)?.id || '').trim();
  if (!fromId || !toId || fromId === toId) {
    return {
      applied: false,
      message: `Skipped move counters (invalid source or destination): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const fromIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === fromId);
  const toIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === toId);
  if (fromIndex < 0 || toIndex < 0) {
    return {
      applied: false,
      message: `Skipped move counters (source or destination left battlefield): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const fromPermanent: any = battlefield[fromIndex] || {};
  const toPermanent: any = battlefield[toIndex] || {};
  const fromCounters: Record<string, number> = { ...((fromPermanent.counters || {}) as Record<string, number>) };
  const toCounters: Record<string, number> = { ...((toPermanent.counters || {}) as Record<string, number>) };
  const requestedCounter = String(step.counter || '').trim();
  const amountIsAll = (step.amount as any)?.kind === 'all';
  const fixedAmount = amountIsAll ? null : quantityToNumber(step.amount as any, ctx);

  if (!amountIsAll && (!Number.isFinite(Number(fixedAmount)) || Number(fixedAmount) <= 0)) {
    return {
      applied: false,
      message: `Skipped move counters (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  let moved = 0;
  for (const [counterName, rawCount] of Object.entries(fromCounters)) {
    if (requestedCounter && counterName !== requestedCounter) continue;
    const available = Math.max(0, Number(rawCount) || 0);
    if (available <= 0) continue;
    const moveCount = amountIsAll ? available : Math.min(available, Math.max(0, Number(fixedAmount) || 0));
    if (moveCount <= 0) continue;
    fromCounters[counterName] = available - moveCount;
    if (fromCounters[counterName] <= 0) delete fromCounters[counterName];
    toCounters[counterName] = Math.max(0, Number(toCounters[counterName]) || 0) + moveCount;
    moved += moveCount;
  }

  if (moved <= 0) {
    return {
      applied: true,
      state,
      log: [`No counters moved`],
    };
  }

  battlefield[fromIndex] = { ...fromPermanent, counters: fromCounters } as any;
  battlefield[toIndex] = { ...toPermanent, counters: toCounters } as any;

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [`Moved ${moved} counter(s)`],
  };
}

