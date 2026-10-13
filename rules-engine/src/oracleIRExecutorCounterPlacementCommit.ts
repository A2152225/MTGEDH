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

/**
 * Cheap scan: skip full overlay/replacement evaluation when the board clearly has
 * no Doubling Season / Hardened Scales / Vorinclex-style counter modifiers.
 * Full evaluation scans compiled overlays for every permanent and locks huge boards.
 */
function battlefieldLikelyHasCounterModifiers(state: GameState): boolean {
  const battlefield = (state.battlefield || []) as any[];
  for (const perm of battlefield) {
    if (!perm?.card || perm?.phasedOut === true) continue;
    const name = String(perm.card?.name || perm.name || '').toLowerCase();
    if (
      name.includes('doubling season')
      || name.includes('hardened scales')
      || name.includes('branching evolution')
      || name.includes('primal vigor')
      || (name.includes('vorinclex') && name.includes('monstrous'))
      || name.includes('corpsejack menace')
      || name.includes('pir, imaginative rascal')
      || name.includes('and they shall know no fear')
    ) {
      return true;
    }
    const oracle = String(perm.card?.oracle_text || '').toLowerCase();
    if (!oracle) continue;
    if (
      (oracle.includes('twice that many') && oracle.includes('counter'))
      || (oracle.includes('that many plus one') && oracle.includes('+1/+1'))
      || (oracle.includes('double that amount') && oracle.includes('+1/+1'))
      || (oracle.includes('put twice that many') && oracle.includes('counter'))
    ) {
      return true;
    }
  }
  return false;
}

