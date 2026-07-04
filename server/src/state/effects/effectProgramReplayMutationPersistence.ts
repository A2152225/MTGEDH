import type { OracleIRCommandExecutionEvent } from '../../../../rules-engine/src/effectProgramOracleRunner.js';
import type { OracleIRReplayMutation } from '../../../../rules-engine/src/oracleIRReplayMutations.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import type { EffectProgramOracleIrBridgeConfig } from '../modules/oracleIrEffectProgramBridge.js';

function buildEffectProgramMutationPayload(
  bridge?: EffectProgramOracleIrBridgeConfig,
): Record<string, unknown> {
  if (!bridge) return {};
  return {
    ...(bridge.sourceId ? { effectProgramSourceId: bridge.sourceId } : {}),
    ...(bridge.sourceName ? { effectProgramSourceName: bridge.sourceName } : {}),
    effectProgramMutation: true,
  };
}

function appendMutationEvent(
  ctx: GameContext,
  type: string,
  payload: Record<string, unknown>,
): void {
  if ((ctx as any).isReplaying) return;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  try {
    appendEvent(
      gameId,
      Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
      type,
      payload,
    );
    if (typeof (ctx as any).bumpSeq === 'function') {
      (ctx as any).bumpSeq();
    }
  } catch (err) {
    debugWarn(1, `[EffectProgram] appendEvent(${type}) failed:`, err);
  }
}

function persistReplayMutation(
  ctx: GameContext,
  mutation: OracleIRReplayMutation,
  bridge?: EffectProgramOracleIrBridgeConfig,
): void {
  const mutationPayload = buildEffectProgramMutationPayload(bridge);

  switch (mutation.kind) {
    case 'mill':
      appendMutationEvent(ctx, 'mill', {
        playerId: mutation.playerId,
        count: mutation.count,
        ...mutationPayload,
      });
      return;
    case 'drawCards':
      appendMutationEvent(ctx, 'drawCards', {
        playerId: mutation.playerId,
        count: mutation.count,
        ...mutationPayload,
      });
      return;
    case 'adjustLife':
      appendMutationEvent(ctx, 'adjustLife', {
        playerId: mutation.playerId,
        delta: mutation.delta,
        ...mutationPayload,
      });
      return;
    case 'createToken':
      appendMutationEvent(ctx, 'executeEffect', {
        effectType: 'createToken',
        controllerId: mutation.controllerId,
        tokenData: mutation.tokenData,
        ...mutationPayload,
      });
      return;
    case 'discardEffect':
      appendMutationEvent(ctx, 'discardEffect', {
        playerId: mutation.playerId,
        cardIds: [...mutation.cardIds],
        destination: mutation.destination,
        ...mutationPayload,
      });
      return;
    case 'putCardFromHandOntoBattlefield':
      appendMutationEvent(ctx, 'putCardFromHandOntoBattlefield', {
        playerId: mutation.playerId,
        cardId: mutation.cardId,
        permanentId: mutation.permanentId,
        card: mutation.card,
        tappedAndAttacking: mutation.tappedAndAttacking === true,
        ...mutationPayload,
      });
      return;
    case 'effectProgramZoneMove':
      appendMutationEvent(ctx, 'effectProgramZoneMove', {
        playerId: mutation.playerId,
        fromPlayerId: mutation.fromPlayerId,
        cardId: mutation.cardId,
        fromZone: mutation.fromZone,
        toZone: mutation.toZone,
        card: mutation.card,
        ...(mutation.permanentId ? { permanentId: mutation.permanentId } : {}),
        ...(mutation.fromPermanentId ? { fromPermanentId: mutation.fromPermanentId } : {}),
        ...mutationPayload,
      });
      return;
    default:
      return;
  }
}

/** Persist replay mutations emitted by oracle_ir_execution events. */
export function persistEffectProgramReplayMutationsFromRun(
  ctx: GameContext,
  events: readonly unknown[],
  bridge?: EffectProgramOracleIrBridgeConfig,
): void {
  if ((ctx as any).isReplaying) return;

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const typed = event as Partial<OracleIRCommandExecutionEvent>;
    if (typed.type !== 'oracle_ir_execution' || !typed.execution) continue;

    for (const mutation of typed.execution.replayMutations || []) {
      persistReplayMutation(ctx, mutation, bridge);
    }
  }
}
