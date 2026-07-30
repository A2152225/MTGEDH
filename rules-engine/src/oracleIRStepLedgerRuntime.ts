import type { OracleEffectStep } from './oracleIR';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { RuntimeObjectZone } from './oracleIRTransitionTypes';
import {
  createEmptyStepLedger,
  recordCardsToStepLedger,
  trackAppliedStepKind,
  type StepLedger,
} from './oracleIRStepLedger';
export type { StepLedger } from './oracleIRStepLedger';

export const BRIDGED_STEP_CARRY_OVER_KEYS = [
  'lastMovedCards',
  'lastExiledCards',
  'lastDiscardedCards',
  'lastMilledCards',
  'lastSacrificedPermanents',
] as const;

export function usedOracleIrServerBridge(ctx?: OracleIRExecutionContext): boolean {
  return Boolean(ctx?.serverBridge && Number.isFinite(ctx?.currentStepIndex));
}

const CHOICE_DEFERRED_OBSERVATION_STEP_KINDS = new Set(['scry', 'surveil']);

/** Record library-top observations when scry/surveil defer to player choice. */
export function flushObservationLedgerFromChoiceDeferredResult(args: {
  ledger: StepLedger;
  appliedStepKinds: Map<number, string>;
  stepIndex: number;
  step: OracleEffectStep;
  controllerId: string;
  result: {
    readonly lastMovedCards?: readonly unknown[];
    readonly skipLedgerFlush?: boolean;
  };
}): boolean {
  if (args.result.skipLedgerFlush) return false;
  if (!CHOICE_DEFERRED_OBSERVATION_STEP_KINDS.has(String(args.step.kind || ''))) return false;
  if (!Array.isArray(args.result.lastMovedCards) || args.result.lastMovedCards.length === 0) return false;
  trackAppliedStepKind(args.appliedStepKinds, args.stepIndex, args.step);
  flushStepLedgerFromAppliedResult({
    ledger: args.ledger,
    appliedStepKinds: args.appliedStepKinds,
    stepIndex: args.stepIndex,
    step: args.step,
    controllerId: args.controllerId,
    appliedResult: args.result,
  });
  return true;
}

/** Reuse ctx.stepLedger when present so flush and serverBridge share one Map. */
export function acquireStepLedgerForExecution(ctx?: OracleIRExecutionContext): StepLedger {
  return ctx?.stepLedger instanceof Map
    ? ctx.stepLedger as StepLedger
    : createEmptyStepLedger();
}

function resolveLedgerZoneForFlushedMovedCards(step: OracleEffectStep): RuntimeObjectZone {
  if (step.kind === 'discard' || step.kind === 'mill') return 'graveyard';
  if (step.kind === 'draw') return 'hand';
  if (step.kind === 'look_select_top') {
    const destination = String((step as { destination?: string }).destination || '').trim();
    if (destination === 'hand') return 'hand';
    if (destination === 'graveyard') return 'graveyard';
    return 'library';
  }
  if (step.kind === 'look_choose_from_top') {
    const destination = String((step as { destination?: string }).destination || '').trim();
    if (destination === 'hand') return 'hand';
    if (destination === 'exile') return 'exile';
    return 'library';
  }
  if (step.kind === 'look_top' || step.kind === 'reveal_top' || step.kind === 'scry' || step.kind === 'surveil') {
    return 'library';
  }
  if (step.kind === 'search_library') {
    const destination = String((step as { destination?: string }).destination || '').trim();
    if (destination === 'hand') return 'hand';
    if (destination === 'graveyard') return 'graveyard';
    if (destination === 'exile') return 'exile';
    if (destination === 'battlefield') return 'battlefield';
    return 'library';
  }
  if (step.kind === 'exile_top' || step.kind === 'impulse_exile_top') return 'exile';
  return 'exile';
}

export function omitBridgedStepCarryOver<T extends Record<string, unknown>>(
  result: T,
  options?: { ledgerRecordedViaBridge?: boolean; skipLedgerFlush?: boolean },
): T & { skipLedgerFlush?: boolean } {
  const bridged = Boolean(
    options?.ledgerRecordedViaBridge
    || options?.skipLedgerFlush
    || (result as { skipLedgerFlush?: boolean }).skipLedgerFlush,
  );
  if (!bridged) return result;

  const next = { ...result, skipLedgerFlush: true } as T & { skipLedgerFlush?: boolean };
  for (const key of BRIDGED_STEP_CARRY_OVER_KEYS) {
    if (key in next) delete (next as Record<string, unknown>)[key];
  }
  if ('lastExiledCardCount' in next) {
    delete (next as Record<string, unknown>).lastExiledCardCount;
  }
  return next;
}

export function sanitizeBridgedStepCarryOver<T extends Record<string, unknown>>(result: T): T {
  return omitBridgedStepCarryOver(result, {
    skipLedgerFlush: (result as { skipLedgerFlush?: boolean }).skipLedgerFlush,
  });
}

export function bridgedZoneStepResult<T extends Record<string, unknown>>(
  ctx: OracleIRExecutionContext | undefined,
  result: T,
): T & { skipLedgerFlush?: boolean } {
  if (!usedOracleIrServerBridge(ctx)) return result;
  return omitBridgedStepCarryOver(result, { ledgerRecordedViaBridge: true });
}