/** Single-pass battlefield update for many counter placements (avoids O(n²) map copies). */
function applyCounterDeltasToManyPermanents(
  state: GameState,
  placements: ReadonlyArray<readonly [string, Readonly<Record<string, number>>]>,
): GameState {
  if (placements.length === 0) return state;

  const deltasById = new Map<string, Record<string, number>>();
  for (const [permanentId, deltas] of placements) {
    const id = String(permanentId || '').trim();
    if (!id) continue;
    const existing = deltasById.get(id) || {};
    const merged = { ...existing };
    for (const [counterName, deltaRaw] of Object.entries(deltas)) {
      const delta = Math.floor(Number(deltaRaw) || 0);
      if (!delta) continue;
      merged[counterName] = (Number(merged[counterName] ?? 0) || 0) + delta;
    }
    deltasById.set(id, merged);
  }
  if (deltasById.size === 0) return state;

  const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    const id = String(perm?.id || '').trim();
    const deltas = deltasById.get(id);
    if (!deltas) return perm;
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

function applyCounterDeltasToPermanent(
  state: GameState,
  permanentId: string,
  deltas: Readonly<Record<string, number>>,
): GameState {
  return applyCounterDeltasToManyPermanents(state, [[permanentId, deltas]]);
}

/**
 * Resolve effective counter deltas via the server bridge without mutating battlefield.
 * Returns halted if a replacement needs a player choice.
 */
function resolveCounterPlacementDeltas(args: {
  state: GameState;
  targetPermanentId: string;
  targetPermanent: unknown;
  deltas: Readonly<Record<string, number>>;
  stepIndex: number;
  stepKind: string;
  cause: string;
  ctx?: OracleIRExecutionContext;
}): {
  halted: boolean;
  effectiveDeltas: Record<string, number>;
  ledgerRecordedViaBridge: boolean;
} {
  const bridge = args.ctx?.serverBridge;
  if (!bridge || !Number.isFinite(args.stepIndex)) {
    return {
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
  args.ctx?.counterModifiersAppliedTo?.add(String(args.targetPermanentId));

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
      halted: true,
      effectiveDeltas: {},
      ledgerRecordedViaBridge: false,
    };
  }

  const ready = bridgeResult.ready?.[0] ?? transition;
  return {
    halted: false,
    effectiveDeltas: resolveEffectiveCounterDeltas(ready, modifiedDeltas),
    ledgerRecordedViaBridge: true,
  };
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
  const resolved = resolveCounterPlacementDeltas(args);
  if (resolved.halted) {
    return {
      state: args.state,
      halted: true,
      effectiveDeltas: {},
      ledgerRecordedViaBridge: false,
    };
  }
  return {
    state: applyCounterDeltasToPermanent(args.state, args.targetPermanentId, resolved.effectiveDeltas),
    halted: false,
    effectiveDeltas: resolved.effectiveDeltas,
    ledgerRecordedViaBridge: resolved.ledgerRecordedViaBridge,
  };
}

/**
 * Bulk counter placement for "each creature you control"-style effects.
 *
 * Replacement evaluation (Doubling Season / Hardened Scales / overlays) is expensive
 * per permanent. For large boards we evaluate once on a sample target and apply that
 * delta to all targets — controller-scoped modifiers produce the same result for each
 * creature you control. Single-target callers still use commitCounterPlacement.
 */
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
  const logs: string[] = [];
  const uniqueTargetIds = Array.from(
    new Set(targetIds.map((id) => String(id || '').trim()).filter(Boolean)),
  );

  if (uniqueTargetIds.length === 0) {
    return { state, log: logs };
  }

  const permanentById = new Map<string, any>();
  for (const perm of (state.battlefield || []) as any[]) {
    const id = String(perm?.id || '').trim();
    if (id) permanentById.set(id, perm);
  }

  const baseDeltas = { [counterName]: amount };
  const resolvedTargets: Array<{ id: string; permanent: any }> = [];
  for (const targetId of uniqueTargetIds) {
    const permanent = permanentById.get(targetId);
    if (!permanent) continue;
    resolvedTargets.push({ id: targetId, permanent });
  }

  if (resolvedTargets.length === 0) {
    return { state, log: logs };
  }

  // Fast path: no bridge → single battlefield map.
  if (!bridgeOptions) {
    const placements = resolvedTargets.map(
      (entry) => [entry.id, baseDeltas] as const,
    );
    const nextState = applyCounterDeltasToManyPermanents(state, placements);
    logs.push(`Added ${amount} ${counterName} counter(s) to ${placements.length} permanent(s)`);
    return { state: nextState, log: logs };
  }

  // Fast path for huge boards with no counter-modifying permanents: skip the
  // overlay scan (O(battlefield) × compiled overlays) that otherwise takes
  // hundreds of ms even for a single sample target (Elspeth 0 with 300+ tokens).
  if (resolvedTargets.length > 1 && !battlefieldLikelyHasCounterModifiers(state)) {
    const placements = resolvedTargets.map(
      (entry) => [entry.id, baseDeltas] as const,
    );
    const nextState = applyCounterDeltasToManyPermanents(state, placements);
    logs.push(`Added ${amount} ${counterName} counter(s) to ${placements.length} permanent(s)`);
    return { state: nextState, log: logs };
  }

  // Bulk path: evaluate replacements once on the first target, then apply that
  // effective delta to every target. Avoids O(n) × expensive replacement scans
  // that lock the game when putting counters on hundreds of tokens (Elspeth 0).
  // Controller-scoped modifiers (Doubling Season, Hardened Scales) yield the same
  // effective delta for each creature you control.
  if (resolvedTargets.length > 1) {
    // One evaluation per distinct (controller, type line, token) class: modifiers such as
    // Branching Evolution / Corpsejack Menace (creatures only) or "nontoken" wording give
    // different results across a mixed target set, so a single sample is not enough.
    const byClass = new Map<string, Record<string, number>>();
    const placements: Array<readonly [string, Record<string, number>]> = [];
    let ledgerRecordedViaBridge = false;
    for (const entry of resolvedTargets) {
      const p = entry.permanent || {};
      const classKey = `${p.controller}|${String(p.card?.type_line || p.type_line || '').toLowerCase()}|${p.isToken === true ? 1 : 0}`;
      let effective = byClass.get(classKey);
      if (!effective) {
        const resolved = resolveCounterPlacementDeltas({
          state,
          targetPermanentId: entry.id,
          targetPermanent: entry.permanent,
          deltas: baseDeltas,
          stepIndex: Number(bridgeOptions.stepIndex),
          stepKind,
          cause: 'oracle_ir:add_counter',
          ctx: bridgeOptions.ctx,
        });
        if (resolved.halted) {
          return { state, log: logs, halted: true };
        }
        effective = resolved.effectiveDeltas;
        ledgerRecordedViaBridge = ledgerRecordedViaBridge || resolved.ledgerRecordedViaBridge;
        byClass.set(classKey, effective);
      }
      bridgeOptions.ctx?.counterModifiersAppliedTo?.add(entry.id);
      placements.push([entry.id, effective] as const);
    }
    const resolved = { ledgerRecordedViaBridge };
    const nextState = applyCounterDeltasToManyPermanents(state, placements);
    logs.push(`Added ${amount} ${counterName} counter(s) to ${placements.length} permanent(s)`);
    return {
      state: nextState,
      log: logs,
      // Sample transition already recorded a ledger snapshot when bridge ran.
      ...(resolved.ledgerRecordedViaBridge ? { skipLedgerFlush: true } : {}),
    };
  }

  // Single-target path (unchanged semantics).
  const only = resolvedTargets[0];
  const resolved = resolveCounterPlacementDeltas({
    state,
    targetPermanentId: only.id,
    targetPermanent: only.permanent,
    deltas: baseDeltas,
    stepIndex: Number(bridgeOptions.stepIndex),
    stepKind,
    cause: 'oracle_ir:add_counter',
    ctx: bridgeOptions.ctx,
  });

  if (resolved.halted) {
    return { state, log: logs, halted: true };
  }

  const nextState = applyCounterDeltasToManyPermanents(state, [[only.id, resolved.effectiveDeltas]]);
  logs.push(`Added ${amount} ${counterName} counter(s) to 1 permanent(s)`);
  return {
    state: nextState,
    log: logs,
    ...(resolved.ledgerRecordedViaBridge ? { skipLedgerFlush: true } : {}),
  };
}
