import { debug } from '../../utils/debug.js';
import { ResolutionQueueManager } from './ResolutionQueueManager.js';
import { ResolutionStepStatus, ResolutionStepType } from './types.js';

const CAST_FLOW_STEP_TYPES = new Set<string>([
  ResolutionStepType.TARGET_SELECTION,
  ResolutionStepType.MODE_SELECTION,
  ResolutionStepType.MANA_PAYMENT_CHOICE,
  ResolutionStepType.ADDITIONAL_COST_PAYMENT,
  ResolutionStepType.X_VALUE_SELECTION,
  ResolutionStepType.MUTATE_TARGET_SELECTION,
  ResolutionStepType.OPTION_CHOICE,
]);

function spellCastEffectId(step: any): string {
  return String(step?.spellCastContext?.effectId || step?.effectId || '').trim();
}

function cardStillBeingCast(state: any, cast: any): boolean {
  const cardId = String(cast?.cardId || '').trim();
  if (!cardId) return false;

  const stack = Array.isArray(state?.stack) ? state.stack : [];
  return stack.some((entry: any) => String(entry?.cardId || entry?.sourceCardId || '').trim() === cardId);
}

function battlefieldActivationAlreadyOnStack(state: any, step: any): boolean {
  const permanentId = String(step?.permanentId || step?.sourceId || '').trim();
  if (!permanentId) return false;

  const stack = Array.isArray(state?.stack) ? state.stack : [];
  return stack.some((entry: any) =>
    String(entry?.type || '') === 'ability' &&
    String(entry?.source || '') === permanentId
  );
}

/**
 * After rebuilding in-memory state from persisted events, drop resolution prompts that
 * were already resolved in the event log but would otherwise be re-queued on replay.
 */
export function pruneObsoleteResolutionQueueAfterReplay(gameId: string, state: any): void {
  if (!gameId || !state) return;

  const queue = ResolutionQueueManager.getQueue(gameId);
  const pendingSpellCasts = (state as any).pendingSpellCasts;

  if (pendingSpellCasts && typeof pendingSpellCasts === 'object') {
    for (const [effectId, cast] of Object.entries(pendingSpellCasts)) {
      if (!cardStillBeingCast(state, cast)) {
        delete pendingSpellCasts[effectId];
      }
    }
  }

  const pendingEffectIds = pendingSpellCasts && typeof pendingSpellCasts === 'object'
    ? new Set(Object.keys(pendingSpellCasts))
    : new Set<string>();

  for (const step of [...queue.steps]) {
    if (step.status !== ResolutionStepStatus.PENDING) continue;

    const stepType = String(step.type || '');
    const effectId = spellCastEffectId(step);

    if (stepType === ResolutionStepType.MANA_COLOR_SELECTION) {
      ResolutionQueueManager.cancelStep(gameId, String(step.id || ''));
      continue;
    }

    if (CAST_FLOW_STEP_TYPES.has(stepType) && effectId && !pendingEffectIds.has(effectId)) {
      ResolutionQueueManager.cancelStep(gameId, String(step.id || ''));
      continue;
    }

    const isBattlefieldTargetStep =
      stepType === ResolutionStepType.TARGET_SELECTION &&
      (step as any)?.battlefieldAbilityTargetSelection === true;
    const isBattlefieldPaymentStep =
      stepType === ResolutionStepType.MANA_PAYMENT_CHOICE &&
      (step as any)?.activationPaymentChoice === true;
    if ((isBattlefieldTargetStep || isBattlefieldPaymentStep) && battlefieldActivationAlreadyOnStack(state, step)) {
      ResolutionQueueManager.cancelStep(gameId, String(step.id || ''));
    }
  }

  const remainingPending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING).length;
  debug(2, `[pruneObsoleteResolutionQueueAfterReplay] ${gameId}: ${remainingPending} pending resolution step(s) after cleanup`);
}
