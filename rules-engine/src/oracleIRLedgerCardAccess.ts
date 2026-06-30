import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { findAntecedentStepIndex } from './oracleIRStepLedger';
import { resolveThisWayAntecedentStepIndex, REVEALED_THIS_WAY_ANTECEDENT_KINDS, SEARCHED_THIS_WAY_ANTECEDENT_KINDS, expandAntecedentStepKinds } from './oracleIRThisWayBinding';
import type { RuntimeObjectSnapshot } from './oracleIRTransitionTypes';
import type { ThisWaySnapshotCountFilter } from './oracleIRThisWayResolver';

function matchesSnapshotFilter(
  snap: RuntimeObjectSnapshot,
  filter?: ThisWaySnapshotCountFilter,
): boolean {
  if (!filter) return true;
  const typeLine = snap.typeLine.toLowerCase();
  if (filter.typeIncludes && !typeLine.includes(String(filter.typeIncludes).toLowerCase())) return false;
  if (filter.typeExcludes && typeLine.includes(String(filter.typeExcludes).toLowerCase())) return false;
  return true;
}

export function snapshotToCardLike(snap: RuntimeObjectSnapshot): Record<string, unknown> {
  return {
    id: snap.objectId,
    name: snap.name,
    type_line: snap.typeLine,
    power: snap.power,
    toughness: snap.toughness,
    colors: [...snap.colors],
    zone: snap.zone,
  };
}

export function collectLedgerCardsAtAntecedent(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
  filter?: ThisWaySnapshotCountFilter,
): Record<string, unknown>[] {
  const snapshots = ctx.stepLedger?.get(antecedentStepIndex) ?? [];
  return snapshots
    .filter((snap) => matchesSnapshotFilter(snap, filter))
    .map(snapshotToCardLike);
}

export function resolveLedgerAntecedentStepIndex(
  ctx: OracleIRExecutionContext | undefined,
  step: OracleEffectStep | undefined,
  kindCandidates: readonly string[],
): number | null {
  if (!ctx) return null;
  if (step && kindCandidates.length > 0) {
    const fromBinding = resolveThisWayAntecedentStepIndex(ctx, step as OracleEffectStep, kindCandidates[0]);
    if (fromBinding !== null) return fromBinding;
  }
  if (ctx.currentStepIndex == null) return null;
  for (const kind of kindCandidates) {
    const index = findAntecedentStepIndex(ctx.appliedStepKinds, kind, ctx.currentStepIndex);
    if (index !== null) return index;
  }
  return null;
}

function appliedKindMatchesRevealedThisWay(kind: string | undefined): boolean {
  const applied = String(kind || '').trim();
  if (!applied) return false;
  const expanded = new Set(expandAntecedentStepKinds([...REVEALED_THIS_WAY_ANTECEDENT_KINDS]));
  return expanded.has(applied);
}

export function isRevealedThisWayLedgerFirst(
  ctx: OracleIRExecutionContext | undefined,
  step?: OracleEffectStep,
): boolean {
  if (!ctx) return false;
  const antecedentIndex = resolveLedgerAntecedentStepIndex(ctx, step, REVEALED_THIS_WAY_ANTECEDENT_KINDS);
  if (antecedentIndex === null) return false;
  if (appliedKindMatchesRevealedThisWay(ctx.appliedStepKinds?.get(antecedentIndex))) return true;
  const snapshots = ctx.stepLedger?.get(antecedentIndex);
  return Boolean(snapshots && snapshots.length > 0);
}

export function collectRevealedThisWayCardsLedgerFirst(
  ctx: OracleIRExecutionContext | undefined,
  step?: OracleEffectStep,
): Record<string, unknown>[] {
  if (!ctx) return [];
  const antecedentIndex = resolveLedgerAntecedentStepIndex(ctx, step, REVEALED_THIS_WAY_ANTECEDENT_KINDS);
  if (antecedentIndex === null) return [];
  return collectLedgerCardsAtAntecedent(ctx, antecedentIndex);
}

