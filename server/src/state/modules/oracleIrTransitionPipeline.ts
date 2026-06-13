import type { OracleIRServerExecutionBridge } from '../../../../rules-engine/src/oracleIRServerBridge.js';
import type { OracleIRTransitionHaltState } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import type {
  OracleIRPendingTransition,
  OracleIRTransitionEventPayload,
  RuntimeObjectSnapshot,
} from '../../../../rules-engine/src/oracleIRTransitionTypes.js';
import { mergeSnapshotsIntoStepLedger, type StepLedger } from '../../../../rules-engine/src/oracleIRStepLedger.js';
import {
  deserializeAppliedStepKindsFromEvent,
  deserializeStepLedgerFromEvent,
  serializeAppliedStepKindsForEvent,
  serializeStepLedgerForEvent,
} from '../../../../rules-engine/src/oracleIRStepLedgerRuntime.js';
import {
  evaluateReplacementEvent,
  type ReplacementEffectResult,
  type ReplacementEvent,
} from './replacement-effects.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';

export interface OracleIRTransitionInterceptorOptions {
  readonly interactivePlayerChoices: boolean;
}

function toReplacementEvent(
  state: unknown,
  transition: OracleIRPendingTransition,
): ReplacementEvent {
  const payload = transition.event;
  const base = {
    state,
    cause: payload.cause ?? transition.cause,
    metadata: {
      ...(payload.metadata ?? {}),
      oracleIrStepIndex: transition.stepIndex,
      oracleIrTransitionId: transition.id,
      oracleIrStepKind: transition.stepKind,
    },
  };

  switch (payload.type) {
    case 'zone-change':
      return {
        type: 'zone-change',
        ...base,
        object: payload.object,
        objectId: payload.objectId,
        sourceZone: payload.sourceZone,
        destinationZone: payload.destinationZone!,
        controller: payload.controllerId,
        owner: payload.ownerId,
      };
    case 'battlefield-entry':
      return {
        type: 'battlefield-entry',
        ...base,
        card: payload.object,
        controllerId: String(payload.controllerId || ''),
        entersTapped: payload.entersTapped,
        entryCounters: payload.entryCounters as Record<string, number> | undefined,
        entersTransformed: payload.entersTransformed,
        entersFaceDown: payload.entersFaceDown,
        copySourceId: payload.copySourceId,
      };
    case 'damage':
      return {
        type: 'damage',
        ...base,
        amount: Number(payload.amount ?? 0),
        targetId: payload.targetPermanentId ?? payload.objectId,
        target: payload.object,
        targetPlayerId: payload.playerId,
        sourceId: String((payload.metadata as any)?.sourceId || '').trim() || undefined,
      };
    case 'life-gain':
      return {
        type: 'life-gain',
        ...base,
        playerId: String(payload.playerId || ''),
        amount: Number(payload.amount ?? 0),
      };
    case 'card-draw':
      return {
        type: 'card-draw',
        ...base,
        playerId: String(payload.playerId || ''),
        count: Number(payload.count ?? payload.amount ?? 0),
        drawIndex: Number((payload.metadata as any)?.drawIndex ?? 0) || undefined,
        metadata: payload.metadata as Record<string, unknown> | undefined,
      };
    case 'counter-placement':
      return {
        type: 'counter-placement',
        ...base,
        targetPermanentId: String(payload.targetPermanentId || ''),
        controllerId: String(payload.controllerId || (payload.metadata as any)?.controllerId || '').trim() || undefined,
        deltas: (payload.deltas ?? {}) as Record<string, number>,
        modifiedDeltas: ((payload.metadata as any)?.modifiedDeltas ?? payload.deltas ?? {}) as Record<string, number>,
      };
    case 'token-creation':
      return {
        type: 'token-creation',
        ...base,
        controllerId: String(payload.controllerId || ''),
        count: Number(payload.count ?? payload.amount ?? 0),
      };
    case 'library-search':
      return {
        type: 'library-search',
        ...base,
        searchingPlayerId: String(payload.playerId || payload.controllerId || ''),
      };
    default:
      return {
        type: 'zone-change',
        ...base,
        destinationZone: payload.destinationZone ?? 'exile',
      };
  }
}