export function flushStepLedgerFromAppliedResult(args: {
  ledger: StepLedger;
  appliedStepKinds: Map<number, string>;
  stepIndex: number;
  step: OracleEffectStep;
  controllerId: string;
  appliedResult: {
    readonly lastExiledCards?: readonly unknown[];
    readonly lastMovedCards?: readonly unknown[];
    readonly lastDiscardedCards?: readonly unknown[];
    readonly lastMilledCards?: readonly unknown[];
    readonly lastSacrificedPermanents?: readonly LastKnownPermanentSnapshot[];
    readonly lastTappedMatchingPermanentIds?: readonly string[];
  };
}): void {
  const existingSnapshots = args.ledger.get(args.stepIndex);
  if (Array.isArray(existingSnapshots) && existingSnapshots.length > 0) {
    return;
  }

  const ownerId = args.controllerId;

  if (Array.isArray(args.appliedResult.lastExiledCards) && args.appliedResult.lastExiledCards.length > 0) {
    recordCardsToStepLedger({
      ledger: args.ledger,
      stepIndex: args.stepIndex,
      stepKind: String(args.step.kind || ''),
      ownerId,
      zone: 'exile',
      cards: args.appliedResult.lastExiledCards,
    });
  }

  if (Array.isArray(args.appliedResult.lastMovedCards) && args.appliedResult.lastMovedCards.length > 0) {
    const isDiscardLike = args.step.kind === 'discard' || args.step.kind === 'mill';
    const hasDiscardedCards = Array.isArray(args.appliedResult.lastDiscardedCards)
      && args.appliedResult.lastDiscardedCards.length > 0;
    if (isDiscardLike && hasDiscardedCards) {
      // Handlers stamp the same cards on lastMovedCards and lastDiscardedCards; record once.
    } else {
      const zone = resolveLedgerZoneForFlushedMovedCards(args.step);
      recordCardsToStepLedger({
        ledger: args.ledger,
        stepIndex: args.stepIndex,
        stepKind: String(args.step.kind || ''),
        ownerId,
        zone,
        cards: args.appliedResult.lastMovedCards,
      });
    }
  }

  if (Array.isArray(args.appliedResult.lastDiscardedCards) && args.appliedResult.lastDiscardedCards.length > 0) {
    recordCardsToStepLedger({
      ledger: args.ledger,
      stepIndex: args.stepIndex,
      stepKind: String(args.step.kind || ''),
      ownerId,
      zone: 'graveyard',
      cards: args.appliedResult.lastDiscardedCards,
    });
  }

  if (Array.isArray(args.appliedResult.lastMilledCards) && args.appliedResult.lastMilledCards.length > 0) {
    recordCardsToStepLedger({
      ledger: args.ledger,
      stepIndex: args.stepIndex,
      stepKind: String(args.step.kind || ''),
      ownerId,
      zone: 'graveyard',
      cards: args.appliedResult.lastMilledCards,
    });
  }

  if (Array.isArray(args.appliedResult.lastSacrificedPermanents)
    && args.appliedResult.lastSacrificedPermanents.length > 0) {
    recordCardsToStepLedger({
      ledger: args.ledger,
      stepIndex: args.stepIndex,
      stepKind: String(args.step.kind || ''),
      ownerId,
      zone: 'graveyard',
      cards: args.appliedResult.lastSacrificedPermanents.map((snap) => ({
        id: snap.id,
        name: snap.name,
        type_line: snap.typeLine,
        power: snap.power,
        toughness: snap.toughness,
        colors: snap.colors,
      })),
    });
  }
}

export function snapshotStepLedger(ledger: StepLedger): ReadonlyMap<number, readonly import('./oracleIRTransitionTypes').RuntimeObjectSnapshot[]> {
  return new Map(ledger);
}

export type SerializedStepLedgerEntry = readonly [number, readonly import('./oracleIRTransitionTypes').RuntimeObjectSnapshot[]];
export type SerializedAppliedStepKindsEntry = readonly [number, string];

export function serializeStepLedgerForEvent(
  ledger: ReadonlyMap<number, readonly import('./oracleIRTransitionTypes').RuntimeObjectSnapshot[]> | undefined,
): SerializedStepLedgerEntry[] | undefined {
  if (!ledger || ledger.size === 0) return undefined;
  return [...ledger.entries()].map(([index, snapshots]) => [index, [...snapshots]] as SerializedStepLedgerEntry);
}

export function deserializeStepLedgerFromEvent(entries: unknown): StepLedger {
  const ledger = createEmptyStepLedger();
  if (!Array.isArray(entries)) return ledger;
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const index = Number(entry[0]);
    const snapshots = entry[1];
    if (!Number.isFinite(index) || !Array.isArray(snapshots)) continue;
    ledger.set(index, snapshots as import('./oracleIRTransitionTypes').RuntimeObjectSnapshot[]);
  }
  return ledger;
}

export function serializeAppliedStepKindsForEvent(
  applied: ReadonlyMap<number, string> | undefined,
): SerializedAppliedStepKindsEntry[] | undefined {
  if (!applied || applied.size === 0) return undefined;
  return [...applied.entries()].map(([index, kind]) => [index, kind] as SerializedAppliedStepKindsEntry);
}

export function deserializeAppliedStepKindsFromEvent(entries: unknown): Map<number, string> {
  const map = new Map<number, string>();
  if (!Array.isArray(entries)) return map;
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const index = Number(entry[0]);
    const kind = String(entry[1] || '').trim();
    if (!Number.isFinite(index) || !kind) continue;
    map.set(index, kind);
  }
  return map;
}

export { createEmptyStepLedger };
