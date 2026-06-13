import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { buildDamageTransition } from './oracleIRExecutorEffectTransitionBuilders';

export type EffectBridgeContext = {
  readonly ctx?: OracleIRExecutionContext;
  readonly stepIndex?: number;
  readonly stepKind?: string;
};

export function interceptDamageViaBridge(args: {
  state: GameState;
  amount: number;
  stepIndex: number;
  stepKind: string;
  cause: string;
  ctx?: OracleIRExecutionContext;
  targetPlayerId?: PlayerID;
  targetPermanentId?: string;
  targetPermanent?: unknown;
}): {
  halted: boolean;
  effectiveAmount: number;
  ledgerRecordedViaBridge: boolean;
} {
  const bridge = args.ctx?.serverBridge;
  if (!bridge || !Number.isFinite(args.stepIndex)) {
    return {
      halted: false,
      effectiveAmount: Math.max(0, args.amount | 0),
      ledgerRecordedViaBridge: false,
    };
  }

  const transition = buildDamageTransition({
    amount: args.amount,
    stepIndex: args.stepIndex,
    stepKind: args.stepKind,
    cause: args.cause,
    ctx: args.ctx,
    targetPlayerId: args.targetPlayerId,
    targetPermanentId: args.targetPermanentId,
    targetPermanent: args.targetPermanent,
  });

  const bridgeResult = bridge.proposeTransitions([transition]);
  if (bridgeResult.halt) {
    if (args.ctx?.transitionHaltState) {
      args.ctx.transitionHaltState.halted = true;
      args.ctx.transitionHaltState.deferred = [...(bridgeResult.deferred || [])];
    }
    return {
      halted: true,
      effectiveAmount: 0,
      ledgerRecordedViaBridge: false,
    };
  }

  const ready = bridgeResult.ready?.[0] ?? transition;
  const replacement = (ready.event.metadata as any)?.replacement;
  const effectiveAmount = Math.max(
    0,
    Number(
      ready.event.amount
      ?? ready.event.count
      ?? replacement?.replacementAmount
      ?? replacement?.originalAmount
      ?? args.amount,
    ) | 0,
  );

  return {
    halted: false,
    effectiveAmount,
    ledgerRecordedViaBridge: true,
  };
}

export function buildEffectBridgeOptions(
  ctx: OracleIRExecutionContext,
  stepKind: string,
): EffectBridgeContext | undefined {
  if (!ctx.serverBridge) return undefined;
  if (ctx.currentStepIndex == null) return undefined;
  return {
    ctx,
    stepIndex: ctx.currentStepIndex,
    stepKind,
  };
}
