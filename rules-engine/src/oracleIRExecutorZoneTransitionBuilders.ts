import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIRPendingTransition, RuntimeObjectZone } from './oracleIRTransitionTypes';
import { nextOracleIRSnapshotId, snapshotObjectAtZone } from './oracleIRSnapshotFactory';

export function buildZoneChangeTransitionsFromPermanents(args: {
  state: GameState;
  permanents: readonly BattlefieldPermanent[];
  stepIndex: number;
  stepKind: string;
  intendedDestination: RuntimeObjectZone;
  cause: string;
  ctx?: OracleIRExecutionContext;
}): OracleIRPendingTransition[] {
  const transitions: OracleIRPendingTransition[] = [];

  for (const perm of args.permanents) {
    const objectId = String((perm as any)?.id || '').trim();
    if (!objectId) continue;

    const transitionId = nextOracleIRSnapshotId('ir-zc');
    const ownerId = String((perm as any)?.owner ?? (perm as any)?.controller ?? args.ctx?.controllerId ?? '').trim();
    const controllerId = String((perm as any)?.controller ?? ownerId).trim();

    transitions.push({
      id: transitionId,
      kind: 'zone-change',
      stepIndex: args.stepIndex,
      stepKind: args.stepKind,
      cause: args.cause,
      snapshotSubjects: [
        snapshotObjectAtZone({
          object: perm,
          zone: 'battlefield',
          ownerId,
          controllerId,
          affectedByStepIndex: args.stepIndex,
          transitionId,
          transitionKind: 'zone-change',
        }),
      ],
      event: {
        type: 'zone-change',
        object: perm,
        objectId,
        sourceZone: 'battlefield',
        destinationZone: args.intendedDestination,
        controllerId,
        ownerId,
        cause: args.cause,
        metadata: {
          exiledBy: args.ctx?.sourceId,
          sourceName: args.ctx?.sourceName,
        },
      },
    });
  }

  return transitions;
}

export function buildZoneChangeTransitionsFromCards(args: {
  cards: readonly unknown[];
  sourceZone: RuntimeObjectZone;
  intendedDestination: RuntimeObjectZone;
  ownerId: string;
  stepIndex: number;
  stepKind: string;
  cause: string;
  ctx?: OracleIRExecutionContext;
  libraryPlacement?: 'top' | 'bottom';
}): OracleIRPendingTransition[] {
  const transitions: OracleIRPendingTransition[] = [];

  for (const card of args.cards) {
    const objectId = String((card as any)?.id || (card as any)?.card?.id || '').trim();
    if (!objectId) continue;

    const transitionId = nextOracleIRSnapshotId('ir-zc');
    const ownerId = String(
      (card as any)?.ownerId ?? (card as any)?.owner ?? args.ownerId,
    ).trim();
    const controllerId = String(
      (card as any)?.controllerId ?? (card as any)?.controller ?? ownerId,
    ).trim();

    transitions.push({
      id: transitionId,
      kind: 'zone-change',
      stepIndex: args.stepIndex,
      stepKind: args.stepKind,
      cause: args.cause,
      snapshotSubjects: [
        snapshotObjectAtZone({
          object: card,
          zone: args.sourceZone,
          ownerId,
          controllerId,
          affectedByStepIndex: args.stepIndex,
          transitionId,
          transitionKind: 'zone-change',
        }),
      ],
      event: {
        type: 'zone-change',
        object: card,
        objectId,
        sourceZone: args.sourceZone,
        destinationZone: args.intendedDestination,
        controllerId,
        ownerId,
        cause: args.cause,
        metadata: {
          sourceName: args.ctx?.sourceName,
          ...(args.libraryPlacement ? { libraryPlacement: args.libraryPlacement } : {}),
        },
      },
    });
  }

  return transitions;
}

export function resolveEffectiveDestinationFromTransition(
  transition: OracleIRPendingTransition,
  fallback: 'graveyard' | 'exile' | 'hand' | 'library',
): 'graveyard' | 'exile' | 'hand' | 'library' | 'cease_to_exist' {
  const replacement = (transition.event.metadata as any)?.replacement;
  if (replacement?.metadata?.ceasesToExist === true) {
    return 'cease_to_exist';
  }

  const dest = String(transition.event.destinationZone || fallback).trim().toLowerCase();
  if (dest === 'exile' || dest === 'graveyard' || dest === 'hand' || dest === 'library') {
    return dest;
  }
  return fallback;
}

export function mapTransitionsToExplicitDestinations(
  transitions: readonly OracleIRPendingTransition[],
  fallback: 'graveyard' | 'exile' | 'hand' | 'library',
): ReadonlyMap<string, 'graveyard' | 'exile' | 'hand' | 'library' | 'cease_to_exist'> {
  const map = new Map<string, 'graveyard' | 'exile' | 'hand' | 'library' | 'cease_to_exist'>();
  for (const transition of transitions) {
    const objectId = String(transition.event.objectId || (transition.event.object as any)?.id || '').trim();
    if (!objectId) continue;
    map.set(objectId, resolveEffectiveDestinationFromTransition(transition, fallback));
  }
  return map;
}
