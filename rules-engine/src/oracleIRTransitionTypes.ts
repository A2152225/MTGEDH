import type { PlayerID } from '../../shared/src';

/** Zone at snapshot time — aligned with server ReplacementZone plus stack. */
export type RuntimeObjectZone =
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'hand'
  | 'library'
  | 'command'
  | 'stack';

export type OracleIRTransitionKind =
  | 'zone-change'
  | 'battlefield-entry'
  | 'damage'
  | 'life-gain'
  | 'card-draw'
  | 'library-search'
  | 'token-creation'
  | 'counter-placement';

/**
 * Immutable trait bundle captured when a step proposes affecting an object.
 * Mirrors last-known information (CR 122.3) at pre-commit time.
 */
export interface RuntimeObjectSnapshot {
  readonly objectId: string;
  readonly cardInstanceId?: string;
  readonly zone: RuntimeObjectZone;
  readonly ownerId: PlayerID;
  readonly controllerId?: PlayerID;
  readonly name: string;
  readonly typeLine: string;
  readonly supertypes: readonly string[];
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly power: number | null;
  readonly toughness: number | null;
  readonly manaValue: number | null;
  readonly colors: readonly string[];
  readonly isToken: boolean;
  readonly isCommander: boolean;
  readonly counters: Readonly<Record<string, number>>;
  readonly tapped?: boolean;
  readonly faceDown?: boolean;
  readonly affectedByStepIndex: number;
  readonly transitionId: string;
  readonly transitionKind: OracleIRTransitionKind;
}

/** Minimal event payload — server maps to ReplacementEvent at intercept time. */
export interface OracleIRTransitionEventPayload {
  readonly type: OracleIRTransitionKind;
  readonly object?: unknown;
  readonly objectId?: string;
  readonly sourceZone?: RuntimeObjectZone;
  readonly destinationZone?: RuntimeObjectZone;
  readonly controllerId?: string;
  readonly ownerId?: string;
  readonly amount?: number;
  readonly count?: number;
  readonly entersTapped?: boolean;
  readonly entryCounters?: Readonly<Record<string, number>>;
  readonly entersTransformed?: boolean;
  readonly entersFaceDown?: boolean;
  readonly copySourceId?: string;
  readonly targetPermanentId?: string;
  readonly deltas?: Readonly<Record<string, number>>;
  readonly playerId?: string;
  readonly cause?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A proposed state mutation before replacement rules run. */
export interface OracleIRPendingTransition {
  readonly id: string;
  readonly kind: OracleIRTransitionKind;
  readonly stepIndex: number;
  readonly stepKind: string;
  readonly cause: string;
  readonly event: OracleIRTransitionEventPayload;
  readonly snapshotSubjects: readonly RuntimeObjectSnapshot[];
}

export interface OracleIRCommitResult {
  readonly committed: readonly OracleIRPendingTransition[];
  readonly deferred: readonly OracleIRPendingTransition[];
  readonly ledgerPatches: ReadonlyMap<number, readonly RuntimeObjectSnapshot[]>;
}

export type ThisWayTrait =
  | 'power'
  | 'toughness'
  | 'manaValue'
  | 'colorCount'
  | 'isCreature'
  | 'isLand'
  | 'isNonland';

export interface ThisWaySubjectFilter {
  readonly zone?: RuntimeObjectZone;
  readonly typeLineMatch?: {
    readonly includes?: readonly string[];
    readonly excludes?: readonly string[];
  };
}

/** Parser-bound antecedent for "this way" / "that way" clauses. */
export interface ThisWayReference {
  readonly binding: 'this_way' | 'that_way';
  readonly antecedentStepIndex: number;
  readonly trait: ThisWayTrait;
  readonly aggregation: 'value' | 'count' | 'greatest' | 'total' | 'least';
  readonly subjectFilter?: ThisWaySubjectFilter;
}