function applyReplacementToTransition(
  transition: OracleIRPendingTransition,
  result: ReplacementEffectResult,
): OracleIRPendingTransition {
  if (!result.applied) return transition;

  const event: OracleIRTransitionEventPayload = { ...transition.event };

  if (transition.kind === 'zone-change' && result.replacementDestination) {
    return {
      ...transition,
      event: {
        ...event,
        destinationZone: result.replacementDestination,
        metadata: { ...(event.metadata ?? {}), replacement: result },
      },
    };
  }

  if (transition.kind === 'battlefield-entry') {
    const meta = (result.metadata ?? {}) as Record<string, unknown>;
    return {
      ...transition,
      event: {
        ...event,
        entersTapped: Boolean(meta.entersTapped ?? event.entersTapped),
        entryCounters: (meta.entryCounters as Record<string, number> | undefined) ?? event.entryCounters,
        entersTransformed: Boolean(meta.entersTransformed ?? event.entersTransformed),
        entersFaceDown: Boolean(meta.entersFaceDown ?? event.entersFaceDown),
        metadata: { ...(event.metadata ?? {}), replacement: result },
      },
    };
  }

  if (transition.kind === 'counter-placement') {
    const meta = (result.metadata ?? {}) as Record<string, unknown>;
    const modifiedDeltas = (meta.modifiedDeltas as Record<string, number> | undefined)
      ?? transition.event.deltas
      ?? {};
    const replacementAmount = result.replacementAmount ?? result.originalAmount;
    return {
      ...transition,
      event: {
        ...event,
        deltas: modifiedDeltas,
        amount: replacementAmount,
        count: replacementAmount,
        metadata: { ...(event.metadata ?? {}), replacement: result },
      },
    };
  }

  if (
    transition.kind === 'damage'
    || transition.kind === 'life-gain'
    || transition.kind === 'card-draw'
    || transition.kind === 'token-creation'
  ) {
    const replacementAmount = result.replacementAmount ?? result.originalAmount;
    return {
      ...transition,
      event: {
        ...event,
        amount: replacementAmount,
        count: replacementAmount,
        metadata: { ...(event.metadata ?? {}), replacement: result },
      },
    };
  }

  return transition;
}

export function interceptOracleIRTransitions(
  state: unknown,
  transitions: readonly OracleIRPendingTransition[],
  options: OracleIRTransitionInterceptorOptions,
): {
  readonly ready: readonly OracleIRPendingTransition[];
  readonly deferred: readonly OracleIRPendingTransition[];
  readonly replacementLog: readonly ReplacementEffectResult[];
} {
  const ready: OracleIRPendingTransition[] = [];
  const deferred: OracleIRPendingTransition[] = [];
  const replacementLog: ReplacementEffectResult[] = [];

  for (const transition of transitions) {
    const result = evaluateReplacementEvent(toReplacementEvent(state, transition));
    replacementLog.push(result);

    if (result.choiceRequired && options.interactivePlayerChoices) {
      deferred.push({
        ...transition,
        event: {
          ...transition.event,
          metadata: {
            ...(transition.event.metadata ?? {}),
            replacementChoice: result,
          },
        },
      });
      continue;
    }

    ready.push(applyReplacementToTransition(transition, result));
  }

  return { ready, deferred, replacementLog };
}

export function commitOracleIRTransitionLedger(
  ledger: StepLedger,
  transitions: readonly OracleIRPendingTransition[],
): void {
  for (const transition of transitions) {
    if (transition.snapshotSubjects.length === 0) continue;
    mergeSnapshotsIntoStepLedger(ledger, transition.stepIndex, transition.snapshotSubjects);
  }
}

