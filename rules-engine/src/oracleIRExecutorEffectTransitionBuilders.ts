import type { PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIRPendingTransition } from './oracleIRTransitionTypes';
import { nextOracleIRSnapshotId, snapshotObjectAtZone } from './oracleIRSnapshotFactory';

export function buildCardDrawTransition(args: {
  playerId: PlayerID;
  stepIndex: number;
  stepKind: string;
  cause: string;
  drawIndex: number;
  count?: number;
  topLibraryCard?: unknown;
  ctx?: OracleIRExecutionContext;
  metadata?: Readonly<Record<string, unknown>>;
}): OracleIRPendingTransition {
  const transitionId = nextOracleIRSnapshotId('ir-draw');
  const drawCount = Math.max(1, Number(args.count ?? 1) | 0);
  const snapshots = args.topLibraryCard
    ? [
        snapshotObjectAtZone({
          object: args.topLibraryCard,
          zone: 'library',
          ownerId: args.playerId,
          controllerId: args.playerId,
          affectedByStepIndex: args.stepIndex,
          transitionId,
          transitionKind: 'card-draw',
        }),
      ]
    : [];

  return {
    id: transitionId,
    kind: 'card-draw',
    stepIndex: args.stepIndex,
    stepKind: args.stepKind,
    cause: args.cause,
    snapshotSubjects: snapshots,
    event: {
      type: 'card-draw',
      playerId: args.playerId,
      count: drawCount,
      amount: drawCount,
      cause: args.cause,
      metadata: {
        drawIndex: args.drawIndex,
        ...(args.metadata ?? {}),
        sourceName: args.ctx?.sourceName,
      },
    },
  };
}

export function buildDamageTransition(args: {
  amount: number;
  stepIndex: number;
  stepKind: string;
  cause: string;
  ctx?: OracleIRExecutionContext;
  targetPlayerId?: PlayerID;
  targetPermanentId?: string;
  targetPermanent?: unknown;
}): OracleIRPendingTransition {
  const transitionId = nextOracleIRSnapshotId('ir-dmg');
  const snapshots = args.targetPermanent
    ? [
        snapshotObjectAtZone({
          object: args.targetPermanent,
          zone: 'battlefield',
          ownerId: String((args.targetPermanent as any)?.owner ?? (args.targetPermanent as any)?.controller ?? args.ctx?.controllerId ?? ''),
          controllerId: String((args.targetPermanent as any)?.controller ?? args.ctx?.controllerId ?? ''),
          affectedByStepIndex: args.stepIndex,
          transitionId,
          transitionKind: 'damage',
        }),
      ]
    : [];

  return {
    id: transitionId,
    kind: 'damage',
    stepIndex: args.stepIndex,
    stepKind: args.stepKind,
    cause: args.cause,
    snapshotSubjects: snapshots,
    event: {
      type: 'damage',
      amount: Math.max(0, args.amount | 0),
      count: Math.max(0, args.amount | 0),
      playerId: args.targetPlayerId,
      targetPermanentId: args.targetPermanentId,
      object: args.targetPermanent,
      objectId: args.targetPermanentId,
      cause: args.cause,
      metadata: {
        sourceId: args.ctx?.sourceId,
        sourceName: args.ctx?.sourceName,
      },
    },
  };
}

export function buildCounterPlacementTransition(args: {
  targetPermanentId: string;
  targetPermanent: unknown;
  deltas: Readonly<Record<string, number>>;
  modifiedDeltas: Readonly<Record<string, number>>;
  stepIndex: number;
  stepKind: string;
  cause: string;
  ctx?: OracleIRExecutionContext;
}): OracleIRPendingTransition {
  const transitionId = nextOracleIRSnapshotId('ir-cntr');
  const controllerId = String(
    (args.targetPermanent as any)?.controller
    ?? (args.targetPermanent as any)?.owner
    ?? args.ctx?.controllerId
    ?? '',
  ).trim();

  return {
    id: transitionId,
    kind: 'counter-placement',
    stepIndex: args.stepIndex,
    stepKind: args.stepKind,
    cause: args.cause,
    snapshotSubjects: [
      snapshotObjectAtZone({
        object: args.targetPermanent,
        zone: 'battlefield',
        ownerId: String((args.targetPermanent as any)?.owner ?? controllerId),
        controllerId,
        affectedByStepIndex: args.stepIndex,
        transitionId,
        transitionKind: 'counter-placement',
      }),
    ],
    event: {
      type: 'counter-placement',
      targetPermanentId: args.targetPermanentId,
      controllerId,
      deltas: { ...args.deltas },
      cause: args.cause,
      metadata: {
        controllerId,
        modifiedDeltas: { ...args.modifiedDeltas },
        sourceName: args.ctx?.sourceName,
      },
    },
  };
}
