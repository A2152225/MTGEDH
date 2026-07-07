import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import type { KeywordTriggerResult } from './keyword-handlers.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';

export function enqueueSupportedKeywordChoiceStep(
  ctx: GameContext,
  permanent: any,
  sourceName: string,
  sourceId: string | undefined,
  result: KeywordTriggerResult,
): boolean {
  const keywordChoice = result.requiresPlayerChoice;
  if (!keywordChoice) {
    return false;
  }

  const keywordGameId = String((ctx as any).gameId || '').trim();
  let queueType: ResolutionStepType | null = null;
  const queueExtras: Record<string, any> = {};

  if (result.keyword === 'riot' && keywordChoice.type === 'riot_choice') {
    queueType = ResolutionStepType.RIOT_CHOICE;
  } else if (result.keyword === 'unleash' && keywordChoice.type === 'unleash_choice') {
    queueType = ResolutionStepType.UNLEASH_CHOICE;
  } else if (result.keyword === 'fabricate' && keywordChoice.type === 'fabricate_choice') {
    queueType = ResolutionStepType.FABRICATE_CHOICE;
    if (typeof keywordChoice.value === 'number' && Number.isFinite(keywordChoice.value)) {
      queueExtras.value = keywordChoice.value;
    }
  } else if (result.keyword === 'exploit' && keywordChoice.type === 'sacrifice_creature') {
    queueType = ResolutionStepType.EXPLOIT_CHOICE;
    queueExtras.creatures = Array.isArray(ctx?.state?.battlefield)
      ? ctx.state.battlefield
          .filter((entry: any) => {
            if (!entry) return false;
            if (String(entry?.controller || '') !== String(keywordChoice.playerId || '')) return false;
            const typeLine = String(entry?.card?.type_line || '').toLowerCase();
            return typeLine.includes('creature');
          })
          .map((entry: any) => ({
            id: String(entry?.id || ''),
            name: String(entry?.card?.name || 'Creature'),
            power: entry?.power ?? entry?.card?.power,
            toughness: entry?.toughness ?? entry?.card?.toughness,
            imageUrl:
              entry?.card?.image_uris?.small ||
              entry?.card?.image_uris?.normal ||
              entry?.card?.imageUrl ||
              undefined,
            type: 'permanent',
          }))
          .filter((entry: any) => entry.id)
      : [];
    queueExtras.mandatory = false;
  } else if (result.keyword === 'mentor' && keywordChoice.type === 'target_creature') {
    queueType = ResolutionStepType.MENTOR_TARGET;
    queueExtras.targets = Array.isArray(keywordChoice.options)
      ? keywordChoice.options
          .map((option: any) => {
            const id = String(option?.id ?? '').trim();
            if (!id) return null;
            return {
              id,
              name: String(option?.name ?? option?.label ?? 'Creature'),
              power: option?.power,
              toughness: option?.toughness,
              type: 'permanent',
            };
          })
          .filter(Boolean)
      : [];
  } else if (result.keyword === 'modular' && keywordChoice.type === 'target_artifact_creature') {
    queueType = ResolutionStepType.MODULAR_CHOICE;
    queueExtras.targets = Array.isArray(keywordChoice.options)
      ? keywordChoice.options
          .map((option: any) => {
            const id = String(option?.id ?? '').trim();
            if (!id) return null;
            return {
              id,
              name: String(option?.name ?? option?.label ?? 'Artifact Creature'),
              power: option?.power,
              toughness: option?.toughness,
              type: 'permanent',
            };
          })
          .filter(Boolean)
      : [];
    if (typeof keywordChoice.value === 'number' && Number.isFinite(keywordChoice.value)) {
      queueExtras.value = keywordChoice.value;
    }
  } else if (result.keyword === 'extort' && keywordChoice.type === 'mana_payment') {
    queueType = ResolutionStepType.EXTORT_PAYMENT;
    queueExtras.manaCost = String(keywordChoice.options?.[0]?.cost || '{W/B}');
    queueExtras.effectText = String(keywordChoice.options?.[0]?.effect || 'Each opponent loses 1 life and you gain that much life');
    queueExtras.cardName = sourceName;
    queueExtras.confirmLabel = 'Pay Extort';
    queueExtras.mandatory = false;
  } else if (result.keyword === 'soulshift' && keywordChoice.type === 'target_spirit') {
    queueType = ResolutionStepType.SOULSHIFT_TARGET;
    queueExtras.spirits = Array.isArray(keywordChoice.options)
      ? keywordChoice.options
          .map((option: any) => {
            const id = String(option?.id ?? '').trim();
            if (!id) return null;
            return {
              id,
              name: String(option?.name ?? option?.label ?? 'Spirit Card'),
              typeLine: option?.typeLine,
              manaCost: option?.manaCost,
              imageUrl: option?.imageUrl,
              cmc: option?.cmc,
              type: 'card',
            };
          })
          .filter(Boolean)
      : [];
    if (typeof keywordChoice.value === 'number' && Number.isFinite(keywordChoice.value)) {
      queueExtras.value = keywordChoice.value;
    }
  } else if (result.keyword === 'annihilator' && keywordChoice.type === 'sacrifice_permanents') {
    const requiredCount = Math.max(0, Number((result as any)?.sacrifice?.count || 0));
    const eligiblePermanents = Array.isArray(ctx?.state?.battlefield)
      ? ctx.state.battlefield
          .filter((entry: any) => {
            if (!entry) return false;
            return String(entry?.controller || '') === String(keywordChoice.playerId || '');
          })
          .map((entry: any) => ({
            id: String(entry?.id || ''),
            label: String(entry?.card?.name || 'Permanent'),
            description: 'permanent',
            imageUrl:
              entry?.card?.image_uris?.small ||
              entry?.card?.image_uris?.normal ||
              entry?.card?.imageUrl ||
              undefined,
            typeLine: entry?.card?.type_line,
          }))
          .filter((entry: any) => entry.id)
      : [];

    if (eligiblePermanents.length === 0 || requiredCount <= 0) {
      return true;
    }

    const effectiveCount = Math.min(requiredCount, eligiblePermanents.length);
    queueType = ResolutionStepType.TARGET_SELECTION;
    queueExtras.description = `${sourceName}: Choose ${effectiveCount} permanent${effectiveCount !== 1 ? 's' : ''} to sacrifice.`;
    queueExtras.validTargets = eligiblePermanents;
    queueExtras.targetTypes = ['permanent'];
    queueExtras.minTargets = effectiveCount;
    queueExtras.maxTargets = effectiveCount;
    queueExtras.targetDescription = 'permanent to sacrifice';
    queueExtras.sacrificeSelection = true;
    queueExtras.sacrificePermanentType = 'permanent';
    queueExtras.sacrificeCount = effectiveCount;
    queueExtras.sacrificeReason = `${sourceName}'s Annihilator ${requiredCount} triggered`;
    queueExtras.sacrificeSourceName = sourceName;
    queueExtras.annihilatorChoice = true;
  } else if (result.keyword === 'myriad' && keywordChoice.type === 'myriad_tokens') {
    const opponentOptions = Array.isArray(keywordChoice.options) ? keywordChoice.options : [];
    if (opponentOptions.length === 0) {
      return true;
    }

    queueType = ResolutionStepType.OPTION_CHOICE;
    queueExtras.description = `Choose any number of other opponents for ${sourceName}.`;
    queueExtras.minSelections = 0;
    queueExtras.maxSelections = opponentOptions.length;
    queueExtras.myriadChoice = true;
  }

  if (!queueType || !keywordGameId || keywordGameId === 'unknown') {
    return false;
  }

  const playerSteps = ResolutionQueueManager.getStepsForPlayer(keywordGameId, keywordChoice.playerId as any);
  const normalizedSourceId = String(sourceId || permanent?.id || '').trim();
  const normalizedPermanentId = String(keywordChoice.permanentId || permanent?.id || '').trim();
  const duplicateStep = playerSteps.some((step: any) =>
    step?.type === queueType &&
    String(step?.sourceId || '').trim() === normalizedSourceId &&
    String(step?.permanentId || '').trim() === normalizedPermanentId,
  );
  if (duplicateStep) {
    return true;
  }

  const normalizedOptions = Array.isArray(keywordChoice.options)
    ? keywordChoice.options
        .map((option: any) => {
          const id = String(option?.id ?? option?.value ?? option?.name ?? '').trim();
          if (!id) return null;
          return {
            ...option,
            id,
            label: String(option?.label ?? option?.name ?? id),
          };
        })
        .filter(Boolean)
    : [];
  const sourceImage =
    permanent?.card?.image_uris?.small ||
    permanent?.card?.image_uris?.normal ||
    permanent?.card?.imageUrl ||
    undefined;

  const queuedStep = ResolutionQueueManager.addStep(keywordGameId, {
    type: queueType,
    playerId: keywordChoice.playerId as any,
    description: String(result.chatMessage || `${sourceName}: Make a choice.`),
    mandatory: true,
    sourceId: normalizedSourceId,
    sourceName,
    sourceImage,
    permanentId: normalizedPermanentId,
    options: normalizedOptions,
    minSelections: 1,
    maxSelections: 1,
    ...queueExtras,
  } as any);

  appendQueuedResolutionPromptEvent(ctx, {
    playerId: String(keywordChoice.playerId || '').trim(),
    sourceId: normalizedSourceId,
    queuedResolutionStep: queuedStep,
  });

  return true;
}
