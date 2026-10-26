import type { OracleIRCommandExecutionEvent } from '../../../../rules-engine/src/effectProgramOracleRunner.js';
import type { OracleIRReplayMutation } from '../../../../rules-engine/src/oracleIRReplayMutations.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import type { EffectProgramOracleIrBridgeConfig } from '../modules/oracleIrEffectProgramBridge.js';

export interface OracleIrReplayMutationBridge {
  readonly sourceId?: string;
  readonly sourceName?: string;
  readonly effectProgramMutation?: boolean;
  /** Scry/surveil/library-search compound resume — tag drawCards for replay without re-running IR. */
  readonly compoundResume?: boolean;
}

function buildReplayMutationPayload(
  bridge?: OracleIrReplayMutationBridge,
): Record<string, unknown> {
  if (!bridge) return {};
  if (bridge.effectProgramMutation) {
    return {
      ...(bridge.sourceId ? { effectProgramSourceId: bridge.sourceId } : {}),
      ...(bridge.sourceName ? { effectProgramSourceName: bridge.sourceName } : {}),
      effectProgramMutation: true,
    };
  }
  return {
    ...(bridge.sourceId ? { oracleIrSourceId: bridge.sourceId } : {}),
    ...(bridge.sourceName ? { oracleIrSourceName: bridge.sourceName } : {}),
    oracleIrReplayMutation: true,
  };
}

function appendMutationEvent(
  ctx: GameContext,
  type: string,
  payload: Record<string, unknown>,
): void {
  if ((ctx as any).isReplaying) return;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  try {
    appendEvent(
      gameId,
      Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
      type,
      payload,
    );
    if (typeof (ctx as any).bumpSeq === 'function') {
      (ctx as any).bumpSeq();
    }
  } catch (err) {
    debugWarn(1, `[OracleIR] appendEvent(${type}) failed:`, err);
  }
}

function persistReplayMutation(
  ctx: GameContext,
  mutation: OracleIRReplayMutation,
  bridge?: OracleIrReplayMutationBridge,
): void {
  const mutationPayload = buildReplayMutationPayload(bridge);

  switch (mutation.kind) {
    case 'mill':
      appendMutationEvent(ctx, 'mill', {
        playerId: mutation.playerId,
        count: mutation.count,
        ...mutationPayload,
      });
      return;
    case 'drawCards':
      appendMutationEvent(ctx, 'drawCards', {
        playerId: mutation.playerId,
        count: mutation.count,
        ...(Array.isArray(mutation.drawnCardIds) && mutation.drawnCardIds.length > 0
          ? { drawnCardIds: [...mutation.drawnCardIds] }
          : {}),
        ...(bridge?.compoundResume ? { oracleIrCompoundResume: true } : {}),
        ...mutationPayload,
      });
      return;
    case 'shuffleLibrary':
      appendMutationEvent(ctx, 'shuffleLibrary', {
        playerId: mutation.playerId,
        shuffledLibraryIds: [...mutation.shuffledLibraryIds],
        ...mutationPayload,
      });
      return;
    case 'adjustLife':
      appendMutationEvent(ctx, 'adjustLife', {
        playerId: mutation.playerId,
        delta: mutation.delta,
        ...mutationPayload,
      });
      return;
    case 'createToken':
      appendMutationEvent(ctx, 'executeEffect', {
        effectType: 'createToken',
        controllerId: mutation.controllerId,
        tokenData: mutation.tokenData,
        ...mutationPayload,
      });
      return;
    case 'discardEffect':
      appendMutationEvent(ctx, 'discardEffect', {
        playerId: mutation.playerId,
        cardIds: [...mutation.cardIds],
        destination: mutation.destination,
        ...mutationPayload,
      });
      return;
    case 'putCardFromHandOntoBattlefield':
      appendMutationEvent(ctx, 'putCardFromHandOntoBattlefield', {
        playerId: mutation.playerId,
        cardId: mutation.cardId,
        permanentId: mutation.permanentId,
        card: mutation.card,
        tappedAndAttacking: mutation.tappedAndAttacking === true,
        ...mutationPayload,
      });
      return;
    case 'effectProgramZoneMove':
      appendMutationEvent(ctx, 'effectProgramZoneMove', {
        playerId: mutation.playerId,
        fromPlayerId: mutation.fromPlayerId,
        cardId: mutation.cardId,
        fromZone: mutation.fromZone,
        toZone: mutation.toZone,
        card: mutation.card,
        ...(mutation.permanentId ? { permanentId: mutation.permanentId } : {}),
        ...(mutation.fromPermanentId ? { fromPermanentId: mutation.fromPermanentId } : {}),
        ...(mutation.libraryPlacement ? { libraryPlacement: mutation.libraryPlacement } : {}),
        ...(mutation.skipGraveyardEntryTriggers ? { skipGraveyardEntryTriggers: true } : {}),
        ...mutationPayload,
      });
      return;
    case 'exilePermanent':
      appendMutationEvent(ctx, 'exilePermanent', {
        permanentId: mutation.permanentId,
        ...(mutation.sourcePermanentId ? { sourcePermanentId: mutation.sourcePermanentId } : {}),
        ...(mutation.sourceName ? { sourceName: mutation.sourceName } : {}),
        ...mutationPayload,
      });
      return;
    case 'goad':
      appendMutationEvent(ctx, 'goadPermanent', {
        permanentId: mutation.permanentId,
        goaderId: mutation.goaderId,
        ...(typeof mutation.expiryTurn === 'number' && Number.isFinite(mutation.expiryTurn)
          ? { expiryTurn: mutation.expiryTurn }
          : {}),
        ...mutationPayload,
      });
      return;
    default:
      return;
  }
}