export function createOracleIRServerExecutionBridge(args: {
  state: unknown;
  ledger: StepLedger;
  interactivePlayerChoices: boolean;
  haltState: OracleIRTransitionHaltState;
  onDeferred?: (deferred: readonly OracleIRPendingTransition[]) => void;
}): OracleIRServerExecutionBridge {
  return {
    proposeTransitions(transitions) {
      const { ready, deferred } = interceptOracleIRTransitions(args.state, transitions, {
        interactivePlayerChoices: args.interactivePlayerChoices,
      });

      if (deferred.length > 0) {
        args.haltState.halted = true;
        args.haltState.deferred = [...deferred];
        args.onDeferred?.(args.haltState.deferred);
        return { halt: true, deferred: args.haltState.deferred };
      }

      commitOracleIRTransitionLedger(args.ledger, ready);
      return { halt: false, ready };
    },
  };
}

export function readStepLedgerFromState(state: unknown): StepLedger {
  const raw = (state as any)?.oracleIrStepLedger;
  if (!(raw instanceof Map)) return new Map();
  const ledger: StepLedger = new Map();
  for (const [index, snapshots] of raw) {
    ledger.set(Number(index), [...(snapshots as RuntimeObjectSnapshot[])]);
  }
  return ledger;
}

export function readAppliedStepKindsFromState(state: unknown): Map<number, string> {
  const raw = (state as any)?.oracleIrAppliedStepKinds;
  if (!(raw instanceof Map)) return new Map();
  return new Map(raw);
}

export function readOracleIrLedgerPersistFields(state: unknown): {
  oracleIrStepLedger?: ReturnType<typeof serializeStepLedgerForEvent>;
  oracleIrAppliedStepKinds?: ReturnType<typeof serializeAppliedStepKindsForEvent>;
} {
  const ledger = serializeStepLedgerForEvent(readStepLedgerFromState(state));
  const applied = serializeAppliedStepKindsForEvent(readAppliedStepKindsFromState(state));
  return {
    ...(ledger ? { oracleIrStepLedger: ledger } : {}),
    ...(applied ? { oracleIrAppliedStepKinds: applied } : {}),
  };
}

export function restoreOracleIrLedgerOnState(
  state: unknown,
  ledgerEntries: unknown,
  appliedEntries: unknown,
): void {
  if (!state || typeof state !== 'object') return;
  if (Array.isArray(ledgerEntries) && ledgerEntries.length > 0) {
    (state as any).oracleIrStepLedger = deserializeStepLedgerFromEvent(ledgerEntries);
  }
  if (Array.isArray(appliedEntries) && appliedEntries.length > 0) {
    (state as any).oracleIrAppliedStepKinds = deserializeAppliedStepKindsFromEvent(appliedEntries);
  }
}

export function queueOracleIrDeferredReplacementPrompts(
  ctx: { gameId?: string; isReplaying?: boolean },
  haltState: OracleIRTransitionHaltState,
  params: {
    controller: string;
    sourceName?: string;
    sourceId?: string;
    continuationSteps?: readonly unknown[];
  },
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  if (!haltState.halted || haltState.deferred.length === 0) return false;

  for (const transition of haltState.deferred) {
    const replacementChoice = (transition.event.metadata as any)?.replacementChoice;
    const options = Array.isArray(replacementChoice?.replacementOptions)
      ? replacementChoice.replacementOptions
      : [];
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.REPLACEMENT_EFFECT_CHOICE,
      playerId: params.controller,
      description: `${String(params.sourceName || 'Ability')}: choose replacement destination`,
      metadata: {
        oracleIrTransitionId: transition.id,
        oracleIrStepIndex: transition.stepIndex,
        replacementOptions: options,
        replacementEffectId: replacementChoice?.effectId,
        continuationSteps: params.continuationSteps,
        sourceId: params.sourceId,
      },
    } as any);
  }

  return true;
}
