import { debug } from '../../utils/debug.js';
import { ResolutionQueueManager } from './ResolutionQueueManager.js';
import { ResolutionStepStatus, ResolutionStepType, type ResolutionStep } from './types.js';

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

type ReplayLibrarySource = Map<string, any[]> | Record<string, any[]> | undefined;

function getAuthoritativeLibraryCards(libraries: ReplayLibrarySource, playerId: string): any[] {
  if (!libraries || !playerId) return [];
  if (typeof (libraries as Map<string, any[]>).get === 'function') {
    const fromMap = (libraries as Map<string, any[]>).get(playerId);
    return Array.isArray(fromMap) ? fromMap : [];
  }
  const fromRecord = (libraries as Record<string, any[]>)[playerId];
  return Array.isArray(fromRecord) ? fromRecord : [];
}

function cardStillInCastSourceZone(
  state: any,
  cast: any,
  libraries?: ReplayLibrarySource,
): boolean {
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
    if (zoneHasCard(playerZones?.exile)) return true;
  }
  if (fromZone === 'graveyard' && zoneHasCard(playerZones?.graveyard)) return true;
  if (fromZone === 'library') {
    // Authoritative source is game.libraries; zones.library is often empty/omitted.
    if (zoneHasCard(getAuthoritativeLibraryCards(libraries, playerId))) return true;
    if (zoneHasCard(playerZones?.library)) return true;
  }
  if (fromZone === 'command') {
    const commandZone = state?.commandZone?.[playerId];
    if (zoneHasCard(commandZone?.commanderCards)) return true;
    if (zoneHasCard(playerZones?.command)) return true;
  }

  // Unknown / legacy casts: treat any hand presence as still in progress.
  if (!cast?.fromZone && zoneHasCard(playerZones?.hand)) return true;

  return false;
}

/** True when a pendingSpellCast still represents an in-progress cast (not yet put on the stack). */
function pendingCastStillInProgress(
  state: any,
  cast: any,
  libraries?: ReplayLibrarySource,
): boolean {
  const cardId = String(cast?.cardId || '').trim();
  if (!cardId) return false;
  if (cardAlreadyOnStack(state, cardId)) return false;
  return cardStillInCastSourceZone(state, cast, libraries);
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

function findBattlefieldPermanentForChoiceStep(state: any, step: any): any | undefined {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (battlefield.length === 0) return undefined;

  const permanentId = String(step?.permanentId || step?.sourceId || '').trim();
  const aliases = (state?.replayPermanentAliases && typeof state.replayPermanentAliases === 'object')
    ? state.replayPermanentAliases as Record<string, string>
    : {};
  const aliasedId = permanentId && typeof aliases[permanentId] === 'string'
    ? String(aliases[permanentId] || '').trim()
    : '';

  if (permanentId) {
    const direct = battlefield.find((entry: any) => {
      const entryId = String(entry?.id || '').trim();
      return entryId !== '' && (entryId === permanentId || entryId === aliasedId);
    });
    if (direct) return direct;
  }

  const playerId = String(step?.playerId || '').trim();
  const cardName = String(step?.cardName || step?.sourceName || '').trim().toLowerCase();
  if (!playerId || !cardName) return undefined;

  const matches = battlefield.filter((entry: any) =>
    String(entry?.controller || '').trim() === playerId &&
    String(entry?.card?.name || '').trim().toLowerCase() === cardName
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function permanentAlreadyHasAsEntersChoice(permanent: any, stepType: string, state: any): boolean {
  if (!permanent) return false;
  if (stepType === ResolutionStepType.CREATURE_TYPE_CHOICE) {
    const morophonChosenType = (state?.morophonChosenType || {}) as Record<string, string>;
    return Boolean(
      String(permanent.chosenCreatureType || permanent.card?.chosenCreatureType || '').trim()
      || String(morophonChosenType[String(permanent.id || '')] || '').trim()
    );
  }
  if (stepType === ResolutionStepType.COLOR_CHOICE) {
    return Boolean(String(permanent.chosenColor || permanent.card?.chosenColor || '').trim());
  }
  if (stepType === ResolutionStepType.CARD_NAME_CHOICE) {
    return Boolean(String(permanent.chosenCardName || permanent.card?.chosenCardName || '').trim());
  }
  if (stepType === ResolutionStepType.PLAYER_CHOICE) {
    return Boolean(String(permanent.chosenPlayer || permanent.card?.chosenPlayer || '').trim());
  }
  return false;
}

/**
 * After rebuilding in-memory state from persisted events, drop resolution prompts that
 * were already resolved in the event log but would otherwise be re-queued on replay.
 *
 * Pass the authoritative `libraries` map when available so library-origin pending casts
 * (Emperor Mihail II / Future Sight / etc.) are not pruned just because `zones.library`
 * is empty.
 */
export function pruneObsoleteResolutionQueueAfterReplay(
  gameId: string,
  state: any,
  libraries?: ReplayLibrarySource,
): void {
  if (!gameId || !state) return;

  const queue = ResolutionQueueManager.getQueue(gameId);
  const pendingSpellCasts = (state as any).pendingSpellCasts;
  const librarySource = libraries
    ?? (state as any)?.libraries
    ?? undefined;

  // Keep pendingSpellCasts only for casts that are still awaiting payment/targets.
  // Completed casts (card already on the stack) must not keep their pre-cast prompts.
  if (pendingSpellCasts && typeof pendingSpellCasts === 'object') {
    for (const [effectId, cast] of Object.entries(pendingSpellCasts)) {
      if (!pendingCastStillInProgress(state, cast, librarySource)) {
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

    // As-enters choose-X prompts restored from resolveTopOfStackPrompt must not
    // survive when the choice event already hydrated the permanent.
    if (
      stepType === ResolutionStepType.CREATURE_TYPE_CHOICE
      || stepType === ResolutionStepType.COLOR_CHOICE
      || stepType === ResolutionStepType.CARD_NAME_CHOICE
      || stepType === ResolutionStepType.PLAYER_CHOICE
    ) {
      const choiceStep = step as ResolutionStep & {
        permanentId?: string;
        spellId?: string;
        beholdCastCardId?: string;
        spellBeholdCastCardId?: string;
        castSpellFromHandArgs?: unknown;
      };
      // Spell/behold cast-time type prompts keep castSpellFromHandArgs / spellId.
      const isPermanentAsEntersPrompt = Boolean(
        choiceStep.permanentId || choiceStep.sourceId
      ) && !choiceStep.spellId && !choiceStep.beholdCastCardId && !choiceStep.spellBeholdCastCardId && !choiceStep.castSpellFromHandArgs;
      if (isPermanentAsEntersPrompt) {
        const permanent = findBattlefieldPermanentForChoiceStep(state, step);
        if (permanentAlreadyHasAsEntersChoice(permanent, stepType, state)) {
          ResolutionQueueManager.cancelStep(gameId, String(step.id || ''));
          continue;
        }
      }
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
