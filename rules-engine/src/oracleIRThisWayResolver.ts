import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  RuntimeObjectSnapshot,
  ThisWayReference,
  ThisWayTrait,
} from './oracleIRTransitionTypes';

export type ThisWaySnapshotCountFilter = {
  readonly typeIncludes?: string;
  readonly typeExcludes?: string;
};

function matchesSimpleSnapshotFilter(
  snap: RuntimeObjectSnapshot,
  filter?: ThisWaySnapshotCountFilter,
): boolean {
  if (!filter) return true;
  const typeLine = snap.typeLine.toLowerCase();
  if (filter.typeIncludes && !typeLine.includes(String(filter.typeIncludes).toLowerCase())) return false;
  if (filter.typeExcludes && typeLine.includes(String(filter.typeExcludes).toLowerCase())) return false;
  return true;
}

export function resolveSnapshotCountAtAntecedent(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
  filter?: ThisWaySnapshotCountFilter,
): number {
  const snapshots = ctx.stepLedger?.get(antecedentStepIndex) ?? [];
  if (snapshots.length === 0) return 0;
  return snapshots.filter((snap) => matchesSimpleSnapshotFilter(snap, filter)).length;
}

export function resolveCardCountDiscardedThisWay(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number {
  return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
}

export function resolveNonlandCountDiscardedThisWay(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number {
  return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex, { typeExcludes: 'land' });
}

export function resolveCreatureCountExiledThisWay(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number {
  return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex, { typeIncludes: 'creature' });
}

export function resolveGreatestPerPlayerDiscardCountThisWay(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number {
  const snapshots = ctx.stepLedger?.get(antecedentStepIndex) ?? [];
  if (snapshots.length === 0) return 0;

  const countsByOwner = new Map<string, number>();
  for (const snap of snapshots) {
    const ownerId = String(snap.ownerId || '').trim();
    if (!ownerId) continue;
    countsByOwner.set(ownerId, (countsByOwner.get(ownerId) ?? 0) + 1);
  }

  if (countsByOwner.size === 0) return snapshots.length;
  return Math.max(...countsByOwner.values());
}

export function collectThisWaySubjects(
  ref: ThisWayReference,
  ctx: OracleIRExecutionContext,
): readonly RuntimeObjectSnapshot[] {
  const ledger = ctx.stepLedger;
  if (!ledger || ledger.size === 0) return [];
  const raw = ledger.get(ref.antecedentStepIndex) ?? [];
  return raw.filter((snap) => matchesSubjectFilter(snap, ref.subjectFilter));
}

export function resolveThisWayTrait(
  ref: ThisWayReference,
  ctx: OracleIRExecutionContext,
): number | null {
  const subjects = collectThisWaySubjects(ref, ctx);
  if (subjects.length === 0) {
    return ref.aggregation === 'count' ? 0 : null;
  }

  const values = subjects
    .map((snap) => readTrait(snap, ref.trait))
    .filter((value): value is number => value !== null);

  switch (ref.aggregation) {
    case 'count':
      return subjects.length;
    case 'greatest':
      return values.length > 0 ? Math.max(...values) : null;
    case 'total':
      return values.reduce((sum, value) => sum + value, 0);
    case 'least':
      return values.length > 0 ? Math.min(...values) : null;
    case 'value':
      return values[0] ?? null;
    default:
      return null;
  }
}

function readTrait(snap: RuntimeObjectSnapshot, trait: ThisWayTrait): number | null {
  switch (trait) {
    case 'power':
      return snap.power;
    case 'toughness':
      return snap.toughness;
    case 'manaValue':
      return snap.manaValue;
    case 'colorCount':
      return snap.colors.length;
    case 'isCreature':
      return snap.types.includes('creature') ? 1 : 0;
    case 'isLand':
      return snap.types.includes('land') ? 1 : 0;
    case 'isNonland':
      return snap.types.includes('land') ? 0 : 1;
    default:
      return null;
  }
}

function matchesSubjectFilter(
  snap: RuntimeObjectSnapshot,
  filter?: ThisWayReference['subjectFilter'],
): boolean {
  if (!filter) return true;
  if (filter.zone && snap.zone !== filter.zone) return false;

  const typeLine = snap.typeLine.toLowerCase();
  for (const inc of filter.typeLineMatch?.includes ?? []) {
    if (!typeLine.includes(String(inc).toLowerCase())) return false;
  }
  for (const exc of filter.typeLineMatch?.excludes ?? []) {
    if (typeLine.includes(String(exc).toLowerCase())) return false;
  }
  return true;
}

export function resolveGreatestPowerExiledThisWay(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number | null {
  return resolveThisWayTrait({
    binding: 'this_way',
    antecedentStepIndex,
    trait: 'power',
    aggregation: 'greatest',
    subjectFilter: { typeLineMatch: { includes: ['creature'] } },
  }, ctx);
}

export function resolveGreatestManaValueExiledThisWay(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number | null {
  return resolveThisWayTrait({
    binding: 'this_way',
    antecedentStepIndex,
    trait: 'manaValue',
    aggregation: 'greatest',
  }, ctx);
}

export function resolveCountExiledThisWay(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number | null {
  return resolveThisWayTrait({
    binding: 'this_way',
    antecedentStepIndex,
    trait: 'isNonland',
    aggregation: 'count',
  }, ctx);
}

export function resolveTotalPowerExiledThisWay(
  ctx: OracleIRExecutionContext,
  antecedentStepIndex: number,
): number | null {
  return resolveThisWayTrait({
    binding: 'this_way',
    antecedentStepIndex,
    trait: 'power',
    aggregation: 'total',
    subjectFilter: { typeLineMatch: { includes: ['creature'] } },
  }, ctx);
}