export function isSearchedLibraryThisWayLedgerFirst(
  ctx: OracleIRExecutionContext | undefined,
  step?: OracleEffectStep,
): boolean {
  if (!ctx) return false;
  const antecedentIndex = resolveLedgerAntecedentStepIndex(ctx, step, SEARCHED_THIS_WAY_ANTECEDENT_KINDS);
  if (antecedentIndex === null) return false;
  if (ctx.appliedStepKinds?.get(antecedentIndex) === 'search_library') return true;
  const snapshots = ctx.stepLedger?.get(antecedentIndex);
  return Boolean(snapshots && snapshots.length > 0);
}

export function collectMostRecentLedgerCards(
  ctx: OracleIRExecutionContext | undefined,
): Record<string, unknown>[] {
  if (!ctx?.stepLedger?.size) return [];
  if (ctx.currentStepIndex != null) {
    for (let index = ctx.currentStepIndex - 1; index >= 0; index -= 1) {
      const snapshots = ctx.stepLedger.get(index);
      if (snapshots && snapshots.length > 0) {
        return snapshots.map(snapshotToCardLike);
      }
    }
    return [];
  }

  let maxIndex = -1;
  for (const key of ctx.stepLedger.keys()) {
    const numeric = Number(key);
    if (Number.isFinite(numeric)) {
      maxIndex = Math.max(maxIndex, numeric);
    }
  }
  if (maxIndex >= 0) {
    const snapshots = ctx.stepLedger.get(maxIndex);
    if (snapshots && snapshots.length > 0) {
      return snapshots.map(snapshotToCardLike);
    }
  }
  return [];
}

export function resolveTotalPowerFromLedgerAntecedent(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
  filter?: ThisWaySnapshotCountFilter,
): number {
  const snapshots = ctx.stepLedger?.get(antecedentStepIndex) ?? [];
  return snapshots
    .filter((snap) => matchesSnapshotFilter(snap, filter))
    .reduce((sum, snap) => sum + (Number.isFinite(snap.power) ? Math.max(0, snap.power as number) : 0), 0);
}

