import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { proposeBattlefieldEntryTransition, resolvePermanentEntersTapped } from './oracleIRBattlefieldEntryProposal';
import { detectEntersWithCounters } from './oracleIRDetectEntersWithCounters';

export type BattlefieldEntryCommitOptions = {
  readonly ctx?: OracleIRExecutionContext;
  readonly stepIndex?: number;
  readonly stepKind?: string;
  readonly cause?: string;
};

export type OracleIrBattlefieldEntryContext = {
  readonly ctx: OracleIRExecutionContext;
  readonly stepKind?: string;
  readonly cause?: string;
};

export type ResolvedBattlefieldEntryModifiers = {
  readonly entersTapped: boolean;
  readonly entersFaceDown: boolean;
  readonly withCounters: Record<string, number>;
  readonly entersTransformed: boolean;
  readonly copySourceId?: string;
};

export function oracleIrBattlefieldEntryOptions(
  ctx: OracleIRExecutionContext,
  stepKind: string,
  cause?: string,
): BattlefieldEntryCommitOptions {
  return {
    ctx,
    stepIndex: ctx.currentStepIndex,
    stepKind,
    cause: cause ?? `oracle_ir:${stepKind}`,
  };
}

function mergeExplicitEntryCounters(
  card: unknown,
  explicitWithCounters?: Record<string, number>,
): Record<string, number> {
  const detected = detectEntersWithCounters(card);
  if (!explicitWithCounters || Object.keys(explicitWithCounters).length === 0) return detected;
  return { ...detected, ...explicitWithCounters };
}

export function resolveBattlefieldEntryModifiers(
  state: GameState,
  card: unknown,
  controllerId: PlayerID,
  args: BattlefieldEntryCommitOptions & {
    readonly explicitEntersTapped?: boolean;
    readonly explicitEntersFaceDown?: boolean;
    readonly explicitWithCounters?: Record<string, number>;
    readonly copySourceId?: string;
    readonly entersTransformed?: boolean;
  },
): ResolvedBattlefieldEntryModifiers | { readonly halted: true } {
  const entryCounters = mergeExplicitEntryCounters(card, args.explicitWithCounters);
  const explicitTapped = Boolean(args.explicitEntersTapped);
  const explicitFaceDown = Boolean(args.explicitEntersFaceDown);

  const bridge = args.ctx?.serverBridge;
  const stepIndex = Number(args.stepIndex);
  if (!bridge || !Number.isFinite(stepIndex)) {
    const fromRules = resolvePermanentEntersTapped({
      battlefield: state.battlefield || [],
      controllerId,
      card,
    });
    return {
      entersTapped: explicitTapped || fromRules,
      entersFaceDown: explicitFaceDown,
      withCounters: entryCounters,
      entersTransformed: Boolean(args.entersTransformed),
      copySourceId: args.copySourceId,
    };
  }

  const baseTransition = proposeBattlefieldEntryTransition({
    stepIndex,
    stepKind: String(args.stepKind || 'battlefield-entry'),
    state,
    card,
    controllerId,
    cause: String(args.cause || `oracle_ir:${args.stepKind || 'battlefield-entry'}`),
    entryCounters,
    copySourceId: args.copySourceId,
    entersTransformed: args.entersTransformed,
    entersFaceDown: explicitFaceDown,
  });

  const transition =
    explicitTapped
      ? {
          ...baseTransition,
          event: {
            ...baseTransition.event,
            entersTapped: true,
          },
        }
      : baseTransition;

  const bridgeResult = bridge.proposeTransitions([transition]);
  if (bridgeResult.halt) {
    if (args.ctx?.transitionHaltState) {
      args.ctx.transitionHaltState.halted = true;
      args.ctx.transitionHaltState.deferred = [...(bridgeResult.deferred || [])];
    }
    return { halted: true };
  }

  const ready = (bridgeResult.ready ?? [transition])[0];
  const event = ready.event;
  return {
    entersTapped: Boolean(event.entersTapped ?? explicitTapped),
    entersFaceDown: Boolean(event.entersFaceDown ?? explicitFaceDown),
    withCounters: { ...(event.entryCounters ?? entryCounters) },
    entersTransformed: Boolean(event.entersTransformed ?? args.entersTransformed),
    copySourceId: event.copySourceId ?? args.copySourceId,
  };
}

export function resolveBattlefieldEntryFromOracleIrContext(
  state: GameState,
  card: unknown,
  controllerId: PlayerID,
  explicit: {
    readonly entersTapped?: boolean;
    readonly entersFaceDown?: boolean;
    readonly withCounters?: Record<string, number>;
    readonly copySourceId?: string;
    readonly entersTransformed?: boolean;
  },
  entry?: OracleIrBattlefieldEntryContext,
): ResolvedBattlefieldEntryModifiers | { readonly halted: true } {
  if (!entry?.ctx) {
    return resolveBattlefieldEntryModifiers(state, card, controllerId, {
      explicitEntersTapped: explicit.entersTapped,
      explicitEntersFaceDown: explicit.entersFaceDown,
      explicitWithCounters: explicit.withCounters,
      copySourceId: explicit.copySourceId,
      entersTransformed: explicit.entersTransformed,
    });
  }

  return resolveBattlefieldEntryModifiers(state, card, controllerId, {
    ...oracleIrBattlefieldEntryOptions(entry.ctx, entry.stepKind || 'move_zone', entry.cause),
    explicitEntersTapped: explicit.entersTapped,
    explicitEntersFaceDown: explicit.entersFaceDown,
    explicitWithCounters: explicit.withCounters,
    copySourceId: explicit.copySourceId,
    entersTransformed: explicit.entersTransformed,
  });
}
