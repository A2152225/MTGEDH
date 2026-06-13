import type { OracleEffectStep } from './oracleIR';
import { expandAntecedentStepKinds } from './oracleIRThisWayBinding';
import type {
  OracleIRTransitionKind,
  RuntimeObjectSnapshot,
} from './oracleIRTransitionTypes';
import {
  nextOracleIRSnapshotId,
  snapshotCardsFromZone,
  snapshotObjectAtZone,
} from './oracleIRSnapshotFactory';

export type StepLedger = Map<number, RuntimeObjectSnapshot[]>;

export function createEmptyStepLedger(
  seed?: ReadonlyMap<number, readonly RuntimeObjectSnapshot[]>,
): StepLedger {
  const ledger: StepLedger = new Map();
  if (!seed) return ledger;
  for (const [index, snapshots] of seed) {
    ledger.set(index, [...snapshots]);
  }
  return ledger;
}

export function mergeSnapshotsIntoStepLedger(
  ledger: StepLedger,
  stepIndex: number,
  snapshots: readonly RuntimeObjectSnapshot[],
): void {
  if (snapshots.length === 0) return;
  const existing = ledger.get(stepIndex) ?? [];
  ledger.set(stepIndex, [...existing, ...snapshots]);
}

const ZONE_AFFECTING_STEP_KINDS = new Set<string>([
  'exile',
  'exile_top',
  'impulse_exile_top',
  'destroy',
  'sacrifice',
  'discard',
  'mill',
  'move_zone',
  'exile_named_cards_from_zones',
  'look_select_top',
  'look_choose_from_top',
  'look_top',
  'reveal_top',
  'search_library',
  'scry',
  'surveil',
]);

const STEP_KIND_TO_TRANSITION: Partial<Record<string, OracleIRTransitionKind>> = {
  exile: 'zone-change',
  exile_top: 'zone-change',
  impulse_exile_top: 'zone-change',
  destroy: 'zone-change',
  sacrifice: 'zone-change',
  discard: 'zone-change',
  mill: 'zone-change',
  move_zone: 'zone-change',
  exile_named_cards_from_zones: 'zone-change',
  look_select_top: 'zone-change',
  look_choose_from_top: 'zone-change',
  look_top: 'zone-change',
  reveal_top: 'zone-change',
  search_library: 'zone-change',
  scry: 'zone-change',
  surveil: 'zone-change',
  create_token: 'battlefield-entry',
  copy_permanent: 'battlefield-entry',
};

export function isZoneAffectingStepKind(kind: string): boolean {
  return ZONE_AFFECTING_STEP_KINDS.has(kind);
}

export function transitionKindForStepKind(kind: string): OracleIRTransitionKind {
  return STEP_KIND_TO_TRANSITION[kind] ?? 'zone-change';
}

/**
 * Record moved card objects into the step ledger from handler carry-over arrays.
 * Interim Phase A bridge until all handlers emit OracleIRPendingTransition.
 */
export function recordCardsToStepLedger(args: {
  ledger: StepLedger;
  stepIndex: number;
  stepKind: string;
  ownerId: string;
  controllerId?: string;
  zone: RuntimeObjectSnapshot['zone'];
  cards: readonly unknown[];
  battlefieldPermanents?: readonly unknown[];
}): void {
  const transitionId = nextOracleIRSnapshotId(`ir-step-${args.stepIndex}`);
  const transitionKind = transitionKindForStepKind(args.stepKind);

  const snapshots: RuntimeObjectSnapshot[] = [];

  if (Array.isArray(args.battlefieldPermanents) && args.battlefieldPermanents.length > 0) {
    for (const perm of args.battlefieldPermanents) {
      snapshots.push(snapshotObjectAtZone({
        object: perm,
        zone: 'battlefield',
        ownerId: String((perm as any)?.owner ?? (perm as any)?.controller ?? args.ownerId),
        controllerId: String((perm as any)?.controller ?? args.controllerId ?? args.ownerId),
        affectedByStepIndex: args.stepIndex,
        transitionId,
        transitionKind,
      }));
    }
  }

  if (Array.isArray(args.cards) && args.cards.length > 0) {
    snapshots.push(...snapshotCardsFromZone({
      cards: args.cards,
      zone: args.zone,
      ownerId: args.ownerId,
      controllerId: args.controllerId,
      affectedByStepIndex: args.stepIndex,
      transitionId,
      transitionKind,
    }));
  }

  mergeSnapshotsIntoStepLedger(args.ledger, args.stepIndex, snapshots);
}

/** Scan backward for the most recent step matching `kind` (or alias-expanded kinds) before `beforeIndex`. */
export function findAntecedentStepIndex(
  appliedStepKinds: ReadonlyMap<number, string> | undefined,
  kind: string,
  beforeIndex: number,
): number | null {
  if (!appliedStepKinds || beforeIndex <= 0) return null;
  const expanded = new Set(expandAntecedentStepKinds([kind]));
  for (let i = beforeIndex - 1; i >= 0; i -= 1) {
    const applied = String(appliedStepKinds.get(i) || '').trim();
    if (applied && expanded.has(applied)) return i;
  }
  return null;
}

export function trackAppliedStepKind(
  tracker: Map<number, string>,
  stepIndex: number,
  step: OracleEffectStep,
): void {
  tracker.set(stepIndex, String(step.kind || ''));
}