export function resolveNonlandLedgerCountAtAntecedent(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number {
  return collectLedgerCardsAtAntecedent(ctx, antecedentStepIndex, { typeExcludes: 'land' }).length;
}

export function resolveCreatureLedgerCountAtAntecedent(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number {
  return collectLedgerCardsAtAntecedent(ctx, antecedentStepIndex, { typeIncludes: 'creature' }).length;
}

export function collectContextualCardsLedgerFirst(
  ctx: OracleIRExecutionContext | undefined,
  runtime?: {
    readonly lastMovedCards?: readonly unknown[];
    readonly lastExiledCards?: readonly unknown[];
    readonly lastDiscardedCards?: readonly unknown[];
  },
): unknown[] {
  const fromLedger = collectMostRecentLedgerCards(ctx);
  if (fromLedger.length > 0) return fromLedger;

  return [
    ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
    ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
    ...(Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : []),
    ...(Array.isArray(ctx?.lastMovedCards) ? ctx.lastMovedCards : []),
    ...(Array.isArray(ctx?.lastExiledCards) ? ctx.lastExiledCards : []),
    ...(Array.isArray((ctx as any)?.lastDiscardedCards) ? (ctx as any).lastDiscardedCards : []),
  ];
}

export function collectExiledCardsLedgerFirst(
  ctx: OracleIRExecutionContext | undefined,
  runtime?: { readonly lastExiledCards?: readonly unknown[] },
): unknown[] {
  if (!ctx) {
    return Array.isArray(runtime?.lastExiledCards) ? [...runtime.lastExiledCards] : [];
  }
  const antecedent = resolveLedgerAntecedentStepIndex(
    ctx,
    undefined,
    ['exile', 'exile_top', 'impulse_exile_top'],
  );
  if (antecedent !== null) {
    const fromAntecedent = collectLedgerCardsAtAntecedent(ctx, antecedent);
    if (fromAntecedent.length > 0) return fromAntecedent;
  }
  const recent = collectMostRecentLedgerCards(ctx);
  if (recent.length > 0 && String((recent[0] as any)?.zone || '').trim() === 'exile') {
    return recent;
  }
  return [
    ...(Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : []),
    ...(Array.isArray(ctx.lastExiledCards) ? ctx.lastExiledCards : []),
  ];
}

export function collectSacrificedPermanentsLedgerFirst(
  ctx: OracleIRExecutionContext,
  runtime?: { readonly lastSacrificedPermanents?: readonly unknown[] },
): readonly unknown[] {
  const antecedent = resolveLedgerAntecedentStepIndex(ctx, undefined, ['sacrifice']);
  if (antecedent !== null) {
    const fromLedger = collectLedgerCardsAtAntecedent(ctx, antecedent);
    if (fromLedger.length > 0) return fromLedger;
  }
  return [
    ...(Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : []),
    ...(Array.isArray((ctx as any).lastSacrificedPermanents) ? (ctx as any).lastSacrificedPermanents : []),
  ];
}

export function resolveAntecedentMovedCards(
  ctx: OracleIRExecutionContext | undefined,
  runtime?: {
    readonly lastMovedCards?: readonly unknown[];
    readonly lastExiledCards?: readonly unknown[];
    readonly lastDiscardedCards?: readonly unknown[];
  },
): unknown[] {
  return collectContextualCardsLedgerFirst(ctx, runtime);
}

export function resolveAntecedentDiscardedCards(
  ctx: OracleIRExecutionContext | undefined,
  runtime?: { readonly lastDiscardedCards?: readonly unknown[] },
): unknown[] {
  if (!ctx) {
    return Array.isArray(runtime?.lastDiscardedCards) ? [...runtime.lastDiscardedCards] : [];
  }
  const antecedent = resolveLedgerAntecedentStepIndex(ctx, undefined, ['discard']);
  if (antecedent !== null) {
    const fromLedger = collectLedgerCardsAtAntecedent(ctx, antecedent);
    if (fromLedger.length > 0) return fromLedger;
  }
  const recent = collectMostRecentLedgerCards(ctx);
  if (recent.length > 0) {
    const priorIndex = ctx.currentStepIndex != null ? ctx.currentStepIndex - 1 : -1;
    if (ctx.appliedStepKinds?.get(priorIndex) === 'discard') return recent;
  }
  return [
    ...(Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : []),
    ...(Array.isArray((ctx as any).lastDiscardedCards) ? (ctx as any).lastDiscardedCards : []),
  ];
}

export function resolveAntecedentMilledCards(ctx: OracleIRExecutionContext | undefined): unknown[] {
  if (!ctx) return [];
  const antecedent = resolveLedgerAntecedentStepIndex(ctx, undefined, ['mill']);
  if (antecedent !== null) {
    const fromLedger = collectLedgerCardsAtAntecedent(ctx, antecedent);
    if (fromLedger.length > 0) return fromLedger;
  }
  const recent = collectMostRecentLedgerCards(ctx);
  if (recent.length > 0) {
    const priorIndex = ctx.currentStepIndex != null ? ctx.currentStepIndex - 1 : -1;
    if (ctx.appliedStepKinds?.get(priorIndex) === 'mill') return recent;
  }
  return Array.isArray((ctx as any).lastMilledCards) ? (ctx as any).lastMilledCards : [];
}

export function resolveAntecedentContextualCards(
  ctx: OracleIRExecutionContext | undefined,
  runtime?: {
    readonly lastMovedCards?: readonly unknown[];
    readonly lastExiledCards?: readonly unknown[];
    readonly lastDiscardedCards?: readonly unknown[];
    readonly lastMilledCards?: readonly unknown[];
  },
): unknown[] {
  const moved = resolveAntecedentMovedCards(ctx, runtime);
  if (moved.length > 0) return moved;
  const milled = resolveAntecedentMilledCards(ctx);
  if (milled.length > 0) return milled;
  if (Array.isArray(runtime?.lastMilledCards) && runtime.lastMilledCards.length > 0) {
    return [...runtime.lastMilledCards];
  }
  return [];
}
