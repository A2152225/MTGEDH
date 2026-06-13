import type { GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIRPendingTransition } from './oracleIRTransitionTypes';
import { buildEffectBridgeOptions } from './oracleIRExecutorDamageTransitionCommit';
import { buildCounterPlacementTransition } from './oracleIRExecutorEffectTransitionBuilders';
import { applyCounterModifications } from '../../server/src/state/modules/counters_tokens.js';

function resolveEffectiveCounterDeltas(
  transition: OracleIRPendingTransition,
  fallback: Readonly<Record<string, number>>,
): Record<string, number> {
  const replacement = (transition.event.metadata as any)?.replacement;
  const fromReplacement = replacement?.metadata?.modifiedDeltas;
  if (fromReplacement && typeof fromReplacement === 'object') {
    return { ...fromReplacement };
  }
  const fromEvent = transition.event.deltas;
  if (fromEvent && typeof fromEvent === 'object') {
    return { ...fromEvent };
  }
  return { ...fallback };
}

function applyCounterDeltasToPermanent(
  state: GameState,
  permanentId: string,
  deltas: Readonly<Record<string, number>>,
): GameState {
  const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    if (String(perm?.id || '').trim() !== permanentId) return perm;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    for (const [counterName, deltaRaw] of Object.entries(deltas)) {
      const delta = Math.floor(Number(deltaRaw) || 0);
      if (!delta) continue;
      const nextCount = (Number(counters[counterName] ?? 0) || 0) + delta;
      if (nextCount <= 0) delete counters[counterName];
      else counters[counterName] = nextCount;
    }
    return { ...perm, counters };
  });
  return { ...(state as any), battlefield: nextBattlefield } as GameState;
}

export function commitCounterPlacement(args: {
  state: GameState;
  targetPermanentId: string;
  targetPermanent: unknown;
  deltas: Readonly<Record<string, number>>;
  stepIndex: number;
  stepKind: string;
  cause: string;
  ctx?: OracleIRExecutionContext;
}): {
  state: GameState;
  halted: boolean;
  effectiveDeltas: Record<string, number>;
  ledgerRecordedViaBridge: boolean;
} {
  const bridge = args.ctx?.serverBridge;
  if (!bridge || !Number.isFinite(args.stepIndex)) {
    return {
      state: applyCounterDeltasToPermanent(args.state, args.targetPermanentId, args.deltas),
      halted: false,
      effectiveDeltas: { ...args.deltas },
      ledgerRecordedViaBridge: false,
    };
  }

  const modifiedDeltas = applyCounterModifications(
    args.state,
    args.targetPermanentId,
    { ...args.deltas },
  );

  const transition = buildCounterPlacementTransition({
    targetPermanentId: args.targetPermanentId,
    targetPermanent: args.targetPermanent,
    deltas: args.deltas,
    modifiedDeltas,
    stepIndex: args.stepIndex,
    stepKind: args.stepKind,
    cause: args.cause,
    ctx: args.ctx,
  });

  const bridgeResult = bridge.proposeTransitions([transition]);
  if (bridgeResult.halt) {
    if (args.ctx?.transitionHaltState) {
      args.ctx.transitionHaltState.halted = true;
      args.ctx.transitionHaltState.deferred = [...(bridgeResult.deferred || [])];
    }
    return {
      state: args.state,
      halted: true,
      effectiveDeltas: {},
      ledgerRecordedViaBridge: false,
    };
  }

  const ready = bridgeResult.ready?.[0] ?? transition;
  const effectiveDeltas = resolveEffectiveCounterDeltas(ready, modifiedDeltas);
  return {
    state: applyCounterDeltasToPermanent(args.state, args.targetPermanentId, effectiveDeltas),
    halted: false,
    effectiveDeltas,
    ledgerRecordedViaBridge: true,
  };
}

export function applyCounterDeltasToBattlefieldTargets(
  state: GameState,
  targetIds: readonly string[],
  counterName: string,
  amount: number,
  ctx: OracleIRExecutionContext,
  stepKind = 'add_counter',
): {
  state: GameState;
  log: string[];
  halted?: boolean;
  skipLedgerFlush?: boolean;
} {
  const bridgeOptions = buildEffectBridgeOptions(ctx, stepKind);
  let nextState = state;
  const logs: string[] = [];
  let halted = false;
  let ledgerRecorded = false;

  for (const targetId of targetIds) {
    const permanent = (nextState.battlefield || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetId,
    );
    if (!permanent) continue;

    const deltas = { [counterName]: amount };
    if (bridgeOptions) {
      const result = commitCounterPlacement({
        state: nextState,
        targetPermanentId: targetId,
        targetPermanent: permanent,
        deltas,
        stepIndex: Number(bridgeOptions.stepIndex),
        stepKind,
        cause: 'oracle_ir:add_counter',
        ctx: bridgeOptions.ctx,
      });
      if (result.halted) {
        return { state: nextState, log: logs, halted: true };
      }
      nextState = result.state;
      ledgerRecorded = ledgerRecorded || result.ledgerRecordedViaBridge;
    } else {
      nextState = applyCounterDeltasToPermanent(nextState, targetId, deltas);
    }
  }

  if (targetIds.length > 0) {
    logs.push(`Added ${amount} ${counterName} counter(s) to ${targetIds.length} permanent(s)`);
  }

  return {
    state: nextState,
    log: logs,
    ...(halted ? { halted: true } : {}),
    ...(ledgerRecorded ? { skipLedgerFlush: true } : {}),
  };
}