/** Persist net counter changes from an oracle IR execution for undo/replay. */
export function persistCounterDiffsFromOracleIR(
  ctx: GameContext,
  countersBefore: ReadonlyMap<string, Record<string, number>>,
  state: any,
  bridge?: OracleIrReplayMutationBridge,
): void {
  if ((ctx as any).isReplaying) return;

  const mutationPayload = buildReplayMutationPayload(bridge);
  const updates: Array<{ permanentId: string; deltas: Record<string, number> }> = [];
  for (const perm of state?.battlefield || []) {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) continue;

    const oldCounters = countersBefore.get(permanentId) || {};
    const newCounters = (perm?.counters || {}) as Record<string, number>;
    const counterKeys = new Set([...Object.keys(oldCounters), ...Object.keys(newCounters)]);
    const deltas: Record<string, number> = {};

    for (const counterType of counterKeys) {
      const delta = Number(newCounters[counterType] || 0) - Number(oldCounters[counterType] || 0);
      if (delta !== 0) {
        deltas[counterType] = delta;
      }
    }

    if (Object.keys(deltas).length === 0) continue;
    updates.push({ permanentId, deltas });
  }

  if (updates.length === 0) return;
  if (updates.length === 1) {
    appendMutationEvent(ctx, 'updateCounters', {
      ...updates[0],
      skipCounterModifications: true,
      ...mutationPayload,
    });
    return;
  }
  // One resolution touching many permanents (Cathars' Crusade on 460 creatures) persists
  // ONE event; replay applies it in one go with a single SBA pass at the end.
  appendMutationEvent(ctx, 'updateCountersBulk', {
    updates,
    skipCounterModifications: true,
    ...mutationPayload,
  });
}

function bridgeToReplayMutationBridge(
  bridge?: EffectProgramOracleIrBridgeConfig,
): OracleIrReplayMutationBridge | undefined {
  if (!bridge) return undefined;
  return {
    sourceId: bridge.sourceId,
    sourceName: bridge.sourceName,
    effectProgramMutation: true,
  };
}

/** Persist replay mutations from a direct oracle IR execution result. */
export function persistOracleIrReplayMutationsFromExecution(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  bridge?: OracleIrReplayMutationBridge,
): void {
  if ((ctx as any).isReplaying) return;
  for (const mutation of result.replayMutations || []) {
    persistReplayMutation(ctx, mutation, bridge);
  }
}

/** Persist this-turn ETB windows granted by IR so coarse resolveTopOfStack replay restores them. */
export function persistTemporaryEtbWindowsFromOracleIR(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  state: any,
  bridge?: OracleIrReplayMutationBridge,
): void {
  if ((ctx as any).isReplaying) return;
  const granted = (result.appliedSteps || []).some((step) => step.kind === 'grant_temporary_etb_trigger');
  if (!granted) return;

  const sourceName = String(bridge?.sourceName || '').trim();
  const windows = Array.isArray(state?.temporaryEtbTriggers) ? state.temporaryEtbTriggers : [];
  for (const entry of windows) {
    if (sourceName && String(entry?.sourceName || '').trim() !== sourceName) continue;
    appendMutationEvent(ctx, 'executeEffect', {
      effectType: 'grantTemporaryEtbTrigger',
      entry,
      ...buildReplayMutationPayload(bridge),
    });
  }
}

/** Persist replay mutations emitted by oracle_ir_execution effect-program events. */
export function persistEffectProgramReplayMutationsFromRun(
  ctx: GameContext,
  events: readonly unknown[],
  bridge?: EffectProgramOracleIrBridgeConfig,
): void {
  if ((ctx as any).isReplaying) return;

  const mutationBridge = bridgeToReplayMutationBridge(bridge);
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const typed = event as Partial<OracleIRCommandExecutionEvent>;
    if (typed.type !== 'oracle_ir_execution' || !typed.execution) continue;

    for (const mutation of typed.execution.replayMutations || []) {
      persistReplayMutation(ctx, mutation, mutationBridge);
    }
  }
}
