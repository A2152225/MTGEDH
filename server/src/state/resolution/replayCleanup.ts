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

function spellCastCardId(step: any): string {
  return String(
    step?.spellCastContext?.cardId
    || step?.cardId
    || step?.mutateCardId
    || step?.sourceId
    || '',
  ).trim();
}

function cardAlreadyOnStack(state: any, cardId: string): boolean {
  const normalizedCardId = String(cardId || '').trim();
  if (!normalizedCardId) return false;

  const stack = Array.isArray(state?.stack) ? state.stack : [];
  return stack.some((entry: any) => {
    if (!entry) return false;
    if (String(entry?.cardId || entry?.sourceCardId || '').trim() === normalizedCardId) return true;
    if (String(entry?.card?.id || '').trim() === normalizedCardId) return true;
    return false;
  });
}

function cardStillInCastSourceZone(state: any, cast: any): boolean {
  const cardId = String(cast?.cardId || '').trim();
  if (!cardId) return false;

  const playerId = String(cast?.playerId || '').trim();
  const fromZone = String(cast?.fromZone || 'hand').toLowerCase().trim() || 'hand';
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  const playerZones = playerId ? zones[playerId] : undefined;

  const zoneHasCard = (zoneCards: any): boolean =>
    Array.isArray(zoneCards) && zoneCards.some((card: any) => String(card?.id || '').trim() === cardId);

  if (fromZone === 'hand' && zoneHasCard(playerZones?.hand)) return true;
  if (fromZone === 'exile') {
    const exile = Array.isArray(state?.exile) ? state.exile : [];
    if (exile.some((card: any) => String(card?.id || '').trim() === cardId)) return true;
  }
  if (fromZone === 'graveyard' && zoneHasCard(playerZones?.graveyard)) return true;
  if (fromZone === 'library' && zoneHasCard(playerZones?.library)) return true;
  if (fromZone === 'command' && zoneHasCard(playerZones?.command)) return true;

  // Unknown / legacy casts: treat any hand presence as still in progress.
  if (!cast?.fromZone && zoneHasCard(playerZones?.hand)) return true;

  return false;
}

/** True when a pendingSpellCast still represents an in-progress cast (not yet put on the stack). */
function pendingCastStillInProgress(state: any, cast: any): boolean {
  const cardId = String(cast?.cardId || '').trim();
  if (!cardId) return false;
  if (cardAlreadyOnStack(state, cardId)) return false;
  return cardStillInCastSourceZone(state, cast);
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

  // Keep pendingSpellCasts only for casts that are still awaiting payment/targets.
  // Completed casts (card already on the stack) must not keep their pre-cast prompts.
  if (pendingSpellCasts && typeof pendingSpellCasts === 'object') {
    for (const [effectId, cast] of Object.entries(pendingSpellCasts)) {
      if (!pendingCastStillInProgress(state, cast)) {
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
    const cardId = spellCastCardId(step);

    if (stepType === ResolutionStepType.MANA_COLOR_SELECTION) {
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
      continue;
    }

    if (CAST_FLOW_STEP_TYPES.has(stepType) && !isBattlefieldTargetStep && !isBattlefieldPaymentStep) {
      // Spell already on the stack means payment/targets already completed in the event log.
      if (cardId && cardAlreadyOnStack(state, cardId)) {
        ResolutionQueueManager.cancelStep(gameId, String(step.id || ''));
        continue;
      }

      if (effectId && !pendingEffectIds.has(effectId)) {
        ResolutionQueueManager.cancelStep(gameId, String(step.id || ''));
        continue;
      }
    }
  }

  const remainingPending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING).length;
  debug(2, `[pruneObsoleteResolutionQueueAfterReplay] ${gameId}: ${remainingPending} pending resolution step(s) after cleanup`);
}
