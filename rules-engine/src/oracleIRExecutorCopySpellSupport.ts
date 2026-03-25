import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  parseMoveZoneSingleTargetFromYourGraveyard,
} from './oracleIRExecutorZoneOps';

export function prepareCopiedSpellExecutionContext(params: {
  state: GameState;
  replaySteps: readonly OracleEffectStep[];
  ctx: OracleIRExecutionContext;
}): {
  readonly ctx: OracleIRExecutionContext;
  readonly log: readonly string[];
  readonly requiresChoice?: boolean;
  readonly candidateCount?: number;
} {
  const { state, replaySteps, ctx } = params;
  const copiedCtx: OracleIRExecutionContext = {
    ...ctx,
    castFromZone: undefined,
    enteredFromZone: undefined,
  };

  const targetMoveStep = replaySteps.find((step): step is Extract<OracleEffectStep, { kind: 'move_zone' }> => {
    if (step.kind !== 'move_zone') return false;
    return Boolean(parseMoveZoneSingleTargetFromYourGraveyard(step.what as any));
  });
  if (!targetMoveStep) {
    return { ctx: copiedCtx, log: [] };
  }

  const criteria = parseMoveZoneSingleTargetFromYourGraveyard(targetMoveStep.what as any);
  if (!criteria) {
    return { ctx: copiedCtx, log: [] };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const player = (state.players || []).find((candidate: any) => String(candidate?.id || '').trim() === controllerId) as any;
  const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
  const currentTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();

  if (currentTargetId) {
    const currentTargetStillLegal = graveyard.some((card: any) => {
      const cardId = String(card?.id || '').trim();
      return cardId === currentTargetId && cardMatchesMoveZoneSingleTargetCriteria(card, criteria);
    });
    if (currentTargetStillLegal) {
      return { ctx: copiedCtx, log: [] };
    }
  }

  const alternativeMatches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || cardId === currentTargetId) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, criteria);
  });

  if (alternativeMatches.length !== 1) {
    return {
      ctx: copiedCtx,
      log: [],
      ...(alternativeMatches.length > 1 ? { requiresChoice: true, candidateCount: alternativeMatches.length } : {}),
    };
  }

  const retargetedId = String((alternativeMatches[0] as any)?.id || '').trim();
  if (!retargetedId) return { ctx: copiedCtx, log: [] };

  return {
    ctx: {
      ...copiedCtx,
      targetPermanentId: retargetedId,
      targetCreatureId: retargetedId,
    },
    log: [`[oracle-ir] Auto-retargeted copied spell to ${retargetedId}`],
  };
}
