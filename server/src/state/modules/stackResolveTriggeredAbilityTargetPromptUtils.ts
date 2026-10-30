import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, cardManaValue } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import {
  buildTriggerSourcePermanentSnapshot,
  getTriggerSourcePermanent,
} from './triggerSourceUtils.js';
import {
  PERMANENT_TRIGGER_TARGET_TYPES,
  matchesTriggeredBattlefieldTarget,
  type TriggeredBattlefieldTargetFilterMetadata,
} from './triggeredAbilityBattlefieldTargetMatch.js';
import { canPermanentBeTargetedByPlayer } from '../../rules-engine/targeting.js';
import { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';
import { isPermanentCardTypeLine } from './stackResolvePermanentSpellTypeUtils.js';
import { stampMissingTargetMetadataAfterOptionalAccept } from './stackResolveTriggeredAbilityMissingTargetSafetyNet.js';
import { getCurrentPowerToughnessForRules } from './currentPowerToughness.js';

/** Damage the trigger will deal, for the target prompt ("deals 3 damage", "deals damage equal to its power"). */
function resolveTriggeredTargetDamagePreview(state: any, item: any, effectText: string): number | undefined {
  const text = String(effectText || '').toLowerCase();
  const fixed = text.match(/\bdeals? (\d+) damage\b/);
  if (fixed) return Number(fixed[1]);
  if (!/\bdeals? damage equal to (?:its|that creature's|that creature\u2019s) power\b/.test(text)) return undefined;
  const subjectId = String(
    item?.interveningIfSubjectPermanentId || item?.triggeringPermanentId || item?.enteringPermanentId || '',
  ).trim();
  if (!subjectId) return undefined;
  const subject = (Array.isArray(state?.battlefield) ? state.battlefield : []).find((perm: any) => String(perm?.id) === subjectId);
  if (!subject) return undefined;
  return getCurrentPowerToughnessForRules(subject, state).power;
}

function resolveTriggeredTargetCombatRole(item: any): TriggeredBattlefieldTargetFilterMetadata['targetCombatRole'] {
  const explicit = String(item?.targetCombatRole || '').trim();
  if (explicit === 'attacking' || explicit === 'blocking' || explicit === 'attacking_or_blocking') {
    return explicit;
  }
  const effectText = String(item?.effect || item?.description || item?.targetDescription || '');
  return inferTriggeredAbilityTargetMetadata(effectText).targetCombatRole;
}

function matchesTriggeredGraveyardTarget(card: any, metadata: {
  targetFilterTypes?: string[];
  targetFilterRequiredTypeWords?: string[];
  targetFilterExcludeTypes?: string[];
  targetFilterPermanentOnly?: boolean;
  targetFilterExactManaValue?: number;
  targetFilterMinManaValue?: number;
  targetFilterMaxManaValue?: number;
  rawEffectText?: string;
}): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (!typeLine) {
    return false;
  }

  const rawEffectText = String(metadata.rawEffectText || '').replace(/[â€™]/g, "'").toLowerCase();
  const artifactOrManaValueMatch = rawEffectText.match(
    /target\s+creature\s+card\s+in\s+your\s+graveyard\s+that'?s\s+an?\s+artifact\s+or\s+that\s+has\s+mana\s+value\s+(\d+)\s+or\s+less/,
  );
  if (artifactOrManaValueMatch) {
    const maxManaValue = Number.parseInt(String(artifactOrManaValueMatch[1] || ''), 10);
    if (!typeLine.includes('creature')) {
      return false;
    }
    if (typeLine.includes('artifact')) {
      return true;
    }
    if (Number.isFinite(maxManaValue)) {
      return cardManaValue(card) <= maxManaValue;
    }
  }

  if (metadata.targetFilterPermanentOnly === true && !isPermanentCardTypeLine(typeLine)) {
    return false;
  }

  if (Array.isArray(metadata.targetFilterTypes) && metadata.targetFilterTypes.length > 0) {
    const matchesAnyIncludedType = metadata.targetFilterTypes.some((type) => typeLine.includes(String(type || '').toLowerCase()));
    if (!matchesAnyIncludedType) {
      return false;
    }
  }

  if (Array.isArray(metadata.targetFilterRequiredTypeWords) && metadata.targetFilterRequiredTypeWords.length > 0) {
    const matchesAllRequiredTypeWords = metadata.targetFilterRequiredTypeWords.every((word) => typeLine.includes(String(word || '').toLowerCase()));
    if (!matchesAllRequiredTypeWords) {
      return false;
    }
  }

  if (Array.isArray(metadata.targetFilterExcludeTypes) && metadata.targetFilterExcludeTypes.length > 0) {
    const matchesExcludedType = metadata.targetFilterExcludeTypes.some((type) => typeLine.includes(String(type || '').toLowerCase()));
    if (matchesExcludedType) {
      return false;
    }
  }

  if (typeof metadata.targetFilterExactManaValue === 'number' && Number.isFinite(metadata.targetFilterExactManaValue)) {
    const manaValue = cardManaValue(card);
    if (manaValue !== metadata.targetFilterExactManaValue) {
      return false;
    }
  }

  if (typeof metadata.targetFilterMinManaValue === 'number' && Number.isFinite(metadata.targetFilterMinManaValue)) {
    const manaValue = cardManaValue(card);
    if (manaValue < metadata.targetFilterMinManaValue) {
      return false;
    }
  }

  if (typeof metadata.targetFilterMaxManaValue === 'number' && Number.isFinite(metadata.targetFilterMaxManaValue)) {
    const manaValue = cardManaValue(card);
    if (manaValue > metadata.targetFilterMaxManaValue) {
      return false;
    }
  }

  return true;
}

export function tryDeferTriggeredAbilityTargetSelection(
  ctx: GameContext,
  item: any,
  state: any,
  options: {
    triggerController: PlayerID;
    sourceName: string;
    sourceId: string;
    description: string;
    triggerType?: string;
  },
): boolean {
  // Safety net: a "you may ... target ..." trigger that was accepted (Yes) but was queued without
  // target metadata must still prompt for a target instead of silently skipping (Hammer of Nazahn class).
  stampMissingTargetMetadataAfterOptionalAccept(ctx, item, state, options);
  const requiresTarget = (item as any).requiresTarget;
  const targetType = (item as any).targetType;
  const triggerType = options.triggerType;
  const triggerController = options.triggerController;
  const sourceName = options.sourceName;
  const sourceId = options.sourceId;
  const description = options.description;

  if (requiresTarget && triggerType === 'etb') {
    const isReplaying = !!(ctx as any).isReplaying;

    if (!isReplaying) {
      debug(2, `[resolveTopOfStack] ETB trigger requires ${targetType || 'unknown'} target - delegating to generic triggered target selection`);
    }
  }

  if (!requiresTarget || String((item as any).type || '') !== 'triggered_ability') {
    return false;
  }

  // Mentor owns MENTOR_TARGET. Generic TARGET_SELECTION leaves an empty list.
  if (String(triggerType || '').toLowerCase() === 'mentor') {
    return false;
  }

  const isReplaying = !!(ctx as any).isReplaying;
  const battlefield = state.battlefield || [];
  const targetZone = String((item as any).targetZone || '').toLowerCase();
  const existingTargets = Array.isArray((item as any).targets)
    ? (item as any).targets.map((entry: any) => String(entry || '')).filter(Boolean)
    : [];
  const hasPersistedLockedTargets = existingTargets.length > 0 && (item as any).preselectedTargetsPersisted === true;
  const hasLockedBattlefieldTargets = existingTargets.length > 0 && (hasPersistedLockedTargets || targetZone !== 'graveyard');
  const targetDestination = String((item as any).targetDestination || '').toLowerCase();
  const targetAction = String((item as any).targetAction || '').toLowerCase();
  const lowerDescription = String(description || '').toLowerCase();
  const constrainedToController =
    String((item as any).targetConstraint || '').toLowerCase().includes('you control') ||
    lowerDescription.includes('target creature you control') ||
    lowerDescription.includes('target permanent you control');

  // If targets were already chosen (ETB/on-cast Choice stamp), do not re-prompt;
  // fall through so executeTriggerEffect can apply the GY return.
  if (!isReplaying && !hasPersistedLockedTargets && existingTargets.length === 0 && targetZone === 'graveyard') {
    const zones = (state.zones || {}) as Record<string, any>;
    const graveyardScope = String((item as any).targetGraveyardScope || 'your').toLowerCase();
    const graveyardOwners = graveyardScope === 'any'
      ? Object.keys(zones).filter((playerId) => {
          const graveyard = Array.isArray(zones[playerId]?.graveyard) ? zones[playerId].graveyard : [];
          return graveyard.length > 0;
        })
      : graveyardScope === 'opponent'
        ? Object.keys(zones).filter((playerId) => {
            if (String(playerId) === String(triggerController)) {
              return false;
            }
            const graveyard = Array.isArray(zones[playerId]?.graveyard) ? zones[playerId].graveyard : [];
            return graveyard.length > 0;
          })
        : [String(triggerController)];
    const targetFilterTypes = Array.isArray((item as any).targetFilterTypes) ? (item as any).targetFilterTypes : undefined;
    const targetFilterRequiredTypeWords = Array.isArray((item as any).targetFilterRequiredTypeWords) ? (item as any).targetFilterRequiredTypeWords : undefined;
    const targetFilterExcludeTypes = Array.isArray((item as any).targetFilterExcludeTypes) ? (item as any).targetFilterExcludeTypes : undefined;
    const targetFilterPermanentOnly = (item as any).targetFilterPermanentOnly === true;
    const targetFilterExactManaValue = typeof (item as any).targetFilterExactManaValue === 'number'
      ? Number((item as any).targetFilterExactManaValue)
      : undefined;
    const targetFilterMinManaValue = typeof (item as any).targetFilterMinManaValue === 'number'
      ? Number((item as any).targetFilterMinManaValue)
      : undefined;
    const targetFilterMaxManaValue = typeof (item as any).targetFilterMaxManaValue === 'number'
      ? Number((item as any).targetFilterMaxManaValue)
      : undefined;
    const targetTotalPowerLimit = typeof (item as any).targetTotalPowerLimit === 'number'
      ? Number((item as any).targetTotalPowerLimit)
      : undefined;
    const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
    const validTargets = graveyardOwners
      .flatMap((graveyardOwner) => {
        const playerZones = zones[graveyardOwner] || {};
        const graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
        return graveyard
          .filter((card: any) => matchesTriggeredGraveyardTarget(card, {
            targetFilterTypes,
            targetFilterRequiredTypeWords,
            targetFilterExcludeTypes,
            targetFilterPermanentOnly,
            targetFilterExactManaValue,
            targetFilterMinManaValue,
            targetFilterMaxManaValue,
            rawEffectText: String((item as any).effect || description || ''),
          }))
          .map((card: any) => ({
            id: String(card?.id || ''),
            name: String(card?.name || card?.id || 'Card'),
            typeLine: String(card?.type_line || ''),
            manaCost: String(card?.mana_cost || ''),
            imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
            zoneOwnerId: graveyardOwner,
          }));
      })
      .filter((card: any) => Boolean(card.id));

    const graveyardPromptSource = graveyardScope === 'opponent'
      ? "an opponent's graveyard"
      : graveyardScope === 'any'
        ? 'a graveyard'
        : 'your graveyard';

    const minSelectionCount = Math.max(0, Number((item as any).minTargets ?? 1));
    const requestedMaxSelectionCount = Math.max(minSelectionCount, Number((item as any).maxTargets ?? minSelectionCount));
    const maxSelectionCount = Math.min(validTargets.length, requestedMaxSelectionCount);

    if (validTargets.length >= minSelectionCount) {
      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.GRAVEYARD_SELECTION,
        playerId: triggerController as PlayerID,
        sourceId: String(sourceId || (item as any).id || ''),
        sourceName,
        description: targetAction === 'cast'
          ? `${sourceName}: Choose target card from ${graveyardPromptSource} to cast`
          : `${sourceName}: Choose target card from ${graveyardPromptSource}`,
        mandatory: true,
        effectId: String((item as any).id || sourceId || uid('graveyard_trigger')),
        cardName: sourceName,
        title: `${sourceName} â€” Select from graveyard`,
        targetPlayerId: graveyardOwners.length === 1 ? String(graveyardOwners[0] || '') : '',
        minTargets: minSelectionCount,
        maxTargets: maxSelectionCount,
        totalPowerLimit: targetTotalPowerLimit,
        destination: targetAction === 'cast' ? 'cast' : targetDestination,
        destinationUsesSelectedCardOwner: (item as any).destinationUsesSelectedCardOwner === true,
        battlefieldControllerMode: String((item as any).battlefieldControllerMode || '').toLowerCase() === 'owner' ? 'owner' : undefined,
        delayedReturnAt: ['next_end_step', 'next_upkeep_selected_card_owner'].includes(String((item as any).delayedReturnAt || '').toLowerCase())
          ? String((item as any).delayedReturnAt || '').toLowerCase()
          : undefined,
        battlefieldTapped: (item as any).battlefieldTapped === true,
        battlefieldCounters: (item as any).battlefieldCounters && typeof (item as any).battlefieldCounters === 'object'
          ? { ...((item as any).battlefieldCounters as Record<string, number>) }
          : undefined,
        battlefieldFaceDown: (item as any).battlefieldFaceDown === true,
        battlefieldSuspected: (item as any).battlefieldSuspected === true,
        ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
        validTargets,
        ...(targetAction === 'cast'
          ? {
              triggeredAbilityGraveyardSelection: true,
              triggeredAbilityCastFromGraveyard: true,
              triggeredAbilityCastWithoutPayingManaCost: (item as any).targetCastWithoutPayingManaCost === true,
              triggeredAbilityMayCastFromGraveyard: (item as any).targetCastIsOptional === true,
            }
          : targetDestination
            ? {
                // Stamp Choice so live-stack ETB/mutate paths can assign targets.
                // Also stamp Selection so resolve-then-choose (Ratchet reflexive)
                // apply+persist still matches GRAVEYARD_SELECTION consumers.
                triggeredAbilityGraveyardChoice: true,
                triggeredAbilityGraveyardSelection: true,
              }
            : {
              // Apply via executeTriggerEffect (IR uncategorized fallback / keyword grants).
              // Do not use stamp-and-return: the trigger is already popped, and an empty
              // destination would otherwise default to moving the card to hand.
              triggeredAbilityGraveyardSelection: true,
            }),
        triggeredAbilityEffectText: String((item as any).effect || description || ''),
        triggeredAbilitySourcePermanentId: String((item as any).source || (item as any).permanentId || ''),
        triggeredAbilityCardSnapshot: (item as any).card && typeof (item as any).card === 'object'
          ? { ...((item as any).card as any) }
          : undefined,
      } as any);

      debug(2, `[resolveTopOfStack] ${triggerType} requires graveyard target selection for ${sourceName}`);
      return true;
    }
  }

  // Graveyard-card targets are not also battlefield creatures.
  if (targetZone === 'graveyard') {
    return false;
  }

  if (!isReplaying && !hasLockedBattlefieldTargets) {
    const targetFilterTypes = Array.isArray((item as any).targetFilterTypes) ? (item as any).targetFilterTypes : undefined;
    const targetFilterRequiredTypeWords = Array.isArray((item as any).targetFilterRequiredTypeWords) ? (item as any).targetFilterRequiredTypeWords : undefined;
    const targetFilterExcludeTypes = Array.isArray((item as any).targetFilterExcludeTypes) ? (item as any).targetFilterExcludeTypes : undefined;
    const normalizedTargetType = String(targetType || '').toLowerCase();
    const targetsBattlefield = PERMANENT_TRIGGER_TARGET_TYPES.has(normalizedTargetType) || normalizedTargetType === 'any';
    const targetsPlayers = ['player', 'opponent', 'any', 'any target', 'any_target'].includes(normalizedTargetType);
    const validPermanentTargets = targetsBattlefield
      ? battlefield
          .filter((permanent: any) => {
            if (!permanent) return false;
            const typeLine = String(permanent.card?.type_line || '').toLowerCase();
            const matchesType = matchesTriggeredBattlefieldTarget(
              normalizedTargetType,
              typeLine,
              {
                targetFilterTypes,
                targetFilterRequiredTypeWords,
                targetFilterExcludeTypes,
                targetFilterRequiresOneOrMoreColors: (item as any).targetFilterRequiresOneOrMoreColors === true,
                targetCombatRole: resolveTriggeredTargetCombatRole(item),
              },
              permanent,
              state,
            );
            if (!matchesType) return false;
            // "any target that isn't a commander" (Lozhan, Dragons' Legacy).
            if (/\bthat (?:isn't|is not|isn\u2019t) a commander\b/i.test(String((item as any).effect || description || ''))) {
              const cid = String(permanent.card?.id || '');
              const cz: any = (state as any).commandZone || {};
              if (permanent.isCommander === true || (cid && Object.values(cz).some((z: any) => Array.isArray(z?.commanderIds) && z.commanderIds.map(String).includes(cid)))) return false;
            }
            // Hexproof/shroud (printed, equipment/aura, static and runtime grants).
            if (!canPermanentBeTargetedByPlayer(permanent, state, String(triggerController) as PlayerID)) return false;
            if (String((item as any).targetConstraint || '').toLowerCase() === 'opponent') {
              return String(permanent.controller || '') !== String(triggerController);
            }
            if (!constrainedToController) return true;
            return String(permanent.controller || '') === String(triggerController);
          })
          .map((permanent: any) => ({
            id: permanent.id,
            label: permanent.card?.name || 'Permanent',
            description: permanent.card?.type_line || 'Permanent',
            image: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
          }))
      : [];
    const validPlayerTargets = targetsPlayers
      ? ((state.players || []) as any[])
          .filter((player: any) => player && player.id && (player as any).hasLost !== true)
          .filter((player: any) => {
            if (normalizedTargetType === 'opponent' || String((item as any).targetConstraint || '').toLowerCase() === 'opponent') {
              return String(player.id) !== String(triggerController);
            }
            return true;
          })
          .map((player: any) => ({
            id: String(player.id),
            label: player.name || String(player.id),
            description: 'Player',
            life: typeof state.life?.[player.id] === 'number' ? state.life[player.id] : player.life,
          }))
      : [];
    const validTargets = [...validPermanentTargets, ...validPlayerTargets];
    const minSelectionCount = Math.max(0, Number((item as any).minTargets ?? 1));
    const requestedMaxSelectionCount = Math.max(minSelectionCount, Number((item as any).maxTargets ?? minSelectionCount));
    const maxSelectionCount = Math.min(validTargets.length, requestedMaxSelectionCount);
    const combatRole = resolveTriggeredTargetCombatRole(item);
    const combatRoleLabel =
      combatRole === 'attacking' ? 'attacking creature'
      : combatRole === 'blocking' ? 'blocking creature'
      : combatRole === 'attacking_or_blocking' ? 'attacking or blocking creature'
      : '';
    const targetDescription = String(
      (item as any).targetDescription
      || combatRoleLabel
      || (normalizedTargetType === 'any' || normalizedTargetType === 'any target' || normalizedTargetType === 'any_target'
        ? 'any target'
        : `target ${targetType || 'object'}`),
    );

    if ((targetsBattlefield || targetsPlayers) && validTargets.length >= minSelectionCount) {
      const damagePreview = resolveTriggeredTargetDamagePreview(state, item, String((item as any).effect || description || ''));
      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: triggerController as PlayerID,
        description: `${sourceName}: Choose ${targetDescription}`,
        mandatory: minSelectionCount > 0,
        sourceId,
        sourceName,
        validTargets,
        targetTypes: [targetType],
        minTargets: minSelectionCount,
        maxTargets: maxSelectionCount,
        targetDescription,
        targetedTriggeredAbility: true,
        triggerItem: item,
        action: (item as any).action,
        targetedTriggeredAbilitySourceName: sourceName,
        targetedTriggeredAbilityDescription: description,
        targetedTriggeredAbilityController: String(triggerController),
        ...(typeof damagePreview === 'number' ? { damagePreview } : {}),
      } as any);

      debug(2, `[resolveTopOfStack] ${triggerType} requires target ${targetType} selection for ${sourceName}`);
      return true;
    }
  }

  return false;
}
