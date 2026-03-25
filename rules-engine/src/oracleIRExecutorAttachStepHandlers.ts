import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { attachExistingBattlefieldPermanentToTarget } from './oracleIRExecutorZoneOps';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unsupported_selector' | 'impossible_action' | 'player_choice_required';
  readonly options?: {
    readonly classification?: 'unsupported' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
  };
};

export type AttachStepHandlerResult = StepApplyResult | StepSkipResult;

function resolveAttachmentSourceId(
  step: Extract<OracleEffectStep, { kind: 'attach' }>,
  ctx: OracleIRExecutionContext
): string {
  if ((step.attachment as any)?.kind !== 'raw') return '';
  const raw = String((step.attachment as any)?.text || '').trim().toLowerCase();
  if (!/^(?:it|this enchantment|this equipment|this permanent)$/.test(raw)) return '';
  return String(ctx.sourceId || '').trim();
}

function resolveAttachmentTargetId(
  step: Extract<OracleEffectStep, { kind: 'attach' }>,
  ctx: OracleIRExecutionContext,
  lastMovedBattlefieldPermanentIds: readonly string[]
): string | 'player_choice_required' {
  if ((step.to as any)?.kind !== 'raw') return '';
  const raw = String((step.to as any)?.text || '').trim().toLowerCase();

  if (/^(?:it|that creature)$/.test(raw)) {
    const ids = lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean);
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) return 'player_choice_required';
    return '';
  }

  if (raw === 'target creature' || raw === 'target creature you control') {
    return String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  }

  return '';
}

export function applyAttachStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'attach' }>,
  ctx: OracleIRExecutionContext,
  lastMovedBattlefieldPermanentIds: readonly string[]
): AttachStepHandlerResult {
  const attachmentId = resolveAttachmentSourceId(step, ctx);
  if (!attachmentId) {
    return {
      applied: false,
      message: `Skipped attach (unsupported attachment selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  const targetId = resolveAttachmentTargetId(step, ctx, lastMovedBattlefieldPermanentIds);
  if (targetId === 'player_choice_required') {
    return {
      applied: false,
      message: `Skipped attach (needs player attachment choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (!targetId) {
    return {
      applied: false,
      message: `Skipped attach (unsupported attachment target): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  const result = attachExistingBattlefieldPermanentToTarget(state, attachmentId, targetId);
  if (result.kind === 'impossible') {
    return {
      applied: false,
      message: `Skipped attach (attachment target unavailable): ${step.raw}`,
      reason: 'impossible_action',
      options: { persist: false },
    };
  }

  return {
    applied: true,
    state: result.state,
    log: result.log,
  };
}
