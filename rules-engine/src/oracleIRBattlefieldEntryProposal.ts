import { detectETBTappedPattern, matchOpponentsControlLandsETB } from './oracleIREtbTappedPattern';
import type { OracleIRPendingTransition } from './oracleIRTransitionTypes';
import { nextOracleIRSnapshotId, snapshotObjectAtZone } from './oracleIRSnapshotFactory';

/**
 * Generic opponent-control enters-tapped detection from battlefield oracle text.
 * No card-name branches — pattern match only.
 */
export function detectOpponentEntersTappedFromBattlefield(
  battlefield: readonly unknown[],
  enteringController: string,
  enteringCard: unknown,
): boolean {
  const typeLine = String((enteringCard as any)?.type_line ?? '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const isArtifact = typeLine.includes('artifact');
  const isLand = typeLine.includes('land');
  const isBasicLand = isLand && typeLine.includes('basic');

  for (const perm of battlefield) {
    if (!perm) continue;
    const controller = String((perm as any)?.controller ?? '');
    if (!controller || controller === enteringController) continue;

    const oracle = String((perm as any)?.card?.oracle_text ?? '').toLowerCase();
    // Require "X your opponents control enter ... tapped", not
    // "this land enters tapped unless your opponents control eight or more lands".
    if (!/opponents? control enter(?: the battlefield)? tapped/.test(oracle)) continue;

    if (isCreature && oracle.includes('creature')) return true;
    if (isArtifact && oracle.includes('artifact')) return true;
    if (isLand && !isBasicLand && oracle.includes('land')) return true;

    if (oracle.includes('permanents your opponents control enter') && oracle.includes('tapped')) {
      if (isCreature || isArtifact || isLand) return true;
    }
  }

  return false;
}

function countOpponentLands(battlefield: readonly unknown[], controllerId: string): number {
  let count = 0;
  for (const perm of battlefield) {
    if (!perm) continue;
    const controller = String((perm as any)?.controller ?? '');
    if (!controller || controller === controllerId) continue;
    const typeLine = String((perm as any)?.card?.type_line ?? '').toLowerCase();
    if (typeLine.includes('land')) count += 1;
  }
  return count;
}

export function resolvePermanentEntersTapped(args: {
  battlefield: readonly unknown[];
  controllerId: string;
  card: unknown;
}): boolean {
  const ownText = String((args.card as any)?.oracle_text ?? '');
  const pattern = detectETBTappedPattern(ownText);
  if (pattern === 'always') return true;
  if (pattern === 'conditional') {
    const opponentsLandThreshold = matchOpponentsControlLandsETB(
      ownText,
      countOpponentLands(args.battlefield, args.controllerId),
    );
    if (opponentsLandThreshold?.shouldEnterTapped) return true;
  }
  return detectOpponentEntersTappedFromBattlefield(args.battlefield, args.controllerId, args.card);
}

export function proposeBattlefieldEntryTransition(args: {
  stepIndex: number;
  stepKind: string;
  state: unknown;
  card: unknown;
  controllerId: string;
  cause: string;
  entryCounters?: Readonly<Record<string, number>>;
  copySourceId?: string;
  entersTransformed?: boolean;
  entersFaceDown?: boolean;
}): OracleIRPendingTransition {
  const battlefield = Array.isArray((args.state as any)?.battlefield)
    ? (args.state as any).battlefield
    : [];
  const entersTapped = resolvePermanentEntersTapped({
    battlefield,
    controllerId: args.controllerId,
    card: args.card,
  });

  const transitionId = nextOracleIRSnapshotId('ir-bfe');
  const snapshot = snapshotObjectAtZone({
    object: args.card,
    zone: 'stack',
    ownerId: args.controllerId,
    controllerId: args.controllerId,
    affectedByStepIndex: args.stepIndex,
    transitionId,
    transitionKind: 'battlefield-entry',
  });

  return {
    id: transitionId,
    kind: 'battlefield-entry',
    stepIndex: args.stepIndex,
    stepKind: args.stepKind,
    cause: args.cause,
    snapshotSubjects: [snapshot],
    event: {
      type: 'battlefield-entry',
      object: args.card,
      controllerId: args.controllerId,
      entersTapped,
      entryCounters: args.entryCounters ?? {},
      entersTransformed: Boolean(args.entersTransformed),
      entersFaceDown: Boolean(args.entersFaceDown),
      copySourceId: args.copySourceId,
      cause: args.cause,
    },
  };
}
