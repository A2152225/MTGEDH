// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerMillCounterPreparedSync.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: mill replacement, counter replacement, and prepared-copy
//   sync after Oracle IR battlefield controller/counter changes.
// Public entry symbols: snapshotBattlefieldControllers, snapshotBattlefieldCounters,
//   syncCounterReplacementEffectsAfterOracleIR,
//   syncPreparedCopiesAfterBattlefieldControllerChanges,
//   syncPreparedCopiesFromControlChangeEffects,
//   normalizeOracleIrControlChangeEffectsForServer, applyMillReplacementEffectsToSteps.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API
// except applyMillReplacementEffectsToSteps.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionContext } from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveOracleQuantity } from '../../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import type { GameContext } from '../../context.js';
import { syncPreparedPermanentAfterControlChange } from '../prepared.js';
import { evaluateCounterPlacementReplacementEvent, evaluateMillReplacementEvent } from '../replacement-effects.js';
import { updateCounters } from '../counters_tokens.js';
import { queueCounterPlacedTriggers } from '../triggers/counters.js';

export function snapshotBattlefieldControllers(state: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const perm of state.battlefield || []) {
    const id = String(perm?.id || '').trim();
    const controllerId = String(perm?.controller || '').trim();
    if (id && controllerId) {
      out.set(id, controllerId);
    }
  }
  return out;
}

export function snapshotBattlefieldCounters(state: any): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const perm of state.battlefield || []) {
    const id = String(perm?.id || '').trim();
    if (!id) continue;
    out.set(id, { ...((perm?.counters || {}) as Record<string, number>) });
  }
  return out;
}

export function syncCounterReplacementEffectsAfterOracleIR(
  ctx: GameContext,
  state: any,
  countersBefore: Map<string, Record<string, number>>,
): void {
  const pendingUpdates: Array<{ permanentId: string; deltas: Record<string, number> }> = [];

  for (const perm of state.battlefield || []) {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) continue;

    const oldCounters = countersBefore.get(permanentId) || {};
    const newCounters = (perm?.counters || {}) as Record<string, number>;
    const counterKeys = new Set([...Object.keys(oldCounters), ...Object.keys(newCounters)]);
    const bonusDeltas: Record<string, number> = {};
    const placedDeltas: Record<string, number> = {};

    for (const counterType of counterKeys) {
      const oldCount = Number(oldCounters[counterType] || 0);
      const newCount = Number(newCounters[counterType] || 0);
      const rawDelta = newCount - oldCount;
      if (rawDelta <= 0) continue;

      const replacementResult = evaluateCounterPlacementReplacementEvent({
        state,
        targetPermanentId: permanentId,
        controllerId: perm.controller,
        deltas: { [counterType]: rawDelta },
      });
      const modifiedDeltas = (replacementResult.metadata as { modifiedDeltas?: Record<string, number> } | undefined)?.modifiedDeltas;
      const modifiedDelta = Number(modifiedDeltas?.[counterType] ?? rawDelta);
      const placed = Number.isFinite(modifiedDelta) && modifiedDelta > 0 ? modifiedDelta : rawDelta;
      placedDeltas[counterType] = (placedDeltas[counterType] || 0) + placed;
      if (modifiedDelta <= rawDelta) continue;

      // Oracle IR already applied rawDelta directly to state; add only the replacement bonus.
      bonusDeltas[counterType] = (bonusDeltas[counterType] || 0) + (modifiedDelta - rawDelta);
    }

    // IR writes counters onto the battlefield without updateCounters, so
    // "whenever you put one or more +1/+1 counters" (Exemplar of Light) never
    // saw the placement. Queue once for the full amount, including replacements.
    if (Object.keys(placedDeltas).length > 0) {
      queueCounterPlacedTriggers(ctx, perm, permanentId, placedDeltas);
    }

    if (Object.keys(bonusDeltas).length === 0) continue;
    pendingUpdates.push({ permanentId, deltas: bonusDeltas });
  }

  for (const { permanentId, deltas } of pendingUpdates) {
    updateCounters(ctx, permanentId, deltas, {
      deferRunSBA: true,
      skipCounterModifications: true,
      skipEventPersistence: true,
      skipCounterPlacedTriggers: true,
    });
  }
}

export function syncPreparedCopiesAfterBattlefieldControllerChanges(
  state: any,
  controllersBefore: Map<string, string>,
): void {
  for (const perm of state.battlefield || []) {
    const id = String(perm?.id || '').trim();
    if (!id) continue;
    const previousController = controllersBefore.get(id);
    const currentController = String(perm?.controller || '').trim();
    if (!previousController || !currentController || previousController === currentController) {
      continue;
    }
    syncPreparedPermanentAfterControlChange(state, perm, previousController);
  }
}

export function syncPreparedCopiesFromControlChangeEffects(state: any): void {
  const effects = Array.isArray(state.controlChangeEffects) ? state.controlChangeEffects : [];
  for (const effect of effects) {
    const permanentId = String(effect?.permanentId || '').trim();
    const previousController = String(effect?.originalController || '').trim();
    if (!permanentId || !previousController) continue;
    const perm = (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === permanentId);
    if (!perm) continue;
    syncPreparedPermanentAfterControlChange(state, perm, previousController);
  }
}

/** Server cleanup / tests use `eot` and capitalized keyword grants. */
export function normalizeOracleIrControlChangeEffectsForServer(state: any): void {
  const effects = Array.isArray(state?.controlChangeEffects) ? state.controlChangeEffects : [];
  for (const effect of effects) {
    const duration = String(effect?.duration || '').trim().toLowerCase();
    if (duration === 'until_end_of_turn' || duration === 'turn') {
      effect.duration = 'eot';
    }
  }
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    const granted = Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities : [];
    for (let i = 0; i < granted.length; i += 1) {
      if (String(granted[i] || '').trim().toLowerCase() === 'haste') {
        granted[i] = 'Haste';
      }
    }
  }
}

function resolveMillTargetPlayerId(
  who: any,
  controller: PlayerID,
  targetPlayerId: PlayerID | undefined,
  state: any,
): PlayerID | undefined {
  if (who?.kind === 'target_player' || who?.kind === 'target_opponent') {
    return targetPlayerId;
  }
  if (who?.kind === 'you') {
    return controller;
  }
  if (who?.kind === 'each_opponent') {
    const opponents = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((id: string) => id && id !== String(controller));
    return opponents.length === 1 ? (opponents[0] as PlayerID) : undefined;
  }
  return targetPlayerId;
}

export function applyMillReplacementEffectsToSteps(
  ctx: GameContext,
  steps: OracleEffectStep[],
  controller: PlayerID,
  targetPlayerId: PlayerID | undefined,
  state: any,
  irCtx: OracleIRExecutionContext,
): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind !== 'mill') return step;

    const millTarget = resolveMillTargetPlayerId((step as any).who, controller, targetPlayerId, state);
    if (!millTarget) return step;

    const baseCount = resolveOracleQuantity(
      state,
      controller,
      (step as any).amount as OracleQuantity,
      irCtx,
      { whereX: (step as any).whereX },
    );
    if (baseCount === null || baseCount <= 0) return step;

    const millResult = evaluateMillReplacementEvent({
      ctx,
      state,
      millingPlayerId: String(controller),
      targetPlayerId: String(millTarget),
      count: baseCount,
    });
    const finalCount = millResult.replacementAmount ?? baseCount;
    if (finalCount === baseCount) return step;

    return {
      ...step,
      amount: { kind: 'number', value: finalCount, raw: String(finalCount) },
    } as OracleEffectStep;
  });
}

